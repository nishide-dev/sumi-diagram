import { describe, expect, test } from "bun:test";
import { getTheme } from "./builtin";
import { cuboidColors, cuboidShadeOf, mixColors } from "./cuboid-shade";

const theme = (id: string) => {
  const found = getTheme(id);
  if (!found) throw new Error(`no theme ${id}`);
  return found;
};

describe("cuboid face shading", () => {
  test("mixColors moves a fraction of the way", () => {
    expect(mixColors("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixColors("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mixColors("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  test("a light theme lights the top toward white (0.55) and darkens the side toward the frame (0.20)", () => {
    const shade = cuboidShadeOf(theme("sumi"));
    expect(shade.top).toEqual({ toward: "#ffffff", amount: 0.55 });
    expect(shade.side).toEqual({ toward: "line", amount: 0.2 });
    // The blue tone of sumi: fill #d9e4e6, frame #3d5d77.
    const colors = cuboidColors("#d9e4e6", "#3d5d77", shade);
    expect(colors?.top).toBe(mixColors("#d9e4e6", "#ffffff", 0.55));
    expect(colors?.side).toBe(mixColors("#d9e4e6", "#3d5d77", 0.2));
    expect(colors?.inner).toBe(mixColors("#3d5d77", "#d9e4e6", 0.55));
  });

  test("sumi-dark lights the top toward the frame (0.22) and darkens the side toward #1c2033 (0.35)", () => {
    const shade = cuboidShadeOf(theme("sumi-dark"));
    expect(shade.top).toEqual({ toward: "line", amount: 0.22 });
    expect(shade.side).toEqual({ toward: "#1c2033", amount: 0.35 });
    const colors = cuboidColors("#3e5068", "#b9d0e5", shade);
    expect(colors?.top).toBe(mixColors("#3e5068", "#b9d0e5", 0.22));
    expect(colors?.side).toBe(mixColors("#3e5068", "#1c2033", 0.35));
    // The top is lighter and the side darker than the front.
    const lum = (hex: string) => Number.parseInt(hex.slice(1, 3), 16);
    expect(lum(colors?.top ?? "")).toBeGreaterThan(lum("#3e5068"));
    expect(lum(colors?.side ?? "")).toBeLessThan(lum("#3e5068"));
  });

  test("a theme that writes no factors gets the light or dark default from its canvas", () => {
    const light = cuboidShadeOf({ canvas: "#ffffff" });
    expect(light.top.toward).toBe("#ffffff");
    const dark = cuboidShadeOf({ canvas: "#30364f" });
    expect(dark.top).toEqual({ toward: "line", amount: 0.22 });
    expect(dark.side.toward).toMatch(/^#[0-9a-f]{6}$/);
    // A theme's own factors win.
    const own = { top: { toward: "line", amount: 0.1 }, side: { toward: "line", amount: 0.3 } };
    expect(cuboidShadeOf({ canvas: "#ffffff", cuboidShade: own })).toEqual(own);
  });

  test("a fill that is not a color has no shades", () => {
    expect(
      cuboidColors("transparent", "#000000", cuboidShadeOf({ canvas: "#ffffff" })),
    ).toBeUndefined();
  });
});
