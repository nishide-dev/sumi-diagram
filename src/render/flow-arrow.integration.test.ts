import { expect, test } from "bun:test";
import {
  FLOW_ARROW_DIRECTIONS,
  FLOW_ARROW_FORMS,
  FLOW_ARROW_LENGTHS,
} from "../core/outline/flow-arrow";
import { BUILTIN_THEMES } from "../core/theme/builtin";
import { checkRoutes } from "../layout/route/check";
import { lintGeometry } from "../lint";
import { svgToPdf } from "./pdf";
import { svgToEditablePptx, svgToPptx } from "./pptx";
import { readPptx } from "./pptx/testing";
import { renderFigure } from "./render";
import { attribute, childElements, descendants, parseXml } from "./xml";

const NAME = { block: "block-arrow", triangle: "triangle-arrow", chevron: "chevron" } as const;

/** Two stage panels with a flow marker between them in a row (or stack). */
const source = (theme: string, form: keyof typeof NAME, props: string, axis = "row") => `version: 1
figure:
  id: stages
  theme: ${theme}
  profile: ${theme === "slides" ? "presentation-16x9" : "paper-double"}
  layout:
    arrange: { ${axis}: { gap: 4mm, align: center, items: [left, ar, right] } }
groups:
  - { id: left, arrange: { stack: { items: [a, b] } } }
  - { id: right, arrange: { stack: { items: [c] } } }
nodes:
  - { id: a, component: box, label: One }
  - { id: b, component: box, label: Two }
  - { id: ar, component: ${NAME[form]}, props: { ${props} } }
  - { id: c, component: box, label: Out }
`;

for (const theme of BUILTIN_THEMES.keys()) {
  for (const form of FLOW_ARROW_FORMS) {
    for (const direction of FLOW_ARROW_DIRECTIONS) {
      test(`${theme}/${form}/${direction}: sized by the text size, centred between the panels, lint-free, every format renders`, async () => {
        const result = await renderFigure(source(theme, form, `direction: ${direction}`));
        if (!result.ok || !("layout" in result.value)) throw new Error(JSON.stringify(result));
        const { compiled, layout, svg } = result.value;
        expect(result.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
        expect(lintGeometry(result.value).filter((d) => d.severity !== "info")).toEqual([]);
        expect(Object.values(checkRoutes(compiled.ir, layout)).flat()).toEqual([]);

        const rect = layout.nodes.find((n) => n.key === "n:ar")?.rect;
        const left = layout.groups.find((g) => g.key === "g:left")?.rect;
        const right = layout.groups.find((g) => g.key === "g:right")?.rect;
        if (!rect || !left || !right) throw new Error("missing layout");
        // 1 em thick and 1.6 / 0.9 / 0.7 em long, in D2 units; rounded up to whole units.
        const em = compiled.ir.nodes.find((n) => n.id === "ar")?.style.fontSize.units ?? 0;
        const length = Math.ceil(em * FLOW_ARROW_LENGTHS[form]);
        const flat = direction === "right" || direction === "left";
        expect([rect.width, rect.height]).toEqual(flat ? [length, em] : [em, length]);
        // Between the panels, on the row's middle line.
        expect(rect.x).toBeGreaterThanOrEqual(left.x + left.width);
        expect(rect.x + rect.width).toBeLessThanOrEqual(right.x);
        const row = Math.max(left.y + left.height, right.y + right.height);
        const top = Math.min(left.y, right.y);
        expect(rect.y + rect.height / 2).toBeCloseTo((top + row) / 2, 1);

        // One closed polygon path, no rect, in the node's own box.
        const shape = svg.match(
          /<g class="sumi-k-n--ar sumi-kind-node"><g class="shape">(.*?)<\/g>/,
        )?.[1];
        expect(shape).toMatch(/^<path d="M [^"]+ Z"/);
        expect(shape).not.toContain("<rect");

        expect(svgToPdf(svg).ok).toBe(true);
        expect(svgToPptx(svg).ok).toBe(true);
        const pptx = svgToEditablePptx(svg, compiled.ir, { connectors: "freeform" });
        if (!pptx.ok) throw new Error(JSON.stringify(pptx.diagnostics));
        const slide = parseXml(
          new TextDecoder().decode(readPptx(pptx.value).get("ppt/slides/slide1.xml")),
        );
        if (!slide.ok) throw new Error(slide.message);
        const shapeXml = [...descendants(slide.root)].find(
          (e) =>
            e.name === "p:sp" &&
            [...descendants(e)].some(
              (n) => n.name === "p:cNvPr" && attribute(n, "name") === "n:ar",
            ),
        );
        if (!shapeXml) throw new Error("missing editable shape");
        const parts = [...descendants(shapeXml)];
        // The PowerPoint preset, not a freeform path.
        const preset = parts.find((e) => e.name === "a:prstGeom");
        expect(attribute(preset as never, "prst")).toBe(
          { block: "rightArrow", triangle: "triangle", chevron: "chevron" }[form],
        );
        expect(parts.some((e) => e.name === "a:custGeom")).toBe(false);
        // A preset is drawn pointing right (the triangle: up); turned or flipped to point the right way.
        const xfrm = parts.find((e) => e.name === "a:xfrm");
        const turn =
          form === "triangle"
            ? { up: [], down: ["flipV"], right: ["rot=5400000"], left: ["rot=16200000"] }
            : { right: [], left: ["flipH"], down: ["rot=5400000"], up: ["rot=16200000"] };
        const set = ["rot", "flipH", "flipV"]
          .filter((a) => attribute(xfrm as never, a) !== undefined)
          .map((a) => (a === "rot" ? `rot=${attribute(xfrm as never, a)}` : a));
        expect(set).toEqual(turn[direction]);
        // A turned preset's box has its sides swapped about the same centre.
        const [cx, cy] = (["cx", "cy"] as const).map((n) => {
          const ext = childElements(xfrm as never).find((e) => e.name === "a:ext");
          return Number(attribute(ext as never, n));
        }) as [number, number];
        const swapped = form === "triangle" ? flat : !flat;
        const [wide, tall] = swapped ? [rect.height, rect.width] : [rect.width, rect.height];
        expect(cx / cy).toBeCloseTo(wide / tall, 2);
      });
    }
  }
}

test("a flow arrow works in a stack, and explicit length, thickness and proportions are kept", async () => {
  const result = await renderFigure(
    source(
      "paper",
      "block",
      "direction: down, length: 30pt, thickness: 20pt, head: 0.4, shaft: 0.6",
      "stack",
    ),
  );
  if (!result.ok || !("layout" in result.value)) throw new Error(JSON.stringify(result));
  expect(result.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
  const rect = result.value.layout.nodes.find((n) => n.key === "n:ar")?.rect;
  expect(rect).toMatchObject({ width: 40, height: 60 });
  const preset = svgToEditablePptx(result.value.svg, result.value.compiled.ir);
  if (!preset.ok) throw new Error("editable PPTX failed");
  const xml = new TextDecoder().decode(readPptx(preset.value).get("ppt/slides/slide1.xml"));
  // head 0.4 of the shorter side, shaft 0.6 of the thickness, as PowerPoint's adj2 and adj1.
  expect(xml).toContain('<a:gd name="adj1" fmla="val 60000"/><a:gd name="adj2" fmla="val 40000"/>');
});

test("a flow arrow can be placed in coordinates between two panels", async () => {
  const result = await renderFigure(`version: 1
figure:
  id: placed
  theme: paper
  layout:
    arrange:
      place:
        unit: 14mm
        items:
          - { item: a, at: [0, 0] }
          - { item: ar, at: [2, 0] }
          - { item: b, at: [4, 0] }
nodes:
  - { id: a, component: box, label: A }
  - { id: ar, component: block-arrow }
  - { id: b, component: box, label: B }
`);
  if (!result.ok || !("layout" in result.value)) throw new Error(JSON.stringify(result));
  expect(result.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
  const rect = result.value.layout.nodes.find((n) => n.key === "n:ar")?.rect;
  const a = result.value.layout.nodes.find((n) => n.key === "n:a")?.rect;
  const b = result.value.layout.nodes.find((n) => n.key === "n:b")?.rect;
  if (!rect || !a || !b) throw new Error("missing layout");
  expect(rect.x).toBeGreaterThan(a.x + a.width);
  expect(rect.x + rect.width).toBeLessThan(b.x);
  expect(rect.y + rect.height / 2).toBeCloseTo(a.y + a.height / 2, 1);
});
