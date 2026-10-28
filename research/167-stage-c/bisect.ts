// Bisection helper for #167: keep only some root items of a structured
// figure (and the nodes, groups and edges that belong to them), to find which
// part of a figure triggers a routing problem.
// Usage: bun research/167-stage-c/bisect.ts <in.sumi.yaml> <out.sumi.yaml> <keep-id>...
// A kept id is a root arrange item (a group id or a node id); a nested box in
// the root is kept when it names a kept id anywhere inside.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse, stringify } from "yaml";

const [input, output, ...keep] = process.argv.slice(2);
if (input === undefined || output === undefined || keep.length === 0) {
  throw new Error("usage: bisect.ts <in> <out> <keep-id>...");
}
// biome-ignore lint/suspicious/noExplicitAny: research script over free-form YAML
const doc: any = parse(readFileSync(input, "utf8"));

// biome-ignore lint/suspicious/noExplicitAny: research script over free-form YAML
function ids(item: any, out: Set<string>): Set<string> {
  if (typeof item === "string") out.add(item);
  else if (item && typeof item === "object") {
    for (const box of ["stack", "row"]) if (item[box]) for (const i of item[box].items) ids(i, out);
    if (item.item) out.add(item.item);
  }
  return out;
}
const groups = new Map<string, unknown>(
  // biome-ignore lint/suspicious/noExplicitAny: research script
  (doc.groups ?? []).map((g: any) => [g.id, g]),
);
const keepSet = new Set(keep);
const root = doc.figure.layout.arrange;
const rootBox = root.stack ?? root.row;
// biome-ignore lint/suspicious/noExplicitAny: research script
rootBox.items = rootBox.items.filter((i: any) =>
  [...ids(i, new Set())].some((id) => keepSet.has(id)),
);
const placed = ids(root, new Set());
let grew = true;
while (grew) {
  grew = false;
  for (const id of [...placed]) {
    // biome-ignore lint/suspicious/noExplicitAny: research script
    const g: any = groups.get(id);
    if (g?.arrange)
      for (const c of ids(g.arrange, new Set()))
        if (!placed.has(c)) {
          placed.add(c);
          grew = true;
        }
  }
}
// biome-ignore lint/suspicious/noExplicitAny: research script
doc.groups = (doc.groups ?? []).filter((g: any) => placed.has(g.id));
// biome-ignore lint/suspicious/noExplicitAny: research script
const attached = (n: any) => n.attach && placed.has(n.attach.to);
// biome-ignore lint/suspicious/noExplicitAny: research script
doc.nodes = doc.nodes.filter((n: any) => placed.has(n.id) || attached(n));
// biome-ignore lint/suspicious/noExplicitAny: research script
const nodeIds = new Set([...placed, ...doc.nodes.map((n: any) => n.id)]);
// biome-ignore lint/suspicious/noExplicitAny: research script
doc.edges = (doc.edges ?? []).filter((e: any) => nodeIds.has(e.from) && nodeIds.has(e.to));
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, stringify(doc));
// copy image assets next to the output
// biome-ignore lint/suspicious/noExplicitAny: research script
for (const n of doc.nodes.filter((n: any) => n.props?.src)) {
  const from = join(dirname(input), n.props.src);
  const to = join(dirname(output), n.props.src);
  mkdirSync(dirname(to), { recursive: true });
  if (existsSync(from)) copyFileSync(from, to);
}
