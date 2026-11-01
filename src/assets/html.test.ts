import { expect, test } from "bun:test";
import { compileFigure } from "../compiler/compile";
import { BUILTIN_THEMES } from "../core/theme/builtin";
import { svgToPdf } from "../render/pdf";
import { svgToEditablePptx, svgToPptx } from "../render/pptx";
import { renderFigure } from "../render/render";
import { HTML_LIMITS, htmlViewport, validateHtml } from "./html";
import { htmlThemeVariables, renderHtmlAssets } from "./html-render";

const source = (html: string, extra = "", engine = "structured") => `version: 1
figure:
  id: html-test
  layout: ${engine === "structured" ? "{ arrange: { row: { items: [card] } } }" : "{ direction: right }"}
nodes:
  - id: card
    component: html
    props:
      viewport: 320x176
${extra}      html: |
${html
  .split("\n")
  .map((l) => `        ${l}`)
  .join("\n")}
`;
const content =
  '<div style="display:flex;flex-direction:column;padding:12px;width:320px;height:176px;background-color:var(--sumi-bg);border:2px solid var(--sumi-accent);border-radius:8px"><b style="font-size:24px">Hello 日本語</b><div style="font-family:var(--sumi-mono);white-space:pre">  code()</div></div>';

test("HTML accepts the subset and rejects unsupported tags, attributes and CSS at YAML locations", () => {
  expect(validateHtml(content)).toEqual([]);
  expect(
    validateHtml(
      '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:4px"><span>A</span><i>B</i><br/></div>',
    ),
  ).toEqual([]);
  for (const [bad, code] of [
    ['<img src="https://example.com/a.png">', "asset/unsafe-html"],
    ["<svg></svg>", "asset/unsafe-html"],
    ["<style></style>", "asset/unsafe-html"],
    ['<div onclick="x()"></div>', "asset/unsafe-html"],
    ['<div class="x"></div>', "asset/unsafe-html"],
    [`${"<div/>".repeat(30)}<span>Hi</span>`, "asset/unsafe-html"],
    ['<div\u00a0style="color:red"></div>', "asset/unsafe-html"],
    ['<div style\u00a0="color:red"></div>', "asset/unsafe-html"],
    ...[
      "float:left",
      "overflow:hidden",
      "transform:rotate(1deg)",
      "box-shadow:0 0 1px black",
      "text-shadow:0 0 1px black",
      "filter:blur(2px)",
      "background-color:linear-gradient(red,blue)",
      "color:url(https://example.com)",
      "color:var(--other)",
      "font-family:Arial",
      "--sumi-fg:red",
      "color:r&#101;d",
      "color:red!important",
      "width:potato",
      "font-size:12bananas",
      "flex-direction:banana",
      "color:potato",
      "width:var(--sumi-font)",
      "color:'; width:12px; color:'",
      "color:var(--sumi-font)",
      "font-family:var(--sumi-fg)",
      "width:calc(1px + 2px)",
      "width:rgb(1,2,3)",
      "width:12px junk",
      "color:rgb(256,0,0)",
      "color:rgba(0,0,0,2)",
      "opacity:2",
      "padding:-1px",
      "constructor:red",
      "color:rgb(1,2,3",
      "font-family:'Inter",
    ].map((s) => [`<div style="${s}"></div>`, "asset/unsupported-css"]),
  ]) {
    const result = compileFigure(source(`<div>\n${bad}\n</div>`), { file: "html.sumi.yaml" });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code,
        path: ["nodes", 0, "props", "html"],
        location: expect.objectContaining({ file: "html.sumi.yaml", line: 12 }),
      }),
    );
  }
  for (const bad of [
    '<div style="color:red" style="color:blue"></div>',
    "<div><span></div>",
    "<!DOCTYPE html>",
    "<div>",
    '<div style="color:red"><script/></div>',
    `${"<div/>".repeat(30)}<span>Hi</span>`,
    "<div/>",
    '<div\u00a0style="color:red"></div>',
    '<div style\u00a0="color:red"></div>',
  ])
    expect(validateHtml(bad).length).toBeGreaterThan(0);
  const quoted = compileFigure(
    source(content).replace(
      / {6}html: \|\n[\s\S]*/,
      `      html: ${JSON.stringify("<div>\n<img/>\n</div>")}\n`,
    ),
  );
  expect(quoted.ok).toBe(false);
  expect(quoted.diagnostics[0]?.location?.line).toBe(10);
  expect(quoted.diagnostics[0]?.location?.column).toBeGreaterThan(20);
});

test("HTML accepts only ASCII syntax whitespace and complete typed CSS values", () => {
  for (const ws of [" ", "\t", "\n", "\f", "\r"])
    expect(validateHtml(`<div${ws}style${ws}=${ws}"color:red"${ws}></div>`)).toEqual([]);
  for (const ws of ["\u00a0", "\u2003", "\u2028", "\uFEFF"]) {
    for (const html of [
      `<div${ws}style="color:red"></div>`,
      `<div style${ws}="color:red"></div>`,
      `<div style="color:red"${ws}></div>`,
    ])
      expect(validateHtml(html)[0]?.code).toBe("asset/unsafe-html");
  }
  for (const css of [
    "width:2em;height:50%;margin:-1pt 0 auto;padding:1px 2pt",
    "color:rgba(1, 2, 3, 0.5);background-color:#abcd",
    "font-family:'Inter', 'BIZ UDPGothic';border:1px solid var(--sumi-fg)",
    "flex:1 0 auto;grid-column:span 2 / 3;line-height:1.5",
  ])
    expect(validateHtml(`<div style="${css}"></div>`)).toEqual([]);
});

test("explicit HTML font families select supplied outlines for Latin and Japanese", async () => {
  const draw = async (family: string, text: string) => {
    const compiled = compileFigure(
      source(`<div style="font-family:${family};font-size:24px">${text}</div>`),
    );
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    const result = await renderHtmlAssets(compiled.value.ir);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    return [...result.value.values()][0];
  };
  // Variable selection must match its explicit bundled family, and changing to
  // a distinct supplied family must actually change the glyph outlines.
  for (const text of ["Wi im 012", "日本語 あいう"]) {
    const mono = await draw("var(--sumi-mono)", text);
    expect(mono).toBe(await draw("'BIZ UDGothic'", text));
    expect(mono).not.toBe(await draw("'BIZ UDPGothic'", text));
  }
  expect(await draw("Inter", "Wi im 012")).not.toBe(await draw("'BIZ UDPGothic'", "Wi im 012"));
});

test("HTML budgets, required props and image source separation", () => {
  expect(htmlViewport("320x176")).toEqual({ width: 320, height: 176 });
  for (const v of ["0x1", "2X3", "2049x1", "2048x2048", "1e3x1"])
    expect(htmlViewport(v)).toBeUndefined();
  for (const html of [
    "<div>".repeat(25) + "</div>".repeat(25),
    "<br>".repeat(513),
    `<div>${"x".repeat(HTML_LIMITS.maxBytes)}</div>`,
  ])
    expect(validateHtml(html)[0]?.code).toBe("asset/too-large");
  expect(compileFigure(source(content).replace("      viewport: 320x176\n", "")).ok).toBe(false);
  expect(compileFigure(source(content).replace("component: html", "component: image")).ok).toBe(
    false,
  );
  expect(compileFigure(source(content, "      src: a.svg\n")).ok).toBe(false);
});

test("resolved theme variables provide grayscale and colored accents and pinned families", () => {
  const vars = [...BUILTIN_THEMES.values()].map(htmlThemeVariables);
  expect(new Set(vars.map((v) => v["--sumi-accent"])).size).toBeGreaterThan(1);
  for (const v of vars) {
    expect(Object.keys(v)).toEqual([
      "--sumi-fg",
      "--sumi-muted",
      "--sumi-accent",
      "--sumi-bg",
      "--sumi-font",
      "--sumi-mono",
    ]);
    expect(v["--sumi-mono"]).toBe("'BIZ UDGothic'");
  }
});

test("HTML outlines are deterministic and use image placement for both engines and all export formats", async () => {
  for (const engine of ["structured", "auto"]) {
    const input = source(content, "      width: 120pt\n", engine);
    const a = await renderFigure(input),
      b = await renderFigure(input);
    if (!a.ok || !b.ok) throw new Error(JSON.stringify([a.diagnostics, b.diagnostics]));
    expect(a.value.svg).toBe(b.value.svg);
    expect(a.value.compiled.ir.nodes[0]?.height?.pt).toBe(66);
    const pdf = svgToPdf(a.value.svg),
      pptx = svgToPptx(a.value.svg);
    expect(pdf.ok).toBe(true);
    expect(pptx.ok).toBe(true);
    expect(pdf).toEqual(svgToPdf(b.value.svg));
    expect(pptx).toEqual(svgToPptx(b.value.svg));
    expect(
      svgToEditablePptx(a.value.svg, a.value.compiled.ir).diagnostics.some(
        (d) => d.code === "pptx/unsupported-asset",
      ),
    ).toBe(true);
  }
  const natural = await renderFigure(source(content));
  if (!natural.ok) throw new Error(JSON.stringify(natural.diagnostics));
  expect(natural.value.compiled.ir.nodes[0]?.width?.pt).toBe(240);
  const grouped = await renderFigure(
    source(content)
      .replace("[card]", "[panel]")
      .replace(
        "nodes:\n",
        "groups:\n  - { id: panel, component: container, label: Panel, arrange: { row: { items: [card] } } }\nnodes:\n",
      )
      .replace("    component: html", "    group: panel\n    component: html"),
  );
  if (!grouped.ok) throw new Error(JSON.stringify(grouped.diagnostics));
  expect(grouped.value.compiled.ir.nodes[0]?.image?.html).toBeDefined();
});
