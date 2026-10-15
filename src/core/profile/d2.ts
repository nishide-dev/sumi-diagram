/**
 * Conversion of a profile's layout values to D2 CLI arguments (design doc
 * §5.2). D2 accepts only integers, so each length is rounded to the nearest D2
 * unit (.5 rounds up); the effective values are recorded for the render
 * artifact.
 *
 * Only profile-derived flags are produced here; `--layout elk`, fonts and
 * `--omit-version` are added by the backend (#9).
 */

import { d2UnitsToPt, roundToD2Units } from "../units";
import type { Profile } from "./schema";

/** A rounded layout value: integer D2 units and the pt they stand for. */
export interface D2LayoutValue {
  /** Integer D2 units passed to the CLI. */
  units: number;
  /** Effective length in pt (`units × 0.5`). */
  pt: number;
}

export interface D2LayoutArgs {
  /** CLI arguments, one argv entry each (no shell quoting needed). */
  args: string[];
  /** Effective (rounded) values behind {@link args}. */
  effective: {
    /** `--pad`, from `margin`. */
    pad: D2LayoutValue;
    /** `--elk-nodeNodeBetweenLayers`, from `layout.layerGap`. */
    nodeNodeBetweenLayers: D2LayoutValue;
    /** `--elk-edgeNodeBetweenLayers`: half of `nodeNodeBetweenLayers`, rounded. */
    edgeNodeBetweenLayers: D2LayoutValue;
    /** `--elk-padding` on all four sides, from `layout.containerPadding`. */
    padding: D2LayoutValue;
  };
}

/** Converts a profile's margin and layout spacing to D2 CLI arguments. */
export function toD2LayoutArgs(profile: Profile): D2LayoutArgs {
  const value = (units: number): D2LayoutValue => ({ units, pt: d2UnitsToPt(units) });
  const pad = value(roundToD2Units(profile.margin.pt));
  const nodeNodeBetweenLayers = value(roundToD2Units(profile.layout.layerGap.pt));
  // round(N / 2) with .5 up, where N is the already rounded layer gap.
  const edgeNodeBetweenLayers = value(Math.floor(nodeNodeBetweenLayers.units / 2 + 0.5));
  const padding = value(roundToD2Units(profile.layout.containerPadding.pt));
  const p = padding.units;
  return {
    args: [
      "--pad",
      String(pad.units),
      "--elk-nodeNodeBetweenLayers",
      String(nodeNodeBetweenLayers.units),
      "--elk-edgeNodeBetweenLayers",
      String(edgeNodeBetweenLayers.units),
      "--elk-padding",
      `[top=${p},left=${p},bottom=${p},right=${p}]`,
    ],
    effective: { pad, nodeNodeBetweenLayers, edgeNodeBetweenLayers, padding },
  };
}
