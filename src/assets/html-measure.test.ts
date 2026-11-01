import { expect, test } from "bun:test";
import { type MeasuredNode, Renderer } from "@takumi-rs/wasm/node";
import { compileFigure } from "../compiler/compile";
import type { Diagnostic } from "../core/diagnostics";
import { lintFigureWithHtml, lintGeometry, lintRenderedFigure } from "../lint";
import { renderFigure } from "../render/render";
import { validateHtml } from "./html";
import { htmlOverflows, locateHtmlMeasurement } from "./html-measure";

const source = (html: string, props = "", figure = "", auto = false) => `version: 1
figure:
  id: html-measure
  ${auto ? "layout: { direction: right }" : "layout: { arrange: { row: { items: [card] } } }"}
${figure}nodes:
  - id: card
    component: html
    props:
      viewport: 320x176
${props}      html: |
${html
  .split("\n")
  .map((line) => `        ${line}`)
  .join("\n")}
`;
const matching = (diagnostics: readonly Diagnostic[], code: string) =>
  diagnostics.filter((d) => d.code === code);
const atElement = (diagnostic: Diagnostic | undefined, line: number, column = 9) => {
  expect(diagnostic).toMatchObject({
    path: ["nodes", 0, "props", "html"],
    location: { file: "html.sumi.yaml", line, column },
    subject: { kind: "node", id: "card" },
  });
};
const options = { file: "html.sumi.yaml" };

test("overflow measures node boxes and text runs on all four viewport edges, with element locations", async () => {
  for (const css of ["left:-1px", "top:-1px", "left:311px", "top:167px"]) {
    const text = source(
      `<div>\n<div style="position:absolute;width:10px;height:10px;${css}"></div>\n</div>`,
    );
    const rendered = await renderFigure(text, options);
    expect(rendered.ok).toBe(true);
    const overflow = matching(rendered.diagnostics, "asset/html-overflow");
    expect(overflow).toHaveLength(1);
    atElement(overflow[0], 12);
    expect(overflow[0]?.severity).toBe("warning");
  }
  const long = source(
    `<div style="width:60px;height:30px;white-space:nowrap">\n<span>this text is much too long to fit in the viewport because it never wraps</span>\n</div>`,
  );
  const result = await renderFigure(long, options);
  expect(result.ok).toBe(true);
  const overflow = matching(result.diagnostics, "asset/html-overflow");
  expect(overflow).toHaveLength(1);
  atElement(overflow[0], 12);
  const good = await renderFigure(
    source('<div style="width:320px;height:176px;padding:10px">Fits</div>'),
    options,
  );
  expect(good.ok).toBe(true);
  expect(matching(good.diagnostics, "asset/html-overflow")).toEqual([]);
});

test("overflow allows only half a CSS pixel of subpixel rounding", () => {
  const viewport = { width: 100, height: 50 };
  expect(htmlOverflows({ x: -0.5, y: -0.5, width: 101, height: 51 }, viewport)).toBe(false);
  for (const box of [
    { x: -0.51, y: 0, width: 1, height: 1 },
    { x: 0, y: -0.51, width: 1, height: 1 },
    { x: 0, y: 0, width: 100.51, height: 1 },
    { x: 0, y: 0, width: 1, height: 50.51 },
  ])
    expect(htmlOverflows(box, viewport)).toBe(true);
});

test("HTML uses the existing text rule and profile threshold, including placed size and contain/cover/fill", async () => {
  const html =
    '<div style="padding:10px;font-size:16px">\n<span style="font-size:50%">tiny</span>\n</div>';
  for (const auto of [false, true]) {
    const rendered = await renderFigure(source(html, "", "", auto), options);
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) continue;
    const findings = matching(
      lintGeometry(rendered.value, { ...options, source: source(html, "", "", auto) }),
      "geometry/text-too-small",
    );
    expect(findings).toHaveLength(1);
    atElement(findings[0], 12);
    expect(findings[0]?.message).toContain("6pt");
    expect(findings[0]?.message).toContain("7pt minimum");
  }
  for (const [fit, fails] of [
    ["contain", true],
    ["cover", false],
    ["fill", true],
  ] as const) {
    const text = source(
      '<div style="padding:10px;font-size:16px">Hello</div>',
      `      width: 120pt\n      height: 132pt\n      fit: ${fit}\n`,
    );
    const report = await lintFigureWithHtml(text, options);
    expect(matching(report.diagnostics, "geometry/text-too-small").length > 0).toBe(fails);
  }
  for (const css of ["font-size:10px", "font-size:7pt", "font-size:16px;line-height:1px"]) {
    const report = await lintFigureWithHtml(
      source(`<div style="padding:10px;${css}">Fits</div>`),
      options,
    );
    expect(matching(report.diagnostics, "geometry/text-too-small")).toEqual([]);
  }
  const enlarged = await lintFigureWithHtml(source(html, "      width: 480pt\n"), options);
  expect(matching(enlarged.diagnostics, "geometry/text-too-small")).toEqual([]);
  const last = await lintFigureWithHtml(
    source('<div style="FONT-SIZE:16PX;font-size:10px;FONT-SIZE:4PX">tiny</div>'),
    options,
  );
  expect(matching(last.diagnostics, "geometry/text-too-small")[0]?.message).toContain("3pt");
});

test("page fitting uses minScaledFontSize, rather than an HTML-specific minimum", async () => {
  for (const [size, fails] of [
    [16, false],
    [6, true],
  ] as const) {
    const report = await lintFigureWithHtml(
      source(
        `<div style="padding:10px;font-size:${size}px">Text</div>`,
        "      width: 300pt\n",
        "  fit: scale\n",
      ),
      options,
    );
    const small = matching(report.diagnostics, "geometry/text-too-small");
    expect(small.length > 0).toBe(fails);
    if (fails) expect(small[0]?.message).toContain("5pt minimum");
  }
});

test("missing glyph uses selected bundled faces, decodes entities, excludes whitespace and controls, and locates elements", async () => {
  const html = `<div style="padding:10px">\n<span style="font-family:Inter">日本語</span>\n<span>&#x1F600;&NotEqualTilde;</span>\n</div>`;
  const report = await lintFigureWithHtml(source(html), options);
  const glyphs = matching(report.diagnostics, "lint/missing-glyph");
  expect(glyphs).toHaveLength(2);
  atElement(glyphs[0], 12);
  atElement(glyphs[1], 13);
  expect(glyphs[0]?.message).toContain("U+65E5");
  expect(glyphs[1]?.message).toContain("U+1F600");
  for (const css of [
    "font-family:var(--sumi-font)",
    "font-family:var(--sumi-mono)",
    "font-family:Inter,'BIZ UDPGothic';font-weight:700",
    "font-family:'BIZ UDPGothic';font-style:italic",
  ]) {
    const good = await lintFigureWithHtml(
      source(`<div style="padding:10px;${css}">日本語 A&amp;B &#9;&#10;&#x200D;&#xFE0F;</div>`),
      options,
    );
    expect(matching(good.diagnostics, "lint/missing-glyph")).toEqual([]);
  }
});

test("inline, block, flex/grid order, inline-block and hidden content retain their own source styles", async () => {
  for (const display of ["block", "flex", "grid"]) {
    const html = `<div style="display:${display};padding:10px">\n<span style="display:none;font-size:1px">😀</span>\n<span style="font-size:16px;order:2">same</span>\n<span style="font-size:4px;order:1">same</span>\n<span style="display:inline-block;font-size:16px">same</span>\n</div>`;
    const report = await lintFigureWithHtml(source(html), options);
    expect(matching(report.diagnostics, "lint/missing-glyph")).toEqual([]);
    const small = matching(report.diagnostics, "geometry/text-too-small");
    expect(small).toHaveLength(1);
    atElement(small[0], 14);
  }
  const mixed = await lintFigureWithHtml(
    source('<div>before<div>large</div><span style="font-size:4px">tiny</span>after</div>'),
    options,
  );
  atElement(matching(mixed.diagnostics, "geometry/text-too-small")[0], 11, 36);
});

test("normal lint, geometry lint, render and YAML scalar locations share diagnostics and rule configuration", async () => {
  const html = '<div style="padding:10px">OK<span style="font-size:4px">😀</span></div>';
  const text = source(html);
  const plain = await lintFigureWithHtml(text, options);
  const geometry = await lintRenderedFigure(text, options);
  for (const code of ["lint/missing-glyph", "geometry/text-too-small"]) {
    expect(matching(plain.diagnostics, code)).toEqual(matching(geometry.diagnostics, code));
    atElement(matching(plain.diagnostics, code)[0], 11, 37);
  }
  const off = await lintFigureWithHtml(text, {
    ...options,
    config: { rules: { "lint/missing-glyph": "off", "geometry/text-too-small": "off" } },
  });
  expect(off.diagnostics).toEqual([]);
  const promoted = await lintFigureWithHtml(text, {
    ...options,
    config: { rules: { "lint/missing-glyph": "error" } },
  });
  expect(matching(promoted.diagnostics, "lint/missing-glyph")[0]?.severity).toBe("error");
  const quoted = text.replace(/ {6}html: \|\n[\s\S]*/, `      html: ${JSON.stringify(html)}\n`);
  const escaped = await lintFigureWithHtml(quoted, options);
  expect(matching(escaped.diagnostics, "lint/missing-glyph")[0]?.location).toMatchObject({
    line: 10,
    column: 44,
  });
});

test("source projection follows mixed inline flows, absolute children, br and preserved whitespace", async () => {
  const tiny = '<span style="font-size:4px">tiny</span>';
  for (const html of [
    `<div>A<br>${tiny}<br>B</div>`,
    `<div style="display:flex;white-space:pre"> A ${tiny} B </div>`,
    `<div>A<div style="position:absolute;left:100px">large</div>${tiny}</div>`,
    `<div><div>large</div><div style="position:absolute;left:100px">${tiny}</div></div>`,
    `<div>A<span style="position:absolute;left:100px">${tiny}</span><span style="position:absolute;left:200px">large</span>B</div>`,
    `<div><span style="display:inline-block">large</span>${tiny}</div>`,
    `<div><span>A<div>large</div>${tiny}</span></div>`,
    `<div><p>large</p>${tiny}<p>large</p></div>`,
    `<div><p>A<div>large</div>${tiny}</p></div>`,
  ]) {
    const rendered = await renderFigure(source(html), options);
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) continue;
    const runs = rendered.value.html?.get("n:card")?.texts.filter((t) => t.text.includes("tiny"));
    expect(runs).toMatchObject([{ fontSize: 4, offset: html.indexOf(tiny) }]);
  }
});

test("resolved font-size range errors name only the last declaration (review nit)", () => {
  const html =
    '<div style="font-size:256px"><span style="font-size:1px; font-size:16em">X</span></div>';
  const issues = validateHtml(html);
  expect(issues).toHaveLength(1);
  expect(issues[0]?.offset).toBe(html.indexOf("font-size:16em"));
  const compiled = compileFigure(source(html), options);
  expect(compiled.ok).toBe(false);
  expect(compiled.diagnostics[0]?.location).toMatchObject({ line: 11, column: 66 });
  expect(
    validateHtml(html.replace("font-size:1px; font-size:16em", "font-size:16em; font-size:1px")),
  ).toEqual([]);
});

test("inline roots keep block and absolute descendants' size, family and diagnostic ownership", async () => {
  for (const absolute of [false, true]) {
    const html = `<span>
<div>before</div>
<div${absolute ? ' style="position:absolute;left:319px"' : ""}>
<span style="font-size:4px;font-family:Inter">日本語 tiny</span>
</div>
<div>after</div>
</span>`;
    const report = await lintFigureWithHtml(source(html), options);
    atElement(matching(report.diagnostics, "geometry/text-too-small")[0], 14);
    atElement(matching(report.diagnostics, "lint/missing-glyph")[0], 14);
    if (absolute) {
      const overflow = matching(report.diagnostics, "asset/html-overflow");
      expect(overflow.length).toBeGreaterThan(0);
      expect(overflow.every((d) => [13, 14].includes(d.location?.line ?? 0))).toBe(true);
    }
  }
});

test("generated wrapper/flow combinations preserve every measured run's resolved style and owner", async () => {
  const renderer = new Renderer();
  const variables = { "--sumi-font": "'BIZ UDPGothic'" };
  const wrappers = [
    "div",
    "span",
    "p",
    "b",
    "i",
    'div style="display:inline"',
    'span style="display:block"',
  ];
  const flows = [
    ["span", "span", "span"],
    ["div", "div", "div"],
    ["span", "div", "span"],
    ["div", "span", "div"],
    ["div", 'div style="position:absolute;left:319px"', "div"],
    ["span", 'span style="position:absolute;left:319px"', "span"],
    ['span style="display:inline-block"', "div", "span"],
  ];
  const words = ["Alpha", "Bravo", "Charlie"];
  const sizes = [16, 4, 12];
  try {
    for (const wrapper of wrappers)
      for (const flow of flows)
        for (const separator of ["", "\n  ", "<br>"]) {
          const leaves = words.map(
            (word, i) =>
              `<span style="font-size:${sizes[i]}px;font-family:${i === 1 ? "Inter" : "'BIZ UDPGothic'"};font-weight:${i === 1 ? 700 : 400}">${word}</span>`,
          );
          const html = `<${wrapper}>${separator}${flow.map((tag, i) => `<${tag}>${leaves[i]}</${tag.split(" ")[0]}>`).join(separator)}${separator}</${wrapper.split(" ")[0]}>`;
          expect(validateHtml(html), html).toEqual([]);
          const measured = await renderer.measure(`<div>${html}</div>`, {
            width: 320,
            height: 176,
          });
          const located = locateHtmlMeasurement(html, variables, measured);
          const measuredTexts = (node: MeasuredNode): string[] => [
            ...node.runs.map((r) => r.text),
            ...node.children.flatMap(measuredTexts),
          ];
          expect(located.texts.map((t) => t.text).join(""), html).toBe(
            measuredTexts(measured).join(""),
          );
          for (const text of located.texts) {
            if (!text.text.trim()) {
              expect(text, html).toMatchObject({
                fontSize: 16,
                families: ["BIZ UDPGothic"],
                weight: wrapper === "b" ? 700 : 400,
                offset: 0,
              });
              continue;
            }
            const index = words.indexOf(text.text.trim());
            expect(index, `${html}: ${text.text}`).toBeGreaterThanOrEqual(0);
            expect(text, html).toMatchObject({
              fontSize: sizes[index],
              families: [index === 1 ? "Inter" : "BIZ UDPGothic"],
              weight: index === 1 ? 700 : 400,
              offset: html.indexOf(leaves[index] ?? ""),
            });
          }
          for (const word of words)
            expect(
              located.texts.some((t) => t.text.includes(word)),
              html,
            ).toBe(true);
        }
  } finally {
    renderer.free();
  }
});

test("ambiguous measurement ownership falls back to the ancestor without losing candidate styles", () => {
  const html =
    '<div><span style="font-size:4px;font-family:Inter">same</span><div>same</div></div>';
  // Simulate a changed anonymous-box topology from a future measurement backend.
  // Identical text cannot identify which source element owns this run.
  const measured: MeasuredNode = {
    width: 320,
    height: 176,
    transform: [1, 0, 0, 1, 0, 0],
    children: [],
    runs: [{ text: "same", x: 0, y: 0, width: 10, height: 5.2 }],
  };
  const result = locateHtmlMeasurement(html, { "--sumi-font": "BIZ UDPGothic" }, measured);
  expect(result.texts).toMatchObject([
    { text: "same", offset: 0, fontSize: 4, families: ["Inter"] },
    { text: "same", offset: 0, fontSize: 16, families: ["BIZ UDPGothic"] },
  ]);
});
