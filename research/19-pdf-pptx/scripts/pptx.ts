/**
 * #19 research: two PPTX PoCs per figure (run render-inputs.ts and pdf.ts first;
 * the PNG fallback is pdf.ts's Chrome reference raster), written as OOXML by
 * hand with a deterministic zip — no dependency.
 *
 *   out/pptx/<id>.image.pptx   (a) one picture: the SVG (asvg:svgBlip) with a PNG fallback
 *   out/pptx/<id>.native.pptx  (b) native DrawingML from the SVG geometry + IR:
 *                                  one shape per node / group (preset rect / ellipse,
 *                                  otherwise an exact freeform), text in the shape,
 *                                  one connector per edge glued to its end shapes,
 *                                  arrowheads / dashes as line properties,
 *                                  edge labels as text boxes
 *
 *   bun research/19-pdf-pptx/scripts/pptx.ts
 *
 * Slide size = the figure's pt size; 1 D2 unit = 0.5pt = 6350 EMU.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { compileFigure } from "../../../src/compiler";
import type { ElementKey } from "../../../src/core/check-state";
import { BUILTIN_FONT_SETS, DEFAULT_FONT_SET_ID } from "../../../src/core/theme/fonts";
import { measureLabel } from "../../../src/lint/geometry/measure";
import {
  decodeElementClass,
  type LabelGeometry,
  type PathSegment,
  parsePath,
  readD2Svg,
  type SvgInspection,
} from "../../../src/render";
import { attribute, childElements, classList, type XmlElement } from "../../../src/render/xml";
import { figureId, INPUTS } from "./lib/inputs";
import { escapeXml, FONT, NS, presentation } from "./lib/ooxml";
import { zip } from "./lib/zip";

const HERE = resolve(import.meta.dir, "..");
const ROOT = resolve(HERE, "..", "..");
const SVG_DIR = join(HERE, "out", "svg");
const OUT = join(HERE, "out", "pptx");
const EMU_PER_UNIT = 6350;
const fontSet = BUILTIN_FONT_SETS.get(DEFAULT_FONT_SET_ID);
if (fontSet === undefined) throw new Error("font set");

const style = (el: XmlElement, prop: string): string | undefined =>
  new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(attribute(el, "style") ?? "")?.[1]?.trim();

/** `#rrggbb` → `<a:solidFill>`; `transparent` / `none` → `<a:noFill/>`. */
function fill(color: string | undefined): string {
  if (color === undefined || color === "none" || color === "transparent") return "<a:noFill/>";
  const hex = /^#([0-9a-fA-F]{6})$/.exec(color)?.[1];
  if (hex === undefined) throw new Error(`unsupported color ${color}`);
  return `<a:solidFill><a:srgbClr val="${hex.toUpperCase()}"/></a:solidFill>`;
}

function line(el: XmlElement, ends = ""): string {
  const width = Number(style(el, "stroke-width") ?? attribute(el, "stroke-width") ?? 1);
  const dash = style(el, "stroke-dasharray")
    ?.split(/[ ,]+/)
    .map(Number)
    .filter((n) => n > 0);
  // custDash lengths are in 1/1000 % of the line width.
  const dashXml =
    dash !== undefined && dash.length >= 2
      ? `<a:custDash><a:ds d="${Math.round((dash[0] ?? 0) / width) * 100000}" sp="${Math.round((dash[1] ?? 0) / width) * 100000}"/></a:custDash>`
      : "";
  return `<a:ln w="${Math.round(width * EMU_PER_UNIT)}" cap="rnd">${fill(attribute(el, "stroke"))}${dashXml}<a:round/>${ends}</a:ln>`;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Freeform from SVG paths (absolute M/L/C), relative to `box`, in EMU. */
const SITES =
  '<a:cxnLst><a:cxn ang="3cd4"><a:pos x="hc" y="t"/></a:cxn><a:cxn ang="cd2"><a:pos x="l" y="vc"/></a:cxn><a:cxn ang="cd4"><a:pos x="hc" y="b"/></a:cxn><a:cxn ang="0"><a:pos x="r" y="vc"/></a:cxn></a:cxnLst>';

function custGeom(paths: { d: string; filled: boolean }[], box: Box): string {
  const pt = (p: { x: number; y: number }) =>
    `<a:pt x="${Math.round((p.x - box.x) * EMU_PER_UNIT)}" y="${Math.round((p.y - box.y) * EMU_PER_UNIT)}"/>`;
  const w = Math.max(1, Math.round(box.w * EMU_PER_UNIT));
  const h = Math.max(1, Math.round(box.h * EMU_PER_UNIT));
  const body = paths
    .map(({ d, filled }) => {
      const parsed = parsePath(d);
      if (!parsed.ok) throw new Error(parsed.message);
      const cmds = parsed.segments
        .map((s: PathSegment) =>
          s.command === "M"
            ? `<a:moveTo>${pt(s.to)}</a:moveTo>`
            : s.command === "L"
              ? `<a:lnTo>${pt(s.to)}</a:lnTo>`
              : `<a:cubicBezTo>${pt(s.c1)}${pt(s.c2)}${pt(s.to)}</a:cubicBezTo>`,
        )
        .join("");
      const close = /[Zz]\s*$/.test(d) ? "<a:close/>" : "";
      return `<a:path w="${w}" h="${h}"${filled ? "" : ' fill="none"'}>${cmds}${close}</a:path>`;
    })
    .join("");
  return `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/>${paths.some((p) => p.filled) ? SITES : "<a:cxnLst/>"}<a:rect l="0" t="0" r="r" b="b"/><a:pathLst>${body}</a:pathLst></a:custGeom>`;
}

const xfrm = (b: Box) =>
  `<a:xfrm><a:off x="${Math.round(b.x * EMU_PER_UNIT)}" y="${Math.round(b.y * EMU_PER_UNIT)}"/><a:ext cx="${Math.max(1, Math.round(b.w * EMU_PER_UNIT))}" cy="${Math.max(1, Math.round(b.h * EMU_PER_UNIT))}"/></a:xfrm>`;

/**
 * Text body that puts the label where the SVG has it: `wrap="none"`, top
 * anchored, insets so the first line's box (Sumi's measurement: baseline −
 * hhea ascent) starts at the same y and the lines are centered on the anchor x.
 */
function txBody(label: LabelGeometry, textEl: XmlElement, box: Box): string {
  const m = measureLabel(label, fontSet as NonNullable<typeof fontSet>);
  const first = m.lines[0];
  const top = first === undefined ? 0 : first.y - box.y;
  const dx = label.anchor.x - (box.x + box.w / 2);
  const emu = (u: number) => Math.round(Math.max(0, u) * EMU_PER_UNIT);
  const sizePt = label.fontSizeUnits * 0.5;
  const bold = classList(textEl).includes("text-bold") ? ' b="1"' : "";
  const color = fill(attribute(textEl, "fill") ?? "#000000");
  const spacing = `<a:lnSpc><a:spcPts val="${Math.round(label.lineHeightUnits * 0.5 * 100)}"/></a:lnSpc>`;
  const paras = m.texts
    .map(
      (t) =>
        `<a:p><a:pPr algn="ctr">${spacing}</a:pPr><a:r><a:rPr lang="ja-JP" sz="${Math.round(sizePt * 100)}"${bold} dirty="0">${color}<a:latin typeface="${FONT}"/><a:ea typeface="${FONT}"/></a:rPr><a:t>${escapeXml(t)}</a:t></a:r></a:p>`,
    )
    .join("");
  return `<p:txBody><a:bodyPr wrap="none" lIns="${emu(2 * dx)}" rIns="${emu(-2 * dx)}" tIns="${emu(top)}" bIns="0" anchor="t" rtlCol="0"><a:noAutofit/></a:bodyPr><a:lstStyle/>${paras}</p:txBody>`;
}

const emptyTx = `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="ja-JP"/></a:p></p:txBody>`;

type EdgeMode = "freeform" | "connector";

interface PlacedShape {
  id: number;
  box: Box;
  preset: "rect" | "ellipse" | "freeform";
}

/**
 * Connection site nearest to `p`: rect / freeform (cxnLst below) 0 top,
 * 1 left, 2 bottom, 3 right; preset ellipse has 8 sites, counter-clockwise from the top.
 */
function site(shape: PlacedShape, p: { x: number; y: number }): number {
  const { x, y, w, h } = shape.box;
  const d = [
    Math.abs(p.y - y),
    Math.abs(p.x - x),
    Math.abs(p.y - (y + h)),
    Math.abs(p.x - (x + w)),
  ];
  const side = d.indexOf(Math.min(...d));
  return shape.preset === "ellipse" ? side * 2 : side;
}

function nativeSlide(
  svg: string,
  inspection: SvgInspection,
  edges: Map<ElementKey, { from: ElementKey; to: ElementKey }>,
  edgeMode: EdgeMode,
) {
  const doc = readD2Svg(svg);
  if (!doc.ok) throw new Error(doc.diagnostic.message);
  const vb = doc.doc.drawingViewBox;
  const geometry = new Map(inspection.elements.map((e) => [e.key, e]));
  const shapeBoxes = new Map<ElementKey, PlacedShape>();
  let nextId = 2;
  const shapes: string[] = [];
  const edgeLabels: string[] = [];
  const at = (b: Box): Box => ({ ...b, x: b.x - vb.x, y: b.y - vb.y });

  for (const g of childElements(doc.doc.drawing).filter((e) => e.name === "g")) {
    const key = classList(g)
      .map(decodeElementClass)
      .find((k) => k !== undefined);
    if (key === undefined) continue;
    const geo = geometry.get(key);
    if (geo === undefined) continue;
    const texts = childElements(g).filter((e) => e.name === "text");
    const name = escapeXml(key);

    if (geo.kind === "edge") {
      const path = childElements(g).find(
        (e) => e.name === "path" && classList(e).includes("connection"),
      );
      if (path === undefined || geo.path === undefined) continue;
      // SVG markers → DrawingML line ends (head = path start, tail = path end).
      const ends = `${attribute(path, "marker-start") ? '<a:headEnd type="triangle" w="med" len="med"/>' : ""}${attribute(path, "marker-end") ? '<a:tailEnd type="triangle" w="med" len="med"/>' : ""}`;
      const sid = nextId++;
      const d = attribute(path, "d") ?? "";
      const rel = edges.get(key);
      const first = geo.path[0]?.to;
      const last = geo.path.at(-1)?.to;
      const src = rel && shapeBoxes.get(rel.from);
      const dst = rel && shapeBoxes.get(rel.to);
      if (edgeMode === "connector" && first && last) {
        // (b2) A glued straight connector: PowerPoint has no freeform
        // connectors (custGeom in p:cxnSp makes it drop the slide content), so
        // the ELK route is lost; moving a node re-routes the connector.
        const glue = `${src ? `<a:stCxn id="${src.id}" idx="${site(src, first)}"/>` : ""}${dst ? `<a:endCxn id="${dst.id}" idx="${site(dst, last)}"/>` : ""}`;
        const box = {
          x: Math.min(first.x, last.x),
          y: Math.min(first.y, last.y),
          w: Math.abs(last.x - first.x),
          h: Math.abs(last.y - first.y),
        };
        const flip = `${last.x < first.x ? ' flipH="1"' : ""}${last.y < first.y ? ' flipV="1"' : ""}`;
        shapes.push(
          `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${sid}" name="${name}"/><p:cNvCxnSpPr>${glue}</p:cNvCxnSpPr><p:nvPr/></p:nvCxnSpPr><p:spPr>${xfrm(at(box)).replace("<a:xfrm>", `<a:xfrm${flip}>`)}<a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom>${line(path, ends)}</p:spPr></p:cxnSp>`,
        );
      } else {
        // (b1) The exact route as an open freeform: editable points, not glued.
        const pts = geo.path.flatMap((s) => (s.command === "C" ? [s.c1, s.c2, s.to] : [s.to]));
        const xs = pts.map((p) => p.x);
        const ys = pts.map((p) => p.y);
        const box = {
          x: Math.min(...xs),
          y: Math.min(...ys),
          w: Math.max(...xs) - Math.min(...xs),
          h: Math.max(...ys) - Math.min(...ys),
        };
        shapes.push(
          `<p:sp><p:nvSpPr><p:cNvPr id="${sid}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(at(box))}${custGeom([{ d, filled: false }], box)}${line(path, ends)}</p:spPr></p:sp>`,
        );
      }
      geo.labels.forEach((label, i) => {
        const textEl = texts[i];
        if (textEl === undefined) return;
        const m = measureLabel(label, fontSet as NonNullable<typeof fontSet>);
        if (m.box === undefined) return;
        // The SVG masks the line behind the label; a white text box does the same.
        const b = { x: m.box.x - 2, y: m.box.y, w: m.box.width + 4, h: m.box.height };
        edgeLabels.push(
          `<p:sp><p:nvSpPr><p:cNvPr id="${nextId++}" name="${name} label"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(at(b))}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr>${txBody(label, textEl, b)}</p:sp>`,
        );
      });
      continue;
    }

    // Node / group: the shapes in g.shape.
    const shapeEls = childElements(
      childElements(g).find((e) => classList(e).includes("shape")) ?? g,
    ).filter((e) => ["rect", "ellipse", "path", "circle", "polygon"].includes(e.name));
    const bbox = geo.bbox;
    const label = geo.labels[0];
    const textEl = texts[0];
    const sid = nextId++;

    if (bbox === undefined || shapeEls.length === 0) {
      // sumi/label: text only.
      if (label === undefined || textEl === undefined) continue;
      const m = measureLabel(label, fontSet as NonNullable<typeof fontSet>);
      if (m.box === undefined) continue;
      const b = { x: m.box.x, y: m.box.y, w: m.box.width, h: m.box.height };
      shapeBoxes.set(key, { id: sid, box: b, preset: "rect" });
      shapes.push(
        `<p:sp><p:nvSpPr><p:cNvPr id="${sid}" name="${name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(at(b))}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>${txBody(label, textEl, b)}</p:sp>`,
      );
      continue;
    }
    const b = { x: bbox.x, y: bbox.y, w: bbox.width, h: bbox.height };
    const first = shapeEls[0] as XmlElement;
    const geom =
      shapeEls.length === 1 && first.name === "rect"
        ? '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'
        : shapeEls.length === 1 && (first.name === "ellipse" || first.name === "circle")
          ? '<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>'
          : custGeom(
              shapeEls.map((e) => ({ d: attribute(e, "d") ?? "", filled: true })),
              b,
            );
    shapeBoxes.set(key, {
      id: sid,
      box: b,
      preset: geom.includes('"ellipse"')
        ? "ellipse"
        : geom.includes('"rect"')
          ? "rect"
          : "freeform",
    });
    const body = label !== undefined && textEl !== undefined ? txBody(label, textEl, b) : emptyTx;
    shapes.push(
      `<p:sp><p:nvSpPr><p:cNvPr id="${sid}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(at(b))}${geom}${fill(attribute(first, "fill"))}${line(first)}</p:spPr>${body}</p:sp>`,
    );
  }
  return [...shapes, ...edgeLabels].join("");
}

function imageSlide(cx: number, cy: number) {
  return `<p:pic><p:nvPicPr><p:cNvPr id="2" name="Sumi figure" descr="Sumi figure"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"><a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"><asvg:svgBlip xmlns:asvg="${NS.asvg}" r:embed="rId3"/></a:ext></a:extLst></a:blip><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

mkdirSync(OUT, { recursive: true });
for (const input of INPUTS) {
  const id = figureId(input);
  const compiled = compileFigure(readFileSync(join(ROOT, input), "utf8"), { file: input });
  if (!compiled.ok) throw new Error(`compile ${input}`);
  const edges = new Map(compiled.value.ir.edges.map((e) => [e.key, { from: e.from, to: e.to }]));
  const svg = readFileSync(join(SVG_DIR, `${id}.svg`), "utf8");
  const inspection: SvgInspection = JSON.parse(
    readFileSync(join(SVG_DIR, `${id}.inspection.json`), "utf8"),
  );
  const cx = Math.round(inspection.canvas.width.pt * 12700);
  const cy = Math.round(inspection.canvas.height.pt * 12700);

  const png = readFileSync(join(HERE, "out", "pdf", `${id}.reference.png`));
  const image = zip(
    presentation({
      cx,
      cy,
      shapes: imageSlide(cx, cy),
      media: [
        { rId: "rId2", name: "image1.png", data: png },
        { rId: "rId3", name: "image2.svg", data: svg },
      ],
    }),
  );
  writeFileSync(join(OUT, `${id}.image.pptx`), image);

  const sizes = [`image ${image.length}B`];
  for (const [mode, suffix] of [
    ["freeform", "native"],
    ["connector", "native-glued"],
  ] as const) {
    const pptx = zip(
      presentation({ cx, cy, shapes: nativeSlide(svg, inspection, edges, mode), media: [] }),
    );
    writeFileSync(join(OUT, `${id}.${suffix}.pptx`), pptx);
    sizes.push(`${suffix} ${pptx.length}B`);
  }
  console.log(`${id}: ${sizes.join(", ")}`);
}
