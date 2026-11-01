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
const properties = new Set(
  `display flex flex-direction flex-wrap flex-grow flex-shrink flex-basis justify-content align-items align-self align-content justify-items justify-self order grid-template-columns grid-template-rows grid-auto-columns grid-auto-rows grid-auto-flow grid-column grid-row grid-column-start grid-column-end grid-row-start grid-row-end position top left right bottom width height min-width min-height max-width max-height margin margin-top margin-right margin-bottom margin-left padding padding-top padding-right padding-bottom padding-left gap row-gap column-gap color background-color border border-width border-style border-color border-top border-right border-bottom border-left border-top-width border-right-width border-bottom-width border-left-width border-top-style border-right-style border-bottom-style border-left-style border-top-color border-right-color border-bottom-color border-left-color border-radius border-top-left-radius border-top-right-radius border-bottom-left-radius border-bottom-right-radius font-size font-weight font-style font-family line-height letter-spacing text-align white-space opacity box-sizing`.split(
    " ",
  ),
);
const functions = new Set([
  "var",
  "calc",
  "min",
  "max",
  "clamp",
  "rgb",
  "rgba",
  "hsl",
  "hsla",
  "repeat",
  "minmax",
  "fit-content",
]);

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
  let count = 0,
    cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf("<", cursor);
    if (start < 0) break;
    const match = /^<(\/)?([a-z][a-z0-9]*)(\s+(?:[^<>"']|"[^"<>]*"|'[^'<>]*')*?)?\s*(\/?)>/i.exec(
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
      if (match[3]?.trim() || match[4] || stack.pop() !== name)
        fail("asset/unsafe-html", "Mismatched closing tag.", start);
      continue;
    }
    if (++count > HTML_LIMITS.maxElements) {
      fail("asset/too-large", "HTML exceeds 512 elements.", start);
      break;
    }
    const attrs = match[3] ?? "";
    let at = 0,
      styled = false;
    while (at < attrs.length) {
      const rest = attrs.slice(at);
      if (!rest.trim()) break;
      const attr = /^\s+([a-zA-Z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/.exec(rest);
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
        validateCss(attr[3] ?? attr[4] ?? "", offset, fail);
      }
      at += attr[0].length;
    }
    if (name !== "br" && !match[4]) stack.push(name);
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
): void {
  let cursor = 0;
  for (const declaration of style.split(";")) {
    const at = offset + cursor + (declaration.length - declaration.trimStart().length);
    cursor += declaration.length + 1;
    if (!declaration.trim()) continue;
    const colon = declaration.indexOf(":");
    const prop = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1).trim();
    const reject = (message: string) => fail("asset/unsupported-css", message, at);
    if (colon < 1 || !properties.has(prop)) {
      reject(`Unsupported CSS property: ${prop || declaration.trim()}.`);
      continue;
    }
    if (!value || /[\\&@{}<>!]|\/\*|\*\//.test(value)) {
      reject("CSS escapes, entities, comments, rules and !important are not supported.");
      continue;
    }
    let depth = 0;
    for (const ch of value) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (depth < 0) break;
    }
    if (depth !== 0) {
      reject("Unbalanced CSS function.");
      continue;
    }
    const calls = [...value.matchAll(/([\w-]+)\s*\(/g)];
    if (calls.some((m) => !functions.has((m[1] ?? "").toLowerCase()))) {
      reject(
        "Only layout, color and injected variable CSS functions are allowed; no URLs, gradients or filters.",
      );
      continue;
    }
    if (calls.some((m) => m[1]?.toLowerCase() === "var") && /var\s*\([^)]*\)/gi.test(value)) {
      const vars = [...value.matchAll(/var\s*\(([^)]*)\)/gi)];
      if (vars.some((m) => !(HTML_VARIABLES as readonly string[]).includes((m[1] ?? "").trim()))) {
        reject("var() may reference only the fixed --sumi-* variables, without fallbacks.");
        continue;
      }
    }
    if (prop === "font-family") {
      const names = value.split(",").map((s) => s.trim().replace(/^(['"])(.*)\1$/, "$2"));
      if (
        !names.every(
          (n) =>
            (HTML_FAMILIES as readonly string[]).includes(n) ||
            /^var\(--sumi-(font|mono)\)$/.test(n),
        )
      )
        reject(
          "font-family must use --sumi-font, --sumi-mono or a bundled family (BIZ UDPGothic, BIZ UDGothic, Inter).",
        );
    }
    const enums: Record<string, string[]> = {
      display: ["flex", "grid", "block", "inline", "inline-block", "none"],
      position: ["relative", "absolute", "static"],
      "box-sizing": ["border-box"],
      "font-style": ["normal", "italic", "oblique"],
      "white-space": ["normal", "pre", "pre-wrap", "nowrap"],
      "text-align": ["left", "right", "center", "start", "end", "justify"],
    };
    if (enums[prop] && !enums[prop].includes(value)) reject(`Unsupported ${prop} value: ${value}.`);
  }
}
