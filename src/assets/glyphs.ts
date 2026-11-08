/**
 * Node glyphs (#408, design doc `408-node-glyphs`): small marks drawn over a
 * node's border, such as the feature vector (a short column of coloured
 * cells) a paper figure puts at the corner of an icon.
 *
 * A glyph is resolved once, in the compiler, to a {@link GlyphIR}: its parts
 * (cells, a dot or a pill) in its own frame, already coloured, and where it
 * sits on the body. Everything else reads the same numbers, so the layout
 * (overhang), the writers (SVG, picture and editable PPTX through the SVG)
 * and the geometry lint agree on one footprint:
 *
 * - the glyph is centered on a corner or the middle of a side of the node's
 *   body, moved by `dx` / `dy` ems; its footprint adds half the outline
 * - it never takes part in routing: edges attach to the body
 * - lengths default to fractions of the node's font size, so a figure scaled
 *   to paper keeps readable cells
 */

import type { GlyphIR, GlyphPartIR, NodeIR } from "../compiler/ir";
import type { FigureGlyph } from "../core/figure/schema";
import type { Rect } from "../core/geometry";
import { dimStyle } from "../core/theme/dim";
import { resolveStyle } from "../core/theme/resolve";
import type { Theme } from "../core/theme/schema";
import type { NodeStyle } from "../core/theme/style";
import { isTone } from "../core/theme/tones";
import { n, paint } from "../render/stroke";

/** Default side of a cell (and height of a pill, diameter of a dot), in ems. */
const DEFAULT_SIZE_EM = 0.4;
/** A pill is this many times as long as it is high unless `width` says otherwise. */
const PILL_ASPECT = 2.2;
const DEFAULT_CELLS = 3;
/** The outline is this fraction of the box's stroke, within the bounds below (units). */
const OUTLINE_RATIO = 0.6;
const MIN_OUTLINE = 0.5;
const MAX_OUTLINE = 1.5;

/** The outline of a solid glyph: 0.5pt. */
const SOLID_OUTLINE = { pt: 0.5, units: 1 } as const;

/** A color 35% of the way to black, for a tone the theme gives no line color. */
function darken(color: string): string {
  const hex = color.replace(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i, "#$1$1$2$2$3$3");
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return color;
  const channels = [1, 3, 5].map((i) =>
    Math.round(Number.parseInt(hex.slice(i, i + 2), 16) * 0.65)
      .toString(16)
      .padStart(2, "0"),
  );
  return `#${channels.join("")}`;
}

const round = (value: number) => Math.round(value * 1000) / 1000;

/** The glyphs of a node: each one resolved against the theme and the node's own style. */
export function glyphsOf(
  glyphs: readonly FigureGlyph[],
  style: NodeStyle,
  theme: Theme,
  dimmed: boolean,
): GlyphIR[] {
  const em = style.fontSize.units;
  const fillOf = (
    tone: string | undefined,
    solid: boolean,
  ): { fill: string; stroke: string; width: number } => {
    const resolved = resolveStyle(theme, {
      kind: "node",
      id: "sumi/box",
      variant: "default",
      ...(tone !== undefined && isTone(tone) && { tone }),
    }).style;
    // Solid (#408): the tone's accent (its line color, a dark shade of the hue;
    // a gray step in the monochrome themes), outlined in the theme's ink. A
    // theme without a line color for the tone gets its fill darkened.
    const accent =
      solid && tone !== undefined && isTone(tone)
        ? (theme.toneLines.get(tone)?.stroke ?? darken(resolved.fill))
        : resolved.fill;
    const base: NodeStyle = solid
      ? { ...resolved, fill: accent, stroke: resolved.fontColor, strokeWidth: SOLID_OUTLINE }
      : resolved;
    const painted = dimmed && theme.dim !== undefined ? dimStyle(base, theme.dim, true) : base;
    return { fill: painted.fill, stroke: painted.stroke, width: base.strokeWidth.units };
  };
  return glyphs.map((glyph): GlyphIR => {
    const size = round(glyph.size === undefined ? em * DEFAULT_SIZE_EM : glyph.size * 2);
    const solid = glyph.strength === "solid";
    const fixed = (tone: string | undefined) => fillOf(tone === "none" ? undefined : tone, solid);
    const base = fixed(glyph.tone);
    const outlined = glyph.outline !== false && base.width > 0 && base.stroke !== "transparent";
    const strokeWidth = !outlined
      ? 0
      : solid
        ? SOLID_OUTLINE.units
        : round(Math.min(MAX_OUTLINE, Math.max(MIN_OUTLINE, base.width * OUTLINE_RATIO)));
    const parts: GlyphPartIR[] = [];
    let width = size;
    let height = size;
    if (glyph.kind === "vector") {
      const count = glyph.tones?.length ?? glyph.cells ?? DEFAULT_CELLS;
      const right = glyph.direction === "right";
      for (let i = 0; i < count; i++) {
        const tone = glyph.tones?.[i] ?? glyph.tone;
        parts.push({
          x: right ? round(i * size) : 0,
          y: right ? 0 : round(i * size),
          width: size,
          height: size,
          radius: 0,
          fill: fixed(tone).fill,
        });
      }
      if (right) width = round(count * size);
      else height = round(count * size);
    } else if (glyph.kind === "pill") {
      width = round(glyph.width === undefined ? size * PILL_ASPECT : glyph.width * 2);
      parts.push({ x: 0, y: 0, width, height: size, radius: round(size / 2), fill: base.fill });
    } else {
      parts.push({
        x: 0,
        y: 0,
        width: size,
        height: size,
        radius: round(size / 2),
        fill: base.fill,
      });
    }
    return {
      kind: glyph.kind,
      at: glyph.at,
      dx: round((glyph.dx ?? 0) * em),
      dy: round((glyph.dy ?? 0) * em),
      width,
      height,
      parts,
      stroke: base.stroke,
      strokeWidth,
    };
  });
}

/** The point of `rect` a glyph at `at` is centered on. */
function anchor(at: GlyphIR["at"], rect: Rect): { x: number; y: number } {
  const x = at.endsWith("east")
    ? rect.x + rect.width
    : at.endsWith("west")
      ? rect.x
      : rect.x + rect.width / 2;
  const y = at.startsWith("south")
    ? rect.y + rect.height
    : at.startsWith("north")
      ? rect.y
      : rect.y + rect.height / 2;
  return { x, y };
}

/** Where a glyph's parts start (top left of its drawing, without the outline's half width). */
function origin(glyph: GlyphIR, body: Rect): { x: number; y: number } {
  const c = anchor(glyph.at, body);
  return { x: c.x + glyph.dx - glyph.width / 2, y: c.y + glyph.dy - glyph.height / 2 };
}

/** A glyph's full footprint: its parts and half the outline around them. */
export function glyphRect(glyph: GlyphIR, body: Rect): Rect {
  const o = origin(glyph, body);
  const half = glyph.strokeWidth / 2;
  return {
    x: o.x - half,
    y: o.y - half,
    width: glyph.width + glyph.strokeWidth,
    height: glyph.height + glyph.strokeWidth,
  };
}

/** The footprints of all of a node's glyphs (none without glyphs). */
export function glyphRects(node: Pick<NodeIR, "glyphs">, body: Rect): Rect[] {
  return (node.glyphs ?? []).map((glyph) => glyphRect(glyph, body));
}

/**
 * The glyphs as one `<g class="sumi-glyphs">` of `<rect>`s (cells and pills
 * with `rx`; a dot is a full-radius rect), or `""` without glyphs. One shape
 * per part keeps the picture exports and the editable PPTX alike.
 */
export function glyphMarkup(node: Pick<NodeIR, "glyphs">, body: Rect): string {
  if (node.glyphs === undefined || node.glyphs.length === 0) return "";
  const groups = node.glyphs.map((glyph) => {
    const o = origin(glyph, body);
    const outline =
      glyph.strokeWidth > 0
        ? ` stroke="${paint(glyph.stroke)}" stroke-width="${n(glyph.strokeWidth)}"`
        : ' stroke="none" stroke-width="0"';
    const rects = glyph.parts
      .map((part) => {
        const rx = part.radius > 0 ? ` rx="${n(part.radius)}"` : "";
        return `<rect x="${n(o.x + part.x)}" y="${n(o.y + part.y)}" width="${n(part.width)}" height="${n(part.height)}"${rx} fill="${paint(part.fill)}"${outline}/>`;
      })
      .join("");
    return `<g class="sumi-glyph sumi-glyph-${glyph.kind}">${rects}</g>`;
  });
  return `<g class="sumi-glyphs">${groups.join("")}</g>`;
}
