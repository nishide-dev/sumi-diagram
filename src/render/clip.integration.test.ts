import { expect, test } from "bun:test";
import { getTheme } from "../core/theme/builtin";
import { renderFigure } from "./render";

test("CLIP preserves mono text and colored words, with neutral ink on blue matrix cells", async () => {
  const file = new URL("../../examples/clip/clip.sumi.yaml", import.meta.url);
  const result = await renderFigure(await Bun.file(file).text(), {
    assetBase: new URL(".", file).pathname,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const { compiled, inspection } = result.value;
  const theme = getTheme("paper");
  if (!theme) throw new Error("missing paper theme");
  const label = (id: string) =>
    inspection.elements.find((element) => element.key === `n:${id}`)?.labels[0];
  for (const id of [
    "captions",
    "labels-1",
    "labels-2",
    "labels-3",
    "labels-5",
    "prompt",
    "answer",
  ]) {
    expect(label(id)?.font).toBe("mono");
    expect(
      label(id)
        ?.runs?.flat()
        .every((run) => run.font === "mono") ?? true,
    ).toBe(true);
  }
  expect(label("captions")?.text).toBe("Pepper the\naussie pup");
  for (const [id, word] of [
    ["prompt", "{object}"],
    ["answer", "dog"],
  ] as const) {
    expect(
      label(id)
        ?.runs?.flat()
        .find((run) => run.text === word),
    ).toMatchObject({
      font: "mono",
      fill: theme.toneLines.get("pink")?.fontColor,
    });
  }
  const neutral = compiled.ir.nodes.find((node) => node.id === "sim-1-2")?.style.fontColor;
  expect(neutral).toBeDefined();
  for (const id of ["sim-1-1", "sim-2-2", "sim-3-3", "sim-5-5", "scores-1-3"]) {
    const node = compiled.ir.nodes.find((node) => node.id === id);
    expect(node?.style.fill).toBe(theme.tones.get("blue")?.fill);
    expect(node?.style.stroke).toBe("#2e60ac");
    const visibleRuns = label(id)
      ?.runs?.flat()
      .filter((run) => run.text.trim() !== "");
    expect(visibleRuns?.length).toBeGreaterThan(0);
    expect(visibleRuns?.every((run) => run.fill === neutral)).toBe(true);
  }
});
