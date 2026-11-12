/** Filled tone variants (#214, design doc §6.63). Existing palettes stay unchanged. */

import { fromOklch, toOklch } from "./color-math";
import type { Theme } from "./schema";
import type { StyleLayer } from "./style";

/** Derive warm paints only from chromatic tones, preserving monochrome themes. */
export function warmTones(theme: Theme, palettePanel?: string): Theme {
  if (luminance(theme.canvas) < 0.2) return theme;
  const lines = new Map(theme.toneLines);
  const solids = new Map<"yellow" | "orange", { fill: string; text: string }>();
  for (const tone of ["yellow", "orange"] as const) {
    const layer = lines.get(tone);
    const source = layer?.stroke;
    if (source === undefined || !/^#[0-9a-f]{6}$/i.test(source)) continue;
    const color = toOklch(source);
    if (color.c < 0.03) continue;
    const ink = theme.base.node.fontColor ?? "#1f2328";
    if (tone === "yellow") {
      const hue = Math.max(85, Math.min(100, color.h));
      const container = theme.components.get("sumi/container");
      const panels = [
        theme.base.group.fill,
        container?.get("default")?.fill,
        palettePanel ?? container?.get("filled")?.fill,
      ];
      const backgrounds = [
        theme.canvas,
        ...panels.filter(
          (panel): panel is string => panel !== undefined && /^#[0-9a-f]{6}$/i.test(panel),
        ),
      ];
      // Search from light to dark in fine OKLCH steps, testing the quantized sRGB paint.
      let stroke = "#000000";
      for (let step = 665; step >= 0; step--) {
        const candidate = fromOklch({ l: step / 1000, c: Math.max(0.15, color.c), h: hue });
        if (backgrounds.every((background) => contrastRatio(candidate, background) >= 3)) {
          stroke = candidate;
          break;
        }
      }
      // Text in the stroke's hue, as for the other tones (#465), darkened until it reads at 4.5:1
      // on white, on the panels and on the yellow tint it labels; the theme's ink would bring a
      // palette's navy or maroon onto the yellow.
      const tint = theme.tones.get(tone)?.fill;
      const surfaces = [
        ...backgrounds,
        ...(tint !== undefined && /^#[0-9a-f]{6}$/i.test(tint) ? [tint] : []),
      ];
      let text = ink;
      for (let step = Math.round(toOklch(stroke).l * 1000); step >= 0; step--) {
        const candidate = fromOklch({ l: step / 1000, c: Math.max(0.1, color.c), h: hue });
        if (surfaces.every((surface) => contrastRatio(candidate, surface) >= 4.5)) {
          text = candidate;
          break;
        }
      }
      lines.set(tone, Object.freeze({ ...layer, stroke, fontColor: text }));
      solids.set(tone, {
        fill: fromOklch({ l: 0.84, c: Math.max(0.16, color.c), h: hue }),
        text: ink,
      });
    } else {
      const fill = fromOklch({ l: 0.51, c: Math.max(0.18, color.c), h: Math.min(38, color.h) });
      solids.set(tone, { fill, text: "#ffffff" });
      if (theme.id === "llama" || theme.id === "color")
        lines.set(tone, Object.freeze({ ...layer, stroke: fill, fontColor: fill }));
    }
  }
  return Object.freeze({ ...theme, toneLines: lines, solidTones: solids });
}

/** WCAG relative luminance of a `#RRGGBB` color. */
export function luminance(color: string): number {
  const rgb = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(color.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (rgb[0] ?? 0) + 0.7152 * (rgb[1] ?? 0) + 0.0722 * (rgb[2] ?? 0);
}

/** WCAG contrast ratio of two `#RRGGBB` colors (#380). */
export function contrastRatio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Contrast against the white page, including the resolved element opacity. */
export function pageTextContrast(ink: string, opacity = 1, canvas = "#ffffff"): number {
  if (ink === "transparent") return 1;
  const hex = ink.length === 4 ? `#${[...ink.slice(1)].map((c) => c + c).join("")}` : ink;
  const composite = `#${[1, 3, 5]
    .map((offset) =>
      Math.round(
        Number.parseInt(canvas.slice(offset, offset + 2), 16) * (1 - opacity) +
          Number.parseInt(hex.slice(offset, offset + 2), 16) * opacity,
      )
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
  return contrastRatio(composite, canvas);
}

/** Keep passing ink on either light or dark fills; otherwise darken by whole percent steps. */
export function readableInk(fill: string, ink: string, minimum = 4.5): string {
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
    const foreground = luminance(color);
    if (
      (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05) >=
      minimum
    )
      return color;
  }
  return "#000000";
}

/** Solid stacks need white separators between overlapping tone-colored layers. */
export function filledToneNode(
  variant: "solid" | "tinted",
  fill: string,
  ink: string,
  stack = false,
): StyleLayer {
  if (variant === "solid") {
    return { fill: ink, stroke: stack ? "#ffffff" : ink, fontColor: "#ffffff" };
  }
  const line = readableInk(fill, ink);
  return { fill, stroke: line, fontColor: line };
}
