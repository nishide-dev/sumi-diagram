import { expect, test } from "bun:test";
import { renderOne } from "./render";
import { paletteSample } from "./samples";

test("the palette gallery has no dead space in any palette", async () => {
  const sample = paletteSample();
  for (const rendering of sample.renderings) {
    const result = await renderOne({ file: sample.fileName, source: rendering.source, rendering });
    expect(result.svg, rendering.palette).toBeDefined();
    expect(
      result.diagnostics.filter((diagnostic) => diagnostic.code === "geometry/dead-space"),
      rendering.palette,
    ).toEqual([]);
  }
});
