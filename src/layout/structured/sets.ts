/**
 * Places the set enclosures of a structured figure (#407, design record
 * 407). A set takes no space in the arrange trees: the members are placed
 * first (by stack, row, grid, `place`, attach), then each set's outline is
 * fitted around their final boxes. The caller grows the canvas to hold the
 * outlines and labels, and draws them below the nodes and edges.
 */

import { badgeRect } from "../../assets/draw";
import { glyphRects } from "../../assets/glyphs";
import type { FigureIR, SetIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";
import type { Point, Rect, SetOutline, TextMetrics } from "../ir";
import {
  fitSetOutline,
  fitSetOutlineExact,
  type MemberFootprint,
  outlineBounds,
  setLabelCenter,
} from "../set-shape";
import { measureText, type TextMeasurer } from "../text";

/** A set fitted around its members, in the engine's coordinates (before the canvas shift). */
export interface FittedSet {
  readonly set: SetIR;
  readonly outline: SetOutline;
  /** The outline's bounding box. */
  readonly rect: Rect;
  /** The axes whose exact `width` / `height` (#545) the members do not fit; empty when met. */
  readonly unmet: readonly ("width" | "height")[];
  /** The measured label and where its center goes; omitted without a label. */
  readonly label?: { readonly metrics: TextMetrics; readonly center: Point };
}

/** Gap between an outline and its label: 0.4 em. */
export const setLabelGap = (fontSizeUnits: number): number => Math.round(fontSizeUnits * 0.4);

/**
 * Fits every set of `ir` around its members. `rectOf` gives a placed
 * element's box; `padding` is the default room in units (the profile's group
 * padding); `captionOf` gives a node's caption box below its frame (#491).
 */
export function fitSets(
  ir: FigureIR,
  rectOf: (key: ElementKey) => Rect,
  measurer: TextMeasurer,
  padding: number,
  captionOf: (key: ElementKey) => Rect | undefined = () => undefined,
): FittedSet[] {
  const nodes = new Map(ir.nodes.map((n) => [n.key, n]));
  return (ir.sets ?? []).map((set) => {
    const members: MemberFootprint[] = set.members.flatMap((key) => {
      const rect = rectOf(key);
      const node = nodes.get(key);
      const round = node !== undefined && (node.shape === "circle" || node.shape === "oval");
      const badge = node === undefined ? undefined : badgeRect(node, rect);
      // A caption below its frame (#491) is text the outline must not cut:
      // enclosed with either `enclose`, like the badge.
      const caption = captionOf(key);
      return [
        { rect, round },
        ...(badge === undefined ? [] : [{ rect: badge, round: false }]),
        ...(caption === undefined ? [] : [{ rect: caption, round: false }]),
        ...(node === undefined || set.enclose !== "footprint"
          ? []
          : glyphRects(node, rect).map((rect) => ({ rect, round: false }))),
      ];
    });
    const room = set.paddingPt === undefined ? padding : set.paddingPt * 2;
    const min = {
      ...(set.minWidthPt !== undefined && { width: set.minWidthPt * 2 }),
      ...(set.minHeightPt !== undefined && { height: set.minHeightPt * 2 }),
    };
    const exact = {
      ...(set.widthPt !== undefined && { width: set.widthPt * 2 }),
      ...(set.heightPt !== undefined && { height: set.heightPt * 2 }),
    };
    const { outline, unmet } =
      set.widthPt === undefined && set.heightPt === undefined
        ? {
            outline: fitSetOutline(
              members,
              set.shape,
              room,
              set.style.radius.units,
              set.angle,
              min,
            ),
            unmet: [] as ("width" | "height")[],
          }
        : fitSetOutlineExact(
            members,
            set.shape,
            room,
            set.style.radius.units,
            set.angle,
            exact,
            min,
          );
    const rect = outlineBounds(outline);
    const metrics = measureText(set.label, set.style, measurer);
    return {
      set,
      outline,
      rect,
      unmet,
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
