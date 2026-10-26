/**
 * Font handling for the PDF engine (#59, design doc §6.12).
 *
 * D2 embeds each font as a WOFF subset in an `@font-face` rule with a
 * per-diagram family name (`d2-<hash>-font-regular`) and selects it per class
 * (`.d2-<hash> .text { font-family: "d2-<hash>-font-regular"; }`). Browsers
 * read those rules; usvg (krilla-svg) does not load `@font-face` fonts, so it
 * would fall back to some other font. {@link resolveSvgFonts} therefore
 * rewrites each class rule to the real family, weight and style of the font
 * set's file for that slot (read from the file's `name` and `OS/2` tables),
 * removes the `@font-face` rules, and returns the files to hand to the engine.
 * The engine sees only those files, never system fonts.
 *
 * SVGs of the structured writer (#91) name their families `sumi-<n>-font-<slot>`
 * the same way and are resolved alike, including the label-math classes
 * `math` / `math-italic` (#93), which are not D2 slots.
 *
 * A `<text>` whose runs use several fonts (label math) needs one more step
 * (#112, design doc §6.24). usvg shapes a text chunk's *whole* text with each
 * run's font and keeps that font's glyphs for the run's own characters. When
 * that font lacks a character of *another* run (STIX Two Text Italic has no
 * `∇`), usvg falls back, and if the fallback font has every character of the
 * chunk (BIZ UDPGothic has `y∇x`) it replaces *all* glyphs with it: the run
 * loses its font. {@link resolveSvgFonts} therefore hands the engine copies of
 * such fonts whose `cmap` also maps those other runs' characters (to the
 * space glyph, which is never drawn: those glyphs are discarded), so shaping
 * a chunk with any of its fonts misses nothing and never falls back. A
 * character a run's *own* font lacks is not added anywhere, so it still falls
 * back as before (`lint/missing-glyph` warns about it).
 */

import { readFileSync } from "node:fs";
import type { Diagnostic } from "../../core/diagnostics";
import { MATH_FONT, MATH_ITALIC_FONT } from "../../core/label/runs";
import type { Result } from "../../core/result";
import { type FontSet, fontSetArgs } from "../../core/theme/fonts";
import { type GlyphCoverage, parseGlyphCoverage } from "../../lint/cmap";
import { fontFileFor } from "../../lint/geometry/measure";
import { FontParseError, readTables } from "../../lint/sfnt";
import { withCodePoints, withoutTables } from "../font-subset";
import { classList, descendants, parseXml, type XmlElement, type XmlNode } from "../xml";

/** How a font file names itself: what usvg/fontdb match a CSS rule against. */
export interface FontFace {
  family: string;
  /** `OS/2.usWeightClass` (400 regular, 700 bold). */
  weight: number;
  italic: boolean;
}

/**
 * Reads the family (typographic family, name ID 16, else name ID 1; Unicode
 * names, US English first), weight and style of a TrueType / OpenType font.
 * Throws {@link FontParseError} if the font has no usable family name.
 */
export function readFontFace(bytes: Uint8Array): FontFace {
  const tables = readTables(bytes);
  const name = tables.require("name");
  const count = name.u16(2);
  const storage = name.u16(4);
  const names: { nameId: number; rank: number; value: string }[] = [];
  for (let i = 0; i < count; i++) {
    const record = 6 + i * 12;
    const platform = name.u16(record);
    const encoding = name.u16(record + 2);
    const language = name.u16(record + 4);
    const nameId = name.u16(record + 6);
    const length = name.u16(record + 8);
    const offset = storage + name.u16(record + 10);
    if (nameId !== 1 && nameId !== 16) continue;
    // Unicode (platform 0) and Windows Unicode (3/1, 3/10) names are UTF-16BE.
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode) continue;
    let value = "";
    for (let j = 0; j + 1 < length; j += 2) value += String.fromCharCode(name.u16(offset + j));
    const rank = platform === 3 && language === 0x0409 ? 0 : 1;
    if (value.trim() !== "") names.push({ nameId, rank, value });
  }
  const pick = (nameId: number) =>
    names.filter((n) => n.nameId === nameId).sort((a, b) => a.rank - b.rank)[0]?.value;
  const family = pick(16) ?? pick(1);
  if (family === undefined) throw new FontParseError("the font has no family name");
  const os2 = tables.get("OS/2");
  const weight = os2 === undefined ? 400 : os2.u16(4);
  const italic = os2 === undefined ? false : (os2.u16(62) & 0x0201) !== 0;
  return { family, weight, italic };
}

export interface ResolvedSvgFonts {
  /** The SVG with D2's font families replaced by the real ones and no `@font-face` rules. */
  svg: string;
  /** The distinct font files of the font set, regular first (the engine's fallback). */
  fonts: Uint8Array[];
  /** Real face per D2 font slot used by the SVG (e.g. `regular`, `bold`). */
  faces: ReadonlyMap<string, FontFace>;
}

/** Font classes of label math (#93): not D2 slots, resolved with `fontFileFor()`. */
const MATH_FONT_CLASSES = [MATH_FONT, MATH_ITALIC_FONT];

const FONT_FACE_RULE = /@font-face\s*\{[^}]*\}\s*/g;
const CSS_RULE = /([^{}]*)\{([^{}]*)\}/g;
const FAMILY_SLOT = /font-family:\s*"?(?:d2|sumi)-\d+-font-([a-z-]+)"?\s*;/;
const LAST_CLASS = /\.([A-Za-z0-9_-]+)\s*$/;
const D2_FAMILY = /font-family:\s*"?(?:d2|sumi)-\d+-font-([a-z-]+)"?\s*;/g;
const D2_FAMILY_ANYWHERE = /(?:d2|sumi)-\d+-font-[a-z-]+/;

function error(code: string, message: string, hint?: string): Diagnostic {
  return { code, severity: "error", message, ...(hint !== undefined && { hint }) };
}

const cssString = (value: string) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

/**
 * Rewrites a finalized SVG's D2 font families to the font set's real faces
 * (see the module comment), in `<style>` content only. Fails with
 * `pdf/missing-font` if a font file of the set cannot be read or parsed,
 * `pdf/unresolved-font` if the CSS names a D2 font slot that has no file, or
 * the CSS or a `font-family` / `style` attribute still names a D2 family
 * after the rewrite, and `svg/invalid` if the SVG is not well-formed.
 */
export function resolveSvgFonts(
  svg: string,
  fontSet: FontSet,
  format: "pdf" | "pptx" = "pdf",
): Result<ResolvedSvgFonts> {
  // `--font-<slot> <file>` is exactly how D2 was told which file each slot uses.
  const args = fontSetArgs(fontSet);
  const fileOf = new Map<string, string>();
  for (let i = 0; i + 1 < args.length; i += 2) {
    fileOf.set((args[i] ?? "").replace(/^--font-/, ""), args[i + 1] ?? "");
  }
  // The label-math slots (#93) exist only in structured SVGs; their files are
  // handed to the engine only when the SVG uses them, so D2 figures convert
  // with exactly the files they always did.
  const optional = new Map(MATH_FONT_CLASSES.map((slot) => [slot, fontFileFor(slot, fontSet)]));
  const files = [...new Set([fontSet.regular, ...fileOf.values()])];
  const bytes = new Map<string, Uint8Array>();
  const faceOfFile = new Map<string, FontFace>();
  const load = (file: string, shaping = true): Diagnostic | undefined => {
    if (bytes.has(file)) return undefined;
    try {
      const raw = new Uint8Array(readFileSync(file));
      // The math fonts are drawn by their advance widths alone, as measured.
      const data = shaping ? raw : withoutTables(raw, ["GSUB", "GPOS"]);
      faceOfFile.set(file, readFontFace(data));
      bytes.set(file, data);
      return undefined;
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      return error(
        `${format}/missing-font`,
        `Cannot read the font ${file} of font set "${fontSet.id}": ${reason}.`,
        "Run `sumi doctor` to check the bundled fonts.",
      );
    }
  };
  for (const file of files) {
    const problem = load(file);
    if (problem !== undefined) return { ok: false, diagnostics: [problem] };
  }
  let loadProblem: Diagnostic | undefined;
  const coverageOf = new Map<string, GlyphCoverage>();

  // Only CSS is rewritten: the content of each <style> element, located by
  // the strict XML parser's offsets and spliced into the original text. Text
  // content (labels) is never touched, whatever it says.
  const parsed = parseXml(svg);
  if (!parsed.ok) {
    return {
      ok: false,
      diagnostics: [error("svg/invalid", `The SVG is not well-formed XML: ${parsed.message}`)],
    };
  }
  const faces = new Map<string, FontFace>();
  const fileOfSlot = new Map<string, string>();
  const slotOfClass = new Map<string, { slot: string; order: number }>();
  let order = 0;
  const unknown = new Set<string>();
  let leftover: string | undefined;
  const parts: string[] = [];
  let copied = 0;
  for (const element of [parsed.root, ...descendants(parsed.root)]) {
    // Font-related attributes are checked, not rewritten (D2 never writes them).
    for (const { name, value } of element.attributes) {
      if (name === "font-family" || name === "style") {
        leftover ??= D2_FAMILY_ANYWHERE.exec(value)?.[0];
      }
    }
    if (element.name !== "style" || element.end === element.startTagEnd) continue;
    const contentEnd = svg.lastIndexOf("</", element.end);
    const rules = svg.slice(element.startTagEnd, contentEnd).replace(FONT_FACE_RULE, "");
    for (const [, selectors, body] of rules.matchAll(CSS_RULE)) {
      const slot = FAMILY_SLOT.exec(body ?? "")?.[1];
      if (slot === undefined) continue;
      for (const selector of (selectors ?? "").split(",")) {
        const cls = LAST_CLASS.exec(selector.trim())?.[1];
        // Later rules win, as in CSS (the selectors have equal specificity).
        if (cls !== undefined) slotOfClass.set(cls, { slot, order: order++ });
      }
    }
    const css = rules.replace(D2_FAMILY, (whole, slot: string) => {
      let file = fileOf.get(slot);
      const extra = optional.get(slot);
      if (file === undefined && extra !== undefined) {
        loadProblem ??= load(extra, false);
        if (!files.includes(extra)) files.push(extra);
        file = extra;
      }
      const face = file === undefined ? undefined : faceOfFile.get(file);
      if (face === undefined) {
        unknown.add(slot);
        return whole;
      }
      faces.set(slot, face);
      fileOfSlot.set(slot, file as string);
      return `font-family: ${cssString(face.family)}; font-weight: ${face.weight}; font-style: ${face.italic ? "italic" : "normal"};`;
    });
    leftover ??= D2_FAMILY_ANYWHERE.exec(css)?.[0];
    parts.push(svg.slice(copied, element.startTagEnd), css);
    copied = contentEnd;
  }
  parts.push(svg.slice(copied));
  if (loadProblem !== undefined) return { ok: false, diagnostics: [loadProblem] };
  const rewritten = parts.join("");
  if (unknown.size > 0 || leftover !== undefined) {
    const what =
      unknown.size > 0 ? `font slot(s) ${[...unknown].sort().join(", ")}` : `"${leftover}"`;
    return {
      ok: false,
      diagnostics: [
        error(
          `${format}/unresolved-font`,
          `The SVG uses ${what}, which font set "${fontSet.id}" cannot provide for the ${format.toUpperCase()}.`,
          "Render the SVG with Sumi from the same font set.",
        ),
      ],
    };
  }
  const fileOfClass = new Map(
    [...slotOfClass].map(([cls, { slot, order }]) => [
      cls,
      { file: fileOfSlot.get(slot) as string, order },
    ]),
  );
  const extra = foreignCodePoints(parsed.root, fileOfClass, fontSet.regular, (file) => {
    let coverage = coverageOf.get(file);
    if (coverage === undefined) {
      coverage = parseGlyphCoverage(bytes.get(file) as Uint8Array);
      coverageOf.set(file, coverage);
    }
    return coverage;
  });
  for (const [file, codePoints] of extra) {
    const coverage = coverageOf.get(file) as GlyphCoverage;
    const blank = coverage.glyph(0x20) || 1;
    bytes.set(
      file,
      withCodePoints(
        bytes.get(file) as Uint8Array,
        new Map([...codePoints].map((cp) => [cp, blank])),
      ),
    );
  }
  return {
    ok: true,
    value: {
      svg: rewritten,
      fonts: files.map((f) => bytes.get(f) as Uint8Array),
      faces,
    },
    diagnostics: [],
  };
}

/**
 * The code points each font file must also map so that no `<text>` with runs
 * in several fonts falls back (see the module comment): per file, the
 * characters of those texts that the file lacks, except characters some run's
 * own font lacks anywhere in the SVG (those keep falling back as before).
 * A run's font is the one of the nearest element (itself or an ancestor)
 * with a class that a font rule selects; text without one uses `regular`
 * (the engine's fallback family). Files that need nothing are left out.
 */
function foreignCodePoints(
  root: XmlElement,
  fileOfClass: ReadonlyMap<string, { file: string; order: number }>,
  regular: string,
  coverage: (file: string) => GlyphCoverage,
): Map<string, Set<number>> {
  const ownMissing = new Set<number>();
  const texts: { files: Set<string>; codePoints: Set<number> }[] = [];
  const fileOf = (element: XmlElement, inherited: string): string => {
    let best: { file: string; order: number } | undefined;
    for (const cls of classList(element)) {
      const rule = fileOfClass.get(cls);
      if (rule !== undefined && (best === undefined || rule.order > best.order)) best = rule;
    }
    return best?.file ?? inherited;
  };
  // Iterative: the parser bounds the depth, but a deep tree must not use the JS stack.
  const stack: { node: XmlNode; file: string; text?: (typeof texts)[number] | undefined }[] = [
    { node: root, file: regular },
  ];
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    const { node, text } = item;
    if (node.type === "text") {
      if (text === undefined) continue;
      text.files.add(item.file);
      for (const char of node.text) {
        const cp = char.codePointAt(0) as number;
        text.codePoints.add(cp);
        if (!coverage(item.file).has(cp)) ownMissing.add(cp);
      }
      continue;
    }
    const file = fileOf(node, item.file);
    let current = text;
    if (current === undefined && node.name === "text") {
      current = { files: new Set(), codePoints: new Set() };
      texts.push(current);
    }
    for (const child of node.children) stack.push({ node: child, file, text: current });
  }
  const extra = new Map<string, Set<number>>();
  for (const { files, codePoints } of texts) {
    if (files.size < 2) continue;
    for (const file of files) {
      for (const cp of codePoints) {
        if (coverage(file).has(cp) || ownMissing.has(cp)) continue;
        let set = extra.get(file);
        if (set === undefined) {
          set = new Set();
          extra.set(file, set);
        }
        set.add(cp);
      }
    }
  }
  return extra;
}
