/**
 * The placement rules (#546) on figures as rendered (structured, no D2): token
 * rows that drift off their column, edge labels pressed against their line or
 * sitting on a box's corner, and straight edges that barely outlast their head.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { renderFigure } from "../../render/render";
import { lintGeometry } from "./lint";

const ROOT = join(import.meta.dir, "..", "..", "..");

async function findings(source: string, file: string, code: string) {
  const result = await renderFigure(source, { assetBase: join(file, "..") });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return lintGeometry(result.value, { source, file }).filter((d) => d.code === code);
}

async function fixture(path: string, code: string) {
  const file = join(ROOT, path);
  return findings(await Bun.file(file).text(), file, code);
}

const rows = (widthB: string) => `version: 1
figure:
  id: tokens
  theme: minimal
  profile: paper-double
  layout: { arrange: { stack: { gap: 8mm, items: [a, b] } } }
nodes:
  - { id: a, component: sumi/tokens, props: { gap: 2mm, width: 12mm, cells: [x1, x2, x3, x4] } }
  - { id: b, component: sumi/tokens, props: { gap: 2mm, width: ${widthB}, cells: [y1, y2, y3, y4] } }
`;

describe("geometry/token-column-drift", () => {
  const code = "geometry/token-column-drift";
  const file = join(ROOT, "tokens.sumi.yaml");

  test("reports the cell that drifts off the column above it, at the cell as written", async () => {
    const found = await findings(rows("12.5mm"), file, code);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      severity: "info",
      subject: { kind: "node", id: "b" },
      message: expect.stringContaining('Cell "4" of tokens "b"'),
    });
    expect(found[0]?.related?.[0]?.message).toContain('tokens "a"');
  });

  test("stays quiet for rows of the same width and for rows with different cells", async () => {
    expect(await findings(rows("12mm"), file, code)).toEqual([]);
    // Rows of clearly different cell widths are not meant to share columns.
    expect(await findings(rows("20mm"), file, code)).toEqual([]);
  });

  test("does not report the shipped token figures", async () => {
    for (const path of [
      "skills/sumi/examples/llada/llada.sumi.yaml",
      "skills/sumi/examples/clip/clip.sumi.yaml",
      "skills/sumi/layouts/encoder-block/encoder-block.sumi.yaml",
      "skills/sumi/layouts/train-infer-panels/train-infer-panels.sumi.yaml",
    ]) {
      expect(await fixture(path, code), path).toEqual([]);
    }
  });
});

describe("geometry/edge-label-hugging", () => {
  const code = "geometry/edge-label-hugging";

  test("reports a label pressed against its line, not one clear of it", async () => {
    const found = await fixture("tests/fixtures/figures/fit/b-dit.sumi.yaml", code);
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]).toMatchObject({ severity: "info", subject: { kind: "edge" } });
    expect(found[0]?.message).toMatch(/sits 0\.\d\dmm from its line/);
    // The router's usual 1.5pt gap (0.4 to 0.5mm of clear space) is not a miss.
    expect(
      await fixture("skills/sumi/layouts/state-machine/state-machine.sumi.yaml", code),
    ).toEqual([]);
    const roomy = await fixture(
      "skills/sumi/layouts/pipeline-linear/pipeline-linear.sumi.yaml",
      code,
    );
    expect(roomy).toEqual([]);
  });
});

describe("geometry/edge-label-on-corner", () => {
  const code = "geometry/edge-label-on-corner";

  test("reports a label within 1.5pt of a box's corner", async () => {
    const found = await fixture("tests/fixtures/figures/density/text-heavy-boxes.sumi.yaml", code);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: "info", subject: { kind: "edge" } });
    expect(found[0]?.message).toContain('a corner of node "mlp"');
    expect(found[0]?.related?.[0]?.message).toContain('Node "mlp"');
  });

  test("is quiet on figures whose labels sit beside their lines", async () => {
    for (const path of [
      "skills/sumi/layouts/pipeline-linear/pipeline-linear.sumi.yaml",
      "skills/sumi/examples/transformer/transformer.sumi.yaml",
    ]) {
      expect(await fixture(path, code), path).toEqual([]);
    }
  });
});

describe("geometry/arrowhead-cramped on straight edges", () => {
  const code = "geometry/arrowhead-cramped";

  test("reports a straight edge that shows under 1pt of line beyond its head", async () => {
    const found = await fixture("tests/fixtures/figures/fit/b-dit.sumi.yaml", code);
    const straight = found.filter((d) => d.message.includes("straight line"));
    expect(straight.length).toBeGreaterThan(0);
    expect(straight[0]).toMatchObject({ severity: "info", subject: { kind: "edge" } });
    expect(straight[0]?.message).toMatch(/only 0\.\d+pt visible beyond its arrowhead/);
  });

  test("does not report the shipped examples", async () => {
    for (const path of [
      "skills/sumi/examples/dit-block/dit-block.sumi.yaml",
      "skills/sumi/examples/transformer/transformer.sumi.yaml",
    ]) {
      expect(await fixture(path, code), path).toEqual([]);
    }
  });
});

describe("geometry/token-column-drift: which rows are compared", () => {
  const code = "geometry/token-column-drift";
  const file = join(ROOT, "tokens.sumi.yaml");

  test("stacks (direction: down) and separate demos are not rows to line up", async () => {
    const column = (id: string, width: string) =>
      `  - { id: ${id}, component: sumi/tokens, props: { direction: down, gap: 2mm, width: ${width}, cells: [p, q, r, s] } }\n`;
    const source = `version: 1
figure:
  id: stacks
  theme: minimal
  profile: paper-double
  layout: { arrange: { stack: { gap: 8mm, items: [a, b] } } }
nodes:
${column("a", "12mm")}${column("b", "12.5mm")}`;
    expect(await findings(source, file, code)).toEqual([]);
  });

  test("a row is compared only with the nearest row below, once", async () => {
    const row = (id: string, width: string) =>
      `  - { id: ${id}, component: sumi/tokens, props: { gap: 2mm, width: ${width}, cells: [x1, x2, x3, x4] } }\n`;
    const source = `version: 1
figure:
  id: three
  theme: minimal
  profile: paper-double
  layout: { arrange: { stack: { gap: 4mm, items: [a, b, c] } } }
nodes:
${row("a", "12mm")}${row("b", "12.5mm")}${row("c", "13mm")}`;
    const found = await findings(source, file, code);
    // a-b and b-c, not a-c as well.
    expect(found.map((d) => d.subject)).toEqual([
      { kind: "node", id: "b" },
      { kind: "node", id: "c" },
    ]);
  });

  test("a figure of 200 token rows is linted in one pass", async () => {
    const ids = Array.from({ length: 200 }, (_, i) => `r${i}`);
    const nodes = ids
      .map(
        (id, i) =>
          `  - { id: ${id}, component: sumi/tokens, props: { gap: 1mm, width: ${12 + (i % 2) * 0.4}mm, cells: [a, b, c] } }\n`,
      )
      .join("");
    const source = `version: 1
figure:
  id: many
  theme: minimal
  profile: paper-double
  layout: { arrange: { stack: { gap: 1mm, items: [${ids.join(", ")}] } } }
nodes:
${nodes}`;
    const start = performance.now();
    const found = await findings(source, file, code);
    expect(found.length).toBeLessThanOrEqual(199);
    expect(found.length).toBeGreaterThan(100);
    expect(performance.now() - start).toBeLessThan(30000);
  });
});
