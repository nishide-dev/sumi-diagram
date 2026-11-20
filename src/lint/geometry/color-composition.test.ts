import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { toOklch } from "../../core/theme/color-math";
import { renderFigure } from "../../render";
import {
  colorOnPanel,
  muddinessOf,
  muddyColor,
  muddyFindings,
  panelFillsOf,
  panelFindings,
  translucentFindings,
  translucentOverColor,
} from "./color-composition";
import { analysisOf, analyze, over, type PaintItem, paintItems } from "./composite";
import { geometryContextFor } from "./lint";

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

/**
 * The third paper trial in miniature (#440): a gray panel (`groupFill`) holding blue and green
 * hyperedge sets that overlap, around toned nodes.
 */
const trial = (groupFill = "'#f3f3f3'") => `version: 1
figure:
  id: trial
  theme: paper
  profile: paper-double
  themeOverrides:
    groupFill: ${groupFill}
  layout:
    arrange: { row: { gap: 3mm, items: [panel] } }
groups:
  - id: panel
    label: Hypergraph
    arrange:
      place:
        unit: 1pt
        items:
          - { item: p1, at: [0, 0] }
          - { item: p2, at: [34, 0] }
          - { item: p3, at: [6, 34] }
          - { item: t1, at: [40, 36] }
          - { item: t2, at: [70, 20] }
nodes:
  - { id: p1, component: box, label: P1, tone: blue, variant: tinted }
  - { id: p2, component: box, label: P2, tone: blue, variant: tinted }
  - { id: p3, component: box, label: P3, tone: blue, variant: tinted }
  - { id: t1, component: box, label: T1, tone: green, variant: tinted }
  - { id: t2, component: box, label: T2, tone: green, variant: tinted }
sets:
  - { id: e1, members: [p1, p2, p3], shape: ellipse, angle: auto, tone: blue, padding: 3pt, fillOpacity: 0.15 }
  - { id: e2, members: [p3, t1], shape: ellipse, angle: auto, tone: green, padding: 3pt, fillOpacity: 0.15 }
  - { id: e3, members: [p2, t1, t2], shape: ellipse, angle: auto, tone: green, padding: 3pt, fillOpacity: 0.15 }
`;

async function contextOf(source: string, path?: string) {
  const result = await renderFigure(
    source,
    path === undefined
      ? {}
      : {
          assetBase: new URL(`../../../${path.replace(/\/[^/]*$/, "")}`, import.meta.url).pathname,
        },
  );
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return geometryContextFor(result.value);
}

describe("geometry/muddy-color (#440): the third trial", () => {
  test("reports muddy strokes as well as fills, but not text", async () => {
    const context = await contextOf(`version: 1
figure:
  id: ochre-lines
  theme: paper
  themeOverrides:
    tones:
      yellow: { line: '#876200', text: '#876200' }
nodes:
  - { id: yellow, component: box, label: yellow, tone: yellow, variant: outlined }
`);
    const findings = muddyColor.run(context, undefined);
    expect(
      findings.some((f) => f.message.includes("stroke") && f.message.includes("#876200")),
    ).toBe(true);
    expect(findings.some((f) => f.message.includes("fontColor"))).toBe(false);
  });
  test("reports an opaque khaki node and suggests a lighter fill", async () => {
    for (const fill of ["#d1bc79", "#d2b48c", "#808000", "#b5a642", "#c3b091"]) {
      const source = `version: 1
figure:
  id: khaki
  theme: paper
  themeOverrides:
    tones:
      yellow: { fill: '${fill}' }
nodes:
  - { id: yellow, component: box, label: yellow, tone: yellow }
`;
      const findings = muddyFindings(analyze(paintItems(await contextOf(source))));
      expect(
        findings.some((finding) => finding.message.includes("khaki")),
        fill,
      ).toBe(true);
      expect(findings[0]?.hint).toContain("lighter yellow");
    }
  });
  test("drawn as before (translucent tints over a gray panel) it is reported", async () => {
    const context = await contextOf(trial());
    const legacy = analyze(paintItems(context, { translucentSets: true }));
    const muddy = muddyFindings(legacy);
    expect(muddy.length).toBeGreaterThan(0);
    expect(muddy[0]?.message).toContain("is painted");
    expect(muddy[0]?.message).toContain('group "panel"');
    expect(muddy[0]?.hint).toContain("white");
    const translucent = translucentFindings(legacy);
    expect(translucent.length).toBeGreaterThan(0);
    expect(translucent[0]?.message).toContain("translucent");
  });

  test("drawn with opaque tints (the renderers since #440) the same figure is not muddy", async () => {
    const context = await contextOf(trial());
    const now = analyze(paintItems(context));
    expect(muddyFindings(now)).toEqual([]);
    expect(translucentFindings(now)).toEqual([]);
  });

  test("the colors of the panel and the sets are still reported (info): colored elements on a gray panel", async () => {
    const context = await contextOf(trial());
    const findings = panelFindings(analyze(paintItems(context)));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("#f3f3f3");
    expect(findings[0]?.message).toContain("colored elements");
    // The panel's color is the figure's groupFill: one override whitens every panel (#608).
    expect(findings[0]?.hint).toContain("themeOverrides.groupFill: '#ffffff'");
    expect(colorOnPanel.defaultSeverity).toBe("info");
  });

  test("on a white panel nothing is reported", async () => {
    const context = await contextOf(trial("'#ffffff'"));
    const items = analyze(paintItems(context));
    expect(panelFindings(items)).toEqual([]);
    expect(muddyFindings(items)).toEqual([]);
    // Even on white, translucent tints that overlap mix into a duller color: that is reported too.
    const legacy = muddyFindings(analyze(paintItems(context, { translucentSets: true })));
    expect(legacy.length).toBeGreaterThan(0);
    expect(legacy.every((f) => /set "e\d"/.test(f.message))).toBe(true);
  });

  test("the rules are warnings, the structural one an info, and they run as geometry rules", () => {
    expect(muddyColor.defaultSeverity).toBe("warning");
    expect(translucentOverColor.defaultSeverity).toBe("warning");
    expect(muddyColor.id).toBe("geometry/muddy-color");
  });
});

describe("the overlap of sets is painted opaquely", () => {
  test("an overlap keeps the chroma of its sets (a stack of translucent fills over gray loses it)", async () => {
    const context = await contextOf(trial("'#ffffff'"));
    const items = paintItems(context);
    const overlaps = items.filter((i) => i.kind === "overlap");
    expect(overlaps.length).toBeGreaterThan(0);
    for (const overlap of overlaps) {
      const lightness = (overlap.of ?? []).map((c) => toOklch(c).l);
      // The average of its sets: neither darker nor lighter than all of them. Three or more
      // sets may be moved up to 0.08 away to differ from each of them (#547).
      const slack = lightness.length >= 3 ? 0.081 : 1e-3;
      expect(toOklch(overlap.color).l).toBeGreaterThanOrEqual(Math.min(...lightness) - slack);
      expect(toOklch(overlap.color).l).toBeLessThanOrEqual(Math.max(...lightness) + slack);
      expect(toOklch(overlap.color).c).toBeGreaterThan(0.005);
    }
  });
});

describe("muddiness() thresholds", () => {
  test("opaque khaki fills are muddy even on white; pale yellow and gray are not", () => {
    const orange = { l: 0.8, c: 0.06, h: 80 };
    expect(muddinessOf(orange, orange)).toBe("khaki");
    for (const hex of [
      "#d1bc79",
      "#d2b48c",
      "#808000",
      "#b5a642",
      "#c3b091",
      "#a5a57a",
      "#b5b589",
      "#ebecbe",
      "#cda58b",
      "#deb59a",
      "#e5c4a1",
      "#efcfab",
      "#9a6700",
      "#996600",
      "#876200",
      "#8a6d00",
      "#7f6600",
    ]) {
      const color = toOklch(hex);
      expect(muddinessOf(color, color), hex).toBe("khaki");
    }
    for (const hex of ["#f8efbf", "#fde7a3", "#f7bc90", "#fcd1b6", "#cccccc", "#d1e7ff"]) {
      const color = toOklch(hex);
      expect(muddinessOf(color, color), hex).toBeUndefined();
    }
  });
  test("dark ochre threshold tapers continuously at the hue boundary", () => {
    for (const h of [74.7, 75, 75.3]) {
      const color = { l: 0.55, c: 0.116, h };
      expect(muddinessOf(color, color)).toBe("khaki");
    }
    const orange = { l: 0.55, c: 0.17, h: 40 };
    expect(muddinessOf(orange, orange)).toBeUndefined();
  });
  test("a tone kept intact is fine; one that lost its chroma, darkened into gray or drifted is not", () => {
    const blue = toOklch("#d1e7ff");
    expect(muddinessOf(blue, blue)).toBeUndefined();
    expect(muddinessOf(blue, { ...blue, c: blue.c * 0.3 })).toBe("chroma");
    expect(muddinessOf({ l: 0.93, c: 0.04, h: 163 }, { l: 0.84, c: 0.035, h: 163 })).toBe("dull");
    expect(muddinessOf({ l: 0.93, c: 0.04, h: 163 }, { l: 0.92, c: 0.045, h: 200 })).toBe("drift");
  });
});

describe("composite colors", () => {
  const item = (over: Partial<PaintItem>): PaintItem => ({
    kind: "group",
    name: 'group "g" fill',
    color: "#f3f3f3",
    alpha: 1,
    ink: "#f3f3f3",
    region: { kind: "polygon", points: [] },
    bbox: { x: 0, y: 0, width: 100, height: 100 },
    docPath: [],
    subject: { kind: "group", id: "g" },
    ...over,
  });
  const box = (x: number, y: number, w: number, h: number) =>
    ({
      kind: "polygon",
      points: [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
      ],
    }) as const;

  test("over() blends a translucent color with what lies under it", () => {
    expect(over("#000000", 0.5, "#ffffff")).toBe("#808080");
    expect(over("#123456", 1, "#ffffff")).toBe("#123456");
  });

  test("mixed overlaps inspect their own paint and translucent layers above", () => {
    const mixed = (color: string) =>
      item({
        kind: "overlap",
        name: "mixed overlap",
        overlapMix: true,
        color,
        ink: color,
        of: ["#ff0000", "#00ff00"],
        region: box(0, 0, 100, 100),
      });
    expect(muddyFindings(analyze([mixed("#d1bc79")]))[0]?.message).toContain("khaki");
    expect(muddyFindings(analyze([mixed("#d1e7ff")]))).toEqual([]);
    const veil = item({
      kind: "node",
      color: "#808080",
      ink: "#808080",
      alpha: 0.8,
      region: box(0, 0, 100, 100),
    });
    expect(
      muddyFindings(analyze([mixed("#d1e7ff"), veil])).some((f) =>
        f.message.includes("Mixed overlap"),
      ),
    ).toBe(true);
  });

  test("a translucent blue over a gray panel is flagged by the two rules; an opaque one is not", () => {
    const panel = item({ region: box(0, 0, 100, 100) });
    const set = (alpha: number, color: string) =>
      item({
        kind: "set",
        name: 'set "s" fill',
        color,
        alpha,
        ink: "#31608e",
        region: box(20, 20, 60, 60),
        bbox: { x: 20, y: 20, width: 60, height: 60 },
      });
    const translucent = analyze([panel, set(0.15, "#31608e")]);
    expect(translucentFindings(translucent)).toHaveLength(1);
    const opaque = analyze([panel, set(1, "#dce6f0")]);
    expect(translucentFindings(opaque)).toEqual([]);
    expect(muddyFindings(opaque)).toEqual([]);
  });
});

describe("calibration on the repository's figures (#440)", () => {
  const paths = [
    "examples/llada/llada.sumi.yaml",
    "examples/llama4-moe/llama4-moe.sumi.yaml",
    "examples/tricl/tricl.sumi.yaml",
    "examples/transformer/transformer.sumi.yaml",
    "examples/dit-block/dit-block.sumi.yaml",
    "examples/gcn/gcn.sumi.yaml",
  ];

  for (const path of paths) {
    test(`${path}: no muddy colors, no translucent fills over colors`, async () => {
      const context = await contextOf(read(path), path);
      const items = analyze(paintItems(context));
      expect(muddyFindings(items), path).toEqual([]);
      expect(translucentFindings(items), path).toEqual([]);
    });
  }

  test("LLaDA and Llama 4 MoE have no panel with colored elements either", async () => {
    for (const path of [
      "examples/llada/llada.sumi.yaml",
      "examples/llama4-moe/llama4-moe.sumi.yaml",
    ]) {
      const context = await contextOf(read(path), path);
      expect(panelFindings(analyze(paintItems(context))), path).toEqual([]);
    }
  });

  test("every example, in its own theme, is free of muddy and translucent colors", async () => {
    for (const dir of readdirSync(new URL("../../../examples", import.meta.url), {
      withFileTypes: true,
    })) {
      if (!dir.isDirectory()) continue;
      const path = `examples/${dir.name}/${dir.name}.sumi.yaml`;
      let source: string;
      try {
        source = read(path);
      } catch {
        continue;
      }
      const result = await renderFigure(source, {
        assetBase: new URL(`../../../examples/${dir.name}`, import.meta.url).pathname,
      });
      if (!result.ok) continue;
      const items = analyze(paintItems(geometryContextFor(result.value)));
      expect(muddyFindings(items), path).toEqual([]);
      expect(translucentFindings(items), path).toEqual([]);
    }
  });
});

describe("geometry/color-on-panel across tones (#548)", () => {
  const TONES = ["red", "orange", "yellow", "green", "blue", "purple", "pink"];
  const panelOf = (theme: string, panel: string, tone: string, variant = "filled") => `version: 1
figure:
  id: tones
  theme: ${theme}
  layout:
    arrange: { row: { gap: 4mm, items: [g] } }
groups:
  - id: g
    caption: Panel
    tone: ${panel}
    variant: filled
    arrange: { row: { gap: 4mm, items: [a, b, c] } }
nodes:
${["a", "b", "c"].map((id) => `  - { id: ${id}, component: box, label: ${id}, ${tone === "none" ? "" : `tone: ${tone}, `}variant: ${variant} }`).join("\n")}
edges: []
`;
  const count = async (source: string) =>
    panelFindings(analyze(paintItems(await contextOf(source)))).length;

  test("in sumi every chromatic tone is reported alike, on a gray panel and on a panel of its own tone", async () => {
    for (const tone of TONES) {
      expect(await count(panelOf("sumi", "gray", tone)), `${tone} on gray`).toBe(1);
      expect(await count(panelOf("sumi", tone, tone)), `${tone} on ${tone}`).toBe(1);
    }
    expect(await count(panelOf("sumi", "gray", "gray"))).toBe(0);
  });

  // Following the hint makes the finding go away, whichever source paints the panel (#608): each
  // case applies the edit the hint names to the YAML and renders it again.
  const panelFigure = (theme: string, group: string, overrides = "") => `version: 1
figure:
  id: fix
  theme: ${theme}
${overrides}  layout:
    arrange: { row: { gap: 4mm, items: [g] } }
groups:
  - id: g
    caption: Panel
${group}    arrange: { row: { gap: 4mm, items: [a, b, c] } }
nodes:
${["a", "b", "c"].map((id) => `  - { id: ${id}, component: box, label: ${id}, tone: green, variant: filled }`).join("\n")}
edges: []
`;
  const hintsOf = async (source: string) => {
    const context = await contextOf(source);
    return panelFindings(analysisOf(context), panelFillsOf(context.ir)).map((f) => f.hint ?? "");
  };
  const TONE = "    tone: blue\n";
  const cases: {
    name: string;
    theme?: string;
    group: string;
    overrides?: string;
    says: string[];
    not?: string[];
    fix: (source: string) => string;
  }[] = [
    {
      name: "tone and filled",
      group: `${TONE}    variant: filled\n`,
      says: ["remove its `tone: blue`", "change its `variant: filled` to `default`"],
      fix: (t) => t.replace(TONE, "").replace("variant: filled\n", "variant: default\n"),
    },
    {
      name: "tone only",
      group: TONE,
      says: ["remove its `tone: blue`"],
      not: ["variant", "groupFill"],
      fix: (t) => t.replace(TONE, ""),
    },
    {
      name: "filled only",
      group: "    variant: filled\n",
      says: ["change its `variant: filled` to `default`"],
      not: ["tone", "groupFill"],
      fix: (t) => t.replace("variant: filled\n", "variant: default\n"),
    },
    {
      name: "filled-dashed",
      group: "    variant: filled-dashed\n",
      says: ["change its `variant: filled-dashed` to `dashed`"],
      fix: (t) => t.replace("variant: filled-dashed\n", "variant: dashed\n"),
    },
    {
      name: "a non-white groupFill",
      group: "",
      overrides: "  themeOverrides: {groupFill: '#efeddd'}\n",
      says: ["`figure.themeOverrides.groupFill: '#ffffff'` (now '#efeddd')"],
      not: ["Remove"],
      fix: (t) => t.replace("'#efeddd'", "'#ffffff'"),
    },
    {
      name: "a tone over a non-white groupFill",
      group: TONE,
      overrides: "  themeOverrides: {groupFill: '#efeddd'}\n",
      says: [
        "Remove the group's `tone: blue` and set `figure.themeOverrides.groupFill: '#ffffff'`",
      ],
      fix: (t) => t.replace(TONE, "").replace("'#efeddd'", "'#ffffff'"),
    },
    {
      name: "a palette's panel (color theme)",
      theme: "color",
      group: "",
      overrides: "  themeOverrides: {palette: sage}\n",
      says: ["`figure.themeOverrides.groupFill: '#ffffff'` (the theme's panel is #"],
      fix: (t) => t.replace("{palette: sage}", "{palette: sage, groupFill: '#ffffff'}"),
    },
    {
      // The palette tints a muted group in every theme; color's default panel is tinted too.
      name: "a palette's muted panel (color theme)",
      theme: "color",
      group: "    variant: muted\n",
      overrides: "  themeOverrides: {palette: sage}\n",
      says: ["`figure.themeOverrides.groupFill: '#ffffff'`"],
      not: ["variant: muted"],
      fix: (t) => t.replace("{palette: sage}", "{palette: sage, groupFill: '#ffffff'}"),
    },
    {
      // sumi's default panel stays white under a palette: the calmer variant clears it.
      name: "a palette's muted panel (sumi)",
      group: "    variant: muted\n",
      overrides: "  themeOverrides: {palette: sage}\n",
      says: ["change its `variant: muted` to `default`"],
      fix: (t) => t.replace("variant: muted\n", "variant: default\n"),
    },
  ];
  test.each(cases.map((c) => [c.name, c] as const))(
    "the color-on-panel hint for %s is a change that clears it",
    async (_, c) => {
      const source = panelFigure(c.theme ?? "sumi", c.group, c.overrides);
      const hints = await hintsOf(source);
      expect(hints).toHaveLength(1);
      for (const part of c.says) expect(hints[0], part).toContain(part);
      for (const part of c.not ?? []) expect(hints[0], part).not.toContain(part);
      expect(await hintsOf(c.fix(source))).toEqual([]);
    },
  );

  test("sumi-dark's panel is its canvas: the fixed panel is not reported there either", async () => {
    const source = panelFigure("sumi-dark", `${TONE}    variant: filled\n`);
    const [hint] = await hintsOf(source);
    expect(hint).toContain("the canvas (#30364f)");
    expect(await hintsOf(source.replace(TONE, "").replace("    variant: filled\n", ""))).toEqual(
      [],
    );
  });

  test("neutral boxes (default outlined, white) on a colored panel are not colored, in any theme", async () => {
    for (const theme of ["sumi", "paper", "color", "llama", "academic"]) {
      for (const panel of ["blue", "green", "gray"]) {
        expect(await count(panelOf(theme, panel, "none", "outlined")), `${theme} ${panel}`).toBe(0);
      }
    }
  });
});
