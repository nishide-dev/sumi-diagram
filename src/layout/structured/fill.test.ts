import { describe, expect, test } from "bun:test";
import { compileFigure } from "../../compiler/compile";
import { checkFigure } from "../../core/check";
import { layoutStructured } from "./engine";

function figure(justify = "", axis = "stack", direction = "down") {
  const parent = axis === "stack" ? "row" : "stack";
  return `version: 1
figure:
  id: fill
  theme: paper
  layout:
    arrange:
      ${parent}:
        align: stretch
        items:
          - tall
          - ${axis}: { direction: ${direction}, gap: 4pt, ${justify ? `justify: ${justify},` : ""} items: [a, b] }
nodes:
  - { id: tall, component: box, props: { width: 180pt, height: 180pt } }
  - { id: a, component: box, label: A }
  - { id: b, component: box, label: "B\\nMore" }
`;
}

function layout(source: string) {
  const compiled = compileFigure(source);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  return layoutStructured(compiled.value.ir);
}

function rect(value: ReturnType<typeof layout>, index: number) {
  const node = value.nodes[index];
  if (node === undefined) throw new Error(`Missing node ${index}`);
  return node.rect;
}

describe("opt-in main-axis fill", () => {
  for (const [axis, direction] of [
    ["stack", "down"],
    ["stack", "up"],
    ["row", "right"],
    ["row", "left"],
  ]) {
    test(`${axis} ${direction}: equal growth fills sibling extent; center preserves defaults`, () => {
      const source = figure("stretch", axis, direction);
      const filled = layout(source);
      const natural = layout(figure("", axis, direction));
      const a = rect(filled, 1);
      const b = rect(filled, 2);
      const tall = rect(filled, 0);
      const vertical = axis === "stack";
      const size = vertical ? "height" : "width";
      const position = vertical ? "y" : "x";
      expect(a[size] + b[size] + 8).toBeCloseTo(tall[size], 2);
      expect(Math.min(a[position], b[position])).toBeCloseTo(tall[position], 2);
      expect(a[size] - rect(natural, 1)[size]).toBeCloseTo(b[size] - rect(natural, 2)[size], 2);
      expect(layout(figure("center", axis, direction))).toEqual(natural);
      expect(
        direction === "up" || direction === "left"
          ? a[position] > b[position]
          : a[position] < b[position],
      ).toBe(true);
    });
  }

  test("space-between changes gaps, not node sizes; single item stays centred", () => {
    const spaced = layout(figure("space-between"));
    const natural = layout(figure());
    expect(rect(spaced, 1).height).toBe(rect(natural, 1).height);
    expect(rect(spaced, 1).y).toBe(rect(spaced, 0).y);
    expect(rect(spaced, 2).y + rect(spaced, 2).height).toBe(
      rect(spaced, 0).y + rect(spaced, 0).height,
    );
    expect(
      layout(
        figure("space-between")
          .replace("items: [a, b]", "items: [a]")
          .replace(/ {2}- \{ id: b[^\n]+\n/, ""),
      ),
    ).toEqual(
      layout(
        figure()
          .replace("items: [a, b]", "items: [a]")
          .replace(/ {2}- \{ id: b[^\n]+\n/, ""),
      ),
    );
  });

  test("explicit main-axis sizes, circles and custom outlines remain fixed; badges grow with boxes", () => {
    const source = figure("stretch").replace(
      "component: box, label: A",
      "component: box, label: A, props: { height: 20pt }",
    );
    expect(rect(layout(source), 1).height).toBe(40);
    for (const component of ["circle", "bowtie"]) {
      const source = figure("stretch").replace(
        "component: box, label: A",
        `component: ${component}, label: A`,
      );
      const filled = layout(source);
      expect(rect(filled, 1).height).toBe(
        rect(layout(source.replace("justify: stretch,", "")), 1).height,
      );
      expect(rect(filled, 2).height).toBeGreaterThan(rect(filled, 1).height);
    }
    const badged = figure("stretch").replace(
      "label: A }",
      "label: A, badge: { icon: emoji/fire, corner: north-east } }",
    );
    expect(rect(layout(badged), 1).height).toBeGreaterThan(
      rect(layout(badged.replace("justify: stretch,", "")), 1).height,
    );
  });

  test("justify does not inherit; a column with no resizable items stays centred", () => {
    const nested = figure("stretch").replace(
      "items: [a, b]",
      "items: [{ stack: { items: [a, b] } }]",
    );
    const centred = layout(nested);
    expect(rect(centred, 1).height).toBe(rect(layout(figure()), 1).height);
    expect(rect(centred, 1).y).toBeGreaterThan(rect(centred, 0).y);
    const filled = layout(
      nested.replace("stack: { items: [a, b] }", "stack: { justify: stretch, items: [a, b] }"),
    );
    expect(rect(filled, 1).y).toBe(rect(filled, 0).y);
    expect(rect(filled, 2).y + rect(filled, 2).height).toBeCloseTo(
      rect(filled, 0).y + rect(filled, 0).height,
      2,
    );
    const fixed = figure("stretch").replaceAll(
      "component: box, label:",
      "component: box, props: { height: 30pt }, label:",
    );
    expect(layout(fixed)).toEqual(layout(fixed.replace("justify: stretch,", "")));
  });

  test("schema rejects unknown justify values and grid justify; auto rejects structured layout", () => {
    for (const source of [
      figure("grow"),
      figure("stretch").replace("row:", "grid:\n        columns: 2\n        justify: stretch"),
    ]) {
      expect(checkFigure(source).state.diagnostics.some((d) => d.severity === "error")).toBe(true);
    }
    expect(
      checkFigure(
        figure("stretch").replace("  layout:", "  layout:\n    engine: auto"),
      ).state.diagnostics.some((d) => d.code === "layout/structured-only"),
    ).toBe(true);
  });
});
