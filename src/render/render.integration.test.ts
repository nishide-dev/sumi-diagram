/**
 * End-to-end check of SVG output and inspection (#11) with the real D2 CLI:
 * every valid fixture (all built-in components and variants, nested groups,
 * multi-edges, self-loops, labels with newlines) renders through
 * `renderFigure()`, and the finalized SVG and its geometry are checked for
 * consistency. This also pins the SVG structure Sumi relies on to the pinned
 * D2 version.
 *
 * Skipped when the pinned `d2` is not installed locally (`bun run d2:install`);
 * required in CI (`CI` set).
 */

import { describe, expect, test } from "bun:test";
import { createD2CliBackend } from "../backends/d2/backend";
import { checkD2Version, findD2Binary } from "../backends/d2/binary";
import { D2_VERSION } from "../backends/d2/version";
import { compileFigure, expectD2Figure } from "../compiler/compile";
import { generateD2 } from "../compiler/d2";
import type { FigureIR } from "../compiler/ir";
import { extrasFigure, goldenCases } from "../compiler/testing";
import type { ElementKey } from "../core/check-state";
import { SUMI_VERSION } from "../core/figure/validate";
import { finalizeSvg, readSvgMetadata, sha256 } from "./finalize";
import { containsPoint, containsRect, distanceToRect, type Point, type Rect } from "./geometry";
import { type ElementGeometry, inspectSvg, type SvgInspection } from "./inspect";
import { expectD2Rendered, renderFigure } from "./render";
import { attribute, parseXml } from "./xml";

const binary = findD2Binary();
const available = binary.ok && (await checkD2Version(binary.value.path)).ok;
const inCI = Boolean(process.env.CI);

if (!available && !inCI) {
  console.warn(
    `[render d2] D2 v${D2_VERSION} not found; skipping. Run \`bun run d2:install\` to enable.`,
  );
}

const backend = createD2CliBackend();

/** Slack for D2's rounding of coordinates and the gap it leaves before arrowheads. */
const ENDPOINT_TOLERANCE = 12;

function geometryByKey(inspection: SvgInspection): Map<ElementKey, ElementGeometry> {
  return new Map(inspection.elements.map((e) => [e.key, e]));
}

/** Checks the geometry is consistent with the IR: containment, labels, edge endpoints. */
function expectPlausibleGeometry(ir: FigureIR, inspection: SvgInspection) {
  const geometry = geometryByKey(inspection);
  expect([...geometry.keys()].sort()).toEqual([...ir.elements.keys()].sort());
  const canvas: Rect = inspection.canvas.viewBox;
  const bboxOf = (key: ElementKey): Rect | undefined => geometry.get(key)?.bbox;

  for (const element of ir.elements.values()) {
    const g = geometry.get(element.key);
    if (g === undefined) throw new Error(`missing ${element.key}`);
    expect(g.kind).toBe(element.kind);

    if (element.kind !== "edge") {
      const bbox = g.bbox;
      if (element.kind === "node" && element.shape === "text") {
        expect(bbox).toBeUndefined();
      } else {
        if (bbox === undefined) throw new Error(`no bbox for ${element.key}`);
        expect({ key: element.key, inside: containsRect(canvas, bbox) }).toEqual({
          key: element.key,
          inside: true,
        });
        // A child's shape lies inside its group's shape.
        const parent = element.parent && bboxOf(element.parent);
        if (parent !== undefined) {
          expect({ key: element.key, inParent: containsRect(parent, bbox) }).toEqual({
            key: element.key,
            inParent: true,
          });
        }
        // Label anchors (center, first baseline) lie inside the shape.
        for (const label of g.labels) {
          expect({ key: element.key, anchor: containsPoint(bbox, label.anchor) }).toEqual({
            key: element.key,
            anchor: true,
          });
        }
      }
    } else {
      const path = g.path ?? [];
      expect(path[0]?.command).toBe("M");
      const first = path[0]?.to as Point;
      const last = path[path.length - 1]?.to as Point;
      const near = (key: ElementKey, point: Point) => {
        const bbox = bboxOf(key);
        return bbox === undefined || distanceToRect(bbox, point) <= ENDPOINT_TOLERANCE;
      };
      const ok =
        (near(element.from, first) && near(element.to, last)) ||
        (near(element.from, last) && near(element.to, first));
      expect({ key: element.key, endpointsNearNodes: ok }).toEqual({
        key: element.key,
        endpointsNearNodes: true,
      });
    }

    // Labels: one per labelled element, with the same lines.
    if (element.label.trim() === "") {
      expect(g.labels).toEqual([]);
    } else {
      const lines = element.label.split(/\r\n?|\n/);
      expect(g.labels).toHaveLength(1);
      const label = g.labels[0];
      expect(label?.lines).toBe(lines.length);
      expect(label?.text.split("\n").map((l) => l.trim())).toEqual(lines.map((l) => l.trim()));
      expect(label?.fontSizeUnits).toBe(element.style.fontSize.units);
    }
  }
}

test("the pinned d2 is installed in CI", () => {
  if (inCI) expect(available).toBe(true);
});

describe.skipIf(!available)("renderFigure with D2", () => {
  for (const { name, input } of goldenCases()) {
    test(name, async () => {
      const text = await Bun.file(input).text();
      const result = await renderFigure(text, { backend });

      const compiled = compileFigure(text);
      if (!compiled.ok) throw new Error("fixture does not compile");
      if (compiled.value.ir.elements.size === 0) {
        expect(result).toMatchObject({
          ok: false,
          diagnostics: [{ code: "svg/empty-figure", severity: "error" }],
        });
        return;
      }
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
      const {
        svg,
        inspection,
        metadata,
        artifact,
        compiled: rendered,
      } = expectD2Rendered(result.value);
      const { ir } = rendered;

      // Root size: width/height in pt = viewBox × 0.5; viewBox unchanged.
      const parsed = parseXml(svg);
      if (!parsed.ok) throw new Error(parsed.message);
      const viewBox = attribute(parsed.root, "viewBox");
      expect(viewBox).toBe(attribute(parseXmlOrThrow(artifact.svg), "viewBox") as string);
      const [, , w, h] = (viewBox ?? "").split(" ").map(Number);
      expect(attribute(parsed.root, "width")).toBe(`${(w ?? 0) * 0.5}pt`);
      expect(attribute(parsed.root, "height")).toBe(`${(h ?? 0) * 0.5}pt`);
      expect(inspection.canvas.width.pt).toBe((w ?? 0) * 0.5);
      expect(inspection.canvas.height.pt).toBe((h ?? 0) * 0.5);

      // Metadata.
      expect(metadata).toEqual({
        format: 1,
        sumiVersion: SUMI_VERSION,
        backend: { name: "d2-cli", version: D2_VERSION },
        figureId: ir.meta.id,
        theme: ir.meta.themeId,
        profile: ir.meta.profileId,
        fontSet: ir.meta.fontSetId,
        inputSha256: sha256(text),
        d2Sha256: sha256(rendered.d2Source),
      });
      expect(readSvgMetadata(svg)).toMatchObject({ ok: true, value: metadata });

      // Every element exactly once (or inspection would have failed) with plausible geometry.
      expectPlausibleGeometry(ir, inspection);
      expect(inspection.profile.id).toBe(ir.meta.profileId);

      // Byte-deterministic.
      const again = await renderFigure(text, { backend });
      if (!again.ok) throw new Error("second render failed");
      expect(again.value.svg).toBe(svg);
    });
  }

  test("custom edges and text styles (mono, italic, backward edges)", async () => {
    const ir = extrasFigure();
    const base = compileFigure("version: 1\nfigure: { id: extras }\n");
    if (!base.ok) throw new Error("expected ok");
    const compiled = {
      ...expectD2Figure(base.value),
      ir,
      d2Source: generateD2(ir),
      sourceMap: ir.sourceMap,
    };
    const rendered = await backend.render({
      d2Source: compiled.d2Source,
      layout: compiled.layout,
      fontSet: compiled.fontSet,
    });
    if (!rendered.ok) throw new Error(JSON.stringify(rendered.diagnostics));
    const finalized = finalizeSvg(rendered.value, compiled, { source: "extras" });
    if (!finalized.ok) throw new Error(JSON.stringify(finalized.diagnostics, null, 2));
    const inspected = inspectSvg(finalized.value.svg, ir);
    if (!inspected.ok) throw new Error(JSON.stringify(inspected.diagnostics, null, 2));
    expectPlausibleGeometry(ir, inspected.value);
    const fonts = inspected.value.elements.flatMap((e) => e.labels.map((l) => l.font));
    expect([...fonts].sort()).toEqual(["mono-bold", "mono-italic", "regular", "regular"]);
  });

  test("labels keep their lines, including multi-line CJK", async () => {
    const result = await renderFigure(
      `version: 1
figure: { id: lines }
nodes:
  - { id: a, component: box, label: "one\\ntwo\\nthree" }
  - { id: b, component: label, label: "多行\\nラベル" }
edges:
  - { from: a, to: b, label: "x\\ny" }
`,
      { backend },
    );
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const labels = result.value.inspection.elements.map((e) => e.labels[0]);
    expect(labels.map((l) => [l?.text, l?.lines])).toEqual([
      ["one\ntwo\nthree", 3],
      ["多行\nラベル", 2],
      ["x\ny", 2],
    ]);
  });
});

function parseXmlOrThrow(svg: string) {
  const parsed = parseXml(svg);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.root;
}
