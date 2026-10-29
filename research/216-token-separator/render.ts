/** Reproduce the #216 H3-World acceptance copy and its small PDF-derived preview. */
import { cpSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const here = import.meta.dir;
const root = join(here, "../..");
const figure = join(here, "c-h3world.sumi.yaml");
const out = join(here, "out");
const previews = join(here, "previews");
mkdirSync(out, { recursive: true });
mkdirSync(previews, { recursive: true });
cpSync(join(root, "research/185-acceptance/figures/assets"), join(here, "assets"), {
  recursive: true,
});
if (!existsSync(figure)) {
  // Bootstrap only: the committed copy is subsequently edited as ordinary YAML.
  const original = readFileSync(
    join(root, "research/185-acceptance/figures/c-h3world.sumi.yaml"),
    "utf8",
  );
  const source = original
    .replace(
      /^# #185 acceptance:/,
      "# #216 acceptance: dotted separators in the packed and block token rows.\n# Based on #185 acceptance:",
    )
    .replace(
      /( {8}- \{ id: i0, label:)/g,
      "        - { id: av, separator: dotted, tone: gray }\n$1",
    );
  writeFileSync(figure, source);
}
function run(args: string[]) {
  const result = Bun.spawnSync(args, { cwd: root, stdout: "pipe", stderr: "pipe" });
  console.log(result.stdout.toString());
  if (result.exitCode !== 0) throw new Error(`${args.join(" ")}\n${result.stderr.toString()}`);
}
const cli = (...args: string[]) => run(["bun", "src/cli/index.ts", ...args]);
cli("fmt", figure);
cli("lint", "--geometry", "--json", figure);
for (const ext of ["svg", "pdf", "pptx"])
  cli("render", figure, "-o", join(out, `c-h3world.${ext}`));
run([
  "pdftoppm",
  "-r",
  "200",
  "-png",
  "-singlefile",
  join(out, "c-h3world.pdf"),
  join(out, "c-h3world"),
]);
run([
  "magick",
  join(out, "c-h3world.png"),
  "+dither",
  "-colors",
  "64",
  "-strip",
  join(previews, "c-h3world.png"),
]);
const size = statSync(join(previews, "c-h3world.png")).size;
console.log(`Preview: ${size} bytes`);
if (size >= 150_000) throw new Error("Preview must be smaller than 150KB");
