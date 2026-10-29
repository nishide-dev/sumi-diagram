import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  BUILTIN_MANIFESTS,
  builtinRegistry,
  createBuiltinRegistry,
  OPERATOR_GLYPHS,
} from "./builtins";
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
      ["sumi/trapezoid", "node"],
      ["sumi/bowtie", "node"],
      ["sumi/stack", "node"],
      ["sumi/label", "node"],
      ["sumi/operator", "node"],
      ["sumi/junction", "node"],
      ["sumi/image", "node"],
      ["sumi/legend", "node"],
      ["sumi/tokens", "node"],
      ["sumi/matrix", "node"],
      ["sumi/container", "group"],
      ["sumi/arrow", "edge"],
      ["sumi/line", "edge"],
      ["sumi/double-arrow", "edge"],
      ["sumi/zoom", "edge"],
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
    expect(get("sumi/box")?.variants).toEqual([
      "default",
      "emphasis",
      "muted",
      "filled",
      "outlined",
      "solid",
      "tinted",
    ]);
    expect(get("sumi/arrow")?.variants).toEqual(["default", "dashed", "emphasis", "muted"]);
  });

  test("each call creates an independent registry", () => {
    const a = createBuiltinRegistry();
    a.register(custom());
    expect(createBuiltinRegistry().get("acme/widget")).toBeUndefined();
  });
});

describe("builtinRegistry", () => {
  test("is one shared registry with the built-in components", () => {
    const shared = builtinRegistry();
    expect(builtinRegistry()).toBe(shared);
    expect(shared.list().map(componentId)).toEqual(registry.list().map(componentId));
    expect(shared.list()).toEqual(registry.list());
  });

  test("is sealed: registering throws and leaves it unchanged", () => {
    const shared = builtinRegistry();
    expect(shared.sealed).toBe(true);
    expect(() => shared.register(custom())).toThrow("sealed");
    expect(shared.get("acme/widget")).toBeUndefined();
  });

  test("its manifests are deep-frozen except the props schema", () => {
    const box = builtinRegistry().get("sumi/box");
    const operator = builtinRegistry().get("sumi/operator");
    const trapezoid = builtinRegistry().get("sumi/trapezoid");
    if (box === undefined || operator?.kind !== "node" || trapezoid?.kind !== "node") {
      throw new Error("missing built-ins");
    }
    if (operator.mark?.type !== "glyph" || trapezoid.render === undefined) {
      throw new Error("built-ins lack the mark or render under test");
    }
    expect(Object.isFrozen(box)).toBe(true);
    expect(Object.isFrozen(box.variants)).toBe(true);
    expect(Object.isFrozen(operator.mark)).toBe(true);
    expect(Object.isFrozen(operator.mark.glyphs)).toBe(true);
    expect(Object.isFrozen(trapezoid.render)).toBe(true);
    expect(Object.isFrozen(trapezoid.render.params)).toBe(true);
    expect(Object.isFrozen(box.props)).toBe(false);
    expect(() => box.variants.push("extra")).toThrow();
    expect(() => {
      (box as { description: string }).description = "changed";
    }).toThrow();
    expect(builtinRegistry().get("sumi/box")?.variants).toEqual([
      "default",
      "emphasis",
      "muted",
      "filled",
      "outlined",
      "solid",
      "tinted",
    ]);
  });

  test("does not freeze fresh registries or the source manifests", () => {
    builtinRegistry();
    const fresh = createBuiltinRegistry();
    expect(fresh.sealed).toBe(false);
    const box = fresh.get("sumi/box");
    const operator = fresh.get("sumi/operator");
    if (box === undefined || operator?.kind !== "node" || operator.mark?.type !== "glyph") {
      throw new Error("missing built-ins");
    }
    expect(Object.isFrozen(box)).toBe(false);
    expect(Object.isFrozen(box.variants)).toBe(false);
    expect(Object.isFrozen(operator.mark.glyphs)).toBe(false);
    expect(Object.isFrozen(OPERATOR_GLYPHS)).toBe(false);
    for (const m of BUILTIN_MANIFESTS) {
      expect(Object.isFrozen(m)).toBe(false);
      expect(Object.isFrozen(m.variants)).toBe(false);
    }
    expect(fresh.register(custom()).ok).toBe(true);
  });
});

describe("seal", () => {
  test("returns the registry and blocks later registration", () => {
    const r = new Registry();
    r.register(custom());
    expect(r.seal()).toBe(r);
    expect(r.sealed).toBe(true);
    expect(() => r.register(custom({ name: "gadget" }))).toThrow("sealed");
    expect(r.list().map(componentId)).toEqual(["acme/widget"]);
  });

  test("freezes a custom manifest's deprecation", () => {
    const r = new Registry();
    const registered = r.register(
      custom({ deprecated: { since: "0.2.0", replacement: "acme/gadget" } }),
    );
    expect(registered.ok).toBe(true);
    r.seal();
    const deprecated = r.get("acme/widget")?.deprecated;
    expect(deprecated).toEqual({ since: "0.2.0", replacement: "acme/gadget" });
    expect(Object.isFrozen(deprecated)).toBe(true);
  });

  test("freezes children of objects that were already shallow-frozen", () => {
    const r = createBuiltinRegistry();
    const operator = r.get("sumi/operator");
    if (operator?.kind !== "node" || operator.mark?.type !== "glyph") {
      throw new Error("missing built-ins");
    }
    Object.freeze(operator.mark);
    expect(Object.isFrozen(operator.mark.glyphs)).toBe(false);
    r.seal();
    expect(Object.isFrozen(operator.mark.glyphs)).toBe(true);
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
    ["a circle without a fixed aspect", custom({ shape: "circle" }), ["sizing"]],
    ["a square without a fixed aspect", custom({ shape: "square" }), ["sizing"]],
    ["a fixed aspect on another shape", custom({ sizing: "fixed-aspect-1" }), ["sizing"]],
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
        hint: "Known node components: box, square, circle, ellipse, diamond, hexagon, parallelogram, cylinder, document, trapezoid, bowtie, stack, label, operator, junction, image, legend, tokens, matrix.",
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
        hint: "Known node components: box, square, circle, ellipse, diamond, hexagon, parallelogram, cylinder, document, trapezoid, bowtie, stack, label, operator, junction, image, legend, tokens, matrix.",
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
      "zoom",
    ]);
    expect(registry.list()).toHaveLength(BUILTIN_MANIFESTS.length);
  });
});

describe("zoom edges (#176)", () => {
  const zoom = registry.get("sumi/zoom") as EdgeManifest;
  const customZoom = (overrides: Partial<EdgeManifest> = {}): EdgeManifest => ({
    ...zoom,
    namespace: "acme",
    ...overrides,
  });

  test("sumi/zoom has no arrows, is structured only and routed by corners", () => {
    expect(zoom).toMatchObject({
      kind: "edge",
      direction: "none",
      routing: "zoom",
      engines: ["structured"],
      variants: ["default", "solid", "muted"],
    });
    expect(new Registry().register(customZoom()).ok).toBe(true);
  });

  test("a zoom manifest needs direction none and the structured engine only", () => {
    for (const overrides of [
      { direction: "forward", head: "triangle" },
      { engines: undefined },
      { engines: ["structured", "auto"] },
    ] as Partial<EdgeManifest>[]) {
      const result = new Registry().register(customZoom(overrides));
      expect(result.ok).toBe(false);
      expect(codes(result)).toEqual(["component/invalid-manifest"]);
    }
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

  test("parses sizes to pt", () => {
    const result = registry.validateUsage(box, {
      props: { width: "40pt", height: "0.5in" },
      variant: "muted",
    });
    expect(result).toEqual({
      ok: true,
      value: { variant: "muted", props: { width: 40, height: 36 } },
      diagnostics: [],
    });
    const widths = ["2.5pt", "2.54cm", "25.4mm", "1in"].map((width) => {
      const r = registry.validateUsage(box, { props: { width } });
      return r.ok ? r.value.props.width : undefined;
    });
    expect(widths).toEqual([2.5, 72, 72, 72]);
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
      "Variants of sumi/box: default, emphasis, muted, filled, outlined, solid, tinted.",
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

  const invalidSizes: [width: unknown, message: string, hint?: string][] = [
    [40, "Expected a length with a unit, got the number 40", 'Add a unit, e.g. "40mm" or "40pt".'],
    ["40", 'Missing unit in length "40"', 'Add a unit, e.g. "40mm" or "40pt".'],
    ["40px", 'Unsupported unit "px" in "40px"; pixel sizes depend on the display'],
    ["4 mm", 'Invalid length "4 mm"; whitespace is not allowed', 'Write "4mm".'],
    [true, 'Expected a length such as "2mm", got a boolean'],
    ["-4mm", 'Size "-4mm" must be positive'],
    ["0pt", 'Size "0pt" must be positive'],
    [
      "15mm",
      'Size "15mm" (42.52pt) is not a multiple of 0.5pt, the D2 unit',
      'The nearest valid size is "42.5pt".',
    ],
    [
      "0.1pt",
      'Size "0.1pt" (0.1pt) is not a multiple of 0.5pt, the D2 unit',
      'The nearest valid size is "0.5pt".',
    ],
  ];
  for (const [width, message, hint] of invalidSizes) {
    test(`rejects the width ${JSON.stringify(width)}`, () => {
      const [d, ...rest] = registry.validateUsage(box, { props: { width } }).diagnostics;
      expect(rest).toEqual([]);
      expect(d).toMatchObject({
        code: "component/invalid-prop",
        severity: "error",
        message: `Invalid prop "width" for sumi/box: ${message}.`,
        path: ["props", "width"],
      });
      if (hint !== undefined) expect(d?.hint).toBe(hint);
    });
  }

  test("fixed-aspect components need equal width and height, compared exactly", () => {
    // 2.54cm is exactly 72pt, though 2.54 * 3600 / 127 is not 72 in floating point.
    expect(registry.validateUsage(circle, { props: { width: "1in", height: "2.54cm" } }).ok).toBe(
      true,
    );
    expect(registry.validateUsage(circle, { props: { width: "10pt", height: "20pt" } })).toEqual({
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
      variants: ["default", "emphasis", "muted", "filled", "outlined", "solid", "tinted"],
      since: "0.1.0",
      shape: "rectangle",
      sizing: "auto",
      props: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: {
          width: {
            description: expect.stringContaining("Explicit width"),
            type: "string",
            pattern: "^\\d+(\\.\\d+)?(mm|cm|in|pt)$",
          },
          height: expect.objectContaining({ type: "string" }),
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
