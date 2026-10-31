/**
 * Stage `component`: resolves each element's component reference through a
 * {@link Registry}, validates its variant and props, and records the result in
 * `state.components` (design doc §0, §3).
 *
 * Nodes whose component draws only text (shape `text`, e.g. `sumi/label`)
 * need a label with visible text (`component/missing-label`) unless they draw
 * an icon (#94). Nodes drawn as a mark (manifest `mark`, e.g.
 * `sumi/operator`) or embedding an image (manifest `embed`, `sumi/image`)
 * take no label (`component/unexpected-label`), and point marks no tone
 * (`component/tone-unsupported`). A group with `labelAt` but no visible
 * label gets `component/label-at-without-label` (warning, #127). A node
 * with `labelRotation` (#178) that draws an icon, a mark or an image gets
 * `component/label-rotation-unsupported`, and one without a visible label
 * `component/label-rotation-without-label` (warning). A node with a
 * `sublabel` (#184) that draws an icon, a mark or an image gets
 * `component/sublabel-unsupported`, and one without a visible label
 * `component/sublabel-without-label` (both errors). An
 * edge with `fromAnchor` / `toAnchor` on an end at a point mark (a junction,
 * which ignores anchors) `component/anchor-on-junction` (warning, #154).
 *
 * Label math (`$...$`, #93) is parsed here, in the label and the sublabel
 * (#184): in structured figures invalid or unsupported math is
 * `component/invalid-math` (error, located at the offending characters); in `auto` figures, where D2 draws labels as plain
 * text, math syntax is `component/unsupported-in-auto` (warning: the label
 * is drawn literally, as before label math existed).
 *
 * Elements already invalid are skipped. Elements whose component fails are
 * marked invalid, and so are the elements depending on them (children of a
 * group, edges touching a node), without further diagnostics. Only valid
 * elements end up in `state.components`.
 */

import {
  type CheckState,
  type ElementEntry,
  type ElementKey,
  figureElements,
  invalidateDependents,
  nodeKey,
} from "../check-state";
import type { Diagnostic, DiagnosticSubject, DocPath } from "../diagnostics";
import type { Locator } from "../figure/yaml";
import { hasLabelMarkup, looksLikeMath, parseLabel } from "../label/math";
import { type ComponentKind, componentId, type ResolvedComponent } from "./manifest";
import type { Registry } from "./registry";

/**
 * Whitespace as D2 trims it (Go `unicode.IsSpace`): JavaScript `\s` without
 * U+FEFF, plus U+0085. Checked against D2 v0.9.0.
 */
const D2_BLANK = /^(?:[^\S\ufeff]|\u0085)*$/;

/**
 * `true` if D2 treats the label as empty: it rejects a text shape whose label
 * is empty or only whitespace ("shape text must have a non-empty label").
 */
export function isBlankForD2(label: string): boolean {
  return D2_BLANK.test(label);
}

interface Element {
  kind: ComponentKind;
  key: ElementKey;
  path: DocPath;
  subject: DiagnosticSubject;
  component: string;
  label: string;
  variant: string;
  tone: string | undefined;
  icon: string | undefined;
  badge: boolean;
  grow: number | undefined;
  /** Groups only (#127). */
  labelAt: string | undefined;
  /** Nodes only (#178). */
  labelRotation: number | undefined;
  /** Nodes only (#184). */
  sublabel: string | undefined;
  props: Record<string, unknown>;
  /** How messages name the element (an expanded caption or legend part names its origin). */
  name: string;
}

export interface ResolveOptions {
  /**
   * Resolve only these elements and keep the components resolved before
   * (the parts a legend expands into, #131). Omitted means every element,
   * starting afresh.
   */
  only?: ReadonlySet<ElementKey>;
}

/** Runs the `component` stage on `state.doc`. */
export function resolveComponents(
  state: CheckState,
  registry: Registry,
  locate: Locator,
  options: ResolveOptions = {},
): void {
  const { only } = options;
  const components =
    only === undefined || state.components === undefined
      ? new Map<ElementKey, ResolvedComponent>()
      : state.components;
  state.components = components;
  const engine = state.doc.figure?.layout?.engine;

  for (const element of elements(state)) {
    if (state.invalid.has(element.key)) continue;
    if (only !== undefined && !only.has(element.key)) continue;
    const report = (diagnostics: Diagnostic[], path: (d: Diagnostic) => DocPath) => {
      for (const d of diagnostics) {
        const at = path(d);
        const location = locate(at, { key: d.code === "component/unknown-prop" });
        state.diagnostics.push({
          ...d,
          path: at,
          ...(location !== undefined && { location }),
          subject: element.subject,
        });
      }
    };

    const resolved = registry.resolve(element.component, element.kind);
    report(resolved.diagnostics, () => [...element.path, "component"]);
    if (!resolved.ok) {
      state.invalid.add(element.key);
      continue;
    }
    const manifest = resolved.value;
    const growUnsupported =
      element.grow !== undefined &&
      ["sumi/tokens", "sumi/matrix", "sumi/legend"].includes(componentId(manifest));
    if (growUnsupported)
      report(
        [
          {
            code: "component/grow-unsupported",
            severity: "error",
            message: `${componentId(manifest)} expands into layout items and has no standalone node body to weight.`,
            hint: "Remove grow; use grow on ordinary nodes inside an immediate row/stack with justify: stretch.",
          },
        ],
        () => [...element.path, "grow"],
      );
    const usage = registry.validateUsage(manifest, element);
    report(usage.diagnostics, (d) => [...element.path, ...(d.path ?? [])]);
    // A component drawn by some engines only (#131, e.g. sumi/legend).
    const wrongEngine =
      engine !== undefined && manifest.engines !== undefined && !manifest.engines.includes(engine);
    if (wrongEngine) {
      const needed = manifest.engines?.join(" or ") ?? "";
      const diagnostic: Diagnostic = {
        code: engine === "auto" ? "layout/structured-only" : "layout/auto-only",
        severity: "error",
        message: `${componentId(manifest)} needs the ${needed} layout engine, but this figure uses the ${engine} engine.`,
        hint:
          engine === "auto"
            ? 'The structured layout is selected by figure.layout.arrange or "engine: structured"; otherwise remove this element.'
            : "Lay the figure out with the auto engine, or remove this element.",
      };
      report([diagnostic], () => [...element.path, "component"]);
    }
    const missingLabel =
      manifest.kind === "node" &&
      manifest.shape === "text" &&
      element.icon === undefined &&
      isBlankForD2(element.label);
    if (missingLabel) {
      const diagnostic: Diagnostic = {
        code: "component/missing-label",
        severity: "error",
        message: `${componentId(manifest)} draws only its label, so the label must not be empty or only whitespace.`,
        hint: "Add a label, or remove the node.",
      };
      report([diagnostic], () => [...element.path, "label"]);
    }
    if (element.labelAt !== undefined && isBlankForD2(element.label)) {
      // Not an error: there is no visible title to place. An omitted or empty
      // label takes no room; a whitespace-only one still has its (blank)
      // band in structured layout, which labelAt moves.
      const diagnostic: Diagnostic = {
        code: "component/label-at-without-label",
        severity: "warning",
        message:
          element.label === ""
            ? "labelAt places the group's label, but the label is omitted or empty, so the group has no visible title and labelAt has no effect."
            : "labelAt places the group's label, but the label is only whitespace, so the group has no visible title; in structured layout labelAt only moves the blank space reserved for it.",
        hint: "Add a label, or remove labelAt.",
      };
      report([diagnostic], () => [...element.path, "labelAt"]);
    }
    const mark = manifest.kind === "node" ? manifest.mark : undefined;
    const embed = manifest.kind === "node" ? manifest.embed : undefined;
    const badgeUnsupported =
      element.badge &&
      (["sumi/legend", "sumi/tokens", "sumi/matrix"].includes(componentId(manifest)) ||
        mark?.type === "point");
    if (badgeUnsupported)
      report(
        [
          {
            code: "component/badge-unsupported",
            severity: "error",
            message: `${componentId(manifest)} has no standalone node body for a corner badge.`,
            hint: "Put the badge on an ordinary shape, image or outline node instead.",
          },
        ],
        () => [...element.path, "badge"],
      );
    const zoom = manifest.kind === "edge" && manifest.routing === "zoom";
    const unexpectedLabel =
      (mark !== undefined || embed !== undefined || zoom) && !isBlankForD2(element.label);
    if (unexpectedLabel) {
      const diagnostic: Diagnostic = {
        code: "component/unexpected-label",
        severity: "error",
        message: zoom
          ? `${componentId(manifest)} draws two lines between corners of its ends, so it takes no label.`
          : mark === undefined
            ? `${componentId(manifest)} draws the image file of props.src, so it takes no label.`
            : mark.type === "glyph"
              ? `${componentId(manifest)} draws the symbol chosen by props.${mark.prop}, so it takes no label.`
              : `${componentId(manifest)} is drawn as a point, so it takes no label.`,
        hint: zoom
          ? "Remove the label; name the zoomed-in view with its group's label or caption instead."
          : "Remove the label; put text next to it with a label node if needed.",
      };
      report([diagnostic], () => [...element.path, "label"]);
    }
    // labelRotation (#178) turns a label: a node drawing an icon, a mark or
    // an image has none to turn.
    const rotationUnsupported =
      element.labelRotation !== undefined &&
      (mark !== undefined || embed !== undefined || element.icon !== undefined);
    if (rotationUnsupported) {
      const drawn =
        element.icon !== undefined
          ? "an icon in place of its label"
          : mark === undefined
            ? "the image file of props.src"
            : mark.type === "glyph"
              ? `the symbol chosen by props.${mark.prop}`
              : "a point";
      const diagnostic: Diagnostic = {
        code: "component/label-rotation-unsupported",
        severity: "error",
        message: `labelRotation turns a node's label, but ${componentId(manifest)} draws ${drawn} here, which is not turned.`,
        hint: "Remove labelRotation; put turned text next to it with a label node if needed.",
      };
      report([diagnostic], () => [...element.path, "labelRotation"]);
    } else if (element.labelRotation !== undefined && isBlankForD2(element.label)) {
      // Not an error, like labelAt without a label: nothing visible to turn.
      const diagnostic: Diagnostic = {
        code: "component/label-rotation-without-label",
        severity: "warning",
        message:
          "labelRotation turns the node's label, but the label is omitted, empty or only whitespace, so labelRotation has no visible effect.",
        hint: "Add a label, or remove labelRotation.",
      };
      report([diagnostic], () => [...element.path, "labelRotation"]);
    }
    // sublabel (#184) draws a second, smaller text under the label: a node
    // drawing an icon, a mark or an image has no label to put it under, and
    // a node without a visible label should write its text as the label.
    const sublabelUnsupported =
      element.sublabel !== undefined &&
      (mark !== undefined || embed !== undefined || element.icon !== undefined);
    const sublabelWithoutLabel =
      !sublabelUnsupported && element.sublabel !== undefined && isBlankForD2(element.label);
    if (sublabelUnsupported) {
      const drawn =
        element.icon !== undefined
          ? "an icon in place of its label"
          : mark === undefined
            ? "the image file of props.src"
            : mark.type === "glyph"
              ? `the symbol chosen by props.${mark.prop}`
              : "a point";
      const diagnostic: Diagnostic = {
        code: "component/sublabel-unsupported",
        severity: "error",
        message: `sublabel draws a second, smaller line under a node's label, but ${componentId(manifest)} draws ${drawn} here, with no label to put it under.`,
        hint: "Remove sublabel; put the text next to it with a label node if needed.",
      };
      report([diagnostic], () => [...element.path, "sublabel"]);
    } else if (sublabelWithoutLabel) {
      const diagnostic: Diagnostic = {
        code: "component/sublabel-without-label",
        severity: "error",
        message:
          "sublabel draws a second, smaller line under the node's label, but the label is omitted, empty or only whitespace.",
        hint: "Add a label, or write the text as the label instead of the sublabel.",
      };
      report([diagnostic], () => [...element.path, "sublabel"]);
    }
    const toneUnsupported = mark?.type === "point" && element.tone !== undefined;
    if (toneUnsupported) {
      const diagnostic: Diagnostic = {
        code: "component/tone-unsupported",
        severity: "error",
        message: `${componentId(manifest)} is drawn as a point in the line color, so it takes no tone.`,
        hint: "Remove the tone.",
      };
      report([diagnostic], () => [...element.path, "tone"]);
    }
    const labelMathErrors =
      mark === undefined && !missingLabel ? checkLabelMath(state, element, "label", locate) : false;
    const sublabelMathErrors =
      element.sublabel !== undefined && !sublabelUnsupported && !sublabelWithoutLabel
        ? checkLabelMath(state, element, "sublabel", locate)
        : false;
    const mathErrors = labelMathErrors || sublabelMathErrors;
    if (
      !usage.ok ||
      wrongEngine ||
      growUnsupported ||
      badgeUnsupported ||
      missingLabel ||
      unexpectedLabel ||
      rotationUnsupported ||
      sublabelUnsupported ||
      sublabelWithoutLabel ||
      toneUnsupported ||
      mathErrors
    ) {
      state.invalid.add(element.key);
      continue;
    }
    components.set(element.key, {
      id: componentId(manifest),
      manifest,
      ...usage.value,
    });
  }

  // Elements checked above may depend on an element that failed later in this
  // stage; they keep their own diagnostics but are not resolved.
  invalidateDependents(state);
  for (const key of components.keys()) {
    if (state.invalid.has(key)) components.delete(key);
  }
  checkJunctionAnchors(state, locate, only);
}

/**
 * `component/anchor-on-junction` (warning, #154): a `fromAnchor` /
 * `toAnchor` on an end at a node drawn as a point (`sumi/junction`), where
 * every line meets the center from any side, so the anchor has no effect.
 * Only resolved edges are checked: anchors in `auto` figures are already
 * `layout/structured-only`, which leaves the edge invalid.
 */
function checkJunctionAnchors(
  state: CheckState,
  locate: Locator,
  only: ReadonlySet<ElementKey> | undefined,
): void {
  const components = state.components;
  if (components === undefined) return;
  for (const entry of figureElements(state.doc)) {
    if (entry.kind !== "edge" || !components.has(entry.key)) continue;
    if (only !== undefined && !only.has(entry.key)) continue;
    const edge = entry.element;
    const own = components.get(entry.key)?.manifest;
    if (own?.kind === "edge" && own.routing === "zoom") {
      checkZoomAnchors(state, locate, entry, componentId(own));
      continue;
    }
    for (const [field, end] of [
      ["fromAnchor", edge.from],
      ["toAnchor", edge.to],
    ] as const) {
      if (edge[field] === undefined) continue;
      const target = components.get(nodeKey(end));
      const manifest = target?.manifest;
      if (manifest?.kind !== "node" || manifest.mark?.type !== "point") continue;
      const at = [...entry.path, field];
      const location = locate(at);
      state.diagnostics.push({
        code: "component/anchor-on-junction",
        severity: "warning",
        message: `${field} has no effect: "${end}" is a ${componentId(manifest)}, drawn as a point where every line meets its center from any side.`,
        path: at,
        ...(location !== undefined && { location }),
        subject: entry.subject,
        hint: `Remove ${field}. To change where the line runs, anchor the edge's other end, or move the junction in the arrange tree or with attach.`,
      });
    }
  }
}

/**
 * `component/anchor-on-zoom` (warning, #176): a `fromAnchor` / `toAnchor` on
 * a zoom edge, whose lines always join the corners chosen from where the
 * target lies relative to the source (design doc §6.45).
 */
function checkZoomAnchors(
  state: CheckState,
  locate: Locator,
  entry: Extract<ElementEntry, { kind: "edge" }>,
  id: string,
): void {
  for (const field of ["fromAnchor", "toAnchor"] as const) {
    if (entry.element[field] === undefined) continue;
    const at = [...entry.path, field];
    const location = locate(at);
    state.diagnostics.push({
      code: "component/anchor-on-zoom",
      severity: "warning",
      message: `${field} has no effect: ${id} joins the corners of its ends chosen from where the target lies relative to the source.`,
      path: at,
      ...(location !== undefined && { location }),
      subject: entry.subject,
      hint: `Remove ${field}. To change which corners are joined, move the target to another side of the source in the arrange tree.`,
    });
  }
}

/**
 * Reports the label math of an element's label or sublabel (#184; see the
 * module comment). Returns whether it reported an error.
 */
function checkLabelMath(
  state: CheckState,
  element: Element,
  field: "label" | "sublabel",
  locate: Locator,
): boolean {
  const label = (field === "label" ? element.label : element.sublabel) ?? "";
  if (!hasLabelMarkup(label)) return false;
  const engine = state.doc.figure?.layout?.engine;
  const at = [...element.path, field];
  if (engine !== "structured") {
    // auto: D2 draws the label as text. Only spans that are clearly math (a
    // command, _ or ^) are reported, so labels such as "$5 or $10" stay quiet.
    if (!looksLikeMath(label)) return false;
    const location = locate(at);
    state.diagnostics.push({
      code: "component/unsupported-in-auto",
      severity: "warning",
      message: `Label math ($...$) needs the structured layout engine; this auto figure draws the label of ${element.name} as written.`,
      path: at,
      ...(location !== undefined && { location }),
      subject: element.subject,
      hint: "Lay the figure out with figure.layout.arrange (the structured engine), or write the label without $...$.",
    });
    return false;
  }
  const parsed = parseLabel(label);
  if (parsed.ok) return false;
  // Positions in messages count characters (code points), from 1.
  const column = (offset: number) => [...label.slice(0, offset)].length;
  for (const error of parsed.errors) {
    const location = locate(at, { span: [error.start, error.end] });
    const excerpt = label.slice(error.start, error.end);
    state.diagnostics.push({
      code: "component/invalid-math",
      severity: "error",
      message: `${error.message} (${field} characters ${column(error.start) + 1}–${column(error.end)}: "${excerpt}")`,
      path: at,
      ...(location !== undefined && { location }),
      subject: element.subject,
      ...(error.hint !== undefined && { hint: error.hint }),
    });
  }
  return true;
}

function* elements(state: CheckState): Generator<Element> {
  for (const entry of figureElements(state.doc)) {
    const { kind, key, path, subject, element, origin } = entry;
    yield {
      // A group's caption (#130) is named by its group.
      name: origin?.name ?? `${kind} "${subject.id}"`,
      kind,
      key,
      path,
      subject,
      component: element.component,
      label: element.label,
      variant: element.variant,
      tone: entry.element.tone,
      icon: entry.kind === "node" ? entry.element.icon : undefined,
      labelAt: entry.kind === "group" ? entry.element.labelAt : undefined,
      labelRotation: entry.kind === "node" ? entry.element.labelRotation : undefined,
      sublabel: entry.kind === "node" ? entry.element.sublabel : undefined,
      badge: entry.kind === "node" && entry.element.badge !== undefined,
      grow: entry.kind === "node" ? entry.element.grow : undefined,
      props: entry.kind === "group" ? {} : entry.element.props,
    };
  }
}
