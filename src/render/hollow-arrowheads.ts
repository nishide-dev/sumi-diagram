/**
 * Hollow arrowheads in `auto` (#483). D2 draws an unfilled arrowhead
 * (`style.filled: false`) as a marker whose shape is filled with its canvas
 * color (`fill="#FFFFFF"`, class `fill-N7`) to hide the end of the line
 * under it. On a transparent background (#479) or on a theme whose canvas is
 * not white, that fill is a visible patch. `composeHollowArrowheads()`
 * points each such end at a copy of its marker whose shapes have no fill,
 * and stops the line where it leaves the head instead, so on the canvas the
 * figure looks as before while the head's interior shows what is behind it.
 *
 * Marker geometry: with `orient="auto"` the marker's x axis runs along the
 * path's direction at that end and its (`refX`, `refY`) sits on the path's
 * end; one marker unit is `min(markerWidth / viewBox width, markerHeight /
 * viewBox height)` user units, times the stroke width for
 * `markerUnits="strokeWidth"` (SVG's default; D2 writes `userSpaceOnUse`).
 * The head's outline (polygon or circle, at its stroke's center) is mapped
 * into user space that way, and the line is cut where it leaves it, walking
 * in from the end: the back of a triangle or box, the back vertex of a
 * diamond, the near side of a circle. D2's `.connection` has round caps, so
 * the cut moves back by another half width and the cap ends on the outline.
 * The copy's reference point moves to the line's new end (and its
 * orientation is fixed to the original direction when the new end turns
 * differently, as on a curve), so the head stays exactly where it was.
 * Heads that meet or overlap leave no line between them: the path keeps its
 * route to place them but gets no stroke. A `cross` only loses its fill
 * (its arms are thinner than their stroke; the line runs through it).
 */

import type { EdgeIR, FigureIR } from "../compiler/ir";
import type { Arrowhead } from "../core/registry/manifest";
import type { Result } from "../core/result";
import { outlineDiagnostic } from "./compose";
import { type PathSegment, type Point, parsePath } from "./geometry";
import { decodeElementClass } from "./inspect";
import {
  attribute,
  childElements,
  classList,
  descendants,
  escapeAttribute,
  parseXml,
  type XmlElement,
} from "./xml";

/** Heads whose interior D2 fills with the canvas and the line runs into. */
const HOLLOW_SHAPES: ReadonlySet<Arrowhead> = new Set(["triangle", "diamond", "circle", "box"]);
/** Heads with a canvas fill but no interior to speak of: the fill is removed, the line kept. */
const THIN_SHAPES: ReadonlySet<Arrowhead> = new Set(["cross"]);

/** Samples per segment when looking for where the line leaves a head. */
const SAMPLES = 64;

const fmt = (n: number) => String(Number(n.toFixed(3)));

interface Edit {
  start: number;
  end: number;
  text: string;
}

/** `true` if the edge's end is one D2 draws as a canvas-filled marker. */
const hollowHead = (edge: EdgeIR, head: Arrowhead | undefined): boolean =>
  !edge.style.filled && head !== undefined && (HOLLOW_SHAPES.has(head) || THIN_SHAPES.has(head));

/**
 * Removes the canvas fill of D2's unfilled arrowheads and stops their lines
 * at the heads (see the module comment). Figures without unfilled
 * arrowheads are returned as they are.
 */
export function composeHollowArrowheads(svg: string, ir: FigureIR): Result<string> {
  const hollow = ir.edges.filter(
    (e) => hollowHead(e, e.sourceArrowhead) || hollowHead(e, e.targetArrowhead),
  );
  if (hollow.length === 0) return { ok: true, value: svg, diagnostics: [] };
  let current = (hollow[0] as EdgeIR).key;
  try {
    const parsed = parseXml(svg);
    if (!parsed.ok) throw new Error(parsed.message);
    const groups = new Map<string, XmlElement>();
    const markers = new Map<string, XmlElement>();
    for (const element of descendants(parsed.root)) {
      if (element.name === "marker") {
        const id = attribute(element, "id");
        if (id !== undefined && !markers.has(id)) markers.set(id, element);
      }
      if (element.name !== "g") continue;
      for (const name of classList(element)) {
        const key = decodeElementClass(name);
        if (key) groups.set(key, element);
      }
    }
    const edits: Edit[] = [];
    /** Marker copies already written: copy id by the original's id and the changes. */
    const copies = new Map<string, string>();
    const copy = (marker: XmlElement, id: string, changes: MarkerChanges): string => {
      const key = `${id}|${changes.refX ?? ""}|${changes.refY ?? ""}|${changes.orient ?? ""}`;
      const existing = copies.get(key);
      if (existing !== undefined) return existing;
      const count = [...copies.keys()].filter((k) => k.startsWith(`${id}|`)).length;
      const copyId = `${id}-hollow${count === 0 ? "" : `-${count + 1}`}`;
      copies.set(key, copyId);
      // Before the original: D2 writes the path right after its marker.
      edits.push({
        start: marker.start,
        end: marker.start,
        text: unfilledMarker(svg.slice(marker.start, marker.end), copyId, changes),
      });
      return copyId;
    };
    for (const edge of hollow) {
      current = edge.key;
      const group = groups.get(edge.key);
      const path =
        group &&
        childElements(group).find((c) => c.name === "path" && classList(c).includes("connection"));
      if (!path) throw new Error(`${edge.key}: missing edge path.`);
      const d = attribute(path, "d");
      const route = d === undefined ? undefined : parsePath(d);
      if (!route?.ok || route.segments.length < 2)
        throw new Error(`${edge.key}: unreadable edge path.`);
      const original = route.segments;
      if (original.slice(1).some((s) => s.command === "M"))
        throw new Error(`${edge.key}: the edge path has several subpaths.`);
      const width = strokeWidth(path);
      // D2's stylesheet gives `.connection` round caps.
      const cap = paintValue(path, "stroke-linecap") ?? "round";
      const capReach = cap === "butt" ? 0 : width / 2;
      const ends = (
        [
          ["start", edge.sourceArrowhead],
          ["end", edge.targetArrowhead],
        ] as const
      ).flatMap(([end, head]) => {
        if (!hollowHead(edge, head)) return [];
        const id = /^url\(#(.+)\)$/.exec(attribute(path, `marker-${end}`) ?? "")?.[1];
        const marker = id === undefined ? undefined : markers.get(id);
        if (id === undefined || marker === undefined)
          throw new Error(`${edge.key}: missing ${end} arrowhead marker.`);
        const frame = HOLLOW_SHAPES.has(head as Arrowhead)
          ? headFrame(marker, original, end, width)
          : undefined;
        return [{ end, id, marker, frame }];
      });
      let segments: PathSegment[] = original;
      let hidden = false;
      let startCut = 0;
      for (const { end, frame } of ends) {
        if (frame === undefined) continue;
        const cut = cutPath(segments, end, (p) => frame.inside(frame.toMarker(p)), capReach);
        if (cut === undefined) {
          // The heads meet or overlap: no line shows between them.
          hidden = true;
          break;
        }
        if (end === "start") startCut = pathLength(segments) - pathLength(cut);
        segments = cut;
      }
      let tag = svg.slice(path.start, path.startTagEnd);
      for (const { end, id, marker, frame } of ends) {
        const changes: MarkerChanges = {};
        const point = ((end === "start" ? segments[0] : segments.at(-1)) as PathSegment).to;
        if (!hidden && frame !== undefined) {
          // The head stays where it was: its reference point moves to the line's new end.
          const ref = frame.toMarker(point);
          if (Math.abs(ref.x - frame.refX) > 1e-6) changes.refX = fmt(ref.x);
          if (Math.abs(ref.y - frame.refY) > 1e-6) changes.refY = fmt(ref.y);
          // A line cut on a curve or an earlier segment turns differently there.
          const after = tangent(segments, end);
          const before = tangent(original, end);
          if (changes.refY !== undefined || before.x * after.x + before.y * after.y < 1 - 1e-9)
            changes.orient = fmt((Math.atan2(frame.axis.y, frame.axis.x) * 180) / Math.PI);
        }
        const copyId = copy(marker, id, changes);
        tag = setAttribute(tag, `marker-${end}`, `url(#${copyId})`);
      }
      if (hidden) {
        // The path still places the heads; its line is not drawn.
        tag = setAttribute(tag, "stroke", "none");
      } else if (segments !== original) {
        tag = setAttribute(tag, "d", pathText(segments));
        // A dash pattern starts at the path's start: keep its phase where the line was cut.
        if (startCut > 0 && dashed(path)) tag = withDashOffset(tag, path, startCut);
      }
      edits.push({ start: path.start, end: path.startTagEnd, text: tag });
    }
    let out = svg;
    for (const edit of edits.sort((a, b) => b.start - a.start)) {
      out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
    }
    return { ok: true, value: out, diagnostics: [] };
  } catch (cause) {
    return {
      ok: false,
      diagnostics: [
        outlineDiagnostic(
          ir,
          current,
          "svg/unsupported-geometry",
          "error",
          cause instanceof Error ? cause.message : String(cause),
        ),
      ],
    };
  }
}

/** Attributes a marker copy changes besides its id (numbers already formatted). */
interface MarkerChanges {
  refX?: string;
  refY?: string;
  orient?: string;
}

/** Sets (or adds) an attribute in an element's start tag. */
function setAttribute(tag: string, name: string, value: string): string {
  const pattern = new RegExp(`(\\s${name}\\s*=\\s*)(?:"[^"]*"|'[^']*')`);
  const text = escapeAttribute(value);
  return pattern.test(tag)
    ? tag.replace(pattern, (_, prefix: string) => `${prefix}"${text}"`)
    : tag.replace(/(\s*\/?>)$/, ` ${name}="${text}"$1`);
}

/**
 * A copy of a marker (its source text) with the id `id`, the given
 * attributes and no fill on any shape.
 */
export function unfilledMarker(text: string, id: string, changes: MarkerChanges = {}): string {
  const open = text.indexOf(">") + 1;
  let head = setAttribute(text.slice(0, open), "id", id);
  for (const name of ["refX", "refY", "orient"] as const) {
    const value = changes[name];
    if (value !== undefined) head = setAttribute(head, name, value);
  }
  const body = text
    .slice(open)
    .replace(/(\sfill\s*=\s*)(?:"[^"]*"|'[^']*')/g, (_, prefix: string) => `${prefix}"none"`)
    // D2's `fill-N7` (and any other fill class) would paint the canvas color over the attribute.
    .replace(/(\sclass\s*=\s*)("[^"]*"|'[^']*')/g, (_, prefix: string, value: string) => {
      const kept = value
        .slice(1, -1)
        .split(/\s+/)
        .filter((c) => c !== "" && !/^fill-/.test(c));
      return `${prefix}"${escapeAttribute(kept.join(" "))}"`;
    });
  return head + body;
}

/** A paint property of an element, from its `style` (which wins) or its attribute. */
function paintValue(element: XmlElement, name: string): string | undefined {
  const style = attribute(element, "style") ?? "";
  const match = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`).exec(style);
  return match?.[1]?.trim() ?? attribute(element, name)?.trim();
}

function strokeWidth(element: XmlElement): number {
  const value = Number.parseFloat(paintValue(element, "stroke-width") ?? "1");
  return Number.isFinite(value) ? value : 1;
}

function dashed(element: XmlElement): boolean {
  const value = paintValue(element, "stroke-dasharray");
  return value !== undefined && value !== "none";
}

/** Adds `by` to the path's dash offset (in its `style`, which D2 writes). */
function withDashOffset(tag: string, path: XmlElement, by: number): string {
  const offset = Number.parseFloat(paintValue(path, "stroke-dashoffset") ?? "0") + by;
  const style = (attribute(path, "style") ?? "")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s !== "" && !s.startsWith("stroke-dashoffset"));
  style.push(`stroke-dashoffset:${fmt(offset)}`);
  const cleared = tag.replace(/\sstroke-dashoffset\s*=\s*(?:"[^"]*"|'[^']*')/, "");
  return setAttribute(cleared, "style", `${style.join(";")};`);
}

const number = (element: XmlElement, name: string, fallback?: number): number => {
  const raw = attribute(element, name);
  const value = raw === undefined ? fallback : Number.parseFloat(raw);
  if (value === undefined || !Number.isFinite(value))
    throw new Error(`The arrowhead marker lacks a numeric ${name}.`);
  return value;
};

/** A head placed at one end of a path, in the marker's coordinates. */
export interface HeadFrame {
  refX: number;
  refY: number;
  /** The marker's x axis in user space (unit length). */
  axis: Point;
  /** User space → marker coordinates. */
  toMarker(p: Point): Point;
  /** `true` inside the head's outline (at its stroke's center), in marker coordinates. */
  inside(p: Point): boolean;
}

/**
 * The marker of a path's `end` placed as a renderer places it (see the
 * module comment): its frame and its outline.
 */
export function headFrame(
  marker: XmlElement,
  segments: readonly PathSegment[],
  end: "start" | "end",
  width: number,
): HeadFrame {
  const orient = attribute(marker, "orient") ?? "0";
  if (orient !== "auto") throw new Error(`Unsupported arrowhead marker orient "${orient}".`);
  const refX = number(marker, "refX", 0);
  const refY = number(marker, "refY", 0);
  const markerWidth = number(marker, "markerWidth", 3);
  const markerHeight = number(marker, "markerHeight", 3);
  const box = (attribute(marker, "viewBox") ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const [, , vbWidth, vbHeight] = box;
  // preserveAspectRatio's default (meet) scales both axes by the smaller factor.
  const viewScale =
    box.length === 4 && box.every(Number.isFinite) && vbWidth && vbHeight
      ? Math.min(markerWidth / vbWidth, markerHeight / vbHeight)
      : 1;
  const unitScale =
    (attribute(marker, "markerUnits") ?? "strokeWidth") === "strokeWidth" ? width : 1;
  const scale = viewScale * unitScale;
  const shapes: ((p: Point) => boolean)[] = [];
  for (const shape of descendants(marker)) {
    if (shape === marker) continue;
    if (attribute(shape, "transform") !== undefined)
      throw new Error(`Unsupported transformed <${shape.name}> in an arrowhead marker.`);
    if (shape.name === "polygon") {
      const values = (attribute(shape, "points") ?? "")
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      if (values.length < 6 || values.length % 2 !== 0 || values.some((v) => !Number.isFinite(v)))
        throw new Error("Unreadable polygon in an arrowhead marker.");
      const vertices: Point[] = [];
      for (let i = 0; i < values.length; i += 2)
        vertices.push({ x: values[i] as number, y: values[i + 1] as number });
      shapes.push((p) => insidePolygon(vertices, p));
    } else if (shape.name === "circle") {
      const cx = number(shape, "cx", 0);
      const cy = number(shape, "cy", 0);
      const r = number(shape, "r");
      shapes.push((p) => Math.hypot(p.x - cx, p.y - cy) <= r);
    } else {
      throw new Error(`Unsupported <${shape.name}> in a hollow arrowhead marker.`);
    }
  }
  const t = tangent(segments, end);
  // `orient="auto"`: the path's direction at that end (out of the path at its end).
  const axis = end === "start" ? t : { x: -t.x, y: -t.y };
  const origin = ((end === "start" ? segments[0] : segments.at(-1)) as PathSegment).to;
  return {
    refX,
    refY,
    axis,
    toMarker: (p) => {
      const v = { x: p.x - origin.x, y: p.y - origin.y };
      return {
        x: refX + (v.x * axis.x + v.y * axis.y) / scale,
        y: refY + (-v.x * axis.y + v.y * axis.x) / scale,
      };
    },
    inside: (p) => shapes.some((s) => s(p)),
  };
}

/** Even-odd point in polygon; a point on the outline counts as inside. */
function insidePolygon(vertices: readonly Point[], p: Point): boolean {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const a = vertices[i] as Point;
    const b = vertices[j] as Point;
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    const within =
      p.x >= Math.min(a.x, b.x) - 1e-9 &&
      p.x <= Math.max(a.x, b.x) + 1e-9 &&
      p.y >= Math.min(a.y, b.y) - 1e-9 &&
      p.y <= Math.max(a.y, b.y) + 1e-9;
    if (within && Math.abs(cross) <= 1e-9 * Math.hypot(b.x - a.x, b.y - a.y)) return true;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}

const lerp = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

/** A segment as a cubic from its start (a line has its control points on it). */
interface Cubic {
  p0: Point;
  p1: Point;
  p2: Point;
  p3: Point;
}

const cubicAt = (forward: readonly PathSegment[], i: number): Cubic => {
  const from = (forward[i - 1] as PathSegment).to;
  const s = forward[i] as PathSegment;
  return s.command === "C"
    ? { p0: from, p1: s.c1, p2: s.c2, p3: s.to }
    : { p0: from, p1: lerp(from, s.to, 1 / 3), p2: lerp(from, s.to, 2 / 3), p3: s.to };
};

const at = (c: Cubic, t: number): Point => {
  const a = lerp(c.p0, c.p1, t);
  const b = lerp(c.p1, c.p2, t);
  const e = lerp(c.p2, c.p3, t);
  return lerp(lerp(a, b, t), lerp(b, e, t), t);
};

/** The path from parameter `t` of its segment `i` on (de Casteljau). */
function from(forward: readonly PathSegment[], i: number, t: number): PathSegment[] {
  const c = cubicAt(forward, i);
  const a = lerp(c.p0, c.p1, t);
  const b = lerp(c.p1, c.p2, t);
  const e = lerp(c.p2, c.p3, t);
  const ab = lerp(a, b, t);
  const be = lerp(b, e, t);
  const start = lerp(ab, be, t);
  const s = forward[i] as PathSegment;
  return [
    { command: "M", to: start },
    s.command === "C" ? { command: "C", c1: be, c2: e, to: c.p3 } : { command: "L", to: c.p3 },
    ...forward.slice(i + 1),
  ];
}

/**
 * Cuts the path at its `end` where it leaves the head (`inside`, in user
 * space; sampled, then bisected), then `backoff` further along it. The path
 * as it is if its end is not inside the head; `undefined` if it never
 * leaves it.
 */
export function cutPath(
  segments: readonly PathSegment[],
  end: "start" | "end",
  inside: (p: Point) => boolean,
  backoff = 0,
): PathSegment[] | undefined {
  const forward = end === "start" ? [...segments] : reversePath(segments);
  if (!inside((forward[0] as PathSegment).to)) return [...segments];
  let cut: PathSegment[] | undefined;
  search: for (let i = 1; i < forward.length; i++) {
    const c = cubicAt(forward, i);
    for (let k = 1; k <= SAMPLES; k++) {
      if (inside(at(c, k / SAMPLES))) continue;
      let lo = (k - 1) / SAMPLES;
      let hi = k / SAMPLES;
      for (let n = 0; n < 40; n++) {
        const mid = (lo + hi) / 2;
        if (inside(at(c, mid))) lo = mid;
        else hi = mid;
      }
      cut = from(forward, i, hi);
      break search;
    }
  }
  if (cut === undefined) return undefined;
  if (backoff > 0) {
    const past = measureTo(cut, backoff);
    if (past === undefined) return undefined;
    cut = from(cut, past.i, past.t);
  }
  return end === "start" ? cut : reversePath(cut);
}

/** The parameter at arc length `length` from the path's start (by chords of the samples). */
function measureTo(
  forward: readonly PathSegment[],
  length: number,
): { i: number; t: number } | undefined {
  let walked = 0;
  for (let i = 1; i < forward.length; i++) {
    const c = cubicAt(forward, i);
    let previous = c.p0;
    for (let k = 1; k <= SAMPLES; k++) {
      const p = at(c, k / SAMPLES);
      const step = Math.hypot(p.x - previous.x, p.y - previous.y);
      if (walked + step >= length) {
        return { i, t: (k - 1 + (step === 0 ? 1 : (length - walked) / step)) / SAMPLES };
      }
      walked += step;
      previous = p;
    }
  }
  return undefined;
}

/** The same path drawn from its end (one subpath of M / L / C). */
function reversePath(segments: readonly PathSegment[]): PathSegment[] {
  const out: PathSegment[] = [{ command: "M", to: (segments.at(-1) as PathSegment).to }];
  for (let i = segments.length - 1; i >= 1; i--) {
    const s = segments[i] as PathSegment;
    const to = (segments[i - 1] as PathSegment).to;
    out.push(s.command === "C" ? { command: "C", c1: s.c2, c2: s.c1, to } : { command: "L", to });
  }
  return out;
}

/** The unit direction from a path's `end` into the path. */
function tangent(segments: readonly PathSegment[], end: "start" | "end"): Point {
  const forward = end === "start" ? segments : reversePath(segments);
  for (let i = 1; i < forward.length; i++) {
    const c = cubicAt(forward, i);
    for (const p of [c.p1, c.p2, c.p3]) {
      const length = Math.hypot(p.x - c.p0.x, p.y - c.p0.y);
      if (length > 1e-9) return { x: (p.x - c.p0.x) / length, y: (p.y - c.p0.y) / length };
    }
  }
  throw new Error("The edge path has no length.");
}

/** A path's length (by chords of the samples). */
function pathLength(segments: readonly PathSegment[]): number {
  let total = 0;
  for (let i = 1; i < segments.length; i++) {
    const c = cubicAt(segments, i);
    let previous = c.p0;
    for (let k = 1; k <= SAMPLES; k++) {
      const p = at(c, k / SAMPLES);
      total += Math.hypot(p.x - previous.x, p.y - previous.y);
      previous = p;
    }
  }
  return total;
}

const pathText = (segments: readonly PathSegment[]) =>
  segments
    .map((s) =>
      s.command === "C"
        ? `C ${fmt(s.c1.x)} ${fmt(s.c1.y)} ${fmt(s.c2.x)} ${fmt(s.c2.y)} ${fmt(s.to.x)} ${fmt(s.to.y)}`
        : `${s.command} ${fmt(s.to.x)} ${fmt(s.to.y)}`,
    )
    .join(" ");
