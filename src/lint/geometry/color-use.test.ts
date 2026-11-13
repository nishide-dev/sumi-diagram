import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { BUILTIN_THEMES, getTheme } from "../../core/theme/builtin";
import { buildThemeCatalog } from "../../core/theme/catalog";
import { renderFigure } from "../../render";
import { themeColorUse } from "./color-use";
import { geometryContextFor } from "./lint";

const fixture = (name: string) =>
  readFileSync(
    new URL(`../../../tests/fixtures/figures/color-use/${name}.sumi.yaml`, import.meta.url),
    "utf8",
  );

async function findingsOf(source: string) {
  const result = await renderFigure(source);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return themeColorUse.run(geometryContextFor(result.value), undefined);
}

describe("geometry/theme-color-use (#513): the dogfood figures of #509", () => {
  test("1A (28 filled/solid blocks, 3 tones) is flagged for its blocks of color", async () => {
    const findings = await findingsOf(fixture("vit-block-a"));
    expect(findings).toHaveLength(2);
    expect(findings[0]?.message).toMatch(/of the node area is a block of color/);
    expect(findings[0]?.hint).toMatch(/filled \/ solid to tinted/);
  });

  test("4A (92% filled, 4 tones) is flagged for blocks and for its tones, naming them", async () => {
    const findings = await findingsOf(fixture("train-infer-a"));
    expect(findings).toHaveLength(2);
    const tones = findings.find((f) => f.message.includes("accent tones"));
    expect(tones?.message).toContain("blue, orange, purple, red");
    expect(tones?.hint).toMatch(
      /Keep blue, orange, purple .*change red \(node "t-loss"\) to tone gray/,
    );
    expect(findings.every((f) => f.severity === undefined)).toBe(true);
  });

  test("5A (a solid blue block) and 7A (solid red and green) are flagged for solid hues", async () => {
    for (const [name, tones] of [
      ["agent-loop-a", ["blue"]],
      ["request-states-a", ["green", "red"]],
    ] as const) {
      const findings = await findingsOf(fixture(name));
      expect(findings, name).toHaveLength(1);
      const [finding] = findings;
      expect(finding?.message).toMatch(/solid with a tone/);
      for (const tone of tones) expect(finding?.message).toContain(tone);
      expect(finding?.hint).toMatch(/emphasis/);
    }
  });

  test.each([
    "vit-block-b",
    "train-infer-b",
    "rag-compare-a",
    "agent-loop-b",
    "request-states-b",
    "method-taxonomy-b",
  ])("%s is not flagged", async (name) => {
    expect(await findingsOf(fixture(name))).toEqual([]);
  });
});

describe("theme color guidance (#513)", () => {
  test("sumi and sumi-dark carry it; the other themes leave it unset", () => {
    for (const [id, theme] of BUILTIN_THEMES) {
      expect(theme.colorUse !== undefined, id).toBe(id === "sumi" || id === "sumi-dark");
    }
    expect(getTheme("sumi")?.colorUse?.heavyVariants).toEqual(["filled", "solid"]);
  });

  test("the catalog lists it, null for a theme without", () => {
    const entries = buildThemeCatalog();
    expect(entries.find((e) => e.id === "sumi")?.colorUse?.maxAccentTones).toBe(3);
    expect(entries.find((e) => e.id === "minimal")?.colorUse).toBeNull();
  });

  test("a theme without guidance reports nothing", async () => {
    const source = fixture("train-infer-a").replace("theme: sumi", "theme: minimal");
    expect(await findingsOf(source)).toEqual([]);
  });
});

const figure = (extra: { overrides?: string; nodes: string; legend?: string }) => `version: 1
figure:
  id: t
  theme: sumi
  profile: paper-double
${extra.overrides === undefined ? "" : `  themeOverrides: ${extra.overrides}\n`}  layout:
    arrange: { row: { gap: 6mm, items: [ ${extra.legend === undefined ? "a, b, c, d, e, f" : "a, b, key"} ] } }
nodes:
${extra.nodes}${extra.legend === undefined ? "\n  - { id: c, component: box, label: C }\n  - { id: d, component: box, label: D }\n  - { id: e, component: box, label: E }\n  - { id: f, component: box, label: F }" : ""}
`;

const box = (id: string, props: string) =>
  `  - { id: ${id}, component: box, label: ${id.toUpperCase()}, ${props} }`;

describe("geometry/theme-color-use: what counts (#513 review)", () => {
  test("legend samples are not accents; a legend alone adds none", async () => {
    const legendOnly = figure({
      legend: "k",
      nodes: [
        box("a", "variant: tinted, tone: blue"),
        box("b", "variant: tinted, tone: blue"),
        `  - id: key
    component: legend
    variant: plain
    props:
      entries:
        - { node: { tone: red, variant: tinted }, label: r }
        - { node: { tone: green, variant: tinted }, label: g }
        - { node: { tone: purple, variant: tinted }, label: p }
        - { node: { tone: orange, variant: tinted }, label: o }`,
      ].join("\n"),
    });
    expect(await findingsOf(legendOnly)).toEqual([]);
  });

  test("a toned box with an icon counts; an icon-only label does not", async () => {
    const withIcon = figure({
      nodes: [
        "  - { id: a, component: box, variant: solid, tone: blue, icon: tabler/repeat, props: { width: 40pt, height: 30pt } }",
        box("b", "variant: tinted"),
      ].join("\n"),
    });
    const finding = (await findingsOf(withIcon)).find((f) =>
      /(is|are) solid with a tone/.test(f.message),
    );
    expect(finding?.message).toMatch(/solid with a tone \(node "a" blue\)/);
    const iconOnly = figure({
      nodes: [
        `  - { id: a, component: label, icon: tabler/repeat, tone: blue }`,
        box("b", "variant: tinted"),
      ].join("\n"),
    });
    expect(await findingsOf(iconOnly)).toEqual([]);
  });

  test("overrides: a gray solid fill under a blue tone is neutral", async () => {
    const nodes = [box("a", "variant: solid, tone: blue"), box("b", "variant: tinted")].join("\n");
    expect(await findingsOf(figure({ nodes }))).toHaveLength(1);
    expect(
      await findingsOf(figure({ nodes, overrides: "{ solidFills: { blue: '#777777' } }" })),
    ).toEqual([]);
  });

  test("overrides: a gray tone painted in a hue is chromatic, a hue tone painted gray is not", async () => {
    const nodes = [box("a", "variant: solid, tone: gray"), box("b", "variant: tinted")].join("\n");
    expect(await findingsOf(figure({ nodes }))).toEqual([]);
    const [finding] = await findingsOf(
      figure({ nodes, overrides: "{ solidFills: { gray: '#cc2222' } }" }),
    );
    expect(finding?.message).toMatch(/solid with a tone/);
    const filled = [
      box("a", "variant: filled, tone: blue"),
      box("b", "variant: filled, tone: blue"),
    ].join("\n");
    expect(await findingsOf(figure({ nodes: filled }))).toHaveLength(1);
    expect(
      await findingsOf(
        figure({
          nodes: filled,
          overrides: "{ tones: { blue: { fill: '#dddddd', line: '#555555' } } }",
        }),
      ),
    ).toEqual([]);
    const grays = [
      box("a", "variant: filled, tone: gray"),
      box("b", "variant: filled, tone: gray"),
    ].join("\n");
    expect(
      await findingsOf(
        figure({
          nodes: grays,
          overrides: "{ tones: { gray: { fill: '#f0a0a0', line: '#a02020' } } }",
        }),
      ),
    ).toHaveLength(1);
  });

  test("the suggested edit (emphasis, no tone) yields a neutral block that passes", async () => {
    const before = figure({
      nodes: [box("a", "variant: solid, tone: blue"), box("b", "variant: tinted, tone: blue")].join(
        "\n",
      ),
    });
    const [finding] = await findingsOf(before);
    expect(finding?.hint).toMatch(/set variant emphasis and delete its tone/);
    const after = figure({
      nodes: [box("a", "variant: emphasis"), box("b", "variant: tinted, tone: blue")].join("\n"),
    });
    expect(await findingsOf(after)).toEqual([]);
  });

  test("a near-gray override of a pale tone is neutral (sumi blue #d9e4e6 vs #e1e1e1)", async () => {
    const nodes = [
      box("a", "variant: filled, tone: blue"),
      box("b", "variant: filled, tone: blue"),
    ].join("\n");
    expect(await findingsOf(figure({ nodes }))).toHaveLength(1);
    expect(
      await findingsOf(
        figure({ nodes, overrides: "{ tones: { blue: { fill: '#e1e1e1', line: '#555555' } } }" }),
      ),
    ).toEqual([]);
  });

  test("an override is judged by its chroma: #d6e4e6 is still blue, #efeddd (a warm gray) counts as a hue", async () => {
    const nodes = [
      box("a", "variant: filled, tone: blue"),
      box("b", "variant: filled, tone: blue"),
    ].join("\n");
    const blue = (fill: string) => `{ tones: { blue: { fill: '${fill}', line: '#555555' } } }`;
    expect(await findingsOf(figure({ nodes, overrides: blue("#d6e4e6") }))).toHaveLength(1);
    expect(await findingsOf(figure({ nodes, overrides: blue("#e1e1e1") }))).toEqual([]);
    // Chroma 0.016 is above the true-gray threshold: a warm gray override is reported, the
    // residual ambiguity of very low-chroma tints (documented in design #513).
    expect(await findingsOf(figure({ nodes, overrides: blue("#efeddd") }))).toHaveLength(1);
  });

  test("the gray tone's defaults (sumi, sumi-dark) are neutral through the shortcut", async () => {
    const grays = [
      box("a", "variant: filled, tone: gray"),
      box("b", "variant: solid, tone: gray"),
    ].join("\n");
    for (const theme of ["sumi", "sumi-dark"]) {
      const source = figure({ nodes: grays }).replace("theme: sumi", `theme: ${theme}`);
      expect(await findingsOf(source), theme).toEqual([]);
    }
  });
});
