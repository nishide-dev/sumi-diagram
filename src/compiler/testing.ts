/**
 * Test support for the compiler: golden fixtures and a figure exercising
 * lowering paths that the built-in components and themes do not reach
 * (backward edges, custom arrowheads, mono / italic text, unfilled arrowheads).
 * Not part of the public API.
 */

import { join } from "node:path";
import { z } from "zod";
import type { ElementKey } from "../core/check-state";
import { createBuiltinRegistry } from "../core/registry/builtins";
import type { EdgeManifest } from "../core/registry/manifest";
import type { ResolvedStyle } from "../core/theme/style";
import { compileFigure } from "./compile";
import { type ElementIR, type FigureIR, readonlyMap } from "./ir";

export const FIXTURES_DIR = join(import.meta.dir, "..", "..", "tests", "fixtures");

export interface GoldenCase {
  name: string;
  /** Path of the `.sumi.yaml` input. */
  input: string;
  /** Path of the expected `.d2` output. */
  expected: string;
}

/** Every valid figure fixture, with its expected D2 source under `tests/fixtures/d2`. */
export function goldenCases(): GoldenCase[] {
  const cases: GoldenCase[] = [];
  for (const dir of ["figures/valid", "compile"]) {
    const glob = new Bun.Glob("*.sumi.yaml");
    for (const file of [...glob.scanSync(join(FIXTURES_DIR, dir))].sort()) {
      const name = file.replace(/\.sumi\.yaml$/, "");
      cases.push({
        name,
        input: join(FIXTURES_DIR, dir, file),
        expected: join(FIXTURES_DIR, "d2", `${name}.d2`),
      });
    }
  }
  return cases;
}

const testEdge = (name: string, arrows: Pick<EdgeManifest, "direction" | "head" | "tail">) =>
  ({
    version: 1,
    kind: "edge",
    namespace: "test",
    name,
    description: `Test edge ${name}.`,
    variants: ["default"],
    props: z.strictObject({}),
    since: "0.1.0",
    ...arrows,
  }) satisfies EdgeManifest;

const EXTRA_SOURCE = `version: 1
figure:
  id: extras
nodes:
  - { id: plain, component: box, label: plain }
  - { id: styled, component: box, label: mono italic }
edges:
  - { from: plain, to: styled, component: test/back, label: back }
  - { from: plain, to: styled, component: test/open, label: open }
  - { from: styled, to: plain, component: test/mixed }
`;

/**
 * A compiled figure with custom edges (`test/back`: backward with the default
 * arrowhead, `test/open`: forward with `arrow`, `test/mixed`: both with
 * `diamond` / `circle`) and styles patched to use mono, italic, bold and
 * unfilled arrowheads.
 */
export function extrasFigure(): FigureIR {
  const registry = createBuiltinRegistry();
  for (const manifest of [
    testEdge("back", { direction: "backward" }),
    testEdge("open", { direction: "forward", head: "arrow" }),
    testEdge("mixed", { direction: "both", head: "diamond", tail: "circle" }),
  ]) {
    const registered = registry.register(manifest);
    if (!registered.ok) throw new Error(JSON.stringify(registered.diagnostics));
  }
  const result = compileFigure(EXTRA_SOURCE, { registry });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return withStyles(result.value.ir, {
    "n:styled": { mono: true, italic: true, fill: "transparent" },
    "e:#1": { mono: true, bold: true, filled: false },
    "e:#2": { opacity: 0.5, filled: false },
  });
}

/** Returns a copy of the IR with some element styles overridden. */
export function withStyles(
  ir: FigureIR,
  patches: Partial<Record<ElementKey, Partial<Record<string, unknown>>>>,
): FigureIR {
  const patch = <T extends ElementIR>(element: T): T => {
    const overrides = patches[element.key];
    if (overrides === undefined) return element;
    return { ...element, style: { ...element.style, ...overrides } as ResolvedStyle } as T;
  };
  const groups = ir.groups.map(patch);
  const nodes = ir.nodes.map(patch);
  const edges = ir.edges.map(patch);
  const elements = readonlyMap<ElementKey, ElementIR>(
    [...groups, ...nodes, ...edges].map((e) => [e.key, e]),
  );
  return { ...ir, groups, nodes, edges, elements };
}
