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
 *
 * Fonts: the `@font-face` of every font class the labels use is a TrueType
 * subset of the font set's file for it (`font-subset.ts`), with the
 * per-figure family name `sumi-<n>-font-<class>`, which the PDF / PPTX font
 * resolution maps back to the font set like D2's `d2-<n>-font-<class>`.
 *
 * The output is a pure function of the two IRs and the font files: numbers
 * are written with at most 3 decimals, and no maps are iterated except in
 * insertion order.
 */

import type { EdgeIR, FigureIR, GroupIR, NodeIR } from "../compiler/ir";
import type { ElementKey } from "../core/check-state";
import type { Arrowhead } from "../core/registry/manifest";
import type { FontSet } from "../core/theme/fonts";
import type { CommonStyle } from "../core/theme/style";
import type { LayoutIR, Point, Rect, TextLayout } from "../layout/ir";
import { arrowheadLength } from "../layout/route/router";
import { fontFileFor } from "../lint/geometry/measure";
import { CYLINDER_ARC_UNITS, shapeOutline } from "../lint/geometry/shapes";
import { drawNodeOutline } from "./compose";
import { subsetFont } from "./font-subset";
import { escapeAttribute } from "./xml";

/** Formats a coordinate: at most 3 decimals, no exponent for the sizes used, never `-0`. */
const n = (value: number): string => String(Number(value.toFixed(3)) || 0);

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

/** `transparent` is written as `none` (every SVG consumer reads it). */
const paint = (color: string): string => (color === "transparent" ? "none" : color);

/**
 * D2's dash pattern for a dash level (`style.stroke-dash`, 0–10) at a stroke
 * width, so dashed lines look the same with both engines.
 */
export function dashArray(strokeWidth: number, dash: number): [number, number] | undefined {
  if (dash <= 0 || strokeWidth <= 0) return undefined;
  const scale = Math.log10(-0.6 * strokeWidth + 10.6) * 0.5 + 0.5;
  const dashSize = strokeWidth * dash;
  return [dashSize, scale * dashSize];
}

/** Stroke attributes of a style (` stroke="…" stroke-width="…"` and dashes). */
function strokeAttributes(style: CommonStyle, color = paint(style.stroke)): string {
  const width = style.strokeWidth.units;
  const dash = dashArray(width, style.strokeDash);
  return (
    ` stroke="${color}" stroke-width="${n(width)}"` +
    (dash === undefined ? "" : ` stroke-dasharray="${n(dash[0])},${n(dash[1])}"`)
  );
}

const opacity = (style: CommonStyle): string =>
  style.opacity < 1 ? ` opacity="${n(style.opacity)}"` : "";

/** The `text*` class of a font class (`regular` → `text`, `bold` → `text-bold`), as D2 names them. */
const textClass = (font: string): string => (font === "regular" ? "text" : `text-${font}`);

function label(layout: TextLayout, color: string): string {
  const { anchor, lines } = layout;
  const open = `<text x="${n(anchor.x)}" y="${n(anchor.y)}" fill="${paint(color)}" class="${textClass(layout.font)}" style="text-anchor:middle;font-size:${n(layout.fontSizeUnits)}px">`;
  if (lines.length === 1) return `${open}${text(lines[0] as string)}</text>`;
  const spans = lines.map(
    (line, i) =>
      `<tspan x="${n(anchor.x)}" dy="${i === 0 ? "0" : n(layout.lineHeightUnits)}">${text(line)}</tspan>`,
  );
  return `${open}${spans.join("")}</text>`;
}

const polygon = (points: readonly Point[], paintAttributes: string): string =>
  `<polygon points="${points.map((p) => `${n(p.x)},${n(p.y)}`).join(" ")}"${paintAttributes}/>`;

const pathData = (points: readonly Point[], closed = false): string =>
  points.map((p, i) => `${i === 0 ? "M" : "L"} ${n(p.x)} ${n(p.y)}`).join(" ") +
  (closed ? " Z" : "");

/** D2 v0.9.0's document shape, in a unit box, with control points that make the wave's bottom the box's bottom. */
const DOCUMENT_EDGE = 0.8586;
const DOCUMENT_DIP = DOCUMENT_EDGE + (1 - DOCUMENT_EDGE) / 0.75;
const DOCUMENT_CREST = 2 * DOCUMENT_EDGE - DOCUMENT_DIP;

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
      return "";
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
      const at = (fx: number, fy: number) => `${n(x + fx * w)} ${n(y + fy * h)}`;
      const d =
        `M ${at(0, DOCUMENT_EDGE)} L ${at(0, 0)} L ${at(1, 0)} L ${at(1, DOCUMENT_EDGE)} ` +
        `C ${at(5 / 6, DOCUMENT_CREST)} ${at(4 / 6, DOCUMENT_CREST)} ${at(0.5, DOCUMENT_EDGE)} ` +
        `C ${at(2 / 6, DOCUMENT_DIP)} ${at(1 / 6, DOCUMENT_DIP)} ${at(0, DOCUMENT_EDGE)} Z`;
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
): string {
  const labelSvg = layout === undefined ? "" : label(layout, element.style.fontColor);
  return `<g class="${elementClass(element.key)} sumi-kind-${element.kind}"${opacity(element.style)}><g class="shape">${shape}</g>${labelSvg}</g>`;
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
 * `arrowheadLength()` (the room the router keeps for it).
 */
export function drawArrowhead(head: Arrowhead, tip: Point, u: Point, edge: EdgeIR): string {
  if (head === "none") return "";
  const { style } = edge;
  const length = arrowheadLength(style.strokeWidth.units);
  const at = (along: number, across: number): Point => ({
    x: tip.x - u.x * along - u.y * across,
    y: tip.y - u.y * along + u.x * across,
  });
  const color = paint(style.stroke);
  const fill = style.filled ? color : "#ffffff";
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

/** Wires: per net and line style, the union of the edges' wire segments (see the module comment). */
function wires(ir: FigureIR, layout: LayoutIR): string[] {
  const edges = new Map(ir.edges.map((e) => [e.key, e]));
  const routes = new Map(layout.edges.map((e) => [e.key, e.route?.points]));
  const nets = layout.nets ?? layout.edges.map((e, id) => ({ id, edges: [e.key], segments: [] }));
  const out: string[] = [];
  for (const net of nets) {
    const byStyle = new Map<string, { edge: EdgeIR; segments: Segment[] }>();
    for (const key of net.edges) {
      const edge = edges.get(key);
      const points = routes.get(key);
      if (edge === undefined || points === undefined) continue;
      const wire = wirePoints(edge, points);
      const entry = byStyle.get(lineKey(edge.style)) ?? { edge, segments: [] };
      for (let i = 1; i < wire.length; i++) {
        entry.segments.push([wire[i - 1] as Point, wire[i] as Point]);
      }
      byStyle.set(lineKey(edge.style), entry);
    }
    for (const { edge, segments } of byStyle.values()) {
      const merged = mergeSegments(segments);
      if (merged.length === 0) continue;
      const d = merged.map(([a, b]) => pathData([a, b])).join(" ");
      out.push(
        `<path class="sumi-wire" d="${d}" fill="none"${strokeAttributes(edge.style)} stroke-linecap="round" stroke-linejoin="round"${opacity(edge.style)}/>`,
      );
    }
  }
  return out;
}

function edgeGroup(edge: EdgeIR, points: readonly Point[], layoutLabel?: TextLayout): string {
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
    ) + drawArrowhead(edge.sourceArrowhead ?? "none", first, unit(points[1] as Point, first), edge);
  let labelSvg = "";
  if (layoutLabel !== undefined) {
    // The label's background (the edge's `fill`, #31), 1 unit around its line box:
    // the router keeps the box 3 units off the line, so the line stays visible.
    const { box } = layoutLabel;
    const background =
      style.fill === "transparent"
        ? ""
        : `<rect x="${n(box.x - 1)}" y="${n(box.y - 1)}" width="${n(box.width + 2)}" height="${n(box.height + 2)}" fill="${style.fill}"/>`;
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
export function writeStructuredSvg(ir: FigureIR, layout: LayoutIR, fonts: FontSet): string {
  const groups = new Map(ir.groups.map((g) => [g.key, g]));
  const nodes = new Map(ir.nodes.map((n) => [n.key, n]));
  const edges = new Map(ir.edges.map((e) => [e.key, e]));
  const body: string[] = [];
  const used = new Map<string, string>();
  const useText = (t: TextLayout | undefined) => {
    if (t !== undefined) used.set(t.font, (used.get(t.font) ?? "") + t.lines.join(""));
  };
  for (const g of layout.groups) {
    const group = groups.get(g.key);
    if (group === undefined)
      throw new Error(`internal error: ${g.key} is not a group of the figure`);
    const shape = nodeShape({ ...asNode(group), shape: "rectangle" }, g.rect);
    body.push(objectGroup(group, shape, g.label));
    useText(g.label);
  }
  for (const placed of layout.nodes) {
    const node = nodes.get(placed.key);
    if (node === undefined)
      throw new Error(`internal error: ${placed.key} is not a node of the figure`);
    body.push(objectGroup(node, nodeShape(node, placed.rect), placed.label));
    useText(placed.label);
  }
  body.push(...wires(ir, layout));
  for (const placed of layout.edges) {
    const edge = edges.get(placed.key);
    const points = placed.route?.points;
    if (edge === undefined || points === undefined || points.length < 2) {
      throw new Error(`internal error: edge ${placed.key} is unknown or not routed`);
    }
    body.push(edgeGroup(edge, points, placed.route?.label));
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
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>` +
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
