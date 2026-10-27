/**
 * Lowers a stage-B draft (`figures/*.sumi.yaml`, proposed syntax) to what
 * v0.4.1 accepts, collecting what the prototypes need (#124):
 *
 * - `requires` is dropped;
 * - `figure.layout.align` is removed and returned as constraints (§6, run
 *   by `align/solve.ts`);
 * - `groups[].caption` is expanded (§3): the group's place in its parent
 *   tree becomes `stack { gap: 1mm, items: [group, <group>-caption] }` with a
 *   `label` node — the expansion the product would do;
 * - `component: legend` nodes are expanded (§3): a group `<id>` whose stack
 *   holds one row per entry: two hidden junctions joined by an edge with the
 *   entry's `edge` fields (a sample line), or a small box with the entry's
 *   `node` fields, then a `label` node — again the product's expansion;
 * - `groups[].labelAt` (top, top-left, top-right) and `edges[].labelAt` are
 *   removed and returned for `labels.ts`, which applies them to the layout
 *   and the label placement (§1–§2); `labelSide` and the bottom positions
 *   are removed (not prototyped: they need the engine / router changes of
 *   §1–§2);
 * - accents `\hat{x}` … are replaced by their argument (§5: drawn only in
 *   `measure/accents.ts`).
 *
 * Every removal is listed in `dropped`, so a reader of the prototype output
 * knows what the rendered figure does not show.
 */

import { parse, stringify } from "yaml";
import type { AlignConstraint } from "./align/solve";

export interface Lowered {
  readonly text: string;
  readonly align: AlignConstraint[];
  /** `groups[].labelAt` by group key (`top`, `top-left`, `top-right`; see `labels.ts`). */
  readonly groupLabelAt: Map<string, string>;
  /** `edges[].labelAt` by edge key (`start`, `middle`, `end`; see `labels.ts`). */
  readonly edgeLabelAt: Map<string, string>;
  readonly dropped: string[];
}

type Item = string | Record<string, { items?: Item[] } & Record<string, unknown>>;
type Doc = {
  requires?: string;
  figure: { layout?: { arrange?: Item; align?: Record<string, unknown>[] } };
  groups?: Record<string, unknown>[];
  nodes?: Record<string, unknown>[];
  edges?: Record<string, unknown>[];
};

const ACCENT = /\\(hat|tilde|bar|dot|ddot|vec)\s*(\{([^{}]*)\}|\\[A-Za-z]+|[A-Za-z])/g;

/** Replaces each occurrence of the ID `id` in arrange trees with `replacement`. */
function replaceItem(box: Item | undefined, id: string, replacement: Item): void {
  if (box === undefined || typeof box === "string") return;
  for (const kind of ["stack", "row"]) {
    const spec = box[kind];
    if (spec?.items === undefined) continue;
    // The replacement holds `id` itself, so it is not searched again.
    spec.items = spec.items.map((item) => {
      if (item === id) return replacement;
      replaceItem(item, id, replacement);
      return item;
    });
  }
}

export function lower(source: string): Lowered {
  const doc = parse(source) as Doc;
  const dropped: string[] = [];
  const trees = () => [
    doc.figure.layout?.arrange,
    ...(doc.groups ?? []).map((g) => g.arrange as Item | undefined),
  ];
  if (doc.requires !== undefined) {
    dropped.push(`requires ${doc.requires}`);
    delete doc.requires;
  }
  const align: AlignConstraint[] = [];
  for (const c of doc.figure.layout?.align ?? []) {
    const axis = "y" in c ? "y" : "x";
    const at = c.at as AlignConstraint["at"];
    align.push({ axis, items: c[axis] as string[], ...(at !== undefined && { at }) });
  }
  if (doc.figure.layout?.align !== undefined) {
    dropped.push(`figure.layout.align (${align.length}, solved by the prototype)`);
    delete doc.figure.layout.align;
  }
  doc.nodes ??= [];
  doc.edges ??= [];
  doc.groups ??= [];

  // Captions (expanded).
  for (const g of doc.groups) {
    if (typeof g.caption !== "string") continue;
    const id = g.id as string;
    const caption = `${id}-caption`;
    doc.nodes.push({ id: caption, component: "label", label: g.caption });
    for (const tree of trees()) {
      replaceItem(tree, id, { stack: { gap: "1mm", items: [id, caption] } });
    }
    delete g.caption;
  }

  // Legends (expanded).
  const legends = doc.nodes.filter((n) => n.component === "legend");
  for (const legend of legends) {
    const id = legend.id as string;
    const entries = ((legend.props as { entries?: Record<string, unknown>[] })?.entries ?? []) as {
      edge?: Record<string, unknown>;
      node?: Record<string, unknown>;
      label: string;
    }[];
    const rows: Item[] = entries.map((entry, i) => {
      const text = `${id}-t${i}`;
      doc.nodes?.push({ id: text, component: "label", label: entry.label });
      if (entry.node !== undefined) {
        const swatch = `${id}-n${i}`;
        doc.nodes?.push({
          id: swatch,
          component: "box",
          label: " ",
          props: { width: "4mm", height: "2.5mm" },
          ...entry.node,
        });
        return { row: { gap: "1.5mm", align: "center", items: [swatch, text] } };
      }
      const a = `${id}-a${i}`;
      const b = `${id}-b${i}`;
      doc.nodes?.push(
        { id: a, component: "junction", variant: "hidden" },
        { id: b, component: "junction", variant: "hidden" },
      );
      doc.edges?.push({ from: a, to: b, ...(entry.edge ?? {}) });
      return {
        row: {
          gap: "1.5mm",
          align: "center",
          items: [{ row: { gap: "6mm", items: [a, b] } }, text],
        },
      };
    });
    doc.groups.push({ id, arrange: { stack: { gap: "1mm", align: "start", items: rows } } });
  }
  doc.nodes = doc.nodes.filter((n) => n.component !== "legend");
  if (legends.length > 0) dropped.push(`legend ${legends.map((l) => l.id).join(", ")} (expanded)`);

  // Label positions: collected for `labels.ts` where it can apply them.
  const groupLabelAt = new Map<string, string>();
  for (const g of doc.groups) {
    if (typeof g.labelAt !== "string") continue;
    const at = g.labelAt;
    if (at === "top-left" || at === "top-right" || at === "top") groupLabelAt.set(`g:${g.id}`, at);
    else dropped.push(`${String(g.id)}.labelAt: ${at} (only top-left / top-right are prototyped)`);
    delete g.labelAt;
  }
  const edgeLabelAt = new Map<string, string>();
  doc.edges.forEach((e, i) => {
    const key = e.id === undefined ? `e:#${i}` : `e:${String(e.id)}`;
    if (typeof e.labelAt === "string") edgeLabelAt.set(key, e.labelAt);
    delete e.labelAt;
    if (e.labelSide !== undefined) {
      dropped.push(`${String(e.from)} → ${String(e.to)}.labelSide (not prototyped)`);
      delete e.labelSide;
    }
  });
  for (const element of [...doc.nodes, ...doc.edges]) {
    if (typeof element.label !== "string") continue;
    const label = element.label.replace(
      ACCENT,
      (_m, _cmd, arg: string, inner?: string) => inner ?? arg,
    );
    if (label !== element.label) {
      dropped.push(`accent in ${String(element.id ?? `${element.from} → ${element.to}`)}`);
      element.label = label;
    }
  }
  return { text: stringify(doc), align, groupLabelAt, edgeLabelAt, dropped };
}
