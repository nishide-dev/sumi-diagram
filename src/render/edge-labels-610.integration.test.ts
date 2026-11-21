/**
 * Edge labels placed predictably (#610, design record
 * `docs/design/decisions/610-edge-labels.md`), through `renderFigure`
 * (structured only, no D2): straight labels above the line whichever way it
 * runs, `labelAt` as a fraction of the route, `labelStyle: tag`, and the
 * lints of labels the router placed off their line, with their verified hint.
 */

import { describe, expect, test } from "bun:test";
import { compileFigure } from "../compiler/compile";
import type { EdgeLayout, Point, Rect } from "../layout/ir";
import { tagBox } from "../layout/route/labels";
import {
  drifts,
  EDGE_LABEL_DETACHED,
  EDGE_LABEL_TOUCHES_LINE,
  geometryContextFor,
  lintGeometry,
} from "../lint/geometry";
import { type RenderedStructuredFigure, renderFigure } from "./render";

async function render(source: string) {
  const result = await renderFigure(source);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return { rendered: result.value as RenderedStructuredFigure, diagnostics: result.diagnostics };
}

const center = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
const edgeAt = (r: RenderedStructuredFigure, i: number): EdgeLayout => {
  const e = r.layout.edges.find((x) => x.key === r.compiled.ir.edges[i]?.key);
  if (e?.route?.label === undefined) throw new Error(`edge ${i} has no label`);
  return e;
};

const row = (edges: string) => `version: 1
figure:
  id: labels
  theme: sumi
  profile: paper-double
  layout:
    arrange:
      stack:
        gap: 12mm
        items:
          - row: {gap: 30mm, items: [a, b, c]}
          - row: {gap: 30mm, items: [d, e, f]}
nodes:
  - {id: a, component: box, label: Client}
  - {id: b, component: box, label: Server}
  - {id: c, component: box, label: Store}
  - {id: d, component: box, label: Dev 0}
  - {id: e, component: box, label: Dev 1}
  - {id: f, component: box, label: Dev 2}
edges:
${edges}
`;

describe("straight labels above the line (#610)", () => {
  test("a leftward straight edge puts its label above, like a rightward one", async () => {
    const { rendered } = await render(
      row(`  - {from: a, to: b, route: straight, label: ask}
  - {from: c, to: b, route: straight, label: reply}`),
    );
    for (const i of [0, 1]) {
      const e = edgeAt(rendered, i);
      const [p, q] = e.route?.points ?? [];
      const box = e.route?.label?.box as Rect;
      expect(box.y + box.height).toBeLessThan(Math.min(p?.y ?? 0, q?.y ?? 0));
    }
  });

  test("labelSide still faces the travel direction", async () => {
    const { rendered } = await render(
      row("  - {from: c, to: b, route: straight, label: reply, labelSide: left}"),
    );
    const e = edgeAt(rendered, 0);
    const y = e.route?.points[0]?.y ?? 0;
    // Left of a leftward line is below it.
    expect(e.route?.label?.box.y).toBeGreaterThan(y);
  });

  test("an upward straight edge puts its label on the right", async () => {
    const { rendered } = await render(row("  - {from: e, to: b, route: straight, label: up}"));
    const e = edgeAt(rendered, 0);
    expect(e.route?.label?.box.x).toBeGreaterThan(e.route?.points[0]?.x ?? 0);
  });
});

describe("labelAt as a fraction (#610)", () => {
  test("centres the label at that point of an orthogonal route", async () => {
    const { rendered } = await render(
      row(`  - {from: d, to: e, label: "q", labelAt: 0.3}
  - {from: d, to: e, label: "q", labelAt: 0.7}`),
    );
    const [first, second] = [edgeAt(rendered, 0), edgeAt(rendered, 1)];
    const [p, q] = first.route?.points ?? [];
    if (p === undefined || q === undefined) throw new Error("no route");
    const at = (f: number) => p.x + f * (q.x - p.x);
    expect(Math.abs(center(first.route?.label?.box as Rect).x - at(0.3))).toBeLessThan(1);
    expect(center(second.route?.label?.box as Rect).x).toBeGreaterThan(
      center(first.route?.label?.box as Rect).x,
    );
  });

  test("of a straight line's length", async () => {
    const { rendered } = await render(
      row("  - {from: a, to: c, route: straight, toAnchor: west, label: x, labelAt: 0.25}"),
    );
    const e = edgeAt(rendered, 0);
    const [p, q] = e.route?.points ?? [];
    if (p === undefined || q === undefined) throw new Error("no route");
    expect(
      Math.abs(center(e.route?.label?.box as Rect).x - (p.x + 0.25 * (q.x - p.x))),
    ).toBeLessThan(1);
  });

  test("rejects a number outside 0 to 1", () => {
    const result = compileFigure(row("  - {from: d, to: e, label: q, labelAt: 1.5}"));
    expect(result.ok).toBe(false);
  });
});

describe("labelStyle: tag (#610)", () => {
  const tagged = row(`  - {from: a, to: b, label: request, labelStyle: tag}
  - {from: b, to: e, label: shard, labelStyle: tag}
  - {from: c, to: f, route: straight, label: up, labelStyle: tag, variant: dashed}`);

  test("sits centred on its line, in a frame drawn under the text", async () => {
    const { rendered, diagnostics } = await render(tagged);
    expect(diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
    for (const i of [0, 1, 2]) {
      const e = edgeAt(rendered, i);
      const c = center(e.route?.label?.box as Rect);
      const [p, q] = e.route?.points ?? [];
      if (p === undefined || q === undefined) throw new Error("no route");
      // Distance from the centre to the line through the first segment.
      const length = Math.hypot(q.x - p.x, q.y - p.y);
      const off = Math.abs((q.x - p.x) * (p.y - c.y) - (p.x - c.x) * (q.y - p.y)) / length;
      expect(off).toBeLessThan(0.75);
    }
    const tags = [...rendered.svg.matchAll(/<rect class="sumi-edge-tag"[^>]*\/><text/g)];
    expect(tags).toHaveLength(3);
    // The frame holds the text's line box with its padding.
    const label = edgeAt(rendered, 0).route?.label;
    if (label === undefined) throw new Error("no label");
    const box = tagBox(label.box, label);
    expect(box.width).toBeGreaterThan(label.box.width);
    expect(tags[0]?.[0]).toContain('fill="#');
  });

  test("is quiet in the geometry lint", async () => {
    const { rendered } = await render(tagged);
    const found = lintGeometry(rendered, { source: tagged }).filter(
      (d) => d.severity !== "info" || d.code.startsWith("geometry/edge-label"),
    );
    expect(found).toEqual([]);
  });

  test("is an error in an auto figure", () => {
    const result = compileFigure(`version: 1
figure: {id: auto, theme: sumi}
nodes:
  - {id: a, component: box, label: A}
  - {id: b, component: box, label: B}
edges:
  - {from: a, to: b, label: x, labelStyle: tag}
`);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.diagnostics.map((d) => d.code)).toContain("layout/structured-only");
  });
});

/** The #603 4-lost-multiturn draft's turn loop: the return label is lifted off a short span. */
const loop = `version: 1
figure:
  id: drift
  theme: sumi
  profile: paper-double
  layout:
    arrange:
      row: {gap: 9mm, items: [usim, asst, cls, ext, ev, done]}
nodes:
  - {id: usim, component: box, tone: blue, variant: tinted, label: User simulator, sublabel: sees all shards}
  - {id: asst, component: box, variant: emphasis, label: Assistant, sublabel: LLM under test}
  - {id: cls, component: box, variant: muted, label: "Strategy\\nclassifier"}
  - {id: ext, component: box, variant: muted, label: "Answer\\nextractor"}
  - {id: ev, component: box, variant: muted, label: Evaluator, sublabel: task-specific}
  - {id: done, component: final}
edges:
  - {from: usim, to: asst, label: 1 shard}
  - {from: asst, to: cls, label: reply}
  - {from: cls, to: ext, label: attempt}
  - {from: ext, to: ev}
  - {from: ev, to: done, label: correct}
  - {from: ev, to: usim, fromAnchor: south, toAnchor: south, label: "otherwise: next turn\\n(until no shards are left)"}
  - {from: cls, to: usim, fromAnchor: south, toAnchor: south, label: no attempt}
`;

describe("geometry/edge-label-detached and edge-label-touches-line (#610)", () => {
  test("reports a lifted label with an edit verified by routing again", async () => {
    const { rendered } = await render(loop);
    const found = lintGeometry(rendered, { source: loop }).filter(
      (d) => d.code === EDGE_LABEL_DETACHED,
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      severity: "info",
      path: ["edges", 5, "label"],
      subject: { kind: "edge", id: "edges[5]" },
    });
    expect(found[0]?.hint).toContain("Verified: setting edges[5].labelAt to start");

    // The verified edit does what the hint says.
    const edited = loop.replace(
      '(until no shards are left)"}',
      '(until no shards are left)", labelAt: start}',
    );
    const after = await render(edited);
    const lint = lintGeometry(after.rendered, { source: edited });
    expect(lint.filter((d) => d.severity !== "info")).toEqual([]);
    expect(
      lint.filter((d) => d.code.startsWith("geometry/edge-label-") && d.path?.[1] === 5),
    ).toEqual([]);
  });

  test("leaves requested labels and labels at their usual gap alone", async () => {
    const { rendered } = await render(
      loop.replace('(until no shards are left)"}', '(until no shards are left)", labelAt: end}'),
    );
    const context = geometryContextFor(rendered);
    expect(drifts(context).map((d) => d.edge.key)).toEqual([]);
  });

  test("a label whose letters meet its line counts as touching", async () => {
    const { rendered } = await render(row("  - {from: d, to: e, label: grads}"));
    const context = geometryContextFor(rendered);
    const edge = context.elements.find((e) => e.ir.kind === "edge");
    const box = edge?.labels[0]?.visibleLines[0];
    if (edge === undefined || box === undefined) throw new Error("no label");
    // The line moved through the middle of the letters.
    const y = box.y + box.height / 2;
    edge.drawn = [
      [
        { x: box.x - 20, y },
        { x: box.x + box.width + 20, y },
      ],
    ];
    const found = drifts(context);
    expect(found.map((d) => d.kind)).toEqual(["touching"]);
    expect(EDGE_LABEL_TOUCHES_LINE).toBe("geometry/edge-label-touches-line");
  });
});
