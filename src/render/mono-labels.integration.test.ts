import { describe, expect, test } from "bun:test";
import { checkFigure } from "../core/check";
import { BUILTIN_THEMES, getTheme } from "../core/theme/builtin";
import { getFontSet } from "../core/theme/fonts";
import type { Theme } from "../core/theme/schema";
import { measureLabel } from "../lint/geometry/measure";
import { svgToPdf } from "./pdf";
import { inspectPdf } from "./pdf/testing";
import { svgToEditablePptx } from "./pptx";
import { readPptx } from "./pptx/testing";
import { type RenderedStructuredFigure, renderFigure } from "./render";

const source = (nodes: string, theme = "paper", items = "a") => `version: 1
figure:
  id: mono-labels
  theme: ${theme}
  profile: paper-double
  layout:
    arrange: { row: { items: [${items}] } }
nodes:
${nodes}
edges: []
`;
const pair = (aFields: string, bFields = aFields, aLabel = "iiiiiiii", bLabel = "WWWWWWWW") =>
  source(
    `  - { id: a, component: label, label: ${JSON.stringify(aLabel)}${aFields} }
  - { id: b, component: label, label: ${JSON.stringify(bLabel)}${bFields} }`,
    "paper",
    "a, b",
  );
const withoutHash = (svg: string) => svg.replace(/input-sha256="[0-9a-f]+"/, "");

/** Register a private in-memory theme without changing any built-in theme. */
async function withTheme(overrides: Partial<Theme>, run: (id: string) => Promise<void>) {
  const paper = getTheme("paper");
  if (!paper) throw new Error("missing paper theme");
  const id = "test-mono-labels";
  const themes = BUILTIN_THEMES as Map<string, Theme>;
  themes.set(id, { ...paper, ...overrides, id });
  try {
    await run(id);
  } finally {
    themes.delete(id);
  }
}

const expanded = (component: "matrix" | "legend", mono = "") =>
  source(`  - id: a
    component: ${component}
    label: iiiWWW${mono}
    props: ${component === "matrix" ? "{ classes: { x: { label: Cell } }, cells: [x] }" : "{ entries: [{ node: { component: box }, label: Entry }] }"}`);

async function render(yaml: string, theme?: string) {
  const result = await renderFigure(
    theme === undefined ? yaml : yaml.replace("theme: paper", `theme: ${theme}`),
  );
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value as RenderedStructuredFigure;
}

describe("monospace node labels (#279)", () => {
  test("mono: true uses the font set's mono font and every character has one width", async () => {
    for (const theme of ["minimal", "academic", "slides", "color", "paper"]) {
      const rendered = await render(pair(", mono: true"), theme);
      const [a, b] = rendered.layout.nodes;
      expect(a?.rect.width).toBeCloseTo(b?.rect.width ?? -1, 4);
      const labels = rendered.inspection.elements.flatMap((e) => e.labels);
      expect(labels.map((l) => l.font)).toEqual(["mono", "mono"]);
      expect(rendered.svg).toContain("text-mono");
      const fonts = getFontSet(rendered.compiled.fontSet.id);
      if (!fonts) throw new Error("missing fonts");
      const widths = labels.map((l) => measureLabel(l, fonts).box?.width ?? -1);
      expect(widths[0]).toBeCloseTo(widths[1] ?? -2, 4);
    }
    // Proportional text keeps different widths, so the equality above is meaningful.
    const plain = await render(pair(""));
    const [pa, pb] = plain.layout.nodes;
    expect(pa?.rect.width).not.toBeCloseTo(pb?.rect.width ?? -1, 1);
  });

  test("without mono nothing changes, and mono: false turns a theme's mono off", async () => {
    const plain = await render(pair(""));
    expect(plain.svg).not.toContain("text-mono");
    const off = await render(pair(", mono: false"));
    expect(withoutHash(off.svg)).toBe(withoutHash(plain.svg));
    const paper = getTheme("paper");
    if (!paper) throw new Error("missing paper theme");
    await withTheme(
      { base: { ...paper.base, node: { ...paper.base.node, mono: true } } },
      async (id) => {
        const inherited = await render(pair(""), id);
        expect(inherited.inspection.elements.flatMap((e) => e.labels.map((l) => l.font))).toEqual([
          "mono",
          "mono",
        ]);
        const overridden = await render(pair(", mono: false"), id);
        expect(overridden.inspection.elements.flatMap((e) => e.labels.map((l) => l.font))).toEqual(
          plain.inspection.elements.flatMap((e) => e.labels.map((l) => l.font)),
        );
        expect(overridden.layout.nodes[0]?.rect.width).not.toBeCloseTo(
          overridden.layout.nodes[1]?.rect.width ?? -1,
          1,
        );
      },
    );
  });

  for (const component of ["matrix", "legend"] as const) {
    test(`${component} preserves mono on its title through expansion`, async () => {
      const plain = await render(expanded(component));
      const on = await render(expanded(component, "\n    mono: true"));
      const title = (figure: RenderedStructuredFigure) =>
        figure.inspection.elements.flatMap((e) => e.labels).find((l) => l.text === "iiiWWW");
      expect(title(plain)?.font).toBe("latin-bold");
      expect(title(on)?.font).toBe("mono-bold");
      expect(
        on.inspection.elements
          .flatMap((e) => e.labels)
          .filter((l) => l.text !== "iiiWWW")
          .every((l) => l.font !== "mono"),
      ).toBe(true);
      const paper = getTheme("paper");
      if (!paper) throw new Error("missing paper theme");
      await withTheme(
        { base: { ...paper.base, group: { ...paper.base.group, mono: true } } },
        async (id) => {
          expect(title(await render(expanded(component), id))?.font).toBe("mono-bold");
          expect(title(await render(expanded(component, "\n    mono: false"), id))?.font).toBe(
            "latin-bold",
          );
        },
      );
    });
  }

  test("missing mono fonts point to the written override, including inherited tokens", async () => {
    const paper = getTheme("paper");
    if (!paper) throw new Error("missing paper theme");
    const { mono: _, ...fontSet } = paper.fontSet;
    await withTheme({ fontSet }, async (id) => {
      const yaml = source(
        `  - id: a
    component: tokens
    mono: true
    props: { cells: [inherited, { label: own, mono: true }, { label: off, mono: false }] }`,
        id,
      );
      const diagnostics = checkFigure(yaml).state.diagnostics.filter(
        (d) => d.code === "theme/missing-font",
      );
      expect(diagnostics.map((d) => d.path)).toEqual([
        ["nodes", 0, "mono"],
        ["nodes", 0, "props", "cells", 1, "mono"],
      ]);
      expect(diagnostics.map((d) => d.location?.line)).toEqual([11, 12]);
      for (const component of ["matrix", "legend"] as const) {
        const check = checkFigure(
          expanded(component, "\n    mono: true").replace("theme: paper", `theme: ${id}`),
        );
        expect(
          check.state.diagnostics.filter((d) => d.code === "theme/missing-font").map((d) => d.path),
        ).toEqual([["nodes", 0, "mono"]]);
      }
    });
  });

  test("measurement matches the drawn text, with sublabels and colored math spans", async () => {
    const rendered = await render(
      source(
        `  - id: a
    component: box
    label: ${JSON.stringify(String.raw`A photo of a $\textcolor{blue}{\text{\{object\}}}$.`)}
    sublabel: small
    mono: true`,
      ),
    );
    const fonts = getFontSet(rendered.compiled.fontSet.id);
    if (!fonts) throw new Error("missing fonts");
    const node = rendered.layout.nodes[0];
    const labels = rendered.inspection.elements[0]?.labels ?? [];
    expect(labels.map((l) => l.font)).toEqual(["mono", "mono"]);
    const runs = labels[0]?.runs?.flat() ?? [];
    expect(runs.some((r) => r.fill !== undefined && r.text.includes("{object}"))).toBe(true);
    for (const label of labels) {
      const box = measureLabel(label, fonts).box;
      expect(box).toBeDefined();
      expect(box?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(node?.rect.width ?? 0);
    }
  });

  test("math symbols keep the math fonts inside a mono label", async () => {
    const rendered = await render(
      source(`  - { id: a, component: box, label: '$I_1\\cdot T_2$ plane', mono: true }`),
    );
    expect(rendered.svg).toContain("text-math-italic");
    expect(rendered.svg).toContain("text-mono");
  });

  test("PDF embeds BIZ UDGothic and the glyph advances match the layout", async () => {
    const rendered = await render(pair(", mono: true"));
    const pdf = svgToPdf(rendered.svg);
    expect(pdf.ok).toBe(true);
    if (!pdf.ok) return;
    const inspected = inspectPdf(pdf.value);
    expect(inspected.fonts.some((f) => f.baseFont.includes("BIZUDGothic"))).toBe(true);
    const advances = new Set(inspected.glyphs.map((g) => g.advance.toFixed(3)));
    expect(advances.size).toBe(1);
  });

  test("editable PPTX names the mono font", async () => {
    const rendered = await render(pair(", mono: true"));
    const pptx = svgToEditablePptx(rendered.svg, rendered.compiled.ir);
    expect(pptx.ok).toBe(true);
    if (!pptx.ok) return;
    const xml = new TextDecoder().decode(readPptx(pptx.value).get("ppt/slides/slide1.xml"));
    expect(xml).toContain('typeface="BIZ UDGothic"');
    expect(xml).toContain("iiiiiiii");
  });

  test("tokens cells inherit the node's mono and can override it", async () => {
    const rendered = await render(
      source(
        `  - id: a
    component: tokens
    mono: true
    props: { cells: [plane, { label: car, mono: false }, dog] }
  - { id: b, component: label, label: x }`,
        "paper",
        "a, b",
      ),
    );
    const fonts = Object.fromEntries(
      rendered.inspection.elements.flatMap((e) => e.labels.map((l) => [l.text, l.font] as const)),
    );
    expect(fonts.plane).toBe("mono");
    expect(fonts.car).not.toBe("mono");
    expect(fonts.dog).toBe("mono");
    expect(fonts.x).not.toBe("mono");
  });

  test("every built-in theme accepts mono, and mono must be a boolean", () => {
    expect(
      checkFigure(pair(", mono: true")).state.diagnostics.filter((d) => d.severity === "error"),
    ).toEqual([]);
    expect(checkFigure(pair(", mono: yes")).state.diagnostics[0]?.code).toBe("schema/invalid-type");
  });
});
