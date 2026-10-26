/**
 * Label math (#93, design doc §6.24): a TeX-like subset in `$...$` spans of
 * a label, parsed into runs of real text. Pure: no fonts, no I/O.
 *
 * Outside `$...$`, a label is literal text, except that `\$` is a literal
 * dollar sign. Inside, the subset is:
 *
 * - Latin letters and lowercase Greek (`\alpha` … `\omega`, or typed as
 *   `α`) are math variables, drawn italic; digits, uppercase Greek and
 *   symbols upright (TeX's conventions). Spaces are ignored, as in TeX.
 * - `_` and `^` take one character, command or `{group}` as a subscript /
 *   superscript (one level; a base may have both, drawn one after the other).
 * - Symbol commands (`\times`, `\leq`, `\to`, …, see `symbols.ts`), with TeX's
 *   automatic spaces around binary operators and relations; explicit spaces
 *   `\,` `\:` `\;` `\ ` `\quad` `\qquad` and `~`.
 * - `\mathrm{…}`, `\mathit{…}`, `\operatorname{…}`, function names (`\log`,
 *   `\exp`, …), and `\text{…}` for text in the label's own font.
 *
 * Anything else (`\frac`, `\sqrt`, environments, `$$`, a `$` not closed on
 * its line, …) is an error with its position in the label, not a guess.
 */

import {
  ASCII_SYMBOLS,
  FUNCTION_COMMANDS,
  type MathClass,
  type MathSymbol,
  MEDIUM_SPACE,
  SPACE_COMMANDS,
  SYMBOL_COMMANDS,
  THICK_SPACE,
  UNICODE_SYMBOLS,
} from "./symbols";

/** The font a run is drawn in: the label's own font, or the font set's math fonts. */
export type RunFont = "text" | "math" | "math-italic";
export type RunScript = "base" | "sub" | "sup";

/** A piece of a label line drawn in one font at one script level. */
export interface MarkupRun {
  readonly text: string;
  readonly font: RunFont;
  readonly script: RunScript;
}

/** A problem in a label's markup: `start` / `end` are UTF-16 offsets into the label. */
export interface MarkupError {
  readonly start: number;
  readonly end: number;
  readonly message: string;
  readonly hint?: string;
}

export interface ParsedLabel {
  /** The label's `\n`-separated lines as runs, before whitespace collapsing. */
  readonly lines: readonly (readonly MarkupRun[])[];
  /** Whether the label has a `$...$` span. */
  readonly hasMath: boolean;
}

export type ParseLabelResult =
  | { readonly ok: true; readonly value: ParsedLabel }
  | { readonly ok: false; readonly errors: readonly MarkupError[] };

/** Whether a label may contain markup (`$` or `\$`); labels without it are plain text. */
export function hasLabelMarkup(label: string): boolean {
  return label.includes("$");
}

const SUPPORTED_HINT =
  "Label math supports letters, digits, Greek letters (\\alpha), _ and ^, symbols such as \\times, \\leq and \\to, \\mathrm{…}, \\mathit{…} and \\text{…}.";
const DOLLAR_HINT = "Write \\$ for a literal dollar sign.";

class MathError extends Error {
  constructor(
    readonly start: number,
    readonly end: number,
    message: string,
    readonly hint: string = SUPPORTED_HINT,
  ) {
    super(message);
  }
}

/** Parses a label (see the module comment). Collects one error per `$...$` span. */
export function parseLabel(label: string): ParseLabelResult {
  const errors: MarkupError[] = [];
  const lines: MarkupRun[][] = [];
  let hasMath = false;
  let lineStart = 0;
  for (const line of label.split("\n")) {
    const runs: MarkupRun[] = [];
    const push = (run: MarkupRun) => {
      if (run.text === "") return;
      const last = runs.at(-1);
      if (last !== undefined && last.font === run.font && last.script === run.script) {
        runs[runs.length - 1] = { ...last, text: last.text + run.text };
      } else runs.push(run);
    };
    let i = 0;
    while (i < line.length) {
      const c = line[i] as string;
      if (c === "\\" && line[i + 1] === "$") {
        push({ text: "$", font: "text", script: "base" });
        i += 2;
        continue;
      }
      if (c !== "$") {
        push({ text: c, font: "text", script: "base" });
        i++;
        continue;
      }
      hasMath = true;
      const close = closingDollar(line, i + 1);
      if (close === undefined) {
        errors.push({
          start: lineStart + i,
          end: lineStart + i + 1,
          message: 'This "$" starts label math that is not closed by a "$" on the same line.',
          hint: DOLLAR_HINT,
        });
        break;
      }
      if (close === i + 1) {
        errors.push({
          start: lineStart + i,
          end: lineStart + i + 2,
          message: 'Empty label math "$$" (display math is not supported).',
          hint: DOLLAR_HINT,
        });
        i += 2;
        continue;
      }
      try {
        const parser = new MathParser(line, i + 1, close, lineStart);
        for (const run of parser.parse()) push(run);
      } catch (e) {
        if (!(e instanceof MathError)) throw e;
        errors.push({ start: e.start, end: e.end, message: e.message, hint: e.hint });
      }
      i = close + 1;
    }
    lines.push(runs);
    lineStart += line.length + 1;
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { lines, hasMath } };
}

/**
 * Whether a label has a closed `$...$` span (on one line, `\$` escaped)
 * whose content uses a command, `_` or `^`: what is clearly math rather than
 * dollar amounts such as "$5 or $10". Used where math is not drawn (`auto`).
 */
export function looksLikeMath(label: string): boolean {
  for (const line of label.split("\n")) {
    let i = 0;
    while (i < line.length) {
      if (line[i] === "\\" && line[i + 1] === "$") i += 2;
      else if (line[i] === "$") {
        const close = closingDollar(line, i + 1);
        if (close === undefined) break;
        if (/[\\_^]/.test(line.slice(i + 1, close))) return true;
        i = close + 1;
      } else i++;
    }
  }
  return false;
}

/** The index of the `$` closing a span that starts at `from`; `\` escapes the next character. */
function closingDollar(line: string, from: number): number | undefined {
  for (let i = from; i < line.length; i++) {
    if (line[i] === "\\") i++;
    else if (line[i] === "$") return i;
  }
  return undefined;
}

type FontStyle = "default" | "rm" | "it";

/** An atom of a math list: its class and its runs (nucleus, then scripts). */
interface Atom {
  /** `glue` is an explicit space: drawn, but it does not take part in automatic spacing. */
  cls: MathClass | "glue";
  runs: MarkupRun[];
  hasSub: boolean;
  hasSup: boolean;
  start: number;
}

const isLetter = (c: string) => /^[A-Za-z]$/.test(c);
const isDigit = (c: string) => /^[0-9]$/.test(c);
const isWhitespace = (c: string) => /^\s$/.test(c);

/** Nested groups (`{…}`, font commands) a label may open: deeper input is an error, not a stack overflow. */
const MAX_DEPTH = 32;

class MathParser {
  #pos: number;
  #depth = 0;

  constructor(
    readonly line: string,
    from: number,
    readonly end: number,
    /** Offset of `line` in the label, for error positions. */
    readonly offset: number,
  ) {
    this.#pos = from;
  }

  parse(): MarkupRun[] {
    const atoms = this.#list("top", false, "default");
    return emit(atoms, true);
  }

  #error(start: number, end: number, message: string, hint?: string): never {
    throw new MathError(this.offset + start, this.offset + end, message, hint);
  }

  #peek(): string | undefined {
    return this.#pos < this.end ? this.line[this.#pos] : undefined;
  }

  #skipSpace(): void {
    while (this.#pos < this.end && isWhitespace(this.line[this.#pos] as string)) this.#pos++;
  }

  /**
   * A group's list: `opened` is the offset of its `{`, which must be at the
   * cursor. Consumes the closing `}`.
   */
  #group(script: boolean, font: FontStyle): Atom[] {
    const opened = this.#pos;
    if (++this.#depth > MAX_DEPTH) {
      this.#error(opened, opened + 1, `Label math nests more than ${MAX_DEPTH} groups.`);
    }
    this.#pos++;
    const atoms = this.#list("group", script, font, opened);
    this.#pos++; // the closing }
    this.#depth--;
    return atoms;
  }

  /** A math list until `}` (inside a group opened at `opened`) or the end of the span. */
  #list(until: "top" | "group", script: boolean, font: FontStyle, opened = -1): Atom[] {
    const atoms: Atom[] = [];
    for (;;) {
      this.#skipSpace();
      const c = this.#peek();
      if (c === undefined) {
        if (until === "group") {
          this.#error(opened, opened + 1, 'This "{" in label math is not closed by "}".');
        }
        return atoms;
      }
      const start = this.#pos;
      if (c === "}") {
        if (until === "group") return atoms;
        this.#error(start, start + 1, 'Unmatched "}" in label math.', "Write \\} for a brace.");
      }
      if (c === "_" || c === "^") {
        const kind = c === "_" ? "sub" : "sup";
        const name = kind === "sub" ? "subscript" : "superscript";
        if (script) {
          this.#error(
            start,
            start + 1,
            `Nested scripts are not supported in label math (a ${name} inside a subscript or superscript).`,
            "Write the script in one level, e.g. x_{i1} or x_{\\text{in}}.",
          );
        }
        this.#pos++;
        let base = atoms.at(-1);
        if (base === undefined || base.cls === "glue") {
          base = { cls: "ord", runs: [], hasSub: false, hasSup: false, start };
          atoms.push(base);
        }
        if (kind === "sub" ? base.hasSub : base.hasSup) {
          this.#error(
            start,
            start + 1,
            `Double ${name}: the base already has one.`,
            `Use braces, e.g. x_{12}.`,
          );
        }
        this.#skipSpace();
        const argStart = this.#pos;
        const arg = this.#argument(font, start);
        const runs = emit(arg, false).map((r): MarkupRun => ({ ...r, script: kind }));
        if (!runs.some((r) => r.text.trim() !== "")) {
          this.#error(
            start,
            Math.max(this.#pos, argStart + 1),
            `Empty ${name} after "${c}".`,
            "Write a character, a command or {…} after it.",
          );
        }
        base.runs.push(...runs);
        if (kind === "sub") base.hasSub = true;
        else base.hasSup = true;
        continue;
      }
      atoms.push(...this.#atom(font, script));
    }
  }

  /** A script's argument (after the `_` / `^` at `marker`): one character, one command or a `{group}`. */
  #argument(font: FontStyle, marker: number): Atom[] {
    const c = this.#peek();
    const start = this.#pos;
    if (c === undefined) {
      this.#error(
        marker,
        marker + 1,
        `A subscript or superscript is missing after this "${this.line[marker]}".`,
        "Write a character, a command or {…} after it.",
      );
    }
    if (c === "_" || c === "^" || c === "}") {
      this.#error(
        start,
        start + 1,
        `"${c}" cannot start a subscript or superscript.`,
        "Write a character, a command or {…} after it.",
      );
    }
    if (c === "{") return this.#group(true, font);
    return this.#atom(font, true);
  }

  /** One atom (or, for a group, the atoms of its list flattened into one). */
  #atom(font: FontStyle, script: boolean): Atom[] {
    const start = this.#pos;
    const c = this.#peek() as string;
    const atom = (cls: Atom["cls"], runs: MarkupRun[]): Atom[] => [
      { cls, runs, hasSub: false, hasSup: false, start },
    ];
    if (c === "{") return atom("ord", emit(this.#group(script, font), !script));
    if (c === "\\") return this.#command(font, script);
    this.#pos += c.length;
    if (c === "~") return atom("glue", [mathRun(" ", "math")]);
    if (isLetter(c)) return atom("ord", [mathRun(c, font === "rm" ? "math" : "math-italic")]);
    if (isDigit(c)) return atom("ord", [mathRun(c, font === "it" ? "math-italic" : "math")]);
    const symbol = ASCII_SYMBOLS.get(c) ?? UNICODE_SYMBOLS.get(c);
    if (symbol !== undefined) return atom(symbol.cls, [symbolRun(symbol, font)]);
    // A character outside the BMP is two UTF-16 units; report it whole.
    const char = String.fromCodePoint(this.line.codePointAt(start) ?? 0);
    this.#pos = start + char.length;
    this.#error(
      start,
      start + char.length,
      `The character "${char}" is not supported in label math.`,
      "Put text in \\text{…}, or move it outside the $…$.",
    );
  }

  #command(font: FontStyle, script: boolean): Atom[] {
    const start = this.#pos;
    this.#pos++; // the backslash
    const rest = this.line.slice(this.#pos, this.end);
    // A control word, or one control symbol (a whole code point).
    const symbolPoint = rest.codePointAt(0);
    const name =
      /^[A-Za-z]+/.exec(rest)?.[0] ??
      (symbolPoint === undefined ? undefined : String.fromCodePoint(symbolPoint));
    if (name === undefined) {
      this.#error(
        start,
        start + 1,
        'A "\\" at the end of label math has no command.',
        SUPPORTED_HINT,
      );
    }
    this.#pos += name.length;
    const end = this.#pos;
    const atom = (cls: Atom["cls"], runs: MarkupRun[]): Atom[] => [
      { cls, runs, hasSub: false, hasSup: false, start },
    ];
    const space = SPACE_COMMANDS.get(name);
    if (space !== undefined) return atom("glue", [mathRun(space, "math")]);
    const symbol = SYMBOL_COMMANDS.get(name);
    if (symbol !== undefined) return atom(symbol.cls, [symbolRun(symbol, font)]);
    if (FUNCTION_COMMANDS.has(name)) return atom("ord", [mathRun(name, "math")]);
    switch (name) {
      case "mathrm":
      case "mathit":
      case "operatorname": {
        const inner = this.#braced(name, start, (opened) =>
          this.#list("group", script, name === "mathit" ? "it" : "rm", opened),
        );
        return atom("ord", emit(inner, !script));
      }
      case "text":
      case "textrm":
      case "mbox":
        return atom("ord", [
          { text: this.#braced(name, start, () => this.#text()), font: "text", script: "base" },
        ]);
    }
    this.#error(
      start,
      end,
      `The command "\\${name}" is not supported in label math.`,
      SUPPORTED_HINT,
    );
  }

  /** Runs `body` on the `{…}` argument of a command, which must be in braces. */
  #braced<T>(name: string, start: number, body: (opened: number) => T): T {
    const end = this.#pos;
    this.#skipSpace();
    if (this.#peek() !== "{") {
      this.#error(start, end, `"\\${name}" needs its argument in braces, e.g. \\${name}{…}.`);
    }
    const opened = this.#pos;
    if (++this.#depth > MAX_DEPTH) {
      this.#error(opened, opened + 1, `Label math nests more than ${MAX_DEPTH} groups.`);
    }
    this.#pos++;
    const value = body(opened);
    if (this.#peek() !== "}") {
      this.#error(opened, opened + 1, `The argument of "\\${name}" is not closed by "}".`);
    }
    this.#pos++;
    this.#depth--;
    return value;
  }

  /** The literal text of `\text{…}` up to its closing brace (balanced braces; `\` escapes one character). */
  #text(): string {
    let depth = 0;
    let out = "";
    while (this.#pos < this.end) {
      const c = this.line[this.#pos] as string;
      if (c === "\\") {
        const next = this.line[this.#pos + 1];
        if (next !== undefined && "{}$\\%&#_".includes(next) && this.#pos + 1 < this.end) {
          out += next;
          this.#pos += 2;
          continue;
        }
        this.#error(
          this.#pos,
          this.#pos + 1,
          "Commands are not supported in \\text{…}; write \\{, \\}, \\$ or \\\\ for those characters.",
        );
      }
      if (c === "{" && this.#depth + ++depth > MAX_DEPTH) {
        this.#error(this.#pos, this.#pos + 1, `Label math nests more than ${MAX_DEPTH} groups.`);
      }
      if (c === "}") {
        if (depth === 0) return out;
        depth--;
      }
      out += c;
      this.#pos++;
    }
    return out;
  }
}

const mathRun = (text: string, font: RunFont): MarkupRun => ({ text, font, script: "base" });

function symbolRun(symbol: MathSymbol, font: FontStyle): MarkupRun {
  const italic =
    font === "it"
      ? symbol.greek === true || /^[A-Za-z0-9]$/.test(symbol.char)
      : font === "rm"
        ? false
        : symbol.italic === true;
  return mathRun(symbol.char, italic ? "math-italic" : "math");
}

/**
 * The runs of a math list: atoms in order, with TeX's automatic spaces
 * between them when `spacing` (not in scripts). A binary operator with no
 * operand before it (first, or after an operator, relation, opening or
 * punctuation) or after it (before a relation, closing, punctuation or the
 * end) is ordinary, like TeX's rules 5 and 6 (The TeXbook, appendix G):
 * `$-1$` has no space after the minus.
 */
function emit(atoms: readonly Atom[], spacing: boolean): MarkupRun[] {
  const classes = atoms.map((a) => a.cls);
  const visible = classes.flatMap((cls, i) => (cls === "glue" ? [] : [i]));
  for (const [k, i] of visible.entries()) {
    if (classes[i] !== "bin") continue;
    const prev = k === 0 ? undefined : classes[visible[k - 1] as number];
    if (prev === undefined || ["bin", "rel", "open", "punct"].includes(prev)) classes[i] = "ord";
  }
  for (const [k, i] of visible.entries()) {
    if (classes[i] !== "bin") continue;
    const next = k + 1 < visible.length ? classes[visible[k + 1] as number] : undefined;
    if (next === undefined || ["rel", "close", "punct"].includes(next)) classes[i] = "ord";
  }
  const out: MarkupRun[] = [];
  let prev: MathClass | undefined;
  for (const [i, atom] of atoms.entries()) {
    const cls = classes[i] as Atom["cls"];
    if (cls !== "glue") {
      const space = spacing && prev !== undefined ? spaceBetween(prev, cls) : "";
      if (space !== "") out.push(mathRun(space, "math"));
      prev = cls;
    }
    out.push(...atom.runs);
  }
  return out;
}

/** TeX's spaces between atoms in text style (The TeXbook, ch. 18), for the classes kept here. */
function spaceBetween(left: MathClass, right: MathClass): string {
  if (right === "bin") return left === "ord" || left === "close" ? MEDIUM_SPACE : "";
  if (left === "bin") return right === "ord" || right === "open" ? MEDIUM_SPACE : "";
  if (right === "rel")
    return left === "ord" || left === "close" || left === "punct" ? THICK_SPACE : "";
  if (left === "rel") return right === "ord" || right === "open" ? THICK_SPACE : "";
  return "";
}
