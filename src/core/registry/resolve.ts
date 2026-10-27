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
 * label gets `component/label-at-without-label` (warning, #127).
 *
 * Label math (`$...$`, #93) is parsed here: in structured figures invalid
 * or unsupported math is `component/invalid-math` (error, located at the
 * offending characters); in `auto` figures, where D2 draws labels as plain
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
  type ElementKey,
  figureElements,
  invalidateDependents,
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
  /** Groups only (#127). */
  labelAt: string | undefined;
  props: Record<string, unknown>;
}

/** Runs the `component` stage on `state.doc`. */
export function resolveComponents(state: CheckState, registry: Registry, locate: Locator): void {
  const components = new Map<ElementKey, ResolvedComponent>();
  state.components = components;

  for (const element of elements(state)) {
    if (state.invalid.has(element.key)) continue;
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
    const usage = registry.validateUsage(manifest, element);
    report(usage.diagnostics, (d) => [...element.path, ...(d.path ?? [])]);
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
    const unexpectedLabel =
      (mark !== undefined || embed !== undefined) && !isBlankForD2(element.label);
    if (unexpectedLabel) {
      const diagnostic: Diagnostic = {
        code: "component/unexpected-label",
        severity: "error",
        message:
          mark === undefined
            ? `${componentId(manifest)} draws the image file of props.src, so it takes no label.`
            : mark.type === "glyph"
              ? `${componentId(manifest)} draws the symbol chosen by props.${mark.prop}, so it takes no label.`
              : `${componentId(manifest)} is drawn as a point, so it takes no label.`,
        hint: "Remove the label; put text next to it with a label node if needed.",
      };
      report([diagnostic], () => [...element.path, "label"]);
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
    const mathErrors =
      mark === undefined && !missingLabel ? checkLabelMath(state, element, locate) : false;
    if (!usage.ok || missingLabel || unexpectedLabel || toneUnsupported || mathErrors) {
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
}

/**
 * Reports the label math of an element (see the module comment). Returns
 * whether it reported an error.
 */
function checkLabelMath(state: CheckState, element: Element, locate: Locator): boolean {
  const { label } = element;
  if (!hasLabelMarkup(label)) return false;
  const engine = state.doc.figure?.layout?.engine;
  const at = [...element.path, "label"];
  if (engine !== "structured") {
    // auto: D2 draws the label as text. Only spans that are clearly math (a
    // command, _ or ^) are reported, so labels such as "$5 or $10" stay quiet.
    if (!looksLikeMath(label)) return false;
    const location = locate(at);
    state.diagnostics.push({
      code: "component/unsupported-in-auto",
      severity: "warning",
      message: `Label math ($...$) needs the structured layout engine; this auto figure draws the label of ${element.kind} "${element.subject.id}" as written.`,
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
      message: `${error.message} (label characters ${column(error.start) + 1}–${column(error.end)}: "${excerpt}")`,
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
    const { kind, key, path, subject, element } = entry;
    yield {
      kind,
      key,
      path,
      subject,
      component: element.component,
      label: element.label,
      variant: element.variant,
      tone: entry.kind === "edge" ? undefined : entry.element.tone,
      icon: entry.kind === "node" ? entry.element.icon : undefined,
      labelAt: entry.kind === "group" ? entry.element.labelAt : undefined,
      props: entry.kind === "group" ? {} : entry.element.props,
    };
  }
}
