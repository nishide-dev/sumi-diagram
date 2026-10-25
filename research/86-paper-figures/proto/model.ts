/**
 * Research prototype (#86): reads the PROPOSED structured-layout syntax of
 * figures/ideal/*.sumi.yaml into a small model. Not product code: only the
 * subset figure A needs, with plain-string errors instead of Diagnostics.
 */
import { parse } from "yaml";

/** 1 user unit = 0.5pt, as in the product (design doc §5.1). */
export const UNITS_PER_MM = (72 / 25.4) * 2;

export type Side = "north" | "east" | "south" | "west";
export const SIDES: readonly Side[] = ["north", "east", "south", "west"];

export interface Anchor {
  side: Side;
  /** 0..1 along the side: left→right for north/south, top→bottom for east/west. */
  offset: number;
}

export type Align = "start" | "center" | "end" | "stretch";

export interface ArrangeBox {
  kind: "stack" | "row";
  /** stack: up | down; row: right | left */
  direction: "up" | "down" | "right" | "left";
  gap: number;
  /** Cross-axis alignment; undefined inherits the parent's. */
  align: Align | undefined;
  items: (string | ArrangeBox)[];
}

export interface NodeDef {
  id: string;
  component: "box" | "label" | "circle" | "operator" | "junction";
  label: string;
  tone: string | undefined;
  icon: string | undefined;
  symbol: string | undefined;
  attach: { to: string; side: Side; gap: number } | undefined;
}

export interface GroupDef {
  id: string;
  label: string;
  caption: string;
  arrange: ArrangeBox;
}

export interface EdgeDef {
  index: number;
  from: string;
  to: string;
  fromAnchor: Anchor | undefined;
  toAnchor: Anchor | undefined;
  arrow: boolean;
  label: string;
}

export interface Model {
  id: string;
  arrange: ArrangeBox;
  nodes: Map<string, NodeDef>;
  groups: Map<string, GroupDef>;
  edges: EdgeDef[];
}

export class ModelError extends Error {}

type Obj = Record<string, unknown>;

function obj(value: unknown, where: string): Obj {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new ModelError(`${where}: expected a mapping`);
  return value as Obj;
}

function str(value: unknown, where: string): string {
  if (typeof value !== "string") throw new ModelError(`${where}: expected a string`);
  return value;
}

function only(o: Obj, keys: readonly string[], where: string): void {
  for (const k of Object.keys(o))
    if (!keys.includes(k)) throw new ModelError(`${where}: unknown field "${k}"`);
}

/** "4mm" | "0" | 0 → user units. */
export function length(value: unknown, where: string): number {
  if (value === 0 || value === "0") return 0;
  const m = typeof value === "string" ? /^(\d+(?:\.\d+)?)(mm|pt)$/.exec(value) : null;
  if (m === null) throw new ModelError(`${where}: expected a length like 4mm or 6pt`);
  const n = Number(m[1]);
  return m[2] === "mm" ? n * UNITS_PER_MM : n * 2;
}

/** "south" | "south:0.25" */
export function anchor(value: unknown, where: string): Anchor {
  const m = /^(north|east|south|west)(?::(0(?:\.\d+)?|1(?:\.0+)?))?$/.exec(str(value, where));
  if (m === null) throw new ModelError(`${where}: expected "<side>" or "<side>:<0..1>"`);
  return { side: m[1] as Side, offset: m[2] === undefined ? 0.5 : Number(m[2]) };
}

function arrange(value: unknown, where: string): ArrangeBox {
  const o = obj(value, where);
  const keys = Object.keys(o);
  const kind = keys[0];
  if (keys.length !== 1 || (kind !== "stack" && kind !== "row"))
    throw new ModelError(`${where}: expected exactly one of stack / row`);
  const spec = obj(o[kind], `${where}.${kind}`);
  only(spec, ["direction", "gap", "align", "items"], `${where}.${kind}`);
  const direction = (spec.direction ?? (kind === "stack" ? "down" : "right")) as string;
  const allowed = kind === "stack" ? ["up", "down"] : ["right", "left"];
  if (!allowed.includes(direction)) throw new ModelError(`${where}: bad direction ${direction}`);
  const align = spec.align as string | undefined;
  if (align !== undefined && !["start", "center", "end", "stretch"].includes(align))
    throw new ModelError(`${where}: bad align ${align}`);
  if (!Array.isArray(spec.items) || spec.items.length === 0)
    throw new ModelError(`${where}: items must be a non-empty list`);
  return {
    kind,
    direction: direction as ArrangeBox["direction"],
    gap: spec.gap === undefined ? 4 * UNITS_PER_MM : length(spec.gap, `${where}.gap`),
    align: align as Align | undefined,
    items: spec.items.map((item, i) =>
      typeof item === "string" ? item : arrange(item, `${where}.items[${i}]`),
    ),
  };
}

const COMPONENTS = new Set(["box", "label", "circle", "operator", "junction"]);

export function parseModel(text: string): Model {
  const root = obj(parse(text), "root");
  only(root, ["version", "requires", "figure", "groups", "nodes", "edges"], "root");
  const figure = obj(root.figure, "figure");
  only(figure, ["id", "title", "theme", "profile", "layout"], "figure");
  const layout = obj(figure.layout, "figure.layout");
  only(layout, ["engine", "arrange"], "figure.layout");
  if (layout.engine !== "structured")
    throw new ModelError("figure.layout.engine: expected structured");
  const nodes = new Map<string, NodeDef>();
  const groups = new Map<string, GroupDef>();
  for (const [i, raw] of ((root.groups as unknown[]) ?? []).entries()) {
    const g = obj(raw, `groups[${i}]`);
    only(g, ["id", "label", "caption", "arrange"], `groups[${i}]`);
    const id = str(g.id, `groups[${i}].id`);
    if (groups.has(id)) throw new ModelError(`groups[${i}]: duplicate id ${id}`);
    groups.set(id, {
      id,
      label: g.label === undefined ? "" : str(g.label, `groups[${i}].label`),
      caption: g.caption === undefined ? "" : str(g.caption, `groups[${i}].caption`),
      arrange: arrange(g.arrange, `groups[${i}].arrange`),
    });
  }
  for (const [i, raw] of ((root.nodes as unknown[]) ?? []).entries()) {
    const n = obj(raw, `nodes[${i}]`);
    const where = `nodes[${i}]`;
    only(n, ["id", "component", "label", "tone", "icon", "props", "attach"], where);
    const id = str(n.id, `${where}.id`);
    if (nodes.has(id) || groups.has(id)) throw new ModelError(`${where}: duplicate id ${id}`);
    const component = str(n.component, `${where}.component`);
    if (!COMPONENTS.has(component))
      throw new ModelError(`${where}: unknown component ${component}`);
    const props = n.props === undefined ? {} : obj(n.props, `${where}.props`);
    let attach: NodeDef["attach"];
    if (n.attach !== undefined) {
      const a = obj(n.attach, `${where}.attach`);
      only(a, ["to", "side", "gap"], `${where}.attach`);
      attach = {
        to: str(a.to, `${where}.attach.to`),
        side: anchor(a.side, `${where}.attach.side`).side,
        gap: a.gap === undefined ? 0 : length(a.gap, `${where}.attach.gap`),
      };
    }
    nodes.set(id, {
      id,
      component: component as NodeDef["component"],
      label: n.label === undefined ? "" : str(n.label, `${where}.label`),
      tone: n.tone === undefined ? undefined : str(n.tone, `${where}.tone`),
      icon: n.icon === undefined ? undefined : str(n.icon, `${where}.icon`),
      symbol: props.symbol === undefined ? undefined : str(props.symbol, `${where}.props.symbol`),
      attach,
    });
  }
  const edges: EdgeDef[] = ((root.edges as unknown[]) ?? []).map((raw, index) => {
    const e = obj(raw, `edges[${index}]`);
    const where = `edges[${index}]`;
    only(e, ["from", "to", "fromAnchor", "toAnchor", "component", "label"], where);
    const from = str(e.from, `${where}.from`);
    const to = str(e.to, `${where}.to`);
    for (const end of [from, to])
      if (!nodes.has(end)) throw new ModelError(`${where}: unknown node ${end}`);
    return {
      index,
      from,
      to,
      fromAnchor:
        e.fromAnchor === undefined ? undefined : anchor(e.fromAnchor, `${where}.fromAnchor`),
      toAnchor: e.toAnchor === undefined ? undefined : anchor(e.toAnchor, `${where}.toAnchor`),
      arrow: (e.component ?? "arrow") === "arrow",
      label: e.label === undefined ? "" : str(e.label, `${where}.label`),
    };
  });
  const model: Model = {
    id: str(figure.id, "figure.id"),
    arrange: arrange(layout.arrange, "figure.layout.arrange"),
    nodes,
    groups,
    edges,
  };
  checkPlacement(model);
  return model;
}

/** Every node and group is placed exactly once: in one arrange tree or by attach. */
function checkPlacement(model: Model): void {
  const seen = new Map<string, string>();
  const visit = (box: ArrangeBox, owner: string) => {
    for (const item of box.items) {
      if (typeof item !== "string") {
        visit(item, owner);
        continue;
      }
      if (!model.nodes.has(item) && !model.groups.has(item))
        throw new ModelError(`${owner}: unknown item ${item}`);
      const before = seen.get(item);
      if (before !== undefined)
        throw new ModelError(`${item} is placed twice (${before}, ${owner})`);
      seen.set(item, owner);
      const group = model.groups.get(item);
      if (group !== undefined) visit(group.arrange, `groups.${item}`);
    }
  };
  visit(model.arrange, "figure.layout");
  for (const node of model.nodes.values()) {
    if (node.attach === undefined) continue;
    if (seen.has(node.id)) throw new ModelError(`${node.id} is both arranged and attached`);
    if (!model.nodes.has(node.attach.to) && !model.groups.has(node.attach.to))
      throw new ModelError(`${node.id}.attach.to: unknown ${node.attach.to}`);
    seen.set(node.id, "attach");
  }
  for (const id of [...model.nodes.keys(), ...model.groups.keys()])
    if (!seen.has(id))
      throw new ModelError(`${id} is not placed (add it to an arrange items list)`);
}
