/**
 * Group padding for the room before an arrowhead (#171, design doc §6.42):
 * the #167 Transformer, whose residual edges enter a member from the side
 * through the group's padding, in `color` (1pt lines) and `academic`
 * (0.5pt lines). Needs no D2.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { buildFigureIR } from "../../compiler/ir";
import { checkFigure } from "../../core/check";
import { BUILTIN_PROFILE_DEFINITIONS } from "../../core/profile/builtin";
import { type Profile, validateProfile } from "../../core/profile/schema";
import { lintGeometry } from "../../lint/geometry/lint";
import type { RenderedStructuredFigure } from "../../render/render";
import { renderFigure } from "../../render/render";
import { layoutStructuredFigure } from "../index";
import { MAX_ALIGN_LAYOUTS } from "../structured/align";
import { placeStructured } from "../structured/engine";
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

/** Lays out (and routes) a structured figure; returns its IR and layout. */
function place(text: string, profile?: Profile) {
  const result = layoutStructuredFigure(text, profile === undefined ? {} : { profile });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return result.value;
}

function groupLayout(value: ReturnType<typeof place>, id: string) {
  const key = value.ir.groups.find((g) => g.id === id)?.key;
  const group = value.layout.groups.find((g) => g.key === key);
  if (group === undefined) throw new Error(`no group ${id}`);
  return group;
}

describe("group padding before arrowheads: edge cases (#171 review)", () => {
  test("a group's self-loop does not grow the group (its port stays on its border)", () => {
    const figure = (edges: string) => `version: 1
figure:
  id: self-loop
  theme: color
  profile: paper-double
  layout:
    arrange:
      stack: { items: [ g ] }
groups:
  - id: g
    arrange:
      stack: { items: [ a ] }
nodes:
  - { id: a, component: box, label: A }
${edges}`;
    const plain = place(figure("edges: []"));
    const looped = place(
      figure("edges:\n  - { from: g, fromAnchor: east, to: g, toAnchor: north }"),
    );
    // Same size (the route around the group only shifts the whole figure).
    const size = (v: ReturnType<typeof place>) => {
      const { rect } = groupLayout(v, "g");
      return { width: rect.width, height: rect.height };
    };
    expect(size(looped)).toEqual(size(plain));
    expect(arrowheadPaddingDeficits(looped.ir, looped.layout).size).toBe(0);
  });

  test("the re-layouts share the figure's align budget, and the stats count them all", async () => {
    const file = join(ROOT, "tests/fixtures/figures/layout/align-side-kv.sumi.yaml");
    const text = (await Bun.file(file).text()).replace("theme: academic", "theme: color");
    const ir = buildFigureIR(checkFigure(text));
    const placed = placeStructured(ir);
    expect(arrowheadPaddingDeficits(ir, placed.layout).size).toBe(0);
    // Re-laid out once: two align solves of at least one layout each.
    expect(placed.align?.layouts).toBeGreaterThanOrEqual(2);
    expect(placed.align?.layouts).toBeLessThanOrEqual(MAX_ALIGN_LAYOUTS);
    for (const maxLayouts of [1, 2, 5]) {
      const limited = placeStructured(ir, { alignLimits: { maxLayouts } });
      expect(limited.align?.layouts).toBeLessThanOrEqual(maxLayouts);
    }
  });

  test("nested groups sharing a border: the innermost grows, in one re-layout", () => {
    const base = BUILTIN_PROFILE_DEFINITIONS.find((p) => p.id === "paper-double");
    if (base === undefined) throw new Error("no paper-double");
    const validated = validateProfile({
      ...base,
      id: "zero-padding",
      layout: { ...base.layout, groupPadding: "0pt" },
    });
    if (!validated.ok) throw new Error(JSON.stringify(validated.diagnostics));
    const text = `version: 1
figure:
  id: nested
  theme: color
  profile: paper-double
  layout:
    arrange:
      stack: { items: [ g1 ] }
groups:
  - { id: g1, arrange: { stack: { items: [ g2 ] } } }
  - { id: g2, arrange: { stack: { items: [ g3 ] } } }
  - { id: g3, arrange: { stack: { items: [ g4 ] } } }
  - id: g4
    arrange:
      stack: { gap: 8mm, items: [ a, b ] }
nodes:
  - { id: a, component: box, label: A }
  - { id: b, component: box, label: B }
edges:
  - { from: a, to: b, toAnchor: west }
`;
    const value = place(text, validated.value);
    expect(arrowheadPaddingDeficits(value.ir, value.layout).size).toBe(0);
    const west = (id: string) => {
      const g = groupLayout(value, id);
      return g.content.x - g.rect.x;
    };
    // stub (12) + clearance (6), all on the innermost group.
    expect([west("g1"), west("g2"), west("g3"), west("g4")]).toEqual([0, 0, 0, 18]);
  });
});
