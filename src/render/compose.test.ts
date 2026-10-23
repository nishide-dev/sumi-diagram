import { expect, test } from "bun:test";
import { join } from "node:path";
import type { DiagramBackend } from "../backends/types";
import { compileFigure } from "../compiler/compile";
import { readonlyMap } from "../compiler/ir";
import { composeOutlines } from "./compose";
import { finalizeSvg } from "./finalize";
import { inspectSvg } from "./inspect";
import { extensionsCross, rayHit, rectPoints } from "./outline-geometry";
import { outlineRegistry } from "./outline-testing";
import { renderFigure } from "./render";
import { artifactFor, tinyCompiled, tinySvg } from "./testing";
import { attribute, childElements, classList, descendants, parseXml } from "./xml";

const ROOT = join(import.meta.dir, "../..");
const source = await Bun.file(join(ROOT, "tests/fixtures/outlines/corner.sumi.yaml")).text();
const raw = await Bun.file(join(ROOT, "tests/fixtures/outlines/corner.svg")).text();
function fixture(svg = raw) {
  const compiled = compileFigure(source, { registry: outlineRegistry(), file: "corner.sumi.yaml" });
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  const finalized = finalizeSvg(artifactFor(compiled.value, svg), compiled.value, { source });
  if (!finalized.ok) throw new Error(JSON.stringify(finalized.diagnostics));
  const inspection = inspectSvg(finalized.value.svg, compiled.value.ir);
  if (!inspection.ok) throw new Error(JSON.stringify(inspection.diagnostics));
  return { compiled: compiled.value, svg: finalized.value.svg, inspection: inspection.value };
}

test("corner fixture warns when extended segments intersect, preserving clearance and provenance", () => {
  const f = fixture();
  const result = composeOutlines(f.svg, f.compiled.ir, f.inspection);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  expect(result.diagnostics).toHaveLength(1);
  expect(result.diagnostics[0]).toMatchObject({
    code: "svg/outline-edge-crossing",
    severity: "warning",
    path: ["edges", 0],
    location: { file: "corner.sumi.yaml" },
    subject: { kind: "edge", id: "left" },
    related: [{ path: ["edges", 1] }],
  });
  const after = inspectSvg(result.value, f.compiled.ir);
  if (!after.ok) throw new Error(JSON.stringify(after.diagnostics));
  expect(after.value.elements.find((e) => e.key === "e:left")?.path?.at(-1)?.to).toEqual({
    x: 14,
    y: 4,
  });
  expect(after.value.elements.find((e) => e.key === "e:top")?.path?.at(-1)?.to).toEqual({
    x: 4,
    y: 14,
  });
  expect(after.value.elements.find((e) => e.key === "n:stack")?.bbox).toEqual(
    f.inspection.elements.find((e) => e.key === "n:stack")?.bbox,
  );
  expect(composeOutlines(f.svg, f.compiled.ir, f.inspection)).toEqual(result);
});

test("unexpected placeholder structures fail explicitly rather than keeping a rectangle", () => {
  const f = fixture();
  // Valid SVG shapes can still violate the one-rect placeholder contract.
  for (const invalid of [
    f.svg.replace(
      '<rect x="0" y="0" width="100" height="100"',
      '<rect x="0" y="0" width="1" height="1"/><rect x="0" y="0" width="100" height="100"',
    ),
    f.svg.replace(
      '<rect x="0" y="0" width="100" height="100"',
      '<ellipse cx="50" cy="50" rx="50" ry="50"',
    ),
  ]) {
    const result = composeOutlines(invalid, f.compiled.ir, f.inspection);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.at(-1)).toMatchObject({
      code: "svg/unsupported-geometry",
      severity: "error",
      subject: { kind: "node", id: "stack" },
    });
  }
});

test("a route that misses the declared footprint warns and remains unchanged", () => {
  const f = fixture(raw.replace("M -18 4 L -2 4", "M -18 -10 L -2 -10"));
  const result = composeOutlines(f.svg, f.compiled.ir, f.inspection);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  expect(result.diagnostics.map((d) => d.code)).toEqual(["svg/outline-edge-miss"]);
  expect(result.value).toContain('d="M -18 -10 L -2 -10"');
});

test("paint, unrelated SVG bytes and markers are preserved; radius is reported", () => {
  const f = fixture(
    raw.replace('width="100" height="100" fill=', 'width="100" height="100" rx="3" ry="3" fill='),
  );
  const nodes = f.compiled.ir.nodes.map((n) =>
    n.render ? { ...n, style: { ...n.style, radius: { pt: 1.5, units: 3 } } } : n,
  );
  const ir = {
    ...f.compiled.ir,
    nodes,
    elements: readonlyMap([...nodes, ...f.compiled.ir.edges].map((n) => [n.key, n] as const)),
  };
  const result = composeOutlines(f.svg, ir, f.inspection);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  expect(result.diagnostics.map((d) => d.code)).toContain("svg/outline-radius-ignored");
  const parsed = parseXml(result.value);
  if (!parsed.ok) throw new Error(parsed.message);
  const group = [...descendants(parsed.root)].find((e) => classList(e).includes("sumi-k-n--stack"));
  if (!group) throw new Error("missing stack");
  const shape = childElements(group).find((e) => classList(e).includes("shape"));
  if (!shape) throw new Error("missing shape");
  for (const layer of childElements(shape)) {
    expect(layer.name).toBe("path");
    expect(attribute(layer, "fill")).toBe("#ffffff");
    expect(attribute(layer, "stroke")).toBe("#000000");
    expect(attribute(layer, "style")).toBe("stroke-width:2;");
    expect(attribute(layer, "rx")).toBeUndefined();
    expect(attribute(layer, "d")).toEndWith(" Z");
  }
  expect(result.value.slice(0, result.value.indexOf('<g class="sumi-k-n--stack'))).toBe(
    f.svg.slice(0, f.svg.indexOf('<g class="sumi-k-n--stack')),
  );
});

test("empty/tiny/ordinary figures retain the existing fast path and errors", async () => {
  const compiled = tinyCompiled();
  let calls = 0;
  const backend: DiagramBackend = {
    name: "d2-cli",
    render: async () => {
      calls++;
      return { ok: true, value: artifactFor(compiled, tinySvg()), diagnostics: [] };
    },
  };
  const result = await renderFigure("version: 1\nfigure: { id: empty }\n", { backend });
  expect(result.ok).toBe(false);
  expect(calls).toBe(0);
  const f = fixture();
  expect(composeOutlines(f.svg, { ...f.compiled.ir, nodes: [] }, f.inspection)).toEqual({
    ok: true,
    value: f.svg,
    diagnostics: [],
  });
});

test("extension geometry handles nearest intersections and crossing/overlap policy", () => {
  expect(
    rayHit(rectPoints({ x: 0, y: 0, width: 10, height: 10 }), { x: -2, y: 5 }, { x: 1, y: 0 }),
  ).toBe(2);
  expect(extensionsCross({ x: -2, y: 4 }, { x: 14, y: 4 }, { x: 4, y: -2 }, { x: 4, y: 14 })).toBe(
    true,
  );
  expect(extensionsCross({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 }, { x: 15, y: 0 })).toBe(
    true,
  );
  expect(extensionsCross({ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 })).toBe(
    false,
  );
});

test("curved end tangents and untouched marker/mask attributes are preserved", () => {
  const f = fixture(
    raw.replace(
      'd="M -18 4 L -2 4"',
      'd="M -18 4 C -12 4 -6 4 -2 4" marker-end="url(#head)" mask="url(#mask)"',
    ),
  );
  const target = composeOutlines(f.svg, f.compiled.ir, f.inspection);
  if (!target.ok) throw new Error(JSON.stringify(target.diagnostics));
  expect(target.value).toContain(
    'd="M -18 4 C -12 4 10 4 14 4" marker-end="url(#head)" mask="url(#mask)"',
  );

  const reverse = fixture(raw.replace('d="M -18 4 L -2 4"', 'd="M -2 4 C -6 4 -12 4 -18 4"'));
  const edges = reverse.compiled.ir.edges.map((e) =>
    e.key === "e:left" ? { ...e, from: e.to, to: e.from } : e,
  );
  const ir = {
    ...reverse.compiled.ir,
    edges,
    elements: readonlyMap([...reverse.compiled.ir.nodes, ...edges].map((e) => [e.key, e] as const)),
  };
  const start = composeOutlines(reverse.svg, ir, reverse.inspection);
  if (!start.ok) throw new Error(JSON.stringify(start.diagnostics));
  expect(start.value).toContain('d="M 14 4 C 10 4 -12 4 -18 4"');
});

test("backend errors in either pass propagate without output and preserve sourceName", async () => {
  for (const failingCall of [1, 2]) {
    let calls = 0;
    const compiled = fixture().compiled;
    const inputs: string[] = [];
    const backend: DiagramBackend = {
      name: "d2-cli",
      render: async (input) => {
        inputs.push(input.sourceName ?? "");
        calls++;
        return calls === failingCall
          ? {
              ok: false,
              diagnostics: [
                { code: "backend/test-failure", severity: "error", message: "Fixture failure." },
              ],
            }
          : {
              ok: true,
              value: { ...artifactFor(compiled, raw), d2Source: input.d2Source },
              diagnostics: [],
            };
      },
    };
    const result = await renderFigure(source, {
      registry: outlineRegistry(),
      backend,
      sourceName: "fixture.d2",
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toEqual(["backend/test-failure"]);
    expect(calls).toBe(failingCall);
    expect(inputs.every((name) => name === "fixture.d2")).toBe(true);
  }
});
