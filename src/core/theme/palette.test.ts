import { describe, expect, test } from "bun:test";
import { builtinRegistry, FLOW_ARROW_IDS } from "../registry/builtins";
import { componentId } from "../registry/manifest";
import { BUILTIN_THEMES, getTheme } from "./builtin";
import { deltaE as deltaEOf, toOklch } from "./color-math";
import { contrastRatio, luminance } from "./node-variants";
import {
  BUILTIN_PALETTES,
  getPalette,
  isDarkCanvas,
  PALETTE_NAMES,
  type Palette,
  withPalette,
} from "./palette";
import { GRAY_SEPARATION } from "./palette-tones";
import { resolveStyle } from "./resolve";
import { TONE_NAMES } from "./tones";

const WHITE = "#ffffff";
const palettes = [...BUILTIN_PALETTES.values()];

/** The four colors of each built-in palette, as listed in the issue (Color Hunt, 2026-11-08). */
const PUBLISHED: Record<string, string[]> = {
  "cool-blue": ["#f9f7f7", "#dbe2ef", "#3f72af", "#112d4e"],
  slate: ["#27374d", "#526d82", "#9db2bf", "#dde6ed"],
  coral: ["#fff5e4", "#ffe3e1", "#ffd1d1", "#ff9494"],
  terracotta: ["#7d5a50", "#b4846c", "#e5b299", "#fcdec0"],
  sage: ["#f8ede3", "#bdd2b6", "#a2b29f", "#798777"],
  lavender: ["#f4eeff", "#dcd6f7", "#a6b1e1", "#424874"],
  "cyan-pink": ["#364f6b", "#3fc1c9", "#f5f5f5", "#fc5185"],
  seafoam: ["#ffb6b9", "#fae3d9", "#bbded6", "#61c0bf"],
};

describe("the built-in palettes", () => {
  test("are eight, named by character, with the four published colors", () => {
    expect([...PALETTE_NAMES]).toEqual(Object.keys(PUBLISHED));
    for (const palette of palettes) {
      expect(palette.colors).toEqual(PUBLISHED[palette.id] as never);
      expect(palette.description.length).toBeGreaterThan(10);
      expect(getPalette(palette.id)).toBe(palette);
    }
    expect(getPalette("nope")).toBeUndefined();
  });

  test("panel and tint start from the published colors; a role not published is listed as adjusted", () => {
    for (const palette of palettes) {
      const published = new Set(palette.colors);
      for (const [role, color] of Object.entries(palette.roles)) {
        expect(color).toMatch(/^#[0-9a-f]{6}$/);
        if (!palette.adjusted.includes(role as never))
          expect(published.has(color), `${palette.id} ${role}`).toBe(true);
      }
    }
  });

  test("every text keeps the contrast of the theme/low-contrast rule (4.5:1) on its background", () => {
    for (const { id, roles: r } of palettes) {
      const at = (what: string, a: string, b: string, minimum = 4.5) =>
        expect(contrastRatio(a, b), `${id} ${what}`).toBeGreaterThanOrEqual(minimum);
      at("ink on white", r.ink, WHITE, 9);
      at("ink on panel", r.ink, r.panel);
      at("ink on tint", r.ink, r.tint);
      at("muted on white", r.muted, WHITE);
      at("muted on panel", r.muted, r.panel);
      at("white on strong (solid)", WHITE, r.strong);
      at("strong on panel (outlined text)", r.strong, r.panel);
      at("white on accent (emphasis fill)", WHITE, r.accent);
    }
  });

  test("keep the roles apart in grayscale: white > soft > panel > tint > frame > accent > strong > ink", () => {
    const lightness = (hex: string) => {
      const y = luminance(hex);
      return y > 216 / 24389 ? 116 * y ** (1 / 3) - 16 : (24389 / 27) * y;
    };
    for (const { id, roles: r } of palettes) {
      const L = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, lightness(v)])) as Record<
        keyof typeof r,
        number
      >;
      const gap = (what: string, higher: number, lower: number, minimum: number) =>
        expect(higher - lower, `${id} ${what}`).toBeGreaterThanOrEqual(minimum);
      gap("white-panel", 100, L.panel, 5);
      gap("white-soft", 100, L.soft, 1);
      gap("soft-panel", L.soft, L.panel, 2);
      gap("panel-tint", L.panel, L.tint, 5);
      gap("tint-frame", L.tint, L.frame, 5);
      gap("tint-accent", L.tint, L.accent, 20);
      // The frame of a muted group stands out from its panel.
      gap("panel-frame", L.panel, L.frame, 20);
      // A solid fill is the accent, deepened: never lighter, and well above the ink.
      gap("accent-strong", L.accent, L.strong, 2);
      gap("strong-ink", L.strong, L.ink, 8);
      gap("accent-ink", L.accent, L.ink, 10);
    }
  });

  test("keep the accent apart from the ink and the tint under protanopia, deuteranopia and tritanopia", () => {
    for (const { id, roles: r } of palettes) {
      for (const [view, matrix] of Object.entries(VISION)) {
        expect(
          deltaE(r.accent, r.ink, matrix),
          `${id} accent-ink (${view})`,
        ).toBeGreaterThanOrEqual(15);
        expect(
          deltaE(r.accent, r.tint, matrix),
          `${id} accent-tint (${view})`,
        ).toBeGreaterThanOrEqual(20);
      }
    }
  });

  test("a palette that needs an adjusted ink or accent says so", () => {
    const adjusted = (id: string) => getPalette(id)?.adjusted ?? [];
    // Pale or mid palettes: the ink is a darkened shade of their darkest color (9:1 on white).
    for (const id of ["coral", "terracotta", "sage", "lavender", "cyan-pink", "seafoam"])
      expect(adjusted(id)).toContain("ink");
    // Dark enough as published.
    for (const id of ["cool-blue", "slate"]) expect(adjusted(id)).not.toContain("ink");
    // A palest-color tint that the ink cannot read on is lightened.
    expect(adjusted("cyan-pink")).toContain("tint");
    expect(adjusted("slate")).not.toContain("tint");
  });
});

describe("a palette on a non-white canvas (#473)", () => {
  const canvasOf = (id: string) => {
    const theme = getTheme(id);
    if (theme === undefined) throw new Error(id);
    return theme.canvas;
  };

  test("is the listed palette on white", () => {
    for (const { id } of palettes) expect(getPalette(id, WHITE)).toBe(PALETTE(id));
  });

  test("on a light canvas, measures the ink, muted text, accent and strong color against it", () => {
    const canvas = canvasOf("sumi");
    expect(isDarkCanvas(canvas)).toBe(false);
    for (const { id } of palettes) {
      const { roles: r } = PALETTE(id, canvas);
      const at = (what: string, a: string, b: string, minimum = 4.5) =>
        expect(contrastRatio(a, b), `${id} ${what}`).toBeGreaterThanOrEqual(minimum);
      at("ink on canvas", r.ink, canvas, 9);
      at("ink on panel", r.ink, r.panel);
      at("ink on tint", r.ink, r.tint);
      at("muted on canvas", r.muted, canvas);
      at("muted on panel", r.muted, r.panel);
      at("accent on canvas", r.accent, canvas);
      at("strong on canvas", r.strong, canvas);
      at("strong on panel", r.strong, r.panel);
      at("white on strong", WHITE, r.strong);
      // The panel is the palette's own, as on white.
      expect(r.panel).toBe(PALETTE(id).roles.panel);
    }
  });

  test("on a dark canvas, is a dark variant: light ink and lines, dark panels and fills", () => {
    const canvas = canvasOf("sumi-dark");
    expect(isDarkCanvas(canvas)).toBe(true);
    for (const { id } of palettes) {
      const { roles: r, tones } = PALETTE(id, canvas);
      const at = (what: string, a: string, b: string, minimum = 4.5) =>
        expect(contrastRatio(a, b), `${id} ${what}`).toBeGreaterThanOrEqual(minimum);
      // Panels a step lighter than the canvas, the tint lighter again; all darker than the text.
      expect(luminance(r.panel), `${id} panel`).toBeGreaterThan(luminance(canvas));
      expect(luminance(r.tint), `${id} tint`).toBeGreaterThan(luminance(r.panel));
      expect(luminance(r.soft), `${id} soft`).toBeLessThan(luminance(r.panel));
      at("ink on canvas", r.ink, canvas, 9);
      for (const ground of [r.panel, r.tint, r.soft]) at(`ink on ${ground}`, r.ink, ground);
      at("muted on canvas", r.muted, canvas);
      at("muted on panel", r.muted, r.panel);
      // The accent keeps its hue and reads as text (and so as a line) on the canvas and the panel.
      at("accent on canvas", r.accent, canvas);
      at("accent on panel", r.accent, r.panel);
      const hueGap = Math.abs(
        ((toOklch(r.accent).h - toOklch(PALETTE(id).roles.accent).h + 540) % 360) - 180,
      );
      expect(hueGap, `${id} accent hue`).toBeLessThan(12);
      // Solid fills take the canvas as text; outlined text sits on the panel; tinted gray on the tint.
      at("canvas on strong", canvas, r.strong);
      at("strong on panel", r.strong, r.panel);
      at("strong on tint", r.strong, r.tint);
      expect(contrastRatio(r.strong, r.accent), `${id} strong-accent`).toBeGreaterThanOrEqual(1.12);
      for (const [tone, { fill, line }] of Object.entries(tones)) {
        expect(luminance(fill), `${id} ${tone} fill darker than its text`).toBeLessThan(
          luminance(line),
        );
        at(`${tone} line on canvas`, line, canvas);
        at(`${tone} line on panel`, line, r.panel);
        at(`${tone} line on its fill`, line, fill);
        at(`ink on ${tone} fill`, r.ink, fill);
        expect(deltaEOf(fill, r.tint), `${id} ${tone} apart from gray`).toBeGreaterThanOrEqual(
          GRAY_SEPARATION,
        );
      }
    }
  });
});

describe("withPalette", () => {
  const theme = getTheme("paper");
  if (theme === undefined) throw new Error("paper");

  test("is the theme itself without a palette", () => {
    expect(withPalette(theme, undefined)).toBe(theme);
    expect(withPalette(theme, "unknown")).toBe(theme);
  });

  test("returns a copy and leaves the built-in theme untouched", () => {
    const before = [...theme.tokens].map(([name, token]) => `${name}=${String(token.value)}`);
    const recolored = withPalette(theme, "cool-blue");
    expect(recolored).not.toBe(theme);
    expect([...theme.tokens].map(([name, token]) => `${name}=${String(token.value)}`)).toEqual(
      before,
    );
    expect(getTheme("paper")?.base.node.fontColor).toBe("#000000");
    expect(recolored.base.node.fontColor).toBe(PALETTE("cool-blue").roles.ink);
  });

  test("changes colors only: sizes, fonts and line weights stay the theme's", () => {
    const recolored = withPalette(theme, "terracotta");
    expect(recolored.fontSet).toBe(theme.fontSet);
    expect(recolored.arrowhead).toBe(theme.arrowhead);
    const registry = builtinRegistry();
    for (const manifest of registry.list()) {
      const id = componentId(manifest);
      for (const variant of manifest.variants) {
        const [a, b] = [
          resolveStyle(theme, { kind: manifest.kind, id, variant }).style,
          resolveStyle(recolored, { kind: manifest.kind, id, variant }).style,
        ];
        for (const key of [
          "strokeWidth",
          "strokeDash",
          "fontSize",
          "bold",
          "italic",
          "mono",
          "opacity",
        ] as const)
          expect(b[key], `${id} ${variant} ${key}`).toEqual(a[key]);
      }
    }
    // The other tones are the palette's derived tones (#423): only their colors differ.
    for (const tone of TONE_NAMES.filter((t) => t !== "gray")) {
      expect(Object.keys(recolored.tones.get(tone) ?? {})).toEqual(
        Object.keys(theme.tones.get(tone) ?? {}),
      );
      expect(recolored.tones.get(tone)?.fill).toBe(PALETTE("terracotta").tones[tone].fill);
      if (
        tone !== "yellow" &&
        !(tone === "orange" && (theme.id === "llama" || theme.id === "color"))
      )
        expect(recolored.toneLines.get(tone)?.stroke).toBe(PALETTE("terracotta").tones[tone].line);
    }
    // The gray tone is the palette's neutral.
    expect(recolored.tones.get("gray")?.fill).toBe(PALETTE("terracotta").roles.tint);
    expect(recolored.toneLines.get("gray")?.stroke).toBe(PALETTE("terracotta").roles.strong);
  });

  test("gives every theme the palette's ink, panel, tint and accent", () => {
    for (const theme of BUILTIN_THEMES.values()) {
      for (const { id } of palettes) {
        // The palette as derived for the theme's canvas (the listed palette on white).
        const { roles } = PALETTE(id, theme.canvas);
        const recolored = withPalette(theme, id);
        const style = (component: string, variant = "default") =>
          resolveStyle(recolored, {
            kind: component === "sumi/container" ? "group" : "node",
            id: component as never,
            variant,
          }).style;
        expect(style("sumi/box").fontColor, `${theme.id} ${id} text`).toBe(roles.ink);
        expect(style("sumi/box", "emphasis").stroke, `${theme.id} ${id} emphasis`).toBe(
          roles.accent,
        );
        expect(style("sumi/box", "filled").fill, `${theme.id} ${id} filled`).toBe(roles.tint);
        expect(style("sumi/box", "solid").fill, `${theme.id} ${id} solid`).toBe(roles.strong);
        const group = style("sumi/container");
        // A theme whose groups have no fill (academic) keeps them open.
        // `paper`'s default groups are white (#440): a palette does not tint them.
        if (group.fill !== "transparent" && theme.id !== "paper")
          expect(group.fill, `${theme.id} ${id} panel`).toBe(roles.panel);
        if (theme.id === "paper") {
          expect(group.fill, `${id} paper default group`).toBe("#ffffff");
          expect(style("sumi/container", "filled").fill, `${id} paper filled group`).toBe(
            roles.panel,
          );
        }
      }
    }
  });

  test("a muted group takes the palette's soft fill and frame, not a neutral gray", () => {
    for (const base of BUILTIN_THEMES.values()) {
      for (const { id } of palettes) {
        const { roles } = PALETTE(id, base.canvas);
        const group = resolveStyle(withPalette(base, id), {
          kind: "group",
          id: "sumi/container",
          variant: "muted",
        }).style;
        // Academic's groups have no fill; that stays.
        expect(group.fill, `${base.id} ${id}`).toBe(
          base.id === "academic" ? "transparent" : roles.soft,
        );
        expect(group.stroke, `${base.id} ${id}`).toBe(roles.frame);
      }
    }
  });

  test("keeps every text readable on its fill in every theme and palette", () => {
    const registry = builtinRegistry();
    for (const base of BUILTIN_THEMES.values()) {
      for (const { id } of palettes) {
        const theme = withPalette(base, id);
        for (const manifest of registry.list()) {
          if (manifest.kind === "edge") continue;
          const cid = componentId(manifest);
          for (const variant of manifest.variants) {
            for (const tone of [undefined, ...TONE_NAMES]) {
              const { style } = resolveStyle(theme, {
                kind: manifest.kind,
                id: cid,
                variant,
                tone,
              });
              if (!/^#[0-9a-f]{6}$/.test(style.fontColor) || style.fill === undefined) continue;
              // A transparent fill sits on the canvas or on a panel; test both.
              const grounds = /^#[0-9a-f]{6}$/.test(style.fill)
                ? [style.fill]
                : [base.canvas, PALETTE(id, base.canvas).roles.panel];
              // A muted or emphasized element with a tone keeps its own text color on the tone's
              // fill (the theme's own limit, with or without a palette).
              if (tone !== undefined && (variant === "muted" || variant === "emphasis")) continue;
              // A junction is a dot: it draws no text.
              if (cid === "sumi/junction") continue;
              // A flow arrow (#426) is a solid shape: its fill is its ink, and it has no text.
              if (FLOW_ARROW_IDS.includes(cid)) continue;
              for (const ground of grounds)
                expect(
                  contrastRatio(style.fontColor, ground),
                  `${base.id} ${id} ${cid} ${variant} ${tone ?? "-"}`,
                ).toBeGreaterThanOrEqual(4.5);
            }
          }
        }
      }
    }
  });
});

const PALETTE = (id: string, canvas?: string): Palette => {
  const palette = getPalette(id, canvas);
  if (palette === undefined) throw new Error(id);
  return palette;
};

// Machado, Oliveira and Fernandes (2009), severity 1.0, on linear RGB.
const VISION = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
  normal: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
} as const;

type Matrix = readonly (readonly number[])[];

/** CIE76 color difference of two sRGB colors as seen through `matrix`. */
function deltaE(a: string, b: string, matrix: Matrix): number {
  const [x, y] = [lab(simulate(a, matrix)), lab(simulate(b, matrix))] as [number[], number[]];
  return Math.hypot(...x.map((v, i) => v - (y[i] ?? 0)));
}

function simulate(hex: string, matrix: Matrix): number[] {
  const linear = [1, 3, 5].map((o) => {
    const v = Number.parseInt(hex.slice(o, o + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return matrix.map((row) =>
    Math.min(
      1,
      Math.max(
        0,
        row.reduce((sum, m, i) => sum + m * (linear[i] ?? 0), 0),
      ),
    ),
  );
}

function lab([r = 0, g = 0, b = 0]: number[]): number[] {
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [x, y, z] = [
    (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047,
    0.2126 * r + 0.7152 * g + 0.0722 * b,
    (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883,
  ];
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
