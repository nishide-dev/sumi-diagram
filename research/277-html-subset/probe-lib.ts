import { loadEngine, runEngine } from "../../src/render/pdf/engine";
import { fontFiles } from "./gen";

const fonts = [fontFiles.mono, fontFiles.inter, fontFiles.interBold];
/** Normalizes any SVG through Sumi's PDF engine (usvg): text to paths, use/defs resolved. */
export function usvg(svg: string): string {
  const p = runEngine(loadEngine(), new TextEncoder().encode(svg), fonts, "picture");
  if (!p.ok) throw new Error(p.message);
  const n = new DataView(p.pdf.buffer, p.pdf.byteOffset).getUint32(0, true);
  return new TextDecoder().decode(p.pdf.subarray(n + 4));
}
