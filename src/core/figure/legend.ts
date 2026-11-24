/**
 * Legends (#131, design doc §6.34): a `sumi/legend` node is expanded into a
 * frame group with the legend's ID that stacks one row per entry: a sample
 * and its text. The sample of an `edge` entry is a real edge with the
 * entry's edge fields between two hidden junctions (so its dash, arrowheads,
 * line width and color are those of the edges it explains); the sample of a `node`
 * entry is a small node with the entry's node fields. The sample of a
 * `class` entry (#180) is a box drawn as the cells of that class of a matrix
 * (its tone, variant and hatch; matrices are expanded first), and its text
 * defaults to the class's label. The text is a `label` node.
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

import { glyphSize } from "../../assets/glyphs";
import { bundleArrowheadScale, edgeArrowheadLength } from "../../layout/route/arrowhead";
import { strokePattern } from "../../render/stroke";
import {
  type CheckState,
  type ElementKey,
  type ExpandedOrigin,
  type ExpandedPaint,
  edgeKey,
  groupKey,
  invalidateDependents,
  nodeKey,
  type PartialFigure,
} from "../check-state";
import { type DocPath, didYouMean } from "../diagnostics";
import {
  builtinRegistry,
  LEGEND_ID,
  MATRIX_ID,
  MATRIX_SCALE_LEGEND_SAMPLES,
  TOKENS_ID,
} from "../registry/builtins";
import type { Arrowhead } from "../registry/manifest";
import {
  componentId,
  type GroupManifest,
  type NodeManifest,
  type ResolvedComponent,
} from "../registry/manifest";
import type { Registry } from "../registry/registry";
import { resolveComponents } from "../registry/resolve";
import { getTheme } from "../theme/builtin";
import { deltaE } from "../theme/color-math";
import { expandColor, paleStyle } from "../theme/dim";
import { figureTheme } from "../theme/overrides";
import { resolveStyle, withDash } from "../theme/resolve";
import { withStrokes } from "../theme/strokes";
import type { Tone } from "../theme/tones";
import { recordExpanded, reportReservedId, takenIds } from "./expand";
import {
  formatScaleValue,
  MATRIX_SCALE_TONE,
  MATRIX_SCALE_VARIANT,
  type MatrixExpansion,
  type MatrixScale,
  MUTED_VARIANT,
} from "./matrix";
import { errorAt, relatedAt } from "./report";
import type {
  ArrangeBox,
  ArrangeItem,
  EdgeDash,
  FigureEdge,
  FigureGlyph,
  FigureGroup,
  FigureNode,
  FigureSet,
  SetVariant,
} from "./schema";
import type { Locator } from "./yaml";

/** One entry of `props.entries`, as validated by the manifest. */
export interface LegendEntry {
  edge?: {
    component?: string;
    variant?: string;
    tone?: Tone;
    lineWidth?: number;
    arrowheadScale?: number;
    /** `dashed` or `dotted` on any variant (#614). */
    dash?: EdgeDash;
    /** Parallel lines of a bundle sample (#614). */
    strands?: number;
  };
  node?: { component?: string; variant?: string; tone?: Tone; cornerRadius?: number };
  /** A matrix class (#180): `<matrix>.<class>`. */
  class?: string;
  /** A matrix's color scale (#644): the matrix's ID. */
  scale?: string;
  /** An icon sample (#409), e.g. `tabler/file-text`. */
  icon?: string;
  /** The icon sample's side (#424): a number of ems or a length; one em when omitted. */
  iconSize?: number | { pt: number };
  /** The icon sample's tone (#445): the icon is drawn in the tone's line color. */
  iconTone?: Tone;
  /** A glyph sample (#409): the fields of a node glyph without its position. */
  glyph?: Omit<FigureGlyph, "at" | "dx" | "dy">;
  /** A set swatch (#409). */
  set?: { variant?: SetVariant; tone?: Tone; fillOpacity?: number };
  /** Starts a group of entries under this heading (#409). */
  heading?: string;
  /** Which side of the sample the text sits on; right when omitted (#409). */
  labelAt?: "right" | "left";
  /** Required unless `class` is given (then the class's label is the default). */
  label?: string;
}

/** One expanded entry of a legend. */
export interface LegendEntryExpansion {
  /** `edge`: a sample line; `node`: a sample box; `icon`, `glyph` and `set` (#409): see the entry. */
  kind: "edge" | "node" | "icon" | "glyph" | "set";
  /** The sample edge or node (for a set swatch, the node the set encloses). */
  sample: ElementKey;
  /** `icon`: the icon the sample draws. */
  icon?: string;
  /** `glyph`: the sample's glyph. */
  glyph?: Omit<FigureGlyph, "at" | "dx" | "dy">;
  /** `set`: the swatch's set (its ID in `doc.sets`), variant and tone. */
  set?: { id: string; variant: SetVariant; tone: Tone | undefined };
  /** `["nodes", i, "props", "entries", j]`. */
  path: DocPath;
  label: string;
  /** The matrix class a `class` entry explains (#180). */
  class?: { matrix: string; name: string };
  /** The matrix whose color scale a `scale` entry explains (#644). */
  scale?: string;
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
  /** Space between entries on one line (flow: row, #409). */
  entryGap: 1.5,
} as const;

/** The text size used when the figure's theme is unknown (an error is reported). */
const FALLBACK_EM_PT = 8;

/** Sizes of a legend's rows in pt, as whole D2 units (0.5pt). */
export interface LegendSizes {
  sample: number;
  box: number;
  textGap: number;
  rowGap: number;
  /** Space between entries on one line. */
  entryGap: number;
  /** The text size in pt, which the size of a glyph sample follows. */
  em: number;
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
    entryGap: units(LEGEND_EM.entryGap),
    em: emPt,
    line: Math.max(0.5, sample - 2 * junctionPt),
  };
}

/** The sizes for the figure's theme: its label font size and hidden junction. */
function themeSizes(
  themeId: string | undefined,
  overrides: Parameters<typeof figureTheme>[1],
): LegendSizes {
  const builtin = themeId === undefined ? undefined : getTheme(themeId);
  if (builtin === undefined) return legendSizes(FALLBACK_EM_PT, 0.5);
  // The figure's text scale (#543) applies: samples follow the scaled text.
  const theme = figureTheme(builtin, overrides);
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
    /** The heading of a group (#409). */
    heading: `${id}-${n}-heading`,
    /** The set of a set swatch (its own ID space, #409). */
    set: `${id}-${n}-set`,
    box: `${id}-${n}-box`,
    /** The `k`-th (1-based) sample box of a scale's strip (#644). */
    step: (k: number) => `${id}-${n}-step-${k}`,
    /** The values at the two ends of a scale's strip (#644). */
    low: `${id}-${n}-low`,
    high: `${id}-${n}-high`,
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
  // So is a matrix (#180): a class entry draws the box of one of its classes.
  if (componentId(manifest) === MATRIX_ID) return "is drawn as its cells";
  return undefined;
}

/**
 * Runs the expansion on `state.doc` (see the module comment). Errors:
 * `ref/reserved-id` for an element that uses the reserved ID of a part,
 * `layout/attached-legend` for a legend placed by `attach`,
 * `asset/icon-unsupported` for a legend with an icon and
 * `component/invalid-prop` for a sample box of a component that cannot draw
 * one (a mark, image, text or legend) or a class entry without a label
 * (#180), and `ref/unknown-class` for a class entry that names no class of
 * a matrix. A legend with an error, or with a class entry of a matrix that
 * has an error of its own, is not expanded and becomes invalid.
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
  const paints = new Map<ElementKey, ExpandedPaint>(doc.paints ?? []);
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
    if (node.sublabel !== undefined) {
      fail(
        "component/sublabel-unsupported",
        `Legend "${node.id}" draws its label as a title above its entries, so it takes no sublabel.`,
        [...legendPath, "sublabel"],
        "Remove sublabel; put the text into the label (a newline breaks the line).",
      );
      continue;
    }

    const entries = component.props.entries as LegendEntry[];
    const entriesPath: DocPath = [...legendPath, "props", "entries"];
    let blocked = false;
    // 0. Every class entry (#180) must name a class of a matrix, and have a label.
    const classes = new Map<number, { matrix: MatrixExpansion; name: string; label: string }>();
    for (const [j, entry] of entries.entries()) {
      if (entry.class === undefined) continue;
      const at: DocPath = [...entriesPath, j, "class"];
      const dot = entry.class.indexOf(".");
      const owner = entry.class.slice(0, dot);
      const name = entry.class.slice(dot + 1);
      const matrix = doc.matrices?.find((m) => m.id === owner);
      if (matrix === undefined) {
        // A matrix with an error of its own (not expanded) explains the figure.
        if (invalid.has(nodeKey(owner)) || invalid.has(groupKey(owner))) {
          blocked = true;
          continue;
        }
        fail(
          "ref/unknown-class",
          `Entry ${j + 1} of legend "${node.id}" names a class of "${owner}", which is not a matrix.`,
          at,
          "A class entry names a class of a matrix as <matrix>.<class>, e.g. mask.o.",
        );
        blocked = true;
        continue;
      }
      // Own classes only: `constructor` or `toString` name no class (#180).
      const cls = Object.hasOwn(matrix.classes, name) ? matrix.classes[name] : undefined;
      if (cls === undefined) {
        const names = Object.keys(matrix.classes);
        fail(
          "ref/unknown-class",
          `Unknown class "${name}" of matrix "${owner}" in entry ${j + 1} of legend "${node.id}".`,
          at,
          didYouMean(name, names) ?? `Classes of matrix "${owner}": ${names.join(", ")}.`,
        );
        blocked = true;
        continue;
      }
      const label = entry.label ?? cls.label;
      if (label === undefined) {
        fail(
          "component/invalid-prop",
          `Invalid prop "entries[${j}]" for ${LEGEND_ID}: class "${name}" of matrix "${owner}" has no label, so the entry needs one.`,
          [...entriesPath, j],
          `Give the entry a label, or give the class one (props.classes.${name}.label of the matrix).`,
        );
        blocked = true;
        continue;
      }
      classes.set(j, { matrix, name, label });
    }
    // 0b. Every scale entry (#644) must name a matrix with a scale.
    const scales = new Map<number, { matrix: MatrixExpansion; label: string | undefined }>();
    for (const [j, entry] of entries.entries()) {
      if (entry.scale === undefined) continue;
      const owner = entry.scale;
      const matrix = doc.matrices?.find((m) => m.id === owner);
      if (matrix?.scale === undefined) {
        if (matrix === undefined && (invalid.has(nodeKey(owner)) || invalid.has(groupKey(owner)))) {
          blocked = true;
          continue;
        }
        fail(
          "ref/unknown-scale",
          matrix === undefined
            ? `Entry ${j + 1} of legend "${node.id}" names the scale of "${owner}", which is not a matrix.`
            : `Entry ${j + 1} of legend "${node.id}" names the scale of matrix "${owner}", which has none.`,
          [...entriesPath, j, "scale"],
          matrix === undefined
            ? "A scale entry names a matrix with props.scale by its ID."
            : `Give matrix "${owner}" a props.scale { from, to }, or explain its classes with class entries.`,
        );
        blocked = true;
        continue;
      }
      scales.set(j, { matrix, label: entry.label ?? matrix.scale.spec.label });
    }
    // 1. Every reserved ID must be free.
    for (const [j, entry] of entries.entries()) {
      const ids = legendPartIds(node.id, j + 1);
      const steps = scales.get(j)?.matrix.scale?.spec.steps ?? MATRIX_SCALE_LEGEND_SAMPLES;
      const parts = [
        ids.label,
        ...(entry.edge !== undefined
          ? [ids.start, ids.end]
          : entry.scale !== undefined
            ? [ids.low, ids.high, ...Array.from({ length: steps }, (_, k) => ids.step(k + 1))]
            : [ids.box]),
        ...(entry.heading !== undefined ? [ids.heading] : []),
      ];
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
      // The set of a set swatch has an ID space of its own.
      const setIndex =
        entry.set === undefined
          ? -1
          : (doc.sets ?? []).findIndex((existing) => existing?.id === ids.set);
      if (setIndex >= 0) {
        state.diagnostics.push(
          errorAt(
            locate,
            "ref/reserved-id",
            `The ID "${ids.set}" is reserved for the swatch of entry ${j + 1} of legend "${node.id}".`,
            ["sets", setIndex, "id"],
            {
              subject: { kind: "set", id: ids.set },
              hint: "Rename this set: Sumi draws the swatch as a set with this ID.",
              related: [
                relatedAt(locate, [...entriesPath, j], "The legend entry is written here."),
              ],
            },
          ),
        );
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
    sizes ??= themeSizes(doc.figure?.theme, doc.figure?.themeOverrides);
    const size = sizes;
    const legendName = `legend "${node.id}"`;
    // Entries are read as a list: wrapped lines start at the left (#333), unless
    // the legend asks otherwise with its own `textAlign`.
    const textAlign = node.textAlign ?? "left";
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
    const flow = (component.props.flow as "column" | "row" | undefined) ?? "column";
    const perRow = component.props.perRow as number | undefined;
    const inline = flow === "row" && component.props.headings === "inline";
    // The groups of entries (#409): a heading starts a new one.
    const sections: { heading?: string; items: ArrangeItem[] }[] = [{ items: [] }];
    for (const [j, entry] of entries.entries()) {
      const n = j + 1;
      const ids = legendPartIds(node.id, n);
      const entryPath: DocPath = [...entriesPath, j];
      const of = `of entry ${n} of ${legendName}`;
      const matrixClass = classes.get(j);
      const matrixScale = scales.get(j);
      const label = matrixClass?.label ?? matrixScale?.label ?? entry.label ?? "";
      if (entry.heading !== undefined) {
        addNode(
          {
            ...partNode(ids.heading, "sumi/label", "default"),
            label: entry.heading,
            textAlign,
          },
          [...entryPath, "heading"],
          `the heading ${of}`,
        );
        const last = sections.at(-1);
        if (last !== undefined && last.heading === undefined && last.items.length === 0) {
          last.heading = ids.heading;
        } else {
          sections.push({ heading: ids.heading, items: [] });
        }
      }
      // A scale's strip may stand alone (#644): it has its values at its ends.
      const hasText = label !== "";
      if (hasText)
        addNode(
          { ...partNode(ids.label, "sumi/label", "default"), label, textAlign },
          entryPath,
          `the text ${of}`,
        );
      // The sample and its text, side by side (the text first with labelAt: left).
      const withText = (sample: ArrangeItem): ArrangeBox =>
        hasText
          ? row(size.textGap, entry.labelAt === "left" ? [ids.label, sample] : [sample, ids.label])
          : row(size.textGap, [sample]);
      let item: ArrangeBox;
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
          ...(entry.edge.tone !== undefined && { tone: entry.edge.tone }),
          ...(entry.edge.lineWidth !== undefined && { lineWidth: entry.edge.lineWidth }),
          ...(entry.edge.arrowheadScale !== undefined && {
            arrowheadScale: entry.edge.arrowheadScale,
          }),
          ...(entry.edge.dash !== undefined && { dash: entry.edge.dash }),
          ...(entry.edge.strands !== undefined && { strands: entry.edge.strands }),
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
        expansion.entries.push({ kind: "edge", sample, path: entryPath, label });
        const builtinTheme = getTheme(doc.figure?.theme ?? "paper");
        const theme = builtinTheme && figureTheme(builtinTheme, doc.figure?.themeOverrides);
        let line = sizes.line;
        if (theme !== undefined) {
          const resolved = registry.resolve(edge.component, "edge");
          if (resolved.ok && resolved.value.kind === "edge") {
            const id = componentId(resolved.value);
            const variantStyle = resolveStyle(theme, {
              kind: "edge",
              id,
              variant: edge.variant,
            });
            const base =
              edge.dash === undefined
                ? variantStyle
                : { ...variantStyle, style: withDash(variantStyle.style, theme, id, edge.dash) };
            const reference = resolveStyle(theme, { kind: "edge", id, variant: "default" });
            const style = withStrokes(base.style, {
              frame: false,
              reference: reference.style.strokeWidth,
              figure: doc.figure?.themeOverrides,
              element: edge,
            });
            const pattern = strokePattern(style);
            if (pattern) {
              // Two heads, plus two complete periods; sizes here are in pt.
              line = Math.max(
                line,
                Math.ceil(
                  ((2 * edgeArrowheadLength(style) + 2 * (pattern[0] + pattern[1])) / 2) * 2,
                ) / 2,
              );
            }
            if (edge.strands !== undefined && style.kind === "edge") {
              // A bundle (#614): its heads as the compiler grows them for their forms
              // (`bundleStyle()`), so the sample keeps room for two of them (and two periods).
              const manifest = resolved.value;
              const standard = builtinTheme?.arrowhead ?? "triangle";
              const form = (head: Arrowhead | undefined) =>
                (head ?? "triangle") === "triangle" ? standard : (head as Arrowhead);
              const heads = [
                ...(manifest.direction === "backward" || manifest.direction === "both"
                  ? [form(manifest.tail)]
                  : []),
                ...(manifest.direction === "forward" || manifest.direction === "both"
                  ? [form(manifest.head)]
                  : []),
              ];
              const scale =
                edge.arrowheadScale !== undefined || heads.length === 0
                  ? (style.arrowheadScale ?? 1)
                  : Math.max(
                      style.arrowheadScale ?? 1,
                      bundleArrowheadScale(style.strokeWidth.units, edge.strands, heads),
                    );
              const head = edgeArrowheadLength({ ...style, arrowheadScale: scale });
              const periods = pattern === undefined ? 0 : 2 * (pattern[0] + pattern[1]);
              // Visible line between the heads: at least an ordinary sample's (its line less
              // its one head), and two dash periods on a dashed one; units here, `line` in pt.
              const stem = Math.max(sizes.line * 2 - edgeArrowheadLength(style), 0);
              line = Math.max(
                line,
                Math.ceil(((Math.max(heads.length, 1) * head + Math.max(periods, stem)) / 2) * 2) /
                  2,
              );
            }
          }
        }
        item = withText(row(line, [ids.start, ids.end]));
      } else if (matrixScale !== undefined) {
        // The strip of a matrix's color scale (#644): one box per step (five for a continuous
        // scale) between the values at its ends, painted as the cells at those steps.
        const { matrix } = matrixScale;
        const scale = matrix.scale?.spec as MatrixScale;
        const scalePath: DocPath = [...entryPath, "scale"];
        const tone = scale.tone ?? MATRIX_SCALE_TONE;
        const steps = scale.steps ?? MATRIX_SCALE_LEGEND_SAMPLES;
        const boxes: string[] = [];
        for (let k = 0; k < steps; k++) {
          const id = ids.step(k + 1);
          addNode(
            {
              ...partNode(id, "box", MATRIX_SCALE_VARIANT),
              tone,
              props: { width: `${size.box}pt`, height: `${size.box}pt` },
            },
            scalePath,
            `step ${k + 1} of the scale ${of}`,
          );
          paints.set(nodeKey(id), {
            ramp: k / (steps - 1),
            ...(matrix.rules === true && { borderless: true }),
          });
          boxes.push(id);
        }
        for (const [id, value, end] of [
          [ids.low, scale.from, "low"],
          [ids.high, scale.to, "high"],
        ] as const)
          addNode(
            {
              ...partNode(id, "sumi/label", "default"),
              label: formatScaleValue(value, scale),
            },
            scalePath,
            `the ${end} end of the scale ${of}`,
          );
        expansion.entries.push({
          kind: "node",
          sample: nodeKey(ids.step(1)),
          path: entryPath,
          label,
          scale: matrix.id,
        });
        item = withText(row(size.textGap / 2, [ids.low, row(0, boxes), ids.high]));
      } else if (matrixClass !== undefined) {
        // The sample box of a matrix class (#180): a box as the class's cells.
        const { matrix, name } = matrixClass;
        const cls = (Object.hasOwn(matrix.classes, name) && matrix.classes[name]) || {};
        const box = partNode(ids.box, "box", cls.variant ?? matrix.cellVariant);
        const resolved = registry.resolve(box.component, "node");
        if (resolved.ok && resolved.value.kind === "node") {
          box.props = sampleBoxSize(resolved.value, sizes);
        }
        if (cls.tone !== undefined) box.tone = cls.tone;
        addNode(box, [...entryPath, "class"], `the sample box ${of}`);
        // As pale as the class's muted cells (#612). In a ruled matrix the sample has no border,
        // as its cells (#644); cells with no visible fill are explained by their text instead.
        const sampleVariant = cls.variant ?? matrix.cellVariant;
        const bare =
          matrix.rules === true &&
          cls.pattern !== "hatch" &&
          !fillShows(doc, cls.tone, sampleVariant);
        const text = bare ? classText(doc, matrix, name) : undefined;
        if (text !== undefined) {
          box.label = text;
          box.props = {};
        }
        const paint: ExpandedPaint = {
          ...(cls.pattern === "hatch" && { hatch: true }),
          ...(sampleVariant === MUTED_VARIANT && { pale: true }),
          ...(matrix.rules === true && (!bare || text !== undefined) && { borderless: true }),
        };
        if (Object.keys(paint).length > 0) paints.set(nodeKey(ids.box), paint);
        expansion.entries.push({
          kind: "node",
          sample: nodeKey(ids.box),
          path: entryPath,
          label,
          class: { matrix: matrix.id, name },
        });
        item = withText(ids.box);
      } else if (entry.icon !== undefined) {
        // An icon sample (#409): a label node that draws the icon, one em tall or `iconSize`.
        addNode(
          {
            ...partNode(ids.box, "sumi/label", "default"),
            icon: entry.icon,
            ...(entry.iconSize !== undefined && { iconSize: entry.iconSize }),
            ...(entry.iconTone !== undefined && { tone: entry.iconTone }),
          },
          [...entryPath, "icon"],
          `the sample icon ${of}`,
        );
        expansion.entries.push({
          kind: "icon",
          sample: nodeKey(ids.box),
          path: entryPath,
          label,
          icon: entry.icon,
        });
        item = withText(ids.box);
      } else if (entry.glyph !== undefined) {
        // A glyph sample (#409): the glyph centered on an empty, bare box sized to it.
        const extent = glyphSize(entry.glyph, sizes.em * 2);
        const box: FigureNode = {
          ...partNode(ids.box, "box", "default"),
          props: {
            width: `${Math.ceil(extent.width) / 2}pt`,
            height: `${Math.ceil(extent.height) / 2}pt`,
          },
          glyphs: [{ ...entry.glyph, at: "center" }],
        };
        addNode(box, [...entryPath, "glyph"], `the sample glyph ${of}`);
        paints.set(nodeKey(ids.box), { bare: true });
        expansion.entries.push({
          kind: "glyph",
          sample: nodeKey(ids.box),
          path: entryPath,
          label,
          glyph: entry.glyph,
        });
        item = withText(ids.box);
      } else if (entry.set !== undefined) {
        // A set swatch (#409): a set around an empty, bare box, as wide as a sample box, with no padding.
        const setPath: DocPath = [...entryPath, "set"];
        const box: FigureNode = {
          ...partNode(ids.box, "box", "default"),
          props: { width: `${sizes.sample}pt`, height: `${sizes.box}pt` },
        };
        addNode(box, setPath, `the sample swatch ${of}`);
        paints.set(nodeKey(ids.box), { bare: true });
        const swatch: FigureSet = {
          id: ids.set,
          label: "",
          members: [ids.box],
          shape: "rect",
          padding: 0,
          variant: entry.set.variant ?? "default",
          ...(entry.set.tone !== undefined && { tone: entry.set.tone }),
          ...(entry.set.fillOpacity !== undefined && { fillOpacity: entry.set.fillOpacity }),
        };
        doc.sets ??= [];
        doc.sets.push(swatch);
        expansion.entries.push({
          kind: "set",
          sample: nodeKey(ids.box),
          path: entryPath,
          label,
          set: { id: ids.set, variant: swatch.variant, tone: entry.set.tone },
        });
        item = withText(ids.box);
      } else {
        const fields = entry.node ?? {};
        const boxPath: DocPath = [...entryPath, "node"];
        const box = partNode(ids.box, fields.component ?? "box", fields.variant ?? "default");
        const resolved = registry.resolve(box.component, "node");
        if (resolved.ok && resolved.value.kind === "node") {
          box.props = sampleBoxSize(resolved.value, sizes);
        }
        if (fields.tone !== undefined) box.tone = fields.tone;
        if (fields.cornerRadius !== undefined) box.cornerRadius = fields.cornerRadius;
        addNode(box, boxPath, `the sample box ${of}`);
        expansion.entries.push({
          kind: "node",
          sample: nodeKey(ids.box),
          path: entryPath,
          label,
        });
        item = withText(ids.box);
      }
      sections.at(-1)?.items.push(item);
    }
    // The lines (#409): a column is one entry per line, with each heading on a line of its
    // own; a row is the entries of a group side by side, wrapping after `perRow` of them,
    // the heading beside the lines of its group.
    const rows: ArrangeItem[] = [];
    if (inline) {
      // Inline headings (#446): the groups follow one another on the same lines, each heading
      // beside its group's first entry. A line holds `perRow` entries; a break goes before a
      // heading, so a group is split only when it alone has more than `perRow` entries, and
      // then it is a small table: the heading, and its lines hanging after the heading's width.
      const limit = perRow ?? Number.POSITIVE_INFINITY;
      let line: ArrangeItem[] = [];
      const flush = () => {
        if (line.length > 0) rows.push(row(size.entryGap, line));
        line = [];
      };
      for (const section of sections) {
        const { heading, items } = section;
        if (items.length === 0) continue;
        if (items.length <= limit) {
          if (line.length + items.length > limit) flush();
          line.push(
            ...items.map((item, i) =>
              i === 0 && heading !== undefined ? row(size.textGap, [heading, item]) : item,
            ),
          );
          continue;
        }
        flush();
        const lines: ArrangeItem[] = [];
        for (let start = 0; start < items.length; start += limit) {
          lines.push(row(size.entryGap, items.slice(start, start + limit)));
        }
        const block: ArrangeBox = {
          stack: { direction: "down", gap: size.rowGap, align: "start", items: lines },
        };
        rows.push(
          heading === undefined
            ? block
            : {
                grid: {
                  columns: 2,
                  columnGap: size.textGap,
                  rowGap: size.rowGap,
                  align: "start",
                  items: [heading, block],
                },
              },
        );
      }
      flush();
    }
    // Headed groups of a row legend (heading, lines), laid out as the rows of one table.
    const table: ArrangeItem[] = [];
    for (const section of inline ? [] : sections) {
      if (flow === "column") {
        if (section.heading !== undefined) rows.push(section.heading);
        rows.push(...section.items);
        continue;
      }
      const lineLength = perRow ?? Math.max(1, section.items.length);
      const lines: ArrangeItem[] = [];
      for (let start = 0; start < section.items.length; start += lineLength) {
        lines.push(row(sizes.entryGap, section.items.slice(start, start + lineLength)));
      }
      if (lines.length === 0) continue;
      if (section.heading === undefined) {
        rows.push(...lines);
        continue;
      }
      // The heading goes beside all the lines of its group, which start under the first entry.
      // A grid keeps the headings of all groups in one column, as wide as the widest.
      const block: ArrangeBox = {
        stack: { direction: "down", gap: sizes.rowGap, align: "start", items: lines },
      };
      table.push(section.heading, block);
    }
    if (table.length > 0) {
      rows.push({
        grid: {
          columns: 2,
          columnGap: sizes.textGap,
          rowGap: sizes.rowGap,
          align: "start",
          items: table,
        },
      });
    }
    // The frame takes the legend node's place: its ID, parent and position.
    const frame: FigureGroup = {
      id: node.id,
      label: node.label,
      component: LEGEND_ID,
      variant: component.variant,
      ...(node.tone !== undefined && { tone: node.tone }),
      ...(node.lineWidth !== undefined && { lineWidth: node.lineWidth }),
      ...(node.cornerRadius !== undefined && { cornerRadius: node.cornerRadius }),
      ...(node.group !== undefined && { group: node.group }),
      arrange: { stack: { direction: "down", gap: sizes.rowGap, align: "start", items: rows } },
    };
    groups.push(frame);
    nodes[index] = undefined;
    components.delete(key);
    const frameKey = groupKey(node.id);
    if (node.mono !== undefined) paints.set(frameKey, { mono: node.mono });
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
  if (paints.size > 0) doc.paints = paints;
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
  // A solid (a cuboid, #575) is a small cube of the sample's height.
  if ("depth" in shape)
    return { width: `${sizes.box}pt`, height: `${sizes.box}pt`, depth: `${sizes.box}pt` };
  const width = manifest.sizing === "fixed-aspect-1" ? sizes.box : sizes.sample;
  return { width: `${width}pt`, height: `${sizes.box}pt` };
}

/** A fill closer than this (CIE76) to the canvas is not seen (#644). */
const UNSEEN_FILL = 2;

/**
 * Whether a matrix cell of this tone and variant shows a fill on the figure's
 * canvas (#644): a ruled matrix's cells without one are only their text.
 */
function fillShows(doc: PartialFigure, tone: Tone | undefined, variant: string): boolean {
  const builtin = getTheme(doc.figure?.theme ?? "paper");
  if (builtin === undefined) return true;
  const theme = figureTheme(builtin, doc.figure?.themeOverrides);
  const { style } = resolveStyle(theme, {
    kind: "node",
    id: "sumi/box",
    variant,
    ...(tone !== undefined && { tone }),
  });
  const drawn = variant === MUTED_VARIANT ? paleStyle(style, theme.canvas) : style;
  if (drawn.fill === "transparent") return false;
  return deltaE(expandColor(drawn.fill), expandColor(theme.canvas)) > UNSEEN_FILL;
}

/** The text of the first cell of class `name` of `matrix` that has one (#644). */
function classText(doc: PartialFigure, matrix: MatrixExpansion, name: string): string | undefined {
  for (const part of matrix.parts) {
    if (part.kind !== "cell" || part.class !== name || part.ellipsis !== undefined) continue;
    const label = doc.nodes?.find((n) => n?.id === part.id)?.label;
    if (label !== undefined && label.trim() !== "") return label;
  }
  return undefined;
}
