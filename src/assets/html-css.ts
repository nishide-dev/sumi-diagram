/** Conservative complete-value grammars, shared by every HTML preflight call. */
export function tokenizeCss(source: string, separator: ";" | "," | " "): string[] | undefined {
  const parts: string[] = [];
  let quote = "",
    depth = 0,
    start = 0;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i] ?? "";
    if (quote) {
      if (ch === quote) quote = "";
    } else if (/\s/.test(ch) && !/[ \t\n\f\r]/.test(ch)) return undefined;
    else if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") {
      if (--depth < 0) return undefined;
    } else if (depth === 0 && (separator === " " ? /[ \t\n\f\r]/.test(ch) : ch === separator)) {
      parts.push(source.slice(start, i));
      start = i + 1;
    }
  }
  if (quote || depth) return undefined;
  parts.push(source.slice(start));
  return separator === " " ? parts.filter(Boolean) : parts;
}

const numberPattern = /^(?:\d+(?:\.\d+)?|\.\d+)$/;
const number = (v: string) => numberPattern.test(v) && Number.isFinite(Number(v));
const integer = (v: string) => /^-?\d+$/.test(v) && Number.isSafeInteger(Number(v));
const length = (v: string) => /^(?:0|(?:\d+(?:\.\d+)?|\.\d+)(?:px|pt|em|%))$/.test(v);
const signedLength = (v: string) => length(v.replace(/^-/, ""));
const absoluteLength = (v: string) => length(v) && !v.endsWith("%");
const oneOf = (v: string, words: string) => words.split(" ").includes(v);
const list = (v: string, check: (s: string) => boolean, max = 4) => {
  const values = tokenizeCss(v, " ");
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
  const channels = tokenizeCss(match[2] ?? "", ",")?.map((s) => s.trim());
  return (
    !!channels &&
    channels.length === (match[1] === "rgb" ? 3 : 4) &&
    channels.every((s, i) => number(s) && Number(s) <= (i === 3 ? 1 : 255))
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
    length(v) || /^(?:\d+(?:\.\d+)?|\.\d+)fr$/.test(v) || oneOf(v, "auto min-content max-content")
  );
}
function tracks(v: string): boolean {
  return list(
    v,
    (s) => {
      if (track(s)) return true;
      const repeat = /^repeat\(([1-9]\d*),(.+)\)$/.exec(s);
      return !!repeat && Number(repeat[1]) <= 64 && list((repeat[2] ?? "").trim(), track, 16);
    },
    16,
  );
}
function gridLine(v: string): boolean {
  return v === "auto" || (integer(v) && Number(v) !== 0) || /^span [1-9]\d*$/.test(v);
}

export function validCssValue(prop: string, v: string): boolean {
  if (Object.hasOwn(keywords, prop)) return oneOf(v, keywords[prop] ?? "");
  if (prop === "font-family") {
    const families = tokenizeCss(v, ",");
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
  if (prop === "color" || prop === "background-color") return color(v);
  if (/^border(?:-(?:top|right|bottom|left))?-color$/.test(prop))
    return list(v, color, prop === "border-color" ? 4 : 1);
  if (/^border(?:-(?:top|right|bottom|left))?-style$/.test(prop))
    return list(v, borderStyle, prop === "border-style" ? 4 : 1);
  if (/^border(?:-(?:top|right|bottom|left))?-width$/.test(prop))
    return list(v, absoluteLength, prop === "border-width" ? 4 : 1);
  if (/^border(?:-(?:top|right|bottom|left))?$/.test(prop)) {
    const parts = tokenizeCss(v, " ");
    return (
      parts?.length === 3 &&
      absoluteLength(parts[0] ?? "") &&
      borderStyle(parts[1] ?? "") &&
      color(parts[2] ?? "")
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
  if (prop === "line-height") return length(v) || number(v) || v === "normal";
  if (prop === "font-weight") return oneOf(v, "normal bold 100 200 300 400 500 600 700 800 900");
  if (prop === "opacity") return number(v) && Number(v) <= 1;
  if (prop === "flex-grow" || prop === "flex-shrink") return number(v);
  if (prop === "order") return integer(v);
  if (prop === "flex") {
    const parts = tokenizeCss(v, " ");
    return (
      oneOf(v, "none auto initial") ||
      (parts?.length === 3 &&
        number(parts[0] ?? "") &&
        number(parts[1] ?? "") &&
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
