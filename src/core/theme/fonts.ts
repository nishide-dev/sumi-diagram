/**
 * Font sets (design doc §4.2). D2 sets the typeface for the whole diagram, so
 * a theme selects one font set; elements only choose bold, italic and mono.
 *
 * A font set has the slots `regular` and `bold` (required) and `italic` and
 * `mono` (optional). Rendering always passes all eight `--font-*` flags so
 * D2's own fonts (which lack CJK glyphs) are never used; a missing optional
 * slot is filled with the regular file.
 *
 * The optional slots `math` / `mathItalic` (#93) and `latin` / `latinBold`
 * (#172, design doc §6.44) are used by the structured layout engine only:
 * they draw runs of a label, which D2 cannot.
 */

import { join } from "node:path";
import { fontAssetsDir } from "../install-layout";

/** Font set ID: `<namespace>/<name>`, e.g. `sumi/biz-ud-gothic`. */
export type FontSetId = `${string}/${string}`;

export interface FontSet {
  id: FontSetId;
  description: string;
  /** Absolute path of the regular TTF. */
  regular: string;
  /** Absolute path of the bold TTF (also used for D2's semibold). */
  bold: string;
  /** Absolute path of the italic TTF. Without it, `italic: true` is an error. */
  italic?: string;
  /** Absolute path of the monospace TTF (all mono weights). Without it, `mono: true` is an error. */
  mono?: string;
  /**
   * Absolute path of the upright math TTF (#93): digits, operators and
   * symbols of label math (`$...$`), and characters the label's font lacks.
   * Structured figures only; D2 never receives it. Without it, label math
   * falls back to `regular`.
   */
  math?: string;
  /** Absolute path of the italic math TTF (#93): math variables (Latin, lowercase Greek). Falls back to `math`. */
  mathItalic?: string;
  /**
   * Absolute path of the Latin TTF of regular text (#172): every character
   * of regular label text that it has (Latin, Greek, digits, punctuation, …)
   * is drawn with it, and the rest (Japanese) with `regular`. Structured
   * figures only; D2 never receives it. Without it, `regular` draws all text.
   */
  latin?: string;
  /** Absolute path of the Latin TTF of bold text (#172), as `latin` for `bold`. Without it, `bold` draws all bold text. */
  latinBold?: string;
}

/**
 * Directory of the bundled fonts: `<repo>/assets/fonts` when running from
 * source, `<prefix>/share/sumi/fonts` in a release (see `install-layout.ts`).
 */
export const FONT_ASSETS_DIR = fontAssetsDir();

const bizUdGothic = join(FONT_ASSETS_DIR, "biz-ud-gothic");
const stixTwo = join(FONT_ASSETS_DIR, "stix-two");
const inter = join(FONT_ASSETS_DIR, "inter");

/** ID of the font set used by the built-in themes. */
export const DEFAULT_FONT_SET_ID: FontSetId = "sumi/biz-ud-gothic";

/**
 * ID of the font set with Latin glyphs from Inter (#172, design doc §6.44):
 * the default set plus the `latin` / `latinBold` slots, for paper figures.
 * No built-in theme uses it yet.
 */
export const LATIN_FONT_SET_ID: FontSetId = "sumi/inter-biz-ud-gothic";

const defaultFiles = {
  regular: join(bizUdGothic, "BIZUDPGothic-Regular.ttf"),
  bold: join(bizUdGothic, "BIZUDPGothic-Bold.ttf"),
  mono: join(bizUdGothic, "BIZUDGothic-Regular.ttf"),
  math: join(stixTwo, "STIXTwoMath-Regular.ttf"),
  mathItalic: join(stixTwo, "STIXTwoText-Italic.ttf"),
};

export const BUILTIN_FONT_SETS: ReadonlyMap<string, FontSet> = new Map(
  [
    {
      id: DEFAULT_FONT_SET_ID,
      description:
        "BIZ UDPGothic (regular, bold) and BIZ UDGothic (mono) v1.051: Latin and Japanese; STIX Two Math and STIX Two Text Italic v2.13 (math): label math; OFL-1.1",
      ...defaultFiles,
    } satisfies FontSet,
    {
      id: LATIN_FONT_SET_ID,
      description:
        "Inter v4.1 (latin, latinBold): Latin of regular and bold text in structured figures; BIZ UDPGothic and BIZ UDGothic v1.051: Japanese, mono and D2 figures; STIX Two v2.13: label math; OFL-1.1",
      ...defaultFiles,
      latin: join(inter, "Inter-Regular.ttf"),
      latinBold: join(inter, "Inter-Bold.ttf"),
    } satisfies FontSet,
  ].map((set) => [set.id, Object.freeze(set)]),
);

/**
 * SHA-256 (lowercase hex) of every bundled font file, by absolute path. Kept
 * in sync with `assets/fonts/<set>/README.md`; `sumi doctor` verifies them.
 */
export const BUNDLED_FONT_SHA256: ReadonlyMap<string, string> = new Map([
  [
    join(bizUdGothic, "BIZUDPGothic-Regular.ttf"),
    "5050778170c19fde190eb7ac7b3c5285bbf917d2cb0bdf184d89b6e4b6207d96",
  ],
  [
    join(bizUdGothic, "BIZUDPGothic-Bold.ttf"),
    "4372c4325944342bdd5efa489ff6204b273953c384ad3d8b4625fb58aaec5a1e",
  ],
  [
    join(bizUdGothic, "BIZUDGothic-Regular.ttf"),
    "031b7e944e42528927e141d097bff50b554de67c906513cb0737180e9ba0f2a9",
  ],
  [
    join(stixTwo, "STIXTwoMath-Regular.ttf"),
    "2e0331951fd61efb60e4247db7e1b6b7f516f224987d6290c1d45437809a0977",
  ],
  [
    join(stixTwo, "STIXTwoText-Italic.ttf"),
    "e9775b729e127624153e8a9c4518b412afb1f732cb7c501f5122527550859771",
  ],
  [
    join(inter, "Inter-Regular.ttf"),
    "40d692fce188e4471e2b3cba937be967878f631ad3ebbbdcd587687c7ebe0c82",
  ],
  [
    join(inter, "Inter-Bold.ttf"),
    "288316099b1e0a47a4716d159098005eef7c0066921f34e3200393dbdb01947f",
  ],
]);

/** The font slots of a font set, in a fixed order (for reports such as `sumi doctor`). */
export const FONT_SLOTS = [
  "regular",
  "bold",
  "italic",
  "mono",
  "math",
  "mathItalic",
  "latin",
  "latinBold",
] as const;
export type FontSlot = (typeof FONT_SLOTS)[number];

/** Returns the built-in font set with the given ID, if any. */
export function getFontSet(id: string): FontSet | undefined {
  return BUILTIN_FONT_SETS.get(id);
}

/**
 * The eight D2 `--font-*` arguments for a font set, one argv entry each
 * (design doc §4.2): `bold` also serves semibold, and `mono` all mono weights
 * and styles. Missing `italic` / `mono` slots get the regular file.
 */
export function fontSetArgs(fontSet: FontSet): string[] {
  const { regular, bold, italic = regular, mono = regular } = fontSet;
  return [
    ["--font-regular", regular],
    ["--font-italic", italic],
    ["--font-bold", bold],
    ["--font-semibold", bold],
    ["--font-mono", mono],
    ["--font-mono-bold", mono],
    ["--font-mono-italic", mono],
    ["--font-mono-semibold", mono],
  ].flat();
}
