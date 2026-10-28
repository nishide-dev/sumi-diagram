/**
 * The whole render pipeline for one figure (#11): compile → D2 backend →
 * optional outline measurement → D2 → finalize → inspect → compose → inspect.
 * A structured figure (#91, design doc §6.23) is laid out and routed by Sumi
 * instead: compile → layout → route → structured SVG writer → finalize →
 * inspect.
 *
 * A figure with icons or images (#94, §6.25) loads them after compiling
 * (`loadFigureAssets()`: the image files, checked) and completes image sizes
 * from their aspect ratio. The structured writer draws them itself; for D2
 * they are composed into the placeholders after the outlines.
 */

import { type FigureAssets, hasAssets, loadFigureAssets } from "../assets/load";
import { createD2CliBackend } from "../backends/d2/backend";
import type { DiagramBackend, RenderArtifact } from "../backends/types";
import {
  type CompiledD2Figure,
  type CompiledFigure,
  type CompiledStructuredFigure,
  type CompileOptions,
  compileFigure,
} from "../compiler/compile";
import { type Diagnostic, hasErrors } from "../core/diagnostics";
import type { Result } from "../core/result";
import { getFontSet } from "../core/theme/fonts";
import type { LayoutIR } from "../layout/ir";
import { routeEdges } from "../layout/route/router";
import { placeStructured } from "../layout/structured/engine";
import { composeJunctionEnds, composeOutlines } from "./compose";
import { composeAssets, withImageSizes } from "./compose-assets";
import { type FinalizedSvg, finalizeStructuredSvg, finalizeSvg } from "./finalize";
import type { PathSegment } from "./geometry";
import { inspectSvg, type SvgInspection } from "./inspect";
import { needsOutlineSizing, outlineMeasurementFigure, sizeOutlineNodes } from "./outline-sizing";
import { paintedEdges, writeStructuredSvg } from "./structured";

export interface RenderFigureOptions extends CompileOptions {
  /** Backend to render `auto` figures with. Defaults to a new D2 CLI backend. Structured figures do not use it. */
  backend?: DiagramBackend;
  /** Name of the generated D2 source in backend diagnostics (see `RenderInput.sourceName`). */
  sourceName?: string;
  /**
   * The directory image paths (`props.src`, #94) are relative to: the figure's
   * YAML file's directory. Without it, a figure with images fails with
   * `asset/no-base-directory`.
   */
  assetBase?: string;
}

interface RenderedFigureBase {
  /** The finalized SVG (see `finalizeSvg`). */
  svg: string;
  metadata: FinalizedSvg["metadata"];
  inspection: SvgInspection;
}

/** An `auto` figure rendered by D2. */
export interface RenderedD2Figure extends RenderedFigureBase {
  compiled: CompiledD2Figure;
  /** The backend's raw output. */
  artifact: RenderArtifact;
}

/** A structured figure, drawn from its layout by the structured SVG writer. */
export interface RenderedStructuredFigure extends RenderedFigureBase {
  compiled: CompiledStructuredFigure;
  /** The routed Layout IR the SVG was drawn from. */
  layout: LayoutIR;
}

export type RenderedFigure = RenderedD2Figure | RenderedStructuredFigure;

/** Narrows a rendered figure to a D2-rendered one; throws for a structured figure (tests, D2-only paths). */
export function expectD2Rendered(rendered: RenderedFigure): RenderedD2Figure {
  if (rendered.compiled.engine !== "auto") {
    throw new Error(
      `internal error: figure "${rendered.compiled.ir.meta.id}" was not rendered by D2`,
    );
  }
  return rendered as RenderedD2Figure;
}

/**
 * Renders a `*.sumi.yaml` source to a finalized, inspected SVG. Diagnostics
 * of every stage are returned, warnings included.
 *
 * A figure with no nodes and no groups fails with `svg/empty-figure` before
 * D2 runs: D2 v0.9.0 writes no SVG for it, and Sumi does not invent an empty
 * canvas (for either engine).
 */
export async function renderFigure(
  text: string,
  options: RenderFigureOptions = {},
): Promise<Result<RenderedFigure>> {
  const { backend, sourceName, assetBase, ...compileOptions } = options;
  const compiled = compileFigure(text, compileOptions);
  if (!compiled.ok) return compiled;
  const diagnostics: Diagnostic[] = [...compiled.diagnostics];

  const { ir } = compiled.value;
  if (ir.elements.size === 0) {
    diagnostics.push({
      code: "svg/empty-figure",
      severity: "error",
      message: `Figure "${ir.meta.id}" has no nodes or groups, so there is nothing to render.`,
      subject: { kind: "figure", id: ir.meta.id },
      hint: "Add at least one node or group.",
    });
    return { ok: false, diagnostics };
  }
  let figure = compiled.value;
  let assets: FigureAssets | undefined;
  if (hasAssets(ir)) {
    const loaded = loadFigureAssets(ir, { ...(assetBase !== undefined && { base: assetBase }) });
    diagnostics.push(...loaded.diagnostics);
    if (!loaded.ok) return { ok: false, diagnostics };
    assets = loaded.value;
    figure = withImageSizes(figure, assets);
  }
  return figure.engine === "structured"
    ? renderStructured(text, figure, diagnostics, assets)
    : renderD2(text, figure, diagnostics, backend ?? createD2CliBackend(), sourceName, assets);
}

async function renderD2(
  text: string,
  compiled: CompiledD2Figure,
  diagnostics: Diagnostic[],
  backend: DiagramBackend,
  sourceName: string | undefined,
  assets: FigureAssets | undefined,
): Promise<Result<RenderedFigure>> {
  const fail = (): Result<RenderedFigure> => ({ ok: false, diagnostics });
  let effective = compiled;
  const render = (figure: CompiledD2Figure) =>
    backend.render({
      d2Source: figure.d2Source,
      layout: figure.layout,
      fontSet: figure.fontSet,
      ...(sourceName !== undefined && { sourceName }),
    });
  if (compiled.ir.nodes.some(needsOutlineSizing)) {
    const measurement = outlineMeasurementFigure(effective);
    const first = await render(measurement);
    diagnostics.push(...first.diagnostics);
    if (!first.ok) return fail();
    const firstFinalized = finalizeSvg(first.value, measurement, { source: text });
    diagnostics.push(...firstFinalized.diagnostics);
    if (!firstFinalized.ok) return fail();
    const measured = inspectSvg(firstFinalized.value.svg, measurement.ir);
    diagnostics.push(...measured.diagnostics);
    if (!measured.ok) return fail();
    const sized = sizeOutlineNodes(effective, measured.value);
    diagnostics.push(...sized.diagnostics);
    if (!sized.ok) return fail();
    effective = sized.value;
  }
  const rendered = await render(effective);
  diagnostics.push(...rendered.diagnostics);
  if (!rendered.ok) return fail();
  const artifact = rendered.value;

  const finalized = finalizeSvg(artifact, effective, {
    source: text,
    ...(assets !== undefined && { assets }),
  });
  diagnostics.push(...finalized.diagnostics);
  if (!finalized.ok) return fail();

  let inspected = inspectSvg(finalized.value.svg, effective.ir);
  diagnostics.push(...inspected.diagnostics);
  if (!inspected.ok) return fail();

  const composed = composeOutlines(finalized.value.svg, effective.ir, inspected.value);
  diagnostics.push(...composed.diagnostics);
  if (!composed.ok) return fail();
  if (effective.ir.nodes.some((n) => n.render !== undefined)) {
    inspected = inspectSvg(composed.value, effective.ir);
    diagnostics.push(...inspected.diagnostics);
    if (!inspected.ok) return fail();
  }
  // Lines meeting at a hidden junction (#101) reach its center.
  const joined = composeJunctionEnds(composed.value, effective.ir, inspected.value);
  diagnostics.push(...joined.diagnostics);
  if (!joined.ok) return fail();
  if (joined.value !== composed.value) {
    inspected = inspectSvg(joined.value, effective.ir);
    diagnostics.push(...inspected.diagnostics);
    if (!inspected.ok) return fail();
  }
  // Icons and images go into the placeholders' boxes; the inspection does not
  // read them, so it stays valid.
  let svg = joined.value;
  if (assets !== undefined) {
    const withAssets = composeAssets(svg, effective.ir, inspected.value, assets);
    diagnostics.push(...withAssets.diagnostics);
    if (!withAssets.ok) return fail();
    svg = withAssets.value;
  }

  return {
    ok: true,
    value: {
      svg,
      metadata: finalized.value.metadata,
      inspection: inspected.value,
      compiled: effective,
      artifact,
    },
    diagnostics,
  };
}

/**
 * Lays out, routes and draws a structured figure. An edge without a route
 * fails with `layout/no-route` (#90); a font that cannot be embedded with
 * `svg/missing-font-face`.
 */
function renderStructured(
  text: string,
  compiled: CompiledStructuredFigure,
  diagnostics: Diagnostic[],
  assets: FigureAssets | undefined,
): Result<RenderedFigure> {
  const fail = (): Result<RenderedFigure> => ({ ok: false, diagnostics });
  const { ir } = compiled;
  const fonts = getFontSet(compiled.fontSet.id);
  if (fonts === undefined)
    throw new Error(`internal error: unknown font set ${compiled.fontSet.id}`);
  const placed = placeStructured(ir);
  diagnostics.push(...placed.diagnostics);
  const routed = routeEdges(ir, placed.layout);
  diagnostics.push(...routed.diagnostics);
  if (hasErrors(routed.diagnostics)) return fail();
  const layout = routed.layout;

  let svg: string;
  try {
    svg = writeStructuredSvg(ir, layout, fonts, assets);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("internal error")) throw e;
    diagnostics.push({
      code: "svg/missing-font-face",
      severity: "error",
      message: `The fonts of font set "${fonts.id}" cannot be embedded in the SVG: ${e instanceof Error ? e.message : String(e)}.`,
      hint: "Run `sumi doctor` to check the bundled fonts.",
    });
    return fail();
  }
  const finalized = finalizeStructuredSvg(svg, compiled, {
    source: text,
    ...(assets !== undefined && { assets }),
  });
  diagnostics.push(...finalized.diagnostics);
  if (!finalized.ok) return fail();
  const inspected = inspectSvg(finalized.value.svg, ir);
  diagnostics.push(...inspected.diagnostics);
  if (!inspected.ok) return fail();
  // What each edge paints (#156), which the merged wires in the SVG lose.
  const painted = [...paintedEdges(ir, layout)].map(([key, { pieces, arcs }]) => ({
    key,
    path: [
      ...pieces.flatMap(([from, to]): PathSegment[] => [
        { command: "M", to: from },
        { command: "L", to },
      ]),
      ...arcs.flatMap(({ from, c1, c2, to }): PathSegment[] => [
        { command: "M", to: from },
        { command: "C", c1, c2, to },
      ]),
    ],
  }));
  return {
    ok: true,
    value: {
      svg: finalized.value.svg,
      metadata: finalized.value.metadata,
      inspection: { ...inspected.value, painted },
      compiled,
      layout,
    },
    diagnostics,
  };
}

export type { CompiledFigure };
