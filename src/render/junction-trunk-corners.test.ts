/**
 * #385: a trunk that turns into a bus out of a junction right below the
 * arrowheads it feeds rounds with the full radius, and the arrowheads keep
 * their 2pt stem.
 */

import { describe, expect, test } from "bun:test";
import type { ElementKey } from "../core/check-state";
import { layoutStructuredFigure } from "../layout";
import { DIRS, type End } from "../layout/route/ports";
import { junctionBusRoom } from "../layout/route/router";
import { paintedEdges } from "./structured";
import type { Arc } from "./wire";

const root = `${import.meta.dir}/../..`;

/** The radius of a quarter-circle arc. */
const radius = (a: Arc) => Math.max(Math.abs(a.to.x - a.from.x), Math.abs(a.to.y - a.from.y));

async function arcsInto(file: string, target: string, theme?: string) {
  const text = await Bun.file(`${root}/${file}`).text();
  const result = layoutStructuredFigure(text, theme === undefined ? {} : { overrides: { theme } });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const { ir, layout } = result.value;
  const node = ir.nodes.find((n) => n.id === target);
  if (node === undefined) throw new Error(`no node ${target}`);
  const painted = paintedEdges(ir, layout);
  return ir.edges
    .filter((e) => e.to === node.key)
    .map((e) => ({ edge: e, arcs: painted.get(e.key)?.arcs ?? [] }));
}

describe("the decoder's middle split of the transformer", () => {
  test.each([undefined, "paper", "academic"])("theme %s", async (theme) => {
    const file = "examples/transformer/transformer.sumi.yaml";
    // The trunk enters the junction, and its turn into the bus is the
    // junction's arc, kept with that edge. Before: 1.33 units (0.67pt).
    const trunk = await arcsInto(file, "dec-split2", theme);
    expect(trunk.length).toBe(1);
    expect(radius(trunk[0]?.arcs[0] as Arc)).toBeGreaterThanOrEqual(7);
    // The turns up into the three arrowheads keep the 2pt (4 unit) stem:
    // 2.67 of the 8 units where the room before the arrowhead is short.
    const heads = await arcsInto(file, "dec-mha", theme);
    expect(heads.length).toBe(3);
    for (const { arcs } of heads) {
      const last = arcs.at(-1) as Arc;
      expect(radius(last)).toBeGreaterThanOrEqual(2.6);
    }
  });

  test("the buses of K, V and Q run on one row, at the junction's", async () => {
    const file = "examples/transformer/transformer.sumi.yaml";
    const heads = await arcsInto(file, "dec-mha");
    const rows = heads.map(({ arcs }) => (arcs.at(-1) as Arc).from.y);
    expect(new Set(rows.map((y) => y.toFixed(3))).size).toBe(1);
    const trunk = await arcsInto(file, "dec-split2");
    expect(trunk[0]?.arcs[0]?.to.y).toBeCloseTo(rows[0] as number, 3);
  });
});

describe("junctionBusRoom", () => {
  const end = (x: number, y: number, dir: number, junction: boolean): End => ({
    key: "n:a" as ElementKey,
    junction,
    dir: junction ? -1 : dir,
    port: { x, y },
    outline: { x, y },
  });
  // A port facing down (dir 1), room 16 after a stub of 8.
  const down = DIRS.findIndex((d) => d.x === 0 && d.y === 1);
  test.each([
    ["a junction 14.67 down and aside: the room ends at it", 14.67, 30, 14.67],
    ["a junction beyond the room", 16, 30, 0],
    ["in line (the room clips at it instead)", 14.67, 0, 0],
    ["too near the stub to leave a corner", 10, 30, 0],
  ])("%s", (_, ahead, aside, expected) => {
    expect(junctionBusRoom(end(0, 0, down, false), end(aside, ahead, 0, true), 16, 8)).toBe(
      expected,
    );
  });
  test("not at a port", () => {
    expect(junctionBusRoom(end(0, 0, down, false), end(30, 14, down, false), 16, 8)).toBe(0);
  });
});
