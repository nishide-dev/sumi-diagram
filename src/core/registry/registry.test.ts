import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { BUILTIN_MANIFESTS, createBuiltinRegistry } from "./builtins";
import { buildCatalog } from "./catalog";
import {
  type ComponentManifest,
  componentId,
  type EdgeManifest,
  type NodeManifest,
} from "./manifest";
import { Registry } from "./registry";

const registry = createBuiltinRegistry();

const custom = (overrides: Partial<NodeManifest> = {}): NodeManifest => ({
  version: 1,
  kind: "node",
  namespace: "acme",
  name: "widget",
  description: "A test widget.",
  variants: ["default"],
  props: z.strictObject({ size: z.number().default(3) }),
  since: "0.1.0",
  shape: "rectangle",
  sizing: "auto",
  ...overrides,
});

const codes = (result: { diagnostics: { code: string }[] }) =>
  result.diagnostics.map((d) => d.code);

describe("built-in components", () => {
  test("cover the MVP table in order", () => {
    expect(registry.list().map((m) => [`${m.namespace}/${m.name}`, m.kind])).toEqual([
      ["sumi/box", "node"],
      ["sumi/square", "node"],
      ["sumi/circle", "node"],
      ["sumi/ellipse", "node"],
      ["sumi/diamond", "node"],
      ["sumi/hexagon", "node"],
      ["sumi/parallelogram", "node"],
      ["sumi/cylinder", "node"],
      ["sumi/document", "node"],
      ["sumi/label", "node"],
      ["sumi/container", "group"],
      ["sumi/arrow", "edge"],
      ["sumi/line", "edge"],
      ["sumi/double-arrow", "edge"],
    ]);
  });

  test("carry shapes, sizing, directions and variants", () => {
    const get = (id: string) => registry.get(id);
    expect(get("sumi/ellipse")).toMatchObject({ shape: "oval", sizing: "auto" });
    expect(get("sumi/circle")).toMatchObject({ shape: "circle", sizing: "fixed-aspect-1" });
    expect(get("sumi/label")).toMatchObject({ shape: "text", variants: ["default", "muted"] });
    expect(get("sumi/container")).toMatchObject({ shape: "rectangle" });
    expect(get("sumi/arrow")).toMatchObject({ direction: "forward", head: "triangle" });
    expect(get("sumi/line")).toMatchObject({ direction: "none" });
    expect(get("sumi/double-arrow")).toMatchObject({ direction: "both", tail: "triangle" });
    expect(get("sumi/box")?.variants).toEqual(["default", "emphasis", "muted"]);
    expect(get("sumi/arrow")?.variants).toEqual(["default", "dashed", "emphasis", "muted"]);
  });

  test("each call creates an independent registry", () => {
    const a = createBuiltinRegistry();
    a.register(custom());
    expect(createBuiltinRegistry().get("acme/widget")).toBeUndefined();
  });
});

describe("register", () => {
  test("accepts a valid manifest", () => {
    const r = new Registry();
    const result = r.register(custom());
    expect(result.ok).toBe(true);
    expect(r.get("acme/widget")?.description).toBe("A test widget.");
  });

  test("rejects ID collisions", () => {
    const r = new Registry();
    r.register(custom());
    const again = r.register(custom({ description: "Another." }));
    expect(again).toEqual({
      ok: false,
      diagnostics: [
        {
          code: "component/duplicate-id",
          severity: "error",
          message: "Component acme/widget is already registered.",
        },
      ],
    });
    expect(r.get("acme/widget")?.description).toBe("A test widget.");
  });

  const malformed: [what: string, manifest: ComponentManifest, path: (string | number)[]][] = [
    ["no default variant", custom({ variants: ["main"] }), ["variants"]],
    ["duplicate variants", custom({ variants: ["default", "default"] }), ["variants"]],
    ["an invalid name", custom({ name: "Widget" }), ["name"]],
    ["an empty description", custom({ description: "" }), ["description"]],
    ["an invalid since", custom({ since: "soon" }), ["since"]],
    ["a disallowed shape", custom({ shape: "cloud" as never }), ["shape"]],
    ["a non-strict props object", custom({ props: z.object({}) }), ["props"]],
    ["props that are not an object", custom({ props: z.string() as never }), ["props"]],
    [
      "props not representable as JSON Schema",
      custom({ props: z.strictObject({ at: z.date() }) }),
      ["props"],
    ],
    [
      "a bad deprecation replacement",
      custom({ deprecated: { since: "0.2.0", replacement: "box" } }),
      ["deprecated", "replacement"],
    ],
    [
      "a head on a line without direction",
      { ...(registry.get("sumi/line") as EdgeManifest), namespace: "acme", head: "triangle" },
      ["head"],
    ],
    [
      "a tail on a forward edge",
      { ...(registry.get("sumi/arrow") as EdgeManifest), namespace: "acme", tail: "triangle" },
      ["tail"],
    ],
    ["an unknown field", { ...custom(), ports: [] } as never, []],
  ];
  for (const [what, manifest, path] of malformed) {
    test(`rejects a manifest with ${what}`, () => {
      const result = new Registry().register(manifest);
      expect(result.ok).toBe(false);
      expect(result.diagnostics.map((d) => [d.code, d.path])).toEqual([
        ["component/invalid-manifest", path],
      ]);
      expect(result.diagnostics[0]?.message).toStartWith("Invalid component manifest ");
    });
  }
});

describe("resolve", () => {
  test("resolves short names and canonical IDs to the same manifest", () => {
    const short = registry.resolve("box", "node");
    const canonical = registry.resolve("sumi/box", "node");
    expect(short.ok && canonical.ok && short.value === canonical.value).toBe(true);
  });

  test("does not require a kind", () => {
    expect(registry.resolve("arrow").ok).toBe(true);
  });

  test("short names resolve only in the built-in namespace", () => {
    const r = createBuiltinRegistry();
    r.register(custom());
    expect(r.resolve("acme/widget", "node").ok).toBe(true);
    expect(codes(r.resolve("widget", "node"))).toEqual(["component/unknown"]);
  });

  test("unknown components suggest the closest name of the kind", () => {
    expect(registry.resolve("rectangel", "node").diagnostics).toEqual([
      {
        code: "component/unknown",
        severity: "error",
        message: 'Unknown node component "rectangel".',
        hint: "Known node components: box, square, circle, ellipse, diamond, hexagon, parallelogram, cylinder, document, label.",
      },
    ]);
    expect(registry.resolve("arow", "edge").diagnostics[0]?.hint).toBe('Did you mean "arrow"?');
    expect(registry.resolve("Box", "node").diagnostics[0]?.hint).toBe('Did you mean "box"?');
    expect(registry.resolve("sumi/bx", "node").diagnostics[0]?.hint).toBe(
      'Did you mean "sumi/box"?',
    );
  });

  test("there are no aliases", () => {
    for (const alias of ["rect", "rectangle", "oval", "group", "connector"]) {
      expect(codes(registry.resolve(alias))).toEqual(["component/unknown"]);
    }
  });

  test("a component of another kind is a wrong-kind error", () => {
    expect(registry.resolve("arrow", "node").diagnostics).toEqual([
      {
        code: "component/wrong-kind",
        severity: "error",
        message:
          'Component "arrow" (sumi/arrow) is an edge component, but a node component is required here.',
        hint: "Known node components: box, square, circle, ellipse, diamond, hexagon, parallelogram, cylinder, document, label.",
      },
    ]);
    expect(codes(registry.resolve("container", "node"))).toEqual(["component/wrong-kind"]);
  });

  test("deprecated components resolve with a warning", () => {
    const r = new Registry();
    r.register(custom({ deprecated: { since: "0.2.0", replacement: "acme/gadget" } }));
    const result = r.resolve("acme/widget", "node");
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([
      {
        code: "component/deprecated",
        severity: "warning",
        message: "Component acme/widget is deprecated since Sumi 0.2.0.",
        hint: 'Use "acme/gadget" instead.',
      },
    ]);
  });
});

describe("list", () => {
  test("filters by kind", () => {
    expect(registry.list({ kind: "group" }).map((m) => m.name)).toEqual(["container"]);
    expect(registry.list({ kind: "edge" }).map((m) => m.name)).toEqual([
      "arrow",
      "line",
      "double-arrow",
    ]);
    expect(registry.list()).toHaveLength(BUILTIN_MANIFESTS.length);
  });
});

describe("validateUsage", () => {
  const box = registry.get("sumi/box") as ComponentManifest;
  const circle = registry.get("sumi/circle") as ComponentManifest;
  const arrow = registry.get("sumi/arrow") as ComponentManifest;

  test("defaults to the default variant and no props", () => {
    expect(registry.validateUsage(box)).toEqual({
      ok: true,
      value: { variant: "default", props: {} },
      diagnostics: [],
    });
  });

  test("normalizes lengths to pt", () => {
    const result = registry.validateUsage(box, {
      props: { width: 40, height: "10mm" },
      variant: "muted",
    });
    expect(result.ok && result.value.variant).toBe("muted");
    expect(result.ok && result.value.props.width).toBe(40);
    expect(result.ok && result.value.props.height).toBeCloseTo(28.3465, 4);
    const units = ["2.5pt", "1cm", "1in"].map((width) => {
      const r = registry.validateUsage(box, { props: { width } });
      return r.ok ? r.value.props.width : undefined;
    });
    expect(units[0]).toBe(2.5);
    expect(units[1]).toBeCloseTo(28.3465, 4);
    expect(units[2]).toBe(72);
  });

  test("applies manifest defaults", () => {
    const widget = custom();
    expect(new Registry().validateUsage(widget, { props: {} })).toMatchObject({
      ok: true,
      value: { props: { size: 3 } },
    });
  });

  test("unknown variants suggest the closest variant", () => {
    const [d] = registry.validateUsage(box, { variant: "mutted" }).diagnostics;
    expect(d).toEqual({
      code: "component/unknown-variant",
      severity: "error",
      message: 'Unknown variant "mutted" for sumi/box.',
      path: ["variant"],
      hint: 'Did you mean "muted"?',
    });
    expect(registry.validateUsage(box, { variant: "loud" }).diagnostics[0]?.hint).toBe(
      "Variants of sumi/box: default, emphasis, muted.",
    );
  });

  test("unknown props suggest the closest prop", () => {
    const result = registry.validateUsage(box, { props: { widht: 1, colour: "red" } });
    expect(result.diagnostics.map((d) => [d.code, d.path, d.hint])).toEqual([
      ["component/unknown-prop", ["props", "widht"], 'Did you mean "width"?'],
      ["component/unknown-prop", ["props", "colour"], "Props of sumi/box: width, height."],
    ]);
    expect(registry.validateUsage(arrow, { props: { width: 1 } }).diagnostics[0]?.hint).toBe(
      "sumi/arrow takes no props.",
    );
  });

  const invalidLengths: unknown[] = ["40px", "-4mm", 0, -1, "0pt", true, "", "4 mm"];
  for (const width of invalidLengths) {
    test(`rejects the width ${JSON.stringify(width)}`, () => {
      expect(registry.validateUsage(box, { props: { width } }).diagnostics).toEqual([
        {
          code: "component/invalid-prop",
          severity: "error",
          message:
            'Invalid prop "width" for sumi/box: expected a positive length such as 40, "40pt" or "15mm".',
          path: ["props", "width"],
        },
      ]);
    });
  }

  test("fixed-aspect components need equal width and height", () => {
    expect(registry.validateUsage(circle, { props: { width: "1in", height: 72 } }).ok).toBe(true);
    expect(registry.validateUsage(circle, { props: { width: 10, height: 20 } })).toEqual({
      ok: false,
      diagnostics: [
        {
          code: "component/invalid-prop",
          severity: "error",
          message:
            'Invalid prop "height" for sumi/circle: width and height must be equal for a fixed aspect ratio.',
          path: ["props", "height"],
        },
      ],
    });
  });

  test("props that are not a mapping are invalid", () => {
    expect(codes(registry.validateUsage(box, { props: [] }))).toEqual(["component/invalid-prop"]);
  });

  test("reports variant and prop errors together", () => {
    expect(codes(registry.validateUsage(box, { variant: "x", props: { y: 1 } }))).toEqual([
      "component/unknown-variant",
      "component/unknown-prop",
    ]);
  });
});

describe("catalog", () => {
  const catalog = buildCatalog(registry);

  test("is JSON-serializable", () => {
    expect(JSON.parse(JSON.stringify(catalog))).toEqual(catalog);
  });

  test("lists every component with canonical IDs", () => {
    expect(catalog.version).toBe(1);
    expect(catalog.components.map((c) => c.id)).toEqual(registry.list().map(componentId));
  });

  test("node entries describe props as JSON Schema", () => {
    const box = catalog.components.find((c) => c.id === "sumi/box");
    expect(box).toEqual({
      id: "sumi/box",
      kind: "node",
      namespace: "sumi",
      name: "box",
      description: "A rectangle; the general-purpose node.",
      variants: ["default", "emphasis", "muted"],
      since: "0.1.0",
      shape: "rectangle",
      sizing: "auto",
      props: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: {
          width: {
            description: expect.stringContaining("Explicit width"),
            anyOf: [
              { type: "number" },
              { type: "string", pattern: "^(\\d+(?:\\.\\d+)?)(pt|mm|cm|in)$" },
            ],
          },
          height: expect.objectContaining({ anyOf: expect.any(Array) }),
        },
        additionalProperties: false,
      },
    });
  });

  test("edge entries carry direction and arrowheads", () => {
    const [arrow, line, double] = buildCatalog(registry, { kind: "edge" }).components;
    expect(arrow).toMatchObject({ id: "sumi/arrow", direction: "forward", head: "triangle" });
    expect(line).toMatchObject({ id: "sumi/line", direction: "none" });
    expect(line).not.toHaveProperty("head");
    expect(double).toMatchObject({ direction: "both", head: "triangle", tail: "triangle" });
    expect(arrow?.props).toEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {},
      additionalProperties: false,
    });
  });

  test("defaults appear in the props schema", () => {
    const r = new Registry();
    r.register(custom());
    expect(buildCatalog(r).components[0]?.props.properties).toEqual({
      size: { type: "number", default: 3 },
    });
  });
});
