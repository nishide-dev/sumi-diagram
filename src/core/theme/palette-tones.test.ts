import { describe, expect, test } from "bun:test";
import { getTheme } from "./builtin";
import {
  COLOR_VISION,
  type ColorVision,
  deltaE,
  deltaEUnder,
  lightness,
  toOklch,
} from "./color-math";
import { contrastRatio } from "./node-variants";
import { figureTheme } from "./overrides";
import { BUILTIN_PALETTES, type Palette, withPalette } from "./palette";
import { type DerivedTone, deriveTones, GRAY_SEPARATION, TONE_HUES } from "./palette-tones";

const palettes = [...BUILTIN_PALETTES.values()];
const tones = Object.keys(TONE_HUES) as DerivedTone[];
const views = Object.keys(COLOR_VISION) as ColorVision[];
const WHITE = "#ffffff";

/** Pairs of tones. */
const pairs = tones.flatMap((a, i) =>
  tones.slice(i + 1).map((b): [DerivedTone, DerivedTone] => [a, b]),
);

/** The shortest distance between two hues in degrees. */
const hueGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

describe("derived tones (#423)", () => {
  test("every palette derives the seven tones other than gray, as lowercase hex", () => {
    for (const palette of palettes) {
      expect(Object.keys(palette.tones)).toEqual(tones);
      for (const { fill, line } of Object.values(palette.tones)) {
        expect(fill).toMatch(/^#[0-9a-f]{6}$/);
        expect(line).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  test("the derivation is a pure function of the palette's roles", () => {
    for (const { roles, tones: derived } of palettes) {
      expect(deriveTones(roles)).toEqual(derived);
    }
  });

  test("each tone keeps its own hue: blue stays blue (within 14 degrees of its nominal hue)", () => {
    for (const { id, tones: derived } of palettes) {
      for (const tone of tones) {
        for (const kind of ["fill", "line"] as const) {
          const { h } = toOklch(derived[tone][kind]);
          expect(
            hueGap(h, TONE_HUES[tone]),
            `${id} ${tone} ${kind} hue ${h.toFixed(0)}`,
          ).toBeLessThanOrEqual(14);
        }
      }
    }
  });

  test("hues keep their order around the wheel and stay 25 degrees apart", () => {
    for (const { id, tones: derived } of palettes) {
      const hues = tones.map((t) => toOklch(derived[t].line).h);
      for (let i = 0; i < tones.length; i++) {
        const next = (i + 1) % tones.length;
        const gap = ((hues[next] as number) - (hues[i] as number) + 360) % 360;
        // red 25, orange 62, yellow 100, green 145, blue 255, purple 305, pink 350, back to red.
        expect(gap, `${id} ${tones[i]}-${tones[next]}`).toBeGreaterThanOrEqual(25);
      }
    }
  });

  test("fills share the palette's lightness and chroma; lines share its strong color's", () => {
    for (const { id, roles, tones: derived } of palettes) {
      const tint = toOklch(roles.tint);
      const strong = toOklch(roles.strong);
      for (const tone of tones) {
        const fill = toOklch(derived[tone].fill);
        const line = toOklch(derived[tone].line);
        // Lightness: the tint's, moved a little to tell tones apart and to let the ink read.
        expect(Math.abs(fill.l - tint.l), `${id} ${tone} fill L`).toBeLessThanOrEqual(0.12);
        expect(Math.abs(line.l - strong.l), `${id} ${tone} line L`).toBeLessThanOrEqual(0.14);
        // Chroma: muted, never neon and never gray.
        expect(fill.c, `${id} ${tone} fill C`).toBeGreaterThanOrEqual(0.045);
        expect(fill.c, `${id} ${tone} fill C`).toBeLessThanOrEqual(0.105);
        expect(line.c, `${id} ${tone} line C`).toBeGreaterThanOrEqual(0.07);
        expect(line.c, `${id} ${tone} line C`).toBeLessThanOrEqual(0.15);
      }
      // The fills of all tones are within a few L* of each other: they read as one family.
      const L = tones.map((t) => lightness(derived[t].fill));
      expect(Math.max(...L) - Math.min(...L), `${id} fill L* spread`).toBeLessThanOrEqual(16);
    }
  });

  test("a rich palette gives richer tones than a muted one", () => {
    const chroma = (id: string) => {
      const palette = BUILTIN_PALETTES.get(id) as Palette;
      return toOklch(palette.tones.blue.fill).c;
    };
    expect(chroma("cyan-pink")).toBeGreaterThan(chroma("slate"));
    expect(chroma("coral")).toBeGreaterThan(chroma("sage"));
  });

  test("text keeps the contrast of theme/low-contrast (4.5:1): lines on white and the panel, the ink on fills", () => {
    for (const { id, roles, tones: derived } of palettes) {
      for (const tone of tones) {
        const { fill, line } = derived[tone];
        const at = (what: string, a: string, b: string) =>
          expect(contrastRatio(a, b), `${id} ${tone} ${what}`).toBeGreaterThanOrEqual(4.5);
        at("white on line (solid)", WHITE, line);
        at("line on panel (outlined text)", line, roles.panel);
        at("ink on fill", roles.ink, fill);
      }
    }
  });

  test("tones stay apart: pairwise CIE76 distance of fills at least 12 and of lines at least 18", () => {
    for (const { id, tones: derived } of palettes) {
      for (const [a, b] of pairs) {
        expect(
          deltaE(derived[a].fill, derived[b].fill),
          `${id} ${a}-${b} fill`,
        ).toBeGreaterThanOrEqual(12);
        expect(
          deltaE(derived[a].line, derived[b].line),
          `${id} ${a}-${b} line`,
        ).toBeGreaterThanOrEqual(18);
      }
    }
  });

  test("a tone of the palette's own hue is still told from the gray tone (the tint and the strong color)", () => {
    for (const { id, roles, tones: derived } of palettes) {
      for (const tone of tones) {
        expect(
          deltaE(derived[tone].fill, roles.tint),
          `${id} ${tone} fill-gray`,
        ).toBeGreaterThanOrEqual(GRAY_SEPARATION);
        expect(
          deltaE(derived[tone].line, roles.strong),
          `${id} ${tone} line-gray`,
        ).toBeGreaterThanOrEqual(GRAY_SEPARATION);
      }
    }
  });

  test("grayscale: a line stays at least 20 L* darker than its own fill, and every line is dark (L* under 55)", () => {
    for (const { id, tones: derived } of palettes) {
      for (const tone of tones) {
        const { fill, line } = derived[tone];
        expect(lightness(fill) - lightness(line), `${id} ${tone}`).toBeGreaterThanOrEqual(20);
        expect(lightness(line), `${id} ${tone} line L*`).toBeLessThan(55);
      }
    }
  });

  test("color vision: a line stays apart from its own fill (CIE76 20), and no two tones collapse", () => {
    for (const { id, tones: derived } of palettes) {
      for (const view of views) {
        for (const tone of tones) {
          expect(
            deltaEUnder(view, derived[tone].fill, derived[tone].line),
            `${id} ${tone} fill-line (${view})`,
          ).toBeGreaterThanOrEqual(20);
        }
        // Hue alone cannot carry red, orange, yellow and green under protanopia or deuteranopia:
        // they differ in lightness too, and are at least as far apart as the paper theme's own
        // tones (2.9 at worst).
        for (const [a, b] of pairs) {
          expect(
            deltaEUnder(view, derived[a].line, derived[b].line),
            `${id} ${a}-${b} line (${view})`,
          ).toBeGreaterThanOrEqual(2.5);
          expect(
            deltaEUnder(view, derived[a].fill, derived[b].fill),
            `${id} ${a}-${b} fill (${view})`,
          ).toBeGreaterThanOrEqual(2.5);
        }
      }
    }
  });
});

describe("withPalette and the derived tones (#423)", () => {
  const paper = getTheme("paper");
  if (paper === undefined) throw new Error("paper");

  test("every theme gets the same derived tones; the theme without a palette keeps its own", () => {
    for (const { id, tones: derived } of palettes) {
      for (const name of ["minimal", "academic", "slides", "color", "paper", "llama"]) {
        const theme = getTheme(name);
        if (theme === undefined) throw new Error(name);
        const recolored = withPalette(theme, id);
        for (const tone of tones) {
          expect(recolored.tones.get(tone)?.fill, `${name} ${id} ${tone}`).toBe(derived[tone].fill);
          expect(recolored.toneLines.get(tone)?.stroke, `${name} ${id} ${tone}`).toBe(
            derived[tone].line,
          );
          expect(recolored.toneLines.get(tone)?.fontColor, `${name} ${id} ${tone}`).toBe(
            derived[tone].line,
          );
        }
      }
    }
    expect(withPalette(paper, undefined)).toBe(paper);
    expect(paper.tones.get("green")?.fill).toBe("#c6edcd");
  });

  test("explicit tone overrides win, per tone and per field", () => {
    const theme = figureTheme(paper, {
      palette: "slate",
      tones: { green: { fill: "#010203" }, red: { line: "#040506" } },
    });
    const slate = BUILTIN_PALETTES.get("slate") as Palette;
    expect(theme.tones.get("green")?.fill).toBe("#010203");
    expect(theme.toneLines.get("green")?.stroke).toBe(slate.tones.green.line);
    expect(theme.toneLines.get("red")?.stroke).toBe("#040506");
    expect(theme.tones.get("red")?.fill).toBe(slate.tones.red.fill);
    expect(theme.tones.get("blue")?.fill).toBe(slate.tones.blue.fill);
  });
});
