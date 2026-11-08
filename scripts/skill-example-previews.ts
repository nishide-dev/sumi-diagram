/** Regenerate Skill reference PNGs from the gallery PDFs; requires Poppler. */
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
for (const name of [
  "transformer",
  "dit-block",
  "clip",
  "embedding-gemma",
  "gcn",
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
