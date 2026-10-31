/**
 * Merges the experiment outputs into results.json and measures binaries / determinism.
 * Order: bun probe.ts; bun figure.ts; bun lint-demo.ts; bun pitfall.ts;
 *        bun build --compile bin/{baseline,satori,takumi}.ts --outfile out/bin-<name>; bun collect.ts
 */
import { readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { base } from "./gen";

const out = join(base, "out");
const json = (f: string) => JSON.parse(readFileSync(join(out, f), "utf8"));
const font = join(base, "../../assets/fonts/inter/Inter-Regular.ttf");
const bins: Record<string, unknown> = {};
const baseSize = statSync(join(out, "bin-baseline")).size;
for (const n of ["baseline", "satori", "takumi"]) {
  const size = statSync(join(out, `bin-${n}`)).size;
  const times: number[] = [];
  for (let i = 0; i < 6; i++) {
    const t0 = performance.now();
    const p = Bun.spawnSync([join(out, `bin-${n}`), font], { cwd: "/" });
    if (p.exitCode !== 0) throw new Error(`bin-${n} failed: ${p.stderr}`);
    times.push(Math.round(performance.now() - t0));
  }
  bins[n] = {
    bytes: size,
    deltaBytes: size - baseSize,
    wallMsRuns: times,
    wallMsWarmMedian: [...times.slice(1)].sort((a, b) => a - b)[2],
  };
}
const sha = (cmd: string[], env: Record<string, string> = {}) => {
  const p = Bun.spawnSync(cmd, { cwd: base, env: { ...process.env, ...env } });
  if (p.exitCode !== 0) throw new Error(p.stderr.toString());
  return JSON.parse(p.stdout.toString()) as Record<string, string>;
};
const a = sha(["bun", "determinism.ts"]);
const b = sha(["bun", "determinism.ts"]);
// Node cannot resolve extensionless TypeScript imports, so bundle the script for it.
Bun.spawnSync(
  [
    "bun",
    "build",
    "determinism.ts",
    "--target=node",
    "--external",
    "satori",
    "--external",
    "@takumi-rs/wasm",
    "--outfile",
    "determinism.node.mjs",
  ],
  { cwd: base },
);
const c = sha(["node", "determinism.node.mjs"]);
unlinkSync(join(base, "determinism.node.mjs")); // generated; biome does not honour .gitignore
const d = sha(["bun", "determinism.ts"], {
  TZ: "Asia/Tokyo",
  LANG: "ja_JP.UTF-8",
  LC_ALL: "ja_JP.UTF-8",
});
const same = (x: object, y: object) => JSON.stringify(x) === JSON.stringify(y);
const probe = json("probe-results.json");
const fig = json("figure-results.json");
const results = {
  environment: {
    bun: Bun.version,
    platform: process.platform,
    arch: process.arch,
    satori: "0.63.2",
    satoriHtml: "0.3.2 (not used by the pipeline, see README)",
    takumiWasm: "2.19.0",
  },
  singleBinary: {
    baselineBytes: baseSize,
    ...bins,
    linuxX64CrossCompile:
      "bun build --compile --target=bun-linux-x64 succeeded for satori.ts and takumi.ts (not executed)",
  },
  determinism: {
    pieces: Object.keys(a).length,
    bunRunTwiceIdentical: same(a, b),
    bunVsNodeIdentical: same(a, c),
    tzLocaleChangeIdentical: same(a, d),
    crossOsVerified: false,
    sha256Prefixes: a,
  },
  importerCompat: probe.compat,
  idCollisions: probe.idCollisions,
  text: probe.text,
  measureCodeWindow: probe.measure,
  safety: probe.safety,
  cssBehaviour: probe.css,
  figures: fig,
  lintDemo: json("lint-demo.json"),
};
writeFileSync(join(base, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      singleBinary: results.singleBinary,
      determinism: { ...results.determinism, sha256Prefixes: undefined },
    },
    null,
    1,
  ),
);
