import { expect, test } from "bun:test";
import { dirname, resolve } from "node:path";
import { svgToPdf } from "./pdf/pdf";
import { svgToPptx } from "./pptx";
import { renderFigure } from "./render";

const root = resolve(import.meta.dir, "../..");
async function render(file: string) {
  const path = resolve(root, file);
  const result = await renderFigure(await Bun.file(path).text(), { assetBase: dirname(path) });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  if (!("layout" in result.value)) throw new Error("expected structured");
  return result.value;
}

test("#109 figure 2 grid fixture renders SVG, PDF and PPTX", async () => {
  const result = await render("tests/fixtures/figures/layout/grid-training.sumi.yaml");
  expect(result.layout.nodes).toHaveLength(12);
  expect(svgToPdf(result.svg).ok).toBe(true);
  expect(svgToPptx(result.svg).ok).toBe(true);
});

test("H3-World (a): row-major grid matches column stacks and align node rectangles", async () => {
  const before = await render("research/185-acceptance/figures/c-h3world.sumi.yaml");
  const after = await render("research/126-grid/c-h3world.sumi.yaml");
  expect(after.layout.nodes.map((n) => [n.key, n.rect])).toEqual(
    before.layout.nodes.map((n) => [n.key, n.rect]),
  );
  expect(after.layout.groups.map((g) => [g.key, g.rect])).toEqual(
    before.layout.groups.map((g) => [g.key, g.rect]),
  );
}, 30000);
