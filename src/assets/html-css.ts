/** Conservative complete-value grammars, shared by every HTML preflight call. */
export function tokenizeCss(
  source: string,
  separator: ";" | "," | " ",
): { parts: string[]; errorOffset?: never } | { parts?: never; errorOffset: number } {
  const parts: string[] = [];
  let quote = "",
    depth = 0,
    start = 0;
  const malformed = () => ({
    errorOffset: start + (source.slice(start).match(/^[ \t\n\f\r]*/)?.[0].length ?? 0),
  });
  for (let i = 0; i < source.length; i++) {
    const ch = source[i] ?? "";
    if (quote) {
      if (ch === quote) quote = "";
    } else if (/\s/.test(ch) && !/[ \t\n\f\r]/.test(ch)) return malformed();
    else if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") {
      if (--depth < 0) return malformed();
    } else if (depth === 0 && (separator === " " ? /[ \t\n\f\r]/.test(ch) : ch === separator)) {
      parts.push(source.slice(start, i));
      start = i + 1;
    }
  }
  if (quote || depth) return malformed();
  parts.push(source.slice(start));
  return { parts: separator === " " ? parts.filter(Boolean) : parts };
}

// Deliberately much smaller than f32's range. Bound every numeric grammar,
// including nested shorthands/tracks; never rely on JS finiteness alone.
export const CSS_LIMITS = Object.freeze({
  px: 2048,
  pt: 1536,
  em: 16,
  percent: 100,
  factor: 64,
  lineHeight: 8,
  order: 512,
  grid: 64,
});
const numberPattern = /^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/;
const number = (v: string, max: number) => numberPattern.test(v) && Number(v) <= max;
const integer = (v: string, max: number) => /^-?\d+$/.test(v) && Math.abs(Number(v)) <= max;
const length = (v: string) => {
  if (v === "0") return true;
  const m = /^(.*?)(px|pt|em|%)$/.exec(v);
  if (!m) return false;
  const value = m[1] ?? "",
    unit = m[2] ?? "";
  const min = unit === "em" ? 0.1 : unit === "pt" ? 0.75 : 1;
  return (
    number(value, unit === "%" ? CSS_LIMITS.percent : CSS_LIMITS[unit as "px" | "pt" | "em"]) &&
    (Number(value) === 0 || Number(value) >= min)
  );
};
const signedLength = (v: string) => length(v.replace(/^-/, ""));
const absoluteLength = (v: string) => length(v) && !v.endsWith("%");
const oneOf = (v: string, words: string) => words.split(" ").includes(v);
const list = (v: string, check: (s: string) => boolean, max = 4) => {
  const values = tokenizeCss(v, " ").parts;
  return !!values?.length && values.length <= max && values.every(check);
};
const namedColors = new Set(
  "transparent black silver gray white maroon red purple fuchsia green lime olive yellow navy blue teal aqua orange rebeccapurple".split(
    " ",
  ),
);
function color(v: string): boolean {
  if (namedColors.has(v) || /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(v))
    return true;
  // The injected variables have fixed types: colors here, font lists only in font-family.
  if (/^var\(--sumi-(?:fg|muted|accent|bg)\)$/.test(v)) return true;
  const match = /^(rgb|rgba)\((.*)\)$/.exec(v);
  if (!match) return false;
  const channels = tokenizeCss(match[2] ?? "", ",").parts?.map((s) => s.trim());
  return (
    !!channels &&
    channels.length === (match[1] === "rgb" ? 3 : 4) &&
    channels.every((s, i) =>
      s.endsWith("%") ? number(s.slice(0, -1), 100) : number(s, i === 3 ? 1 : 255),
    ) &&
    // Legacy comma rgb requires all three color channels to use the same unit.
    channels.slice(0, 3).every((s) => s.endsWith("%") === channels[0]?.endsWith("%"))
  );
}
const keywords: Record<string, string> = {
  display: "flex grid block inline inline-block none",
  position: "relative absolute static",
  "box-sizing": "border-box",
  "font-style": "normal italic oblique",
  "white-space": "normal pre pre-wrap nowrap",
  "text-align": "left right center start end justify",
  "flex-direction": "row row-reverse column column-reverse",
  "flex-wrap": "nowrap wrap wrap-reverse",
  "justify-content": "start end flex-start flex-end center space-between space-around space-evenly",
  "align-content":
    "start end flex-start flex-end center stretch space-between space-around space-evenly",
  "align-items": "start end flex-start flex-end center stretch baseline",
  "align-self": "auto start end flex-start flex-end center stretch baseline",
  "justify-items": "start end center stretch",
  "justify-self": "auto start end center stretch",
  "grid-auto-flow": "row column",
};
const borderStyle = (v: string) => oneOf(v, "solid dashed dotted double none");
function track(v: string): boolean {
  return (
    length(v) ||
    (v.endsWith("fr") && number(v.slice(0, -2), CSS_LIMITS.factor)) ||
    oneOf(v, "auto min-content max-content")
  );
}
function tracks(v: string): boolean {
  let count = 0;
  return list(
    v,
    (s) => {
      if (track(s)) return ++count <= CSS_LIMITS.grid;
      const repeat = /^repeat\(([1-9]\d*),(.+)\)$/.exec(s);
      if (!repeat || Number(repeat[1]) > CSS_LIMITS.grid) return false;
      const inner = tokenizeCss((repeat[2] ?? "").trim(), " ").parts;
      if (!inner?.length || !inner.every(track)) return false;
      count += Number(repeat[1]) * inner.length;
      return count <= CSS_LIMITS.grid;
    },
    16,
  );
}
function gridLine(v: string): boolean {
  return (
    v === "auto" ||
    (integer(v, CSS_LIMITS.grid) && Number(v) !== 0) ||
    (/^span [1-9]\d*$/.test(v) && Number(v.slice(5)) <= CSS_LIMITS.grid)
  );
}

export function validCssValue(prop: string, v: string): boolean {
  if (prop === "font-family") {
    const families = tokenizeCss(v, ",").parts;
    return (
      !!families?.length &&
      families.every((s) => {
        const name = s.trim().replace(/^(['"])(.*)\1$/, "$2");
        return (
          ["BIZ UDPGothic", "BIZ UDGothic", "Inter"].includes(name) ||
          /^var\(--sumi-(font|mono)\)$/.test(s.trim())
        );
      })
    );
  }
  // CSS units/keywords/colors are ASCII case-insensitive; custom property
  // identifiers remain case-sensitive even inside otherwise insensitive values.
  const variables = v.match(/var\([^)]*\)/gi) ?? [];
  if (variables.some((s) => !/^var\(--sumi-(?:fg|muted|accent|bg)\)$/.test(s))) return false;
  v = v.replace(/[A-Z]/g, (ch) => ch.toLowerCase());
  if (Object.hasOwn(keywords, prop)) return oneOf(v, keywords[prop] ?? "");
  if (prop === "color" || prop === "background-color") return color(v);
  if (/^border(?:-(?:top|right|bottom|left))?-color$/.test(prop))
    return list(v, color, prop === "border-color" ? 4 : 1);
  if (/^border(?:-(?:top|right|bottom|left))?-style$/.test(prop))
    return list(v, borderStyle, prop === "border-style" ? 4 : 1);
  if (/^border(?:-(?:top|right|bottom|left))?-width$/.test(prop))
    return list(v, absoluteLength, prop === "border-width" ? 4 : 1);
  if (/^border(?:-(?:top|right|bottom|left))?$/.test(prop)) {
    const parts = tokenizeCss(v, " ").parts;
    return (
      parts?.length === 3 &&
      parts.some(absoluteLength) &&
      parts.some(borderStyle) &&
      parts.some(color)
    );
  }
  if (prop === "border-radius") return list(v, length);
  if (/^border-(?:top|bottom)-(?:left|right)-radius$/.test(prop)) return list(v, length, 2);
  if (/^(?:max-width|max-height)$/.test(prop)) return length(v) || v === "none";
  if (/^(?:width|height|min-width|min-height|flex-basis)$/.test(prop))
    return length(v) || v === "auto";
  if (/^(?:top|left|right|bottom)$/.test(prop)) return signedLength(v) || v === "auto";
  if (/^margin(?:-(?:top|right|bottom|left))?$/.test(prop))
    return list(v, (s) => signedLength(s) || s === "auto", prop === "margin" ? 4 : 1);
  if (/^padding(?:-(?:top|right|bottom|left))?$/.test(prop))
    return list(v, length, prop === "padding" ? 4 : 1);
  if (prop === "gap") return list(v, length, 2);
  if (prop === "row-gap" || prop === "column-gap" || prop === "font-size") return length(v);
  if (prop === "letter-spacing") return (signedLength(v) && !v.endsWith("%")) || v === "normal";
  if (prop === "line-height")
    return length(v) || number(v, CSS_LIMITS.lineHeight) || v === "normal";
  if (prop === "font-weight") return oneOf(v, "normal bold 100 200 300 400 500 600 700 800 900");
  if (prop === "opacity") return number(v, 1);
  if (prop === "flex-grow" || prop === "flex-shrink") return number(v, CSS_LIMITS.factor);
  if (prop === "order") return integer(v, CSS_LIMITS.order);
  if (prop === "flex") {
    const parts = tokenizeCss(v, " ").parts;
    return (
      oneOf(v, "none auto initial") ||
      number(v, CSS_LIMITS.factor) ||
      (parts?.length === 3 &&
        number(parts[0] ?? "", CSS_LIMITS.factor) &&
        number(parts[1] ?? "", CSS_LIMITS.factor) &&
        (length(parts[2] ?? "") || parts[2] === "auto"))
    );
  }
  if (/^grid-template-(?:columns|rows)$/.test(prop)) return tracks(v);
  if (/^grid-auto-(?:columns|rows)$/.test(prop)) return list(v, track, 16);
  if (/^grid-(?:column|row)-(?:start|end)$/.test(prop)) return gridLine(v);
  if (prop === "grid-column" || prop === "grid-row") {
    const parts = v.split("/").map((s) => s.trim());
    return parts.length <= 2 && parts.every(gridLine);
  }
  return false;
}
