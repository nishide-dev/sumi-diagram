/**
 * Geometry lint end to end with the real D2 CLI (#13): fixtures under
 * tests/fixtures/figures/geometry produce exactly the expected geometry
 * diagnostics, the examples produce none, and no figure that D2 lays out on
 * its own (auto-sized shapes) gets a label overflow, clipping or overlap
 * (false positives of the re-measurement).
 *
 * Skipped when the pinned `d2` is not installed locally (`bun run d2:install`);
 * required in CI (`CI` set).
 */

import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { checkD2Version, findD2Binary } from "../../backends/d2/binary";
import { D2_VERSION } from "../../backends/d2/version";
import { lintRenderedFigure } from "./lint";

const binary = findD2Binary();
const available = binary.ok && (await checkD2Version(binary.value.path)).ok;
const inCI = Boolean(process.env.CI);

if (!available && !inCI) {
  console.warn(
    `[geometry d2] D2 v${D2_VERSION} not found; skipping. Run \`bun run d2:install\` to enable.`,
  );
}

const ROOT = join(import.meta.dir, "..", "..", "..");
const FIXTURES = join(ROOT, "tests", "fixtures", "figures");

async function lintFile(path: string) {
  const report = await lintRenderedFigure(await Bun.file(path).text(), { file: path });
  const geometry = report.diagnostics.filter((d) => d.code.startsWith("geometry/"));
  return { report, geometry };
}

describe.skipIf(!available && !inCI)("geometry lint with D2", () => {
  test.each<[string, string[]]>([
    ["exceeds-page-width", ["geometry/exceeds-page-width"]],
    ["label-overflow", ["geometry/label-overflow"]],
    ["edge-crosses-label", ["geometry/edge-crosses-label"]],
    // #31: the regression fixtures of the readability fixes.
    ["exceeds-page-height", ["geometry/exceeds-page-height"]],
    // #116: the label "errors" sits on the group's bottom border (D2 puts it
    // where the edge leaves the group).
    ["container-label", ["geometry/label-collision"]],
    ["reversed-edge", ["geometry/reversed-edge"]],
    ["reversed-edge-reordered", []],
    ["reversed-edge-group", []],
    ["containment", []],
    ["whitespace", []],
  ])("fixture %s", async (name, expected) => {
    const { report, geometry } = await lintFile(join(FIXTURES, "geometry", `${name}.sumi.yaml`));
    expect(report.rendered).toBeDefined();
    expect(geometry.map((d) => d.code)).toEqual(expected);
    for (const d of geometry) expect(d.location?.file).toContain(`${name}.sumi.yaml`);
  });

  test("exceeds-page-width reports both sizes in mm and fails the lint", async () => {
    const { report, geometry } = await lintFile(
      join(FIXTURES, "geometry", "exceeds-page-width.sumi.yaml"),
    );
    expect(geometry[0]?.message).toMatch(
      /^The figure is \d+(\.\d+)?mm wide, more than the 88mm maximum width of profile "paper-single"\.$/,
    );
    expect(report.exitCode).toBe(1);
    // The figure is never shrunk: the SVG keeps D2's full size.
    const { width } = report.rendered?.inspection.canvas ?? {};
    expect(width?.mm).toBeGreaterThan(88);
  });

  test("label-overflow points at the explicit size", async () => {
    const { geometry } = await lintFile(join(FIXTURES, "geometry", "label-overflow.sumi.yaml"));
    expect(geometry[0]?.path).toEqual(["nodes", 0, "props"]);
    expect(geometry[0]?.location?.line).toBe(15);
  });

  test("labels with blank lines render; D2's line advances are measured as written", async () => {
    const { report, geometry } = await lintFile(join(FIXTURES, "geometry", "whitespace.sumi.yaml"));
    expect(geometry).toEqual([]);
    const labelOf = (key: string) =>
      report.rendered?.inspection.elements.find((e) => e.key === key)?.labels[0];
    // D2 v0.9.0 divides its measured height (blank first / last lines add none) by the line count.
    expect(labelOf("n:newline")).toMatchObject({ lines: 2, lineHeightUnits: 0 });
    expect(labelOf("n:blank-lines")).toMatchObject({ lines: 2, lineHeightUnits: 0 });
    expect(labelOf("n:framed")?.lineHeightUnits).toBeCloseTo(16 / 3, 5);
    expect(labelOf("n:gap")).toMatchObject({ lines: 3, lineHeightUnits: 16 });
  });

  test("edge-crosses-label names the container", async () => {
    const { geometry } = await lintFile(join(FIXTURES, "geometry", "edge-crosses-label.sumi.yaml"));
    expect(geometry[0]?.message).toBe('Edge "enter" crosses the label of group "stages".');
  });

  test("reversed-edge names the edge and where its target is drawn (#31)", async () => {
    const { geometry } = await lintFile(join(FIXTURES, "geometry", "reversed-edge.sumi.yaml"));
    expect(geometry[0]?.path).toEqual(["edges", 1]);
    expect(geometry[0]?.message).toBe(
      'Edge edges[1] points against layout.direction (down): node "done" is drawn above node "process", although the edge does not close a cycle in declaration order.',
    );
  });

  test("exceeds-page-height compares with the paper profile's 220mm (#31)", async () => {
    const { report, geometry } = await lintFile(
      join(FIXTURES, "geometry", "exceeds-page-height.sumi.yaml"),
    );
    expect(geometry[0]?.message).toMatch(
      /^The figure is \d+(\.\d+)?mm tall, more than the 220mm maximum height of profile "paper-single"\.$/,
    );
    expect(report.exitCode).toBe(1);
  });

  test.each(["decision-flow", "pipeline"])(
    "example %s has no geometry diagnostics",
    async (name) => {
      const { report, geometry } = await lintFile(
        join(ROOT, "examples", name, `${name}.sumi.yaml`),
      );
      expect(geometry).toEqual([]);
      expect(report.exitCode).toBe(0);
    },
  );

  // Every figure D2 sizes on its own: re-measured labels fit their shapes,
  // nothing is clipped and nothing overlaps. (Page width and layout warnings
  // depend on the fixture and are not asserted here.)
  const autoSized = [
    ...readdirSync(join(FIXTURES, "valid")).map((f) => join(FIXTURES, "valid", f)),
    ...readdirSync(join(FIXTURES, "lint")).map((f) => join(FIXTURES, "lint", f)),
    ...readdirSync(join(ROOT, "tests", "fixtures", "compile")).map((f) =>
      join(ROOT, "tests", "fixtures", "compile", f),
    ),
  ].filter((f) => f.endsWith(".sumi.yaml"));
  test.each(autoSized)("no false positives: %s", async (path) => {
    const { geometry } = await lintFile(path);
    const unexpected = geometry.filter((d) =>
      [
        "geometry/label-overflow",
        "geometry/out-of-canvas",
        "geometry/node-overlap",
        "geometry/text-too-small",
        "geometry/reversed-edge",
      ].includes(d.code),
    );
    expect(unexpected).toEqual([]);
  });

  test("errors before rendering skip the render and the geometry rules", async () => {
    const { report, geometry } = await lintFile(join(FIXTURES, "lint", "no-cascade.sumi.yaml"));
    expect(report.rendered).toBeUndefined();
    expect(geometry).toEqual([]);
    expect(report.diagnostics.some((d) => d.code.startsWith("svg/"))).toBe(false);
    expect(report.exitCode).toBe(1);
  });
});
