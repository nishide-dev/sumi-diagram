/**
 * Structured layout (#86 prototype): stack / row boxes with gap and
 * cross-axis alignment, containers with padding, and `attach` placement.
 * Deterministic single pass: measure bottom-up, place top-down. No search,
 * no iteration, no floating-point accumulation beyond sums.
 */
import type { Align, ArrangeBox, GroupDef, Model, NodeDef } from "./model";
import { type MeasuredLabel, measureLabel } from "./text";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Visual constants in user units (1 unit = 0.5pt). */
export const STYLE = {
  fontSize: 16, // 8pt, the academic theme's text size
  boxPadX: 14,
  boxPadY: 7,
  operatorSize: 18,
  junctionSize: 0,
  iconCircleSize: 34,
  groupPad: 16,
  groupRadius: 12,
  captionGap: 8,
  margin: 11, // the paper profiles' 2mm pad
};

export interface Layout {
  nodes: Map<string, Rect>;
  groups: Map<string, Rect>;
  captions: Map<string, Rect>;
  labels: Map<string, MeasuredLabel>;
  width: number;
  height: number;
}

interface Size {
  w: number;
  h: number;
}

export function layoutModel(model: Model): Layout {
  const labels = new Map<string, MeasuredLabel>();
  const natural = new Map<string, Size>();

  const nodeSize = (node: NodeDef): Size => {
    const label = measureLabel(node.label, STYLE.fontSize);
    labels.set(node.id, label);
    switch (node.component) {
      case "junction":
        return { w: STYLE.junctionSize, h: STYLE.junctionSize };
      case "operator":
        return { w: STYLE.operatorSize, h: STYLE.operatorSize };
      case "circle":
        return { w: STYLE.iconCircleSize, h: STYLE.iconCircleSize };
      case "label":
        return { w: Math.ceil(label.width), h: Math.ceil(label.height) };
      case "box":
        return {
          w: Math.ceil(label.width + 2 * STYLE.boxPadX),
          h: Math.ceil(label.height + 2 * STYLE.boxPadY),
        };
    }
  };

  const itemSize = (item: string | ArrangeBox): Size => {
    if (typeof item !== "string") return boxSize(item);
    const cached = natural.get(item);
    if (cached !== undefined) return cached;
    const node = model.nodes.get(item);
    let size: Size;
    if (node !== undefined) size = nodeSize(node);
    else {
      const group = model.groups.get(item) as GroupDef;
      const inner = boxSize(group.arrange);
      size = { w: inner.w + 2 * STYLE.groupPad, h: inner.h + 2 * STYLE.groupPad };
      if (group.caption !== "") {
        const caption = measureLabel(group.caption, STYLE.fontSize);
        labels.set(`caption:${group.id}`, caption);
        size = {
          w: Math.max(size.w, Math.ceil(caption.width)),
          h: size.h + STYLE.captionGap + Math.ceil(caption.height),
        };
      }
    }
    natural.set(item, size);
    return size;
  };

  const boxSize = (box: ArrangeBox): Size => {
    const sizes = box.items.map(itemSize);
    const vertical = box.kind === "stack";
    const main = sizes.reduce((s, z) => s + (vertical ? z.h : z.w), 0);
    const gaps = box.gap * (sizes.length - 1);
    const cross = Math.max(0, ...sizes.map((z) => (vertical ? z.w : z.h)));
    return vertical ? { w: cross, h: main + gaps } : { w: main + gaps, h: cross };
  };

  for (const node of model.nodes.values()) itemSize(node.id);

  const nodes = new Map<string, Rect>();
  const groups = new Map<string, Rect>();
  const captions = new Map<string, Rect>();

  const stretchable = (item: string | ArrangeBox): boolean => {
    if (typeof item !== "string") return true;
    const node = model.nodes.get(item);
    return node === undefined || node.component === "box";
  };

  const placeItem = (item: string | ArrangeBox, r: Rect, align: Align, kind: string): void => {
    if (typeof item !== "string") {
      // Alignment is inherited only along the same axis (stack in stack, row in row).
      placeBox(item, r, item.kind === kind ? align : "center");
      return;
    }
    if (model.nodes.has(item)) {
      nodes.set(item, r);
      return;
    }
    const group = model.groups.get(item) as GroupDef;
    const caption = labels.get(`caption:${item}`);
    const ch = caption === undefined ? 0 : STYLE.captionGap + Math.ceil(caption.height);
    const box = { x: r.x, y: r.y, w: r.w, h: r.h - ch };
    groups.set(item, box);
    if (caption !== undefined)
      captions.set(item, {
        x: r.x,
        y: r.y + box.h + STYLE.captionGap,
        w: r.w,
        h: ch - STYLE.captionGap,
      });
    const p = STYLE.groupPad;
    placeBox(
      group.arrange,
      { x: box.x + p, y: box.y + p, w: box.w - 2 * p, h: box.h - 2 * p },
      "center",
    );
  };

  const placeBox = (box: ArrangeBox, r: Rect, inherited: Align): void => {
    const align = box.align ?? inherited;
    const vertical = box.kind === "stack";
    const reversed = box.direction === "up" || box.direction === "left";
    const order = reversed ? [...box.items].reverse() : box.items;
    const sizes = order.map(itemSize);
    const natural = boxSize(box);
    // Extra main-axis room (from a stretching parent) centers the content.
    let cursor = vertical ? r.y + (r.h - natural.h) / 2 : r.x + (r.w - natural.w) / 2;
    order.forEach((item, i) => {
      const size = sizes[i] as Size;
      const crossAvail = vertical ? r.w : r.h;
      const crossNat = vertical ? size.w : size.h;
      const cross = align === "stretch" && stretchable(item) ? crossAvail : crossNat;
      const offset =
        align === "start" || (align === "stretch" && cross === crossAvail)
          ? 0
          : align === "end"
            ? crossAvail - cross
            : (crossAvail - cross) / 2;
      const child: Rect = vertical
        ? { x: r.x + offset, y: cursor, w: cross, h: size.h }
        : { x: cursor, y: r.y + offset, w: size.w, h: cross };
      placeItem(item, child, align, box.kind);
      cursor += (vertical ? size.h : size.w) + box.gap;
    });
  };

  const top = boxSize(model.arrange);
  placeBox(model.arrange, { x: 0, y: 0, w: top.w, h: top.h }, "center");

  // attach: place beside an already placed element, centered on that side.
  const pending = [...model.nodes.values()].filter((n) => n.attach !== undefined);
  while (pending.length > 0) {
    const index = pending.findIndex((n) => {
      const to = n.attach?.to ?? "";
      return nodes.has(to) || groups.has(to);
    });
    if (index < 0) throw new Error(`attach cycle: ${pending.map((n) => n.id).join(", ")}`);
    const [node] = pending.splice(index, 1);
    if (node?.attach === undefined) continue;
    const target = nodes.get(node.attach.to) ?? (groups.get(node.attach.to) as Rect);
    const size = itemSize(node.id);
    const { side, gap } = node.attach;
    const cx = target.x + (target.w - size.w) / 2;
    const cy = target.y + (target.h - size.h) / 2;
    nodes.set(
      node.id,
      side === "west"
        ? { x: target.x - gap - size.w, y: cy, w: size.w, h: size.h }
        : side === "east"
          ? { x: target.x + target.w + gap, y: cy, w: size.w, h: size.h }
          : side === "north"
            ? { x: cx, y: target.y - gap - size.h, w: size.w, h: size.h }
            : { x: cx, y: target.y + target.h + gap, w: size.w, h: size.h },
    );
  }

  // Normalize: content box at (margin, margin); coordinates rounded to 1/1000 unit.
  const all = [...nodes.values(), ...groups.values(), ...captions.values()];
  const minX = Math.min(...all.map((r) => r.x));
  const minY = Math.min(...all.map((r) => r.y));
  const maxX = Math.max(...all.map((r) => r.x + r.w));
  const maxY = Math.max(...all.map((r) => r.y + r.h));
  const round = (v: number) => Math.round(v * 1000) / 1000;
  const shift = (r: Rect): Rect => ({
    x: round(r.x - minX + STYLE.margin),
    y: round(r.y - minY + STYLE.margin),
    w: round(r.w),
    h: round(r.h),
  });
  for (const [k, r] of nodes) nodes.set(k, shift(r));
  for (const [k, r] of groups) groups.set(k, shift(r));
  for (const [k, r] of captions) captions.set(k, shift(r));
  return {
    nodes,
    groups,
    captions,
    labels,
    width: Math.ceil(maxX - minX + 2 * STYLE.margin),
    height: Math.ceil(maxY - minY + 2 * STYLE.margin),
  };
}
