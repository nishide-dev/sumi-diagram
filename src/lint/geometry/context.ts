/**
 * What geometry rules see (#13): every element of the rendered figure with
 * its IR entry, source path, shape regions, measured labels and flattened
 * edge route, plus the canvas and the profile's physical limits.
 */

import { iconRect } from "../../assets/draw";
import type { ElementIR, FigureIR, NodeIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";
import type { DiagnosticSubject, DocPath } from "../../core/diagnostics";
import { getOutlineRenderer } from "../../core/outline";
import type { FontSet } from "../../core/theme/fonts";
import type { Point, Rect } from "../../render/geometry";
import type { ProfileLimits, SvgInspection } from "../../render/inspect";
import { type MeasuredLabel, measureLabel } from "./measure";
import { outlineRegions } from "./outlines";
import { type DrawnShape, flattenPath, labelArea, type Region, shapeOutline } from "./shapes";

export interface GeometryElement {
  key: ElementKey;
  kind: "node" | "group" | "edge";
  ir: ElementIR;
  subject: DiagnosticSubject;
  /** Path of the element in the source document (from the IR source map). */
  docPath: DocPath;
  /** `node "api"`, `group "backend"`, `edge "e1"` or `edge edges[2]`, for messages. */
  name: string;
  /** Shape bounding box (stroke excluded); undefined for edges and `text` nodes. */
  bbox?: Rect;
  /** Convex collision region: renderer collision/hull for custom nodes, otherwise shapeOutline. */
  outline?: Region;
  /** Custom renderer safeArea or the ordinary shape's labelArea; set with bbox. */
  labelArea?: Region;
  /** Half the stroke width in units: the part of the border drawn inside the outline. */
  strokeInset: number;
  labels: MeasuredLabel[];
  /** Edge: the route as polylines (cubics flattened). */
  route?: Point[][];
  /**
   * Edge: what is stroked for it (#156). D2 strokes the route itself; a
   * structured figure paints its nets as wires with rounded turns that stop
   * at arrowheads (`SvgInspection.painted`, kept per edge), and the sharp
   * `route` is the logical path.
   */
  drawn?: Point[][];
}

export interface GeometryContext {
  readonly ir: FigureIR;
  readonly inspection: SvgInspection;
  /** The canvas (viewBox of `svg.d2-svg`) in element coordinates. */
  readonly canvas: Rect;
  readonly profile: ProfileLimits;
  /** Every element in IR order: groups, nodes, edges. */
  readonly elements: readonly GeometryElement[];
  get(key: ElementKey): GeometryElement | undefined;
  /** `true` if `ancestor` is a group that (transitively) contains `key`. */
  isAncestor(ancestor: ElementKey, key: ElementKey): boolean;
}

/** The ID of the group a caption node was expanded from (#130), if `element` is one. */
function captionGroupId(element: ElementIR): string | undefined {
  if (element.kind !== "node" || element.captionOf === undefined) return undefined;
  return element.captionOf.slice("g:".length);
}

function subjectOf(element: ElementIR): DiagnosticSubject {
  // The frame and parts of a legend (#131) are written as the legend node.
  if (element.legend !== undefined) return { kind: "node", id: element.legend.id };
  if (element.kind === "edge") return { kind: "edge", id: element.id ?? `edges[${element.index}]` };
  const captioned = captionGroupId(element);
  if (captioned !== undefined) return { kind: "group", id: captioned };
  return { kind: element.kind, id: element.id };
}

function nameOf(element: ElementIR): string {
  if (element.legend !== undefined) return element.legend.name;
  if (element.kind === "edge") {
    return element.id === undefined ? `edge edges[${element.index}]` : `edge "${element.id}"`;
  }
  const captioned = captionGroupId(element);
  if (captioned !== undefined) return `the caption of group "${captioned}"`;
  return `${element.kind} "${element.id}"`;
}

/** An icon's square as a one-line label without text (1 em, where `iconRect()` draws it). */
function iconAsLabel(node: NodeIR, box: Rect): MeasuredLabel {
  const rect = iconRect(node, box);
  const size = node.style.fontSize.units;
  return {
    label: {
      text: "",
      anchor: { x: rect.x + rect.width / 2, y: rect.y + rect.height },
      fontSizeUnits: size,
      lines: 1,
      lineHeightUnits: size,
      font: "regular",
    },
    fontPath: "",
    texts: [""],
    lines: [rect],
    visibleLines: [rect],
    box: rect,
  };
}

/**
 * Builds the context from the IR and the SVG inspection of the same render.
 * Labels are measured with `fonts` (the theme's font set).
 */
export function createGeometryContext(
  ir: FigureIR,
  inspection: SvgInspection,
  fonts: FontSet,
): GeometryContext {
  const elements: GeometryElement[] = [];
  for (const geometry of inspection.elements) {
    const element = ir.elements.get(geometry.key);
    if (element === undefined) {
      throw new Error(`internal error: inspected element ${geometry.key} is not in the IR`);
    }
    const shape: DrawnShape | undefined =
      element.kind === "edge" || element.shape === "text" ? undefined : element.shape;
    const bbox = shape === undefined ? undefined : geometry.bbox;
    let regions: { outline: Region; labelArea: Region } | undefined;
    if (shape !== undefined && bbox !== undefined) {
      if (element.kind === "node" && element.render !== undefined) {
        const renderer = getOutlineRenderer(element.render.renderer);
        if (!renderer)
          throw new Error(`internal error: unknown outline renderer ${element.render.renderer}`);
        regions = outlineRegions(
          renderer.draw(bbox, renderer.params.parse(element.render.params ?? {})),
        );
      } else regions = { outline: shapeOutline(shape, bbox), labelArea: labelArea(shape, bbox) };
    }
    elements.push({
      key: geometry.key,
      kind: geometry.kind,
      ir: element,
      subject: subjectOf(element),
      docPath: ir.sourceMap.get(geometry.key)?.path ?? [],
      name: nameOf(element),
      ...(shape !== undefined &&
        bbox !== undefined && {
          bbox,
          ...regions,
        }),
      strokeInset: element.style.strokeWidth.units / 2,
      labels: [
        ...geometry.labels.map((label) => measureLabel(label, fonts)),
        // An icon (#94) is drawn in place of the label: the rules that keep
        // labels inside their shape and apart from others check it too.
        ...(element.kind === "node" && element.icon !== undefined && geometry.bbox !== undefined
          ? [iconAsLabel(element, geometry.bbox)]
          : []),
      ],
      ...(geometry.path !== undefined && { route: flattenPath(geometry.path) }),
    });
  }
  if (inspection.painted !== undefined) {
    const painted = new Map(inspection.painted.map(({ key, path }) => [key, flattenPath(path)]));
    for (const element of elements) {
      if (element.route !== undefined) element.drawn = painted.get(element.key) ?? [];
    }
  } else {
    for (const element of elements) if (element.route !== undefined) element.drawn = element.route;
  }
  const byKey = new Map(elements.map((e) => [e.key, e]));
  return {
    ir,
    inspection,
    canvas: inspection.canvas.viewBox,
    profile: inspection.profile,
    elements,
    get: (key) => byKey.get(key),
    isAncestor(ancestor, key) {
      const seen = new Set<ElementKey>();
      let current = ir.elements.get(key);
      while (current !== undefined && current.kind !== "edge" && current.parent !== undefined) {
        if (current.parent === ancestor) return true;
        if (seen.has(current.parent)) return false;
        seen.add(current.parent);
        current = ir.elements.get(current.parent);
      }
      return false;
    },
  };
}
