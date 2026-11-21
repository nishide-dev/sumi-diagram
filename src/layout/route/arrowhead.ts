/**
 * The length an arrowhead takes along the line for an edge stroke of
 * `strokeUnits`: D2's triangle (4 + 4 × stroke width). The router keeps the
 * last segment before an arrowhead at least this long; the SVG writer (#91)
 * must not draw a longer one.
 */
export function arrowheadLength(strokeUnits: number, scale = 1): number {
  const length = 4 + 4 * strokeUnits;
  return scale === 1 ? length : Math.round(length * scale * 1000) / 1000;
}

/**
 * The arrowhead length of an edge style (#427): D2's triangle for its stroke
 * width, times its `arrowheadScale`. The router's reserved room, the writer
 * and the lints all read it here, so a scaled head keeps them in step.
 */
export function edgeArrowheadLength(style: {
  readonly strokeWidth: { readonly units: number };
  readonly arrowheadScale?: number | undefined;
}): number {
  return arrowheadLength(style.strokeWidth.units, style.arrowheadScale);
}
/** Visible straight wire before a group-padding arrowhead: 2pt (#247). */
export const ARROWHEAD_STEM_UNITS = 4;

/**
 * Corner radius reserved before the visible stem of a group-padding
 * arrowhead: 2pt (#260). The padding holds arrowhead + stem + this, so the
 * turn right before the stem rounds with a small radius instead of staying
 * sharp. The full `WIRE_CORNER_RADIUS` is not reserved there.
 */
export const GROUP_STEM_CORNER_UNITS = 4;

/**
 * Largest structured wire corner radius: 4pt (#101), a little under D2's
 * 5pt for ELK routes. The router prefers this much extra approach (#116)
 * so the writer can round a corner without reaching the arrowhead.
 */
export const WIRE_CORNER_RADIUS = 8;

/**
 * The distance between the centres of two neighbouring lines of a bundle
 * (#614, `edges[].strands`): two line widths, so the gap between them is one
 * line width at any width.
 */
export const strandSpacing = (strokeUnits: number): number => 2 * strokeUnits;

/**
 * The arrowhead scale a bundle of `strands` lines needs so one head covers it
 * (#614): the head (as wide as it is long) at least `2 · strands` line widths
 * wide, which leaves half a line width of head beside the outer lines; in
 * quarter steps, between 1 and 2 (the largest scale).
 */
export function bundleArrowheadScale(strokeUnits: number, strands: number): number {
  const needed = (2 * strands * strokeUnits) / arrowheadLength(strokeUnits);
  return Math.min(2, Math.max(1, Math.ceil(needed * 4 - 1e-9) / 4));
}
