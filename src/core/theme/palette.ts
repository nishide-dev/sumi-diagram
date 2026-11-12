/**
 * Built-in color palettes (#417, `figure.themeOverrides.palette`).
 *
 * A palette is four colors from a popular Color Hunt palette, mapped onto the
 * color roles every theme has: the pale panel (group fill), the tint (filled
 * and tinted nodes, `gray` tone fill), the accent (emphasis), and the ink
 * (text, frames and lines). Three more colors are derived from the ink and the
 * accent so that every pair of text and background keeps the contrast the
 * `theme/low-contrast` rule asks for (4.5:1): `muted`, `strong` and the
 * accent's line shade. A role that is not one of the four colors as published
 * is listed in {@link Palette.adjusted}. The other tones (blue, green, ...) are
 * derived from the roles in OKLCH ({@link Palette.tones}, `palette-tones.ts`, #423).
 *
 * The contrasts below are those on white; on another canvas a palette is
 * derived for it ({@link getPalette} with a canvas, #473): on a light one the
 * same contrasts are measured against the canvas too, on a dark one the
 * palette draws its dark variant (light ink and lines on dark panels).
 *
 * {@link withPalette} recolors a copy of a theme, never the theme itself, so
 * a figure without a palette is drawn exactly as before. See
 * docs/design/decisions/417-palettes.md and 423-tone-harmony.md.
 */

import { fromOklch, toOklch } from "./color-math";
import { contrastRatio, luminance, warmTones } from "./node-variants";
import { type DerivedTone, type DerivedToneColors, deriveTones } from "./palette-tones";
import type { Theme } from "./schema";
import type { StyleLayer, TypedValue } from "./style";
import { TONE_NAMES } from "./tones";

/** Where the four colors of every palette come from (colors only, no other data). */
export const PALETTE_SOURCE = "Color Hunt popular palettes, retrieved 2026-11-08";

/** The color roles of a palette, as `#rrggbb`. */
export interface PaletteRoles {
  /** The palest color: group (panel) fill. */
  readonly panel: string;
  /** A light color: filled and tinted nodes, `gray` tone fill, filled groups. */
  readonly tint: string;
  /** The emphasis color, at least 4.5:1 on white (a line, or a fill with white text). */
  readonly accent: string;
  /** Text, node frames, edges and arrowheads: at least 9:1 on white. */
  readonly ink: string;
  /** Secondary text and frames: at least 4.5:1 on white and on the panel. */
  readonly muted: string;
  /** Solid fills (with white text), outlined frames and text, `gray` tone line: the accent, deepened. */
  readonly strong: string;
  /** Fill of a `muted` group: a paler panel. */
  readonly soft: string;
  /** Frame of a `muted` group. */
  readonly frame: string;
}

export type PaletteRole = keyof PaletteRoles;

export interface Palette {
  readonly id: string;
  readonly description: string;
  /** The four colors as published, in the source's order. */
  readonly colors: readonly [string, string, string, string];
  readonly roles: PaletteRoles;
  /**
   * The tones other than `gray`, in the palette's lightness and chroma (#423):
   * each keeps its own hue. `gray` is the palette's neutral (tint and strong).
   */
  readonly tones: Readonly<Record<DerivedTone, DerivedToneColors>>;
  /** Roles that are derived or adjusted, not one of `colors` as published. */
  readonly adjusted: readonly PaletteRole[];
}

interface PaletteDefinition {
  readonly id: string;
  readonly description: string;
  readonly colors: readonly [string, string, string, string];
  /** Which of `colors` is the accent. */
  readonly accent: string;
  /** The panel (group fill) and the tint: published colors, or ones moved toward white / the accent. */
  readonly panel: string;
  readonly tint: string;
}

const WHITE = "#ffffff";

const DEFINITIONS: readonly PaletteDefinition[] = [
  {
    id: "cool-blue",
    description: "Cool blue: pale blue panel, blue tint, mid blue accent, navy ink",
    colors: ["#f9f7f7", "#dbe2ef", "#3f72af", "#112d4e"],
    accent: "#3f72af",
    panel: "#dbe2ef",
    tint: mix("#dbe2ef", "#3f72af", 0.3),
  },
  {
    id: "slate",
    description: "Muted blue-gray: slate ink, steel-gray tint, pale mist panel",
    colors: ["#27374d", "#526d82", "#9db2bf", "#dde6ed"],
    accent: "#526d82",
    panel: "#dde6ed",
    tint: "#9db2bf",
  },
  {
    id: "coral",
    description: "Warm: pale pink panel, pink tint, coral-red accent, brick-brown ink",
    colors: ["#fff5e4", "#ffe3e1", "#ffd1d1", "#ff9494"],
    accent: "#ff9494",
    panel: "#ffe3e1",
    tint: mix("#ffd1d1", "#ff9494", 0.5),
  },
  {
    id: "terracotta",
    description: "Earthy: sand panel, clay tint, terracotta accent, cocoa ink",
    colors: ["#7d5a50", "#b4846c", "#e5b299", "#fcdec0"],
    accent: "#b4846c",
    panel: "#fcdec0",
    tint: "#e5b299",
  },
  {
    id: "sage",
    description: "Muted green: pale green panel, sage tint, moss accent, gray-green ink",
    colors: ["#f8ede3", "#bdd2b6", "#a2b29f", "#798777"],
    accent: "#bdd2b6",
    panel: mix("#bdd2b6", WHITE, 0.55),
    tint: "#bdd2b6",
  },
  {
    id: "lavender",
    description: "Lavender: pale violet panel, periwinkle tint and accent, indigo ink",
    colors: ["#f4eeff", "#dcd6f7", "#a6b1e1", "#424874"],
    accent: "#a6b1e1",
    panel: mix("#dcd6f7", WHITE, 0.45),
    tint: "#dcd6f7",
  },
  {
    id: "cyan-pink",
    description: "High contrast: pale cyan panel, cyan tint, hot pink accent, navy ink",
    colors: ["#364f6b", "#3fc1c9", "#f5f5f5", "#fc5185"],
    accent: "#fc5185",
    panel: mix("#3fc1c9", WHITE, 0.8),
    tint: "#3fc1c9",
  },
  {
    id: "seafoam",
    description: "Green-teal: mint panel, seafoam tint, teal accent, deep teal ink",
    colors: ["#ffb6b9", "#fae3d9", "#bbded6", "#61c0bf"],
    accent: "#61c0bf",
    panel: mix("#bbded6", WHITE, 0.55),
    tint: "#bbded6",
  },
];

// ---- color arithmetic (sRGB, `#rrggbb`) ----

function channels(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function toHex(rgb: readonly number[]): string {
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

/** `a` moved `t` (0..1) of the way to `b`. */
function mix(a: string, b: string, t: number): string {
  const [x, y] = [channels(a), channels(b)];
  return toHex(x.map((c, i) => c + ((y[i] ?? 0) - c) * t));
}

/** The color darkened (toward black) in 1% steps until `ok` holds. */
function darkenUntil(hex: string, ok: (color: string) => boolean): string {
  for (let percent = 0; percent <= 100; percent++) {
    const color = mix(hex, "#000000", percent / 100);
    if (ok(color)) return color;
  }
  return "#000000";
}

function toHsl(hex: string): [number, number, number] {
  const [r, g, b] = channels(hex).map((c) => c / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function fromHsl(h: number, s: number, l: number): string {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return (l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255;
  };
  return toHex([f(0), f(8), f(4)]);
}

/**
 * The color with its lightness lowered (hue kept, saturation at most 0.55, so a
 * pastel does not turn into a neon) until `ok` holds: an accent that stays
 * colorful, unlike a mix with black.
 */
function deepenUntil(hex: string, ok: (color: string) => boolean): string {
  const [h, s, l] = toHsl(hex);
  for (let step = 0; step <= 100; step++) {
    const color = step === 0 ? hex : fromHsl(h, Math.min(s, 0.55), l * (1 - step / 100));
    if (ok(color)) return color;
  }
  return "#000000";
}

/** The color lightened (toward white) in 1% steps until `ok` holds. */
function lightenUntil(hex: string, ok: (color: string) => boolean): string {
  for (let percent = 0; percent <= 100; percent++) {
    const color = mix(hex, WHITE, percent / 100);
    if (ok(color)) return color;
  }
  return WHITE;
}

/**
 * Whether a canvas is dark (OKLCH lightness below one half and a bit): a
 * palette then draws its dark variant, light text and lines on a dark ground.
 */
export function isDarkCanvas(canvas: string): boolean {
  return toOklch(canvas).l < 0.6;
}

/**
 * The palette's roles and tones on a light canvas (white for every theme but
 * `sumi`): text, lines and frames are measured against the canvas as well as
 * white, so on white the result is the published derivation.
 */
function definePalette(definition: PaletteDefinition, canvas = WHITE): Palette {
  if (isDarkCanvas(canvas)) return defineDarkPalette(definition, canvas);
  const { id, description, colors, accent: published } = definition;
  const ordered = [...colors].sort((a, b) => luminance(b) - luminance(a));
  const darkest = ordered[ordered.length - 1] ?? "#000000";
  const adjusted: PaletteRole[] = [];
  const keep = (role: PaletteRole, color: string): string => {
    if (!colors.includes(color)) adjusted.push(role);
    return color;
  };
  // Ink: the darkest color, darkened until it reads on the canvas at 9:1.
  const ink = keep(
    "ink",
    darkenUntil(darkest, (c) => contrastRatio(c, canvas) >= 9),
  );
  // Panel: the definition's pale color (a published color, or a published color toward white).
  const panel = keep("panel", definition.panel);
  // Tint: lightened until the ink reads on it at 4.5:1.
  const tint = keep(
    "tint",
    lightenUntil(definition.tint, (c) => contrastRatio(ink, c) >= 4.5),
  );
  // Accent: the published color, deepened (hue kept) until white text reads on it at 4.5:1
  // (and, as an emphasis line or text, on the canvas).
  const accent = keep(
    "accent",
    deepenUntil(
      published,
      (c) => contrastRatio(c, WHITE) >= 4.5 && contrastRatio(c, canvas) >= 4.5,
    ),
  );
  // Strong: the accent deepened further so it also reads on the panel at 4.5:1 (outlined
  // text) and stands apart from the accent; solid fills (white text), outlined frames and the gray tone take it.
  const strong = keep(
    "strong",
    deepenUntil(
      published,
      (c) =>
        contrastRatio(c, WHITE) >= 4.5 &&
        contrastRatio(c, canvas) >= 4.5 &&
        contrastRatio(c, panel) >= 4.5 &&
        // Visibly deeper than the accent, so a solid or outlined node differs from an emphasis.
        contrastRatio(c, accent) >= 1.12,
    ),
  );
  return finish(definition, canvas, { panel, tint, accent, ink, strong }, adjusted);
}

/**
 * The muted, soft and frame roles and the tones, from the other roles: the
 * muted text is the ink as close to the canvas as still reads on the canvas
 * and the panel at 4.5:1, a muted group's fill is the panel halfway to the
 * canvas.
 */
function finish(
  definition: PaletteDefinition,
  canvas: string,
  roles: Pick<PaletteRoles, "panel" | "tint" | "accent" | "ink" | "strong">,
  adjusted: PaletteRole[],
): Palette {
  const { id, description, colors } = definition;
  const { panel, tint, accent, ink, strong } = roles;
  let muted = ink;
  for (let percent = 0; percent <= 100; percent++) {
    const candidate = mix(ink, canvas, percent / 100);
    if (contrastRatio(candidate, canvas) >= 4.5 && contrastRatio(candidate, panel) >= 4.5)
      muted = candidate;
  }
  // A muted group: a paler panel with a frame between the tint and the ink.
  const soft = mix(panel, canvas, 0.5);
  const frame = mix(tint, ink, 0.3);
  adjusted.push("muted", "soft", "frame");
  return Object.freeze({
    id,
    description,
    colors,
    roles: Object.freeze({ panel, tint, accent, ink, muted, strong, soft, frame }),
    tones: Object.freeze(deriveTones({ panel, tint, accent, strong, ink, canvas })),
    adjusted: Object.freeze(adjusted),
  });
}

/** OKLCH lightness steps (0.005) from `start` in `direction` until `ok` holds, hue and chroma kept (gamut permitting). */
function stepLightness(
  start: string,
  direction: 1 | -1,
  ok: (color: string) => boolean,
  chroma?: number,
): string {
  const { l, c, h } = toOklch(start);
  for (let step = 0; step <= 200; step++) {
    const color =
      step === 0 && chroma === undefined
        ? start
        : fromOklch({
            l: Math.min(1, Math.max(0, l + direction * step * 0.005)),
            c: chroma ?? c,
            h,
          });
    if (ok(color)) return color;
  }
  return direction > 0 ? WHITE : "#000000";
}

/**
 * The dark variant of a palette on a dark canvas (`sumi-dark`): the canvas
 * stays the theme's; the panel is a step lighter than the canvas in the hue of
 * the palette's panel, the tint a step lighter again in the tint's hue (and
 * darkened until the ink reads on it at 4.5:1); the ink is the palette's
 * palest color, lightened until it reads on the canvas at 9:1 and on the panel
 * at 4.5:1; the accent keeps its hue and is lightened until it reads on the
 * canvas and the panel at 4.5:1 (a pastel far above that is deepened, see
 * {@link DARK_ACCENT_CONTRAST}), and the strong color is lightened further
 * (solid fills take the canvas as text).
 */
function defineDarkPalette(definition: PaletteDefinition, canvas: string): Palette {
  const { colors, accent: published } = definition;
  const ordered = [...colors].sort((a, b) => luminance(b) - luminance(a));
  const palest = ordered[0] ?? WHITE;
  const adjusted: PaletteRole[] = [];
  const keep = (role: PaletteRole, color: string): string => {
    if (!colors.includes(color)) adjusted.push(role);
    return color;
  };
  const ground = toOklch(canvas);
  const tintSource = toOklch(definition.tint);
  const accentSource = toOklch(published);
  // The palette's hue: that of its most colorful role, as for the tones.
  const hue = accentSource.c >= tintSource.c ? accentSource.h : tintSource.h;
  // The panel in the hue of the palette's own panel (cyan for cyan-pink), or of the palette.
  const panelSource = toOklch(definition.panel);
  const panel = keep(
    "panel",
    fromOklch({
      l: ground.l + DARK_PANEL_STEP,
      c: DARK_PANEL_CHROMA,
      h: panelSource.c >= 0.01 ? panelSource.h : hue,
    }),
  );
  const ink = keep(
    "ink",
    lightenUntil(palest, (c) => contrastRatio(c, canvas) >= 9 && contrastRatio(c, panel) >= 4.5),
  );
  const tint = keep(
    "tint",
    stepLightness(
      fromOklch({
        l: ground.l + DARK_TINT_STEP,
        c: Math.min(DARK_TINT_CHROMA[1], Math.max(DARK_TINT_CHROMA[0], tintSource.c)),
        h: tintSource.c < 0.02 ? hue : tintSource.h,
      }),
      -1,
      (c) => contrastRatio(ink, c) >= 4.5,
    ),
  );
  const readsOnGround = (c: string) =>
    contrastRatio(c, canvas) >= 4.5 && contrastRatio(c, panel) >= 4.5;
  const accentChroma = Math.min(accentSource.c, DARK_ACCENT_CHROMA);
  const accent = keep(
    "accent",
    !readsOnGround(published)
      ? stepLightness(published, 1, readsOnGround, accentChroma)
      : contrastRatio(published, canvas) > DARK_ACCENT_CONTRAST
        ? deepestReading(published, readsOnGround)
        : published,
  );
  const strong = keep(
    "strong",
    stepLightness(
      accent,
      1,
      (c) =>
        readsOnGround(c) &&
        contrastRatio(c, tint) >= 4.5 &&
        // Visibly lighter than the accent, so a solid or outlined node differs from an emphasis.
        contrastRatio(c, accent) >= 1.12,
      Math.min(toOklch(accent).c, DARK_ACCENT_CHROMA),
    ),
  );
  return finish(definition, canvas, { panel, tint, accent, ink, strong }, adjusted);
}

/**
 * A pastel accent that reads on a dark canvas with more than this contrast
 * (sage's pale green) is too close to the light ink to stand out: it is drawn
 * as dark as still reads, with at least {@link DARK_ACCENT_MIN_CHROMA}.
 */
const DARK_ACCENT_CONTRAST = 6.5;
const DARK_ACCENT_MIN_CHROMA = 0.08;

/** The color, in its hue with at least {@link DARK_ACCENT_MIN_CHROMA}, as dark as `ok` allows. */
function deepestReading(color: string, ok: (color: string) => boolean): string {
  const { l, c, h } = toOklch(color);
  const chroma = Math.max(c, DARK_ACCENT_MIN_CHROMA);
  let deepest = color;
  for (let step = 0; step <= 200; step++) {
    const candidate = fromOklch({ l: l - step * 0.005, c: chroma, h });
    if (!ok(candidate)) break;
    deepest = candidate;
  }
  return deepest;
}

/** OKLCH lightness of a dark palette's panel and tint above the canvas. */
const DARK_PANEL_STEP = 0.05;
const DARK_TINT_STEP = 0.12;
/** Chroma of a dark palette's panel, and the range of its tint's. */
const DARK_PANEL_CHROMA = 0.03;
const DARK_TINT_CHROMA = [0.03, 0.06] as const;
/** The most chroma a dark palette's lightened accent and strong color keep. */
const DARK_ACCENT_CHROMA = 0.16;

/** The built-in palettes, in the order of the catalog. */
export const BUILTIN_PALETTES: ReadonlyMap<string, Palette> = new Map(
  DEFINITIONS.map((definition) => [definition.id, definePalette(definition)]),
);

/** The IDs of the built-in palettes. */
export const PALETTE_NAMES = DEFINITIONS.map((d) => d.id) as [string, ...string[]];

const ON_CANVAS = new Map<string, Palette>();

/**
 * The built-in palette, derived for the canvas it is drawn on: on white (the
 * default) the palette as listed; on another light canvas its contrasts are
 * measured against that canvas; on a dark canvas it is the palette's dark
 * variant (see {@link isDarkCanvas}).
 */
export function getPalette(id: string, canvas = WHITE): Palette | undefined {
  const palette = BUILTIN_PALETTES.get(id);
  if (palette === undefined || canvas === WHITE) return palette;
  const key = `${id} ${canvas}`;
  let derived = ON_CANVAS.get(key);
  if (derived === undefined) {
    const definition = DEFINITIONS.find((d) => d.id === id) as PaletteDefinition;
    derived = definePalette(definition, canvas);
    ON_CANVAS.set(key, derived);
  }
  return derived;
}

// ---- applying a palette to a theme ----

const HEX = /^#[0-9a-f]{6}$/;

const COLOR_PROPERTIES = ["fill", "stroke", "fontColor"] as const;

/** `#rgb` / `#rrggbb` as lowercase `#rrggbb`; anything else (`transparent`) is `undefined`. */
function normalized(color: unknown): string | undefined {
  if (typeof color !== "string") return undefined;
  const lower = color.toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(lower)) return `#${[...lower.slice(1)].map((c) => c + c).join("")}`;
  return HEX.test(lower) ? lower : undefined;
}

const chroma = (hex: string): number =>
  (Math.max(...channels(hex)) - Math.min(...channels(hex))) / 255;

/**
 * The theme's colors by role, each mapped to the palette color that plays
 * that role. Roles are read from where every theme keeps them (the base node,
 * edge and group, the muted label, the `gray` tone and the emphasis variants);
 * any other pale or gray color of the base and component layers (a panel
 * shade, a legend frame, a zoom line) goes by its lightness.
 */
function colorMap(theme: Theme, roles: PaletteRoles): Map<string, string> {
  const map = new Map<string, string>();
  const { canvas } = theme;
  const dark = isDarkCanvas(canvas);
  // White and the canvas stay: they are the page, not a color of the theme's.
  const page = (color: string) => color === WHITE || color === canvas;
  const assign = (color: unknown, target: string) => {
    const key = normalized(color);
    if (key !== undefined && !page(key) && !map.has(key)) map.set(key, target);
  };
  const layer = (component: string, variant: string): StyleLayer | undefined =>
    theme.components.get(component as never)?.get(variant);
  const text = normalized(theme.base.node.fontColor);
  assign(theme.base.node.fontColor, roles.ink);
  assign(
    theme.base.node.stroke,
    text === normalized(theme.base.node.stroke) ? roles.ink : roles.muted,
  );
  assign(theme.base.edge.stroke, roles.ink);
  assign(theme.base.edge.fontColor, roles.ink);
  assign(theme.base.group.fontColor, roles.ink);
  assign(layer("sumi/label", "muted")?.fontColor, roles.muted);
  assign(theme.tones.get("gray")?.fill, roles.tint);
  assign(theme.toneLines.get("gray")?.stroke, roles.strong);
  assign(theme.toneLines.get("gray")?.fontColor, roles.strong);
  // The accent: a colorful emphasis fill or edge color (`color`, `llama`), or any emphasis
  // color on a dark canvas (`sumi-dark`'s sand).
  for (const emphasis of [layer("sumi/box", "emphasis"), layer("sumi/arrow", "emphasis")]) {
    for (const property of ["fill", "stroke"] as const) {
      const color = normalized(emphasis?.[property]);
      if (color !== undefined && (dark || chroma(color) > 0.2)) assign(color, roles.accent);
    }
  }
  // The group fill is the panel (a theme's panel may be darker than the lightness rule's limit).
  assign(theme.base.group.fill, roles.panel);
  // Everything else that is pale or gray goes by how far it is from the canvas: by lightness
  // relative to a light canvas, by contrast with a dark one.
  const yCanvas = luminance(canvas);
  const rest = (value: unknown) => {
    const color = normalized(value);
    if (color === undefined || page(color) || map.has(color) || chroma(color) > 0.2) return;
    if (dark) {
      const ratio = contrastRatio(color, canvas);
      map.set(color, ratio < 1.4 ? roles.panel : ratio < 3 ? roles.tint : roles.muted);
      return;
    }
    const y = luminance(color) / yCanvas;
    map.set(color, y > 0.85 ? roles.panel : y > 0.5 ? roles.tint : roles.muted);
  };
  for (const l of recolorable(theme)) for (const property of COLOR_PROPERTIES) rest(l[property]);
  return map;
}

/**
 * The gray tone in the palette's neutral (tint fill, strong line) even where a
 * theme paints another role in the same color (`sumi`'s gray line is its muted
 * text): `property`, and the font color when it matched it, take `color`.
 */
function neutral(
  recolored: StyleLayer,
  source: StyleLayer,
  property: "fill" | "stroke",
  color: string,
): StyleLayer {
  const value = normalized(source[property]);
  if (value === undefined || value === WHITE) return recolored;
  return Object.freeze({
    ...recolored,
    [property]: color,
    ...(normalized(source.fontColor) === value && { fontColor: color }),
  }) as StyleLayer;
}

/** The layers a palette recolors: base, components and the `gray` tone. */
function recolorable(theme: Theme): StyleLayer[] {
  return [
    ...Object.values(theme.base),
    ...[...theme.components.values()].flatMap((variants) => [...variants.values()]),
    ...[theme.tones.get("gray"), theme.toneLines.get("gray")].filter((l) => l !== undefined),
  ];
}

/**
 * A copy of the theme in the palette's colors (the theme itself without a
 * palette). Text, frames and lines take the ink; panels, tints and the `gray`
 * tone take the palette's light colors; emphasis takes the accent. Sizes,
 * fonts, line weights and the other tones are the theme's.
 */
export function withPalette(theme: Theme, name: string | undefined): Theme {
  const palette = name === undefined ? undefined : getPalette(name, theme.canvas);
  if (palette === undefined) return theme;
  const { roles } = palette;
  const map = colorMap(theme, roles);
  // The gray tone's line: an outlined node's frame and text take the strong color even where the
  // theme paints its muted text in the same color (`sumi`).
  const grayLineColor = normalized(theme.toneLines.get("gray")?.stroke);
  const recolor = (
    source: StyleLayer,
    emphasis = false,
    muted = false,
    outlined = false,
  ): StyleLayer => {
    const values: Record<string, unknown> = { ...source };
    for (const property of COLOR_PROPERTIES) {
      const color = normalized(source[property]);
      const target =
        color === undefined
          ? undefined
          : outlined && property !== "fill" && color === grayLineColor && color !== WHITE
            ? roles.strong
            : map.get(color);
      if (target !== undefined) values[property] = target;
    }
    // Emphasis is drawn in the accent whatever the theme does (a heavier black frame, a gray fill).
    if (emphasis && source.stroke !== "transparent") values.stroke = roles.accent;
    // A muted group is a paler panel with a frame from the palette, not a neutral gray.
    if (muted) {
      if (normalized(source.fill) !== undefined) values.fill = roles.soft;
      values.stroke = roles.frame;
    }
    return Object.freeze(values) as StyleLayer;
  };
  const components = new Map(
    [...theme.components].map(([id, variants]) => [
      id,
      new Map(
        [...variants].map(([variant, layer]) => [
          variant,
          recolor(
            layer,
            variant === "emphasis",
            variant === "muted" && id === "sumi/container",
            variant === "outlined",
          ),
        ]),
      ),
    ]),
  );
  const tones = new Map(theme.tones);
  const toneLines = new Map(theme.toneLines);
  const gray = theme.tones.get("gray");
  if (gray !== undefined) tones.set("gray", neutral(recolor(gray), gray, "fill", roles.tint));
  // The other tones are drawn in the palette's lightness and chroma, each in its own hue (#423).
  for (const tone of TONE_NAMES) {
    if (tone === "gray") continue;
    const colors = palette.tones[tone];
    const fill = theme.tones.get(tone);
    if (fill !== undefined) tones.set(tone, Object.freeze({ ...fill, fill: colors.fill }));
    const line = theme.toneLines.get(tone);
    if (line !== undefined)
      toneLines.set(tone, Object.freeze({ ...line, stroke: colors.line, fontColor: colors.line }));
  }
  const grayLine = theme.toneLines.get("gray");
  if (grayLine !== undefined)
    toneLines.set("gray", neutral(recolor(grayLine), grayLine, "stroke", roles.strong));
  const tokens = new Map<string, TypedValue>(
    [...theme.tokens].map(([name, token]): [string, TypedValue] => {
      const target = token.type === "color" ? map.get(normalized(token.value) ?? "") : undefined;
      return [name, target === undefined ? token : { type: "color", value: target }];
    }),
  );
  return warmTones(
    Object.freeze({
      ...theme,
      tokens,
      base: Object.freeze({
        node: recolor(theme.base.node),
        group: recolor(theme.base.group),
        edge: recolor(theme.base.edge),
      }),
      components,
      tones,
      toneLines,
    }),
    roles.panel,
  );
}
