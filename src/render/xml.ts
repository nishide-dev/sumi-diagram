/**
 * A minimal, strict, non-validating XML parser for the SVG that D2 writes.
 *
 * Safety by construction (design doc §6.1):
 * - Document type declarations (`<!DOCTYPE …>`) are rejected, so there are no
 *   internal or external entities: XXE and entity-expansion attacks ("billion
 *   laughs") cannot happen.
 * - Only the five predefined entities and numeric character references are
 *   decoded; any other entity reference is an error.
 * - Processing instructions other than the leading XML declaration are
 *   rejected (`<?xml-stylesheet?>` would make viewers fetch resources).
 * - Nothing is executed or fetched: `<script>` and event attributes are plain
 *   data here.
 * - Parsing is iterative (no recursion), so deep nesting cannot overflow the
 *   stack.
 *
 * Elements keep source offsets so callers can edit the document by splicing
 * the original text instead of re-serializing it (finalization must leave
 * D2's bytes untouched).
 */

export interface XmlAttribute {
  name: string;
  /** Decoded value. */
  value: string;
}

export interface XmlElement {
  type: "element";
  name: string;
  /** In source order; names are unique. */
  attributes: XmlAttribute[];
  children: XmlNode[];
  /** Offset of the `<` that opens the start tag. */
  start: number;
  /** Offset just past the `>` of the start tag (or of `/>`). */
  startTagEnd: number;
  /** Offset just past the end tag (equals {@link startTagEnd} for `<a/>`). */
  end: number;
}

export interface XmlText {
  type: "text";
  /** Decoded character data (CDATA sections included verbatim). */
  text: string;
}

export type XmlNode = XmlElement | XmlText;

export type XmlParseResult =
  | { ok: true; root: XmlElement }
  | { ok: false; message: string; line: number; column: number };

class XmlError extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(message);
  }
}

const NAME_START = /[A-Za-z_:À-￿]/;
const NAME = /[A-Za-z0-9_:.\-·À-￿]*/y;
const WHITESPACE = /[ \t\r\n]*/y;
const XML_DECLARATION = /<\?xml[ \t\r\n][^?]*\?>/y;

/** The predefined entities. A `Map`, so names such as `constructor` never resolve through a prototype. */
const PREDEFINED_ENTITIES: ReadonlyMap<string, string> = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
]);

/** `true` for a code point allowed in XML 1.0 documents. */
function isXmlChar(code: number): boolean {
  return (
    code === 0x9 ||
    code === 0xa ||
    code === 0xd ||
    (code >= 0x20 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0xfffd) ||
    (code >= 0x10000 && code <= 0x10ffff)
  );
}

/**
 * Rejects characters outside the XML 1.0 `Char` production anywhere in the
 * document (text, attribute values, CDATA, comments, markup): C0 controls
 * other than tab / LF / CR, lone surrogates, U+FFFE and U+FFFF. Scans by code
 * point and reports the offset of the offending UTF-16 unit.
 */
function checkCharacters(text: string): void {
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0x20 && unit < 0xd800) continue;
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        i++; // A valid surrogate pair: a supplementary-plane character.
        continue;
      }
      throw new XmlError("Unpaired surrogate (invalid UTF-16) in the document.", i);
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new XmlError("Unpaired surrogate (invalid UTF-16) in the document.", i);
    }
    if (!isXmlChar(unit)) {
      const hex = unit.toString(16).toUpperCase().padStart(4, "0");
      throw new XmlError(`Character U+${hex} is not allowed in XML.`, i);
    }
  }
}

/** Decodes entity and character references in `raw`, which starts at `offset` in the document. */
function decode(raw: string, offset: number): string {
  if (!raw.includes("&")) return raw;
  let out = "";
  let last = 0;
  for (let at = raw.indexOf("&"); at !== -1; at = raw.indexOf("&", last)) {
    out += raw.slice(last, at);
    const semi = raw.indexOf(";", at);
    if (semi === -1) throw new XmlError("Unterminated entity reference.", offset + at);
    const ref = raw.slice(at + 1, semi);
    let decoded: string | undefined;
    const numeric = /^#(?:x([0-9A-Fa-f]{1,6})|([0-9]{1,7}))$/.exec(ref);
    if (numeric) {
      const code =
        numeric[1] !== undefined ? Number.parseInt(numeric[1], 16) : Number(numeric[2] ?? "");
      if (!isXmlChar(code)) {
        throw new XmlError(
          `Character reference "&${ref};" is not a valid XML character.`,
          offset + at,
        );
      }
      decoded = String.fromCodePoint(code);
    } else {
      decoded = PREDEFINED_ENTITIES.get(ref);
    }
    if (decoded === undefined) {
      throw new XmlError(
        `Undefined entity "&${ref};"; only the predefined XML entities and character references are allowed.`,
        offset + at,
      );
    }
    out += decoded;
    last = semi + 1;
  }
  return out + raw.slice(last);
}

/** Converts an offset into a 1-based line and column. */
export function position(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = text.indexOf("\n"); i !== -1 && i < offset; i = text.indexOf("\n", i + 1)) {
    line++;
    lineStart = i + 1;
  }
  return { line, column: offset - lineStart + 1 };
}

/** Parses an XML document with a single root element. Never throws. */
export function parseXml(text: string): XmlParseResult {
  try {
    return { ok: true, root: new Parser(text).document() };
  } catch (error) {
    if (!(error instanceof XmlError)) throw error;
    return { ok: false, message: error.message, ...position(text, error.offset) };
  }
}

class Parser {
  private pos = 0;

  constructor(private readonly text: string) {}

  document(): XmlElement {
    checkCharacters(this.text);
    if (this.text.startsWith("﻿")) this.pos = 1;
    XML_DECLARATION.lastIndex = this.pos;
    if (XML_DECLARATION.test(this.text)) this.pos = XML_DECLARATION.lastIndex;
    this.misc();
    if (this.pos >= this.text.length || this.text[this.pos] !== "<") {
      throw new XmlError("Expected a root element.", this.pos);
    }
    const root = this.element();
    this.misc();
    if (this.pos < this.text.length) {
      throw new XmlError("Unexpected content after the root element.", this.pos);
    }
    return root;
  }

  /** Skips whitespace and comments outside the root element. */
  private misc(): void {
    for (;;) {
      this.skipWhitespace();
      if (this.text.startsWith("<!--", this.pos)) this.comment();
      else if (this.text.startsWith("<!DOCTYPE", this.pos)) {
        throw new XmlError("Document type declarations (DOCTYPE) are not allowed.", this.pos);
      } else if (this.text.startsWith("<?", this.pos)) {
        throw new XmlError("Processing instructions are not allowed.", this.pos);
      } else return;
    }
  }

  private skipWhitespace(): void {
    WHITESPACE.lastIndex = this.pos;
    WHITESPACE.test(this.text);
    this.pos = WHITESPACE.lastIndex;
  }

  private comment(): void {
    const close = this.text.indexOf("-->", this.pos + 4);
    if (close === -1) throw new XmlError("Unterminated comment.", this.pos);
    if (this.text.slice(this.pos + 4, close).includes("--")) {
      throw new XmlError('"--" is not allowed inside a comment.', this.pos);
    }
    this.pos = close + 3;
  }

  private name(): string {
    const start = this.pos;
    if (!NAME_START.test(this.text[start] ?? "")) throw new XmlError("Expected a name.", start);
    NAME.lastIndex = start + 1;
    NAME.test(this.text);
    this.pos = NAME.lastIndex;
    return this.text.slice(start, this.pos);
  }

  /** Parses the element at `pos` (which is at `<`) and all its content, iteratively. */
  private element(): XmlElement {
    const root = this.startTag();
    const stack: XmlElement[] = root.end === -1 ? [root] : [];
    while (stack.length > 0) {
      const current = stack[stack.length - 1] as XmlElement;
      const lt = this.text.indexOf("<", this.pos);
      if (lt === -1) throw new XmlError(`Unclosed element <${current.name}>.`, current.start);
      if (lt > this.pos) this.characterData(current, this.pos, lt);
      this.pos = lt;
      if (this.text.startsWith("</", lt)) {
        this.pos += 2;
        const name = this.name();
        this.skipWhitespace();
        if (this.text[this.pos] !== ">") throw new XmlError("Expected '>'.", this.pos);
        if (name !== current.name) {
          throw new XmlError(`Expected </${current.name}>, found </${name}>.`, lt);
        }
        this.pos++;
        current.end = this.pos;
        stack.pop();
      } else if (this.text.startsWith("<!--", lt)) {
        this.comment();
      } else if (this.text.startsWith("<![CDATA[", lt)) {
        const close = this.text.indexOf("]]>", lt + 9);
        if (close === -1) throw new XmlError("Unterminated CDATA section.", lt);
        this.appendText(current, this.text.slice(lt + 9, close));
        this.pos = close + 3;
      } else if (this.text.startsWith("<!", lt)) {
        throw new XmlError("Markup declarations (<!…>) are not allowed.", lt);
      } else if (this.text.startsWith("<?", lt)) {
        throw new XmlError("Processing instructions are not allowed.", lt);
      } else {
        const child = this.startTag();
        current.children.push(child);
        if (child.end === -1) stack.push(child);
      }
    }
    return root;
  }

  /** Character data between `from` and `to`. */
  private characterData(parent: XmlElement, from: number, to: number): void {
    const raw = this.text.slice(from, to);
    const bad = raw.indexOf("]]>");
    if (bad !== -1) throw new XmlError('"]]>" is not allowed in text.', from + bad);
    this.appendText(parent, decode(raw, from));
  }

  private appendText(parent: XmlElement, text: string): void {
    const last = parent.children[parent.children.length - 1];
    if (last?.type === "text") last.text += text;
    else parent.children.push({ type: "text", text });
  }

  /** Parses a start tag at `pos`; `end` is -1 unless the element is empty (`/>`). */
  private startTag(): XmlElement {
    const start = this.pos;
    this.pos++;
    const name = this.name();
    const attributes: XmlAttribute[] = [];
    const seen = new Set<string>();
    for (;;) {
      const before = this.pos;
      this.skipWhitespace();
      const char = this.text[this.pos];
      if (char === ">" || (char === "/" && this.text[this.pos + 1] === ">")) {
        this.pos += char === ">" ? 1 : 2;
        const empty = char === "/";
        return {
          type: "element",
          name,
          attributes,
          children: [],
          start,
          startTagEnd: this.pos,
          end: empty ? this.pos : -1,
        };
      }
      if (char === undefined) throw new XmlError(`Unterminated start tag <${name}>.`, start);
      if (this.pos === before)
        throw new XmlError("Expected whitespace before an attribute.", before);
      const attrStart = this.pos;
      const attrName = this.name();
      if (seen.has(attrName)) {
        throw new XmlError(`Duplicate attribute "${attrName}" on <${name}>.`, attrStart);
      }
      seen.add(attrName);
      this.skipWhitespace();
      if (this.text[this.pos] !== "=")
        throw new XmlError(`Expected '=' after "${attrName}".`, this.pos);
      this.pos++;
      this.skipWhitespace();
      const quote = this.text[this.pos];
      if (quote !== '"' && quote !== "'") {
        throw new XmlError(`Expected a quoted value for "${attrName}".`, this.pos);
      }
      const close = this.text.indexOf(quote, this.pos + 1);
      if (close === -1) throw new XmlError(`Unterminated value of "${attrName}".`, this.pos);
      const raw = this.text.slice(this.pos + 1, close);
      if (raw.includes("<"))
        throw new XmlError(`'<' is not allowed in the value of "${attrName}".`, this.pos);
      attributes.push({ name: attrName, value: decode(raw, this.pos + 1) });
      this.pos = close + 1;
    }
  }
}

/** The value of an attribute, if present. */
export function attribute(element: XmlElement, name: string): string | undefined {
  return element.attributes.find((a) => a.name === name)?.value;
}

/** The whitespace-separated class list of an element. */
export function classList(element: XmlElement): string[] {
  return (attribute(element, "class") ?? "").split(/[ \t\r\n]+/).filter((c) => c !== "");
}

/** Child elements (text skipped). */
export function childElements(element: XmlElement): XmlElement[] {
  return element.children.filter((c): c is XmlElement => c.type === "element");
}

/** All character data inside an element, in document order. */
export function textContent(element: XmlElement): string {
  let out = "";
  const stack: XmlNode[] = [...element.children].reverse();
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if (node.type === "text") out += node.text;
    else stack.push(...[...node.children].reverse());
  }
  return out;
}

/** Every descendant element in document order (pre-order), excluding `element` itself. */
export function* descendants(element: XmlElement): Generator<XmlElement> {
  const stack: XmlElement[] = childElements(element).reverse();
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    yield node;
    stack.push(...childElements(node).reverse());
  }
}

/** Escapes text for an attribute value in double quotes. */
export function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
