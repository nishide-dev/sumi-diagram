/**
 * Geometry-only SVG import (#86 prototype), following the #18 §5.5 rule: parse
 * with the product's strict XML parser (no DTD / entities / PIs), keep an
 * allowlist of shape elements and attributes, and *re-serialize* — the input
 * text is never copied to the output.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { escapeAttribute, parseXml, type XmlElement } from "../../../src/render/xml";

const SHAPES: Record<string, readonly string[]> = {
  path: ["d"],
  circle: ["cx", "cy", "r"],
  ellipse: ["cx", "cy", "rx", "ry"],
  rect: ["x", "y", "width", "height", "rx", "ry"],
  line: ["x1", "y1", "x2", "y2"],
  polyline: ["points"],
  polygon: ["points"],
};
const PAINT = ["fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "fill-rule"];
const NUMBER = /^-?(\d+\.?\d*|\.\d+)(e-?\d+)?$/i;
const COLOR = /^(none|currentColor|#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6})$/;
/** A Map, so names such as `constructor` never resolve through a prototype. */
const PAINT_VALUE: ReadonlyMap<string, RegExp> = new Map([
  ["fill", COLOR],
  ["stroke", COLOR],
  ["stroke-width", NUMBER],
  ["stroke-linecap", /^(butt|round|square)$/],
  ["stroke-linejoin", /^(miter|round|bevel)$/],
  ["fill-rule", /^(nonzero|evenodd)$/],
]);
const PATH_DATA = /^[MmLlHhVvCcSsQqTtZz0-9eE.,+\-\s]*$/; // no arcs (A), see design §6.3

export interface ImportedSvg {
  viewBox: [number, number, number, number];
  /** Re-serialized shape markup (paint attributes kept only if allowlisted). */
  markup: string;
  rejected: string[];
}

export function importSvg(text: string): ImportedSvg {
  const parsed = parseXml(text);
  if (!parsed.ok) throw new Error(`icon: ${parsed.message}`);
  const root = parsed.root;
  if (root.name !== "svg") throw new Error("icon: root is not <svg>");
  const vb = (root.attributes.find((a) => a.name === "viewBox")?.value ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (vb.length !== 4 || vb.some((n) => !Number.isFinite(n))) throw new Error("icon: bad viewBox");
  const rejected: string[] = [];
  /** Copies allowlisted paint attributes with valid values; reports the rest. */
  const paintOf = (el: XmlElement, into: Map<string, string>) => {
    for (const a of el.attributes) {
      const valid = PAINT_VALUE.get(a.name);
      if (valid === undefined) continue;
      if (valid.test(a.value)) into.set(a.name, a.value);
      else rejected.push(`${el.name}@${a.name}=${a.value}`);
    }
    return into;
  };
  const out: string[] = [];
  const visit = (el: XmlElement, paint: Map<string, string>) => {
    for (const child of el.children) {
      if (child.type !== "element") continue;
      const local = paintOf(child, new Map(paint));
      if (child.name === "g") {
        for (const a of child.attributes) if (!PAINT.includes(a.name)) rejected.push(`g@${a.name}`);
        visit(child, local);
        continue;
      }
      const geometry = Object.hasOwn(SHAPES, child.name) ? SHAPES[child.name] : undefined;
      if (geometry === undefined) {
        rejected.push(child.name);
        continue;
      }
      const attrs: string[] = [];
      let broken = false;
      for (const a of child.attributes) {
        if (PAINT.includes(a.name)) continue;
        if (!geometry.includes(a.name)) {
          if (a.name !== "class") rejected.push(`${child.name}@${a.name}`);
          continue;
        }
        const ok =
          a.name === "d"
            ? PATH_DATA.test(a.value)
            : a.name === "points"
              ? /^[0-9eE.,+\-\s]*$/.test(a.value)
              : NUMBER.test(a.value);
        if (!ok) {
          rejected.push(`${child.name}@${a.name}`);
          broken = true;
          continue;
        }
        attrs.push(`${a.name}="${escapeAttribute(a.value)}"`);
      }
      if (broken) continue; // never emit a shape with a dropped geometry attribute
      for (const [k, v] of local) attrs.push(`${k}="${escapeAttribute(v)}"`);
      out.push(`<${child.name} ${attrs.join(" ")}/>`);
    }
  };
  visit(root, paintOf(root, new Map()));
  return { viewBox: vb as [number, number, number, number], markup: out.join(""), rejected };
}

/** Built-in fallback (one sine period) so the prototype runs without downloads. */
const FALLBACK_SINE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12c3-8 6-8 9 0s6 8 9 0"/></svg>';

const TABLER = join(import.meta.dir, "..", ".tools", "@tabler__icons-3.49.0", "icons", "outline");

/** Resolves `tabler/<name>` from the research download, else a built-in fallback. */
export function loadIcon(ref: string): { svg: ImportedSvg; source: string } {
  // SUMI86_ICONS=fallback forces the built-in icon (run.ts --offline sets it).
  const m = process.env.SUMI86_ICONS === "fallback" ? null : /^tabler\/([a-z0-9-]+)$/.exec(ref);
  if (m !== null) {
    const file = join(TABLER, `${m[1]}.svg`);
    if (existsSync(file))
      return { svg: importSvg(readFileSync(file, "utf8")), source: `@tabler/icons@3.49.0 ${m[1]}` };
  }
  return { svg: importSvg(FALLBACK_SINE), source: "fallback" };
}
