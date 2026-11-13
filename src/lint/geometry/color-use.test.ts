import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { BUILTIN_THEMES, getTheme } from "../../core/theme/builtin";
import { buildThemeCatalog } from "../../core/theme/catalog";
import { renderFigure } from "../../render";
import { themeColorUse } from "./color-use";
import { geometryContextFor } from "./lint";

const fixture = (name: string) =>
  readFileSync(
    new URL(`../../../tests/fixtures/figures/color-use/${name}.sumi.yaml`, import.meta.url),
    "utf8",
  );

async function findingsOf(source: string) {
  const result = await renderFigure(source);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return themeColorUse.run(geometryContextFor(result.value), undefined);
}

describe("geometry/theme-color-use (#513): the dogfood figures of #509", () => {
  test("1A (28 filled/solid blocks, 3 tones) is flagged for its blocks of color", async () => {
    const findings = await findingsOf(fixture("vit-block-a"));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toMatch(/of the node area is a block of color/);
    expect(findings[0]?.hint).toMatch(/filled \/ solid to tinted/);
  });

  test("4A (92% filled, 4 tones) is flagged for blocks and for its tones, naming them", async () => {
    const findings = await findingsOf(fixture("train-infer-a"));
    expect(findings).toHaveLength(2);
    const tones = findings.find((f) => f.message.includes("accent tones"));
    expect(tones?.message).toContain("blue, orange, purple, red");
    expect(tones?.hint).toMatch(
      /Keep blue, orange, purple .*change red \(node "t-loss"\) to tone gray/,
    );
    expect(findings.every((f) => f.severity === undefined)).toBe(true);
  });

  test.each(["vit-block-b", "train-infer-b", "rag-compare-a"])(
    "%s is not flagged",
    async (name) => {
      expect(await findingsOf(fixture(name))).toEqual([]);
    },
  );
});

describe("theme color guidance (#513)", () => {
  test("sumi and sumi-dark carry it; the other themes leave it unset", () => {
    for (const [id, theme] of BUILTIN_THEMES) {
      expect(theme.colorUse !== undefined, id).toBe(id === "sumi" || id === "sumi-dark");
    }
    expect(getTheme("sumi")?.colorUse?.heavyVariants).toEqual(["filled", "solid"]);
  });

  test("the catalog lists it, null for a theme without", () => {
    const entries = buildThemeCatalog();
    expect(entries.find((e) => e.id === "sumi")?.colorUse?.maxAccentTones).toBe(3);
    expect(entries.find((e) => e.id === "minimal")?.colorUse).toBeNull();
  });

  test("a theme without guidance reports nothing", async () => {
    const source = fixture("train-infer-a").replace("theme: sumi", "theme: minimal");
    expect(await findingsOf(source)).toEqual([]);
  });
});
