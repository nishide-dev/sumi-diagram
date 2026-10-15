import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { checkFigure } from "../check";
import type { CheckState } from "../check-state";
import { resolveFigureProfile } from "../profile/constrain";
import { createBuiltinRegistry } from "../registry/builtins";
import { getTheme, KIND_DEFAULTS, resolveStyle, type Theme } from ".";

const fixtures = `${import.meta.dir}/../../../tests/fixtures/figures`;
const read = (name: string) => Bun.file(`${fixtures}/${name}`).text();

const summarize = (state: CheckState) =>
  state.diagnostics.map((d) => [d.code, d.severity, d.path, d.location?.line ?? 0]);

describe("theme stage", () => {
  test("styles every valid element with the figure's theme", async () => {
    const { state } = checkFigure(await read("valid/full.sumi.yaml"));
    expect(state.diagnostics).toEqual([]);
    const minimal = getTheme("minimal");
    if (!minimal) throw new Error("missing theme");
    expect([...(state.styles?.keys() ?? [])]).toEqual([
      "g:backend",
      "n:client",
      "n:api",
      "n:auth",
      "n:db",
      "e:#0",
      "e:#1",
      "e:#2",
    ]);
    expect(state.styles?.get("n:db")).toEqual(
      resolveStyle(minimal, { kind: "node", id: "sumi/cylinder", variant: "muted" }).style,
    );
    expect(state.styles?.get("e:#2")).toMatchObject({ kind: "edge", strokeDash: 4 });
    expect(state.styles?.get("g:backend")).toMatchObject({ kind: "group", bold: true });
  });

  test("switching the theme changes styles but not the profile constraints", async () => {
    const text = await read("valid/full.sumi.yaml");
    const minimal = checkFigure(text);
    const academic = checkFigure(text.replace("theme: minimal", "theme: academic"));
    expect(academic.state.diagnostics).toEqual([]);
    expect(academic.state.styles?.get("n:client")).not.toEqual(
      minimal.state.styles?.get("n:client"),
    );
    expect(academic.state.styles?.get("n:client")?.strokeWidth).toEqual({ pt: 0.5, units: 1 });
    expect(minimal.state.styles?.get("n:client")?.strokeWidth).toEqual({ pt: 1, units: 2 });
    const profile = (state: CheckState) => resolveFigureProfile(state, () => undefined);
    expect(profile(academic.state)).toBe(profile(minimal.state));
  });

  test("an omitted theme defaults to minimal", () => {
    const { state } = checkFigure(
      "version: 1\nfigure: { id: t }\nnodes: [{ id: a, component: box }]",
    );
    expect(state.diagnostics).toEqual([]);
    expect(state.doc.figure?.theme).toBe("minimal");
    expect(state.styles?.get("n:a")).toEqual(
      resolveStyle(getTheme("minimal") as Theme, {
        kind: "node",
        id: "sumi/box",
        variant: "default",
      }).style,
    );
  });

  test("an unknown theme is reported with a suggestion and styles nothing", async () => {
    const { state } = checkFigure(await read("invalid/theme-unknown.sumi.yaml"), {
      file: "theme-unknown.sumi.yaml",
    });
    expect(summarize(state)).toEqual([["theme/unknown", "error", ["figure", "theme"], 4]]);
    expect(state.diagnostics[0]?.hint).toBe(
      'Did you mean "academic"? Available themes: minimal, academic.',
    );
    expect(state.styles?.size).toBe(0);
  });

  test("elements with invalid components are not styled (no cascade)", async () => {
    const { state } = checkFigure(await read("invalid/component-no-cascade.sumi.yaml"));
    expect(state.diagnostics.every((d) => d.code.startsWith("component/"))).toBe(true);
    for (const key of state.invalid) expect(state.styles?.has(key)).toBe(false);
    expect(state.styles?.has("n:client")).toBe(true);
  });

  test("a variant missing from the theme falls back with a warning", () => {
    const registry = createBuiltinRegistry();
    registry.register({
      version: 1,
      kind: "node",
      namespace: "acme",
      name: "widget",
      description: "Test component",
      variants: ["default", "loud"],
      props: z.strictObject({}),
      since: "0.1.0",
      shape: "rectangle",
      sizing: "auto",
    });
    const text = [
      "version: 1",
      "figure: { id: t }",
      "nodes:",
      "  - { id: a, component: acme/widget, variant: loud, label: A }",
    ].join("\n");
    const { state } = checkFigure(text, { registry });
    expect(summarize(state)).toEqual([
      ["theme/missing-variant", "warning", ["nodes", 0, "variant"], 4],
    ]);
    expect(state.diagnostics[0]?.subject).toEqual({ kind: "node", id: "a" });
    expect(state.styles?.get("n:a")).toEqual({
      ...KIND_DEFAULTS.node,
      ...getTheme("minimal")?.base.node,
    });
    expect(state.invalid.size).toBe(0);
  });
});

describe("profile stage", () => {
  test("checks the theme's font sizes of labeled elements only", async () => {
    const { state } = checkFigure(await read("invalid/profile-font-too-small.sumi.yaml"));
    // presentation-16x9 requires 14pt; minimal uses 7–9pt. The unlabeled
    // circle and edges[0] draw no text.
    expect(summarize(state)).toEqual([
      ["profile/font-too-small", "error", ["groups", 0], 7],
      ["profile/font-too-small", "error", ["nodes", 0], 10],
      ["profile/font-too-small", "error", ["edges", 1], 19],
    ]);
    expect(state.diagnostics[1]?.message).toBe(
      'Font size 8pt of node "client" is below the minimum 14pt of profile "presentation-16x9".',
    );
    expect(state.invalid.has("n:dot")).toBe(false);
  });

  test("the same figure passes with a profile whose minimum the theme meets", async () => {
    const text = await read("invalid/profile-font-too-small.sumi.yaml");
    const { state } = checkFigure(text.replace("presentation-16x9", "paper-double"));
    expect(state.diagnostics).toEqual([]);
  });
});
