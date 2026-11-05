/** Independent cubic routes with a shared through direction at junctions (#366). */
import type { EdgeIR, FigureIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";
import { getOutlineRenderer } from "../../core/outline";
import type { LayoutIR, Point, Rect, TextLayout, TextMetrics } from "../ir";
import { roundUnits } from "../ir";
import { arrowheadLength } from "./arrowhead";
import { type Cubic, cubicPoint, sampleCubic } from "./cubic";
import { straightLabel } from "./direct-label";
import { DIRS, isJunction, SIDE_DIR } from "./ports";

/**
 * Resolve each junction once from the complete incident set, including the through edge.
 * The vector is an oriented flow direction: edges ending here arrive along it and edges
 * starting here depart along it, so curves continue through the junction without a cusp.
 */
export function junctionTangents(
  ir: FigureIR,
  layout: LayoutIR,
  rects: ReadonlyMap<ElementKey, Rect>,
): ReadonlyMap<ElementKey, Point> {
  const center = (key: ElementKey): Point => {
    const r = rects.get(key);
    if (!r) throw new Error(`Missing curve endpoint ${key}`);
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  };
  const nodes = new Map(ir.nodes.map((n) => [n.key, n]));
  const tangents = new Map<ElementKey, Point>();
  for (const node of ir.nodes.filter(isJunction)) {
    const key = node.key;
    const incident = ir.edges
      .filter((e) => e.from === key || e.to === key)
      .sort((a, b) => a.key.localeCompare(b.key));
    // A junction-to-junction edge is the explicit through flow. Otherwise use
    // a non-curved neighbour, then the dominant axis of the incident bundle.
    const other =
      incident.find((e) => isJunction(nodes.get(e.from === key ? e.to : e.from))) ??
      incident.find((e) => e.route !== "curve");
    let v: Point;
    if (other) {
      const p = layout.edges.find((e) => e.key === other.key)?.route?.points;
      const first = other.from === key ? p?.[0] : p?.at(-2);
      const last = other.from === key ? p?.[1] : p?.at(-1);
      const from = first ?? center(other.from);
      const to = last ?? center(other.to);
      v = { x: to.x - from.x, y: to.y - from.y };
    } else {
      const sum = incident.reduce(
        (v, e) => {
          const from = center(e.from);
          const to = center(e.to);
          return { x: v.x + Math.abs(to.x - from.x), y: v.y + Math.abs(to.y - from.y) };
        },
        { x: 0, y: 0 },
      );
      v = sum.x >= sum.y ? { x: 1, y: 0 } : { x: 0, y: 1 };
      const into = incident.filter((e) => e.to === key);
      const out = incident.filter((e) => e.from === key);
      const [first] = into;
      const [last] = out;
      if (first && last && into.length === 1 && out.length === 1) {
        // One in, one out: the through direction runs from the incoming source to the outgoing target.
        const a = center(first.from);
        const b = center(last.to);
        v = { x: b.x - a.x, y: b.y - a.y };
      } else {
        // Fan-in/fan-out: orient the axis along the incoming (else outgoing) chords.
        const dot = (e: EdgeIR) => {
          const a = center(e.from);
          const b = center(e.to);
          return v.x * (b.x - a.x) + v.y * (b.y - a.y);
        };
        const total = (into.length > 0 ? into : out).reduce((n, e) => n + dot(e), 0);
        if (total < 0) v = { x: -v.x, y: -v.y };
      }
    }
    tangents.set(key, v);
  }
  return tangents;
}

export function curvePoints(
  edge: EdgeIR,
  a: Point,
  b: Point,
  ir: FigureIR,
  rects: ReadonlyMap<ElementKey, Rect>,
  tangents: ReadonlyMap<ElementKey, Point>,
): Cubic {
  const nodes = new Map(ir.nodes.map((n) => [n.key, n]));
  const chord = { x: b.x - a.x, y: b.y - a.y };
  const tangent = (key: ElementKey, anchor: EdgeIR["fromAnchor"], source: boolean): Point => {
    const node = nodes.get(key);
    let fixed: EdgeIR["fromAnchor"];
    if (node?.render) {
      const renderer = getOutlineRenderer(node.render.renderer);
      fixed = renderer?.draw(
        rects.get(key) as Rect,
        renderer.params.parse(node.render.params ?? {}),
      ).fixedPort;
    }
    const side = fixed ?? anchor;
    if (side !== undefined && side !== "straight") {
      const normal = DIRS[SIDE_DIR[side.side]] as Point;
      return { x: normal.x * (source ? 1 : -1), y: normal.y * (source ? 1 : -1) };
    }
    // Junction vectors are already oriented along the flow; only ordinary nodes follow the chord.
    return tangents.get(key) ?? chord;
  };
  const distance = Math.hypot(chord.x, chord.y) / 3;
  const control = (p: Point, v: Point, sign: number): Point => {
    const norm = Math.hypot(v.x, v.y) || 1;
    return {
      x: roundUnits(p.x + (sign * distance * v.x) / norm),
      y: roundUnits(p.y + (sign * distance * v.y) / norm),
    };
  };
  return [
    a,
    control(a, tangent(edge.from, edge.fromAnchor, true), 1),
    control(b, tangent(edge.to, edge.toAnchor, false), -1),
    b,
  ];
}

export function curveLabel(metrics: TextMetrics, points: Cubic, edge: EdgeIR): TextLayout {
  const samples = sampleCubic(points);
  const lengths = [0];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1] as Point;
    const b = samples[i] as Point;
    lengths.push((lengths[i - 1] ?? 0) + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = lengths.at(-1) ?? 1;
  const room =
    Math.hypot(metrics.width, metrics.height) / 2 +
    arrowheadLength(edge.style.strokeWidth.units) +
    2;
  const at =
    edge.labelAt === "start"
      ? Math.min(total / 2, room)
      : edge.labelAt === "end"
        ? Math.max(total / 2, total - room)
        : total / 2;
  const i = Math.max(
    1,
    lengths.findIndex((n) => n >= at),
  );
  const t =
    (i - 1 + (at - (lengths[i - 1] ?? 0)) / ((lengths[i] ?? 1) - (lengths[i - 1] ?? 0))) /
    (samples.length - 1);
  const p = cubicPoint(points, t);
  const a = cubicPoint(points, Math.max(0, t - 0.0001));
  const b = cubicPoint(points, Math.min(1, t + 0.0001));
  const v = { x: b.x - a.x, y: b.y - a.y };
  return straightLabel(
    metrics,
    { x: p.x - v.x, y: p.y - v.y },
    { x: p.x + v.x, y: p.y + v.y },
    { ...edge, labelAt: "middle" },
  );
}
