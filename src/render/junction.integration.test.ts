/**
 * Hidden junctions and rounded wires (#101), in both engines: a junction of
 * variant `hidden` draws no dot; structured wires round their turns and join
 * smoothly through a hidden junction; in `auto` the lines D2 ends short of
 * the point are extended to its center, and nothing else changes.
 */

import { describe, expect, test } from "bun:test";
import { createD2CliBackend } from "../backends/d2/backend";
import { checkD2Version, findD2Binary } from "../backends/d2/binary";
import type { ElementKey } from "../core/check-state";
import { lintGeometry } from "../lint/geometry";
import { composeJunctionEnds, composeOutlines } from "./compose";
import { finalizeSvg } from "./finalize";
import { inspectSvg } from "./inspect";
import { expectD2Rendered, renderFigure } from "./render";
import { attribute, classList, descendants, parseXml } from "./xml";

const binary = findD2Binary();
const available = binary.ok && (await checkD2Version(binary.value.path)).ok;

/** A split without a dot, a residual around a block and an arrow into open space. */
const figure = (engine: "auto" | "structured", variant: "hidden" | "default") => `version: 1
figure:
  id: junctions
  theme: academic
  profile: paper-single
  layout:
    ${engine === "structured" ? "engine: structured\n    arrange: { stack: { direction: up, gap: 4mm, items: [input, split, block, add, out] } }" : "direction: up"}
nodes:
  - { id: input, component: ${engine === "auto" ? "trapezoid" : "box"}, label: Input }
  - { id: split, component: junction${variant === "hidden" ? ", variant: hidden" : ""} }
  - { id: block, component: box, label: Block }
  - { id: add, component: operator, props: { symbol: plus } }
  - { id: out, component: junction${variant === "hidden" ? ", variant: hidden" : ""} }
edges:
  - { from: input, to: split, component: line }
  - { from: split, to: block }
  - { from: split, to: add${engine === "structured" ? ", toAnchor: west" : ""} }
  - { from: block, to: add }
  - { from: add, to: out }
`;

const render = async (source: string) => {
  const result = await renderFigure(source, { backend: createD2CliBackend() });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  expect(result.diagnostics).toEqual([]);
  expect(lintGeometry(result.value, { source })).toEqual([]);
  return result.value;
};

/** The `d` of every `path.sumi-wire`, and the shape markup of a node. */
function parts(svg: string) {
  const parsed = parseXml(svg);
  if (!parsed.ok) throw new Error(parsed.message);
  const elements = [...descendants(parsed.root)];
  const wires = elements
    .filter((e) => e.name === "path" && classList(e).includes("sumi-wire"))
    .map((e) => attribute(e, "d") ?? "");
  return { wires, elements };
}

describe("structured", () => {
  test("a hidden junction draws no dot, and the split and the residual turn smoothly", async () => {
    const rendered = await render(figure("structured", "hidden"));
    const { wires } = parts(rendered.svg);
    expect(rendered.svg).toMatch(/sumi-k-n--split[^>]*><g class="shape"><circle [^>]*fill="none"/);
    expect(rendered.svg).toMatch(/sumi-k-n--out[^>]*><g class="shape"><circle [^>]*fill="none"/);
    // The 1-unit point (zero stroke width × 3, at least one unit).
    const split = rendered.inspection.elements.find((e) => e.key === "n:split");
    expect(split?.bbox?.width).toBe(1);
    const curves = wires.join(" ").match(/ C /g) ?? [];
    // The residual's two turns, and the split's turn into it.
    expect(curves.length).toBe(3);
    // The inspection still reads every edge's route as M / L.
    for (const edge of rendered.inspection.elements.filter((e) => e.kind === "edge")) {
      expect(edge.path?.every((s) => s.command !== "C")).toBe(true);
    }
  });

  test("a junction with a dot keeps its sharp join (only the route's own turns are rounded)", async () => {
    const rendered = await render(figure("structured", "default"));
    const curves = parts(rendered.svg).wires.join(" ").match(/ C /g) ?? [];
    expect(curves.length).toBe(2);
    expect(rendered.svg).toMatch(/sumi-k-n--split[^>]*><g class="shape"><circle [^>]*fill="#/);
  });

  test("is deterministic", async () => {
    const source = figure("structured", "hidden");
    expect((await render(source)).svg).toBe((await render(source)).svg);
  });
});

describe.skipIf(!available)("auto (D2)", () => {
  test("lines without arrowheads reach a hidden junction's center; a dot's lines are left as D2 drew them", async () => {
    for (const variant of ["hidden", "default"] as const) {
      const rendered = await render(figure("auto", variant));
      const geometry = new Map(rendered.inspection.elements.map((e) => [e.key, e]));
      const center = (key: ElementKey) => {
        const box = geometry.get(key)?.bbox;
        if (box === undefined) throw new Error(`no box for ${key}`);
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      };
      const end = (edge: ElementKey, at: "first" | "last") => {
        const path = geometry.get(edge)?.path ?? [];
        const segment = at === "first" ? path[0] : path[path.length - 1];
        if (segment === undefined) throw new Error(`no path for ${edge}`);
        return segment.to;
      };
      const split = center("n:split");
      // input → split (line) ends at the split; split → block / add leave from it.
      const ends = [end("e:#0", "last"), end("e:#1", "first"), end("e:#2", "first")];
      for (const p of ends) {
        const distance = Math.hypot(p.x - split.x, p.y - split.y);
        if (variant === "hidden") expect(distance).toBeLessThan(1);
        else expect(distance).toBeGreaterThan(1);
      }
      // The arrow into the open end keeps D2's end (its arrowhead's tip).
      const out = center("n:out");
      const tip = end("e:#4", "last");
      expect(Math.hypot(tip.x - out.x, tip.y - out.y)).toBeGreaterThan(0.4);
    }
  });

  test("composition moves only the ends that meet at a hidden junction, after the outlines", async () => {
    for (const variant of ["hidden", "default"] as const) {
      const source = figure("auto", variant);
      const rendered = expectD2Rendered(await render(source));
      const { compiled } = rendered;
      // Replay the pipeline up to the junction composition.
      const finalized = finalizeSvg(rendered.artifact, compiled, { source });
      if (!finalized.ok) throw new Error("finalize failed");
      const first = inspectSvg(finalized.value.svg, compiled.ir);
      if (!first.ok) throw new Error("inspect failed");
      const outlined = composeOutlines(finalized.value.svg, compiled.ir, first.value);
      if (!outlined.ok) throw new Error("outline composition failed");
      const before = inspectSvg(outlined.value, compiled.ir);
      if (!before.ok) throw new Error("inspect failed");
      const joined = composeJunctionEnds(outlined.value, compiled.ir, before.value);
      expect(joined.ok).toBe(true);
      if (!joined.ok) return;
      expect(joined.value).toBe(rendered.svg);
      if (variant === "default") {
        expect(joined.value).toBe(outlined.value);
        continue;
      }
      const after = new Map(rendered.inspection.elements.map((e) => [e.key, e]));
      const moved = new Map<ElementKey, ("first" | "last")[]>([
        ["e:#0", ["last"]], // trapezoid → split (its source end was extended to the outline)
        ["e:#1", ["first"]],
        ["e:#2", ["first"]],
      ]);
      for (const element of before.value.elements.filter((e) => e.kind === "edge")) {
        const old = element.path ?? [];
        const now = after.get(element.key)?.path ?? [];
        const ends = moved.get(element.key) ?? [];
        expect(now.length).toBe(old.length);
        now.forEach((segment, i) => {
          const isEnd =
            (i === 0 && ends.includes("first")) || (i === now.length - 1 && ends.includes("last"));
          if (!isEnd) {
            // Untouched apart from the control point next to a moved end.
            if (!(i === 1 && ends.includes("first"))) {
              expect(segment.to.x).toBeCloseTo(old[i]?.to.x ?? Number.NaN, 3);
              expect(segment.to.y).toBeCloseTo(old[i]?.to.y ?? Number.NaN, 3);
            }
            return;
          }
          // The moved end lies on the line it travelled along, at the center's projection.
          // Every moved end is at the split.
          const box = after.get("n:split")?.bbox;
          if (box === undefined) throw new Error("no junction box");
          const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
          expect(Math.hypot(segment.to.x - center.x, segment.to.y - center.y)).toBeLessThan(1);
        });
      }
    }
  });
});
