/**
 * Reusable assets (#310, design doc §6.91): `figure.assets`, `props.asset`,
 * `props.crop` and image cells of `tokens`.
 */

import { describe, expect, test } from "bun:test";
import { checkD2Version, findD2Binary } from "../backends/d2/binary";
import { compileFigure } from "../compiler/compile";
import { renderFigure } from "../render/render";
import { loadFigureAssets } from "./load";

const binary = findD2Binary();
const d2 = binary.ok && (await checkD2Version(binary.value.path)).ok;
const inCI = Boolean(process.env.CI);

const body =
  '<rect width="120" height="120" fill="#dde8f5"/><circle cx="60" cy="60" r="40" fill="#c04050"/>';
const photo = `<svg viewBox="0 0 120 120">${body}</svg>`;
const definition = `  assets:
    photo:
      svg: |
        ${photo}
`;
const figure = (nodes: string, assets = definition, items = "[a, b]") => `version: 1
figure:
  id: reuse
${assets}  layout: { arrange: { row: { items: ${items} } } }
nodes:
${nodes}
`;
const image = (id: string, props: string) =>
  `  - { id: ${id}, component: image, props: { width: 40pt, ${props} } }`;

function codes(text: string) {
  const result = compileFigure(text, { file: "f.sumi.yaml" });
  return result.diagnostics;
}

describe("figure.assets and props.asset", () => {
  test("images that name an asset share one import and compile to the asset reference", () => {
    const compiled = compileFigure(
      figure(`${image("a", "asset: photo")}\n${image("b", "asset: photo, crop: [0, 0, 60, 60]")}`),
    );
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    const { ir } = compiled.value;
    expect([...(ir.assets?.keys() ?? [])]).toEqual(["photo"]);
    expect(ir.nodes[0]?.image?.asset).toBe("photo");
    expect(ir.nodes[1]?.image?.crop).toEqual([0, 0, 60, 60]);
    const loaded = loadFigureAssets(ir);
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.diagnostics));
    const [a, b] = ["n:a", "n:b"].map((key) => loaded.value.nodes.get(key as never));
    expect(a?.kind === "image" && a.size).toEqual({ width: 80, height: 80 });
    expect(a?.kind === "image" && b?.kind === "image" && a.href !== b.href).toBe(true);
  });

  test("a figure without assets has no assets in its IR", () => {
    const compiled = compileFigure(
      figure(image("a", "svg: '<svg viewBox=\"0 0 1 1\"/>'"), "", "[a]"),
    );
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    expect(compiled.value.ir.assets).toBeUndefined();
  });

  test("an unknown asset is located at props.asset with the closest name", () => {
    const diagnostics = codes(figure(image("a", "asset: phto"), definition, "[a]"));
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: "asset/unknown-asset",
        path: ["nodes", 0, "props", "asset"],
        hint: 'Did you mean "photo"?',
        location: expect.objectContaining({ file: "f.sumi.yaml", line: 10 }),
      }),
    );
  });

  test("src, svg and asset are exclusive", () => {
    for (const other of ["src: x.png", `svg: '${photo}'`]) {
      const diagnostics = codes(figure(image("a", `asset: photo, ${other}`), definition, "[a]"));
      expect(diagnostics.map((d) => d.code)).toContain("component/invalid-prop");
    }
    const none = codes(figure(image("a", "fit: fill"), definition, "[a]"));
    expect(none.map((d) => d.code)).toContain("component/invalid-prop");
  });

  test("sha256 belongs to the asset, and crop needs an asset", () => {
    const sha = codes(
      figure(image("a", `asset: photo, sha256: "${"0".repeat(64)}"`), definition, "[a]"),
    );
    expect(sha).toContainEqual(
      expect.objectContaining({
        code: "asset/invalid-image",
        path: ["nodes", 0, "props", "sha256"],
      }),
    );
    const crop = codes(figure(image("a", `svg: '${photo}', crop: [0, 0, 1, 1]`), "", "[a]"));
    expect(crop).toContainEqual(
      expect.objectContaining({ code: "asset/invalid-crop", path: ["nodes", 0, "props", "crop"] }),
    );
  });

  test("asset definitions are checked once, where they are written", () => {
    const unsafe = definition.replace(photo, '<svg viewBox="0 0 1 1"><script/></svg>');
    const diagnostics = codes(figure(image("a", "asset: photo"), unsafe, "[a]"));
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: "asset/unsafe-svg",
        path: ["figure", "assets", "photo", "svg"],
        location: expect.objectContaining({ line: 7 }),
      }),
    );
    const outside = codes(
      figure(image("a", "asset: x"), "  assets:\n    x: { src: ../x.png }\n", "[a]"),
    );
    expect(outside).toContainEqual(
      expect.objectContaining({
        code: "asset/invalid-path",
        path: ["figure", "assets", "x", "src"],
        location: expect.objectContaining({ line: 5 }),
      }),
    );
    const both = codes(
      figure(image("a", "asset: x"), `  assets:\n    x: { src: a.png, svg: '${photo}' }\n`, "[a]"),
    );
    expect(both.some((d) => d.path?.[2] === "x")).toBe(true);
    const badName = codes(
      figure(image("a", "asset: X"), `  assets:\n    X: { src: a.png }\n`, "[a]"),
    );
    expect(badName.length).toBeGreaterThan(0);
  });

  test("a figure's asset that does not load is reported at its definition, and a pinned sha256 is checked", () => {
    const pinned = `  assets:\n    photo:\n      sha256: "${"0".repeat(64)}"\n      svg: '${photo}'\n`;
    const compiled = compileFigure(figure(image("a", "asset: photo"), pinned, "[a]"));
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    const loaded = loadFigureAssets(compiled.value.ir);
    expect(loaded.ok).toBe(false);
    expect(loaded.diagnostics[0]).toMatchObject({
      code: "asset/sha256-mismatch",
      path: ["figure", "assets", "photo", "svg"],
    });
    const missing = compileFigure(
      figure(image("a", "asset: x"), "  assets:\n    x: { src: nope.png }\n", "[a]"),
    );
    if (!missing.ok) throw new Error(JSON.stringify(missing.diagnostics));
    const result = loadFigureAssets(missing.value.ir, { base: import.meta.dir });
    expect(result.diagnostics[0]).toMatchObject({
      code: "asset/not-found",
      path: ["figure", "assets", "x", "src"],
    });
  });
});

describe("props.crop", () => {
  const load = (props: string, assets = definition) => {
    const compiled = compileFigure(figure(image("a", props), assets, "[a]"));
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    return loadFigureAssets(compiled.value.ir, { base: import.meta.dir });
  };
  const decode = (href: string) =>
    Buffer.from(href.slice(href.indexOf("base64,") + 7), "base64").toString("utf8");

  test("becomes the viewBox of the shared drawing, with the size scaled", () => {
    const loaded = load("asset: photo, crop: [30, 60, 60, 30]");
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.diagnostics));
    const asset = loaded.value.nodes.get("n:a" as never);
    if (asset?.kind !== "image") throw new Error("missing image");
    expect(asset.intrinsic).toEqual({ width: 60, height: 30 });
    expect(asset.size).toEqual({ width: 80, height: 40 });
    const document = decode(asset.href);
    expect(document).toContain('viewBox="30 60 60 30"');
    expect(document).toContain('width="60" height="30"');
    expect(document).toContain('r="40"');
  });

  test("outside the viewBox, or on a raster asset, is an error at props.crop", () => {
    for (const crop of ["[100, 0, 40, 40]", "[-1, 0, 10, 10]", "[0, 0, 121, 10]"]) {
      const loaded = load(`asset: photo, crop: ${crop}`);
      expect(loaded.diagnostics[0]).toMatchObject({
        code: "asset/invalid-crop",
        path: ["nodes", 0, "props", "crop"],
        subject: { kind: "node", id: "a" },
      });
      expect(loaded.diagnostics[0]?.location?.line).toBe(10);
    }
    const raster = load("asset: x, crop: [0, 0, 1, 1]", "  assets:\n    x: { src: png-rgb.png }\n");
    expect(
      raster.diagnostics[0]?.code === "asset/not-found" ||
        raster.diagnostics[0]?.code === "asset/invalid-crop",
    ).toBe(true);
  });

  test("a crop needs positive numbers (4 of them)", () => {
    for (const crop of ["[0, 0, 0, 5]", "[0, 0, 5]", "[0, 0, -1, 5]", "x"]) {
      const diagnostics = codes(
        figure(image("a", `asset: photo, crop: ${crop}`), definition, "[a]"),
      );
      expect(diagnostics.some((d) => d.code === "component/invalid-prop")).toBe(true);
    }
  });
});

describe("tokens image cells", () => {
  const tokens = (cells: string, extra = "") => `version: 1
figure:
  id: tok
${definition}  layout: { arrange: { row: { items: [t] } } }
nodes:
  - id: t
    component: tokens
    props:
      ${extra}
      cells:
${cells}
`;

  test("expand to image nodes sharing the asset, with located errors", () => {
    const compiled = compileFigure(
      tokens(
        "        - { asset: photo, crop: [0, 0, 60, 60], variant: framed }\n        - { asset: photo, id: b }\n        - x",
        "width: 30pt",
      ),
    );
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    const nodes = compiled.value.ir.nodes;
    expect(nodes.map((n) => n.id)).toEqual(["t-1", "t-b", "t-3"]);
    expect(nodes[0]?.image).toMatchObject({ asset: "photo", crop: [0, 0, 60, 60] });
    expect(nodes[1]?.image?.asset).toBe("photo");
    expect(nodes[2]?.image).toBeUndefined();

    const unknown = codes(tokens("        - { asset: nope }", "width: 30pt"));
    expect(unknown).toContainEqual(
      expect.objectContaining({
        code: "asset/unknown-asset",
        path: ["nodes", 0, "props", "cells", 0, "asset"],
      }),
    );
    const noSize = codes(tokens("        - { asset: photo }"));
    expect(noSize.some((d) => d.path?.slice(0, 5).join() === "nodes,0,props,cells,0")).toBe(true);
    const label = codes(tokens("        - { asset: photo, label: hi }", "width: 30pt"));
    expect(label).toContainEqual(
      expect.objectContaining({
        code: "component/invalid-prop",
        path: ["nodes", 0, "props", "cells", 0, "label"],
      }),
    );
    const orphan = codes(tokens("        - { crop: [0, 0, 1, 1], label: x }"));
    expect(orphan).toContainEqual(
      expect.objectContaining({ path: ["nodes", 0, "props", "cells", 0, "crop"] }),
    );
  });
});

test.skipIf(!d2 && !inCI)("an asset renders exactly like the same SVG written inline", async () => {
  const embedded = (svg: string) =>
    [...svg.matchAll(/data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+/g)].map((m) => m[0]);
  const inlineSvg = (viewBox: string) => `<svg viewBox="${viewBox}">${body}</svg>`;
  for (const [props, viewBox] of [
    ["asset: photo", "0 0 120 120"],
    ["asset: photo, crop: [30, 0, 60, 60]", "30 0 60 60"],
  ] as const) {
    const reused = await renderFigure(figure(image("a", props), definition, "[a]"));
    const inline = await renderFigure(
      figure(image("a", `svg: '${inlineSvg(viewBox)}'`), "", "[a]"),
    );
    if (!reused.ok || !inline.ok) throw new Error("render failed");
    expect(embedded(reused.value.svg).length).toBe(1);
    expect(embedded(reused.value.svg)).toEqual(embedded(inline.value.svg));
  }
});
