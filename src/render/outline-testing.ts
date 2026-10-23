/** Outline pipeline fixtures use a private component registry until #55 publishes components. */
import { createBuiltinRegistry } from "../core/registry/builtins";
import type { NodeManifest } from "../core/registry/manifest";

export function outlineRegistry() {
  const registry = createBuiltinRegistry();
  const box = registry.get("sumi/box") as NodeManifest;
  for (const name of ["trapezoid", "stack"]) {
    const registered = registry.register({
      ...box,
      namespace: "test",
      name,
      variants: ["default"],
      render: { type: "outline", renderer: `sumi/${name}` },
    });
    if (!registered.ok) throw new Error(JSON.stringify(registered.diagnostics));
  }
  const backward = registry.register({
    version: 1,
    namespace: "test",
    name: "backward",
    description: "Backward edge for outline tests.",
    since: "0.2.0",
    kind: "edge",
    direction: "backward",
    variants: ["default"],
    props: box.props,
  });
  if (!backward.ok) throw new Error(JSON.stringify(backward.diagnostics));
  return registry;
}

export const OUTLINE_SOURCE = `version: 1
figure:
  id: outline-flow
  theme: academic
  profile: paper-double
  layout: { direction: right }
groups:
  - { id: outer, label: Outer }
  - { id: group, label: Group, group: outer }
nodes:
  - { id: a, component: box, label: Input }
  - { id: b, component: box, label: Import }
  - { id: trap, component: test/trapezoid, label: "Filter\\n日本語" }
  - { id: stack, component: test/stack, label: "Jobs\\nQueue", group: group }
  - { id: c, component: box, label: Output }
edges:
  - { from: a, to: trap, label: Read }
  - { from: b, to: trap }
  - { from: trap, to: stack, component: double-arrow }
  - { from: stack, to: c, component: line }
`;
