/**
 * #19 research (macOS + Microsoft PowerPoint only): opens each PoC PPTX in
 * PowerPoint, records how many shapes it kept, exports the slide to PDF and
 * checks that PDF like pdf.ts does (page size, fonts, label positions vs
 * the SVG, pixel difference vs Chrome's rendering of the SVG).
 *
 *   bun research/19-pdf-pptx/scripts/validate-pptx.ts
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pdfInfo, pixelDiff, rasterize, textPositions } from "./lib/pdf-checks";

const HERE = resolve(import.meta.dir, "..");
const PPTX = join(HERE, "out", "pptx");
const BOX = join(homedir(), "Library/Containers/com.microsoft.Powerpoint/Data/Documents/sumi19");
const SCRIPT = join(import.meta.dir, "powerpoint-to-pdf.applescript");
mkdirSync(BOX, { recursive: true });

const report: Record<string, unknown>[] = [];
for (const file of readdirSync(PPTX)
  .filter((f) => f.endsWith(".pptx"))
  .sort()) {
  const [id = "", variant = ""] = file.replace(/\.pptx$/, "").split(".");
  const inBox = join(BOX, file);
  const pdfInBox = inBox.replace(/\.pptx$/, ".pdf");
  copyFileSync(join(PPTX, file), inBox);
  const p = Bun.spawnSync(["osascript", SCRIPT, inBox, pdfInBox], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (p.exitCode !== 0 || !existsSync(pdfInBox)) {
    Bun.spawnSync(["pkill", "-x", "Microsoft PowerPoint"]);
    Bun.sleepSync(3000);
    report.push({ figure: id, variant, ok: false, error: p.stderr.toString().trim() });
    console.log(`${file}: FAILED ${p.stderr.toString().trim()}`);
    continue;
  }
  const pdf = join(PPTX, `${id}.${variant}.powerpoint.pdf`);
  copyFileSync(pdfInBox, pdf);
  const png = pdf.replace(/\.pdf$/, ".png");
  rasterize(pdf, png);
  const ref = join(HERE, "out", "pdf", `${id}.reference.png`);
  const result = {
    figure: id,
    variant,
    ok: true,
    shapesKept: Number(p.stdout.toString().trim()),
    ...pdfInfo(pdf),
    text: textPositions(id, pdf),
    pixelDiffPercent: pixelDiff(ref, png, png.replace(/\.png$/, ".diff.png")),
  };
  report.push(result);
  console.log(
    `${file}: shapes=${result.shapesKept} ${result.widthPt}x${result.heightPt} fonts=[${result.fonts.join("; ")}] text ${result.text.matched}/${result.text.expected} dx=${result.text.maxDxPt} dw=${result.text.maxDwidthPt} dy=${result.text.maxDyTopPt} diff=${result.pixelDiffPercent}%`,
  );
}
writeFileSync(join(PPTX, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
