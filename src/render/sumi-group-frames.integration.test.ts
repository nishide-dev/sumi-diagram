/**
 * The group frame contract of `sumi` and `sumi-dark` (#634): every frame a container draws is a
 * 0.5pt pale hairline; `filled-dashed`, sets and legends keep their 1pt frames; the figure's
 * overrides replace it; other themes are unaffected.
 */

import { describe, expect, test } from "bun:test";
import { getTheme } from "../core/theme/builtin";
import { resolveStyle } from "../core/theme/resolve";
import { resolveSetStyle } from "../core/theme/set-style";
import { renderFigure } from "./render";

const FRAME = { sumi: "#a9aebc", "sumi-dark": "#6f7791" } as const;
const MUTED = { sumi: "#4e566b", "sumi-dark": "#acbac4" } as const;

const figure = (theme: string, overrides = "") => `version: 1
figure:
  id: frames
  theme: ${theme}
  profile: paper-double
  projection: {angle: 45, depthScale: 0.6}
${overrides ? `  themeOverrides: ${overrides}\n` : ""}  layout:
    arrange:
      stack:
        gap: 6mm
        items:
          - row: {gap: 6mm, items: [default, muted, dashed, dotted, filled-dashed]}
          - row: {gap: 8mm, items: [layers, plane, key]}
groups:
  - {id: default, label: Default, arrange: {stack: {items: [n1]}}}
  - {id: muted, label: Muted, variant: muted, arrange: {stack: {items: [n2]}}}
  - {id: dashed, label: Dashed, variant: dashed, arrange: {stack: {items: [n3]}}}
  - {id: dotted, label: Dotted, variant: dotted, arrange: {stack: {items: [n4]}}}
  - {id: filled-dashed, label: Filled, variant: filled-dashed, arrange: {stack: {items: [n5]}}}
  - {id: layers, label: Layers, props: {layers: {count: 3, offset: 3pt}}, arrange: {stack: {items: [n6]}}}
  - {id: plane, label: Plane, props: {plane: floor}, arrange: {row: {items: [n7]}}}
nodes:
  - {id: n1, component: box, label: A}
  - {id: n2, component: box, label: B}
  - {id: n3, component: box, label: C}
  - {id: n4, component: box, label: D}
  - {id: n5, component: box, label: E}
  - {id: n6, component: box, label: F}
  - {id: n7, component: box, label: G}
  - id: key
    component: legend
    props:
      entries:
        - {label: box, node: {component: box}}
sets:
  - {id: s, label: S, members: [n1, n2], tone: blue}
`;

async function compile(text: string) {
  const result = await renderFigure(text);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return result.value.compiled.ir;
}

const frameOf = (style: { stroke: string; strokeWidth: { pt: number } } | undefined) =>
  style === undefined ? undefined : { stroke: style.stroke, width: style.strokeWidth.pt };

describe("sumi group frames (#634)", () => {
  for (const id of ["sumi", "sumi-dark"] as const) {
    test(`${id}: every frame a container draws is a 0.5pt pale hairline`, async () => {
      const ir = await compile(figure(id));
      const group = (gid: string) => frameOf(ir.groups.find((g) => g.id === gid)?.style);
      for (const gid of ["default", "muted", "dashed", "dotted", "layers", "plane"])
        expect(group(gid), `${id} ${gid}`).toEqual({ stroke: FRAME[id], width: 0.5 });
      // Nodes keep their 1pt outline.
      expect(ir.nodes.find((n) => n.id === "n1")?.style.strokeWidth.pt).toBe(1);
    });

    test(`${id}: filled-dashed, sets and legends keep their 1pt frames`, async () => {
      const ir = await compile(figure(id));
      expect(frameOf(ir.groups.find((g) => g.id === "filled-dashed")?.style)).toEqual({
        stroke: MUTED[id],
        width: 1,
      });
      const set = ir.sets?.find((s) => s.id === "s")?.style;
      expect(set?.strokeWidth.pt).toBe(1);
      expect(set?.stroke).toBe(getTheme(id)?.toneLines.get("blue")?.stroke);
      const legend = ir.groups.find((g) => g.id === "key")?.style;
      expect(frameOf(legend)).toEqual({ stroke: MUTED[id], width: 1 });
    });

    test(`${id}: groupStroke and frameWidth bring back the gray 1pt frame`, async () => {
      const ir = await compile(figure(id, `{ groupStroke: "${MUTED[id]}", frameWidth: 1pt }`));
      for (const gid of ["default", "muted", "dashed", "dotted", "layers", "plane"])
        expect(frameOf(ir.groups.find((g) => g.id === gid)?.style), `${id} ${gid}`).toEqual({
          stroke: MUTED[id],
          width: 1,
        });
    });

    test(`${id}: the theme resolves the frame for each variant`, () => {
      const theme = getTheme(id);
      if (!theme) throw new Error(`missing ${id}`);
      const frame = (variant: string) =>
        frameOf(resolveStyle(theme, { kind: "group", id: "sumi/container", variant }).style);
      for (const variant of ["default", "muted", "dashed", "dotted"])
        expect(frame(variant), variant).toEqual({ stroke: FRAME[id], width: 0.5 });
      expect(frame("filled-dashed")).toEqual({ stroke: MUTED[id], width: 1 });
      expect(resolveSetStyle(theme, { variant: "default", tone: "blue" }).strokeWidth.pt).toBe(1);
    });
  }

  test("paper keeps its own frames", () => {
    const theme = getTheme("paper");
    if (!theme) throw new Error("missing paper");
    const frame = (variant: string) =>
      frameOf(resolveStyle(theme, { kind: "group", id: "sumi/container", variant }).style);
    expect(frame("default")).toEqual({ stroke: "#b4b8c0", width: 0.5 });
    expect(frame("muted")).toEqual({ stroke: "#737373", width: 0.5 });
    expect(frame("dashed")).toEqual({ stroke: "#b4b8c0", width: 0.5 });
    expect(resolveSetStyle(theme, { variant: "default", tone: "blue" }).strokeWidth.pt).toBe(0.5);
  });
});
