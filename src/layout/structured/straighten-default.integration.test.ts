/**
 * `figure.layout.straighten` is the default (#620, design #620): `false` keeps the output of
 * the layout before the default changed, byte for byte. The hashes are of origin/main's output
 * (3375734b, before #620) of the same YAML, with the version and input attributes blanked.
 */

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { renderFigure } from "../../render/render";

const ROOT = join(import.meta.dir, "../../..");

const hash = (svg: string) =>
  createHash("sha256")
    .update(
      svg
        .replace(/input-sha256="[^"]*"/, "")
        .replace(/(sumi-version|backend-version)="[^"]*"/g, '$1=""'),
    )
    .digest("hex");

async function render(rel: string, straighten: "omit" | "false"): Promise<string> {
  const file = join(ROOT, rel);
  let text = await Bun.file(file).text();
  if (straighten === "false") {
    expect(text).toMatch(/^ {2}layout:\n/m);
    text = text.replace(/^ {2}layout:\n/m, "  layout:\n    straighten: false\n");
  }
  const result = await renderFigure(text, { assetBase: dirname(file) });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return hash(result.value.svg);
}

/** origin/main (before #620): these figures without `straighten`. */
const BEFORE = {
  "tests/fixtures/figures/color-use/train-infer-a.sumi.yaml":
    "19360ec2fb377cfc38bdb4ffa1002897d507cdd75884e973e5e9f48ee292c806",
  "tests/fixtures/figures/density/sparse-small-elements.sumi.yaml":
    "9454d35f3f17e89d8e25fc55a07693564fef3b2c6df240424853dcc9886bddd9",
} as const;

describe("figure.layout.straighten: false is the layout before #620", () => {
  test("train-infer-a (moves by default): false matches the old output, omitted does not", async () => {
    const rel = "tests/fixtures/figures/color-use/train-infer-a.sumi.yaml";
    expect(await render(rel, "false")).toBe(BEFORE[rel]);
    expect(await render(rel, "omit")).not.toBe(BEFORE[rel]);
  });

  test("sparse-small-elements: an end on a plain group does not slide, so the default keeps the old output", async () => {
    const rel = "tests/fixtures/figures/density/sparse-small-elements.sumi.yaml";
    expect(await render(rel, "false")).toBe(BEFORE[rel]);
    expect(await render(rel, "omit")).toBe(BEFORE[rel]);
  });
});
