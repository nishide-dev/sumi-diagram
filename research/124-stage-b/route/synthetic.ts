/**
 * The synthetic 100-node figures of the router tests
 * (`src/layout/route/router.test.ts`, `synthetic()`), copied verbatim because
 * the test file does not export them. `bench.ts` checks the copies still
 * route to the edge counts the design doc records (129 and 146 edges).
 */

import { stringify } from "yaml";

export function synthetic(kind: "columns" | "grid"): string {
  let seed = kind === "columns" ? 12345 : 7;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const nodes: unknown[] = [];
  const edges: unknown[] = [];
  const label = (text: string, max: number) => `${text}${"x".repeat(Math.floor(rand() * max))}`;
  if (kind === "columns") {
    const groups: { id: string; arrange: unknown }[] = [];
    for (let c = 0; c < 5; c++) {
      const items: string[] = [];
      for (let r = 0; r < 20; r++) {
        const id = `n${c}-${r}`;
        items.push(id);
        nodes.push({ id, component: "box", label: label(`Block ${c}.${r}`, 8) });
        if (r > 0) edges.push({ from: `n${c}-${r - 1}`, to: id });
        if (r > 2 && rand() < 0.2) edges.push({ from: `n${c}-${r - 3}`, to: id, toAnchor: "west" });
      }
      groups.push({ id: `g${c}`, arrange: { stack: { gap: "4mm", items } } });
      for (let k = 0; c > 0 && k < 4; k++) {
        const a = Math.floor(rand() * 20);
        const b = Math.floor(rand() * 20);
        edges.push({ from: `n${c - 1}-${a}`, to: `n${c}-${b}` });
      }
    }
    const arrange = { row: { gap: "8mm", items: groups.map((g) => g.id) } };
    return stringify({
      version: 1,
      figure: { id: "s", profile: "paper-double", layout: { arrange } },
      groups,
      nodes,
      edges,
    });
  }
  const stacks: unknown[] = [];
  for (let c = 0; c < 10; c++) {
    const items: string[] = [];
    for (let r = 0; r < 10; r++) {
      items.push(`n${c}-${r}`);
      nodes.push({ id: `n${c}-${r}`, component: "box", label: label(`B${c}.${r}`, 6) });
    }
    stacks.push({ stack: { gap: "6mm", items } });
  }
  for (let k = 0; k < 150; k++) {
    const a = `n${Math.floor(rand() * 10)}-${Math.floor(rand() * 10)}`;
    const b = `n${Math.floor(rand() * 10)}-${Math.floor(rand() * 10)}`;
    if (a !== b) edges.push({ from: a, to: b });
  }
  const arrange = { row: { gap: "6mm", items: stacks } };
  return stringify({
    version: 1,
    figure: { id: "s", profile: "paper-double", layout: { arrange } },
    nodes,
    edges,
  });
}
