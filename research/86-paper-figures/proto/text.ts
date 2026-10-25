/**
 * Text measurement with the bundled fonts (the product's TTF reader), plus a
 * tiny "label math" subset: `$...$` spans with Greek macros, `_x` / `_{..}`
 * subscripts and `^x` / `^{..}` superscripts, rendered as SVG <tspan>s of
 * real text (no glyph outlines), so PDF text stays searchable.
 */
import { getFontSet } from "../../../src/core/theme/fonts";
import { type FontMetrics, loadFontMetrics } from "../../../src/lint/metrics";

const fontSet = getFontSet("sumi/biz-ud-gothic");
if (fontSet === undefined) throw new Error("bundled font set missing");
export const FONT_FILES = { regular: fontSet.regular, bold: fontSet.bold };
const metrics: Record<"regular" | "bold", FontMetrics> = {
  regular: loadFontMetrics(fontSet.regular),
  bold: loadFontMetrics(fontSet.bold),
};

/** Real family name the PDF/PNG engine resolves to the bundled TTF. */
export const FONT_FAMILY = "BIZ UDPGothic";
export const LINE_HEIGHT = 1.25;
/** Size of sub/superscripts relative to the base size, and their baseline shifts (em). */
export const SCRIPT_SCALE = 0.7;
export const SUB_SHIFT = 0.25;
export const SUP_SHIFT = -0.4;

export interface Run {
  text: string;
  /** 0 = baseline, 1 = subscript, -1 = superscript */
  script: 0 | 1 | -1;
}

const GREEK: Record<string, string> = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  theta: "θ",
  lambda: "λ",
  mu: "μ",
  sigma: "σ",
  phi: "φ",
  omega: "ω",
  Sigma: "Σ",
  Delta: "Δ",
  times: "×",
  oplus: "⊕",
  cdot: "·",
  to: "→",
};

export class TextError extends Error {}

/** Parses one line of a label into runs. Outside `$...$` everything is literal. */
export function parseRuns(line: string): Run[] {
  const runs: Run[] = [];
  const push = (text: string, script: Run["script"]) => {
    if (text === "") return;
    const last = runs.at(-1);
    if (last !== undefined && last.script === script) last.text += text;
    else runs.push({ text, script });
  };
  const parts = line.split("$");
  if (parts.length % 2 === 0) throw new TextError(`unbalanced $ in "${line}"`);
  parts.forEach((part, i) => {
    if (i % 2 === 0) {
      push(part, 0);
      return;
    }
    let pos = 0;
    const atom = (): string => {
      const c = part[pos];
      if (c === undefined) throw new TextError(`dangling script in "${part}"`);
      if (c === "{") {
        const end = part.indexOf("}", pos);
        if (end < 0) throw new TextError(`unclosed { in "${part}"`);
        const inner = part.slice(pos + 1, end);
        pos = end + 1;
        return expand(inner);
      }
      if (c === "\\") return macro();
      pos++;
      return c;
    };
    const macro = (): string => {
      const m = /^\\([A-Za-z]+)/.exec(part.slice(pos));
      if (m === null) throw new TextError(`bad macro in "${part}"`);
      const value = GREEK[m[1] ?? ""];
      if (value === undefined) throw new TextError(`unsupported macro \\${m[1]}`);
      pos += m[0].length;
      return value;
    };
    const expand = (s: string): string =>
      s.replace(/\\([A-Za-z]+)/g, (_, name: string) => {
        const v = GREEK[name];
        if (v === undefined) throw new TextError(`unsupported macro \\${name}`);
        return v;
      });
    while (pos < part.length) {
      const c = part[pos];
      if (c === "_" || c === "^") {
        pos++;
        push(atom(), c === "_" ? 1 : -1);
      } else if (c === "\\") push(macro(), 0);
      else {
        push(c ?? "", 0);
        pos++;
      }
    }
  });
  return runs;
}

export interface MeasuredLabel {
  lines: Run[][];
  width: number;
  height: number;
  size: number;
  bold: boolean;
}

export function runWidth(run: Run, size: number, bold: boolean): number {
  const s = run.script === 0 ? size : size * SCRIPT_SCALE;
  return metrics[bold ? "bold" : "regular"].measureEm(run.text) * s;
}

export function measureLabel(label: string, size: number, bold = false): MeasuredLabel {
  const lines = label === "" ? [] : label.split("\n").map(parseRuns);
  const width = Math.max(
    0,
    ...lines.map((runs) => runs.reduce((sum, r) => sum + runWidth(r, size, bold), 0)),
  );
  return { lines, width, height: lines.length * size * LINE_HEIGHT, size, bold };
}

/** Code points of `text` the bundled regular font lacks (would render as tofu). */
export function missingGlyphs(text: string): string[] {
  return [...new Set([...text])].filter(
    (c) => c.trim() !== "" && !metrics.regular.coverage.has(c.codePointAt(0) ?? 0),
  );
}
