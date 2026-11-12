import { expect, test } from "bun:test";
import type { ElementIR } from "../../compiler/ir";
import { compile, lintSpec } from "./testing";

const source = `version: 1
figure: { id: contrast, theme: llama, themeOverrides: { palette: cool-blue } }
groups: [{ id: panel, variant: filled }]
nodes:
  - { id: a, component: box, group: panel }
  - { id: b, component: box, group: panel }
edges: [{ id: e, from: a, to: b, tone: yellow }]
`;

test("measures edge contrast on the actual panel and permits severity overrides", () => {
  const compiled = compile(source);
  const spec = {
    elements: {
      "g:panel": { bbox: { x: 0, y: 0, width: 200, height: 100 } },
      "e:e": {
        path: [
          { x: 20, y: 50 },
          { x: 180, y: 50 },
        ],
      },
    },
  };
  const code = "geometry/low-stroke-contrast";
  const findings = lintSpec(compiled, spec, { code });
  expect(findings).toHaveLength(1);
  expect(findings[0]?.severity).toBe("info");
  expect(findings[0]?.message).toContain("2.13:1");
  expect(
    lintSpec(compiled, spec, { code, config: { rules: { [code]: "error" } } })[0]?.severity,
  ).toBe("error");
});

test("does not flag decorative frames around contrasting fills", () => {
  const compiled = compile(`version: 1
figure: { id: frame, theme: llama, themeOverrides: { palette: cool-blue } }
groups: [{ id: panel, variant: filled }]
nodes: [{ id: frame, component: box, group: panel, variant: filled, tone: yellow }]
`);
  const findings = lintSpec(
    compiled,
    {
      elements: {
        "g:panel": { bbox: { x: 0, y: 0, width: 200, height: 100 } },
        "n:frame": { bbox: { x: 30, y: 20, width: 120, height: 60 } },
      },
    },
    { code: "geometry/low-stroke-contrast" },
  );
  expect(findings.filter((f) => f.subject?.id === "frame")).toEqual([]);
});

const code = "geometry/low-stroke-contrast";

test("an edge that nearly vanishes is a warning", () => {
  const compiled = compile(`version: 1
figure:
  id: faint
  theme: color
  themeOverrides: { tones: { blue: { line: "#f4f4f4" } } }
nodes:
  - { id: a, component: box }
  - { id: b, component: box }
edges: [{ id: e, from: a, to: b, tone: blue }]
`);
  const findings = lintSpec(
    compiled,
    {
      elements: {
        "e:e": {
          path: [
            { x: 20, y: 50 },
            { x: 180, y: 50 },
          ],
        },
      },
    },
    { code },
  );
  expect(findings.map((f) => f.severity)).toEqual(["warning"]);
});

test("group frames and dimmed elements are not checked", () => {
  const compiled = compile(`version: 1
figure: { id: quiet, theme: paper }
groups: [{ id: g, label: G, dim: true }]
nodes: [{ id: a, component: box, group: g }]
`);
  const findings = lintSpec(
    compiled,
    {
      elements: {
        "g:g": { bbox: { x: 0, y: 0, width: 200, height: 100 } },
        "n:a": { bbox: { x: 40, y: 30, width: 80, height: 40 } },
      },
    },
    { code },
  );
  expect(findings).toEqual([]);
});

test("transparent frames see preceding fills but not later fills, including short hex", () => {
  const original = compile(`version: 1
figure: { id: order, theme: paper }
nodes:
  - { id: below, component: box }
  - { id: frame, component: box }
  - { id: above, component: box }
`);
  const elements = new Map(original.ir.elements);
  for (const [id, fill, stroke] of [
    ["below", "#aaa", "#000"],
    ["frame", "transparent", "#aaa"],
    ["above", "#fff", "#000"],
  ]) {
    const key = `n:${id}` as const;
    const element = elements.get(key);
    if (element)
      elements.set(key, {
        ...element,
        style: { ...element.style, fill: fill as string, stroke: stroke as string },
      } as ElementIR);
  }
  const compiled = { ...original, ir: { ...original.ir, elements } };
  const rect = { x: 0, y: 0, width: 100, height: 100 };
  const findings = lintSpec(
    compiled,
    {
      elements: {
        "n:below": { bbox: rect },
        "n:frame": { bbox: rect },
        "n:above": { bbox: rect },
      },
    },
    { code },
  );
  // The opaque node painted above hides the frame entirely: nothing to report.
  expect(findings.some((f) => f.subject?.id === "frame")).toBe(false);
  expect(findings.some((f) => f.subject?.id === "below")).toBe(false);
  // Without the node above, the frame shows on the preceding gray fill and is reported.
  const exposed = lintSpec(
    compiled,
    {
      elements: {
        "n:below": { bbox: rect },
        "n:frame": { bbox: rect },
        "n:above": { bbox: { x: 400, y: 400, width: 10, height: 10 } },
      },
    },
    { code },
  );
  expect(exposed.some((f) => f.subject?.id === "frame" && f.message.includes("#aaaaaa"))).toBe(
    true,
  );
});

test("warning requires ten units below 1.5, independently of the info length", () => {
  const original = compile(`version: 1
figure: { id: lengths, theme: paper }
nodes: [{ id: a, component: box }, { id: b, component: box }, { id: patch, component: box }]
edges: [{ id: e, from: a, to: b }]
`);
  const elements = new Map(original.ir.elements);
  for (const [key, changes] of [
    ["e:e", { stroke: "#aaa", opacity: 1 }],
    ["n:patch", { fill: "#aaa" }],
  ] as const) {
    const element = elements.get(key);
    if (element)
      elements.set(key, { ...element, style: { ...element.style, ...changes } } as ElementIR);
  }
  const compiled = { ...original, ir: { ...original.ir, elements } };
  const run = (length: number, patchWidth: number) =>
    lintSpec(
      compiled,
      {
        elements: {
          "n:patch": { bbox: { x: 0, y: 0, width: patchWidth, height: 20 } },
          "e:e": {
            path: [
              { x: 0, y: 10 },
              { x: length, y: 10 },
            ],
          },
        },
      },
      { code },
    ).filter((f) => f.subject?.id === "e");
  expect(run(8, 0)).toHaveLength(0);
  expect(run(12, 0)[0]?.severity).toBe("info");
  expect(run(100, 4)[0]?.severity).toBe("info");
  expect(run(100, 12)[0]?.severity).toBe("warning");
});

test("edge thresholds and intentional dimming", () => {
  const original = compile(`version: 1
figure: { id: thresholds, theme: paper }
nodes: [{ id: a, component: box }, { id: b, component: box }]
edges: [{ id: e, from: a, to: b }]
`);
  const spec = {
    elements: {
      "e:e": {
        path: [
          { x: 0, y: 0 },
          { x: 40, y: 0 },
        ],
      },
    },
  };
  const run = (stroke: string, dimmed = false) => {
    const elements = new Map(original.ir.elements);
    const edge = elements.get("e:e");
    if (edge?.kind !== "edge") throw new Error("missing edge");
    elements.set("e:e", { ...edge, style: { ...edge.style, stroke } } as ElementIR);
    return lintSpec(
      { ...original, ir: { ...original.ir, elements, dimmed: dimmed ? ["e:e"] : [] } },
      spec,
      { code },
    );
  };
  expect(run("#949494")).toHaveLength(0);
  expect(run("#959595")[0]?.severity).toBe("info");
  expect(run("#d2d2d2")[0]?.severity).toBe("info");
  expect(run("#d3d3d3")[0]?.severity).toBe("warning");
  expect(run("#d3d3d3", true)).toHaveLength(0);
});

async function strokeFindings(yaml: string) {
  const { renderFigure } = await import("../../render");
  const { lintGeometry } = await import("./lint");
  const rendered = await renderFigure(yaml, { file: "contrast.sumi.yaml" });
  if (!rendered.ok) throw new Error(JSON.stringify(rendered.diagnostics));
  return lintGeometry(rendered.value, { source: yaml, file: "contrast.sumi.yaml" }).filter(
    (d) => d.code === code,
  );
}

test("measures against a non-white theme canvas", async () => {
  // #3d4560 is barely lighter than sumi-dark's #30364f canvas, though far from white.
  const findings = await strokeFindings(`version: 1
figure:
  id: dark
  theme: sumi-dark
  themeOverrides: { tones: { blue: { line: "#3d4560" } } }
  layout: { arrange: { row: { gap: 20mm, items: [a, b] } } }
nodes:
  - { id: a, component: box, label: A }
  - { id: b, component: box, label: B }
edges: [{ from: a, to: b, tone: blue }]
`);
  expect(findings).toHaveLength(1);
  expect(findings[0]?.severity).toBe("warning");
  expect(findings[0]?.message).toContain("#30364f");
});

test("measures an edge against the set tint it crosses", async () => {
  const yaml = (line: string) => `version: 1
figure:
  id: set
  theme: paper
  themeOverrides: { tones: { green: { line: "${line}" } } }
  layout: { arrange: { row: { gap: 24mm, items: [a, b] } } }
sets: [{ id: s, members: [a, b], shape: rect, tone: blue, variant: filled, fillOpacity: 1 }]
nodes:
  - { id: a, component: box, label: A }
  - { id: b, component: box, label: B }
edges: [{ from: a, to: b, tone: green }]
`;
  const findings = await strokeFindings(yaml("#3f72af"));
  // The edge runs inside the filled blue set, not on the white canvas.
  expect(findings.some((f) => !f.message.includes("#ffffff"))).toBe(true);
});

test("an outline-only node's frame is reported under 2:1 and not at 2:1 or more", async () => {
  const yaml = (line: string) => `version: 1
figure:
  id: frame
  theme: paper
  themeOverrides: { tones: { blue: { line: "${line}" } } }
  layout: { arrange: { row: { items: [a] } } }
nodes: [{ id: a, component: box, label: A, tone: blue, variant: outlined }]
`;
  // On white: #bebebe is 1.86:1, #b0b0b0 is 2.17:1.
  expect((await strokeFindings(yaml("#bebebe"))).map((f) => f.severity)).toEqual(["info"]);
  expect(await strokeFindings(yaml("#b0b0b0"))).toEqual([]);
});
