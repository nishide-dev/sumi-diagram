import { expect, test } from "bun:test";
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
