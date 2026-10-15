/**
 * Stage `component`: resolves each element's component reference through a
 * {@link Registry}, validates its variant and props, and records the result in
 * `state.components` (design doc §0, §3).
 *
 * Nodes whose component draws only text (shape `text`, e.g. `sumi/label`)
 * need a label with visible text (`component/missing-label`).
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
      manifest.kind === "node" && manifest.shape === "text" && isBlankForD2(element.label);
    if (missingLabel) {
      const diagnostic: Diagnostic = {
        code: "component/missing-label",
        severity: "error",
        message: `${componentId(manifest)} draws only its label, so the label must not be empty or only whitespace.`,
        hint: "Add a label, or remove the node.",
      };
      report([diagnostic], () => [...element.path, "label"]);
    }
    if (!usage.ok || missingLabel) {
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
      props: entry.kind === "group" ? {} : entry.element.props,
    };
  }
}
