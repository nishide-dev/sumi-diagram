/**
 * `sumi/operator` props.size and the paper theme's lighter image frame
 * (#311, design doc §6.92): IR sizes per theme, located diagnostics, and an
 * editable PPTX whose circle and symbol match the SVG.
 */

import { describe, expect, test } from "bun:test";
import { checkFigure } from "../core/check";
import { svgToEditablePptx } from "./pptx/editable";
import { readPptx } from "./pptx/testing";
import { renderFigure } from "./render";
import { attribute, descendants, parseXml } from "./xml";

const THEMES = ["minimal", "academic", "slides", "color", "paper"];
const SCALE = { regular: 1, large: 1.5, xlarge: 2 } as const;

const source = (theme: string, size?: string) => `version: 1
figure:
  id: op
  theme: ${theme}
  layout: { arrange: { row: { items: [a, op] } } }
nodes:
  - { id: a, component: box, label: A }
  - { id: op, component: operator, props: { symbol: plus${size ? `, size: ${size}` : ""} } }
`;

async function render(text: string) {
  const result = await renderFigure(text);
  if (!result.ok || !("layout" in result.value))
    throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}

describe("operator size", () => {
  test.each(THEMES)("scales the circle and the symbol together in %s", async (theme) => {
    const base = (await render(source(theme))).compiled.ir.nodes.find((n) => n.id === "op");
    const omitted = base?.style.fontSize.units ?? 0;
    expect(base?.width?.units).toBe(2 * omitted);
    // `regular` is the same as no size.
    const regular = (await render(source(theme, "regular"))).compiled.ir.nodes.find(
      (n) => n.id === "op",
    );
    expect(regular?.style).toEqual(base?.style);
    expect(regular?.width).toEqual(base?.width);
    for (const [size, scale] of Object.entries(SCALE)) {
      const op = (await render(source(theme, size))).compiled.ir.nodes.find((n) => n.id === "op");
      const units = Math.round(omitted * scale);
      expect(op?.style.fontSize.units).toBe(units);
      expect(op?.width?.units).toBe(2 * units);
      expect(op?.height?.units).toBe(2 * units);
      // The frame keeps the theme's line weight.
      expect(op?.style.strokeWidth).toEqual(base?.style.strokeWidth);
    }
  });

  test("an unknown size is a located diagnostic", () => {
    const text = source("paper", "huge");
    const d = checkFigure(text).state.diagnostics.find((x) => x.code === "component/invalid-prop");
    expect(d?.path).toEqual(["nodes", 1, "props", "size"]);
    expect(d?.location?.line).toBe(8);
  });

  test("editable PPTX draws the circle and symbol at the same scale as the SVG", async () => {
    const measure = async (size: string, connectors: "freeform" | "glued") => {
      const { svg, compiled } = await render(source("paper", size));
      const exported = svgToEditablePptx(svg, compiled.ir, { connectors });
      if (!exported.ok) throw new Error(JSON.stringify(exported.diagnostics));
      const parsed = parseXml(
        new TextDecoder().decode(readPptx(exported.value).get("ppt/slides/slide1.xml")),
      );
      if (!parsed.ok) throw new Error(parsed.message);
      const shape = [...descendants(parsed.root)].find(
        (s) =>
          s.name === "p:sp" &&
          [...descendants(s)].some((e) => e.name === "p:cNvPr" && attribute(e, "name") === "n:op"),
      );
      const parts = shape ? [...descendants(shape)] : [];
      const ext = parts.find((e) => e.name === "a:ext");
      const run = parts.find((e) => e.name === "a:rPr");
      if (!ext || !run) throw new Error("operator shape missing");
      return { cx: Number(attribute(ext, "cx")), sz: Number(attribute(run, "sz")) };
    };
    for (const connectors of ["freeform", "glued"] as const) {
      const regular = await measure("regular", connectors);
      const xlarge = await measure("xlarge", connectors);
      expect(xlarge.cx / regular.cx).toBeCloseTo(2, 2);
      expect(xlarge.sz / regular.sz).toBeCloseTo(2, 2);
    }
  });
});

describe("framed image frame", () => {
  const image = (theme: string) => `version: 1
figure: { id: f, theme: ${theme}, layout: { arrange: { row: { items: [img] } } } }
nodes:
  - id: img
    component: image
    variant: framed
    props: { svg: '<svg viewBox="0 0 10 10"><path d="M1 1H9V9Z" fill="#c04050"/></svg>', height: 24pt }
`;
  test.each([
    ["minimal", 1],
    ["academic", 0.5],
    ["slides", 2],
    ["color", 1],
    ["paper", 0.5],
  ])("%s frames at %spt", async (theme, pt) => {
    const { compiled } = await render(image(theme));
    expect(compiled.ir.nodes[0]?.style.strokeWidth.pt).toBe(pt);
  });
});
