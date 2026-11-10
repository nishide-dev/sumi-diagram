import { expect, test } from "bun:test";
import { toOklch } from "../../core/theme/color-math";

test("gallery warm paints avoid dark ochre and dull khaki", async () => {
  for (const directory of ["tones", "palettes", "sets"]) {
    for (const file of new Bun.Glob(`docs/gallery/${directory}/*.svg`).scanSync()) {
      const svg = await Bun.file(file).text();
      for (const match of svg.matchAll(/(?:fill|stroke)="(#[0-9a-f]{6})"/gi)) {
        const color = match[1] as string;
        if (
          file.endsWith("palettes.terracotta.svg") &&
          ["#875b45", "#9c6950", "#674534"].includes(color.toLowerCase())
        )
          continue;
        const { l, c, h } = toOklch(color);
        const dark = c >= 0.03 && h >= 45 && h <= 115 && l < 0.66;
        const dull = c >= 0.03 && h >= 60 && h <= 115 && l >= 0.66 && l < 0.86 && c < 0.11;
        expect(dark || dull, `${file}: ${color}`).toBe(false);
      }
    }
  }
});
