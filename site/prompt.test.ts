import { describe, expect, test } from "bun:test";
import { buildPrompt, DEFAULT_STATE } from "./prompt";

describe("buildPrompt", () => {
  test("generates English instructions without implicit colour meanings", () => {
    const text = buildPrompt({ ...DEFAULT_STATE, content: "A → B" });
    expect(text).toContain("Make a system architecture diagram.");
    expect(text).toContain("from the notes only");
    expect(text).toContain("Presentation is yours");
    expect(text).not.toContain("no taller than the content needs");
    expect(text).toContain("list the assumptions");
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
    expect(text).toContain("Theme: paper\n");
    expect(text).toContain("at most 338.7mm wide and 190.5mm tall");
    expect(text).toContain("textScaleFor.presentation-16x9");
    expect(text).toContain("Palette: slate (figure.themeOverrides.palette)");
    expect(text).toContain("- service → blue");
    expect(text).not.toContain("→ red");
  });
  test("README placement uses screen-doc with the theme's text scale", () => {
    const text = buildPrompt({ ...DEFAULT_STATE, theme: "sumi" });
    expect(text).toContain("profile: screen-doc, at most 200mm wide and 150mm tall");
    expect(text).toContain("textScaleFor.screen-doc");
    expect(text).toContain("Theme: sumi");
  });
  test("articles, Japanese target spacing and gray themes", () => {
    expect(buildPrompt({ ...DEFAULT_STATE, kind: "overview" })).toContain(
      "Make an overview figure in panels.",
    );
    const ja = buildPrompt({
      ...DEFAULT_STATE,
      ui: "ja",
      kind: "pipeline",
      target: "RAG システム",
    });
    expect(ja).toContain("RAG システムを表す処理・パイプラインを作る。");
    const slides = buildPrompt({
      ...DEFAULT_STATE,
      theme: "slides",
      place: "presentation-16x9",
      tones: [["failure", "red"]],
    });
    expect(slides).not.toContain("textScaleFor");
    expect(slides).toContain("slides draws tones as shades of gray");
    expect(buildPrompt({ ...DEFAULT_STATE, place: "paper-single" })).toContain(
      "no taller than the content needs",
    );
  });
});
