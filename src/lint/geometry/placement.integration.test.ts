/**
 * The placement rules (#546) on figures as rendered (structured, no D2): token
 * rows that drift off their column, edge labels pressed against their line or
 * sitting on a box's corner, and straight edges that barely outlast their head.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { ElementIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";
import { renderFigure } from "../../render/render";
import { geometryContextFor, lintGeometry } from "./lint";
import { tokenColumnDrift } from "./placement";

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

describe("geometry/token-column-drift: the hint names the cause (#647)", () => {
  const code = "geometry/token-column-drift";
  const file = join(ROOT, "steps.sumi.yaml");
  /** Step rows as in a decoding figure: a step label, then the step's tokens. */
  const steps = (
    labels: readonly [string, string],
    width = "",
    cells = "6mm, gap: 1mm",
  ) => `version: 1
figure:
  id: steps
  theme: sumi
  profile: paper-double
  layout:
    arrange:
      stack:
        gap: 2mm
        items:
          - row: { gap: 2mm, align: center, items: [l1, t1] }
          - row: { gap: 2mm, align: center, items: [l2, t2] }
nodes:
  - { id: l1, component: label, label: '${labels[0]}'${width} }
  - { id: t1, component: tokens, props: { width: 6mm, height: 6mm, gap: 1mm, cells: [a, b, c, d] } }
  - { id: l2, component: label, label: '${labels[1]}'${width} }
  - { id: t2, component: tokens, props: { width: ${cells}, height: 6mm, cells: [a, b, c, d] } }
`;

  test("the same cells shifted by step labels of different widths: names the labels", async () => {
    const found = await findings(steps(["t=1", "t=2"]), file, code);
    expect(found).toHaveLength(1);
    const hint = found[0]?.hint ?? "";
    expect(hint).toMatch(
      /^Both rows have the same cells, but tokens "t2" starts 0\.\d\dmm right of tokens "t1"/,
    );
    expect(hint).toMatch(
      /node "l1" \(before tokens "t1"\) is \d\.\d\dmm wide and node "l2" \(before tokens "t2"\) \d\.\d\dmm/,
    );
    // Named as the cause only because a trial layout with one width lines the rows up.
    const verified =
      /Verified: props\.width (\d+(?:\.\d)?)mm on both node "l1" and node "l2" lines the rows up/.exec(
        hint,
      );
    expect(verified).not.toBeNull();
    expect(hint).not.toContain("props.gap");
    // The fix the hint gives: that width on both labels.
    const width = `, props: { width: ${verified?.[1]}mm }`;
    expect(await findings(steps(["t=1", "t=2"], width), file, code)).toEqual([]);
  });

  /** Two rows placed by coordinates, the lower one 0.3mm right: what sits beside them does not move them. */
  const placed = (labels: string) => `version: 1
figure:
  id: placed
  theme: sumi
  profile: paper-double
  layout:
    arrange:
      place:
        unit: 1mm
        items:
          - {item: t1, at: [40, 10]}
          - {item: t2, at: [40.3, 20]}
${labels}nodes:
  - { id: t1, component: tokens, props: { width: 6mm, height: 6mm, gap: 1mm, cells: [a, b, c, d] } }
  - { id: t2, component: tokens, props: { width: 6mm, height: 6mm, gap: 1mm, cells: [a, b, c, d] } }
  - { id: l1, component: label, label: 't=1' }
  - { id: l2, component: label, label: 'step 2' }
`;

  test("neighbours of different widths that do not position the rows are not named as the cause", async () => {
    const found = await findings(
      placed("          - {item: l1, at: [15, 10]}\n          - {item: l2, at: [15, 20]}\n"),
      file,
      code,
    );
    expect(found).toHaveLength(1);
    const hint = found[0]?.hint ?? "";
    expect(hint).toMatch(
      /^Both rows have the same cells, but tokens "t2" starts 0\.\d\dmm right of tokens "t1"\. /,
    );
    expect(hint).not.toContain("Verified");
    // The trial ran (equal widths left the rows apart), so not even "not checked".
    expect(hint).not.toContain('node "l1"');
    expect(hint).not.toContain("not checked");
    expect(hint).toContain("Make the rows start at the same x");
  });

  test("no neighbour: the measured start, and a fix without a cause", async () => {
    const source = placed("").replace(/ {2}- \{ id: l[12],.*\n/g, "");
    const found = await findings(source, file, code);
    expect(found).toHaveLength(1);
    expect(found[0]?.hint).toMatch(
      /^Both rows have the same cells, but tokens "t2" starts 0\.\d\dmm right of tokens "t1"\. Make the rows start at the same x/,
    );
  });

  test("cells of different widths or gaps: says that the cells differ", async () => {
    const wider = await findings(steps(["t=1", "t=1"], "", "6.4mm, gap: 1mm"), file, code);
    // The rows are centred, so wider cells also start the row further left:
    // both differences are reported, with the offsets measured at both ends.
    expect(wider[0]?.hint).toMatch(
      /^The cells differ \(tokens "t1" has 6\.00mm cells with 1\.00mm gaps, tokens "t2" has 6\.\d\dmm cells with 1\.00mm gaps\), and tokens "t2" starts 0\.\d\dmm left of tokens "t1": the centres are 0\.\d\dmm apart at the first column and 0\.\d\dmm at the last\./,
    );
    expect(wider[0]?.hint).toContain("start the rows at the same x");
    expect(wider[0]?.hint).not.toContain("further");
    expect(wider[0]?.message).toMatch(
      /^Cell "[14]" of tokens "t2" sits 0\.\d\dmm \(\d\.\dpt\) off the centre of cell "[14]" of tokens "t1", so the columns of tokens "t1" and tokens "t2" do not line up\.$/,
    );
    const gaps = await findings(steps(["t=1", "t=1"], "", "6mm, gap: 1.3mm"), file, code);
    expect(gaps[0]?.hint).toContain('tokens "t2" has 6');
    expect(gaps[0]?.hint).toContain("1.3");
    expect(gaps[0]?.hint).toContain("props.gap");
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

describe("geometry/edge-label-hugging under a theme's label gap (#546)", () => {
  const code = "geometry/edge-label-hugging";
  const file = join(ROOT, "gap.sumi.yaml");
  const figure = (theme: string) => `version: 1
figure:
  id: gap
  theme: ${theme}
  profile: paper-double
  layout: { arrange: { row: { gap: 20mm, items: [a, b] } } }
nodes:
  - { id: a, component: box, label: A }
  - { id: b, component: box, label: B }
edges:
  - { from: a, to: b, label: gap, labelSide: left }
`;
  /**
   * The rule's findings for the figure with every edge's `labelGap` replaced
   * (the label stays where the router put it; only the threshold moves).
   */
  const withThemeGap = async (source: string, themeGap: number | undefined) => {
    const result = await renderFigure(source, { assetBase: ROOT });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const { compiled } = result.value;
    const elements = new Map<ElementKey, ElementIR>(
      [...compiled.ir.elements].map(([key, element]): [ElementKey, ElementIR] => {
        if (element.kind !== "edge") return [key, element];
        const { labelGap: _drop, ...style } = element.style;
        return [
          key,
          { ...element, style: themeGap === undefined ? style : { ...style, labelGap: themeGap } },
        ];
      }),
    );
    const ir = { ...compiled.ir, elements };
    return lintGeometry(
      { ...result.value, compiled: { ...compiled, ir } },
      { source, file },
    ).filter((d) => d.code === code);
  };
  /** The printed clearance (mm) of the label from its line, read off a report forced by a huge threshold. */
  const clearanceMm = async (source: string) => {
    const found = await withThemeGap(source, 24);
    const mm = /sits ([\d.]+)mm/.exec(found[0]?.message ?? "");
    if (!mm) throw new Error("no finding");
    return Number(mm[1]);
  };

  test("a sumi label sits about 1mm from its line, about twice the 3-unit gap, and is not reported", async () => {
    expect(await findings(figure("sumi"), file, code)).toEqual([]);
    const sumi = await clearanceMm(figure("sumi"));
    const minimal = await clearanceMm(figure("minimal"));
    expect(sumi).toBeGreaterThan(0.8);
    expect(sumi).toBeLessThan(1.4);
    expect(minimal).toBeGreaterThan(0.3);
    expect(minimal / sumi).toBeLessThan(0.7);
  });

  test("a label closer than 75% of the theme's gap is reported; the default place is not", async () => {
    // 6 units: the placed label clears it. 9 units (threshold 6.75): it does not.
    expect(await withThemeGap(figure("sumi"), 6)).toEqual([]);
    const found = await withThemeGap(figure("sumi"), 9);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: "info", subject: { kind: "edge" } });
    expect(found[0]?.message).toContain("theme's label gap");
    // A theme without a gap keeps the 1pt line: the same label is quiet.
    expect(await withThemeGap(figure("sumi"), undefined)).toEqual([]);
  });

  test("the gap follows textScale", async () => {
    const scaled = figure("sumi").replace(
      "  theme: sumi\n",
      "  theme: sumi\n  themeOverrides: { textScale: 2 }\n",
    );
    expect(scaled).toContain("textScale");
    expect(await findings(scaled, file, code)).toEqual([]);
    const one = await clearanceMm(figure("sumi"));
    const two = await clearanceMm(scaled);
    // Printed size also follows the profile's fit, so compare the ratio loosely.
    expect(two).toBeGreaterThan(one * 1.3);
  });

  test("the shipped sumi layouts have no hugging labels", async () => {
    for (const path of [
      "skills/sumi/layouts/pipeline-feedback/pipeline-feedback.sumi.yaml",
      "skills/sumi/layouts/agent-loop/agent-loop.sumi.yaml",
    ])
      expect(await fixture(path, code), path).toEqual([]);
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

  test("close rows of the same count but other cell widths or little overlap are unrelated", async () => {
    const make = (a: string, b: string, shift: string) => `version: 1
figure:
  id: unrelated
  theme: minimal
  profile: paper-double
  layout: { arrange: { stack: { gap: 4mm, items: [a, { row: { items: [pad, b] } }] } } }
nodes:
  - { id: a, component: sumi/tokens, props: { gap: 2mm, width: ${a}, cells: [x1, x2, x3, x4] } }
  - { id: pad, component: box, label: ' ', props: { width: ${shift}, height: 4mm } }
  - { id: b, component: sumi/tokens, props: { gap: 2mm, width: ${b}, cells: [y1, y2, y3, y4] } }
`;
    // Cell widths 12mm and 13.5mm: more than 10% apart.
    expect(await findings(make("12mm", "13.5mm", "0.1mm"), file, code)).toEqual([]);
    // Same widths, but the second row starts at the first row's last cell: little overlap.
    expect(await findings(make("12mm", "12mm", "42mm"), file, code)).toEqual([]);
  });

  test("worst cases stay fast: 300 rows at one height, and 300 rows in nearby columns", async () => {
    const row = (id: string, gap: number) =>
      `  - { id: ${id}, component: sumi/tokens, props: { gap: ${gap}mm, width: 5mm, cells: [a, b] } }\n`;
    const flat = Array.from({ length: 300 }, (_, i) => `r${i}`);
    const flatSource = `version: 1
figure:
  id: flat
  theme: minimal
  profile: paper-double
  layout: { arrange: { row: { gap: 1mm, items: [${flat.join(", ")}] } } }
nodes:
${flat.map((id) => row(id, 1)).join("")}`;
    const columns = Array.from({ length: 5 }, (_, c) =>
      Array.from({ length: 60 }, (_, i) => `c${c}r${i}`),
    );
    const colSource = `version: 1
figure:
  id: columns
  theme: minimal
  profile: paper-double
  layout: { arrange: { row: { gap: 1mm, items: [${columns
    .map((ids) => `{ stack: { gap: 1mm, items: [${ids.join(", ")}] } }`)
    .join(", ")}] } } }
nodes:
${columns.map((ids) => ids.map((id, i) => row(id, 1 + (i % 2) * 0.6)).join("")).join("")}`;
    for (const [source, check] of [
      [flatSource, (n: number) => expect(n).toBe(0)],
      [colSource, (n: number) => expect(n).toBeGreaterThan(200)],
    ] as const) {
      const result = await renderFigure(source, { assetBase: ROOT });
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
      const context = geometryContextFor(result.value);
      const start = performance.now();
      const found = tokenColumnDrift.run(context, undefined as never);
      // A coarse ceiling: each row scans only rows in its vertical window (quadratic only when many unrelated rows share one window).
      expect(performance.now() - start).toBeLessThan(5000);
      check(found.length);
    }
  });

  test("the nearest neighbour is found among many unrelated rows at the next height", async () => {
    const stack = (c: number) => `{ stack: { gap: 4mm, items: [t${c}a, t${c}b] } }`;
    const tokens = (id: string, gap: number) =>
      `  - { id: ${id}, component: sumi/tokens, props: { gap: ${gap}mm, width: 5mm, cells: [a, b] } }\n`;
    const cols = Array.from({ length: 9 }, (_, c) => c);
    const source = `version: 1
figure:
  id: crowded
  theme: minimal
  profile: paper-double
  layout: { arrange: { row: { gap: 6mm, items: [${cols.map(stack).join(", ")}] } } }
nodes:
${cols.map((c) => tokens(`t${c}a`, 1) + tokens(`t${c}b`, c === 8 ? 1.6 : 1)).join("")}`;
    const found = await findings(source, file, code);
    expect(found.map((d) => d.subject)).toEqual([{ kind: "node", id: "t8b" }]);
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
