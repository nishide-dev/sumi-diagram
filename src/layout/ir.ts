/**
 * Layout IR (design doc §6.21): the geometry of a figure, independent of how
 * it was computed. The structured engine (#89) produces it from the Figure IR;
 * a future ELK-direct backend (#57 §5) returns the same type. The orthogonal
 * router (#90) fills in the edge routes, and the SVG writer (#91) draws it.
 *
 * Geometry only: components, outline renderers, effective styles (stroke
 * widths, arrowheads) and the font set stay in the Figure IR. Consumers join
 * the two by `ElementKey`.
 *
 * Conventions:
 * - Coordinates are SVG user units (1 unit = 0.5pt, like D2 and `inspectSvg`),
 *   y pointing down, origin at the top-left corner of the canvas (the margin
 *   is inside the canvas).
 * - Every coordinate is rounded to 1/1000 unit (see {@link roundUnits}).
 *   Rectangles are rounded by their edges, so rectangles that touch before
 *   rounding still touch after it.
 * - Lists are in a fixed order (see each field), so serializing a layout is
 *   deterministic.
 */

import type { ElementKey } from "../core/check-state";
import type { Anchor } from "../core/figure/layout";
import type { Side } from "../core/figure/schema";
import type { Point, Rect } from "../core/geometry";
import type { NodeShape } from "../core/registry/manifest";

export type { Point, Rect } from "../core/geometry";

/** Rounds a coordinate to 1/1000 unit (ties away from zero, so -0.0005 → -0.001; never `-0`). */
export function roundUnits(value: number): number {
  const rounded = Math.sign(value) * (Math.round(Math.abs(value) * 1000) / 1000);
  return rounded === 0 ? 0 : rounded;
}

/** Rounds a rectangle by its edges (left, top, right, bottom) to 1/1000 unit. */
export function roundRect(rect: Rect): Rect {
  const x = roundUnits(rect.x);
  const y = roundUnits(rect.y);
  return {
    x,
    y,
    width: roundUnits(roundUnits(rect.x + rect.width) - x),
    height: roundUnits(roundUnits(rect.y + rect.height) - y),
  };
}

/**
 * A measured label, before it is placed: its lines as drawn and their size.
 * Measured with the theme's TTF files (the same advance widths and `hhea`
 * metrics as the geometry lint, design doc §6.5).
 */
export interface TextMetrics {
  /** The lines as drawn: `\n`-separated, whitespace collapsed like an SVG `<text>` without `xml:space`. */
  readonly lines: readonly string[];
  /** Advance width of each line in units (not rounded). */
  readonly lineWidths: readonly number[];
  /**
   * Font class, as in `LabelGeometry.font` of the inspection: `regular`,
   * `bold`, `italic`, `mono`, `mono-bold`, `mono-italic`. Selects the TTF.
   */
  readonly font: string;
  readonly fontSizeUnits: number;
  /** Baseline-to-baseline distance in units. */
  readonly lineHeightUnits: number;
  /** The font's ascender / descender at this size in units (`hhea`, both positive). */
  readonly ascentUnits: number;
  readonly descentUnits: number;
  /** Widest line in units (not rounded). */
  readonly width: number;
  /** `lines.length × lineHeightUnits`. */
  readonly height: number;
}

/** A placed label: metrics plus where it is drawn. */
export interface TextLayout extends TextMetrics {
  /**
   * The label's line box: `lines.length × lineHeightUnits` high, as wide as
   * the widest line, every line centered in it. A typographic box, not the
   * glyph bounds: the geometry lint's per-line ascender-to-descender boxes lie
   * inside it (blank lines take their height here; the lint skips them).
   */
  readonly box: Rect;
  /**
   * Where an SVG `<text text-anchor="middle">` goes: x = the center of the
   * lines, y = the first line's baseline. Later lines are `lineHeightUnits`
   * further down. The baseline puts the font's ascender-to-descender span in
   * the middle of each line's `lineHeightUnits` (CSS half-leading).
   */
  readonly anchor: Point;
}

/** How an element got its position. */
export type Placement = "arrange" | "attach";

export interface NodeLayout {
  readonly key: ElementKey;
  readonly kind: "node";
  /** Containing group, or `undefined` at the root. */
  readonly parent?: ElementKey;
  readonly shape: NodeShape;
  /** The shape's bounding box (stroke not included), like `ElementGeometry.bbox`. */
  readonly rect: Rect;
  readonly placement: Placement;
  /** The node's label; omitted when it has none. */
  readonly label?: TextLayout;
}

export interface GroupLayout {
  readonly key: ElementKey;
  readonly kind: "group";
  readonly parent?: ElementKey;
  /** The group's rectangle (stroke not included). */
  readonly rect: Rect;
  /** The area the group's children are laid out in: `rect` minus padding and label. */
  readonly content: Rect;
  /** The group's label, at the top of `rect`; omitted when it has none. */
  readonly label?: TextLayout;
}

/** An edge's path, once routed (#90): absolute points, joined by straight segments. */
export interface EdgeRoute {
  /**
   * First point on the source's outline, last on the target's; at least 2
   * points. The structured router's routes are orthogonal, without repeated
   * or collinear interior points; at a junction the end is its center.
   */
  readonly points: readonly Point[];
  /** The edge's placed label; omitted when the edge has none. */
  readonly label?: TextLayout;
  /** The edge's net: an index into {@link LayoutIR.nets} (#90). */
  readonly net: number;
  /** The side of the source the route leaves; omitted at a junction. */
  readonly fromSide?: Side;
  /** The side of the target the route enters; omitted at a junction. */
  readonly toSide?: Side;
}

/**
 * A net (#90): edges drawn as one connected wire. Edges that leave or enter
 * the same port, or meet at a junction (transitively, through edges between
 * junctions), share a net, and its routes may overlap (a shared trunk);
 * the router keeps routes of different nets from overlapping, crossing or
 * touching where it can (crossings are a cost, not forbidden).
 */
export interface RouteNet {
  /** Its index in `LayoutIR.nets`: nets are numbered in the order of their first edge. */
  readonly id: number;
  /** The net's edges, in document order. */
  readonly edges: readonly ElementKey[];
  /**
   * The union of the net's routes as maximal axis-parallel segments, so a
   * shared trunk appears once. Horizontal segments first (by y, then x),
   * then vertical (by x, then y); each from its smaller end.
   */
  readonly segments: readonly (readonly [Point, Point])[];
}

export interface EdgeLayout {
  readonly key: ElementKey;
  readonly kind: "edge";
  readonly from: ElementKey;
  readonly to: ElementKey;
  /** Where the edge must leave the source; omitted lets the router choose. */
  readonly fromAnchor?: Anchor;
  /** Where the edge must enter the target; omitted lets the router choose. */
  readonly toAnchor?: Anchor;
  /** The label measured but not placed (the router places it); omitted when the edge has none. */
  readonly labelMetrics?: TextMetrics;
  /** Omitted until the edges are routed. */
  readonly route?: EdgeRoute;
}

export interface LayoutIR {
  /** What produced the geometry, e.g. `sumi-structured` (recorded as the SVG metadata's backend). */
  readonly engine: string;
  /** The canvas: `[0, width] × [0, height]`, whole units. */
  readonly canvas: { readonly width: number; readonly height: number };
  /** Space kept between the content and each canvas side (at least), in units. */
  readonly margin: number;
  /** Bounding box of every node, group and label; once routed (#90), of the routes and edge labels too. */
  readonly content: Rect;
  /** Groups, parents before their children (pre-order of the group tree, each level in document order). */
  readonly groups: readonly GroupLayout[];
  /** Nodes in document order. */
  readonly nodes: readonly NodeLayout[];
  /** Edges in document order. */
  readonly edges: readonly EdgeLayout[];
  /** The edges' nets (#90), by `id`; omitted until the edges are routed. */
  readonly nets?: readonly RouteNet[];
}
