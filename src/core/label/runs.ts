/**
 * The runs a structured figure draws a label with (#93, design doc §6.24):
 * the parsed markup (`math.ts`) with font classes resolved, characters the
 * Latin font has moved to it (#172, §6.44), characters the label's font lacks
 * moved to the math font, and whitespace collapsed as an SVG `<text>` without
 * `xml:space` draws it. Shared by the layout engine (to
 * measure), the structural lint (`lint/missing-glyph`) and, through the
 * Layout IR, the SVG writer, so all three see the same runs.
 */

import { type MarkupRun, mergeableRuns, parseLabel, type RunScript } from "./math";

/** A run with its font class (`regular`, `bold`, …, `math`, `math-italic`). */
export interface LabelRun {
  readonly text: string;
  /** Font class, as in `LabelGeometry.font`: selects the font set's file. */
  readonly font: string;
  readonly script: RunScript;
  /** A combining accent over the run's one character (#129), drawn in the run's font. */
  readonly accent?: string;
}

export interface LabelRunsOptions {
  /** The label's own font class (`regular`, `bold`, `mono`, …), for text outside math. */
  readonly font: string;
  /**
   * Whether a font class has a glyph for a code point. Text characters the
   * label's font lacks but the `math` font has are drawn with the `math`
   * font. Without it, nothing falls back.
   */
  readonly covers?: (font: string, codePoint: number) => boolean;
  /**
   * The Latin font class for a label font class, if the font set has one
   * (#172: `regular` → `latin`, `bold` → `latin-bold`). Text characters that
   * font has are drawn with it (before the math fallback). Needs `covers`.
   */
  readonly latin?: (font: string) => string | undefined;
}

/**
 * Script sizes and baseline shifts, as fractions of the label's font size:
 * STIX Two Math's `MATH` constants (ScriptPercentScaleDown 70,
 * SubscriptShiftDown 210, SuperscriptShiftUp 360 per 1000 units).
 */
export const SCRIPT_SCALE = 0.7;
export const SUBSCRIPT_SHIFT = 0.21;
export const SUPERSCRIPT_SHIFT = 0.36;

/** A run's size and baseline offset (positive down) at a label font size. */
export function scriptGeometry(
  script: RunScript,
  fontSize: number,
): { fontSize: number; shift: number } {
  if (script === "base") return { fontSize, shift: 0 };
  return {
    fontSize: fontSize * SCRIPT_SCALE,
    shift: (script === "sub" ? SUBSCRIPT_SHIFT : -SUPERSCRIPT_SHIFT) * fontSize,
  };
}

/** The math fonts' classes (SVG class `text-math`, `text-math-italic`). */
export const MATH_FONT = "math";
export const MATH_ITALIC_FONT = "math-italic";

/** The Latin fonts' classes (#172; SVG class `text-latin`, `text-latin-bold`). */
export const LATIN_FONT = "latin";
export const LATIN_BOLD_FONT = "latin-bold";

export interface LabelLayoutText {
  /** The lines as drawn (whitespace collapsed, `\$` unescaped). */
  readonly lines: string[];
  /**
   * The runs of each line; omitted when every line is one run in the
   * label's own font (no math, nothing falls back), which keeps such labels
   * on the plain one-font path.
   */
  readonly runs?: LabelRun[][];
  /**
   * The font class the whole label is drawn in, when it is not the label's
   * own: a label whose every run is in the Latin font (#172) is drawn as
   * plain text in that font.
   */
  readonly font?: string;
}

/**
 * The lines and runs of a label (see the module comment). Throws if the
 * label's markup is invalid: the `component` stage reports that before
 * anything is laid out.
 */
export function labelRuns(label: string, options: LabelRunsOptions): LabelLayoutText {
  const parsed = parseLabel(label);
  if (!parsed.ok) {
    throw new Error(`internal error: invalid label markup: ${parsed.errors[0]?.message}`);
  }
  const { font, covers } = options;
  const latin = options.latin?.(font);
  const resolve = (run: MarkupRun): LabelRun => ({
    text: run.text,
    font: run.font === "text" ? font : run.font,
    script: run.script,
    ...(run.accent !== undefined && { accent: run.accent }),
  });
  let lines = parsed.value.lines.map((line) => line.map(resolve));
  if (covers !== undefined) {
    lines = lines.map((line) => line.flatMap((run) => fallback(run, font, covers, latin)));
  }
  const runs = collapse(lines);
  const plainIn = (f: string) =>
    runs.every(
      (line) => line.length <= 1 && line.every((r) => r.font === f && r.script === "base"),
    );
  if (plainIn(font)) return { lines: runLines(runs) };
  // A label wholly in the Latin font is plain text in that font (and has some text).
  if (latin !== undefined && runs.some((line) => line.length > 0) && plainIn(latin)) {
    return { lines: runLines(runs), font: latin };
  }
  return { lines: runLines(runs), runs };
}

/**
 * Splits a text run into the characters the Latin font has (if any) and,
 * of the rest, the ones its font lacks but the math font has.
 */
function fallback(
  run: LabelRun,
  font: string,
  covers: (font: string, codePoint: number) => boolean,
  latin: string | undefined,
): LabelRun[] {
  if (run.font !== font) return [run];
  const out: LabelRun[] = [];
  for (const char of run.text) {
    const codePoint = char.codePointAt(0) ?? 0;
    const target =
      latin !== undefined && covers(latin, codePoint)
        ? latin
        : !covers(font, codePoint) && covers(MATH_FONT, codePoint)
          ? MATH_FONT
          : font;
    const last = out.at(-1);
    if (last !== undefined && last.font === target)
      out[out.length - 1] = { ...last, text: last.text + char };
    else out.push({ text: char, font: target, script: run.script });
  }
  return out;
}

/** Collapsible whitespace of CSS `white-space: normal` (as `renderedLines()` in the geometry lint). */
const COLLAPSIBLE = /[ \t\n\r\f]/;

/**
 * Collapses whitespace across runs and lines like `renderedLines()`: runs of
 * collapsible whitespace become one space, spaces at the start and end of
 * the whole text are removed. Then drops empty runs and merges neighbors
 * with the same font and script.
 */
function collapse(lines: readonly (readonly LabelRun[])[]): LabelRun[][] {
  let afterSpace = true;
  const out = lines.map((line) =>
    line.map((run) => {
      let kept = "";
      for (const char of run.text) {
        if (COLLAPSIBLE.test(char)) {
          if (afterSpace) continue;
          kept += " ";
          afterSpace = true;
        } else {
          kept += char;
          afterSpace = false;
        }
      }
      return { ...run, text: kept };
    }),
  );
  // The trailing space of the whole text: in the last run that kept anything.
  outer: for (let i = out.length - 1; i >= 0; i--) {
    const line = out[i] as LabelRun[];
    for (let j = line.length - 1; j >= 0; j--) {
      const run = line[j] as LabelRun;
      if (run.text === "") continue;
      if (run.text.endsWith(" ")) line[j] = { ...run, text: run.text.slice(0, -1) };
      break outer;
    }
  }
  return out.map((line) => {
    const merged: LabelRun[] = [];
    for (const run of line) {
      if (run.text === "") continue;
      const last = merged.at(-1);
      if (last !== undefined && mergeableRuns(last, run)) {
        merged[merged.length - 1] = { ...last, text: last.text + run.text };
      } else merged.push(run);
    }
    // The text after an accent starts a new chunk in the SVG, which must not
    // start with a space (#129): leading spaces are a run of their own, drawn
    // at the end of the accent's chunk. Whitespace-only runs after an accent
    // (`\hat y\,` then ` と`) stay in that chunk, so the split looks past them.
    const out: LabelRun[] = [];
    let afterAccent = false;
    for (const run of merged) {
      if (run.accent !== undefined) {
        out.push(run);
        afterAccent = true;
        continue;
      }
      const space: string | undefined = afterAccent ? LEADING_SPACE.exec(run.text)?.[0] : undefined;
      if (space === undefined || space === run.text) {
        out.push(run);
        afterAccent = afterAccent && space !== undefined;
        continue;
      }
      out.push({ ...run, text: space }, { ...run, text: run.text.slice(space.length) });
      afterAccent = false;
    }
    return out;
  });
}

const LEADING_SPACE = /^\s+/u;

/** Whether a run draws only whitespace (spaces after an accent join the accent's chunk, #129). */
export function isSpaceRun(run: { readonly text: string }): boolean {
  return run.text !== "" && LEADING_SPACE.exec(run.text)?.[0] === run.text;
}

/**
 * The text of each line, as drawn (the runs' text joined). An accent follows
 * its base as the combining mark (`y` U+0302), which is also the order of the
 * characters in the SVG and the PDF.
 */
export function runLines(lines: readonly (readonly LabelRun[])[]): string[] {
  return lines.map((line) => line.map((r) => r.text + (r.accent ?? "")).join(""));
}
