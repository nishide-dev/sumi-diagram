/**
 * Probes of the pinned D2 v0.9.0 for features option A (keep D2/ELK, add
 * hints) would rely on: grid containers as gap-0 stacks, edges inside grids,
 * icons, LaTeX and Markdown labels. Writes D2/SVG to out/d2/ and returns the
 * measured geometry. Run through ../run.ts.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runCommand } from "../../../src/core/subprocess";
import { fontSetArgs, getFontSet } from "../../../src/core/theme/fonts";

const ROOT = join(import.meta.dir, "..", "..", "..");
const D2 = join(ROOT, ".sumi", "bin", "d2");
const OUT = join(import.meta.dir, "..", "out", "d2");

/** A tiny self-made SVG icon (a circle), used as a data URI. */
const ICON = `data:image/svg+xml;base64,${Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#e66"/></svg>',
).toString("base64")}`;

export const D2_PROBES: Record<string, string> = {
  // A gap-0 vertical stack through a grid container, plus a "residual" edge
  // that skips one cell and an edge from outside.
  "grid-stack": [
    "enc: {",
    "  grid-columns: 1",
    "  vertical-gap: 0",
    '  an2: "Add & Norm"',
    '  ff: "Feed Forward"',
    '  an1: "Add & Norm"',
    '  mha: "Multi-Head Attention"',
    "}",
    'emb: "Input Embedding"',
    "emb -> enc.mha",
    "enc.mha -> enc.an1",
    "enc.an1 -> enc.ff",
    "enc.an1 -> enc.an2",
  ].join("\n"),
  // Two grid columns side by side (an "encoder | decoder" row) with a cross edge.
  "grid-row": [
    "fig: {",
    "  grid-columns: 2",
    "  horizontal-gap: 40",
    "  enc: { grid-columns: 1; vertical-gap: 0; a: A; b: B }",
    "  dec: { grid-columns: 1; vertical-gap: 0; c: C; d: D; e: E }",
    "}",
    "fig.enc.a -> fig.dec.d",
  ].join("\n"),
  // An icon on an ordinary box.
  icon: [`box: Label { icon: "${ICON}" }`, "other: Other", "box -> other"].join("\n"),
  // LaTeX label (D2 renders it itself).
  latex: ["m: |latex \\gamma_1, \\beta_1|", "n: N", "m -> n"].join("\n"),
  // Markdown label.
  markdown: ["md: |md", "  The character **stands** _still_", "|", "x: X", "md -> x"].join("\n"),
};

interface Rect {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface D2ProbeResult {
  name: string;
  ok: boolean;
  stderr?: string;
  bytes?: number;
  rects?: Rect[];
  paths?: string[];
  elements?: Record<string, number>;
}

function count(svg: string, tag: string): number {
  return svg.split(`<${tag}`).length - 1;
}

/** Shapes D2 writes as `<g class="<base64 key>"><g class="shape" ><rect …/>`. */
function rects(svg: string): Rect[] {
  const out: Rect[] = [];
  const re =
    /<g class="([A-Za-z0-9+/=]+)"><g class="shape" ><rect x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)"/g;
  for (const m of svg.matchAll(re)) {
    const [, key = "", x = "0", y = "0", w = "0", h = "0"] = m;
    out.push({
      key: Buffer.from(key, "base64").toString("utf8"),
      x: Number(x),
      y: Number(y),
      width: Number(w),
      height: Number(h),
    });
  }
  return out;
}

export async function runD2Probes(): Promise<D2ProbeResult[]> {
  await mkdir(OUT, { recursive: true });
  const fontSet = getFontSet("sumi/biz-ud-gothic");
  if (fontSet === undefined) throw new Error("font set");
  const results: D2ProbeResult[] = [];
  for (const [name, source] of Object.entries(D2_PROBES)) {
    const input = join(OUT, `${name}.d2`);
    const output = join(OUT, `${name}.svg`);
    await writeFile(input, `${source}\n`);
    const run = await runCommand([
      D2,
      "--layout",
      "elk",
      "--omit-version",
      ...fontSetArgs(fontSet),
      input,
      output,
    ]);
    if (run.exitCode !== 0) {
      results.push({ name, ok: false, stderr: run.stderr.trim().split("\n").slice(-2).join(" ") });
      continue;
    }
    const svg = await readFile(output, "utf8");
    results.push({
      name,
      ok: true,
      bytes: svg.length,
      rects: rects(svg),
      paths: [...svg.matchAll(/<path d="(M[^"]*)"[^>]*class="connection/g)].map((m) => m[1] ?? ""),
      elements: {
        image: count(svg, "image"),
        foreignObject: count(svg, "foreignObject"),
        text: count(svg, "text"),
        path: count(svg, "path"),
        use: count(svg, "use"),
      },
    });
  }
  return results;
}

if (import.meta.main) console.log(JSON.stringify(await runD2Probes(), null, 2));
