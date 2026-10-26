/** Icons and images (#94): the allow-list importer, the `asset` stage and the loader. */

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildFigureIR } from "../compiler/ir";
import { ASSETS_DIR } from "../compiler/testing";
import { checkFigure } from "../core/check";
import { iconNames, iconSets, iconSvg, TABLER_ARCHIVE_SHA256 } from "./icons";
import { ASSET_LIMITS, loadFigureAssets } from "./load";
import { srcProblem } from "./paths";
import { jpegSize, pngSize, sniffFormat } from "./raster";
import { importSvg } from "./svg-import";

const svg = (body: string, root = 'viewBox="0 0 10 10"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${root}>${body}</svg>`;

describe("importSvg", () => {
  test("re-serializes allowed shapes and paint; the input text is not copied", () => {
    const result = importSvg(
      svg(
        '<title>t</title><g id="a" class="c" fill="#123456" transform="translate(1 2) scale(2)"><path d="M0 0 L5 5 A2 2 0 0 1 9 9 Z"   data-x="1"/></g><circle cx="5" cy="5" r="2" style="stroke: red; stroke-width: 2px !important"/>',
      ),
    );
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value.viewBox).toEqual([0, 0, 10, 10]);
    expect(result.value.markup).toBe(
      '<g><g fill="#123456" transform="translate(1 2) scale(2)"><path d="M0 0 L5 5 A2 2 0 0 1 9 9 Z"/></g><circle cx="5" cy="5" r="2" stroke="red" stroke-width="2px"/></g>',
    );
  });

  test("replaces currentColor and drops invisible shapes when asked", () => {
    const result = importSvg(
      svg('<path d="M0 0h1" stroke="none" fill="none"/><path d="M1 1h2" stroke="currentColor"/>'),
      { currentColor: "#ff0000", dropInvisible: true },
    );
    if (!result.ok) throw new Error("rejected");
    expect(result.value.markup).toBe('<g><path d="M1 1h2" stroke="#ff0000"/></g>');
  });

  test("intrinsic size from width / height with units, else the viewBox", () => {
    const sized = importSvg(svg("", 'width="2in" height="96" viewBox="0 0 20 10"'));
    expect(sized.ok && [sized.value.width, sized.value.height]).toEqual([192, 96]);
    const fromViewBox = importSvg(svg("", 'viewBox="0 0 20 10"'));
    expect(fromViewBox.ok && [fromViewBox.value.width, fromViewBox.value.height]).toEqual([20, 10]);
    const oneSide = importSvg(svg("", 'width="40" viewBox="0 0 20 10"'));
    expect(oneSide.ok && [oneSide.value.width, oneSide.value.height]).toEqual([40, 20]);
  });

  const issues = (text: string) => {
    const result = importSvg(text);
    if (result.ok) throw new Error("accepted");
    return result.issues;
  };

  test.each([
    ["script", svg("<script>alert(1)</script>"), "<script"],
    ["event attribute", svg('<rect width="1" height="1" onload="x()"/>'), "<rect"],
    ["href", svg('<path d="M0 0" xlink:href="https://example.com/"/>'), "<path"],
    ["use", svg('<use href="#a"/>'), "<use"],
    ["image", svg('<image href="a.png"/>'), "<image"],
    ["foreignObject", svg("<foreignObject/>"), "<foreignObject"],
    ["style element", svg("<style>@import url(x.css);</style>"), "<style"],
    [
      "animation",
      svg('<rect width="1" height="1"><set attributeName="fill" to="red"/></rect>'),
      "<set",
    ],
    ["url() paint", svg('<rect width="1" height="1" fill="url(#g)"/>'), "<rect"],
    ["url() in style", svg('<rect width="1" height="1" style="fill:url(http://x/y)"/>'), "<rect"],
    [
      "namespaced script",
      svg('<svg:script xmlns:svg="http://www.w3.org/2000/svg"/>'),
      "<svg:script",
    ],
  ])("%s is unsafe, with its position", (_name, text, tag) => {
    const found = issues(text);
    expect(found.some((i) => i.kind === "unsafe")).toBe(true);
    expect(found[0]).toMatchObject({ kind: "unsafe", line: 1, column: text.indexOf(tag) + 1 });
  });

  test("a DTD or an entity is unsafe (rejected by the parser), with its position", () => {
    const dtd = issues(`<?xml version="1.0"?>\n<!DOCTYPE svg [<!ENTITY x "y">]>\n${svg("")}`);
    expect(dtd).toEqual([expect.objectContaining({ kind: "unsafe", line: 2, column: 1 })]);
    const entity = issues(svg("<title>&x;</title>"));
    expect(entity[0]?.kind).toBe("unsafe");
    const pi = issues(`<?xml-stylesheet href="x.css"?>${svg("")}`);
    expect(pi[0]?.kind).toBe("unsafe");
  });

  test("other elements and attributes are unsupported, not dropped", () => {
    expect(issues(svg('<defs><linearGradient id="g"/></defs>'))[0]?.kind).toBe("unsupported");
    expect(issues(svg("<text>x</text>"))[0]?.kind).toBe("unsupported");
    expect(issues(svg('<rect width="1" height="1" filter="x"/>'))[0]?.kind).toBe("unsupported");
    expect(issues(svg('<rect width="10%" height="1"/>'))[0]?.kind).toBe("unsupported");
    expect(issues(svg("", 'preserveAspectRatio="none" viewBox="0 0 1 1"'))[0]?.kind).toBe(
      "unsupported",
    );
  });

  test("malformed input is invalid", () => {
    expect(issues("<svg")[0]?.kind).toBe("invalid");
    expect(issues('<html xmlns="http://www.w3.org/1999/xhtml"/>')[0]?.kind).toBe("invalid");
    expect(issues('<svg xmlns="http://www.w3.org/2000/svg"/>')[0]?.message).toContain("viewBox");
    expect(issues(svg("", 'viewBox="0 0 1e999 1"'))[0]?.kind).toBe("invalid");
  });

  test("patterns stay linear on long hostile values", () => {
    const long = "1".repeat(200_000);
    const started = performance.now();
    for (const text of [
      svg(`<polygon points="${long}x"/>`),
      svg(`<rect width="${long}x" height="1"/>`),
      svg(`<g transform="translate(${" ".repeat(100_000)}"/>`),
      svg(`<rect width="1" height="1" fill="rgb(${" ".repeat(100_000)}"/>`),
    ]) {
      expect(importSvg(text).ok).toBe(false);
    }
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe("the bundled Tabler icons", () => {
  test("every icon but the Brand category, at the pinned version", () => {
    const [set] = iconSets();
    expect(set).toMatchObject({ id: "tabler", version: "3.49.0", license: "MIT", count: 4808 });
    const names = iconNames("tabler");
    expect(names).toContain("wave-sine");
    expect(names).toContain("flame");
    expect(names.some((n) => n.startsWith("brand-"))).toBe(false);
    expect(TABLER_ARCHIVE_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });

  test("every bundled icon passes the importer", () => {
    for (const name of iconNames("tabler")) {
      const result = importSvg(iconSvg("tabler", name) as string, { dropInvisible: true });
      if (!result.ok) throw new Error(`${name}: ${JSON.stringify(result.issues)}`);
      expect(result.value.viewBox).toEqual([0, 0, 24, 24]);
    }
  });
});

describe("image paths", () => {
  test.each([
    ["a.png", undefined],
    ["img/a.png", undefined],
    ["./img/../a.png", undefined],
    ["/etc/passwd", "absolute"],
    ["C:/x.png", "Windows"],
    ["https://example.com/a.png", "URL"],
    ["file:///etc/passwd", "URL"],
    ["img\\a.png", "\\"],
    ["../a.png", "leaves"],
    ["img/../../a.png", "leaves"],
    ["img/", "directory"],
    [".", "directory"],
    ["a\u0000.png", "control"],
  ])("%s", (src, problem) => {
    const found = srcProblem(src);
    if (problem === undefined) expect(found).toBeUndefined();
    else expect(found).toContain(problem);
  });
});

describe("raster headers", () => {
  test("PNG and JPEG sizes and formats", () => {
    const png = new Uint8Array(readFileSync(join(ASSETS_DIR, "gradient.png")));
    const jpeg = new Uint8Array(readFileSync(join(ASSETS_DIR, "gradient.jpg")));
    expect(sniffFormat(png)).toBe("png");
    expect(sniffFormat(jpeg)).toBe("jpeg");
    expect(sniffFormat(new TextEncoder().encode(svg("")))).toBe("svg");
    expect(sniffFormat(new TextEncoder().encode("GIF89a"))).toBeUndefined();
    expect(pngSize(png)).toEqual({ width: 64, height: 48 });
    expect(jpegSize(jpeg)).toEqual({ width: 64, height: 48 });
    expect(typeof pngSize(png.subarray(0, 20))).toBe("string");
    expect(typeof jpegSize(jpeg.subarray(0, 4))).toBe("string");
  });
});

const figure = (nodes: string) => `version: 1
figure: { id: f }
nodes:
${nodes}
`;

const checkCodes = (text: string) =>
  checkFigure(text).state.diagnostics.map((d) => [d.code, d.path?.join(".")]);

describe("the asset stage", () => {
  test("a known icon on a plain shape or label checks clean", () => {
    expect(
      checkCodes(
        figure(
          "  - { id: a, component: circle, icon: tabler/wave-sine }\n  - { id: b, component: label, icon: tabler/flame }",
        ),
      ),
    ).toEqual([]);
  });

  test("unknown icons and sets, with a suggestion", () => {
    const { state } = checkFigure(figure("  - { id: a, component: box, icon: tabler/wave-sin }"));
    expect(state.diagnostics).toEqual([
      expect.objectContaining({
        code: "asset/unknown-icon",
        path: ["nodes", 0, "icon"],
        location: expect.objectContaining({ line: 4 }),
        hint: 'Did you mean "tabler/wave-sine"?',
      }),
    ]);
    expect(checkCodes(figure("  - { id: a, component: box, icon: lucide/flame }"))).toEqual([
      ["asset/unknown-icon-set", "nodes.0.icon"],
    ]);
    expect(checkCodes(figure("  - { id: a, component: box, icon: Tabler/Flame }"))[0]?.[0]).toBe(
      "schema/invalid-value",
    );
  });

  test("an icon takes no label and goes on plain shapes only", () => {
    expect(
      checkCodes(figure("  - { id: a, component: box, label: x, icon: tabler/flame }")),
    ).toEqual([["asset/icon-with-label", "nodes.0.icon"]]);
    for (const component of [
      "{ component: operator, props: { symbol: plus } }",
      "{ component: junction }",
      "{ component: trapezoid }",
      "{ component: image, props: { src: a.png, width: 10pt } }",
    ]) {
      const node = component.replace("{ ", "{ id: a, icon: tabler/flame, ");
      expect(checkCodes(figure(`  - ${node}`))).toEqual([
        ["asset/icon-unsupported", "nodes.0.icon"],
      ]);
    }
  });

  test("image: a relative path inside the figure's directory, a size, no label", () => {
    expect(
      checkCodes(figure("  - { id: a, component: image, props: { src: ../a.png, width: 10pt } }")),
    ).toEqual([["asset/invalid-path", "nodes.0.props.src"]]);
    expect(checkCodes(figure("  - { id: a, component: image, props: { src: a.png } }"))).toEqual([
      ["component/invalid-prop", "nodes.0.props.width"],
    ]);
    expect(
      checkCodes(
        figure("  - { id: a, component: image, label: x, props: { src: a.png, width: 10pt } }"),
      ),
    ).toEqual([["component/unexpected-label", "nodes.0.label"]]);
  });
});

/** Loads the assets of a figure that checks clean; `base` defaults to the test images. */
function load(text: string, base: string | null = ASSETS_DIR) {
  const check = checkFigure(text);
  expect(check.state.diagnostics).toEqual([]);
  return loadFigureAssets(buildFigureIR(check), base === null ? {} : { base });
}

const image = (props: string) =>
  figure(`  - { id: a, component: image, props: { ${props}, width: 20pt } }`);

describe("loadFigureAssets", () => {
  test("PNG, JPEG and SVG become data: URIs with their intrinsic sizes", () => {
    const result = load(
      figure(
        [
          "  - { id: p, component: image, props: { src: gradient.png, width: 20pt } }",
          "  - { id: j, component: image, props: { src: gradient.jpg, width: 20pt } }",
          "  - { id: s, component: image, props: { src: shapes.svg, width: 20pt } }",
          "  - { id: i, component: circle, icon: tabler/wave-sine }",
        ].join("\n"),
      ),
    );
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const assets = result.value;
    const png = assets.nodes.get("n:p");
    expect(png).toMatchObject({
      kind: "image",
      format: "png",
      intrinsic: { width: 64, height: 48 },
    });
    expect(png?.kind === "image" && png.href).toBe(
      `data:image/png;base64,${readFileSync(join(ASSETS_DIR, "gradient.png")).toString("base64")}`,
    );
    expect(assets.nodes.get("n:j")).toMatchObject({ format: "jpeg" });
    const shapes = assets.nodes.get("n:s");
    expect(shapes).toMatchObject({ format: "svg", intrinsic: { width: 80, height: 40 } });
    // The SVG is re-serialized: no comment, no <title>, no XML declaration.
    const decoded =
      shapes?.kind === "image"
        ? Buffer.from(shapes.href.split(",")[1] as string, "base64").toString("utf8")
        : "";
    expect(decoded.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 40"')).toBe(
      true,
    );
    expect(decoded).not.toContain("<title");
    expect(decoded).not.toContain("<!--");
    expect(assets.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(assets.notices).toEqual([
      expect.objectContaining({ name: "Tabler Icons", version: "3.49.0", license: "MIT" }),
    ]);
    expect(assets.notices[0]?.text).toContain("Permission is hereby granted");
  });

  test("assets-sha256 follows the files and the order", () => {
    const a = load(image("src: gradient.png"));
    const b = load(image("src: gradient.jpg"));
    expect(a.ok && b.ok && a.value.sha256 !== b.value.sha256).toBe(true);
    const none = load(figure("  - { id: a, component: box, label: x }"));
    expect(none.ok && none.value.sha256).toBeUndefined();
  });

  const codes = (result: ReturnType<typeof load>) =>
    result.diagnostics.map((d) => [d.code, d.path?.join(".")]);

  test("a pinned sha256 must match", () => {
    const sha = new Bun.CryptoHasher("sha256")
      .update(readFileSync(join(ASSETS_DIR, "gradient.png")))
      .digest("hex");
    expect(load(image(`src: gradient.png, sha256: "${sha.toUpperCase()}"`)).ok).toBe(true);
    expect(codes(load(image(`src: gradient.png, sha256: "${"0".repeat(64)}"`)))).toEqual([
      ["asset/sha256-mismatch", "nodes.0.props.src"],
    ]);
  });

  test.each([
    ["unsafe-script.svg", "asset/unsafe-svg", 3],
    ["unsafe-event.svg", "asset/unsafe-svg", 2],
    ["unsafe-external.svg", "asset/unsafe-svg", 2],
    ["unsafe-dtd.svg", "asset/unsafe-svg", 2],
    ["unsafe-foreign.svg", "asset/unsafe-svg", 2],
    ["unsafe-url.svg", "asset/unsafe-svg", 2],
    ["unsupported-gradient.svg", "asset/unsupported-svg", 2],
  ])("%s → %s, located in the YAML and the SVG", (file, code, line) => {
    const result = load(image(`src: ${file}`));
    expect(result.ok).toBe(false);
    const [diagnostic] = result.diagnostics;
    expect(diagnostic).toMatchObject({
      code,
      path: ["nodes", 0, "props", "src"],
      location: expect.objectContaining({ line: 4 }),
      subject: { kind: "node", id: "a" },
    });
    expect(diagnostic?.message).toContain(`${file}:${line}:`);
    expect(diagnostic?.related?.[0]?.location).toMatchObject({ file, line });
  });

  test("missing files, other formats and misnamed files", () => {
    const dir = mkdtempSync(join(tmpdir(), "sumi-assets-"));
    writeFileSync(join(dir, "real.png"), readFileSync(join(ASSETS_DIR, "gradient.png")));
    writeFileSync(join(dir, "fake.png"), readFileSync(join(ASSETS_DIR, "gradient.jpg")));
    writeFileSync(join(dir, "anim.gif"), "GIF89a....");
    writeFileSync(join(dir, "noext"), readFileSync(join(ASSETS_DIR, "gradient.png")));
    writeFileSync(
      join(dir, "broken.png"),
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]),
    );
    mkdirSync(join(dir, "folder.png"));
    const at = (src: string) => codes(load(image(`src: ${src}`), dir))[0]?.[0];
    expect(at("missing.png")).toBe("asset/not-found");
    expect(at("folder.png")).toBe("asset/not-found");
    expect(at("fake.png")).toBe("asset/format-mismatch");
    expect(at("anim.gif")).toBe("asset/unsupported-format");
    expect(at("noext")).toBe("asset/format-mismatch");
    expect(at("broken.png")).toBe("asset/invalid-image");
    expect(load(image("src: real.png"), dir).ok).toBe(true);
    // An aspect ratio that would make the other side absurd.
    writeFileSync(join(dir, "thin.svg"), svg("", 'viewBox="0 0 1 100000"'));
    expect(at("thin.svg")).toBe("asset/invalid-image");
    expect(codes(load(image("src: real.png"), null))).toEqual([
      ["asset/no-base-directory", "nodes.0.props.src"],
    ]);
  });

  test("a symbolic link out of the figure's directory is refused", () => {
    const outside = mkdtempSync(join(tmpdir(), "sumi-outside-"));
    const dir = mkdtempSync(join(tmpdir(), "sumi-assets-"));
    writeFileSync(join(outside, "secret.png"), readFileSync(join(ASSETS_DIR, "gradient.png")));
    symlinkSync(join(outside, "secret.png"), join(dir, "link.png"));
    symlinkSync(outside, join(dir, "linked-dir"));
    expect(codes(load(image("src: link.png"), dir))[0]?.[0]).toBe("asset/outside-base");
    expect(codes(load(image("src: linked-dir/secret.png"), dir))[0]?.[0]).toBe(
      "asset/outside-base",
    );
  });

  test("size limits: per file, per figure and pixels", () => {
    const dir = mkdtempSync(join(tmpdir(), "sumi-assets-"));
    // A PNG header claiming 9000 × 10 pixels (the data is never decoded).
    const header = new Uint8Array(readFileSync(join(ASSETS_DIR, "gradient.png")));
    const wide = header.slice();
    new DataView(wide.buffer).setUint32(16, 9000);
    writeFileSync(join(dir, "wide.png"), wide);
    expect(codes(load(image("src: wide.png"), dir))[0]?.[0]).toBe("asset/too-many-pixels");
    const big = new Uint8Array(ASSET_LIMITS.maxFileBytes + 1);
    big.set(header);
    writeFileSync(join(dir, "big.png"), big);
    expect(codes(load(image("src: big.png"), dir))[0]?.[0]).toBe("asset/too-large");
    const half = new Uint8Array(ASSET_LIMITS.maxFileBytes);
    half.set(header);
    writeFileSync(join(dir, "half.png"), half);
    const three = figure(
      ["a", "b", "c"]
        .map((id) => `  - { id: ${id}, component: image, props: { src: half.png, width: 20pt } }`)
        .join("\n"),
    );
    expect(codes(load(three, dir))).toEqual([["asset/too-large", "nodes.2.props.src"]]);
  });
});
