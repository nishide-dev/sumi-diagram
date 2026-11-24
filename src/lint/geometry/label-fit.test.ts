/** The size that fits in a `geometry/label-overflow` hint (#614): checked at any configured level. */
import { describe, expect, test } from "bun:test";
import { type RenderedStructuredFigure, renderFigure } from "../../render/render";
import { resolveLintConfig } from "../config";
import { fitTrials } from "./label-fit";
import { geometryContextFor, lintGeometry } from "./lint";
import { labelOverflow } from "./rules";

const source = (size: string) => `version: 1
figure:
  id: fit
  theme: sumi
  layout:
    arrange: {row: {gap: 8mm, items: [a, d]}}
nodes:
  - {id: a, component: box, label: Start}
  - {id: d, component: diamond, label: "More\\nresearch?", props: {${size}}}
edges:
  - {from: a, to: d}
`;

async function rendered(text: string): Promise<RenderedStructuredFigure> {
  const result = await renderFigure(text);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return result.value as RenderedStructuredFigure;
}

const info = { rules: { "geometry/label-overflow": "info" as const } };
const subject = { kind: "node", id: "d" };
const overflows = (linted: Parameters<typeof labelOverflow.run>[0], s: unknown) =>
  labelOverflow.run(linted, undefined).some((f) => JSON.stringify(f.subject) === JSON.stringify(s));

describe("label-overflow fitting size at any level", () => {
  test("as an info the hint is still verified, and the size really fits", async () => {
    const text = source("width: 20mm, height: 12mm");
    const found = lintGeometry(await rendered(text), { source: text, config: info }).find(
      (d) => d.code === "geometry/label-overflow",
    );
    expect(found?.severity).toBe("info");
    expect(found?.hint).toMatch(/Verified: props\.width: 25mm, props\.height: 15mm/);
    const fixed = lintGeometry(await rendered(source("width: 25mm, height: 15mm")), {
      source: text,
      config: info,
    });
    expect(fixed.filter((d) => d.code === "geometry/label-overflow")).toEqual([]);
  });

  test("a size that still overflows is not verified, even when the rule is an info", async () => {
    const figure = await rendered(source("width: 20mm, height: 12mm"));
    const context = { ...geometryContextFor(figure), lintConfig: resolveLintConfig(info) };
    // The written size itself, "grown" to the same length: the trial keeps the overflow.
    const same = { widthMm: 20, heightMm: 12, changes: { width: true, height: true } };
    const [verdict] = fitTrials(context, [{ key: "n:d", subject, size: same }], overflows);
    expect(verdict).toEqual({ ok: false, reason: "overflow" });
  });
});

describe("trials are linted on the painted lines (#614 review)", () => {
  // Growing the diamond pushes the row below it down, onto a line: only the bundle's outer
  // strands (not its route) come too close, so the trial must see what is painted.
  const painted = (size: string) => `version: 1
figure:
  id: painted
  theme: sumi
  layout:
    arrange:
      place:
        unit: 1mm
        items:
          - {item: {stack: {gap: 3mm, items: [n, {row: {gap: 40mm, items: [e, d]}}]}}, at: [0, 0]}
          - {item: p, at: [-30, 10.8]}
          - {item: q, at: [30, 10.8]}
nodes:
  - {id: n, component: diamond, label: "More\\nresearch?", props: {${size}}}
  - {id: e, component: junction, variant: hidden}
  - {id: d, component: junction, variant: hidden}
  - {id: p, component: junction, variant: hidden}
  - {id: q, component: junction, variant: hidden}
edges:
  - {from: e, to: d, strands: 5, component: line}
  - {from: p, to: q, component: line}
`;
  test("a resize that brings a strand onto another line is not verified", async () => {
    const text = painted("width: 20mm, height: 12mm");
    const lint = lintGeometry(await rendered(text), { source: text });
    expect(lint.filter((d) => d.code === "geometry/edge-near-edge")).toEqual([]);
    const hint = lint.find((d) => d.code === "geometry/label-overflow")?.hint ?? "";
    expect(hint).not.toContain("Verified");
    expect(hint).toContain("the trial layout adds geometry/edge-near-edge");
    // The size it names does bring the strands onto the line when rendered.
    const after = lintGeometry(await rendered(painted("width: 25mm, height: 15mm")), {
      source: text,
    });
    expect(after.map((d) => d.code)).toContain("geometry/edge-near-edge");
  });
});
