/** Network-free, D2-free checks of the #86 prototype. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkLayout } from "./check";
import { importSvg } from "./icons";
import { runPrototype } from "./index";
import { ModelError, parseModel } from "./model";
import { parseRuns, TextError } from "./text";

const figure = (name: string) =>
  readFileSync(join(import.meta.dir, "..", "figures", "ideal", `${name}.sumi.yaml`), "utf8");

const MINIMAL = `
version: 1
figure:
  id: t
  layout:
    engine: structured
    arrange:
      stack: { items: [a, b] }
nodes:
  - { id: a, component: box, label: A }
  - { id: b, component: box, label: B }
edges:
  - { from: a, to: b }
`;

describe("model", () => {
  test("accepts the minimal structured figure", () => {
    expect(parseModel(MINIMAL).nodes.size).toBe(2);
  });
  test("rejects unknown fields, unplaced and twice-placed items, bad anchors", () => {
    expect(() => parseModel(MINIMAL.replace("label: A", "label: A, colour: red"))).toThrow(
      ModelError,
    );
    expect(() => parseModel(MINIMAL.replace("items: [a, b]", "items: [a]"))).toThrow(/not placed/);
    expect(() => parseModel(MINIMAL.replace("items: [a, b]", "items: [a, b, a]"))).toThrow(/twice/);
    expect(() => parseModel(MINIMAL.replace("to: b }", "to: b, toAnchor: up }"))).toThrow(/side/);
    expect(() => parseModel(MINIMAL.replace("to: b }", 'to: b, toAnchor: "south:1.5" }'))).toThrow(
      /side/,
    );
  });
});

describe("label math subset", () => {
  test("Greek, sub- and superscripts", () => {
    expect(parseRuns("$\\gamma_1,\\beta_1$")).toEqual([
      { text: "γ", script: 0 },
      { text: "1", script: 1 },
      { text: ",β", script: 0 },
      { text: "1", script: 1 },
    ]);
    expect(parseRuns("Timestep $t$")).toEqual([{ text: "Timestep t", script: 0 }]);
    expect(parseRuns("$I_{13-16}$")).toEqual([
      { text: "I", script: 0 },
      { text: "13-16", script: 1 },
    ]);
  });
  test("unsupported input is an error, not a guess", () => {
    expect(() => parseRuns("$\\frac{a}{b}$")).toThrow(TextError);
    expect(() => parseRuns("cost $5")).toThrow(TextError);
  });
});

describe("SVG import allowlist", () => {
  test("keeps geometry, drops active content and transforms", () => {
    const icon = importSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke="currentColor"><script>x</script><path d="M1 1L5 5" onclick="x"/><g transform="rotate(4)"><circle cx="1" cy="1" r="1"/></g><foreignObject/><path d="M0 0A5 5 0 0 1 9 9"/><image href="x.png"/></svg>',
    );
    expect(icon.markup).toBe(
      '<path d="M1 1L5 5" stroke="currentColor"/><circle cx="1" cy="1" r="1" stroke="currentColor"/>',
    );
    expect(icon.rejected).toEqual([
      "script",
      "path@onclick",
      "g@transform",
      "foreignObject",
      "path@d",
      "image",
    ]);
  });
  test("validates inherited and local paint values", () => {
    const icon = importSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke="url(#x)" stroke-width="2"><path d="M1 1L2 2" fill="red" stroke-linecap="javascript:x"/></svg>',
    );
    expect(icon.markup).toBe('<path d="M1 1L2 2" stroke-width="2"/>');
    expect(icon.rejected).toEqual([
      "svg@stroke=url(#x)",
      "path@fill=red",
      "path@stroke-linecap=javascript:x",
    ]);
  });
  test("entity-encoded quotes cannot inject attributes", () => {
    const icon = importSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke="&quot; onmouseover=&quot;alert(1)"><path d="M0 0L1 1"/></svg>',
    );
    expect(icon.markup).toBe('<path d="M0 0L1 1"/>');
    expect(icon.rejected).toEqual(['svg@stroke=" onmouseover="alert(1)']);
    expect(icon.markup).not.toContain("onmouseover");
  });
  test("refuses DTDs (XXE / entity expansion)", () => {
    expect(() =>
      importSvg(
        '<!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>',
      ),
    ).toThrow();
  });
});

describe("checker negative cases", () => {
  // Two unrelated nets: (0,0)→(40,0) and (20,-20)→(20,0) ends on the first one (a T contact),
  // and an arrow whose head lies on the other net.
  const model = parseModel(MINIMAL);
  const layout = {
    nodes: new Map([
      ["a", { x: 0, y: 0, w: 0, h: 0 }],
      ["b", { x: 40, y: 0, w: 0, h: 0 }],
    ]),
    groups: new Map([["g", { x: 10, y: -30, w: 20, h: 20 }]]),
    captions: new Map(),
    labels: new Map(),
    width: 100,
    height: 100,
  };
  const edge = (index: number) => ({
    index,
    from: "a",
    to: "b",
    fromAnchor: undefined,
    toAnchor: undefined,
    arrow: true,
    label: "",
  });
  const routed = [
    {
      edge: edge(0),
      net: "p",
      points: [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
      ],
      toSide: undefined,
      fromSide: undefined,
    },
    {
      edge: edge(1),
      net: "q",
      points: [
        { x: 20, y: -20 },
        { x: 20, y: 0 },
      ],
      toSide: undefined,
      fromSide: undefined,
    },
    {
      // ends 3 units below net p: its arrowhead (9 long) reaches across p
      edge: edge(2),
      net: "r",
      points: [
        { x: 36, y: -20 },
        { x: 36, y: 3 },
      ],
      toSide: undefined,
      fromSide: undefined,
    },
  ];
  const placed = [
    {
      edge: 1,
      rect: { x: 25, y: -14, w: 10, h: 8 },
      label: { lines: [], width: 10, height: 8, size: 14, bold: false },
    },
  ];
  const report = checkLayout(model, layout, routed, placed);
  test("T contacts, arrowheads on another net and labels across a border are reported", () => {
    expect(report.crossings).toBe(1); // only e#2 properly crosses e#0 …
    expect(report.contacts).toEqual(["e#1 vertex on e#0"]); // … e#1 ends on it (T contact)
    expect(report.arrowheadHits).toEqual(["e#0 head / e#2", "e#2 head / e#0"]);
    expect(report.labelCollisions).toEqual(["e#1 label / border g"]);
  });
});

describe("figure A (Transformer)", () => {
  const result = runPrototype(figure("a-transformer"));
  test("no geometry violations", () => {
    const c = result.checks;
    expect(c.nonOrthogonalSegments).toBe(0);
    expect(c.edgeThroughNode).toEqual([]);
    expect(c.misplacedEnds).toEqual([]);
    expect(c.crossings).toBe(0);
    expect(c.overlapLength).toBe(0);
    expect(c.nodeOverlaps).toEqual([]);
    expect(c.containment).toEqual([]);
    expect(c.contacts).toEqual([]);
    expect(c.arrowheadHits).toEqual([]);
  });
  test("deterministic", () => {
    expect(runPrototype(figure("a-transformer")).svg).toBe(result.svg);
  });
  test("stacked blocks touch and share one axis", () => {
    const r = (id: string) => result.layout.nodes.get(id);
    const mha = r("enc-mha");
    const norm = r("enc-norm1");
    expect(mha && norm && mha.y - (norm.y + norm.h)).toBe(0);
    const blocks = ["enc-mha", "enc-norm1", "enc-ff", "enc-norm2"].map(r);
    expect(new Set(blocks.map((b) => `${b?.x}/${b?.w}`)).size).toBe(1);
    const add = r("enc-add");
    const mid = (b: typeof mha) => (b === undefined ? Number.NaN : b.x + b.w / 2);
    expect(mid(add)).toBeCloseTo(mid(mha), 6);
  });
  test("one source port feeding two targets shares a trunk (encoder → decoder K, V)", () => {
    const kv = result.routed.filter((e) => e.edge.from === "enc-norm2");
    expect(kv).toHaveLength(2);
    expect(kv[0]?.net).toBe(kv[1]?.net ?? "");
    expect(kv[0]?.points.slice(0, 3)).toEqual(kv[1]?.points.slice(0, 3) ?? []);
  });
});

describe("figure B panel (adaLN-Zero)", () => {
  const result = runPrototype(figure("b-adaln-panel"));
  test("bus with four taps, labels next to the arrowheads without collisions", () => {
    expect(result.checks.crossings).toBe(0);
    expect(result.checks.edgeThroughNode).toEqual([]);
    expect(result.checks.labelCollisions).toEqual([]);
    expect(result.checks.contacts).toEqual([]);
    expect(result.checks.arrowheadHits).toEqual([]);
    expect(result.edgeLabels.map((l) => l.edge)).toHaveLength(4);
    expect(new Set(result.routed.filter((e) => e.edge.from === "mlp").map((e) => e.net)).size).toBe(
      1,
    );
  });
  test("caption is below the panel", () => {
    const panel = result.layout.groups.get("panel");
    const caption = result.layout.captions.get("panel");
    expect(panel && caption && caption.y > panel.y + panel.h).toBe(true);
  });
});
