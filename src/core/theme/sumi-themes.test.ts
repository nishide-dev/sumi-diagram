import { expect, test } from "bun:test";
import { getTheme } from "./builtin";
import { contrastRatio } from "./node-variants";

test("Sumi canvases and base text contrast", () => {
  for (const [id, canvas] of [
    ["sumi", "#f8f8ee"],
    ["sumi-dark", "#30364f"],
  ] as const) {
    const theme = getTheme(id);
    expect(theme).toBeDefined();
    if (!theme) throw new Error(`missing ${id}`);
    expect(theme.canvas).toBe(canvas);
    const text = theme.base.node.fontColor ?? "";
    const panel = theme.base.group.fill ?? "";
    expect(contrastRatio(text, canvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(text, panel)).toBeGreaterThanOrEqual(4.5);
  }
});
