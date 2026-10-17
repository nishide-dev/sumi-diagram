/**
 * PoC for #18: SVG post-processing that turns placeholder rectangles into
 * custom outlines (approach (a) in docs/research/18-custom-svg-components.md).
 *
 * Input is a finalized Sumi SVG, its IR and its inspection. For every node
 * with a custom shape it
 * 1. replaces the children of the node's `g.shape` with the shape's layers,
 *    copying the paint attributes (fill, stroke, class, style, dash) from D2's
 *    placeholder `<rect>`, so the theme's resolved style is reused verbatim;
 * 2. optionally moves the label to the center of the shape's safe area;
 * 3. optionally moves edge endpoints along their last segment from the
 *    footprint to the custom outline (keeping D2's arrowhead offset).
 *
 * It relies only on the SVG contract of design doc §6 (`g.sumi-k-*`, `g.shape`,
 * `text`, `path.connection`) and edits the text by splicing start tags and
 * the shape's content; all other bytes stay D2's. Research code.
 */

import type { FigureIR } from "../../src/compiler/ir";
import type { ElementKey } from "../../src/core/check-state";
import { distanceToRect, type PathSegment, type Point, type Rect } from "../../src/render/geometry";
import { decodeElementClass, type SvgInspection } from "../../src/render/inspect";
import {
  attribute,
  childElements,
  classList,
  descendants,
  escapeAttribute,
  parseXml,
  type XmlElement,
} from "../../src/render/xml";
import { type CustomShape, rayHit, rectPolygon } from "./shapes";

export interface ComposeOptions {
  /** Replace the placeholder rectangles with the custom layers (off: only measure edge ends). */
  drawOutlines: boolean;
  /** Move labels to the center of the safe area (stack: the front layer). */
  moveLabels: boolean;
  /** Extend / trim edge endpoints to the custom outline. */
  clipEdges: boolean;
}

/** One edge end that touches a custom node. */
export interface EdgeEndReport {
  edge: string;
  end: "source" | "target";
  node: string;
  /**
   * Distance from the drawn end to the custom outline along the end segment
   * (units). D2 stops the line short of the shape for an arrowhead (4 units
   * for the default triangle at 1pt) or the stroke (2 units).
   */
  endToOutlineUnits?: number;
  /** The same distance to the footprint (placeholder rectangle). */
  endToFootprintUnits?: number;
  /** `endToOutline − endToFootprint`: how far the line stops short of the drawn outline. */
  gapUnits: number;
  /** The ray along the end segment misses the outline (endpoint left alone). */
  missed: boolean;
}

export interface ComposeResult {
  svg: string;
  edgeEnds: EdgeEndReport[];
}

interface Edit {
  start: number;
  end: number;
  text: string;
}

/** Endpoints this far (units) from a footprint belong to it; same as the #11 integration test. */
const ENDPOINT_SLACK = 12;

/** Deterministic number formatting: at most 3 decimals, no exponent. */
const fmt = (n: number): string => {
  const rounded = Math.round(n * 1000) / 1000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
};

const polygonPath = (points: readonly Point[]): string =>
  `${points.map((p, i) => `${i === 0 ? "M" : "L"} ${fmt(p.x)} ${fmt(p.y)}`).join(" ")} Z`;

function serializePath(segments: PathSegment[]): string {
  return segments
    .map((s) =>
      s.command === "C"
        ? `C ${fmt(s.c1.x)} ${fmt(s.c1.y)} ${fmt(s.c2.x)} ${fmt(s.c2.y)} ${fmt(s.to.x)} ${fmt(s.to.y)}`
        : `${s.command} ${fmt(s.to.x)} ${fmt(s.to.y)}`,
    )
    .join(" ");
}

/** Replaces (or fails to find) one attribute in a start tag's source text. */
function setAttribute(tag: string, name: string, value: string): string {
  const pattern = new RegExp(`(\\s${name}=")[^"]*(")`);
  if (!pattern.test(tag)) throw new Error(`<${tag.slice(1, 20)}…> has no ${name} attribute`);
  return tag.replace(pattern, `$1${escapeAttribute(value)}$2`);
}

const PLACEHOLDER_GEOMETRY = new Set(["x", "y", "width", "height", "rx", "ry"]);

export function composeCustomShapes(
  svg: string,
  ir: FigureIR,
  inspection: SvgInspection,
  shapes: ReadonlyMap<ElementKey, CustomShape>,
  options: ComposeOptions,
): ComposeResult {
  const parsed = parseXml(svg);
  if (!parsed.ok) throw new Error(`not XML: ${parsed.message}`);
  const groups = new Map<ElementKey, XmlElement>();
  for (const element of descendants(parsed.root)) {
    if (element.name !== "g") continue;
    for (const c of classList(element)) {
      const key = decodeElementClass(c);
      if (key !== undefined) groups.set(key, element);
    }
  }
  const geometry = new Map(inspection.elements.map((e) => [e.key, e]));
  const edits: Edit[] = [];
  const startTag = (e: XmlElement) => svg.slice(e.start, e.startTagEnd);
  const editStartTag = (e: XmlElement, change: (tag: string) => string) =>
    edits.push({ start: e.start, end: e.startTagEnd, text: change(startTag(e)) });

  // 1–2. Outlines and labels.
  const drawings = new Map<ElementKey, { bbox: Rect; outline: readonly Point[] }>();
  for (const [key, shape] of shapes) {
    const g = groups.get(key);
    const bbox = geometry.get(key)?.bbox;
    if (g === undefined || bbox === undefined) throw new Error(`${key}: not in the SVG`);
    const drawing = shape.draw(bbox);
    drawings.set(key, { bbox, outline: drawing.outline });
    if (!options.drawOutlines) continue;
    const shapeGroup = childElements(g).find((c) => classList(c).includes("shape"));
    const placeholder = shapeGroup && childElements(shapeGroup)[0];
    if (shapeGroup === undefined || placeholder?.name !== "rect") {
      throw new Error(`${key}: expected g.shape > rect (the placeholder)`);
    }
    const paint = placeholder.attributes
      .filter((a) => !PLACEHOLDER_GEOMETRY.has(a.name))
      .map((a) => ` ${a.name}="${escapeAttribute(a.value)}"`)
      .join("");
    edits.push({
      start: shapeGroup.startTagEnd,
      end: shapeGroup.end - "</g>".length,
      text: drawing.layers.map((layer) => `<path d="${polygonPath(layer)}"${paint} />`).join(""),
    });

    if (!options.moveLabels) continue;
    const dx = drawing.safeArea.x + drawing.safeArea.width / 2 - (bbox.x + bbox.width / 2);
    const dy = drawing.safeArea.y + drawing.safeArea.height / 2 - (bbox.y + bbox.height / 2);
    if (dx === 0 && dy === 0) continue;
    for (const text of childElements(g).filter((c) => c.name === "text")) {
      const x = Number(attribute(text, "x")) + dx;
      const y = Number(attribute(text, "y")) + dy;
      editStartTag(text, (tag) => setAttribute(setAttribute(tag, "x", fmt(x)), "y", fmt(y)));
      for (const tspan of childElements(text).filter((c) => c.name === "tspan")) {
        if (attribute(tspan, "x") === undefined) continue;
        editStartTag(tspan, (tag) => setAttribute(tag, "x", fmt(x)));
      }
    }
  }

  // 3. Edge endpoints.
  const edgeEnds: EdgeEndReport[] = [];
  for (const edge of ir.edges) {
    const segments = geometry.get(edge.key)?.path;
    const g = groups.get(edge.key);
    const pathElement =
      g && childElements(g).find((c) => c.name === "path" && classList(c).includes("connection"));
    if (segments === undefined || pathElement === undefined || segments.length < 2) continue;
    const route = segments.map((s) => ({ ...s })) as PathSegment[];
    let changed = false;

    for (const end of ["source", "target"] as const) {
      const index = end === "source" ? 0 : route.length - 1;
      const segment = route[index] as PathSegment;
      const point = segment.to;
      // The neighbour that fixes the direction of the end segment.
      const neighbour =
        end === "source"
          ? (() => {
              const next = route[1] as PathSegment;
              return next.command === "C" ? next.c1 : next.to;
            })()
          : segment.command === "C"
            ? segment.c2
            : (route[index - 1] as PathSegment).to;
      const length = Math.hypot(point.x - neighbour.x, point.y - neighbour.y);
      if (length === 0) continue;
      const direction = {
        x: (point.x - neighbour.x) / length,
        y: (point.y - neighbour.y) / length,
      };

      // The custom node at this end: the nearer of the two endpoints' footprints.
      const candidates = [edge.from, edge.to]
        .map((key) => ({ key, drawing: drawings.get(key) }))
        .filter((c) => c.drawing !== undefined)
        .map((c) => ({ ...c, distance: distanceToRect(c.drawing?.bbox as Rect, point) }))
        .filter((c) => c.distance <= ENDPOINT_SLACK)
        .sort((a, b) => a.distance - b.distance);
      const hit = candidates[0];
      if (hit?.drawing === undefined) continue;

      const toFootprint = rayHit(rectPolygon(hit.drawing.bbox), point, direction);
      const toOutline = rayHit(hit.drawing.outline, point, direction);
      const report: EdgeEndReport = {
        edge: edge.id ?? `edges[${edge.index}]`,
        end,
        node: hit.key,
        gapUnits: 0,
        missed: toOutline === undefined,
      };
      edgeEnds.push(report);
      const round = (n: number) => Math.round(n * 1000) / 1000;
      if (toOutline !== undefined) report.endToOutlineUnits = round(toOutline);
      if (toFootprint !== undefined) report.endToFootprintUnits = round(toFootprint);
      if (toFootprint === undefined || toOutline === undefined) continue;
      report.gapUnits = Math.round((toOutline - toFootprint) * 1000) / 1000;
      if (!options.clipEdges || report.gapUnits === 0) continue;

      const shift = { x: direction.x * report.gapUnits, y: direction.y * report.gapUnits };
      const move = (p: Point): Point => ({ x: p.x + shift.x, y: p.y + shift.y });
      route[index] = { ...segment, to: move(point) } as PathSegment;
      // Keep the tangent of a curved end segment.
      if (end === "source" && route[1]?.command === "C") {
        route[1] = { ...route[1], c1: move(route[1].c1) };
      }
      if (end === "target" && segment.command === "C") {
        route[index] = { ...segment, to: move(point), c2: move(segment.c2) };
      }
      changed = true;
    }
    if (changed) {
      editStartTag(pathElement, (tag) => setAttribute(tag, "d", serializePath(route)));
    }
  }

  // Apply the splices back to front (they never overlap).
  edits.sort((a, b) => b.start - a.start);
  let out = svg;
  let limit = Number.POSITIVE_INFINITY;
  for (const edit of edits) {
    if (edit.end > limit) throw new Error("internal error: overlapping edits");
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
    limit = edit.start;
  }
  return { svg: out, edgeEnds };
}
