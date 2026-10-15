import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkFigure } from "../check";

const fixture = (name: string) =>
  readFileSync(join(import.meta.dir, "../../../tests/fixtures/figures", name), "utf8");

describe("checkFigure overrides", () => {
  test("replace figure.theme and figure.profile after validation", () => {
    const text = fixture("lint/clean.sumi.yaml");
    const { state } = checkFigure(text, {
      overrides: { theme: "academic", profile: "presentation-16x9" },
    });
    expect(state.doc.figure?.theme).toBe("academic");
    expect(state.doc.figure?.profile).toBe("presentation-16x9");
  });

  test("fix or cause profile diagnostics, which then have no source location for the profile", () => {
    const failing = fixture("invalid/profile-font-too-small.sumi.yaml");
    const before = checkFigure(failing, { file: "f.sumi.yaml" }).state.diagnostics;
    expect(before.some((d) => d.code === "profile/font-too-small")).toBe(true);
    expect(before[0]?.related?.[0]?.location?.line).toBe(5);

    const fixed = checkFigure(failing, { overrides: { profile: "paper-single" } }).state;
    expect(fixed.diagnostics).toEqual([]);

    const clean = fixture("lint/clean.sumi.yaml");
    const caused = checkFigure(clean, {
      file: "f.sumi.yaml",
      overrides: { profile: "presentation-16x9" },
    }).state.diagnostics;
    const diagnostic = caused.find((d) => d.code === "profile/font-too-small");
    expect(diagnostic?.location?.file).toBe("f.sumi.yaml");
    expect(diagnostic?.related?.[0]?.location).toBeUndefined();
    expect(diagnostic?.related?.[0]?.path).toEqual(["figure", "profile"]);
  });

  test("an unknown theme in the file is not reported when overridden", () => {
    const text = fixture("invalid/theme-unknown.sumi.yaml");
    expect(checkFigure(text).state.diagnostics.map((d) => d.code)).toEqual(["theme/unknown"]);
    expect(checkFigure(text, { overrides: { theme: "minimal" } }).state.diagnostics).toEqual([]);
  });

  test("schema errors in the overridden field are still reported at their location", () => {
    const text = "version: 1\nfigure:\n  id: x\n  theme: 3\n";
    const diagnostics = checkFigure(text, { overrides: { theme: "minimal" } }).state.diagnostics;
    expect(diagnostics.map((d) => [d.code, d.location?.line])).toEqual([
      ["schema/invalid-type", 4],
    ]);
  });
});
