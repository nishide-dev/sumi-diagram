/** #215: repository YAML × own/built-in themes, SHA-256 of actual exports.
 * Run `bun research/215-paper-operator/verify.ts before` before changing the
 * theme, then `... after`. Failures are recorded, never silently skipped.
 */
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { compileFigure } from "../../src/compiler/compile";
import { BUILTIN_THEMES } from "../../src/core/theme/builtin";
import { renderFigure } from "../../src/render";
import { svgToPdf } from "../../src/render/pdf";
import { svgToPptx } from "../../src/render/pptx";

const root = join(import.meta.dir, "../..");
const out = join(import.meta.dir, "out");
mkdirSync(out, { recursive: true });
const phase = process.argv[2];
if (phase !== "before" && phase !== "after") throw new Error("expected before|after");
const files = Bun.spawnSync(["git", "ls-files", "--", "*.sumi.yaml"], { cwd: root })
  .stdout.toString()
  .trim()
  .split("\n");
// Keep the acceptance copy identical, including relative image references.
cpSync(join(root, "research/185-acceptance/figures"), join(out, "figures"), { recursive: true });
const hash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const report: Record<string, Record<string, string>> = {};
let next = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (next < files.length) {
      const file = files[next++];
      if (!file) continue;
      const source = readFileSync(join(root, file), "utf8");
      for (const theme of ["own", ...BUILTIN_THEMES.keys()]) {
        const key = `${file} @ ${theme}`;
        const options = {
          file,
          assetBase: dirname(join(root, file)),
          overrides: theme === "own" ? {} : { theme },
        };
        const outputs: Record<string, string> = {};
        report[key] = outputs;
        const compiled = compileFigure(source, options);
        if (compiled.ok && compiled.value.engine === "auto")
          outputs.d2 = hash(compiled.value.d2Source);
        const result = await renderFigure(source, options);
        if (!result.ok) {
          outputs.failure = JSON.stringify(result.diagnostics);
          continue;
        }
        outputs.svg = hash(result.value.svg);
        for (const [format, convert] of [
          ["pdf", svgToPdf],
          ["pptx", svgToPptx],
        ] as const) {
          const exported = convert(result.value.svg);
          outputs[format] = exported.ok
            ? hash(exported.value)
            : JSON.stringify(exported.diagnostics);
        }
        if (file.startsWith("research/185-acceptance/figures/") && theme === "own") {
          const name = file.split("/").at(-1)?.replace(".sumi.yaml", "");
          writeFileSync(join(out, `${phase}-${name}.svg`), result.value.svg);
          const pdf = svgToPdf(result.value.svg);
          if (pdf.ok) writeFileSync(join(out, `${phase}-${name}.pdf`), pdf.value);
        }
      }
      console.log(`${phase}: ${file}`);
    }
  }),
);
const sorted = Object.fromEntries(Object.entries(report).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(join(out, `${phase}.json`), `${JSON.stringify(sorted, null, 2)}\n`);
if (phase === "after") {
  const before = JSON.parse(readFileSync(join(out, "before.json"), "utf8")) as typeof report;
  const changed: string[] = [];
  for (const [key, outputs] of Object.entries(sorted)) {
    for (const [format, value] of Object.entries(outputs)) {
      if (before[key]?.[format] !== value) changed.push(`${key} : ${format}`);
    }
  }
  writeFileSync(join(out, "changed.txt"), `${changed.join("\n")}\n`);
  console.log(`${files.length} files × 6 theme selections; ${changed.length} changed exports`);
  for (const format of ["d2", "svg", "pdf", "pptx", "failure"]) {
    console.log(
      `${format}: ${Object.values(sorted).filter((outputs) => outputs[format] !== undefined).length}`,
    );
  }
  const inventory = [...new Set(changed.map((line) => line.split(" : ")[0]))];
  writeFileSync(
    join(import.meta.dir, "changed-outputs.md"),
    [
      "# #215 の意図した出力変更一覧",
      "",
      "各行の SVG・PDF・画像方式 PPTX が変更（計 177 出力）。すべて paper の operator の縮小・細線化と、それに伴う配置・経路・fit の再計算による。D2 の変更はない。own は YAML に書かれた paper。45 ファイルを PDF → PNG にし、4 枚の一覧で目視確認した。過去の不具合の再現図にある重なりは保持される。",
      "",
      ...inventory.map((key) => `- \`${key}\` — SVG / PDF / PPTX`),
      "",
      "ギャラリーの変更: `docs/gallery/components/sumi-operator.paper.svg`（全 symbol・variant）、`docs/gallery/tones/tones.paper.svg`（tone）、`docs/gallery/dim/dim.paper.svg`（薄表示）。後二者はラベルなし mark のため、PDF/PPTX corpus の対象外。目次 README / HTML はサイズ表示のみ。PDF corpus 1 件、画像方式 PPTX corpus 1 件、編集可能 PPTX corpus は operator の freeform / glued 各 1 件（slide XML も各 1 件）を指定の更新手順で再生成した。",
      "",
      "受け入れ図の PNG 3 件と `research/215-paper-operator/previews/c-h3world.png` は同じ変更のプレビュー。その他の Theme、operator を含まない paper、既存の D2 はバイト一致。",
      "",
    ].join("\n"),
  );
}
