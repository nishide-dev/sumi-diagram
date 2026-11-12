/** Experimental DrawingML: editable objects, not a fidelity/round-trip format (#62). */

import { readFileSync } from "node:fs";
import type { EdgeIR, FigureIR, SetIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";
import type { Diagnostic } from "../../core/diagnostics";
import type { Region } from "../../core/geometry";
import { getOutlineRenderer } from "../../core/outline";
import { type FlowArrowParams, flowArrow, flowArrowHead } from "../../core/outline/flow-arrow";
import { SEPARATOR_ID } from "../../core/registry/builtins";
import type { Result } from "../../core/result";
import { getTheme } from "../../core/theme/builtin";
import { type FontSet, getFontSet } from "../../core/theme/fonts";
import { overlapTint } from "../../core/theme/set-style";
import { edgeArrowheadLength } from "../../layout/route/arrowhead";
import { setOverlaps } from "../../layout/set-overlap";
import { fontFileFor, measureLabel } from "../../lint/geometry/measure";
import { FontParseError } from "../../lint/sfnt";
import { readSvgMetadata } from "../finalize";
import { BoundsBuilder, type PathSegment, type Point, parsePath, type Rect } from "../geometry";
import { untrimmedRoutes } from "../hollow-arrowheads";
import {
  decodeElementClass,
  inspectSvg,
  type LabelGeometry,
  type LabelRunGeometry,
} from "../inspect";
import { rayHit } from "../outline-geometry";
import { readFontFace } from "../pdf/fonts";
import { exceedsPdfInputLimits } from "../pdf/pdf";
import { readD2Svg } from "../svg";
import { attribute, childElements, classList, descendants, type XmlElement } from "../xml";
import { editablePptx, escapeXml } from "./package";

export type PptxConnectors = "freeform" | "glued";
export interface EditablePptxOptions {
  connectors?: PptxConnectors;
  fontSet?: FontSet;
}
const U = 6350; // one D2 unit = .5pt

/**
 * A flow arrow (#426) as the PowerPoint preset of its form, so it stays one
 * editable shape: `rightArrow`, `triangle` or `chevron`, turned or flipped to
 * point the right way. A preset is drawn unturned pointing right (the
 * triangle: up), so a turned shape takes the box with its sides swapped about
 * the same center and DrawingML's `rot` (clockwise, 60000ths of a degree).
 */
export function flowArrowPreset(box: Rect, params: FlowArrowParams) {
  const { form, direction, shaft } = params;
  const flat = direction === "right" || direction === "left";
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const swapped = {
    x: cx - box.height / 2,
    y: cy - box.width / 2,
    width: box.height,
    height: box.width,
  };
  const percent = (fraction: number) => Math.round(fraction * 100000);
  const [length, thickness] = flat ? [box.width, box.height] : [box.height, box.width];
  // The head the geometry draws, which may be shorter than asked (a chevron's band keeps some width).
  const head = flowArrowHead(params, length, thickness) / Math.min(length, thickness);
  let preset: string;
  let adjust = "";
  let drawn = box;
  let turn = "";
  if (form === "triangle") {
    preset = "triangle";
    // Up is the preset's own direction; the others turn it about its center.
    if (flat) drawn = swapped;
    turn = { up: "", down: ' flipV="1"', right: ' rot="5400000"', left: ' rot="16200000"' }[
      direction
    ];
  } else {
    if (form === "block") {
      preset = "rightArrow";
      adjust = `<a:gd name="adj1" fmla="val ${percent(shaft)}"/><a:gd name="adj2" fmla="val ${percent(head)}"/>`;
    } else {
      preset = "chevron";
      adjust = `<a:gd name="adj" fmla="val ${percent(head)}"/>`;
    }
    if (!flat) drawn = swapped;
    turn = { right: "", left: ' flipH="1"', down: ' rot="5400000"', up: ' rot="16200000"' }[
      direction
    ];
  }
  return {
    geom: `<a:prstGeom prst="${preset}"><a:avLst>${adjust}</a:avLst></a:prstGeom>`,
    box: drawn,
    turn,
  };
}
/**
 * How far above its SVG position (units) a sublabel (#184) may start when
 * joined to its node's text: rounding only (1/1000 unit coordinates).
 */
const SPACING_TOLERANCE = 0.002;
/** The smallest DrawingML text size (`a:rPr/@sz`, in 1/100 pt): 1pt. */
const MIN_TEXT_SIZE = 100;
/**
 * EMU of a length in D2 units at a print scale (#183, `figure.fit: scale`:
 * the SVG's printed size over its natural size; 1 otherwise).
 */
const emuAt = (scale: number) => (n: number) => Math.round(n * U * scale);
const sites =
  '<a:cxnLst><a:cxn ang="3cd4"><a:pos x="hc" y="t"/></a:cxn><a:cxn ang="cd2"><a:pos x="l" y="vc"/></a:cxn><a:cxn ang="cd4"><a:pos x="hc" y="b"/></a:cxn><a:cxn ang="0"><a:pos x="r" y="vc"/></a:cxn></a:cxnLst>';
/**
 * A label line's runs for DrawingML: a math accent's mark (#129) joins its
 * base's run (`y` U+0302 in one `<a:r>`), since PowerPoint places combining
 * marks itself.
 */
function withAccentsOnBases(runs: readonly LabelRunGeometry[]): LabelRunGeometry[] {
  const out: LabelRunGeometry[] = [];
  for (const run of runs) {
    const base = out.at(-1);
    if (run.accent === true && base !== undefined) {
      out[out.length - 1] = { ...base, text: base.text + run.text };
    } else out.push(run);
  }
  return out;
}

function paint(color: string, opacity = 1): string {
  if (color === "none" || color === "transparent") return "<a:noFill/>";
  const hex = color.replace(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i, "#$1$1$2$2$3$3");
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`Unsupported native color ${color}`);
  return `<a:solidFill><a:srgbClr val="${hex.slice(1).toUpperCase()}">${opacity < 1 ? `<a:alpha val="${Math.round(opacity * 100000)}"/>` : ""}</a:srgbClr></a:solidFill>`;
}
function property(el: XmlElement, name: string): string | undefined {
  return (
    new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`)
      .exec(attribute(el, "style") ?? "")?.[1]
      ?.trim() ?? attribute(el, name)
  );
}
const value = (el: XmlElement, name: string, fallback = 0) =>
  Number(attribute(el, name) ?? fallback);
function shapePath(el: XmlElement): { segments: PathSegment[]; filled: boolean } {
  let d: string;
  switch (el.name) {
    case "path":
      d = attribute(el, "d") ?? "";
      break;
    case "rect": {
      const x = value(el, "x"),
        y = value(el, "y"),
        w = value(el, "width"),
        h = value(el, "height");
      const r = Math.min(value(el, "rx"), w / 2, h / 2),
        k = r * 0.5522847498307936;
      d =
        r > 0
          ? `M${x + r} ${y}H${x + w - r}C${x + w - r + k} ${y} ${x + w} ${y + r - k} ${x + w} ${y + r}V${y + h - r}C${x + w} ${y + h - r + k} ${x + w - r + k} ${y + h} ${x + w - r} ${y + h}H${x + r}C${x + r - k} ${y + h} ${x} ${y + h - r + k} ${x} ${y + h - r}V${y + r}C${x} ${y + r - k} ${x + r - k} ${y} ${x + r} ${y}Z`
          : `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
      break;
    }
    case "line":
      d = `M${value(el, "x1")} ${value(el, "y1")}L${value(el, "x2")} ${value(el, "y2")}`;
      break;
    case "polygon":
    case "polyline": {
      const p = (attribute(el, "points") ?? "")
        .trim()
        .split(/[ ,\s]+/)
        .map(Number);
      if (p.length < 4 || p.length % 2 !== 0 || !p.every(Number.isFinite))
        throw new Error("Invalid polygon");
      d =
        p.map((n, i) => (i % 2 === 0 ? `${i === 0 ? "M" : "L"}${n}` : ` ${n}`)).join("") +
        (el.name === "polygon" ? "Z" : "");
      break;
    }
    case "circle":
    case "ellipse": {
      const x = value(el, "cx"),
        y = value(el, "cy"),
        rx = value(el, el.name === "circle" ? "r" : "rx"),
        ry = value(el, el.name === "circle" ? "r" : "ry"),
        k = 0.5522847498307936;
      d = `M${x} ${y - ry}C${x + rx * k} ${y - ry} ${x + rx} ${y - ry * k} ${x + rx} ${y}C${x + rx} ${y + ry * k} ${x + rx * k} ${y + ry} ${x} ${y + ry}C${x - rx * k} ${y + ry} ${x - rx} ${y + ry * k} ${x - rx} ${y}C${x - rx} ${y - ry * k} ${x - rx * k} ${y - ry} ${x} ${y - ry}Z`;
      break;
    }
    default:
      throw new Error(`Unsupported native primitive <${el.name}>`);
  }
  const parsed = parsePath(d);
  if (!parsed.ok) throw new Error(parsed.message);
  return {
    segments: parsed.segments,
    filled:
      property(el, "fill") !== "none" &&
      property(el, "fill") !== "transparent" &&
      el.name !== "line" &&
      el.name !== "polyline",
  };
}
/** A set's convex region as a polygon (an ellipse sampled in 96 steps, as `outlinePolygon()` does). */
function regionPolygon(region: Region): Point[] {
  if (region.kind === "polygon") return [...region.points];
  return Array.from({ length: 96 }, (_, i) => {
    const a = (i / 96) * 2 * Math.PI;
    return { x: region.cx + region.rx * Math.cos(a), y: region.cy + region.ry * Math.sin(a) };
  });
}
function geometry(
  paths: { segments: PathSegment[]; filled: boolean }[],
  box: Rect,
  emu: (n: number) => number,
  connectionPoints?: readonly Point[],
): string {
  const point = (p: Point) => `<a:pt x="${emu(p.x - box.x)}" y="${emu(p.y - box.y)}"/>`;
  const body = paths
    .map(({ segments, filled }) => {
      let start: Point | undefined;
      const commands = segments
        .map((s) => {
          if (s.command === "M") {
            start = s.to;
            return `<a:moveTo>${point(s.to)}</a:moveTo>`;
          }
          if (s.command === "C")
            return `<a:cubicBezTo>${point(s.c1)}${point(s.c2)}${point(s.to)}</a:cubicBezTo>`;
          return filled && start && s.to.x === start.x && s.to.y === start.y
            ? "<a:close/>"
            : `<a:lnTo>${point(s.to)}</a:lnTo>`;
        })
        .join("");
      return `<a:path w="${Math.max(1, emu(box.width))}" h="${Math.max(1, emu(box.height))}"${filled ? "" : ' fill="none"'}>${commands}</a:path>`;
    })
    .join("");
  const connections = connectionPoints?.length
    ? `<a:cxnLst>${connectionPoints.map((p) => `<a:cxn ang="0"><a:pos x="${emu(p.x - box.x)}" y="${emu(p.y - box.y)}"/></a:cxn>`).join("")}</a:cxnLst>`
    : sites;
  return `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/>${connections}<a:rect l="0" t="0" r="r" b="b"/><a:pathLst>${body}</a:pathLst></a:custGeom>`;
}

/** Cut masked portions out of a path, preserving untouched cubic segments. */
/** How much of a route runs under the mask rectangles (the gaps `splitMaskedPath` leaves). */
export function maskedLength(path: PathSegment[], masks: Rect[]): number {
  const length = (parts: PathSegment[][]) => {
    let total = 0;
    for (const part of parts) {
      let a = part[0]?.to;
      for (const seg of part.slice(1)) {
        if (!a) break;
        const from = a;
        if (seg.command === "C") {
          // Cubics by 32 chords, so pieces of a split curve add up to the whole.
          let p = from;
          for (let k = 1; k <= 32; k++) {
            const t = k / 32,
              u = 1 - t;
            const q = {
              x:
                u * u * u * from.x +
                3 * u * u * t * seg.c1.x +
                3 * u * t * t * seg.c2.x +
                t * t * t * seg.to.x,
              y:
                u * u * u * from.y +
                3 * u * u * t * seg.c1.y +
                3 * u * t * t * seg.c2.y +
                t * t * t * seg.to.y,
            };
            total += Math.hypot(q.x - p.x, q.y - p.y);
            p = q;
          }
        } else total += Math.hypot(seg.to.x - from.x, seg.to.y - from.y);
        a = seg.to;
      }
    }
    return total;
  };
  return length(splitMaskedPath(path, [])) - length(splitMaskedPath(path, masks));
}

export function splitMaskedPath(path: PathSegment[], masks: Rect[]): PathSegment[][] {
  const parts: PathSegment[][] = [];
  let current: PathSegment[] | undefined;
  const append = (a: Point, b: Point) => {
    if (!current || current.at(-1)?.to.x !== a.x || current.at(-1)?.to.y !== a.y) {
      current = [{ command: "M", to: a }];
      parts.push(current);
    }
    current.push({ command: "L", to: b });
  };
  const cut = (a: Point, b: Point) => {
    let intervals: [number, number][] = [[0, 1]];
    for (const r of masks) {
      let lo = 0,
        hi = 1;
      for (const [p, d, min, max] of [
        [a.x, b.x - a.x, r.x, r.x + r.width],
        [a.y, b.y - a.y, r.y, r.y + r.height],
      ] as [number, number, number, number][]) {
        if (d === 0) {
          if (p < min || p > max) {
            lo = 1;
            hi = 0;
            break;
          }
        } else {
          lo = Math.max(lo, Math.min((min - p) / d, (max - p) / d));
          hi = Math.min(hi, Math.max((min - p) / d, (max - p) / d));
        }
      }
      if (lo < hi)
        intervals = intervals.flatMap(([s, e]) =>
          hi <= s || lo >= e
            ? [[s, e]]
            : [
                ...(s < lo ? [[s, lo] as [number, number]] : []),
                ...(hi < e ? [[hi, e] as [number, number]] : []),
              ],
        );
    }
    const at = (t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    for (const [s, e] of intervals) {
      if (s > 0) current = undefined;
      append(at(s), at(e));
      if (e < 1) current = undefined;
    }
    if (intervals.length === 0) current = undefined;
  };
  const curve = (a: Point, c1: Point, c2: Point, b: Point, depth = 0): void => {
    const points = [a, c1, c2, b];
    const x = Math.min(...points.map((p) => p.x)),
      y = Math.min(...points.map((p) => p.y));
    const maxX = Math.max(...points.map((p) => p.x)),
      maxY = Math.max(...points.map((p) => p.y));
    const intersects = masks.some(
      (r) => r.x <= maxX && r.x + r.width >= x && r.y <= maxY && r.y + r.height >= y,
    );
    if (
      masks.some((r) => r.x <= x && r.x + r.width >= maxX && r.y <= y && r.y + r.height >= maxY)
    ) {
      current = undefined;
    } else if (!intersects) {
      if (!current) {
        current = [{ command: "M", to: a }];
        parts.push(current);
      }
      current.push({ command: "C", c1, c2, to: b });
    } else if (depth >= 16 || Math.max(maxX - x, maxY - y) < 0.01) cut(a, b);
    else {
      const mid = (p: Point, q: Point): Point => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
      const p = mid(a, c1),
        q = mid(c1, c2),
        r = mid(c2, b),
        s = mid(p, q),
        t = mid(q, r),
        m = mid(s, t);
      curve(a, p, s, m, depth + 1);
      curve(m, t, r, b, depth + 1);
    }
  };
  let prev: Point | undefined;
  for (const segment of path) {
    if (segment.command === "M") {
      prev = segment.to;
      current = undefined;
      continue;
    }
    if (!prev) throw new Error("Invalid masked path");
    if (segment.command === "L") cut(prev, segment.to);
    else curve(prev, segment.c1, segment.c2, segment.to);
    prev = segment.to;
  }
  return parts;
}
interface ObjectSite {
  id: number;
  box: Rect;
  ellipse: boolean;
  connectionPoints?: readonly Point[];
}
function site(shape: ObjectSite, p: Point) {
  if (shape.connectionPoints?.length) {
    const distances = shape.connectionPoints.map((q) => Math.hypot(q.x - p.x, q.y - p.y));
    const index = distances.indexOf(Math.min(...distances));
    return { index, point: shape.connectionPoints[index] as Point };
  }
  const b = shape.box;
  const distances = [
    Math.abs(p.y - b.y),
    Math.abs(p.x - b.x),
    Math.abs(p.y - b.y - b.height),
    Math.abs(p.x - b.x - b.width),
  ];
  const index = distances.indexOf(Math.min(...distances));
  const points = [
    { x: b.x + b.width / 2, y: b.y },
    { x: b.x, y: b.y + b.height / 2 },
    { x: b.x + b.width / 2, y: b.y + b.height },
    { x: b.x + b.width, y: b.y + b.height / 2 },
  ];
  return { index: shape.ellipse ? index * 2 : index, point: points[index] as Point };
}
/** Input must be a finalized Sumi SVG with its matching IR and font set. */
export function svgToEditablePptx(
  finished: string,
  ir: FigureIR,
  options: EditablePptxOptions = {},
): Result<Uint8Array> {
  // PowerPoint draws the heads at the line's ends: use D2's routes, not
  // the lines cut short at hollow SVG heads (#483).
  const svg = untrimmedRoutes(finished);
  const limit = exceedsPdfInputLimits(svg);
  if (limit)
    return {
      ok: false,
      diagnostics: [
        {
          code: "pptx/input-too-large",
          severity: "error",
          message: limit.replaceAll("PDF", "PPTX"),
        },
      ],
    };
  const fail = (message: string): Result<never> => ({
    ok: false,
    diagnostics: [{ code: "pptx/unsupported-geometry", severity: "error", message }],
  });
  const layeredGroups = ir.groups.filter((g) => (g.layers?.count ?? 1) > 1);
  if (layeredGroups.length > 0)
    return {
      ok: false,
      diagnostics: layeredGroups.map((group) => ({
        code: "pptx/unsupported-geometry",
        severity: "error",
        message: `Editable PPTX cannot preserve stacked frames and front-frame connection sites of group "${group.id}".`,
        path: [...(ir.sourceMap.get(group.key)?.path ?? []), "props", "layers"],
        subject: { kind: "group", id: group.id },
        hint: "Use picture PPTX (the default --pptx-mode), which preserves all cards.",
      })),
    };
  // Icons and images (#94) have no editable DrawingML form yet (research #86
  // §6.2: a separate `p:pic` is stage B). Refuse rather than drop them.
  const withAssets = ir.nodes.filter(
    (n) => n.icon !== undefined || n.image !== undefined || n.badge !== undefined,
  );
  if (withAssets.length > 0) {
    return {
      ok: false,
      diagnostics: withAssets.map((node) => {
        const source = ir.sourceMap.get(node.key);
        return {
          code: "pptx/unsupported-asset",
          severity: "error",
          message: `The editable PPTX cannot carry the ${node.badge !== undefined ? "badge" : node.icon !== undefined ? "icon" : "image"} of ${
            node.legend === undefined
              ? `node "${node.id}"`
              : node.legend.name.replace(/^the sample icon of /, "")
          } yet.`,
          ...(source !== undefined && {
            path: [
              ...source.path,
              // The origin of a legend's icon sample is the entry's `icon` already.
              ...(node.legend !== undefined && node.icon !== undefined
                ? []
                : [
                    node.badge !== undefined
                      ? "badge"
                      : node.icon !== undefined
                        ? "icon"
                        : "component",
                  ]),
            ],
          }),
          ...(source?.location !== undefined && { location: source.location }),
          subject: { kind: "node", id: node.legend?.id ?? node.id },
          hint: "Use the picture PPTX (the default --pptx-mode), which keeps icons and images.",
        };
      }),
    };
  }
  const connectors = options.connectors ?? "freeform";
  const fonts = options.fontSet ?? getFontSet(ir.meta.fontSetId);
  if (!fonts)
    return {
      ok: false,
      diagnostics: [
        {
          code: "pptx/missing-font",
          severity: "error",
          message: "The editable export requires the figure's font set.",
        },
      ],
    };
  if (connectors !== "freeform" && connectors !== "glued")
    return fail(`Unsupported connector mode ${connectors}`);
  const inspected = inspectSvg(svg, ir);
  if (!inspected.ok) return inspected;
  const read = readD2Svg(svg);
  if (!read.ok) return { ok: false, diagnostics: [read.diagnostic] };
  const metadata = readSvgMetadata(svg);
  if (!metadata.ok) return metadata;
  if (metadata.value && metadata.value.figureId !== ir.meta.id)
    return fail("The SVG and Figure IR do not match.");
  const canvas = inspected.value.canvas;
  const canvasColor = getTheme(ir.meta.themeId)?.canvas ?? "#ffffff";
  // A figure shrunk by `figure.fit: scale` (#183) is placed at its printed
  // size: every length, line width and font size times the scale.
  const scale = inspected.value.scale ?? 1;
  const emu = emuAt(scale);
  const slide = { width: canvas.width.pt * scale, height: canvas.height.pt * scale };
  if (![slide.width, slide.height].every((v) => v > 0 && v <= 4032))
    return {
      ok: false,
      diagnostics: [
        {
          code: "pptx/unsupported-size",
          severity: "error",
          message: "PPTX slide sides must not exceed 4032pt (56 inches).",
        },
      ],
    };
  // DrawingML sizes text in 1/100 pt from 100 (1pt): a figure shrunk hard by
  // `figure.fit: scale` (#183) can print text below that. Refuse rather than
  // write an invalid package or enlarge the text.
  const textSizes = inspected.value.elements.flatMap((e) =>
    e.labels.map((l) => Math.round(l.fontSizeUnits * 50 * scale)),
  );
  const smallestText = Math.min(...textSizes);
  if (textSizes.length > 0 && smallestText < MIN_TEXT_SIZE)
    return {
      ok: false,
      diagnostics: [
        {
          code: "pptx/unsupported-size",
          severity: "error",
          message: `The editable PPTX cannot write text smaller than 1pt; the figure, shrunk to ${Math.round(scale * 1000) / 10}% by figure.fit: scale, prints text at ${smallestText / 100}pt.`,
          hint: "Use the picture PPTX (the default --pptx-mode), or make the figure narrower so it shrinks less.",
        },
      ],
    };
  const vb = canvas.viewBox;
  const dx = Math.floor(
    (Math.max(914400, Math.round(slide.width * 12700)) - Math.round(slide.width * 12700)) / 2,
  );
  const dy = Math.floor(
    (Math.max(914400, Math.round(slide.height * 12700)) - Math.round(slide.height * 12700)) / 2,
  );
  const xfrm = (b: Rect, flip = "", grouped = false) => {
    const off = `x="${emu(b.x - vb.x) + dx}" y="${emu(b.y - vb.y) + dy}"`;
    const ext = `cx="${Math.max(1, emu(b.width))}" cy="${Math.max(1, emu(b.height))}"`;
    return `<a:xfrm${flip}><a:off ${off}/><a:ext ${ext}/>${grouped ? `<a:chOff ${off}/><a:chExt ${ext}/>` : ""}</a:xfrm>`;
  };
  const geometries = new Map(inspected.value.elements.map((e) => [e.key, e]));
  const groups = [...descendants(read.doc.drawing)].filter(
    (e) => e.name === "g" && classList(e).some((c) => c.startsWith("sumi-k-")),
  );
  const byKey = new Map<ElementKey, XmlElement>();
  for (const group of groups) {
    const key = classList(group)
      .map(decodeElementClass)
      .find((k) => k !== undefined);
    if (key) byKey.set(key, group);
  }
  let next = 2;
  const ids = new Map([...ir.elements.keys()].map((key) => [key, next++]));
  const objects = new Map<ElementKey, ObjectSite>();
  const faces = new Map<string, ReturnType<typeof readFontFace>>();
  try {
    const faceOf = (font: string) => {
      const file = fontFileFor(font, fonts);
      let face = faces.get(file);
      if (!face) {
        face = readFontFace(readFileSync(file));
        faces.set(file, face);
      }
      return face;
    };
    /**
     * A label's paragraphs: one per line, in the label's size and line
     * spacing; the first one `before` units below the previous paragraph.
     */
    const paragraphsOf = (label: LabelGeometry, el: XmlElement, opacity: number, before = 0) => {
      const measured = measureLabel(label, fonts);
      const fill = paint(property(el, "fill") ?? "#000000", opacity);
      // A run in its own face; label math (#93) uses DrawingML's baseline
      // offset for scripts (PowerPoint draws such runs smaller by itself, so
      // they keep the label's size here).
      const run = (text: string, font: string, shiftUnits = 0, color?: string) => {
        const face = faceOf(font);
        const baseline =
          shiftUnits === 0
            ? ""
            : ` baseline="${Math.round((-shiftUnits / label.fontSizeUnits) * 100000)}"`;
        return `<a:r><a:rPr lang="ja-JP" sz="${Math.round(label.fontSizeUnits * 50 * scale)}"${face.weight >= 600 ? ' b="1"' : ""}${face.italic ? ' i="1"' : ""}${baseline}>${color === undefined ? fill : paint(color, opacity)}<a:latin typeface="${escapeXml(face.family)}"/><a:ea typeface="${escapeXml(face.family)}"/></a:rPr><a:t xml:space="preserve">${escapeXml(text)}</a:t></a:r>`;
      };
      return measured.texts
        .map((text, i) => {
          const runs = label.runs?.[i];
          const content =
            runs === undefined
              ? run(text, label.font)
              : withAccentsOnBases(runs)
                  .map((r) => run(r.text, r.font, r.shiftUnits, r.fill))
                  .join("");
          return `<a:p><a:pPr algn="${label.textAlign === "left" ? "l" : label.textAlign === "right" ? "r" : "ctr"}"><a:lnSpc><a:spcPts val="${Math.max(0, Math.round(label.lineHeightUnits * 50 * scale))}"/></a:lnSpc><a:spcBef><a:spcPts val="${i === 0 ? Math.round(before * 50 * scale) : 0}"/></a:spcBef><a:spcAft><a:spcPts val="0"/></a:spcAft></a:pPr>${content}</a:p>`;
        })
        .join("");
    };
    /**
     * The space (`spcBef`, in units) a node's sublabel (#184) needs before
     * its first paragraph, written right after its label's paragraphs, so
     * that its first line's top lands where the SVG has it: each line's top
     * is the top inset plus the line spacings above it. Negative when the
     * sublabel starts higher than the label's spacings reach, which
     * DrawingML cannot write (no negative spacing).
     */
    const sublabelSpaceBefore = (label: LabelGeometry, sublabel: LabelGeometry): number => {
      const m = measureLabel(label, fonts);
      const s = measureLabel(sublabel, fonts);
      const labelTop = m.lines[0]?.y ?? 0;
      const sublabelTop = s.lines[0]?.y ?? 0;
      return sublabelTop - (labelTop + m.texts.length * label.lineHeightUnits);
    };
    /**
     * A text body holding `label`, then, when given, a node's sublabel
     * (#184) as paragraphs in its smaller size after `before` units of space
     * (see {@link sublabelSpaceBefore}; never negative here). Placed by the
     * label: its first line's top is the top inset.
     */
    const textBody = (
      label: LabelGeometry,
      el: XmlElement,
      box: Rect,
      opacity: number,
      sublabel?: { label: LabelGeometry; el: XmlElement; before: number },
    ) => {
      const measured = measureLabel(label, fonts);
      const offset = label.anchor.x - (box.x + box.width / 2);
      const left =
        label.textAlign === "left"
          ? label.anchor.x - box.x
          : label.textAlign === "right"
            ? 0
            : Math.max(0, 2 * offset);
      const right =
        label.textAlign === "right"
          ? box.x + box.width - label.anchor.x
          : label.textAlign === "left"
            ? 0
            : Math.max(0, -2 * offset);
      const top = (measured.lines[0]?.y ?? box.y) - box.y;
      const paragraphs =
        paragraphsOf(label, el, opacity) +
        (sublabel === undefined
          ? ""
          : paragraphsOf(sublabel.label, sublabel.el, opacity, sublabel.before));
      return `<p:txBody><a:bodyPr wrap="none" lIns="${emu(Math.max(0, left))}" rIns="${emu(Math.max(0, right))}" tIns="${emu(top)}" bIns="0" anchor="t"><a:noAutofit/></a:bodyPr><a:lstStyle/>${paragraphs}</p:txBody>`;
    };
    const line = (
      el: XmlElement,
      style: { stroke: string; strokeWidth: { units: number }; opacity: number },
      ends = "",
      strokeStyle: "round" | "svg-default" = "round",
    ) => {
      const width = Number(property(el, "stroke-width") ?? style.strokeWidth.units);
      if (!Number.isFinite(width) || width < 0) throw new Error("Unsupported stroke width");
      const dash = (property(el, "stroke-dasharray") ?? "")
        .split(/[ ,]+/)
        .filter(Boolean)
        .map(Number);
      // Round dots (#427) are a zero-length dash with round caps: PowerPoint's own round dot.
      const dotted = dash.length === 2 && dash[0] === 0 && (dash[1] ?? 0) > 0;
      if (
        !dotted &&
        dash.length &&
        (dash.length % 2 !== 0 || !dash.every((n) => Number.isFinite(n) && n > 0))
      )
        throw new Error("Unsupported dash pattern");
      const dashXml =
        width > 0 && dotted
          ? '<a:prstDash val="sysDot"/>'
          : width > 0 && dash.length
            ? `<a:custDash>${Array.from({ length: dash.length / 2 }, (_, i) => `<a:ds d="${Math.max(1, Math.round(((dash[2 * i] ?? 0) / width) * 100000))}" sp="${Math.max(1, Math.round(((dash[2 * i + 1] ?? 0) / width) * 100000))}"/>`).join("")}</a:custDash>`
            : "";
      const cap = strokeStyle === "svg-default" && !dotted ? "flat" : "rnd";
      const join = strokeStyle === "svg-default" ? '<a:miter lim="400000"/>' : "<a:round/>";
      return `<a:ln w="${emu(width)}" cap="${cap}">${width === 0 ? "<a:noFill/>" : paint(property(el, "stroke") ?? style.stroke, style.opacity)}${dashXml}${join}${ends}</a:ln>`;
    };
    const shape = (
      id: number,
      name: string,
      b: Rect,
      geom: string,
      fill: string,
      stroke: string,
      body = "",
      textOnly = false,
      xfrmAttributes = "",
    ) =>
      `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${escapeXml(name)}"/><p:cNvSpPr${textOnly ? ' txBox="1"' : ""}/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(b, xfrmAttributes)}${geom}${fill}${stroke}</p:spPr>${body}</p:sp>`;
    /**
     * A turned node label (#178) as a text box of its own, turned with
     * DrawingML's `rot` (clockwise, 60000ths of a degree) about the box's
     * center: the box is the label's upright box, centered on the SVG's
     * rotation center so that turning it about its center matches the SVG.
     * The node's shape keeps no text (rotating the shape would turn its
     * geometry too).
     */
    const turnedLabel = (
      name: string,
      label: LabelGeometry,
      el: XmlElement,
      opacity: number,
    ): string => {
      const rotation = label.rotation;
      if (rotation === undefined) return "";
      const { rotation: _, ...upright } = label;
      const m = measureLabel(upright, fonts).box;
      if (m === undefined) return "";
      const c = rotation.center;
      const halfWidth = Math.max(c.x - m.x, m.x + m.width - c.x);
      const halfHeight = Math.max(c.y - m.y, m.y + m.height - c.y);
      const box = {
        x: c.x - halfWidth,
        y: c.y - halfHeight,
        width: 2 * halfWidth,
        height: 2 * halfHeight,
      };
      return shape(
        next++,
        name,
        box,
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>',
        "<a:noFill/>",
        "<a:ln><a:noFill/></a:ln>",
        textBody(upright, el, box, opacity),
        true,
        ` rot="${((rotation.degrees + 360) % 360) * 60000}"`,
      );
    };
    /**
     * A node's line decoration: matrix hatches (#180, `path.sumi-hatch`)
     * or a token divider (#216, `path.sumi-token-separator`). Export the
     * segments as a line shape of their own over the node's box, so the
     * slide draws the same lines as the SVG, PDF and picture PPTX (a
     * DrawingML pattern fill would tile at its own scale and phase).
     */
    const hatchShape = (
      key: ElementKey,
      group: XmlElement,
      box: Rect,
      style: { stroke: string; strokeWidth: { units: number }; opacity: number },
    ): string => {
      const hatch = childElements(group).find(
        (e) =>
          e.name === "path" &&
          (classList(e).includes("sumi-hatch") || classList(e).includes("sumi-token-separator")),
      );
      if (hatch === undefined) return "";
      return shape(
        next++,
        `${key} ${classList(hatch).includes("sumi-token-separator") ? "separator" : "hatch"}`,
        box,
        geometry([shapePath(hatch)], box, emu),
        "<a:noFill/>",
        line(hatch, style),
      );
    };
    /**
     * A node's glyphs (#408, `g.sumi-glyphs`): one editable shape per cell,
     * dot or pill, in the SVG's own colours, over the node's body.
     */
    const glyphShapes = (key: ElementKey, group: XmlElement, opacity: number): string => {
      const glyphs = childElements(group).find(
        (e) => e.name === "g" && classList(e).includes("sumi-glyphs"),
      );
      if (glyphs === undefined) return "";
      return [...descendants(glyphs)]
        .filter((e) => e.name === "rect")
        .map((cell, index) => {
          const b = {
            x: value(cell, "x"),
            y: value(cell, "y"),
            width: value(cell, "width"),
            height: value(cell, "height"),
          };
          return shape(
            next++,
            `${key} glyph ${index + 1}`,
            b,
            geometry([shapePath(cell)], b, emu),
            paint(property(cell, "fill") ?? "none", opacity),
            line(cell, { stroke: "none", strokeWidth: { units: 0 }, opacity }),
          );
        })
        .join("");
    };
    const objectXml = new Map<ElementKey, string>();
    for (const element of [...ir.groups, ...ir.nodes]) {
      const group = byKey.get(element.key),
        geo = geometries.get(element.key),
        id = ids.get(element.key);
      if (!group || !geo || id === undefined) throw new Error(`Missing object ${element.key}`);
      // A caption (#130) is a text box: in D2 it is drawn as the label of a
      // transparent container around its group, which is not part of it.
      const caption = element.kind === "node" && element.captionOf !== undefined;
      const container = caption
        ? undefined
        : childElements(group).find((e) => classList(e).includes("shape"));
      const primitives = container ? [...descendants(container)].filter((e) => e.name !== "g") : [];
      // DrawingML has one line style per shape. Keep the waveform's mitered
      // frame separate from its round-capped/round-joined signal paths.
      const waveform = element.kind === "node" && element.render?.renderer === "sumi/waveform";
      const bodyPrimitives = waveform ? primitives.slice(0, 1) : primitives;
      const signalPrimitives = waveform ? primitives.slice(1) : [];
      const label = geo.labels[0];
      const texts = childElements(group).filter((e) => e.name === "text");
      const text = texts[0];
      // A node's sublabel (#184) is its second <text>, under the label.
      const sublabelLabel = geo.labels[1];
      const sublabelText = texts[1];
      const sublabel =
        sublabelLabel !== undefined && sublabelText !== undefined
          ? { label: sublabelLabel, el: sublabelText }
          : undefined;
      const measured = label
        ? sublabel === undefined
          ? measureLabel(label, fonts).box
          : [label, sublabel.label]
              .map((l) => measureLabel(l, fonts).box)
              .reduce(
                (bounds, rect) => (rect === undefined ? bounds : bounds.addRect(rect)),
                new BoundsBuilder(),
              )
              .rect()
        : undefined;
      const box = geo.bbox ??
        measured ?? { x: label?.anchor.x ?? vb.x, y: label?.anchor.y ?? vb.y, width: 1, height: 1 };
      const ellipse =
        primitives.length === 1 && ["circle", "ellipse"].includes(primitives[0]?.name ?? "");
      // New directional / disconnected outlines need their painted contacts,
      // not the legacy bounding-box sites (which may be in the empty gap).
      const preciseSites =
        element.kind === "node" &&
        element.render !== undefined &&
        (element.render.renderer === "sumi/bubble" ||
          (element.render.renderer === "sumi/bowtie" &&
            typeof element.render.params?.gap === "number" &&
            element.render.params.gap > 0) ||
          (element.render.renderer === "sumi/trapezoid" &&
            element.render.params?.narrow !== undefined));
      const connectionEnds = preciseSites
        ? ir.edges.flatMap((edge) => {
            const path = inspected.value.elements.find((e) => e.key === edge.key)?.path;
            if (!path || path.length < 2) return [];
            const first = path[0] as PathSegment;
            const second = path[1] as PathSegment;
            const last = path.at(-1) as PathSegment;
            const before = path.at(-2) as PathSegment;
            return [
              ...(edge.from === element.key
                ? [{ point: first.to, neighbour: second.command === "C" ? second.c1 : second.to }]
                : []),
              ...(edge.to === element.key
                ? [{ point: last.to, neighbour: last.command === "C" ? last.c2 : before.to }]
                : []),
            ];
          })
        : undefined;
      const connectionPoints = connectionEnds?.map(({ point }) => point);
      if (connectionPoints !== undefined && element.kind === "node" && element.render) {
        const renderer = getOutlineRenderer(element.render.renderer);
        if (!renderer) throw new Error(`Missing renderer ${element.render.renderer}`);
        const drawing = renderer.draw(box, renderer.params.parse(element.render.params));
        const boundaries = drawing.boundaries ?? [drawing.portOutline ?? drawing.outline];
        // Auto routes retain D2's clearance. A glued site must instead lie on
        // the painted boundary, including at the corner of a split body's lip.
        for (const [index, point] of connectionPoints.entries()) {
          const neighbour = connectionEnds?.[index]?.neighbour;
          let contact: Point | undefined;
          if (neighbour !== undefined) {
            const direction = { x: point.x - neighbour.x, y: point.y - neighbour.y };
            const hits = boundaries.flatMap((boundary) => {
              const hit = rayHit(boundary, point, direction);
              return hit === undefined ? [] : [hit];
            });
            if (hits.length > 0) {
              const distance = Math.min(...hits);
              contact = {
                x: point.x + direction.x * distance,
                y: point.y + direction.y * distance,
              };
            }
          }
          // A rounded or degenerate tangent may miss a polygon corner. Fall
          // back to its closest painted point, never a clearance coordinate.
          let nearest = point;
          let distance = Number.POSITIVE_INFINITY;
          for (const boundary of boundaries) {
            for (const [i, a] of boundary.entries()) {
              const b = boundary[(i + 1) % boundary.length] as Point;
              const dx = b.x - a.x;
              const dy = b.y - a.y;
              const lengthSquared = dx * dx + dy * dy;
              const t =
                lengthSquared === 0
                  ? 0
                  : Math.max(
                      0,
                      Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared),
                    );
              const projected = { x: a.x + t * dx, y: a.y + t * dy };
              const d = Math.hypot(projected.x - point.x, projected.y - point.y);
              if (d < distance) {
                nearest = projected;
                distance = d;
              }
            }
          }
          // Structured SVG rounds contacts to 1/1000 unit. If that puts an
          // end just inside the body, its forward ray sees the far side.
          connectionPoints[index] = distance <= 0.002 ? nearest : (contact ?? nearest);
        }
        // Also offer painted sites on an unconnected shape when edited later.
        connectionPoints.push(...boundaries.flat());
      }
      const flow =
        element.kind === "node" && element.render?.renderer === "sumi/flow-arrow"
          ? flowArrowPreset(box, flowArrow.params.parse(element.render.params ?? {}))
          : undefined;
      const geom = flow
        ? flow.geom
        : ellipse
          ? '<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>'
          : primitives.length
            ? geometry(bodyPrimitives.map(shapePath), box, emu, connectionPoints)
            : '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>';
      const first = primitives[0];
      const fill = first
        ? paint(property(first, "fill") ?? element.style.fill, element.style.opacity)
        : "<a:noFill/>";
      const stroke = first
        ? line(
            first,
            element.style,
            "",
            waveform ||
              flow !== undefined ||
              element.component === SEPARATOR_ID ||
              ir.meta.themeOverrides?.nodeCorners === "square"
              ? "svg-default"
              : "round",
          )
        : "<a:ln><a:noFill/></a:ln>";
      const turned = label?.rotation !== undefined;
      // An upright sublabel (#184) joins the node's text when paragraph
      // spacing can put it where the SVG draws it; otherwise (it would need
      // negative spacing) it is a text box of its own at its SVG position.
      const before =
        label && sublabel && !turned ? sublabelSpaceBefore(label, sublabel.label) : undefined;
      const joined = before !== undefined && before >= -SPACING_TOLERANCE;
      const ownBox = (part: { label: LabelGeometry; el: XmlElement }) => {
        const b = measureLabel(part.label, fonts).box;
        if (b === undefined) return "";
        return shape(
          next++,
          `${element.key} sublabel`,
          b,
          '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>',
          "<a:noFill/>",
          "<a:ln><a:noFill/></a:ln>",
          textBody(part.label, part.el, b, element.style.opacity),
          true,
        );
      };
      let body = shape(
        id,
        element.key,
        flow?.box ?? box,
        geom,
        fill,
        stroke,
        label && text && !turned
          ? textBody(
              label,
              text,
              box,
              element.style.opacity,
              sublabel !== undefined && joined
                ? { ...sublabel, before: Math.max(0, before) }
                : undefined,
            )
          : "",
        !first,
        flow?.turn,
      );
      if (signalPrimitives[0] !== undefined) {
        body += shape(
          next++,
          `${element.key} signal`,
          box,
          geometry(signalPrimitives.map(shapePath), box, emu),
          "<a:noFill/>",
          line(signalPrimitives[0], element.style),
        );
        // Keep the frame's connection id and the signal's paint order inside
        // one editable object. Equal parent/child transforms preserve the
        // children's slide coordinates while moving/scaling them together.
        body = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${next++}" name="${escapeXml(`${element.key} waveform`)}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr>${xfrm(box, "", true)}</p:grpSpPr>${body}</p:grpSp>`;
      }
      objectXml.set(
        element.key,
        body +
          (sublabel !== undefined && before !== undefined && !joined ? ownBox(sublabel) : "") +
          (label && text && turned
            ? turnedLabel(`${element.key} label`, label, text, element.style.opacity) +
              (sublabel === undefined
                ? ""
                : turnedLabel(
                    `${element.key} sublabel`,
                    sublabel.label,
                    sublabel.el,
                    element.style.opacity,
                  ))
            : "") +
          hatchShape(element.key, group, box, element.style) +
          (element.kind === "node" ? glyphShapes(element.key, group, element.style.opacity) : ""),
      );
      objects.set(element.key, { id, box, ellipse, ...(connectionPoints && { connectionPoints }) });
    }
    const markers = new Map(
      [...descendants(read.doc.drawing)]
        .filter((e) => e.name === "marker")
        .map((e) => [attribute(e, "id"), e]),
    );
    const ends = (edge: EdgeIR, path: XmlElement) => {
      const emit = (at: "start" | "end", type: EdgeIR["sourceArrowhead"]) => {
        if (!type || type === "none") return "";
        // OOXML's `arrow` end is an open chevron: `open` (#386) maps to it exactly.
        const mapped = {
          triangle: "triangle",
          open: "arrow",
          arrow: "arrow",
          diamond: "diamond",
          circle: "oval",
          box: "",
          cross: "",
        }[type];
        if (!mapped || (!edge.style.filled && mapped !== "arrow"))
          throw new Error(`Unsupported native arrowhead ${type} (filled=${edge.style.filled})`);
        const marker = markers.get(
          /^url\(#(.+)\)$/.exec(attribute(path, `marker-${at}`) ?? "")?.[1],
        );
        // Calibrated in PowerPoint Mac 16.114.1 at .5/1/2pt line widths:
        // standard ends render at about 4/6/10pt, rather than scaling with
        // stroke width. Choose the nearest discrete size to the SVG marker.
        const size = (units: number) => {
          const pt = units * 0.5 * scale;
          return (
            [
              ["med", 6],
              ["sm", 4],
              ["lg", 10],
            ] as const
          ).reduce((best, next) =>
            Math.abs(next[1] - pt) < Math.abs(best[1] - pt) ? next : best,
          )[0];
        };
        // A figure that scales its arrowheads (#427) picks the size nearest to the scaled head.
        const scaled =
          edge.style.arrowheadScale === undefined ? undefined : edgeArrowheadLength(edge.style);
        const across = scaled ?? (marker ? value(marker, "markerHeight") : 12);
        const along = scaled ?? (marker ? value(marker, "markerWidth") : 12);
        return `<a:${at === "start" ? "headEnd" : "tailEnd"} type="${mapped}" w="${size(across)}" len="${size(along)}"/>`;
      };
      return emit("start", edge.sourceArrowhead) + emit("end", edge.targetArrowhead);
    };
    // Set enclosures (#407), as in the SVG (#440): every set's opaque tint, the regions where
    // sets overlap (freeform polygons in the combined tints), then each outline (no fill)
    // and label. They sit between the groups and the nodes.
    const setXml: string[] = [];
    const outlineXml: string[] = [];
    const drawnSets = (ir.sets ?? []).map((set) => {
      const geo = inspected.value.sets?.find((g) => g.id === set.id);
      const group = [...descendants(read.doc.drawing)].find(
        (e) => e.name === "g" && classList(e).includes(`sumi-set-${set.id}`),
      );
      const drawn =
        group && childElements(group).find((e) => classList(e).includes("sumi-set-shape"));
      if (!geo || !group || !drawn) throw new Error(`Missing set ${set.id}`);
      return { set, geo, group, drawn };
    });
    const tinted = drawnSets.map(
      ({ set }) => set.style.fill !== "transparent" && set.style.strength > 0,
    );
    for (const [i, { set, geo, drawn }] of drawnSets.entries()) {
      if (tinted[i] !== true) continue;
      setXml.push(
        shape(
          next++,
          `set ${set.id}`,
          geo.bbox,
          // The outline element is drawn `fill="none"`: the tint shape fills the same path.
          geometry([{ ...shapePath(drawn), filled: true }], geo.bbox, emu),
          paint(set.style.fill),
          "<a:ln><a:noFill/></a:ln>",
        ),
      );
    }
    const overlaps = setOverlaps(
      drawnSets.map(({ geo }, i) => (tinted[i] === true ? regionPolygon(geo.region) : undefined)),
    );
    for (const { members, polygon } of overlaps) {
      const xs = polygon.map((p) => p.x);
      const ys = polygon.map((p) => p.y);
      const bounds: Rect = {
        x: Math.min(...xs),
        y: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
      };
      const ring: PathSegment[] = [
        { command: "M", to: polygon[0] as Point },
        ...polygon.slice(1).map((to): PathSegment => ({ command: "L", to })),
        { command: "L", to: polygon[0] as Point },
      ];
      setXml.push(
        shape(
          next++,
          `set overlap ${members.map((m) => (drawnSets[m] as { set: { id: string } }).set.id).join(" + ")}`,
          bounds,
          geometry([{ segments: ring, filled: true }], bounds, emu),
          paint(
            overlapTint(
              members.map((m) => (drawnSets[m] as { set: SetIR }).set),
              canvasColor,
            ),
          ),
          "<a:ln><a:noFill/></a:ln>",
        ),
      );
    }
    for (const { set, geo, group, drawn } of drawnSets) {
      outlineXml.push(
        shape(
          next++,
          `set ${set.id} outline`,
          geo.bbox,
          geometry([shapePath(drawn)], geo.bbox, emu),
          "<a:noFill/>",
          line(drawn, set.style),
        ),
      );
      const text = childElements(group).find((e) => e.name === "text");
      const label = geo.labels[0];
      const b = label && measureLabel(label, fonts).box;
      if (text && label && b) {
        const box = { ...b, x: b.x - 2, width: b.width + 4 };
        outlineXml.push(
          shape(
            next++,
            `set ${set.id} label`,
            box,
            '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>',
            "<a:noFill/>",
            "<a:ln><a:noFill/></a:ln>",
            textBody(label, text, box, 1),
            true,
          ),
        );
      }
    }
    setXml.push(...outlineXml);
    let setsEmitted = setXml.length === 0;
    const output: string[] = [];
    const labels: string[] = [];
    // Zoom edges (#176) are painted under the routed edges, as in the SVG
    // (their wires come before the nets' wires): their shapes go right
    // before the first routed edge's.
    const zooms: string[] = [];
    let firstRouted: number | undefined;
    for (const group of groups) {
      const key = classList(group)
        .map(decodeElementClass)
        .find((k) => k !== undefined);
      if (!key) continue;
      const element = ir.elements.get(key),
        geo = geometries.get(key),
        id = ids.get(key);
      if (!element || !geo || id === undefined) throw new Error(`Unknown element ${key}`);
      if (element.kind !== "group" && !setsEmitted) {
        output.push(...setXml);
        setsEmitted = true;
      }
      if (element.kind !== "edge") {
        output.push(objectXml.get(key) ?? "");
        continue;
      }
      const path = childElements(group).find(
        (e) => e.name === "path" && classList(e).includes("connection"),
      );
      if (!path || !geo.path?.length) throw new Error(`Missing edge path ${key}`);
      const first = geo.path[0]?.to,
        last = geo.path.at(-1)?.to;
      if (!first || !last) throw new Error(`Empty edge ${key}`);
      const arrows = ends(element, path);
      const maskId = /^url\(#(.+)\)$/.exec(attribute(path, "mask") ?? "")?.[1];
      const mask =
        maskId &&
        [...descendants(read.doc.drawing)].find(
          (el) => el.name === "mask" && attribute(el, "id") === maskId,
        );
      const masks = mask
        ? childElements(mask)
            .filter((el) => el.name === "rect" && property(el, "fill") === "black")
            .map((el) => ({
              x: value(el, "x"),
              y: value(el, "y"),
              width: value(el, "width"),
              height: value(el, "height"),
            }))
        : [];
      const edgeStroke = ir.meta.themeOverrides?.edgeCorners === "sharp" ? "svg-default" : "round";
      // A zoom edge (#176) is two lines between corners, not a connector
      // between sites: it stays a freeform shape in either mode.
      // D2 shares one label mask between edges: only a route that runs under
      // one of its rectangles has a gap to keep.
      const crossesMask = masks.length > 0 && maskedLength(geo.path, masks) > 0.01;
      const splitTransparent = ir.meta.transparentBackground === true && crossesMask;
      if (connectors === "glued" && element.route === "curve" && !splitTransparent) {
        throw new Error(
          "Curved edges require freeform connectors; glued connectors cannot preserve cubic tangents. Use --pptx-connectors freeform.",
        );
      }
      if (connectors === "glued" && element.routing !== "zoom" && !splitTransparent) {
        if (element.from === element.to)
          throw new Error("Glued self-loops are unsupported; use freeform connectors.");
        const src = objects.get(element.from),
          dst = objects.get(element.to);
        if (!src || !dst) throw new Error("Missing connector endpoint");
        firstRouted ??= output.length;
        const a = site(src, first),
          b = site(dst, last);
        const box = {
          x: Math.min(a.point.x, b.point.x),
          y: Math.min(a.point.y, b.point.y),
          width: Math.abs(a.point.x - b.point.x),
          height: Math.abs(a.point.y - b.point.y),
        };
        const flip = `${b.point.x < a.point.x ? ' flipH="1"' : ""}${b.point.y < a.point.y ? ' flipV="1"' : ""}`;
        output.push(
          `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="${escapeXml(key)}"/><p:cNvCxnSpPr><a:stCxn id="${src.id}" idx="${a.index}"/><a:endCxn id="${dst.id}" idx="${b.index}"/></p:cNvCxnSpPr><p:nvPr/></p:nvCxnSpPr><p:spPr>${xfrm(box, flip)}<a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom>${line(path, element.style, arrows, edgeStroke)}</p:spPr></p:cxnSp>`,
        );
      } else {
        const parts = masks.length ? splitMaskedPath(geo.path, masks) : [geo.path];
        const zoom = element.routing === "zoom";
        if (!zoom) firstRouted ??= output.length;
        parts.forEach((part, index) => {
          const bounds = new BoundsBuilder().addPath(part).rect();
          if (!bounds) throw new Error(`Unbounded edge ${key}`);
          const partArrows =
            (index === 0 ? (arrows.match(/<a:headEnd[^>]*\/>/)?.[0] ?? "") : "") +
            (index === parts.length - 1 ? (arrows.match(/<a:tailEnd[^>]*\/>/)?.[0] ?? "") : "");
          (zoom ? zooms : output).push(
            shape(
              index === 0 ? id : next++,
              key,
              bounds,
              geometry([{ segments: part, filled: false }], bounds, emu),
              "<a:noFill/>",
              line(path, element.style, partArrows, edgeStroke),
            ),
          );
        });
      }
      const children = childElements(group);
      const texts = children.filter((e) => e.name === "text");
      // A glued connector cannot be interrupted; hide it on the canvas only.
      const before = children[children.indexOf(texts[0] as XmlElement) - 1];
      const background =
        before?.name === "rect"
          ? paint(property(before, "fill") ?? "#ffffff")
          : connectors === "glued" &&
              element.routing !== "zoom" &&
              !ir.meta.transparentBackground &&
              masks.length > 0
            ? paint(canvasColor)
            : "<a:noFill/>";
      geo.labels.forEach((label, i) => {
        const el = texts[i];
        if (!el) throw new Error("Missing label text");
        const b = measureLabel(label, fonts).box;
        if (!b) return;
        const box = { ...b, x: b.x - 2, width: b.width + 4 };
        labels.push(
          shape(
            next++,
            `${key} label ${i}`,
            box,
            '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>',
            background,
            "<a:ln><a:noFill/></a:ln>",
            textBody(label, el, box, element.style.opacity),
            true,
          ),
        );
      });
    }
    if (!setsEmitted) output.push(...setXml);
    const diagnostics: Diagnostic[] = [
      {
        code: "pptx/experimental-editable",
        severity: "warning",
        message:
          "Experimental editable PPTX: fonts must be installed by the viewer; exact appearance, layout after edits and YAML round-trip are not guaranteed.",
      },
    ];
    if (connectors === "glued")
      diagnostics.push({
        code: "pptx/glued-routing",
        severity: "warning",
        message:
          "Glued connectors replace ELK routes with straight lines. Edge label positions do not follow later edits.",
      });
    return {
      ok: true,
      value: editablePptx(
        [
          ...output.slice(0, firstRouted ?? output.length),
          ...zooms,
          ...output.slice(firstRouted ?? output.length),
          ...labels,
        ].join(""),
        slide.width,
        slide.height,
        metadata.value,
        connectors,
        canvasColor,
      ),
      diagnostics,
    };
  } catch (error) {
    if (
      error instanceof FontParseError ||
      (error instanceof Error &&
        "code" in error &&
        ["ENOENT", "EACCES", "EISDIR"].includes(String(error.code)))
    ) {
      return {
        ok: false,
        diagnostics: [
          {
            code: "pptx/missing-font",
            severity: "error",
            message: `Cannot read the editable figure's font: ${error.message}`,
          },
        ],
      };
    }
    return fail(error instanceof Error ? error.message : String(error));
  }
}
