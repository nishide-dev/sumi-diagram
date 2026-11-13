/**
 * State-machine markers (#519): the initial state, a solid dot, and the final
 * state, a ring around a smaller dot (UML's bullseye). They carry no label and
 * take their default size from the theme's text size.
 */
import { z } from "zod";
import type { Point } from "../geometry";
import type { OutlineRenderer } from "./types";

export const STATE_MARKER_KINDS = ["initial", "final"] as const;
export type StateMarkerKind = (typeof STATE_MARKER_KINDS)[number];

/** Default diameter in ems of the theme's text size. */
export const STATE_MARKER_DIAMETERS: Readonly<Record<StateMarkerKind, number>> = {
  initial: 1.25,
  final: 1.75,
};
/** The inner dot of a final marker, relative to its ring's radius. */
export const FINAL_DOT_RATIO = 0.5;
/** Vertices of a circle drawn as a polygon (the contract allows straight segments only). */
const CIRCLE_STEPS = 48;
/** The em of a figure whose theme size is unknown: 8pt in D2 units. */
const DEFAULT_EM = 16;

export const stateMarkerParams = z.strictObject({
  kind: z.enum(STATE_MARKER_KINDS).default("initial"),
  /** The theme's text size, which scales the default diameter. */
  em: z.number().positive().default(DEFAULT_EM),
  /** Explicit diameter. */
  size: z.number().positive().optional(),
});
export type StateMarkerParams = z.output<typeof stateMarkerParams>;

/** Smallest diameter, in D2 units (6pt): below it a final marker's ring and gap vanish. */
export const STATE_MARKER_MIN_DIAMETER = 12;

export function stateMarkerDiameter({ kind, em, size }: StateMarkerParams): number {
  return Math.max(STATE_MARKER_MIN_DIAMETER, size ?? em * STATE_MARKER_DIAMETERS[kind]);
}

function circle(cx: number, cy: number, r: number): Point[] {
  return Array.from({ length: CIRCLE_STEPS }, (_, i) => {
    const t = (2 * Math.PI * i) / CIRCLE_STEPS - Math.PI / 2;
    return { x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) };
  });
}

/** The ring of a final marker, relative to its radius: from `RING_INNER` to 1. */
const RING_INNER = 0.84;
/**
 * An annulus as two half rings, each a simple polygon (the right half from the
 * top to the bottom, then the left half back), so no polygon touches itself.
 */
function annulus(cx: number, cy: number, outer: number, inner: number): Point[][] {
  const o = circle(cx, cy, outer);
  const i = circle(cx, cy, inner);
  const half = CIRCLE_STEPS / 2;
  const band = (outerArc: Point[], innerArc: Point[]) => [...outerArc, ...innerArc.reverse()];
  return [
    band(o.slice(0, half + 1), i.slice(0, half + 1)),
    band([...o.slice(half), o[0] as Point], [...i.slice(half), i[0] as Point]),
  ];
}

export const stateMarker: OutlineRenderer<StateMarkerParams> = {
  id: "sumi/state-marker",
  version: 1,
  labelless: true,
  params: stateMarkerParams,
  footprint(_label, params) {
    const d = stateMarkerDiameter(params);
    return { width: d, height: d };
  },
  draw(rect, { kind }) {
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const r = Math.min(rect.width, rect.height) / 2;
    const outline = circle(cx, cy, r);
    // The largest square the circle's polygon holds (a marker takes no label).
    const half = r * 0.69;
    const safeArea = { x: cx - half, y: cy - half, width: 2 * half, height: 2 * half };
    if (kind === "initial")
      return {
        layers: [{ role: "body", path: { points: outline, closed: true } }],
        outline,
        safeArea,
      };
    const rings = annulus(cx, cy, r, r * RING_INNER);
    const dot = circle(cx, cy, r * FINAL_DOT_RATIO);
    const bodies = [...rings, dot];
    return {
      layers: bodies.map((points) => ({
        role: "body" as const,
        path: { points, closed: true },
      })),
      outline,
      // Edges meet the ring, never the gap between it and the dot.
      boundaries: bodies,
      safeArea,
    };
  },
};
