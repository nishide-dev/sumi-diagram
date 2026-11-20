import { expect, test } from "bun:test";
import { getTheme } from "./builtin";
import { contrastRatio } from "./node-variants";
import { resolveStyle } from "./resolve";

test("Sumi canvases and base text contrast", () => {
  for (const [id, canvas] of [
    ["sumi", "#ffffff"],
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

test("Sumi panels are the canvas with a gray frame; filled is the sand shade (#608)", () => {
  for (const id of ["sumi", "sumi-dark"] as const) {
    const theme = getTheme(id);
    if (!theme) throw new Error(`missing ${id}`);
    const group = (variant: string) =>
      resolveStyle(theme, { kind: "group", id: "sumi/container", variant }).style;
    expect(group("default").fill, `${id} default`).toBe(theme.canvas);
    expect(group("muted").fill, `${id} muted`).toBe(theme.canvas);
    expect(group("filled").fill, `${id} filled`).not.toBe(theme.canvas);
  }
  expect(
    resolveStyle(getTheme("sumi") as NonNullable<ReturnType<typeof getTheme>>, {
      kind: "group",
      id: "sumi/container",
      variant: "filled",
    }).style.fill,
  ).toBe("#e1d9bc");
});
