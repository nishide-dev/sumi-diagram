/**
 * Test support for the geometry lint: a compiled figure plus a hand-made SVG
 * inspection, so rules can be tested on exact geometry without D2. Not part
 * of the public API.
 */

import { type CompiledFigure, compileFigure } from "../../compiler/compile";
import type { ElementKey } from "../../core/check-state";
import type { Diagnostic } from "../../core/diagnostics";
import { mmToPt } from "../../core/units";
import { type PathSegment, type Point, type Rect, toSize } from "../../render/geometry";
import type {
  ElementGeometry,
  LabelGeometry,
  ProfileLimits,
  SvgInspection,
} from "../../render/inspect";
import type { LintConfig } from "../config";
import { lintGeometry } from "./lint";

export function compile(source: string): CompiledFigure {
  const result = compileFigure(source);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return result.value;
}

/**
 * A label in the regular font at `size` units, centered at `x` with its first
 * baseline at `baseline`. "漢" is exactly 1em wide in BIZ UDPGothic, and a
 * line box is 1em tall (ascender 1802/2048 above the baseline).
 */
export function label(
  text: string,
  x: number,
  baseline: number,
  options: Partial<LabelGeometry> = {},
): LabelGeometry {
  const fontSizeUnits = options.fontSizeUnits ?? 16;
  return {
    text,
    anchor: { x, y: baseline },
    fontSizeUnits,
    lines: text.split("\n").length,
    lineHeightUnits: fontSizeUnits,
    font: "regular",
    ...options,
  };
}

/** Ascent of a 16-unit label in BIZ UD Gothic: the line box starts this far above the baseline. */
export const ASCENT_16 = (1802 / 2048) * 16;

/** The baseline that vertically centers a one-line 16-unit label at `centerY`. */
export const centeredBaseline = (centerY: number): number => centerY + ASCENT_16 - 8;

export interface InspectionSpec {
  canvas?: Rect;
  profile?: Partial<ProfileLimits>;
  /** Per element: bbox / labels / path. Elements left out get no labels and no geometry. */
  elements: Partial<
    Record<ElementKey, { bbox?: Rect; labels?: LabelGeometry[]; path?: Point[] | PathSegment[] }>
  >;
  /**
   * What a structured figure paints per edge (#156), as polylines: sets
   * `SvgInspection.painted` (edges left out paint nothing).
   */
  painted?: Partial<Record<ElementKey, Point[][]>>;
}

const isPoints = (path: Point[] | PathSegment[]): path is Point[] =>
  path.length > 0 && !("command" in (path[0] as object));

/** A synthetic inspection of `compiled`, in IR order. */
export function inspection(compiled: CompiledFigure, spec: InspectionSpec): SvgInspection {
  const canvas = spec.canvas ?? { x: 0, y: 0, width: 400, height: 300 };
  const elements: ElementGeometry[] = [...compiled.ir.elements.values()].map((element) => {
    const given = spec.elements[element.key] ?? {};
    const path =
      given.path === undefined
        ? undefined
        : isPoints(given.path)
          ? given.path.map((to, i): PathSegment => ({ command: i === 0 ? "M" : "L", to }))
          : given.path;
    return {
      key: element.key,
      kind: element.kind,
      ...(given.bbox !== undefined && { bbox: given.bbox }),
      labels: given.labels ?? [],
      ...(path !== undefined && { path }),
    };
  });
  return {
    canvas: { viewBox: canvas, width: toSize(canvas.width), height: toSize(canvas.height) },
    profile: { id: "paper-single", maxWidthPt: mmToPt(88), minFontSizePt: 7, ...spec.profile },
    elements,
    ...(spec.painted !== undefined && {
      painted: Object.entries(spec.painted).map(([key, lines]) => ({
        key: key as ElementKey,
        path: (lines ?? []).flatMap((line) =>
          line.map((to, i): PathSegment => ({ command: i === 0 ? "M" : "L", to })),
        ),
      })),
    }),
  };
}

/** Runs the geometry rules (all, or only `code`) on a synthetic inspection. */
export function lintSpec(
  compiled: CompiledFigure,
  spec: InspectionSpec,
  options: { code?: string; config?: LintConfig; source?: string } = {},
): Diagnostic[] {
  const diagnostics = lintGeometry(
    { compiled, inspection: inspection(compiled, spec) },
    {
      ...(options.config !== undefined && { config: options.config }),
      ...(options.source !== undefined && { source: options.source }),
    },
  );
  return options.code === undefined
    ? diagnostics
    : diagnostics.filter((d) => d.code === options.code);
}
