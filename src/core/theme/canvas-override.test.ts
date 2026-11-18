import { expect, test } from "bun:test";
import { checkFigure } from "../check";
import { getTheme } from "./builtin";
import { canvasTheme, figureCanvas, figureTheme } from "./overrides";

const CREAM = "#f8f8ee";

function theme(id: string) {
  const found = getTheme(id);
  if (!found) throw new Error(`missing theme ${id}`);
  return found;
}

test("sumi draws on white and sumi-dark keeps its navy canvas (#595)", () => {
  expect(theme("sumi").canvas).toBe("#ffffff");
  expect(theme("sumi").base.node.fill).toBe("#ffffff");
  expect(theme("sumi-dark").canvas).toBe("#30364f");
});

test("themeOverrides.canvas brings back the cream: sumi is built again on it", () => {
  const cream = canvasTheme(theme("sumi"), { canvas: CREAM });
  expect(cream.canvas).toBe(CREAM);
  expect(cream.base.node.fill).toBe(CREAM);
  expect(cream.base.edge.fill).toBe(CREAM);
  expect(cream.tokens.get("color.bg")?.value).toBe(CREAM);
  // The emphasis text takes the canvas, as before; a chat bubble stays white on it.
  expect(cream.components.get("sumi/box")?.get("emphasis")?.fontColor).toBe(CREAM);
  expect(cream.components.get("sumi/bubble")?.get("default")?.fill).toBe("#ffffff");
  expect(figureTheme(theme("sumi"), { canvas: CREAM }).canvas).toBe(CREAM);
});

test("another theme has the colors equal to its canvas replaced", () => {
  const minimal = theme("minimal");
  const tinted = canvasTheme(minimal, { canvas: "#fffbe6" });
  expect(tinted.canvas).toBe("#fffbe6");
  expect(tinted.base.node.fill).toBe("#fffbe6");
  expect(tinted.base.node.stroke).toBe(minimal.base.node.stroke);
  expect(canvasTheme(minimal, undefined)).toBe(minimal);
});

test("figureCanvas reads the override, else the theme's canvas", () => {
  expect(figureCanvas("sumi", undefined)).toBe("#ffffff");
  expect(figureCanvas("sumi", { canvas: "#F8F8EE" })).toBe(CREAM);
  expect(figureCanvas("nope", undefined)).toBeUndefined();
});

test("a canvas override must be an exact #RRGGBB", () => {
  const source = (canvas: string) =>
    `version: 1\nfigure:\n  id: f\n  theme: sumi\n  themeOverrides:\n    canvas: "${canvas}"\nnodes:\n  - id: a\n    component: box\n    label: A\n`;
  const codes = (canvas: string) =>
    checkFigure(source(canvas)).state.diagnostics.map((d) => d.code);
  expect(codes("#f8f8ee")).not.toContain("schema/invalid-value");
  expect(codes("cream")).toContain("schema/invalid-value");
  expect(codes("transparent")).toContain("schema/invalid-value");
});
