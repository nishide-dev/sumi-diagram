// Merges the per-shard lcov reports of the sharded CI test jobs (#320) into one
// line-coverage table, since a shard alone only sees the files its tests import.
//
//   bun scripts/merge-lcov.ts <lcov.info | directory>...
//
// Bun's lcov carries per-line hit counts (DA) but only function totals (FNF/FNH,
// no per-function records), so hits are summed per line and function coverage is
// not reported. The table goes to stdout and, in CI, to the job summary.

import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { Glob } from "bun";

export type LineHits = Map<string, Map<number, number>>;

/** Adds the DA records of one lcov document into `into`. */
export function mergeLcov(text: string, into: LineHits): void {
  let current: Map<number, number> | undefined;
  for (const line of text.split("\n")) {
    if (line.startsWith("SF:")) {
      const file = line.slice(3).trim();
      current = into.get(file) ?? new Map();
      into.set(file, current);
    } else if (line.startsWith("DA:") && current) {
      const [no, hits] = line.slice(3).split(",");
      const n = Number(no);
      current.set(n, (current.get(n) ?? 0) + Number(hits ?? 0));
    } else if (line === "end_of_record") {
      current = undefined;
    }
  }
}

export function lineTable(hits: LineHits): string {
  const rows = [...hits.entries()]
    .map(([file, lines]) => ({
      file,
      found: lines.size,
      hit: [...lines.values()].filter((h) => h > 0).length,
    }))
    .sort((a, b) => a.file.localeCompare(b.file));
  const pct = (hit: number, found: number) => (found === 0 ? 100 : (hit / found) * 100).toFixed(2);
  const total = rows.reduce((t, r) => ({ found: t.found + r.found, hit: t.hit + r.hit }), {
    found: 0,
    hit: 0,
  });
  const width = Math.max(10, ...rows.map((r) => r.file.length));
  const out = [`${"File".padEnd(width)} | % Lines`, `${"-".repeat(width)}-|--------`];
  out.push(`${"All files".padEnd(width)} | ${pct(total.hit, total.found).padStart(7)}`);
  for (const r of rows) out.push(`${r.file.padEnd(width)} | ${pct(r.hit, r.found).padStart(7)}`);
  return out.join("\n");
}

async function main(args: string[]): Promise<void> {
  if (args.length === 0) throw new Error("Usage: merge-lcov.ts <lcov.info | directory>...");
  const hits: LineHits = new Map();
  let reports = 0;
  for (const arg of args) {
    const paths = arg.endsWith(".info")
      ? [arg]
      : [...new Glob("**/lcov.info").scanSync({ cwd: arg })].map((p) => join(arg, p));
    for (const path of paths) {
      mergeLcov(await Bun.file(path).text(), hits);
      reports++;
    }
  }
  if (reports === 0) throw new Error("No lcov.info found");
  const table = lineTable(hits);
  console.log(`Merged line coverage of ${reports} shard report(s)\n\n${table}`);
  const summary = process.env["GITHUB_STEP_SUMMARY"];
  if (summary) {
    appendFileSync(
      summary,
      `### Merged line coverage (${reports} shards)\n\n\`\`\`\n${table}\n\`\`\`\n`,
    );
  }
}

if (import.meta.main) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(`merge-lcov: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
