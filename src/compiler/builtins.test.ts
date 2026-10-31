/**
 * Contracts of the built-in primitive components (#10), checked without D2:
 * each lowers to a standard D2 shape / connection, colors come only from
 * themes, switching themes changes styles but not layout, and misuse is
 * rejected. Rendering with the real D2 CLI is in `builtins-render.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { checkFigure } from "../core/check";
import { BUILTIN_MANIFESTS } from "../core/registry/builtins";
import { BUILTIN_THEME_DEFINITIONS, getTheme } from "../core/theme/builtin";
import { filledToneNode } from "../core/theme/node-variants";
import { KIND_DEFAULTS } from "../core/theme/style";
import { compileFigure, expectD2Figure } from "./compile";
import type { FigureIR } from "./ir";
import {
  primitivesFigure,
  STRUCTURED_ONLY_MANIFESTS,
  structuredPrimitivesFigure,
  writtenComponentOf,
} from "./testing";

/** Design doc §3: the D2 lowering of every built-in component. */
const LOWERING: Record<string, string> = {
  "sumi/box": "rectangle",
  "sumi/square": "square",
  "sumi/circle": "circle",
  "sumi/ellipse": "oval",
  "sumi/diamond": "diamond",
  "sumi/hexagon": "hexagon",
  "sumi/parallelogram": "parallelogram",
  "sumi/cylinder": "cylinder",
  "sumi/document": "document",
  "sumi/trapezoid": "rectangle",
  "sumi/bowtie": "rectangle",
  "sumi/bracket": "rectangle",
  "sumi/stack": "rectangle",
  "sumi/label": "text",
  "sumi/operator": "circle",
  "sumi/junction": "circle",
  "sumi/image": "rectangle",
  // Expanded into a frame group around its entries (#131, structured only).
  "sumi/legend": "rectangle",
  "sumi/container": "rectangle",
  "sumi/arrow": "-> target:triangle",
  "sumi/line": "--",
  "sumi/double-arrow": "<-> source:triangle target:triangle",
  // Two straight lines between corners (#176, structured only).
  "sumi/zoom": "--",
};

/**
 * Components the `check` stages expand into elements of other components,
 * leaving none of their own (#181: a tokens node becomes its cells; #180: a
 * matrix becomes a plain container of labels and boxes). They
 * are traced back through `writtenComponentOf()`.
 */
const EXPANDED_AWAY = ["sumi/tokens", "sumi/matrix"];

function compileAny(source: string) {
  const result = compileFigure(source);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return result.value;
}

const compile = (source: string) => expectD2Figure(compileAny(source));

/** The lowering of each element of compiled figures, by canonical component ID. */
function lowerings(...irs: FigureIR[]): Map<string, Set<string>> {
  const seen = new Map<string, Set<string>>();
  for (const ir of irs) addLowerings(ir, seen);
  return seen;
}

function addLowerings(ir: FigureIR, seen: Map<string, Set<string>>): void {
  const add = (id: string, value: string) => seen.set(id, (seen.get(id) ?? new Set()).add(value));
  for (const n of [...ir.nodes, ...ir.groups]) add(n.component, n.shape);
  const operators = { forward: "->", backward: "<-", both: "<->", none: "--" };
  for (const e of ir.edges) {
    const heads = [
      e.sourceArrowhead && `source:${e.sourceArrowhead}`,
      e.targetArrowhead && `target:${e.targetArrowhead}`,
    ].filter(Boolean);
    add(e.component, [operators[e.direction], ...heads].join(" "));
  }
}

describe("built-in components lower to standard D2 shapes", () => {
  test("the lowering table covers exactly the built-in components", () => {
    expect([...Object.keys(LOWERING), ...EXPANDED_AWAY].sort()).toEqual(
      BUILTIN_MANIFESTS.map((m) => `${m.namespace}/${m.name}`).sort(),
    );
  });

  for (const { id: theme } of BUILTIN_THEME_DEFINITIONS) {
    test(`every component and variant (${theme})`, () => {
      const { ir, d2Source } = compile(primitivesFigure(theme));
      // The components the auto engine cannot draw (#131) are in a structured figure.
      const structured = compileAny(structuredPrimitivesFigure(theme));
      expect(structured.engine).toBe("structured");
      const seen = lowerings(ir, structured.ir);
      expect(Object.fromEntries([...seen].map(([id, values]) => [id, [...values]]))).toEqual(
        Object.fromEntries(Object.entries(LOWERING).map(([id, value]) => [id, [value]])),
      );
      for (const shape of new Set(Object.values(LOWERING))) {
        if (!shape.includes("-")) expect(d2Source).toContain(`shape: ${shape}\n`);
      }
      // Every component × variant is present, so no theme falls back to
      // `default`. A legend's parts are traced back to the legend (#131).
      const written = [ir, structured.ir].flatMap((figure) =>
        [...figure.elements.values()].map((e) => writtenComponentOf(figure, e)),
      );
      for (const m of BUILTIN_MANIFESTS) {
        const id = `${m.namespace}/${m.name}`;
        const variants = [...ir.elements.values(), ...structured.ir.elements.values()]
          .filter((e) => e.component === id)
          .map((e) => e.variant);
        expect(new Set(variants)).toEqual(new Set(EXPANDED_AWAY.includes(id) ? [] : m.variants));
        const traced = written.filter((e) => e.component === id).map((e) => e.variant);
        expect(new Set(traced)).toEqual(new Set(m.variants));
      }
      // Only the components the auto engine cannot draw are left to the structured figure.
      expect(STRUCTURED_ONLY_MANIFESTS.map((m) => m.name)).toEqual([
        "bracket",
        "legend",
        "tokens",
        "matrix",
        "zoom",
      ]);
      expect(ir.elements.size).toBeGreaterThan(0);
      for (const e of ir.elements.values()) {
        expect(e.component).not.toBe("sumi/legend");
        expect(e.component).not.toBe("sumi/zoom");
        expect(e.component).not.toBe("sumi/tokens");
        expect(e.component).not.toBe("sumi/matrix");
      }
    });
  }
});

describe("colors come only from themes", () => {
  const COLOR_LITERAL = /["'`](#[0-9a-f]{3}|#[0-9a-f]{6}|transparent)["'`]/gi;
  const COLOR_FUNCTION = /\b(rgba?|hsla?)\(/gi;
  const NAMED_COLOR =
    /["'`](red|green|blue|black|white|gr[ae]y|orange|yellow|purple|pink|navy|teal)["'`]/gi;

  for (const dir of ["compiler", "core/registry"]) {
    test(`src/${dir} hardcodes no colors`, async () => {
      const root = join(import.meta.dir, "..", dir);
      const files = [...new Bun.Glob("**/*.ts").scanSync(root)].filter(
        // Tests and test support (`testing.ts` patches styles) may use literals.
        (f) => !f.endsWith(".test.ts") && f !== "testing.ts",
      );
      expect(files.length).toBeGreaterThan(0);
      const found: string[] = [];
      for (const file of files) {
        const text = await Bun.file(join(root, file)).text();
        for (const pattern of [COLOR_LITERAL, COLOR_FUNCTION, NAMED_COLOR]) {
          for (const m of text.matchAll(pattern)) found.push(`${file}: ${m[0]}`);
        }
      }
      expect(found).toEqual([]);
    });
  }

  test("every color in the D2 source is a theme token, derived tone ink or a kind default", () => {
    const defaults = Object.values(KIND_DEFAULTS).flatMap((style) => Object.values(style));
    for (const definition of BUILTIN_THEME_DEFINITIONS) {
      const allowed = new Set(
        [...JSON.stringify([definition, defaults]).matchAll(/"(#[0-9a-f]+|transparent)"/gi)].map(
          (m) => (m[1] ?? "").toLowerCase(),
        ),
      );
      const theme = getTheme(definition.id);
      if (!theme) throw new Error(definition.id);
      // New tinted variants derive ink in the theme layer, never in the compiler (#214).
      for (const [tone, layer] of theme.tones) {
        const ink = theme.toneLines.get(tone)?.stroke;
        if (layer.fill !== undefined && ink !== undefined) {
          for (const color of Object.values(filledToneNode("tinted", layer.fill, ink))) {
            if (typeof color === "string") allowed.add(color);
          }
        }
      }
      const { d2Source } = compile(primitivesFigure(definition.id));
      const used = [...d2Source.matchAll(/(?:fill|stroke|font-color): "([^"]*)"/g)].map(
        (m) => m[1],
      );
      expect(used.length).toBeGreaterThan(0);
      for (const color of new Set(used))
        expect({ color, allowed: allowed.has(color ?? "") }).toEqual({ color, allowed: true });
    }
  });
});

describe("the same components under different themes", () => {
  const minimal = compile(primitivesFigure("minimal"));
  const academic = compile(primitivesFigure("academic"));

  test("styles change", () => {
    let changed = 0;
    for (const [key, element] of minimal.ir.elements) {
      const other = academic.ir.elements.get(key);
      expect(other?.kind).toBe(element.kind);
      if (JSON.stringify(other?.style) !== JSON.stringify(element.style)) changed++;
    }
    expect(changed).toBe(minimal.ir.elements.size);
  });

  test("profile-derived layout and structure do not", () => {
    expect(academic.layout).toEqual(minimal.layout);
    expect(academic.ir.meta.profileId).toBe(minimal.ir.meta.profileId);
    expect(academic.ir.meta.direction).toBe(minimal.ir.meta.direction);
    expect(academic.fontSet).toEqual(minimal.fontSet);
    // Only the `style` blocks of the D2 source differ, and the sizes of marks
    // (#92), which follow the theme's font size or stroke width.
    const withoutStyles = (source: string) =>
      source
        .replace(/^( *)style: \{\n[\s\S]*?^\1\}\n/gm, "")
        .replace(/^ *(width|height): \d+\n/gm, "")
        .replace(/^#.*\n/, "");
    expect(withoutStyles(academic.d2Source)).toBe(withoutStyles(minimal.d2Source));
    expect(academic.d2Source).not.toBe(minimal.d2Source);
  });
});

describe("the slides theme with the presentation profile (#36)", () => {
  const presentation = (theme: string) =>
    primitivesFigure(theme).replace("profile: paper-double", "profile: presentation-16x9");

  test("every labeled component × variant passes the profile's font check", () => {
    const { state } = checkFigure(presentation("slides"));
    expect(state.diagnostics).toEqual([]);
    const structured = structuredPrimitivesFigure("slides").replace(
      "profile: paper-double",
      "profile: presentation-16x9",
    );
    expect(checkFigure(structured).state.diagnostics).toEqual([]);
  });

  test("the paper themes are rejected with profile/font-too-small by design", () => {
    for (const theme of ["minimal", "academic"]) {
      const codes = new Set(checkFigure(presentation(theme)).state.diagnostics.map((d) => d.code));
      expect([...codes]).toEqual(["profile/font-too-small"]);
    }
  });
});

describe("misuse of built-in components is rejected", () => {
  const codes = (source: string) =>
    checkFigure(`version: 1\nfigure: { id: f }\n${source}`).state.diagnostics.map((d) => [
      d.code,
      d.path,
    ]);

  test("unknown props on groups and edges (they take none)", () => {
    // Groups have no `props` field at all in the v1 schema.
    expect(codes("groups: [{ id: g, props: { width: 10pt } }]\n")).toEqual([
      ["schema/unknown-field", ["groups", 0, "props"]],
    ]);
    expect(
      codes(
        "nodes: [{ id: a, component: box }]\n" +
          "edges:\n  - { from: a, to: a, component: line, props: { color: red } }\n" +
          "  - { from: a, to: a, props: { width: 1pt } }\n",
      ),
    ).toEqual([
      ["component/unknown-prop", ["edges", 0, "props", "color"]],
      ["component/unknown-prop", ["edges", 1, "props", "width"]],
    ]);
  });

  test("ports are not part of the v1 schema", () => {
    expect(
      codes(
        "nodes: [{ id: a, component: box, ports: [in] }]\n" +
          "edges: [{ from: a, to: a, fromPort: in }]\n",
      ),
    ).toEqual([
      ["schema/unknown-field", ["nodes", 0, "ports"]],
      ["schema/unknown-field", ["edges", 0, "fromPort"]],
    ]);
  });

  test("fixed-aspect components need equal sizes", () => {
    expect(
      codes(
        "nodes:\n  - { id: s, component: square, props: { width: 10pt, height: 20pt } }\n" +
          "  - { id: c, component: circle, props: { width: 10pt, height: 10pt } }\n",
      ),
    ).toEqual([["component/invalid-prop", ["nodes", 0, "props", "height"]]]);
  });

  test("node-only components cannot be used as edges or groups and vice versa", () => {
    expect(
      codes(
        "groups: [{ id: g, component: box }]\n" +
          "nodes: [{ id: a, component: container }]\n" +
          "edges: [{ from: a, to: a, component: diamond }]\n",
      ),
    ).toEqual([
      ["component/wrong-kind", ["groups", 0, "component"]],
      ["component/wrong-kind", ["nodes", 0, "component"]],
      ["component/wrong-kind", ["edges", 0, "component"]],
    ]);
  });
});
