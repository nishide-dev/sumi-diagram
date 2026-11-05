import type { FigureIR } from "../../compiler/ir";
import type { Diagnostic } from "../../core/diagnostics";
import { segmentCrossesRegion } from "../../lint/geometry/edges";
import { groupLayerObstacles } from "../group-layers";
import type { LayoutIR } from "../ir";

/** Stubs and straight/zoom routes must also respect the reserved back-card bands. */
export function groupLayerDiagnostics(ir: FigureIR, layout: LayoutIR): Diagnostic[] {
  const obstacles = layout.groups.flatMap((placed) => {
    const group = ir.elements.get(placed.key);
    return group?.kind === "group"
      ? groupLayerObstacles(group, placed.rect).map((rect) => ({ group, rect }))
      : [];
  });
  if (obstacles.length === 0) return [];
  const diagnostics: Diagnostic[] = [];
  for (const placed of layout.edges) {
    const edge = ir.edges.find((e) => e.key === placed.key);
    if (!edge || !placed.route) continue;
    const lines = placed.route.lines ?? [placed.route.points];
    const reported = new Set<string>();
    for (const { group, rect } of obstacles) {
      if (reported.has(group.id)) continue;
      const region = {
        kind: "polygon" as const,
        points: [
          { x: rect.x, y: rect.y },
          { x: rect.x + rect.width, y: rect.y },
          { x: rect.x + rect.width, y: rect.y + rect.height },
          { x: rect.x, y: rect.y + rect.height },
        ],
      };
      if (
        !lines.some((line) =>
          line.some((point, i) => {
            const previous = line[i - 1];
            return previous !== undefined && segmentCrossesRegion(previous, point, region, 0);
          }),
        )
      )
        continue;
      reported.add(group.id);
      const source = ir.sourceMap.get(edge.key);
      diagnostics.push({
        code: "layout/no-route",
        severity: "error",
        message: `The edge crosses the reserved back cards of group "${group.id}"; this route cannot keep the stack clear and connect to the front frame.`,
        ...(source && { path: source.path, location: source.location }),
        subject: { kind: "edge", id: edge.id ?? `edges[${edge.index}]` },
        hint: "Use west or south anchors on the layered group, or move the other endpoint to leave its back cards clear.",
      });
    }
  }
  return diagnostics;
}
