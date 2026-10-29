/**
 * Capture all existing figures before editing, then compare after editing:
 *   bun research/126-grid/compat.ts before
 *   bun research/126-grid/compat.ts after
 *   bun research/126-grid/compat.ts compare  # compare saved manifests only
 * Manifests stay in the worktree's ignored .sumi directory. Invalid figures
 * and unsupported exports retain their diagnostic codes rather than hashes.
 */
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import type { Result } from "../../src/core/result";

// --baseline uses a pristine git archive under this same worktree's .sumi.
const root = process.argv.includes("--baseline") ? "../../.sumi/baseline" : "../..";
const { compileFigure } = (await import(
  `${root}/src/compiler/compile.ts`
)) as typeof import("../../src/compiler/compile");
const { BUILTIN_THEMES } = (await import(
  `${root}/src/core/theme/builtin.ts`
)) as typeof import("../../src/core/theme/builtin");
const { svgToPdf } = (await import(
  `${root}/src/render/pdf/pdf.ts`
)) as typeof import("../../src/render/pdf/pdf");
const { svgToEditablePptx, svgToPptx } = (await import(
  `${root}/src/render/pptx/index.ts`
)) as typeof import("../../src/render/pptx");
const { renderFigure } = (await import(
  `${root}/src/render/render.ts`
)) as typeof import("../../src/render/render");

type Entry = Record<string, string | string[] | null>;
type Manifest = Record<string, Record<string, Entry>>;
const phase = process.argv[2];
if (phase !== "before" && phase !== "after" && phase !== "compare")
  throw new Error("Expected before, after or compare");
const before: Manifest | undefined =
  phase !== "before" ? await Bun.file(".sumi/compat-before.json").json() : undefined;
const files =
  before === undefined
    ? Bun.spawnSync(["git", "ls-files", "*.sumi.yaml"]).stdout.toString().trim().split("\n")
    : Object.keys(before);
const hash = (x: string | Uint8Array) => createHash("sha256").update(x).digest("hex");
const record = (result: Result<Uint8Array>) =>
  result.ok ? hash(result.value) : result.diagnostics.map((d) => d.code);
const manifest: Manifest =
  phase === "compare" ? await Bun.file(".sumi/compat-after.json").json() : {};
for (const [i, file] of (phase === "compare" ? [] : files).entries()) {
  const text = await Bun.file(file).text();
  const entries: Record<string, Entry> = {};
  for (const theme of [undefined, ...BUILTIN_THEMES.keys()]) {
    const overrides = theme === undefined ? {} : { overrides: { theme } };
    const compiled = compileFigure(text, overrides);
    const d2 =
      compiled.ok && compiled.value.engine === "auto" ? hash(compiled.value.d2Source) : null;
    const rendered = await renderFigure(text, { ...overrides, assetBase: dirname(file) });
    if (!rendered.ok) {
      entries[theme ?? "own"] = { d2, error: rendered.diagnostics.map((d) => d.code) };
      continue;
    }
    const {
      svg,
      compiled: { ir },
    } = rendered.value;
    entries[theme ?? "own"] = {
      d2,
      svg: hash(svg),
      pdf: record(svgToPdf(svg)),
      pptx: record(svgToPptx(svg)),
      freeform: record(svgToEditablePptx(svg, ir)),
      glued: record(svgToEditablePptx(svg, ir, { connectors: "glued" })),
    };
  }
  manifest[file] = entries;
  console.log(`${i + 1}/${files.length} ${file}`);
}
if (phase !== "compare")
  await Bun.write(`.sumi/compat-${phase}.json`, JSON.stringify(manifest, null, 2));
if (before !== undefined) {
  const counts: Record<string, number> = {};
  const changed: string[] = [];
  const diagnosticsChanged = new Set<string>();
  for (const [file, themes] of Object.entries(before)) {
    for (const [theme, entry] of Object.entries(themes)) {
      const next = manifest[file]?.[theme];
      if (next === undefined) throw new Error(`Missing ${file}:${theme}`);
      for (const format of ["d2", "svg", "pdf", "pptx", "freeform", "glued"]) {
        const a = typeof entry[format] === "string" ? entry[format] : null;
        const b = typeof next[format] === "string" ? next[format] : null;
        if (a !== null) counts[format] = (counts[format] ?? 0) + 1;
        if (a !== b) changed.push(`${file}:${theme}:${format}`);
      }
      if (JSON.stringify(entry.error) !== JSON.stringify(next.error)) diagnosticsChanged.add(file);
    }
  }
  console.log({
    files: files.length,
    counts,
    changed,
    diagnosticsChanged: [...diagnosticsChanged],
  });
  if (changed.length > 0) process.exitCode = 1;
}
