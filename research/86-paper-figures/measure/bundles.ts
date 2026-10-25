/**
 * Minified bundle size of candidate layout / constraint libraries, as a proxy
 * for what they would add to the single binary (#57 measured the compile delta
 * of elkjs at about its bundle size). Installed only into a gitignored
 * .tools/ project; each entry imports and calls the library once so tree
 * shaking keeps the code that a layout call needs.
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { runCommand } from "../../../src/core/subprocess";
import { PINNED } from "./packages";
import { installLocked } from "./tools";

const DIR = join(import.meta.dir, "..", ".tools", "bundles");

const ENTRIES: Record<string, string> = {
  "@lume/kiwi": `import * as kiwi from "@lume/kiwi";
const s = new kiwi.Solver(); const x = new kiwi.Variable(); const y = new kiwi.Variable();
s.addConstraint(new kiwi.Constraint(new kiwi.Expression(x, [-1, y], 10), kiwi.Operator.Eq));
s.addEditVariable(y, kiwi.Strength.strong); s.suggestValue(y, 5); s.updateVariables();
console.log(JSON.stringify([x.value(), y.value()]));`,
  webcola: `import * as cola from "webcola";
const l = new cola.Layout().nodes([{ width: 10, height: 10 }, { width: 10, height: 10 }]).links([{ source: 0, target: 1 }]).avoidOverlaps(true);
l.start(10, 0, 10, 0, false); console.log(JSON.stringify(l.nodes().map((n) => [Math.round(n.x), Math.round(n.y)])));`,
  "@dagrejs/dagre": `import * as dagre from "@dagrejs/dagre";
const g = new dagre.graphlib.Graph(); g.setGraph({}); g.setDefaultEdgeLabel(() => ({}));
g.setNode("a", { width: 10, height: 10 }); g.setNode("b", { width: 10, height: 10 }); g.setEdge("a", "b");
dagre.layout(g); console.log(JSON.stringify(g.nodes().map((n) => [g.node(n).x, g.node(n).y])));`,
};

export interface BundleReport {
  name: string;
  version: string;
  ok: boolean;
  output?: string;
  sameOutputTwice?: boolean;
  minifiedBytes?: number;
  gzipBytes?: number;
  error?: string;
}

export async function measureBundles(): Promise<BundleReport[]> {
  await mkdir(DIR, { recursive: true });
  const deps = Object.fromEntries(Object.keys(ENTRIES).map((n) => [n, PINNED[n] ?? ""]));
  await writeFile(join(DIR, "package.json"), JSON.stringify({ private: true, dependencies: deps }));
  await installLocked(DIR, "bundles");
  const out: BundleReport[] = [];
  for (const [name, source] of Object.entries(ENTRIES)) {
    const base = name.replace(/[@/]/g, "_");
    await writeFile(join(DIR, `${base}.mjs`), source);
    const run = await runCommand(["bun", `${base}.mjs`], { cwd: DIR });
    const rerun = await runCommand(["bun", `${base}.mjs`], { cwd: DIR });
    const build = await runCommand(
      [
        "bun",
        "build",
        "--minify",
        "--target",
        "bun",
        `${base}.mjs`,
        "--outfile",
        `${base}.bundle.js`,
      ],
      { cwd: DIR },
    );
    if (run.exitCode !== 0 || build.exitCode !== 0) {
      out.push({
        name,
        version: PINNED[name] ?? "",
        ok: false,
        error: (run.stderr + build.stderr).slice(-300),
      });
      continue;
    }
    const file = join(DIR, `${base}.bundle.js`);
    out.push({
      name,
      version: PINNED[name] ?? "",
      ok: true,
      output: run.stdout.trim(),
      sameOutputTwice: run.stdout === rerun.stdout,
      minifiedBytes: (await stat(file)).size,
      gzipBytes: gzipSync(await readFile(file)).length,
    });
  }
  return out;
}

if (import.meta.main) console.log(JSON.stringify(await measureBundles(), null, 2));
