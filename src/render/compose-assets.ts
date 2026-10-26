/**
 * Icons and images in `auto` (D2) figures (#94, design doc §6.25): D2 draws
 * the node as a placeholder (an icon node without a label at the size the
 * structured engine would give it, an image as a transparent rectangle of the
 * image's size), and this step splices the asset's markup (`assetMarkup()`)
 * into the node's `<g>` right after its `g.shape`, in the box the inspection
 * measured. Like the outline composition (#53, `compose.ts`), it edits the
 * finalized SVG by XML offsets and leaves every other byte as D2 wrote it.
 */

import { assetMarkup } from "../assets/draw";
import type { FigureAssets } from "../assets/load";
import type { CompiledFigure } from "../compiler/compile";
import { generateD2 } from "../compiler/d2";
import { type FigureIR, readonlyMap } from "../compiler/ir";
import type { ElementKey } from "../core/check-state";
import type { Result } from "../core/result";
import type { StyleLength } from "../core/theme/style";
import { outlineDiagnostic } from "./compose";
import { decodeElementClass, type SvgInspection } from "./inspect";
import { childElements, classList, descendants, parseXml, type XmlElement } from "./xml";

/**
 * Completes the size of image nodes that give only a width or a height: the
 * other follows the image's aspect ratio, rounded to whole units (0.5pt), at
 * least one. The YAML is not changed; an `auto` figure's D2 source is
 * generated again from the sized IR.
 */
export function withImageSizes(compiled: CompiledFigure, assets: FigureAssets): CompiledFigure {
  let changed = false;
  const nodes = compiled.ir.nodes.map((node) => {
    const asset = assets.nodes.get(node.key);
    if (asset?.kind !== "image" || (node.width !== undefined && node.height !== undefined)) {
      return node;
    }
    const size = asset.size;
    if (size === undefined) throw new Error(`internal error: ${node.key} has no image size`);
    const length = (units: number): StyleLength => Object.freeze({ units, pt: units / 2 });
    changed = true;
    return Object.freeze({
      ...node,
      width: node.width ?? length(size.width),
      height: node.height ?? length(size.height),
    });
  });
  if (!changed) return compiled;
  const ir: FigureIR = Object.freeze({
    ...compiled.ir,
    nodes: Object.freeze(nodes),
    elements: readonlyMap(
      [...compiled.ir.groups, ...nodes, ...compiled.ir.edges].map((e) => [e.key, e] as const),
    ),
  });
  return compiled.engine === "auto"
    ? { ...compiled, ir, d2Source: generateD2(ir) }
    : { ...compiled, ir };
}

/** Inserts the assets of `ir`'s icon and image nodes into a finalized, inspected SVG. */
export function composeAssets(
  svg: string,
  ir: FigureIR,
  inspection: SvgInspection,
  assets: FigureAssets,
): Result<string> {
  const nodes = ir.nodes.filter((n) => n.icon !== undefined || n.image !== undefined);
  if (nodes.length === 0) return { ok: true, value: svg, diagnostics: [] };
  const parsed = parseXml(svg);
  if (!parsed.ok)
    throw new Error(`internal error: the finalized SVG does not parse: ${parsed.message}`);
  const groups = new Map<ElementKey, XmlElement>();
  for (const element of descendants(parsed.root)) {
    if (element.name !== "g") continue;
    for (const name of classList(element)) {
      const key = decodeElementClass(name);
      if (key !== undefined) groups.set(key, element);
    }
  }
  const boxes = new Map(inspection.elements.map((e) => [e.key, e.bbox]));
  const inserts: { at: number; text: string }[] = [];
  for (const node of nodes) {
    const group = groups.get(node.key);
    const shape =
      group && childElements(group).find((c) => c.name === "g" && classList(c).includes("shape"));
    const box = boxes.get(node.key);
    if (shape === undefined || box === undefined) {
      return {
        ok: false,
        diagnostics: [
          outlineDiagnostic(
            ir,
            node.key,
            "svg/unsupported-geometry",
            "error",
            `${node.key}: expected a g.shape with a measurable box to draw the ${node.icon ? "icon" : "image"} in.`,
          ),
        ],
      };
    }
    inserts.push({ at: shape.end, text: assetMarkup(node, assets.nodes.get(node.key), box) });
  }
  let out = svg;
  for (const { at, text } of inserts.sort((a, b) => b.at - a.at)) {
    out = out.slice(0, at) + text + out.slice(at);
  }
  return { ok: true, value: out, diagnostics: [] };
}
