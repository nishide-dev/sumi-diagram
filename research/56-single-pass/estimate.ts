/** Research candidates for #56, not imported by Sumi's production pipeline. */
import type { CompiledD2Figure } from "../../src/compiler/compile";
import type { NodeIR } from "../../src/compiler/ir";
import { getOutlineRenderer, type OutlineSize } from "../../src/core/outline";
import { getTheme } from "../../src/core/theme/builtin";
import { fontFileFor, renderedLines } from "../../src/lint/geometry/measure";
import { loadFontMetrics } from "../../src/lint/metrics";
import { displayWidth } from "../../src/lint/text";
import { withOutlineNodes } from "../../src/render/outline-sizing";

export type Candidate = "d2-approx" | "compact" | "compact-aware";
const graphemes = new Intl.Segmenter("ja", { granularity: "grapheme" });

/** Deliberately incomplete: advance widths are not D2's hinted ink bounds. */
export function approximateBox(node: NodeIR, compiled: CompiledD2Figure): OutlineSize {
  if (node.label.trim() === "") return { width: 100, height: 100 };
  const fonts = getTheme(compiled.ir.meta.themeId)?.fontSet;
  if (!fonts) throw new Error("missing fonts");
  const metrics = loadFontMetrics(fontFileFor(node.style.mono ? "mono-bold" : "bold", fonts));
  const size = node.style.fontSize.units;
  const lines = node.label.trim().split("\n");
  const widths = lines.map((line) => {
    let width = 0;
    const tab = metrics.measureEm(" ") * size * 4;
    for (const { segment } of graphemes.segment(line)) {
      if (segment === "\t") width = (Math.floor(width / tab) + 1) * tab;
      else width += displayWidth(segment) > 1 ? 1.25 * size : metrics.measureEm(segment) * size;
    }
    return width;
  });
  // D2's graph padding: 5 inner-label + 40 rectangle padding (total per axis).
  return {
    width: Math.ceil(Math.max(...widths)) + 45,
    height: Math.ceil(lines.length * size) + 45,
  };
}

/** Actual painted font advances + 8 units per side, not D2's invisible padding. */
export function compactBox(node: NodeIR, compiled: CompiledD2Figure): OutlineSize {
  if (node.label.trim() === "") return { width: 100, height: 100 };
  const fonts = getTheme(compiled.ir.meta.themeId)?.fontSet;
  if (!fonts) throw new Error("missing fonts");
  const font = node.style.mono ? "mono" : node.style.bold ? "bold" : "regular";
  const metrics = loadFontMetrics(fontFileFor(font, fonts));
  const lines = renderedLines(node.label);
  return {
    width:
      Math.max(...lines.map((line) => metrics.measureEm(line))) * node.style.fontSize.units + 16,
    height: lines.length * node.style.fontSize.units + 16,
  };
}

function degreeFloor(node: NodeIR, compiled: CompiledD2Figure, size: OutlineSize): OutlineSize {
  const incoming = compiled.ir.edges.filter((e) => e.to === node.key).length;
  const outgoing = compiled.ir.edges.filter((e) => e.from === node.key).length;
  const degree = Math.max(incoming, outgoing);
  if (degree < 2) return size;
  const horizontal =
    compiled.ir.meta.direction === "right" || compiled.ir.meta.direction === "left";
  return horizontal
    ? { ...size, height: Math.max(size.height, degree * 40) }
    : { ...size, width: Math.max(size.width, degree * 40) };
}

/** Preserve written dimensions; only missing outline dimensions are estimated. */
export function estimateFigure(compiled: CompiledD2Figure, candidate: Candidate): CompiledD2Figure {
  return withOutlineNodes(
    compiled,
    compiled.ir.nodes.map((node) => {
      if (!node.render || (node.width && node.height)) return node;
      const renderer = getOutlineRenderer(node.render.renderer);
      if (!renderer) throw new Error("missing renderer");
      const content =
        candidate === "d2-approx" ? approximateBox(node, compiled) : compactBox(node, compiled);
      const box = candidate === "compact" ? content : degreeFloor(node, compiled, content);
      const footprint = renderer.footprint(box, renderer.params.parse(node.render.params ?? {}));
      const fitted = candidate === "compact" ? degreeFloor(node, compiled, footprint) : footprint;
      const width = Math.ceil(fitted.width);
      const height = Math.ceil(fitted.height);
      if (![width, height].every((n) => Number.isSafeInteger(n) && n > 0))
        throw new Error("invalid candidate size");
      return Object.freeze({
        ...node,
        ...(node.width === undefined && node.height === undefined && { autoSized: true }),
        width: node.width ?? Object.freeze({ pt: width / 2, units: width }),
        height: node.height ?? Object.freeze({ pt: height / 2, units: height }),
      });
    }),
  );
}
