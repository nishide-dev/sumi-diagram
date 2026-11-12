/**
 * The colors a figure finally paints (#440). The fills of the groups, the
 * sets (and the overlaps between them) and the nodes are stacked in drawing
 * order, each over what lies beneath it, the way the renderers composite them.
 * Sampling the points where an item is the topmost fill gives the color a
 * viewer sees there ({@link analyze}), to compare with the same fill painted on
 * white. The input of `geometry/muddy-color`, `geometry/translucent-over-color`
 * and `geometry/color-on-panel`.
 */

import type { DiagnosticSubject, DocPath } from "../../core/diagnostics";
import { getTheme } from "../../core/theme/builtin";
import { multiplyTints } from "../../core/theme/set-style";
import { setOverlaps } from "../../layout/set-overlap";
import type { Point, Rect } from "../../render/geometry";
import type { GeometryContext, GeometryElement, GeometrySet } from "./context";
import { depthInside, type Region, rectPolygon } from "./shapes";

/** One painted fill. */
export interface PaintItem {
  readonly kind: "group" | "node" | "set" | "overlap";
  /** `node "a" fill`, `the overlap of set "a" and set "b"`, for messages. */
  readonly name: string;
  /** `#rrggbb`. */
  readonly color: string;
  /** 1 is opaque. */
  readonly alpha: number;
  /** The color the author chose before it was mixed into white: a set's line color (its tint is the pale mix). */
  readonly ink: string;
  readonly region: Region;
  readonly bbox: Rect;
  readonly docPath: DocPath;
  readonly subject: DiagnosticSubject;
  /** For an overlap, the colors of the sets it lies in. */
  readonly of?: readonly string[];
}

const HEX = /^#[0-9a-f]{6}$/i;
const WHITE = "#ffffff";

function normalized(color: string | undefined): string | undefined {
  if (color === undefined) return undefined;
  const long = color.replace(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i, "#$1$1$2$2$3$3").toLowerCase();
  return HEX.test(long) ? long : undefined;
}

const channels = (hex: string): number[] =>
  [1, 3, 5].map((o) => Number.parseInt(hex.slice(o, o + 2), 16));

/** `top` at `alpha` over `bottom`, as `#rrggbb`. */
export function over(top: string, alpha: number, bottom: string): string {
  if (alpha >= 1) return top;
  const a = channels(top);
  const b = channels(bottom);
  return `#${a
    .map((c, i) => Math.round(c * alpha + (b[i] as number) * (1 - alpha)))
    .map((c) => c.toString(16).padStart(2, "0"))
    .join("")}`;
}

/** A convex region as a polygon (an ellipse sampled in 96 steps). */
function polygonOf(region: Region): Point[] {
  if (region.kind === "polygon") return [...region.points];
  return Array.from({ length: 96 }, (_, i) => {
    const a = (i / 96) * 2 * Math.PI;
    return { x: region.cx + region.rx * Math.cos(a), y: region.cy + region.ry * Math.sin(a) };
  });
}

function boundsOf(polygon: readonly Point[]): Rect {
  const xs = polygon.map((p) => p.x);
  const ys = polygon.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export interface PaintOptions {
  /**
   * Paint a set the way figures did before #440: its line color at `strength`
   * opacity, stacking where sets overlap. The renderers no longer do; this is
   * for judging such a figure and for calibrating the rules on one.
   */
  readonly translucentSets?: boolean;
}

/** What the renderers paint, in drawing order: groups, sets with their overlaps, then nodes. */
export function paintItems(context: GeometryContext, options: PaintOptions = {}): PaintItem[] {
  const items: PaintItem[] = [];
  const ofKind = (kind: "group" | "node"): GeometryElement[] =>
    context.elements.filter((e) => e.kind === kind && e.bbox !== undefined);
  const element = (e: GeometryElement, kind: "group" | "node"): PaintItem | undefined => {
    const color = normalized(e.ir.style.fill);
    if (color === undefined || e.bbox === undefined || e.ir.style.opacity <= 0) return undefined;
    return {
      kind,
      name: `${e.name} fill`,
      color,
      alpha: e.ir.style.opacity,
      ink: color,
      region: kind === "group" ? rectPolygon(e.bbox) : (e.outline ?? rectPolygon(e.bbox)),
      bbox: e.bbox,
      docPath: e.docPath,
      subject: e.subject,
    };
  };
  for (const e of ofKind("group")) {
    const item = element(e, "group");
    if (item !== undefined) items.push(item);
  }
  const polygons: (readonly Point[] | undefined)[] = [];
  const tinted: GeometrySet[] = [];
  for (const set of context.sets) {
    const { style } = set.ir;
    const ink = normalized(style.stroke === "transparent" ? style.fontColor : style.stroke);
    const color = options.translucentSets ? ink : normalized(style.fill);
    if (color === undefined || ink === undefined || style.strength <= 0) {
      polygons.push(undefined);
      continue;
    }
    polygons.push(options.translucentSets ? undefined : polygonOf(set.geometry.region));
    tinted.push(set);
    items.push({
      kind: "set",
      name: `${set.name} fill`,
      color,
      alpha: options.translucentSets ? style.strength : 1,
      ink,
      region: set.geometry.region,
      bbox: set.geometry.bbox,
      docPath: set.docPath,
      subject: set.subject,
    });
  }
  // The renderers paint an overlap in the product of its sets' (opaque) fills.
  for (const { members, polygon } of setOverlaps(polygons)) {
    const sets = members.map((m) => context.sets[m] as GeometrySet);
    const colors = sets.map((s) => normalized(s.ir.style.fill) ?? WHITE);
    const first = sets[0] as GeometrySet;
    items.push({
      kind: "overlap",
      name: `the overlap of ${sets.map((s) => s.name).join(" and ")}`,
      color: multiplyTints(colors, getTheme(context.ir.meta.themeId)?.canvas),
      alpha: 1,
      ink: multiplyTints(colors, getTheme(context.ir.meta.themeId)?.canvas),
      region: { kind: "polygon", points: polygon },
      bbox: boundsOf(polygon),
      docPath: first.docPath,
      subject: first.subject,
      of: colors,
    });
  }
  for (const e of ofKind("node")) {
    const item = element(e, "node");
    if (item !== undefined) items.push(item);
  }
  return items;
}

/** What a sample of an item shows. */
export interface Sample {
  readonly point: Point;
  /** The color painted at the point beneath the item. */
  readonly below: string;
  /** The color finally seen at the point (the item and any translucent fill over it). */
  readonly final: string;
  /** The items beneath the item at the point. */
  readonly under: readonly PaintItem[];
  /** The group fills alone beneath the item: the panel it sits on. */
  readonly panel: string;
}

export interface Analysis {
  readonly item: PaintItem;
  readonly canvas: string;
  readonly index: number;
  /** The item's color as it looks on white, the reference. */
  readonly onWhite: string;
  /** The points where the item shows (no opaque fill over it), with what lies beneath and the final color. */
  readonly samples: readonly Sample[];
}

/** Samples of an item are a grid this many points a side, at least `INSET` units inside its edge. */
const GRID = 4;
const INSET = 1;

const covers = (item: PaintItem, p: Point): boolean =>
  p.x >= item.bbox.x - 1e-6 &&
  p.x <= item.bbox.x + item.bbox.width + 1e-6 &&
  p.y >= item.bbox.y - 1e-6 &&
  p.y <= item.bbox.y + item.bbox.height + 1e-6 &&
  depthInside(item.region, p) >= 0;

/** Every item with the samples at which it shows. */
export function analyze(items: readonly PaintItem[], canvas = WHITE): Analysis[] {
  return items.map((item, index) => {
    const samples: Sample[] = [];
    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) {
        const point: Point = {
          x: item.bbox.x + ((i + 0.5) / GRID) * item.bbox.width,
          y: item.bbox.y + ((j + 0.5) / GRID) * item.bbox.height,
        };
        if (depthInside(item.region, point) < INSET) continue;
        // An opaque fill drawn later hides this one here; a translucent one lets it show.
        if (items.some((above, k) => k > index && above.alpha >= 1 && covers(above, point)))
          continue;
        const under = items.filter((below, k) => k < index && covers(below, point));
        let below = canvas;
        let panel = canvas;
        for (const u of under) {
          below = over(u.color, u.alpha, below);
          if (u.kind === "group") panel = over(u.color, u.alpha, panel);
        }
        let final = over(item.color, item.alpha, below);
        for (let k = index + 1; k < items.length; k++) {
          const above = items[k] as PaintItem;
          if (covers(above, point)) final = over(above.color, above.alpha, final);
        }
        samples.push({ point, below, final, under, panel });
      }
    }
    return { item, index, canvas, onWhite: over(item.color, item.alpha, canvas), samples };
  });
}

const cache = new WeakMap<GeometryContext, Analysis[]>();

/** The analysis of the figure's painted fills, once per context. */
export function analysisOf(context: GeometryContext): Analysis[] {
  let analysis = cache.get(context);
  if (analysis === undefined) {
    analysis = analyze(paintItems(context), getTheme(context.ir.meta.themeId)?.canvas ?? WHITE);
    cache.set(context, analysis);
  }
  return analysis;
}
