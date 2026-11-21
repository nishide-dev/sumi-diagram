/**
 * Dimming a group and everything inside it (#175, design doc §6.53).
 *
 * `groups[].dim: true` is a field, not a variant: it is orthogonal to the
 * group's own look (a dimmed group keeps its variant and tone) and it is
 * inherited, which no variant is. A dimmed element keeps its resolved style
 * except for colors, which the theme's `dim` gives (no opacity):
 *
 * - every visible stroke (lines, borders, arrowheads, junction dots) and every
 *   text take `dim.stroke` and `dim.fontColor` (solid node text darkens as
 *   needed for 3:1 contrast; solid stack separators follow that text color);
 * - every fill moves toward the canvas by `dim.lighten` (0 = unchanged, 1 =
 *   canvas), so tone fills become their dimmed versions and lighter / darker
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
import { contrastRatio, readableInk } from "./node-variants";
import type { Color, ResolvedStyle } from "./style";

/** A theme's colors for dimmed elements (`dim` in the theme). */
export interface DimColors {
  /** Color of every text of a dimmed element. */
  readonly fontColor: Color;
  /** Color of every visible stroke of a dimmed element. */
  readonly stroke: Color;
  /** How far each fill moves toward the canvas, from 0 (unchanged) to 1 (canvas). */
  readonly lighten: number;
}

/** `#rgb` / `#rrggbb` as lowercase `#rrggbb`; `transparent` as it is. */
export function expandColor(color: Color): Color {
  if (color === "transparent") return color;
  const hex = color.length === 4 ? [...color.slice(1)].map((c) => c + c).join("") : color.slice(1);
  return `#${hex.toLowerCase()}`;
}

/** `#rgb` / `#rrggbb` mixed toward the canvas by `amount`, as lowercase `#rrggbb`. */
export function lightenColor(color: Color, amount: number, canvas: Color = "#ffffff"): Color {
  if (color === "transparent") return color;
  const hex = expandColor(color).slice(1);
  const ground = expandColor(canvas).slice(1);
  const channels = [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  const mixed = channels.map((c, i) =>
    Math.round(c + (Number.parseInt(ground.slice(i * 2, i * 2 + 2), 16) - c) * amount),
  );
  return `#${mixed.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** The contrast against the canvas a pale outline keeps (#612): above the 2:1 of `geometry/low-stroke-contrast`. */
export const PALE_LINE_CONTRAST = 2.5;
/** The contrast against its fill pale text keeps (#612), as dimmed text on a solid area. */
export const PALE_TEXT_CONTRAST = 3;
/** How far a pale fill moves toward the canvas (#612). */
export const PALE_FILL_LIGHTEN = 0.5;

/**
 * `color` moved toward the canvas as far as it can while keeping `minimum`
 * contrast against `against` (unchanged if it already has less). In steps of
 * 1%, so the result is deterministic.
 */
function fadeToward(color: Color, against: Color, minimum: number, canvas: Color): Color {
  if (!/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(color) || against === "transparent") return color;
  const ground = expandColor(against);
  let best = expandColor(color);
  if (contrastRatio(best, ground) <= minimum) return best;
  for (let percent = 1; percent <= 100; percent++) {
    const next = lightenColor(color, percent / 100, canvas);
    if (contrastRatio(next, ground) < minimum) break;
    best = next;
  }
  return best;
}

/**
 * A pale element (#612: a muted matrix cell and its legend sample): its fill
 * moves {@link PALE_FILL_LIGHTEN} toward the canvas, its outline (and hatch)
 * toward the canvas until {@link PALE_LINE_CONTRAST} against it, and its text
 * until {@link PALE_TEXT_CONTRAST} against the new fill. Sizes, fonts and
 * dashes stay, so layout is the same.
 */
export function paleStyle<S extends ResolvedStyle>(style: S, canvas: Color = "#ffffff"): S {
  const ground = expandColor(canvas);
  const fill = lightenColor(style.fill, PALE_FILL_LIGHTEN, ground);
  const behind = fill === "transparent" ? ground : fill;
  const pale: S = {
    ...style,
    fill,
    stroke: fadeToward(style.stroke, ground, PALE_LINE_CONTRAST, ground),
    fontColor: fadeToward(style.fontColor, behind, PALE_TEXT_CONTRAST, ground),
    ...("hatch" in style &&
      style.hatch !== undefined && {
        hatch: fadeToward(style.hatch, behind, PALE_LINE_CONTRAST, ground),
      }),
  };
  return Object.freeze(pale);
}

/**
 * The dimmed color of a frame: the theme's dim stroke, unless the frame already has less contrast
 * against the canvas (#634: `sumi`'s pale panel frames). Dimming never makes a frame louder.
 */
function quieter(own: Color, dimmed: Color, canvas: Color): Color {
  const hex = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;
  if (!hex.test(own) || !hex.test(dimmed) || !hex.test(canvas)) return dimmed;
  const ground = expandColor(canvas);
  return contrastRatio(expandColor(own), ground) < contrastRatio(expandColor(dimmed), ground)
    ? own
    : dimmed;
}

/** Solid areas lighten and keep at least 3:1 text contrast (#214). */
export function dimStyle<S extends ResolvedStyle>(
  style: S,
  dim: DimColors,
  areaFill = false,
  canvas: Color = "#ffffff",
): S {
  const visible = (color: Color, to: Color) => (color === "transparent" ? color : to);
  // Compared expanded, so `#000` and `#000000` are the same ink.
  const ink =
    !areaFill &&
    style.fill !== "transparent" &&
    expandColor(style.fill) === expandColor(style.stroke);
  // A frame (a group's or a legend's) is structure: a quiet one stays quiet. A node's or an
  // edge's line takes the dim gray, which also drops its tone.
  const stroke = style.kind === "group" ? quieter(style.stroke, dim.stroke, canvas) : dim.stroke;
  const fill = ink ? stroke : lightenColor(style.fill, dim.lighten, canvas);
  const dimmed: S = {
    ...style,
    stroke: visible(style.stroke, stroke),
    fontColor: visible(
      style.fontColor,
      areaFill ? readableInk(expandColor(fill), expandColor(dim.fontColor), 3) : dim.fontColor,
    ),
    fill,
    // Hatch lines (#180) are lines.
    ...("hatch" in style && style.hatch !== undefined && { hatch: dim.stroke }),
  };
  // A muted sublabel (#519) is dimmed with its label.
  if (style.kind === "node" && style.sublabel?.fontColor !== undefined)
    (dimmed as { sublabel?: unknown }).sublabel = {
      ...style.sublabel,
      fontColor: dimmed.fontColor,
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
