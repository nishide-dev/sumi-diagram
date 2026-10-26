/**
 * SVG inspection (#11, design doc §6): extracts per-element geometry from
 * D2's SVG and maps it back to ElementKeys through the `sumi-k-*` classes.
 *
 * Coordinates are in the user units of `svg.d2-svg` (= D2 units; convert
 * with `unitsToPt` / `unitsToMm` from `./geometry`). Geometry lint rules are #13; this
 * module only extracts data and checks that every element of the IR appears
 * exactly once.
 */

import type { ElementIR, FigureIR } from "../compiler/ir";
import type { ElementKey } from "../core/check-state";
import type { Diagnostic, DiagnosticSubject } from "../core/diagnostics";
import { getProfile } from "../core/profile/builtin";
import type { Result } from "../core/result";
import {
  BoundsBuilder,
  type PathSegment,
  type Point,
  parsePath,
  type Rect,
  type Size,
  toSize,
} from "./geometry";
import { invalid, parseNumber, readD2Svg } from "./svg";
import { attribute, childElements, classList, textContent, type XmlElement } from "./xml";

export interface LabelGeometry {
  /** Text as drawn; lines of a multi-line label are joined with `\n`. */
  text: string;
  /** `x` = horizontal center (`text-anchor: middle`), `y` = baseline of the first line. */
  anchor: Point;
  /** Font size in D2 units (`font-size` in px of the SVG user space). */
  fontSizeUnits: number;
  /** Number of lines (`<tspan>` count, or 1). */
  lines: number;
  /**
   * Baseline-to-baseline distance in D2 units: the `dy` of the second and later
   * `<tspan>`s. D2 v0.9.0 writes the same value for each: its measured height
   * of the label divided by the number of lines, e.g. 18.5 for two lines of
   * 18px text. Blank leading or trailing lines add no height, so it can be
   * smaller than the font size (16 / 3 for `"\nmiddle\n"` at 16px) or 0 (a
   * label of blank lines only). For a single line, `fontSizeUnits`.
   */
  lineHeightUnits: number;
  /**
   * D2's font class without the `text` prefix: `regular` for `text`, otherwise
   * e.g. `bold`, `italic`, `mono`, `mono-bold`. Selects the TTF to re-measure with (#13).
   */
  font: string;
  /**
   * The runs of each line, for labels drawn with nested `<tspan>`s (#93:
   * label math in structured figures). Absent for labels whose lines are
   * plain text in `font` (every D2 label).
   */
  runs?: LabelRunGeometry[][];
}

/** A run of a label line: text drawn in one font class, size and baseline. */
export interface LabelRunGeometry {
  text: string;
  /** Font class, like `LabelGeometry.font` (`regular`, `math`, `math-italic`, …). */
  font: string;
  fontSizeUnits: number;
  /** Baseline offset from the line's baseline in D2 units, positive down. */
  shiftUnits: number;
}

export interface ElementGeometry {
  key: ElementKey;
  kind: "node" | "group" | "edge";
  /**
   * Node / group: bounding box of the shape itself (`g.shape`), stroke
   * excluded. Undefined for `text`-shaped nodes, which D2 draws without a shape.
   */
  bbox?: Rect;
  labels: LabelGeometry[];
  /** Edge: `path.connection` as absolute M/L/C segments. */
  path?: PathSegment[];
}

/** Physical limits of the figure's profile, unquantized, for the geometry lint (#13). */
export interface ProfileLimits {
  id: string;
  maxWidthPt?: number;
  maxHeightPt?: number;
  minFontSizePt: number;
}

export interface SvgInspection {
  canvas: {
    /**
     * The whole output (margin included) in the coordinates of the element
     * geometry: the viewBox of `svg.d2-svg`, whose size equals the root viewBox.
     */
    viewBox: Rect;
    width: Size;
    height: Size;
  };
  profile: ProfileLimits;
  /** One entry per IR element, in IR order (groups, nodes, edges). */
  elements: ElementGeometry[];
}

const ELEMENT_CLASS = /^sumi-k-([nge])--(.+)$/;
const ID = /^[a-z][a-z0-9_-]{0,63}$/;

/**
 * Decodes a `sumi-k-*` class back to its ElementKey (inverse of
 * `elementClass`, design doc §2.4): `sumi-k-n--api` → `n:api`,
 * `sumi-k-e--_3` → `e:#3`. Returns `undefined` for anything else.
 */
export function decodeElementClass(className: string): ElementKey | undefined {
  const match = ELEMENT_CLASS.exec(className);
  if (match === null) return undefined;
  const [, kind = "", rest = ""] = match;
  if (kind === "e" && /^_\d+$/.test(rest)) return `e:#${rest.slice(1)}`;
  return ID.test(rest) ? (`${kind}:${rest}` as ElementKey) : undefined;
}

function subjectOf(element: ElementIR): DiagnosticSubject {
  if (element.kind === "edge") {
    return { kind: "edge", id: element.id ?? `edges[${element.index}]` };
  }
  return { kind: element.kind, id: element.id };
}

function unsupported(message: string): Diagnostic {
  return { code: "svg/unsupported-geometry", severity: "error", message };
}

/** Collects the extent of a shape's drawing elements; reports anything it cannot measure exactly. */
function addShape(bounds: BoundsBuilder, shape: XmlElement, problems: string[]): void {
  for (const child of childElements(shape)) {
    if (attribute(child, "transform") !== undefined) {
      problems.push(`<${child.name}> has a transform`);
      continue;
    }
    const num = (name: string): number | undefined => parseNumber(attribute(child, name));
    const need = (...names: string[]): number[] | undefined => {
      const values = names.map(num);
      if (values.some((v) => v === undefined)) {
        problems.push(`<${child.name}> lacks a numeric ${names.join("/")}`);
        return undefined;
      }
      return values as number[];
    };
    switch (child.name) {
      case "g":
        addShape(bounds, child, problems);
        break;
      case "rect": {
        const v = need("x", "y", "width", "height");
        if (v) bounds.addRect({ x: v[0] ?? 0, y: v[1] ?? 0, width: v[2] ?? 0, height: v[3] ?? 0 });
        break;
      }
      case "ellipse":
      case "circle": {
        const v =
          child.name === "circle" ? need("cx", "cy", "r", "r") : need("cx", "cy", "rx", "ry");
        if (v) {
          const [cx = 0, cy = 0, rx = 0, ry = 0] = v;
          bounds.addRect({ x: cx - rx, y: cy - ry, width: 2 * rx, height: 2 * ry });
        }
        break;
      }
      case "line": {
        const v = need("x1", "y1", "x2", "y2");
        if (v) bounds.add({ x: v[0] ?? 0, y: v[1] ?? 0 }).add({ x: v[2] ?? 0, y: v[3] ?? 0 });
        break;
      }
      case "polygon":
      case "polyline": {
        const coords = (attribute(child, "points") ?? "")
          .trim()
          .split(/[ \t\r\n,]+/)
          .map(parseNumber);
        if (coords.length < 2 || coords.length % 2 !== 0 || coords.some((c) => c === undefined)) {
          problems.push(`<${child.name}> has invalid points`);
          break;
        }
        for (let i = 0; i < coords.length; i += 2) {
          bounds.add({ x: coords[i] as number, y: coords[i + 1] as number });
        }
        break;
      }
      case "path": {
        const parsed = parsePath(attribute(child, "d") ?? "");
        if (parsed.ok) bounds.addPath(parsed.segments);
        else problems.push(`<path>: ${parsed.message}`);
        break;
      }
      default:
        problems.push(`unsupported shape element <${child.name}>`);
    }
  }
}

const FONT_SIZE_PX = /(?:^|;)\s*font-size\s*:\s*([\d.]+)px\s*(?:;|$)/;

/** The font class of an element without the `text` prefix, or `undefined` if it has none. */
function fontClassOf(element: XmlElement): string | undefined {
  const fontClass = classList(element).find((c) => c === "text" || c.startsWith("text-"));
  return fontClass === undefined
    ? undefined
    : fontClass === "text"
      ? "regular"
      : fontClass.slice(5);
}

/** Reads a `<text>` label. Returns a problem description on failure. */
function readLabel(text: XmlElement): LabelGeometry | string {
  if (attribute(text, "transform") !== undefined) return "<text> has a transform";
  const x = parseNumber(attribute(text, "x"));
  const y = parseNumber(attribute(text, "y"));
  if (x === undefined || y === undefined) return "<text> lacks a numeric x/y";
  const style = attribute(text, "style") ?? "";
  const fontSize = FONT_SIZE_PX.exec(style)?.[1] ?? attribute(text, "font-size");
  const fontSizeUnits = parseNumber(fontSize);
  if (fontSizeUnits === undefined) return "<text> has no font-size in px";
  if (!/(?:^|;)\s*text-anchor\s*:\s*middle\s*(?:;|$)/.test(style)) {
    return "<text> is not centered (text-anchor: middle)";
  }
  const font = fontClassOf(text) ?? "regular";
  const tspans = childElements(text).filter((c) => c.name === "tspan");
  // `pen` follows the baseline through every dy (lines and runs alike); a
  // line's baseline is where its own dy puts the pen, or its absolute `y`
  // (#93: lines of labels with runs carry their baseline as `y`).
  let pen = 0;
  const baselines: number[] = [];
  const runs: LabelRunGeometry[][] = [];
  let rich = false;
  for (const [i, tspan] of tspans.entries()) {
    const dy = attribute(tspan, "dy");
    const tspanY = attribute(tspan, "y");
    const tspanX = attribute(tspan, "x");
    if (tspanX !== undefined && parseNumber(tspanX) !== x) {
      return `<tspan> has x "${tspanX}" different from its <text>`;
    }
    if (tspanY !== undefined) {
      const absolute = parseNumber(tspanY);
      if (absolute === undefined || dy !== undefined || (i === 0 && absolute !== y)) {
        return `<tspan> has an unsupported y "${tspanY}"`;
      }
      pen = absolute - y;
    } else {
      const value = parseNumber(dy ?? "0");
      if (value === undefined || (i === 0 && value !== 0)) {
        return `<tspan> has an unsupported dy "${dy}"`;
      }
      pen += value;
    }
    const baseline = pen;
    baselines.push(baseline);
    const line: LabelRunGeometry[] = [];
    for (const child of tspan.children) {
      if (child.type === "text") {
        if (child.text !== "") {
          line.push({ text: child.text, font, fontSizeUnits, shiftUnits: pen - baseline });
        }
        continue;
      }
      rich = true;
      const run = readRun(child, font, fontSizeUnits);
      if (typeof run === "string") return run;
      pen += run.dy;
      line.push({ ...run.geometry, shiftUnits: pen - baseline });
    }
    runs.push(line);
  }
  // Lines advance by equal steps; later lines may advance by 0 (D2 does so
  // for labels of blank lines only), never backwards.
  let lineHeightUnits = fontSizeUnits;
  for (let i = 1; i < baselines.length; i++) {
    const step = (baselines[i] as number) - (baselines[i - 1] as number);
    if (step < 0) return "a label line <tspan> moves the baseline backwards (dy or y)";
    if (i === 1) lineHeightUnits = step;
    else if (Math.abs(step - lineHeightUnits) > 1e-6) return "<tspan>s have different line heights";
  }
  return {
    text: tspans.length > 0 ? tspans.map(textContent).join("\n") : textContent(text),
    anchor: { x, y },
    fontSizeUnits,
    lines: Math.max(tspans.length, 1),
    lineHeightUnits,
    font,
    ...(rich && { runs }),
  };
}

/** Reads a run `<tspan>` inside a line (#93): text only, with optional font class, font-size and dy. */
function readRun(
  tspan: XmlElement,
  font: string,
  fontSizeUnits: number,
): { geometry: Omit<LabelRunGeometry, "shiftUnits">; dy: number } | string {
  if (tspan.name !== "tspan") return `<${tspan.name}> inside a label line`;
  for (const { name } of tspan.attributes) {
    if (!["class", "style", "dy"].includes(name)) return `a run <tspan> has the attribute ${name}`;
  }
  if (childElements(tspan).length > 0) return "a run <tspan> has nested elements";
  const style = attribute(tspan, "style");
  let size = fontSizeUnits;
  if (style !== undefined) {
    const px = parseNumber(FONT_SIZE_PX.exec(style)?.[1]);
    if (px === undefined || style.replace(FONT_SIZE_PX, "").trim() !== "") {
      return `a run <tspan> has an unsupported style "${style}"`;
    }
    size = px;
  }
  const dyText = attribute(tspan, "dy");
  const dy = parseNumber(dyText ?? "0");
  if (dy === undefined) return `a run <tspan> has an unsupported dy "${dyText}"`;
  return {
    geometry: { text: textContent(tspan), font: fontClassOf(tspan) ?? font, fontSizeUnits: size },
    dy,
  };
}

/** Finds `<g>` elements with a `sumi-k-*` class; reports those under a transform. */
function findElementGroups(
  drawing: XmlElement,
  problems: Diagnostic[],
): { group: XmlElement; classes: string[] }[] {
  const found: { group: XmlElement; classes: string[] }[] = [];
  const stack: { element: XmlElement; transformed: boolean }[] = childElements(drawing)
    .reverse()
    .map((element) => ({ element, transformed: false }));
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    const { element } = item;
    const transformed = item.transformed || attribute(element, "transform") !== undefined;
    const classes = classList(element);
    if (element.name === "g" && classes.some((c) => c.startsWith("sumi-k-"))) {
      if (transformed) {
        problems.push(unsupported(`Element group "${classes.join(" ")}" is under a transform.`));
      }
      found.push({ group: element, classes });
      continue; // Sumi elements are never nested inside one another in D2's SVG.
    }
    for (const child of childElements(element).reverse())
      stack.push({ element: child, transformed });
  }
  return found;
}

/**
 * Extracts the geometry of every element of `ir` from a (raw or finalized)
 * D2 SVG. Errors: `svg/invalid` / `svg/empty` for unreadable output,
 * `svg/missing-element` / `svg/duplicate-element` / `svg/unknown-element`
 * when the `sumi-k-*` classes do not match the IR one to one, and
 * `svg/unsupported-geometry` for drawing constructs that cannot be measured
 * exactly (arcs, transforms, unknown shape elements).
 */
export function inspectSvg(svg: string, ir: FigureIR): Result<SvgInspection> {
  const read = readD2Svg(svg);
  if (!read.ok) return { ok: false, diagnostics: [read.diagnostic] };
  const { drawingViewBox: viewBox, drawing, root } = read.doc;
  const diagnostics: Diagnostic[] = [];

  // Every coordinate is read in the drawing's user space, so nothing above it may move it.
  for (const svgElement of [root, drawing]) {
    const where = svgElement === root ? "root <svg>" : 'D2 drawing <svg class="d2-svg">';
    if (attribute(svgElement, "transform") !== undefined) {
      diagnostics.push(unsupported(`The ${where} has a transform.`));
    }
  }
  for (const name of ["x", "y"]) {
    const value = attribute(drawing, name);
    if (value !== undefined && parseNumber(value) !== 0) {
      diagnostics.push(unsupported(`The D2 drawing <svg> is offset (${name}="${value}").`));
    }
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics };

  const groupsByKey = new Map<ElementKey, XmlElement[]>();
  for (const { group, classes } of findElementGroups(drawing, diagnostics)) {
    const encoded = classes.filter((c) => c.startsWith("sumi-k-"));
    const keys = encoded.map(decodeElementClass);
    const key = keys[0];
    const element = key === undefined ? undefined : ir.elements.get(key);
    if (keys.length !== 1 || key === undefined || element === undefined) {
      diagnostics.push({
        code: "svg/unknown-element",
        severity: "error",
        message: `The SVG has an element "${encoded.join(" ")}" that is not in the figure.`,
      });
      continue;
    }
    if (!classes.includes(`sumi-kind-${element.kind}`)) {
      diagnostics.push({
        code: "svg/unknown-element",
        severity: "error",
        message: `The SVG element for ${element.kind} "${subjectOf(element).id}" lacks the class "sumi-kind-${element.kind}".`,
        subject: subjectOf(element),
      });
      continue;
    }
    groupsByKey.set(key, [...(groupsByKey.get(key) ?? []), group]);
  }

  const elements: ElementGeometry[] = [];
  for (const element of [...ir.groups, ...ir.nodes, ...ir.edges]) {
    const subject = subjectOf(element);
    const source = ir.sourceMap.get(element.key);
    const located = {
      subject,
      ...(source !== undefined && { path: [...source.path] }),
      ...(source?.location !== undefined && { location: source.location }),
    };
    const found = groupsByKey.get(element.key) ?? [];
    if (found.length !== 1) {
      diagnostics.push({
        code: found.length === 0 ? "svg/missing-element" : "svg/duplicate-element",
        severity: "error",
        message:
          found.length === 0
            ? `The ${element.kind} "${subject.id}" does not appear in the SVG.`
            : `The ${element.kind} "${subject.id}" appears ${found.length} times in the SVG.`,
        ...located,
      });
      continue;
    }
    const group = found[0] as XmlElement;
    const problems: string[] = [];
    const geometry: ElementGeometry = { key: element.key, kind: element.kind, labels: [] };
    const children = childElements(group);

    for (const text of children.filter((c) => c.name === "text")) {
      const label = readLabel(text);
      if (typeof label === "string") problems.push(label);
      else geometry.labels.push(label);
    }

    if (element.kind === "edge") {
      const paths = children.filter(
        (c) => c.name === "path" && classList(c).includes("connection"),
      );
      if (paths.length !== 1) {
        diagnostics.push({
          ...invalid(`Edge "${subject.id}" has ${paths.length} connection paths; expected one.`),
          ...located,
        });
        continue;
      }
      const connection = paths[0] as XmlElement;
      if (attribute(connection, "transform") !== undefined) {
        problems.push("the connection path has a transform");
      }
      const parsed = parsePath(attribute(connection, "d") ?? "");
      if (parsed.ok) geometry.path = parsed.segments;
      else problems.push(`connection path: ${parsed.message}`);
    } else {
      const shapes = children.filter((c) => c.name === "g" && classList(c).includes("shape"));
      if (shapes.length !== 1) {
        diagnostics.push({
          ...invalid(
            `The ${element.kind} "${subject.id}" has ${shapes.length} shape groups; expected one.`,
          ),
          ...located,
        });
        continue;
      }
      const shape = shapes[0] as XmlElement;
      if (attribute(shape, "transform") !== undefined) {
        problems.push("the shape group has a transform");
      }
      const bounds = new BoundsBuilder();
      addShape(bounds, shape, problems);
      const bbox = bounds.rect();
      if (bbox !== undefined && !Object.values(bbox).every(Number.isFinite)) {
        problems.push("the shape's extent is not finite");
      } else if (bbox !== undefined) geometry.bbox = bbox;
      else if (!(element.kind === "node" && element.shape === "text")) {
        problems.push("the shape group draws nothing");
      }
    }

    if (problems.length > 0) {
      diagnostics.push({
        ...unsupported(
          `Cannot read the geometry of ${element.kind} "${subject.id}": ${problems.map((p) => p.replace(/\.$/, "")).join("; ")}.`,
        ),
        ...located,
      });
      continue;
    }
    elements.push(geometry);
  }

  if (diagnostics.length > 0) return { ok: false, diagnostics };
  const profile = getProfile(ir.meta.profileId);
  if (profile === undefined)
    throw new Error(`internal error: unknown profile ${ir.meta.profileId}`);
  return {
    ok: true,
    value: {
      canvas: { viewBox, width: toSize(viewBox.width), height: toSize(viewBox.height) },
      profile: {
        id: profile.id,
        ...(profile.page.maxWidth !== undefined && { maxWidthPt: profile.page.maxWidth.pt }),
        ...(profile.page.maxHeight !== undefined && { maxHeightPt: profile.page.maxHeight.pt }),
        minFontSizePt: profile.typography.minFontSize.pt,
      },
      elements,
    },
    diagnostics: [],
  };
}
