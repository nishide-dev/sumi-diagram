import { describe, expect, test } from "bun:test";
import { buildPrompt, DEFAULT_STATE } from "./prompt";

describe("buildPrompt", () => {
  test("generates English instructions without implicit colour meanings", () => {
    const text = buildPrompt({ ...DEFAULT_STATE, content: "A → B" });
    expect(text).toContain("Make a system architecture.");
    expect(text).toContain("- Notes: A → B");
    expect(text).not.toContain("Colour meaning (tone):");
  });
  test("generates Japanese custom goal and figure", () => {
    const text = buildPrompt({
      ...DEFAULT_STATE,
      ui: "ja",
      purpose: "custom",
      purposeText: "目的",
      kind: "custom",
      kindText: "時系列",
    });
    expect(text).toContain("## 目的\n目的");
    expect(text).toContain("## 図の種類\n時系列");
  });
  test("reproduction has comparison and original colours", () => {
    const text = buildPrompt({ ...DEFAULT_STATE, purpose: "reproduce", target: "Figure 2" });
    expect(text).toContain("Recreate Figure 2");
    expect(text).toContain("Compare it side by side");
    expect(text).toContain("Take the colours from the original");
    expect(buildPrompt(DEFAULT_STATE)).not.toContain("Compare it side by side");
  });
  test("slide placement, palette and colour meanings", () => {
    const text = buildPrompt({
      ...DEFAULT_STATE,
      place: "presentation-16x9",
      palette: "slate",
      tones: [
        ["service", "blue"],
        ["", "red"],
      ],
    });
    expect(text).toContain("Theme: slides (switched from paper for a slide)");
    expect(text).toContain("Palette: slate (figure.themeOverrides.palette)");
    expect(text).toContain("- service → blue");
    expect(text).not.toContain("→ red");
  });
});
