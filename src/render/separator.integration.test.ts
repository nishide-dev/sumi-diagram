import { expect, test } from "bun:test";
import { compileFigure } from "../compiler/compile";
import { BUILTIN_MANIFESTS, builtinRegistry } from "../core/registry/builtins";
import { buildCatalog } from "../core/registry/catalog";
import { Registry } from "../core/registry/registry";
import { BUILTIN_THEMES } from "../core/theme/builtin";
import { lintGeometry } from "../lint";
import { svgToPdf } from "./pdf";
import { parsePdf } from "./pdf/testing";
import { svgToEditablePptx, svgToPptx } from "./pptx";
import { readPptx } from "./pptx/testing";
import { renderFigure } from "./render";

const source = (
  theme = "paper",
  axis = "row",
  variant = "dashed",
  align = "center",
  direction = "",
) => `version: 1
figure:
  id: panels
  theme: ${theme}
  profile: ${theme === "slides" ? "presentation-16x9" : "paper-double"}
  layout:
    arrange: { ${axis}: { gap: 8pt, align: ${align}, ${direction ? `direction: ${direction},` : ""} items: [left, cut, right] } }
groups:
  - { id: left, variant: plain, arrange: { stack: { items: [a, b] } } }
  - { id: right, variant: plain, arrange: { row: { items: [c, d] } } }
nodes:
  - { id: a, component: box, label: Panel A }
  - { id: b, component: box, label: Input }
  - { id: cut, component: separator, variant: ${variant} }
  - { id: c, component: box, label: Panel B }
  - { id: d, component: box, label: Output }
`;

test("reproduce #309 against the v0.11.0 component set", () => {
  const registry = new Registry();
  for (const manifest of BUILTIN_MANIFESTS) {
    if (manifest.name !== "separator") registry.register(manifest);
  }
  const result = compileFigure(source(), { registry });
  expect(result.ok).toBe(false);
  expect(result.diagnostics.some((d) => d.code === "component/unknown")).toBe(true);
});

test("separator catalog describes variants, version and empty props", () => {
  const entry = buildCatalog(builtinRegistry()).components.find((c) => c.id === "sumi/separator");
  expect(entry).toMatchObject({ since: "0.12.0", variants: ["default", "dashed", "solid"] });
  const manifest = builtinRegistry().resolve("separator", "node");
  if (!manifest.ok) throw new Error("missing separator");
  expect(manifest.value.props.parse({})).toEqual({});
  expect(manifest.value.props.safeParse({ height: "10pt" }).success).toBe(false);
});

for (const theme of BUILTIN_THEMES.keys()) {
  for (const axis of ["row", "stack"]) {
    for (const variant of ["default", "dashed", "solid"]) {
      test(`${theme}/${axis}/${variant}: full sibling span, lint-free and all export formats`, async () => {
        const result = await renderFigure(source(theme, axis, variant));
        if (!result.ok || !("layout" in result.value)) throw new Error(JSON.stringify(result));
        const { svg, layout, compiled } = result.value;
        expect(result.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
        expect(lintGeometry(result.value).filter((d) => d.severity !== "info")).toEqual([]);
        const cut = layout.nodes.find((n) => n.key === "n:cut")?.rect;
        if (!cut) throw new Error("missing separator");
        const groups = layout.groups.map((g) => g.rect);
        const start = axis === "row" ? "y" : "x";
        const span = axis === "row" ? "height" : "width";
        expect(cut[start]).toBe(Math.min(...groups.map((g) => g[start])));
        expect(cut[span]).toBeCloseTo(Math.max(...groups.map((g) => g[span])), 2);
        expect(axis === "row" ? cut.width : cut.height).toBe(0);
        const shape = svg.match(
          /<g class="sumi-k-n--cut sumi-kind-node"><g class="shape">(.*?)<\/g>/,
        )?.[1];
        expect(shape).toContain('<path d="M ');
        expect(shape).toContain('fill="none"');
        expect(shape?.includes("stroke-dasharray")).toBe(variant !== "solid");
        const pdf = svgToPdf(svg);
        if (!pdf.ok) throw new Error(JSON.stringify(pdf.diagnostics));
        const coordinates = shape?.match(/d="M ([\d.]+) ([\d.]+) L ([\d.]+) ([\d.]+)"/);
        if (!coordinates) throw new Error("missing divider path");
        const streams = [...parsePdf(pdf.value).objects.values()]
          .filter((o) => o.stream !== undefined)
          .map((o) => new TextDecoder("latin1").decode(o.stream))
          .join("\n");
        expect(streams).toContain(
          `${coordinates[1]} ${coordinates[2]} m ${coordinates[3]} ${coordinates[4]} l`,
        );
        const picture = svgToPptx(svg);
        if (!picture.ok) throw new Error(JSON.stringify(picture.diagnostics));
        const pictureSvg = new TextDecoder().decode(
          readPptx(picture.value).get("ppt/media/figure.svg"),
        );
        const paintedPath = [...pictureSvg.matchAll(/<path\b[^>]*>/g)]
          .map((m) => m[0])
          .find((tag) => {
            const points = tag.match(/d="M ([\d.]+) ([\d.]+) L ([\d.]+) ([\d.]+)"/);
            return points
              ?.slice(1)
              .every((value, i) => Math.abs(Number(value) - Number(coordinates[i + 1])) < 0.001);
          });
        expect(paintedPath).toContain('fill="none"');
        expect(paintedPath?.includes("stroke-dasharray")).toBe(variant !== "solid");
        for (const connectors of ["freeform", "glued"] as const) {
          const pptx = svgToEditablePptx(svg, compiled.ir, { connectors });
          if (!pptx.ok) throw new Error(JSON.stringify(pptx.diagnostics));
          const slide = new TextDecoder().decode(readPptx(pptx.value).get("ppt/slides/slide1.xml"));
          const object = slide.match(
            /<p:sp><p:nvSpPr><p:cNvPr[^>]*name="n:cut"[\s\S]*?<\/p:sp>/,
          )?.[0];
          expect(object).toContain("<a:custGeom>");
          expect(object).toContain("<a:moveTo>");
          expect(object).toContain("<a:lnTo>");
          expect(object?.includes("<a:custDash>")).toBe(variant !== "solid");
          expect(object).toContain('cap="flat"');
        }
      });
    }
  }
}

for (const [axis, direction] of [
  ["row", "left"],
  ["stack", "up"],
]) {
  for (const align of ["start", "center", "end", "stretch"]) {
    test(`${axis}/${direction}/${align}: separator stretches independently of alignment`, async () => {
      const result = await renderFigure(source("paper", axis, "solid", align, direction));
      if (!result.ok || !("layout" in result.value)) throw new Error(JSON.stringify(result));
      const { layout } = result.value;
      const cut = layout.nodes.find((n) => n.key === "n:cut")?.rect;
      if (!cut) throw new Error("missing separator");
      const span = axis === "row" ? "height" : "width";
      expect(cut[span]).toBeCloseTo(Math.max(...layout.groups.map((g) => g.rect[span])), 2);
    });
  }
}

test("separator rejects labels, badges, props, connections and non-linear placement", () => {
  for (const [text, code] of [
    [
      source().replace("component: separator,", "component: separator, label: nope,"),
      "component/unexpected-label",
    ],
    [
      source().replace("component: separator,", "component: separator, props: { height: 10pt },"),
      "component/unknown-prop",
    ],
    [`${source()}edges:\n  - { from: cut, to: a }\n`, "component/separator-connection"],
    [
      source().replace(
        "row: { gap: 8pt, align: center,",
        "grid: { columns: 3, columnGap: 8pt, align: center,",
      ),
      "component/separator-placement",
    ],
    [
      source()
        .replace("items: [left, cut, right]", "items: [left, right]")
        .replace(
          "component: separator,",
          "component: separator, attach: { to: left, side: east },",
        ),
      "component/separator-placement",
    ],
  ] as const) {
    const result = compileFigure(text);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toContain(code);
  }
});

test("nested stretching row keeps a zero-width separator and routes across it without an obstacle", async () => {
  const text = source()
    .replace(
      "arrange: { row: { gap: 8pt, align: center,  items: [left, cut, right] } }",
      "arrange: { stack: { align: stretch, items: [{ row: { gap: 8pt, align: start, justify: stretch, items: [left, cut, right] } }, wide] } }",
    )
    .replace(
      "nodes:\n",
      "nodes:\n  - { id: wide, component: box, label: Wide, props: { width: 300pt } }\n",
    );
  const result = await renderFigure(`${text}edges:\n  - { from: b, to: d }\n`);
  if (!result.ok || !("layout" in result.value)) throw new Error(JSON.stringify(result));
  expect(result.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
  expect(lintGeometry(result.value).filter((d) => d.severity !== "info")).toEqual([]);
  const cut = result.value.layout.nodes.find((n) => n.key === "n:cut")?.rect;
  expect(cut?.width).toBe(0);
  expect(cut?.height).toBeCloseTo(
    Math.max(...result.value.layout.groups.map((g) => g.rect.height)),
    2,
  );
});

for (const variant of ["dashed", "solid"]) {
  for (const dim of [false, true]) {
    test(`${variant}/dim=${dim}: tone colors the line and dim overrides it`, async () => {
      const text = source("paper", "row", variant)
        .replace("items: [left, cut, right]", "items: [outer]")
        .replace(
          "groups:\n",
          `groups:\n  - { id: outer, variant: plain, ${dim ? "dim: true, " : ""}arrange: { row: { items: [left, cut, right] } } }\n`,
        )
        .replace("component: separator,", "component: separator, tone: purple,");
      const result = await renderFigure(text);
      if (!result.ok) throw new Error(JSON.stringify(result));
      const theme = BUILTIN_THEMES.get("paper");
      const color = dim ? theme?.dim?.stroke : theme?.toneLines.get("purple")?.stroke;
      const cut = result.value.svg.match(
        /<g class="sumi-k-n--cut sumi-kind-node"><g class="shape">(.*?)<\/g>/,
      )?.[1];
      expect(cut).toContain(`stroke="${color}"`);
      expect(lintGeometry(result.value).filter((d) => d.severity !== "info")).toEqual([]);
    });
  }
}

test("grow on a separator is a located component/grow-unsupported error", async () => {
  const text = source().replace("component: separator,", "component: separator, grow: 2,");
  const result = await renderFigure(text);
  expect(result.ok).toBe(false);
  const found = result.diagnostics.find((d) => d.code === "component/grow-unsupported");
  expect(found?.severity).toBe("error");
  expect(found?.path).toEqual(["nodes", 2, "grow"]);
  expect(found?.location).toBeDefined();
});
