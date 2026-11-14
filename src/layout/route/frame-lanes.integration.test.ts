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
