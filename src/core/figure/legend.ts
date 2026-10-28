/**
 * Legends (#131, design doc §6.34): a `sumi/legend` node is expanded into a
 * frame group with the legend's ID that stacks one row per entry: a sample
 * and its text. The sample of an `edge` entry is a real edge with the
 * entry's edge fields between two hidden junctions (so its dash, arrowheads
 * and line width are those of the edges it explains); the sample of a `node`
 * entry is a small node with the entry's node fields. The text is a `label`
 * node.
 *
 * The expansion runs after the `component` stage (it needs the legend's
 * validated `props.entries`) and resolves the parts it adds through the same
 * stage. Later stages (asset, theme, profile, lint, IR) see the parts as
 * ordinary elements. Like a caption (#130), each part has a reserved ID and
 * records its origin (`doc.expanded`), so diagnostics about it point at the
 * legend's entry; the frame group points at the legend node.
 *
 * Legends need the structured engine (the manifest's `engines`; an `auto`
 * figure gets `layout/structured-only` from the component stage) and are
 * placed in an arrange tree, never by `attach`.
 */

import {
  type CheckState,
  type ElementKey,
  type ExpandedOrigin,
  edgeKey,
  groupKey,
  invalidateDependents,
  nodeKey,
} from "../check-state";
import type { DocPath } from "../diagnostics";
import { builtinRegistry, LEGEND_ID, TOKENS_ID } from "../registry/builtins";
import {
  componentId,
  type GroupManifest,
  type NodeManifest,
  type ResolvedComponent,
} from "../registry/manifest";
import type { Registry } from "../registry/registry";
import { resolveComponents } from "../registry/resolve";
import { getTheme } from "../theme/builtin";
import { resolveStyle } from "../theme/resolve";
import type { Tone } from "../theme/tones";
import { recordExpanded, reportReservedId, takenIds } from "./expand";
import { errorAt } from "./report";
import type { ArrangeBox, ArrangeItem, FigureEdge, FigureGroup, FigureNode } from "./schema";
import type { Locator } from "./yaml";

/** One entry of `props.entries`, as validated by the manifest. */
export interface LegendEntry {
  edge?: { component?: string; variant?: string };
  node?: { component?: string; variant?: string; tone?: Tone };
  label: string;
}

/** One expanded entry of a legend. */
export interface LegendEntryExpansion {
  /** `edge`: a sample line; `node`: a sample box. */
  kind: "edge" | "node";
  /** The sample edge or node. */
  sample: ElementKey;
  /** `["nodes", i, "props", "entries", j]`. */
  path: DocPath;
  label: string;
}

/** A legend node and what it was expanded into (`doc.legends`). */
export interface LegendExpansion {
  /** The legend's ID: also the ID of its frame group. */
  id: string;
  /** Where the legend node is written: `["nodes", i]`. */
  path: DocPath;
  entries: LegendEntryExpansion[];
}

/**
 * The sizes of a legend's rows, in em of the entries' text (the theme's
 * `sumi/label` font size), so samples grow with the text and the lines of
 * a theme for slides: at 8pt a sample is 20pt wide (a line long enough for
 * two dashes and an arrowhead) and a box 9pt high.
 */
export const LEGEND_EM = {
  /** Width of a sample: a box, or a line with its two hidden junctions. */
  sample: 2.5,
  /** Height of a sample box (a fixed-aspect shape is a square of it). */
  box: 1.125,
  /** Space between a sample and its text. */
  textGap: 0.5,
  /** Space between rows. */
  rowGap: 0.375,
} as const;

/** The text size used when the figure's theme is unknown (an error is reported). */
const FALLBACK_EM_PT = 8;

/** Sizes of a legend's rows in pt, as whole D2 units (0.5pt). */
export interface LegendSizes {
  sample: number;
  box: number;
  textGap: number;
  rowGap: number;
  /** Length of a sample line between its junctions: `sample` minus the junctions. */
  line: number;
}

/** {@link LEGEND_EM} for the text size `emPt` and junctions `junctionPt` across. */
export function legendSizes(emPt: number, junctionPt: number): LegendSizes {
  const units = (em: number) => Math.max(0.5, Math.round(em * emPt * 2) / 2);
  const sample = units(LEGEND_EM.sample);
  return {
    sample,
    box: units(LEGEND_EM.box),
    textGap: units(LEGEND_EM.textGap),
    rowGap: units(LEGEND_EM.rowGap),
    line: Math.max(0.5, sample - 2 * junctionPt),
  };
}

/** The sizes for the figure's theme: its label font size and hidden junction. */
function themeSizes(themeId: string | undefined): LegendSizes {
  const theme = themeId === undefined ? undefined : getTheme(themeId);
  if (theme === undefined) return legendSizes(FALLBACK_EM_PT, 0.5);
  const text = resolveStyle(theme, { kind: "node", id: "sumi/label", variant: "default" });
  const junction = resolveStyle(theme, { kind: "node", id: "sumi/junction", variant: "hidden" });
  // A point mark's diameter (design doc §6.20): `size` stroke widths, at least one D2 unit.
  const manifest = builtinRegistry().get("sumi/junction");
  const mark = manifest?.kind === "node" ? manifest.mark : undefined;
  const units = Math.max(1, Math.round((mark?.size ?? 0) * junction.style.strokeWidth.units));
  return legendSizes(text.style.fontSize.pt, units / 2);
}

/** The reserved IDs of the parts of entry `n` (1-based) of legend `id`. */
export function legendPartIds(id: string, n: number) {
  return {
    label: `${id}-${n}-label`,
    box: `${id}-${n}-box`,
    start: `${id}-${n}-start`,
    end: `${id}-${n}-end`,
    /** The sample edge (edges have their own ID space). */
    line: `${id}-${n}-line`,
  };
}

/**
 * The group manifest the frame of a legend is resolved as: the legend's own
 * name, variants and theme styles (`components.legend` in a theme), drawn
 * as a group around its entries.
 */
function frameManifest(legend: NodeManifest): GroupManifest {
  const { version, namespace, name, description, variants, props, since } = legend;
  return {
    kind: "group",
    version,
    namespace,
    name,
    description,
    variants,
    props,
    since,
    shape: "rectangle",
  };
}

/** Why a node component cannot draw a sample box, or `undefined` if it can. */
function sampleBoxProblem(manifest: NodeManifest): string | undefined {
  if (manifest.mark !== undefined) return "is drawn as a fixed mark";
  if (manifest.embed !== undefined) return "embeds an image file";
  if (manifest.shape === "text") return "draws only its label";
  if (componentId(manifest) === LEGEND_ID) return "is a legend";
  // Tokens (#181) are expanded into cells, never drawn as one box.
  if (componentId(manifest) === TOKENS_ID) return "is drawn as its cells";
  return undefined;
}

/**
 * Runs the expansion on `state.doc` (see the module comment). Errors:
 * `ref/reserved-id` for an element that uses the reserved ID of a part,
 * `layout/attached-legend` for a legend placed by `attach`,
 * `asset/icon-unsupported` for a legend with an icon and
 * `component/invalid-prop` for a sample box of a component that cannot draw
 * one (a mark, image, text or legend). A legend with an error is not
 * expanded and becomes invalid.
 */
export function expandLegends(state: CheckState, registry: Registry, locate: Locator): void {
  const { doc, invalid } = state;
  const { groups, nodes, edges } = doc;
  const components = state.components;
  if (groups === undefined || nodes === undefined || edges === undefined) return;
  if (components === undefined || doc.figure?.layout.engine !== "structured") return;

  const taken = takenIds(doc);
  const takenEdges = new Map<string, DocPath>();
  for (const [index, edge] of edges.entries()) {
    if (edge?.id !== undefined && !takenEdges.has(edge.id))
      takenEdges.set(edge.id, ["edges", index]);
  }
  const added = new Set<ElementKey>();
  let sizes: LegendSizes | undefined;
  const origins: [ElementKey, ExpandedOrigin][] = [];
  const legends: LegendExpansion[] = [];

  for (const [index, node] of nodes.entries()) {
    if (node === undefined) continue;
    const key = nodeKey(node.id);
    const component = components.get(key);
    if (component?.id !== LEGEND_ID || invalid.has(key)) continue;
    if (component.manifest.kind !== "node") continue;
    const legendPath: DocPath = ["nodes", index];
    const subject = { kind: "node", id: node.id } as const;
    const fail = (code: string, message: string, at: DocPath, hint: string) => {
      state.diagnostics.push(errorAt(locate, code, message, at, { subject, hint }));
      invalid.add(key);
    };
    if (node.attach !== undefined) {
      fail(
        "layout/attached-legend",
        `Legend "${node.id}" is drawn as a frame around its entries, so it cannot be attached.`,
        [...legendPath, "attach"],
        "Remove attach and list the legend in an arrange tree, e.g. in a row or stack next to what it explains.",
      );
      continue;
    }
    if (node.icon !== undefined) {
      fail(
        "asset/icon-unsupported",
        `${LEGEND_ID} cannot draw an icon; icons go on plain shapes such as box, circle or label.`,
        [...legendPath, "icon"],
        "Remove the icon; a legend's title is its label.",
      );
      continue;
    }
    if (node.labelRotation !== undefined) {
      fail(
        "component/label-rotation-unsupported",
        `Legend "${node.id}" lays its title out above its entries, so its label cannot be turned.`,
        [...legendPath, "labelRotation"],
        "Remove labelRotation.",
      );
      continue;
    }

    const entries = component.props.entries as LegendEntry[];
    const entriesPath: DocPath = [...legendPath, "props", "entries"];
    // 1. Every reserved ID must be free.
    let blocked = false;
    for (const [j, entry] of entries.entries()) {
      const ids = legendPartIds(node.id, j + 1);
      const parts =
        entry.edge !== undefined ? [ids.label, ids.start, ids.end] : [ids.label, ids.box];
      const related = { path: [...entriesPath, j], message: "The legend entry is written here." };
      for (const id of parts) {
        const owner = taken.get(id);
        const reservedFor = `entry ${j + 1} of legend "${node.id}"`;
        if (owner !== undefined) {
          reportReservedId(state, locate, { id, owner, reservedFor, related });
          blocked = true;
        } else if (invalid.has(nodeKey(id)) || invalid.has(groupKey(id))) {
          // An unreadable element may hold the ID: its own error explains the figure.
          blocked = true;
        }
      }
      const owner = entry.edge !== undefined ? takenEdges.get(ids.line) : undefined;
      if (owner !== undefined) {
        reportReservedId(state, locate, {
          id: ids.line,
          owner,
          reservedFor: `the sample line of entry ${j + 1} of legend "${node.id}"`,
          related,
        });
        blocked = true;
      }
    }
    // 2. Every sample box must be a shape.
    for (const [j, entry] of entries.entries()) {
      if (entry.node === undefined) continue;
      const resolved = registry.resolve(entry.node.component ?? "box", "node");
      if (!resolved.ok || resolved.value.kind !== "node") continue;
      const problem = sampleBoxProblem(resolved.value);
      if (problem === undefined) continue;
      fail(
        "component/invalid-prop",
        `Invalid prop "entries[${j}].node.component" for ${LEGEND_ID}: ${componentId(resolved.value)} ${problem}, so it cannot be a sample box.`,
        [...entriesPath, j, "node", "component"],
        "Use a shape such as box, circle or ellipse; describe lines with edge instead of node.",
      );
      blocked = true;
    }
    if (blocked) {
      invalid.add(key);
      continue;
    }

    // 3. Expand.
    sizes ??= themeSizes(doc.figure?.theme);
    const legendName = `legend "${node.id}"`;
    const rows: ArrangeItem[] = [];
    const expansion: LegendExpansion = { id: node.id, path: legendPath, entries: [] };
    const addNode = (part: FigureNode, path: DocPath, name: string) => {
      nodes.push(part);
      const partKey = nodeKey(part.id);
      added.add(partKey);
      origins.push([partKey, { from: "legend", path, subject, name }]);
      taken.set(part.id, path);
    };
    const partNode = (id: string, component: string, variant: string): FigureNode => ({
      id,
      component,
      label: "",
      variant,
      props: {},
      group: node.id,
    });
    for (const [j, entry] of entries.entries()) {
      const n = j + 1;
      const ids = legendPartIds(node.id, n);
      const entryPath: DocPath = [...entriesPath, j];
      const of = `of entry ${n} of ${legendName}`;
      addNode(
        { ...partNode(ids.label, "sumi/label", "default"), label: entry.label },
        entryPath,
        `the text ${of}`,
      );
      if (entry.edge !== undefined) {
        const linePath: DocPath = [...entryPath, "edge"];
        addNode(partNode(ids.start, "sumi/junction", "hidden"), linePath, `the sample line ${of}`);
        addNode(partNode(ids.end, "sumi/junction", "hidden"), linePath, `the sample line ${of}`);
        const edge: FigureEdge = {
          id: ids.line,
          from: ids.start,
          to: ids.end,
          label: "",
          component: entry.edge.component ?? "arrow",
          variant: entry.edge.variant ?? "default",
          props: {},
        };
        edges.push(edge);
        const sample = edgeKey(ids.line, edges.length - 1);
        added.add(sample);
        origins.push([
          sample,
          { from: "legend", path: linePath, subject, name: `the sample line ${of}` },
        ]);
        takenEdges.set(ids.line, linePath);
        expansion.entries.push({ kind: "edge", sample, path: entryPath, label: entry.label });
        rows.push(row(sizes.textGap, [row(sizes.line, [ids.start, ids.end]), ids.label]));
      } else {
        const fields = entry.node ?? {};
        const boxPath: DocPath = [...entryPath, "node"];
        const box = partNode(ids.box, fields.component ?? "box", fields.variant ?? "default");
        const resolved = registry.resolve(box.component, "node");
        if (resolved.ok && resolved.value.kind === "node") {
          box.props = sampleBoxSize(resolved.value, sizes);
        }
        if (fields.tone !== undefined) box.tone = fields.tone;
        addNode(box, boxPath, `the sample box ${of}`);
        expansion.entries.push({
          kind: "node",
          sample: nodeKey(ids.box),
          path: entryPath,
          label: entry.label,
        });
        rows.push(row(sizes.textGap, [ids.box, ids.label]));
      }
    }
    // The frame takes the legend node's place: its ID, parent and position.
    const frame: FigureGroup = {
      id: node.id,
      label: node.label,
      component: LEGEND_ID,
      variant: component.variant,
      ...(node.tone !== undefined && { tone: node.tone }),
      ...(node.group !== undefined && { group: node.group }),
      arrange: { stack: { direction: "down", gap: sizes.rowGap, align: "start", items: rows } },
    };
    groups.push(frame);
    nodes[index] = undefined;
    components.delete(key);
    const frameKey = groupKey(node.id);
    const frameComponent: ResolvedComponent = {
      id: LEGEND_ID,
      manifest: frameManifest(component.manifest),
      variant: component.variant,
      props: {},
    };
    components.set(frameKey, frameComponent);
    origins.push([frameKey, { from: "legend", path: legendPath, subject, name: legendName }]);
    legends.push(expansion);
  }
  if (legends.length === 0) {
    invalidateDependents(state);
    return;
  }
  doc.legends = legends;
  recordExpanded(doc, origins);
  resolveComponents(state, registry, locate, { only: added });
}

/** A row box with the items centred on one line. */
function row(gap: number, items: ArrangeItem[]): ArrangeBox {
  return { row: { direction: "right", gap, align: "center", items } };
}

/** The props of a sample box: its size, if the component takes one. */
function sampleBoxSize(manifest: NodeManifest, sizes: LegendSizes): Record<string, unknown> {
  const shape = manifest.props.shape as Record<string, unknown>;
  if (!("width" in shape) || !("height" in shape)) return {};
  // Written as in a figure: the component stage validates them like any props.
  const width = manifest.sizing === "fixed-aspect-1" ? sizes.box : sizes.sample;
  return { width: `${width}pt`, height: `${sizes.box}pt` };
}
