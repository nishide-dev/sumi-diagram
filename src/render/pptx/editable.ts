/** Experimental DrawingML: editable objects, not a fidelity/round-trip format (#62). */

import { readFileSync } from "node:fs";
import type { EdgeIR, FigureIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";
import type { Diagnostic } from "../../core/diagnostics";
import type { Result } from "../../core/result";
import { type FontSet, getFontSet } from "../../core/theme/fonts";
import { fontFileFor, measureLabel } from "../../lint/geometry/measure";
import { FontParseError } from "../../lint/sfnt";
import { readSvgMetadata } from "../finalize";
import { BoundsBuilder, type PathSegment, type Point, parsePath, type Rect } from "../geometry";
import {
  decodeElementClass,
  inspectSvg,
  type LabelGeometry,
  type LabelRunGeometry,
} from "../inspect";
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
function geometry(
  paths: { segments: PathSegment[]; filled: boolean }[],
  box: Rect,
  emu: (n: number) => number,
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
  return `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/>${sites}<a:rect l="0" t="0" r="r" b="b"/><a:pathLst>${body}</a:pathLst></a:custGeom>`;
}
interface ObjectSite {
  id: number;
  box: Rect;
  ellipse: boolean;
}
function site(shape: ObjectSite, p: Point) {
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
  svg: string,
  ir: FigureIR,
  options: EditablePptxOptions = {},
): Result<Uint8Array> {
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
          message: `The editable PPTX cannot carry the ${node.badge !== undefined ? "badge" : node.icon !== undefined ? "icon" : "image"} of node "${node.id}" yet.`,
          ...(source !== undefined && {
            path: [
              ...source.path,
              node.badge !== undefined ? "badge" : node.icon !== undefined ? "icon" : "component",
            ],
          }),
          ...(source?.location !== undefined && { location: source.location }),
          subject: { kind: "node", id: node.id },
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
  const xfrm = (b: Rect, flip = "") =>
    `<a:xfrm${flip}><a:off x="${emu(b.x - vb.x) + dx}" y="${emu(b.y - vb.y) + dy}"/><a:ext cx="${Math.max(1, emu(b.width))}" cy="${Math.max(1, emu(b.height))}"/></a:xfrm>`;
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
    ) => {
      const width = Number(property(el, "stroke-width") ?? style.strokeWidth.units);
      if (!Number.isFinite(width) || width < 0) throw new Error("Unsupported stroke width");
      const dash = (property(el, "stroke-dasharray") ?? "")
        .split(/[ ,]+/)
        .filter(Boolean)
        .map(Number);
      if (dash.length && (dash.length % 2 !== 0 || !dash.every((n) => Number.isFinite(n) && n > 0)))
        throw new Error("Unsupported dash pattern");
      const dashXml =
        width > 0 && dash.length
          ? `<a:custDash>${Array.from({ length: dash.length / 2 }, (_, i) => `<a:ds d="${Math.max(1, Math.round(((dash[2 * i] ?? 0) / width) * 100000))}" sp="${Math.max(1, Math.round(((dash[2 * i + 1] ?? 0) / width) * 100000))}"/>`).join("")}</a:custDash>`
          : "";
      return `<a:ln w="${emu(width)}" cap="rnd">${width === 0 ? "<a:noFill/>" : paint(property(el, "stroke") ?? style.stroke, style.opacity)}${dashXml}<a:round/>${ends}</a:ln>`;
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
      const geom = ellipse
        ? '<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>'
        : primitives.length
          ? geometry(primitives.map(shapePath), box, emu)
          : '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>';
      const first = primitives[0];
      const fill = first
        ? paint(property(first, "fill") ?? element.style.fill, element.style.opacity)
        : "<a:noFill/>";
      const stroke = first ? line(first, element.style) : "<a:ln><a:noFill/></a:ln>";
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
      objectXml.set(
        element.key,
        shape(
          id,
          element.key,
          box,
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
        ) +
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
          hatchShape(element.key, group, box, element.style),
      );
      objects.set(element.key, { id, box, ellipse });
    }
    const markers = new Map(
      [...descendants(read.doc.drawing)]
        .filter((e) => e.name === "marker")
        .map((e) => [attribute(e, "id"), e]),
    );
    const ends = (edge: EdgeIR, path: XmlElement) => {
      const emit = (at: "start" | "end", type: EdgeIR["sourceArrowhead"]) => {
        if (!type || type === "none") return "";
        const mapped = {
          triangle: "triangle",
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
        return `<a:${at === "start" ? "headEnd" : "tailEnd"} type="${mapped}" w="${size(marker ? value(marker, "markerHeight") : 12)}" len="${size(marker ? value(marker, "markerWidth") : 12)}"/>`;
      };
      return emit("start", edge.sourceArrowhead) + emit("end", edge.targetArrowhead);
    };
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
      // A zoom edge (#176) is two lines between corners, not a connector
      // between sites: it stays a freeform shape in either mode.
      if (connectors === "glued" && element.routing !== "zoom") {
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
          `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="${escapeXml(key)}"/><p:cNvCxnSpPr><a:stCxn id="${src.id}" idx="${a.index}"/><a:endCxn id="${dst.id}" idx="${b.index}"/></p:cNvCxnSpPr><p:nvPr/></p:nvCxnSpPr><p:spPr>${xfrm(box, flip)}<a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom>${line(path, element.style, arrows)}</p:spPr></p:cxnSp>`,
        );
      } else {
        const bounds = new BoundsBuilder().addPath(geo.path).rect();
        if (!bounds) throw new Error(`Unbounded edge ${key}`);
        const zoom = element.routing === "zoom";
        if (!zoom) firstRouted ??= output.length;
        (zoom ? zooms : output).push(
          shape(
            id,
            key,
            bounds,
            geometry([{ segments: geo.path, filled: false }], bounds, emu),
            "<a:noFill/>",
            line(path, element.style, arrows),
          ),
        );
      }
      const children = childElements(group);
      const texts = children.filter((e) => e.name === "text");
      // The label's background is the `<rect>` the SVG draws right before its
      // text (#170, design doc §6.41): in structured SVG the color painted
      // beneath the label, in D2's the edge's `fill` (white in the built-in
      // themes; any other color is kept, where this used to write white
      // always). Without one, D2 still hides the line under the label with a
      // mask: white here, as before. Structured SVG without one (an edge
      // `fill` of `transparent`) draws nothing, so no fill.
      const before = children[children.indexOf(texts[0] as XmlElement) - 1];
      const masked = attribute(path, "mask") !== undefined;
      const background =
        before?.name === "rect"
          ? paint(property(before, "fill") ?? "#ffffff")
          : masked
            ? paint("#ffffff")
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
