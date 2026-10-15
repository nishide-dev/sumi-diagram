/**
 * Shared reading of D2's SVG structure (design doc §6): a root `<svg>` with a
 * viewBox, containing a single `<svg class="… d2-svg">` with the drawing.
 */

import type { Diagnostic } from "../core/diagnostics";
import type { Rect } from "./geometry";
import { attribute, childElements, classList, parseXml, type XmlElement } from "./xml";

export const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

export interface D2SvgDocument {
  root: XmlElement;
  /** The root viewBox: the whole canvas in D2 units, margin (`--pad`) included. */
  viewBox: Rect;
  /** The single `svg.d2-svg` holding the drawing. */
  drawing: XmlElement;
}

export type D2SvgResult = { ok: true; doc: D2SvgDocument } | { ok: false; diagnostic: Diagnostic };

export function invalid(message: string, hint?: string): Diagnostic {
  return { code: "svg/invalid", severity: "error", message, ...(hint !== undefined && { hint }) };
}

function empty(message: string): Diagnostic {
  return {
    code: "svg/empty",
    severity: "error",
    message,
    hint: "Check that the figure has at least one node or group and that D2 rendered it.",
  };
}

/** Parses a viewBox `min-x min-y width height`; `undefined` if malformed. */
export function parseViewBox(value: string | undefined): Rect | undefined {
  if (value === undefined) return undefined;
  const parts = value.trim().split(/[ \t\r\n,]+/);
  if (parts.length !== 4) return undefined;
  const numbers = parts.map(parseNumber);
  if (numbers.some((n) => n === undefined)) return undefined;
  const [x, y, width, height] = numbers as [number, number, number, number];
  if (width < 0 || height < 0) return undefined;
  return { x, y, width, height };
}

/** Parses an SVG number (no unit); `undefined` if malformed or not finite. */
export function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Parses SVG text and checks D2's document structure. Malformed XML or an
 * unexpected structure is `svg/invalid`; a document without a drawing (zero
 * canvas, no `svg.d2-svg` content) is `svg/empty`.
 */
export function readD2Svg(svg: string): D2SvgResult {
  if (svg.trim() === "") return { ok: false, diagnostic: empty("The SVG output is empty.") };
  const parsed = parseXml(svg);
  if (!parsed.ok) {
    return {
      ok: false,
      diagnostic: invalid(
        `The SVG is not well-formed XML: ${parsed.message} (line ${parsed.line}, column ${parsed.column}).`,
      ),
    };
  }
  const { root } = parsed;
  if (root.name !== "svg" || attribute(root, "xmlns") !== SVG_NAMESPACE) {
    return {
      ok: false,
      diagnostic: invalid(`The root element is <${root.name}>, not an SVG <svg> element.`),
    };
  }
  const viewBox = parseViewBox(attribute(root, "viewBox"));
  if (viewBox === undefined) {
    return { ok: false, diagnostic: invalid("The root <svg> has no valid viewBox.") };
  }
  if (viewBox.width === 0 || viewBox.height === 0) {
    return { ok: false, diagnostic: empty("The SVG canvas has zero width or height.") };
  }
  const drawings = childElements(root).filter(
    (child) => child.name === "svg" && classList(child).includes("d2-svg"),
  );
  if (drawings.length > 1) {
    return {
      ok: false,
      diagnostic: invalid(`Expected one <svg class="d2-svg">, found ${drawings.length}.`),
    };
  }
  const [drawing] = drawings;
  if (drawing === undefined || childElements(drawing).length === 0) {
    return { ok: false, diagnostic: empty("The SVG contains no D2 drawing.") };
  }
  return { ok: true, doc: { root, viewBox, drawing } };
}
