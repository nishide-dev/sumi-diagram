/**
 * Label measurement for the geometry lint (#13, design doc §6.5): the boxes
 * of a label as the SVG draws it, re-measured with the same TTF files that D2
 * embedded (the theme's font set), without a browser.
 *
 * - Whitespace: D2's `<text>` has neither `xml:space="preserve"` nor
 *   `white-space: pre`, so renderers collapse it (see {@link renderedLines}).
 * - Horizontal: each line is centered on the anchor (`text-anchor: middle`)
 *   and is as wide as the sum of its characters' advance widths (`hmtx`) at
 *   the label's font size. No kerning or shaping; the bundled BIZ UD Gothic
 *   has neither `kern` nor `GPOS`, so this is exact for it.
 * - Vertical: the first line's baseline is the anchor; later lines advance by
 *   the label's line height (the `<tspan>` `dy`). A line spans from the
 *   font's ascender above its baseline to its descender below (`hhea`).
 * - Runs (#93): a line drawn as runs (`LabelGeometry.runs`) is as wide as the
 *   sum of the runs' advances, each in its own font and size; each run spans
 *   its font's ascender / descender at its size around its own baseline
 *   (the line's, shifted for scripts), and the line's box is their union.
 * - Accents (#129): a line with math accents is drawn as text chunks, each
 *   centered on its own x (`LabelRunGeometry.chunkX`); an accent's mark is
 *   measured by its glyph outline (`glyf`), where the layout placed it.
 * - Turned labels (#178): a label drawn turned by ±90° is measured in its own
 *   frame as above, then every box is turned about the rotation's center
 *   (exact: an axis-aligned box stays one, width and height swapped).
 */

import type { FontSet } from "../../core/theme/fonts";
import type { Rect } from "../../render/geometry";
import type { LabelGeometry, LabelRunGeometry } from "../../render/inspect";
import { type FontMetrics, loadFontMetrics } from "../metrics";

export interface MeasuredLabel {
  /** The label as inspected. */
  label: LabelGeometry;
  /** The font file the label is drawn with. */
  fontPath: string;
  /** The lines as rendered, after whitespace collapsing ({@link renderedLines}). */
  texts: string[];
  /** One box per line, in drawing order (lines without characters have zero width). */
  lines: Rect[];
  /**
   * The boxes of the lines that draw something: lines that are empty or only
   * whitespace (including no-break spaces) are left out. Rules check these.
   */
  visibleLines: Rect[];
  /** The union of {@link visibleLines}; undefined when nothing is drawn. */
  box?: Rect;
  /** For a label with runs (#93): each line's runs with their boxes, in drawing order. */
  runs?: MeasuredRun[][];
}

/** A measured run (#93): where its text is drawn. */
export interface MeasuredRun {
  text: string;
  font: string;
  fontSizeUnits: number;
  /** Where the run's pen starts (x), and its advance width (in the label's own frame, #178). */
  x: number;
  width: number;
  /**
   * The run's baseline (y, in the label's own frame), and its advance box
   * (font ascender to descender at its size; for a math accent's mark,
   * #129, the mark's outline), turned with the label (#178).
   */
  baseline: number;
  box: Rect;
}

/**
 * Turns an axis-aligned rectangle by ±90° about `center` (#178), as SVG's
 * `rotate(degrees cx cy)` does (positive clockwise, y down): the result is
 * the same rectangle, width and height swapped, about the turned center.
 */
export function turnRect(
  rect: Rect,
  rotation: { degrees: number; center: { x: number; y: number } },
): Rect {
  const { center } = rotation;
  const dx = rect.x + rect.width / 2 - center.x;
  const dy = rect.y + rect.height / 2 - center.y;
  // rotate(90): (dx, dy) → (−dy, dx); rotate(−90): (dx, dy) → (dy, −dx).
  const sign = rotation.degrees > 0 ? 1 : -1;
  const cx = center.x - sign * dy;
  const cy = center.y + sign * dx;
  return {
    x: cx - rect.height / 2,
    y: cy - rect.width / 2,
    width: rect.height,
    height: rect.width,
  };
}

/**
 * The font file for one of D2's font classes (`LabelGeometry.font`): `mono*`
 * → mono, `bold` / `semibold` → bold, `italic` → italic, the label-math
 * classes (#93) `math` → math and `math-italic` → mathItalic (then math),
 * anything else regular. Missing optional slots fall back to regular, like the `--font-*`
 * arguments do (design doc §4.2).
 */
export function fontFileFor(fontClass: string, fonts: FontSet): string {
  if (fontClass === "math") return fonts.math ?? fonts.regular;
  if (fontClass === "math-italic") return fonts.mathItalic ?? fonts.math ?? fonts.regular;
  if (fontClass.startsWith("mono")) return fonts.mono ?? fonts.regular;
  if (fontClass === "bold" || fontClass === "semibold") return fonts.bold;
  if (fontClass === "italic") return fonts.italic ?? fonts.regular;
  return fonts.regular;
}

/** Collapsible whitespace of CSS `white-space: normal`: space, tab, line breaks (not U+00A0 or U+3000). */
const COLLAPSIBLE = /[ \t\n\r\f]/;

/**
 * The lines of a label (`LabelGeometry.text`, one `<tspan>` per `\n`) as an
 * SVG renderer draws them without `xml:space="preserve"` (CSS
 * `white-space: normal`, no wrapping): tabs and other collapsible whitespace
 * become spaces, a run of spaces collapses to its first space — also across
 * `<tspan>` boundaries, since the lines are inline boxes of one text — and
 * spaces at the start and end of the whole text are removed. No-break spaces
 * (U+00A0) and other non-collapsible spaces are kept.
 */
export function renderedLines(text: string): string[] {
  const lines = text.split("\n");
  const out: string[] = [];
  // The last kept character is a collapsible space, or nothing was kept yet.
  let afterSpace = true;
  for (const line of lines) {
    let kept = "";
    for (const char of line) {
      if (COLLAPSIBLE.test(char)) {
        if (afterSpace) continue;
        kept += " ";
        afterSpace = true;
      } else {
        kept += char;
        afterSpace = false;
      }
    }
    out.push(kept);
  }
  // Remove the trailing space of the whole text (in the last line that kept anything).
  for (let i = out.length - 1; i >= 0; i--) {
    const line = out[i] ?? "";
    if (line === "") continue;
    if (line.endsWith(" ")) out[i] = line.slice(0, -1);
    break;
  }
  return out;
}

/** Text that draws nothing: whitespace (`\s` includes U+00A0 and U+3000), controls, default-ignorables. */
const INVISIBLE = /^[\s\p{Cc}\p{Default_Ignorable_Code_Point}]*$/u;

/**
 * Measures a label drawn with `metrics` (see the module comment). A label
 * with runs needs the metrics of every run's font: pass a function from
 * font class to metrics.
 */
export function measureLabelWith(
  label: LabelGeometry,
  metrics: FontMetrics | ((font: string) => FontMetrics),
): Omit<MeasuredLabel, "fontPath"> {
  const metricsOf = typeof metrics === "function" ? metrics : () => metrics;
  const upright =
    label.runs !== undefined
      ? measureRuns(label, label.runs, metricsOf)
      : measurePlain(label, metricsOf(label.font));
  const { rotation } = label;
  if (rotation === undefined) return upright;
  // A turned label (#178): every box turned about the rotation's center.
  const turn = (rect: Rect) => turnRect(rect, rotation);
  const box = upright.box === undefined ? undefined : turn(upright.box);
  return {
    label,
    texts: upright.texts,
    lines: upright.lines.map(turn),
    visibleLines: upright.visibleLines.map(turn),
    ...(box !== undefined && { box }),
    ...(upright.runs !== undefined && {
      runs: upright.runs.map((line) => line.map((run) => ({ ...run, box: turn(run.box) }))),
    }),
  };
}

function measurePlain(label: LabelGeometry, metrics: FontMetrics): Omit<MeasuredLabel, "fontPath"> {
  const size = label.fontSizeUnits;
  const ascent = (metrics.hhea.ascender / metrics.unitsPerEm) * size;
  const descent = (-metrics.hhea.descender / metrics.unitsPerEm) * size;
  const texts = renderedLines(label.text);
  const lines = texts.map((text, i): Rect => {
    const width = metrics.measureEm(text) * size;
    const baseline = label.anchor.y + i * label.lineHeightUnits;
    return {
      x: label.anchor.x - width / 2,
      y: baseline - ascent,
      width,
      height: ascent + descent,
    };
  });
  const visibleLines = lines.filter((_, i) => !INVISIBLE.test(texts[i] ?? ""));
  const box = unionOf(visibleLines);
  return { label, texts, lines, visibleLines, ...(box !== undefined && { box }) };
}

function measureRuns(
  label: LabelGeometry,
  runs: readonly (readonly LabelRunGeometry[])[],
  metricsOf: (font: string) => FontMetrics,
): Omit<MeasuredLabel, "fontPath"> {
  const texts = runs.map((line) => line.map((r) => r.text).join(""));
  const measured = runs.map((line, i): MeasuredRun[] => {
    const lineBaseline = label.anchor.y + i * label.lineHeightUnits;
    const widths = line.map((run) => metricsOf(run.font).measureEm(run.text) * run.fontSizeUnits);
    // Each chunk (#129) is centered on its own x; a line without chunks on the anchor.
    const starts: number[] = [];
    let x = 0;
    for (const [j, run] of line.entries()) {
      if (j === 0 || run.chunkX !== undefined) {
        let width = 0;
        for (let k = j; k < line.length && (k === j || line[k]?.chunkX === undefined); k++) {
          width += widths[k] as number;
        }
        x = (run.chunkX ?? label.anchor.x) - width / 2;
      }
      starts.push(x);
      x += widths[j] as number;
    }
    return line.map((run, j) => {
      const m = metricsOf(run.font);
      const scale = run.fontSizeUnits / m.unitsPerEm;
      const ascent = m.hhea.ascender * scale;
      const descent = -m.hhea.descender * scale;
      const baseline = lineBaseline + run.shiftUnits;
      const width = widths[j] as number;
      const start = starts[j] as number;
      let box: Rect = { x: start, y: baseline - ascent, width, height: ascent + descent };
      if (run.accent === true) {
        // A math accent's mark: its outline, which the layout placed over its base.
        const outline = unionOf(
          [...run.text].flatMap((char) => {
            const b = m.glyphBounds(char.codePointAt(0) ?? 0);
            return b === undefined
              ? []
              : [
                  {
                    x: start + b.xMin * scale,
                    y: baseline - b.yMax * scale,
                    width: (b.xMax - b.xMin) * scale,
                    height: (b.yMax - b.yMin) * scale,
                  },
                ];
          }),
        );
        box = outline ?? { x: start, y: baseline, width: 0, height: 0 };
      }
      return {
        text: run.text,
        font: run.font,
        fontSizeUnits: run.fontSizeUnits,
        x: start,
        width,
        baseline,
        box,
      };
    });
  });
  // A line without runs is an empty box at its baseline, like a blank plain line.
  const lines = measured.map(
    (line, i): Rect =>
      unionOf(line.map((r) => r.box)) ?? {
        x: label.anchor.x,
        y: label.anchor.y + i * label.lineHeightUnits,
        width: 0,
        height: 0,
      },
  );
  const visibleLines = measured.flatMap((line) => {
    const box = unionOf(line.filter((r) => !INVISIBLE.test(r.text)).map((r) => r.box));
    return box === undefined ? [] : [box];
  });
  const box = unionOf(visibleLines);
  return {
    label,
    texts,
    lines,
    visibleLines,
    ...(box !== undefined && { box }),
    runs: measured,
  };
}

/** The bounding box of rectangles, or `undefined` for none. */
export function unionOf(rects: readonly Rect[]): Rect | undefined {
  if (rects.length === 0) return undefined;
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.width));
  const y1 = Math.max(...rects.map((r) => r.y + r.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Characters `measureEm()` skips when the font does not map them (see `metrics.ts`). */
const SKIPPED = /[\p{Cc}\p{Default_Ignorable_Code_Point}]/u;

/**
 * The ink of each visible line (#156): the union of its glyphs' outlines
 * (`glyf`) where the line draws them, so a rule can tell a line that touches
 * the letters from one that only enters the space above a capital. Falls
 * back to the line box where the outlines are not known: a label drawn as
 * runs (#93), an icon (#94), a glyph without outline data.
 */
export function inkLines(measured: MeasuredLabel): Rect[] {
  if (measured.runs !== undefined || measured.fontPath === "") return measured.visibleLines;
  const metrics = loadFontMetrics(measured.fontPath);
  const scale = measured.label.fontSizeUnits / metrics.unitsPerEm;
  const ascent = metrics.hhea.ascender * scale;
  // A turned label (#178): the glyphs in the label's own frame, then turned.
  const { rotation } = measured.label;
  const back =
    rotation === undefined ? undefined : { degrees: -rotation.degrees, center: rotation.center };
  const lines =
    back === undefined ? measured.lines : measured.lines.map((line) => turnRect(line, back));
  const ink: Rect[] = [];
  for (const [i, text] of measured.texts.entries()) {
    const line = lines[i];
    if (line === undefined || INVISIBLE.test(text)) continue;
    const baseline = line.y + ascent;
    let pen = line.x;
    const glyphs: Rect[] = [];
    let known = true;
    for (const char of text) {
      const codePoint = char.codePointAt(0) ?? 0;
      // As `measureEm()`: renderers draw nothing for unmapped control and
      // default-ignorable characters, and do not advance over them.
      if (!metrics.coverage.has(codePoint) && SKIPPED.test(char)) continue;
      const bounds = metrics.glyphBounds(codePoint);
      if (bounds !== undefined) {
        glyphs.push({
          x: pen + bounds.xMin * scale,
          y: baseline - bounds.yMax * scale,
          width: (bounds.xMax - bounds.xMin) * scale,
          height: (bounds.yMax - bounds.yMin) * scale,
        });
      } else if (!INVISIBLE.test(char)) {
        // A visible character without outline data: fall back to the line box.
        known = false;
      }
      pen += metrics.advanceOf(codePoint) * scale;
    }
    ink.push((known ? unionOf(glyphs) : undefined) ?? line);
  }
  return rotation === undefined ? ink : ink.map((rect) => turnRect(rect, rotation));
}

/** Measures a label with the font set's file for each font class. */
export function measureLabel(label: LabelGeometry, fonts: FontSet): MeasuredLabel {
  const fontPath = fontFileFor(label.font, fonts);
  return {
    ...measureLabelWith(label, (font) => loadFontMetrics(fontFileFor(font, fonts))),
    fontPath,
  };
}
