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

/** An arrowhead's form, as `drawArrowhead()` draws it (the registry's `Arrowhead`). */
type HeadForm = "none" | "triangle" | "arrow" | "open" | "diamond" | "circle" | "box" | "cross";

/**
 * How far from its axis an arrowhead `length` long covers a line at its back
 * (#614): the half width of the triangle, the notched `arrow` and the circle;
 * the box and the diamond are 0.8 of that wide; the open chevron's arms end
 * half a stroke short of it. `none` and `cross` cover nothing a bundle needs
 * (no line ends under them): unlimited.
 */
export function headReach(head: HeadForm | undefined, length: number, strokeUnits: number): number {
  switch (head) {
    case undefined:
    case "none":
    case "cross":
      return Number.POSITIVE_INFINITY;
    case "box":
    case "diamond":
      return 0.4 * length;
    case "open":
      return length / 2 - strokeUnits / 2;
    default:
      return length / 2;
  }
}

/** Largest automatic arrowhead scale of a bundle: the largest written scale. */
const MAX_BUNDLE_SCALE = 2;

/**
 * The arrowhead scale a bundle of `strands` lines needs so each of its `heads`
 * covers it (#614): the outer line (`(strands − 1)` line widths from the axis
 * at `strandSpacing()`) and half a line width beside it under the head's
 * reach (`headReach()`), in quarter steps between 1 and 2. A head that needs
 * more stays at 2 and the writer narrows the bundle under it
 * (`bundleSpacing()`).
 */
export function bundleArrowheadScale(
  strokeUnits: number,
  strands: number,
  heads: readonly (HeadForm | undefined)[] = ["triangle"],
): number {
  const outer = (strands - 1) * strokeUnits + strokeUnits / 2;
  let scale = 1;
  for (const head of heads) {
    while (
      scale < MAX_BUNDLE_SCALE &&
      headReach(head, arrowheadLength(strokeUnits, scale), strokeUnits) < outer
    )
      scale += 0.25;
  }
  return scale;
}

/**
 * The spacing of a bundle's lines under its heads (#614): `strandSpacing()`,
 * or less where a head (at its drawn `length`) cannot reach the outer line at
 * that spacing, so every line ends under the head (the outer one and half a
 * line width beside it within `headReach()`).
 */
export function bundleSpacing(
  strokeUnits: number,
  strands: number,
  length: number,
  heads: readonly (HeadForm | undefined)[],
): number {
  let spacing = strandSpacing(strokeUnits);
  if (strands < 2) return spacing;
  for (const head of heads) {
    const reach = headReach(head, length, strokeUnits);
    spacing = Math.min(spacing, (2 * (reach - strokeUnits / 2)) / (strands - 1));
  }
  return Math.max(0, spacing);
}
