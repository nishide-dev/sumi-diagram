/**
 * Borderless and dashed variants (#174, design doc §6.49): node `filled`,
 * container `plain` / `filled` / `dashed`. A border that is not drawn (zero
 * stroke width) is not reported by the geometry rules, while the group keeps
 * its rectangle for inspect, captions and edge-label backgrounds. The
 * structured tests run without D2; the auto test needs it.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createD2CliBackend } from "../backends/d2/backend";
import { checkD2Version, findD2Binary } from "../backends/d2/binary";
import { compileFigure, expectD2Figure } from "../compiler/compile";
import { generateD2 } from "../compiler/d2";
import { BUILTIN_THEMES } from "../core/theme/builtin";
import { lintGeometry } from "../lint/geometry";
import { type RenderedFigure, type RenderedStructuredFigure, renderFigure } from "./render";

const ROOT = join(import.meta.dir, "..", "..");
const DIT = readFileSync(
  join(ROOT, "tests/fixtures/figures/variants/b-dit-plain.sumi.yaml"),
  "utf8",
);

const binary = findD2Binary();
const available = binary.ok && (await checkD2Version(binary.value.path)).ok;

async function render(source: string, auto = false): Promise<RenderedFigure> {
  const result = await renderFigure(source, auto ? { backend: createD2CliBackend() } : {});
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return result.value;
}

/** The DiT fixture with `variant` on the adaLN-Zero panel (written without one). */
const withAdalnVariant = (variant: string) =>
  DIT.replace("  - id: adaln\n", `  - id: adaln\n    variant: ${variant}\n`);

describe("DiT with a plain left panel (structured)", () => {
  test("the plain panel's caption lines up with the other panels' captions", async () => {
    const rendered = (await render(DIT)) as RenderedStructuredFigure;
    const { layout, inspection } = rendered;
    const panels = ["ldt", "adaln", "cross", "incontext"];
    const captions = panels.map((id) => {
      const rect = layout.nodes.find((n) => n.key === `n:${id}-caption`)?.rect;
      if (rect === undefined) throw new Error(`no caption of ${id}`);
      return rect;
    });
    for (const rect of captions) expect(rect.y).toBeCloseTo(captions[0]?.y ?? Number.NaN, 3);
    // Inspect still reads the plain group's rectangle, drawn without paint.
    const group = layout.groups.find((g) => g.key === "g:ldt")?.rect;
    const inspected = inspection.elements.find((e) => e.key === "g:ldt")?.bbox;
    if (group === undefined || inspected === undefined) throw new Error("no ldt");
    expect(inspected.width).toBeCloseTo(group.width, 2);
    expect(inspected.height).toBeCloseTo(group.height, 2);
    expect(rendered.svg).toMatch(
      /<g class="sumi-k-g--ldt sumi-kind-group"><g class="shape"><rect [^>]*fill="none" [^>]*stroke-width="0"\/>/,
    );
    // The geometry rules report nothing about the plain panel.
    const diagnostics = lintGeometry(rendered, { source: DIT });
    expect(diagnostics.filter((d) => JSON.stringify(d).includes('"ldt"'))).toEqual([]);
  });

  test("lines beside an undrawn border are not reported; a dashed border is", async () => {
    const nearBorder = async (source: string) =>
      lintGeometry(await render(source), { source })
        .filter((d) => d.code.startsWith("geometry/edge-") && d.code.endsWith("-border"))
        .map((d) => d.message);
    // The zoom lines run 0.48mm beside the adaLN-Zero panel's left border.
    const drawn = await nearBorder(DIT);
    expect(drawn).toHaveLength(2);
    expect(await nearBorder(withAdalnVariant("dashed"))).toEqual(drawn);
    expect(await nearBorder(withAdalnVariant("filled"))).toEqual([]);
    expect(await nearBorder(withAdalnVariant("plain"))).toEqual([]);
  });
});

describe("edge-label backgrounds (structured, §6.41)", () => {
  const figure = (variant: string) => `version: 1
figure:
  id: label-background
  theme: color
  layout: { arrange: { stack: { items: [g] } } }
groups:
  - { id: g, label: Group, variant: ${variant}, arrange: { stack: { gap: 10mm, items: [a, b] } } }
nodes:
  - { id: a, component: box, label: A }
  - { id: b, component: box, label: B }
edges:
  - { from: a, to: b, label: x }
`;
  const background = async (variant: string) => {
    const { svg } = await render(figure(variant));
    return /<g class="sumi-k-e--_0[^"]*">.*?<rect [^>]*fill="(#[0-9a-f]+)"\/><text/.exec(svg)?.[1];
  };

  test("a plain group counts as transparent, a filled one as painted", async () => {
    // The canvas, and color's group surface.
    expect(await background("plain")).toBe("#ffffff");
    expect(await background("dashed")).toBe("#ffffff");
    expect(await background("filled")).toBe("#f6f8fa");
    expect(await background("default")).toBe("#f6f8fa");
  });
});

describe("D2 source (auto)", () => {
  const source = (theme: string) => `version: 1
figure: { id: borderless, theme: ${theme} }
groups:
  - { id: p, label: Plain, variant: plain }
  - { id: f, label: Filled, variant: filled }
  - { id: d, label: Dashed, variant: dashed }
nodes:
  - { id: a, component: box, label: A, variant: filled, group: p }
  - { id: b, component: box, label: B, variant: filled, tone: yellow, group: f }
  - { id: c, component: box, label: C, group: d }
edges:
  - { from: a, to: b }
  - { from: b, to: c }
`;
  const styleOf = (d2: string, name: string) => {
    const start = d2.indexOf(`"${name}": {`);
    const style = d2.slice(
      d2.indexOf("style: {", start),
      d2.indexOf("}", d2.indexOf("style: {", start)),
    );
    return Object.fromEntries(
      [...style.matchAll(/^\s*([a-z-]+): (.+)$/gm)].map(([, k, v]) => [k, v?.replaceAll('"', "")]),
    );
  };

  for (const theme of BUILTIN_THEMES.keys()) {
    test(`${theme}: no border is a zero stroke width, dashes a stroke-dash`, () => {
      const result = compileFigure(source(theme));
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      expect(result.diagnostics).toEqual([]);
      const d2 = generateD2(expectD2Figure(result.value).ir);
      expect(styleOf(d2, "g_p")).toMatchObject({ "stroke-width": "0", fill: "transparent" });
      expect(styleOf(d2, "g_f")).toMatchObject({ "stroke-width": "0" });
      expect(styleOf(d2, "g_f").fill).not.toBe("transparent");
      expect(styleOf(d2, "g_d")).toMatchObject({ fill: "transparent" });
      expect(Number(styleOf(d2, "g_d")["stroke-dash"])).toBeGreaterThan(0);
      expect(Number(styleOf(d2, "g_d")["stroke-width"])).toBeGreaterThan(0);
      expect(styleOf(d2, "n_a")).toMatchObject({ "stroke-width": "0" });
      expect(styleOf(d2, "n_b")).toMatchObject({ "stroke-width": "0" });
      expect(styleOf(d2, "n_a").fill).not.toBe(styleOf(d2, "n_b").fill);
    });
  }

  test.skipIf(!available)("renders through D2 without geometry diagnostics", async () => {
    for (const theme of ["minimal", "academic", "color"]) {
      const rendered = await render(source(theme), true);
      expect(lintGeometry(rendered, { source: source(theme) })).toEqual([]);
      // Inspect reads the plain group's rectangle.
      expect(rendered.inspection.elements.find((e) => e.key === "g:p")?.bbox).toBeDefined();
    }
  });
});
