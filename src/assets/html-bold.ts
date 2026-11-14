/**
 * Synthetic bold for HTML text (#495). No bold monospace face is bundled, so
 * Takumi emboldens `font-weight:bold` mono text by stroking the glyph outlines
 * (stroke-width = font-size / 25). The stroke grows in every direction and
 * fuses thin gaps, so the dots of i and j merge into their stems once
 * rasterised ("figure" becomes "f|gure").
 *
 * The same weight is rebuilt by drawing the outline twice, shifted by half the
 * stroke width either way: stems get as thick as before, but nothing grows
 * vertically, so the gap under a dot is kept.
 *
 * Identification: a `<path>` is a synthetic-bold glyph when its fill is a real
 * paint, its stroke is the same paint (colour and opacity) and it carries a
 * positive stroke-width and no dash, cap, join or other stroke attribute.
 * Takumi draws backgrounds and borders as fill-only or `fill="none"` paths
 * (borders: dashed strokes with `fill="none"`), so they never match.
 * Attributes may come in any order; a path-level `transform` is kept.
 */

const PATH = /<path\s+([^>]*?)\s*\/>/g;
const ATTR = /([a-zA-Z:-]+)="([^"]*)"/g;
const STROKE_EXTRAS = new Set([
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
]);

function syntheticBold(attrs: Map<string, string>): number | undefined {
  const fill = attrs.get("fill");
  const stroke = attrs.get("stroke");
  if (!fill || fill === "none" || stroke !== fill) return undefined;
  if ((attrs.get("fill-opacity") ?? "1") !== (attrs.get("stroke-opacity") ?? "1")) return undefined;
  if ([...attrs.keys()].some((k) => STROKE_EXTRAS.has(k))) return undefined;
  const width = Number(attrs.get("stroke-width"));
  return width > 0 ? width : undefined;
}

export function smearSyntheticBold(svg: string): string {
  return svg.replace(PATH, (all, body: string) => {
    const attrs = new Map<string, string>();
    for (const m of body.matchAll(ATTR)) attrs.set(m[1] as string, m[2] as string);
    const width = syntheticBold(attrs);
    if (width === undefined || !attrs.has("d")) return all;
    const half = width / 2;
    const opacity = attrs.get("fill-opacity");
    const transform = attrs.get("transform");
    const copy = (dx: number) => {
      const shift = `translate(${dx} 0)`;
      const list = [
        `d="${attrs.get("d")}"`,
        `transform="${transform ? `${transform} ${shift}` : shift}"`,
      ];
      for (const [k, v] of attrs) {
        if (
          [
            "d",
            "transform",
            "stroke",
            "stroke-width",
            "stroke-opacity",
            "fill",
            "fill-opacity",
          ].includes(k)
        )
          continue;
        list.push(`${k}="${v}"`);
      }
      return `<path ${list.join(" ")}/>`;
    };
    return `<g fill="${attrs.get("fill")}"${opacity ? ` opacity="${opacity}"` : ""}>${copy(-half)}${copy(half)}</g>`;
  });
}
