/**
 * Which figures a strategy leaves byte-identical (the routed Layout IR equals
 * the product router's): the golden-compatibility question of #124 §8.
 *
 *   bun research/124-stage-b/route/same.ts sides-tree [more strategies…]
 */

import { join } from "node:path";
import { loadFile } from "./load";
import { STRATEGIES } from "./strategies";
import { loadVariantRouter } from "./variant";

const ROOT = join(import.meta.dir, "../../..");
const FILES = [
  "examples/transformer/transformer.sumi.yaml",
  "examples/dit-block/dit-block.sumi.yaml",
  "tests/fixtures/figures/layout/a-transformer.sumi.yaml",
  "tests/fixtures/figures/layout/b-adaln-panel.sumi.yaml",
  "research/109-dogfood-v0.4/figures/seq2seq-attention.sumi.yaml",
  "research/109-dogfood-v0.4/figures/training-pipeline.sumi.yaml",
  "research/109-dogfood-v0.4/figures/serving-architecture.sumi.yaml",
  "research/109-dogfood-v0.4/figures/unet-small.sumi.yaml",
];

const v = await loadVariantRouter();
for (const name of process.argv.slice(2)) {
  const strategy = STRATEGIES[name];
  if (strategy === undefined) throw new Error(`unknown strategy ${name}`);
  for (const file of FILES) {
    const fig = loadFile(join(ROOT, file));
    const product = JSON.stringify(STRATEGIES.product?.(fig.ir, fig.placed, v).layout);
    const other = JSON.stringify(strategy(fig.ir, fig.placed, v).layout);
    console.log(`${name}\t${file}\t${product === other ? "identical" : "differs"}`);
  }
}
