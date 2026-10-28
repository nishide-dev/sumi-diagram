/**
 * #181: rewrites the hand-written token cells of two research figures with
 * `component: tokens` (design doc §6.50), changing nothing else:
 *
 * - research/167-stage-c/figures/c-h3world.sumi.yaml (H3-World): the packed
 *   sequence (`seq-*`), the H3 block's tokens (`bt-*`), the column of LoRA
 *   tokens (`ct-*`) and the 5 × 2 key clusters (`k<n>-*`, written as lines);
 * - research/151-dogfood-v0.5/figures/vit-input.sumi.yaml (ViT): the five
 *   position + patch token pairs.
 *
 * The originals are not changed; the results are written to figures/ here.
 * `src/core/figure/tokens.integration.test.ts` checks that each has the same
 * Layout IR as its original, with the cells' reserved IDs mapped to the
 * hand-written ones.
 *
 *   bun research/181-tokens/rewrite.ts
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const ROOT = join(import.meta.dir, "..", "..");
const OUT = join(import.meta.dir, "figures");

interface Node {
  id: string;
  label?: string;
  tone?: string;
  props?: { width?: string; height?: string };
}

const header = (from: string) =>
  [
    `# #181: ${from}`,
    "# with its token cells written as `component: tokens` by",
    "# research/181-tokens/rewrite.ts; nothing else is changed.",
  ].join("\n");

/** A cell as YAML flow: the label alone when that is all it has. */
function cell(node: Node, id: string | undefined, omit: string[] = []): string {
  const label = node.label ?? "";
  const quoted = /^[A-Za-z][A-Za-z ]*$/.test(label) ? label : `'${label.replaceAll("'", "''")}'`;
  const parts: string[] = [];
  if (id !== undefined) parts.push(`id: ${id}`);
  if (label !== "") parts.push(`label: ${quoted}`);
  if (node.tone !== undefined && !omit.includes("tone")) parts.push(`tone: ${node.tone}`);
  for (const size of ["width", "height"] as const) {
    const value = node.props?.[size];
    if (value !== undefined && !omit.includes(size)) parts.push(`${size}: ${value}`);
  }
  if (parts.length === 1 && label !== "" && id === undefined) return quoted;
  return `{ ${parts.join(", ")} }`;
}

function nodesOf(source: string): (id: string) => Node {
  const nodes = new Map((parse(source).nodes as Node[]).map((n) => [n.id, n]));
  return (id) => {
    const node = nodes.get(id);
    if (node === undefined) throw new Error(`no node ${id}`);
    return node;
  };
}

function editor(source: string) {
  let text = source;
  return {
    replace(from: string | RegExp, to: string) {
      const next = text.replace(from, to);
      if (next === text) throw new Error(`not found: ${from}`);
      text = next;
    },
    get text() {
      return text;
    },
  };
}

function h3world(): void {
  const source = readFileSync(
    join(ROOT, "research/167-stage-c/figures/c-h3world.sumi.yaml"),
    "utf8",
  );
  const get = nodesOf(source);
  const edit = editor(source);
  const seqIds = "static a1 a2 a3 a4 a5 adots i0 v1 v2 v3 v4 v5 vdots".split(" ");
  const btIds = "static a1 a2 a3 i0 v1 v2 v3 pad".split(" ");
  const ctIds = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  // Arrange trees: each key cluster, sequence and column becomes one item.
  edit.replace(
    /\{ row: \{ gap: 1\.5mm, items: \[ \{ stack: \{ gap: 0\.5mm, items: \[ (k\d)-w, \{ row: \{ gap: 0\.5mm, items: \[ \1-a, \1-s, \1-d \] \} \} \] \} \}, \{ stack: \{ gap: 0\.5mm, items: \[ \{ row: \{ gap: 0\.5mm, items: \[ \1-i, \1-f \] \} \}, \{ row: \{ gap: 0\.5mm, items: \[ \1-j, \1-k, \1-l \] \} \} \] \} \} \] \} \}/g,
    "{ row: { gap: 1.5mm, items: [ $1-move, $1-look ] } }",
  );
  edit.replace(
    `- row: { gap: 1.5pt, items: [ ${seqIds.map((c) => `seq-${c}`).join(", ")} ] }`,
    "- seq",
  );
  edit.replace(`- row: { gap: 1pt, items: [ ${btIds.map((c) => `bt-${c}`).join(", ")} ] }`, "- bt");
  edit.replace(
    `- stack: { gap: 1.5pt, items: [ ${ctIds.map((i) => `ct-${i}`).join(", ")} ] }`,
    "- ct",
  );
  // Align constraints and edges: cell references.
  edit.replace("{ y: [ action-heading, k0-s ] }", "{ y: [ action-heading, k0-move.3 ] }");
  edit.replace("{ y: [ seq-heading, seq-static ] }", "{ y: [ seq-heading, seq.static ] }");
  edit.replace("to: seq-a5 }", "to: seq.a5 }");
  edit.replace("to: seq-vdots,", "to: seq.vdots,");
  edit.replace("{ from: bt-a3,", "{ from: bt.a3,");
  edit.replace("{ from: ct-4, to: lora-in", "{ from: ct.5, to: lora-in");
  edit.replace("{ from: ct-4, to: qkv", "{ from: ct.5, to: qkv");

  // Nodes: drop the cells; the tokens nodes take the place of the first cell.
  const keys = (n: number) => {
    const line = (ids: string[]) =>
      `[${ids.map((k) => cell(get(`k${n}-${k}`), undefined, ["width", "height"])).join(", ")}]`;
    const props = "gap: 0.5mm, component: square, width: 8.5pt, height: 8.5pt";
    return [
      `  - { id: k${n}-move, component: tokens, props: { ${props}, lines: [ ${line(["w"])}, ${line(["a", "s", "d"])} ] } }`,
      `  - { id: k${n}-look, component: tokens, props: { ${props}, lines: [ ${line(["i", "f"])}, ${line(["j", "k", "l"])} ] } }`,
    ];
  };
  const sequence = (id: string, cells: string[], props: string[], width: string) => [
    `  - id: ${id}`,
    "    component: tokens",
    "    props:",
    ...props.map((p) => `      ${p}`),
    "      cells:",
    ...cells.map((c) => {
      const node = get(`${id}-${c}`);
      const omit = ["height", ...(node.props?.width === width ? ["width"] : [])];
      return `        - ${cell(node, c, omit)}`;
    }),
  ];
  const isCell = (id: string) =>
    /^k\d-[wasdifjkl]$/.test(id) ||
    /^ct-\d$/.test(id) ||
    seqIds.some((c) => id === `seq-${c}`) ||
    btIds.some((c) => id === `bt-${c}`);
  const out: string[] = [];
  for (const line of edit.text.split("\n")) {
    const id = /^ {2}- \{ id: ([a-z0-9-]+),/.exec(line)?.[1];
    if (id === undefined || !isCell(id)) {
      out.push(line);
      continue;
    }
    const k = /^k(\d)-w$/.exec(id);
    if (k) out.push(...keys(Number(k[1])));
    if (id === "seq-static")
      out.push(...sequence("seq", seqIds, ["gap: 1.5pt", "width: 20pt", "height: 14pt"], "20pt"));
    if (id === "bt-static")
      out.push(...sequence("bt", btIds, ["gap: 1pt", "width: 16pt", "height: 14pt"], "16pt"));
    if (id === "ct-0") {
      const cells = ctIds.map((i) => `{ tone: ${get(`ct-${i}`).tone} }`);
      out.push(
        `  - { id: ct, component: tokens, props: { direction: down, gap: 1.5pt, width: 9pt, height: 7pt, cells: [ ${cells.join(", ")} ] } }`,
      );
    }
  }
  const body = out.join("\n");
  writeFileSync(
    join(OUT, "c-h3world.sumi.yaml"),
    `${header("research/167-stage-c/figures/c-h3world.sumi.yaml (#167 figure C, H3-World)")}\n${body.slice(body.indexOf("version: 1"))}`,
  );
}

function vit(): void {
  const source = readFileSync(
    join(ROOT, "research/151-dogfood-v0.5/figures/vit-input.sumi.yaml"),
    "utf8",
  );
  const get = nodesOf(source);
  const edit = editor(source);
  edit.replace(
    /- row:\n {14}gap: 1\.5mm\n {14}items:\n(?: {16}- row: \{ gap: 0, items: \[ e\d, t\d \] \}\n){5}/,
    "- row: { gap: 1.5mm, items: [ tok0, tok1, tok2, tok3, tok4 ] }\n",
  );
  const tokens = [0, 1, 2, 3, 4].map(
    (i) =>
      `  - { id: tok${i}, component: tokens, props: { gap: 0, cells: [ ${cell(get(`e${i}`), "pos")}, ${cell(get(`t${i}`), "x")} ] } }`,
  );
  // The labels hold `$'`, a special pattern of a replacement string.
  const nodes = /(?: {2}- \{ id: e\d, .*\n){5}(?: {2}- \{ id: t\d, .*\n){5}/;
  edit.replace(nodes, `${tokens.join("\n").replaceAll("$", "$$$$")}\n`);
  for (const i of [0, 1, 2, 3, 4]) {
    edit.replace(new RegExp(`(\\{ from: | to: )t${i}([ ,])`, "g"), `$1tok${i}.x$2`);
  }
  writeFileSync(
    join(OUT, "vit-input.sumi.yaml"),
    `${header("research/151-dogfood-v0.5/figures/vit-input.sumi.yaml (#151, ViT input)")}\n${edit.text}`,
  );
}

h3world();
vit();
