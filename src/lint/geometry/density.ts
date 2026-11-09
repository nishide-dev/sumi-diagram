/**
 * Density diagnostics for paper figures (#422): a figure that is too sparse
 * for its canvas, and boxes that hold sentences. Metrics are measured on the
 * rendered geometry and calibrated on the TriCL and LLaDA reproductions
 * (dense, publishable) against three sparse trial figures; see
 * docs/design/decisions/422-density-lint.md.
 */

import { formatMm, ptToMm } from "../../core/units";
import { type Rect, unitsToPt } from "../../render/geometry";
import { printedSize } from "../../render/size";
import { defineGeometryRule } from "../rule";
import type { GeometryContext, GeometryElement } from "./context";
import { largestEmptyRect, mergeAligned, position } from "./dead-space";
import { occupiedArea } from "./empty-space";
import type { MeasuredLabel } from "./measure";

/** A figure needs at least this many drawn nodes before its fill is judged. */
export const SPARSE_MIN_ELEMENTS = 30;
/** Drawn bodies, text, badges and glyphs cover less than this share of the canvas. */
export const SPARSE_FILL_MAX = 0.34;
/** Each element gets more than this much printed canvas (mm²) on average. */
export const SPARSE_AREA_PER_ELEMENT_MM2 = 330;

/** A node label of at least this many characters (whitespace collapsed) is a sentence, not a name. */
export const TEXT_HEAVY_CHARS = 36;
/** Report when at least this many nodes are text-heavy. */
export const TEXT_HEAVY_MIN_NODES = 2;
/** The text rule needs a figure of at least this many drawn nodes. */
export const TEXT_HEAVY_MIN_ELEMENTS = 12;

const figureSubject = (context: GeometryContext) =>
  ({ kind: "figure", id: context.ir.meta.id }) as const;

/** Paper figures (paper-* profiles) and figures that declare a placement budget. */
export function inDensityScope(context: GeometryContext): boolean {
  return context.ir.meta.profileId.startsWith("paper-") || context.ir.meta.target !== undefined;
}

/** Drawn nodes: nodes with a shape (groups, edges and `text` nodes excluded). */
export function drawnNodes(context: GeometryContext): GeometryElement[] {
  return context.elements.filter((e) => e.kind === "node" && e.bbox !== undefined);
}

function textBoxes(element: { readonly labels: readonly MeasuredLabel[] }): Rect[] {
  return element.labels.flatMap((l) => l.visibleLines);
}

/** Boxes of everything drawn as content: node bodies, text, badges, glyphs, set enclosures. */
export function contentBoxes(context: GeometryContext): Rect[] {
  const boxes: Rect[] = [];
  for (const element of context.elements) {
    if (element.bbox !== undefined && element.kind !== "group") boxes.push(element.bbox);
    boxes.push(...textBoxes(element));
    if (element.badge !== undefined) boxes.push(element.badge);
    boxes.push(...(element.glyphs ?? []));
  }
  for (const set of context.sets) {
    boxes.push(set.geometry.bbox);
    boxes.push(...textBoxes(set));
  }
  return boxes;
}

export interface FillMetrics {
  /** Drawn nodes (shapes that are not group frames). */
  elements: number;
  /** Union of {@link contentBoxes} over the canvas, 0..1. Group frames and wires are not content. */
  fill: number;
  /** Printed canvas area in mm². */
  areaMm2: number;
  /** Printed canvas area per drawn node in mm². */
  areaPerElementMm2: number;
}

export function fillMetrics(context: GeometryContext): FillMetrics {
  const nodes = drawnNodes(context);
  const canvas = context.canvas;
  const total = canvas.width * canvas.height;
  const fill = total > 0 ? occupiedArea(canvas, contentBoxes(context)) / total : 0;
  const { widthPt, heightPt } = printedSize(context.inspection);
  const areaMm2 = ptToMm(widthPt) * ptToMm(heightPt);
  return {
    elements: nodes.length,
    fill,
    areaMm2,
    areaPerElementMm2: nodes.length > 0 ? areaMm2 / nodes.length : Number.POSITIVE_INFINITY,
  };
}

/** The largest empty rectangle among content and wires (group frames are not obstacles). */
export function largestHole(context: GeometryContext): Rect | undefined {
  const boxes = contentBoxes(context);
  for (const element of context.elements) {
    const pad = Math.max(element.strokeInset, 1);
    for (const line of element.drawn ?? []) {
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1];
        const b = line[i];
        if (a === undefined || b === undefined) continue;
        boxes.push({
          x: Math.min(a.x, b.x) - pad,
          y: Math.min(a.y, b.y) - pad,
          width: Math.abs(b.x - a.x) + pad * 2,
          height: Math.abs(b.y - a.y) + pad * 2,
        });
      }
    }
  }
  return largestEmptyRect(context.canvas, mergeAligned(boxes));
}

export function isSparse(metrics: FillMetrics): boolean {
  return (
    metrics.elements >= SPARSE_MIN_ELEMENTS &&
    metrics.fill < SPARSE_FILL_MAX &&
    metrics.areaPerElementMm2 > SPARSE_AREA_PER_ELEMENT_MM2
  );
}

export interface TextHeavyNode {
  element: GeometryElement;
  text: string;
  chars: number;
}

/** Components whose labels are prose by design (chat bubbles). */
const PROSE_COMPONENTS = new Set(["sumi/bubble"]);

/** Nodes whose label holds at least {@link TEXT_HEAVY_CHARS} characters. */
export function textHeavyNodes(context: GeometryContext): TextHeavyNode[] {
  return context.elements.flatMap((element): TextHeavyNode[] => {
    if (element.ir.kind !== "node" || element.bbox === undefined) return [];
    if (PROSE_COMPONENTS.has(element.ir.component)) return [];
    const text = element.labels
      .map((l) => l.label.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    return text.length >= TEXT_HEAVY_CHARS ? [{ element, text, chars: text.length }] : [];
  });
}

export const sparseFigure = defineGeometryRule({
  id: "geometry/sparse-figure",
  description:
    "A paper figure with at least 30 drawn nodes covers under 34% of its canvas and gives each node more than 330mm² of printed canvas.",
  defaultSeverity: "info",
  fixable: false,
  run(context) {
    if (!inDensityScope(context)) return [];
    const metrics = fillMetrics(context);
    if (!isSparse(metrics)) return [];
    const hole = largestHole(context);
    const scale = context.inspection.scale ?? 1;
    const mm = (n: number) => formatMm(unitsToPt(n * scale));
    const total = context.canvas.width * context.canvas.height;
    const where =
      hole === undefined
        ? ""
        : ` The largest empty area is ${position(hole, context.canvas)}, ${mm(hole.width)} × ${mm(hole.height)} (${((100 * hole.width * hole.height) / total).toFixed(1)}% of the canvas): move the legend or scattered labels into it.`;
    return [
      {
        message: `The figure is sparse: ${metrics.elements} nodes, text and shapes cover ${(metrics.fill * 100).toFixed(1)}% of the canvas (below ${SPARSE_FILL_MAX * 100}%), ${Math.round(metrics.areaPerElementMm2)}mm² of canvas per node (above ${SPARSE_AREA_PER_ELEMENT_MM2}mm²).`,
        path: ["figure", "layout"],
        subject: figureSubject(context),
        hint: `Shrink the canvas (smaller gaps and padding, \`layout.density: compact\`, a lower \`figure.target.height\`) or enlarge the elements, so the same content fills a smaller area; dense reference figures cover about 36-41%.${where} Drop whitespace between panels; if the space is intentional, suppress with {"rules":{"geometry/sparse-figure":"off"}}.`,
      },
    ];
  },
});

export const textHeavy = defineGeometryRule({
  id: "geometry/text-heavy-nodes",
  description: `At least ${TEXT_HEAVY_MIN_NODES} nodes of a paper figure with ${TEXT_HEAVY_MIN_ELEMENTS}+ nodes hold ${TEXT_HEAVY_CHARS}+ characters of label text.`,
  defaultSeverity: "info",
  fixable: false,
  run(context) {
    if (!inDensityScope(context)) return [];
    if (drawnNodes(context).length < TEXT_HEAVY_MIN_ELEMENTS) return [];
    const heavy = textHeavyNodes(context);
    if (heavy.length < TEXT_HEAVY_MIN_NODES) return [];
    const list = heavy
      .slice(0, 5)
      .map((h) => `${h.element.name} (${h.chars} characters)`)
      .join("; ");
    return [
      {
        message: `${heavy.length} nodes hold ${TEXT_HEAVY_CHARS}+ characters of text: ${list}${heavy.length > 5 ? "; ..." : ""}.`,
        path: ["figure", "layout"],
        subject: figureSubject(context),
        hint: 'A paper figure labels with names, not sentences: move formulas and explanations to the caption, shorten each label to a name or a short phrase, or split the box into a title and a small `sublabel`. If the sentences are the point of the figure, suppress with {"rules":{"geometry/text-heavy-nodes":"off"}}.',
        related: heavy.slice(0, 5).map((h) => ({
          path: h.element.docPath,
          message: `${h.element.name}: ${JSON.stringify(h.text.slice(0, 60))}`,
        })),
      },
    ];
  },
});
