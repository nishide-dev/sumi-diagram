import { expect, test } from "bun:test";
import { buildFullCatalog } from "../../core/catalog";
import { checkFigure } from "../../core/check";
import { FigureTargetSchema } from "../../core/figure/schema";
import { builtinRegistry } from "../../core/registry/builtins";
import { mmToPt } from "../../core/units";
import { renderFigure } from "../../render/render";
import { lintGeometry, lintRenderedFigure } from "./lint";
import { heavyScaling } from "./rules";
import { exceedsTargetHeight, lineTooThin, placementUsage } from "./target";
import { compile, inspection, label, lintSpec } from "./testing";

const source = (target = "", extra = "") => `version: 1
figure:
  id: placement
  theme: paper
  profile: paper-double
  ${target ? `target: ${target}` : ""}
  ${extra}
  layout: { arrange: { stack: { gap: 10mm, items: [a, b] } } }
nodes:
  - { id: a, component: box, label: A }
  - { id: b, component: box, label: B }
edges: [{ from: a, to: b }]
`;

test("target lengths are strict, normalized, and minFontSize has a 4.5pt floor", () => {
  const parsed = FigureTargetSchema.parse({
    height: "6cm",
    minFontSize: "4.5pt",
    minLineWidth: "0.3pt",
  });
  expect(parsed.height).toBeCloseTo(mmToPt(60), 10);
  expect(parsed).toMatchObject({ minFontSize: 4.5, minLineWidth: 0.3 });
  for (const input of [
    { height: "0pt" },
    { height: "-1mm" },
    { height: 60 },
    { minFontSize: "4.49pt" },
    { minFontSize: "NaNpt" },
    { minLineWidth: 0 },
    { aspectRatio: 2 },
    { width: "80mm" },
  ])
    expect(FigureTargetSchema.safeParse(input).success).toBe(false);
  expect(FigureTargetSchema.parse({})).toEqual({});
});

test("catalog exposes the same target input schema and meanings", () => {
  const catalog = buildFullCatalog(builtinRegistry(), { sections: ["targets"] });
  expect(Object.keys(catalog)).toEqual(["version", "targets"]);
  expect(catalog.targets?.path).toBe("figure.target");
  expect(Object.keys(catalog.targets?.schema.properties ?? {})).toEqual([
    "height",
    "minFontSize",
    "minLineWidth",
  ]);
  expect(JSON.stringify(catalog.targets)).toContain("4.5pt");
});

test("height is a warning at the budget source, with printed placement attribution", async () => {
  const text = source("{ height: 10mm }");
  const result = await renderFigure(text);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const findings = lintGeometry(result.value, {
    source: text,
    file: "placement.sumi.yaml",
    rules: [exceedsTargetHeight, placementUsage],
  });
  expect(findings).toHaveLength(2);
  const height = findings.find((d) => d.code === "geometry/exceeds-target-height");
  expect(height).toMatchObject({
    severity: "warning",
    path: ["figure", "target", "height"],
    location: { file: "placement.sumi.yaml", line: 6 },
  });
  expect(height?.message).toContain("10mm target height budget");
  expect(height?.hint).toContain("top-level bodies/labels");
  expect(height?.hint).toContain("gaps 10mm");
  expect(height?.hint).toContain('node "a"');
  const usage = findings.find((d) => d.code === "geometry/placement-usage");
  expect(usage?.message).toContain("Placement reserves 180mm ×");
  expect(usage?.message).toContain("Width use:");
  const natural = await renderFigure(source());
  const withoutInputHash = (svg: string) => svg.replace(/input-sha256="[a-f0-9]+"/, "");
  expect(natural.ok && withoutInputHash(natural.value.svg)).toBe(
    withoutInputHash(result.value.svg),
  );
});

test("height comparison uses the final scale, is inclusive, and is configurable", () => {
  const text = source("{ height: 50pt }");
  const compiled = compile(text);
  const spec = { canvas: { x: 0, y: 0, width: 400, height: 200 }, scale: 0.5, elements: {} };
  expect(lintSpec(compiled, spec, { code: "geometry/exceeds-target-height" })).toEqual([]);
  expect(
    lintSpec(compiled, { ...spec, scale: 0.6 }, { code: "geometry/exceeds-target-height" }),
  ).toHaveLength(1);
  expect(
    lintSpec(
      compiled,
      { ...spec, scale: 0.6 },
      {
        code: "geometry/exceeds-target-height",
        config: { rules: { "geometry/exceeds-target-height": "off" } },
      },
    ),
  ).toEqual([]);
});

test("9pt rejects 8pt final labels; 5pt accepts exactly 5pt, overriding both profile minima", async () => {
  const high = await lintRenderedFigure(source("{ minFontSize: 9pt }"));
  const errors = high.diagnostics.filter((d) => d.code === "geometry/text-too-small");
  expect(errors).toHaveLength(2);
  expect(
    errors.every((d) => d.severity === "error" && d.message.includes("figure.target.minFontSize")),
  ).toBe(true);
  const lowText = source("{ minFontSize: 5pt }").replace("paper-double", "presentation-16x9");
  expect(checkFigure(lowText).state.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  for (const scale of [1, 0.5]) {
    const compiled = compile(lowText);
    const spec = {
      scale,
      elements: { "n:a": { labels: [label("A", 30, 30, { fontSizeUnits: 10 / scale })] } },
    };
    expect(lintSpec(compiled, spec, { code: "geometry/text-too-small" })).toEqual([]);
    const small = {
      ...spec,
      elements: { "n:a": { labels: [label("A", 30, 30, { fontSizeUnits: 9.8 / scale })] } },
    };
    expect(lintSpec(compiled, small, { code: "geometry/text-too-small" })[0]?.severity).toBe(
      "error",
    );
  }
});

test("scaling advice uses final headroom, including the DETR-like 4.2pt script at 85%", () => {
  const compiled = compile(source("{ minFontSize: 5pt }", "fit: scale"));
  const findings = (size: number, scale: number, script = false) =>
    lintGeometry(
      {
        compiled,
        inspection: inspection(compiled, {
          scale,
          elements: {
            "n:a": {
              labels: [
                label("A", 30, 30, {
                  fontSizeUnits: size * 2,
                  ...(script && {
                    runs: [
                      [
                        {
                          text: "i",
                          font: "math",
                          fontSizeUnits: (4.2 * 2) / scale,
                          shiftUnits: 2,
                        },
                      ],
                    ],
                  }),
                }),
              ],
            },
          },
        }),
      },
      { rules: [heavyScaling] },
    );
  expect(findings(10, 0.6)).toHaveLength(1); // exactly 20% headroom
  expect(findings(10.1, 0.6)).toEqual([]); // 60% scaling is fine with readable text
  expect(findings(5.5, 0.95)).toHaveLength(1); // 95% can still be near the minimum
  expect(findings(8, 0.85, true)[0]?.message).toContain("4.2pt");
  expect(findings(8, 0.85, true)[0]?.message).toContain("84%");
  expect(findings(5, 1)).toEqual([]);
  expect(
    lintGeometry(
      { compiled, inspection: inspection(compiled, { scale: 0.5, elements: {} }) },
      { rules: [heavyScaling] },
    ),
  ).toEqual([]);
});

test("line minima use printed stroke widths, report locations and ignore invisible/text shapes", async () => {
  const text = source("{ minLineWidth: 0.5pt }");
  const result = await renderFigure(text);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  expect(lintGeometry(result.value, { rules: [lineTooThin] })).toEqual([]);
  const scaled = { ...result.value, inspection: { ...result.value.inspection, scale: 0.85 } };
  const findings = lintGeometry(scaled, { rules: [lineTooThin], source: text });
  expect(findings.length).toBeGreaterThan(0);
  expect(findings.every((d) => d.severity === "warning" && d.location !== undefined)).toBe(true);
  expect(findings.some((d) => d.subject?.kind === "edge")).toBe(true);
  expect(findings[0]?.message).toContain("0.42pt");
  const quiet = await renderFigure(
    source("{ minLineWidth: 9pt }")
      .replaceAll("component: box", "component: label")
      .replace("edges: [{ from: a, to: b }]", "edges: []"),
  );
  if (!quiet.ok) throw new Error(JSON.stringify(quiet.diagnostics));
  expect(lintGeometry(quiet.value, { rules: [lineTooThin] })).toEqual([]);
});

test("the same target minimum reaches sublabels, HTML and scaled script information", async () => {
  const sublabel = await lintRenderedFigure(
    source("{ minFontSize: 8pt }").replace("label: A }", "label: A, sublabel: Detail }"),
  );
  expect(
    sublabel.diagnostics.find(
      (d) => d.code === "geometry/text-too-small" && d.path?.includes("sublabel"),
    )?.message,
  ).toContain("7pt");
  const htmlSource = source("{ minFontSize: 9pt }").replace(
    "{ id: a, component: box, label: A }",
    `{ id: a, component: html, props: { width: 80pt, height: 30pt, viewport: 160x60, html: '<div style="font-size: 16px">Readable</div>' } }`,
  );
  const html = await lintRenderedFigure(htmlSource);
  expect(html.rendered).toBeDefined();
  expect(
    html.diagnostics.find((d) => d.code === "geometry/text-too-small" && d.path?.includes("html"))
      ?.message,
  ).toContain("figure.target.minFontSize");
  const compiled = compile(source("{ minFontSize: 9pt }", "fit: scale"));
  const spec = {
    scale: 0.9,
    elements: {
      "n:a": {
        labels: [
          label("A", 30, 30, {
            fontSizeUnits: 20,
            runs: [[{ text: "i", font: "math", fontSizeUnits: 14, shiftUnits: 2 }]],
          }),
        ],
      },
    },
  };
  const script = lintSpec(compiled, spec, { code: "geometry/script-too-small" });
  expect(script[0]?.message).toContain("9pt minimum font size of figure.target.minFontSize");
  expect(script[0]?.severity).toBe("info");
});

test("a standalone junction paints no stroke, so it never trips minLineWidth", async () => {
  const header =
    "version: 1\nfigure: { id: j, theme: paper, target: { minLineWidth: 1.1pt }, layout: { engine: structured, arrange: { stack: { items: [j] } } } }\n";
  const lone = await renderFigure(
    `${header}nodes:\n  - { id: j, component: junction }\nedges: []\n`,
  );
  if (!lone.ok) throw new Error(JSON.stringify(lone.diagnostics));
  expect(lone.value.svg).toMatch(/<circle [^>]*stroke="none"/);
  expect(lintGeometry(lone.value, { rules: [lineTooThin] })).toEqual([]);
  const real = await renderFigure(source("{ minLineWidth: 9pt }"));
  if (!real.ok) throw new Error(JSON.stringify(real.diagnostics));
  const kinds = lintGeometry(real.value, { rules: [lineTooThin] }).map((d) => d.subject?.kind);
  expect(kinds).toContain("node");
  expect(kinds).toContain("edge");
});

test("emitted JSON Schema keeps positive-length and 4.5pt floor constraints", async () => {
  const emitted = JSON.parse(await Bun.file("schema/figure.v1.schema.json").text());
  const catalogSchema = buildFullCatalog(builtinRegistry(), { sections: ["targets"] }).targets
    ?.schema;
  const patternOf = (schema: unknown, key: string): RegExp => {
    const props = (schema as { properties: Record<string, { pattern?: string }> }).properties;
    const pattern = props[key]?.pattern;
    if (pattern === undefined) throw new Error(`no pattern for ${key}`);
    return new RegExp(pattern);
  };
  const find = (node: unknown): unknown => {
    if (node && typeof node === "object") {
      const record = node as Record<string, unknown>;
      const props = record.properties as Record<string, unknown> | undefined;
      if (props && "minFontSize" in props && "minLineWidth" in props) return node;
      for (const value of Object.values(record)) {
        const hit = find(value);
        if (hit) return hit;
      }
    }
    return undefined;
  };
  for (const schema of [find(emitted), catalogSchema]) {
    expect(schema).toBeDefined();
    const height = patternOf(schema, "height");
    const line = patternOf(schema, "minLineWidth");
    const font = patternOf(schema, "minFontSize");
    for (const bad of ["0pt", "0mm", "0.00cm", "00in"]) {
      expect(height.test(bad)).toBe(false);
      expect(line.test(bad)).toBe(false);
    }
    for (const ok of ["0.3pt", "60mm", "0.01in", "10pt"]) expect(line.test(ok)).toBe(true);
    for (const bad of ["4pt", "4.49pt", "1.58mm", "0.158cm", "0.06in", "0pt"])
      expect(font.test(bad)).toBe(false);
    for (const ok of ["4.5pt", "4.50pt", "5pt", "12pt", "1.5875mm", "2mm", "0.16cm", "0.0625in"])
      expect(font.test(ok)).toBe(true);
  }
});
