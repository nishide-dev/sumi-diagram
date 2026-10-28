/**
 * Group padding for the room before an arrowhead (#171, design doc §6.42):
 * the #167 Transformer, whose residual edges enter a member from the side
 * through the group's padding, in `color` (1pt lines) and `academic`
 * (0.5pt lines). Needs no D2.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { lintGeometry } from "../../lint/geometry/lint";
import type { RenderedStructuredFigure } from "../../render/render";
import { renderFigure } from "../../render/render";
import { arrowheadLength } from "./arrowhead";
import { arrowheadPaddingDeficits, BORDER_CLEARANCE } from "./padding";
import { ROUTE } from "./router";

const ROOT = join(import.meta.dir, "..", "..", "..");
const FIGURE = join(ROOT, "research/167-stage-c/figures/a-transformer.sumi.yaml");

async function render(
  theme: string,
): Promise<{ source: string; rendered: RenderedStructuredFigure }> {
  const source = await Bun.file(FIGURE).text();
  const result = await renderFigure(source, {
    overrides: { theme },
    assetBase: join(FIGURE, ".."),
  });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return { source, rendered: result.value as RenderedStructuredFigure };
}

/** The padding of a group per side (units), from its rect and content. */
function padding(rendered: RenderedStructuredFigure, id: string) {
  const ir = rendered.compiled.ir;
  const key = ir.groups.find((g) => g.id === id)?.key;
  const group = rendered.layout.groups.find((g) => g.key === key);
  if (group === undefined) throw new Error(`no group ${id}`);
  const { rect, content } = group;
  return {
    rect,
    west: content.x - rect.x,
    east: rect.x + rect.width - (content.x + content.width),
  };
}

describe("group padding before arrowheads (#171)", () => {
  test("the clearance kept from the border is the router's", () => {
    expect(BORDER_CLEARANCE).toBe(ROUTE.clearance);
  });

  for (const [theme, stroke, grown] of [
    ["color", 2, 2],
    ["academic", 1, 0],
  ] as const) {
    test(`${theme}: the residual lines run in the padding, clear of the border`, async () => {
      const { source, rendered } = await render(theme);
      const ir = rendered.compiled.ir;
      // The side the residuals enter from grows by what it lacked, and only that side.
      const encoder = padding(rendered, "encoder");
      const decoder = padding(rendered, "decoder");
      expect(encoder.west).toBeCloseTo(16 + grown, 6);
      expect(encoder.east).toBeCloseTo(16, 6);
      expect(decoder.east).toBeCloseTo(16 + grown, 6);
      expect(decoder.west).toBeCloseTo(16, 6);
      // Settled: the final layout lacks nothing.
      expect(arrowheadPaddingDeficits(ir, rendered.layout).size).toBe(0);

      // The residual into enc-norm1 (toAnchor: west) bends the arrowhead's
      // length before the member and the clearance inside the border.
      const residual = rendered.layout.edges[7]?.route?.points;
      if (residual === undefined) throw new Error("edges[7] has no route");
      const bend = residual.at(-2);
      const tip = residual.at(-1);
      if (bend === undefined || tip === undefined) throw new Error("short route");
      expect(bend.y).toBeCloseTo(tip.y, 6);
      expect(tip.x - bend.x).toBeGreaterThanOrEqual(arrowheadLength(stroke) - 1e-6);
      expect(bend.x - encoder.rect.x).toBeGreaterThanOrEqual(BORDER_CLEARANCE - 1e-6);

      const near = lintGeometry(rendered, { source }).filter((d) =>
        /^geometry\/edge-(on|near)-border$/.test(d.code),
      );
      expect(near).toEqual([]);
    });
  }
});
