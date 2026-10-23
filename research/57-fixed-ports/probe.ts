/** ELK JSON fixtures and independent fixed-position checks. No SVG rendering is claimed. */
export interface Point {
  x: number;
  y: number;
}
export interface Port extends Point {
  id: string;
  width: number;
  height: number;
  layoutOptions: Record<string, string>;
}
export interface Node {
  id: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  ports?: Port[];
  children?: Node[];
  layoutOptions?: Record<string, string>;
}
export interface Edge {
  id: string;
  sources: string[];
  targets: string[];
  container?: string;
  sections?: { startPoint: Point; endPoint: Point; bendPoints?: Point[] }[];
}
export interface Graph extends Node {
  edges: Edge[];
}
export interface ElkApi {
  layout(graph: Graph): Promise<Graph>;
}
export type ElkConstructor = new () => ElkApi;

function ports(id: string, side: string): Port[] {
  return [0.25, 0.75].map((fraction, i) => ({
    id: `${id}.p${i}`,
    width: 0,
    height: 0,
    x: side === "EAST" ? 120 : side === "WEST" ? 0 : 120 * fraction,
    y: side === "SOUTH" ? 80 : side === "NORTH" ? 0 : 80 * fraction,
    layoutOptions: { "org.eclipse.elk.port.side": side },
  }));
}

export function fixture(direction: string, nested: boolean, constraints: string): Graph {
  const sides: Record<string, [string, string]> = {
    RIGHT: ["EAST", "WEST"],
    LEFT: ["WEST", "EAST"],
    DOWN: ["SOUTH", "NORTH"],
    UP: ["NORTH", "SOUTH"],
  };
  const [source, target] = sides[direction] ?? ["EAST", "WEST"];
  const children = ["a", "b"].map((id, i) => ({
    id,
    width: 120,
    height: 80,
    layoutOptions: { "org.eclipse.elk.portConstraints": constraints },
    ports: ports(id, i === 0 ? source : target),
  }));
  return {
    id: "root",
    layoutOptions: {
      "org.eclipse.elk.algorithm": "layered",
      "org.eclipse.elk.direction": direction,
      "org.eclipse.elk.edgeRouting": "ORTHOGONAL",
      "org.eclipse.elk.randomSeed": "1",
      "org.eclipse.elk.hierarchyHandling": "INCLUDE_CHILDREN",
    },
    children: nested
      ? [
          {
            id: "group",
            layoutOptions: {
              "org.eclipse.elk.algorithm": "layered",
              "org.eclipse.elk.direction": direction,
            },
            children,
          },
        ]
      : children,
    edges: [
      { id: "e0", sources: ["a.p0"], targets: ["b.p1"] },
      { id: "e1", sources: ["a.p1"], targets: ["b.p0"] },
    ],
  };
}

function absolutePorts(
  graph: Node,
  offset: Point = { x: 0, y: 0 },
  result = new Map<string, Point>(),
): Map<string, Point> {
  const origin = { x: offset.x + (graph.x ?? 0), y: offset.y + (graph.y ?? 0) };
  for (const port of graph.ports ?? [])
    result.set(port.id, { x: origin.x + port.x, y: origin.y + port.y });
  for (const child of graph.children ?? []) absolutePorts(child, origin, result);
  return result;
}

function localPorts(graph: Node, result = new Map<string, Point>()): Map<string, Point> {
  for (const port of graph.ports ?? []) result.set(port.id, { x: port.x, y: port.y });
  for (const child of graph.children ?? []) localPorts(child, result);
  return result;
}

function origins(
  graph: Node,
  offset: Point = { x: 0, y: 0 },
  result = new Map<string, Point>(),
): Map<string, Point> {
  const origin = { x: offset.x + (graph.x ?? 0), y: offset.y + (graph.y ?? 0) };
  result.set(graph.id, origin);
  for (const child of graph.children ?? []) origins(child, origin, result);
  return result;
}

/** Own geometric projection, excluding private GWT identity fields such as $H. */
export function canonicalLayout(graph: Graph): string {
  const point = (p: Point) => ({ x: p.x, y: p.y });
  const node = (n: Node): unknown => ({
    id: n.id,
    x: n.x,
    y: n.y,
    width: n.width,
    height: n.height,
    ports: n.ports?.map((p) => ({ id: p.id, x: p.x, y: p.y, width: p.width, height: p.height })),
    children: n.children?.map(node),
  });
  return JSON.stringify({
    graph: node(graph),
    edges: graph.edges.map((e) => ({
      id: e.id,
      sources: e.sources,
      targets: e.targets,
      container: e.container,
      sections: e.sections?.map((s) => ({
        start: point(s.startPoint),
        end: point(s.endPoint),
        bends: s.bendPoints?.map(point),
      })),
    })),
  });
}

export function inspectLayout(input: Graph, output: Graph) {
  const before = localPorts(input);
  const after = localPorts(output);
  const absolute = absolutePorts(output);
  const containers = origins(output);
  const finite = (p: Point) => {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new Error("non-finite ELK geometry");
  };
  let maxPositionDelta = 0;
  let maxEndpointDelta = 0;
  const portPositions = [];
  for (const [id, expected] of before) {
    const actual = after.get(id);
    if (!actual) throw new Error(`missing port ${id}`);
    finite(expected);
    finite(actual);
    maxPositionDelta = Math.max(
      maxPositionDelta,
      Math.hypot(actual.x - expected.x, actual.y - expected.y),
    );
    portPositions.push({ id, requested: expected, actual, absolute: absolute.get(id) });
  }
  const routes = output.edges.map((edge) => {
    const section = edge.sections?.[0];
    const source = absolute.get(edge.sources[0] ?? "");
    const target = absolute.get(edge.targets[0] ?? "");
    // ELK can assign a different container even for edges declared at root.
    // Translate sections by that container, rather than assuming root space.
    if (!section || !source || !target || edge.sections?.length !== 1)
      throw new Error(`unsupported route for ${edge.id}`);
    const offset = containers.get(edge.container ?? output.id);
    if (!offset) throw new Error(`missing route container ${edge.container}`);
    const translate = (p: Point): Point => ({ x: p.x + offset.x, y: p.y + offset.y });
    const start = translate(section.startPoint);
    const end = translate(section.endPoint);
    for (const p of [source, target, start, end, ...(section.bendPoints ?? [])]) finite(p);
    maxEndpointDelta = Math.max(
      maxEndpointDelta,
      Math.hypot(start.x - source.x, start.y - source.y),
      Math.hypot(end.x - target.x, end.y - target.y),
    );
    return {
      id: edge.id,
      start,
      end,
      bends: (section.bendPoints ?? []).map(translate),
    };
  });
  return {
    ports: before.size,
    endpoints: routes.length * 2,
    maxPositionDelta,
    maxEndpointDelta,
    portPositions,
    routes,
  };
}

export async function probe(ELK: ElkConstructor) {
  const results = [];
  for (const direction of ["RIGHT", "LEFT", "DOWN", "UP"])
    for (const nested of [false, true])
      for (const constraints of ["FIXED_POS", "FREE"]) {
        const input = fixture(direction, nested, constraints);
        const elk = new ELK();
        const first = await elk.layout(structuredClone(input));
        const firstText = canonicalLayout(first);
        const second = await elk.layout(structuredClone(input));
        const fresh = await new ELK().layout(structuredClone(input));
        if (canonicalLayout(second) !== firstText || canonicalLayout(fresh) !== firstText)
          throw new Error("ELK is not deterministic in this fixture");
        const result = inspectLayout(input, first);
        if (result.maxEndpointDelta > 0.01)
          throw new Error(`ELK endpoints missed their ports: ${JSON.stringify(result)}`);
        if (constraints === "FIXED_POS" && result.maxPositionDelta > 0.01)
          throw new Error("FIXED_POS was not respected");
        results.push({
          direction,
          nested,
          constraints,
          geometryDeterministic: true,
          rawJsonDeterministic:
            JSON.stringify(first) === JSON.stringify(second) &&
            JSON.stringify(first) === JSON.stringify(fresh),
          ...result,
          geometrySha256: new Bun.CryptoHasher("sha256").update(firstText).digest("hex"),
        });
      }
  return results;
}
