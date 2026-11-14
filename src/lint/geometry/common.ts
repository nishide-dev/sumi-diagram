/** Helpers the geometry rules share: printed sizes, element predicates and wording. */

import { unitsToMm } from "../../render/geometry";
import type { GeometryContext, GeometryElement } from "./context";

/**
 * Printed size ÷ drawn size (#183, `figure.fit: scale`; 1 otherwise). Element
 * geometry stays in drawing units: containment and intersection are checked
 * there as drawn, while physical thresholds (a gap in pt, a run in mm) are
 * converted with {@link drawnUnits} and reported lengths with {@link printedUnits}.
 */
export const printScale = (context: GeometryContext): number => context.inspection.scale ?? 1;

/** A length given at printed size (in units of 0.5pt), in drawing units. */
export const drawnUnits = (context: GeometryContext, units: number): number =>
  units / printScale(context);

/** A drawn length in units, at its printed size (still in units of 0.5pt). */
export const printedUnits = (context: GeometryContext, units: number): number =>
  units * printScale(context);

/** A drawn length in mm at its printed size (#183). */
export const mmText = (context: GeometryContext, units: number, digits = 1): string =>
  `${unitsToMm(printedUnits(context, units)).toFixed(digits)}mm`;

export const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

export const isStructured = (context: GeometryContext): boolean =>
  context.ir.meta.engine === "structured";

/** `true` if the element is painted at all (not fully transparent). */
export const isOpaque = (e: GeometryElement): boolean => e.ir.style.opacity > 0;

/** `true` for an edge drawn with a visible stroke, other than a legend's sample line. */
export const isDrawnEdge = (e: GeometryElement): boolean =>
  e.ir.kind === "edge" &&
  e.drawn !== undefined &&
  e.ir.legend === undefined &&
  e.ir.style.strokeWidth.units > 0 &&
  e.ir.style.stroke !== "transparent" &&
  isOpaque(e);
