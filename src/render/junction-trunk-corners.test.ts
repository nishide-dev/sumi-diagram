/**
 * #385: a hidden junction in a stack gap sits on the bus row of the
 * arrowheads it feeds, so its trunk turns into the bus with a gentle corner
 * instead of rising 1.33 units above the bus and dropping back.
 */

import { describe, expect, test } from "bun:test";
import type { ElementKey } from "../core/check-state";
import { layoutStructuredFigure } from "../layout";
import { junctionsOnBus } from "../layout/route/router";
import { paintedEdges } from "./structured";
import type { Arc } from "./wire";

const root = `${import.meta.dir}/../..`;

/** The radius of a quarter-circle arc. */
const radius = (a: Arc) => Math.max(Math.abs(a.to.x - a.from.x), Math.abs(a.to.y - a.from.y));

async function laid(file: string, theme?: string) {
  const text = await Bun.file(`${root}/${file}`).text();
  const result = layoutStructuredFigure(text, theme === undefined ? {} : { overrides: { theme } });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const { ir, layout } = result.value;
  const key = (id: string): ElementKey => {
    const node = ir.nodes.find((n) => n.id === id);
    if (node === undefined) throw new Error(`no node ${id}`);
    return node.key;
  };
  const painted = paintedEdges(ir, layout);
  /** The arcs of the edges entering `target`, in document order. */
  const into = (target: string) =>
    ir.edges.filter((e) => e.to === key(target)).map((e) => painted.get(e.key)?.arcs ?? []);
  const centreY = (id: string) => {
    const r = layout.nodes.find((n) => n.key === key(id))?.rect;
    if (r === undefined) throw new Error(`no layout ${id}`);
    return r.y + r.height / 2;
  };
  return { ir, layout, into, centreY };
}

const TRANSFORMER = "examples/transformer/transformer.sumi.yaml";

describe("the decoder's middle split of the transformer", () => {
  test.each([undefined, "paper", "academic"])("theme %s", async (theme) => {
    const { into } = await laid(TRANSFORMER, theme);
    // The trunk enters the junction, and its turn into the bus is the
    // junction's arc, kept with that edge. Before: 1.33 units (0.67pt).
    const trunk = into("dec-split2");
    expect(trunk.length).toBe(1);
    expect(radius(trunk[0]?.[0] as Arc)).toBeGreaterThanOrEqual(6.5);
    // The turns up into the three arrowheads are as gentle as the encoder's:
    // 4 units, with the 2pt stem kept.
    const heads = into("dec-mha");
    expect(heads.length).toBe(3);
    for (const arcs of heads) expect(radius(arcs.at(-1) as Arc)).toBeGreaterThanOrEqual(4);
  });

  test("the junction sits on the bus row of K, V and Q", async () => {
    const { into, centreY } = await laid(TRANSFORMER);
    const rows = into("dec-mha").map((arcs) => (arcs.at(-1) as Arc).from.y);
    expect(new Set(rows.map((y) => y.toFixed(3))).size).toBe(1);
    expect(centreY("dec-split2")).toBeCloseTo(rows[0] as number, 3);
  });
});

describe("junctionsOnBus", () => {
  // `layoutStructuredFigure` routes, so its junction already sits on the bus
  // row: put it back where the stack gap centred it (1.33 units nearer the
  // box) and move it again.
  test("moves only the junction that feeds a bus from aside, back onto the bus row", async () => {
    const { ir, layout, centreY } = await laid(TRANSFORMER);
    const id = (key: ElementKey) => ir.nodes.find((n) => n.key === key)?.id;
    const split = layout.nodes.find((n) => id(n.key) === "dec-split2");
    if (split === undefined) throw new Error("no junction");
    const centred = {
      ...layout,
      nodes: layout.nodes.map((n) =>
        n === split ? { ...n, rect: { ...n.rect, y: n.rect.y - 4 / 3 } } : n,
      ),
    };
    const moved = junctionsOnBus(ir, centred);
    const changed = moved.nodes.filter((n, i) => n.rect.y !== centred.nodes[i]?.rect.y);
    expect(changed.map((n) => id(n.key))).toEqual(["dec-split2"]);
    expect(changed[0]?.rect.y).toBeCloseTo(split.rect.y, 2);
    expect(centreY("dec-split2")).toBeCloseTo(split.rect.y + split.rect.height / 2, 3);
    // The T splits of the encoder and of the masked block stay.
    expect(junctionsOnBus(ir, layout).nodes).toEqual(layout.nodes);
  });
});
