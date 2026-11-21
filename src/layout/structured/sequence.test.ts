/**
 * Sequence diagrams (#630, design record 630): the geometry of the
 * `sequence` arrange box — lifelines from the participants, rows in order,
 * self-messages, notes, bands and fragments — and the check-stage errors.
 */
import { describe, expect, test } from "bun:test";
import { checkFigure } from "../../core/check";
import type { Rect } from "../../core/geometry";
import { layoutStructuredFigure } from "../index";
import type { EdgeLayout, LayoutIR } from "../ir";

const figure = (rows: string, extra = { nodes: "", edges: "", sequence: "" }) => `version: 1
figure:
  id: seq
  theme: sumi
  layout:
    arrange:
      sequence:
        participants: [a, b, c]
${extra.sequence}        rows:
${rows}
nodes:
  - {id: a, component: box, label: Alice}
  - {id: b, component: box, label: Bob}
  - {id: c, component: box, label: Carol}
${extra.nodes}edges:
  - {id: ab, from: a, to: b, label: hello}
  - {id: ba, from: b, to: a, variant: dashed, label: hi}
  - {id: bc, from: b, to: c, label: forward the request}
  - {id: ca, from: c, to: a, variant: dashed, label: done}
  - {id: cc, from: c, to: c, label: think}
${extra.edges}`;

function layout(text: string) {
  const result = layoutStructuredFigure(text);
  if (!result.ok)
    throw new Error(result.diagnostics.map((d) => `${d.code} ${d.message}`).join("\n"));
  const { layout } = result.value;
  const rect = (key: string): Rect => {
    const n = [...layout.nodes, ...layout.groups].find((n) => n.key === key);
    if (!n) throw new Error(`missing ${key}`);
    return n.rect;
  };
  const edge = (key: string): EdgeLayout => {
    const e = layout.edges.find((e) => e.key === key);
    if (!e) throw new Error(`missing ${key}`);
    return e;
  };
  const cx = (key: string) => rect(key).x + rect(key).width / 2;
  const cy = (key: string) => rect(key).y + rect(key).height / 2;
  return { layout, rect, edge, cx, cy, diagnostics: result.diagnostics, ir: result.value.ir };
}

const errorCodes = (text: string) =>
  checkFigure(text)
    .state.diagnostics.filter((d) => d.severity === "error")
    .map((d) => d.code);

const lifelines = (layout: LayoutIR, participant: number) =>
  layout.edges.filter((e) => e.key.startsWith(`e:seq-1-life-${participant}-`));

describe("sequence geometry (#630)", () => {
  test("messages run between the lifelines, which stand under the participants' centres", () => {
    const p = layout(figure("          - ab\n          - bc\n          - ca"));
    expect(p.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
    // Participants side by side, left to right, tops aligned (equal heights).
    expect(p.rect("n:a").x + p.rect("n:a").width).toBeLessThan(p.rect("n:b").x);
    expect(p.rect("n:b").x + p.rect("n:b").width).toBeLessThan(p.rect("n:c").x);
    expect(p.rect("n:a").y).toBe(p.rect("n:b").y);
    // Each message's junctions sit on its participants' lifelines, at one y.
    for (const [m, from, to] of [
      [1, "a", "b"],
      [2, "b", "c"],
      [3, "c", "a"],
    ] as const) {
      expect(p.cx(`n:seq-1-m${m}-from`)).toBeCloseTo(p.cx(`n:${from}`), 3);
      expect(p.cx(`n:seq-1-m${m}-to`)).toBeCloseTo(p.cx(`n:${to}`), 3);
      expect(p.cy(`n:seq-1-m${m}-from`)).toBeCloseTo(p.cy(`n:seq-1-m${m}-to`), 3);
    }
    // The edge itself is retargeted and drawn straight, horizontally.
    const ab = p.edge("e:ab");
    expect(ab.from).toBe("n:seq-1-m1-from");
    const points = ab.route?.points ?? [];
    expect(points).toHaveLength(2);
    expect(points[0]?.y).toBeCloseTo(points[1]?.y ?? Number.NaN, 3);
    // Every lifeline is one vertical line from its head down to its end.
    for (const i of [1, 2, 3]) {
      const pieces = lifelines(p.layout, i);
      expect(pieces.length).toBeGreaterThan(0);
      for (const piece of pieces)
        for (const point of piece.route?.points ?? [])
          expect(point.x).toBeCloseTo(p.cx(["n:a", "n:b", "n:c"][i - 1] as string), 3);
    }
  });

  test("rows run top to bottom in the order written, and a new row moves no x", () => {
    const three = layout(figure("          - ab\n          - bc\n          - ca"));
    const ys = [1, 2, 3].map((m) => three.cy(`n:seq-1-m${m}-from`));
    expect(ys[0]).toBeLessThan(ys[1] as number);
    expect(ys[1]).toBeLessThan(ys[2] as number);
    // A row added in the middle: the others keep their order and lifelines.
    const four = layout(figure("          - ab\n          - ba\n          - bc\n          - ca"));
    expect(four.cy("n:seq-1-m2-from")).toBeGreaterThan(four.cy("n:seq-1-m1-from"));
    expect(four.cy("n:seq-1-m3-from")).toBeGreaterThan(four.cy("n:seq-1-m2-from"));
    for (const id of ["n:a", "n:b", "n:c"])
      expect(four.cx(id) - four.cx("n:a")).toBeCloseTo(three.cx(id) - three.cx("n:a"), 3);
  });

  test("a gap is as wide as the label it holds, clear of both lifelines", () => {
    const p = layout(figure("          - ab\n          - bc"));
    const label = p.edge("e:bc").route?.label;
    if (!label) throw new Error("no label");
    expect(label.box.x).toBeGreaterThan(p.cx("n:b"));
    expect(label.box.x + label.box.width).toBeLessThan(p.cx("n:c"));
    // Above its line, whichever way the message runs.
    for (const key of ["e:bc", "e:ca"]) {
      const q = layout(figure("          - bc\n          - ca"));
      const route = q.edge(key).route;
      const box = route?.label?.box;
      if (!route || !box) throw new Error("no label");
      expect(box.y + box.height).toBeLessThanOrEqual((route.points[0]?.y ?? 0) + 1e-6);
    }
  });

  test("a message over several lifelines keeps its label in the gap next to its source", () => {
    const p = layout(figure("          - ca"));
    const label = p.edge("e:ca").route?.label;
    if (!label) throw new Error("no label");
    expect(label.box.x).toBeGreaterThan(p.cx("n:b"));
    expect(label.box.x + label.box.width).toBeLessThan(p.cx("n:c"));
  });

  test("a self-message loops east between two junctions, its label beside the loop", () => {
    const p = layout(figure("          - ab\n          - cc\n          - ca"));
    expect(p.cx("n:seq-1-m2-from")).toBeCloseTo(p.cx("n:c"), 3);
    expect(p.cx("n:seq-1-m2-to")).toBeCloseTo(p.cx("n:c"), 3);
    expect(p.cy("n:seq-1-m2-to")).toBeGreaterThan(p.cy("n:seq-1-m2-from"));
    const route = p.edge("e:cc").route;
    if (!route?.label) throw new Error("no route");
    const east = Math.max(...route.points.map((q) => q.x));
    expect(east).toBeGreaterThan(p.cx("n:c"));
    expect(route.label.box.x).toBeGreaterThan(east);
    // The next row starts below the loop.
    expect(p.cy("n:seq-1-m3-from")).toBeGreaterThan(p.cy("n:seq-1-m2-to"));
  });

  test("notes: over one lifeline, spread over several, beside one", () => {
    const p = layout(
      figure(
        "          - ab\n          - {note: n1, over: [b]}\n          - {note: n2, over: [a, c]}\n          - {note: n3, over: [a], side: right}\n          - bc",
        {
          nodes:
            "  - {id: n1, component: box, label: one}\n  - {id: n2, component: box, label: two}\n  - {id: n3, component: box, label: three}\n",
          edges: "",
          sequence: "",
        },
      ),
    );
    expect(p.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
    expect(p.cx("n:n1")).toBeCloseTo(p.cx("n:b"), 3);
    // Spread over a..c: it covers every lifeline from a to c.
    expect(p.rect("n:n2").x).toBeLessThan(p.cx("n:a"));
    expect(p.rect("n:n2").x + p.rect("n:n2").width).toBeGreaterThan(p.cx("n:c"));
    // Beside a: right of its lifeline, left of b's.
    expect(p.rect("n:n3").x).toBeGreaterThan(p.cx("n:a"));
    expect(p.rect("n:n3").x + p.rect("n:n3").width).toBeLessThan(p.cx("n:b"));
    // Rows in order.
    expect(p.rect("n:n1").y).toBeGreaterThan(p.cy("n:seq-1-m1-from"));
    expect(p.rect("n:n2").y).toBeGreaterThan(p.rect("n:n1").y + p.rect("n:n1").height);
    // The lifelines stop above a note over them and resume below it: no piece crosses the note.
    for (const piece of lifelines(p.layout, 2)) {
      const [s, t] = piece.route?.points ?? [];
      if (!s || !t) continue;
      const n1 = p.rect("n:n1");
      expect(Math.max(s.y, t.y) <= n1.y || Math.min(s.y, t.y) >= n1.y + n1.height).toBe(true);
    }
    // The side note does not interrupt a's lifeline.
    const n3 = p.rect("n:n3");
    expect(
      lifelines(p.layout, 1).some((piece) => {
        const [s, t] = piece.route?.points ?? [];
        return s !== undefined && t !== undefined && s.y < n3.y && t.y > n3.y + n3.height;
      }),
    ).toBe(true);
  });

  test("a band puts its rows side by side from one top", () => {
    const p = layout(
      figure("          - [ab, {note: n1, over: [c]}]\n          - bc", {
        nodes: "  - {id: n1, component: box, label: busy}\n",
        edges: "",
        sequence: "",
      }),
    );
    const labelTop = p.edge("e:ab").route?.label?.box.y ?? Number.NaN;
    expect(Math.abs(labelTop - p.rect("n:n1").y)).toBeLessThan(6);
    expect(p.cy("n:seq-1-m2-from")).toBeGreaterThan(p.rect("n:n1").y + p.rect("n:n1").height);
  });

  test("a fragment frames its rows, heading left of its first lifeline", () => {
    const p = layout(
      figure("          - ab\n          - {fragment: loop, rows: [bc, cc]}\n          - ca"),
    );
    expect(p.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
    const frame = p.layout.sets?.find((s) => s.id === "seq-1-f1")?.rect;
    if (!frame) throw new Error("no frame");
    // The frame spans exactly its corner junctions.
    expect(frame.x).toBeCloseTo(p.rect("n:seq-1-f1-start").x, 1);
    expect(frame.y).toBeCloseTo(p.rect("n:seq-1-f1-start").y, 1);
    const end = p.rect("n:seq-1-f1-end");
    expect(frame.x + frame.width).toBeCloseTo(end.x + end.width, 1);
    expect(frame.y + frame.height).toBeCloseTo(end.y + end.height, 1);
    // It holds its rows (and the self-message's label), and not the rows around it.
    for (const key of ["n:seq-1-m2-from", "n:seq-1-m3-to"]) {
      expect(p.cy(key)).toBeGreaterThan(frame.y);
      expect(p.cy(key)).toBeLessThan(frame.y + frame.height);
    }
    const loopLabel = p.edge("e:cc").route?.label?.box;
    if (!loopLabel) throw new Error("no label");
    expect(loopLabel.x + loopLabel.width).toBeLessThan(frame.x + frame.width);
    expect(p.cy("n:seq-1-m1-from")).toBeLessThan(frame.y);
    expect(p.cy("n:seq-1-m4-from")).toBeGreaterThan(frame.y + frame.height);
    // The heading sits inside, left of b's lifeline and right of a's.
    const heading = p.rect("n:seq-1-f1-label");
    expect(heading.x).toBeGreaterThan(frame.x);
    expect(heading.x + heading.width).toBeLessThan(p.cx("n:b"));
    expect(frame.x).toBeGreaterThan(p.cx("n:a"));
  });

  test("participantGap and rowGap set the least spacing", () => {
    const narrow = layout(figure("          - ab"));
    const wide = layout(
      figure("          - ab", {
        nodes: "",
        edges: "",
        sequence: "        participantGap: 40mm\n",
      }),
    );
    const gap = (p: ReturnType<typeof layout>) =>
      p.rect("n:b").x - (p.rect("n:a").x + p.rect("n:a").width);
    expect(gap(wide)).toBeCloseTo(((40 * 72) / 25.4) * 2, 0);
    expect(gap(narrow)).toBeLessThan(gap(wide));
  });

  test("lifelines are thinner than the messages and dashed by default", () => {
    const p = layout(figure("          - ab"));
    const life = p.ir.edges.find((e) => e.key === "e:seq-1-life-1-1");
    const message = p.ir.edges.find((e) => e.key === "e:ab");
    expect(life?.lifeline).toBe(true);
    expect(life?.style.strokeWidth.pt).toBeLessThan(message?.style.strokeWidth.pt ?? 0);
    expect((life?.style as { strokeDash?: number } | undefined)?.strokeDash).toBeGreaterThan(0);
    const solid = layout(
      figure("          - ab", {
        nodes: "",
        edges: "",
        sequence: "        lifeline: {dash: solid, lineWidth: 1pt}\n",
      }),
    );
    const plain = solid.ir.edges.find((e) => e.key === "e:seq-1-life-1-1");
    expect(plain?.style.strokeWidth.pt).toBe(1);
    expect((plain?.style as { strokeDash?: number } | undefined)?.strokeDash ?? 0).toBe(0);
  });
});

describe("sequence errors (#630)", () => {
  test("a row must name an edge between participants, once", () => {
    expect(errorCodes(figure("          - nope"))).toContain("layout/sequence-unknown-message");
    expect(errorCodes(figure("          - ab\n          - ab"))).toContain(
      "layout/sequence-invalid-row",
    );
    expect(
      errorCodes(
        figure("          - ad", {
          nodes: "  - {id: d, component: box, label: D}\n",
          edges: "  - {id: ad, from: a, to: d}\n",
          sequence: "",
        }).replace("participants: [a, b, c]", "participants: [a, b, c]\n      # d is placed below"),
      ),
    ).toContain("layout/sequence-unknown-participant");
  });

  test("a note beside a lifeline names one; a band's rows use different lifelines", () => {
    const notes = { nodes: "  - {id: n1, component: box, label: n}\n", edges: "", sequence: "" };
    expect(
      errorCodes(figure("          - {note: n1, over: [a, b], side: right}", notes)),
    ).toContain("layout/sequence-invalid-row");
    expect(errorCodes(figure("          - [ab, bc]"))).toContain("layout/sequence-invalid-row");
    expect(errorCodes(figure("          - [ab, {note: n1, over: [c]}]", notes))).toEqual([]);
  });

  test("band members may not cover the same lifelines or gap (regression: side notes)", () => {
    const notes = {
      nodes: "  - {id: n1, component: box, label: n}\n  - {id: n2, component: box, label: m}\n",
      edges: "",
      sequence: "",
    };
    const invalid = (rows: string) => {
      const diagnostics = checkFigure(figure(rows, notes)).state.diagnostics.filter(
        (d) => d.code === "layout/sequence-invalid-row",
      );
      return diagnostics.map((d) => d.message);
    };
    // A note beside a's lifeline sits in the gap the message a → b runs through.
    const [message] = invalid("          - [ab, {note: n1, over: [a], side: right}]");
    expect(message).toContain('message "ab"');
    expect(message).toContain('note "n1"');
    expect(invalid("          - [ab, {note: n1, over: [b], side: left}]")).toHaveLength(1);
    // A self-message's loop and a note beside it, both right of c's lifeline.
    expect(invalid("          - [cc, {note: n1, over: [c], side: right}]")).toHaveLength(1);
    // A note over a lifeline and one beside it.
    expect(
      invalid("          - [{note: n1, over: [a]}, {note: n2, over: [a], side: right}]"),
    ).toHaveLength(1);
    // Facing sides of one gap, and a loop next to a note over the next lifeline: allowed.
    expect(
      invalid(
        "          - [{note: n1, over: [a], side: right}, {note: n2, over: [b], side: left}]",
      ),
    ).toEqual([]);
    expect(invalid("          - [ab, {note: n1, over: [c], side: right}]")).toEqual([]);
  });

  test("allowed band members that share a gap are laid out clear of each other", () => {
    const p = layout(
      figure(
        "          - [{note: n1, over: [a], side: right}, {note: n2, over: [b]}]\n          - ab",
        {
          nodes:
            "  - {id: n1, component: box, label: a wide side note}\n  - {id: n2, component: box, label: a wide note over b}\n",
          edges: "",
          sequence: "",
        },
      ),
    );
    expect(p.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
    expect(p.rect("n:n1").x + p.rect("n:n1").width).toBeLessThan(p.rect("n:n2").x);
  });

  test("generated IDs are reserved; the auto engine cannot draw a sequence", () => {
    expect(
      errorCodes(
        figure("          - ab", {
          nodes: "  - {id: seq-1-m1-from, component: box, label: x}\n",
          edges: "",
          sequence: "",
        }),
      ),
    ).toContain("ref/reserved-id");
    const auto = figure("          - ab").replace("  layout:\n", "  layout:\n    engine: auto\n");
    expect(errorCodes(auto)).toContain("layout/structured-only");
  });

  test("a self-message loops east or west: other lanes are errors, west is checked and laid out", () => {
    const west = {
      nodes: "  - {id: n1, component: box, label: a note}\n",
      edges: "  - {id: bb, from: b, to: b, label: back, lane: {side: west}}\n",
      sequence: "",
    };
    // West of b's lifeline, the loop shares the a–b gap with a note right of a: allowed, and
    // the gap holds both.
    const p = layout(
      figure("          - [bb, {note: n1, over: [a], side: right}]\n          - ab", west),
    );
    expect(p.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
    const route = p.edge("e:bb").route;
    if (!route?.label) throw new Error("no route");
    const westmost = Math.min(...route.points.map((q) => q.x), route.label.box.x);
    expect(westmost).toBeLessThan(p.cx("n:b"));
    expect(westmost).toBeGreaterThan(p.rect("n:n1").x + p.rect("n:n1").width);
    // Its label is outside the loop, west of it.
    expect(route.label.box.x + route.label.box.width).toBeLessThanOrEqual(
      Math.min(...route.points.map((q) => q.x)) + 1e-6,
    );
    // A note left of b would sit on the loop.
    expect(
      errorCodes(figure("          - [bb, {note: n1, over: [b], side: left}]", west)),
    ).toContain("layout/sequence-invalid-row");
    for (const lane of ["{side: north}", "{side: east, outside: a}"])
      expect(
        errorCodes(
          figure("          - bb", {
            nodes: "",
            edges: `  - {id: bb, from: b, to: b, lane: ${lane}}\n`,
            sequence: "",
          }),
        ),
      ).toContain("layout/sequence-invalid-row");
  });

  test("a note over several lifelines must be able to widen", () => {
    const note = (node: string) =>
      figure("          - {note: n1, over: [a, c]}", {
        nodes: `${node}\n`,
        edges: "",
        sequence: "",
      });
    const fixed = layoutStructuredFigure(note("  - {id: n1, component: circle, label: n}"));
    expect(fixed.diagnostics.map((d) => d.code)).toContain("layout/sequence-invalid-row");
    expect(fixed.ok).toBe(false);
    const sized = layoutStructuredFigure(
      note("  - {id: n1, component: box, label: n, props: {width: 10mm}}"),
    );
    expect(sized.diagnostics.map((d) => d.code)).toContain("layout/sequence-invalid-row");
    // Over one lifeline any component is fine.
    const one = layoutStructuredFigure(
      figure("          - {note: n1, over: [b]}", {
        nodes: "  - {id: n1, component: circle, label: n}\n",
        edges: "",
        sequence: "",
      }),
    );
    expect(one.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  test("dash: solid makes the lifelines solid even on a dashed variant", () => {
    const p = layout(
      figure("          - ab", {
        nodes: "",
        edges: "",
        sequence: "        lifeline: {variant: dashed, dash: solid}\n",
      }),
    );
    const life = p.ir.edges.find((e) => e.key === "e:seq-1-life-1-1");
    expect(life?.variant).toBe("dashed");
    expect((life?.style as { strokeDash?: number }).strokeDash).toBe(0);
    expect((life?.style as { strokeDotted?: true }).strokeDotted).toBeUndefined();
    const dotted = layout(
      figure("          - ab", {
        nodes: "",
        edges: "",
        sequence: "        lifeline: {variant: dotted, dash: solid}\n",
      }),
    );
    const plain = dotted.ir.edges.find((e) => e.key === "e:seq-1-life-1-1");
    expect((plain?.style as { strokeDotted?: true }).strokeDotted).toBeUndefined();
  });
});
