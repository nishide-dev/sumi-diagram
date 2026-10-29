/** Filled tone variants (#214, design doc §6.63). Existing palettes stay unchanged. */
import type { StyleLayer } from "./style";

function luminance(color: string): number {
  const rgb = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(color.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (rgb[0] ?? 0) + 0.7152 * (rgb[1] ?? 0) + 0.0722 * (rgb[2] ?? 0);
}

/** Keep the pastel; darken its ink by whole percent steps until normal text meets WCAG AA. */
function tintedInk(fill: string, ink: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(fill) || !/^#[0-9a-f]{6}$/i.test(ink)) return ink;
  const background = luminance(fill);
  for (let percent = 0; percent <= 100; percent++) {
    const color = `#${[1, 3, 5]
      .map((offset) =>
        Math.round(Number.parseInt(ink.slice(offset, offset + 2), 16) * (1 - percent / 100))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")}`;
    if ((background + 0.05) / (luminance(color) + 0.05) >= 4.5) return color;
  }
  return "#000000";
}

/** A visible, tone-colored border also keeps stack's layers distinct. */
export function filledToneNode(variant: "solid" | "tinted", fill: string, ink: string): StyleLayer {
  if (variant === "solid") return { fill: ink, stroke: ink, fontColor: "#ffffff" };
  const line = tintedInk(fill, ink);
  return { fill, stroke: line, fontColor: line };
}
