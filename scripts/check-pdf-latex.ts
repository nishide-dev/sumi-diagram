/**
 * Real pdfLaTeX / LuaLaTeX inclusion checks (#63), deliberately separate from
 * `bun test`: requires TeX Live (graphicx + geometry), Poppler and pinned D2.
 * Generates fresh PDFs via the CLI, includes them at native size, and checks
 * fonts, text, images and rasterized appearance after inclusion. Artifacts and
 * a machine-readable report remain in .sumi/pdf-latex (or --out <directory>).
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { type CommandArgv, runCommand } from "../src/core/subprocess";
import { inspectPdf } from "../src/render/pdf/testing";

const ROOT = resolve(import.meta.dir, "..");
const ENGINES = ["pdflatex", "lualatex"] as const;
const MODES = ["default", "pdf17"] as const;
const args = Bun.argv.slice(2);
if (args.length !== 0 && (args.length !== 2 || args[0] !== "--out" || !args[1])) {
  console.error("Usage: bun run pdf:latex [--out <directory>]");
  process.exit(2);
}
const out = resolve(args[1] ?? join(ROOT, ".sumi", "pdf-latex"));
const sha256 = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const normalizeText = (text: string) => text.replace(/\s/g, "");

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function command(argv: CommandArgv, cwd = ROOT): Promise<string> {
  const result = await runCommand(argv, { cwd, timeoutMs: 120_000 });
  check(
    result.exitCode === 0,
    `${argv.join(" ")} failed (${result.exitCode ?? result.signal}):\n${result.stdout}${result.stderr}`,
  );
  return result.stdout;
}

/** Poppler's final five columns are emb/sub/uni/object/generation. */
function fonts(table: string): string[] {
  const rows = table.trim().split("\n").slice(2);
  check(rows.length > 0, "PDF has no fonts");
  return rows
    .map((row) => {
      const fields = row.trim().split(/\s+/);
      const name = fields[0] ?? "";
      check(
        fields.slice(-5, -2).join(" ") === "yes yes yes",
        `Font is not embedded/subset/Unicode: ${row}`,
      );
      check(/^[A-Z]{6}\+BIZUDP?Gothic-(Regular|Bold)$/.test(name), `Unexpected font: ${row}`);
      return name.replace(/^[A-Z]{6}\+/, "");
    })
    .sort();
}

function ppm(bytes: Uint8Array): { width: number; height: number; pixels: Uint8Array } {
  const header = /^P6\s+(\d+)\s+(\d+)\s+255\n/.exec(
    new TextDecoder().decode(bytes.subarray(0, 100)),
  );
  check(header, "Unexpected pdftoppm PPM header");
  const width = Number(header[1]);
  const height = Number(header[2]);
  const pixels = bytes.subarray(header[0].length);
  check(pixels.length === width * height * 3, "Unexpected PPM pixel count");
  return { width, height, pixels };
}

/** Same Poppler process/settings for both PDFs; allow small antialiasing differences. */
async function compareAppearance(source: string, included: string): Promise<number> {
  const a = ppm(await readFile(source));
  const b = ppm(await readFile(included));
  check(a.width === b.width && a.height === b.height, "Raster dimensions changed");
  let changed = 0;
  // TeX's bp -> sp -> bp rounding changes subpixel stroke antialiasing.
  // Compare 3x3 box-filtered pixels, rather than treating redistributed ink
  // as a missing line. Word geometry is checked independently to 0.02bp.
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const delta = [0, 0, 0];
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= a.width || ny < 0 || ny >= a.height) continue;
          const i = (ny * a.width + nx) * 3;
          for (let c = 0; c < 3; c++)
            delta[c] = (delta[c] ?? 0) + (a.pixels[i + c] ?? 0) - (b.pixels[i + c] ?? 0);
          count++;
        }
      }
      if (delta.some((d) => Math.abs(d / count) > 64)) changed++;
    }
  }
  const fraction = changed / (a.width * a.height);
  check(
    fraction < 0.01,
    `Appearance changed: ${(fraction * 100).toFixed(3)}% of filtered pixels differ by >64/255`,
  );
  return fraction;
}

/** Poppler word boxes use PDF points and top-left coordinates. */
function wordBoxes(xml: string): { text: string; box: number[] }[] {
  const words = [
    ...xml.matchAll(
      /<word xMin="([\d.-]+)" yMin="([\d.-]+)" xMax="([\d.-]+)" yMax="([\d.-]+)">([^<]*)<\/word>/g,
    ),
  ].map((match) => ({ text: match[5] ?? "", box: match.slice(1, 5).map(Number) }));
  check(words.length > 0, "No Poppler word boxes");
  return words;
}

function checkWordBoxes(source: string, included: string): number {
  const expected = wordBoxes(source);
  const actual = wordBoxes(included);
  check(actual.length === expected.length, "Word count changed");
  let maxDelta = 0;
  for (const [i, word] of expected.entries()) {
    const hit = actual[i];
    check(hit?.text === word.text, `Word ${i} changed`);
    for (const [j, coordinate] of word.box.entries()) {
      const delta = Math.abs((hit.box[j] ?? 0) - coordinate - 12);
      check(delta < 0.02, `Word geometry changed: ${word.text}`);
      maxDelta = Math.max(maxDelta, delta);
    }
  }
  return maxDelta;
}

interface InclusionResult {
  sample: string;
  engine: string;
  mode: string;
  sourceSha256: string;
  fonts: string[];
  changedPixelFraction: number;
  wordBoxMaxDeltaPt: number;
  outputPdfVersion: string;
  warnings: string[];
}

async function main(): Promise<void> {
  await mkdir(out, { recursive: true });
  // A failed rerun must not leave an earlier success report in the artifacts.
  await rm(join(out, "report.json"), { force: true });
  for (const tool of [...ENGINES, "pdfinfo", "pdffonts", "pdftotext", "pdfimages", "pdftoppm"]) {
    check(Bun.which(tool), `${tool} is required; see docs/verification/63-pdf-latex.md`);
  }
  const versions: Record<string, string> = {};
  for (const engine of ENGINES) versions[engine] = (await command([engine, "--version"])).trim();
  const poppler = await runCommand(["pdfinfo", "-v"]);
  check(poppler.exitCode === 0, "Could not determine Poppler version");
  versions.poppler = `${poppler.stdout}${poppler.stderr}`.trim();
  console.log(JSON.stringify(versions, null, 2));

  const sources = [...new Bun.Glob("examples/*/*.sumi.yaml").scanSync(ROOT)].sort();
  check(sources.length >= 4, "Expected the four example figures");
  sources.push("tests/fixtures/pdf-latex/japanese.sumi.yaml");
  const template = await readFile(join(ROOT, "tests/fixtures/pdf-latex/include.tex"), "utf8");
  const results: InclusionResult[] = [];
  for (const source of sources) {
    const sample = basename(source, ".sumi.yaml");
    const directory = join(out, sample);
    await mkdir(directory, { recursive: true });
    const input = join(directory, "input.pdf");
    await command([
      process.execPath,
      join(ROOT, "src/cli/index.ts"),
      "render",
      join(ROOT, source),
      "-o",
      input,
    ]);
    const bytes = await readFile(input);
    const inspected = inspectPdf(bytes);
    const box = inspected.pages[0]?.mediaBox;
    check(inspected.pages.length === 1 && box, `${sample}: expected one source page`);
    const width = box[2];
    const height = box[3];
    check(
      width !== undefined && height !== undefined && width > 0 && height > 0,
      `${sample}: invalid source size`,
    );
    const expectedText = await command(["pdftotext", input, "-"]);
    const expectedBoxes = await command(["pdftotext", "-bbox", input, "-"]);
    check(normalizeText(expectedText).length > 0, `${sample}: no source text`);
    const sourceFonts = await command(["pdffonts", input]);
    const expectedFonts = fonts(sourceFonts);
    await writeFile(join(directory, "source-fonts.txt"), sourceFonts);
    await command(["pdftoppm", "-r", "144", "-singlefile", input, join(directory, "source")]);

    for (const engine of ENGINES) {
      for (const mode of MODES) {
        const name = `${engine}-${mode}`;
        const tex = template
          .replace(
            "@@VERSION@@",
            mode === "pdf17"
              ? "\\ifdefined\\pdfminorversion\\pdfminorversion=7\\else\\pdfvariable minorversion=7\\fi"
              : "",
          )
          .replace("@@WIDTH@@", String(width + 24))
          .replace("@@HEIGHT@@", String(height + 24));
        await writeFile(join(directory, `${name}.tex`), tex);
        const output = await command(
          [engine, "-no-shell-escape", "-interaction=nonstopmode", "-halt-on-error", `${name}.tex`],
          directory,
        );
        await writeFile(join(directory, `${name}-stdout.txt`), output);
        const log = await readFile(join(directory, `${name}.log`), "utf8");
        check(!/Missing character:/.test(log), `${sample}/${name}: missing glyph`);
        const pdf = join(directory, `${name}.pdf`);
        const info = await command(["pdfinfo", pdf]);
        const outputPdfVersion = /^PDF version:\s+(\S+)/m.exec(info)?.[1] ?? "";
        check(
          mode !== "pdf17" || outputPdfVersion === "1.7",
          `${sample}/${name}: expected PDF 1.7`,
        );
        check(/^Pages:\s+1\s*$/m.test(info), `${sample}/${name}: expected one included page`);
        const size = /^Page size:\s+([\d.]+) x ([\d.]+) pts/m.exec(info);
        check(
          size &&
            Math.abs(Number(size[1]) - width - 24) < 0.02 &&
            Math.abs(Number(size[2]) - height - 24) < 0.02,
          `${sample}/${name}: wrong page size`,
        );
        const fontTable = await command(["pdffonts", pdf]);
        const actualFonts = fonts(fontTable);
        check(
          actualFonts.join("\n") === expectedFonts.join("\n"),
          `${sample}/${name}: fonts changed`,
        );
        const text = await command(["pdftotext", pdf, "-"]);
        check(
          normalizeText(text) === normalizeText(expectedText),
          `${sample}/${name}: text changed`,
        );
        const wordBoxMaxDeltaPt = checkWordBoxes(
          expectedBoxes,
          await command(["pdftotext", "-bbox", pdf, "-"]),
        );
        const images = await command(["pdfimages", "-list", pdf]);
        check(
          images.trim().split("\n").length === 2,
          `${sample}/${name}: raster images introduced`,
        );
        await writeFile(
          join(directory, `${name}-inspection.txt`),
          `${info}\n${fontTable}\n${images}\n${text}`,
        );
        // 12bp margins at 144dpi are exactly 24 pixels; compare only the figure.
        await command([
          "pdftoppm",
          "-r",
          "144",
          "-singlefile",
          "-x",
          "24",
          "-y",
          "24",
          "-W",
          String(Math.ceil(width * 2)),
          "-H",
          String(Math.ceil(height * 2)),
          pdf,
          join(directory, name),
        ]);
        const changedPixelFraction = await compareAppearance(
          join(directory, "source.ppm"),
          join(directory, `${name}.ppm`),
        );
        const warnings = log.split("\n").filter((line) => /warning|Missing character/i.test(line));
        results.push({
          sample,
          engine,
          mode,
          sourceSha256: sha256(bytes),
          fonts: actualFonts,
          changedPixelFraction,
          wordBoxMaxDeltaPt,
          outputPdfVersion,
          warnings,
        });
        console.log(
          `ok - ${sample}/${name}: text, fonts, vectors; changed pixels ${(changedPixelFraction * 100).toFixed(4)}%; ${warnings.length} warning lines`,
        );
      }
    }
  }
  await writeFile(
    join(out, "report.json"),
    `${JSON.stringify({ platform: process.platform, arch: process.arch, versions, results }, null, 2)}\n`,
  );
  console.log(
    `PDF / LaTeX checks passed (${results.length} inclusions). Report: ${join(out, "report.json")}`,
  );
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(`Artifacts: ${out}`);
  process.exitCode = 1;
}
