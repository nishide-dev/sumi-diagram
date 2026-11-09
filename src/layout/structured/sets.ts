/**
 * Places the set enclosures of a structured figure (#407, design record
 * 407). A set takes no space in the arrange trees: the members are placed
 * first (by stack, row, grid, `place`, attach), then each set's outline is
 * fitted around their final boxes. The caller grows the canvas to hold the
 * outlines and labels, and draws them below the nodes and edges.
 */

import { badgeRect } from "../../assets/draw";
import type { FigureIR, SetIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";
import type { Point, Rect, SetOutline, TextMetrics } from "../ir";
import { fitSetOutline, type MemberFootprint, outlineBounds, setLabelCenter } from "../set-shape";
import { measureText, type TextMeasurer } from "../text";

/** A set fitted around its members, in the engine's coordinates (before the canvas shift). */
export interface FittedSet {
  readonly set: SetIR;
  readonly outline: SetOutline;
  /** The outline's bounding box. */
  readonly rect: Rect;
  /** The measured label and where its center goes; omitted without a label. */
  readonly label?: { readonly metrics: TextMetrics; readonly center: Point };
}

/** Gap between an outline and its label: 0.4 em. */
export const setLabelGap = (fontSizeUnits: number): number => Math.round(fontSizeUnits * 0.4);

/**
 * Fits every set of `ir` around its members. `rectOf` gives a placed
 * element's box; `padding` is the default room in units (the profile's group
 * padding).
 */
export function fitSets(
  ir: FigureIR,
  rectOf: (key: ElementKey) => Rect,
  measurer: TextMeasurer,
  padding: number,
): FittedSet[] {
  const nodes = new Map(ir.nodes.map((n) => [n.key, n]));
  return (ir.sets ?? []).map((set) => {
    const members: MemberFootprint[] = set.members.flatMap((key) => {
      const rect = rectOf(key);
      const node = nodes.get(key);
      const round = node !== undefined && (node.shape === "circle" || node.shape === "oval");
      const badge = node === undefined ? undefined : badgeRect(node, rect);
      return [{ rect, round }, ...(badge === undefined ? [] : [{ rect: badge, round: false }])];
    });
    const room = set.paddingPt === undefined ? padding : set.paddingPt * 2;
    const outline = fitSetOutline(members, set.shape, room, set.style.radius.units, set.angle);
    const rect = outlineBounds(outline);
    const metrics = measureText(set.label, set.style, measurer);
    return {
      set,
      outline,
      rect,
      ...(metrics !== undefined && {
        label: {
          metrics,
          center: setLabelCenter(
            outline,
            set.labelAt,
            metrics,
            setLabelGap(set.style.fontSize.units),
          ),
        },
      }),
    };
  });
}
