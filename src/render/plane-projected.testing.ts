/** The plane figure the projected-planes tests render (#577); also rendered on older checkouts for baselines. */

/** Two stacked planes with the same nodes; `contents` is written on both planes (or not at all). */
export function source({
  contents = "projected",
  shape = "circle",
  plane = "floor",
  inPlane = "route: straight",
}: {
  contents?: string;
  shape?: string;
  plane?: string;
  inPlane?: string;
} = {}): string {
  const props = `plane: ${plane}${contents === "" ? "" : `, contents: ${contents}`}, padding: 8mm`;
  const place = (s: string) =>
    [
      ["a", 14, 14],
      ["b", 46, 14],
      ["c", 78, 14],
      ["d", 46, 42],
    ]
      .map(([n, u, v]) => `          - { item: ${n}${s}, at: [${u}, ${56 - (v as number)}] }`)
      .join("\n");
  const nodes = (s: string, tone: string) =>
    ["a", "b", "c", "d"]
      .map(
        (n) =>
          `  - { id: ${n}${s}, component: ${shape}, label: ${n.toUpperCase()}, tone: ${tone} }`,
      )
      .join("\n");
  return `version: 1
figure:
  id: projected
  theme: sumi
  profile: paper-double
  layout:
    arrange: { stack: { gap: 18mm, align: start, items: [ga, gb] } }
groups:
  - id: ga
    label: (a) Graph A
    props: { ${props} }
    arrange:
      place:
        unit: 1mm
        items:
${place("1")}
  - id: gb
    label: (b) Graph B
    props: { ${props} }
    arrange:
      place:
        unit: 1mm
        items:
${place("2")}
nodes:
${nodes("1", "blue")}
${nodes("2", "green")}
edges:
  - { from: a1, to: b1, component: arrow, ${inPlane} }
  - { from: b1, to: c1, component: line, ${inPlane} }
  - { from: a1, to: d1, component: line, ${inPlane} }
  - { from: a2, to: d2, component: line, ${inPlane} }
  - { from: a2, to: a1, component: line, route: straight, variant: dotted }
  - { from: c2, to: c1, component: line, route: straight, variant: dotted }
`;
}
