/**
 * The allow-list importer for external SVG (#94, design doc §6.25; research
 * #86 §6.2–§6.3, following #18 §5.5): bundled icons and user SVG images both
 * pass through here before anything of them reaches Sumi's output.
 *
 * - Parsed with Sumi's strict XML parser (`src/render/xml.ts`): document type
 *   declarations (DTD), entities other than the predefined ones, and
 *   processing instructions (`<?xml-stylesheet?>`) are rejected.
 * - Elements and attributes are checked against allow-lists. Anything that
 *   could run code or reach outside the file is an `unsafe` issue with its
 *   line and column: `script`, `foreignObject`, `style`, `image`, `use`, `a`,
 *   `iframe` / `object` / `embed`, animations, event attributes (`on*`),
 *   `href` / `src` in any namespace, and `url(` / `javascript:` in any value.
 *   Other elements and attributes Sumi does not draw (gradients, `defs`,
 *   `text`, filters, …) are `unsupported` issues, so nothing is dropped
 *   silently. Only non-rendering metadata (`title`, `desc`, `metadata`,
 *   editor namespaces) and inert attributes (`id`, `class`, `xmlns*`, …) are
 *   skipped.
 * - The result is **re-serialized** from the parsed values: the input text is
 *   never copied to the output, and every value written has passed a strict
 *   pattern (numbers, path data, colors, transforms).
 *
 * The engines would drop some of these constructs on their own (external
 * references and `foreignObject` vanish silently in the PDF engine, research
 * #86 §6.1); Sumi reports them instead of relying on that.
 */

import { childElements, escapeAttribute, parseXml, position, type XmlElement } from "../render/xml";

export type SvgIssueKind = "unsafe" | "unsupported" | "invalid";

export interface SvgImportIssue {
  kind: SvgIssueKind;
  /** One English sentence. */
  message: string;
  /** 1-based position in the SVG text. */
  line: number;
  column: number;
}

export interface ImportedSvg {
  /** `[minX, minY, width, height]` of the root's viewBox (or `0 0 width height`). */
  viewBox: readonly [number, number, number, number];
  /** Intrinsic size in CSS px: the root's `width` / `height`, else the viewBox size. */
  width: number;
  height: number;
  /**
   * The drawing as one `<g>` (the root's paint attributes on it) holding the
   * re-serialized shapes, in viewBox coordinates.
   */
  markup: string;
}

export type SvgImportResult =
  | { ok: true; value: ImportedSvg }
  | { ok: false; issues: SvgImportIssue[] };

export interface SvgImportOptions {
  /** Replaces `currentColor` in paint values (icons take the node's text color). */
  currentColor?: string;
  /** Leaves out shapes whose own `fill` and `stroke` are both `none` (Tabler's sizing frame). */
  dropInvisible?: boolean;
}

/** Limits that keep the re-serialized drawing well inside the PDF engine's input limits. */
export const SVG_IMPORT_LIMITS = Object.freeze({ maxElements: 20_000, maxDepth: 32 });

// Patterns are written so that no input can make them backtrack more than
// linearly (the SVG may be large): no nested or adjacent overlapping quantifiers.
const NUM = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?`;
const NUMBER = new RegExp(`^${NUM}$`);
const LENGTH = new RegExp(`^${NUM}(?:px)?$`);
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]*$/;
const COLOR =
  /^(?:none|transparent|currentcolor|#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}|rgba?\([0-9.%\s,]+\)|[a-z]+)$/i;
const OPACITY = new RegExp(`^${NUM}%?$`);
const TRANSFORM_STEP =
  /\s*(?:matrix|translate|scale|rotate|skewX|skewY)\s*\([0-9eE.,+\-\s]*\)\s*,?/y;

/** A whitespace- or comma-separated list of numbers (polygon points). */
function numberList(value: string): boolean {
  const trimmed = value.trim();
  return trimmed === "" || trimmed.split(/[\s,]+/).every((n) => NUMBER.test(n));
}

/** A transform list of the six SVG functions with numeric arguments. */
function transformList(value: string): boolean {
  let at = 0;
  while (at < value.length) {
    TRANSFORM_STEP.lastIndex = at;
    if (!TRANSFORM_STEP.test(value)) return value.slice(at).trim() === "";
    at = TRANSFORM_STEP.lastIndex;
  }
  return true;
}

type Check = RegExp | ((value: string) => boolean);
const passes = (check: Check, value: string): boolean =>
  typeof check === "function" ? check(value) : check.test(value);

/** Geometry attributes per drawn element (written in this order). */
const SHAPES: ReadonlyMap<string, readonly string[]> = new Map([
  ["path", ["d"]],
  ["rect", ["x", "y", "width", "height", "rx", "ry"]],
  ["circle", ["cx", "cy", "r"]],
  ["ellipse", ["cx", "cy", "rx", "ry"]],
  ["line", ["x1", "y1", "x2", "y2"]],
  ["polyline", ["points"]],
  ["polygon", ["points"]],
]);

/** Presentation attributes (and `style` properties) and their value patterns, in output order. */
const PAINT: ReadonlyMap<string, Check> = new Map<string, Check>([
  ["fill", COLOR],
  ["fill-opacity", OPACITY],
  ["fill-rule", /^(?:nonzero|evenodd)$/],
  ["stroke", COLOR],
  ["stroke-width", LENGTH],
  ["stroke-opacity", OPACITY],
  ["stroke-linecap", /^(?:butt|round|square)$/],
  ["stroke-linejoin", /^(?:miter|round|bevel|arcs|miter-clip)$/],
  ["stroke-miterlimit", NUMBER],
  ["stroke-dasharray", (v) => v === "none" || numberList(v.replace(/px/g, ""))],
  ["stroke-dashoffset", LENGTH],
  ["opacity", OPACITY],
  ["transform", transformList],
]);

/** Elements that could run code, load something or embed foreign content. */
const UNSAFE_ELEMENTS = new Set([
  "script",
  "foreignobject",
  "style",
  "image",
  "use",
  "a",
  "iframe",
  "object",
  "embed",
  "audio",
  "video",
  "canvas",
  "handler",
  "listener",
  "set",
  "animate",
  "animatemotion",
  "animatetransform",
  "animatecolor",
  "discard",
  "feimage",
  "cursor",
  "font-face-uri",
]);

/** Elements that never render: skipped with their content. */
const SKIPPED_ELEMENTS = new Set(["title", "desc", "metadata"]);

/** Namespace prefixes of editor metadata (never rendered): skipped. */
const EDITOR_PREFIXES = new Set(["sodipodi", "inkscape", "sketch", "serif", "rdf", "cc", "dc"]);

/** Attributes without effect on the drawing once re-serialized (never written). */
function inertAttribute(name: string): boolean {
  return (
    name === "xmlns" ||
    name.startsWith("xmlns:") ||
    name === "id" ||
    name === "class" ||
    name === "version" ||
    name === "baseProfile" ||
    name === "xml:space" ||
    name === "xml:lang" ||
    name === "lang" ||
    name === "role" ||
    name === "focusable" ||
    name === "enable-background" ||
    name.startsWith("data-") ||
    name.startsWith("aria-") ||
    EDITOR_PREFIXES.has(name.split(":")[0] ?? "")
  );
}

const localName = (name: string): string => (name.split(":").pop() ?? name).toLowerCase();

/** Lengths of the root's `width` / `height` in CSS px (unitless = px). */
const ROOT_UNITS: ReadonlyMap<string, number> = new Map([
  ["", 1],
  ["px", 1],
  ["pt", 96 / 72],
  ["pc", 16],
  ["mm", 96 / 25.4],
  ["cm", 96 / 2.54],
  ["in", 96],
]);

function rootLength(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const match = new RegExp(`^(${NUM})\\s?(px|pt|pc|mm|cm|in)?$`).exec(value.trim());
  if (match === null) return undefined;
  const scale = ROOT_UNITS.get(match[2] ?? "");
  const n = Number(match[1]) * (scale ?? Number.NaN);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Splits a `style` attribute into declarations; `undefined` if it is not plain declarations. */
function styleDeclarations(style: string): [string, string][] | undefined {
  const out: [string, string][] = [];
  for (const part of style.split(";")) {
    if (part.trim() === "") continue;
    const colon = part.indexOf(":");
    if (colon === -1) return undefined;
    const name = part.slice(0, colon).trim().toLowerCase();
    let value = part.slice(colon + 1).trim();
    if (value.toLowerCase().endsWith("!important")) value = value.slice(0, -10).trim();
    if (!/^[a-z-]+$/.test(name)) return undefined;
    out.push([name, value]);
  }
  return out;
}

/**
 * Imports an SVG document (see the module comment). Never throws; every
 * problem is an issue with its position.
 */
export function importSvg(text: string, options: SvgImportOptions = {}): SvgImportResult {
  const issues: SvgImportIssue[] = [];
  const at = (offset: number) => position(text, offset);
  const issue = (kind: SvgIssueKind, message: string, offset: number) =>
    issues.push({ kind, message, ...at(offset) });

  const parsed = parseXml(text);
  if (!parsed.ok) {
    const unsafe = /DOCTYPE|declaration|entity|Processing instruction/i.test(parsed.message);
    const message = unsafe
      ? `${parsed.message.replace(/\.$/, "")}: DTDs, entities and processing instructions can reach outside the file.`
      : `The SVG is not well-formed XML: ${parsed.message}`;
    return {
      ok: false,
      issues: [
        { kind: unsafe ? "unsafe" : "invalid", message, line: parsed.line, column: parsed.column },
      ],
    };
  }
  const root = parsed.root;
  if (localName(root.name) !== "svg" || root.name.includes(":")) {
    issue("invalid", `The root element is <${root.name}>, not <svg>.`, root.start);
    return { ok: false, issues };
  }

  /** Validated paint of an element (attributes, then `style`, which wins). */
  const paintOf = (element: XmlElement, allowed: readonly string[]): Map<string, string> => {
    const paint = new Map<string, string>();
    const set = (name: string, value: string, offset: number, inStyle: boolean) => {
      if (/url\s*\(|javascript:|expression\s*\(/i.test(value)) {
        issue(
          "unsafe",
          `<${element.name}> ${inStyle ? `style "${name}"` : `"${name}"`} refers to another resource (${value.slice(0, 40)}).`,
          offset,
        );
        return;
      }
      const pattern = PAINT.get(name);
      if (pattern === undefined) {
        issue(
          "unsupported",
          `<${element.name}> ${inStyle ? `style property "${name}"` : `attribute "${name}"`} is not supported.`,
          offset,
        );
        return;
      }
      if (!passes(pattern, value.trim())) {
        issue("unsupported", `<${element.name}> has an unsupported ${name} "${value}".`, offset);
        return;
      }
      let v = value.trim();
      if (options.currentColor !== undefined && /^currentcolor$/i.test(v)) v = options.currentColor;
      paint.set(name, v);
    };
    let style: string | undefined;
    for (const a of element.attributes) {
      const name = a.name;
      const local = localName(name);
      if (local.startsWith("on")) {
        issue("unsafe", `<${element.name}> has an event attribute "${name}".`, element.start);
      } else if (local === "href" || local === "src") {
        issue(
          "unsafe",
          `<${element.name}> has "${name}", a reference to another file or URL.`,
          element.start,
        );
      } else if (/url\s*\(|javascript:/i.test(a.value) && !inertAttribute(name)) {
        issue(
          "unsafe",
          `<${element.name}> "${name}" refers to another resource (${a.value.slice(0, 40)}).`,
          element.start,
        );
      } else if (name === "style") style = a.value;
      else if (allowed.includes(name) || inertAttribute(name)) {
        // Geometry (checked by the caller) or inert.
      } else set(name, a.value, element.start, false);
    }
    if (style !== undefined) {
      const declarations = styleDeclarations(style);
      if (declarations === undefined) {
        issue(
          "unsupported",
          `<${element.name}> has a style attribute Sumi cannot read.`,
          element.start,
        );
      } else for (const [name, value] of declarations) set(name, value, element.start, true);
    }
    return paint;
  };

  const paintAttributes = (paint: Map<string, string>): string =>
    [...PAINT.keys()]
      .filter((name) => paint.has(name))
      .map((name) => ` ${name}="${escapeAttribute(paint.get(name) as string)}"`)
      .join("");

  let count = 0;
  const visit = (parent: XmlElement, depth: number): string => {
    let out = "";
    for (const child of childElements(parent)) {
      if (++count > SVG_IMPORT_LIMITS.maxElements) {
        if (count === SVG_IMPORT_LIMITS.maxElements + 1) {
          issue(
            "unsupported",
            `The SVG has more than ${SVG_IMPORT_LIMITS.maxElements} elements.`,
            child.start,
          );
        }
        return out;
      }
      const name = child.name;
      const local = localName(name);
      const prefix = name.includes(":") ? (name.split(":")[0] ?? "") : "";
      if (UNSAFE_ELEMENTS.has(local)) {
        issue(
          "unsafe",
          `<${name}> is not allowed: it can run code, load other files or embed foreign content.`,
          child.start,
        );
        continue;
      }
      if (EDITOR_PREFIXES.has(prefix) || (prefix === "" && SKIPPED_ELEMENTS.has(local))) continue;
      if (prefix !== "") {
        issue("unsupported", `<${name}> (a namespaced element) is not supported.`, child.start);
        continue;
      }
      if (depth >= SVG_IMPORT_LIMITS.maxDepth) {
        issue(
          "unsupported",
          `The SVG nests elements deeper than ${SVG_IMPORT_LIMITS.maxDepth} levels.`,
          child.start,
        );
        continue;
      }
      if (name === "g") {
        const paint = paintOf(child, []);
        out += `<g${paintAttributes(paint)}>${visit(child, depth + 1)}</g>`;
        continue;
      }
      const geometry = SHAPES.get(name);
      if (geometry === undefined) {
        issue(
          "unsupported",
          `<${name}> is not supported; Sumi draws basic shapes only.`,
          child.start,
        );
        continue;
      }
      if (childElements(child).some((c) => !SKIPPED_ELEMENTS.has(localName(c.name)))) {
        // Shapes have no drawn children; animations inside are unsafe and reported here.
        visit(child, depth + 1);
      }
      const attrs: string[] = [];
      for (const attrName of geometry) {
        const value = child.attributes.find((a) => a.name === attrName)?.value;
        if (value === undefined) continue;
        const ok =
          attrName === "d"
            ? PATH_DATA.test(value)
            : attrName === "points"
              ? numberList(value)
              : LENGTH.test(value.trim());
        if (!ok) {
          issue(
            "unsupported",
            `<${name}> has an unsupported ${attrName} "${value.slice(0, 40)}".`,
            child.start,
          );
          continue;
        }
        attrs.push(` ${attrName}="${escapeAttribute(value.trim().replace(/\s+/g, " "))}"`);
      }
      const paint = paintOf(child, geometry);
      if (options.dropInvisible && paint.get("fill") === "none" && paint.get("stroke") === "none") {
        continue;
      }
      out += `<${name}${attrs.join("")}${paintAttributes(paint)}/>`;
    }
    return out;
  };

  const rootPaint = paintOf(root, ["width", "height", "viewBox", "x", "y", "preserveAspectRatio"]);
  const body = visit(root, 1);

  const viewBoxText = root.attributes.find((a) => a.name === "viewBox")?.value;
  const width = rootLength(root.attributes.find((a) => a.name === "width")?.value);
  const height = rootLength(root.attributes.find((a) => a.name === "height")?.value);
  let viewBox: [number, number, number, number] | undefined;
  if (viewBoxText !== undefined) {
    const parts = viewBoxText.trim().split(/[\s,]+/);
    const numbers = parts.map(Number);
    if (
      parts.length === 4 &&
      parts.every((p) => NUMBER.test(p)) &&
      numbers.every(Number.isFinite) &&
      (numbers[2] ?? 0) > 0 &&
      (numbers[3] ?? 0) > 0
    ) {
      viewBox = numbers as [number, number, number, number];
    } else
      issue(
        "invalid",
        `The root viewBox "${viewBoxText}" is not four numbers with a positive size.`,
        root.start,
      );
  } else if (width !== undefined && height !== undefined) {
    viewBox = [0, 0, width, height];
  } else {
    issue("invalid", "The root <svg> has neither a viewBox nor a width and height.", root.start);
  }
  const preserve = root.attributes.find((a) => a.name === "preserveAspectRatio")?.value;
  if (preserve !== undefined && !/^\s*xMidYMid(?:\s+meet)?\s*$/.test(preserve)) {
    issue(
      "unsupported",
      `The root preserveAspectRatio "${preserve}" is not supported; Sumi fits the drawing by props.fit.`,
      root.start,
    );
  }
  if (issues.length > 0 || viewBox === undefined) return { ok: false, issues };
  const [, , vw, vh] = viewBox;
  // A root with only one of width / height keeps the viewBox's aspect ratio.
  const w = width ?? (height !== undefined ? (height * vw) / vh : vw);
  const h = height ?? (width !== undefined ? (width * vh) / vw : vh);
  return {
    ok: true,
    value: { viewBox, width: w, height: h, markup: `<g${paintAttributes(rootPaint)}>${body}</g>` },
  };
}
