import { expect, test } from "bun:test";
import { getProfile } from "../profile/builtin";
import { BUILTIN_THEMES, getTheme } from "./builtin";
import { buildThemeCatalog } from "./catalog";
import { scaleFontSize, scaleLineWidth, scaleToReach, withTextScale } from "./text-scale";

const sumi = getTheme("sumi");
if (!sumi) throw new Error("missing sumi theme");

test("scales font sizes, lines and radii of every layer and keeps colors", () => {
  const scaled = withTextScale(sumi, 2);
  expect(scaled.base.node.fontSize?.pt).toBe(16);
  expect(scaled.base.group.fontSize?.pt).toBe(18);
  expect(scaled.base.edge.fontSize?.pt).toBe(14);
  expect(scaled.base.node.strokeWidth?.pt).toBe(2);
  expect(scaled.base.node.stroke).toBe(sumi.base.node.stroke);
  expect(scaled.canvas).toBe(sumi.canvas);
  for (const [id, variants] of sumi.components)
    for (const [variant, layer] of variants) {
      const next = scaled.components.get(id)?.get(variant);
      if (layer.fontSize) expect(next?.fontSize?.pt).toBe(layer.fontSize.pt * 2);
      if (layer.strokeWidth) expect(next?.strokeWidth?.pt).toBe(layer.strokeWidth.pt * 2);
      expect(next?.fill).toBe(layer.fill);
    }
  // The original theme is untouched.
  expect(sumi.base.node.fontSize?.pt).toBe(8);
});

test("rounds to 0.5pt, keeps borderless lines borderless and stays in range", () => {
  expect(scaleFontSize({ pt: 7, units: 14 }, 1.75).pt).toBe(12.5);
  expect(scaleFontSize({ pt: 20, units: 40 }, 4).pt).toBe(50);
  expect(scaleFontSize({ pt: 7, units: 14 }, 0.5).pt).toBe(4);
  expect(scaleLineWidth({ pt: 1, units: 2 }, 1.75).pt).toBe(2);
  expect(scaleLineWidth({ pt: 0, units: 0 }, 3).pt).toBe(0);
  expect(scaleLineWidth({ pt: 0.5, units: 1 }, 0.5).pt).toBe(0.5);
  expect(scaleLineWidth({ pt: 4, units: 8 }, 4).pt).toBe(7.5);
});

test("scaleToReach finds the smallest 0.25 step, sublabels included", () => {
  expect(scaleToReach(7, 14, false)).toBe(2);
  expect(scaleToReach(8, 14, false)).toBe(1.75);
  expect(scaleToReach(8, 14, true)).toBe(2);
  expect(scaleToReach(7, 100, false)).toBeUndefined();
});

test("the theme catalog lists the text scale each profile needs", () => {
  const entries = Object.fromEntries(buildThemeCatalog().map((entry) => [entry.id, entry]));
  expect(entries.sumi?.textScaleFor).toEqual({ "screen-doc": 1.5, "presentation-16x9": 2 });
  // `slides` meets every profile; the paper themes meet the paper profiles.
  expect(entries.slides?.textScaleFor).toEqual({});
  for (const entry of Object.values(entries))
    for (const profile of Object.keys(entry.textScaleFor))
      expect(entry.compatibleProfiles).not.toContain(profile);
  expect(BUILTIN_THEMES.size).toBe(Object.keys(entries).length);
});

test("screen-doc is sized for sumi text at 1.5", () => {
  const profile = getProfile("screen-doc");
  expect(profile?.typography.minFontSize.pt).toBe(10);
  expect(profile?.page.maxWidth?.pt).toBeCloseTo(566.93, 1);
  const scaled = withTextScale(sumi, 1.5);
  const sizes = [...scaled.components.values()].flatMap((variants) =>
    [...variants.values()].map((layer) => layer.fontSize?.pt ?? 99),
  );
  expect(Math.min(...sizes)).toBeGreaterThanOrEqual(10);
});

test("the JSON Schema states the same step as the validator", async () => {
  const schema = JSON.parse(await Bun.file("schema/figure.v1.schema.json").text());
  const field = schema.properties.figure.properties.themeOverrides.properties.textScale;
  expect(field).toMatchObject({ minimum: 0.5, maximum: 4, multipleOf: 0.25 });
});
