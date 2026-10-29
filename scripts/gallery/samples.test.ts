/**
 * The gallery's sample figures (#17) without D2: every catalog component has
 * one, it shows every variant, and it compiles cleanly under every built-in
 * theme. `bun run gallery:check` (CI) covers the rendered output.
 */

import { describe, expect, test } from "bun:test";
import { compileFigure } from "../../src/compiler/compile";
import { writtenComponentOf } from "../../src/compiler/testing";
import { createBuiltinRegistry } from "../../src/core/registry/builtins";
import { buildCatalog } from "../../src/core/registry/catalog";
import { lintFigure } from "../../src/lint/lint";
import {
  comparison,
  componentSamples,
  dimSample,
  filledToneSample,
  outlinedToneSample,
  PROFILES,
  SAMPLE_PROFILE,
  THEMES,
  toneSample,
  WIDE_SAMPLE_PROFILE,
} from "./samples";

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
        // A component the auto engine cannot draw (#131) gets a structured sample.
        const { engines } = sample.entry;
        expect(compiled.value.engine).toBe(
          (engines === undefined || engines.includes("auto")) &&
            !(
              sample.entry.kind === "node" &&
              sample.entry.mark === undefined &&
              sample.entry.embed === undefined &&
              sample.entry.variants.includes("solid")
            )
            ? "auto"
            : "structured",
        );
        // Every variant appears, and only elements of this component carry a
        // variant. Elements a legend was expanded into (#131) count as the
        // legend: each is traced back to it, and none is left untraced.
        const { ir } = compiled.value;
        const used = new Set(
          [...ir.elements.values()]
            .map((e) => writtenComponentOf(ir, e))
            .filter((e) => e.component === sample.entry.id)
            .map((e) => e.variant),
        );
        expect([...used].sort()).toEqual([...sample.entry.variants].sort());
      }
    });
  }
});

test("only slides rows of more than three node or group variants use the wide profile (#174)", () => {
  const wide = samples
    .filter((s) => s.renderings.some((r) => r.profile !== SAMPLE_PROFILE))
    .map((s) => s.entry.id);
  expect(wide).toEqual([
    "sumi/box",
    "sumi/square",
    "sumi/circle",
    "sumi/ellipse",
    "sumi/diamond",
    "sumi/hexagon",
    "sumi/parallelogram",
    "sumi/cylinder",
    "sumi/document",
    "sumi/trapezoid",
    // Six variants with solid and tinted (#214).
    "sumi/stack",
    "sumi/container",
  ]);
  for (const sample of samples) {
    for (const r of sample.renderings) {
      const wideRendering = r.profile === WIDE_SAMPLE_PROFILE;
      expect(wideRendering ? r.theme : "").toBe(wideRendering ? "slides" : "");
      expect(r.overrides.profile).toBe(wideRendering ? WIDE_SAMPLE_PROFILE : undefined);
    }
  }
});

test("the comparison covers every theme × profile through overrides", () => {
  const { renderings } = comparison();
  expect(renderings).toHaveLength(THEMES.length * PROFILES.length);
  for (const r of renderings) expect(r.overrides).toEqual({ theme: r.theme, profile: r.profile });
  expect(new Set(renderings.map((r) => r.output)).size).toBe(renderings.length);
});

test("every theme-wide sample passes structural lint under every theme (#177)", () => {
  // Rendering in the gallery checks diagnostics and geometry only; the
  // structural rules (e.g. lint/unused-legend-entry) run here.
  for (const sample of [toneSample(), outlinedToneSample(), filledToneSample(), dimSample()]) {
    for (const theme of THEMES) {
      const source = sample.source.replace(/^ {2}theme: .*$/m, `  theme: ${theme}`);
      const report = lintFigure(source);
      expect([sample.fileName, theme, report.diagnostics.map((d) => [d.code, d.message])]).toEqual([
        sample.fileName,
        theme,
        [],
      ]);
    }
  }
});

test("component samples have no structural lint warnings or errors (#177)", () => {
  // A node sample shows its variants side by side without edges, so
  // lint/no-edges is expected there; nothing else is.
  for (const sample of componentSamples()) {
    const report = lintFigure(sample.source, { file: sample.fileName });
    const problems = report.diagnostics.filter(
      (d) => d.severity !== "info" && d.code !== "lint/no-edges",
    );
    expect([sample.entry.id, problems.map((d) => [d.code, d.message])]).toEqual([
      sample.entry.id,
      [],
    ]);
  }
});
