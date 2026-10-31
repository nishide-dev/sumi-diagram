import { expect, test } from "bun:test";
import { compileFigure } from "../compiler/compile";
import { ASSETS_DIR } from "../compiler/testing";
import { ASSET_LIMITS, loadFigureAssets } from "./load";
import { SVG_IMPORT_LIMITS } from "./svg-import";

const svg =
  '<svg viewBox="0 0 100 50"><path d="M0 25L50 5L100 25" fill="none" stroke="red"/></svg>';
const source = (props: string) => `version: 1
figure: { id: inline, layout: { arrange: { row: { items: [drawing] } } } }
nodes:
  - id: drawing
    component: image
    props:
      width: 40pt
${props}
`;
const inline = (value: string) =>
  source(
    `      svg: |\n${value
      .split("\n")
      .map((l) => `        ${l}`)
      .join("\n")}`,
  );

test("image requires exactly one source, and retains the original inline source", () => {
  for (const props of ["", `      src: vector.svg\n      svg: '${svg}'`]) {
    const result = compileFigure(source(props));
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "component/invalid-prop")).toBe(true);
  }
  const compiled = compileFigure(inline(svg));
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  expect(compiled.value.ir.nodes[0]?.image?.svg).toBe(`${svg}\n`);
  const loaded = loadFigureAssets(compiled.value.ir);
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.diagnostics));
  const asset = loaded.value.nodes.get("n:drawing");
  expect(asset?.kind === "image" && asset.size).toEqual({ width: 80, height: 40 });
  const digest = new Bun.CryptoHasher("sha256").update(`${svg}\n`).digest("hex");
  expect(loaded.value.sha256).toBe(
    new Bun.CryptoHasher("sha256").update(`inline-svg drawing ${digest}\n`).digest("hex"),
  );
});

test("inline SVG issues point into literal blocks and escaped quoted scalars", () => {
  for (const [content, code] of [
    ["<script/>", "asset/unsafe-svg"],
    ['<rect onclick="alert(1)"/>', "asset/unsafe-svg"],
    ['<use href="https://example.com/x.svg"/>', "asset/unsafe-svg"],
    ["<foreignObject/>", "asset/unsafe-svg"],
    ["<text>hello</text>", "asset/unsupported-svg"],
    ["<defs/>", "asset/unsupported-svg"],
  ]) {
    const value = `<svg viewBox="0 0 10 10">\n${content}\n</svg>`;
    const result = compileFigure(inline(value), { file: "drawing.sumi.yaml" });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code,
        path: ["nodes", 0, "props", "svg"],
        location: expect.objectContaining({ file: "drawing.sumi.yaml", line: 10 }),
      }),
    );
    const quoted = compileFigure(source(`      svg: ${JSON.stringify(value)}`));
    expect(quoted.ok).toBe(false);
    expect(quoted.diagnostics[0]?.location?.line).toBe(8);
    expect(quoted.diagnostics[0]?.location?.column).toBeGreaterThan(20);
  }
});

test("byte, element and depth budgets also apply to inline sources", () => {
  for (const value of [
    `<svg viewBox="0 0 1 1">${"<g>".repeat(SVG_IMPORT_LIMITS.maxDepth + 1)}${"</g>".repeat(SVG_IMPORT_LIMITS.maxDepth + 1)}</svg>`,
    `<svg viewBox="0 0 1 1">${"<rect/>".repeat(SVG_IMPORT_LIMITS.maxElements + 1)}</svg>`,
  ])
    expect(compileFigure(inline(value)).ok).toBe(false);
  const tooBig = compileFigure(
    inline(`<svg viewBox="0 0 1 1"><!--${"a".repeat(ASSET_LIMITS.maxFileBytes)}--></svg>`),
  );
  expect(tooBig.diagnostics.some((d) => d.code === "asset/too-large")).toBe(true);
});

test("inline and file images share the total byte budget; sha256 pins raw UTF-8", () => {
  const compiled = compileFigure(inline(svg));
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  const node = compiled.value.ir.nodes[0];
  if (node?.image === undefined) throw new Error("missing image");
  const image = node.image;
  const empty = '<svg viewBox="0 0 1 1"><!----></svg>';
  const large = empty.replace(
    "<!---->",
    `<!--${"a".repeat(ASSET_LIMITS.maxFileBytes - empty.length)}-->`,
  );
  const nodes = Array.from({ length: 2 }, (_, i) => ({
    ...node,
    id: `inline-${i}`,
    image: { ...image, svg: large },
  }));
  const file = {
    ...node,
    id: "file",
    image: { src: "shapes.svg", fit: "contain" as const, srcAt: image.srcAt },
  };
  const loaded = loadFigureAssets(
    {
      ...compiled.value.ir,
      nodes: [...nodes, file],
    },
    { base: ASSETS_DIR },
  );
  expect(loaded.ok).toBe(false);
  expect(loaded.diagnostics.some((d) => d.code === "asset/too-large")).toBe(true);
  expect(loaded.diagnostics.find((d) => d.code === "asset/too-large")?.subject?.id).toBe("file");
  const pinned = loadFigureAssets({
    ...compiled.value.ir,
    nodes: [{ ...node, image: { ...image, sha256: "0".repeat(64) } }],
  });
  expect(pinned.diagnostics[0]?.code).toBe("asset/sha256-mismatch");
});
