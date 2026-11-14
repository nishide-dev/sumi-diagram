import { describe, expect, test } from "bun:test";
import { getTheme } from "./builtin";
import { deltaE, toOklch } from "./color-math";
import { MIN_OVERLAP_DELTA_E, mixTints } from "./set-style";

test("perceptual overlap mixing is symmetric for three tints and keeps their average lightness", () => {
  const colors = ["#c9e2f5", "#d1ead5", "#f1d6d9"];
  const mixed = mixTints(colors);
  expect(mixTints([...colors].reverse())).toBe(mixed);
  const average = colors.reduce((sum, c) => sum + toOklch(c).l, 0) / colors.length;
  expect(toOklch(mixed).l).toBeCloseTo(average, 2);
  const dark = ["#36455a", "#435449", "#54434c"];
  const darkAverage = dark.reduce((sum, c) => sum + toOklch(c).l, 0) / dark.length;
  // Dark tints this close are deepened (lighter on a dark canvas, #547) by at most 0.08.
  expect(toOklch(mixTints(dark, "#171b22")).l).toBeGreaterThanOrEqual(darkAverage - 0.005);
  expect(toOklch(mixTints(dark, "#171b22")).l).toBeLessThanOrEqual(darkAverage + 0.081);
});

import { resolveStyle } from "./resolve";
import { multiplyTints, resolveSetStyle, SET_FILL_OPACITY, tintOver } from "./set-style";

describe("set tints are opaque (#440)", () => {
  test("dark canvas sets and their overlap stay dark and distinguishable", () => {
    const theme = getTheme("sumi-dark");
    if (!theme) throw new Error("missing theme");
    const blue = resolveSetStyle(theme, { variant: "default", tone: "blue" });
    const green = resolveSetStyle(theme, { variant: "default", tone: "green" });
    const overlap = multiplyTints([blue.fill, green.fill], theme.canvas);
    expect(toOklch(blue.fill).l).toBeLessThan(toOklch(blue.fontColor).l - 0.3);
    expect(toOklch(overlap).l).toBeGreaterThan(toOklch(blue.fill).l);
    expect(toOklch(overlap).l).toBeLessThan(toOklch(blue.fontColor).l - 0.2);
  });
  test("tintOver mixes the ink into white: 0 is white, 1 is the ink", () => {
    expect(tintOver("#000000", 0)).toBe("#ffffff");
    expect(tintOver("#102030", 1)).toBe("#102030");
    // 20% of black over white is what 20% opacity black looks like on a white page.
    expect(tintOver("#000000", 0.2)).toBe("#cccccc");
    expect(tintOver("#31608e", 0.2)).toBe(tintOver("#31608e", 0.2).toLowerCase());
  });

  test("a color that is not hex is left alone", () => {
    expect(tintOver("transparent", 0.2)).toBe("transparent");
  });

  test("multiplyTints is the product relative to white", () => {
    expect(multiplyTints(["#ffffff", "#ffffff"])).toBe("#ffffff");
    expect(multiplyTints(["#808080", "#ffffff"])).toBe("#808080");
    expect(multiplyTints(["#ff0000", "#00ff00"])).toBe("#000000");
    const product = multiplyTints(["#dde5ee", "#ddeae3"]);
    // Darker than both, and still tinted (a gray-brown stack of alphas would not be).
    expect(toOklch(product).l).toBeLessThan(toOklch("#dde5ee").l);
    expect(toOklch(product).c).toBeGreaterThan(0.015);
  });

  test("a default set's fill is an opaque pale color whose opacity is gone from the style", () => {
    const theme = getTheme("paper");
    if (theme === undefined) throw new Error("no paper theme");
    const style = resolveSetStyle(theme, { variant: "default", tone: "blue" });
    const ink = theme.toneLines.get("blue")?.stroke ?? "";
    expect(style.fill).toBe(tintOver(ink, SET_FILL_OPACITY.default));
    expect(style.fill).toMatch(/^#[0-9a-f]{6}$/);
    expect(style.strength).toBe(SET_FILL_OPACITY.default);
    expect("fillOpacity" in style).toBe(false);
  });

  test("fillOpacity is the strength of the tint; outlined has none", () => {
    const theme = getTheme("paper");
    if (theme === undefined) throw new Error("no paper theme");
    const weak = resolveSetStyle(theme, { variant: "default", tone: "green", fillOpacity: 0.1 });
    const strong = resolveSetStyle(theme, { variant: "default", tone: "green", fillOpacity: 0.5 });
    expect(toOklch(strong.fill).l).toBeLessThan(toOklch(weak.fill).l);
    const outlined = resolveSetStyle(theme, { variant: "outlined", tone: "green" });
    expect(outlined.fill).toBe("transparent");
    expect(outlined.strength).toBe(0);
  });
});

describe("the paper theme's panels (#440)", () => {
  const fillOf = (variant: string) => {
    const theme = getTheme("paper");
    if (theme === undefined) throw new Error("no paper theme");
    return resolveStyle(theme, { kind: "group", id: "sumi/container", variant }).style.fill;
  };

  test("the default group is white, with its frame", () => {
    const theme = getTheme("paper");
    if (theme === undefined) throw new Error("no paper theme");
    const style = resolveStyle(theme, {
      kind: "group",
      id: "sumi/container",
      variant: "default",
    }).style;
    expect(style.fill).toBe("#ffffff");
    expect(style.strokeWidth.units).toBeGreaterThan(0);
  });

  test("gray panels are asked for: variant filled stays gray", () => {
    expect(fillOf("filled")).toBe("#f3f3f5");
  });
});

test("a three-way overlap differs from every tint in it, on light and dark canvases (#547)", () => {
  // The plain average lands on the purple tint (deltaE 0.4 before #547).
  const light = ["#d8dfe4", "#d9e0da", "#dfdce4"];
  expect(deltaE(mixTints(light, "#ffffff"), light[2] as string)).toBeGreaterThanOrEqual(
    MIN_OVERLAP_DELTA_E,
  );
  const dark = ["#36455a", "#435449", "#3b4560"];
  for (const color of dark)
    expect(deltaE(mixTints(dark, "#171b22"), color)).toBeGreaterThanOrEqual(MIN_OVERLAP_DELTA_E);
  // The deepening goes away from the canvas.
  expect(toOklch(mixTints(light, "#ffffff")).l).toBeLessThan(toOklch(light[2] as string).l);
  expect(toOklch(mixTints(dark, "#171b22")).l).toBeGreaterThan(toOklch(dark[0] as string).l);
});

test("two tints are the plain average (#505)", () => {
  const pair = ["#c9e2f5", "#d1ead5"];
  const mixed = mixTints(pair);
  expect(toOklch(mixed).l).toBeCloseTo(
    (toOklch(pair[0] as string).l + toOklch(pair[1] as string).l) / 2,
    2,
  );
});

test("identical tints are separated by moving the overlap, and the guarantee is best effort at the gamut's edge (#547)", () => {
  const same = ["#d8dfe4", "#d8dfe4", "#d8dfe4"];
  expect(deltaE(mixTints(same), same[0] as string)).toBeGreaterThanOrEqual(MIN_OVERLAP_DELTA_E);
  // White tints on a white canvas cannot go lighter; the other direction is tried.
  const white = ["#ffffff", "#ffffff", "#ffffff"];
  expect(deltaE(mixTints(white, "#000000"), "#ffffff")).toBeGreaterThanOrEqual(MIN_OVERLAP_DELTA_E);
  // Within the cap at most; never an exception, and still a valid color.
  const black = ["#000000", "#000000", "#000000"];
  expect(mixTints(black, "#000000")).toMatch(/^#[0-9a-f]{6}$/);
  expect(deltaE(mixTints(black, "#000000"), "#000000")).toBeGreaterThan(0);
});
