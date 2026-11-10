import { expect, test } from "bun:test";
import { toOklch } from "../../core/theme/color-math";
import { muddinessOf } from "./color-composition";

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
        const value = toOklch(color);
        expect(muddinessOf(value, value), `${file}: ${color}`).toBeUndefined();
      }
    }
  }
});
