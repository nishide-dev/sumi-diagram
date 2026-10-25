/**
 * MathJax as an in-process TeX -> SVG engine: does it run under Bun, is the
 * output deterministic, how large are the SVGs, and what does it add to a
 * `bun build --compile` binary. MathJax is installed only into a gitignored
 * .tools/ project of its own (never the root package.json / bun.lock).
 */
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runCommand } from "../../../src/core/subprocess";

const TOOLS = join(import.meta.dir, "..", ".tools");

export const MATHJAX_VARIANTS = {
  "mathjax-full@3.2.2": { pkg: "mathjax-full", version: "3.2.2", root: "mathjax-full/js" },
  "@mathjax/src@4.1.3": { pkg: "@mathjax/src", version: "4.1.3", root: "@mathjax/src/js" },
} as const;

export const EXPRESSIONS = [
  "\\alpha_2",
  "\\gamma_1,\\beta_1",
  "32 \\times 32 \\times 4",
  "I_{13-16}",
  "\\mathcal{L} = \\sum_i \\lVert x_i \\rVert^2",
];

function entrySource(root: string, v4: boolean): string {
  return `
import { mathjax } from "${root}/mathjax.js";
import { TeX } from "${root}/input/tex.js";
import { SVG } from "${root}/output/svg.js";
import { liteAdaptor } from "${root}/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "${root}/handlers/html.js";
import "${root}/input/tex/base/BaseConfiguration.js";
import "${root}/input/tex/ams/AmsConfiguration.js";
${v4 ? 'import { MathJaxNewcmFont } from "@mathjax/mathjax-newcm-font/js/svg.js";' : ""}
const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const doc = mathjax.document("", {
  InputJax: new TeX({ packages: ["base", "ams"] }),
  OutputJax: new SVG({ fontCache: "local"${v4 ? ", fontData: MathJaxNewcmFont" : ""} }),
});
const out = [];
for (const tex of ${JSON.stringify(EXPRESSIONS)}) {
  const t0 = performance.now();
  try {
    const svg = adaptor.innerHTML(doc.convert(tex, { display: false }));
    out.push({
      tex,
      ms: Number((performance.now() - t0).toFixed(2)),
      bytes: svg.length,
      paths: svg.split("<path").length - 1,
      texts: svg.split("<text").length - 1,
      uses: svg.split("<use").length - 1,
      width: (svg.match(/width="([^"]+)"/) || [])[1],
      sha256: new Bun.CryptoHasher("sha256").update(svg).digest("hex"),
    });
  } catch (e) {
    out.push({ tex, error: String(e) });
  }
}
console.log(JSON.stringify(out));
`;
}

export interface MathJaxReport {
  variant: string;
  installedPackages?: number;
  run?: unknown;
  deterministic?: boolean;
  compiled?: {
    controlBytes: number;
    withMathJaxBytes: number;
    deltaBytes: number;
    sameOutput: boolean;
  };
  error?: string;
}

async function size(path: string): Promise<number> {
  return (await stat(path)).size;
}

export async function measureMathJax(compile = true): Promise<MathJaxReport[]> {
  const reports: MathJaxReport[] = [];
  for (const [variant, spec] of Object.entries(MATHJAX_VARIANTS)) {
    const dir = join(TOOLS, `mathjax-${spec.pkg.replace("/", "__")}-${spec.version}`);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ private: true, dependencies: { [spec.pkg]: spec.version } }, null, 2),
    );
    const install = await runCommand(["bun", "install", "--ignore-scripts"], { cwd: dir });
    if (install.exitCode !== 0) {
      reports.push({ variant, error: install.stderr.slice(-400) });
      continue;
    }
    const v4 = spec.pkg === "@mathjax/src";
    await writeFile(join(dir, "entry.mjs"), entrySource(spec.root, v4));
    await writeFile(join(dir, "control.mjs"), "console.log(JSON.stringify([{ok:true}]));\n");
    const first = await runCommand(["bun", "entry.mjs"], { cwd: dir });
    const second = await runCommand(["bun", "entry.mjs"], { cwd: dir });
    const report: MathJaxReport = { variant };
    if (first.exitCode !== 0) {
      report.error = first.stderr.slice(-600);
      reports.push(report);
      continue;
    }
    const strip = (s: string) => s.replace(/"ms":[\d.]+/g, "");
    report.run = JSON.parse(first.stdout);
    report.deterministic = strip(first.stdout) === strip(second.stdout);
    const lock = await runCommand(["bun", "pm", "ls", "--all"], { cwd: dir });
    report.installedPackages = lock.stdout.split("\n").filter((l) => /[├└]/.test(l)).length;
    if (compile) {
      const bin = join(dir, "bin");
      await rm(bin, { recursive: true, force: true });
      await mkdir(bin);
      for (const name of ["entry", "control"]) {
        const b = await runCommand(
          ["bun", "build", "--compile", "--minify", `${name}.mjs`, "--outfile", join(bin, name)],
          { cwd: dir },
        );
        if (b.exitCode !== 0) throw new Error(b.stderr);
      }
      // Run the compiled binary from an unrelated cwd (no node_modules nearby).
      const fromBinary = await runCommand([join(bin, "entry")], { cwd: TOOLS });
      report.compiled = {
        controlBytes: await size(join(bin, "control")),
        withMathJaxBytes: await size(join(bin, "entry")),
        deltaBytes: (await size(join(bin, "entry"))) - (await size(join(bin, "control"))),
        sameOutput: fromBinary.exitCode === 0 && strip(fromBinary.stdout) === strip(first.stdout),
      };
    }
    reports.push(report);
  }
  return reports;
}

if (import.meta.main) console.log(JSON.stringify(await measureMathJax(), null, 2));
