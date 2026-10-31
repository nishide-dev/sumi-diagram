import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { BUILTIN_OUTLINE_RENDERERS } from "../outline";
import { createBuiltinRegistry } from "./builtins";
import { buildCatalog } from "./catalog";
import type { ComponentManifest, NodeManifest, OutlineRender } from "./manifest";
import { Registry } from "./registry";

const manifest = (render?: OutlineRender, overrides: Partial<NodeManifest> = {}): NodeManifest => ({
  version: 1,
  kind: "node",
  namespace: "example",
  name: "custom-outline",
  description: "A node for testing outline metadata.",
  since: "0.2.0",
  shape: "rectangle",
  sizing: "auto",
  props: z.strictObject({}),
  variants: ["default"],
  ...(render !== undefined && { render }),
  ...overrides,
});

describe("outline manifests", () => {
  test("normalizes defaults without modifying the supplied manifest", () => {
    const r = new Registry();
    const original = manifest({ type: "outline", renderer: "sumi/stack", params: { layers: 2 } });
    const result = r.register(original);
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    const normalized = r.get("example/custom-outline");
    expect(normalized?.kind === "node" && normalized.render).toEqual({
      type: "outline",
      renderer: "sumi/stack",
      params: { layers: 2, offset: 8 },
    });
    expect(original.render?.params).toEqual({ layers: 2 });
    expect(buildCatalog(r).components[0]).toEqual(
      expect.objectContaining({
        render: { type: "outline", renderer: "sumi/stack", params: { layers: 2, offset: 8 } },
      }),
    );
    expect(JSON.parse(JSON.stringify(buildCatalog(r)))).toEqual(buildCatalog(r));
  });

  test("accepts all bundled renderers with omitted params", () => {
    for (const renderer of BUILTIN_OUTLINE_RENDERERS.values()) {
      const r = new Registry();
      expect(r.register(manifest({ type: "outline", renderer: renderer.id })).ok).toBe(true);
      expect(buildCatalog(r).components[0]).toHaveProperty(
        "render.params",
        renderer.params.parse({}),
      );
    }
  });

  const invalid: [string, ComponentManifest, (string | number)[]][] = [
    [
      "unknown renderer",
      manifest({ type: "outline", renderer: "other/missing" }),
      ["render", "renderer"],
    ],
    ["short renderer ID", manifest({ type: "outline", renderer: "stack" }), ["render", "renderer"]],
    [
      "wrong render type",
      manifest({ type: "svg", renderer: "sumi/stack" } as never),
      ["render", "type"],
    ],
    [
      "non-rectangle placeholder",
      manifest({ type: "outline", renderer: "sumi/stack" }, { shape: "oval" }),
      ["shape"],
    ],
    [
      "fixed aspect",
      manifest({ type: "outline", renderer: "sumi/stack" }, { sizing: "fixed-aspect-1" }),
      ["sizing"],
    ],
    [
      "unknown param",
      manifest({ type: "outline", renderer: "sumi/stack", params: { unknown: 1 } }),
      ["render", "params"],
    ],
    [
      "fractional layer count",
      manifest({ type: "outline", renderer: "sumi/stack", params: { layers: 2.5 } }),
      ["render", "params", "layers"],
    ],
    [
      "empty layer count",
      manifest({ type: "outline", renderer: "sumi/stack", params: { layers: 0 } }),
      ["render", "params", "layers"],
    ],
    [
      "too many layers",
      manifest({ type: "outline", renderer: "sumi/stack", params: { layers: 9 } }),
      ["render", "params", "layers"],
    ],
    [
      "wrong param type",
      manifest({ type: "outline", renderer: "sumi/stack", params: { offset: "8" } }),
      ["render", "params", "offset"],
    ],
    [
      "zero offset",
      manifest({ type: "outline", renderer: "sumi/stack", params: { offset: 0 } }),
      ["render", "params", "offset"],
    ],
    [
      "infinite param",
      manifest({ type: "outline", renderer: "sumi/stack", params: { offset: Infinity } }),
      ["render", "params", "offset"],
    ],
    [
      "nested params",
      manifest({ type: "outline", renderer: "sumi/stack", params: { offset: {} } } as never),
      ["render", "params", "offset"],
    ],
    [
      "out-of-range slant",
      manifest({ type: "outline", renderer: "sumi/trapezoid", params: { slant: -0.1 } }),
      ["render", "params", "slant"],
    ],
    [
      "render on a group",
      {
        ...createBuiltinRegistry().get("sumi/container"),
        render: { type: "outline", renderer: "sumi/stack" },
      } as never,
      [],
    ],
    [
      "render on an edge",
      {
        ...createBuiltinRegistry().get("sumi/arrow"),
        render: { type: "outline", renderer: "sumi/stack" },
      } as never,
      [],
    ],
  ];
  test.each(invalid)("rejects %s as an invalid manifest", (_, m, path) => {
    const r = new Registry();
    const result = r.register(m);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((d) => [d.code, d.severity, d.path])).toEqual([
      ["component/invalid-manifest", "error", path],
    ]);
    expect(r.list()).toEqual([]);
  });

  test("a rejected manifest does not reserve its ID", () => {
    const r = new Registry();
    expect(r.register(manifest({ type: "outline", renderer: "other/missing" })).ok).toBe(false);
    expect(r.register(manifest({ type: "outline", renderer: "sumi/trapezoid" })).ok).toBe(true);
  });

  test("legacy manifests and ordinary built-in catalog entries have no render field", () => {
    const r = new Registry();
    const original = manifest();
    expect(r.register(original)).toEqual({ ok: true, value: original, diagnostics: [] });
    expect(buildCatalog(r).components[0]).not.toHaveProperty("render");
    for (const entry of buildCatalog(createBuiltinRegistry()).components) {
      if (
        entry.id !== "sumi/trapezoid" &&
        entry.id !== "sumi/stack" &&
        entry.id !== "sumi/bowtie" &&
        entry.id !== "sumi/waveform"
      )
        expect(entry).not.toHaveProperty("render");
    }
  });
});
