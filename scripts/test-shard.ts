// Deterministic sharding of the test suite for CI (#320).
//
//   bun scripts/test-shard.ts <index>/<total>   print the test files of one shard
//   bun scripts/test-shard.ts --check [<total>] verify the shards cover every test file
//   bun scripts/test-shard.ts --update <junit.xml>...  rewrite scripts/test-durations.json
//     (several reports, e.g. the junit artifacts of all CI shards, are merged)
//
// Files are balanced by the per-file seconds recorded in scripts/test-durations.json
// (longest first onto the lightest shard). A file without a recorded duration is
// placed by a stable hash of its path, so a new test file never reshuffles the rest.
// Regenerate the durations from a full run with:
//   bun test --timeout 60000 --reporter=junit --reporter-outfile=/tmp/junit.xml
//   bun scripts/test-shard.ts --update /tmp/junit.xml

import { join } from "node:path";
import { Glob } from "bun";

export const DEFAULT_SHARDS = 4;
const ROOT = join(import.meta.dir, "..");
const DURATIONS_PATH = join(import.meta.dir, "test-durations.json");
const SKIPPED_DIRS = /(^|\/)node_modules(\/|$)/;
const EXTENSIONS = "ts,tsx,js,jsx,mjs,cjs,mts,cts";
// Bun's own rules: `*.test.*`, `*_test.*`, `*.spec.*`, `*_spec.*` with a JS/TS
// extension; node_modules and dot-directories are not searched.
const TEST_FILE = /[._](test|spec)\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/i;
// Deliberately broader, for the cross-check: a tracked file that looks like a
// test (`foo-test.ts`, `x.tests.ts`) but is not one Bun runs.
const TEST_LIKE = /(^|[-._])(tests?|specs?)\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/i;

export function isTestLike(path: string): boolean {
  return TEST_LIKE.test(path) && !isTestFile(path);
}

export function isTestFile(path: string): boolean {
  return (
    TEST_FILE.test(path) &&
    !SKIPPED_DIRS.test(path) &&
    !path
      .split("/")
      .slice(0, -1)
      .some((d) => d.startsWith("."))
  );
}

/** Every test file under `root`, as sorted repo-relative POSIX paths (what `bun test` runs). */
export function discoverTestFiles(root: string = ROOT): string[] {
  // Bun matches case-insensitively and runs dot-named files (but not dot-directories),
  // so the glob spells each letter in both cases and scans dot paths; isTestFile filters.
  const anyCase = (word: string) =>
    [...word].map((c) => `[${c.toLowerCase()}${c.toUpperCase()}]`).join("");
  const glob = new Glob(
    `**/*{.,_}{${anyCase("test")},${anyCase("spec")}}.{${EXTENSIONS.split(",").map(anyCase).join(",")}}`,
  );
  const files: string[] = [];
  for (const file of glob.scanSync({ cwd: root, dot: true })) {
    const path = file.replaceAll("\\", "/");
    if (isTestFile(path)) files.push(path);
  }
  return files.sort();
}

/** FNV-1a, 32 bit: a stable, dependency-free hash for placing unrecorded files. */
export function hashPath(path: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < path.length; i++) {
    hash ^= path.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

export type Durations = Readonly<Record<string, number>>;

/** Partitions `files` into `total` shards (index 0-based in the result). */
export function assignShards(
  files: readonly string[],
  durations: Durations,
  total: number,
): string[][] {
  if (!Number.isInteger(total) || total < 1) throw new Error(`Invalid shard count: ${total}`);
  const shards: string[][] = Array.from({ length: total }, () => []);
  const load = new Array<number>(total).fill(0);
  const known = files.filter((f) => durations[f] !== undefined);
  known.sort((a, b) => (durations[b] ?? 0) - (durations[a] ?? 0) || a.localeCompare(b));
  for (const file of known) {
    let lightest = 0;
    for (let i = 1; i < total; i++) if ((load[i] ?? 0) < (load[lightest] ?? 0)) lightest = i;
    shards[lightest]?.push(file);
    load[lightest] = (load[lightest] ?? 0) + (durations[file] ?? 0);
  }
  for (const file of files) {
    if (durations[file] === undefined) shards[hashPath(file) % total]?.push(file);
  }
  return shards.map((s) => s.sort());
}

/** Throws unless the shards are pairwise disjoint and their union is exactly `files`. */
export function verifyPartition(files: readonly string[], shards: readonly string[][]): void {
  const seen = new Map<string, number>();
  shards.forEach((shard, i) => {
    for (const file of shard) {
      const first = seen.get(file);
      if (first !== undefined) {
        throw new Error(`${file} is in shard ${first + 1} and shard ${i + 1}`);
      }
      seen.set(file, i);
    }
  });
  const missing = files.filter((f) => !seen.has(f));
  const extra = [...seen.keys()].filter((f) => !files.includes(f));
  if (missing.length > 0) throw new Error(`Not in any shard: ${missing.join(", ")}`);
  if (extra.length > 0) throw new Error(`Not a test file: ${extra.join(", ")}`);
}

/** Per-file seconds: the sum of the test case times of a `bun test --reporter=junit` report. */
export function durationsFromJunit(xml: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const match of xml.matchAll(/<testcase ([^>]*)>/g)) {
    const attrs = match[1] ?? "";
    const file = /\bfile="([^"]*)"/.exec(attrs)?.[1];
    const time = Number(/\btime="([^"]*)"/.exec(attrs)?.[1] ?? 0);
    if (file) out[file] = (out[file] ?? 0) + time;
  }
  const rounded: Record<string, number> = {};
  for (const file of Object.keys(out).sort()) {
    rounded[file] = Math.max(0.1, Math.round((out[file] ?? 0) * 10) / 10);
  }
  return rounded;
}

async function readDurations(): Promise<Durations> {
  return (await Bun.file(DURATIONS_PATH).json()) as Durations;
}

/** Every tracked path (an independent view of the tree from the directory scan). */
function trackedFiles(): string[] {
  const run = Bun.spawnSync(["git", "ls-files"], { cwd: ROOT });
  return run.stdout
    .toString()
    .split("\n")
    .filter((f) => f !== "")
    .sort();
}

async function main(args: string[]): Promise<number> {
  const [first, second] = args;
  if (first === "--update") {
    const reports = args.slice(1);
    if (reports.length === 0) throw new Error("Usage: test-shard.ts --update <junit.xml>...");
    const merged: Record<string, number> = {};
    for (const report of reports) {
      Object.assign(merged, durationsFromJunit(await Bun.file(report).text()));
    }
    await Bun.write(DURATIONS_PATH, `${JSON.stringify(merged, null, 2)}\n`);
    console.log(`Wrote ${Object.keys(merged).length} durations to ${DURATIONS_PATH}`);
    return 0;
  }
  const durations = await readDurations();
  const files = discoverTestFiles();
  if (first === "--check") {
    const total = second ? Number(second) : DEFAULT_SHARDS;
    const shards = assignShards(files, durations, total);
    verifyPartition(files, shards);
    const tracked = trackedFiles();
    if (tracked.length > 0) {
      const gone = tracked.filter((f) => isTestFile(f) && !files.includes(f));
      if (gone.length > 0) throw new Error(`Tracked test files not discovered: ${gone.join(", ")}`);
      const nearMiss = tracked.filter((f) => isTestLike(f));
      if (nearMiss.length > 0) {
        throw new Error(
          `Looks like a test file but Bun would not run it (name it *.test.ts / *_test.ts): ${nearMiss.join(", ")}`,
        );
      }
    }
    const stale = Object.keys(durations).filter((f) => !files.includes(f));
    if (stale.length > 0) {
      console.log(
        `warning: ${stale.length} stale duration entr(ies) in test-durations.json: ${stale.join(", ")}`,
      );
    }
    const unrecorded = files.filter((f) => durations[f] === undefined);
    shards.forEach((shard, i) => {
      const seconds = shard.reduce((sum, f) => sum + (durations[f] ?? 0), 0);
      console.log(
        `shard ${i + 1}/${total}: ${shard.length} files, ~${seconds.toFixed(0)}s recorded`,
      );
    });
    console.log(`OK: ${files.length} test files, each in exactly one of ${total} shards`);
    if (unrecorded.length > 0) {
      console.log(`${unrecorded.length} file(s) without a recorded duration (placed by hash)`);
    }
    return 0;
  }
  const match = /^(\d+)\/(\d+)$/.exec(first ?? "");
  if (!match)
    throw new Error(
      "Usage: test-shard.ts <index>/<total> | --check [total] | --update <junit.xml>",
    );
  const index = Number(match[1]);
  const total = Number(match[2]);
  if (index < 1 || index > total) throw new Error(`Shard index ${index} is outside 1..${total}`);
  const shards = assignShards(files, durations, total);
  verifyPartition(files, shards);
  // "./" makes `bun test` treat each argument as a path, not a substring filter.
  for (const file of shards[index - 1] ?? []) console.log(`./${file}`);
  return 0;
}

if (import.meta.main) {
  try {
    process.exit(await main(process.argv.slice(2)));
  } catch (error) {
    console.error(`test-shard: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
