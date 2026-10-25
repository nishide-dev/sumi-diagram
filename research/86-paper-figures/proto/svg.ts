/**
 * SVG writer for the prototype. Emits the same element vocabulary the product
 * inspects today (`g.sumi-k-*`, `g.shape`, centered <text>/<tspan>,
 * `path.connection` with M/L), but with fonts as real family names (what the
 * PDF/PPTX engine resolves) instead of D2's embedded @font-face subsets.
 */
import type { PlacedLabel } from "./edge-labels";
import { loadIcon } from "./icons";
import { type Layout, type Rect, STYLE } from "./layout";
import type { Model, NodeDef } from "./model";
import type { Point, RoutedEdge } from "./route";
import {
  FONT_FAMILY,
  LINE_HEIGHT,
  type MeasuredLabel,
  runWidth,
  SCRIPT_SCALE,
  SUB_SHIFT,
  SUP_SHIFT,
} from "./text";

/** Proposed theme palette ("tone"): pastel fill per categorical hue. */
export const TONES: Record<string, string> = {
  pink: "#f8dfe0",
  yellow: "#f3f6c8",
  blue: "#cfe8f3",
  orange: "#fbe1c0",
  green: "#d3ead4",
  purple: "#dfe0f1",
  gray: "#e6e6e6",
};
const STROKE = "#000000";
const LINE = 2; // 1pt
const BOX_LINE = 3; // 1.5pt: the reference figure's heavy block outlines
const ARROW = { length: 9, half: 4 };

const n3 = (v: number) => String(Math.round(v * 1000) / 1000);
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const cls = (key: string, kind: string) => `sumi-k-${key.replace(":", "--")} sumi-kind-${kind}`;

export function textSvg(label: MeasuredLabel, cx: number, cy: number): string {
  if (label.lines.length === 0) return "";
  const { size } = label;
  const lh = size * LINE_HEIGHT;
  // Baseline of line 1 so that the block of lines is centered on cy (ascent ≈ 0.88em, BIZ UD).
  const first = cy - (label.lines.length * lh) / 2 + lh / 2 + size * 0.35;
  const lines = label.lines.map((runs, i) => {
    const width = runs.reduce((s, r) => s + runWidth(r, size, label.bold), 0);
    let x = cx - width / 2;
    const spans = runs.map((r) => {
      const shift = r.script === 0 ? 0 : (r.script === 1 ? SUB_SHIFT : SUP_SHIFT) * size;
      const fs = r.script === 0 ? size : size * SCRIPT_SCALE;
      const span = `<tspan x="${n3(x)}" y="${n3(first + i * lh + shift)}" font-size="${n3(fs)}">${esc(r.text)}</tspan>`;
      x += runWidth(r, size, label.bold);
      return span;
    });
    return spans.join("");
  });
  return `<text font-family="${FONT_FAMILY}" font-size="${size}" fill="#000000">${lines.join("")}</text>`;
}

function nodeSvg(node: NodeDef, r: Rect, label: MeasuredLabel): string {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  let shape = "";
  switch (node.component) {
    case "junction":
      return "";
    case "box": {
      const fill = node.tone === undefined ? "#ffffff" : (TONES[node.tone] ?? "#ffffff");
      shape = `<rect x="${n3(r.x)}" y="${n3(r.y)}" width="${n3(r.w)}" height="${n3(r.h)}" rx="4" fill="${fill}" stroke="${STROKE}" stroke-width="${BOX_LINE}"/>`;
      break;
    }
    case "operator": {
      const rad = r.w / 2;
      const arm = rad * 0.65;
      shape =
        `<circle cx="${n3(cx)}" cy="${n3(cy)}" r="${n3(rad)}" fill="#ffffff" stroke="${STROKE}" stroke-width="${LINE}"/>` +
        `<path d="M ${n3(cx - arm)} ${n3(cy)} L ${n3(cx + arm)} ${n3(cy)} M ${n3(cx)} ${n3(cy - arm)} L ${n3(cx)} ${n3(cy + arm)}" stroke="${STROKE}" stroke-width="${LINE}" fill="none"/>`;
      break;
    }
    case "circle": {
      const rad = r.w / 2;
      shape = `<circle cx="${n3(cx)}" cy="${n3(cy)}" r="${n3(rad)}" fill="#ffffff" stroke="${STROKE}" stroke-width="${LINE}"/>`;
      if (node.icon !== undefined) {
        const { svg } = loadIcon(node.icon);
        const [vx, vy, vw, vh] = svg.viewBox;
        const side = rad * 1.3;
        const scale = side / Math.max(vw, vh);
        const tx = cx - (vw * scale) / 2 - vx * scale;
        const ty = cy - (vh * scale) / 2 - vy * scale;
        // A nested <svg> positions the icon without a transform attribute on inspected elements.
        shape += `<svg x="${n3(tx + vx * scale)}" y="${n3(ty + vy * scale)}" width="${n3(vw * scale)}" height="${n3(vh * scale)}" viewBox="${svg.viewBox.join(" ")}" color="${STROKE}">${svg.markup}</svg>`;
      }
      break;
    }
    case "label":
      break;
  }
  const text = node.component === "box" || node.component === "label" ? textSvg(label, cx, cy) : "";
  return `<g class="${cls(`n:${node.id}`, "node")}"><g class="shape">${shape}</g>${text}</g>`;
}

function edgeSvg(e: RoutedEdge): string {
  const pts = e.points.map((p) => ({ ...p }));
  let head = "";
  if (e.edge.arrow && pts.length >= 2) {
    const tip = pts[pts.length - 1] as Point;
    const prev = pts[pts.length - 2] as Point;
    const len = Math.hypot(tip.x - prev.x, tip.y - prev.y);
    const ux = (tip.x - prev.x) / len;
    const uy = (tip.y - prev.y) / len;
    const bx = tip.x - ux * ARROW.length;
    const by = tip.y - uy * ARROW.length;
    pts[pts.length - 1] = { x: bx, y: by };
    head = `<polygon points="${n3(tip.x)},${n3(tip.y)} ${n3(bx - uy * ARROW.half)},${n3(by + ux * ARROW.half)} ${n3(bx + uy * ARROW.half)},${n3(by - ux * ARROW.half)}" fill="${STROKE}"/>`;
  }
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${n3(p.x)} ${n3(p.y)}`).join(" ");
  return `<g class="${cls(`e:#${e.edge.index}`, "edge")}"><path class="connection" d="${d}" fill="none" stroke="${STROKE}" stroke-width="${LINE}" stroke-linejoin="round"/>${head}</g>`;
}

export function renderSvg(
  model: Model,
  layout: Layout,
  edges: RoutedEdge[],
  edgeLabels: PlacedLabel[],
): string {
  const parts: string[] = [];
  for (const [id, r] of layout.captions) {
    const label = layout.labels.get(`caption:${id}`) as MeasuredLabel;
    parts.push(`<g class="sumi-caption">${textSvg(label, r.x + r.w / 2, r.y + r.h / 2)}</g>`);
  }
  for (const [id, r] of layout.groups)
    parts.push(
      `<g class="${cls(`g:${id}`, "group")}"><g class="shape"><rect x="${n3(r.x)}" y="${n3(r.y)}" width="${n3(r.w)}" height="${n3(r.h)}" rx="${STYLE.groupRadius}" fill="#f2f2f2" stroke="${STROKE}" stroke-width="${BOX_LINE}"/></g></g>`,
    );
  for (const e of edges) parts.push(edgeSvg(e));
  for (const l of edgeLabels)
    parts.push(
      `<g class="sumi-edge-label">${textSvg(l.label, l.rect.x + l.rect.w / 2, l.rect.y + l.rect.h / 2)}</g>`,
    );
  for (const node of model.nodes.values()) {
    const r = layout.nodes.get(node.id) as Rect;
    parts.push(nodeSvg(node, r, layout.labels.get(node.id) as MeasuredLabel));
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width / 2}pt" height="${layout.height / 2}pt" viewBox="0 0 ${layout.width} ${layout.height}">`,
    `<rect x="0" y="0" width="${layout.width}" height="${layout.height}" fill="#ffffff"/>`,
    ...parts,
    "</svg>",
  ].join("\n");
}
