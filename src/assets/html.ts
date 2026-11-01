/** Strict, located HTML/CSS preflight. No renderer is called before this succeeds. */
export const HTML_LIMITS = Object.freeze({
  maxBytes: 131_072,
  maxElements: 512,
  maxDepth: 24,
  maxSide: 2048,
  maxPixels: 2_097_152,
});
export const HTML_VARIABLES = [
  "--sumi-fg",
  "--sumi-muted",
  "--sumi-accent",
  "--sumi-bg",
  "--sumi-font",
  "--sumi-mono",
] as const;
export const HTML_FAMILIES = ["BIZ UDPGothic", "BIZ UDGothic", "Inter"] as const;
export interface HtmlIssue {
  code: string;
  message: string;
  offset: number;
}
const tags = new Set(["div", "span", "p", "b", "i", "br"]);

import { CSS_LIMITS, tokenizeCss, validCssValue } from "./html-css";

export function htmlViewport(value: string): { width: number; height: number } | undefined {
  const m = /^([1-9]\d*)x([1-9]\d*)$/.exec(value);
  if (!m) return undefined;
  const width = Number(m[1]),
    height = Number(m[2]);
  return width <= HTML_LIMITS.maxSide &&
    height <= HTML_LIMITS.maxSide &&
    width * height <= HTML_LIMITS.maxPixels
    ? { width, height }
    : undefined;
}

export function validateHtml(source: string): HtmlIssue[] {
  const issues: HtmlIssue[] = [];
  const fail = (code: string, message: string, offset: number) => {
    if (issues.length < 20) issues.push({ code, message, offset });
  };
  if (Buffer.byteLength(source, "utf8") > HTML_LIMITS.maxBytes)
    return [
      { code: "asset/too-large", message: "HTML exceeds the 128 KiB input budget.", offset: 0 },
    ];
  const stack: string[] = [];
  const fontSizes: number[] = [];
  let count = 0,
    cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf("<", cursor);
    if (start < 0) break;
    const match =
      /^<(\/)?([a-z][a-z0-9]*)([ \t\n\f\r]+(?:[^<>"']|"[^"<>]*"|'[^'<>]*')*?)?[ \t\n\f\r]*(\/?)>/i.exec(
        source.slice(start),
      );
    if (!match) {
      fail(
        "asset/unsafe-html",
        "Malformed HTML, comments and declarations are not supported.",
        start,
      );
      break;
    }
    cursor = start + match[0].length;
    const name = (match[2] ?? "").toLowerCase();
    if (!tags.has(name))
      fail(
        "asset/unsafe-html",
        `Tag <${name}> is not allowed; use div, span, p, b, i or br.`,
        start,
      );
    if (match[1]) {
      fontSizes.pop();
      if (match[3]?.replace(/[ \t\n\f\r]/g, "") || match[4] || stack.pop() !== name)
        fail("asset/unsafe-html", "Mismatched closing tag.", start);
      continue;
    }
    if (++count > HTML_LIMITS.maxElements) {
      fail("asset/too-large", "HTML exceeds 512 elements.", start);
      break;
    }
    const attrs = match[3] ?? "";
    let fontSize = fontSizes.at(-1) ?? 16;
    let at = 0,
      styled = false;
    while (at < attrs.length) {
      const rest = attrs.slice(at);
      if (/^[ \t\n\f\r]*$/.test(rest)) break;
      const attr =
        /^[ \t\n\f\r]+([a-zA-Z_:][\w:.-]*)[ \t\n\f\r]*=[ \t\n\f\r]*("([^"]*)"|'([^']*)')/.exec(
          rest,
        );
      if (!attr) {
        fail(
          "asset/unsafe-html",
          "Only a quoted style attribute is allowed.",
          start + 1 + name.length + at,
        );
        break;
      }
      const offset = start + 1 + name.length + at + attr[0].indexOf(attr[2] ?? "") + 1;
      if (attr[1]?.toLowerCase() !== "style" || styled)
        fail(
          "asset/unsafe-html",
          "Only one style attribute is allowed; all other attributes are rejected.",
          offset,
        );
      else {
        styled = true;
        fontSize = validateCss(attr[3] ?? attr[4] ?? "", offset, fail, fontSize);
      }
      at += attr[0].length;
    }
    if (name !== "br") {
      if (match[4]) fail("asset/unsafe-html", "Self-closing syntax is allowed only on br.", start);
      stack.push(name);
      fontSizes.push(fontSize);
    }
    if (stack.length > HTML_LIMITS.maxDepth) {
      fail("asset/too-large", "HTML exceeds nesting depth 24.", start);
      break;
    }
  }
  if (stack.length && issues.length === 0)
    fail("asset/unsafe-html", "Unclosed HTML tag.", source.length);
  if (!count && !issues.length)
    fail("asset/unsafe-html", "HTML needs at least one allowed element.", 0);
  return issues;
}

function validateCss(
  style: string,
  offset: number,
  fail: (code: string, message: string, offset: number) => void,
  inheritedFontSize: number,
): number {
  let cursor = 0;
  const tokenized = tokenizeCss(style, ";");
  const declarations = tokenized.parts;
  if (!declarations) {
    fail(
      "asset/unsupported-css",
      "Malformed CSS quotes, parentheses or non-ASCII whitespace.",
      offset + tokenized.errorOffset,
    );
    return inheritedFontSize;
  }
  // Resolve the last font-size before checking em lengths, regardless of
  // declaration order. This prevents nested em font sizes escaping the px budget.
  let fontSize = inheritedFontSize;
  for (const declaration of declarations) {
    const match = /^\s*font-size\s*:\s*(.*?)\s*$/i.exec(declaration);
    const value = match?.[1]?.toLowerCase();
    if (!value || !validCssValue("font-size", value)) continue;
    const scalar = Number.parseFloat(value);
    fontSize = value.endsWith("em")
      ? scalar * inheritedFontSize
      : value.endsWith("%")
        ? (scalar * inheritedFontSize) / 100
        : value.endsWith("pt")
          ? (scalar * 4) / 3
          : scalar;
  }
  for (const declaration of declarations) {
    const at = offset + cursor + (declaration.length - declaration.trimStart().length);
    cursor += declaration.length + 1;
    if (!declaration.trim()) continue;
    const colon = declaration.indexOf(":");
    const prop = declaration
      .slice(0, colon)
      .trim()
      .replace(/[A-Z]/g, (ch) => ch.toLowerCase());
    const value = declaration.slice(colon + 1).trim();
    const reject = (message: string) => fail("asset/unsupported-css", message, at);
    if (colon < 1) {
      reject(`Unsupported CSS property: ${prop || declaration.trim()}.`);
      continue;
    }
    if (!value || /[\\&@{}<>!]|\/\*|\*\//.test(value)) {
      reject("CSS escapes, entities, comments, rules and !important are not supported.");
      continue;
    }
    if (!validCssValue(prop, value)) reject(`Unsupported ${prop} value: ${value}.`);
    else if (prop === "font-size" && (fontSize > CSS_LIMITS.px || (fontSize > 0 && fontSize < 1)))
      reject("Resolved font-size must be 0 or 1–2048 CSS px.");
    else if (
      prop !== "font-family" &&
      [...value.matchAll(/(-?(?:\d+(?:\.\d+)?|\.\d+))em\b/gi)].some(
        (m) =>
          Math.abs(Number(m[1])) * (prop === "font-size" ? inheritedFontSize : fontSize) >
          CSS_LIMITS.px,
      )
    )
      reject("Resolved em lengths must not exceed the 2048 CSS px side budget.");
  }
  return fontSize;
}
