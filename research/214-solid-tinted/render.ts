/** Render the #214 acceptance copy and a <150 KB preview, entirely inside the worktree. */
import { cpSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../..");
const out = join(import.meta.dir, "out");
const previews = join(import.meta.dir, "previews");
mkdirSync(out, { recursive: true });
mkdirSync(previews, { recursive: true });
cpSync(
  join(root, "research/185-acceptance/figures/assets"),
  join(import.meta.dir, "figures/assets"),
  { recursive: true },
);
const source = "research/214-solid-tinted/figures/c-h3world.sumi.yaml";
function run(args: string[]) {
  const result = Bun.spawnSync(args, { cwd: root, stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) throw new Error(`${args.join(" ")} failed`);
}
run(["bun", "src/cli/index.ts", "fmt", source]);
run(["bun", "src/cli/index.ts", "lint", "--json", source]);
for (const format of ["svg", "pdf"]) {
  run([
    "bun",
    "src/cli/index.ts",
    "render",
    "--json",
    source,
    "-o",
    join(out, `c-h3world.${format}`),
  ]);
}
run([
  "pdftoppm",
  "-scale-to",
  "1800",
  "-singlefile",
  "-png",
  join(out, "c-h3world.pdf"),
  join(out, "c-h3world"),
]);
const preview = join(previews, "c-h3world.png");
run(["magick", join(out, "c-h3world.png"), "-colors", "64", `PNG8:${preview}`]);
if (statSync(preview).size >= 150_000) throw new Error("preview exceeds 150 KB");
console.log(`Preview: ${preview} (${statSync(preview).size} bytes)`);
