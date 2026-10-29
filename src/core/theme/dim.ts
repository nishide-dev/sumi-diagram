/**
 * Dimming a group and everything inside it (#175, design doc §6.53).
 *
 * `groups[].dim: true` is a field, not a variant: it is orthogonal to the
 * group's own look (a dimmed group keeps its variant and tone) and it is
 * inherited, which no variant is. A dimmed element keeps its resolved style
 * except for colors, which the theme's `dim` gives (no opacity):
 *
 * - every visible stroke (lines, borders, arrowheads, junction dots) and every
 *   text take `dim.stroke` and `dim.fontColor`;
 * - every fill moves toward white by `dim.lighten` (0 = unchanged, 1 =
 *   white), so tone fills become their pale versions and lighter / darker
 *   fills keep their order. A fill painted in the element's own stroke color
 *   (ink, e.g. a junction's dot) follows the stroke instead;
 * - `transparent` stays transparent, and nothing else changes (sizes, fonts,
 *   dashes, opacity), so layout is the same with or without `dim`.
 *
 * Which elements are dimmed: a group with `dim: true` and every group, node
 * and expanded element inside it (by `group`, after the layout stage filled
 * it in); a group's caption with its group (the caption is drawn outside the
 * border, as a child of the group's parent); an edge whose two ends are both
 * dimmed elements (an edge crossing into or out of a dimmed group stays as it
 * is). Nested `dim` is the same as one: colors are dimmed once.
 */

import type { ElementKey, PartialFigure } from "../check-state";
import { edgeKey, groupKey, nodeKey } from "../check-state";
import type { DocPath } from "../diagnostics";
import type { Color, ResolvedStyle } from "./style";

/** A theme's colors for dimmed elements (`dim` in the theme). */
export interface DimColors {
  /** Color of every text of a dimmed element. */
  readonly fontColor: Color;
  /** Color of every visible stroke of a dimmed element. */
  readonly stroke: Color;
  /** How far each fill moves toward white, from 0 (unchanged) to 1 (white). */
  readonly lighten: number;
}

/** The color fills move toward: the page (the writers' canvas is white). */
const PAPER = 0xff;

/** `#rgb` / `#rrggbb` as lowercase `#rrggbb`; `transparent` as it is. */
function expandColor(color: Color): Color {
  if (color === "transparent") return color;
  const hex = color.length === 4 ? [...color.slice(1)].map((c) => c + c).join("") : color.slice(1);
  return `#${hex.toLowerCase()}`;
}

/** `#rgb` / `#rrggbb` mixed toward white by `amount`, as lowercase `#rrggbb`. */
export function lightenColor(color: Color, amount: number): Color {
  if (color === "transparent") return color;
  const hex = expandColor(color).slice(1);
  const channels = [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  const mixed = channels.map((c) => Math.round(c + (PAPER - c) * amount));
  return `#${mixed.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** Colors from `dim`; solid node areas lighten even though fill equals stroke (#214). */
export function dimStyle<S extends ResolvedStyle>(style: S, dim: DimColors, areaFill = false): S {
  const visible = (color: Color, to: Color) => (color === "transparent" ? color : to);
  // Compared expanded, so `#000` and `#000000` are the same ink.
  const ink =
    !areaFill &&
    style.fill !== "transparent" &&
    expandColor(style.fill) === expandColor(style.stroke);
  const dimmed: S = {
    ...style,
    stroke: visible(style.stroke, dim.stroke),
    fontColor: visible(style.fontColor, dim.fontColor),
    fill: ink ? dim.stroke : lightenColor(style.fill, dim.lighten),
    // Hatch lines (#180) are lines.
    ...("hatch" in style && style.hatch !== undefined && { hatch: dim.stroke }),
  };
  return Object.freeze(dimmed);
}

/**
 * The dimmed elements of a figure, each with the path of the `dim` field it
 * inherits (of the outermost dimmed group, so diagnostics name the field the
 * author wrote). Group cycles (reported by the `ref` stage) end the walk.
 */
export function dimmedElements(doc: PartialFigure): Map<ElementKey, DocPath> {
  const groups = new Map<
    string,
    { group?: string | undefined; dim?: true | undefined; index: number }
  >();
  for (const [index, g] of (doc.groups ?? []).entries()) {
    if (g !== undefined) groups.set(g.id, { group: g.group, dim: g.dim, index });
  }
  const dimmed = new Map<ElementKey, DocPath>();
  if (![...groups.values()].some((g) => g.dim === true)) return dimmed;

  /** The `dim` path a member of the group inherits, if any (the outermost one). */
  const dimOf = (id: string | undefined): DocPath | undefined => {
    const seen = new Set<string>();
    let found: DocPath | undefined;
    for (let at = id; at !== undefined && !seen.has(at); at = groups.get(at)?.group) {
      seen.add(at);
      const g = groups.get(at);
      if (g?.dim === true) found = ["groups", g.index, "dim"];
    }
    return found;
  };

  for (const id of groups.keys()) {
    const path = dimOf(id);
    if (path !== undefined) dimmed.set(groupKey(id), path);
  }
  for (const [index, n] of (doc.nodes ?? []).entries()) {
    if (n === undefined) continue;
    const caption = doc.captions?.get(index);
    const path = caption === undefined ? dimOf(n.group) : dimOf(caption.group);
    if (path !== undefined) dimmed.set(nodeKey(n.id), path);
  }
  const dimmedEnd = (ref: string): DocPath | undefined =>
    dimmed.get(nodeKey(ref)) ?? dimmed.get(groupKey(ref));
  for (const [index, e] of (doc.edges ?? []).entries()) {
    if (e === undefined) continue;
    const from = dimmedEnd(e.from);
    if (from !== undefined && dimmedEnd(e.to) !== undefined) dimmed.set(edgeKey(e.id, index), from);
  }
  return dimmed;
}
