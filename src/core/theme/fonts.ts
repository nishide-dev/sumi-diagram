/**
 * Font sets (design doc §4.2). D2 sets the typeface for the whole diagram, so
 * a theme selects one font set; elements only choose bold, italic and mono.
 *
 * A font set has the slots `regular` and `bold` (required) and `italic` and
 * `mono` (optional). Rendering always passes all eight `--font-*` flags so
 * D2's own fonts (which lack CJK glyphs) are never used; a missing optional
 * slot is filled with the regular file.
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
}

/**
 * Directory of the bundled fonts: `<repo>/assets/fonts` when running from
 * source, `<prefix>/share/sumi/fonts` in a release (see `install-layout.ts`).
 */
export const FONT_ASSETS_DIR = fontAssetsDir();

const bizUdGothic = join(FONT_ASSETS_DIR, "biz-ud-gothic");
const stixTwo = join(FONT_ASSETS_DIR, "stix-two");

/** ID of the font set used by the built-in themes. */
export const DEFAULT_FONT_SET_ID: FontSetId = "sumi/biz-ud-gothic";

export const BUILTIN_FONT_SETS: ReadonlyMap<string, FontSet> = new Map(
  [
    {
      id: DEFAULT_FONT_SET_ID,
      description:
        "BIZ UDPGothic (regular, bold) and BIZ UDGothic (mono) v1.051: Latin and Japanese; STIX Two Math and STIX Two Text Italic v2.13 (math): label math; OFL-1.1",
      regular: join(bizUdGothic, "BIZUDPGothic-Regular.ttf"),
      bold: join(bizUdGothic, "BIZUDPGothic-Bold.ttf"),
      mono: join(bizUdGothic, "BIZUDGothic-Regular.ttf"),
      math: join(stixTwo, "STIXTwoMath-Regular.ttf"),
      mathItalic: join(stixTwo, "STIXTwoText-Italic.ttf"),
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
]);

/** The font slots of a font set, in a fixed order (for reports such as `sumi doctor`). */
export const FONT_SLOTS = ["regular", "bold", "italic", "mono", "math", "mathItalic"] as const;
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
