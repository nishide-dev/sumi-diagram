import type { GroupIR } from "../compiler/ir";
import type { Rect } from "./ir";

export function groupLayerSpread(group: Pick<GroupIR, "layers">): number {
  return group.layers === undefined ? 0 : (group.layers.count - 1) * group.layers.offset.units;
}

/** Layout bounds cover all cards; content and connections belong to the front. */
export function groupFrontRect(group: Pick<GroupIR, "layers">, footprint: Rect): Rect {
  const spread = groupLayerSpread(group);
  return spread === 0
    ? footprint
    : {
        x: footprint.x,
        y: footprint.y + spread,
        width: footprint.width - spread,
        height: footprint.height - spread,
      };
}

/** Back to front, in painter's order. */
export function groupLayerRects(group: GroupIR, footprint: Rect): Rect[] {
  const front = groupFrontRect(group, footprint);
  const count = group.layers?.count ?? 1;
  const offset = group.layers?.offset.units ?? 0;
  return Array.from({ length: count }, (_, i) => {
    const shift = (count - 1 - i) * offset;
    return { ...front, x: front.x + shift, y: front.y - shift };
  });
}

/** Label exclusions outside the front card (including stair-step gaps); routes may cross them. */
export function groupLayerObstacles(group: GroupIR, footprint: Rect): Rect[] {
  const spread = groupLayerSpread(group);
  if (spread === 0) return [];
  const front = groupFrontRect(group, footprint);
  return [
    { x: footprint.x, y: footprint.y, width: footprint.width, height: spread },
    { x: front.x + front.width, y: front.y, width: spread, height: front.height },
  ];
}
