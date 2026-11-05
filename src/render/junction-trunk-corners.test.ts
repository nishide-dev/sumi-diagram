/**
 * #385: a hidden junction in a stack gap sits on the bus row of the
 * arrowheads it feeds, so its trunk turns into the bus with a gentle corner
 * instead of rising 1.33 units above the bus and dropping back.
 */

import { describe, expect, test } from "bun:test";
import type { ElementKey } from "../core/check-state";
import { validateProfile } from "../core/profile/schema";
import { layoutStructuredFigure } from "../layout";
import { junctionsOnBus, routeEdges } from "../layout/route/router";
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

function placed(text: string, profile?: Parameters<typeof layoutStructuredFigure>[1]) {
  const result = layoutStructuredFigure(text, { ...profile, route: false });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}

const small = (route = "orthogonal", centerOn = false) => `
version: 1
figure:
  id: bus-guards
  layout:
    arrange:
      row:
        items:
          - stack: { direction: up, gap: 7pt, ${centerOn ? "centerOn: j," : ""} items: [a, j, b] }
          - c
nodes:
  - { id: a, component: box, label: A }
  - { id: j, component: junction, variant: hidden }
  - { id: b, component: box, label: B }
  - { id: c, component: box, label: C }
edges:
  - { from: a, to: j, component: arrow }
  - { from: j, to: b, component: arrow, ${route === "orthogonal" ? "" : `route: ${route},`} toAnchor: 'south:0.8' }
`;

function nodeRect(value: ReturnType<typeof placed>, id: string) {
  const key = value.ir.nodes.find((n) => n.id === id)?.key;
  const rect = value.layout.nodes.find((n) => n.key === key)?.rect;
  if (rect === undefined) throw new Error(`missing ${id}`);
  return rect;
}

describe("bus movement preserves solved placement", () => {
  test("transformer y alignment still holds after routing", async () => {
    const text = (await Bun.file(`${root}/${TRANSFORMER}`).text()).replace(
      "    density: compact",
      "    density: compact\n    align: [{ y: [dec-split2, enc-split2] }]",
    );
    const value = placed(text);
    const routed = routeEdges(value.ir, value.layout);
    expect(routed.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const final = { ...value, layout: routed.layout };
    expect(nodeRect(final, "dec-split2").y).toBe(nodeRect(final, "enc-split2").y);
    expect(nodeRect(final, "dec-split2").y).toBe(nodeRect(value, "dec-split2").y);
  });

  test("stack.centerOn keeps the junction aligned with the neighboring main path", () => {
    const value = placed(small("orthogonal", true));
    const result = routeEdges(value.ir, value.layout);
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const final = { ...value, layout: result.layout };
    const center = (id: string) => {
      const r = nodeRect(final, id);
      return r.y + r.height / 2;
    };
    expect(center("j")).toBe(center("c"));
    expect(nodeRect(final, "j")).toEqual(nodeRect(value, "j"));
  });

  test("an attached obstacle retains its relationship and does not cause no-route errors", async () => {
    const text = (await Bun.file(`${root}/${TRANSFORMER}`).text()).replace(
      "nodes:",
      `nodes:
  - id: obstacle
    component: box
    props: { width: 2pt, height: 1pt }
    attach: { to: dec-split2, side: south, gap: 0 }`,
    );
    const value = placed(text);
    const result = routeEdges(value.ir, value.layout);
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const final = { ...value, layout: result.layout };
    const j = nodeRect(final, "dec-split2");
    expect(nodeRect(final, "obstacle").y).toBeCloseTo(j.y + j.height, 3);
    expect(j).toEqual(nodeRect(value, "dec-split2"));
  });

  test.each(["straight", "curve"])("%s edges cannot request a bus move", (route) => {
    const value = placed(small(route));
    const result = routeEdges(value.ir, value.layout);
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(nodeRect({ ...value, layout: result.layout }, "j")).toEqual(nodeRect(value, "j"));
  });

  test.each(["straight", "curve", "zoom"])(
    "mixed routing retains incident %s endpoints",
    (route) => {
      const text = small().replace(
        "{ from: a, to: j, component: arrow }",
        `{ from: a, to: j, component: ${route === "zoom" ? "zoom" : "arrow"}${route === "zoom" ? "" : `, route: ${route}`} }`,
      );
      const value = placed(text);
      expect(junctionsOnBus(value.ir, value.layout)).toBe(value.layout);
    },
  );

  test.each(["node", "group", "title", "layer"])(
    "the swept channel cannot intersect a %s obstacle",
    async (kind) => {
      const value = placed(await Bun.file(`${root}/${TRANSFORMER}`).text());
      const at = nodeRect(value, "dec-split2");
      // The move is 1.33 units down: this obstacle lies strictly between the
      // original and final rectangles, so checking only the destination fails.
      const obstacle = { x: at.x - 1, y: at.y + at.height + 0.2, width: at.width + 2, height: 0.1 };
      const template = value.layout.groups[0];
      const spec = value.ir.groups[0];
      const node = value.layout.nodes.find(
        (n) => n.key !== value.ir.nodes.find((n) => n.id === "dec-split2")?.key,
      );
      if (!template || !spec || !node) throw new Error("missing obstacle template");
      const key = "group:bus-obstacle" as ElementKey;
      let { ir, layout } = value;
      if (kind === "node") {
        layout = {
          ...layout,
          nodes: layout.nodes.map((n) => (n === node ? { ...n, rect: obstacle } : n)),
        };
      } else {
        const group = { kind: "group" as const, key, rect: obstacle, content: obstacle };
        if (kind === "title") {
          const label = layout.nodes.find((n) => n.label)?.label;
          if (!label) throw new Error("missing label");
          layout = {
            ...layout,
            groups: [
              ...layout.groups,
              {
                ...group,
                rect: { ...obstacle, x: obstacle.x + 100 },
                label: { ...label, box: obstacle },
              },
            ],
          };
        } else if (kind === "layer") {
          // Its front starts below the sweep, but the back-card strip covers it.
          layout = {
            ...layout,
            groups: [...layout.groups, { ...group, rect: { ...obstacle, height: 30, width: 30 } }],
          };
        } else layout = { ...layout, groups: [...layout.groups, group] };
        ir = {
          ...ir,
          groups: [
            ...ir.groups,
            {
              ...spec,
              key,
              ...(kind === "layer" ? { layers: { count: 2, offset: { units: 2, pt: 1 } } } : {}),
            },
          ],
        };
      }
      expect(
        junctionsOnBus(ir, layout).nodes.find(
          (n) => n.key === value.ir.nodes.find((n) => n.id === "dec-split2")?.key,
        )?.rect,
      ).toEqual(at);
    },
  );

  test.each(["north", "west"])("the complete junction cannot leave the %s group border", (side) => {
    const checked = validateProfile({
      version: 1,
      id: "zero-padding",
      description: "Zero group padding",
      page: { maxWidth: "88mm", maxHeight: "220mm" },
      margin: "2mm",
      typography: { minFontSize: "7pt" },
      layout: {
        layerGap: "10mm",
        containerPadding: "4mm",
        groupPadding: "0pt",
        compact: {
          arrangeGap: "0pt",
          nodePaddingX: "0pt",
          nodePaddingY: "0pt",
          groupPadding: "0pt",
        },
      },
    });
    if (!checked.ok) throw new Error(JSON.stringify(checked.diagnostics));
    const text = `version: 1
figure:
  id: containment
  theme: paper
  layout:
    arrange:
      ${side === "north" ? "stack" : "row"}: { gap: 5pt, items: [g, b] }
groups:
  - id: g
    arrange:
      stack: { items: [j] }
nodes:
  - { id: b, component: box, label: B }
  - { id: j, component: junction, variant: hidden }
edges:
  - { from: j, to: b, component: arrow, toAnchor: '${side}:0.8' }
`;
    const value = placed(text, { profile: checked.value });
    expect(junctionsOnBus(value.ir, value.layout)).toBe(value.layout);
    const routed = routeEdges(value.ir, value.layout);
    expect(routed.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const final = routed.layout;
    const j = nodeRect({ ...value, layout: final }, "j");
    const g = final.groups[0]?.rect;
    if (!g) throw new Error("missing group");
    expect(j.x).toBeGreaterThanOrEqual(g.x);
    expect(j.y).toBeGreaterThanOrEqual(g.y);
    expect(j.x + j.width).toBeLessThanOrEqual(g.x + g.width);
    expect(j.y + j.height).toBeLessThanOrEqual(g.y + g.height);
  });
});
