/** Exhaustive local compatibility probe; baseline paths are frozen on the first run. */
import { dirname, resolve } from "node:path";
import { BUILTIN_THEMES } from "../src/core/theme/builtin";
import { svgToPdf } from "../src/render/pdf";
import { svgToPptx } from "../src/render/pptx";
import { renderFigure } from "../src/render/render";

const phase = process.argv[2] ?? "before";
const root = resolve(import.meta.dir, "..");
const manifest = resolve(root, ".sumi/compat-283-paths.json");
const paths: string[] =
  phase === "before"
    ? [...new Bun.Glob("**/*.sumi.yaml").scanSync({ cwd: root, dot: true })]
        .filter(
          (p) =>
            !p.startsWith("node_modules/") && !p.startsWith(".git/") && !p.startsWith(".sumi/"),
        )
        .sort()
    : await Bun.file(manifest).json();
if (phase === "before") await Bun.write(manifest, JSON.stringify(paths));
const hash = (s: string | Uint8Array) => new Bun.CryptoHasher("sha256").update(s).digest("hex");
const results: Record<string, unknown> = {};
for (const [i, path] of paths.entries()) {
  const source = await Bun.file(resolve(root, path)).text();
  for (const theme of [undefined, ...BUILTIN_THEMES.keys()]) {
    const key = `${path}::${theme ?? "own"}`;
    try {
      const r = await renderFigure(source, {
        assetBase: dirname(resolve(root, path)),
        ...(theme && { overrides: { theme } }),
      });
      if (!r.ok) {
        results[key] = { failed: r.diagnostics.map((d) => d.code) };
        continue;
      }
      const pdf = svgToPdf(r.value.svg);
      const pptx = svgToPptx(r.value.svg);
      results[key] = {
        svg: hash(r.value.svg),
        pdf: pdf.ok ? hash(pdf.value) : pdf.diagnostics.map((d) => d.code),
        pptx: pptx.ok ? hash(pptx.value) : pptx.diagnostics.map((d) => d.code),
        d2: r.value.compiled.engine === "auto" ? hash(r.value.compiled.d2Source) : null,
      };
    } catch (e) {
      results[key] = { exception: String(e) };
    }
  }
  console.log(`${i + 1}/${paths.length} ${path}`);
}
await Bun.write(resolve(root, `.sumi/compat-283-${phase}.json`), JSON.stringify(results, null, 2));
if (phase !== "before") {
  const before = await Bun.file(resolve(root, ".sumi/compat-283-before.json")).json();
  const changed = Object.keys(before).filter(
    (k) => JSON.stringify(before[k]) !== JSON.stringify(results[k]),
  );
  console.log(JSON.stringify({ cases: Object.keys(results).length, changed }, null, 2));
  if (changed.length) process.exitCode = 1;
}
