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
import { formatMm, formatPt } from "../../core/units";
import { type Point, type Rect, unitsToPt } from "../../render/geometry";
import { defineGeometryRule, type GeometryRule, type LintFinding } from "../rule";
import type { GeometryContext, GeometryElement } from "./context";
import { obstaclesCrossedByRoute, type RouteObstacle } from "./edges";
import { unionOf } from "./measure";
import { regionsOverlap } from "./outlines";
import {
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

const labelPath = (element: GeometryElement): DocPath => [...element.docPath, "label"];

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

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
        hint: "Sumi never shrinks a figure to fit. Lay it out top to bottom (layout.direction: down), shorten long labels, or use a wider profile (e.g. paper-double).",
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
        hint: "Sumi never shrinks a figure to fit. Lay it out left to right (layout.direction: right), split it into several figures, or use a taller profile.",
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
      const sizes = element.labels.map((l) => unitsToPt(l.label.fontSizeUnits));
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
        message: `The label of ${element.name} (${box === undefined ? "" : `${formatSize(box)}, `}measured with the theme's fonts) does not fit inside its ${shapeName(element)} shape (${formatSize(bbox)})${outside ? "; it is drawn outside the shape" : ""}.`,
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
          hint: "Elements overlap only when one contains the other through `group`. Check explicit sizes, or put the nodes in the same group.",
          related: [{ path: b.docPath, message: `${capitalize(b.name)} is defined here.` }],
        });
      }
    }
    return findings;
  },
});

/** Label collisions: label vs label of another element, and label vs another node's shape. */
export const labelCollision = defineGeometryRule({
  id: "geometry/label-collision",
  description:
    "A label (re-measured) overlaps a label of another element, or the shape of another node.",
  defaultSeverity: "warning",
  fixable: false,
  run(context) {
    const findings: LintFinding[] = [];
    const tolerance = GEOMETRY_TOLERANCE_UNITS;
    const labelled = context.elements.filter((e) => e.labels.length > 0);
    const lineBoxes = (e: GeometryElement) => e.labels.flatMap((l) => l.visibleLines);
    const reported = new Set<string>();
    const report = (a: GeometryElement, b: GeometryElement, what: string) => {
      const pair = [a.key, b.key].sort().join(" ");
      if (reported.has(pair)) return;
      reported.add(pair);
      findings.push({
        message: `The label of ${a.name} overlaps ${what} of ${b.name}.`,
        path: labelPath(a),
        subject: a.subject,
        hint: "Overlapping text is hard to read. Shorten the labels, or change the layout (direction, grouping, edge labels).",
        related: [{ path: b.docPath, message: `${capitalize(b.name)} is defined here.` }],
      });
    };
    for (const [i, a] of labelled.entries()) {
      const boxesA = lineBoxes(a);
      for (const b of labelled.slice(i + 1)) {
        const boxesB = lineBoxes(b);
        if (boxesA.some((ra) => boxesB.some((rb) => rectsOverlap(ra, rb, tolerance)))) {
          report(a, b, "the label");
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
    return findings;
  },
});

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
          message: `${capitalize(edge.name)} crosses the label of ${other.name}.`,
          path: edge.docPath,
          subject: edge.subject,
          hint:
            other.kind === "group"
              ? "A container's label sits at its top-left corner, so edges that enter the container from above can cross it when the label is wide. Shorten the label, connect elements inside the container instead of the container itself, or change layout.direction."
              : "Change the layout (direction or grouping) so the edge is routed around the label, or shorten the label.",
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
