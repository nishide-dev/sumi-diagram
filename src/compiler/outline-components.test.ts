/** Public outline components: all themes/variants, four directions and container membership. */
import { describe, expect, test } from "bun:test";
import { checkD2Version, findD2Binary } from "../backends/d2/binary";
import { getOutlineRenderer } from "../core/outline";
import { BUILTIN_THEMES } from "../core/theme/builtin";
import { lintGeometry } from "../lint";
import { finalizeSvg } from "../render/finalize";
import { containsRect, type Point, type Rect } from "../render/geometry";
import { inspectSvg } from "../render/inspect";
import { rayHit, rectPoints } from "../render/outline-geometry";
import { expectD2Rendered, renderFigure } from "../render/render";
import { attribute, childElements, classList, descendants, parseXml } from "../render/xml";

const binary = findD2Binary();
const available = binary.ok && (await checkD2Version(binary.value.path)).ok;
test("D2 is installed in CI for public outline components", () => {
  if (process.env.CI) expect(available).toBe(true);
});

describe.skipIf(!available)("public outline components", () => {
  for (const theme of BUILTIN_THEMES.keys()) {
    for (const variant of ["default", "emphasis", "muted"]) {
      for (const direction of ["right", "left", "down", "up"]) {
        test(`${theme} / ${variant} / ${direction}`, async () => {
          const source = `version: 1
figure: { id: outline-components, theme: ${theme}, profile: ${theme === "slides" ? "presentation-16x9" : "paper-double"}, layout: { direction: ${direction} } }
groups:
  - { id: group, label: Group }
nodes:
  - { id: input, component: box, label: In }
  - { id: trap, component: trapezoid, label: "Filter\\n処理", variant: ${variant}, group: group }
  - { id: stack, component: stack, label: Jobs, variant: ${variant}, group: group }
  - { id: output, component: box, label: Out }
edges:
  - { from: input, to: trap }
  - { from: trap, to: stack, component: double-arrow }
  - { from: stack, to: output }
`;
          const result = await renderFigure(source);
          if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
          expect([...result.diagnostics, ...lintGeometry(result.value, { source })]).toEqual([]);
          const { compiled, artifact, inspection, svg } = expectD2Rendered(result.value);
          const raw = finalizeSvg(artifact, compiled, { source });
          if (!raw.ok) throw new Error("finalize failed");
          const before = inspectSvg(raw.value.svg, compiled.ir);
          if (!before.ok) throw new Error("inspect failed");
          const pre = new Map(before.value.elements.map((e) => [e.key, e]));
          const post = new Map(inspection.elements.map((e) => [e.key, e]));
          const parsed = parseXml(svg);
          if (!parsed.ok) throw new Error(parsed.message);
          for (const node of compiled.ir.nodes.filter((n) => n.render)) {
            const group = [...descendants(parsed.root)].find(
              (e) => e.name === "g" && classList(e).includes(`sumi-k-n--${node.id}`),
            );
            const shape = group && childElements(group).find((e) => classList(e).includes("shape"));
            if (!shape) throw new Error("missing outline");
            const paths = childElements(shape);
            expect(paths).toHaveLength(node.id === "stack" ? 3 : 1);
            for (const path of paths) {
              expect(path.name).toBe("path");
              expect(attribute(path, "d")).toEndWith(" Z");
              expect(attribute(path, "fill")).toBe(node.style.fill);
              expect(attribute(path, "stroke")).toBe(node.style.stroke);
              expect(attribute(path, "style")).toContain(
                `stroke-width:${node.style.strokeWidth.units};`,
              );
            }
            const bbox = post.get(node.key)?.bbox;
            const parent = post.get("g:group")?.bbox;
            if (!bbox || !parent) throw new Error("missing bbox");
            expect(bbox).toEqual(pre.get(node.key)?.bbox as Rect);
            expect(containsRect(parent, bbox)).toBe(true);
          }
          for (const edge of compiled.ir.edges) {
            const route = pre.get(edge.key)?.path ?? [];
            const after = post.get(edge.key)?.path ?? [];
            for (const end of ["source", "target"] as const) {
              const node = compiled.ir.elements.get(end === "source" ? edge.from : edge.to);
              if (node?.kind !== "node" || !node.render) continue;
              const bbox = pre.get(node.key)?.bbox;
              const index = end === "source" ? 0 : route.length - 1;
              const segment = route[index];
              const next = route[1];
              const neighbour =
                end === "source"
                  ? next?.command === "C"
                    ? next.c1
                    : next?.to
                  : segment?.command === "C"
                    ? segment.c2
                    : route[index - 1]?.to;
              if (!bbox || !segment || !neighbour) throw new Error("missing edge geometry");
              const length = Math.hypot(segment.to.x - neighbour.x, segment.to.y - neighbour.y);
              const normal = {
                x: (segment.to.x - neighbour.x) / length,
                y: (segment.to.y - neighbour.y) / length,
              };
              const renderer = getOutlineRenderer(node.render.renderer);
              if (!renderer) throw new Error("missing renderer");
              const outline = renderer.draw(
                bbox,
                renderer.params.parse(node.render.params),
              ).outline;
              expect(rayHit(outline, after[index]?.to as Point, normal)).toBeCloseTo(
                rayHit(rectPoints(bbox), segment.to, normal) as number,
                2,
              );
            }
          }
        }, 30_000);
      }
    }
  }
});
