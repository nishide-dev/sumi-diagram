/**
 * The length an arrowhead takes along the line for an edge stroke of
 * `strokeUnits`: D2's triangle (4 + 4 × stroke width). The router keeps the
 * last segment before an arrowhead at least this long; the SVG writer (#91)
 * must not draw a longer one.
 */
export function arrowheadLength(strokeUnits: number): number {
  return 4 + 4 * strokeUnits;
}
/** Visible straight wire before a group-padding arrowhead: 2pt (#247). */
export const ARROWHEAD_STEM_UNITS = 4;

/**
 * Largest structured wire corner radius: 4pt (#101), a little under D2's
 * 5pt for ELK routes. The router prefers this much extra approach (#116)
 * so the writer can round a corner without reaching the arrowhead.
 */
export const WIRE_CORNER_RADIUS = 8;
