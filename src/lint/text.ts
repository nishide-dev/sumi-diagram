/**
 * Label text helpers for lint rules: line splitting, display width and the
 * characters that need a glyph.
 */

/** Line breaks as the compiler lowers them (`\r\n`, `\r`, `\n`). */
const LINE_BREAK = /\r\n|\r|\n/;

/** Splits a label into its lines. */
export function labelLines(label: string): string[] {
  return label.split(LINE_BREAK);
}

const segmenter = new Intl.Segmenter("und", { granularity: "grapheme" });

/**
 * East Asian Wide (W) and Fullwidth (F) ranges of UAX #11, merged into the
 * blocks that matter for labels. Emoji are handled separately.
 */
const WIDE_RANGES: readonly [number, number][] = [
  [0x1100, 0x115f], // Hangul Jamo initial consonants
  [0x2e80, 0x303e], // CJK radicals, Kangxi radicals, ideographic description, CJK symbols and punctuation
  [0x3041, 0x33ff], // Hiragana, Katakana, Bopomofo, Hangul compatibility Jamo, Kanbun, CJK strokes, enclosed CJK, CJK compatibility
  [0x3400, 0x4dbf], // CJK Unified Ideographs Extension A
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0xa000, 0xa4cf], // Yi
  [0xa960, 0xa97f], // Hangul Jamo Extended-A
  [0xac00, 0xd7a3], // Hangul syllables
  [0xf900, 0xfaff], // CJK compatibility ideographs
  [0xfe10, 0xfe19], // Vertical forms
  [0xfe30, 0xfe6f], // CJK compatibility forms, small form variants
  [0xff00, 0xff60], // Fullwidth forms
  [0xffe0, 0xffe6], // Fullwidth signs
  [0x1b000, 0x1b2ff], // Kana supplement and extensions
  [0x1f200, 0x1f2ff], // Enclosed ideographic supplement
  [0x20000, 0x2fffd], // CJK Unified Ideographs Extensions B–F, compatibility supplement
  [0x30000, 0x3fffd], // CJK Unified Ideographs Extensions G–H
];

const EMOJI_PRESENTATION = /\p{Emoji_Presentation}|\p{Extended_Pictographic}️/u;

function isWide(codePoint: number): boolean {
  return WIDE_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end);
}

/**
 * Display width of one line in columns, like a terminal: each grapheme cluster
 * counts 2 if it is East Asian Wide / Fullwidth (CJK, kana, Hangul, fullwidth
 * forms) or an emoji shown as an emoji, otherwise 1. So "API" is 3 columns and
 * "認証サーバ" is 10. Combining marks and joiners do not add width because
 * they belong to the cluster of their base character.
 */
export function displayWidth(line: string): number {
  let width = 0;
  for (const { segment } of segmenter.segment(line)) {
    const first = segment.codePointAt(0) ?? 0;
    width += isWide(first) || EMOJI_PRESENTATION.test(segment) ? 2 : 1;
  }
  return width;
}

/**
 * Characters that are not drawn as glyphs: whitespace (including line breaks),
 * control characters, and default-ignorable code points such as variation
 * selectors and zero-width joiners. They never count as missing glyphs.
 */
const NO_GLYPH = /[\p{White_Space}\p{Cc}\p{Default_Ignorable_Code_Point}]/u;

/** The distinct code points of `text` that need a glyph, in order of first appearance. */
export function glyphCodePoints(text: string): number[] {
  const seen = new Set<number>();
  for (const char of text) {
    const codePoint = char.codePointAt(0);
    if (codePoint !== undefined && !NO_GLYPH.test(char)) seen.add(codePoint);
  }
  return [...seen];
}

/** `U+1F600` style code point notation. */
export function formatCodePoint(codePoint: number): string {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
}
