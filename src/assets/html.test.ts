import { expect, test } from "bun:test";
import { compileFigure } from "../compiler/compile";
import { BUILTIN_THEMES } from "../core/theme/builtin";
import { svgToPdf } from "../render/pdf";
import { svgToEditablePptx, svgToPptx } from "../render/pptx";
import { renderFigure } from "../render/render";
import { HTML_LIMITS, htmlViewport, validateHtml } from "./html";
import { validCssValue } from "./html-css";
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
      "color:blacK",
      "bacKground-color:red",
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

test("malformed later CSS declarations report their own HTML and YAML offsets", () => {
  for (const bad of [
    "color:rgb(1,2,3",
    "font-family:'Inter",
    "color:red)",
    "color:\u00a0red",
    "\u2003color:red",
  ]) {
    const html = `<div style="padding:4px;\n  ${bad}"></div>`;
    expect(validateHtml(html)[0]?.offset).toBe(html.indexOf(bad));
    const result = compileFigure(source(html), { file: "html.sumi.yaml" });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.location).toEqual(
      expect.objectContaining({ file: "html.sumi.yaml", line: 12, column: 11 }),
    );
  }
});

test("every CSS numeric grammar has a finite conservative budget", () => {
  const huge = "9999999999999999999999999999999999999999";
  for (const [prop, good, bad] of [
    ["flex-grow", ["0", ".01", "64"], [huge, "64.01", "-1", ".001"]],
    ["flex-shrink", ["0", "64"], [huge, "65"]],
    [
      "flex",
      ["1", "1 1 0", "64 64 2048px", "none", "auto", "initial"],
      [huge, `${huge} 1 0`, `1 ${huge} 0`, `1 1 ${huge}px`],
    ],
    ["line-height", ["0", "8", "2048px"], [huge, "8.01", "2049px"]],
    ["opacity", ["0", ".01", "1"], [huge, "1.01", "-0.01"]],
    ["font-weight", ["100", "900", "bold"], ["0", "99", "901", huge]],
    ["order", ["-512", "0", "512"], ["-513", "513", huge]],
    [
      "width",
      ["0", "2048px", "1536pt", "16em", "100%"],
      [`${huge}px`, "2049px", "1537pt", "16.01em", "100.01%", "0.001px"],
    ],
    ["margin", ["-2048px -1536pt -16em -100%"], ["-2049px", "-1537pt", "-16.01em", "-100.01%"]],
    [
      "grid-template-columns",
      ["0fr .01fr 64fr", "repeat(64,1fr)"],
      [`${huge}fr`, "64.01fr", "repeat(65,1fr)", "repeat(64,1fr 1fr)"],
    ],
    ["grid-column", ["-64 / 64", "span 64"], ["0", "-65", "65", `span ${huge}`]],
    [
      "color",
      ["rgb(0,255,0)", "rgba(100%,0%,0%,100%)"],
      ["rgb(100.01%,0%,0%)", "rgba(0,0,0,100.01%)", `rgb(${huge},0,0)`],
    ],
  ] as const) {
    for (const v of good) expect(validCssValue(prop, v), `${prop}:${v}`).toBe(true);
    for (const v of bad) {
      expect(validCssValue(prop, v), `${prop}:${v}`).toBe(false);
      expect(
        compileFigure(source(`<div style="${prop}:${v}"></div>`)).diagnostics.some(
          (d) => d.code === "asset/unsupported-css",
        ),
      ).toBe(true);
    }
  }
  // Every length-bearing shorthand uses the same bound, including negatives.
  for (const prop of [
    "border",
    "border-width",
    "border-radius",
    "padding",
    "gap",
    "font-size",
    "letter-spacing",
    "top",
    "flex-basis",
    "grid-auto-rows",
  ]) {
    expect(validCssValue(prop, prop === "border" ? `solid ${huge}px red` : `${huge}px`)).toBe(
      false,
    );
  }
  expect(validCssValue("color", "var(--SUMI-fg)")).toBe(false);
  expect(validCssValue("border", "1px solid VAR(--sumi-fg)")).toBe(false);
  for (const html of [
    '<div style="font-size:16em"><div style="font-size:16em">X</div></div>',
    '<div style="width:16em;font-size:2048px">X</div>',
    '<div style="font-size:2048px;width:16em">X</div>',
    '<div style="font-size:1px"><div style="font-size:1%">X</div></div>',
  ])
    expect(validateHtml(html)[0]?.code).toBe("asset/unsupported-css");
});

async function drawHtml(html: string): Promise<string> {
  const compiled = compileFigure(source(html));
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  const rendered = await renderHtmlAssets(compiled.value.ir);
  if (!rendered.ok) throw new Error(JSON.stringify(rendered.diagnostics));
  return [...rendered.value.values()][0] ?? "";
}

const flexProbe = (css: string, width = 20) =>
  `<div style="display:flex;width:100px;height:20px"><div style="width:${width}px;height:20px;background-color:red;${css}"></div><div style="width:20px;height:20px;flex-shrink:0;background-color:blue"></div></div>`;

test("Takumi honors shorthand, case-insensitive syntax and percentage colors through production normalization", async () => {
  for (const [a, b] of [
    ["width:40PX", "width:40px"],
    ["width:12PT", "width:12pt"],
    ["width:1EM", "width:1em"],
    ["display:FLEX;flex-direction:COLUMN", "display:flex;flex-direction:column"],
    ["color:RED", "color:#ff0000"],
    ["color:RGB(100%,0%,0%)", "color:rgb(255,0,0)"],
    ["color:rgba(100%,0%,0%,50%)", "color:rgba(255,0,0,.5)"],
    ["color:rgba(0%,100%,0%,100%)", "color:rgba(0,255,0,1)"],
    ["color:rgba(0%,100%,0%,0%)", "color:rgba(0,255,0,0)"],
  ] as const) {
    const card = (css: string) =>
      `<div style="height:40px;background-color:silver;${css}"><span>X</span><span>Y</span></div>`;
    expect(await drawHtml(card(a)), a).toBe(await drawHtml(card(b)));
    expect(await drawHtml(card(a)), a).not.toBe(await drawHtml(card("")));
  }
  for (const border of [
    "1px solid #ccc",
    "1px #ccc solid",
    "solid 1px #ccc",
    "solid #ccc 1px",
    "#ccc 1px solid",
    "#ccc solid 1px",
  ]) {
    const card = (css: string) => `<div style="width:40px;height:40px;${css}">X</div>`;
    expect(await drawHtml(card(`border:${border}`))).toBe(
      await drawHtml(card("border:1px solid #ccc")),
    );
    expect(await drawHtml(card(`border:${border}`))).not.toBe(await drawHtml(card("")));
  }
  for (const [shorthand, expanded] of [
    ["1", "1 1 0"],
    ["none", "0 0 auto"],
    ["auto", "1 1 auto"],
    ["initial", "0 1 auto"],
  ] as const) {
    for (const width of [20, 120])
      expect(await drawHtml(flexProbe(`flex:${shorthand}`, width))).toBe(
        await drawHtml(flexProbe(`flex:${expanded}`, width)),
      );
  }
  expect(await drawHtml(flexProbe("flex:1"))).not.toBe(await drawHtml(flexProbe("flex:none")));
});

test("accepted numeric range edges still affect Takumi's normalized SVG", async () => {
  // 100px row: the upper bound must grow to 80/20, not regress to 20/20.
  for (const prop of ["flex-grow", "flex-shrink"]) {
    const width = prop === "flex-grow" ? 20 : 2048;
    const zero = await drawHtml(flexProbe(`${prop}:0`, width));
    for (const edge of [".01", "64"])
      expect(await drawHtml(flexProbe(`${prop}:${edge}`, width))).not.toBe(zero);
    expect(await drawHtml(flexProbe(`${prop}:64`, width))).toBe(
      await drawHtml(flexProbe(`${prop}:1`, width)),
    );
    expect(await drawHtml(flexProbe(`${prop}:64`, width))).toContain("M 0 0 L 80 0 L 80 20");
  }
  for (const css of ["flex:64 1 0", "flex:1 64 0"])
    expect(await drawHtml(flexProbe(css))).toBe(await drawHtml(flexProbe("flex:1")));
  const box = (css: string) => `<div style="height:20px;background-color:red;${css}"></div>`;
  for (const edge of ["1px", ".75pt", ".1em", "1%", "2048px", "1536pt", "16em", "100%"]) {
    expect(await drawHtml(box(`width:${edge}`)), edge).not.toBe(await drawHtml(box("width:0")));
  }
  for (const edge of ["-2048px", "-1536pt", "-16em", "-100%"])
    expect(await drawHtml(box(`width:20px;margin-left:${edge}`)), edge).not.toBe(
      await drawHtml(box("width:20px;margin-left:0")),
    );
  for (const edge of ["0", ".01", "1"]) {
    expect(await drawHtml(box(`width:20px;opacity:${edge}`))).not.toBe(
      await drawHtml(box(`width:20px;opacity:${edge === "1" ? "0" : "1"}`)),
    );
  }
  for (const edge of ["0", "8", "2048px"]) {
    const text = (v: string) => `<div style="font-size:16px;line-height:${v}">X<br>Y</div>`;
    expect(await drawHtml(text(edge)), `line-height:${edge}`).not.toBe(
      await drawHtml(text("normal")),
    );
  }
  expect(await drawHtml('<div style="font-weight:100">Wide</div>')).not.toBe(
    await drawHtml('<div style="font-weight:900">Wide</div>'),
  );
  for (const edge of ["1px", "2048px"]) {
    expect(await drawHtml(`<div style="font-size:${edge}">X</div>`)).not.toBe(
      await drawHtml('<div style="font-size:0">X</div>'),
    );
  }
  expect(await drawHtml('<div style="font-size:16em">X</div>')).toBe(
    await drawHtml('<div style="font-size:256px">X</div>'),
  );
  expect(
    await drawHtml(
      '<div style="width:16em;font-size:128px;height:20px;background-color:red"></div>',
    ),
  ).toBe(await drawHtml(box("width:2048px")));
  for (const edge of [-512, 512]) {
    const row = (order: number) =>
      `<div style="display:flex"><div style="order:${order};width:20px;height:20px;background-color:red"></div><div style="width:20px;height:20px;background-color:blue"></div></div>`;
    expect(await drawHtml(row(edge))).not.toBe(await drawHtml(row(-edge)));
  }
  for (const edge of [".01fr", "64fr"]) {
    const grid = (track: string) =>
      `<div style="display:grid;width:2048px;grid-template-columns:${track} 1fr"><div style="height:20px;background-color:red"></div><div style="height:20px;background-color:blue"></div></div>`;
    expect(await drawHtml(grid(edge))).not.toBe(await drawHtml(grid("0fr")));
  }
  for (const edge of ["-64", "64", "span 64"]) {
    const grid = (line: string) =>
      `<div style="display:grid;grid-template-columns:repeat(64,2px)"><div style="grid-column:${line};height:20px;background-color:red"></div></div>`;
    expect(await drawHtml(grid(edge)), edge).not.toBe(await drawHtml(grid("1")));
  }
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
