/**
 * Cuboid dimensions (#575): `props.dims` of a `cuboid` node are expanded into
 * `label` nodes attached to it, so layout, geometry lint and every output
 * draw and check them as ordinary horizontal text. Like a group's caption
 * (#130) each has a reserved ID, `<node>-dim-width`, `-dim-height` or
 * `-dim-depth`, and diagnostics about it point at the `dims` field.
 *
 * Placed relative to the silhouette (the cuboid's footprint): the width above
 * it, the height below it, the depth at its lower right corner.
 */
import { type CheckState, nodeKey } from "../check-state";
import { recordExpanded, reportReservedId, takenIds } from "./expand";
import { type FigureNode, NodeSchema } from "./schema";
import type { Locator } from "./yaml";

export const CUBOID_IDS: readonly string[] = ["cuboid", "sumi/cuboid"];
export const CUBOID_DIM_AXES = ["width", "height", "depth"] as const;
export type CuboidDimAxis = (typeof CUBOID_DIM_AXES)[number];

/** Where each dimension text sits: the side or corner of the silhouette and the gap to it. */
const PLACEMENT: Record<CuboidDimAxis, { side: "north" | "south" | "south-east"; gap: string }> = {
  width: { side: "north", gap: "1.2mm" },
  height: { side: "south", gap: "2mm" },
  depth: { side: "south-east", gap: "0mm" },
};

export const cuboidDimId = (node: string, axis: CuboidDimAxis): string => `${node}-dim-${axis}`;

export function expandCuboidDims(state: CheckState, locate: Locator): void {
  const { doc } = state;
  if (doc.nodes === undefined || doc.figure?.layout.engine !== "structured") return;
  const taken = takenIds(doc);
  const added: FigureNode[] = [];
  for (const [index, node] of doc.nodes.entries()) {
    if (node === undefined || !CUBOID_IDS.includes(node.component)) continue;
    const dims = node.props.dims;
    if (typeof dims !== "object" || dims === null || Array.isArray(dims)) continue;
    for (const axis of CUBOID_DIM_AXES) {
      const text = (dims as Record<string, unknown>)[axis];
      if (typeof text !== "string" || text === "") continue;
      const id = cuboidDimId(node.id, axis);
      const path = ["nodes", index, "props", "dims", axis];
      const owner = taken.get(id);
      if (owner !== undefined) {
        reportReservedId(state, locate, {
          id,
          owner,
          reservedFor: `the ${axis} dimension of cuboid "${node.id}"`,
          related: { path, message: "The dimension is written here." },
        });
        continue;
      }
      taken.set(id, path);
      const { side, gap } = PLACEMENT[axis];
      added.push(
        NodeSchema.parse({
          id,
          component: "sumi/label",
          label: text,
          text: "small",
          props: {},
          attach: { to: node.id, side, gap },
        }),
      );
      recordExpanded(doc, [
        [
          nodeKey(id),
          {
            from: "dims",
            path,
            subject: { kind: "node", id: node.id },
            name: `the ${axis} dimension of cuboid "${node.id}"`,
          },
        ],
      ]);
    }
  }
  doc.nodes.push(...added);
}
