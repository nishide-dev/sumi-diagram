import { expect, test } from "bun:test";
import { stringify } from "yaml";
import { BUILTIN_THEMES } from "../../core/theme/builtin";
import { lintGeometry } from "../../lint";
import { renderFigure } from "../../render";
import { HintTrials, mapBoxes } from "../hint-trials";
import { layoutStructuredFigure } from "../index";
import type { EdgeLayout, LayoutIR } from "../ir";
import { placeStructured } from "./engine";

const fixture = `${import.meta.dir}/../../../tests/fixtures/figures/layout/side-inputs.sumi.yaml`;

function straight(edge: EdgeLayout | undefined, axis: "x" | "y") {
  expect(edge).toBeDefined();
  const points = edge?.route?.points;
  expect(points).toHaveLength(2);
  expect(Math.abs((points?.[0]?.[axis] ?? NaN) - (points?.[1]?.[axis] ?? NaN))).toBeLessThanOrEqual(
    0.001,
  );
}

function center(layout: LayoutIR, id: string, axis: "x" | "y") {
  const rect = layout.nodes.find((n) => n.key === `n:${id}`)?.rect;
  if (!rect) throw new Error(`missing ${id}`);
  return rect[axis] + rect[axis === "x" ? "width" : "height"] / 2;
}

for (const theme of BUILTIN_THEMES.keys()) {
  for (const above of [false, true]) {
    test(`side inputs preserve the centerline and reserve space (${theme}, ${above ? "above" : "below"})`, async () => {
      const source = await Bun.file(fixture).text();
      const text = above
        ? source
            .replaceAll("centerOn:", "direction: up\n              centerOn:")
            .replaceAll("fromAnchor: north, toAnchor: south", "fromAnchor: south, toAnchor: north")
        : source;
      const result = await renderFigure(text, { overrides: { theme } });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      expect(result.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
      const rendered = result.value;
      if (!("layout" in rendered)) throw new Error("expected structured layout");
      const rect = (id: string) => {
        const node = rendered.layout.nodes.find((n) => n.key === `n:${id}`);
        if (!node) throw new Error(`missing ${id}`);
        return node.rect;
      };
      const main = ["features", "encoder", "decoder", "predictions"].map(rect);
      const centers = main.map((r) => r.y + r.height / 2);
      expect(Math.max(...centers) - Math.min(...centers)).toBeLessThanOrEqual(0.001);
      const geometry = lintGeometry(rendered, { source: text });
      expect(geometry.filter((d) => d.severity !== "info")).toEqual([]);
      // Main-flow edges remain visibly straight, including encoder → decoder.
      for (const edge of rendered.layout.edges.slice(0, 3)) {
        expect(
          edge.route?.points.every((p) => Math.abs(p.y - (edge.route?.points[0]?.y ?? 0)) < 0.001),
        ).toBe(true);
      }
      for (const id of ["position", "queries"]) {
        straight(
          rendered.layout.edges.find((e) => e.from === `n:${id}` || e.from === `g:${id}`),
          "x",
        );
      }
    });
  }
}

for (const theme of BUILTIN_THEMES.keys()) {
  for (const left of [false, true]) {
    test(`side inputs route horizontally (${theme}, ${left ? "left" : "right"})`, async () => {
      const source = await Bun.file(fixture).text();
      const text = source
        .replace("      row:", "      stack:")
        .replaceAll("- stack:", "- row:")
        .replaceAll("centerOn:", `direction: ${left ? "left" : "right"}\n              centerOn:`)
        .replaceAll(
          "fromAnchor: north, toAnchor: south",
          left ? "fromAnchor: east, toAnchor: west" : "fromAnchor: west, toAnchor: east",
        );
      const result = await renderFigure(text, { overrides: { theme } });
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      const rendered = result.value;
      if (!("layout" in rendered)) throw new Error("expected structured layout");
      expect(result.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
      expect(lintGeometry(rendered, { source: text }).filter((d) => d.severity !== "info")).toEqual(
        [],
      );
      for (const id of ["encoder", "decoder", "predictions"])
        expect(
          Math.abs(center(rendered.layout, id, "x") - center(rendered.layout, "features", "x")),
        ).toBeLessThanOrEqual(0.001);
      for (const edge of rendered.layout.edges.slice(0, 3)) straight(edge, "x");
      for (const id of ["position", "queries"])
        straight(
          rendered.layout.edges.find((e) => e.from === `n:${id}` || e.from === `g:${id}`),
          "y",
        );
    });
  }
}

test("multiple spread inputs in parallel lanes retain centerOn through alignment and hint trials", async () => {
  const lanes = [0, 1];
  const source = stringify({
    version: 1,
    figure: {
      id: "parallel-inputs",
      layout: {
        fanIn: "spread",
        arrange: {
          stack: {
            align: "start",
            items: lanes.map((i) => ({
              row: {
                items: [
                  `a${i}`,
                  {
                    stack: {
                      centerOn: `b${i}`,
                      items: [`b${i}`, { row: { items: [`x${i}`, `y${i}`] } }],
                    },
                  },
                  `c${i}`,
                ],
              },
            })),
          },
        },
        align: [{ x: ["b0", "b1"] }],
      },
    },
    nodes: lanes.flatMap((i) =>
      ["a", "b", "c", "x", "y"].map((id) => ({
        id: `${id}${i}`,
        component: "box",
        label: id === "a" && i === 1 ? "Longer lane entry" : id,
      })),
    ),
    edges: lanes.flatMap((i) => [
      { from: `a${i}`, to: `b${i}` },
      { from: `b${i}`, to: `c${i}` },
      ...["x", "y"].map((id) => ({ from: `${id}${i}`, to: `b${i}`, fromAnchor: "north" })),
    ]),
  });
  const result = layoutStructuredFigure(source);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  expect(result.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
  const aligned = placeStructured(result.value.ir);
  expect(Object.values(aligned.align?.struts ?? {}).some((value) => value > 0)).toBe(true);
  const assertLayout = (layout: LayoutIR) => {
    expect(Math.abs(center(layout, "b0", "x") - center(layout, "b1", "x"))).toBeLessThanOrEqual(
      0.001,
    );
    for (const i of lanes) {
      for (const id of ["a", "c"])
        expect(
          Math.abs(center(layout, `${id}${i}`, "y") - center(layout, `b${i}`, "y")),
        ).toBeLessThanOrEqual(0.001);
      const inputs = layout.edges.filter(
        (e) => e.to === `n:b${i}` && [`n:x${i}`, `n:y${i}`].includes(e.from),
      );
      expect(inputs).toHaveLength(2);
      const ends = inputs.map((e) => {
        expect(e.route).toBeDefined();
        return e.route?.points.at(-1)?.x;
      });
      expect(ends[0]).not.toBe(ends[1]);
    }
  };
  assertLayout(result.value.layout);
  const candidate = mapBoxes(result.value.ir, (box) => ({ ...box }));
  const trial = new HintTrials(result.value.ir).run(candidate);
  expect(trial).toBeDefined();
  if (!trial) throw new Error("missing hint trial");
  assertLayout(trial.layout);
  expect(trial.layout).toEqual(result.value.layout);
  const rendered = await renderFigure(source);
  if (!rendered.ok) throw new Error(JSON.stringify(rendered.diagnostics));
  expect(lintGeometry(rendered.value, { source }).filter((d) => d.severity !== "info")).toEqual([]);
});
