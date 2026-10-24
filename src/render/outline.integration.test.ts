import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createD2CliBackend } from "../backends/d2/backend";
import { checkD2Version, findD2Binary } from "../backends/d2/binary";
import type { DiagramBackend } from "../backends/types";
import { compileFigure } from "../compiler/compile";
import { generateD2 } from "../compiler/d2";
import { getOutlineRenderer } from "../core/outline";
import { lintRenderedFigure } from "../lint/geometry";
import { finalizeSvg, readSvgMetadata, sha256 } from "./finalize";
import { containsRect, type Point } from "./geometry";
import { inspectSvg } from "./inspect";
import { ENDPOINT_ANGLE_TOLERANCE_DEG, entryAngle, rayHit, rectPoints } from "./outline-geometry";
import { OUTLINE_SOURCE, outlineRegistry } from "./outline-testing";
import { svgToEditablePptx } from "./pptx";
import { renderFigure } from "./render";

const binary = findD2Binary();
const available = binary.ok && (await checkD2Version(binary.value.path)).ok;
const real = createD2CliBackend();
// Each case starts D2 4–8 times (measurement, final layout, determinism or
// reference sizes). Shared CI runners can exceed Bun's default five seconds.
const D2_TEST_TIMEOUT_MS = 30_000;
test("pinned D2 is installed for outline integration in CI", () => {
  if (process.env.CI) expect(available).toBe(true);
});

describe.skipIf(!available)("outline pipeline with real D2", () => {
  test(
    "backward edges, self loops and parallel routes keep the declared endpoint mapping",
    async () => {
      const source = `version: 1
figure: { id: routes, profile: paper-double }
nodes:
  - { id: a, component: test/trapezoid, label: A }
  - { id: b, component: test/stack, label: B }
edges:
  - { id: back, from: a, to: b, component: test/backward }
  - { id: again, from: a, to: b }
  - { id: loop, from: b, to: b }
`;
      const result = await renderFigure(source, { registry: outlineRegistry() });
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      expect(result.diagnostics.filter((d) => d.code !== "svg/outline-edge-crossing")).toEqual([]);
      const again = await renderFigure(source, { registry: outlineRegistry() });
      expect(again.ok && again.value.svg).toBe(result.value.svg);
      const metadata = readSvgMetadata(result.value.svg);
      expect(metadata.ok).toBe(true);
    },
    D2_TEST_TIMEOUT_MS,
  );
  for (const theme of ["minimal", "academic", "slides"]) {
    for (const direction of ["right", "left", "down", "up"]) {
      test(
        `${theme} / ${direction}: sizes, labels, endpoint clearance, determinism`,
        async () => {
          const source = OUTLINE_SOURCE.replace("theme: academic", `theme: ${theme}`)
            .replace(
              "profile: paper-double",
              theme === "slides" ? "profile: presentation-16x9" : "profile: paper-double",
            )
            .replace("direction: right", `direction: ${direction}`);
          const registry = outlineRegistry();
          let calls = 0;
          const backend: DiagramBackend = {
            ...real,
            render: async (input) => {
              calls++;
              return real.render(input);
            },
          };
          const result = await renderFigure(source, { registry, backend });
          if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
          expect(result.diagnostics).toEqual([]);
          expect(calls).toBe(2);
          const { compiled, artifact, svg, inspection, metadata } = result.value;
          expect(artifact.d2Source).toBe(compiled.d2Source);
          expect(generateD2(compiled.ir)).toBe(compiled.d2Source);
          expect(metadata.inputSha256).toBe(sha256(source));
          expect(metadata.d2Sha256).toBe(sha256(compiled.d2Source));
          expect(readSvgMetadata(svg)).toEqual({ ok: true, value: metadata, diagnostics: [] });
          const finalized = finalizeSvg(artifact, compiled, { source });
          if (!finalized.ok) throw new Error("finalize failed");
          const raw = inspectSvg(finalized.value.svg, compiled.ir);
          if (!raw.ok) throw new Error("inspect failed");
          const before = new Map(raw.value.elements.map((g) => [g.key, g]));
          const after = new Map(inspection.elements.map((g) => [g.key, g]));
          for (const node of compiled.ir.nodes.filter((n) => n.render)) {
            const bbox = before.get(node.key)?.bbox;
            if (!bbox || !node.render) throw new Error("missing bbox");
            expect(after.get(node.key)?.bbox).toEqual(bbox);
            expect(bbox.width).toBe(node.width?.units as number);
            expect(bbox.height).toBe(node.height?.units as number);
            const renderer = getOutlineRenderer(node.render.renderer);
            if (!renderer) throw new Error("missing renderer");
            const drawing = renderer.draw(bbox, renderer.params.parse(node.render.params));
            const oldLabel = before.get(node.key)?.labels[0];
            const newLabel = after.get(node.key)?.labels[0];
            expect(newLabel?.text).toBe(oldLabel?.text);
            expect(newLabel?.lineHeightUnits).toBe(oldLabel?.lineHeightUnits as number);
            expect(newLabel?.fontSizeUnits).toBe(oldLabel?.fontSizeUnits as number);
            expect(newLabel?.anchor.y).toBeCloseTo(
              (oldLabel?.anchor.y ?? 0) +
                drawing.safeArea.y +
                drawing.safeArea.height / 2 -
                bbox.y -
                bbox.height / 2,
              2,
            );
            expect(newLabel?.anchor.x).toBeCloseTo(
              drawing.safeArea.x + drawing.safeArea.width / 2,
              2,
            );
            if (node.parent) {
              const parent = after.get(node.parent)?.bbox;
              if (!parent) throw new Error("missing parent");
              expect(containsRect(parent, bbox)).toBe(true);
            }
          }
          for (const edge of compiled.ir.edges) {
            const original = before.get(edge.key)?.path ?? [];
            const composed = after.get(edge.key)?.path ?? [];
            for (const end of ["source", "target"] as const) {
              const node = compiled.ir.elements.get(end === "source" ? edge.from : edge.to);
              if (node?.kind !== "node" || !node.render) continue;
              const bbox = before.get(node.key)?.bbox;
              if (!bbox) throw new Error("missing node geometry");
              const index = end === "source" ? 0 : original.length - 1;
              const point = original[index]?.to as Point;
              const last = original[index];
              const next = original[1];
              const neighbour =
                end === "source"
                  ? next?.command === "C"
                    ? next.c1
                    : next?.to
                  : last?.command === "C"
                    ? last.c2
                    : original[index - 1]?.to;
              if (!neighbour) throw new Error("missing route");
              const length = Math.hypot(point.x - neighbour.x, point.y - neighbour.y);
              const normal = {
                x: (point.x - neighbour.x) / length,
                y: (point.y - neighbour.y) / length,
              };
              expect(Math.min(Math.abs(normal.x), Math.abs(normal.y))).toBeLessThan(1e-6);
              const clearance = rayHit(rectPoints(bbox), point, normal);
              expect(clearance).toBeDefined();
              expect(clearance).toBeLessThanOrEqual(12);
              const renderer = getOutlineRenderer(node.render.renderer);
              if (!renderer) throw new Error("missing renderer");
              const outline = renderer.draw(
                bbox,
                renderer.params.parse(node.render.params),
              ).outline;
              const moved = composed[index]?.to as Point;
              expect(rayHit(outline, moved, normal)).toBeCloseTo(clearance as number, 2);
            }
          }
          const again = await renderFigure(source, { registry });
          expect(again.ok && again.value.svg).toBe(svg);
        },
        D2_TEST_TIMEOUT_MS,
      );
    }
  }
  test(
    "explicit dimensions use one pass; partial dimensions preserve the written axis",
    async () => {
      for (const props of [
        "{ width: 80pt, height: 60pt }",
        "{ width: 80pt }",
        "{ height: 60pt }",
      ]) {
        const source = `version: 1\nfigure: { id: explicit }\nnodes:\n  - { id: s, component: test/stack, label: "A\\nB", props: ${props} }\n`;
        let calls = 0;
        const backend: DiagramBackend = {
          ...real,
          render: async (input) => {
            calls++;
            return real.render(input);
          },
        };
        const result = await renderFigure(source, { registry: outlineRegistry(), backend });
        if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
        expect(result.diagnostics).toEqual([]);
        expect(calls).toBe(props.includes("width") && props.includes("height") ? 1 : 2);
        const node = result.value.compiled.ir.nodes[0];
        if (props.includes("width")) expect(node?.width?.units).toBe(160);
        if (props.includes("height")) expect(node?.height?.units).toBe(120);
        const initial = compileFigure(source, { registry: outlineRegistry() });
        expect(initial.ok && initial.value.ir.nodes[0]?.render).toEqual(node?.render);
        if (initial.ok) expect(Object.isFrozen(node?.render?.params)).toBe(true);
      }
    },
    D2_TEST_TIMEOUT_MS,
  );

  test(
    "narrow explicit and partial dimensions keep labels centered inside the safe area",
    async () => {
      for (const component of ["stack", "trapezoid"]) {
        const template = (props: string) =>
          `version: 1\nfigure: { id: narrow }\nnodes:\n  - { id: a, component: test/${component}, label: "LongLongLong\\n日本語", props: ${props} }\n`;
        const reference = await renderFigure(template("{ width: 160pt, height: 80pt }"), {
          registry: outlineRegistry(),
        });
        if (!reference.ok) throw new Error(JSON.stringify(reference.diagnostics));
        const refNode = reference.value.compiled.ir.nodes[0];
        const refGeometry = reference.value.inspection.elements[0];
        const renderer = refNode?.render && getOutlineRenderer(refNode.render.renderer);
        if (!renderer || !refGeometry?.bbox || !refGeometry.labels[0])
          throw new Error("missing reference geometry");
        const refArea = renderer.draw(
          refGeometry.bbox,
          renderer.params.parse(refNode?.render?.params),
        ).safeArea;
        const baselineOffset = refGeometry.labels[0].anchor.y - refArea.y - refArea.height / 2;
        for (const props of ["{ width: 10pt, height: 40pt }", "{ width: 10pt }"]) {
          const registry = outlineRegistry();
          const source = template(props);
          const result = await renderFigure(source, { registry });
          if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
          expect(result.diagnostics).toEqual([]);
          const node = result.value.compiled.ir.nodes[0];
          const geometry = result.value.inspection.elements[0];
          if (!node?.render || !geometry?.bbox) throw new Error("missing outline");
          const renderer = getOutlineRenderer(node.render.renderer);
          if (!renderer) throw new Error("missing renderer");
          const area = renderer.draw(
            geometry.bbox,
            renderer.params.parse(node.render.params),
          ).safeArea;
          const label = geometry.labels[0];
          if (!label) throw new Error("missing label");
          expect(geometry.bbox.width).toBe(20);
          if (props.includes("height")) expect(geometry.bbox.height).toBe(80);
          expect(label.anchor.x).toBeCloseTo(area.x + area.width / 2, 2);
          // Keep D2's baseline offset of the same centered multiline label,
          // even when its width overflows the explicitly preserved footprint.
          expect(label.anchor.y - area.y - area.height / 2).toBeCloseTo(baselineOffset, 2);
          expect(result.value.compiled.d2Source).toContain("label.near: center-center");
        }
      }
    },
    D2_TEST_TIMEOUT_MS,
  );

  // #82: D2 traces straight routes to diamond ends, leaving them < 1 unit off
  // axis. Such ends are extended along their own direction without warnings.
  for (const [fixture, minDeg, extended] of [
    ["nearly-aligned", 1.2, 0],
    ["slanted-side", 1.2, 2],
  ] as const) {
    test(
      `${fixture}: nearly axis-aligned ends reach the outline without outline-edge-miss`,
      async () => {
        const source = await Bun.file(
          join(import.meta.dir, `../../tests/fixtures/outlines/${fixture}.sumi.yaml`),
        ).text();
        const report = await lintRenderedFigure(source);
        expect(report.diagnostics).toEqual([]);
        const rendered = report.rendered;
        if (!rendered) throw new Error("render failed");
        const { compiled, artifact, inspection, svg } = rendered;
        const finalized = finalizeSvg(artifact, compiled, { source });
        if (!finalized.ok) throw new Error("finalize failed");
        const raw = inspectSvg(finalized.value.svg, compiled.ir);
        if (!raw.ok) throw new Error("inspect failed");
        const before = new Map(raw.value.elements.map((g) => [g.key, g]));
        const after = new Map(inspection.elements.map((g) => [g.key, g]));
        let maxDeg = 0;
        let moved = 0;
        for (const edge of compiled.ir.edges) {
          const original = before.get(edge.key)?.path ?? [];
          const composed = after.get(edge.key)?.path ?? [];
          for (const end of ["source", "target"] as const) {
            const node = compiled.ir.elements.get(end === "source" ? edge.from : edge.to);
            if (node?.kind !== "node" || !node.render) continue;
            const bbox = before.get(node.key)?.bbox;
            if (!bbox) throw new Error("missing node geometry");
            const index = end === "source" ? 0 : original.length - 1;
            const point = original[index]?.to as Point;
            const neighbour = (
              end === "source" ? original[1]?.to : original[index - 1]?.to
            ) as Point;
            const length = Math.hypot(point.x - neighbour.x, point.y - neighbour.y);
            const ray = {
              x: (point.x - neighbour.x) / length,
              y: (point.y - neighbour.y) / length,
            };
            const clearance = rayHit(rectPoints(bbox), point, ray) as number;
            const angle = entryAngle(bbox, point, ray, clearance);
            expect(angle).toBeLessThanOrEqual(ENDPOINT_ANGLE_TOLERANCE_DEG);
            maxDeg = Math.max(maxDeg, angle);
            const renderer = getOutlineRenderer(node.render.renderer);
            if (!renderer) throw new Error("missing renderer");
            const outline = renderer.draw(bbox, renderer.params.parse(node.render.params)).outline;
            const end_ = composed[index]?.to as Point;
            // The end keeps D2's clearance to the drawn outline along its own ray.
            expect(rayHit(outline, end_, ray)).toBeCloseTo(clearance, 2);
            const shift = Math.hypot(end_.x - point.x, end_.y - point.y);
            if (shift > 1) {
              moved++;
              // Extended along the travel direction, not snapped to an axis.
              expect(
                Math.abs((end_.x - point.x) * ray.y - (end_.y - point.y) * ray.x),
              ).toBeLessThan(0.01);
            }
          }
        }
        // Guard that D2 still produces the off-axis routes this fixture pins.
        expect(maxDeg).toBeGreaterThan(minDeg);
        expect(moved).toBe(extended);
        for (const connectors of ["freeform", "glued"] as const) {
          const pptx = svgToEditablePptx(svg, compiled.ir, { connectors });
          if (!pptx.ok) throw new Error(JSON.stringify(pptx.diagnostics));
        }
      },
      D2_TEST_TIMEOUT_MS,
    );
  }
});
