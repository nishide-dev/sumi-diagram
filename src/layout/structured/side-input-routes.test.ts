import { expect, test } from "bun:test";
import { stringify } from "yaml";
import { lintGeometry } from "../../lint";
import { renderFigure } from "../../render";

type Rect = { x: number; y: number; width: number; height: number };

function crosses(points: readonly { x: number; y: number }[], rect: Rect): boolean {
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (a === undefined || b === undefined) continue;
    for (let t = 0; t <= 1; t += 0.005) {
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      if (x > rect.x && x < rect.x + rect.width && y > rect.y && y < rect.y + rect.height)
        return true;
    }
  }
  return false;
}

type Case = {
  direction: "up" | "down";
  align: "center" | "start" | "end";
  label: "after" | "before" | "west" | "east" | "north";
  fanIn: boolean;
  straight: boolean;
};

function source(c: Case): string {
  const items =
    c.label === "after"
      ? ["decoder", "queries", "ql"]
      : c.label === "before"
        ? ["decoder", "ql", "queries"]
        : ["decoder", "queries"];
  const side = c.direction === "up";
  return stringify({
    version: 1,
    figure: {
      id: "side-route",
      theme: "paper",
      profile: "paper-double",
      layout: {
        ...(c.fanIn ? { fanIn: "spread" } : {}),
        arrange: {
          row: {
            gap: "8mm",
            align: c.align,
            items: [
              "encoder",
              { stack: { direction: c.direction, centerOn: "decoder", gap: "4mm", items } },
              "predictions",
            ],
          },
        },
      },
    },
    nodes: [
      { id: "encoder", component: "box", label: "Encoder\nblocks\nand\nmore" },
      { id: "decoder", component: "box", label: "Decoder" },
      { id: "predictions", component: "box", label: "Predictions" },
      { id: "queries", component: "tokens", props: { cells: ["q1", "q2", "q3"] } },
      {
        id: "ql",
        component: "label",
        label: "N object queries",
        ...(["west", "east", "north"].includes(c.label)
          ? { attach: { to: "queries", side: c.label, gap: "1mm" } }
          : {}),
      },
    ],
    edges: [
      { from: "encoder", to: "decoder", ...(c.straight ? { route: "straight" } : {}) },
      { from: "decoder", to: "predictions" },
      {
        from: "queries",
        to: "decoder",
        fromAnchor: side ? "south" : "north",
        toAnchor: side ? "north" : "south",
      },
    ],
  });
}

const WATCHED = new Set([
  "geometry/edge-crosses-label",
  "geometry/edge-through-node",
  "geometry/label-collision",
  "geometry/node-overlap",
]);

// #357: a main-flow edge into a `centerOn` stack must either keep clear of the
// side input (its tokens and label) or come with a located diagnostic.
for (const direction of ["up", "down"] as const)
  for (const align of ["center", "start", "end"] as const)
    for (const label of ["after", "before", "west", "east", "north"] as const)
      for (const fanIn of [false, true])
        for (const straight of [false, true]) {
          const c: Case = { direction, align, label, fanIn, straight };
          test(`main-flow edge avoids side input or reports it (${JSON.stringify(c)})`, async () => {
            const text = source(c);
            const result = await renderFigure(text, {});
            if (!result.ok) {
              const errors = result.diagnostics.filter((d) => d.severity === "error");
              expect(errors.length).toBeGreaterThan(0);
              for (const d of errors) expect(d.location ?? d.path).toBeDefined();
              return;
            }
            const rendered = result.value;
            if (!("layout" in rendered)) throw new Error("expected structured layout");
            const { nodes, edges } = rendered.layout;
            const edge = edges.find((e) => e.from === "n:encoder" && e.to === "n:decoder");
            const points = edge?.route?.points ?? [];
            expect(points.length).toBeGreaterThanOrEqual(2);
            const sideRects = nodes
              .filter((n) => n.key === "n:ql" || n.key.startsWith("n:queries"))
              .map((n) => n.rect);
            expect(sideRects.length).toBeGreaterThan(0);
            if (!sideRects.some((r) => crosses(points, r))) return;
            const findings = [
              ...result.diagnostics,
              ...lintGeometry(rendered, { source: text }),
            ].filter((d) => WATCHED.has(d.code));
            expect(findings.length).toBeGreaterThan(0);
            for (const d of findings) expect(d.location ?? d.path).toBeDefined();
          });
        }

for (const direction of ["left", "right"] as const)
  for (const label of ["north", "south", "west", "east"] as const)
    test(`vertical main flow keeps clear of a ${direction} side input (label ${label})`, async () => {
      const text = stringify({
        version: 1,
        figure: {
          id: "side-route-v",
          theme: "paper",
          profile: "paper-double",
          layout: {
            arrange: {
              stack: {
                gap: "8mm",
                items: [
                  "encoder",
                  {
                    row: {
                      direction,
                      centerOn: "decoder",
                      gap: "4mm",
                      items: ["decoder", "queries"],
                    },
                  },
                  "predictions",
                ],
              },
            },
          },
        },
        nodes: [
          { id: "encoder", component: "box", label: "Encoder" },
          { id: "decoder", component: "box", label: "Decoder" },
          { id: "predictions", component: "box", label: "Predictions" },
          { id: "queries", component: "tokens", props: { cells: ["q1", "q2"] } },
          {
            id: "ql",
            component: "label",
            label: "N object queries",
            attach: { to: "queries", side: label, gap: "1mm" },
          },
        ],
        edges: [
          { from: "encoder", to: "decoder" },
          { from: "decoder", to: "predictions" },
          {
            from: "queries",
            to: "decoder",
            fromAnchor: direction === "left" ? "east" : "west",
            toAnchor: direction === "left" ? "west" : "east",
          },
        ],
      });
      const result = await renderFigure(text, {});
      if (!result.ok) {
        expect(result.diagnostics.some((d) => d.severity === "error" && d.location)).toBe(true);
        return;
      }
      const rendered = result.value;
      if (!("layout" in rendered)) throw new Error("expected structured layout");
      const edge = rendered.layout.edges.find((e) => e.from === "n:encoder");
      const points = edge?.route?.points ?? [];
      const rects = rendered.layout.nodes
        .filter((n) => n.key === "n:ql" || n.key.startsWith("n:queries"))
        .map((n) => n.rect);
      if (rects.some((r) => crosses(points, r)))
        expect(
          lintGeometry(rendered, { source: text }).some((d) => WATCHED.has(d.code) && d.location),
        ).toBe(true);
    });
