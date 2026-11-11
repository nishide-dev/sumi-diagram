import { expect, test } from "bun:test";
import { parse } from "yaml";
import { componentSamples, toneSample } from "../gallery/samples";
import { componentData, exampleMetadata, optionData, paperUrl, sampleSource } from "./data";

test("sample source preserves comments and existing overrides", () => {
  const source =
    "# heading\nfigure:\n  theme: minimal\n  profile: paper-double\n  themeOverrides:\n    # keep this\n    tokens: { ink: red }\n";
  const result = sampleSource(source, "slides", "presentation-16x9", "sage");
  expect(result).toContain("# heading");
  expect(result).toContain("# keep this");
  expect(parse(result).figure).toEqual({
    theme: "slides",
    profile: "presentation-16x9",
    themeOverrides: { tokens: { ink: "red" }, palette: "sage" },
  });
});

test("paper URL comes only from leading comments or the curated map", () => {
  expect(
    paperUrl(
      "x",
      "# see https://arxiv.org/abs/1234.5678.\nversion: 1\n# https://ai.meta.com/ignored\n",
    ),
  ).toBe("https://arxiv.org/abs/1234.5678");
  expect(paperUrl("x", "version: 1\n# https://arxiv.org/abs/1234\n")).toBeUndefined();
  expect(paperUrl("transformer", "version: 1\n")).toBe("https://arxiv.org/abs/1706.03762");
});

test("metadata includes source, selected profiles and example fields", () => {
  const source =
    "# https://ai.meta.com/research/paper/\nfigure: { title: Demo, theme: paper, profile: paper-double }\n";
  expect(exampleMetadata("demo", source)).toEqual({
    slug: "demo",
    title: "Demo",
    theme: "paper",
    profile: "paper-double",
    source,
    paperUrl: "https://ai.meta.com/research/paper/",
  });
  const sample = componentSamples()[0];
  expect(sample).toBeDefined();
  if (!sample) throw new Error("No components");
  expect(componentData(sample)).toMatchObject({
    id: sample.entry.id,
    props: sample.entry.props,
    profiles: { minimal: "paper-double" },
  });
  expect(optionData(toneSample(), "Tones", "Colors")).toMatchObject({
    slug: "tones",
    title: "Tones",
    description: "Colors",
  });
});
