/**
 * Edge labels placed predictably (#610, design record
 * `docs/design/decisions/610-edge-labels.md`), through `renderFigure`
 * (structured only, no D2): straight labels above the line whichever way it
 * runs, `labelAt` as a fraction of the route, `labelStyle: tag`, and the
 * lints of labels the router placed off their line, with their verified hint.
 */

import { describe, expect, test } from "bun:test";
import { compileFigure } from "../compiler/compile";
import { asHintTrial } from "../layout/hint-trials";
import type { EdgeLayout, Point, Rect } from "../layout/ir";
import { tagBox } from "../layout/route/labels";
import { resolveLintConfig } from "../lint/config";
import {
  drifts,
  driftsAdded,
  EDGE_LABEL_DETACHED,
  EDGE_LABEL_TOUCHES_LINE,
  edgeLabelDetached,
  geometryContextFor,
  inkGlyphs,
  inkLines,
  lintGeometry,
  lintTrial,
  type TrialLint,
} from "../lint/geometry";
import { routeTrial, trialContext } from "../lint/geometry/trial";
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

  test("a line through the space between two words does not touch them", async () => {
    const { rendered } = await render(row("  - {from: d, to: e, label: left right}"));
    const context = geometryContextFor(rendered);
    const edge = context.elements.find((e) => e.ir.kind === "edge");
    const measured = edge?.labels[0];
    if (edge === undefined || measured === undefined) throw new Error("no label");
    const glyphs = inkGlyphs(measured).sort((a, b) => a.x - b.x);
    // "left" then "right": the space lies between the 4th and 5th glyph.
    const t = glyphs[3] as Rect;
    const r = glyphs[4] as Rect;
    const x = (t.x + t.width + r.x) / 2;
    expect(r.x - (t.x + t.width)).toBeGreaterThan(1);
    const box = measured.visibleLines[0] as Rect;
    edge.drawn = [
      [
        { x, y: box.y - 20 },
        { x, y: box.y + box.height + 20 },
      ],
    ];
    // The line box would count it as touching; the glyphs do not.
    expect(inkLines(measured).some((ink) => ink.x < x && x < ink.x + ink.width)).toBe(true);
    expect(drifts(context).filter((d) => d.kind === "touching")).toEqual([]);
  });

  test("inside a trial the rules only detect, so a trial can see other labels drift", async () => {
    const source = loop;
    const { rendered } = await render(source);
    const context = { ...geometryContextFor(rendered), source };
    const found = asHintTrial(() => edgeLabelDetached.run(context, undefined));
    expect(found).toHaveLength(1);
    expect(found[0]?.hint).not.toContain("Verified");
    expect(found[0]?.hint).not.toContain("None of");
  });

  test("a trial that makes another label drift is turned down", () => {
    const lint = (entries: [string, string[]][]): TrialLint => ({
      problems: new Map(),
      bySubject: new Map(entries.map(([k, v]) => [k, new Set(v)])),
    });
    const before = lint([['{"kind":"edge","id":"edges[5]"}', [EDGE_LABEL_DETACHED]]]);
    expect(driftsAdded(before, lint([]))).toBe(false);
    expect(
      driftsAdded(before, lint([['{"kind":"edge","id":"edges[6]"}', [EDGE_LABEL_DETACHED]]])),
    ).toBe(true);
    expect(
      driftsAdded(before, lint([['{"kind":"edge","id":"edges[1]"}', [EDGE_LABEL_TOUCHES_LINE]]])),
    ).toBe(true);
  });
});

describe("tag frames in layout/edge-label-overlap (#610)", () => {
  test("a tag whose frame, not its text, reaches a node is reported", async () => {
    // The frame is wider than the text: on a span that holds the text but not the frame.
    const figure = (gap: string) => `version: 1
figure:
  id: tight
  theme: sumi
  profile: paper-double
  layout:
    arrange:
      row: {gap: ${gap}, items: [a, b]}
nodes:
  - {id: a, component: box, label: A}
  - {id: b, component: box, label: B}
edges:
  - {from: a, to: b, label: tagged, labelStyle: tag}
`;
    const sizes: { gap: number; text: number; frame: number; warned: boolean }[] = [];
    for (const mm of [9, 10, 11, 12, 13, 14, 16]) {
      const { rendered, diagnostics } = await render(figure(`${mm}mm`));
      const e = edgeAt(rendered, 0);
      const label = e.route?.label;
      if (label === undefined) throw new Error("no label");
      const a = rendered.layout.nodes.find((n) => n.key === rendered.compiled.ir.nodes[0]?.key)
        ?.rect as Rect;
      const b = rendered.layout.nodes.find((n) => n.key === rendered.compiled.ir.nodes[1]?.key)
        ?.rect as Rect;
      const frame = tagBox(label.box, label);
      const hits = (r: Rect) =>
        r.x < b.x && r.x + r.width > a.x + a.width && (r.x < a.x + a.width || r.x + r.width > b.x);
      sizes.push({
        gap: mm,
        text: hits(label.box) ? 1 : 0,
        frame: hits(frame) ? 1 : 0,
        warned: diagnostics.some((d) => d.code === "layout/edge-label-overlap"),
      });
    }
    // Wherever the frame reaches a node, the warning is there, even if the text is clear.
    for (const s of sizes) if (s.frame) expect(s.warned).toBe(true);
    expect(sizes.some((s) => s.frame && !s.text)).toBe(true);
  });
});

describe("tags of straight and curved edges, checked once every route is drawn (#610)", () => {
  // A tag on a/c's line, with b's box right on it; the edge a → c skips over b.
  const over = (route: string) => `version: 1
figure:
  id: direct
  theme: sumi
  profile: paper-double
  layout:
    arrange:
      row: {gap: 12mm, items: [a, b, c]}
nodes:
  - {id: a, component: box, label: A}
  - {id: b, component: box, label: B}
  - {id: c, component: box, label: C}
edges:
  - {from: a, to: c, route: ${route}, label: over, labelStyle: tag}
`;

  for (const route of ["straight", "curve"]) {
    test(`a ${route} tag whose frame sits on a node is reported`, async () => {
      const result = await renderFigure(over(route));
      const warned = result.diagnostics.filter((d) => d.code === "layout/edge-label-overlap");
      expect(warned).toHaveLength(1);
      expect(warned[0]?.message).toContain('node "b"');
      expect(warned[0]?.message).not.toContain("its own line");
    });
  }

  test("a clear straight or curved tag is not", async () => {
    for (const route of ["straight", "curve"]) {
      const source = row(`  - {from: d, to: b, route: ${route}, label: up, labelStyle: tag}`);
      const result = await renderFigure(source);
      expect(
        result.diagnostics.filter((d) => d.code === "layout/edge-label-overlap"),
        route,
      ).toEqual([]);
    }
  });
});

describe("drift detection in trials does not depend on the rules' levels (#610)", () => {
  for (const off of [EDGE_LABEL_DETACHED, EDGE_LABEL_TOUCHES_LINE]) {
    test(`with ${off} off, a trial still sees a detached label`, async () => {
      const { rendered } = await render(loop);
      const context = {
        ...geometryContextFor(rendered),
        lintConfig: resolveLintConfig({ rules: { [off]: "off" } }),
      };
      const placed = context.placed;
      if (placed === undefined) throw new Error("not placed");
      const seen = asHintTrial(() => {
        const trial = routeTrial(placed.ir, placed.layout);
        if (trial === undefined) throw new Error("no trial");
        const linted = trialContext(context, trial, undefined);
        if (linted === undefined) throw new Error("no trial context");
        return lintTrial(linted, trial);
      });
      expect(seen.bySubject.get(JSON.stringify({ kind: "edge", id: "edges[5]" }))).toContain(
        EDGE_LABEL_DETACHED,
      );
      // And a trial in which it appears for another edge is turned down.
      const none: TrialLint = { problems: new Map(), bySubject: new Map() };
      expect(driftsAdded(none, seen)).toBe(true);
    });
  }
});

describe("zoom lines in the tag check (#610)", () => {
  const figure = `version: 1
figure:
  id: zoomtag
  theme: sumi
  profile: paper-double
  layout:
    arrange:
      row: {gap: 6mm, items: [x, {stack: {gap: 14mm, items: [p, q]}}, y]}
nodes:
  - {id: x, component: box, label: X, props: {width: 8mm, height: 3mm}}
  - {id: p, component: box, label: P}
  - {id: q, component: box, label: Q}
  - {id: y, component: box, label: Y, props: {width: 20mm, height: 3mm}}
edges:
  - {from: x, to: y, component: zoom}
  - {from: p, to: q, route: straight, label: tagged, labelStyle: tag}
`;

  test("a straight tag across a zoom line is reported", async () => {
    const result = await renderFigure(figure);
    const warned = result.diagnostics.filter((d) => d.code === "layout/edge-label-overlap");
    expect(warned).toHaveLength(1);
    expect(warned[0]?.message).toContain('the line of edge edges[0] ("x" → "y")');
  });
});

describe("a touching label in a trial with edge-label-touches-line off (#610)", () => {
  test("is still recorded", async () => {
    const source = row("  - {from: d, to: e, label: grads}");
    const { rendered } = await render(source);
    const context = {
      ...geometryContextFor(rendered),
      lintConfig: resolveLintConfig({ rules: { [EDGE_LABEL_TOUCHES_LINE]: "off" } }),
    };
    const placed = context.placed;
    if (placed === undefined) throw new Error("not placed");
    const seen = asHintTrial(() => {
      const trial = routeTrial(placed.ir, placed.layout);
      if (trial === undefined) throw new Error("no trial");
      const linted = trialContext(context, trial, undefined);
      if (linted === undefined) throw new Error("no trial context");
      // The trial's line moved through the middle of the letters.
      const edge = linted.elements.find((e) => e.ir.kind === "edge");
      const box = edge?.labels[0]?.visibleLines[0];
      if (edge === undefined || box === undefined) throw new Error("no label");
      const y = box.y + box.height / 2;
      edge.drawn = [
        [
          { x: box.x - 20, y },
          { x: box.x + box.width + 20, y },
        ],
      ];
      return lintTrial(linted, trial);
    });
    expect(seen.bySubject.get(JSON.stringify({ kind: "edge", id: "edges[0]" }))).toContain(
      EDGE_LABEL_TOUCHES_LINE,
    );
    const none: TrialLint = { problems: new Map(), bySubject: new Map() };
    expect(driftsAdded(none, seen)).toBe(true);
  });
});

describe("orthogonal tags against zoom lines (#610)", () => {
  test("an orthogonal tag across zoom lines is reported once", async () => {
    const source = `version: 1
figure:
  id: zoomtag
  theme: sumi
  profile: paper-double
  layout:
    arrange:
      row: {gap: 6mm, items: [x, {stack: {gap: 14mm, items: [p, q]}}, y]}
nodes:
  - {id: x, component: box, label: X, props: {width: 8mm, height: 3mm}}
  - {id: p, component: box, label: P}
  - {id: q, component: box, label: Q}
  - {id: y, component: box, label: Y, props: {width: 20mm, height: 3mm}}
edges:
  - {from: x, to: y, component: zoom}
  - {from: p, to: q, label: tagged, labelStyle: tag}
`;
    const result = await renderFigure(source);
    const warned = result.diagnostics.filter((d) => d.code === "layout/edge-label-overlap");
    expect(warned).toHaveLength(1);
    expect(warned[0]?.message).toContain('the line of edge edges[0] ("x" → "y")');
  });
});

describe("tags on tilted planes against page routes (#610, #577)", () => {
  const figure = (pageEdge: boolean) => `version: 1
figure:
  id: planetag
  theme: sumi
  profile: paper-double
  projection: {angle: 45, depthScale: 0.6}
  layout:
    arrange:
      stack: {gap: 6mm, align: center, items: [a, tokens, b]}
groups:
  - id: tokens
    props: {plane: floor, contents: projected, padding: 7mm}
    arrange:
      row: {gap: 14mm, align: center, items: [t1, t2]}
nodes:
  - {id: a, component: box, label: A}
  - {id: b, component: box, label: B}
  - {id: t1, component: box, label: The, tone: blue}
  - {id: t2, component: box, label: cat, tone: blue}
edges:
  - {from: t1, to: t2, label: next, labelStyle: tag}
${pageEdge ? "  - {from: a, to: b}" : ""}
`;

  test("a plane edge's tag under a page route is reported once, in page coordinates", async () => {
    const result = await renderFigure(figure(true));
    const warned = result.diagnostics.filter((d) => d.code === "layout/edge-label-overlap");
    expect(warned).toHaveLength(1);
    expect(warned[0]?.message).toContain('the line of edge edges[1] ("a" → "b")');
    expect(warned[0]?.message).not.toContain("its own line");
  });

  test("alone on its plane, the tag is clear", async () => {
    const result = await renderFigure(figure(false));
    expect(result.diagnostics.filter((d) => d.code === "layout/edge-label-overlap")).toEqual([]);
  });
});

describe("a plane tag against the other legs of its own route (#610, #577)", () => {
  const figure = (plane: boolean) => `version: 1
figure:
  id: planeu
  theme: sumi
  profile: paper-double
${plane ? "  projection: {angle: 45, depthScale: 0.6}\n" : ""}  layout:
    arrange:
      stack: {gap: 6mm, align: center, items: [tokens]}
groups:
  - id: tokens
    props: {${plane ? "plane: floor, contents: projected, " : ""}padding: 9mm}
    arrange:
      row: {gap: 6mm, align: center, items: [t1, t2]}
nodes:
  - {id: t1, component: box, label: The, tone: blue}
  - {id: t2, component: box, label: cat, tone: blue}
edges:
  - {from: t1, to: t2, fromAnchor: south, toAnchor: south, label: "a much longer tag on the loop", labelStyle: tag, labelAt: 0.5}
`;

  for (const plane of [false, true]) {
    test(`a tag wider than its U's bottom leg crosses its own legs (${plane ? "on a tilted plane" : "on the page"})`, async () => {
      const result = await renderFigure(figure(plane));
      const warned = result.diagnostics.filter((d) => d.code === "layout/edge-label-overlap");
      expect(warned).toHaveLength(1);
      expect(warned[0]?.message).toContain("its own line");
    });
  }
});

describe("an explicit labelStyle: beside is still router-placed (#610)", () => {
  test("a lifted label with labelStyle: beside is reported as detached", async () => {
    const source = loop.replace(
      '(until no shards are left)"}',
      '(until no shards are left)", labelStyle: beside}',
    );
    const { rendered } = await render(source);
    expect(drifts(geometryContextFor(rendered)).map((d) => d.kind)).toEqual(["detached"]);
  });
});
