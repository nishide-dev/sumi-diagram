/**
 * #649: four small expression gaps — `attach.inFlow: false`, `labelStyle:
 * badge`, `lane.bus: false` and `origin: place` on nested place boxes.
 */
import { describe, expect, test } from "bun:test";
import { renderFigure } from "../render/render";
import { layoutStructuredFigure } from "./index";
import type { LayoutIR, Rect } from "./ir";

function layout(source: string): LayoutIR {
  const result = layoutStructuredFigure(source);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 1));
  return result.value.layout;
}

const rectOf = (l: LayoutIR, key: string): Rect => {
  const found = [...l.nodes, ...l.groups].find((e) => e.key === key);
  if (found === undefined) throw new Error(`no ${key}`);
  return found.rect;
};
const centerY = (r: Rect) => r.y + r.height / 2;
const centerX = (r: Rect) => r.x + r.width / 2;

describe("attach.inFlow: false (#649)", () => {
  // The edge from the whole tokens node makes it a frame that holds the note.
  const figure = (inFlow: string) => `version: 1
figure:
  id: note
  theme: sumi
  layout:
    arrange:
      stack:
        gap: 12mm
        items:
          - row: {gap: 8mm, align: center, items: [label, seq, out]}
          - next
nodes:
  - {id: label, component: label, label: "t=3"}
  - id: seq
    component: tokens
    props: {width: 6mm, height: 6mm, gap: 1mm, cells: [{label: A}, {id: f, label: B}, {label: C}]}
  - {id: out, component: box, label: out}
  - {id: next, component: box, label: next}
  - {id: note, component: label, label: "fork\\nhere", attach: {to: seq.f, side: south, gap: 1mm${inFlow}}}
edges:
  - {from: seq, to: out}
`;

  test("the row keeps its size: the label stays centred on the cells", () => {
    const flowing = layout(figure(""));
    const hanging = layout(figure(", inFlow: false"));
    const cell = (l: LayoutIR) => centerY(rectOf(l, "n:seq-f"));
    // In the flow, the frame grows by the note and the label centres on cells + note.
    expect(Math.abs(centerY(rectOf(flowing, "n:label")) - cell(flowing))).toBeGreaterThan(5);
    expect(centerY(rectOf(hanging, "n:label"))).toBeCloseTo(cell(hanging), 3);
    expect(centerY(rectOf(hanging, "n:out"))).toBeCloseTo(cell(hanging), 3);
    // The frame is the cells alone; the note hangs below it.
    const frame = rectOf(hanging, "g:seq");
    expect(frame.height).toBeCloseTo(rectOf(hanging, "n:seq-f").height, 3);
    const note = rectOf(hanging, "n:note");
    expect(note.y).toBeGreaterThan(frame.y + frame.height);
    expect(centerX(note)).toBeCloseTo(centerX(rectOf(hanging, "n:seq-f")), 3);
  });

  test("the group around the frame grows to hold a note that sticks out", () => {
    const source = `version: 1
figure:
  id: note
  theme: sumi
  layout: {arrange: {row: {items: [panel]}}}
groups:
  - id: panel
    label: Panel
    arrange: {row: {gap: 8mm, align: center, items: [label, seq, out]}}
nodes:
  - {id: label, component: label, label: "t=3"}
  - id: seq
    component: tokens
    props: {width: 6mm, height: 6mm, gap: 1mm, cells: [{label: A}, {id: f, label: B}]}
  - {id: out, component: box, label: out}
  - {id: note, component: label, label: "a long note\\non two lines", attach: {to: seq.f, side: south, gap: 1mm, inFlow: false}}
edges:
  - {from: seq, to: out}
`;
    const l = layout(source);
    const panel = rectOf(l, "g:panel");
    const note = rectOf(l, "n:note");
    expect(note.y + note.height).toBeLessThanOrEqual(panel.y + panel.height);
    expect(centerY(rectOf(l, "n:label"))).toBeCloseTo(centerY(rectOf(l, "n:seq-f")), 3);
  });
});

describe("labelStyle: badge (#649)", () => {
  test("a short label is drawn in a circle on its line, a longer one in a pill", async () => {
    const source = `version: 1
figure:
  id: badges
  theme: sumi
  layout: {arrange: {row: {gap: 20mm, items: [a, b, c]}}}
nodes:
  - {id: a, component: box, label: A}
  - {id: b, component: box, label: B}
  - {id: c, component: box, label: C}
edges:
  - {from: a, to: b, label: "1", labelStyle: badge}
  - {from: b, to: c, label: "step 2", labelStyle: badge}
`;
    const rendered = await renderFigure(source);
    if (!rendered.ok) throw new Error(JSON.stringify(rendered.diagnostics));
    const badges = [
      ...rendered.value.svg.matchAll(
        /<rect class="sumi-edge-badge" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="([\d.]+)"[^>]*\/><text/g,
      ),
    ].map((m) => ({
      x: Number(m[1]),
      y: Number(m[2]),
      width: Number(m[3]),
      height: Number(m[4]),
      rx: Number(m[5]),
    }));
    expect(badges).toHaveLength(2);
    const [circle, pill] = badges as [(typeof badges)[0], (typeof badges)[0]];
    expect(circle.width).toBeCloseTo(circle.height, 2);
    expect(circle.rx).toBeCloseTo(circle.height / 2, 2);
    expect(pill.width).toBeGreaterThan(pill.height);
    expect(pill.rx).toBeCloseTo(pill.height / 2, 2);
    // Centred on the horizontal line between the boxes, like a tag.
    const l = layout(source);
    expect(circle.y + circle.height / 2).toBeCloseTo(centerY(rectOf(l, "n:a")), 0);
    expect(rendered.value.svg).not.toContain("sumi-edge-tag");
  });
});

describe("lane.bus: false (#649)", () => {
  const figure = (bus: string) => `version: 1
figure:
  id: lanes
  theme: sumi
  layout: {arrange: {stack: {gap: 8mm, items: [avail, acq, done, arch]}}}
nodes:
  - {id: avail, component: box, label: Available}
  - {id: acq, component: box, label: Acquired}
  - {id: done, component: box, label: Acknowledged}
  - {id: arch, component: box, label: Archived}
edges:
  - {from: avail, to: acq}
  - {from: acq, to: done}
  - {from: done, to: arch}
  - {id: release, from: acq, to: avail, lane: {side: east${bus}}}
  - {id: reject, from: acq, to: arch, lane: {side: east, offset: 10mm${bus}}}
`;
  const route = (l: LayoutIR, key: string) => {
    const points = l.edges.find((e) => e.key === key)?.route?.points;
    if (points === undefined) throw new Error(`no route for ${key}`);
    return points;
  };

  test("a lane of its own keeps its offset and leaves from a point of its own", () => {
    const bussed = layout(figure(""));
    const own = layout(figure(", bus: false"));
    const laneX = (l: LayoutIR, key: string) => Math.max(...route(l, key).map((p) => p.x));
    // One bus: both on the farthest lane.
    expect(laneX(bussed, "e:release")).toBeCloseTo(laneX(bussed, "e:reject"), 3);
    // Two lanes: the release loop runs nearer than the reject one.
    expect(laneX(own, "e:release")).toBeLessThan(laneX(own, "e:reject") - 10);
    // Spread along Acquired's east side: the upward loop leaves above the downward one.
    const start = (key: string) => route(own, key)[0] as { x: number; y: number };
    const acq = rectOf(own, "n:acq");
    expect(start("e:release").x).toBeCloseTo(acq.x + acq.width, 3);
    expect(start("e:release").y).toBeLessThan(start("e:reject").y);
  });

  test("no lane-bus-split or lane-blocked warning", () => {
    const result = layoutStructuredFigure(figure(", bus: false"));
    expect(result.diagnostics.filter((d) => d.code.startsWith("layout/lane"))).toEqual([]);
  });
});

describe("origin: place on nested place boxes (#649)", () => {
  const figure = (origin: string, target = "active") => `version: 1
figure:
  id: nested
  theme: sumi
  layout:
    arrange:
      place:
        unit: 1mm
        items:
          - {item: ${target}, at: [0, 0], origin: ${origin}}
          - {item: terminal, at: [0, 0], origin: place}
groups:
  - id: active
    label: Active
    labelAt: top-left
    arrange:
      place:
        unit: 1mm
        items:
          - {item: submitted, at: [40, 20]}
          - {item: working, at: [40, 40]}
          - {item: input, at: [10, 40]}
  - id: terminal
    label: Terminal
    arrange:
      place:
        unit: 1mm
        items:
          - {item: completed, at: [40, 70]}
          - {item: failed, at: [75, 70]}
nodes:
  - {id: submitted, component: box, label: submitted}
  - {id: working, component: box, label: working}
  - {id: input, component: box, label: input}
  - {id: completed, component: box, label: completed}
  - {id: failed, component: box, label: failed}
`;
  // 1mm in layout units (0.5pt).
  const mm = 72 / 25.4 / 0.5;

  test("the inner coordinates are the page's: centres line up across groups", () => {
    const l = layout(figure("place"));
    const c = (key: string) => ({ x: centerX(rectOf(l, key)), y: centerY(rectOf(l, key)) });
    const working = c("n:working");
    expect(c("n:completed").x).toBeCloseTo(working.x, 3);
    expect(c("n:completed").y - working.y).toBeCloseTo(30 * mm, 2);
    expect(c("n:failed").x - c("n:completed").x).toBeCloseTo(35 * mm, 2);
    expect(working.x - c("n:input").x).toBeCloseTo(30 * mm, 2);
    expect(working.y - c("n:submitted").y).toBeCloseTo(20 * mm, 2);
  });

  test("on a node or a group arranged otherwise it is an error", () => {
    const result = layoutStructuredFigure(figure("place", "submitted"));
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toContain("layout/invalid-place-origin");
  });
});
