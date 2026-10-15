import { describe, expect, test } from "bun:test";
import { elementClass } from "../compiler/d2";
import type { ElementKey } from "../core/check-state";
import type { Diagnostic } from "../core/diagnostics";
import { getProfile } from "../core/profile/builtin";
import { decodeElementClass, inspectSvg, type SvgInspection } from "./inspect";
import { TINY_PARTS, tinyCompiled, tinySvg } from "./testing";

const { ir } = tinyCompiled();

function inspect(svg: string): SvgInspection {
  const result = inspectSvg(svg, ir);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return result.value;
}

function failure(svg: string): Diagnostic[] {
  const result = inspectSvg(svg, ir);
  expect(result.ok).toBe(false);
  return result.diagnostics;
}

const codes = (diagnostics: Diagnostic[]) => diagnostics.map((d) => d.code);

describe("decodeElementClass", () => {
  test("inverts elementClass", () => {
    const keys: ElementKey[] = ["n:api", "n:a--b", "n:x-", "g:g_1", "e:#0", "e:#12", "e:twin-1"];
    for (const key of keys) expect(decodeElementClass(elementClass(key))).toBe(key);
  });

  test("rejects other classes", () => {
    for (const c of [
      "sumi-kind-node",
      "shape",
      "sumi-k-",
      "sumi-k-x--a",
      "sumi-k-n--",
      "sumi-k-n--_3",
      "sumi-k-e--_x",
      "sumi-k-n--A",
      "sumi-k-n-api",
    ]) {
      expect(decodeElementClass(c)).toBeUndefined();
    }
  });
});

describe("inspectSvg", () => {
  test("extracts geometry for every element in IR order", () => {
    const inspection = inspect(tinySvg());
    expect(inspection.canvas).toEqual({
      viewBox: { x: 0, y: 0, width: 200, height: 100 },
      width: { units: 200, pt: 100, mm: expect.closeTo(35.2778, 3) },
      height: { units: 100, pt: 50, mm: expect.closeTo(17.6389, 3) },
    });
    expect(inspection.profile).toEqual({
      id: "paper-single",
      maxWidthPt: getProfile("paper-single")?.page.maxWidth?.pt as number,
      minFontSizePt: 7,
    });
    expect(inspection.elements.map((e) => e.key)).toEqual([
      "g:grp",
      "n:a",
      "n:note",
      "e:#0",
      "e:back",
    ]);
    const [grp, a, note, edge0, back] = inspection.elements;
    expect(grp).toEqual({
      key: "g:grp",
      kind: "group",
      bbox: { x: 10, y: 10, width: 120, height: 80 },
      labels: [
        {
          text: "Group",
          anchor: { x: 70, y: 31 },
          fontSizeUnits: 18,
          lines: 1,
          lineHeightUnits: 18,
          font: "bold",
        },
      ],
    });
    expect(a?.bbox).toEqual({ x: 20, y: 40, width: 50, height: 30 });
    expect(a?.labels).toEqual([
      {
        text: "A",
        anchor: { x: 45, y: 60 },
        fontSizeUnits: 16,
        lines: 1,
        lineHeightUnits: 16,
        font: "regular",
      },
    ]);
    // A text-shaped node has no shape geometry; its label has two lines.
    expect(note?.bbox).toBeUndefined();
    expect(note?.labels).toEqual([
      {
        text: "No\nte",
        anchor: { x: 170, y: 60 },
        fontSizeUnits: 16,
        lines: 2,
        lineHeightUnits: 16,
        font: "regular",
      },
    ]);
    // S is normalized to C; the marker's polygon.connection is ignored.
    expect(edge0?.path).toEqual([
      { command: "M", to: { x: 72, y: 55 } },
      { command: "L", to: { x: 140, y: 55 } },
      { command: "C", c1: { x: 140, y: 55 }, c2: { x: 150, y: 55 }, to: { x: 150, y: 50 } },
      { command: "L", to: { x: 155, y: 50 } },
    ]);
    expect(edge0?.labels.map((l) => l.text)).toEqual(["x"]);
    expect(edge0?.bbox).toBeUndefined();
    expect(back?.path).toEqual([
      { command: "M", to: { x: 160, y: 65 } },
      { command: "L", to: { x: 160, y: 80 } },
      { command: "L", to: { x: 45, y: 80 } },
      { command: "L", to: { x: 45, y: 72 } },
    ]);
    expect(back?.labels).toEqual([]);
  });

  test("measures every shape element D2 emits, stroke excluded", () => {
    const shapes = [
      `<ellipse rx="36.5" ry="20" cx="45" cy="55" />`,
      `<circle r="10" cx="45" cy="55" />`,
      `<path d="M 30 70 L 30 40 L 60 40 L 60 70 C 50 64 40 76 30 70 Z" />`,
      `<polygon points="20,40 70,40 45,70" />`,
      `<path d="M 20 45 C 20 35 70 35 70 45 V 65 C 70 75 20 75 20 65 V 45 Z" /><path d="M 20 45 C 20 55 70 55 70 45" />`,
    ];
    const expected = [
      { x: 8.5, y: 35, width: 73, height: 40 },
      { x: 35, y: 45, width: 20, height: 20 },
      { x: 30, y: 40, width: 30, height: expect.closeTo(31.732, 3) },
      { x: 20, y: 40, width: 50, height: 30 },
      { x: 20, y: 37.5, width: 50, height: 35 },
    ];
    shapes.forEach((shape, i) => {
      const a = TINY_PARTS.a.replace(
        /<g class="shape" >.*?<\/g>/,
        `<g class="shape" >${shape}</g>`,
      );
      const svg = tinySvg([TINY_PARTS.grp, a, TINY_PARTS.note, TINY_PARTS.edge0, TINY_PARTS.back]);
      expect(inspect(svg).elements[1]?.bbox).toEqual(expected[i] as never);
    });
  });

  test("works on a finalized SVG (metadata ignored)", () => {
    const raw = tinySvg();
    const finalized = raw.replace(
      /viewBox="0 0 200 100">/,
      `viewBox="0 0 200 100" width="100pt" height="50pt"><metadata><sumi:render xmlns:sumi="x"/></metadata>`,
    );
    expect(inspect(finalized)).toEqual(inspect(raw));
  });

  describe("checks that every element appears exactly once", () => {
    const { grp, a, note, edge0, back } = TINY_PARTS;

    test("svg/missing-element with the element's source location", () => {
      const [diagnostic, ...rest] = failure(tinySvg([grp, a, edge0, back]));
      expect(rest).toEqual([]);
      expect(diagnostic).toMatchObject({
        code: "svg/missing-element",
        severity: "error",
        subject: { kind: "node", id: "note" },
        path: ["nodes", 1],
        location: { line: 7 },
      });
    });

    test("svg/duplicate-element", () => {
      const diagnostics = failure(tinySvg([grp, a, note, edge0, back, back]));
      expect(diagnostics).toMatchObject([
        { code: "svg/duplicate-element", subject: { kind: "edge", id: "back" } },
      ]);
    });

    test("edges without an ID are named by index", () => {
      expect(failure(tinySvg([grp, a, note, back]))).toMatchObject([
        { code: "svg/missing-element", subject: { kind: "edge", id: "edges[0]" } },
      ]);
    });

    test("svg/unknown-element for keys not in the figure, bad encodings and wrong kinds", () => {
      const ghost = a.replace("sumi-k-n--a", "sumi-k-n--ghost");
      const bad = a.replace("sumi-k-n--a", "sumi-k-q--a");
      const wrongKind = a.replace("sumi-kind-node", "sumi-kind-group");
      const twoKeys = back.replace("sumi-k-e--back", "sumi-k-e--back sumi-k-e--_0");
      const diagnostics = failure(tinySvg([grp, a, note, edge0, back, ghost, bad]));
      expect(codes(diagnostics)).toEqual(["svg/unknown-element", "svg/unknown-element"]);
      expect(codes(failure(tinySvg([grp, wrongKind, note, edge0, back])))).toEqual([
        "svg/unknown-element",
        "svg/missing-element",
      ]);
      expect(codes(failure(tinySvg([grp, a, note, edge0, twoKeys])))).toEqual([
        "svg/unknown-element",
        "svg/missing-element",
      ]);
    });
  });

  describe("svg/unsupported-geometry instead of guessing", () => {
    const { grp, a, note, edge0, back } = TINY_PARTS;
    const cases: [string, string[], string][] = [
      [
        "arcs in a connection",
        [grp, a, note, edge0, back.replace("v -8", "a 4 4 0 0 1 4 4")],
        '"a"',
      ],
      [
        "a transformed shape",
        [grp, a.replace("<rect ", `<rect transform="scale(2)" `), note, edge0, back],
        "transform",
      ],
      [
        "a transformed element group",
        [grp, `<g transform="translate(5 5)">${a}</g>`, note, edge0, back],
        "transform",
      ],
      [
        "an unknown shape element",
        [grp, a.replace(/<rect [^>]*\/>/, `<image href="x.png"/>`), note, edge0, back],
        "<image>",
      ],
      [
        "a label without a font size",
        [grp, a.replace("font-size:16px", "fill:red"), note, edge0, back],
        "font-size",
      ],
      [
        "a label that is not centered",
        [grp, a.replace("text-anchor:middle", "text-anchor:start"), note, edge0, back],
        "text-anchor",
      ],
      [
        "a label whose lines advance by different amounts",
        [
          grp,
          a,
          note.replace('dy="16">te', 'dy="16">te</tspan><tspan x="170" dy="20">x'),
          edge0,
          back,
        ],
        "different line heights",
      ],
      [
        "a label line with a relative unit",
        [grp, a, note.replace('dy="16"', 'dy="1em"'), edge0, back],
        "dy",
      ],
      [
        "a label line at another x",
        [grp, a, note.replace('<tspan x="170" dy="16"', '<tspan x="20" dy="16"'), edge0, back],
        "different from its <text>",
      ],
      [
        "a box that draws nothing",
        [grp, a.replace(/<rect [^>]*\/>/, ""), note, edge0, back],
        "draws nothing",
      ],
    ];
    for (const [name, parts, message] of cases) {
      test(name, () => {
        const diagnostics = failure(tinySvg(parts));
        expect(codes(diagnostics)).toContain("svg/unsupported-geometry");
        expect(diagnostics.map((d) => d.message).join("\n")).toContain(message);
      });
    }

    test("transforms on any measured element or its ancestors", () => {
      const scale = 'transform="scale(2)" ';
      const cases: [string, string][] = [
        [
          "shape group",
          tinySvg([
            grp,
            a.replace('<g class="shape" >', `<g ${scale}class="shape" >`),
            note,
            edge0,
            back,
          ]),
        ],
        [
          "connection path",
          tinySvg([grp, a, note, edge0, back.replace("<path ", `<path ${scale}`)]),
        ],
        [
          "element group",
          tinySvg([grp, a.replace("<g class=", `<g ${scale}class=`), note, edge0, back]),
        ],
        [
          "label",
          tinySvg([grp, a.replace('<text x="45"', `<text ${scale}x="45"`), note, edge0, back]),
        ],
        [
          "drawing svg",
          tinySvg().replace('<svg class="d2-1 d2-svg"', `<svg ${scale}class="d2-1 d2-svg"`),
        ],
        ["root svg", tinySvg().replace("<svg xmlns=", `<svg ${scale}xmlns=`)],
        [
          "offset drawing svg",
          tinySvg().replace('<svg class="d2-1 d2-svg"', '<svg x="5" class="d2-1 d2-svg"'),
        ],
      ];
      for (const [where, svg] of cases) {
        const diagnostics = failure(svg);
        expect({ where, codes: [...new Set(codes(diagnostics))] }).toEqual({
          where,
          codes: ["svg/unsupported-geometry"],
        });
      }
      // x="0" on the drawing is harmless.
      inspect(
        tinySvg().replace('<svg class="d2-1 d2-svg"', '<svg x="0" y="0" class="d2-1 d2-svg"'),
      );
    });

    test("an edge without exactly one connection path is invalid", () => {
      const noPath = back.replace(/<path [^>]*\/>/, "");
      expect(failure(tinySvg([grp, a, note, edge0, noPath]))).toMatchObject([
        { code: "svg/invalid", subject: { kind: "edge", id: "back" } },
      ]);
    });
  });

  describe("rejects unreadable output", () => {
    const cases: [string, string, string][] = [
      ["empty text", "", "svg/empty"],
      ["malformed XML", tinySvg().replace("</svg></svg>", "</svg>"), "svg/invalid"],
      ["a DTD", `<!DOCTYPE svg>${tinySvg().replace(/^<\?xml[^>]*>/, "")}`, "svg/invalid"],
      ["a non-SVG root", `<html xmlns="http://www.w3.org/2000/svg"/>`, "svg/invalid"],
      ["no viewBox", tinySvg().replace(/ viewBox="0 0 200 100">/, ">"), "svg/invalid"],
      ["a zero-size canvas", tinySvg(undefined, { viewBox: "0 0 0 100" }), "svg/empty"],
      [
        "no drawing",
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>`,
        "svg/empty",
      ],
      [
        "two drawings",
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><svg class="d2-svg"><g/></svg><svg class="d2-svg"><g/></svg></svg>`,
        "svg/invalid",
      ],
    ];
    for (const [name, svg, code] of cases) {
      test(name, () => {
        expect(codes(failure(svg))).toEqual([code]);
      });
    }
  });
});
