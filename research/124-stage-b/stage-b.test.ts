/**
 * Checks of the #124 prototypes (no network, no D2). The patched copies of the
 * product router and engine are pinned to the product source they were
 * written against (README "Pinned base"); if a later product change moves a
 * patch target, the tests that need the copies are skipped, not failed, so
 * research code never blocks product work. The drafts' lowering does not
 * depend on the copies and always runs.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import semver from "semver";
import { checkFigure } from "../../src/core/check";
import { layoutStructured } from "../../src/layout/structured/engine";
import { engineSource, loadEngineCopy, solveAlignment } from "./align/solve";
import { lower } from "./lower";
import { loadFile, loadText } from "./route/load";
import { STRATEGIES } from "./route/strategies";
import { loadVariantRouter, variantSources } from "./route/variant";

const FIG = join(import.meta.dir, "figures");
const ROOT = join(import.meta.dir, "../..");
const drafts = readdirSync(FIG).filter((f) => f.endsWith(".sumi.yaml"));

/**
 * Whether the patched copies can be built: `false` only when a patch target
 * no longer matches the product source (expected drift after the pinned
 * base); any other error is a bug in the prototype and fails the run.
 */
const applies = (build: () => unknown) => {
  try {
    build();
    return true;
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("patch target found")) {
      console.warn(`#124 prototype tests skipped: ${e.message}`);
      return false;
    }
    throw e;
  }
};
/**
 * The drafts declare `requires: ">=0.5.0"`; while the product is older they
 * must stop at that check. From 0.5.0 on the check is retired (the drafts
 * then document the syntax as shipped or not, see the doc §5).
 */
const beforeStageB = semver.lt(
  (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string }).version,
  "0.5.0",
);
const routerPatched = applies(variantSources);
const enginePatched = applies(engineSource);

describe("stage-B drafts", () => {
  test.each(drafts)("%s lowers to a figure v0.4.1 accepts without diagnostics", (file) => {
    const lowered = lower(readFileSync(join(FIG, file), "utf8"));
    expect(checkFigure(lowered.text).state.diagnostics).toEqual([]);
  });

  test.if(beforeStageB).each(drafts)("%s as written stops at requires >=0.5.0", (file) => {
    const codes = checkFigure(readFileSync(join(FIG, file), "utf8")).state.diagnostics.map(
      (d) => d.code,
    );
    expect(codes).toEqual(["schema/unsatisfied-requires"]);
  });
});

describe.if(routerPatched)("router variant", () => {
  test("without hooks it routes exactly like the product router", async () => {
    const v = await loadVariantRouter();
    for (const file of [
      "examples/transformer/transformer.sumi.yaml",
      "examples/dit-block/dit-block.sumi.yaml",
      "research/109-dogfood-v0.4/figures/serving-architecture.sumi.yaml",
    ]) {
      const fig = loadFile(join(ROOT, file));
      const product = STRATEGIES.product?.(fig.ir, fig.placed, v).layout;
      const variant = STRATEGIES["variant-identity"]?.(fig.ir, fig.placed, v).layout;
      expect(JSON.stringify(variant)).toBe(JSON.stringify(product));
    }
  });

  test("sides from the arrange tree leave the examples unchanged", async () => {
    const v = await loadVariantRouter();
    for (const file of [
      "examples/transformer/transformer.sumi.yaml",
      "examples/dit-block/dit-block.sumi.yaml",
    ]) {
      const fig = loadFile(join(ROOT, file));
      const product = STRATEGIES.product?.(fig.ir, fig.placed, v).layout;
      const sides = STRATEGIES["sides-tree"]?.(fig.ir, fig.placed, v).layout;
      expect(JSON.stringify(sides)).toBe(JSON.stringify(product));
    }
  });
});

describe.if(enginePatched)("alignment by struts", () => {
  test("without struts the engine copy lays out exactly like the product engine", async () => {
    const copy = await loadEngineCopy();
    const fig = loadFile(join(ROOT, "examples/transformer/transformer.sumi.yaml"));
    expect(JSON.stringify(copy.layoutStructured(fig.ir))).toBe(
      JSON.stringify(layoutStructured(fig.ir)),
    );
  });

  test.each(["unet-small", "seq2seq-attention.side-kv"])(
    "%s: every constraint is met",
    async (name) => {
      const lowered = lower(readFileSync(join(FIG, `${name}.sumi.yaml`), "utf8"));
      const fig = loadText(lowered.text, FIG);
      const solved = await solveAlignment(fig.ir, lowered.align);
      expect(lowered.align.length).toBeGreaterThan(0);
      expect(solved.residual).toBe(0);
    },
  );

  test("stops on the largest residual, not the sum (many met constraints and one unmet)", async () => {
    const lowered = lower(readFileSync(join(FIG, "unet-small.sumi.yaml"), "utf8"));
    const fig = loadText(lowered.text, FIG);
    const met = Array.from({ length: 100 }, () => ({
      axis: "y" as const,
      items: ["enc1", "enc1"],
    }));
    const solved = await solveAlignment(fig.ir, [...met, ...lowered.align]);
    expect(solved.residual).toBe(0);
  });

  test("never separates the items of a gap: 0 box", async () => {
    const lowered = lower(readFileSync(join(FIG, "seq2seq-attention.side-kv.sumi.yaml"), "utf8"));
    const fig = loadText(lowered.text, FIG);
    const solved = await solveAlignment(fig.ir, lowered.align);
    const rect = (id: string) => solved.layout.nodes.find((n) => n.key === `n:${id}`)?.rect;
    for (const [lower_, upper] of [
      ["dec-cross", "dec-norm2"],
      ["dec-self", "dec-norm1"],
      ["enc-ffn", "enc-norm2"],
    ] as const) {
      const a = rect(upper);
      const b = rect(lower_);
      expect(a && b && Math.abs(a.y + a.height - b.y)).toBeLessThan(0.001);
    }
  });
});
