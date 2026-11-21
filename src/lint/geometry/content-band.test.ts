/** `geometry/content-band` (#613): a stretched group centres its content; `contentAlign: top`, checked by a trial layout. */
// The rule table first: the lint config first: content-band → trial → config → rules is a cycle that must be entered at config.
import "../config";
import { describe, expect, test } from "bun:test";
import { type RenderedStructuredFigure, renderFigure } from "../../render/render";
import { CONTENT_BAND, MAX_BAND_TRIALS } from "./content-band";
import { lintGeometry } from "./lint";

function figure(fields: { a?: string; c?: string } = {}, align = "stretch") {
  return `version: 1
figure:
  id: content-band
  profile: paper-double
  layout:
    arrange:
      row: {gap: 4mm, align: ${align}, items: [a, b, c]}
groups:
  - id: a
    label: (a) Short
    ${fields.a ?? ""}
    arrange: {stack: {items: [a1, a2]}}
  - id: b
    label: (b) Tall
    arrange: {stack: {items: [b1, b2, b3, b4, b5]}}
  - id: c
    label: (c) Row
    ${fields.c ?? ""}
    arrange: {row: {items: [c1, c2]}}
nodes:
  - {id: a1, component: box, label: Input}
  - {id: a2, component: box, label: Encoder}
  - {id: b1, component: box, label: One}
  - {id: b2, component: box, label: Two}
  - {id: b3, component: box, label: Three}
  - {id: b4, component: box, label: Four}
  - {id: b5, component: box, label: Five}
  - {id: c1, component: box, label: Left}
  - {id: c2, component: box, label: Right}
edges:
  - {from: a1, to: a2}
  - {from: c1, to: c2}
`;
}

async function bands(source: string) {
  const result = await renderFigure(source);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  const rendered = result.value as RenderedStructuredFigure;
  return lintGeometry(rendered, { source }).filter((d) => d.code === CONTENT_BAND);
}

describe("geometry/content-band", () => {
  test("reports each stretched panel with both bands, with a verified contentAlign: top", async () => {
    const found = await bands(figure());
    expect(found.map((d) => d.subject)).toEqual([
      { kind: "group", id: "a" },
      { kind: "group", id: "c" },
    ]);
    for (const d of found) {
      expect(d.severity).toBe("info");
      expect(d.message).toMatch(/empty above the content and \d+\.\dmm below/);
      expect(d.hint).toMatch(/^Verified: setting groups\[[02]\]\.contentAlign to top puts/);
    }
  });

  test("silent once contentAlign is written, and for panels at their natural height", async () => {
    expect(await bands(figure({ a: "contentAlign: top", c: "contentAlign: center" }))).toEqual([]);
    expect(await bands(figure({}, "center"))).toEqual([]);
  });

  test("lays out at most MAX_BAND_TRIALS groups; the rest are reported unchecked", async () => {
    const short = Array.from({ length: MAX_BAND_TRIALS + 1 }, (_, i) => `s${i}`);
    const source = `version: 1
figure:
  id: content-band-budget
  profile: paper-double
  layout:
    arrange:
      row: {gap: 2mm, align: stretch, items: [${[...short, "tall"].join(", ")}]}
groups:
${short.map((id) => `  - {id: ${id}, arrange: {stack: {items: [${id}n]}}}`).join("\n")}
  - {id: tall, arrange: {stack: {items: [t1, t2, t3, t4, t5]}}}
nodes:
${short.map((id) => `  - {id: ${id}n, component: box, label: ${id}}`).join("\n")}
${[1, 2, 3, 4, 5].map((i) => `  - {id: t${i}, component: box, label: T${i}}`).join("\n")}
`;
    const found = await bands(source);
    expect(found).toHaveLength(MAX_BAND_TRIALS + 1);
    expect(found.filter((d) => d.hint?.startsWith("Verified"))).toHaveLength(MAX_BAND_TRIALS);
    expect(found.at(-1)?.hint).toMatch(
      /not checked \(at most \d+ groups are laid out again per figure\)/,
    );
  });
});
