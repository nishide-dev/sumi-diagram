import { describe, expect, test } from "bun:test";
import { lintGeometry } from "../lint/geometry";
import { renderFigure } from "./render";

/**
 * Crossed vs covered non-members (#518): a probe node slides in from the right
 * towards a set around two members; it is `clear`, then `crossed`
 * (geometry/set-outline-crosses-node), then `covered`
 * (geometry/set-contains-non-member), never two of them and never a gap.
 */
type Status = "clear" | "crossed" | "covered";

const SHAPES = ["circle", "ellipse", "hull", "rect"];

async function status(
  shape: string,
  probe: string,
  x: number,
  extraSets = "",
  y = 0,
): Promise<{ codes: string[]; by: Record<string, string[]> }> {
  const source = `version: 1
figure:
  id: probe
  theme: color
  profile: paper-double
  layout:
    arrange:
      place:
        unit: 1mm
        items:
          - { item: m1, at: [0, 0] }
          - { item: m2, at: [14, 0] }
          - { item: p, at: [${x}, ${y}] }
nodes:
  - { id: m1, component: box, label: A }
  - { id: m2, component: box, label: B }
  - { id: p, ${probe} }
sets:
  - { id: s, members: [m1, m2], shape: ${shape}, padding: 3mm }
${extraSets}`;
  const result = await renderFigure(source);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  if (!("layout" in result.value)) throw new Error("expected a structured figure");
  const findings = lintGeometry(result.value, { source }).filter(
    (d) =>
      d.code === "geometry/set-outline-crosses-node" ||
      d.code === "geometry/set-contains-non-member",
  );
  const by: Record<string, string[]> = {};
  for (const d of findings) (by[d.subject?.id ?? ""] ??= []).push(d.code);
  return { codes: by.s ?? [], by };
}

const classify = (codes: string[]): Status =>
  codes.length === 0
    ? "clear"
    : codes.length === 1 && codes[0] === "geometry/set-outline-crosses-node"
      ? "crossed"
      : codes.length === 1 && codes[0] === "geometry/set-contains-non-member"
        ? "covered"
        : (() => {
            throw new Error(`reported twice or unexpectedly: ${codes.join(", ")}`);
          })();

const ORDER: Status[] = ["clear", "crossed", "covered"];

async function sweep(shape: string, probe: string, y = 0): Promise<Status[]> {
  const out: Status[] = [];
  // From far to deep inside (mm); the set around A and B spans about -9..23.
  for (let x = 40; x >= 7; x -= 1.5)
    out.push(classify((await status(shape, probe, x, "", y)).codes));
  return out;
}

describe("set outline vs non-member nodes", () => {
  for (const shape of SHAPES)
    for (const probe of [
      "component: box, label: P",
      "component: circle, label: P",
      "component: diamond, label: P",
      "component: box, label: '', props: { width: 1pt, height: 30pt }",
    ])
      test(`${shape} set, probe ${probe}: clear, crossed, covered in order, each once`, async () => {
        const seen = await sweep(shape, probe);
        const ranks = seen.map((s) => ORDER.indexOf(s));
        expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
        expect(seen[0]).toBe("clear");
        expect(seen.at(-1)).toBe("covered");
      });

  test("a diamond's empty corner is not crossing: it crosses later than a box does", async () => {
    // Off the center line, a box's corner reaches into the circle before a diamond's slanted side does.
    const first = async (probe: string) => {
      const seen = await sweep("circle", probe, 19);
      return seen.indexOf("crossed");
    };
    const size = "props: { width: 30pt, height: 30pt }";
    const box = await first(`component: box, label: '', ${size}`);
    const diamond = await first(`component: diamond, label: '', ${size}`);
    expect(box).toBeGreaterThanOrEqual(0);
    expect(diamond).toBeGreaterThan(box);
  });

  test("a thin node is judged like any other: crossed, then covered", async () => {
    const thin = "component: box, label: '', props: { width: 1pt, height: 30pt }";
    const seen = new Set(await sweep("ellipse", thin));
    expect(seen.has("crossed") || seen.has("covered")).toBe(true);
    expect((await status("ellipse", thin, 7)).codes).toEqual(["geometry/set-contains-non-member"]);
  });

  test("a member of one set is a non-member of an overlapping one: reported for that set only", async () => {
    // Set t holds p alone; p is no member of s and straddles its outline.
    const extra = "  - { id: t, members: [p], shape: rect, padding: 1mm }\n";
    let sawCrossed = false;
    for (let x = 40; x >= 7; x -= 1.5) {
      const { by } = await status("circle", "component: box, label: P", x, extra);
      for (const code of by.s ?? []) sawCrossed ||= code === "geometry/set-outline-crosses-node";
      expect((by.s ?? []).length).toBeLessThanOrEqual(1);
    }
    expect(sawCrossed).toBe(true);
  });
});
