/** Outline renderer contract (#52, design §3.1). Geometry only; no SVG or theme. */
import type { z } from "zod";
import type { Point, Rect, Region } from "../geometry";

export type OutlineParams = Record<string, number | boolean | string>;

export interface OutlineSize {
  width: number;
  height: number;
}

/** Straight segments only. `closed` preserves SVG Z semantics, unlike PathSegment. */
export interface OutlinePath {
  readonly points: readonly Point[];
  readonly closed: boolean;
}

export interface OutlineDrawing {
  /** Back to front. Bodies are closed, filled polygons; lines are unfilled. */
  readonly layers: readonly { readonly role: "body" | "line"; readonly path: OutlinePath }[];
  /** Simple polygon equal to the boundary of the union of the body layers. */
  readonly outline: readonly Point[];
  /** Label rectangle contained in the body union; its center is the label anchor. */
  readonly safeArea: Rect;
  /** Convex collision region, containing the outline; omitted means its convex hull. */
  readonly collision?: Region;
}

export interface OutlineRenderer<P extends OutlineParams = OutlineParams> {
  readonly id: `${string}/${string}`;
  readonly version: 1;
  /** Strict object; parse fixed manifest params (including defaults) before calling. */
  readonly params: z.ZodType<P>;
  /** Positive finite label size -> size whose safeArea holds it; monotone in both axes. */
  footprint(label: Readonly<OutlineSize>, params: Readonly<P>): OutlineSize;
  /** Pure/deterministic for a positive finite footprint; does not mutate either argument. */
  draw(footprint: Readonly<Rect>, params: Readonly<P>): OutlineDrawing;
}
