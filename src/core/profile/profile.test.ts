import { describe, expect, test } from "bun:test";
import { checkFigureSource } from "../figure/check";
import { formatMm } from "../units";
import {
  BUILTIN_PROFILE_DEFINITIONS,
  BUILTIN_PROFILES,
  constrainFigure,
  getProfile,
  type Profile,
  resolveProfile,
  toD2LayoutArgs,
  validateProfile,
} from ".";

const builtin = (id: string): Profile => {
  const profile = getProfile(id);
  if (!profile) throw new Error(`missing built-in profile ${id}`);
  return profile;
};

const paper = {
  version: 1,
  id: "custom",
  description: "Test profile",
  page: { maxWidth: "88mm", maxHeight: "120mm" },
  margin: "2mm",
  typography: { minFontSize: "7pt" },
  layout: { layerGap: "10mm", containerPadding: "4mm" },
};

describe("built-in profiles", () => {
  test("are all valid and registered by ID", () => {
    expect([...BUILTIN_PROFILES.keys()]).toEqual([
      "paper-single",
      "paper-double",
      "presentation-16x9",
    ]);
    for (const definition of BUILTIN_PROFILE_DEFINITIONS) {
      expect(validateProfile(definition).ok).toBe(true);
    }
  });

  test("have the page limits and minimum font sizes of the design doc", () => {
    const summary = (id: string) => {
      const p = builtin(id);
      return {
        maxWidth: p.page.maxWidth && formatMm(p.page.maxWidth.pt),
        maxHeight: p.page.maxHeight && formatMm(p.page.maxHeight.pt),
        minFontSize: p.typography.minFontSize.pt,
      };
    };
    expect(summary("paper-single")).toEqual({
      maxWidth: "88mm",
      maxHeight: undefined,
      minFontSize: 7,
    });
    expect(summary("paper-double")).toEqual({
      maxWidth: "180mm",
      maxHeight: undefined,
      minFontSize: 7,
    });
    expect(summary("presentation-16x9")).toEqual({
      maxWidth: "338.7mm",
      maxHeight: "190.5mm",
      minFontSize: 14,
    });
  });
});

describe("toD2LayoutArgs", () => {
  test("matches the conversion table of the design doc (§5.2)", () => {
    expect(toD2LayoutArgs(builtin("paper-single"))).toEqual({
      args: [
        "--pad",
        "11",
        "--elk-nodeNodeBetweenLayers",
        "57",
        "--elk-edgeNodeBetweenLayers",
        "29",
        "--elk-padding",
        "[top=23,left=23,bottom=23,right=23]",
      ],
      effective: {
        pad: { units: 11, pt: 5.5 },
        nodeNodeBetweenLayers: { units: 57, pt: 28.5 },
        edgeNodeBetweenLayers: { units: 29, pt: 14.5 },
        padding: { units: 23, pt: 11.5 },
      },
    });
  });

  test("scales the presentation profile", () => {
    const { effective } = toD2LayoutArgs(builtin("presentation-16x9"));
    expect(effective.pad.units).toBe(23); // 4mm = 22.68 units
    expect(effective.nodeNodeBetweenLayers.units).toBe(113); // 20mm = 113.39 units
    expect(effective.edgeNodeBetweenLayers.units).toBe(57); // 113 / 2 = 56.5, rounded up
    expect(effective.padding.units).toBe(45); // 8mm = 45.35 units
  });

  test("rounds .5 units up", () => {
    const result = validateProfile({
      ...paper,
      margin: "0.25pt",
      layout: { layerGap: "2.75pt", containerPadding: "0pt" },
    });
    if (!result.ok) throw new Error("expected ok");
    const { effective } = toD2LayoutArgs(result.value);
    expect(effective.pad.units).toBe(1); // 0.5
    expect(effective.nodeNodeBetweenLayers.units).toBe(6); // 5.5
    expect(effective.edgeNodeBetweenLayers.units).toBe(3); // 6 / 2
    expect(effective.padding.units).toBe(0);
  });
});

describe("validateProfile", () => {
  const codes = (raw: unknown) =>
    validateProfile(raw).diagnostics.map((d) => [d.code, d.path, d.message, d.hint]);

  test("accepts a complete definition and normalizes lengths", () => {
    const result = validateProfile(paper);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.margin).toEqual({ value: 2, unit: "mm", pt: (2 * 72) / 25.4 });
    expect(result.value.page.maxHeight?.unit).toBe("mm");
  });

  test("page is optional", () => {
    const { page: _, ...rest } = paper;
    const result = validateProfile(rest);
    expect(result.ok && result.value.page).toEqual({});
  });

  test("reports invalid lengths", () => {
    expect(
      codes({
        ...paper,
        margin: "8px",
        typography: { minFontSize: 7 },
        layout: { layerGap: "-1mm", containerPadding: true },
      }),
    ).toEqual([
      [
        "profile/invalid-length",
        ["margin"],
        'margin: Unsupported unit "px" in "8px"; pixel sizes depend on the display.',
        "Use one of mm, cm, in or pt, e.g. 2mm or 7pt. At 96 dpi, 1px = 0.75pt.",
      ],
      [
        "profile/invalid-length",
        ["typography", "minFontSize"],
        "typography.minFontSize: Expected a length with a unit, got the number 7.",
        'Add a unit, e.g. "7mm" or "7pt".',
      ],
      [
        "profile/invalid-length",
        ["layout", "layerGap"],
        'layout.layerGap: Length "-1mm" must be zero or more.',
        undefined,
      ],
      [
        "profile/invalid-length",
        ["layout", "containerPadding"],
        'layout.containerPadding: Expected a length such as "2mm", got a boolean.',
        undefined,
      ],
    ]);
  });

  test("requires positive page limits and font size", () => {
    const result = validateProfile({ ...paper, typography: { minFontSize: "0pt" } });
    expect(result.diagnostics.map((d) => [d.code, d.message])).toEqual([
      ["profile/invalid-length", 'typography.minFontSize: Length "0pt" must be greater than zero.'],
    ]);
  });

  test("rejects a non-mapping definition", () => {
    expect(codes("paper")).toEqual([
      ["profile/invalid-type", [], "Expected a mapping at (root).", undefined],
    ]);
  });

  test("reports structural errors", () => {
    const { margin: _, ...noMargin } = paper;
    expect(
      codes({
        ...noMargin,
        version: 2,
        id: "Paper",
        layout: { ...paper.layout, layerGaps: "1mm" },
      }),
    ).toEqual([
      [
        "profile/unsupported-version",
        ["version"],
        "Unsupported profile format version 2; this Sumi supports version 1.",
        undefined,
      ],
      [
        "profile/invalid-value",
        ["id"],
        'Invalid profile ID "Paper"; IDs must match ^[a-z][a-z0-9_-]{0,63}$.',
        undefined,
      ],
      [
        "profile/missing-field",
        ["margin"],
        'Missing required field "margin" in (root).',
        undefined,
      ],
      [
        "profile/unknown-field",
        ["layout", "layerGaps"],
        'Unknown field "layerGaps" in layout.',
        'Did you mean "layerGap"?',
      ],
    ]);
  });
});

describe("resolveProfile", () => {
  test("finds built-in profiles", () => {
    const result = resolveProfile("paper-double");
    expect(result.ok && result.value.id).toBe("paper-double");
  });

  test("reports unknown names with the closest match", () => {
    expect(resolveProfile("paper-singel")).toEqual({
      ok: false,
      diagnostics: [
        {
          code: "profile/unknown",
          severity: "error",
          message: 'Unknown profile "paper-singel".',
          path: ["figure", "profile"],
          hint: 'Did you mean "paper-single"? Available profiles: paper-single, paper-double, presentation-16x9.',
        },
      ],
    });
    expect(resolveProfile("poster").diagnostics[0]?.hint).toBe(
      "Available profiles: paper-single, paper-double, presentation-16x9.",
    );
  });
});

describe("constrainFigure (stage profile)", () => {
  const figure = (profile?: string) => `version: 1
figure:
  id: test
${profile ? `  profile: ${profile}\n` : ""}groups:
  - id: backend
nodes:
  - id: api
    component: box
    group: backend
  - id: db
    component: box
edges:
  - from: api
    to: db
  - id: link
    from: db
    to: api
`;

  test("uses paper-single by default", () => {
    const { state, locate } = checkFigureSource(figure());
    expect(constrainFigure(state, locate)?.id).toBe("paper-single");
    expect(state.diagnostics).toEqual([]);
  });

  test("reports an unknown profile at figure.profile", () => {
    const { state, locate } = checkFigureSource(figure("slides"), { file: "a.sumi.yaml" });
    expect(constrainFigure(state, locate)).toBeUndefined();
    expect(state.diagnostics).toMatchObject([
      {
        code: "profile/unknown",
        path: ["figure", "profile"],
        location: { file: "a.sumi.yaml", line: 4, column: 12 },
      },
    ]);
  });

  test("reports fonts below minFontSize, comparing unquantized pt", () => {
    const { state, locate } = checkFigureSource(figure("presentation-16x9"));
    constrainFigure(state, locate, {
      fonts: [
        { key: "n:api", fontSizePt: 14 },
        { key: "n:db", fontSizePt: 13.99 },
        { key: "g:backend", fontSizePt: 9 },
        { key: "e:#0", fontSizePt: 7 },
        { key: "e:link", fontSizePt: 7 },
      ],
    });
    expect(state.diagnostics.map((d) => [d.code, d.path, d.subject, d.message])).toEqual([
      [
        "profile/font-too-small",
        ["nodes", 1],
        { kind: "node", id: "db" },
        'Font size 13.99pt of node "db" is below the minimum 14pt of profile "presentation-16x9".',
      ],
      [
        "profile/font-too-small",
        ["groups", 0],
        { kind: "group", id: "backend" },
        'Font size 9pt of group "backend" is below the minimum 14pt of profile "presentation-16x9".',
      ],
      [
        "profile/font-too-small",
        ["edges", 0],
        { kind: "edge", id: "edges[0]" },
        'Font size 7pt of edge edges[0] is below the minimum 14pt of profile "presentation-16x9".',
      ],
      [
        "profile/font-too-small",
        ["edges", 1],
        { kind: "edge", id: "link" },
        'Font size 7pt of edge "link" is below the minimum 14pt of profile "presentation-16x9".',
      ],
    ]);
    expect(state.diagnostics[0]?.location?.line).toBe(11);
    expect(state.diagnostics[0]?.related?.[0]?.path).toEqual(["figure", "profile"]);
    expect([...state.invalid]).toEqual(["n:db", "g:backend", "e:#0", "e:link"]);
  });

  test("skips invalid elements and unknown profiles", () => {
    const { state, locate } = checkFigureSource(figure());
    state.invalid.add("n:db");
    constrainFigure(state, locate, { fonts: [{ key: "n:db", fontSizePt: 1 }] });
    expect(state.diagnostics).toEqual([]);

    const unknown = checkFigureSource(figure("nope"));
    constrainFigure(unknown.state, unknown.locate, { fonts: [{ key: "n:db", fontSizePt: 1 }] });
    expect(unknown.state.diagnostics.map((d) => d.code)).toEqual(["profile/unknown"]);
  });
});
