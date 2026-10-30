/** Measure every existing figure in its own theme; output reproducible occupancy data. */
import { dirname } from "node:path";
import { groupEmptySpace } from "../../src/lint/geometry/empty-space";
import { geometryContextFor } from "../../src/lint/geometry/lint";
import { renderFigure } from "../../src/render/render";

const files = (await Array.fromAsync(new Bun.Glob("**/*.sumi.yaml").scan()))
  .filter((p) => !p.startsWith("node_modules/") && !p.startsWith("research/248-fill/"))
  .sort();
const groups: { file: string; id: string; empty: number }[] = [];
let rendered = 0;
for (const file of files) {
  const result = await renderFigure(await Bun.file(file).text(), {
    file,
    assetBase: dirname(file),
  });
  if (!result.ok) continue;
  rendered++;
  const context = geometryContextFor(result.value);
  for (const group of context.elements) {
    const empty = groupEmptySpace(context, group);
    if (empty !== undefined) groups.push({ file, id: group.key, empty });
  }
}
groups.sort((a, b) => a.empty - b.empty);
const percentile = (p: number) => groups[Math.ceil(groups.length * p) - 1]?.empty;
const summary = {
  figures: files.length,
  rendered,
  groups: groups.length,
  p50: percentile(0.5),
  p75: percentile(0.75),
  p90: percentile(0.9),
  p95: percentile(0.95),
  max: groups.at(-1)?.empty,
};
console.log(JSON.stringify(summary, null, 2));
await Bun.write(
  "research/248-fill/occupancy.json",
  `${JSON.stringify({ summary, groups }, null, 2)}\n`,
);
