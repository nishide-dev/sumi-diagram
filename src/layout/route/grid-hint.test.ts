import { expect, test } from "bun:test";
import { parse, stringify } from "yaml";
import { layoutStructuredFigure } from "../index";
import { checkRoutes } from "./check";

function source(align?: string, props?: object, component = "box", blocked = false) {
  const patches = Array.from({ length: 10 }, (_, i) => `p${i}`);
  const encoded = Array.from({ length: 10 }, (_, i) => `e${i}`);
  return stringify({
    version: 1,
    figure: {
      id: "grid-spans",
      theme: "paper",
      profile: "paper-double",
      layout: {
        arrange: {
          grid: {
            columns: 10,
            align,
            rowGap: "12pt",
            columnGap: "4pt",
            items: [
              { item: "encoder", span: 10 },
              ...(blocked ? [] : encoded),
              null,
              { item: "projection", span: 9 },
              ...patches,
            ],
          },
        },
      },
    },
    nodes: [
      { id: "encoder", component, label: "Encoder", props },
      {
        id: "projection",
        component,
        label: "Linear Projection",
        ...(props && { props: { ...props } }),
      },
      ...[...patches, ...(blocked ? [] : encoded)].map((id) => ({
        id,
        component: "box",
        label: id,
        props: { width: "16pt", height: "16pt" },
      })),
    ],
    edges: [
      ...patches.slice(1).map((id) => ({ from: id, to: "projection", toAnchor: "straight" })),
      ...(blocked ? patches : encoded).map((id) => ({
        from: "encoder",
        to: id,
        fromAnchor: "straight",
      })),
    ],
  });
}

test("#306: 9/10-column spans explain natural width at both straight-anchor ends", () => {
  const result = layoutStructuredFigure(source(), { file: "spans.sumi.yaml" });
  const warnings = result.diagnostics.filter((d) => d.code === "layout/straight-off-side");
  expect(warnings.length).toBeGreaterThan(0);
  for (const d of warnings) {
    expect(d.hint).toContain("natural width");
    expect(d.hint).toContain("grid.align: stretch");
    expect(d.hint).toContain("span reserves tracks");
    expect(d.path?.at(-1)).toMatch(/^(from|to)Anchor$/);
    expect(d.location?.file).toBe("spans.sumi.yaml");
  }
  expect(warnings.some((d) => d.hint?.includes('"encoder" spans 10'))).toBe(true);
  expect(warnings.some((d) => d.hint?.includes('"projection" spans 9'))).toBe(true);
  // Explicit center is the unchanged default, including routed geometry.
  const centered = layoutStructuredFigure(source("center"));
  expect(result.ok && centered.ok && result.value.layout).toEqual(
    centered.ok && centered.value.layout,
  );
  const fixed = layoutStructuredFigure(source("stretch"));
  expect(fixed.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
  expect(fixed.ok).toBe(true);
  if (!fixed.ok) return;
  expect(Object.values(checkRoutes(fixed.value.ir, fixed.value.layout)).flat()).toEqual([]);
  for (const edge of fixed.value.layout.edges) {
    expect(edge.route?.points).toHaveLength(2);
    expect(edge.route?.points[0]?.x).toBe(edge.route?.points[1]?.x);
  }
});

test("#306: no-route keeps blocker locations and adds the spanning-cell cause", () => {
  const result = layoutStructuredFigure(source(undefined, undefined, "box", true), {
    file: "blocked.sumi.yaml",
  });
  const errors = result.diagnostics.filter((d) => d.code === "layout/no-route");
  expect(errors.length).toBeGreaterThan(0);
  for (const d of errors) {
    expect(d.hint).toContain('"encoder" spans 10');
    expect(d.hint).toContain("grid.align: stretch");
    expect(d.related?.[0]?.location?.file).toBe("blocked.sumi.yaml");
    expect(d.subject?.kind).toBe("edge");
  }
});

test("#306: fixed widths and fixed shapes do not promise that stretch alone fixes them", () => {
  for (const align of [undefined, "stretch"]) {
    const fixed = layoutStructuredFigure(source(align, { width: "40pt" }));
    const warnings = fixed.diagnostics.filter((d) => d.code === "layout/straight-off-side");
    expect(warnings.length, JSON.stringify(fixed.diagnostics)).toBeGreaterThan(0);
    expect(warnings.every((d) => d.hint?.includes("remove props.width"))).toBe(true);
    const circle = layoutStructuredFigure(source(align, undefined, "circle"));
    const shapes = circle.diagnostics.filter((d) => d.code === "layout/straight-off-side");
    expect(shapes.length).toBeGreaterThan(0);
    expect(shapes.every((d) => d.hint?.includes("keeps its width"))).toBe(true);
  }
});

test("#306: nested/group grids use their own alignment and non-spans keep generic hints", () => {
  for (const align of ["start", "end"]) {
    const doc = parse(source(align));
    const arrange = doc.figure.layout.arrange;
    doc.figure.layout.arrange = { stack: { align: "stretch", items: ["panel"] } };
    doc.groups = [{ id: "panel", arrange }];
    const result = layoutStructuredFigure(stringify(doc));
    const warnings = result.diagnostics.filter((d) => d.code === "layout/straight-off-side");
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.every((d) => d.hint?.includes(`grid.align: ${align}`))).toBe(true);
  }
  const doc = parse(source());
  // A single-column grid can still have diagonal endpoints, but has no span issue.
  doc.figure.layout.arrange = {
    row: {
      items: [
        { grid: { columns: 1, items: ["encoder"] } },
        { stack: { items: ["projection", "p0"] } },
      ],
    },
  };
  doc.nodes = doc.nodes.filter((n: { id: string }) =>
    ["encoder", "projection", "p0"].includes(n.id),
  );
  doc.edges = [{ from: "encoder", to: "p0", fromAnchor: "straight" }];
  const result = layoutStructuredFigure(stringify(doc));
  const d = result.diagnostics.find((d) => d.code === "layout/straight-off-side");
  expect(d).toBeDefined();
  expect(d?.hint).not.toContain("grid.align");
});
