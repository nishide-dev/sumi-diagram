import { describe, expect, test } from "bun:test";
import { checkFigure } from "../check";
import { parseFigure } from "./check";
import { SetSchema } from "./schema";

const figure = (sets: string, layout = "arrange: { row: { items: [a, b, c] } }") => `version: 1
figure: { id: f, theme: color, layout: { ${layout} } }
nodes:
  - { id: a, component: box, label: A }
  - { id: b, component: box, label: B }
  - { id: c, component: box, label: C }
${sets}`;

const diagnostics = (source: string) =>
  checkFigure(source).state.diagnostics.map((d) => [d.code, d.path?.join("."), d.severity]);

describe("sets: schema", () => {
  test("accepts only the supported enclosure modes", () => {
    const set = { id: "s", members: ["a"] };
    expect(SetSchema.safeParse({ ...set, enclose: "body" }).success).toBe(true);
    expect(SetSchema.safeParse({ ...set, enclose: "footprint" }).success).toBe(true);
    expect(SetSchema.safeParse({ ...set, enclose: "glyph" }).success).toBe(false);
  });
  test("a set normalizes its defaults and keeps every member", () => {
    const parsed = parseFigure(
      figure("sets:\n  - { id: s, members: [a, b], tone: blue, label: Group }"),
    );
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
    expect(parsed.value.sets).toEqual([
      {
        id: "s",
        label: "Group",
        members: ["a", "b"],
        shape: "circle",
        variant: "default",
        tone: "blue",
      },
    ]);
  });

  test("a figure without sets has no sets field, so its parsed document does not change", () => {
    const parsed = parseFigure(figure(""));
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
    expect("sets" in parsed.value).toBe(false);
  });

  test("every field is validated: shape, label position, variant, opacity, padding, members", () => {
    const bad = (field: string) =>
      SetSchema.safeParse({ id: "s", members: ["a"], ...JSON.parse(`{${field}}`) }).success;
    expect(bad('"shape": "star"')).toBe(false);
    expect(bad('"labelAt": "center"')).toBe(false);
    expect(bad('"variant": "solid"')).toBe(false);
    expect(bad('"fillOpacity": 1.5')).toBe(false);
    expect(bad('"padding": 3')).toBe(false);
    expect(bad('"padding": "3mm"')).toBe(true);
    expect(bad('"members": []')).toBe(false);
    expect(bad('"members": ["A"]')).toBe(false);
    expect(bad('"colour": "red"')).toBe(false);
  });
});

describe("sets: references", () => {
  test("members may be nodes or groups, in any number of sets (many to many)", () => {
    const source = `version: 1
figure: { id: f, layout: { arrange: { row: { items: [g, c] } } } }
groups:
  - { id: g, arrange: { row: { items: [a, b] } } }
nodes:
  - { id: a, component: box, label: A }
  - { id: b, component: box, label: B }
  - { id: c, component: box, label: C }
sets:
  - { id: s1, members: [a, b] }
  - { id: s2, members: [b, c] }
  - { id: s3, members: [g, c] }
`;
    expect(diagnostics(source)).toEqual([]);
  });

  test("an unknown member is ref/unknown-set-member with a suggestion", () => {
    const check = checkFigure(figure("sets:\n  - { id: s, members: [a, bb] }"));
    const [d] = check.state.diagnostics;
    expect(check.state.diagnostics).toHaveLength(1);
    expect(d).toMatchObject({
      code: "ref/unknown-set-member",
      severity: "error",
      path: ["sets", 0, "members", 1],
      subject: { kind: "set", id: "s" },
      hint: 'Did you mean "b"?',
    });
    expect(d?.location?.line).toBeGreaterThan(0);
  });

  test("a member listed twice is ref/duplicate-set-member and points at the first", () => {
    const check = checkFigure(figure("sets:\n  - { id: s, members: [a, b, a] }"));
    expect(check.state.diagnostics.map((d) => [d.code, d.path?.join(".")])).toEqual([
      ["ref/duplicate-set-member", "sets.0.members.2"],
    ]);
    expect(check.state.diagnostics[0]?.related?.[0]?.path).toEqual(["sets", 0, "members", 0]);
  });

  test("set IDs are unique among sets but may equal a node ID", () => {
    expect(
      diagnostics(figure("sets:\n  - { id: a, members: [a] }\n  - { id: s, members: [b] }")),
    ).toEqual([]);
    expect(
      diagnostics(figure("sets:\n  - { id: s, members: [a] }\n  - { id: s, members: [b] }")),
    ).toEqual([["ref/duplicate-id", "sets.1.id", "error"]]);
  });

  test("a member with an error of its own is not reported again", () => {
    const source = figure("sets:\n  - { id: s, members: [a, broken] }").replace(
      "nodes:",
      "nodes:\n  - { id: broken, component: nonexistent, label: X }",
    );
    expect(diagnostics(source).filter(([code]) => code === "ref/unknown-set-member")).toEqual([]);
  });
});

describe("sets: engine", () => {
  test("the auto layout cannot draw sets: layout/structured-only", () => {
    const check = checkFigure(figure("sets:\n  - { id: s, members: [a, b] }", "direction: right"));
    expect(check.state.diagnostics.map((d) => [d.code, d.path?.join(".")])).toEqual([
      ["layout/structured-only", "sets.0"],
    ]);
    expect(check.state.diagnostics[0]?.hint).toContain("figure.layout.arrange");
  });

  test("an invalid set is dropped from the document, so later stages never see it", () => {
    const check = checkFigure(figure("sets:\n  - { id: s, members: [a, nope] }"));
    expect(check.state.doc.sets).toEqual([undefined]);
  });
});

describe("sets: angle (#430)", () => {
  const set = (fields: string) => `sets:\n  - { id: s, members: [a, b], ${fields} }`;

  test("angle is a number of degrees from -180 to 180, or auto", () => {
    const ok = (angle: unknown) =>
      SetSchema.safeParse({ id: "s", members: ["a"], shape: "ellipse", angle }).success;
    expect(ok(30)).toBe(true);
    expect(ok(-180)).toBe(true);
    expect(ok(0)).toBe(true);
    expect(ok("auto")).toBe(true);
    expect(ok(181)).toBe(false);
    expect(ok("30")).toBe(false);
    expect(ok("diagonal")).toBe(false);
  });

  test("an ellipse takes angle; without it the parsed set has no angle", () => {
    expect(diagnostics(figure(set("shape: ellipse, angle: auto")))).toEqual([]);
    expect(diagnostics(figure(set("shape: ellipse, angle: -35")))).toEqual([]);
    const parsed = parseFigure(figure(set("shape: ellipse")));
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
    expect("angle" in (parsed.value.sets?.[0] ?? {})).toBe(false);
  });

  test("angle on a circle, hull or rect is ref/set-angle-needs-ellipse, and drops the set", () => {
    for (const shape of ["circle", "hull", "rect"]) {
      const check = checkFigure(figure(set(`shape: ${shape}, angle: 30`)));
      expect(check.state.diagnostics.map((d) => [d.code, d.path?.join("."), d.severity])).toEqual([
        ["ref/set-angle-needs-ellipse", "sets.0.angle", "error"],
      ]);
      expect(check.state.diagnostics[0]?.hint).toContain("shape: ellipse");
      expect(check.state.doc.sets).toEqual([undefined]);
    }
    // The default shape is a circle.
    expect(diagnostics(figure(set("angle: auto"))).map(([code]) => code)).toEqual([
      "ref/set-angle-needs-ellipse",
    ]);
  });
});
