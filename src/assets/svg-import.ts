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

import { childElements, escapeAttribute, parseXml, type XmlElement } from "../render/xml";

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
const NUM_GLOBAL = new RegExp(NUM, "g");
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

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Namespaces of editor metadata (never rendered): elements in them are
 * skipped with their content, attributes in them ignored. Recognized by the
 * namespace a prefix is bound to, never by the prefix's spelling.
 */
const EDITOR_NAMESPACES = new Set([
  "http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd",
  "http://www.inkscape.org/namespaces/inkscape",
  "http://www.bohemiancoding.com/sketch/ns",
  "http://www.serif.com/",
  "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  "http://creativecommons.org/ns#",
  "http://purl.org/dc/elements/1.1/",
  "http://ns.adobe.com/AdobeIllustrator/10.0/",
  "http://ns.adobe.com/AdobeSVGViewerExtensions/3.0/",
  "http://ns.adobe.com/Extensibility/1.0/",
  "http://ns.adobe.com/Graphs/1.0/",
  "http://ns.adobe.com/SaveForWeb/1.0/",
  "http://ns.adobe.com/Variables/1.0/",
]);

/** Prefix → namespace URI in scope (`""` is the default namespace). */
type Scope = ReadonlyMap<string, string>;

/** The scope inside `element`: its parent's plus its own `xmlns` / `xmlns:*` declarations. */
function scopeOf(element: XmlElement, parent: Scope): Scope {
  const declared = element.attributes.filter(
    (a) => a.name === "xmlns" || a.name.startsWith("xmlns:"),
  );
  if (declared.length === 0) return parent;
  const scope = new Map(parent);
  for (const a of declared) scope.set(a.name === "xmlns" ? "" : a.name.slice(6), a.value);
  return scope;
}

const prefixOf = (name: string): string => (name.includes(":") ? (name.split(":")[0] ?? "") : "");
const localName = (name: string): string => (name.split(":").pop() ?? name).toLowerCase();

/** Unprefixed attributes without effect on the drawing once re-serialized (never written). */
function inertAttribute(name: string): boolean {
  return (
    name === "id" ||
    name === "class" ||
    name === "version" ||
    name === "baseProfile" ||
    name === "lang" ||
    name === "role" ||
    name === "focusable" ||
    name === "enable-background" ||
    name.startsWith("data-") ||
    name.startsWith("aria-")
  );
}

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

const ROOT_LENGTH = new RegExp(`^(${NUM}) ?(px|pt|pc|mm|cm|in)?$`);

function rootLength(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const match = ROOT_LENGTH.exec(value.trim());
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

/** At most this many issues of each kind are kept (each costs a position lookup). */
const MAX_ISSUES_PER_KIND = 100;

/** 1-based line and column of offsets in `text`, by binary search over the line starts. */
function positions(text: string): (offset: number) => { line: number; column: number } {
  let starts: number[] | undefined;
  return (offset) => {
    if (starts === undefined) {
      starts = [0];
      for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
    }
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((starts[mid] as number) <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - (starts[lo] as number) + 1 };
  };
}

/**
 * Imports an SVG document (see the module comment). Never throws; every
 * problem is an issue with its position.
 */
export function importSvg(text: string, options: SvgImportOptions = {}): SvgImportResult {
  const issues: SvgImportIssue[] = [];
  const counts = new Map<SvgIssueKind, number>();
  const at = positions(text);
  const issue = (kind: SvgIssueKind, message: string, offset: number) => {
    const count = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, count);
    if (count <= MAX_ISSUES_PER_KIND) issues.push({ kind, message, ...at(offset) });
  };

  // The budgets hold while parsing, before the whole tree exists (skipped
  // metadata counts too).
  const parsed = parseXml(text, SVG_IMPORT_LIMITS);
  if (!parsed.ok) {
    const unsafe = /DOCTYPE|declaration|entity|Processing instruction/i.test(parsed.message);
    const budget = /more than|deeper than/.test(parsed.message);
    const message = unsafe
      ? `${parsed.message.replace(/\.$/, "")}: DTDs, entities and processing instructions can reach outside the file.`
      : budget
        ? parsed.message
        : `The SVG is not well-formed XML: ${parsed.message}`;
    return {
      ok: false,
      issues: [
        {
          kind: unsafe ? "unsafe" : budget ? "unsupported" : "invalid",
          message,
          line: parsed.line,
          column: parsed.column,
        },
      ],
    };
  }
  const root = parsed.root;
  const rootScope = scopeOf(root, new Map());
  const rootNs = rootScope.get("");
  if (root.name !== "svg" || (rootNs !== undefined && rootNs !== SVG_NS)) {
    issue("invalid", `The root element is <${root.name}>, not an SVG <svg>.`, root.start);
    return { ok: false, issues };
  }

  /** `true` if every number in `value` is finite (e.g. no `1e999`). */
  const finite = (value: string): boolean => {
    for (const match of value.matchAll(NUM_GLOBAL))
      if (!Number.isFinite(Number(match[0]))) return false;
    return true;
  };

  /** Validated paint of an element (attributes, then `style`, which wins). */
  const paintOf = (
    element: XmlElement,
    scope: Scope,
    allowed: readonly string[],
  ): Map<string, string> => {
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
      const trimmed = value.trim();
      if (!passes(pattern, trimmed) || !finite(trimmed)) {
        issue(
          "unsupported",
          `<${element.name}> has an unsupported ${name} "${value.slice(0, 40)}".`,
          offset,
        );
        return;
      }
      paint.set(
        name,
        options.currentColor !== undefined && /^currentcolor$/i.test(trimmed)
          ? options.currentColor
          : trimmed,
      );
    };
    let style: string | undefined;
    for (const a of element.attributes) {
      const name = a.name;
      const local = localName(name);
      const prefix = prefixOf(name);
      if (local.startsWith("on")) {
        issue("unsafe", `<${element.name}> has an event attribute "${name}".`, element.start);
      } else if (local === "href" || local === "src") {
        issue(
          "unsafe",
          `<${element.name}> has "${name}", a reference to another file or URL.`,
          element.start,
        );
      } else if (name === "xmlns" || prefix === "xmlns") {
        // Namespace declarations (see scopeOf).
      } else if (prefix !== "") {
        // xml:space / xml:lang and editor metadata are inert; anything else is not drawn by Sumi.
        const inert =
          name === "xml:space" ||
          name === "xml:lang" ||
          EDITOR_NAMESPACES.has(scope.get(prefix) ?? "");
        if (!inert) {
          issue(
            "unsupported",
            `<${element.name}> attribute "${name}" (a namespaced attribute) is not supported.`,
            element.start,
          );
        }
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

  const visit = (parent: XmlElement, parentScope: Scope): string => {
    let out = "";
    for (const child of childElements(parent)) {
      const scope = scopeOf(child, parentScope);
      const name = child.name;
      const local = localName(name);
      const prefix = prefixOf(name);
      const namespace = scope.get(prefix);
      if (UNSAFE_ELEMENTS.has(local)) {
        issue(
          "unsafe",
          `<${name}> is not allowed: it can run code, load other files or embed foreign content.`,
          child.start,
        );
        visit(child, scope); // report what is inside too
        continue;
      }
      if (namespace !== undefined && EDITOR_NAMESPACES.has(namespace)) continue;
      if (prefix !== "" || (namespace !== undefined && namespace !== SVG_NS)) {
        issue(
          "unsupported",
          `<${name}> is in ${namespace === undefined ? "an undeclared namespace" : `the namespace ${namespace}`}, not drawn by Sumi.`,
          child.start,
        );
        visit(child, scope);
        continue;
      }
      if (SKIPPED_ELEMENTS.has(name)) continue;
      if (name === "g") {
        const paint = paintOf(child, scope, []);
        out += `<g${paintAttributes(paint)}>${visit(child, scope)}</g>`;
        continue;
      }
      const geometry = SHAPES.get(name);
      if (geometry === undefined) {
        issue(
          "unsupported",
          `<${name}> is not supported; Sumi draws basic shapes only.`,
          child.start,
        );
        visit(child, scope);
        continue;
      }
      // Shapes draw no children; whatever is inside (e.g. an animation) is reported.
      visit(child, scope);
      const attrs: string[] = [];
      for (const attrName of geometry) {
        const value = child.attributes.find((a) => a.name === attrName)?.value;
        if (value === undefined) continue;
        const ok =
          (attrName === "d"
            ? PATH_DATA.test(value)
            : attrName === "points"
              ? numberList(value)
              : LENGTH.test(value.trim())) && finite(value);
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
      const paint = paintOf(child, scope, geometry);
      if (options.dropInvisible && paint.get("fill") === "none" && paint.get("stroke") === "none") {
        continue;
      }
      out += `<${name}${attrs.join("")}${paintAttributes(paint)}/>`;
    }
    return out;
  };

  const rootPaint = paintOf(root, rootScope, [
    "width",
    "height",
    "viewBox",
    "x",
    "y",
    "preserveAspectRatio",
  ]);
  const body = visit(root, rootScope);

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
        `The root viewBox "${viewBoxText.slice(0, 60)}" is not four finite numbers with a positive size.`,
        root.start,
      );
  } else if (width !== undefined && height !== undefined) {
    viewBox = [0, 0, width, height];
  } else {
    issue("invalid", "The root <svg> has neither a viewBox nor a width and height.", root.start);
  }
  const preserve = root.attributes.find((a) => a.name === "preserveAspectRatio")?.value;
  if (
    preserve !== undefined &&
    !/^xMidYMid(?: meet)?$/.test(preserve.trim().replace(/\s+/g, " "))
  ) {
    issue(
      "unsupported",
      `The root preserveAspectRatio "${preserve.slice(0, 40)}" is not supported; Sumi fits the drawing by props.fit.`,
      root.start,
    );
  }
  if (issues.length > 0 || viewBox === undefined) return { ok: false, issues };
  const [, , vw, vh] = viewBox;
  // A root with only one of width / height keeps the viewBox's aspect ratio.
  const w = width ?? (height !== undefined ? (height * vw) / vh : vw);
  const h = height ?? (width !== undefined ? (width * vh) / vw : vh);
  if (![w, h].every((n) => Number.isFinite(n) && n > 0)) {
    issue("invalid", "The root <svg> has no finite positive size.", root.start);
    return { ok: false, issues };
  }
  return {
    ok: true,
    value: { viewBox, width: w, height: h, markup: `<g${paintAttributes(rootPaint)}>${body}</g>` },
  };
}
