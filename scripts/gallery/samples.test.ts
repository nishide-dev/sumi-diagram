/**
 * The gallery's sample figures (#17) without D2: every catalog component has
 * one, it shows every variant, and it compiles cleanly under every built-in
 * theme. `bun run gallery:check` (CI) covers the rendered output.
 */

import { describe, expect, test } from "bun:test";
import { compileFigure } from "../../src/compiler/compile";
import { createBuiltinRegistry } from "../../src/core/registry/builtins";
import { buildCatalog } from "../../src/core/registry/catalog";
import { comparison, componentSamples, PROFILES, THEMES } from "./samples";

const samples = componentSamples();

test("every catalog component has a sample, in catalog order", () => {
  expect(samples.map((s) => s.entry.id)).toEqual(
    buildCatalog(createBuiltinRegistry()).components.map((c) => c.id),
  );
});

describe("component samples", () => {
  for (const sample of samples) {
    test(`${sample.entry.id} compiles without diagnostics under every theme`, () => {
      expect(sample.renderings.map((r) => r.theme)).toEqual([...THEMES]);
      for (const rendering of sample.renderings) {
        const compiled = compileFigure(sample.source, { overrides: rendering.overrides });
        if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics, null, 2));
        expect(compiled.diagnostics).toEqual([]);
        expect(compiled.value.ir.meta.themeId).toBe(rendering.theme);
        // Every variant appears, and only elements of this component carry a variant.
        const used = new Set(
          [...compiled.value.ir.elements.values()]
            .filter((e) => e.component === sample.entry.id)
            .map((e) => e.variant),
        );
        expect([...used].sort()).toEqual([...sample.entry.variants].sort());
      }
    });
  }
});

test("the comparison covers every theme × profile through overrides", () => {
  const { renderings } = comparison();
  expect(renderings).toHaveLength(THEMES.length * PROFILES.length);
  for (const r of renderings) expect(r.overrides).toEqual({ theme: r.theme, profile: r.profile });
  expect(new Set(renderings.map((r) => r.output)).size).toBe(renderings.length);
});
