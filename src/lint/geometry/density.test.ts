import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  fillMetrics,
  inDensityScope,
  isSparse,
  largestHole,
  SPARSE_AREA_PER_ELEMENT_MM2,
  SPARSE_FILL_MAX,
  textHeavyNodes,
} from "./density";
import { geometryContextFor, lintRenderedFigure } from "./lint";
import { BUILTIN_GEOMETRY_RULES } from "./rules";
import { centeredBaseline, compile, inspection, label } from "./testing";

const ROOT = join(import.meta.dir, "..", "..", "..");
const FIXTURES = join(ROOT, "tests", "fixtures", "figures", "density");

/** A figure of `count` boxes in a 10-column grid; `size` units square, `pitch` apart. */
function grid(
  count: number,
  size: number,
  pitch: number,
  options: { profile?: string; theme?: string; texts?: string[] } = {},
) {
  const ids = Array.from({ length: count }, (_, i) => `n${i}`);
  const source = `version: 1
figure:
  id: dense
  theme: ${options.theme ?? "paper"}
  profile: ${options.profile ?? "paper-double"}
nodes:
${ids.map((id, i) => `  - { id: ${id}, component: box, label: ${JSON.stringify(options.texts?.[i] ?? "A")} }`).join("\n")}
`;
  const compiled = compile(source);
  const elements = Object.fromEntries(
    ids.map((id, i) => {
      const bbox = {
        x: 10 + (i % 10) * pitch,
        y: 10 + Math.floor(i / 10) * pitch,
        width: size,
        height: size,
      };
      return [
        `n:${id}`,
        {
          bbox,
          labels: [
            label(
              options.texts?.[i] ?? "A",
              bbox.x + size / 2,
              centeredBaseline(bbox.y + size / 2),
            ),
          ],
        },
      ];
    }),
  );
  const rows = Math.ceil(count / 10);
  const canvas = { x: 0, y: 0, width: 20 + 10 * pitch, height: 20 + rows * pitch };
  const context = geometryContextFor({
    compiled,
    inspection: inspection(compiled, {
      canvas,
      profile: { id: options.profile ?? "paper-double", maxWidthPt: 510 },
      elements,
    }),
  });
  return { context, compiled, canvas, elements };
}

describe("fill metrics", () => {
  test("fill is the union of node bodies and text over the canvas", () => {
    const { context, canvas } = grid(40, 20, 25);
    const metrics = fillMetrics(context);
    expect(metrics.elements).toBe(40);
    // 40 non-overlapping 20x20 squares (labels lie inside them).
    expect(metrics.fill).toBeCloseTo((40 * 400) / (canvas.width * canvas.height), 6);
    expect(metrics.areaPerElementMm2).toBeCloseTo(metrics.areaMm2 / 40, 6);
  });

  test("overlapping boxes count once", () => {
    const { context, canvas } = grid(40, 20, 10);
    // 4 rows of 10 columns, each box overlapping its neighbours: one block.
    const block = (9 * 10 + 20) * (3 * 10 + 20);
    expect(fillMetrics(context).fill).toBeCloseTo(block / (canvas.width * canvas.height), 6);
  });

  test("a sparse figure needs many elements, low fill and a large canvas per element", () => {
    const sparse = fillMetrics(grid(40, 20, 120).context);
    expect(sparse.fill).toBeLessThan(SPARSE_FILL_MAX);
    expect(sparse.areaPerElementMm2).toBeGreaterThan(SPARSE_AREA_PER_ELEMENT_MM2);
    expect(isSparse(sparse)).toBe(true);
    // Few elements: a small figure is not judged.
    expect(isSparse(fillMetrics(grid(12, 20, 120).context))).toBe(false);
    // Well filled.
    const dense = fillMetrics(grid(40, 20, 22).context);
    expect(dense.fill).toBeGreaterThan(SPARSE_FILL_MAX);
    expect(isSparse(dense)).toBe(false);
    // Low fill but a small canvas per element: compact, not sparse.
    const small = fillMetrics(grid(40, 16, 40).context);
    expect(small.fill).toBeLessThan(SPARSE_FILL_MAX);
    expect(small.areaPerElementMm2).toBeLessThan(SPARSE_AREA_PER_ELEMENT_MM2);
    expect(isSparse(small)).toBe(false);
  });

  test("the largest hole ignores group frames and finds the empty corner", () => {
    const { context, canvas } = grid(40, 20, 120);
    const hole = largestHole(context);
    expect(hole).toBeDefined();
    expect((hole?.width ?? 0) * (hole?.height ?? 0)).toBeGreaterThan(
      0.05 * canvas.width * canvas.height,
    );
  });

  test("scope: paper profiles and figures with a target", () => {
    expect(inDensityScope(grid(3, 20, 25).context)).toBe(true);
    expect(
      inDensityScope(grid(3, 20, 25, { profile: "presentation-16x9", theme: "slides" }).context),
    ).toBe(false);
  });
});

describe("text-heavy nodes", () => {
  const sentence = "Attribute integration with a long explanation";
  test("labels of 36+ characters count, names do not", () => {
    const texts = ["Encoder", sentence, "x".repeat(35), "x".repeat(36)];
    const { context } = grid(4, 20, 25, { texts });
    const heavy = textHeavyNodes(context);
    expect(heavy.map((h) => h.element.name)).toEqual(['node "n1"', 'node "n3"']);
    expect(heavy[0]?.chars).toBe(sentence.length);
  });

  test("the rule needs a dozen nodes and two heavy ones, and names them", () => {
    const run = (count: number, heavy: number) => {
      const texts = Array.from({ length: count }, (_, i) => (i < heavy ? sentence : "Name"));
      const { context } = grid(count, 20, 25, { texts });
      const rule = BUILTIN_GEOMETRY_RULES.find((r) => r.id === "geometry/text-heavy-nodes");
      return rule?.run(context, {}) ?? [];
    };
    expect(run(11, 3)).toEqual([]);
    expect(run(12, 1)).toEqual([]);
    const [finding] = run(12, 3);
    expect(finding?.message).toContain("3 nodes hold 36+ characters");
    expect(finding?.message).toContain('node "n0"');
    expect(finding?.hint).toContain("caption");
  });
});

describe("calibration on rendered figures (no D2: structured layout)", () => {
  async function diagnostics(path: string) {
    const report = await lintRenderedFigure(await Bun.file(path).text(), {
      file: path,
      assetBase: join(path, ".."),
    });
    return report.diagnostics.filter((d) =>
      ["geometry/sparse-figure", "geometry/text-heavy-nodes"].includes(d.code),
    );
  }

  test.each(["tricl", "llada", "gcn", "llama4-moe", "transformer"])(
    "example %s is not flagged",
    async (name) => {
      expect(await diagnostics(join(ROOT, "examples", name, `${name}.sumi.yaml`))).toEqual([]);
    },
  );

  test.each([
    ["text-heavy-boxes", ["geometry/sparse-figure", "geometry/text-heavy-nodes"]],
    ["sparse-small-elements", ["geometry/sparse-figure", "geometry/text-heavy-nodes"]],
    ["sparse-empty-corner", ["geometry/sparse-figure", "geometry/text-heavy-nodes"]],
  ])("weak trial %s is flagged", async (name, codes) => {
    const found = await diagnostics(join(FIXTURES, `${name}.sumi.yaml`));
    expect(found.map((d) => d.code).sort()).toEqual([...codes].sort());
    expect(found.every((d) => d.severity === "info")).toBe(true);
    const sparse = found.find((d) => d.code === "geometry/sparse-figure");
    expect(sparse?.hint).toContain("largest empty area");
  });
});
