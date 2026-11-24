/**
 * Geometry of a sequence diagram (#630, design record 630): the arrange box
 * `sequence` places its participants side by side and every row below them,
 * in the box's local coordinates (units). Nothing here is written by the
 * author: the lifelines are as far apart as the message labels, notes and
 * fragment frames between them need (at least `participantGap` between the
 * participants' boxes), and each row starts `rowGap` below the previous one.
 *
 * - Participants are as tall as the tallest one (top and bottom aligned) when their
 *   component can grow, else bottom-aligned above their lifelines.
 * - A message's two junctions sit on its lifelines at the row's line; the
 *   label above the line (`labelSide` from the direction, set by the
 *   expansion) is clear of every lifeline it does not end on.
 * - A self-message's junctions are the two ends of a loop to the east; its
 *   label sits right of the loop, before the next lifeline.
 * - A note over lifelines is centred on them (widened to span several); a
 *   note with `side` sits beside its lifeline, clear of the next one.
 * - A fragment's frame encloses its rows plus padding; its heading is in a
 *   header row inside the frame, left of the first lifeline it encloses, so
 *   no lifeline crosses it. The two corner junctions span the frame exactly
 *   (the set around them has no padding).
 */
import type { ArrangeBoxIR, EdgeIR, SequenceRowIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";
import type { Rect, TextMetrics } from "../ir";
import { edgeArrowheadLength } from "../route/arrowhead";
import { labelGap } from "../route/labels";
import type { Size } from "./sizing";

export interface SequenceContext {
  /** An item's natural footprint. */
  readonly sizeOf: (key: ElementKey) => Size;
  readonly edgeOf: (key: ElementKey) => EdgeIR | undefined;
  /** The measured label of an edge or node; `undefined` without one. */
  readonly labelOf: (key: ElementKey) => TextMetrics | undefined;
  /** Whether a note may be drawn wider than its natural width (to span several lifelines). */
  readonly widenable: (key: ElementKey) => boolean;
  /** Whether a participant may be drawn taller than its natural height (#645); omitted means no. */
  readonly tallable?: (key: ElementKey) => boolean;
  /** The profile's arrange gap in units. */
  readonly gap: number;
}

/** Why a gap between two lifelines is as wide as it is (for the width hints, #607). */
export interface SequenceGapReason {
  /** The left participant of the gap (index). */
  readonly index: number;
  /** The distance between the two lifelines, in units. */
  readonly width: number;
  /** What sets it, e.g. `the label of message "call"`. */
  readonly reason: string;
  /** The message whose label sets it, if one does. */
  readonly edge?: ElementKey;
}

export interface SequenceGeometry {
  readonly size: Size;
  readonly rects: Map<ElementKey, Rect>;
  /** The lifelines' x in local coordinates, parallel to the participants. */
  readonly lifelines: readonly number[];
  readonly gaps: readonly SequenceGapReason[];
}

/** One lower bound on the distance between two lifelines. */
interface Need {
  readonly lo: number;
  readonly hi: number;
  readonly width: number;
  readonly reason: string;
  readonly edge?: ElementKey;
}

/** How far a row's contents reach left and right of the lifelines, for the frames around them. */
interface Reach {
  lo: number;
  hi: number;
  left: number;
  right: number;
}

const idOf = (key: ElementKey) => key.slice(2);

/** The reason of a gap no label, note or frame widens. */
export const PARTICIPANT_GAP = "participantGap";

export function sequenceGeometry(box: ArrangeBoxIR, ctx: SequenceContext): SequenceGeometry {
  const seq = box.sequence;
  if (!seq) throw new Error("internal error: missing sequence rows");
  const count = seq.participants.length;
  const participantGap = seq.participantGapPt === undefined ? ctx.gap : seq.participantGapPt * 2;
  const rowGap = seq.rowGapPt === undefined ? Math.round(ctx.gap / 3) : seq.rowGapPt * 2;
  // Room kept between a lifeline and text or a box it does not belong to.
  const clear = Math.max(4, Math.round(ctx.gap / 4));
  // A frame's padding around its rows, and the inset of its heading.
  const framePad = Math.max(6, Math.round(ctx.gap / 3));
  const inset = Math.max(3, Math.round(framePad / 2));
  // A frame's sides run parallel to lifelines: twice the clearance keeps a side clearly apart
  // from the outermost lifeline it encloses and from the next one outside it (#645).
  const sidePad = Math.max(framePad, 2 * clear);
  const heads = seq.participants.map(ctx.sizeOf);
  const half = (key: ElementKey) => ctx.sizeOf(key).width / 2;

  // Horizontal: gaps between neighbouring lifelines, widened until every need is met.
  const gaps = heads
    .slice(1)
    .map((h, i) => (heads[i] as Size).width / 2 + h.width / 2 + participantGap);
  const reasons: { reason: string; edge?: ElementKey }[] = gaps.map(() => ({
    reason: PARTICIPANT_GAP,
  }));
  const xs = (): number[] => {
    const out = [0];
    for (const g of gaps) out.push((out.at(-1) as number) + g);
    return out;
  };
  const edgeStyle = (row: Extract<SequenceRowIR, { kind: "message" }>) => {
    const edge = ctx.edgeOf(row.edge);
    const label = ctx.labelOf(row.edge);
    const g = edge === undefined ? 0 : labelGap(edge.style);
    const head = edge === undefined ? 0 : edgeArrowheadLength(edge.style);
    return { edge, label, g, head };
  };
  /** A self-message's loop: how far right of its lifeline it and its label reach, and its height. */
  const loop = (row: Extract<SequenceRowIR, { kind: "message" }>) => {
    const { edge, label, g, head } = edgeStyle(row);
    const offset = edge?.lane?.offset ?? 12;
    const out = half(row.fromNode) + offset;
    const height = Math.max((label?.height ?? 0) + 2 * g, out * 1.5, ctx.gap / 2, head * 2);
    return { out, reach: out + (label === undefined ? 0 : g + label.width), height, label, g };
  };
  const noteWidth = (row: Extract<SequenceRowIR, { kind: "note" }>, x: readonly number[]) => {
    const natural = ctx.sizeOf(row.node).width;
    if (row.side !== undefined || row.lo === row.hi || !ctx.widenable(row.node)) return natural;
    const span = (x[row.hi] as number) - (x[row.lo] as number);
    return Math.max(natural, span + 2 * framePad);
  };
  const noteRect = (row: Extract<SequenceRowIR, { kind: "note" }>, x: readonly number[]) => {
    const width = noteWidth(row, x);
    const a = x[row.lo] as number;
    const b = x[row.hi] as number;
    const left =
      row.side === "right"
        ? a + clear
        : row.side === "left"
          ? a - clear - width
          : (a + b) / 2 - width / 2;
    return { left, right: left + width, width };
  };
  const headingWidth = (key: ElementKey) => ctx.sizeOf(key).width;
  /** The needs of `rows` at the lifelines `x`, and how far their contents reach. */
  const needs = (
    rows: readonly SequenceRowIR[],
    x: readonly number[],
    out: Need[],
  ): Reach | undefined => {
    let reach: Reach | undefined;
    const extend = (lo: number, hi: number, left: number, right: number) => {
      reach =
        reach === undefined
          ? { lo, hi, left, right }
          : {
              lo: Math.min(reach.lo, lo),
              hi: Math.max(reach.hi, hi),
              left: Math.min(reach.left, left),
              right: Math.max(reach.right, right),
            };
    };
    for (const row of rows) {
      if (row.kind === "message") {
        const name = `the label of message "${idOf(row.edge)}"`;
        const lo = Math.min(row.from, row.to);
        const hi = Math.max(row.from, row.to);
        if (lo === hi) {
          // The loop and its label lie in the gap east of the lifeline (west with `lane: west`).
          const { reach: r } = loop(row);
          if (row.west) {
            if (lo > 0)
              out.push({ lo: lo - 1, hi: lo, width: r + clear, reason: name, edge: row.edge });
            extend(lo, hi, (x[lo] as number) - r, x[lo] as number);
          } else {
            if (hi < count - 1)
              out.push({ lo, hi: hi + 1, width: r + clear, reason: name, edge: row.edge });
            extend(lo, hi, x[lo] as number, (x[lo] as number) + r);
          }
          continue;
        }
        extend(lo, hi, x[lo] as number, x[hi] as number);
        const { edge, label, g, head } = edgeStyle(row);
        if (label === undefined) {
          out.push({
            lo,
            hi,
            width: 3 * head,
            reason: `the arrowhead of message "${idOf(row.edge)}"`,
          });
          continue;
        }
        const at = edge?.labelAt ?? "middle";
        if (at === "middle") {
          out.push({
            lo,
            hi,
            width: label.width + 2 * Math.max(clear, head),
            reason: name,
            edge: row.edge,
          });
          continue;
        }
        // Next to one end: that end's gap holds the label.
        const nearFrom = at === "start";
        const end = nearFrom ? row.from : row.to;
        const arrow = nearFrom ? edge?.sourceArrowhead : edge?.targetArrowhead;
        const width = g + (arrow === undefined ? 0 : head) + label.width + clear;
        const other = (nearFrom ? row.to : row.from) > end ? end + 1 : end - 1;
        out.push({
          lo: Math.min(end, other),
          hi: Math.max(end, other),
          width,
          reason: name,
          edge: row.edge,
        });
        continue;
      }
      if (row.kind === "note") {
        const name = `note "${idOf(row.node)}"`;
        const r = noteRect(row, x);
        const a = x[row.lo] as number;
        const b = x[row.hi] as number;
        if (row.lo > 0)
          out.push({ lo: row.lo - 1, hi: row.lo, width: a - r.left + clear, reason: name });
        if (row.hi < count - 1)
          out.push({ lo: row.hi, hi: row.hi + 1, width: r.right - b + clear, reason: name });
        extend(row.lo, row.hi, r.left, r.right);
        continue;
      }
      if (row.kind === "band") {
        const inner = needs(row.rows, x, out);
        if (inner !== undefined) extend(inner.lo, inner.hi, inner.left, inner.right);
        // Side by side: what reaches right of one member and left of the next share their gap.
        const members = row.rows
          .flatMap((member) => {
            const r = needs([member], x, []);
            return r === undefined ? [] : [r];
          })
          .sort((a, b) => a.lo - b.lo);
        for (const [k, b] of members.entries()) {
          const a = members[k - 1];
          if (a === undefined || a.hi >= b.lo) continue;
          out.push({
            lo: a.hi,
            hi: b.lo,
            width: a.right - (x[a.hi] as number) + ((x[b.lo] as number) - b.left) + clear,
            reason: "two rows side by side in a band",
          });
        }
        continue;
      }
      const inner = needs(row.rows, x, out) ?? {
        lo: 0,
        hi: 0,
        left: x[0] as number,
        right: x[0] as number,
      };
      const frame = frameOf(row, inner, x);
      const name = `fragment "${idOf(row.label).replace(/-label$/, "")}"`;
      if (inner.lo > 0)
        out.push({
          lo: inner.lo - 1,
          hi: inner.lo,
          width: (x[inner.lo] as number) - frame.left + sidePad,
          reason: `the frame of ${name}`,
        });
      if (inner.hi < count - 1)
        out.push({
          lo: inner.hi,
          hi: inner.hi + 1,
          width: frame.right - (x[inner.hi] as number) + sidePad,
          reason: `the frame of ${name}`,
        });
      extend(inner.lo, inner.hi, frame.left, frame.right);
    }
    return reach;
  };
  const frameOf = (
    row: Extract<SequenceRowIR, { kind: "fragment" }>,
    inner: Reach,
    x: readonly number[],
  ) => {
    const first = x[inner.lo] as number;
    const left = Math.min(inner.left - sidePad, first - clear - headingWidth(row.label) - inset);
    const right = Math.max(inner.right, x[inner.hi] as number) + sidePad;
    return { left, right };
  };

  for (let pass = 0; pass < 64; pass++) {
    const x = xs();
    const list: Need[] = [];
    needs(seq.rows, x, list);
    let changed = false;
    // Shortest spans first: a wide label over two gaps then widens both evenly.
    list.sort((a, b) => a.hi - a.lo - (b.hi - b.lo));
    for (const need of list) {
      const current = xs();
      const have = (current[need.hi] as number) - (current[need.lo] as number);
      const deficit = Math.ceil(need.width - have);
      if (deficit <= 0) continue;
      const span = need.hi - need.lo;
      for (let k = need.lo; k < need.hi; k++) {
        gaps[k] = (gaps[k] as number) + Math.ceil(deficit / span);
        reasons[k] = { reason: need.reason, ...(need.edge !== undefined && { edge: need.edge }) };
      }
      changed = true;
    }
    if (!changed) break;
  }
  const x = xs();

  // Vertical: heads as tall as the tallest (#645: a one-line box beside a two-line one), else
  // bottom-aligned on the lifelines' top; then one row after another.
  const rects = new Map<ElementKey, Rect>();
  const headBottom = Math.max(...heads.map((h) => h.height));
  for (const [i, key] of seq.participants.entries()) {
    const h = heads[i] as Size;
    const height = ctx.tallable?.(key) === true ? headBottom : h.height;
    rects.set(key, {
      x: (x[i] as number) - h.width / 2,
      y: headBottom - height,
      width: h.width,
      height,
    });
  }
  const point = (key: ElementKey, px: number, py: number) => {
    const s = ctx.sizeOf(key);
    rects.set(key, { x: px - s.width / 2, y: py - s.height / 2, ...s });
  };
  /** Places one row from `y`; returns its bottom. */
  const placeRow = (row: SequenceRowIR, y: number): number => {
    if (row.kind === "message") {
      const { edge, label, g, head } = edgeStyle(row);
      const tip = head / 2;
      if (row.from === row.to) {
        const l = loop(row);
        const y1 = y + tip;
        point(row.fromNode, x[row.from] as number, y1);
        point(row.toNode, x[row.from] as number, y1 + l.height);
        return y1 + l.height + tip;
      }
      const above =
        label !== undefined && row.to > row.from === ((edge?.labelSide ?? "left") === "left");
      const below = label !== undefined && !above;
      const line = y + (above ? (label as TextMetrics).height + g : tip);
      point(row.fromNode, x[row.from] as number, line);
      point(row.toNode, x[row.to] as number, line);
      return line + (below ? g + (label as TextMetrics).height : tip);
    }
    if (row.kind === "note") {
      const r = noteRect(row, x);
      const s = ctx.sizeOf(row.node);
      rects.set(row.node, { x: r.left, y, width: r.width, height: s.height });
      // The lifeline stops just short of the note's border, so it never grazes the frame.
      const stop = (key: ElementKey) => Math.max(ctx.sizeOf(key).height + 1, clear / 2);
      for (const [k, key] of row.tops.entries()) point(key, x[row.lo + k] as number, y - stop(key));
      for (const [k, key] of row.bottoms.entries())
        point(key, x[row.lo + k] as number, y + s.height + stop(key));
      return y + s.height;
    }
    if (row.kind === "band") return Math.max(y, ...row.rows.map((member) => placeRow(member, y)));
    const label = ctx.sizeOf(row.label);
    const inner = needs(row.rows, x, []) ?? {
      lo: 0,
      hi: 0,
      left: x[0] as number,
      right: x[0] as number,
    };
    const frame = frameOf(row, inner, x);
    // The first row starts beside the heading when it keeps clear of it (a message
    // between the lifelines), else below it.
    const headingRight = frame.left + inset + label.width;
    const first = row.rows[0] === undefined ? undefined : needs([row.rows[0]], x, []);
    const beside = first !== undefined && first.left >= headingRight + clear - 1e-6;
    const innerTop = y + inset + (beside ? 0 : label.height + rowGap / 2);
    const innerBottom = Math.max(place(row.rows, innerTop), y + inset + label.height);
    const frameBottom = innerBottom + Math.max(rowGap / 2, inset);
    rects.set(row.label, { x: frame.left + inset, y: y + inset, ...label });
    const corner = (key: ElementKey, cx: number, cy: number, sx: 1 | -1, sy: 1 | -1) => {
      const s = ctx.sizeOf(key);
      rects.set(key, { x: sx > 0 ? cx : cx - s.width, y: sy > 0 ? cy : cy - s.height, ...s });
    };
    corner(row.topLeft, frame.left, y, 1, 1);
    corner(row.bottomRight, frame.right, frameBottom, -1, -1);
    return frameBottom;
  };
  /** Places `rows` one below the other from `top`; returns the bottom of the last one. */
  const place = (rows: readonly SequenceRowIR[], top: number): number => {
    let bottom = top;
    for (const [i, row] of rows.entries()) bottom = placeRow(row, i === 0 ? top : bottom + rowGap);
    return bottom;
  };
  const last = place(seq.rows, headBottom + rowGap);
  const end = last + rowGap;
  for (const [i, key] of seq.ends.entries()) point(key, x[i] as number, end);

  // Self-message labels reach beyond their loops; everything else is a rect.
  let minX = Math.min(...[...rects.values()].map((r) => r.x));
  let maxX = Math.max(...[...rects.values()].map((r) => r.x + r.width));
  const selfReach = (rows: readonly SequenceRowIR[]) => {
    for (const row of rows) {
      if (row.kind === "fragment" || row.kind === "band") selfReach(row.rows);
      else if (row.kind === "message" && row.from === row.to) {
        if (row.west) minX = Math.min(minX, (x[row.from] as number) - loop(row).reach);
        else maxX = Math.max(maxX, (x[row.from] as number) + loop(row).reach);
      }
    }
  };
  selfReach(seq.rows);
  minX = Math.min(minX, 0);
  const height = Math.max(...[...rects.values()].map((r) => r.y + r.height));
  const shifted = new Map<ElementKey, Rect>();
  for (const [key, r] of rects) shifted.set(key, { ...r, x: r.x - minX });
  return {
    size: { width: maxX - minX, height },
    rects: shifted,
    lifelines: x.map((v) => v - minX),
    gaps: gaps.map((width, index) => ({ index, width, ...reasons[index] })) as SequenceGapReason[],
  };
}
