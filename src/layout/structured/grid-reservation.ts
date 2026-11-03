import type { Rect } from "../ir";

/** Placement-only evidence for hints; never serialized into LayoutIR or figure outputs. */
export const gridReservations = new WeakMap<Rect, Rect>();
