import type { ArrangeBoxIR, NodeIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";
import type { Diagnostic } from "../../core/diagnostics";
import type { Rect } from "../../core/geometry";
import type { Size } from "./sizing";

/** Rigid column in local coordinates. Every visual has an ordinary node footprint. */
export function chatGeometry(
  box: ArrangeBoxIR,
  sizeOf: (key: ElementKey) => Size,
  nodeOf: (key: ElementKey) => NodeIR | undefined,
  gap: number,
  bodyRect: (key: ElementKey, rect: Rect) => Rect,
): { size: Size; rects: Map<ElementKey, Rect>; diagnostics: Diagnostic[] } {
  const chat = box.chat;
  if (!chat) throw new Error("internal error: missing chat rows");
  const width = chat.widthPt * 2;
  const rects = new Map<ElementKey, Rect>();
  const diagnostics: Diagnostic[] = [];
  const smallGap = gap / 4;
  let y = 0;
  let runHorn = 0;
  for (const [index, row] of chat.rows.entries()) {
    if (index > 0) y += row.runStart ? gap / 2 : smallGap;
    const bubble = sizeOf(row.node);
    if (!row.side) {
      rects.set(row.node, { x: (width - bubble.width) / 2, y, ...bubble });
      y += bubble.height;
    } else {
      const node = nodeOf(row.node);
      const body = bodyRect(row.node, { x: 0, y: 0, ...bubble });
      const horn =
        typeof node?.render?.params?.tailSize === "number"
          ? Math.min(node.render.params.tailSize, body.width / 3)
          : 0;
      if (row.runStart) runHorn = horn;
      const avatar = row.indentAvatar ? sizeOf(row.indentAvatar) : undefined;
      const indent = avatar ? avatar.width + smallGap : 0;
      const meta = row.meta ? sizeOf(row.meta) : undefined;
      const avatarBody =
        row.avatar && avatar ? bodyRect(row.avatar, { x: 0, y: 0, ...avatar }) : undefined;
      // Align bodies, but shift the entire row to keep every footprint above y.
      const top =
        y + Math.max(0, (meta?.height ?? 0) - body.y - body.height, (avatarBody?.y ?? 0) - body.y);
      const x =
        row.side === "left"
          ? indent + (row.runStart ? 0 : runHorn)
          : width - indent - bubble.width - (row.runStart ? 0 : runHorn);
      rects.set(row.node, { x, y: top, ...bubble });
      if (row.avatar && avatar)
        rects.set(row.avatar, {
          x: row.side === "left" ? 0 : width - avatar.width,
          y: top + body.y - (avatarBody?.y ?? 0),
          ...avatar,
        });
      if (row.meta && meta)
        rects.set(row.meta, {
          x: row.side === "left" ? x + bubble.width + smallGap : x - smallGap - meta.width,
          y: top + body.y + body.height - meta.height,
          ...meta,
        });
      y = Math.max(
        top + bubble.height,
        row.avatar ? (rects.get(row.avatar)?.y ?? top) + (avatar?.height ?? 0) : 0,
      );
    }
    const keys = [row.node, row.avatar, row.meta].filter((k): k is ElementKey => k !== undefined);
    if (
      keys.some((k) => {
        const r = rects.get(k);
        return r && (r.x < -0.001 || r.x + r.width > width + 0.001);
      })
    ) {
      diagnostics.push({
        code: "layout/chat-overflow",
        severity: "warning",
        message: "Chat visuals exceed the column width.",
        ...row.source,
        hint: "Increase chat.width, reduce maxWidth, or shorten the meta note.",
      });
    }
  }
  return { size: { width, height: y }, rects, diagnostics };
}
