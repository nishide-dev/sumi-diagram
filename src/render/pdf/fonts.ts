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
 */

import { readFileSync } from "node:fs";
import type { Diagnostic } from "../../core/diagnostics";
import type { Result } from "../../core/result";
import { type FontSet, fontSetArgs } from "../../core/theme/fonts";
import { FontParseError, readTables } from "../../lint/sfnt";
import { descendants, parseXml } from "../xml";

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

const FONT_FACE_RULE = /@font-face\s*\{[^}]*\}\s*/g;
const D2_FAMILY = /font-family:\s*"?d2-\d+-font-([a-z-]+)"?\s*;/g;
const D2_FAMILY_ANYWHERE = /d2-\d+-font-[a-z-]+/;

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
export function resolveSvgFonts(svg: string, fontSet: FontSet): Result<ResolvedSvgFonts> {
  // `--font-<slot> <file>` is exactly how D2 was told which file each slot uses.
  const args = fontSetArgs(fontSet);
  const fileOf = new Map<string, string>();
  for (let i = 0; i + 1 < args.length; i += 2) {
    fileOf.set((args[i] ?? "").replace(/^--font-/, ""), args[i + 1] ?? "");
  }
  const files = [...new Set([fontSet.regular, ...fileOf.values()])];
  const bytes = new Map<string, Uint8Array>();
  const faceOfFile = new Map<string, FontFace>();
  for (const file of files) {
    try {
      const data = new Uint8Array(readFileSync(file));
      faceOfFile.set(file, readFontFace(data));
      bytes.set(file, data);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        diagnostics: [
          error(
            "pdf/missing-font",
            `Cannot read the font ${file} of font set "${fontSet.id}": ${reason}.`,
            "Run `sumi doctor` to check the bundled fonts.",
          ),
        ],
      };
    }
  }

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
    const css = svg
      .slice(element.startTagEnd, contentEnd)
      .replace(FONT_FACE_RULE, "")
      .replace(D2_FAMILY, (whole, slot: string) => {
        const file = fileOf.get(slot);
        const face = file === undefined ? undefined : faceOfFile.get(file);
        if (face === undefined) {
          unknown.add(slot);
          return whole;
        }
        faces.set(slot, face);
        return `font-family: ${cssString(face.family)}; font-weight: ${face.weight}; font-style: ${face.italic ? "italic" : "normal"};`;
      });
    leftover ??= D2_FAMILY_ANYWHERE.exec(css)?.[0];
    parts.push(svg.slice(copied, element.startTagEnd), css);
    copied = contentEnd;
  }
  parts.push(svg.slice(copied));
  const rewritten = parts.join("");
  if (unknown.size > 0 || leftover !== undefined) {
    const what =
      unknown.size > 0 ? `font slot(s) ${[...unknown].sort().join(", ")}` : `"${leftover}"`;
    return {
      ok: false,
      diagnostics: [
        error(
          "pdf/unresolved-font",
          `The SVG uses ${what}, which font set "${fontSet.id}" cannot provide for the PDF.`,
          "Render the SVG with Sumi from the same font set.",
        ),
      ],
    };
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
