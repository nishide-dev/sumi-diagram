/**
 * Routing next to frames and between nested skips (#512): a trunk into a
 * group's members keeps its distance from the frame, and skip connections
 * on one side of a column take lanes of their own. Needs no D2.
 */

import { describe, expect, test } from "bun:test";
import { lintGeometry } from "../../lint/geometry/lint";
import { renderFigure } from "../../render/render";

const FAN = `
version: 1
figure:
  id: fan
  theme: sumi
  profile: paper-double
  layout:
    arrange:
      row: {gap: 14mm, align: start, items: [src, grp]}
groups:
  - id: grp
    label: Group
    labelAt: above-left
    arrange: {stack: {gap: 5mm, items: [a, b, c]}}
nodes:
  - {id: src, component: box, label: Source}
  - {id: a, component: box, label: A}
  - {id: b, component: box, label: B}
  - {id: c, component: box, label: C}
edges:
  - {from: src, to: a}
  - {from: src, to: b}
  - {from: src, to: c}
`;

const SKIPS = `
version: 1
figure:
  id: skips
  theme: sumi
  profile: paper-single
  layout:
    arrange: {stack: {direction: up, gap: 4mm, align: stretch, items: [a1, a2, a3, m, b3, b2, b1]}}
nodes:
  - {id: a1, component: box, label: A1}
  - {id: a2, component: box, label: A2}
  - {id: a3, component: box, label: A3}
  - {id: m, component: box, label: M}
  - {id: b3, component: box, label: B3}
  - {id: b2, component: box, label: B2}
  - {id: b1, component: box, label: B1}
edges:
  - {from: a3, to: b3, fromAnchor: east, toAnchor: east, variant: dashed}
  - {from: a2, to: b2, fromAnchor: east, toAnchor: east, variant: dashed}
  - {from: a1, to: b1, fromAnchor: east, toAnchor: east, variant: dashed}
`;

async function routes(source: string) {
  const result = await renderFigure(source);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return {
    rendered: result.value,
    svg: result.value.svg,
    paths: [...result.value.svg.matchAll(/class="connection" d="([^"]*)"/g)].map((m) =>
      [...(m[1] as string).matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((p) => ({
        x: Number(p[1]),
        y: Number(p[2]),
      })),
    ),
  };
}

describe("frames and lanes (#512)", () => {
  test("a fan-out into a group keeps its trunk clear of the frame", async () => {
    const { rendered, svg, paths } = await routes(FAN);
    const frame = Number(
      /<rect x="([\d.]+)" y="[\d.]+" width="[\d.]+" height="[\d.]+" fill="#efeddd"/.exec(svg)?.[1],
    );
    const trunk = (paths[0] as { x: number }[])[1]?.x as number;
    // 3pt (6 units) between the frame and the bend before the arrowheads.
    expect(trunk - frame).toBeGreaterThanOrEqual(6);
    expect(lintGeometry(rendered).filter((d) => d.code === "geometry/edge-near-border")).toEqual(
      [],
    );
  });

  test("nested skips on one side run in separate lanes, shorter ones nearer", async () => {
    const { rendered, paths } = await routes(SKIPS);
    const lanes = paths.map((p) => p[1]?.x as number);
    expect(paths.every((p) => p.length === 4)).toBe(true);
    // a3 → b3 (shortest) nearest, a1 → b1 farthest, 2.5pt apart or more.
    expect(lanes[1] as number).toBeGreaterThan(lanes[0] as number);
    expect(lanes[2] as number).toBeGreaterThan(lanes[1] as number);
    expect((lanes[1] as number) - (lanes[0] as number)).toBeGreaterThanOrEqual(5);
    expect((lanes[2] as number) - (lanes[1] as number)).toBeGreaterThanOrEqual(5);
    expect(
      lintGeometry(rendered).filter((d) => /edge-near-edge|edge-crossing/.test(d.code)),
    ).toEqual([]);
  });
});

describe("fan padding (#512)", () => {
  const width = async (source: string) => {
    const { svg } = await routes(source);
    return Number(/<rect x="[\d.]+" y="[\d.]+" width="([\d.]+)"[^>]*fill="#efeddd"/.exec(svg)?.[1]);
  };
  const edges = (list: string[], extra = "") =>
    FAN.replace(
      /edges:[\s\S]*$/,
      `edges:\n${list.map((t) => `  - {from: src, to: ${t}${extra}}`).join("\n")}\n`,
    );

  test("the growth does not depend on the order of the edges", async () => {
    expect(await width(edges(["a", "b", "c"]))).toBe(await width(edges(["c", "b", "a"])));
  });

  test("curved or straight fan-outs do not grow the group", async () => {
    const single = await width(edges(["a"]));
    expect(await width(edges(["a", "b", "c"], ", route: curve"))).toBe(single);
    expect(await width(edges(["a", "b", "c"], ", route: straight"))).toBe(single);
    expect(await width(edges(["a", "b", "c"]))).toBeGreaterThan(single);
  });
});

describe("trunks between boxes beside a frame (#512)", () => {
  const nearBorder = async (source: string) =>
    lintGeometry((await routes(source)).rendered).filter(
      (d) => d.code === "geometry/edge-near-border",
    );

  // The 2-web-system case: two services, one below the other, both write to
  // one store inside the next group. Their shared trunk turns in that
  // group's padding.
  const FAN_IN = `
version: 1
figure:
  id: fan-in
  theme: sumi
  profile: paper-double
  layout:
    arrange:
      row: {gap: 14mm, align: start, items: [services, data]}
groups:
  - id: services
    label: Services
    arrange: {stack: {gap: 4mm, items: [a, b]}}
  - id: data
    label: Data
    arrange: {stack: {gap: 14mm, items: [top, store]}}
nodes:
  - {id: a, component: box, label: A}
  - {id: b, component: box, label: B}
  - {id: top, component: box, label: Top}
  - {id: store, component: cylinder, label: Store}
edges:
  - {from: a, to: store}
  - {from: b, to: store}
`;

  test("edges from several boxes into one member keep their trunk off the frame", async () => {
    const { paths, svg } = await routes(FAN_IN);
    const frames = [...svg.matchAll(/<rect x="([\d.]+)"[^>]*fill="#efeddd"/g)].map((m) =>
      Number(m[1]),
    );
    const trunk = (paths[0] as { x: number }[])[1]?.x as number;
    const frame = Math.max(...frames);
    expect(trunk - frame).toBeGreaterThanOrEqual(6);
    expect(await nearBorder(FAN_IN)).toEqual([]);
  });

  // The 7-request-states case: an edge reaches a member's south port from
  // above, so it turns below the member, in the group's padding.
  const U_TURN = `
version: 1
figure:
  id: u-turn
  theme: sumi
  profile: paper-double
  layout:
    arrange:
      row: {gap: 14mm, align: start, items: [src, grp]}
groups:
  - id: grp
    label: Group
    labelAt: above-left
    arrange: {stack: {gap: 5mm, items: [a, b]}}
nodes:
  - {id: src, component: box, label: Source}
  - {id: a, component: box, label: A}
  - {id: b, component: box, label: B}
edges:
  - {from: src, to: b, fromAnchor: south, toAnchor: south}
`;

  test("a U-turn into a member's far side keeps its trunk off the frame", async () => {
    expect(await nearBorder(U_TURN)).toEqual([]);
    const { paths, svg } = await routes(U_TURN);
    const frame =
      /<rect x="[\d.]+" y="([\d.]+)" width="[\d.]+" height="([\d.]+)"[^>]*fill="#efeddd"/.exec(svg);
    const bottom = Number(frame?.[1]) + Number(frame?.[2]);
    const lowest = Math.max(...(paths[0] as { y: number }[]).map((p) => p.y));
    expect(Math.abs(lowest - bottom)).toBeGreaterThanOrEqual(6);
  });

  /** The size of the largest group frame (width plus height: a side grows either). */
  const size = async (source: string) => {
    const { svg } = await routes(source);
    return Math.max(
      ...[...svg.matchAll(/<rect[^>]* width="([\d.]+)" height="([\d.]+)"[^>]*fill="#efeddd"/g)].map(
        (m) => Number(m[1]) + Number(m[2]),
      ),
    );
  };
  const withEdges = (source: string, list: string[]) =>
    source.replace(
      /edges:[\s\S]*$/,
      list.length === 0 ? "edges: []\n" : `edges:\n${list.map((e) => `  - {${e}}`).join("\n")}\n`,
    );
  const FAN_EDGES = ["from: a, to: store", "from: b, to: store"];
  const U_EDGE = "from: src, to: b, fromAnchor: south, toAnchor: south";

  test("the growth does not depend on the order of the fan-in edges", async () => {
    expect(await size(withEdges(FAN_IN, FAN_EDGES))).toBe(
      await size(withEdges(FAN_IN, [...FAN_EDGES].reverse())),
    );
  });

  test("a fan-in grows the group; a single arrival or one in line does not", async () => {
    const none = await size(withEdges(FAN_IN, []));
    expect(await size(withEdges(FAN_IN, FAN_EDGES))).toBeGreaterThan(none);
    expect(await size(withEdges(FAN_IN, [FAN_EDGES[0] as string]))).toBe(none);
    expect(await size(withEdges(FAN_IN, ["from: a, to: top"]))).toBe(none);
  });

  test("curved or straight edges do not grow the group", async () => {
    const none = await size(withEdges(FAN_IN, []));
    for (const route of ["curve", "straight"]) {
      const list = FAN_EDGES.map((e) => `${e}, route: ${route}`);
      expect(await size(withEdges(FAN_IN, list))).toBe(none);
    }
    const base = await size(withEdges(U_TURN, []));
    expect(await size(withEdges(U_TURN, [U_EDGE]))).toBeGreaterThan(base);
    expect(await size(withEdges(U_TURN, [`${U_EDGE}, route: curve`]))).toBe(base);
  });

  test("an arrival facing the other end is not a U-turn", async () => {
    const base = await size(withEdges(U_TURN, []));
    expect(await size(withEdges(U_TURN, ["from: src, to: b, toAnchor: west"]))).toBe(base);
  });

  // Around the 3pt threshold: whatever the padding that the profile, density
  // and text scale give, the group grows only where the trunk would be within
  // 3pt of the frame, and then until it is clear (no near-border finding).
  test("the group grows only where the trunk would be within 3pt of the frame", async () => {
    let grew = 0;
    let kept = 0;
    for (const profile of ["paper-single", "paper-double"]) {
      for (const density of ["compact", "normal"]) {
        for (const textScale of [1, 1.5, 2]) {
          for (const source of [FAN_IN, U_TURN]) {
            const text = source
              .replace(/profile: [\w-]+/, `profile: ${profile}`)
              .replace(
                "  layout:\n",
                `  themeOverrides: {textScale: ${textScale}}\n  layout:\n    density: ${density}\n`,
              );
            const before = await size(withEdges(text, []));
            if ((await size(text)) > before) grew++;
            else kept++;
            expect(await nearBorder(text)).toEqual([]);
          }
        }
      }
    }
    expect(grew).toBeGreaterThan(0);
    expect(kept).toBeGreaterThan(0);
  });
});
