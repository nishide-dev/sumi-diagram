/** Non-destructive outline composition (#53): shapes, label positions and edge ends only. */
import { imageLayerRects } from "../assets/layers";
import type { FigureIR, NodeIR } from "../compiler/ir";
import type { ElementKey } from "../core/check-state";
import type { Diagnostic } from "../core/diagnostics";
import { getOutlineRenderer, type OutlineDrawing } from "../core/outline";
import type { Result } from "../core/result";
import { getFontSet } from "../core/theme/fonts";
import { captionGap, LINE_HEIGHT } from "../layout/text";
import { measureLabel } from "../lint/geometry/measure";
import {
  CYLINDER_ARC_UNITS,
  cylinderArc,
  cylinderPathData,
  depthInside,
  flattenPath,
} from "../lint/geometry/shapes";
import { type PathSegment, type Point, parsePath, type Rect } from "./geometry";
import { decodeElementClass, type SvgInspection } from "./inspect";
import {
  ENDPOINT_ANGLE_TOLERANCE_DEG,
  entryAngle,
  extensionsCross,
  FLUSH_TOLERANCE,
  insideRect,
  rayHit,
  rectPoints,
} from "./outline-geometry";
import { correctedOutlineRouteIsSafe } from "./outline-route";
import { isHiddenJunction } from "./wire";
import {
  attribute,
  childElements,
  classList,
  descendants,
  escapeAttribute,
  parseXml,
  type XmlElement,
} from "./xml";

interface Edit {
  start: number;
  end: number;
  text: string;
}
interface Extension {
  node: ElementKey;
  edge: ElementKey;
  start: Point;
  end: Point;
}
const fmt = (n: number) => String(Number(n.toFixed(3)));
const PATH_GEOMETRY = new Set(["x", "y", "width", "height", "rx", "ry"]);
const pathText = (segments: readonly PathSegment[]) =>
  segments
    .map((s) =>
      s.command === "C"
        ? `C ${fmt(s.c1.x)} ${fmt(s.c1.y)} ${fmt(s.c2.x)} ${fmt(s.c2.y)} ${fmt(s.to.x)} ${fmt(s.to.y)}`
        : `${s.command} ${fmt(s.to.x)} ${fmt(s.to.y)}`,
    )
    .join(" ");

/** Preserve document locations and subjects for SVG-stage diagnostics. */
export function outlineDiagnostic(
  ir: FigureIR,
  key: ElementKey,
  code: string,
  severity: "error" | "warning",
  message: string,
): Diagnostic {
  const entry = ir.sourceMap.get(key);
  const element = ir.elements.get(key);
  return {
    code,
    severity,
    message,
    ...(entry && { path: [...entry.path], ...(entry.location && { location: entry.location }) }),
    ...(element && {
      subject: {
        kind: element.kind,
        id: element.kind === "edge" ? (element.id ?? `edges[${element.index}]`) : element.id,
      },
    }),
  };
}

export function drawNodeOutline(node: NodeIR, bbox: Rect): OutlineDrawing {
  const renderer = node.render && getOutlineRenderer(node.render.renderer);
  if (!renderer || !node.render) throw new Error(`Unknown outline renderer on ${node.key}.`);
  return renderer.draw(bbox, renderer.params.parse(node.render.params ?? {}));
}

/** Finalized, inspected placeholders -> composed SVG; callers inspect the result again. */
export function composeOutlines(
  svg: string,
  ir: FigureIR,
  inspection: SvgInspection,
): Result<string> {
  const diagnostics: Diagnostic[] = [];
  const nodes = ir.nodes.filter((n) => n.render !== undefined || n.image?.layers !== undefined);
  if (nodes.length === 0) return { ok: true, value: svg, diagnostics };
  let current: ElementKey = nodes[0]?.key as ElementKey;
  try {
    const parsed = parseXml(svg);
    if (!parsed.ok) throw new Error(parsed.message);
    const groups = new Map<ElementKey, XmlElement>();
    for (const element of descendants(parsed.root)) {
      if (element.name !== "g") continue;
      for (const name of classList(element)) {
        const key = decodeElementClass(name);
        if (key) groups.set(key, element);
      }
    }
    const geometry = new Map(inspection.elements.map((e) => [e.key, e]));
    const edits: Edit[] = [];
    const editTag = (element: XmlElement, updates: Record<string, string>) => {
      let tag = svg.slice(element.start, element.startTagEnd);
      for (const [name, value] of Object.entries(updates)) {
        const pattern = new RegExp(`(\\s${name}\\s*=\\s*)(?:"[^"]*"|'[^']*')`);
        if (!pattern.test(tag)) throw new Error(`<${element.name}> lacks ${name}.`);
        tag = tag.replace(pattern, (_, prefix: string) => `${prefix}"${escapeAttribute(value)}"`);
      }
      edits.push({ start: element.start, end: element.startTagEnd, text: tag });
    };
    const drawings = new Map<
      ElementKey,
      {
        bbox: Rect;
        outlines: readonly (readonly Point[])[];
        image?: boolean;
        disconnected?: boolean;
      }
    >();
    for (const node of nodes) {
      current = node.key;
      const group = groups.get(node.key);
      const bbox = geometry.get(node.key)?.bbox;
      if (!group || !bbox) throw new Error(`Missing outline placeholder ${node.key}.`);
      if (node.image?.layers !== undefined) {
        drawings.set(node.key, {
          bbox,
          outlines: imageLayerRects(node, bbox).map(rectPoints),
          image: true,
        });
        continue;
      }
      const shapes = childElements(group).filter(
        (c) => c.name === "g" && classList(c).includes("shape"),
      );
      const shape = shapes[0];
      const children = shape && childElements(shape);
      const rect = children?.[0];
      if (shapes.length !== 1 || !shape || children?.length !== 1 || rect?.name !== "rect")
        throw new Error(`${node.key}: expected exactly one g.shape > rect placeholder.`);
      const drawing = drawNodeOutline(node, bbox);
      drawings.set(node.key, {
        bbox,
        outlines: drawing.boundaries ?? [drawing.portOutline ?? drawing.outline],
        ...(drawing.boundaries && { disconnected: true }),
      });
      const paint = rect.attributes.filter((a) => !PATH_GEOMETRY.has(a.name));
      const layers = drawing.layers
        .map((layer) => {
          const d =
            layer.path.points
              .map((p, i) => `${i === 0 ? "M" : "L"} ${fmt(p.x)} ${fmt(p.y)}`)
              .join(" ") + (layer.path.closed ? " Z" : "");
          const attrs = paint
            .map(
              (a) =>
                ` ${a.name}="${escapeAttribute(
                  layer.role === "line" && a.name === "fill"
                    ? "none"
                    : layer.role === "line" &&
                        a.name === "stroke" &&
                        node.render?.renderer === "sumi/waveform" &&
                        typeof node.render.params?.signalStroke === "string"
                      ? node.render.params.signalStroke
                      : layer.role === "body" &&
                          a.name === "stroke" &&
                          node.render?.renderer === "sumi/waveform" &&
                          typeof node.render.params?.frameStroke === "string"
                        ? node.render.params.frameStroke
                        : a.value,
                )}"`,
            )
            .join("");
          const signal =
            layer.role === "line" ? ' stroke-linecap="round" stroke-linejoin="round"' : "";
          return `<path d="${d}"${attrs}${layer.role === "line" && !paint.some((a) => a.name === "fill") ? ' fill="none"' : ""}${signal} />`;
        })
        .join("");
      const closing = svg.lastIndexOf("</", shape.end - 1);
      if (closing < shape.startTagEnd)
        throw new Error("The placeholder shape group is not paired.");
      edits.push({ start: shape.startTagEnd, end: closing, text: layers });
      if (node.style.radius.units !== 0)
        diagnostics.push(
          outlineDiagnostic(
            ir,
            node.key,
            "svg/outline-radius-ignored",
            "warning",
            `The polygon outline of ${node.id} does not support rounded corners.`,
          ),
        );
      let dx = drawing.safeArea.x + drawing.safeArea.width / 2 - bbox.x - bbox.width / 2;
      let dy = drawing.safeArea.y + drawing.safeArea.height / 2 - bbox.y - bbox.height / 2;
      const align = node.render?.renderer === "sumi/bubble" ? node.textAlign : undefined;
      if (node.labelBelow) {
        // D2 draws the caption outside, below the shape (#491): centre it and
        // put its first line box `captionGap` under the frame, as the
        // structured engine places it (half-leading above the font's ascent).
        const fonts = getFontSet(ir.meta.fontSetId);
        const label = geometry.get(node.key)?.labels[0];
        const line = fonts && label ? measureLabel(label, fonts).lines[0] : undefined;
        if (!label || !line) throw new Error(`${node.key}: cannot measure the caption.`);
        dx = bbox.x + bbox.width / 2 - label.anchor.x;
        const lineHeight = Math.max(label.fontSizeUnits * LINE_HEIGHT, line.height);
        dy =
          bbox.y +
          bbox.height +
          captionGap(label.fontSizeUnits) +
          (lineHeight - line.height) / 2 -
          line.y;
      } else if (align === "left" || align === "right") {
        const fonts = getFontSet(ir.meta.fontSetId);
        const label = geometry.get(node.key)?.labels[0];
        if (fonts && label) {
          const width = measureLabel(label, fonts).box?.width ?? 0;
          dx += (align === "left" ? -width : width) / 2;
        }
      }
      if (Math.abs(dx) + Math.abs(dy) > 1e-9 || align !== undefined) {
        for (const text of childElements(group).filter((c) => c.name === "text")) {
          const x = Number(attribute(text, "x"));
          const y = Number(attribute(text, "y"));
          editTag(text, {
            x: fmt(x + dx),
            y: fmt(y + dy),
            ...(align !== undefined && {
              style: (attribute(text, "style") ?? "").replace(
                /text-anchor:middle/,
                `text-anchor:${align === "left" ? "start" : align === "right" ? "end" : "middle"}`,
              ),
            }),
          });
          for (const span of childElements(text).filter(
            (c) => c.name === "tspan" && attribute(c, "x") !== undefined,
          ))
            editTag(span, { x: fmt(x + dx) });
        }
      }
    }

    const extensions: Extension[] = [];
    for (const edge of ir.edges) {
      if (!drawings.has(edge.from) && !drawings.has(edge.to)) continue;
      current = edge.key;
      const original = geometry.get(edge.key)?.path;
      const group = groups.get(edge.key);
      const path =
        group &&
        childElements(group).find((c) => c.name === "path" && classList(c).includes("connection"));
      if (!original || original.length < 2 || !path)
        throw new Error(`${edge.key}: missing edge route.`);
      const route = original.map((s) => structuredClone(s));
      const bends: { index: number; point: Point }[] = [];
      const pendingExtensions: Extension[] = [];
      const correctedEnds: ("source" | "target")[] = [];
      let changed = false;
      let failed = false;
      for (const end of ["source", "target"] as const) {
        const key = end === "source" ? edge.from : edge.to;
        const custom = drawings.get(key);
        if (!custom) continue;
        const index = end === "source" ? 0 : original.length - 1;
        const segment = original[index] as PathSegment;
        let point = segment.to;
        const adjacent = end === "source" ? (original[1] as PathSegment) : segment;
        const neighbour =
          end === "source"
            ? adjacent.command === "C"
              ? adjacent.c1
              : adjacent.to
            : segment.command === "C"
              ? segment.c2
              : (original[index - 1] as PathSegment).to;
        const length = Math.hypot(point.x - neighbour.x, point.y - neighbour.y);
        const direction = {
          x: (point.x - neighbour.x) / length,
          y: (point.y - neighbour.y) / length,
        };
        let lateral = 0;
        // A near-normal approach through a disconnected bowtie's gap must end on
        // a painted lip. Translate the endpoint ray, retaining its tangent.
        if (
          custom.disconnected &&
          Math.abs(direction.x) <= Math.sin((ENDPOINT_ANGLE_TOLERANCE_DEG * Math.PI) / 180)
        ) {
          const spans = custom.outlines.map((points) => ({
            min: Math.min(...points.map((p) => p.x)),
            max: Math.max(...points.map((p) => p.x)),
          }));
          if (!custom.outlines.some((outline) => rayHit(outline, point, direction) !== undefined)) {
            const nearest = custom.outlines
              .flat()
              .filter((p) => spans.some((span) => p.x === span.min || p.x === span.max))
              .sort((a, b) => {
                const distance = Math.abs(a.x - point.x) - Math.abs(b.x - point.x);
                return Math.abs(distance) > 1e-6
                  ? distance
                  : a.x - b.x || (a.y - b.y) * direction.y;
              })[0];
            if (nearest !== undefined) {
              // Aim the translated ray at the lip, rather than putting only
              // its origin on the lip's x (which can still miss when slanted).
              lateral = nearest.x - point.x - (direction.x / direction.y) * (nearest.y - point.y);
              point = { ...point, x: point.x + lateral };
            }
          }
        }
        const usable = length > 1e-9 && !insideRect(custom.bbox, point);
        const rectDistance = usable ? rayHit(rectPoints(custom.bbox), point, direction) : undefined;
        const hits = usable
          ? custom.outlines.flatMap((outline) => {
              const hit = rayHit(outline, point, direction);
              return hit === undefined ? [] : [hit];
            })
          : [];
        const outlineDistance = hits.length > 0 ? Math.min(...hits) : undefined;
        // D2 endpoints approach their declared footprint from outside and enter
        // it approximately normally (within ENDPOINT_ANGLE_TOLERANCE_DEG, #82).
        // Extend along the end's own travel direction; never guess a different
        // node if a backend changes this contract. An end whose outline already
        // coincides with the footprint along its ray needs no extension, so it
        // is left as D2 drew it without a warning, whatever its angle.
        const delta =
          rectDistance !== undefined && outlineDistance !== undefined
            ? outlineDistance - rectDistance
            : undefined;
        const normal =
          rectDistance !== undefined &&
          entryAngle(custom.bbox, point, direction, rectDistance) <= ENDPOINT_ANGLE_TOLERANCE_DEG;
        const flush = delta !== undefined && Math.abs(delta) <= FLUSH_TOLERANCE;
        if (delta === undefined || delta < -0.01 || (!normal && !flush)) {
          diagnostics.push(
            outlineDiagnostic(
              ir,
              edge.key,
              "svg/outline-edge-miss",
              custom.image ? "error" : "warning",
              `The ${end} end of ${edge.id ?? `edges[${edge.index}]`} could not be extended to ${key}'s outline.`,
            ),
          );
          failed = true;
          break;
        }
        // Ends that are not normal reach this point only when flush.
        if ((delta <= 1e-9 && lateral === 0) || !normal) continue;
        const shift = (p: Point): Point => ({
          x: p.x + direction.x * delta + lateral,
          y: p.y + direction.y * delta,
        });
        const moved = shift(segment.to);
        route[index] = { ...(route[index] as PathSegment), to: moved };
        if (end === "source" && route[1]?.command === "C")
          route[1] = { ...route[1], c1: shift(route[1].c1) };
        if (end === "target" && route[index]?.command === "C") {
          const last = route[index];
          if (last?.command === "C") route[index] = { ...last, c2: shift(last.c2) };
        }
        if (lateral !== 0 && adjacent.command !== "C") {
          // Retain the straight end's tangent too. Join its translated origin
          // to the old route outside the footprint, instead of making a diagonal
          // from the unchanged neighbour through the empty gap.
          bends.push({
            index: end === "source" ? 1 : index,
            point,
          });
        }
        pendingExtensions.push({ node: key, edge: edge.key, start: point, end: moved });
        correctedEnds.push(end);
        changed = true;
      }
      // Endpoint corrections are atomic: never publish the other end's edit
      // (or its crossing checks) when any end could not be corrected.
      if (failed) continue;
      // At equal indices insert the target first, so the source bend ends up
      // before it in travel order (a two-point route has both at index 1).
      for (const bend of bends.reverse().sort((a, b) => b.index - a.index))
        route.splice(bend.index, 0, { command: "L", to: bend.point });
      if (changed) {
        const d = pathText(route);
        const split = drawings.get(edge.from)?.disconnected || drawings.get(edge.to)?.disconnected;
        const rounded = parsePath(d);
        // Rounding can turn a corner contact into a ray through the gap.
        // Re-cast each corrected end using the serialized endpoint/tangent
        // and the same rounded boundaries that are painted in the SVG.
        const reachesPaint =
          rounded.ok &&
          correctedEnds.every((end) => {
            const segments = rounded.segments;
            const index = end === "source" ? 0 : segments.length - 1;
            const point = (segments[index] as PathSegment).to;
            const adjacent = segments[end === "source" ? 1 : index] as PathSegment;
            const neighbour =
              adjacent.command === "C"
                ? end === "source"
                  ? adjacent.c1
                  : adjacent.c2
                : (segments[end === "source" ? 1 : index - 1] as PathSegment).to;
            const direction = { x: point.x - neighbour.x, y: point.y - neighbour.y };
            const custom = drawings.get(end === "source" ? edge.from : edge.to);
            return custom?.outlines.some(
              (outline) =>
                rayHit(
                  outline.map((p) => ({ x: Number(fmt(p.x)), y: Number(fmt(p.y)) })),
                  point,
                  direction,
                ) !== undefined,
            );
          });
        const obstacles = inspection.elements.flatMap((e) =>
          e.kind !== "edge" && e.key !== edge.from && e.key !== edge.to && e.bbox ? [e.bbox] : [],
        );
        if (
          !rounded.ok ||
          !reachesPaint ||
          (split && !correctedOutlineRouteIsSafe(rounded.segments, original, obstacles))
        ) {
          diagnostics.push(
            outlineDiagnostic(
              ir,
              edge.key,
              "svg/outline-edge-miss",
              "warning",
              `The corrected route of ${edge.id ?? `edges[${edge.index}]`} could not be validated for painted contact, degeneracy, overlap or obstacle clearance; D2's original path was kept. Adjust the layout.`,
            ),
          );
          continue;
        }
        extensions.push(...pendingExtensions);
        editTag(path, { d });
      }
    }
    for (const [i, a] of extensions.entries()) {
      for (const b of extensions.slice(i + 1)) {
        if (a.node === b.node && extensionsCross(a.start, a.end, b.start, b.end)) {
          const d = outlineDiagnostic(
            ir,
            a.edge,
            "svg/outline-edge-crossing",
            "warning",
            `Extended edge ends intersect near ${a.node}.`,
          );
          const other = ir.sourceMap.get(b.edge);
          d.related = [
            {
              message: `The other extended edge end is ${b.edge}.`,
              ...(other && {
                path: [...other.path],
                ...(other.location && { location: other.location }),
              }),
            },
          ];
          diagnostics.push(d);
        }
      }
    }
    let out = svg;
    let limit = svg.length;
    for (const edit of edits.sort((a, b) => b.start - a.start)) {
      if (edit.end > limit) throw new Error("Outline SVG edits overlap.");
      out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
      limit = edit.start;
    }
    return diagnostics.some((d) => d.severity === "error")
      ? { ok: false, diagnostics }
      : { ok: true, value: out, diagnostics };
  } catch (cause) {
    diagnostics.push(
      outlineDiagnostic(
        ir,
        current,
        "svg/unsupported-geometry",
        "error",
        cause instanceof Error ? cause.message : String(cause),
      ),
    );
    return { ok: false, diagnostics };
  }
}

/**
 * Hidden junctions in `auto` (#101): D2 ends a line short of a node's
 * outline, so lines meeting at a junction without a dot would show a gap.
 * Each end without an arrowhead at a hidden junction is extended along its
 * own direction to the junction's center (its projection on that line), the
 * way `composeOutlines()` extends ends to an outline: only the `d` of those
 * edges' `path.connection` changes. Figures without hidden junctions are
 * returned as they are; callers inspect the result again.
 */
export function composeJunctionEnds(
  svg: string,
  ir: FigureIR,
  inspection: SvgInspection,
): Result<string> {
  const diagnostics: Diagnostic[] = [];
  const hidden = new Set(ir.nodes.filter(isHiddenJunction).map((n) => n.key));
  if (hidden.size === 0) return { ok: true, value: svg, diagnostics };
  let current: ElementKey = [...hidden][0] as ElementKey;
  try {
    const parsed = parseXml(svg);
    if (!parsed.ok) throw new Error(parsed.message);
    const groups = new Map<ElementKey, XmlElement>();
    for (const element of descendants(parsed.root)) {
      if (element.name !== "g") continue;
      for (const name of classList(element)) {
        const key = decodeElementClass(name);
        if (key) groups.set(key, element);
      }
    }
    const geometry = new Map(inspection.elements.map((e) => [e.key, e]));
    const edits: Edit[] = [];
    for (const edge of ir.edges) {
      const ends = (["source", "target"] as const).filter((end) => {
        const key = end === "source" ? edge.from : edge.to;
        const head = end === "source" ? edge.sourceArrowhead : edge.targetArrowhead;
        return hidden.has(key) && (head === undefined || head === "none");
      });
      if (ends.length === 0) continue;
      current = edge.key;
      const original = geometry.get(edge.key)?.path;
      const group = groups.get(edge.key);
      const path =
        group &&
        childElements(group).find((c) => c.name === "path" && classList(c).includes("connection"));
      if (!original || original.length < 2 || !path)
        throw new Error(`${edge.key}: missing edge route.`);
      const route = original.map((s) => structuredClone(s));
      let changed = false;
      for (const end of ends) {
        const bbox = geometry.get(end === "source" ? edge.from : edge.to)?.bbox;
        if (!bbox) throw new Error(`${edge.key}: missing junction geometry.`);
        const center = { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 };
        const index = end === "source" ? 0 : original.length - 1;
        const segment = original[index] as PathSegment;
        const point = segment.to;
        const next = original[1] as PathSegment;
        const neighbour =
          end === "source"
            ? next.command === "C"
              ? next.c1
              : next.to
            : segment.command === "C"
              ? segment.c2
              : (original[index - 1] as PathSegment).to;
        const length = Math.hypot(point.x - neighbour.x, point.y - neighbour.y);
        if (length <= 1e-9) continue;
        const direction = {
          x: (point.x - neighbour.x) / length,
          y: (point.y - neighbour.y) / length,
        };
        // How far along its own direction the end is from the center's projection.
        const delta = (center.x - point.x) * direction.x + (center.y - point.y) * direction.y;
        if (delta <= 1e-9) continue;
        const shift = (p: Point): Point => ({
          x: p.x + direction.x * delta,
          y: p.y + direction.y * delta,
        });
        route[index] = { ...(route[index] as PathSegment), to: shift(point) };
        if (end === "source" && route[1]?.command === "C")
          route[1] = { ...route[1], c1: shift(route[1].c1) };
        const last = route[index];
        if (end === "target" && last?.command === "C")
          route[index] = { ...last, c2: shift(last.c2) };
        changed = true;
      }
      if (!changed) continue;
      const tag = svg.slice(path.start, path.startTagEnd);
      const pattern = /(\sd\s*=\s*)(?:"[^"]*"|'[^']*')/;
      if (!pattern.test(tag)) throw new Error(`<${path.name}> lacks d.`);
      edits.push({
        start: path.start,
        end: path.startTagEnd,
        text: tag.replace(pattern, (_, prefix: string) => `${prefix}"${pathText(route)}"`),
      });
    }
    let out = svg;
    for (const edit of edits.sort((a, b) => b.start - a.start)) {
      out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
    }
    return { ok: true, value: out, diagnostics };
  } catch (cause) {
    diagnostics.push(
      outlineDiagnostic(
        ir,
        current,
        "svg/unsupported-geometry",
        "error",
        cause instanceof Error ? cause.message : String(cause),
      ),
    );
    return { ok: false, diagnostics };
  }
}

/**
 * Open arrowheads in `auto` (#386): D2 has no chevron, so an `open` end is
 * written to D2 as a filled triangle (`compileToD2`) and its marker is
 * replaced here by a copy with the same box that strokes a right-angled
 * chevron in the triangle's color and the edge's line width. The copy gets
 * an id of its own, so a triangle that shares D2's marker stays as it is.
 * The vertex sits just ahead of the line's end (D2 stops the line 1.5 widths
 * behind the tip), so the line runs into the chevron without a gap. Figures
 * without open arrowheads are returned as they are.
 */
export function composeOpenArrowheads(svg: string, ir: FigureIR): Result<string> {
  const diagnostics: Diagnostic[] = [];
  const open = ir.edges.filter((e) => e.sourceArrowhead === "open" || e.targetArrowhead === "open");
  if (open.length === 0) return { ok: true, value: svg, diagnostics };
  let current: ElementKey = (open[0] as (typeof open)[number]).key;
  try {
    const parsed = parseXml(svg);
    if (!parsed.ok) throw new Error(parsed.message);
    const groups = new Map<ElementKey, XmlElement>();
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
    const added = new Set<string>();
    for (const edge of open) {
      current = edge.key;
      const group = groups.get(edge.key);
      const path =
        group &&
        childElements(group).find((c) => c.name === "path" && classList(c).includes("connection"));
      if (!path) throw new Error(`${edge.key}: missing edge path.`);
      let tag = svg.slice(path.start, path.startTagEnd);
      for (const [end, head] of [
        ["start", edge.sourceArrowhead],
        ["end", edge.targetArrowhead],
      ] as const) {
        if (head !== "open") continue;
        const id = /^url\(#(.+)\)$/.exec(attribute(path, `marker-${end}`) ?? "")?.[1];
        const marker = id === undefined ? undefined : markers.get(id);
        if (id === undefined || marker === undefined)
          throw new Error(`${edge.key}: missing ${end} arrowhead marker.`);
        const chevronId = `${id}-open`;
        if (!added.has(chevronId)) {
          added.add(chevronId);
          // Before the original: D2 writes the path right after its marker.
          edits.push({
            start: marker.start,
            end: marker.start,
            text: chevronMarker(marker, chevronId, edge.style.strokeWidth.units),
          });
        }
        const pattern = new RegExp(`(\\smarker-${end}\\s*=\\s*)(?:"[^"]*"|'[^']*')`);
        tag = tag.replace(pattern, (_, prefix: string) => `${prefix}"url(#${chevronId})"`);
      }
      edits.push({ start: path.start, end: path.startTagEnd, text: tag });
    }
    let out = svg;
    for (const edit of edits.sort((a, b) => b.start - a.start)) {
      out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
    }
    return { ok: true, value: out, diagnostics };
  } catch (cause) {
    diagnostics.push(
      outlineDiagnostic(
        ir,
        current,
        "svg/unsupported-geometry",
        "error",
        cause instanceof Error ? cause.message : String(cause),
      ),
    );
    return { ok: false, diagnostics };
  }
}

/** A copy of D2's triangle `marker` that strokes a chevron instead (see `composeOpenArrowheads`). */
function chevronMarker(marker: XmlElement, id: string, width: number): string {
  const polygon = childElements(marker).find((c) => c.name === "polygon");
  const points = (attribute(polygon ?? marker, "points") ?? "")
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split(",").map(Number) as [number, number]);
  if (
    polygon === undefined ||
    points.length !== 3 ||
    points.flat().some((v) => !Number.isFinite(v))
  )
    throw new Error("The arrowhead marker is not a triangle.");
  // The tip is the corner opposite the base, whose two corners share x.
  const tipIndex = points.findIndex((_, i) => {
    const [a, b] = points.filter((_, j) => j !== i) as [[number, number], [number, number]];
    return a[0] === b[0];
  });
  if (tipIndex < 0) throw new Error("The arrowhead marker is not a triangle.");
  const tip = points[tipIndex] as [number, number];
  const base = points.filter((_, i) => i !== tipIndex) as [number, number][];
  const baseX = (base[0] as [number, number])[0];
  const half = Math.abs((base[0] as [number, number])[1] - (base[1] as [number, number])[1]) / 2;
  const sign = Math.sign(tip[0] - baseX);
  const refX = Number(attribute(marker, "refX"));
  const refY = Number(attribute(marker, "refY"));
  if (!Number.isFinite(refX) || !Number.isFinite(refY))
    throw new Error("The arrowhead marker has no reference point.");
  // The inner corner of the stroked vertex (0.7 widths behind it) meets the line's end.
  const vertex = refX + sign * 0.7 * width;
  const reach = Math.min(half - width / 2, Math.abs(vertex - baseX) - width / 2);
  const d = `M ${fmt(vertex - sign * reach)} ${fmt(refY - reach)} L ${fmt(vertex)} ${fmt(refY)} L ${fmt(vertex - sign * reach)} ${fmt(refY + reach)}`;
  const keep = ["markerWidth", "markerHeight", "refX", "refY", "viewBox", "orient", "markerUnits"]
    .map((name) => {
      const value = attribute(marker, name);
      return value === undefined ? "" : ` ${name}="${escapeAttribute(value)}"`;
    })
    .join("");
  const color = escapeAttribute(attribute(polygon, "fill") ?? "#000000");
  return `<marker id="${escapeAttribute(id)}"${keep}><path d="${d}" fill="none" stroke="${color}" stroke-width="${fmt(width)}" stroke-linecap="round" stroke-linejoin="round"/></marker>`;
}

/**
 * Short cylinders (#516): D2 v0.9.0 draws every cylinder with 24-unit caps and
 * puts the label in the body below them, so a cylinder under 100 units tall
 * has no room for a line of text. Where `cylinderArc()` makes the caps
 * shallower, redraws the two paths of the node's `g.shape` and moves the label
 * to the middle of the body the lint measures.
 * Callers inspect the result again (the bounding box does not change).
 */
export function composeCylinders(
  svg: string,
  ir: FigureIR,
  inspection: SvgInspection,
): Result<string> {
  const diagnostics: Diagnostic[] = [];
  const geometry = new Map(inspection.elements.map((e) => [e.key, e]));
  const short = ir.nodes.filter((n) => {
    const bbox = geometry.get(n.key)?.bbox;
    return (
      n.shape === "cylinder" &&
      n.render === undefined &&
      bbox !== undefined &&
      cylinderArc(bbox.height) < CYLINDER_ARC_UNITS
    );
  });
  if (short.length === 0) return { ok: true, value: svg, diagnostics };
  let current: ElementKey = (short[0] as (typeof short)[number]).key;
  try {
    const parsed = parseXml(svg);
    if (!parsed.ok) throw new Error(parsed.message);
    const groups = new Map<ElementKey, XmlElement>();
    for (const element of descendants(parsed.root)) {
      if (element.name !== "g") continue;
      for (const name of classList(element)) {
        const key = decodeElementClass(name);
        if (key) groups.set(key, element);
      }
    }
    const edits: Edit[] = [];
    const setAttribute = (element: XmlElement, name: string, value: string) => {
      const pattern = new RegExp(`(\\s${name}\\s*=\\s*)(?:"[^"]*"|'[^']*')`);
      const tag = svg.slice(element.start, element.startTagEnd);
      if (!pattern.test(tag)) throw new Error(`<${element.name}> lacks ${name}.`);
      edits.push({
        start: element.start,
        end: element.startTagEnd,
        text: tag.replace(pattern, (_, prefix: string) => `${prefix}"${escapeAttribute(value)}"`),
      });
    };
    for (const node of short) {
      current = node.key;
      const group = groups.get(node.key);
      const bbox = geometry.get(node.key)?.bbox;
      if (!group || !bbox) throw new Error(`${node.key}: missing cylinder.`);
      const shape = childElements(group).find(
        (c) => c.name === "g" && classList(c).includes("shape"),
      );
      const paths = shape ? childElements(shape).filter((c) => c.name === "path") : [];
      const [body, rim] = paths;
      if (paths.length !== 2 || !body || !rim)
        throw new Error(`${node.key}: expected a cylinder drawn as two paths.`);
      const d = cylinderPathData(bbox, fmt);
      setAttribute(body, "d", d.body);
      setAttribute(rim, "d", d.rim);
      // D2 puts the label half a cap below the middle, its cap being at most a quarter
      // of the height deep (measured: 12 units from 48 units up, h / 4 below).
      const shift =
        cylinderArc(bbox.height) / 2 - Math.min(CYLINDER_ARC_UNITS / 2, bbox.height / 4);
      for (const text of childElements(group).filter((c) => c.name === "text")) {
        const y = Number(attribute(text, "y"));
        if (!Number.isFinite(y)) throw new Error(`${node.key}: a cylinder label lacks y.`);
        setAttribute(text, "y", fmt(y + shift));
      }
    }
    // D2 ended the edges on its own 24-unit caps: an end that now lies inside the
    // shallower shape is pulled back along its last segment to the new outline.
    const outlines = new Map(
      short.map((node) => {
        const bbox = geometry.get(node.key)?.bbox as Rect;
        const parsedBody = parsePath(cylinderPathData(bbox, fmt).body);
        if (!parsedBody.ok) throw new Error(parsedBody.message);
        const points = flattenPath(parsedBody.segments)[0] ?? [];
        return [node.key, { kind: "polygon" as const, points }] as const;
      }),
    );
    for (const edge of ir.edges) {
      const ends = (["source", "target"] as const).filter((end) =>
        outlines.has(end === "source" ? edge.from : edge.to),
      );
      if (ends.length === 0) continue;
      current = edge.key;
      const original = geometry.get(edge.key)?.path;
      const group = groups.get(edge.key);
      const path =
        group &&
        childElements(group).find((c) => c.name === "path" && classList(c).includes("connection"));
      if (!original || original.length < 2 || !path) continue;
      const route = original.map((seg) => structuredClone(seg));
      let changed = false;
      for (const end of ends) {
        const outline = outlines.get(end === "source" ? edge.from : edge.to);
        if (outline === undefined) continue;
        const index = end === "source" ? 0 : route.length - 1;
        const segment = route[index] as PathSegment;
        const point = segment.to;
        const next = route[1] as PathSegment;
        const neighbour =
          end === "source"
            ? next.command === "C"
              ? next.c1
              : next.to
            : segment.command === "C"
              ? segment.c2
              : (route[index - 1] as PathSegment).to;
        const length = Math.hypot(point.x - neighbour.x, point.y - neighbour.y);
        if (length <= 1e-9 || depthInside(outline, point) <= 0.01) continue;
        // Back along the last segment, from the end towards the neighbour, to the outline.
        const toward = { x: (neighbour.x - point.x) / length, y: (neighbour.y - point.y) / length };
        let lo = 0;
        let hi = length;
        if (depthInside(outline, neighbour) > 0) hi = length * 4;
        for (let i = 0; i < 40; i++) {
          const mid = (lo + hi) / 2;
          const inside =
            depthInside(outline, {
              x: point.x + toward.x * mid,
              y: point.y + toward.y * mid,
            }) > 0;
          if (inside) lo = mid;
          else hi = mid;
        }
        const moved = { x: point.x + toward.x * hi, y: point.y + toward.y * hi };
        const shift = { x: moved.x - point.x, y: moved.y - point.y };
        route[index] = { ...segment, to: moved };
        if (end === "source" && route[1]?.command === "C")
          route[1] = {
            ...route[1],
            c1: { x: route[1].c1.x + shift.x, y: route[1].c1.y + shift.y },
          };
        const last = route[index];
        if (end === "target" && last?.command === "C")
          route[index] = { ...last, c2: { x: last.c2.x + shift.x, y: last.c2.y + shift.y } };
        changed = true;
      }
      if (!changed) continue;
      const tag = svg.slice(path.start, path.startTagEnd);
      const pattern = /(\sd\s*=\s*)(?:"[^"]*"|'[^']*')/;
      if (!pattern.test(tag)) throw new Error(`<${path.name}> lacks d.`);
      edits.push({
        start: path.start,
        end: path.startTagEnd,
        text: tag.replace(pattern, (_, prefix: string) => `${prefix}"${pathText(route)}"`),
      });
    }
    let out = svg;
    for (const edit of edits.sort((a, b) => b.start - a.start)) {
      out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
    }
    return { ok: true, value: out, diagnostics };
  } catch (cause) {
    diagnostics.push(
      outlineDiagnostic(
        ir,
        current,
        "svg/unsupported-geometry",
        "error",
        cause instanceof Error ? cause.message : String(cause),
      ),
    );
    return { ok: false, diagnostics };
  }
}
