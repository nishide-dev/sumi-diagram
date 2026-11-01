/**
 * Geometry lint rules (stage `geometry`, #13): checks on the rendered SVG's
 * geometry, with labels re-measured from the theme's TTF files. Tolerances
 * and limits are documented in design doc §6.5 and docs/lint-rules.md.
 *
 * None of these rules changes the figure: Sumi never shrinks text or the
 * canvas to make a problem go away (design doc §5). A figure the author
 * shrinks with `figure.fit: scale` (#183, §6.48) is checked at its printed
 * size: the page limits and the text sizes are measured after the scale.
 */

import type { EdgeIR, FigureIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";
import type { DocPath } from "../../core/diagnostics";
import type { GroupLabelPosition } from "../../core/figure/schema";
import { BUILTIN_PROFILES } from "../../core/profile/builtin";
import { formatMm, formatPt, mmToPt, ptToD2Units } from "../../core/units";
import { ARROWHEAD_STEM_UNITS, arrowheadLength } from "../../layout/route/arrowhead";
import { type Point, type Rect, unitsToMm, unitsToPt } from "../../render/geometry";
import type { ProfileLimits } from "../../render/inspect";
import { printedSize } from "../../render/size";
import { defineGeometryRule, type GeometryRule, type LintFinding } from "../rule";
import { arrowheadStraightRun } from "./arrowheads";
import type { GeometryContext, GeometryElement } from "./context";
import { obstaclesCrossedByRoute, type RouteObstacle } from "./edges";
import { groupEmptySpace } from "./empty-space";
import { microJogLengths } from "./jogs";
import { inkLines, unionOf } from "./measure";
import { regionsOverlap } from "./outlines";
import {
  axisSegments,
  type Bundle,
  COINCIDENT_UNITS,
  type Piece,
  PieceIndex,
  parallelRun,
  polylinesRectDistance,
  rectSides,
} from "./proximity";
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

/**
 * Printed size ÷ drawn size (#183, `figure.fit: scale`; 1 otherwise). Element
 * geometry stays in drawing units: containment and intersection are checked
 * there as drawn, while physical thresholds (a gap in pt, a run in mm) are
 * converted with {@link drawnUnits} and reported lengths with {@link printedUnits}.
 */
const printScale = (context: GeometryContext): number => context.inspection.scale ?? 1;

/** A length given at printed size (in units of 0.5pt), in drawing units. */
const drawnUnits = (context: GeometryContext, units: number): number => units / printScale(context);

/** A drawn length in units, at its printed size (still in units of 0.5pt). */
const printedUnits = (context: GeometryContext, units: number): number =>
  units * printScale(context);

const formatSize = (context: GeometryContext, rect: Rect): string =>
  `${formatPt(unitsToPt(printedUnits(context, rect.width)))} × ${formatPt(unitsToPt(printedUnits(context, rect.height)))}`;

const figurePath: DocPath = ["figure"];

function figureSubject(context: GeometryContext) {
  return { kind: "figure", id: context.ir.meta.id } as const;
}

/**
 * Where a label is written: `label`, or `icon` for a node that draws an icon
 * in its place (#94). A caption's text is the `caption` field itself (#130).
 */
const labelPath = (element: GeometryElement): DocPath =>
  isCaption(element) ? element.docPath : [...element.docPath, hasIcon(element) ? "icon" : "label"];

const isCaption = (element: GeometryElement): boolean =>
  element.ir.kind === "node" && element.ir.captionOf !== undefined;

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
  const { widthPt, heightPt } = printedSize(context.inspection);
  const larger = largerBuiltinProfiles(context.profile, axis, { widthPt, heightPt });
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
  const fit = `Or print it smaller as drawn with \`figure.fit: scale\` (its text must then print at ${formatPt(scaledMinFontSizePt(context.profile))} or more).`;
  return `Sumi never shrinks a figure on its own. ${listOptions(options)}. ${fit}`;
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
  return context.ir.meta.fit === "scale"
    ? `\`figure.fit: scale\` shrinks a figure to the page width only. ${listOptions(options)}.`
    : `Sumi never shrinks a figure to fit. ${listOptions(options)}.`;
}

/** The minimum printed font size of a figure shrunk by `figure.fit: scale` (#183). */
export const scaledMinFontSizePt = (profile: ProfileLimits): number =>
  profile.minScaledFontSizePt ?? profile.minFontSizePt;

/** ` (7pt shrunk to 70% by figure.fit: scale)`, or nothing for a figure printed at its natural size. */
function scaleNote(drawnPt: number, scale: number): string {
  return scale === 1
    ? ""
    : ` (${formatPt(drawnPt)} shrunk to ${Math.round(scale * 1000) / 10}% by figure.fit: scale)`;
}

export const exceedsPageWidth = defineGeometryRule({
  id: "geometry/exceeds-page-width",
  description:
    "The rendered figure (margin included) is wider than the profile's maximum page width.",
  defaultSeverity: "error",
  fixable: false,
  run(context) {
    const { profile } = context;
    const width = printedSize(context.inspection).widthPt;
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
    const height = printedSize(context.inspection).heightPt;
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

/**
 * The scale the figure is printed at and the minimum font size that applies:
 * `minFontSize`, or for a figure shrunk by `figure.fit: scale` (#183) the
 * profile's `minScaledFontSize`.
 */
function textLimits(context: GeometryContext): { scale: number; minPt: number; scaled: boolean } {
  const { scale } = printedSize(context.inspection);
  const scaled = scale < 1;
  return {
    scale,
    scaled,
    minPt: scaled ? scaledMinFontSizePt(context.profile) : context.profile.minFontSizePt,
  };
}

const SCALED_TEXT_HINT =
  "Make the figure narrower so `figure.fit: scale` shrinks it less (see the suggestions of geometry/exceeds-page-width without `fit`), or use a wider profile.";

export const textTooSmall = defineGeometryRule({
  id: "geometry/text-too-small",
  description:
    "A label is printed with a font size below the profile's minimum (a safety net behind profile/font-too-small), or, in a figure shrunk by figure.fit: scale, below the profile's minimum for scaled figures.",
  defaultSeverity: "error",
  fixable: false,
  run(context) {
    const findings: LintFinding[] = [];
    const { scale, scaled, minPt: min } = textLimits(context);
    for (const element of context.elements) {
      if (element.ir.kind !== "node" || !element.bbox) continue;
      const image = element.ir.image;
      const measured = context.html?.get(element.key);
      if (!measured || !image?.viewport) continue;
      const sx = element.bbox.width / image.viewport.width;
      const sy = element.bbox.height / image.viewport.height;
      // SVG image preserveAspectRatio: meet / slice / non-uniform fill. For
      // fill use the smaller axis, so compressed text cannot evade the rule.
      const placedScale = image.fit === "cover" ? Math.max(sx, sy) : Math.min(sx, sy);
      const reported = new Set<number>();
      for (const run of measured.texts) {
        const pt = unitsToPt(run.fontSize * placedScale) * scale;
        if (!run.text.trim() || pt >= min - PT_EPSILON || reported.has(run.offset)) continue;
        reported.add(run.offset);
        findings.push({
          message: `HTML text of ${element.name} is printed at ${formatPt(pt)}, below the ${formatPt(min)} minimum font size of profile "${context.profile.id}"${scaled ? " for a scaled figure" : ""}.`,
          path: [...image.srcAt.path],
          span: [run.offset, run.offset],
          literalBlock: true,
          subject: element.subject,
          hint: `Increase CSS font-size, increase the component's placed size relative to viewport, or reduce viewport while keeping content inside it.${scaled ? ` ${SCALED_TEXT_HINT}` : ""}`,
        });
      }
    }
    for (const element of context.elements) {
      // An icon (#94, no font file) is not text.
      const sizes = element.labels
        .filter((l) => l.fontPath !== "")
        .map((l) => unitsToPt(l.label.fontSizeUnits));
      const smallest = Math.min(...sizes);
      if (sizes.length === 0 || smallest * scale >= min - PT_EPSILON) continue;
      // A node's sublabel (#184) is its second <text>, smaller than the label:
      // name it when only it is too small.
      const sublabel =
        element.ir.kind === "node" &&
        element.ir.sublabel !== undefined &&
        sizes.length === 2 &&
        (sizes[0] as number) * scale >= min - PT_EPSILON;
      const what = sublabel ? "sublabel" : "label";
      findings.push({
        message: scaled
          ? `The ${what} of ${element.name} is printed at ${formatPt(smallest * scale)}${scaleNote(smallest, scale)}, below the ${formatPt(min)} minimum font size of profile "${context.profile.id}" for a scaled figure.`
          : `The ${what} of ${element.name} is drawn at ${formatPt(smallest)}, below the ${formatPt(min)} minimum font size of profile "${context.profile.id}".`,
        path: sublabel ? [...element.docPath, "sublabel"] : labelPath(element),
        subject: element.subject,
        hint: sublabel
          ? `A sublabel is drawn at 7/8 of its node's font size (rounded down to 0.5pt). ${scaled ? SCALED_TEXT_HINT : "Use a theme or variant with a larger font size."} Or write the text into the label, at the label's size.`
          : scaled
            ? SCALED_TEXT_HINT
            : "Use a theme or variant with a larger font size. Sumi does not shrink text below the profile's minimum.",
      });
    }
    return findings;
  },
});

/** How many labels `script-too-small` names before "and N more". */
const SCRIPT_NAMES = 3;

/**
 * Subscripts and superscripts of label math (#93) are set at 0.7 of the
 * label's size and are exempt from `text-too-small` (TeX's convention, design
 * doc §6.24). Once `figure.fit: scale` shrinks the figure (#183, §6.48) they
 * can become hard to read, so they are reported, as information, when they
 * print below the scaled minimum. A figure at its natural size is not checked.
 * One finding per figure (at `figure.fit`), naming the labels: a figure with
 * math usually has many, and they all shrink by the same factor.
 */
export const scriptTooSmall = defineGeometryRule({
  id: "geometry/script-too-small",
  description:
    "In a figure shrunk by figure.fit: scale, a subscript or superscript of label math prints below the profile's minimum font size for scaled figures.",
  defaultSeverity: "info",
  fixable: false,
  run(context) {
    const { scale, scaled, minPt: min } = textLimits(context);
    if (!scaled) return [];
    const small: { name: string; pt: number }[] = [];
    for (const element of context.elements) {
      const scripts = element.labels.flatMap(({ label }) =>
        (label.runs ?? [])
          .flat()
          .filter((run) => run.fontSizeUnits < label.fontSizeUnits)
          .map((run) => unitsToPt(run.fontSizeUnits)),
      );
      const smallest = Math.min(...scripts);
      if (scripts.length > 0 && smallest * scale < min - PT_EPSILON)
        small.push({ name: element.name, pt: smallest });
    }
    if (small.length === 0) return [];
    const smallest = Math.min(...small.map((s) => s.pt));
    const names = small.slice(0, SCRIPT_NAMES).map((s) => s.name);
    const more = small.length - names.length;
    const where =
      more > 0
        ? `${names.join(", ")} and ${more} more label${more === 1 ? "" : "s"}`
        : names.length === 1
          ? names.join("")
          : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    const finding: LintFinding = {
      message: `Subscripts or superscripts of label math print at down to ${formatPt(smallest * scale)}${scaleNote(smallest, scale)}, below the ${formatPt(min)} minimum font size of profile "${context.profile.id}" for a scaled figure: in ${where}.`,
      path: ["figure", "fit"],
      subject: figureSubject(context),
      hint: `Scripts are exempt from the minimum at the natural size, so this is information only. If they are too small to read, ${SCALED_TEXT_HINT.charAt(0).toLowerCase()}${SCALED_TEXT_HINT.slice(1)}`,
    };
    return [finding];
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
      const overflows = lines.some(
        (line) =>
          rectDepthInside(labelArea, line) < margin ||
          (element.labelBoundaries !== undefined &&
            element.ir.style.stroke !== "transparent" &&
            element.ir.style.strokeWidth.units > 0 &&
            polylinesCrossRect(element.labelBoundaries, line, -margin)),
      );
      if (!overflows) continue;
      const box = unionOf(element.labels.flatMap((l) => (l.box === undefined ? [] : [l.box])));
      const { ir } = element;
      const explicit =
        ir.kind === "node" && !ir.autoSized && (ir.width !== undefined || ir.height !== undefined);
      const outside = box !== undefined && !rectsOverlap(box, bbox, 0);
      findings.push({
        message: hasIcon(element)
          ? `The icon of ${element.name} (${box === undefined ? "" : `${formatSize(context, box)}, `}1 em) does not fit inside its ${shapeName(element)} shape (${formatSize(context, bbox)})${outside ? "; it is drawn outside the shape" : ""}.`
          : `The label of ${element.name} (${box === undefined ? "" : `${formatSize(context, box)}, `}measured with the theme's fonts) does not fit inside its ${shapeName(element)} shape (${formatSize(context, bbox)})${outside ? "; it is drawn outside the shape" : ""}.`,
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
        message: `${capitalize(element.name)} extends ${formatPt(unitsToPt(printedUnits(context, by)))} outside the canvas, so part of it is clipped.`,
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
/** `true` for a zoom edge (#176): straight lines between corners, not routed, no anchors. */
const isZoom = (e: GeometryElement): boolean => e.ir.kind === "edge" && e.ir.routing === "zoom";

/** What moves a zoom edge's lines (#176): its anchors do not. */
const ZOOM_MOVES =
  "A zoom edge's lines run straight between corners of its ends; fromAnchor / toAnchor do not move them. Move the source or the zoomed-in view (the order of the arrange items, a gap, another row or stack)";

/** Hint of the label rules for a zoom edge. */
const zoomLabelHint = (): string =>
  `${ZOOM_MOVES} so the lines pass beside the label, or move the label away: a group title with labelAt, a caption or text node elsewhere in the tree, or a shorter label.`;

/** Hint of the proximity rules for a zoom edge. */
const zoomLineHint = (): string =>
  `${ZOOM_MOVES} so the line does not run along the border or the other line.`;

export function edgeCrossesLabelHint(context: GeometryContext, other: GeometryElement): string {
  if (isCaption(other)) {
    // The structured router goes around a caption (a node); D2/ELK does not
    // know the caption is there (the label of a container around the group, #130).
    return isStructured(context)
      ? "A group's caption sits centred below the group. Move the edge's ends with fromAnchor / toAnchor (e.g. leave the group from a side), or change the arrangement so the edge does not pass below the group."
      : "A group's caption sits centred below the group, and the auto layout does not route edges around it: an edge that leaves or passes the group downwards crosses it. Change layout.direction so the edge leaves the group sideways, connect elements beside the group, or use the structured layout, whose router goes around captions.";
  }
  const group =
    other.kind === "group" ? GROUP_LABEL_WORDS[groupLabelAt(context, other)] : undefined;
  if (isStructured(context)) {
    if (group === undefined)
      return "Move the edge's ends with fromAnchor / toAnchor, move the label (attach it to another side, or reorder the arrange items), or shorten the label.";
    const at = groupLabelAt(context, other);
    const from = at.startsWith("bottom") ? "below" : "above";
    // An anchor on the title's side, away from the title: the far end from a
    // corner title, and off the centre (as before #127) for a centred one.
    const fraction = at.endsWith("-right") ? "0.15" : "0.85";
    const anchor = `${from === "above" ? "north" : "south"}:${fraction}`;
    return `A group's title sits at the ${group.at} of the group: if an edge enters the group from ${from} near the title, it crosses the title. Move the title with labelAt (e.g. ${group.others}), connect an element inside the group instead of the group, move the end away from the title with fromAnchor / toAnchor (e.g. ${anchor}), reorder the arrange items so the edge comes from another side, or shorten the title.`;
  }
  if (group === undefined)
    return "Change the layout (direction or grouping) so the edge is routed around the label, or shorten the label.";
  const from = group.at.startsWith("bottom") ? "below" : "above";
  return `A container's label sits at its ${group.at}: if edges enter the container from ${from}, they can cross it when the label is wide. Move the label with labelAt (e.g. ${group.others}), shorten the label, connect elements inside the container instead of the container itself, or change layout.direction.`;
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
          hint: isZoom(edge) ? zoomLabelHint() : edgeCrossesLabelHint(context, other),
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
      // A zoom edge's straight lines are not routed around nodes (#176): zoom-crosses-node.
      if (edge.ir.routing === "zoom") continue;
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

export const zoomCrossesNode = defineGeometryRule({
  id: "geometry/zoom-crosses-node",
  description:
    "A line of a zoom edge (a straight line from a corner of the source to a corner of the target) passes through the shape of a node that is not one of its ends.",
  defaultSeverity: "warning",
  fixable: false,
  run(context) {
    // Zoom lines (#176, design doc §6.45) are straight on purpose: bent
    // around a node, they would no longer read as a callout, so they are
    // not routed and a node in the way is reported instead.
    const obstacles: RouteObstacle[] = context.elements.flatMap((e) =>
      e.kind === "node" && e.outline !== undefined ? [{ key: e.key, region: e.outline }] : [],
    );
    const findings: LintFinding[] = [];
    for (const edge of context.elements) {
      if (edge.route === undefined || edge.ir.kind !== "edge" || edge.ir.routing !== "zoom")
        continue;
      const ends = new Set([edge.ir.from, edge.ir.to]);
      for (const key of obstaclesCrossedByRoute(
        edge.route,
        obstacles,
        ends,
        GEOMETRY_TOLERANCE_UNITS,
      )) {
        const node = context.get(key) as GeometryElement;
        findings.push({
          message: `A line of ${edge.name} passes through the shape of ${node.name}.`,
          path: edge.docPath,
          subject: edge.subject,
          hint: "A zoom edge draws straight lines between corners of its ends and does not go around nodes. Move the node out of the way, or move the source or the zoomed-in view (the order of the arrange items, a gap, another row or stack) so the lines pass beside it.",
          related: [{ path: node.docPath, message: `${capitalize(node.name)} is defined here.` }],
        });
      }
    }
    return findings;
  },
});

/**
 * Two lines whose strokes come closer than this (edge to edge, in units:
 * 1.5pt ≈ 0.53mm) read as one line or as a double line in print (#156).
 */
export const PROXIMITY_GAP_UNITS = 3;

/**
 * The shortest stretch two lines must run side by side to count (3mm, in
 * units, #156): longer than an arrowhead and the stub before it, so an edge
 * that only turns near a border or splits off near a node is not reported.
 */
export const PROXIMITY_MIN_RUN_UNITS = ptToD2Units(mmToPt(3));

/** A drawn length in mm at its printed size (#183). */
const mmText = (context: GeometryContext, units: number, digits = 1): string =>
  `${unitsToMm(printedUnits(context, units)).toFixed(digits)}mm`;

/** `true` if the element is painted at all (not fully transparent). */
const isOpaque = (e: GeometryElement): boolean => e.ir.style.opacity > 0;

/** `true` for an edge drawn with a visible stroke, other than a legend's sample line. */
const isDrawnEdge = (e: GeometryElement): boolean =>
  e.ir.kind === "edge" &&
  e.drawn !== undefined &&
  e.ir.legend === undefined &&
  e.ir.style.strokeWidth.units > 0 &&
  e.ir.style.stroke !== "transparent" &&
  isOpaque(e);

/** One printed point, matching the physical-size convention of geometry lint. */
export const EDGE_JOG_MIN_UNITS = ptToD2Units(1);

export const edgeJog = defineGeometryRule({
  id: "geometry/edge-jog",
  description: "A painted edge has a sub-1pt orthogonal step between two bends.",
  defaultSeverity: "info",
  fixable: false,
  run(context) {
    return context.elements.flatMap((edge): LintFinding[] => {
      if (!isDrawnEdge(edge)) return [];
      const lengths = microJogLengths(edge.drawn ?? []).map((n) => printedUnits(context, n));
      const shortest = Math.min(...lengths);
      if (shortest >= EDGE_JOG_MIN_UNITS - 0.002) return [];
      return [
        {
          message: `${capitalize(edge.name)} has a ${formatPt(unitsToPt(shortest))} segment between two bends (less than 1pt): a micro-jog.`,
          path: edge.docPath,
          subject: edge.subject,
          hint: "Align the approach with fromAnchor / toAnchor, increase the gap, or change the arrangement to remove the tiny step.",
        },
      ];
    });
  },
});

export const arrowheadOnBend = defineGeometryRule({
  id: "geometry/arrowhead-on-bend",
  description: "An arrowhead is longer than the straight run at its end of the painted edge.",
  defaultSeverity: "warning",
  fixable: false,
  run(context) {
    const findings: LintFinding[] = [];
    for (const edge of context.elements) {
      if (!isDrawnEdge(edge) || edge.ir.kind !== "edge" || edge.route === undefined) continue;
      const width = edge.ir.style.strokeWidth.units;
      const structured = isStructured(context);
      const length = structured ? arrowheadLength(width) : 4 + 3 * width;
      for (const source of [true, false]) {
        if ((source ? edge.ir.sourceArrowhead : edge.ir.targetArrowhead) === undefined) continue;
        const route = source ? edge.route[0] : edge.route.at(-1);
        if (route === undefined) continue;
        // D2's triangle marker is 4 + 3w long, with its tip 1.5w beyond
        // path.connection's endpoint (refX = 4 + 1.5w). Its nearly tangent
        // cubic ends are quantized too, so use the usual geometry tolerance.
        const head = source ? edge.ir.sourceArrowhead : edge.ir.targetArrowhead;
        if (!structured && head !== "triangle") continue;
        const run =
          arrowheadStraightRun(
            route,
            edge.drawn ?? [],
            source,
            structured ? undefined : GEOMETRY_TOLERANCE_UNITS,
          ) + (structured ? 0 : 1.5 * width);
        if (run + GEOMETRY_TOLERANCE_UNITS >= length) continue;
        findings.push({
          message: `The ${source ? "source" : "target"} arrowhead of ${edge.name} is ${formatPt(unitsToPt(printedUnits(context, length)))} long, but its last straight run is only ${formatPt(unitsToPt(printedUnits(context, run)))}: the arrowhead sits on a bend.`,
          path: edge.docPath,
          subject: edge.subject,
          hint: "Leave a straight segment at least as long as the arrowhead before its tip. Move the ends with fromAnchor / toAnchor, increase the gap, or change the arrangement so the edge can approach from another side.",
        });
      }
    }
    return findings;
  },
});

export const arrowheadCramped = defineGeometryRule({
  id: "geometry/arrowhead-cramped",
  description: "A structured arrowhead has less than 2pt of visible straight stem before a bend.",
  defaultSeverity: "info",
  fixable: false,
  run(context) {
    if (!isStructured(context)) return [];
    const findings: LintFinding[] = [];
    for (const edge of context.elements) {
      if (!isDrawnEdge(edge) || edge.ir.kind !== "edge" || edge.route === undefined) continue;
      const length = arrowheadLength(edge.ir.style.strokeWidth.units);
      for (const source of [true, false]) {
        if ((source ? edge.ir.sourceArrowhead : edge.ir.targetArrowhead) === undefined) continue;
        const route = source ? edge.route[0] : edge.route.at(-1);
        if (route === undefined) continue;
        const run = arrowheadStraightRun(route, edge.drawn ?? [], source);
        const total = route
          .slice(1)
          .reduce(
            (sum, p, i) => sum + Math.hypot(p.x - (route[i]?.x ?? p.x), p.y - (route[i]?.y ?? p.y)),
            0,
          );
        // Straight edges have no preceding bend. Overlap already has a warning.
        if (run >= total - 0.002 || run + GEOMETRY_TOLERANCE_UNITS < length) continue;
        const stem = Math.max(0, printedUnits(context, run - length));
        if (stem >= ARROWHEAD_STEM_UNITS - 0.002) continue;
        findings.push({
          message: `The ${source ? "source" : "target"} arrowhead of ${edge.name} has only ${formatPt(unitsToPt(stem))} of visible straight stem before a bend (less than 2pt).`,
          path: edge.docPath,
          subject: edge.subject,
          hint: "Leave the arrowhead length plus 2pt of straight approach after rounding. Increase the gap or change fromAnchor / toAnchor; a fitted figure may need more room before scaling.",
        });
      }
    }
    return findings;
  },
});

/** `true` for a group drawn with a visible border. */
const isFramedGroup = (e: GeometryElement): boolean =>
  e.ir.kind === "group" &&
  e.bbox !== undefined &&
  e.ir.style.strokeWidth.units > 0 &&
  e.ir.style.stroke !== "transparent" &&
  isOpaque(e);

/** What the proximity rules share, built once per context (#156). */
interface ProximityData {
  /** The straight pieces of what every drawn edge paints, each with its own edge and width. */
  index: PieceIndex<GeometryElement>;
  /** The widest edge stroke, which bounds how far apart two lines in reach can be. */
  maxWidth: number;
  /** Elements in IR (document) order. */
  order: ReadonlyMap<ElementKey, number>;
}

const proximityCache = new WeakMap<GeometryContext, ProximityData>();

function proximityData(context: GeometryContext): ProximityData {
  const cached = proximityCache.get(context);
  if (cached !== undefined) return cached;
  const pieces: Piece<GeometryElement>[] = [];
  for (const edge of context.elements) {
    if (!isDrawnEdge(edge)) continue;
    const width = edge.ir.style.strokeWidth.units;
    for (const segment of axisSegments(edge.drawn ?? [])) {
      pieces.push({ ...segment, owner: edge, width });
    }
  }
  const data: ProximityData = {
    index: new PieceIndex(pieces),
    maxWidth: Math.max(0, ...pieces.map((p) => p.width)),
    order: new Map(context.elements.map((e, i) => [e.key, i])),
  };
  proximityCache.set(context, data);
  return data;
}

/** Edges in document order. */
const inOrder = (edges: Iterable<GeometryElement>, order: ReadonlyMap<ElementKey, number>) =>
  [...new Set(edges)].sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0));

/** `edge "a"`, or `the line shared by edge "a" and edge edges[3]`. */
function linesName(edges: readonly GeometryElement[]): string {
  if (edges.length === 1) return (edges[0] as GeometryElement).name;
  const names = edges.map((e) => e.name);
  return `the line shared by ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Related entries for the other edges on a shared line. */
const sharedRelated = (edges: readonly GeometryElement[]) =>
  edges.slice(1).map((e) => ({
    path: e.docPath,
    message: `${capitalize(e.name)} runs on the same line.`,
  }));

/** Two stretches `[from, to]` overlap. */
const overlaps = (a: { from: number; to: number }, b: { from: number; to: number }) =>
  Math.min(a.to, b.to) > Math.max(a.from, b.from);

interface BorderRun {
  edge: GeometryElement;
  group: GeometryElement;
  /** Which side of the group's border (index into `rectSides()`). */
  side: number;
  /** The coordinate of the edge's piece. */
  at: number;
  /** Space between the two strokes, in units (negative: they overlap). */
  gap: number;
  from: number;
  to: number;
}

/**
 * Every place where a piece an edge paints runs along a straight side of a
 * drawn group border closer than {@link PROXIMITY_GAP_UNITS} for at least
 * {@link PROXIMITY_MIN_RUN_UNITS}: per edge and group, the closest run (then
 * the longest). Each edge is measured with its own stroke, on the stretch it
 * paints itself.
 */
function borderRuns(context: GeometryContext): BorderRun[] {
  const { index, maxWidth } = proximityData(context);
  const runs = new Map<string, BorderRun>();
  const gapUnits = drawnUnits(context, PROXIMITY_GAP_UNITS);
  const minRun = drawnUnits(context, PROXIMITY_MIN_RUN_UNITS);
  for (const group of context.elements) {
    if (!isFramedGroup(group) || group.bbox === undefined || group.ir.kind !== "group") continue;
    const width = group.ir.style.strokeWidth.units;
    const reach = gapUnits + (maxWidth + width) / 2;
    for (const [side, line] of rectSides(group.bbox, group.ir.style.radius.units).entries()) {
      for (const bundle of index.near(line.axis, line.at, reach)) {
        const run = parallelRun(bundle, line);
        if (run === undefined || run.to - run.from < minRun) continue;
        const gap = run.distance - (bundle.width + width) / 2;
        if (gap >= gapUnits) continue;
        for (const edge of bundle.owners) {
          const key = `${edge.key}|${group.key}`;
          const seen = runs.get(key);
          if (
            seen === undefined ||
            gap < seen.gap ||
            (gap === seen.gap && run.to - run.from > seen.to - seen.from)
          )
            runs.set(key, { edge, group, side, at: bundle.at, gap, ...run });
        }
      }
    }
  }
  return [...runs.values()];
}

/** Hint of `edge-on-border` / `edge-near-border`, by engine. */
function edgeBorderHint(context: GeometryContext): string {
  return isStructured(context)
    ? "A line on or right beside a group's border reads as part of the frame. Give the edge another way past the group: move its ends with fromAnchor / toAnchor, reorder the arrange items or change a `gap` so the edge does not pass along the group, or connect an element on the other side."
    : "A line on or right beside a container's border reads as part of the frame. Change the layout (layout.direction, grouping) or connect elements inside the container instead of the container itself.";
}

function borderFindings(
  context: GeometryContext,
  keep: (gap: number) => boolean,
  verb: string,
): LintFinding[] {
  const { order } = proximityData(context);
  // A trunk several edges share is one finding: runs along the same side, on
  // the same line as the first run found there and overlapping it.
  const clusters: { first: BorderRun; edges: GeometryElement[]; gap: number; length: number }[] =
    [];
  const runs = borderRuns(context)
    .filter((r) => keep(r.gap))
    .sort((a, b) => (order.get(a.edge.key) ?? 0) - (order.get(b.edge.key) ?? 0));
  for (const run of runs) {
    const cluster = clusters.find(
      ({ first }) =>
        first.group === run.group &&
        first.side === run.side &&
        Math.abs(first.at - run.at) <= COINCIDENT_UNITS &&
        overlaps(first, run),
    );
    if (cluster === undefined) {
      clusters.push({ first: run, edges: [run.edge], gap: run.gap, length: run.to - run.from });
      continue;
    }
    cluster.edges.push(run.edge);
    cluster.gap = Math.min(cluster.gap, run.gap);
    cluster.length = Math.max(cluster.length, run.to - run.from);
  }
  return clusters.map(({ first, edges, gap, length }) => {
    const sorted = inOrder(edges, order);
    const edge = sorted[0] as GeometryElement;
    const { group } = first;
    return {
      message: `${capitalize(linesName(sorted))} ${verb} the border of ${group.name} for ${mmText(context, length)}${gap > 0 ? ` (${mmText(context, gap, 2)} between the lines)` : ""}, so it reads as part of the frame.`,
      path: edge.docPath,
      subject: edge.subject,
      hint: isZoom(edge) ? zoomLineHint() : edgeBorderHint(context),
      related: [
        ...sharedRelated(sorted),
        { path: group.docPath, message: `${capitalize(group.name)} is defined here.` },
      ],
    };
  });
}

export const edgeOnBorder = defineGeometryRule({
  id: "geometry/edge-on-border",
  description:
    "An edge runs on the border of a group for 3mm or more: the two strokes touch or overlap (at most 0.5pt apart), so the edge is drawn as part of the frame.",
  defaultSeverity: "warning",
  fixable: false,
  run(context) {
    return borderFindings(context, (gap) => gap <= GEOMETRY_TOLERANCE_UNITS, "runs on");
  },
});

export const edgeNearBorder = defineGeometryRule({
  id: "geometry/edge-near-border",
  description:
    "An edge runs right beside the border of a group for 3mm or more, less than 1.5pt from it (stroke to stroke) but not touching it.",
  defaultSeverity: "info",
  fixable: false,
  run(context) {
    return borderFindings(context, (gap) => gap > GEOMETRY_TOLERANCE_UNITS, "runs right beside");
  },
});

/** Two lines side by side: `low` is the one with the smaller coordinate. */
interface LinePair {
  low: Bundle<GeometryElement>;
  high: Bundle<GeometryElement>;
  lowEdges: GeometryElement[];
  highEdges: GeometryElement[];
  gap: number;
  from: number;
  to: number;
}

export const edgeNearEdge = defineGeometryRule({
  id: "geometry/edge-near-edge",
  description:
    "Two edges run side by side for 3mm or more less than 1.5pt apart (stroke to stroke) without coinciding, so they read as one blurred or doubled line. A trunk the edges share (drawn on the same line) is not reported.",
  defaultSeverity: "warning",
  fixable: false,
  run(context) {
    const { index, maxWidth, order } = proximityData(context);
    // Lines on the same coordinates (within COINCIDENT_UNITS) are a shared
    // trunk and never paired; each piece keeps its own edges and width.
    const pairs: LinePair[] = [];
    const gapUnits = drawnUnits(context, PROXIMITY_GAP_UNITS);
    const minRun = drawnUnits(context, PROXIMITY_MIN_RUN_UNITS);
    for (const { a, b, aOwners, bOwners, run } of index.pairs(
      COINCIDENT_UNITS,
      gapUnits + maxWidth,
    )) {
      if (run.to - run.from < minRun) continue;
      const gap = run.distance - (a.width + b.width) / 2;
      if (gap >= gapUnits) continue;
      pairs.push({
        low: a,
        high: b,
        lowEdges: aOwners,
        highEdges: bOwners,
        gap,
        from: run.from,
        to: run.to,
      });
    }
    // One finding per pair of lines: pairs whose two sides lie on the same
    // lines as the first pair found there (shared trunks whose edges part at
    // different points) and overlap it are merged.
    const first = (edges: readonly GeometryElement[]) =>
      Math.min(...edges.map((e) => order.get(e.key) ?? 0));
    pairs.sort(
      (p, q) =>
        Math.min(first(p.lowEdges), first(p.highEdges)) -
          Math.min(first(q.lowEdges), first(q.highEdges)) || q.to - q.from - (p.to - p.from),
    );
    const clusters: {
      first: LinePair;
      low: GeometryElement[];
      high: GeometryElement[];
      gap: number;
      length: number;
    }[] = [];
    for (const pair of pairs) {
      const cluster = clusters.find(
        ({ first }) =>
          first.low.axis === pair.low.axis &&
          Math.abs(first.low.at - pair.low.at) <= COINCIDENT_UNITS &&
          Math.abs(first.high.at - pair.high.at) <= COINCIDENT_UNITS &&
          overlaps(first, pair),
      );
      const length = pair.to - pair.from;
      if (cluster === undefined) {
        clusters.push({
          first: pair,
          low: [...pair.lowEdges],
          high: [...pair.highEdges],
          gap: pair.gap,
          length,
        });
        continue;
      }
      cluster.low.push(...pair.lowEdges);
      cluster.high.push(...pair.highEdges);
      cluster.gap = Math.min(cluster.gap, pair.gap);
      cluster.length = Math.max(cluster.length, length);
    }
    // The same edges side by side at several places: the longest stretch.
    const best = new Map<
      string,
      { earlier: GeometryElement[]; later: GeometryElement[]; gap: number; length: number }
    >();
    for (const { low, high, gap, length } of clusters) {
      const sides = [inOrder(low, order), inOrder(high, order)] as const;
      // The line whose first edge comes later is the one to move (as for crossings).
      const [earlier, later] = first(sides[0]) <= first(sides[1]) ? sides : [sides[1], sides[0]];
      const key = `${later.map((e) => e.key).join(",")}|${earlier.map((e) => e.key).join(",")}`;
      const seen = best.get(key);
      if (seen === undefined || length > seen.length)
        best.set(key, { earlier, later, gap, length });
    }
    return [...best.values()].map(({ earlier, later, gap, length }) => {
      const edge = later[0] as GeometryElement;
      return {
        message: `${capitalize(linesName(later))} runs beside ${linesName(earlier)} for ${mmText(context, length)}, ${gap > 0 ? `${mmText(context, gap, 2)} apart` : "their strokes overlapping"}, so the two read as one line.`,
        path: edge.docPath,
        subject: edge.subject,
        hint: isZoom(edge)
          ? zoomLineHint()
          : isStructured(context)
            ? "Edges that should merge share one line only when they start or end at the same point; otherwise keep them apart. Move an end with fromAnchor / toAnchor, merge the edges into one trunk (the same anchor, or figure.layout.fanIn: merge), or change the arrangement (a `gap`, the order of a box's items) so they take different channels."
            : "Change the layout (layout.direction, grouping) so the edges take different channels, or connect them through a shared node.",
        related: [
          ...sharedRelated(later),
          ...earlier.map((e) => ({
            path: e.docPath,
            message: `${capitalize(e.name)} runs alongside.`,
          })),
        ],
      };
    });
  },
});

/** `true` for a label an edge should keep clear of: a group's title, a caption, a text node. */
const isFreeText = (e: GeometryElement): boolean =>
  e.ir.legend === undefined &&
  isOpaque(e) &&
  (e.ir.kind === "group" || (e.ir.kind === "node" && (isCaption(e) || e.ir.shape === "text")));

export const edgeTouchesLabel = defineGeometryRule({
  id: "geometry/edge-touches-label",
  description:
    "An edge passes less than 1.5pt (stroke to outline) from the letters (re-measured glyph outlines) of a group's title, a caption or a text label that is not one of its ends, without crossing the label.",
  defaultSeverity: "info",
  fixable: false,
  run(context) {
    const findings: LintFinding[] = [];
    for (const edge of context.elements) {
      const { route, drawn } = edge;
      if (route === undefined || drawn === undefined || !isDrawnEdge(edge)) continue;
      if (edge.ir.kind !== "edge") continue;
      const ends = new Set([edge.ir.from, edge.ir.to]);
      for (const other of context.elements) {
        if (!isFreeText(other) || ends.has(other.key)) continue;
        const boxes = other.labels.flatMap((l) => l.visibleLines);
        // Crossing the label is edge-crosses-label's (on the route, as it checks).
        if (
          boxes.length === 0 ||
          boxes.some((box) => polylinesCrossRect(route, box, GEOMETRY_TOLERANCE_UNITS))
        )
          continue;
        // Room between the painted stroke and the letters' outlines.
        const gap =
          Math.min(
            ...other.labels.flatMap(inkLines).map((ink) => polylinesRectDistance(drawn, ink)),
          ) - edge.strokeInset;
        if (gap >= drawnUnits(context, PROXIMITY_GAP_UNITS)) continue;
        findings.push({
          message: `${capitalize(edge.name)} touches the ${contentNoun(other)} of ${other.name} (${gap > 0 ? `${mmText(context, gap, 2)} from` : "touching"} the letters).`,
          path: edge.docPath,
          subject: edge.subject,
          hint: isZoom(edge) ? zoomLabelHint() : edgeCrossesLabelHint(context, other),
          related: [{ path: labelPath(other), message: "The label is defined here." }],
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
        message: `The ${ir.shape} ${element.name} is drawn ${formatSize(context, bbox)}, not with equal width and height.`,
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
export const badgeCollision = defineGeometryRule({
  id: "geometry/badge-collision",
  description:
    "A corner badge is outside the canvas or collides with another element, label, badge or edge.",
  defaultSeverity: "warning",
  fixable: false,
  run(context) {
    const findings: LintFinding[] = [];
    for (const element of context.elements) {
      const badge = element.badge;
      if (badge === undefined) continue;
      const collisions = context.elements.filter((other) => {
        if (other.key === element.key) return false;
        return (
          (!context.isAncestor(other.key, element.key) &&
            other.bbox !== undefined &&
            rectsOverlap(badge, other.bbox, GEOMETRY_TOLERANCE_UNITS)) ||
          (other.badge !== undefined &&
            rectsOverlap(badge, other.badge, GEOMETRY_TOLERANCE_UNITS)) ||
          other.labels.some((label) =>
            label.visibleLines.some((line) => rectsOverlap(badge, line, GEOMETRY_TOLERANCE_UNITS)),
          ) ||
          (other.drawn !== undefined &&
            polylinesCrossRect(other.drawn, badge, GEOMETRY_TOLERANCE_UNITS))
        );
      });
      const ownLabel = element.labels.some((label) =>
        label.visibleLines.some((line) => rectsOverlap(badge, line, GEOMETRY_TOLERANCE_UNITS)),
      );
      if (
        collisions.length > 0 ||
        ownLabel ||
        !rectInside(context.canvas, badge, GEOMETRY_TOLERANCE_UNITS)
      )
        findings.push({
          message: `The badge of ${element.name} ${collisions.length > 0 || ownLabel ? "collides with a label or another element" : "extends outside the canvas"}.`,
          path: [...element.docPath, "badge"],
          subject: element.subject,
          hint: "Choose another corner or increase the layout gap or margin.",
          related: collisions.map((other) => ({
            path: other.docPath,
            message: `${capitalize(other.name)} is here.`,
          })),
        });
    }
    return findings;
  },
});

/** Rounded repository p90 (75.25%); see design §6.71 and research/248-fill. */
export const GROUP_EMPTY_SPACE_THRESHOLD = 0.75;

export const groupEmptyArea = defineGeometryRule({
  id: "geometry/group-empty-area",
  description:
    "At least 75% of a group's frame is outside its title and direct children's bounding boxes (edges excluded).",
  defaultSeverity: "info",
  fixable: false,
  run(context) {
    return context.elements.flatMap((group): LintFinding[] => {
      const empty = groupEmptySpace(context, group);
      if (empty === undefined || empty < GROUP_EMPTY_SPACE_THRESHOLD) return [];
      return [
        {
          message: `${capitalize(group.name)} has ${(empty * 100).toFixed(1)}% empty bounding-box area (threshold 75%; edges excluded).`,
          path: group.docPath,
          subject: group.subject,
          hint: isStructured(context)
            ? "If unintended, use align: stretch on the enclosing row/stack and justify: stretch inside the stretched column/row, or justify: space-between for fixed-size items. Reduce explicit gaps or avoid stretching the panel itself to tighten title/caption spacing. Whitespace can be intentional; this is information only."
            : "Whitespace can be intentional. If needed, use structured row/stack layout with align: stretch and justify: stretch (or space-between), or adjust grouping and gaps.",
        },
      ];
    });
  },
});

export const BUILTIN_GEOMETRY_RULES: readonly GeometryRule[] = Object.freeze([
  groupEmptyArea,
  badgeCollision,
  exceedsPageWidth,
  exceedsPageHeight,
  textTooSmall,
  scriptTooSmall,
  labelOverflow,
  outOfCanvas,
  nodeOverlap,
  labelCollision,
  edgeCrossesLabel,
  edgeThroughNode,
  arrowheadOnBend,
  arrowheadCramped,
  edgeJog,
  zoomCrossesNode,
  edgeOnBorder,
  edgeNearBorder,
  edgeNearEdge,
  edgeTouchesLabel,
  aspectDistorted,
  reversedEdge,
] as GeometryRule[]);
