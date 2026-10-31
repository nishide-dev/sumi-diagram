import { expect, test } from "bun:test";
import { getOutlineRenderer } from "../core/outline";
import { BUILTIN_THEMES } from "../core/theme/builtin";
import { checkRoutes } from "../layout/route/check";
import { resolveEnds } from "../layout/route/ports";
import { lintGeometry } from "../lint";
import { geometryContextFor } from "../lint/geometry/lint";
import { renderFigure } from "./render";

for (const theme of BUILTIN_THEMES.keys()) {
  for (const axis of ["stack", "row"]) {
    for (const [component, props, variant] of [
      ["bowtie", "", "filled"],
      ["bowtie", "gap: 8", "filled"],
      ["bowtie", "gap: 64", "solid"],
      ...["south", "north", "east", "west"].map((side) => [
        "trapezoid",
        `narrow: ${side}`,
        "filled",
      ]),
    ]) {
      test(`${theme}/${axis}/${component}/${props}/${variant}: one-axis growth preserves labels and painted ports`, async () => {
        const source = `version: 1
figure: { id: growth, theme: ${theme}, profile: paper-double, layout: { arrange: { ${axis === "stack" ? "row" : "stack"}: { align: stretch, items: [extent, { ${axis}: { justify: stretch, gap: 24pt, items: [a, b, c] } }] } } } }
nodes:
  - { id: extent, component: box, props: { width: 600pt, height: 600pt } }
  - { id: a, component: box, label: In }
  - { id: b, component: ${component}, variant: ${variant}, label: "A long label", props: { ${props} } }
  - { id: c, component: box, label: Out }
edges: [{ from: a, to: b }, { from: b, to: c }]
`;
        const result = await renderFigure(source);
        const natural = await renderFigure(source.replace("justify: stretch,", ""));
        if (
          !result.ok ||
          !("layout" in result.value) ||
          !natural.ok ||
          !("layout" in natural.value)
        )
          throw new Error(JSON.stringify(result.diagnostics));
        const { compiled, layout } = result.value;
        const placed = layout.nodes.find((n) => n.key === "n:b");
        const before = natural.value.layout.nodes.find((n) => n.key === "n:b");
        const node = compiled.ir.nodes.find((n) => n.key === "n:b");
        if (!placed || !before || !node?.render) throw new Error("Missing outline");
        const main = axis === "stack" ? "height" : "width";
        const cross = axis === "stack" ? "width" : "height";
        expect(placed.rect[main]).toBeGreaterThan(before.rect[main]);
        expect(placed.rect[cross]).toBe(before.rect[cross]);
        expect(
          lintGeometry(result.value).filter((d) => d.code === "geometry/label-overflow"),
        ).toEqual([]);
        expect(Object.values(checkRoutes(compiled.ir, layout)).flat()).toEqual([]);
        const renderer = getOutlineRenderer(node.render.renderer);
        if (!renderer) throw new Error("Missing renderer");
        const drawing = renderer.draw(placed.rect, renderer.params.parse(node.render.params));
        const pairs = resolveEnds(compiled.ir, layout);
        for (const [i, pair] of pairs.entries()) {
          if ("error" in pair) throw new Error(pair.error);
          const p = i === 0 ? pair.to.outline : pair.from.outline;
          const points = layout.edges[i]?.route?.points;
          expect(i === 0 ? points?.at(-1) : points?.[0]).toEqual(p);
          expect(
            (drawing.boundaries ?? [drawing.outline]).some((polygon) =>
              polygon.some((a, j) => {
                const b = polygon[(j + 1) % polygon.length];
                if (!b) return false;
                return (
                  Math.abs((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) /
                    Math.hypot(b.x - a.x, b.y - a.y) <
                    0.002 &&
                  p.x >= Math.min(a.x, b.x) - 0.002 &&
                  p.x <= Math.max(a.x, b.x) + 0.002 &&
                  p.y >= Math.min(a.y, b.y) - 0.002 &&
                  p.y <= Math.max(a.y, b.y) + 0.002
                );
              }),
            ),
          ).toBe(true);
        }
        if (component === "bowtie" && props) {
          expect(drawing.boundaries).toHaveLength(2);
          if (axis === "stack") {
            const lip =
              placed.rect.x +
              (placed.rect.width - Math.min(Number(props.split(": ")[1]), placed.rect.width / 2)) /
                2;
            const pair = pairs[0];
            if (!pair || "error" in pair) throw new Error("Missing lip");
            expect(pair.to.outline.x).toBeCloseTo(lip, 2);
            expect(pair.to.outline.y).toBeCloseTo(placed.rect.y + placed.rect.height / 4, 2);
          }
        }
      });
    }
  }

  for (const variant of ["solid", "filled", "outlined"]) {
    for (const dim of [false, true]) {
      for (const axis of ["natural", "stack", "row"]) {
        test(`${theme}/${variant}/dim=${dim}/${axis}: source tone and dim resolve split-label placement`, async () => {
          const result = await renderFigure(`version: 1
figure: { id: tones, theme: ${theme}, profile: paper-double, layout: { arrange: { stack: { items: [g] } } } }
groups: [{ id: g, ${dim ? "dim: true," : ""} arrange: { ${axis === "stack" ? "row" : "stack"}: { align: stretch, items: ${axis === "natural" ? "[a]" : `[extent, { ${axis}: { justify: stretch, items: [a] } }]`} } } }]
nodes:
  - { id: a, group: g, component: bowtie, variant: ${variant}, tone: pink, label: S, props: { gap: 64 } }
${axis === "natural" ? "" : "  - { id: extent, group: g, component: box, props: { width: 200pt, height: 200pt } }"}
`);
          if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
          const node = result.value.compiled.ir.nodes[0];
          const left = dim ? variant !== "solid" : variant === "solid";
          expect(node?.render?.params?.labelOnLeft === true).toBe(left);
          const geometry = geometryContextFor(result.value).get("n:a");
          const box = geometry?.bbox;
          const line = geometry?.labels[0]?.visibleLines[0];
          if (!box || !line) throw new Error("Missing label");
          const center = left
            ? box.x + (box.width - Math.min(64, box.width / 2)) / 4
            : box.x + box.width / 2;
          expect(line.x + line.width / 2).toBeCloseTo(center, 2);
          expect(line.y + line.height / 2).toBeCloseTo(box.y + box.height / 2, 2);
          if (axis !== "natural") expect(box[axis === "stack" ? "height" : "width"]).toBe(400);
          expect(line.y).toBeGreaterThanOrEqual(box.y);
          expect(line.y + line.height).toBeLessThanOrEqual(box.y + box.height);
          expect(
            lintGeometry(result.value).filter((d) => d.code === "geometry/label-overflow"),
          ).toEqual([]);
        });
      }
    }
  }
}
