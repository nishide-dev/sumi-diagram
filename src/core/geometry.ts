/** Shared geometry, in D2/SVG user units (1 unit = 0.5pt). */
export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A convex collision region; polygon vertices are ordered in either orientation. */
export type Region =
  | { kind: "polygon"; points: readonly Point[] }
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number };
