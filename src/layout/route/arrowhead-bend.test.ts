import { expect, test } from "bun:test";
import { BUILTIN_THEMES } from "../../core/theme/builtin";
import { layoutStructuredFigure } from "../index";
import { arrowheadLength, routeEdges } from "./router";

const root = `${import.meta.dir}/../../..`;

test("#217: a junction's free direction still needs room for its arrowhead", async () => {
  const text = await Bun.file(
    `${root}/tests/fixtures/figures/layout/arrowhead-on-bend.sumi.yaml`,
  ).text();
  for (const theme of BUILTIN_THEMES.keys()) {
    const result = layoutStructuredFigure(text, { overrides: { theme } });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const { ir, layout } = result.value;
    const points = layout.edges[0]?.route?.points;
    expect(points).toBeDefined();
    const a = points?.at(-2);
    const b = points?.at(-1);
    if (a === undefined || b === undefined || ir.edges[0] === undefined)
      throw new Error("no route");
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(
      arrowheadLength(ir.edges[0].style.strokeWidth.units),
    );
    expect(routeEdges(ir, layout, { verifyLowerBound: true }).diagnostics).toEqual([]);
  }
});

test("#217: source arrowheads at junctions use the same constrained retry", async () => {
  const text = (
    await Bun.file(`${root}/tests/fixtures/figures/layout/arrowhead-on-bend.sumi.yaml`).text()
  ).replace(
    "from: source, to: target, fromAnchor:",
    "component: double-arrow, from: target, to: source, toAnchor:",
  );
  const result = layoutStructuredFigure(text);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const { ir, layout } = result.value;
  const points = layout.edges[0]?.route?.points;
  const a = points?.[0];
  const b = points?.[1];
  if (!a || !b || !ir.edges[0]) throw new Error("no route");
  expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(
    arrowheadLength(ir.edges[0].style.strokeWidth.units),
  );
  expect(routeEdges(ir, layout, { verifyLowerBound: true }).diagnostics).toEqual([]);
});

test("#217: an arrowhead with no valid approach gets layout/no-route", async () => {
  const text = (
    await Bun.file(`${root}/tests/fixtures/figures/layout/arrowhead-on-bend.sumi.yaml`).text()
  )
    .replace("gap: 20pt", "gap: 2pt")
    .replace(', fromAnchor: "east:0.6"', "");
  const result = layoutStructuredFigure(text);
  expect(result.ok).toBe(false);
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "layout/no-route",
      severity: "error",
      subject: { kind: "edge", id: "bent" },
    }),
  );
});

test("#217: acceptance out-proj → c-add-out keeps a full arrowhead-length straight run", async () => {
  const text = await Bun.file(`${root}/research/185-acceptance/figures/c-h3world.sumi.yaml`).text();
  const result = layoutStructuredFigure(text);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const { ir, layout } = result.value;
  const edge = ir.edges.find((e) => e.from === "n:out-proj" && e.to === "n:c-add-out");
  if (edge === undefined) throw new Error("no acceptance edge");
  const points = layout.edges.find((e) => e.key === edge.key)?.route?.points;
  const a = points?.at(-2);
  const b = points?.at(-1);
  if (a === undefined || b === undefined) throw new Error("no acceptance route");
  expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(
    arrowheadLength(edge.style.strokeWidth.units),
  );
});
