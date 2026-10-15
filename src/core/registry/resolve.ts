/**
 * Stage `component`: resolves each element's component reference through a
 * {@link Registry}, validates its variant and props, and records the result in
 * `state.components` (design doc §0, §3).
 *
 * Elements already invalid are skipped. Elements whose component fails are
 * marked invalid, and so are the elements depending on them (children of a
 * group, edges touching a node), without further diagnostics. Only valid
 * elements end up in `state.components`.
 */

import {
  type CheckState,
  type ElementKey,
  edgeKey,
  groupKey,
  invalidateDependents,
  nodeKey,
} from "../check-state";
import type { Diagnostic, DiagnosticSubject, DocPath } from "../diagnostics";
import type { FigureEdge, FigureGroup, FigureNode } from "../figure/schema";
import type { Locator } from "../figure/yaml";
import { type ComponentKind, componentId, type ResolvedComponent } from "./manifest";
import type { Registry } from "./registry";

interface Element {
  kind: ComponentKind;
  key: ElementKey;
  path: DocPath;
  subject: DiagnosticSubject;
  component: string;
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
    const usage = registry.validateUsage(resolved.value, element);
    report(usage.diagnostics, (d) => [...element.path, ...(d.path ?? [])]);
    if (!usage.ok) {
      state.invalid.add(element.key);
      continue;
    }
    components.set(element.key, {
      id: componentId(resolved.value),
      manifest: resolved.value,
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
  const { groups = [], nodes = [], edges = [] } = state.doc;
  const each = <T>(list: (T | undefined)[]) =>
    list.flatMap((value, index) => (value === undefined ? [] : [{ value, index }]));

  for (const { value: g, index } of each<FigureGroup>(groups)) {
    yield {
      kind: "group",
      key: groupKey(g.id),
      path: ["groups", index],
      subject: { kind: "group", id: g.id },
      component: g.component,
      variant: g.variant,
      props: {},
    };
  }
  for (const { value: n, index } of each<FigureNode>(nodes)) {
    yield {
      kind: "node",
      key: nodeKey(n.id),
      path: ["nodes", index],
      subject: { kind: "node", id: n.id },
      component: n.component,
      variant: n.variant,
      props: n.props,
    };
  }
  for (const { value: e, index } of each<FigureEdge>(edges)) {
    yield {
      kind: "edge",
      key: edgeKey(e.id, index),
      path: ["edges", index],
      subject: { kind: "edge", id: e.id ?? `edges[${index}]` },
      component: e.component,
      variant: e.variant,
      props: e.props,
    };
  }
}
