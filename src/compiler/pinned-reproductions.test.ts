/**
 * The paper reproductions in `examples/` pin their colors to the original
 * figures (#441): their painted fills and strokes must not depend on a
 * theme's tone, group-fill or group-frame defaults, so that changing those
 * defaults for new figures (#434, #440) can never recolor a reproduction.
 *
 * Each reproduction is rendered twice, with the real theme and with a copy
 * whose tone colors, group and container fills and frames are replaced by
 * obviously different values; the painted colors must be identical.
 *
 * Skipped when the pinned `d2` is not installed locally; required in CI.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { checkD2Version, findD2Binary } from "../backends/d2/binary";
import { BUILTIN_THEMES } from "../core/theme/builtin";
import type { Theme } from "../core/theme/schema";
import type { StyleLayer } from "../core/theme/style";
import { renderFigure } from "../render";

/**
 * The reproductions of a paper's or announcement's figure. A new reproduction
 * must be added here (and must pin its colors in `themeOverrides`).
 */
const REPRODUCTIONS = [
  "transformer",
  "dit-block",
  "clip",
  "embedding-gemma",
  "gcn",
  "llama4-moe",
  "tricl",
  "llada",
] as const;

const binary = findD2Binary();
const available = binary.ok && (await checkD2Version(binary.value.path)).ok;
const inCI = Boolean(process.env.CI);
const run = available || inCI ? describe : describe.skip;

const ROOT = join(import.meta.dir, "..", "..");
const TIMEOUT_MS = 60_000;

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** A distinct, loud color for each call. */
let seed = 0;
const loud = (): string => {
  seed += 1;
  return `#${((seed * 0x2f4b13 + 0x10c0a0) % 0xffffff).toString(16).padStart(6, "0")}`;
};

/** The layer with its listed colors replaced (`transparent` stays unpainted). */
function recolor(
  layer: StyleLayer,
  keys: readonly ("fill" | "stroke" | "fontColor")[],
): StyleLayer {
  const out: Mutable<StyleLayer> & Record<string, unknown> = { ...layer };
  for (const key of keys) {
    const value = out[key];
    if (typeof value === "string" && value !== "transparent") out[key] = loud();
  }
  return out;
}

/** The theme with different tone colors, group fills and group frames. */
function perturbed(theme: Theme): Theme {
  const all = ["fill", "stroke", "fontColor"] as const;
  const panel = ["fill", "stroke"] as const;
  return {
    ...theme,
    tones: new Map([...theme.tones].map(([tone, layer]) => [tone, recolor(layer, all)])),
    toneLines: new Map([...theme.toneLines].map(([tone, layer]) => [tone, recolor(layer, all)])),
    components: new Map(
      [...theme.components].map(([id, variants]) => [
        id,
        new Map(
          [...variants].map(([variant, layer]) => [
            variant,
            id.endsWith("/container") ? recolor(layer, panel) : layer,
          ]),
        ),
      ]),
    ),
    base: { ...theme.base, group: recolor(theme.base.group, panel) },
  };
}

/** Every painted color of an SVG, as a sorted list: zero-width frames paint nothing. */
function painted(svg: string): string[] {
  const visible = svg.replace(/ stroke="#[0-9a-f]{6}"( stroke-width="0")/gi, "$1");
  return [...visible.matchAll(/#[0-9a-f]{6}\b/gi)].map((m) => m[0].toLowerCase()).sort();
}

async function svgOf(text: string, assetBase: string, themeId: string, theme: Theme) {
  const themes = BUILTIN_THEMES as Map<string, Theme>;
  const real = themes.get(themeId);
  themes.set(themeId, theme);
  try {
    const result = await renderFigure(text, { assetBase });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    return result.value.svg;
  } finally {
    if (real) themes.set(themeId, real);
  }
}

run("reproductions are pinned to their original figures (#441)", () => {
  for (const name of REPRODUCTIONS) {
    test(
      `${name} paints the same colors whatever the theme's tone and panel defaults are`,
      async () => {
        const file = join(ROOT, "examples", name, `${name}.sumi.yaml`);
        const text = readFileSync(file, "utf8");
        const themeId = /^ {2}theme: (\S+)/m.exec(text)?.[1] ?? "";
        const real = BUILTIN_THEMES.get(themeId);
        if (!real) throw new Error(`${name}: unknown theme "${themeId}"`);
        const assetBase = dirname(file);
        const a = painted(await svgOf(text, assetBase, themeId, real));
        const b = painted(await svgOf(text, assetBase, themeId, perturbed(real)));
        expect(b).toEqual(a);
      },
      TIMEOUT_MS,
    );
  }

  test("the perturbation changes a figure that relies on theme defaults", async () => {
    const text = `version: 1
figure:
  id: control
  theme: paper
  layout: { arrange: { stack: { items: [panel] } } }
groups:
  - id: panel
    arrange: { row: { items: [a, b] } }
nodes:
  - { id: a, component: box, label: A, tone: green }
  - { id: b, component: box, label: B, variant: tinted, tone: blue }
`;
    const real = BUILTIN_THEMES.get("paper") as Theme;
    const before = painted(await svgOf(text, ROOT, "paper", real));
    const after = painted(await svgOf(text, ROOT, "paper", perturbed(real)));
    expect(after).not.toEqual(before);
  });
});
