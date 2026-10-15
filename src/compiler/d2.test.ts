import { describe, expect, test } from "bun:test";
import { compileFigure } from "./compile";
import { d2String, elementClass, generateD2 } from "./d2";
import { extrasFigure, goldenCases } from "./testing";

// Set SUMI_UPDATE_GOLDEN=1 to rewrite the expected `.d2` files.
const update = process.env.SUMI_UPDATE_GOLDEN === "1";

describe("d2String", () => {
  test.each([
    ["", '""'],
    ["plain", '"plain"'],
    ['say "hi"', '"say \\"hi\\""'],
    ["back\\slash \\n", '"back\\\\slash \\\\n"'],
    // biome-ignore lint/suspicious/noTemplateCurlyInString: D2 substitution syntax under test
    ["$5 ${x}", '"\\$5 \\${x}"'],
    ["a\nb\r\nc\rd", '"a\\nb\\nc\\nd"'],
    ["a\tb", '"a\\tb"'],
    ["bell\u0007del\u007f", '"bell\uFFFDdel\uFFFD"'],
    ["# . : ; { } [ ] | -> 日本語", '"# . : ; { } [ ] | -> 日本語"'],
  ])("%j → %s", (text, quoted) => {
    expect(d2String(text)).toBe(quoted);
  });
});

describe("elementClass", () => {
  test.each([
    ["n:api", "sumi-k-n--api"],
    ["g:my-group", "sumi-k-g--my-group"],
    ["e:twin-1", "sumi-k-e--twin-1"],
    ["e:#3", "sumi-k-e--_3"],
  ] as const)("%s → %s", (key, cls) => {
    expect(elementClass(key)).toBe(cls);
  });
});

describe("golden D2 sources", () => {
  for (const { name, input, expected } of goldenCases()) {
    test(name, async () => {
      const result = compileFigure(await Bun.file(input).text());
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
      const { d2Source } = result.value;
      if (update) await Bun.write(expected, d2Source);
      expect(d2Source).toBe(await Bun.file(expected).text());
    });
  }
});

describe("generateD2", () => {
  test("is deterministic", async () => {
    for (const { input } of goldenCases()) {
      const text = await Bun.file(input).text();
      const first = compileFigure(text);
      const second = compileFigure(text);
      if (!first.ok || !second.ok) throw new Error("expected ok");
      expect(second.value.d2Source).toBe(first.value.d2Source);
      expect(generateD2(first.value.ir)).toBe(first.value.d2Source);
    }
  });

  test("declares every element exactly once with its reverse-lookup classes", async () => {
    for (const { input } of goldenCases()) {
      const result = compileFigure(await Bun.file(input).text());
      if (!result.ok) throw new Error("expected ok");
      const { ir, d2Source } = result.value;
      for (const [key, element] of ir.elements) {
        const line = `class: ["${elementClass(key)}"; "sumi-kind-${element.kind}"]`;
        expect(d2Source.split(line).length - 1).toBe(1);
      }
      expect(d2Source.match(/class: /g) ?? []).toHaveLength(ir.elements.size);
    }
  });

  test("lowers edge directions, arrowheads and text styles", () => {
    const d2 = generateD2(extrasFigure());
    expect(d2).toContain(`"n_plain" <- "n_styled": {
  label: "back"
  class: ["sumi-k-e--_0"; "sumi-kind-edge"]`);
    expect(d2).toContain(`  source-arrowhead: {
    shape: triangle
    style.filled: true
  }
}`);
    expect(d2).toContain(`"n_plain" -> "n_styled": {
  label: "open"
  class: ["sumi-k-e--_1"; "sumi-kind-edge"]
  style: {
    fill: "#ffffff"
    stroke: "#1f2328"
    stroke-width: 2
    stroke-dash: 0
    opacity: 1
    font-size: 14
    font-color: "#1f2328"
    bold: true
    italic: false
    font: mono
  }
  target-arrowhead: {
    shape: arrow
    style.filled: false
  }
}`);
    expect(d2).toContain(`"n_styled" <-> "n_plain": {
  label: ""
  class: ["sumi-k-e--_2"; "sumi-kind-edge"]
  style: {
    fill: "#ffffff"
    stroke: "#1f2328"
    stroke-width: 2
    stroke-dash: 0
    opacity: 0.5
    font-size: 14
    font-color: "#1f2328"
    bold: false
    italic: false
  }
  source-arrowhead: {
    shape: circle
    style.filled: false
  }
  target-arrowhead: {
    shape: diamond
    style.filled: false
  }
}`);
    expect(d2).toContain(`"n_styled": {
  label: "mono italic"
  class: ["sumi-k-n--styled"; "sumi-kind-node"]
  shape: rectangle
  style: {
    fill: "transparent"
    stroke: "#1f2328"
    stroke-width: 2
    stroke-dash: 0
    border-radius: 0
    opacity: 1
    font-size: 16
    font-color: "#1f2328"
    bold: false
    italic: true
    font: mono
  }
}`);
  });

  test("puts group labels at the top-left and gives edge labels a background (#31)", () => {
    const result = compileFigure(`version: 1
figure: { id: readability, theme: academic }
groups:
  - { id: g, label: Group }
nodes:
  - { id: a, component: box, label: A, group: g }
  - { id: b, component: box, label: B }
edges:
  - { from: b, to: a, label: x }
`);
    if (!result.ok) throw new Error("expected ok");
    const { d2Source } = result.value;
    expect(d2Source).toContain(`"g_g": {
  label: "Group"
  class: ["sumi-k-g--g"; "sumi-kind-group"]
  shape: rectangle
  label.near: top-left
`);
    expect(d2Source.match(/label\.near/g)).toHaveLength(1);
    // academic's edge fill is its paper color.
    expect(d2Source).toContain(`  label: "x"
  class: ["sumi-k-e--_0"; "sumi-kind-edge"]
  style: {
    fill: "#ffffff"
`);
  });

  test("writes an explicit empty label and no arrowheads for undirected edges", async () => {
    const result = compileFigure(`version: 1
figure: { id: empty }
nodes:
  - { id: a, component: box }
edges:
  - { from: a, to: a, component: line }
`);
    if (!result.ok) throw new Error("expected ok");
    const { d2Source } = result.value;
    expect(d2Source).toContain(`"n_a": {\n  label: ""\n`);
    expect(d2Source).toContain(`"n_a" -- "n_a": {\n  label: ""\n`);
    expect(d2Source).not.toContain("arrowhead");
  });
});
