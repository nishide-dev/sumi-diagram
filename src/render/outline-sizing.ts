/** Two-pass layout sizing changes IR only, never the user's YAML. */
import type { CompiledFigure } from "../compiler/compile";
import { generateD2 } from "../compiler/d2";
import { type FigureIR, type NodeIR, readonlyMap } from "../compiler/ir";
import type { Diagnostic } from "../core/diagnostics";
import { getOutlineRenderer } from "../core/outline";
import type { Result } from "../core/result";
import { outlineDiagnostic } from "./compose";
import type { SvgInspection } from "./inspect";

export function withOutlineNodes(
  compiled: CompiledFigure,
  nodes: readonly NodeIR[],
): CompiledFigure {
  const ir: FigureIR = Object.freeze({
    ...compiled.ir,
    nodes: Object.freeze([...nodes]),
    elements: readonlyMap(
      [...compiled.ir.groups, ...nodes, ...compiled.ir.edges].map((e) => [e.key, e] as const),
    ),
  });
  return { ...compiled, ir, d2Source: generateD2(ir) };
}

export const needsOutlineSizing = (node: NodeIR) =>
  node.render !== undefined && (node.width === undefined || node.height === undefined);

/** Measure an auto-sized padded D2 label box even when just one dimension was supplied. */
export function outlineMeasurementFigure(compiled: CompiledFigure): CompiledFigure {
  return withOutlineNodes(
    compiled,
    compiled.ir.nodes.map((node) => {
      if (!needsOutlineSizing(node)) return node;
      const { width: _width, height: _height, ...rest } = node;
      return Object.freeze(rest);
    }),
  );
}

export function sizeOutlineNodes(
  compiled: CompiledFigure,
  inspection: SvgInspection,
): Result<CompiledFigure> {
  const geometry = new Map(inspection.elements.map((e) => [e.key, e]));
  const diagnostics: Diagnostic[] = [];
  const nodes = compiled.ir.nodes.map((node) => {
    if (!needsOutlineSizing(node)) return node;
    const box = geometry.get(node.key)?.bbox;
    const renderer = node.render && getOutlineRenderer(node.render.renderer);
    if (!box || !renderer) {
      diagnostics.push(
        outlineDiagnostic(
          compiled.ir,
          node.key,
          "svg/unsupported-geometry",
          "error",
          `Cannot measure the outline footprint of ${node.id}.`,
        ),
      );
      return node;
    }
    const size = renderer.footprint(box, renderer.params.parse(node.render?.params ?? {}));
    const width = Math.ceil(size.width);
    const height = Math.ceil(size.height);
    if (![width, height].every((n) => Number.isSafeInteger(n) && n > 0)) {
      diagnostics.push(
        outlineDiagnostic(
          compiled.ir,
          node.key,
          "svg/unsupported-geometry",
          "error",
          `Invalid outline footprint for ${node.id}.`,
        ),
      );
      return node;
    }
    return Object.freeze({
      ...node,
      ...(node.width === undefined && node.height === undefined && { autoSized: true }),
      width: node.width ?? Object.freeze({ units: width, pt: width * 0.5 }),
      height: node.height ?? Object.freeze({ units: height, pt: height * 0.5 }),
    });
  });
  return diagnostics.length > 0
    ? { ok: false, diagnostics }
    : { ok: true, value: withOutlineNodes(compiled, nodes), diagnostics };
}
