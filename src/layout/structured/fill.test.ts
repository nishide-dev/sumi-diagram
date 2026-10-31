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
  test("expanded components reject grow at its source location, even under immediate stretch", () => {
    for (const [component, props] of [
      ["tokens", "cells: [A]"],
      ["matrix", "rows: [R], columns: [C], classes: { x: { tone: blue } }, cells: [x]"],
      ["legend", "entries: [{ node: { component: box }, label: A }]"],
    ]) {
      for (const grow of [1, 10]) {
        const source = figure("stretch").replace(
          "component: box, label: A",
          `component: ${component}, grow: ${grow}, props: { ${props} }`,
        );
        const diagnostic = checkFigure(source).state.diagnostics.find(
          (d) => d.code === "component/grow-unsupported",
        );
        expect(diagnostic?.severity).toBe("error");
        expect(diagnostic?.path).toEqual(["nodes", 1, "grow"]);
        expect(diagnostic?.location?.line).toBe(14);
        expect(
          checkFigure(source.replace(`grow: ${grow}, `, "")).state.diagnostics.filter(
            (d) => d.severity === "error",
          ),
        ).toEqual([]);
      }
    }
  });
  test("grow weights divide extra space only; defaults and other modes retain their behavior", () => {
    for (const axis of ["stack", "row"]) {
      const source = figure("stretch", axis, axis === "stack" ? "down" : "right");
      const weighted = source.replace("id: a,", "id: a, grow: 0.5,");
      const natural = layout(source.replace("justify: stretch,", ""));
      const filled = layout(weighted);
      const main = axis === "stack" ? "height" : "width";
      expect(
        Math.abs(
          2 * (rect(filled, 1)[main] - rect(natural, 1)[main]) -
            (rect(filled, 2)[main] - rect(natural, 2)[main]),
        ),
      ).toBeLessThanOrEqual(2);
      expect(layout(source.replace("id: a,", "id: a, grow: 1,"))).toEqual(layout(source));
      expect(
        layout(source.replaceAll("component: box, label:", "component: box, grow: 5e-324, label:")),
      ).toEqual(layout(source));
      for (const mode of ["center", "space-between"]) {
        expect(layout(weighted.replace("justify: stretch", `justify: ${mode}`))).toEqual(
          layout(source.replace("justify: stretch", `justify: ${mode}`)),
        );
      }
      const fixed = weighted.replace("label: A", `props: { ${main}: 40pt }, label: A`);
      expect(rect(layout(fixed), 1)[main]).toBe(80);
    }
    for (const grow of ["0", "-1", "1001", "foo"]) {
      expect(
        checkFigure(
          figure("stretch").replace("id: a,", `id: a, grow: ${grow},`),
        ).state.diagnostics.some((d) => d.severity === "error" && d.path?.at(-1) === "grow"),
      ).toBe(true);
    }
    expect(
      checkFigure(
        figure("stretch")
          .replace("id: a,", "id: a, grow: 0.5,")
          .replace("  layout:", "  layout:\n    engine: auto"),
      ).state.diagnostics.some(
        (d) => d.code === "layout/structured-only" && d.path?.at(-1) === "grow",
      ),
    ).toBe(true);
  });
  for (const [axis, direction] of [
    ["stack", "down"],
    ["stack", "up"],
    ["row", "right"],
    ["row", "left"],
  ]) {
    test(`${axis} ${direction}: weighted whole-unit allocation preserves gaps and extent`, () => {
      const source = figure("stretch", axis, direction).replace(
        "component: box, label: A",
        "component: bowtie, grow: 0.6, label: A",
      );
      const filled = layout(source);
      const main = axis === "stack" ? "height" : "width";
      const pos = axis === "stack" ? "y" : "x";
      const a = rect(filled, 1);
      const b = rect(filled, 2);
      expect(Number.isInteger(a[main])).toBe(true);
      expect(Number.isInteger(b[main])).toBe(true);
      const [first, last] = a[pos] < b[pos] ? [a, b] : [b, a];
      expect(last[pos] - first[pos] - first[main]).toBe(8);
      expect(first[pos]).toBe(rect(filled, 0)[pos]);
      expect(last[pos] + last[main]).toBe(rect(filled, 0)[pos] + 360);
      expect(layout(source)).toEqual(filled);

      // Equal remainders award the odd unit to the first visual item.
      const tied = layout(
        figure("stretch", axis, direction)
          .replace('label: "B\\nMore"', "label: A")
          .replace("gap: 4pt", "gap: 4.5pt"),
      );
      const reversed = direction === "up" || direction === "left";
      expect(rect(tied, reversed ? 2 : 1)[main]).toBe(rect(tied, reversed ? 1 : 2)[main] + 1);
      const fractional = layout(source.replace("gap: 4pt", "gap: 4.125pt"));
      expect(Number.isInteger(rect(fractional, 1)[main])).toBe(true);
      expect(Number.isInteger(rect(fractional, 2)[main])).toBe(true);
      expect(
        Math.min(rect(fractional, 1)[pos], rect(fractional, 2)[pos]) - rect(fractional, 0)[pos],
      ).toBeCloseTo(0.375, 3);
    });
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
      expect(
        Math.abs(a[size] - rect(natural, 1)[size] - (b[size] - rect(natural, 2)[size])),
      ).toBeLessThanOrEqual(1);
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

  test("explicit main-axis sizes and circles remain fixed; badges grow with boxes", () => {
    const source = figure("stretch").replace(
      "component: box, label: A",
      "component: box, label: A, props: { height: 20pt }",
    );
    expect(rect(layout(source), 1).height).toBe(40);
    for (const component of ["circle", "stack"]) {
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

  test("operators and images keep both dimensions under main-axis fill", () => {
    for (const axis of ["stack", "row"]) {
      for (const component of [
        "operator, props: { symbol: plus }",
        "image, props: { src: image.png, width: 20pt, height: 10pt }",
      ]) {
        const source = figure("stretch", axis, axis === "stack" ? "down" : "right").replace(
          "component: box, label: A",
          `component: ${component}`,
        );
        const filled = layout(source);
        const natural = layout(source.replace("justify: stretch,", ""));
        expect(rect(filled, 1).width).toBe(rect(natural, 1).width);
        expect(rect(filled, 1).height).toBe(rect(natural, 1).height);
        const size = axis === "stack" ? "height" : "width";
        expect(rect(filled, 2)[size]).toBeGreaterThan(rect(natural, 2)[size]);
      }
    }
  });

  for (const axis of ["stack", "row"]) {
    for (const [component, props] of [
      ["bowtie", ""],
      ["bowtie", "gap: 8"],
      ["bowtie", "gap: 64"],
      ...["south", "north", "east", "west"].map((narrow) => ["trapezoid", `narrow: ${narrow}`]),
    ]) {
      test(`${axis}/${component}/${props}: outlines share growth and explicit main sizes opt out`, () => {
        const source = figure("stretch", axis, axis === "stack" ? "down" : "right").replace(
          "component: box, label: A",
          `component: ${component}, label: A, props: { ${props} }`,
        );
        const filled = layout(source);
        const natural = layout(source.replace("justify: stretch,", ""));
        const main = axis === "stack" ? "height" : "width";
        const cross = axis === "stack" ? "width" : "height";
        expect(rect(filled, 1)[main]).toBeGreaterThan(rect(natural, 1)[main]);
        expect(
          Math.abs(
            rect(filled, 1)[main] -
              rect(natural, 1)[main] -
              (rect(filled, 2)[main] - rect(natural, 2)[main]),
          ),
        ).toBeLessThanOrEqual(1);
        expect(rect(filled, 1)[cross]).toBe(rect(natural, 1)[cross]);
        const fixed = source.replace(
          `props: { ${props} }`,
          `props: { ${props ? `${props},` : ""} ${main}: 40pt }`,
        );
        expect(rect(layout(fixed), 1)[main]).toBe(80);
      });
    }
  }

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
    const inset = rect(filled, 1).y - rect(filled, 0).y;
    expect(inset).toBeGreaterThanOrEqual(0);
    expect(inset).toBeLessThan(0.5);
    expect(rect(filled, 2).y + rect(filled, 2).height).toBeCloseTo(
      rect(filled, 0).y + rect(filled, 0).height - inset,
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
