/** Non-destructive outline composition (#53): shapes, label positions and edge ends only. */
import type { FigureIR, NodeIR } from "../compiler/ir";
import type { ElementKey } from "../core/check-state";
import type { Diagnostic } from "../core/diagnostics";
import { getOutlineRenderer, type OutlineDrawing } from "../core/outline";
import type { Result } from "../core/result";
import type { PathSegment, Point, Rect } from "./geometry";
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
  const nodes = ir.nodes.filter((n) => n.render !== undefined);
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
    const drawings = new Map<ElementKey, { bbox: Rect; drawing: OutlineDrawing }>();
    for (const node of nodes) {
      current = node.key;
      const group = groups.get(node.key);
      const bbox = geometry.get(node.key)?.bbox;
      if (!group || !bbox) throw new Error(`Missing outline placeholder ${node.key}.`);
      const shapes = childElements(group).filter(
        (c) => c.name === "g" && classList(c).includes("shape"),
      );
      const shape = shapes[0];
      const children = shape && childElements(shape);
      const rect = children?.[0];
      if (shapes.length !== 1 || !shape || children?.length !== 1 || rect?.name !== "rect")
        throw new Error(`${node.key}: expected exactly one g.shape > rect placeholder.`);
      const drawing = drawNodeOutline(node, bbox);
      drawings.set(node.key, { bbox, drawing });
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
                ` ${a.name}="${escapeAttribute(layer.role === "line" && a.name === "fill" ? "none" : a.value)}"`,
            )
            .join("");
          return `<path d="${d}"${attrs}${layer.role === "line" && !paint.some((a) => a.name === "fill") ? ' fill="none"' : ""} />`;
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
      const dx = drawing.safeArea.x + drawing.safeArea.width / 2 - bbox.x - bbox.width / 2;
      const dy = drawing.safeArea.y + drawing.safeArea.height / 2 - bbox.y - bbox.height / 2;
      if (Math.abs(dx) + Math.abs(dy) > 1e-9) {
        for (const text of childElements(group).filter((c) => c.name === "text")) {
          const x = Number(attribute(text, "x"));
          const y = Number(attribute(text, "y"));
          editTag(text, { x: fmt(x + dx), y: fmt(y + dy) });
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
      let changed = false;
      for (const end of ["source", "target"] as const) {
        const key = end === "source" ? edge.from : edge.to;
        const custom = drawings.get(key);
        if (!custom) continue;
        const index = end === "source" ? 0 : original.length - 1;
        const segment = original[index] as PathSegment;
        const point = segment.to;
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
        const usable = length > 1e-9 && !insideRect(custom.bbox, point);
        const rectDistance = usable ? rayHit(rectPoints(custom.bbox), point, direction) : undefined;
        const outlineDistance = usable
          ? rayHit(custom.drawing.outline, point, direction)
          : undefined;
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
              "warning",
              `The ${end} end of ${edge.id ?? `edges[${edge.index}]`} could not be extended to ${key}'s outline.`,
            ),
          );
          continue;
        }
        // Ends that are not normal reach this point only when flush.
        if (delta <= 1e-9 || !normal) continue;
        const shift = (p: Point): Point => ({
          x: p.x + direction.x * delta,
          y: p.y + direction.y * delta,
        });
        const moved = shift(point);
        route[index] = { ...(route[index] as PathSegment), to: moved };
        if (end === "source" && route[1]?.command === "C")
          route[1] = { ...route[1], c1: shift(route[1].c1) };
        if (end === "target" && route[index]?.command === "C") {
          const last = route[index];
          if (last?.command === "C") route[index] = { ...last, c2: shift(last.c2) };
        }
        extensions.push({ node: key, edge: edge.key, start: point, end: moved });
        changed = true;
      }
      if (changed) editTag(path, { d: pathText(route) });
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
