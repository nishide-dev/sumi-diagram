/**
 * #167 prototype P3: how small would the text have to be for figures B and
 * C to fit paper-double (180mm) as drawn, without rearranging them?
 *
 * Registers, in this process only, copies of the `color` theme with smaller
 * text sizes (and a copy of `paper-double` whose minimum font size is low
 * enough to accept them), then renders figures B and C with the product's
 * renderFigure() and reads the width. Node padding, gaps, arrowheads and
 * line widths are unchanged, so this isolates the effect of the type size.
 * It also reports the "scale-to-fit" alternative: the factor LaTeX would
 * apply to the 8pt figure (\includegraphics[width=\textwidth]) and the
 * smallest text that results.
 * Usage: bun research/167-stage-c/proto/compact.ts   → results/compact.json
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { BUILTIN_PROFILE_DEFINITIONS, BUILTIN_PROFILES } from "../../../src/core/profile/builtin";
import type { Profile } from "../../../src/core/profile/schema";
import { validateProfile } from "../../../src/core/profile/schema";
import { BUILTIN_THEME_DEFINITIONS, BUILTIN_THEMES } from "../../../src/core/theme/builtin";
import type { Theme } from "../../../src/core/theme/schema";
import { validateTheme } from "../../../src/core/theme/schema";
import { renderFigure } from "../../../src/render/render";

const HERE = dirname(import.meta.dir);
const SIZES = [
  { id: "color", text: "8pt", small: "7pt", heading: "9pt" },
  { id: "color-7", text: "7pt", small: "6.5pt", heading: "7.5pt" },
  { id: "color-6", text: "6pt", small: "5.5pt", heading: "6.5pt" },
] as const;

const color = BUILTIN_THEME_DEFINITIONS.find((t) => t.id === "color");
if (color === undefined) throw new Error("no color theme");
for (const s of SIZES.slice(1)) {
  const def = structuredClone(color) as unknown as {
    id: string;
    tokens: { size: Record<string, string> };
  };
  def.id = s.id;
  def.tokens.size = { text: s.text, small: s.small, heading: s.heading };
  const theme = validateTheme(def);
  if (!theme.ok) throw new Error(JSON.stringify(theme.diagnostics));
  (BUILTIN_THEMES as Map<string, Theme>).set(s.id, theme.value);
}
const double = BUILTIN_PROFILE_DEFINITIONS.find((p) => p.id === "paper-double");
if (double === undefined) throw new Error("no paper-double");
const low = validateProfile({
  ...structuredClone(double),
  id: "paper-double-lowmin",
  typography: { minFontSize: "5pt" },
});
if (!low.ok) throw new Error(JSON.stringify(low.diagnostics));
(BUILTIN_PROFILES as Map<string, Profile>).set("paper-double-lowmin", low.value);
// Compact spacing: half the node and group padding (the references pack
// one-line boxes with little air; DiT's blocks are about 2.2× their text height).
const compact = validateProfile({
  ...structuredClone(double),
  id: "paper-double-compact",
  typography: { minFontSize: "5pt" },
  layout: {
    ...(structuredClone(double) as { layout: Record<string, string> }).layout,
    groupPadding: "4pt",
    nodePaddingX: "3.5pt",
    nodePaddingY: "1.5pt",
  },
});
if (!compact.ok) throw new Error(JSON.stringify(compact.diagnostics));
(BUILTIN_PROFILES as Map<string, Profile>).set("paper-double-compact", compact.value);
const CASES = [
  ...SIZES.map((s) => ({ ...s, profile: "paper-double-lowmin" })),
  { ...SIZES[2], profile: "paper-double-compact" },
];

const results: Record<string, unknown> = {};
for (const name of ["b-dit", "c-h3world"]) {
  const file = join(HERE, "figures", `${name}.sumi.yaml`);
  const text = readFileSync(file, "utf8");
  const rows: unknown[] = [];
  for (const s of CASES) {
    const variant = text
      .replace(/theme: color\b/, `theme: ${s.id}`)
      .replace(/profile: paper-double\b/, `profile: ${s.profile}`);
    const r = await renderFigure(variant, { assetBase: dirname(file) });
    if (!r.ok) {
      rows.push({ theme: s.id, profile: s.profile, error: r.diagnostics.map((d) => d.code) });
      continue;
    }
    const m = /width="([\d.]+)pt" height="([\d.]+)pt"/.exec(r.value.svg);
    const widthMm = m ? (Number(m[1]) * 25.4) / 72 : Number.NaN;
    const heightMm = m ? (Number(m[2]) * 25.4) / 72 : Number.NaN;
    const scale = Math.min(1, 180 / widthMm);
    rows.push({
      theme: s.id,
      profile: s.profile,
      text: s.text,
      edgeText: s.small,
      widthMm: Math.round(widthMm * 10) / 10,
      heightMm: Math.round(heightMm * 10) / 10,
      fits180: widthMm <= 180,
      heightAfterScaleMm: Math.round(heightMm * scale * 10) / 10,
      scaleToFit: Math.round(scale * 1000) / 1000,
      textAfterScalePt: Math.round(Number.parseFloat(s.text) * scale * 10) / 10,
      edgeTextAfterScalePt: Math.round(Number.parseFloat(s.small) * scale * 10) / 10,
      subscriptAfterScalePt: Math.round(Number.parseFloat(s.small) * 0.7 * scale * 10) / 10,
    });
  }
  results[name] = rows;
  console.log(name);
  console.table(rows);
}
mkdirSync(join(HERE, "results"), { recursive: true });
writeFileSync(join(HERE, "results/compact.json"), `${JSON.stringify(results, null, 2)}\n`);
