/**
 * The structured SVG writer (#91, design doc §6.23): draws a structured
 * figure from its Layout IR (geometry, #89 / #90) and Figure IR (components,
 * styles, arrowheads, marks, font set), joined by `ElementKey`.
 *
 * The output follows the inspect contract D2's SVG follows (§6.3), so
 * `finalizeStructuredSvg()`, `inspectSvg()`, the geometry lint, the PDF and
 * both PPTX exports read it like D2's:
 *
 * - a root `<svg>` with the canvas as viewBox, holding one `svg.d2-svg`
 *   (same viewBox, no transform anywhere);
 * - one `<g class="sumi-k-… sumi-kind-…">` per element (ElementKey encoded with
 *   `:` → `--` and `#` → `_`), groups (pre-order), then nodes, then edges;
 * - a node / group draws its shape in one `g.shape` whose bounding box is the
 *   layout's `rect`, and its label as a `<text>` with `text-anchor: middle` at
 *   the layout's anchor, later lines as `<tspan dy>` of `lineHeightUnits`
 *   (no `xml:space`: the layout measured collapsed whitespace);
 * - an edge has one `path.connection` with its whole route (M/L) for the
 *   inspection, and draws its arrowheads and label.
 *
 * Lines are drawn per net (#90): the edges of one net with the same line
 * style are stroked as one path of maximal segments (`path.sumi-wire`, before
 * the edges), so a shared trunk is stroked once (a dashed or translucent
 * trunk would otherwise show doubled dashes or alpha). Edges of a net with
 * different line styles are stroked per style, so a segment two styles share
 * is drawn in both, the later edge on top. The `path.connection` therefore
 * carries the route and line width / dashes but no `stroke` (SVG's initial
 * value, `none`). At an arrowhead the wire stops at the arrowhead's base.
 * The wires' turns, and the joins at a junction drawn without a dot, are
 * rounded (`wire.ts`, #101); the `path.connection` keeps the sharp route.
 *
 * Icons and images (#94) are drawn by `assetMarkup()` right after the node's
 * `g.shape`: an icon as shapes under one transformed `g.sumi-icon` (never a
 * nested `<svg>`), an image as one `image.sumi-image` with a `data:` URI.
 *
 * Fonts: the `@font-face` of every font class the labels use is a TrueType
 * subset of the font set's file for it (`font-subset.ts`), with the
 * per-figure family name `sumi-<n>-font-<class>`, which the PDF / PPTX font
 * resolution maps back to the font set like D2's `d2-<n>-font-<class>`.
 *
 * The output is a pure function of the two IRs and the font files: numbers
 * are written with at most 6 decimals, and no maps are iterated except in
 * insertion order.
 */

import { assetMarkup } from "../assets/draw";
import type { FigureAssets } from "../assets/load";
import type { EdgeIR, FigureIR, GroupIR, NodeIR } from "../compiler/ir";
import type { ElementKey } from "../core/check-state";
import { isSpaceRun } from "../core/label/runs";
import type { Arrowhead } from "../core/registry/manifest";
import type { FontSet } from "../core/theme/fonts";
import type { CommonStyle } from "../core/theme/style";
import type { LayoutIR, Point, Rect, TextLayout, TextRun } from "../layout/ir";
import { arrowheadLength, WIRE_CORNER_RADIUS } from "../layout/route/router";
import { fontFileFor } from "../lint/geometry/measure";
import { CYLINDER_ARC_UNITS, shapeOutline } from "../lint/geometry/shapes";
import { drawNodeOutline } from "./compose";
import { subsetFont } from "./font-subset";
import { dashArray, n, paint, strokeAttributes } from "./stroke";
import { type Arc, isHiddenJunction, roundCorners, type WirePolyline } from "./wire";
import { escapeAttribute } from "./xml";

export { dashArray };

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
// biome-ignore lint/suspicious/noControlCharactersInRegex: characters XML 1.0 cannot carry
const NOT_XML = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g;
/** Escapes label text for element content; characters XML cannot hold become U+FFFD (as in D2). */
const text = (value: string): string =>
  value.replace(NOT_XML, "�").replace(/[&<>]/g, (c) => ESCAPES[c] as string);
const attr = (value: string): string => escapeAttribute(value.replace(NOT_XML, "�"));

/** `sumi-k-<key>`: the ElementKey with `:` → `--` and `#` → `_` (design doc §2.4, as in D2 output). */
const elementClass = (key: ElementKey): string =>
  `sumi-k-${key.replace(":", "--").replace("#", "_")}`;

const opacity = (style: CommonStyle): string =>
  style.opacity < 1 ? ` opacity="${n(style.opacity)}"` : "";

/** The `text*` class of a font class (`regular` → `text`, `bold` → `text-bold`), as D2 names them. */
const textClass = (font: string): string => (font === "regular" ? "text" : `text-${font}`);

/**
 * A turned label's `transform` (#178): `rotate(±90 cx cy)` about the center
 * of its box, the one form `inspectSvg()` reads on a `<text>`. Empty for
 * upright text, so its bytes do not change.
 */
function rotate(layout: TextLayout): string {
  if (layout.rotation === undefined) return "";
  const { box } = layout;
  return ` transform="rotate(${layout.rotation} ${n(box.x + box.width / 2)} ${n(box.y + box.height / 2)})"`;
}

function label(layout: TextLayout, color: string): string {
  const { anchor, lines } = layout;
  if (layout.runs !== undefined) return richLabel(layout, layout.runs, color);
  const open = `<text x="${n(anchor.x)}" y="${n(anchor.y)}" fill="${paint(color)}" class="${textClass(layout.font)}" style="text-anchor:middle;font-size:${n(layout.fontSizeUnits)}px"${rotate(layout)}>`;
  if (lines.length === 1) return `${open}${text(lines[0] as string)}</text>`;
  const spans = lines.map(
    (line, i) =>
      `<tspan x="${n(anchor.x)}" dy="${i === 0 ? "0" : n(layout.lineHeightUnits)}">${text(line)}</tspan>`,
  );
  return `${open}${spans.join("")}</text>`;
}

/**
 * A label with runs (#93): every line is a `<tspan x y>` (also a single
 * one) at its absolute baseline, holding its runs in order. A run in the
 * label's font, size and baseline is plain text; others are a `<tspan>` with
 * the font class, the `font-size` and a `dy` from the previous run's
 * baseline. Absolute line baselines keep later lines in place when a line is
 * blank (renderers do not move the pen for an empty `<tspan>`) or ends in a
 * script. `font-kerning: none`: the layout measures advance widths without
 * kerning (STIX Two has kerning; BIZ UD has none).
 */
function richLabel(
  layout: TextLayout,
  runs: readonly (readonly TextRun[])[],
  color: string,
): string {
  const { anchor } = layout;
  const open = `<text x="${n(anchor.x)}" y="${n(anchor.y)}" fill="${paint(color)}" class="${textClass(layout.font)}" style="text-anchor:middle;font-size:${n(layout.fontSizeUnits)}px;font-kerning:none"${rotate(layout)}>`;
  const spans = runs.map((line, i) => {
    const y = n(anchor.y + i * layout.lineHeightUnits);
    if (!line.some((run) => run.accent !== undefined)) {
      return `<tspan x="${n(anchor.x)}" y="${y}">${runContent(layout, line)}</tspan>`;
    }
    const width = line.reduce((sum, run) => sum + run.width, 0);
    return accentChunks(line, anchor.x - width / 2)
      .map(
        (chunk) =>
          `<tspan x="${n(chunk.start + chunk.width / 2)}" y="${y}">${runContent(layout, chunk.runs)}</tspan>`,
      )
      .join("");
  });
  return `${open}${spans.join("")}</text>`;
}

/**
 * The runs of a line (or chunk) as text and `<tspan>`s: plain text for a run
 * in the label's font, size and baseline, otherwise a `<tspan>` with the
 * font class, `font-size` and a `dy` from the previous run's baseline.
 */
function runContent(layout: TextLayout, runs: readonly ChunkRun[]): string {
  let pen = 0; // the current baseline offset from the line's baseline
  const attributes = runs.map((run) => {
    const value =
      (run.font === layout.font ? "" : ` class="${textClass(run.font)}"`) +
      (run.fontSizeUnits === layout.fontSizeUnits
        ? ""
        : ` style="font-size:${n(run.fontSizeUnits)}px"`) +
      (run.shiftUnits === pen ? "" : ` dy="${n(run.shiftUnits - pen)}"`);
    pen = run.shiftUnits;
    return value;
  });
  return runs
    .map((run, i) => {
      const own = attributes[i] as string;
      if (own !== "") return `<tspan${own}>${text(run.text)}</tspan>`;
      // usvg (the PDF and picture PPTX engine) drops the leading space of a
      // <tspan> right after a text node (#172: `入力` then a Latin run
      // ` Embedding`); a bare <tspan> around the text node keeps it.
      const next = runs[i + 1];
      return next !== undefined && attributes[i + 1] !== "" && next.text.startsWith(" ")
        ? `<tspan>${text(run.text)}</tspan>`
        : text(run.text);
    })
    .join("");
}

/** A run as a chunk draws it: an accent's mark is a run of its own. */
type ChunkRun = Pick<TextRun, "text" | "font" | "fontSizeUnits" | "shiftUnits" | "width">;

interface Chunk {
  /** Where the chunk's pen starts (units). */
  start: number;
  width: number;
  runs: ChunkRun[];
}

/**
 * A line with math accents (#129, design doc §6.29) as absolutely positioned
 * text chunks (`<tspan x y>`, each centered on its own x: `text-anchor`
 * applies per chunk). An accented base ends its chunk; the mark is a chunk
 * of its own at the position the layout chose, followed by the spaces after
 * it (`labelRuns()` splits them off), so that no chunk starts with a space:
 * usvg drops a chunk's leading space, browsers do not. The text after them
 * is the next chunk, where the base's advance ends.
 */
export function accentChunks(line: readonly TextRun[], lineStart: number): Chunk[] {
  const chunks: Chunk[] = [];
  let x = lineStart;
  let open: Chunk | undefined;
  let afterAccent = false; // `open` is an accent's chunk
  for (const run of line) {
    if (afterAccent && !isSpaceRun(run)) {
      open = undefined;
      afterAccent = false;
    }
    if (open === undefined) {
      open = { start: x, width: 0, runs: [] };
      chunks.push(open);
    }
    open.runs.push(run);
    open.width += run.width;
    x += run.width;
    if (run.accent !== undefined) {
      const { char, dxUnits, shiftUnits, width } = run.accent;
      const mark: ChunkRun = { ...run, text: char, shiftUnits, width };
      open = { start: x - run.width + dxUnits, width, runs: [mark] };
      chunks.push(open);
      afterAccent = true;
    }
  }
  return chunks;
}

const polygon = (points: readonly Point[], paintAttributes: string): string =>
  `<polygon points="${points.map((p) => `${n(p.x)},${n(p.y)}`).join(" ")}"${paintAttributes}/>`;

const pathData = (points: readonly Point[], closed = false): string =>
  points.map((p, i) => `${i === 0 ? "M" : "L"} ${n(p.x)} ${n(p.y)}`).join(" ") +
  (closed ? " Z" : "");

/** D2 v0.9.0's document shape: where its wavy bottom edge meets the sides, as a fraction of the height. */
const DOCUMENT_EDGE = 0.8586;

/** The drawing elements of a node's shape, whose bounding box is exactly `r`. */
function nodeShape(node: NodeIR, r: Rect): string {
  const { style } = node;
  const paints = ` fill="${paint(style.fill)}"${strokeAttributes(style)}`;
  const { x, y, width: w, height: h } = r;
  if (node.mark?.type === "point") {
    // A junction (#92): a dot in the line color, no outline, as big as its rect.
    return `<circle cx="${n(x + w / 2)}" cy="${n(y + h / 2)}" r="${n(w / 2)}" fill="${paint(style.fill)}" stroke="none"/>`;
  }
  if (node.render !== undefined) {
    const drawing = drawNodeOutline(node, r);
    return drawing.layers
      .map((layer) => {
        const fill = layer.role === "line" ? "none" : paint(style.fill);
        return `<path d="${pathData(layer.path.points, layer.path.closed)}" fill="${fill}"${strokeAttributes(style)}/>`;
      })
      .join("");
  }
  switch (node.shape) {
    case "text":
      // An icon on a label node (#94): an invisible box, so the inspection
      // and the geometry lint see where the icon is drawn.
      return node.icon === undefined
        ? ""
        : `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="none" stroke="none"/>`;
    case "rectangle":
    case "square": {
      const radius = Math.min(style.radius.units, w / 2, h / 2);
      const rx = radius > 0 ? ` rx="${n(radius)}"` : "";
      return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"${rx}${paints}/>`;
    }
    case "circle":
    case "oval":
      return w === h
        ? `<circle cx="${n(x + w / 2)}" cy="${n(y + h / 2)}" r="${n(w / 2)}"${paints}/>`
        : `<ellipse cx="${n(x + w / 2)}" cy="${n(y + h / 2)}" rx="${n(w / 2)}" ry="${n(h / 2)}"${paints}/>`;
    case "diamond":
    case "hexagon":
    case "parallelogram": {
      const outline = shapeOutline(node.shape, r);
      if (outline.kind !== "polygon") throw new Error("internal error: polygon shape expected");
      return polygon(outline.points, paints);
    }
    case "cylinder": {
      // D2 v0.9.0's cylinder: elliptical caps `arc` deep, curve handles 5% of the width from the middle.
      const arc = Math.min(CYLINDER_ARC_UNITS, h / 3);
      const cx = x + w / 2;
      const k = w * 0.05;
      const body =
        `M ${n(x)} ${n(y + arc)} C ${n(x)} ${n(y)} ${n(cx - k)} ${n(y)} ${n(cx)} ${n(y)} ` +
        `C ${n(cx + k)} ${n(y)} ${n(x + w)} ${n(y)} ${n(x + w)} ${n(y + arc)} V ${n(y + h - arc)} ` +
        `C ${n(x + w)} ${n(y + h)} ${n(cx + k)} ${n(y + h)} ${n(cx)} ${n(y + h)} ` +
        `C ${n(cx - k)} ${n(y + h)} ${n(x)} ${n(y + h)} ${n(x)} ${n(y + h - arc)} V ${n(y + arc)} Z`;
      const rim =
        `M ${n(x)} ${n(y + arc)} C ${n(x)} ${n(y + 2 * arc)} ${n(cx - k)} ${n(y + 2 * arc)} ${n(cx)} ${n(y + 2 * arc)} ` +
        `C ${n(cx + k)} ${n(y + 2 * arc)} ${n(x + w)} ${n(y + 2 * arc)} ${n(x + w)} ${n(y + arc)}`;
      return `<path d="${body}"${paints}/><path d="${rim}"${paints}/>`;
    }
    case "document": {
      // A cubic from `edge` to `edge` with both handles at `edge + 4k` reaches
      // `edge + 3k`: with `edge = bottom - 3k` (k on the 6-decimal grid), the
      // trough is exactly the box's bottom, so the bbox is exactly `r`.
      const k = Number(((h * (1 - DOCUMENT_EDGE)) / 3).toFixed(6));
      const bottom = y + h;
      const edge = bottom - 3 * k;
      const at = (fx: number, py: number) => `${n(x + fx * w)} ${n(py)}`;
      const d =
        `M ${at(0, edge)} L ${at(0, y)} L ${at(1, y)} L ${at(1, edge)} ` +
        `C ${at(5 / 6, edge - 4 * k)} ${at(4 / 6, edge - 4 * k)} ${at(0.5, edge)} ` +
        `C ${at(2 / 6, edge + 4 * k)} ${at(1 / 6, edge + 4 * k)} ${at(0, edge)} Z`;
      return `<path d="${d}"${paints}/>`;
    }
    case "page": {
      const fold = Math.min(16, w / 4, h / 4);
      const outline = [
        { x, y },
        { x: x + w - fold, y },
        { x: x + w, y: y + fold },
        { x: x + w, y: y + h },
        { x, y: y + h },
      ];
      const crease = [
        { x: x + w - fold, y },
        { x: x + w - fold, y: y + fold },
        { x: x + w, y: y + fold },
      ];
      return `<path d="${pathData(outline, true)}"${paints}/><path d="${pathData(crease)}" fill="none"${strokeAttributes(style)}/>`;
    }
  }
}

function objectGroup(
  element: NodeIR | GroupIR,
  shape: string,
  layout: TextLayout | undefined,
  asset = "",
): string {
  const labelSvg = layout === undefined ? "" : label(layout, element.style.fontColor);
  return `<g class="${elementClass(element.key)} sumi-kind-${element.kind}"${opacity(element.style)}><g class="shape">${shape}</g>${asset}${labelSvg}</g>`;
}

const unit = (from: Point, to: Point): Point => {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  return length === 0
    ? { x: 0, y: 0 }
    : { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
};

/** How far an arrowhead's base is from its tip: where the line stops. */
function arrowheadInset(head: Arrowhead, length: number): number {
  switch (head) {
    case "none":
    case "cross":
      return 0;
    case "arrow":
      return length * 0.6;
    default:
      return length;
  }
}

/**
 * An arrowhead at `tip`, pointing along `u`, no longer than
 * `arrowheadLength()` (the room the router keeps for it). A hollow one
 * (`filled: false`) is painted inside with the color beneath its center,
 * half its length behind the tip (#192, `backgroundAt()` over `groups`), so
 * it hides the lines it covers without showing white on a filled group.
 */
export function drawArrowhead(
  head: Arrowhead,
  tip: Point,
  u: Point,
  edge: EdgeIR,
  groups: readonly PaintedGroup[] = [],
): string {
  if (head === "none") return "";
  const { style } = edge;
  const length = arrowheadLength(style.strokeWidth.units);
  const at = (along: number, across: number): Point => ({
    x: tip.x - u.x * along - u.y * across,
    y: tip.y - u.y * along + u.x * across,
  });
  const color = paint(style.stroke);
  const fill = style.filled ? color : backgroundAt(at(length / 2, 0), groups);
  const outline = style.filled
    ? ` fill="${fill}" stroke="none"`
    : ` fill="${fill}" stroke="${color}" stroke-width="${n(style.strokeWidth.units)}" stroke-linejoin="miter"`;
  const half = length / 2;
  switch (head) {
    case "triangle":
      return polygon([tip, at(length, half), at(length, -half)], outline);
    case "arrow":
      return polygon([tip, at(length, half), at(length * 0.6, 0), at(length, -half)], outline);
    case "diamond":
      return polygon([tip, at(half, half * 0.8), at(length, 0), at(half, -half * 0.8)], outline);
    case "box":
      return polygon(
        [at(0, half * 0.8), at(length, half * 0.8), at(length, -half * 0.8), at(0, -half * 0.8)],
        outline,
      );
    case "circle": {
      const c = at(half, 0);
      return `<circle cx="${n(c.x)}" cy="${n(c.y)}" r="${n(half)}"${outline}/>`;
    }
    case "cross": {
      const arm = half * 0.7;
      return `<path d="${pathData([at(half - arm, arm), at(half + arm, -arm)])} ${pathData([at(half - arm, -arm), at(half + arm, arm)])}" fill="none" stroke="${color}" stroke-width="${n(style.strokeWidth.units)}"/>`;
    }
  }
}

/** Removes `amount` units from the end of a polyline (keeps at least its first point). */
function trimEnd(points: readonly Point[], amount: number): Point[] {
  const out = [...points];
  let left = amount;
  while (left > 0 && out.length >= 2) {
    const last = out[out.length - 1] as Point;
    const prev = out[out.length - 2] as Point;
    const length = Math.hypot(last.x - prev.x, last.y - prev.y);
    if (length > left) {
      const t = (length - left) / length;
      out[out.length - 1] = {
        x: prev.x + (last.x - prev.x) * t,
        y: prev.y + (last.y - prev.y) * t,
      };
      return out;
    }
    out.pop();
    left -= length;
  }
  return out;
}

/**
 * How much of the wire's end runs under the arrowhead `head` (from its base
 * to its back): a rounded corner must not reach it (#116).
 */
function underArrowhead(head: Arrowhead, edge: EdgeIR): number {
  if (head === "none") return 0;
  const length = arrowheadLength(edge.style.strokeWidth.units);
  return length - arrowheadInset(head, length);
}

/** The part of an edge's route its wire strokes: the route minus the arrowheads' insets. */
function wirePoints(edge: EdgeIR, points: readonly Point[]): Point[] {
  const length = arrowheadLength(edge.style.strokeWidth.units);
  const head = arrowheadInset(edge.targetArrowhead ?? "none", length);
  const tail = arrowheadInset(edge.sourceArrowhead ?? "none", length);
  const trimmed = trimEnd(points, head);
  return trimEnd(trimmed.reverse(), tail).reverse();
}

type Segment = readonly [Point, Point];

/**
 * Merges segments into maximal axis-parallel ones (overlapping or touching
 * collinear segments join): horizontal by y then x, vertical by x then y,
 * then any others as given. Zero-length segments are dropped.
 */
export function mergeSegments(segments: readonly Segment[]): Segment[] {
  const horizontal = new Map<number, [number, number][]>();
  const vertical = new Map<number, [number, number][]>();
  const others: Segment[] = [];
  for (const [a, b] of segments) {
    if (a.x === b.x && a.y === b.y) continue;
    if (a.y === b.y) {
      const list = horizontal.get(a.y) ?? [];
      list.push([Math.min(a.x, b.x), Math.max(a.x, b.x)]);
      horizontal.set(a.y, list);
    } else if (a.x === b.x) {
      const list = vertical.get(a.x) ?? [];
      list.push([Math.min(a.y, b.y), Math.max(a.y, b.y)]);
      vertical.set(a.x, list);
    } else others.push([a, b]);
  }
  const merged = (
    lines: Map<number, [number, number][]>,
    toSegment: (c: number, a: number, b: number) => Segment,
  ) =>
    [...lines.keys()]
      .sort((p, q) => p - q)
      .flatMap((coordinate) => {
        const intervals = (lines.get(coordinate) ?? []).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
        const out: [number, number][] = [];
        for (const [start, end] of intervals) {
          const last = out[out.length - 1];
          if (last !== undefined && start <= last[1]) last[1] = Math.max(last[1], end);
          else out.push([start, end]);
        }
        return out.map(([start, end]) => toSegment(coordinate, start, end));
      });
  return [
    ...merged(horizontal, (y, a, b) => [
      { x: a, y },
      { x: b, y },
    ]),
    ...merged(vertical, (x, a, b) => [
      { x, y: a },
      { x, y: b },
    ]),
    ...others,
  ];
}

/** The line style that decides which edges of a net share a wire. */
const lineKey = (style: EdgeIR["style"]): string =>
  `${paint(style.stroke)}|${style.strokeWidth.units}|${style.strokeDash}|${style.opacity}`;

/** The largest corner radius of a wire (#101); defined by the router, which keeps room for it (#116). */
export { WIRE_CORNER_RADIUS };

/** A point as SVG path coordinates. */
const xy = (p: Point): string => `${n(p.x)} ${n(p.y)}`;

/**
 * Wires: per net and line style, the union of the edges' wire segments (see
 * the module comment), with rounded turns (`wire.ts`, #101): each turn of a
 * route, and the joins at a hidden junction (`isHiddenJunction()`) whose
 * edges all share one line style and reach its center.
 */
/** What the wires paint for one edge (#156): its straight pieces and arcs, after rounding and trimming. */
export interface PaintedEdge {
  readonly pieces: readonly (readonly [Point, Point])[];
  readonly arcs: readonly Arc[];
}

/**
 * What the wires paint for each edge (#156): the same rounding and trimming
 * as the writer, with each piece and arc kept with the edge it was cut from
 * (a hidden junction's arcs go to the edge that enters it, as in
 * `roundCorners()`). The geometry lint measures edges on this.
 */
export function paintedEdges(ir: FigureIR, layout: LayoutIR): Map<ElementKey, PaintedEdge> {
  return wires(ir, layout).painted;
}

function wires(
  ir: FigureIR,
  layout: LayoutIR,
): { markup: string[]; painted: Map<ElementKey, PaintedEdge> } {
  const edges = new Map(ir.edges.map((e) => [e.key, e]));
  const nodes = new Map(ir.nodes.map((node) => [node.key, node]));
  const routes = new Map(layout.edges.map((e) => [e.key, e]));
  const nets = layout.nets ?? layout.edges.map((e, id) => ({ id, edges: [e.key], segments: [] }));
  const hidden = (key: ElementKey): boolean => {
    const node = nodes.get(key);
    return node !== undefined && isHiddenJunction(node);
  };
  // What every arc keeps clear of: shapes and labels (not hidden junctions).
  const fixed: Rect[] = [
    ...layout.nodes.filter((node) => !hidden(node.key)).map((node) => node.rect),
    ...layout.groups.flatMap((group) => (group.label === undefined ? [] : [group.label.box])),
    ...layout.edges.flatMap((edge) =>
      edge.route?.label === undefined ? [] : [edge.route.label.box],
    ),
  ];
  const segmentRect = ([a, b]: readonly [Point, Point]): Rect => ({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  });
  const out: string[] = [];
  const painted = new Map<ElementKey, { pieces: [Point, Point][]; arcs: Arc[] }>();
  for (const net of nets) {
    const obstacles = [
      ...fixed,
      ...nets
        .filter((other) => other.id !== net.id)
        .flatMap((other) => other.segments.map(segmentRect)),
    ];
    const drawn: {
      key: ElementKey;
      edge: EdgeIR;
      route: (typeof layout.edges)[number];
      wire: Point[];
    }[] = [];
    for (const key of net.edges) {
      const edge = edges.get(key);
      const route = routes.get(key);
      const points = route?.route?.points;
      if (edge === undefined || route === undefined || points === undefined) continue;
      drawn.push({ key, edge, route, wire: wirePoints(edge, points) });
    }
    // A hidden junction joins its routes when they all reach its center in one line style.
    const joined = new Set<ElementKey>();
    for (const { route } of drawn) {
      for (const junction of [route.from, route.to]) {
        if (!hidden(junction) || joined.has(junction)) continue;
        const touching = drawn.filter((d) => d.route.from === junction || d.route.to === junction);
        const center = (d: (typeof drawn)[number]) =>
          d.route.from === junction ? d.wire[0] : d.wire[d.wire.length - 1];
        const reaches = (d: (typeof drawn)[number]) => {
          const at = center(d);
          const end =
            d.route.from === junction ? d.route.route?.points[0] : d.route.route?.points.at(-1);
          return (
            d.wire.length >= 2 &&
            at !== undefined &&
            end !== undefined &&
            at.x === end.x &&
            at.y === end.y
          );
        };
        const key0 = touching[0] === undefined ? "" : lineKey(touching[0].edge.style);
        if (touching.every((d) => reaches(d) && lineKey(d.edge.style) === key0))
          joined.add(junction);
      }
    }
    const byStyle = new Map<
      string,
      { edge: EdgeIR; polylines: WirePolyline[]; keys: ElementKey[] }
    >();
    for (const { key, edge, route, wire } of drawn) {
      const entry = byStyle.get(lineKey(edge.style)) ?? { edge, polylines: [], keys: [] };
      entry.keys.push(key);
      const keepStart = underArrowhead(edge.sourceArrowhead ?? "none", edge);
      const keepEnd = underArrowhead(edge.targetArrowhead ?? "none", edge);
      entry.polylines.push({
        points: wire,
        ...(joined.has(route.from) ? { start: route.from } : {}),
        ...(joined.has(route.to) ? { end: route.to } : {}),
        ...(keepStart > 0 && { keepStart }),
        ...(keepEnd > 0 && { keepEnd }),
      });
      byStyle.set(lineKey(edge.style), entry);
    }
    for (const { edge, polylines, keys } of byStyle.values()) {
      const width = edge.style.strokeWidth.units;
      const rounded = roundCorners(polylines, {
        radius: WIRE_CORNER_RADIUS,
        minRadius: width,
        clearance: width,
        obstacles,
      });
      for (const [i, key] of keys.entries()) {
        const own = painted.get(key) ?? { pieces: [], arcs: [] };
        own.pieces.push(...(rounded.pieces[i] ?? []).map(([a, b]): [Point, Point] => [a, b]));
        own.arcs.push(...(rounded.arcs[i] ?? []));
        painted.set(key, own);
      }
      const merged = mergeSegments(rounded.pieces.flat());
      const seen = new Set<string>();
      const curves: string[] = [];
      for (const a of rounded.arcs.flat()) {
        const d = `M ${xy(a.from)} C ${xy(a.c1)} ${xy(a.c2)} ${xy(a.to)}`;
        if (seen.has(d)) continue;
        seen.add(d);
        curves.push(d);
      }
      if (merged.length === 0 && curves.length === 0) continue;
      const d = [...merged.map(([a, b]) => pathData([a, b])), ...curves].join(" ");
      out.push(
        `<path class="sumi-wire" d="${d}" fill="none"${strokeAttributes(edge.style)} stroke-linecap="round" stroke-linejoin="round"${opacity(edge.style)}/>`,
      );
    }
  }
  return { markup: out, painted };
}

/** The canvas the structured writer paints under everything (its first `<rect>`). */
export const CANVAS_FILL = "#ffffff";

/** A group as painted under an edge label or arrowhead: its rectangle and paint, in drawing order. */
export interface PaintedGroup {
  readonly rect: Rect;
  readonly fill: string;
  readonly opacity: number;
}

function hexChannels(color: string): number[] | undefined {
  const long = color.replace(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i, "#$1$1$2$2$3$3");
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(long);
  return m === null ? undefined : [m[1], m[2], m[3]].map((c) => Number.parseInt(c as string, 16));
}

/** `top` at `alpha` over the opaque `bottom`, as `#rrggbb` (`top` itself at full opacity). */
function over(top: string, alpha: number, bottom: string): string {
  if (alpha >= 1) return top;
  const a = hexChannels(top);
  const b = hexChannels(bottom);
  if (a === undefined || b === undefined) return top;
  const mixed = a.map((c, i) => Math.round(c * alpha + (b[i] as number) * (1 - alpha)));
  return `#${mixed.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The color painted beneath an edge label (#170, design doc §6.41): the
 * color beneath the label box's center (`backgroundAt()`).
 */
export function labelBackground(box: Rect, groups: readonly PaintedGroup[]): string {
  return backgroundAt({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, groups);
}

/**
 * The color painted beneath `point` (#170, #192, design doc §6.41): the
 * groups whose rectangle holds it (borders included), painted in drawing
 * order (outer first) over the canvas. A `transparent` or fully translucent
 * group lets the color beneath it through; a translucent one is blended
 * over it, and of overlapping siblings the later is on top. For nested,
 * opaque groups this is the first painted background from the innermost
 * group outward, else the canvas. Never `transparent`, since the
 * background is there to hide what runs under a label or a hollow
 * arrowhead. Something across a group border takes the color under the
 * point it is sampled at (its center). Nodes are not looked at: labels are
 * placed off node boxes, and one left on a node is reported by
 * `geometry/label-collision`; an arrowhead lies outside the node it points at.
 */
export function backgroundAt({ x: cx, y: cy }: Point, groups: readonly PaintedGroup[]): string {
  let color = CANVAS_FILL;
  for (const { rect, fill, opacity } of groups) {
    if (fill === "transparent" || opacity <= 0) continue;
    if (cx < rect.x || cx > rect.x + rect.width || cy < rect.y || cy > rect.y + rect.height)
      continue;
    color = over(fill, opacity, color);
  }
  return color;
}

function edgeGroup(
  edge: EdgeIR,
  points: readonly Point[],
  layoutLabel: TextLayout | undefined,
  groups: readonly PaintedGroup[],
): string {
  const { style } = edge;
  const width = style.strokeWidth.units;
  const dash = dashArray(width, style.strokeDash);
  const connection = `<path class="connection" d="${pathData(points)}" fill="none" stroke-width="${n(width)}"${dash === undefined ? "" : ` stroke-dasharray="${n(dash[0])},${n(dash[1])}"`}/>`;
  const first = points[0] as Point;
  const last = points[points.length - 1] as Point;
  const heads =
    drawArrowhead(
      edge.targetArrowhead ?? "none",
      last,
      unit(points[points.length - 2] as Point, last),
      edge,
      groups,
    ) +
    drawArrowhead(
      edge.sourceArrowhead ?? "none",
      first,
      unit(points[1] as Point, first),
      edge,
      groups,
    );
  let labelSvg = "";
  if (layoutLabel !== undefined) {
    // The label's background, 1 unit around its line box: the router keeps
    // the box 3 units off the line, so the line stays visible. The edge's
    // `fill` turns it on (#31; `transparent`: none); its color is what is
    // painted beneath the label (#170, `labelBackground()`).
    const { box } = layoutLabel;
    const background =
      style.fill === "transparent"
        ? ""
        : `<rect x="${n(box.x - 1)}" y="${n(box.y - 1)}" width="${n(box.width + 2)}" height="${n(box.height + 2)}" fill="${labelBackground(box, groups)}"/>`;
    labelSvg = background + label(layoutLabel, style.fontColor);
  }
  return `<g class="${elementClass(edge.key)} sumi-kind-edge"${opacity(style)}>${connection}${heads}${labelSvg}</g>`;
}

/** FNV-1a (32 bit) of a string, as a decimal: the per-figure id of class and font names. */
function figureHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return String(hash);
}

const STATIC_CSS = `.shape {
  shape-rendering: geometricPrecision;
  stroke-linejoin: round;
}
.connection {
  stroke-linecap: round;
  stroke-linejoin: round;
}`;

/**
 * Writes the SVG of a structured figure (see the module comment): `ir` and
 * its routed `layout`, labels embedded in subsets of `fonts`. Throws if the
 * two IRs do not belong together, or (`FontParseError` / `Error`) if a font
 * cannot be read or subset.
 */
export function writeStructuredSvg(
  ir: FigureIR,
  layout: LayoutIR,
  fonts: FontSet,
  assets?: FigureAssets,
): string {
  const groups = new Map(ir.groups.map((g) => [g.key, g]));
  const nodes = new Map(ir.nodes.map((n) => [n.key, n]));
  const edges = new Map(ir.edges.map((e) => [e.key, e]));
  const body: string[] = [];
  const used = new Map<string, string>();
  const useText = (t: TextLayout | undefined) => {
    if (t === undefined) return;
    // The label's own font class is on its <text> even when every character
    // is in a math run, so it always gets an @font-face (maybe of .notdef only).
    used.set(t.font, used.get(t.font) ?? "");
    const runs = t.runs?.flat() ?? [{ font: t.font, text: t.lines.join("") }];
    for (const run of runs) {
      const accent = "accent" in run ? (run.accent?.char ?? "") : "";
      used.set(run.font, (used.get(run.font) ?? "") + run.text + accent);
    }
  };
  const painted: PaintedGroup[] = [];
  for (const g of layout.groups) {
    const group = groups.get(g.key);
    if (group === undefined)
      throw new Error(`internal error: ${g.key} is not a group of the figure`);
    painted.push({ rect: g.rect, fill: group.style.fill, opacity: group.style.opacity });
    const shape = nodeShape({ ...asNode(group), shape: "rectangle" }, g.rect);
    body.push(objectGroup(group, shape, g.label));
    useText(g.label);
  }
  for (const placed of layout.nodes) {
    const node = nodes.get(placed.key);
    if (node === undefined)
      throw new Error(`internal error: ${placed.key} is not a node of the figure`);
    const asset = assetMarkup(node, assets?.nodes.get(node.key), placed.rect);
    body.push(objectGroup(node, nodeShape(node, placed.rect), placed.label, asset));
    useText(placed.label);
  }
  body.push(...wires(ir, layout).markup);
  for (const placed of layout.edges) {
    const edge = edges.get(placed.key);
    const points = placed.route?.points;
    if (edge === undefined || points === undefined || points.length < 2) {
      throw new Error(`internal error: edge ${placed.key} is unknown or not routed`);
    }
    body.push(edgeGroup(edge, points, placed.route?.label, painted));
    useText(placed.route?.label);
  }
  const drawing = body.join("");
  const id = `sumi-${figureHash(drawing)}`;
  const css = [...used.entries()].map(([font, chars]) => {
    const family = `${id}-font-${font}`;
    const subset = Buffer.from(subsetFont(fontFileFor(font, fonts), chars)).toString("base64");
    return `.${id} .${textClass(font)} {\n\tfont-family: "${family}";\n}\n@font-face {\n\tfont-family: ${family};\n\tsrc: url("data:font/ttf;base64,${subset}");\n}`;
  });
  const { width, height } = layout.canvas;
  const viewBox = `0 0 ${width} ${height}`;
  const style = `<style type="text/css"><![CDATA[\n${[...css, STATIC_CSS].join("\n")}\n]]></style>`;
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    `<svg xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMinYMin meet" viewBox="${viewBox}">` +
    `<svg class="${attr(id)} d2-svg" width="${width}" height="${height}" viewBox="${viewBox}">` +
    `<rect x="0" y="0" width="${width}" height="${height}" fill="${CANVAS_FILL}"/>` +
    style +
    drawing +
    "</svg></svg>"
  );
}

/** A group drawn like a rectangle node (same paint, radius and dashes). */
function asNode(group: GroupIR): NodeIR {
  return {
    ...group,
    kind: "node",
    shape: "rectangle",
    sizing: "auto",
    style: { ...group.style, kind: "node" },
  };
}
