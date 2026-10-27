/**
 * Geometry lint rules (stage `geometry`, #13): checks on the rendered SVG's
 * geometry, with labels re-measured from the theme's TTF files. Tolerances
 * and limits are documented in design doc §6.5 and docs/lint-rules.md.
 *
 * None of these rules changes the figure: Sumi never shrinks text or the
 * canvas to make a problem go away (design doc §5).
 */

import type { EdgeIR, FigureIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";
import type { DocPath } from "../../core/diagnostics";
import type { GroupLabelPosition } from "../../core/figure/schema";
import { BUILTIN_PROFILES } from "../../core/profile/builtin";
import { formatMm, formatPt } from "../../core/units";
import { type Point, type Rect, unitsToPt } from "../../render/geometry";
import type { ProfileLimits } from "../../render/inspect";
import { defineGeometryRule, type GeometryRule, type LintFinding } from "../rule";
import type { GeometryContext, GeometryElement } from "./context";
import { obstaclesCrossedByRoute, type RouteObstacle } from "./edges";
import { unionOf } from "./measure";
import { regionsOverlap } from "./outlines";
import {
  CUBIC_STEPS,
  overhang,
  polylinesCrossRect,
  rectDepthInside,
  rectInside,
  rectsOverlap,
  regionIntersectsRect,
} from "./shapes";

/**
 * Slack in SVG units (0.5pt) for D2's rounding: D2 writes shape coordinates
 * as integers or halves and positions labels from its own (different) text
 * measurement, so geometry that merely touches is not a problem.
 */
export const GEOMETRY_TOLERANCE_UNITS = 1;

/** Slack for comparing physical sizes in pt (floating point only; sizes are not quantized). */
const PT_EPSILON = 1e-6;

const formatSize = (rect: Rect): string =>
  `${formatPt(unitsToPt(rect.width))} × ${formatPt(unitsToPt(rect.height))}`;

const figurePath: DocPath = ["figure"];

function figureSubject(context: GeometryContext) {
  return { kind: "figure", id: context.ir.meta.id } as const;
}

/** Where a label is written: `label`, or `icon` for a node that draws an icon in its place (#94). */
const labelPath = (element: GeometryElement): DocPath => [
  ...element.docPath,
  hasIcon(element) ? "icon" : "label",
];

const hasIcon = (element: GeometryElement): boolean =>
  element.ir.kind === "node" && element.ir.icon !== undefined;

/** `label`, or `icon` for a node that draws an icon in place of its label (#94). */
const contentNoun = (element: GeometryElement): string => (hasIcon(element) ? "icon" : "label");

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

const isStructured = (context: GeometryContext): boolean => context.ir.meta.engine === "structured";

/** `true` if the auto layout runs left / right, so the layers are side by side. */
const isHorizontal = (context: GeometryContext): boolean =>
  context.ir.meta.direction === "right" || context.ir.meta.direction === "left";

/**
 * The built-in profiles a figure that is too wide (too tall) could move to
 * (#114): larger along `axis` than `current`, holding the figure as drawn on
 * both axes (an omitted limit holds anything), with no larger minimum font
 * size (a paper figure is not sent to a slide profile). Sorted by the page
 * size along `axis`, then by ID.
 */
export function largerBuiltinProfiles(
  current: ProfileLimits,
  axis: "width" | "height",
  size: { widthPt: number; heightPt: number },
): { id: string; maxPt: number }[] {
  const currentMax = axis === "width" ? current.maxWidthPt : current.maxHeightPt;
  if (currentMax === undefined) return [];
  const holds = (limit: { pt: number } | undefined, sizePt: number) =>
    limit === undefined || limit.pt + PT_EPSILON >= sizePt;
  return [...BUILTIN_PROFILES.values()]
    .flatMap((profile) => {
      const { maxWidth, maxHeight } = profile.page;
      const max = axis === "width" ? maxWidth : maxHeight;
      return profile.id !== current.id &&
        (max === undefined || max.pt > currentMax + PT_EPSILON) &&
        holds(maxWidth, size.widthPt) &&
        holds(maxHeight, size.heightPt) &&
        profile.typography.minFontSize.pt <= current.minFontSizePt + PT_EPSILON
        ? [{ id: profile.id, maxPt: max?.pt ?? Number.POSITIVE_INFINITY }]
        : [];
    })
    .sort((a, b) => a.maxPt - b.maxPt || a.id.localeCompare(b.id));
}

/** `use a wider profile (paper-double, 180mm)`, or nothing if no built-in profile fits. */
function profileAdvice(context: GeometryContext, axis: "width" | "height"): string[] {
  const { width, height } = context.inspection.canvas;
  const larger = largerBuiltinProfiles(context.profile, axis, {
    widthPt: width.pt,
    heightPt: height.pt,
  });
  if (larger.length === 0) return [];
  const list = larger
    .map((p) => (Number.isFinite(p.maxPt) ? `${p.id}, ${formatMm(p.maxPt)}` : p.id))
    .join("; ");
  return [`use a ${axis === "width" ? "wider" : "taller"} profile (${list})`];
}

/** `a, b, or c` (capitalized). */
const listOptions = (options: readonly string[]): string =>
  capitalize(
    options.length <= 1
      ? options.join("")
      : `${options.slice(0, -1).join(", ")}, or ${options[options.length - 1]}`,
  );

/** Hint of `exceeds-page-width`: what makes this figure narrower, by engine and profile (#114). */
export function pageWidthHint(context: GeometryContext): string {
  const layout = isStructured(context)
    ? ["turn the widest `row` into a `stack` (or split it into several rows)", "reduce its `gap`"]
    : isHorizontal(context)
      ? ["lay it out top to bottom (layout.direction: down)"]
      : ["place fewer nodes side by side (split a wide layer, or group its nodes)"];
  const options = [...layout, "shorten long labels", ...profileAdvice(context, "width")];
  return `Sumi never shrinks a figure to fit. ${listOptions(options)}.`;
}

/** Hint of `exceeds-page-height`: what makes this figure shorter, by engine and profile (#114). */
export function pageHeightHint(context: GeometryContext): string {
  const layout = isStructured(context)
    ? [
        "turn the tallest `stack` into a `row` (or split it into several columns)",
        "reduce its `gap`",
      ]
    : isHorizontal(context)
      ? ["place fewer nodes on top of each other (split a tall layer, or group its nodes)"]
      : ["lay it out left to right (layout.direction: right)"];
  const options = [...layout, "split it into several figures", ...profileAdvice(context, "height")];
  return `Sumi never shrinks a figure to fit. ${listOptions(options)}.`;
}

export const exceedsPageWidth = defineGeometryRule({
  id: "geometry/exceeds-page-width",
  description:
    "The rendered figure (margin included) is wider than the profile's maximum page width.",
  defaultSeverity: "error",
  fixable: false,
  run(context) {
    const { profile } = context;
    const width = context.inspection.canvas.width.pt;
    if (profile.maxWidthPt === undefined || width <= profile.maxWidthPt + PT_EPSILON) return [];
    return [
      {
        message: `The figure is ${formatMm(width)} wide, more than the ${formatMm(profile.maxWidthPt)} maximum width of profile "${profile.id}".`,
        path: figurePath,
        subject: figureSubject(context),
        hint: pageWidthHint(context),
      },
    ];
  },
});

export const exceedsPageHeight = defineGeometryRule({
  id: "geometry/exceeds-page-height",
  description:
    "The rendered figure (margin included) is taller than the profile's maximum page height, if the profile sets one.",
  defaultSeverity: "error",
  fixable: false,
  run(context) {
    const { profile } = context;
    const height = context.inspection.canvas.height.pt;
    if (profile.maxHeightPt === undefined || height <= profile.maxHeightPt + PT_EPSILON) return [];
    return [
      {
        message: `The figure is ${formatMm(height)} tall, more than the ${formatMm(profile.maxHeightPt)} maximum height of profile "${profile.id}".`,
        path: figurePath,
        subject: figureSubject(context),
        hint: pageHeightHint(context),
      },
    ];
  },
});

export const textTooSmall = defineGeometryRule({
  id: "geometry/text-too-small",
  description:
    "A label is drawn with a font size below the profile's minimum (a safety net behind profile/font-too-small).",
  defaultSeverity: "error",
  fixable: false,
  run(context) {
    const findings: LintFinding[] = [];
    const min = context.profile.minFontSizePt;
    for (const element of context.elements) {
      // An icon (#94, no font file) is not text.
      const sizes = element.labels
        .filter((l) => l.fontPath !== "")
        .map((l) => unitsToPt(l.label.fontSizeUnits));
      const smallest = Math.min(...sizes);
      if (sizes.length === 0 || smallest >= min - PT_EPSILON) continue;
      findings.push({
        message: `The label of ${element.name} is drawn at ${formatPt(smallest)}, below the ${formatPt(min)} minimum font size of profile "${context.profile.id}".`,
        path: labelPath(element),
        subject: element.subject,
        hint: "Use a theme or variant with a larger font size. Sumi does not shrink text below the profile's minimum.",
      });
    }
    return findings;
  },
});

/** Shape names for messages. */
function shapeName(element: GeometryElement): string {
  if (element.ir.kind === "group") return "container";
  if (element.ir.kind === "node")
    return element.ir.render
      ? `custom outline (${element.ir.render.renderer})`
      : element.ir.shape === "oval"
        ? "ellipse"
        : element.ir.shape;
  return "shape";
}

export const labelOverflow = defineGeometryRule({
  id: "geometry/label-overflow",
  description:
    "A node's or group's label, re-measured with the theme's fonts, does not fit inside the area of its shape that can hold text.",
  defaultSeverity: "error",
  fixable: false,
  run(context) {
    const findings: LintFinding[] = [];
    for (const element of context.elements) {
      const { labelArea, bbox } = element;
      if (labelArea === undefined || bbox === undefined) continue;
      // The label must stay clear of the border's inner half.
      const margin = element.strokeInset - GEOMETRY_TOLERANCE_UNITS;
      const lines = element.labels.flatMap((l) => l.visibleLines);
      const overflows = lines.some((line) => rectDepthInside(labelArea, line) < margin);
      if (!overflows) continue;
      const box = unionOf(element.labels.flatMap((l) => (l.box === undefined ? [] : [l.box])));
      const { ir } = element;
      const explicit =
        ir.kind === "node" && !ir.autoSized && (ir.width !== undefined || ir.height !== undefined);
      const outside = box !== undefined && !rectsOverlap(box, bbox, 0);
      findings.push({
        message: hasIcon(element)
          ? `The icon of ${element.name} (${box === undefined ? "" : `${formatSize(box)}, `}1 em) does not fit inside its ${shapeName(element)} shape (${formatSize(bbox)})${outside ? "; it is drawn outside the shape" : ""}.`
          : `The label of ${element.name} (${box === undefined ? "" : `${formatSize(box)}, `}measured with the theme's fonts) does not fit inside its ${shapeName(element)} shape (${formatSize(bbox)})${outside ? "; it is drawn outside the shape" : ""}.`,
        path: explicit ? [...element.docPath, "props"] : labelPath(element),
        subject: element.subject,
        hint: explicit
          ? "Make props.width / props.height larger, or remove them so the node is sized to its label; or shorten the label or break it into lines (\\n)."
          : "Shorten the label or break it into lines (\\n), or use a shape with more room for text (e.g. box instead of diamond or circle).",
        ...(explicit && {
          related: [{ path: labelPath(element), message: "The label is defined here." }],
        }),
      });
    }
    return findings;
  },
});

export const outOfCanvas = defineGeometryRule({
  id: "geometry/out-of-canvas",
  description:
    "An element's shape, label (re-measured) or edge route extends outside the canvas, so it is clipped.",
  defaultSeverity: "error",
  fixable: false,
  run(context) {
    const { canvas } = context;
    const findings: LintFinding[] = [];
    for (const element of context.elements) {
      const rects: Rect[] = [
        ...(element.bbox === undefined ? [] : [element.bbox]),
        ...element.labels.flatMap((l) => (l.box === undefined ? [] : [l.box])),
        ...(element.route ?? []).flat().map((p: Point) => ({ ...p, width: 0, height: 0 })),
      ];
      const outside = rects.filter((r) => !rectInside(canvas, r, GEOMETRY_TOLERANCE_UNITS));
      if (outside.length === 0) continue;
      const by = Math.max(...outside.map((r) => overhang(canvas, r)));
      findings.push({
        message: `${capitalize(element.name)} extends ${formatPt(unitsToPt(by))} outside the canvas, so part of it is clipped.`,
        path: element.docPath,
        subject: element.subject,
        hint: "D2 normally sizes the canvas to its contents: shorten the label if it is a label that sticks out, and report the figure if the problem remains.",
      });
    }
    return findings;
  },
});

/** Hint of `node-overlap`: an `attach`ed node takes no space in the arrange tree (#114). */
export function nodeOverlapHint(
  context: GeometryContext,
  a: GeometryElement,
  b: GeometryElement,
): string {
  const attached = [a, b].find((e) => e.ir.kind === "node" && e.ir.attach !== undefined);
  if (attached !== undefined && attached.ir.kind === "node" && attached.ir.attach !== undefined) {
    const target = context.get(attached.ir.attach.to);
    const to = target === undefined ? "its target" : target.name;
    return `${capitalize(attached.name)} is attached to ${to}, and an attached node takes no space in the arrange tree, so it can cover its neighbours. Put it in the arrange tree instead, attach it to a free side, or widen the \`gap\` next to ${to}.`;
  }
  return isStructured(context)
    ? "Elements overlap only when one contains the other through `group`. Check explicit sizes (props.width / props.height) and the arrange tree."
    : "Elements overlap only when one contains the other through `group`. Check explicit sizes, or put the nodes in the same group.";
}

export const nodeOverlap = defineGeometryRule({
  id: "geometry/node-overlap",
  description:
    "The shapes of two nodes or groups overlap, and neither contains the other in the group tree.",
  defaultSeverity: "warning",
  fixable: false,
  run(context) {
    const findings: LintFinding[] = [];
    const shapes = context.elements.filter((e) => e.bbox !== undefined && e.kind !== "edge");
    for (const [i, a] of shapes.entries()) {
      for (const b of shapes.slice(i + 1)) {
        if (context.isAncestor(a.key, b.key) || context.isAncestor(b.key, a.key)) continue;
        if (a.bbox === undefined || b.bbox === undefined) continue;
        const custom =
          (a.ir.kind === "node" && a.ir.render !== undefined) ||
          (b.ir.kind === "node" && b.ir.render !== undefined);
        if (custom && a.outline && b.outline) {
          if (!regionsOverlap(a.outline, b.outline, GEOMETRY_TOLERANCE_UNITS)) continue;
        } else if (!rectsOverlap(a.bbox, b.bbox, GEOMETRY_TOLERANCE_UNITS)) continue;
        findings.push({
          message: `The shapes of ${a.name} and ${b.name} overlap.`,
          path: a.docPath,
          subject: a.subject,
          hint: nodeOverlapHint(context, a, b),
          related: [{ path: b.docPath, message: `${capitalize(b.name)} is defined here.` }],
        });
      }
    }
    return findings;
  },
});

/**
 * A group's border as a closed polyline: its rectangle with the corners
 * rounded by `radius` (clamped to half the sides, as the writers draw it),
 * each corner flattened into {@link CUBIC_STEPS} chords.
 */
export function borderOf({ x, y, width, height }: Rect, radius = 0): Point[] {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  if (r === 0) {
    return [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
      { x, y },
    ];
  }
  const corners: [number, number, number][] = [
    [x + width - r, y + r, -Math.PI / 2],
    [x + width - r, y + height - r, 0],
    [x + r, y + height - r, Math.PI / 2],
    [x + r, y + r, Math.PI],
  ];
  const points: Point[] = [];
  for (const [cx, cy, start] of corners) {
    for (let i = 0; i <= CUBIC_STEPS; i++) {
      const a = start + (i / CUBIC_STEPS) * (Math.PI / 2);
      points.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
  }
  points.push(points[0] as Point);
  return points;
}

/**
 * Label collisions: label vs label of another element, label vs another
 * node's shape, and label across a group's border (#116).
 */
export const labelCollision = defineGeometryRule({
  id: "geometry/label-collision",
  description:
    "A label (re-measured) overlaps a label of another element, the shape of another node, or the border of a group.",
  defaultSeverity: "warning",
  fixable: false,
  run(context) {
    const findings: LintFinding[] = [];
    const tolerance = GEOMETRY_TOLERANCE_UNITS;
    const labelled = context.elements.filter((e) => e.labels.length > 0);
    const lineBoxes = (e: GeometryElement) => e.labels.flatMap((l) => l.visibleLines);
    const reported = new Set<string>();
    const report = (a: GeometryElement, b: GeometryElement, what: string, hint?: string) => {
      const pair = [a.key, b.key].sort().join(" ");
      if (reported.has(pair)) return;
      reported.add(pair);
      findings.push({
        message: `The ${contentNoun(a)} of ${a.name} overlaps ${what} of ${b.name}.`,
        path: labelPath(a),
        subject: a.subject,
        hint:
          hint ??
          (a.kind === "group" || b.kind === "group"
            ? `Overlapping text is hard to read. Move the group's title with labelAt (top-left, top, top-right, bottom-left, bottom or bottom-right), shorten the labels, or change the ${isStructured(context) ? "arrangement (gap, anchors, attach side, edge labels)" : "layout (direction, grouping, edge labels)"}.`
            : isStructured(context)
              ? "Overlapping text is hard to read. Shorten the labels, or change the arrangement (gap, anchors, attach side, edge labels)."
              : "Overlapping text is hard to read. Shorten the labels, or change the layout (direction, grouping, edge labels)."),
        related: [{ path: b.docPath, message: `${capitalize(b.name)} is defined here.` }],
      });
    };
    for (const [i, a] of labelled.entries()) {
      const boxesA = lineBoxes(a);
      for (const b of labelled.slice(i + 1)) {
        const boxesB = lineBoxes(b);
        if (boxesA.some((ra) => boxesB.some((rb) => rectsOverlap(ra, rb, tolerance)))) {
          report(a, b, `the ${contentNoun(b)}`);
        }
      }
    }
    // Labels over node shapes. Group shapes are left out: elements inside a
    // group are drawn over it on purpose, and group labels are covered above.
    for (const a of labelled) {
      const boxesA = lineBoxes(a);
      for (const b of context.elements) {
        if (b === a || b.kind !== "node" || b.outline === undefined) continue;
        const { outline } = b;
        if (boxesA.some((r) => regionIntersectsRect(outline, r, tolerance))) {
          report(a, b, "the shape");
        }
      }
    }
    // Labels on a group's border (#116): the border's stroke comes within the
    // tolerance of the text's line box, so it runs through or along the text
    // (and an edge label's background hides it there), e.g. an edge label
    // where the edge crosses into a group. Inside or outside the group is
    // fine; the group's own label is left out, and so are groups drawn
    // without a border.
    for (const a of labelled) {
      const boxesA = lineBoxes(a);
      for (const b of context.elements) {
        if (b === a || b.ir.kind !== "group" || b.bbox === undefined) continue;
        const { style } = b.ir;
        if (style.strokeWidth.units === 0 || style.stroke === "transparent") continue;
        const border = [borderOf(b.bbox, style.radius.units)];
        const reach = b.strokeInset + tolerance;
        const grown = (r: Rect): Rect => ({
          x: r.x - reach,
          y: r.y - reach,
          width: r.width + 2 * reach,
          height: r.height + 2 * reach,
        });
        if (boxesA.some((r) => polylinesCrossRect(border, grown(r), 0))) {
          report(
            a,
            b,
            "the border",
            isStructured(context)
              ? "A border through the text is hard to read. An edge label sits beside the arrowhead: widen the gap before the group so the label fits outside it, move the edge's ends (fromAnchor / toAnchor), or shorten the label."
              : "A border through the text is hard to read. Shorten the label, or change the layout (direction, grouping) so the edge crosses the border elsewhere.",
          );
        }
      }
    }
    return findings;
  },
});

/** Where a group's title is, in words, and other `labelAt` values to suggest (#127). */
const GROUP_LABEL_WORDS: Readonly<Record<GroupLabelPosition, { at: string; others: string }>> = {
  "top-left": { at: "top-left corner", others: "top-right or bottom" },
  top: { at: "top centre", others: "top-left, top-right or bottom" },
  "top-right": { at: "top-right corner", others: "top-left or bottom" },
  "bottom-left": { at: "bottom-left corner", others: "bottom-right or top" },
  bottom: { at: "bottom centre", others: "bottom-left, bottom-right or top" },
  "bottom-right": { at: "bottom-right corner", others: "bottom-left or top" },
};

/** A group's effective `labelAt`: the engine's default when omitted (#127). */
function groupLabelAt(context: GeometryContext, group: GeometryElement): GroupLabelPosition {
  const written = group.ir.kind === "group" ? group.ir.labelAt : undefined;
  return written ?? (isStructured(context) ? "top" : "top-left");
}

/**
 * Hint of `edge-crosses-label`, by engine: group titles and the means to move
 * edges differ (#114). A group's title is where its `labelAt` puts it (#127).
 */
export function edgeCrossesLabelHint(context: GeometryContext, other: GeometryElement): string {
  const group =
    other.kind === "group" ? GROUP_LABEL_WORDS[groupLabelAt(context, other)] : undefined;
  if (isStructured(context)) {
    if (group === undefined)
      return "Move the edge's ends with fromAnchor / toAnchor, move the label (attach it to another side, or reorder the arrange items), or shorten the label.";
    const from = group.at.startsWith("bottom") ? "below" : "above";
    return `A group's title sits at the ${group.at} of the group, so an edge that enters the group from ${from} crosses it. Move the title with labelAt (e.g. ${group.others}), connect an element inside the group instead of the group, move the end with fromAnchor / toAnchor (e.g. ${from === "above" ? "north" : "south"}:0.85), reorder the arrange items so the edge comes from another side, or shorten the title.`;
  }
  if (group === undefined)
    return "Change the layout (direction or grouping) so the edge is routed around the label, or shorten the label.";
  const from = group.at.startsWith("bottom") ? "below" : "above";
  return `A container's label sits at its ${group.at}, so edges that enter the container from ${from} can cross it when the label is wide. Move the label with labelAt (e.g. ${group.others}), shorten the label, connect elements inside the container instead of the container itself, or change layout.direction.`;
}

export const edgeCrossesLabel = defineGeometryRule({
  id: "geometry/edge-crosses-label",
  description:
    "An edge's route passes through the label (re-measured) of another element, such as a container label.",
  defaultSeverity: "warning",
  fixable: false,
  run(context) {
    const findings: LintFinding[] = [];
    for (const edge of context.elements) {
      const { route } = edge;
      if (route === undefined) continue;
      for (const other of context.elements) {
        if (other === edge) continue;
        const crossed = other.labels
          .flatMap((l) => l.visibleLines)
          .some((box) => polylinesCrossRect(route, box, GEOMETRY_TOLERANCE_UNITS));
        if (!crossed) continue;
        findings.push({
          message: `${capitalize(edge.name)} crosses the ${contentNoun(other)} of ${other.name}.`,
          path: edge.docPath,
          subject: edge.subject,
          hint: edgeCrossesLabelHint(context, other),
          related: [{ path: labelPath(other), message: "The label is defined here." }],
        });
      }
    }
    return findings;
  },
});

export const edgeThroughNode = defineGeometryRule({
  id: "geometry/edge-through-node",
  description: "An edge's route passes through the shape of a node that is not one of its ends.",
  defaultSeverity: "warning",
  fixable: false,
  run(context) {
    // The structured router (#90) avoids nodes by design; this re-checks it
    // independently, and checks D2 / ELK routes (`auto`) the same way. Nodes
    // without a drawn shape (`text`) are left to `edge-crosses-label`.
    const obstacles: RouteObstacle[] = context.elements.flatMap((e) =>
      e.kind === "node" && e.outline !== undefined ? [{ key: e.key, region: e.outline }] : [],
    );
    const findings: LintFinding[] = [];
    for (const edge of context.elements) {
      if (edge.route === undefined || edge.ir.kind !== "edge") continue;
      const ends = new Set([edge.ir.from, edge.ir.to]);
      for (const key of obstaclesCrossedByRoute(
        edge.route,
        obstacles,
        ends,
        GEOMETRY_TOLERANCE_UNITS,
      )) {
        const node = context.get(key) as GeometryElement;
        findings.push({
          message: `${capitalize(edge.name)} passes through the shape of ${node.name}.`,
          path: edge.docPath,
          subject: edge.subject,
          hint: "An edge should go around the nodes it does not connect. In a structured figure, change its anchors (fromAnchor / toAnchor) or leave a free channel between the nodes; in an auto figure, change layout.direction or the grouping.",
          related: [{ path: node.docPath, message: `${capitalize(node.name)} is defined here.` }],
        });
      }
    }
    return findings;
  },
});

export const aspectDistorted = defineGeometryRule({
  id: "geometry/aspect-distorted",
  description:
    "A fixed-aspect node (circle, square) is drawn with unequal width and height, typically stretched by the layout engine.",
  defaultSeverity: "warning",
  fixable: false,
  run(context) {
    const findings: LintFinding[] = [];
    for (const element of context.elements) {
      const { ir, bbox } = element;
      if (ir.kind !== "node" || ir.sizing !== "fixed-aspect-1" || bbox === undefined) continue;
      if (Math.abs(bbox.width - bbox.height) <= GEOMETRY_TOLERANCE_UNITS) continue;
      findings.push({
        message: `The ${ir.shape} ${element.name} is drawn ${formatSize(bbox)}, not with equal width and height.`,
        path: element.docPath,
        subject: element.subject,
        hint: "The layout engine (ELK) enlarges nodes with many edges or a self-loop along one axis. Reduce the edges at the node, or use an ellipse or box if the aspect does not matter.",
      });
    }
    return findings;
  },
});

/**
 * The edges that close a cycle when the figure is read in declaration order
 * (#31): a depth-first search from the sources (elements without incoming
 * edges), then from the remaining elements, all in IR order, following edges
 * in document order. An edge to an element still on the search path closes a
 * cycle. These are the edges a reader expects to run against the layout
 * direction (e.g. a "retry" edge back to an earlier step).
 *
 * ELK lays out a group as one block among its siblings, so an edge that
 * crosses group boundaries is followed both between its endpoints and between
 * their ancestors that are children of the lowest common ancestor: `g -> b`
 * and `b -> a` (with `a` inside group `g`) form the cycle `g -> b -> g`,
 * closed by `b -> a`.
 */
export function cycleClosingEdges(
  ir: FigureIR,
  isLayoutEdge: (edge: EdgeIR) => boolean,
): ReadonlySet<ElementKey> {
  const vertices: ElementKey[] = [...ir.groups, ...ir.nodes].map((e) => e.key);
  /** The element's ancestors from the root down, ending with the element itself. */
  const chain = (key: ElementKey): ElementKey[] => {
    const keys: ElementKey[] = [];
    const seen = new Set<ElementKey>();
    for (let k: ElementKey | undefined = key; k !== undefined && !seen.has(k); ) {
      seen.add(k);
      keys.unshift(k);
      const element = ir.elements.get(k);
      k = element === undefined || element.kind === "edge" ? undefined : element.parent;
    }
    return keys;
  };
  /** The endpoints projected onto the children of their lowest common ancestor. */
  const project = (edge: EdgeIR): [ElementKey, ElementKey] => {
    const from = chain(edge.from);
    const to = chain(edge.to);
    let i = 0;
    while (i < from.length - 1 && i < to.length - 1 && from[i] === to[i]) i++;
    return [from[i] as ElementKey, to[i] as ElementKey];
  };
  const outgoing = new Map<ElementKey, { edge: EdgeIR; to: ElementKey }[]>(
    vertices.map((key) => [key, []]),
  );
  const hasIncoming = new Set<ElementKey>();
  for (const edge of ir.edges) {
    if (!isLayoutEdge(edge)) continue;
    // The edge itself orders the elements; its projection adds the cycles it
    // forms with edges of the enclosing groups.
    const [from, to] = project(edge);
    const pairs: [ElementKey, ElementKey][] = [[edge.from, edge.to]];
    if (from !== to && (from !== edge.from || to !== edge.to)) pairs.push([from, to]);
    for (const [f, t] of pairs) {
      outgoing.get(f)?.push({ edge, to: t });
      hasIncoming.add(t);
    }
  }
  const closing = new Set<ElementKey>();
  const visited = new Set<ElementKey>();
  const onPath = new Set<ElementKey>();
  const roots = [
    ...vertices.filter((key) => !hasIncoming.has(key)),
    ...vertices.filter((key) => hasIncoming.has(key)),
  ];
  for (const root of roots) {
    if (visited.has(root)) continue;
    // Iterative DFS: each frame is a vertex and the index of its next edge.
    const stack: { key: ElementKey; next: number }[] = [{ key: root, next: 0 }];
    visited.add(root);
    onPath.add(root);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1] as { key: ElementKey; next: number };
      const step = (outgoing.get(frame.key) ?? [])[frame.next++];
      if (step === undefined) {
        onPath.delete(frame.key);
        stack.pop();
        continue;
      }
      if (onPath.has(step.to)) {
        closing.add(step.edge.key);
      } else if (!visited.has(step.to)) {
        visited.add(step.to);
        onPath.add(step.to);
        stack.push({ key: step.to, next: 0 });
      }
    }
  }
  return closing;
}

const DIRECTION_WORDS: Readonly<Record<FigureIR["meta"]["direction"], string>> = {
  down: "above",
  up: "below",
  right: "to the left of",
  left: "to the right of",
};

/**
 * `true` if `target` lies entirely before `source` along the layout direction,
 * i.e. an edge from `source` to `target` runs against it.
 */
function isBefore(
  direction: FigureIR["meta"]["direction"],
  source: Rect,
  target: Rect,
  tolerance: number,
): boolean {
  switch (direction) {
    case "down":
      return target.y + target.height <= source.y + tolerance;
    case "up":
      return target.y >= source.y + source.height - tolerance;
    case "right":
      return target.x + target.width <= source.x + tolerance;
    case "left":
      return target.x >= source.x + source.width - tolerance;
  }
}

export const reversedEdge = defineGeometryRule({
  id: "geometry/reversed-edge",
  description:
    "An arrow is drawn against layout.direction although it does not close a cycle in declaration order: the layout engine reversed a different edge of the cycle than the source implies.",
  defaultSeverity: "warning",
  fixable: false,
  run(context) {
    const { ir } = context;
    // `layout.direction` and ELK's cycle breaking belong to the auto engine: a
    // structured figure places every element where its arrange tree says (#91).
    if (ir.meta.engine === "structured") return [];
    const { direction } = ir.meta;
    // Self-loops have no direction, and edges between a group and its
    // descendants are lint/ancestor-edge's concern.
    const isLayoutEdge = (edge: EdgeIR) =>
      edge.from !== edge.to &&
      !context.isAncestor(edge.from, edge.to) &&
      !context.isAncestor(edge.to, edge.from);
    const closing = cycleClosingEdges(ir, isLayoutEdge);
    const boxOf = (key: ElementKey): Rect | undefined => {
      const element = context.get(key);
      if (element === undefined) return undefined;
      return element.bbox ?? unionOf(element.labels.flatMap((l) => l.visibleLines));
    };
    const findings: LintFinding[] = [];
    for (const edge of ir.edges) {
      // Only one-way arrows show a direction; lines and double arrows do not.
      if (edge.direction !== "forward" || !isLayoutEdge(edge) || closing.has(edge.key)) continue;
      const source = boxOf(edge.from);
      const target = boxOf(edge.to);
      const element = context.get(edge.key);
      if (source === undefined || target === undefined || element === undefined) continue;
      if (!isBefore(direction, source, target, GEOMETRY_TOLERANCE_UNITS)) continue;
      const from = context.get(edge.from);
      const to = context.get(edge.to);
      if (from === undefined || to === undefined) continue;
      findings.push({
        message: `${capitalize(element.name)} points against layout.direction (${direction}): ${to.name} is drawn ${DIRECTION_WORDS[direction]} ${from.name}, although the edge does not close a cycle in declaration order.`,
        path: element.docPath,
        subject: element.subject,
        hint: "The layout engine (ELK) reverses one edge of every cycle, and inside a container it may pick a different one than intended. Declare the cycle's nodes in a different order (e.g. swap them in `nodes`), or move the cycle out of the container.",
        related: [{ path: to.docPath, message: `${capitalize(to.name)} is defined here.` }],
      });
    }
    return findings;
  },
});

/** The built-in geometry rules, all enabled by default. */
export const BUILTIN_GEOMETRY_RULES: readonly GeometryRule[] = Object.freeze([
  exceedsPageWidth,
  exceedsPageHeight,
  textTooSmall,
  labelOverflow,
  outOfCanvas,
  nodeOverlap,
  labelCollision,
  edgeCrossesLabel,
  edgeThroughNode,
  aspectDistorted,
  reversedEdge,
] as GeometryRule[]);
