import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { checkFigure } from "../core/check";
import { compileFigure } from "./compile";
import { generateD2 } from "./d2";
import { buildFigureIR, type FigureIR } from "./ir";
import { FIXTURES_DIR } from "./testing";

async function irOf(fixture: string): Promise<FigureIR> {
  const result = compileFigure(await Bun.file(join(FIXTURES_DIR, fixture)).text(), {
    file: fixture,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return result.value.ir;
}

describe("buildFigureIR", () => {
  test("normalizes the design doc example", async () => {
    const ir = await irOf("figures/valid/full.sumi.yaml");
    expect(ir.meta).toEqual({
      id: "request-pipeline",
      themeId: "minimal",
      profileId: "paper-single",
      direction: "right",
      fontSetId: "sumi/biz-ud-gothic",
    });
    expect(ir.roots).toEqual(["g:backend", "n:client"]);
    const [backend] = ir.groups;
    expect(backend).toMatchObject({
      key: "g:backend",
      kind: "group",
      id: "backend",
      label: "Backend",
      component: "sumi/container",
      variant: "default",
      d2Key: "g_backend",
      d2Path: ["g_backend"],
      children: ["n:api", "n:auth", "n:db"],
    });
    expect(backend?.parent).toBeUndefined();
    expect(ir.elements.get("n:db")).toMatchObject({
      kind: "node",
      label: "Database\n(primary)",
      component: "sumi/cylinder",
      variant: "muted",
      shape: "cylinder",
      sizing: "auto",
      parent: "g:backend",
      d2Path: ["g_backend", "n_db"],
      style: { kind: "node", stroke: "#6e7781", fontSize: { pt: 8, units: 16 } },
    });
    expect(ir.edges.map((e) => [e.key, e.from, e.to, e.direction, e.targetArrowhead])).toEqual([
      ["e:#0", "n:client", "n:api", "forward", "triangle"],
      ["e:#1", "n:api", "n:auth", "forward", "triangle"],
      ["e:#2", "n:auth", "n:db", "forward", "triangle"],
    ]);
    expect(ir.edges[2]?.style).toMatchObject({ kind: "edge", strokeDash: 4, filled: true });
    expect(ir.edges[0]?.sourceArrowhead).toBeUndefined();
  });

  test("builds the group tree in document order", async () => {
    const ir = await irOf("compile/structure.sumi.yaml");
    expect(ir.roots).toEqual(["g:outer", "g:side", "n:x-", "n:free"]);
    const tree = Object.fromEntries(ir.groups.map((g) => [g.id, [g.parent, g.children]]));
    expect(tree).toEqual({
      inner: ["g:middle", ["n:deep"]],
      outer: [undefined, ["g:middle"]],
      middle: ["g:outer", ["g:inner", "n:a--b"]],
      side: [undefined, ["n:lonely"]],
    });
    expect(ir.elements.get("n:deep")).toMatchObject({
      d2Path: ["g_outer", "g_middle", "g_inner", "n_deep"],
    });
    // Edges to groups and between ancestors and descendants keep their endpoint kinds.
    const edges = Object.fromEntries(ir.edges.map((e) => [e.key, [e.from, e.to, e.direction]]));
    expect(edges).toMatchObject({
      "e:twin-1": ["n:x-", "n:a--b", "forward"],
      "e:twin-2": ["n:x-", "n:a--b", "none"],
      "e:#3": ["n:x-", "n:x-", "forward"],
      "e:#4": ["g:side", "g:side", "both"],
      "e:#5": ["g:outer", "n:deep", "forward"],
    });
    const both = ir.elements.get("e:#4");
    expect(both).toMatchObject({ sourceArrowhead: "triangle", targetArrowhead: "triangle" });
    const line = ir.elements.get("e:twin-2");
    expect(line).not.toHaveProperty("sourceArrowhead");
    expect(line).not.toHaveProperty("targetArrowhead");
    expect(ir.elements.get("e:twin-1")).toMatchObject({ id: "twin-1", index: 1 });
  });

  test("converts explicit sizes to D2 units", async () => {
    const ir = await irOf("figures/valid/components.sumi.yaml");
    expect(ir.elements.get("n:box")).toMatchObject({
      width: { pt: 40, units: 80 },
      height: { pt: 36, units: 72 },
    });
    expect(ir.elements.get("n:square")).toMatchObject({
      sizing: "fixed-aspect-1",
      width: { pt: 72, units: 144 },
      height: { pt: 72, units: 144 },
    });
    expect(ir.elements.get("n:circle")).not.toHaveProperty("width");
  });

  test("maps every element to its document path and source location", async () => {
    const ir = await irOf("figures/valid/full.sumi.yaml");
    expect([...ir.sourceMap.keys()].sort()).toEqual([...ir.elements.keys()].sort());
    expect(ir.sourceMap.get("g:backend")).toMatchObject({
      path: ["groups", 0],
      location: { file: "figures/valid/full.sumi.yaml", line: 10, column: 5 },
    });
    expect(ir.sourceMap.get("n:auth")).toMatchObject({
      path: ["nodes", 2],
      location: { line: 21, column: 5 },
    });
    expect(ir.sourceMap.get("e:#2")).toMatchObject({
      path: ["edges", 2],
      location: { line: 37, column: 5 },
    });
  });

  test("is immutable", async () => {
    const ir = await irOf("compile/structure.sumi.yaml");
    expect(Object.isFrozen(ir)).toBe(true);
    expect(Object.isFrozen(ir.meta)).toBe(true);
    expect(Object.isFrozen(ir.groups)).toBe(true);
    expect(Object.isFrozen(ir.nodes)).toBe(true);
    expect(Object.isFrozen(ir.edges)).toBe(true);
    for (const element of ir.elements.values()) {
      expect(Object.isFrozen(element)).toBe(true);
      expect(Object.isFrozen(element.style)).toBe(true);
      if (element.kind !== "edge") expect(Object.isFrozen(element.d2Path)).toBe(true);
      if (element.kind === "group") expect(Object.isFrozen(element.children)).toBe(true);
    }
    for (const entry of ir.sourceMap.values()) {
      expect(Object.isFrozen(entry)).toBe(true);
      expect(Object.isFrozen(entry.path)).toBe(true);
      expect(Object.isFrozen(entry.location)).toBe(true);
    }
  });

  test("rejects mutation of its maps and source map", async () => {
    const ir = await irOf("compile/structure.sumi.yaml");
    const before = generateD2(ir);
    for (const map of [ir.elements, ir.sourceMap]) {
      // Only the reading methods exist; the backing Map is private.
      const mutable = map as unknown as Partial<Map<unknown, unknown>>;
      expect(map).not.toBeInstanceOf(Map);
      expect(mutable.set).toBeUndefined();
      expect(mutable.delete).toBeUndefined();
      expect(mutable.clear).toBeUndefined();
      expect(() => Object.assign(map, { get: () => undefined })).toThrow(TypeError);
      expect(Object.getOwnPropertyNames(map)).toEqual([]);
    }
    const entry = ir.sourceMap.get("n:deep");
    if (!entry?.location) throw new Error("expected a location");
    const location = entry.location as { line: number };
    expect(() => {
      location.line = 0;
    }).toThrow(TypeError);
    expect(() => (entry.path as (string | number)[]).push("x")).toThrow(TypeError);
    expect(generateD2(ir)).toBe(before);
    expect(ir.elements.size).toBe(17);
    expect([...ir.elements.keys()]).toEqual([...ir.sourceMap.keys()]);
  });

  test("refuses a check with errors", async () => {
    const check = checkFigure(
      "version: 1\nfigure: { id: x }\nnodes:\n  - { id: a, component: nope }\n",
    );
    expect(() => buildFigureIR(check)).toThrow(/errors/);
  });
});
