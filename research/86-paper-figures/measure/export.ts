/**
 * Exports a prototype SVG through the product's committed engine (no
 * changes): PDF via krilla, PNG via resvg (the picture-PPTX path), with the
 * bundled fonts. Then reads the PDF back with Poppler for fonts, images and
 * extractable text.
 */
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { runCommand } from "../../../src/core/subprocess";
import { loadEngine, runEngine } from "../../../src/render/pdf/engine";
import { FONT_FILES } from "../proto/text";

export interface ExportReport {
  pdfBytes: number;
  pdfDeterministic: boolean;
  pdfFonts: string[];
  pdfImages: number;
  /** pdftotext output, whitespace-collapsed. */
  pdfText: string;
  pngBytes: number;
}

export async function exportSvg(svg: string, base: string): Promise<ExportReport> {
  const fonts = [FONT_FILES.regular, FONT_FILES.bold].map((f) => new Uint8Array(readFileSync(f)));
  const module = loadEngine();
  const input = new TextEncoder().encode(svg);
  const pdf = runEngine(module, input, fonts, "convert");
  if (!pdf.ok) throw new Error(`pdf: ${pdf.message}`);
  const again = runEngine(module, input, fonts, "convert");
  await writeFile(`${base}.pdf`, pdf.pdf);
  const picture = runEngine(module, input, fonts, "picture");
  if (!picture.ok) throw new Error(`picture: ${picture.message}`);
  const n = new DataView(picture.pdf.buffer, picture.pdf.byteOffset).getUint32(0, true);
  const png = picture.pdf.slice(4, 4 + n);
  await writeFile(`${base}.png`, png);
  const fontsOut = await runCommand(["pdffonts", `${base}.pdf`]);
  const images = await runCommand(["pdfimages", "-list", `${base}.pdf`]);
  const text = await runCommand(["pdftotext", "-layout", `${base}.pdf`, "-"]);
  return {
    pdfBytes: pdf.pdf.length,
    pdfDeterministic: again.ok && Buffer.from(again.pdf).equals(Buffer.from(pdf.pdf)),
    pdfFonts: fontsOut.stdout
      .trim()
      .split("\n")
      .slice(2)
      .map((l) => l.replace(/\s+/g, " ").trim()),
    pdfImages: Math.max(0, images.stdout.trim().split("\n").length - 2),
    pdfText: text.stdout.replace(/\s+/g, " ").trim(),
    pngBytes: png.length,
  };
}
