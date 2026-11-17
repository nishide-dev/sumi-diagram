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

/** Which face of a solid a body layer is (#575): painted without a stroke, as a shade of the node's fill. */
export type OutlineShade = "front" | "top" | "side";

export interface OutlineLayer {
  readonly role: "body" | "line";
  readonly path: OutlinePath;
  /**
   * Body only: the layer is a face of a solid. Renderers paint it with no stroke;
   * `front` takes the node's fill, `top` and `side` the shades the theme derives
   * from it (params `topFill`, `sideFill`). Lines draw the edges.
   */
  readonly shade?: OutlineShade;
  /** Line only: an inner edge of a solid, thinner and lighter than the silhouette (param `innerStroke`). */
  readonly inner?: true;
  /** Line only: a grid line of a solid's cells (#576), thinner and paler than the inner edges. */
  readonly grid?: true;
  /** More open lines painted with the same attributes as `path` (the many lines of a grid). */
  readonly more?: readonly OutlinePath[];
  /** The index of the highlighted sub-block (param `blocks`) this layer belongs to, if any (#576). */
  readonly block?: number;
}

/** A named sub-block of a solid (#576): its silhouette, faces and bounding box. */
export interface OutlinePart {
  readonly box: Rect;
  readonly outline: readonly Point[];
  /** The three visible faces and the hidden left face, each as 4 corners: front-top, back-top, back-bottom, front-bottom for the left and right (side) faces. */
  readonly faces: {
    readonly front: readonly Point[];
    readonly side: readonly Point[];
    readonly left: readonly Point[];
  };
}

export interface OutlineDrawing {
  /** Back to front. Bodies are closed, filled polygons; lines are unfilled with round caps/joins. */
  readonly layers: readonly OutlineLayer[];
  /**
   * A solid drawn in projection (#575, a cuboid): its bounding box's middle is its projected
   * centre, where edges without an anchor aim, so edges between neighbouring solids may be
   * straightened along the extents of their boxes.
   */
  readonly solid?: true;
  /** Named sub-blocks of a solid (#576): the targets of references `<node>.<name>`. */
  readonly parts?: Readonly<Record<string, OutlinePart>>;
  /** The visible faces a `faceContacts` end may slide along (parallelograms), with `faceContacts`. */
  /**
   * Where an edge without an anchor ends on a visible face of a solid instead of the silhouette
   * (#575, cuboid `ports: face`): the centroid of that face, inside the silhouette, on the same
   * line as the side's default port. The stretch over the node's own face is drawn on top of it.
   */
  readonly faces?: Partial<Record<"north" | "east", readonly Point[]>>;
  readonly faceContacts?: Partial<Record<"north" | "south" | "east" | "west", Point>>;
  /** Ordered enclosing silhouette; equals the body union unless boundaries is supplied. */
  readonly outline: readonly Point[];
  /** Optional body-only boundary for edge contacts; collision still includes the complete silhouette. */
  readonly portOutline?: readonly Point[];
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
   * Set when the drawing never holds a label (a bracket, #281; a waveform,
   * whose label is a caption below its frame, #491): its footprint does not
   * depend on the label box, so callers pass a 1 x 1 box. The drawing may
   * then have no body at all, only `line` layers.
   */
  readonly labelless?: boolean;
  /** Strict object; parse fixed manifest params (including defaults) before calling. */
  readonly params: z.ZodType<P>;
  /** Positive finite label size -> size whose safeArea holds it; monotone in both axes. */
  footprint(label: Readonly<OutlineSize>, params: Readonly<P>): OutlineSize;
  /** Pure/deterministic for a positive finite footprint; does not mutate either argument. */
  draw(footprint: Readonly<Rect>, params: Readonly<P>): OutlineDrawing;
}
