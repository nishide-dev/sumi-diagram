/** Outline renderer contract (#52, design §3.1). Geometry only; no SVG or theme. */
import type { z } from "zod";
import type { Anchor } from "../figure/layout";
import type { Point, Rect, Region } from "../geometry";

export type OutlineParams = Record<string, number | boolean | string | undefined>;

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
  /** Ordered enclosing silhouette; equals the body union unless boundaries is supplied. */
  readonly outline: readonly Point[];
  /** Disconnected painted boundaries, when present. Ports contact these, never the gap. */
  readonly boundaries?: readonly (readonly Point[])[];
  /** The only painted contact for incoming and outgoing edges, independent of the other end. */
  readonly fixedPort?: Anchor;
  /** Label rectangle; disconnected bodies may share text across their enclosing silhouette. */
  readonly safeArea: Rect;
  /** Convex collision region, containing the outline; omitted means its convex hull. */
  readonly collision?: Region;
}

export interface OutlineRenderer<P extends OutlineParams = OutlineParams> {
  readonly id: `${string}/${string}`;
  readonly version: 1;
  /**
   * Set when the drawing never holds a label (a bracket, #281): its footprint
   * does not depend on the label box, so callers pass a 1 x 1 box. The drawing
   * may then have no body at all, only `line` layers.
   */
  readonly labelless?: boolean;
  /** Strict object; parse fixed manifest params (including defaults) before calling. */
  readonly params: z.ZodType<P>;
  /** Positive finite label size -> size whose safeArea holds it; monotone in both axes. */
  footprint(label: Readonly<OutlineSize>, params: Readonly<P>): OutlineSize;
  /** Pure/deterministic for a positive finite footprint; does not mutate either argument. */
  draw(footprint: Readonly<Rect>, params: Readonly<P>): OutlineDrawing;
}
