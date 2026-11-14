/**
 * Synthetic bold for HTML text (#495). No bold monospace face is bundled, so
 * Takumi emboldens `font-weight:bold` mono text by stroking the glyph outlines
 * (`fill` and `stroke` of one colour, stroke-width = font-size / 25). The
 * stroke grows in every direction and fuses thin gaps, so the dots of i and j
 * merge into their stems once rasterised ("figure" becomes "f|gure").
 *
 * The same weight is rebuilt by drawing the outline twice, shifted by half the
 * stroke width either way: stems get as thick as before, but nothing grows
 * vertically, so the gap under a dot is kept.
 */

const STROKED_PATH = /<path d="([^"]*)" fill="([^"]*)" stroke="\2" stroke-width="([0-9.]+)"\s*\/>/g;

export function smearSyntheticBold(svg: string): string {
  return svg.replace(STROKED_PATH, (_all, d: string, color: string, width: string) => {
    const half = Number(width) / 2;
    if (!(half > 0)) return _all;
    const path = (dx: number) => `<path d="${d}" transform="translate(${dx} 0)"/>`;
    return `<g fill="${color}">${path(-half)}${path(half)}</g>`;
  });
}
