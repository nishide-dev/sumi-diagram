/**
 * Test support for the compiler: golden fixtures and a figure exercising
 * lowering paths that the built-in components and themes do not reach
 * (backward edges, custom arrowheads, mono / italic text, unfilled arrowheads).
 * Not part of the public API.
 */

import { join } from "node:path";
import { z } from "zod";
import type { ElementKey } from "../core/check-state";
import { BUILTIN_MANIFESTS, createBuiltinRegistry } from "../core/registry/builtins";
import type { ComponentManifest, EdgeManifest } from "../core/registry/manifest";
import type { ResolvedStyle } from "../core/theme/style";
import { compileFigure } from "./compile";
import { type ElementIR, type FigureIR, readonlyMap } from "./ir";

export const FIXTURES_DIR = join(import.meta.dir, "..", "..", "tests", "fixtures");

/**
 * The directory of the self-made test images (#94): pass it as `assetBase`
 * when rendering a figure with `sumi/image` nodes from {@link primitivesFigure}.
 */
export const ASSETS_DIR = join(FIXTURES_DIR, "assets");

export interface GoldenCase {
  name: string;
  /** Path of the `.sumi.yaml` input. */
  input: string;
  /** Path of the expected `.d2` output. */
  expected: string;
}

/** Every valid figure fixture, with its expected D2 source under `tests/fixtures/d2`. */
export function goldenCases(): GoldenCase[] {
  const cases: GoldenCase[] = [];
  for (const dir of ["figures/valid", "compile"]) {
    const glob = new Bun.Glob("*.sumi.yaml");
    for (const file of [...glob.scanSync(join(FIXTURES_DIR, dir))].sort()) {
      const name = file.replace(/\.sumi\.yaml$/, "");
      cases.push({
        name,
        input: join(FIXTURES_DIR, dir, file),
        expected: join(FIXTURES_DIR, "d2", `${name}.d2`),
      });
    }
  }
  return cases;
}

const testEdge = (name: string, arrows: Pick<EdgeManifest, "direction" | "head" | "tail">) =>
  ({
    version: 1,
    kind: "edge",
    namespace: "test",
    name,
    description: `Test edge ${name}.`,
    variants: ["default"],
    props: z.strictObject({}),
    since: "0.1.0",
    ...arrows,
  }) satisfies EdgeManifest;

const EXTRA_SOURCE = `version: 1
figure:
  id: extras
nodes:
  - { id: plain, component: box, label: plain }
  - { id: styled, component: box, label: mono italic }
edges:
  - { from: plain, to: styled, component: test/back, label: back }
  - { from: plain, to: styled, component: test/open, label: open }
  - { from: styled, to: plain, component: test/mixed }
`;

/**
 * A compiled figure with custom edges (`test/back`: backward with the default
 * arrowhead, `test/open`: forward with `arrow`, `test/mixed`: both with
 * `diamond` / `circle`) and styles patched to use mono, italic, bold and
 * unfilled arrowheads.
 */
export function extrasFigure(): FigureIR {
  const registry = createBuiltinRegistry();
  for (const manifest of [
    testEdge("back", { direction: "backward" }),
    testEdge("open", { direction: "forward", head: "arrow" }),
    testEdge("mixed", { direction: "both", head: "diamond", tail: "circle" }),
  ]) {
    const registered = registry.register(manifest);
    if (!registered.ok) throw new Error(JSON.stringify(registered.diagnostics));
  }
  const result = compileFigure(EXTRA_SOURCE, { registry });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return withStyles(result.value.ir, {
    "n:styled": { mono: true, italic: true, fill: "transparent" },
    "e:#1": { mono: true, bold: true, filled: false },
    "e:#2": { opacity: 0.5, filled: false },
  });
}

/** Returns a copy of the IR with some element styles overridden. */
export function withStyles(
  ir: FigureIR,
  patches: Partial<Record<ElementKey, Partial<Record<string, unknown>>>>,
): FigureIR {
  const patch = <T extends ElementIR>(element: T): T => {
    const overrides = patches[element.key];
    if (overrides === undefined) return element;
    return { ...element, style: { ...element.style, ...overrides } as ResolvedStyle } as T;
  };
  const groups = ir.groups.map(patch);
  const nodes = ir.nodes.map(patch);
  const edges = ir.edges.map(patch);
  const elements = readonlyMap<ElementKey, ElementIR>(
    [...groups, ...nodes, ...edges].map((e) => [e.key, e]),
  );
  return { ...ir, groups, nodes, edges, elements };
}

/** `true` if the auto (D2) engine can draw the component (manifest `engines`, #131). */
export const drawnByAuto = (manifest: ComponentManifest): boolean =>
  manifest.engines === undefined || manifest.engines.includes("auto");

/**
 * The built-in components {@link primitivesFigure} cannot hold because the
 * auto engine cannot draw them (#131: `sumi/legend`);
 * {@link structuredPrimitivesFigure} holds them instead.
 */
export const STRUCTURED_ONLY_MANIFESTS: readonly ComponentManifest[] = BUILTIN_MANIFESTS.filter(
  (m) => !drawnByAuto(m),
);

/**
 * A figure using every built-in component the auto engine can draw, with
 * every variant, under the given theme. Each element has the ID and label
 * `<component>-<variant>`. Default-variant nodes sit in the default container
 * and muted ones in the muted container; the edges chain the nodes in order.
 * The other components are in {@link structuredPrimitivesFigure}; together
 * the two cover every built-in component and variant.
 */
export function primitivesFigure(theme: string): string {
  const ofKind = (kind: string) =>
    BUILTIN_MANIFESTS.filter((m) => m.kind === kind && drawnByAuto(m));
  const lines = [
    "version: 1",
    `figure: { id: primitives-${theme}, theme: ${theme}, profile: paper-double, layout: { direction: down } }`,
    "groups:",
  ];
  const containers = new Set<string>();
  for (const m of ofKind("group")) {
    for (const variant of m.variants) {
      containers.add(variant);
      lines.push(
        `  - { id: ${m.name}-${variant}, label: ${m.name}-${variant}, variant: ${variant} }`,
      );
    }
  }
  lines.push("nodes:");
  const nodes: string[] = [];
  for (const m of ofKind("node")) {
    for (const variant of m.variants) {
      const id = `${m.name}-${variant}`;
      const group = containers.has(variant) ? `, group: container-${variant}` : "";
      // Marks (#92) take no label; a glyph mark needs its prop. An image
      // (#94) takes none either; it shows a test image (see ASSETS_DIR).
      const mark = m.kind === "node" ? m.mark : undefined;
      const embed = m.kind === "node" ? m.embed : undefined;
      const label =
        m.name === "html"
          ? `, props: { viewport: 120x60, height: 24pt, html: '<div style="color:var(--sumi-fg);font-size:16px">HTML</div>' }`
          : embed !== undefined
            ? ", props: { src: gradient.png, height: 24pt }"
            : mark === undefined
              ? `, label: ${id}`
              : mark.type === "glyph"
                ? `, props: { ${mark.prop}: ${Object.keys(mark.glyphs)[0]} }`
                : "";
      const waveformProps = m.name === "waveform" ? ", props: { samples: [0, -0.5, 1, 0] }" : "";
      lines.push(
        `  - { id: ${id}, component: ${m.name}${label}${waveformProps}, variant: ${variant}${group} }`,
      );
      nodes.push(id);
    }
  }
  lines.push("edges:");
  for (const m of ofKind("edge")) {
    for (const variant of m.variants) {
      const id = `${m.name}-${variant}`;
      const from = nodes[(lines.length * 7) % nodes.length];
      const to = nodes[(lines.length * 7 + 1) % nodes.length];
      lines.push(
        `  - { id: ${id}, from: ${from}, to: ${to}, component: ${m.name}, label: ${id}, variant: ${variant} }`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

/**
 * The entries of a legend in {@link structuredPrimitivesFigure}: every edge
 * component once (its sample line), the dashed arrow, and a toned box and a
 * circle (sample boxes), so that every sample kind is drawn.
 */
const LEGEND_ENTRIES = [
  "{ edge: {}, label: arrow }",
  "{ edge: { variant: dashed }, label: dashed }",
  "{ edge: { component: line }, label: line }",
  "{ edge: { component: double-arrow }, label: double-arrow }",
  "{ node: { tone: blue }, label: blue box }",
  "{ node: { component: circle, variant: emphasis }, label: circle }",
];

/**
 * A structured figure using every built-in component the auto engine cannot
 * draw (see {@link STRUCTURED_ONLY_MANIFESTS}), with every variant, under the
 * given theme: each with the ID `<component>-<variant>`, in a row below the
 * nodes and edges whose styles a legend's entries explain (a zoom edge, #176,
 * runs from one of those nodes to a box of its own in a row between them),
 * and a row of tokens (#181) with an edge from a cell to a box below, and
 * of matrices (#180) with an edge from a box above.
 * Throws for a structured-only component it does not know how to fill in.
 */
export function structuredPrimitivesFigure(theme: string): string {
  const legends: string[] = [];
  const nodes = [
    "  - { id: a, component: box, label: A, tone: blue }",
    "  - { id: b, component: circle, label: B, variant: emphasis }",
    "  - { id: c, component: box, label: C }",
    "  - { id: d, component: box, label: D }",
  ];
  const edges = [
    "  - { from: a, to: b }",
    "  - { from: b, to: c, variant: dashed }",
    "  - { from: c, to: d, component: line }",
    "  - { from: a, to: d, component: double-arrow, fromAnchor: south, toAnchor: south }",
  ];
  const zooms: string[] = [];
  const tokens: string[] = [];
  for (const m of STRUCTURED_ONLY_MANIFESTS) {
    const id = `${m.namespace}/${m.name}`;
    if (id === "sumi/tokens") {
      // A row of cells (#181): labeled, toned, math and a borderless one,
      // with an edge into a cell.
      for (const variant of m.variants) {
        const name = `${m.name}-${variant}`;
        tokens.push(`{ stack: { gap: 6mm, items: [${name}, ${name}-out] } }`);
        nodes.push(
          `  - id: ${name}`,
          `    component: ${m.name}`,
          `    variant: ${variant}`,
          "    tone: purple",
          "    props:",
          "      gap: 1.5pt",
          "      cells:",
          "        - { id: first, label: First, tone: gray }",
          "        - '$A_1$'",
          "        - { label: '…', component: label }",
        );
        nodes.push(`  - { id: ${name}-out, component: box, label: out }`);
        edges.push(`  - { from: ${name}.first, to: ${name}-out }`);
      }
      continue;
    }
    if (id === "sumi/matrix") {
      // A matrix (#180) with headers, a toned header and a hatched class,
      // an edge into it, and a legend entry made from a class.
      for (const variant of m.variants) {
        const name = `${m.name}-${variant}`;
        tokens.push(`{ stack: { gap: 6mm, items: [${name}-in, ${name}] } }`);
        nodes.push(
          `  - { id: ${name}-in, component: box, label: in }`,
          `  - id: ${name}`,
          `    component: ${m.name}`,
          `    variant: ${variant}`,
          "    props:",
          "      rows: [a, { label: '$B_1$', tone: purple }]",
          "      columns: [a, b]",
          "      cellWidth: 22pt",
          "      gap: 2pt",
          "      classes:",
          "        o: { tone: green, label: on }",
          "        x: { pattern: hatch, label: off }",
          "      cells: [ox, xo]",
        );
        edges.push(`  - { from: ${name}-in, to: ${name} }`);
      }
      continue;
    }
    if (id === "sumi/bracket") {
      // A bracket (#281) attached to the east side of a whole token sequence
      // (so it is as long as the column), with an edge from its tip.
      const brackets: string[] = [];
      for (const [i, variant] of m.variants.entries()) {
        const name = `${m.name}-${variant}`;
        brackets.push(`{ row: { gap: 12mm, items: [${name}-set, ${name}-out] } }`);
        nodes.push(
          `  - { id: ${name}-set, component: tokens, props: { direction: down, gap: 1.5pt, cells: [x, y] } }`,
          `  - { id: ${name}, component: ${m.name}, variant: ${variant}, attach: { to: ${name}-set, side: east, gap: 2mm }, props: { form: ${i % 2 === 0 ? "curly" : "square"} } }`,
          `  - { id: ${name}-out, component: box, label: out }`,
        );
        edges.push(`  - { from: ${name}, to: ${name}-out }`);
      }
      tokens.push(
        `{ grid: { columns: 2, rowGap: 3mm, columnGap: 6mm, items: [${brackets.join(", ")}] } }`,
      );
      continue;
    }
    if (id === "sumi/zoom") {
      // A callout from each node of the first row to a box below it (#176).
      for (const [i, variant] of m.variants.entries()) {
        const name = `${m.name}-${variant}`;
        const from = ["a", "b", "c", "d"][i] ?? "a";
        zooms.push(name);
        nodes.push(`  - { id: ${name}, component: box, label: ${name} }`);
        edges.push(
          `  - { id: ${name}, from: ${from}, to: ${name}, component: ${m.name}, variant: ${variant} }`,
        );
      }
      continue;
    }
    if (id !== "sumi/legend") {
      throw new Error(`internal error: no structured sample for ${id}`);
    }
    for (const variant of m.variants) {
      const name = `${m.name}-${variant}`;
      legends.push(name);
      nodes.push(
        `  - id: ${name}`,
        `    component: ${m.name}`,
        `    label: ${name}`,
        `    variant: ${variant}`,
        "    props:",
        "      entries:",
        ...LEGEND_ENTRIES.map((entry) => `        - ${entry}`),
      );
    }
  }
  return `${[
    "version: 1",
    "figure:",
    `  id: structured-primitives-${theme}`,
    `  theme: ${theme}`,
    "  profile: paper-double",
    "  layout:",
    "    arrange:",
    "      stack:",
    "        gap: 8mm",
    "        items:",
    "          - row: { gap: 8mm, align: center, items: [a, b, c, d] }",
    `          - row: { gap: 8mm, align: center, items: [${zooms.join(", ")}] }`,
    `          - row: { gap: 8mm, align: center, items: [${tokens.join(", ")}] }`,
    `          - row: { gap: 6mm, align: start, items: [${legends.join(", ")}] }`,
    "nodes:",
    ...nodes,
    "edges:",
    ...edges,
  ].join("\n")}\n`;
}

/**
 * The component and variant an element of a compiled figure stands for: the
 * legend's own for the frame and the parts of a legend (#131, which the
 * `check` stages expand into groups, nodes and edges of other components),
 * the tokens node's for its cells (#181), the matrix's for its frame and
 * parts (#180), otherwise the element's.
 */
export function writtenComponentOf(
  ir: FigureIR,
  element: ElementIR,
): { component: string; variant: string } {
  // A cell of a tokens node (#181): no element is left of the tokens node.
  if (element.tokens !== undefined) {
    return { component: "sumi/tokens", variant: element.tokens.variant };
  }
  // The frame or a part of a matrix (#180): the matrix node is gone.
  if (element.matrix !== undefined) {
    return { component: "sumi/matrix", variant: element.matrix.variant };
  }
  if (element.legend === undefined) {
    return { component: element.component, variant: element.variant };
  }
  const frame = ir.elements.get(`g:${element.legend.id}`);
  if (frame === undefined)
    throw new Error(`internal error: legend ${element.legend.id} has no frame`);
  return { component: frame.component, variant: frame.variant };
}

/**
 * How an edge is drawn, independent of where it runs: the visible line's
 * color, width and dash (the structured writer draws it as a `sumi-wire` path
 * that starts where the edge's `connection` path starts), and each
 * arrowhead's side lengths (rounded) and fill. `chunk` is the edge's markup in
 * `svg`.
 */
export function edgeLook(svg: string, chunk: string) {
  const path = /<path class="connection"[^>]*>/.exec(chunk)?.[0] ?? "";
  const pointsOf = (element: string) =>
    [...(/ d="([^"]*)"/.exec(element)?.[1] ?? "").matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map(
      (m) => [Number(m[1]), Number(m[2])] as const,
    );
  const route = pointsOf(path);
  // The wire starts on the route (shortened for an arrowhead at the source).
  const onRoute = ([x, y]: readonly [number, number]) =>
    route.some(([ax, ay], i) => {
      const [bx, by] = route[i + 1] ?? [ax, ay];
      const within = (v: number, p: number, q: number) =>
        v >= Math.min(p, q) - 0.01 && v <= Math.max(p, q) + 0.01;
      const collinear = Math.abs((bx - ax) * (y - ay) - (by - ay) * (x - ax)) < 0.01;
      return collinear && within(x, ax, bx) && within(y, ay, by);
    });
  const wire = [...svg.matchAll(/<path class="sumi-wire"[^>]*>/g)]
    .map((m) => m[0])
    .find((w) => {
      const [first] = pointsOf(w);
      return first !== undefined && onRoute(first);
    });
  const start = route[0]?.join(" ");
  const attr = (element: string, name: string) =>
    new RegExp(` ${name}="([^"]*)"`).exec(element)?.[1] ?? null;
  const heads = [...chunk.matchAll(/<polygon points="([^"]*)" fill="([^"]*)"/g)].map((m) => {
    const points = (m[1] ?? "").split(" ").map((p) => p.split(",").map(Number));
    const sides = points.map((p, i) => {
      const q = points[(i + 1) % points.length] ?? p;
      return Math.round(Math.hypot((q[0] ?? 0) - (p[0] ?? 0), (q[1] ?? 0) - (p[1] ?? 0)) * 100);
    });
    return { sides: sides.sort((a, b) => a - b), fill: m[2] };
  });
  if (wire === undefined) throw new Error(`no drawn line for the edge at ${start}`);
  return {
    stroke: attr(wire, "stroke"),
    width: attr(wire, "stroke-width"),
    dash: attr(wire, "stroke-dasharray"),
    heads,
  };
}
