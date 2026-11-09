/**
 * Perceptual color math for the palette-derived tones (#423) and the
 * color-harmony lint: sRGB (`#rrggbb`) to OKLab / OKLCH (Ottosson, 2020) and
 * CIELAB, gamut mapping that keeps lightness and hue, and the CIE76 color
 * difference. Pure functions on hex strings; no theme knowledge.
 */

export interface Oklch {
  /** Lightness, 0 (black) to 1 (white). */
  readonly l: number;
  /** Chroma, 0 (gray) to about 0.32. */
  readonly c: number;
  /** Hue in degrees, 0 <= h < 360. */
  readonly h: number;
}

const toLinear = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const fromLinear = (v: number): number =>
  v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;

/** `#rrggbb` as linear-light RGB in 0..1. */
export function linearRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((o) => toLinear(Number.parseInt(hex.slice(o, o + 2), 16) / 255)) as [
    number,
    number,
    number,
  ];
}

/** The color in OKLab: `[L, a, b]`. */
export function toOklab(hex: string): [number, number, number] {
  const [r, g, b] = linearRgb(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function toOklch(hex: string): Oklch {
  const [l, a, b] = toOklab(hex);
  const c = Math.hypot(a, b);
  return {
    l,
    c,
    h: c < 1e-4 ? 0 : (((Math.atan2(b, a) * 180) / Math.PI) % 360) + (b < 0 ? 360 : 0),
  };
}

/** The linear RGB of an OKLCH color, unclamped (outside 0..1 when out of gamut). */
function oklchToLinear({ l, c, h }: Oklch): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

const inGamut = (rgb: readonly number[]): boolean => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

/**
 * The OKLCH color as `#rrggbb`. A color outside sRGB keeps its lightness and
 * hue and loses chroma (bisection) until it fits, so a pastel never shifts
 * hue the way a per-channel clamp would.
 */
export function fromOklch(color: Oklch): string {
  let candidate = color;
  if (!inGamut(oklchToLinear(candidate))) {
    let [low, high] = [0, color.c];
    for (let i = 0; i < 24; i++) {
      const mid = (low + high) / 2;
      if (inGamut(oklchToLinear({ ...color, c: mid }))) low = mid;
      else high = mid;
    }
    candidate = { ...color, c: low };
  }
  const rgb = oklchToLinear(candidate).map((v) =>
    Math.round(255 * fromLinear(Math.min(1, Math.max(0, v)))),
  );
  return `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** CIELAB (D65) `[L*, a*, b*]` of linear RGB. */
function labOfLinear([r, g, b]: readonly number[] & [number, number, number]): [
  number,
  number,
  number,
] {
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 / 116) * t + 16 / 116);
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

export function toLab(hex: string): [number, number, number] {
  return labOfLinear(linearRgb(hex));
}

/** CIE76 color difference of two `#rrggbb` colors. */
export function deltaE(a: string, b: string): number {
  const [x, y] = [toLab(a), toLab(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

/** Machado, Oliveira and Fernandes (2009) matrices, severity 1.0, on linear RGB. */
export const COLOR_VISION = {
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
} as const;

export type ColorVision = keyof typeof COLOR_VISION;

/** CIE76 difference of two colors as seen with the given color vision deficiency. */
export function deltaEUnder(vision: ColorVision, a: string, b: string): number {
  const matrix = COLOR_VISION[vision];
  const see = (hex: string) => {
    const linear = linearRgb(hex);
    return labOfLinear(
      matrix.map((row) =>
        Math.min(
          1,
          Math.max(
            0,
            row.reduce((sum, m, i) => sum + m * (linear[i] ?? 0), 0),
          ),
        ),
      ) as [number, number, number],
    );
  };
  const [x, y] = [see(a), see(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

/** CIE L* (0..100) of a color: its gray level. */
export const lightness = (hex: string): number => toLab(hex)[0];
