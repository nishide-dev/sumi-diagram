/**
 * Sequence diagrams (#630, design record 630): an arrange box
 * `sequence: {participants, rows}` is expanded into ordinary elements, so the
 * router, the SVG and PPTX writers and the geometry lint draw and check them
 * like any other figure:
 *
 * - every message (an edge named by a row) gets a hidden `junction` on each of
 *   its lifelines at its row; the edge is retargeted to those junctions and
 *   drawn `route: straight` (a self-message: a `lane` loop on the east side
 *   between two junctions of the same lifeline);
 * - every lifeline is a chain of `line` edges (muted, dashed by default) from
 *   its participant through those junctions to a hidden junction at the
 *   bottom; a note over it interrupts it between two hidden junctions on the
 *   note's top and bottom border;
 * - a fragment is a `rect` set around two hidden corner junctions, its notes
 *   and a `label` node for its heading.
 *
 * The structured engine (`layout/structured/sequence.ts`) decides the
 * coordinates: participants side by side, lifelines as far apart as the
 * labels, notes and frames between them need, and one row after another.
 * Generated IDs start with `seq-<n>-` and are reserved.
 */
import {
  type CheckState,
  type ElementKey,
  type ExpandedOrigin,
  edgeKey,
  nodeKey,
} from "../check-state";
import type { DocPath } from "../diagnostics";
import { getProfile } from "../profile/builtin";
import { spacedProfile } from "../profile/schema";
import { getTheme } from "../theme/builtin";
import { figureTheme } from "../theme/overrides";
import { resolveStyle } from "../theme/resolve";
import { recordExpanded, takenIds } from "./expand";
import { errorAt } from "./report";
import {
  type ArrangeBox,
  type FigureEdge,
  type FigureNode,
  type FigureSet,
  NodeSchema,
  type Sequence,
  type SequenceRow,
  SetSchema,
} from "./schema";
import type { Locator } from "./yaml";

/** A row after expansion: indices are positions in `participants`. */
export type SequenceRowX =
  | {
      readonly kind: "message";
      /** The edge's key (`edgeKey(id, index)`). */
      readonly edge: string;
      readonly from: number;
      readonly to: number;
      /** The hidden junctions the edge now joins, on the `from` and `to` lifelines. */
      readonly fromNode: string;
      readonly toNode: string;
      /** A self-message looping west of its lifeline (`lane: {side: west}`); east otherwise. */
      readonly west?: true;
      readonly path: DocPath;
    }
  | {
      readonly kind: "note";
      readonly node: string;
      /** The leftmost and rightmost participant the note lies over (equal for one). */
      readonly lo: number;
      readonly hi: number;
      readonly side?: "left" | "right";
      /** Over lifelines: the junctions where each lifeline from `lo` to `hi` meets its top and bottom. */
      readonly tops: readonly string[];
      readonly bottoms: readonly string[];
      readonly path: DocPath;
    }
  | {
      /** Messages and notes side by side in one row, on different lifelines. */
      readonly kind: "band";
      readonly rows: readonly SequenceRowX[];
      readonly path: DocPath;
    }
  | {
      readonly kind: "fragment";
      /** The heading's label node. */
      readonly label: string;
      /** Hidden junctions at the frame's top-left and bottom-right corners. */
      readonly topLeft: string;
      readonly bottomRight: string;
      readonly rows: readonly SequenceRowX[];
      readonly path: DocPath;
    };

export interface SequenceExpansion {
  readonly spec: Sequence;
  /** Participant IDs, left to right. */
  readonly participants: readonly string[];
  readonly rows: readonly SequenceRowX[];
  /** The hidden junction at the bottom of each lifeline, parallel to `participants`. */
  readonly ends: readonly string[];
  readonly path: DocPath;
}

/** The node and group IDs a sequence places, in order. */
export function sequenceKeys(expansion: SequenceExpansion): string[] {
  const ids: string[] = [...expansion.participants];
  const walk = (rows: readonly SequenceRowX[]) => {
    for (const row of rows) {
      if (row.kind === "message") ids.push(row.fromNode, row.toNode);
      else if (row.kind === "note") ids.push(row.node, ...row.tops, ...row.bottoms);
      else if (row.kind === "band") walk(row.rows);
      else {
        ids.push(row.label, row.topLeft, row.bottomRight);
        walk(row.rows);
      }
    }
  };
  walk(expansion.rows);
  ids.push(...expansion.ends);
  return ids;
}

/** Where a placed ID of a sequence is written, for diagnostics about its placement. */
export function sequenceItemPath(expansion: SequenceExpansion, id: string): DocPath {
  const index = expansion.participants.indexOf(id);
  if (index >= 0) return [...expansion.path, "sequence", "participants", index];
  let found: DocPath | undefined;
  const walk = (rows: readonly SequenceRowX[]) => {
    for (const row of rows) {
      if (found) return;
      if (row.kind === "note" && row.node === id) found = [...row.path, "note"];
      else if (row.kind === "band" || row.kind === "fragment") walk(row.rows);
    }
  };
  walk(expansion.rows);
  return found ?? [...expansion.path, "sequence"];
}

/**
 * The default width of the lifelines in pt: the theme's thin line, else half
 * its muted line, so they read lighter than the messages; never below half a
 * point at the figure's text scale (nor above the muted line).
 */
function lifelineWidth(
  themeId: string,
  overrides: Parameters<typeof figureTheme>[1],
): number | undefined {
  const builtin = getTheme(themeId);
  if (builtin === undefined) return undefined;
  const theme = figureTheme(builtin, overrides);
  const muted = resolveStyle(theme, { kind: "edge", id: "sumi/line", variant: "muted" }).style
    .strokeWidth.pt;
  const thin = theme.tokens.get("line.thin");
  const wanted = thin?.type === "length" ? thin.value.pt : muted / 2;
  const floor = Math.min(muted, 0.5 * (overrides?.textScale ?? 1));
  const pt = Math.round(Math.min(muted, Math.max(floor, wanted)) * 4) / 4;
  return pt >= 0.25 && pt <= 4 ? pt : undefined;
}

/** The IDs a sequence generates are `seq-<n>-…`. */
const PREFIX = "seq-";

export function expandSequences(state: CheckState, locate: Locator): void {
  const consumed = new Set<number>();
  expandBoxes(state, locate, consumed);
  // A list of targets (#645) means one arrow per target in a sequence's rows; elsewhere an
  // edge has one target.
  for (const [index, targets] of state.doc.recipients ?? []) {
    const edge = state.doc.edges?.[index];
    if (edge === undefined || consumed.has(index)) continue;
    state.invalid.add(edgeKey(edge.id, index));
    state.diagnostics.push(
      errorAt(
        locate,
        "layout/multiple-targets",
        `Edge ${edge.id === undefined ? `edges[${index}]` : `"${edge.id}"`} lists ${targets.length} targets; only a message in a sequence's rows may have several.`,
        ["edges", index, "to"],
        {
          subject: { kind: "edge", id: edge.id ?? `edges[${index}]` },
          hint: "Write one edge per target, or put the edge's id in the rows of an arrange sequence.",
        },
      ),
    );
  }
}

function expandBoxes(state: CheckState, locate: Locator, consumed: Set<number>): void {
  const { doc } = state;
  if (!doc.nodes || !doc.edges || !doc.figure || doc.figure.layout.engine !== "structured") return;
  const profile = getProfile(doc.figure.profile) ?? getProfile("paper-single");
  if (!profile) return;
  const spacing = spacedProfile(profile, doc.figure.layout.density);
  // A self-message's loop reaches three quarters of an arrange gap beyond its lifeline (whole pt).
  const loopPt = Math.max(6, Math.round(spacing.layout.arrangeGap.pt * 0.75));
  const thinPt = lifelineWidth(doc.figure.theme, doc.figure.themeOverrides);
  const nodes = doc.nodes;
  const edges = doc.edges;
  const taken = takenIds(doc);
  const takenEdges = new Set(edges.flatMap((e) => (e?.id === undefined ? [] : [e.id])));
  const takenSets = new Set((doc.sets ?? []).flatMap((s) => (s === undefined ? [] : [s.id])));
  const expansions: SequenceExpansion[] = [];
  /** Messages already placed by a row, with the row that placed them. */
  const used = new Map<string, DocPath>();
  const origins: [ElementKey, ExpandedOrigin][] = [];
  /** Where each generated fragment set is written, by its index in `sets`. */
  const setOrigins = new Map<number, DocPath>();
  /** The fragment frames drawn as the theme's group frame (#645): no variant or tone written. */
  const panels = new Set<number>();
  const figureSubject = { kind: "figure", id: doc.figure.id } as const;

  const reserved = (id: string, path: DocPath): boolean => {
    if (!taken.has(id) && !takenEdges.has(id) && !takenSets.has(id)) return false;
    state.diagnostics.push(
      errorAt(
        locate,
        "ref/reserved-id",
        `The ID "${id}" is reserved for the parts of a sequence diagram.`,
        path,
        {
          subject: figureSubject,
          hint: `Rename the element that uses "${id}": Sumi names the junctions, lifelines and frames of a sequence ${PREFIX}<n>-….`,
        },
      ),
    );
    return true;
  };
  const addNode = (node: FigureNode, path: DocPath, name: string): string | undefined => {
    if (reserved(node.id, path)) return undefined;
    taken.set(node.id, path);
    nodes.push(node);
    origins.push([nodeKey(node.id), { from: "sequence", path, subject: figureSubject, name }]);
    return node.id;
  };
  const junction = (id: string, path: DocPath, name: string) =>
    addNode(NodeSchema.parse({ id, component: "sumi/junction", variant: "hidden" }), path, name);
  const solid = new Set<ElementKey>();
  const addEdge = (edge: FigureEdge, path: DocPath, name: string, solidLine = false): void => {
    if (edge.id === undefined || reserved(edge.id, path)) return;
    takenEdges.add(edge.id);
    edges.push(edge);
    if (solidLine) solid.add(edgeKey(edge.id, edges.length - 1));
    origins.push([
      edgeKey(edge.id, edges.length - 1),
      { from: "sequence", path, subject: figureSubject, name },
    ]);
  };

  const expand = (spec: Sequence, path: DocPath) => {
    const n = expansions.length + 1;
    const prefix = `${PREFIX}${n}`;
    const at = [...path, "sequence"];
    const participants = spec.participants;
    const indexOf = new Map<string, number>();
    for (const [i, id] of participants.entries()) {
      if (indexOf.has(id)) {
        state.diagnostics.push(
          errorAt(
            locate,
            "layout/sequence-invalid-row",
            `Participant "${id}" is listed twice.`,
            [...at, "participants", i],
            { subject: figureSubject, hint: "List each participant once." },
          ),
        );
        continue;
      }
      indexOf.set(id, i);
    }
    /** The junctions on each lifeline, top to bottom; `open` ends a stretch (a note's top). */
    const stops: { id: string; open?: true }[][] = participants.map(() => []);
    let notes = 0;
    let messages = 0;
    let fragments = 0;
    const participantOf = (id: string, rowPath: DocPath, what: string): number | undefined => {
      const index = indexOf.get(id);
      if (index !== undefined) return index;
      state.diagnostics.push(
        errorAt(
          locate,
          "layout/sequence-unknown-participant",
          `${what} "${id}" is not a participant of this sequence.`,
          rowPath,
          {
            subject: figureSubject,
            hint: `Use one of the participants (${participants.join(", ")}), or add "${id}" to participants.`,
          },
        ),
      );
      return undefined;
    };
    const rowsOf = (
      rows: readonly SequenceRow[],
      rowsPath: DocPath,
      inBand = false,
    ): SequenceRowX[] => {
      const out: SequenceRowX[] = [];
      for (const [r, row] of rows.entries()) {
        const rowPath = [...rowsPath, r];
        if (Array.isArray(row)) {
          const inner = rowsOf(row, rowPath, true);
          // What each member covers across the lifelines, at 4 steps per lifeline (lifeline i
          // at 4i): a message spans its lifelines, a self-message its lifeline and the start
          // of the gap to its right, a note over lifelines those and the edges of the gaps
          // beside them, a note beside a lifeline the part of the gap next to it. Members
          // that meet would be drawn over each other.
          const extent = (x: SequenceRowX): [number, number] | undefined =>
            x.kind === "message"
              ? x.from === x.to
                ? x.west
                  ? [4 * x.from - 1, 4 * x.from]
                  : [4 * x.from, 4 * x.from + 1]
                : [4 * Math.min(x.from, x.to), 4 * Math.max(x.from, x.to)]
              : x.kind === "note"
                ? x.side === "right"
                  ? [4 * x.lo + 1, 4 * x.lo + 1]
                  : x.side === "left"
                    ? [4 * x.lo - 1, 4 * x.lo - 1]
                    : [4 * x.lo - 1, 4 * x.hi + 1]
                : undefined;
          const describe = (x: SequenceRowX) =>
            x.kind === "message"
              ? `message "${x.edge.slice(2)}"`
              : x.kind === "note"
                ? `note "${x.node}"`
                : "a row";
          let clash: [SequenceRowX, SequenceRowX] | undefined;
          for (const [k, p] of inner.entries())
            for (const q of inner.slice(k + 1)) {
              const [p0, p1] = extent(p) ?? [];
              const [q0, q1] = extent(q) ?? [];
              if (p0 === undefined || p1 === undefined || q0 === undefined || q1 === undefined)
                continue;
              if (clash === undefined && p0 <= q1 && q0 <= p1) clash = [p, q];
            }
          if (clash !== undefined)
            state.diagnostics.push(
              errorAt(
                locate,
                "layout/sequence-invalid-row",
                `In a band, ${describe(clash[0])} and ${describe(clash[1])} cover the same part of the lifelines and would be drawn over each other.`,
                rowPath,
                {
                  subject: figureSubject,
                  hint: "Rows side by side must lie on different lifelines and gaps; write them as consecutive rows instead.",
                },
              ),
            );
          out.push({ kind: "band", rows: inner, path: rowPath });
          continue;
        }
        if (typeof row === "string") {
          const index = edges.findIndex((e) => e?.id === row);
          const edge = edges[index];
          if (edge === undefined) {
            if (!state.invalid.has(edgeKey(row, 0)))
              state.diagnostics.push(
                errorAt(
                  locate,
                  "layout/sequence-unknown-message",
                  `Row "${row}" names no edge.`,
                  rowPath,
                  {
                    subject: figureSubject,
                    hint: "A message row is the id of an edge between two participants; give the edge an id, or write {note, over} for a note.",
                  },
                ),
              );
            continue;
          }
          const first = used.get(row);
          if (first !== undefined) {
            state.diagnostics.push(
              errorAt(
                locate,
                "layout/sequence-invalid-row",
                `Message "${row}" is placed by more than one row.`,
                rowPath,
                { subject: figureSubject, hint: "Each message is one row; add another edge." },
              ),
            );
            continue;
          }
          const from = participantOf(edge.from, rowPath, `The source of message "${row}",`);
          // Several targets (#645): one arrow to each, in consecutive rows, the label on the first.
          const written = doc.recipients?.get(index);
          const targets = (written ?? [edge.to]).map((id) =>
            participantOf(id, rowPath, `The target of message "${row}",`),
          );
          if (written !== undefined) consumed.add(index);
          if (from === undefined || targets.some((t) => t === undefined)) continue;
          const to = targets[0] as number;
          if (written !== undefined) {
            const problem = inBand
              ? "is a band member: a band holds one row"
              : targets.includes(from)
                ? `lists its source "${edge.from}" as a target`
                : new Set(targets).size < targets.length
                  ? "lists a target twice"
                  : undefined;
            if (problem !== undefined) {
              state.diagnostics.push(
                errorAt(
                  locate,
                  "layout/sequence-invalid-row",
                  `Message "${row}" with several targets ${problem}.`,
                  rowPath,
                  {
                    subject: figureSubject,
                    hint: "A message to several participants draws one arrow to each, in consecutive rows: list each target once, not the source, and write it as a row of its own.",
                  },
                ),
              );
              continue;
            }
          }
          // Sumi owns a message's geometry: a straight line between the lifelines with its
          // label above it, next to the source across several lifelines; a self-message is a
          // loop east (or, with lane: {side: west}, west) with its label outside it.
          const lane = edge.lane;
          const self = from === to;
          const fields = [
            ...(edge.labelAt !== undefined ? ["labelAt"] : []),
            ...(edge.labelSide !== undefined ? ["labelSide"] : []),
            ...(edge.fromAnchor !== undefined ? ["fromAnchor"] : []),
            ...(edge.toAnchor !== undefined ? ["toAnchor"] : []),
            ...(edge.route !== undefined && (self || edge.route !== "straight")
              ? [`route: ${edge.route}`]
              : []),
            ...(lane !== undefined &&
            (!self || (lane.side !== "east" && lane.side !== "west") || lane.outside !== undefined)
              ? [self ? "a lane other than {side: east | west, offset}" : "lane"]
              : []),
          ];
          if (fields.length > 0) {
            state.diagnostics.push(
              errorAt(
                locate,
                "layout/sequence-invalid-row",
                `${self ? "Self-message" : "Message"} "${row}" is drawn by the sequence, which places its line and label: remove ${fields.join(", ")}.`,
                rowPath,
                {
                  subject: figureSubject,
                  hint: self
                    ? "A self-message is a loop east of its lifeline with the label outside it; lane: {side: west} (with an optional offset) puts it west."
                    : "A message is a straight line between the two lifelines with its label above it, in the gap next to its source when it crosses other lifelines.",
                },
              ),
            );
            continue;
          }
          const west = from === to && lane?.side === "west";
          used.set(row, rowPath);
          for (const [k, target] of (targets as number[]).entries()) {
            messages++;
            const recipient = participants[target] as string;
            const what = k === 0 ? `message "${row}"` : `message "${row}" to "${recipient}"`;
            const fromNode = junction(
              `${prefix}-m${messages}-from`,
              rowPath,
              `the start of ${what}`,
            );
            const toNode = junction(`${prefix}-m${messages}-to`, rowPath, `the end of ${what}`);
            if (fromNode === undefined || toNode === undefined) continue;
            stops[from]?.push({ id: fromNode });
            stops[target]?.push({ id: toNode });
            const span = Math.abs(target - from);
            // Labels sit above the line: left of travel going right, right of it going left.
            const drawn: FigureEdge = {
              ...edge,
              from: fromNode,
              to: toNode,
              ...(self
                ? {
                    lane: { side: west ? "west" : "east", offset: lane?.offset ?? loopPt },
                    labelAt: "middle",
                    // Outside the loop: right of the downward segment going east, left going west.
                    labelSide: west ? "right" : "left",
                  }
                : {
                    route: "straight",
                    labelSide: target > from ? "left" : "right",
                    // Across several lifelines the label stays in the gap next to the source.
                    ...(span > 1 && { labelAt: "start" }),
                  }),
            };
            let key: string;
            if (k === 0) {
              edges[index] = drawn;
              key = edgeKey(edge.id, index);
            } else {
              // The other targets: a copy of the message without its label (#645).
              const id = `${prefix}-m${messages}`;
              addEdge({ ...drawn, id, label: "" }, rowPath, `the arrow of ${what}`);
              if (edges.at(-1)?.id !== id) continue;
              key = edgeKey(id, edges.length - 1);
            }
            out.push({
              kind: "message",
              edge: key,
              from,
              to: target,
              fromNode,
              toNode,
              ...(west && { west: true as const }),
              path: rowPath,
            });
          }
          continue;
        }
        if ("note" in row) {
          const over = row.over.map((id, k) =>
            participantOf(id, [...rowPath, "over", k], "Note lifeline"),
          );
          if (over.some((i) => i === undefined)) continue;
          const indices = over as number[];
          const lo = Math.min(...indices);
          const hi = Math.max(...indices);
          if (row.side !== undefined && lo !== hi) {
            state.diagnostics.push(
              errorAt(
                locate,
                "layout/sequence-invalid-row",
                `A note beside a lifeline (side: ${row.side}) names one participant, not ${indices.length}.`,
                [...rowPath, "over"],
                {
                  subject: figureSubject,
                  hint: "Name one participant in over, or drop side to spread the note over several lifelines.",
                },
              ),
            );
            continue;
          }
          notes++;
          const tops: string[] = [];
          const bottoms: string[] = [];
          if (row.side === undefined)
            for (let i = lo; i <= hi; i++) {
              const name = `the lifeline of "${participants[i]}" at note "${row.note}"`;
              const top = junction(`${prefix}-n${notes}-${i + 1}-top`, rowPath, name);
              const bottom = junction(`${prefix}-n${notes}-${i + 1}-bottom`, rowPath, name);
              if (top === undefined || bottom === undefined) continue;
              tops.push(top);
              bottoms.push(bottom);
              stops[i]?.push({ id: top, open: true }, { id: bottom });
            }
          out.push({
            kind: "note",
            node: row.note,
            lo,
            hi,
            ...(row.side !== undefined && { side: row.side }),
            tops,
            bottoms,
            path: rowPath,
          });
          continue;
        }
        fragments++;
        const id = `${prefix}-f${fragments}`;
        const label = addNode(
          NodeSchema.parse({
            id: `${id}-label`,
            component: "sumi/label",
            label: row.fragment,
            weight: row.weight ?? "bold",
            ...(row.text !== undefined && { text: row.text }),
            ...(row.tone !== undefined && { tone: row.tone }),
            textAlign: "left",
          }),
          [...rowPath, "fragment"],
          `the heading of fragment "${row.fragment}"`,
        );
        const topLeft = junction(`${id}-start`, rowPath, `the frame of fragment "${row.fragment}"`);
        const inner = rowsOf(row.rows, [...rowPath, "rows"]);
        const bottomRight = junction(
          `${id}-end`,
          rowPath,
          `the frame of fragment "${row.fragment}"`,
        );
        if (label === undefined || topLeft === undefined || bottomRight === undefined) continue;
        if (!reserved(id, rowPath)) {
          const inside: string[] = [];
          const collect = (rows: readonly SequenceRowX[]) => {
            for (const x of rows) {
              if (x.kind === "note") inside.push(x.node);
              else if (x.kind === "band") collect(x.rows);
              else if (x.kind === "fragment") {
                inside.push(x.label);
                collect(x.rows);
              }
            }
          };
          collect(inner);
          takenSets.add(id);
          const set: FigureSet = SetSchema.parse({
            id,
            members: [topLeft, bottomRight, label, ...inside],
            shape: "rect",
            padding: 0,
            variant: row.variant ?? "outlined",
            ...(row.tone !== undefined && { tone: row.tone }),
            ...(row.fillOpacity !== undefined && { fillOpacity: row.fillOpacity }),
          });
          doc.sets = [...(doc.sets ?? []), set];
          setOrigins.set(doc.sets.length - 1, rowPath);
          if (row.variant === undefined && row.tone === undefined) panels.add(doc.sets.length - 1);
        }
        out.push({ kind: "fragment", label, topLeft, bottomRight, rows: inner, path: rowPath });
      }
      return out;
    };
    const rows = rowsOf(spec.rows, [...at, "rows"]);
    const ends: string[] = [];
    for (const [i, participant] of participants.entries()) {
      const end = junction(
        `${prefix}-end-${i + 1}`,
        [...at, "participants", i],
        "a lifeline's end",
      );
      if (end === undefined) return;
      ends.push(end);
      const chain = [...(stops[i] ?? []), { id: end }];
      let previous: { id: string; open?: true; head?: true } = { id: participant, head: true };
      const lifeline = spec.lifeline;
      const dash = lifeline?.dash ?? "dashed";
      for (const [k, stop] of chain.entries()) {
        if (previous.open === undefined)
          addEdge(
            {
              id: `${prefix}-life-${i + 1}-${k + 1}`,
              from: previous.id,
              to: stop.id,
              label: "",
              component: "sumi/line",
              variant: lifeline?.variant ?? "muted",
              route: "straight",
              ...(previous.head && { fromAnchor: "south" }),
              ...(dash !== "solid" && { dash }),
              ...(lifeline?.tone !== undefined && { tone: lifeline.tone }),
              ...((lifeline?.lineWidth ?? thinPt) !== undefined && {
                lineWidth: lifeline?.lineWidth ?? thinPt,
              }),
              props: {},
            },
            [...at, "participants", i],
            `the lifeline of "${participant}"`,
            dash === "solid",
          );
        previous = stop;
      }
    }
    expansions.push({ spec, participants, rows, ends, path });
  };

  const walk = (box: ArrangeBox, path: DocPath) => {
    if (box.sequence) {
      expand(box.sequence, path);
      return;
    }
    for (const kind of ["stack", "row", "grid", "place"] as const) {
      box[kind]?.items.forEach((cell, i) => {
        const wrapped = cell !== null && typeof cell === "object" && "item" in cell;
        const item = wrapped ? cell.item : cell;
        if (item !== null && typeof item === "object")
          walk(item, [...path, kind, "items", i, ...(wrapped ? ["item"] : [])]);
      });
    }
  };
  if (doc.figure.layout.arrange) walk(doc.figure.layout.arrange, ["figure", "layout", "arrange"]);
  doc.groups?.forEach((g, i) => {
    if (g?.arrange) walk(g.arrange, ["groups", i, "arrange"]);
  });
  if (expansions.length === 0) return;
  doc.sequences = expansions;
  if (setOrigins.size > 0) doc.sequenceSets = setOrigins;
  if (panels.size > 0) doc.sequencePanels = panels;
  if (solid.size > 0) doc.solidLifelines = solid;
  recordExpanded(doc, origins);
}
