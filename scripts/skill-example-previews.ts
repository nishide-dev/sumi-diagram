/** Regenerate Skill reference PNGs (examples from the gallery PDFs, which needs Poppler; layouts from their SVGs). */
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
for (const name of [
  "transformer",
  "dit-block",
  "clip",
  "embedding-gemma",
  "gcn",
  "tricl",
  "llama4-moe",
  "llada",
  "chat",
  "llm-dialogue",
  "pipeline",
  "decision-flow",
  "system-architecture",
  "grouped",
]) {
  const pdf = join(root, "examples", name, `${name}.pdf`);
  const output = join(root, "skills", "sumi", "examples", name, name);
  const run = Bun.spawnSync(["pdftoppm", "-png", "-r", "150", "-singlefile", pdf, output], {
    stdout: "inherit",
    stderr: "inherit",
  });
  if (run.exitCode !== 0) throw new Error(`pdftoppm failed for ${name}; install Poppler first.`);
  console.log(`Wrote ${output}.png`);
}

// Base layouts (#511): PNG thumbnails of the gallery SVGs, through the Skill's own preview script.
const manifest: Record<string, string> = {};
const layouts = new Bun.Glob("skills/sumi/layouts/*/*.svg").scanSync({ cwd: root });
for (const svg of [...layouts].sort()) {
  const png = join(root, svg.replace(/\.svg$/, ".png"));
  const run = Bun.spawnSync(
    [join(root, "skills/sumi/scripts/preview"), "-o", png, join(root, svg), "1000"],
    { stdout: "inherit", stderr: "inherit" },
  );
  if (run.exitCode !== 0) throw new Error(`preview failed for ${svg}.`);
  // The SVG each PNG was made from, so the tests can tell a stale PNG.
  manifest[svg.split("/")[3] ?? svg] = new Bun.CryptoHasher("sha256")
    .update(await Bun.file(join(root, svg)).bytes())
    .digest("hex");
}
await Bun.write(
  join(root, "skills/sumi/layouts/previews.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
