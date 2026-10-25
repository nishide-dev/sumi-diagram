/**
 * Which characters the reference figures need are covered by the bundled
 * font set (BIZ UDPGothic / BIZ UDGothic v1.051), read with the product's
 * cmap reader (the same one `lint/missing-glyph` uses).
 */

import { getFontSet } from "../../../src/core/theme/fonts";
import { loadGlyphCoverage } from "../../../src/lint/cmap";
import { loadFontMetrics } from "../../../src/lint/metrics";

/** Characters used by figures A/B/C, grouped by purpose. */
export const NEEDED: Record<string, string> = {
  greekLower: "αβγδεθλμσφψω",
  greekUpper: "ΣΔΩΦ",
  subscriptDigits: "₀₁₂₃₄₅₆₇₈₉",
  superscriptDigits: "⁰¹²³⁴⁵⁶⁷⁸⁹",
  subscriptLetters: "ₐₑₒₓₜ",
  operators: "⊕⊗×·∼≈≤≥∑∏∈→↔⋯…",
  mathItalic: "𝑥𝑦𝑡𝛼𝛽𝛾",
  emoji: "🔥❄",
};

export interface GlyphReport {
  font: string;
  groups: Record<string, { covered: number; total: number; missing: string }>;
  /** Advance widths in em of sample Latin vs Greek letters (Greek is full-width in a CJK font). */
  advancesEm: Record<string, number>;
}

const ADVANCE_SAMPLES = "axαβγΣ×";

export function measureGlyphs(): GlyphReport[] {
  const set = getFontSet("sumi/biz-ud-gothic");
  if (set === undefined) throw new Error("font set");
  const files = { regular: set.regular, bold: set.bold, mono: set.mono ?? set.regular };
  return Object.entries(files).map(([slot, path]) => {
    const coverage = loadGlyphCoverage(path);
    const groups: GlyphReport["groups"] = {};
    for (const [name, chars] of Object.entries(NEEDED)) {
      const list = [...chars];
      const missing = list.filter((c) => !coverage.has(c.codePointAt(0) ?? 0));
      groups[name] = {
        covered: list.length - missing.length,
        total: list.length,
        missing: missing.join(""),
      };
    }
    const metrics = loadFontMetrics(path);
    const advancesEm: Record<string, number> = {};
    for (const c of ADVANCE_SAMPLES)
      advancesEm[c] = Number(
        (metrics.advanceOf(c.codePointAt(0) ?? 0) / metrics.unitsPerEm).toFixed(4),
      );
    return { font: `${slot}:${path.split("/").pop()}`, groups, advancesEm };
  });
}

if (import.meta.main) console.log(JSON.stringify(measureGlyphs(), null, 2));
