/**
 * #167 prototype P1: "enter straight above the source" (#151 C1) and the
 * sub-unit misalignment loop (bug R1, repro/operator-loop.sumi.yaml).
 *
 * For selected edges (from → to pairs), the target-side anchor is replaced
 * by the exact projection of the source's centre on the entered side, when
 * that projection lies on the side at least `MARGIN` units from its corners.
 * This is what a `toAnchor: straight` (or an automatic rule) would compute
 * after placement and before routing. The product's placement, router,
 * route check and SVG writer are used unchanged (read-only imports).
 *
 * Variants per figure:
 *   none     the selected ends without any anchor (what an author writes first)
 *   spread   the same with figure.layout.fanIn: spread (#134)
 *   written  the file as committed (hand-computed or round anchors)
 *   straight exact projections injected into the IR (no decimal rounding)
 *   4dp      the same projections rounded to 4 decimals, as a person or an
 *            LLM copies them into YAML (shows bug R1: near-aligned ends loop)
 *
 * Usage: bun research/167-stage-c/proto/straight.ts [--png]
 * Writes results/straight.json; with --png also out/straight/*.png.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse, stringify } from "yaml";
import type { FigureIR } from "../../../src/compiler/ir";
import type { Anchor, EdgeAnchor } from "../../../src/core/figure/layout";
import type { LayoutIR } from "../../../src/layout/ir";
import { checkRoutes } from "../../../src/layout/route/check";
import { routeEdges } from "../../../src/layout/route/router";
import { svgToPdf } from "../../../src/render/pdf/pdf";
import { writeStructuredSvg } from "../../../src/render/structured";
import { type LoadedFigure, loadText } from "../../124-stage-b/route/load";

const HERE = dirname(import.meta.dir);
const MARGIN = 6; // units: keep the arrowhead off the corner

interface Case {
  readonly name: string;
  readonly file: string;
  readonly pairs: readonly (readonly [string, string])[];
}

const CASES: readonly Case[] = [
  {
    name: "c-h3world (encoders → refiner, refiner → A5, A3 → block)",
    file: join(HERE, "figures/c-h3world.sumi.yaml"),
    pairs: [
      ["enc0", "refiner"],
      ["enc1", "refiner"],
      ["enc2", "refiner"],
      ["enc3", "refiner"],
      ["enc4", "refiner"],
      ["refiner", "seq-a5"],
      ["bt-a3", "b-block1"],
    ],
  },
  {
    name: "b-dit (panel 1 inputs, panel 4 tokens)",
    file: join(HERE, "figures/b-dit.sumi.yaml"),
    pairs: [
      ["patchify", "dit-block"],
      ["embed", "dit-block"],
      ["timestep", "embed"],
      ["noised", "patchify"],
      ["i-tokens", "i-concat"],
    ],
  },
  {
    name: "#151 vit-input (patches → projection, tokens → encoder)",
    file: join(HERE, "../151-dogfood-v0.5/figures/vit-input.sumi.yaml"),
    pairs: [
      ["p1", "projection"],
      ["p2", "projection"],
      ["p3", "projection"],
      ["p4", "projection"],
      ["t0", "encoder"],
      ["t1", "encoder"],
      ["t2", "encoder"],
      ["t3", "encoder"],
      ["t4", "encoder"],
    ],
  },
];

type Variant = "none" | "spread" | "written" | "straight" | "4dp";
const VARIANTS: readonly Variant[] = ["none", "spread", "written", "straight", "4dp"];

function variantText(c: Case, v: Variant): string {
  const text = readFileSync(c.file, "utf8");
  if (v === "written" || v === "straight" || v === "4dp") return text;
  // biome-ignore lint/suspicious/noExplicitAny: free-form YAML document
  const doc: any = parse(text);
  const selected = (e: { from: string; to: string }) =>
    c.pairs.some(([f, t]) => f === e.from && t === e.to);
  for (const e of doc.edges) if (selected(e)) delete e.toAnchor;
  doc.figure.layout.fanIn = v === "spread" ? "spread" : "merge";
  return stringify(doc);
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function rectOf(layout: LayoutIR, key: string): Box | undefined {
  return (
    layout.nodes.find((n) => n.key === key)?.rect ?? layout.groups.find((g) => g.key === key)?.rect
  );
}

/** The side of `target` that faces `source` along the axis they are separated on. */
function facing(source: Box, target: Box): Anchor["side"] | undefined {
  if (source.y >= target.y + target.height) return "south";
  if (source.y + source.height <= target.y) return "north";
  if (source.x >= target.x + target.width) return "east";
  if (source.x + source.width <= target.x) return "west";
  return undefined;
}

function straightAnchor(source: Box, target: Box, round?: number): Anchor | undefined {
  const side = facing(source, target);
  if (side === undefined) return undefined;
  const vertical = side === "north" || side === "south";
  const c = vertical ? source.x + source.width / 2 : source.y + source.height / 2;
  const start = vertical ? target.x : target.y;
  const length = vertical ? target.width : target.height;
  if (c < start + MARGIN || c > start + length - MARGIN) return undefined;
  let offset = (c - start) / length;
  if (round !== undefined) offset = Number(offset.toFixed(round));
  return { side, offset };
}

function keyOf(fig: LoadedFigure, id: string): string | undefined {
  return fig.ir.nodes.find((n) => n.id === id)?.key ?? fig.ir.groups.find((g) => g.id === id)?.key;
}

interface EdgeResult {
  readonly edge: string;
  readonly anchor?: string;
  readonly bends: number;
  readonly excess: number;
  readonly jog: number;
}

function measure(c: Case, v: Variant) {
  const fig = loadText(variantText(c, v), dirname(c.file));
  let ir: FigureIR = fig.ir;
  let placed: LayoutIR = fig.placed;
  const sel = c.pairs.map(([f, t]) => {
    const from = keyOf(fig, f);
    const to = keyOf(fig, t);
    if (from === undefined || to === undefined) throw new Error(`${c.name}: ${f} → ${t} not found`);
    const edge = ir.edges.find((e) => e.from === from && e.to === to);
    if (edge === undefined) throw new Error(`${c.name}: no edge ${f} → ${t}`);
    return { label: `${f}→${t}`, key: edge.key, from, to };
  });
  const injected = new Map<string, Anchor | undefined>();
  const injectedFrom = new Map<string, Anchor | undefined>();
  if (v === "straight" || v === "4dp") {
    for (const s of sel) {
      const a = rectOf(placed, s.from);
      const b = rectOf(placed, s.to);
      if (a === undefined || b === undefined) throw new Error(`${s.label}: no rect`);
      const round = v === "4dp" ? 4 : undefined;
      const to = straightAnchor(a, b, round);
      injected.set(s.key, to);
      // Otherwise leave the source straight below the target's centre.
      if (to === undefined) injectedFrom.set(s.key, straightAnchor(b, a, round));
    }
    const patch = <T extends { key: string; toAnchor?: EdgeAnchor; fromAnchor?: EdgeAnchor }>(
      e: T,
    ): T => {
      const to = injected.get(e.key);
      if (to !== undefined) return { ...e, toAnchor: to };
      const from = injectedFrom.get(e.key);
      if (from !== undefined) return { ...e, fromAnchor: from };
      return e; // no projection on either side: keep as written
    };
    ir = { ...ir, edges: ir.edges.map(patch) };
    placed = { ...placed, edges: placed.edges.map(patch) };
  }
  const routed = routeEdges(ir, placed);
  const errors = routed.diagnostics.filter((d) => d.severity === "error").map((d) => d.code);
  const layout = routed.layout;
  const report = checkRoutes(ir, layout);
  const edges: EdgeResult[] = sel.map((s) => {
    const pts = layout.edges.find((e) => e.key === s.key)?.route?.points ?? [];
    let length = 0;
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1];
      const q = pts[i];
      if (p && q) length += Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
    }
    const first = pts[0];
    const last = pts.at(-1);
    const direct = first && last ? Math.abs(last.x - first.x) + Math.abs(last.y - first.y) : 0;
    const anchor = injected.get(s.key) ?? injectedFrom.get(s.key);
    const end = injected.has(s.key) && injected.get(s.key) !== undefined ? "to" : "from";
    return {
      edge: s.label,
      ...(anchor !== undefined && { anchor: `${end} ${anchor.side}:${anchor.offset}` }),
      bends: visibleBends(pts),
      excess: Math.round((length - direct) * 1000) / 1000,
      // lateral offset between the two ends (the size of the jog), in units (1 unit = 0.5pt)
      jog:
        first && last
          ? Math.round(Math.min(Math.abs(last.x - first.x), Math.abs(last.y - first.y)) * 1000) /
            1000
          : 0,
    };
  });
  return { fig, ir, layout, errors, crossings: report.crossings.length, edges };
}

/**
 * Bends a reader sees: interior points left after dropping segments shorter
 * than 0.5 unit (0.09mm), so a 1/1000-unit jog from rounding is not counted
 * but its effect on the route (a detour) still is, through `excess`.
 */
function visibleBends(points: readonly { x: number; y: number }[]): number {
  const kept: { x: number; y: number }[] = [];
  for (const p of points) {
    const last = kept.at(-1);
    if (last && Math.abs(p.x - last.x) + Math.abs(p.y - last.y) < 0.5) continue;
    kept.push(p);
  }
  let bends = 0;
  for (let i = 1; i + 1 < kept.length; i++) {
    const a = kept[i - 1];
    const b = kept[i];
    const c = kept[i + 1];
    if (!a || !b || !c) continue;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) > 1e-6) bends++;
  }
  return bends;
}

const png = process.argv.includes("--png");
const results: Record<string, Record<string, unknown>> = {};
for (const c of CASES) {
  const row: Record<string, unknown> = {};
  results[c.name] = row;
  for (const v of VARIANTS) {
    const r = measure(c, v);
    const straight = r.edges.filter((e) => e.bends === 0).length;
    const loops = r.edges.filter((e) => e.excess > 20).length; // > 20 units (~3.5mm) out of the way
    const bends = r.edges.reduce((s, e) => s + e.bends, 0);
    row[v] = {
      errors: r.errors,
      crossings: r.crossings,
      straight: `${straight}/${r.edges.length}`,
      bends,
      loops,
      edges: r.edges,
    };
    console.log(
      `${c.name.padEnd(58)} ${v.padEnd(8)} straight ${straight}/${r.edges.length}  bends ${bends}  loops ${loops}  crossings ${r.crossings}${r.errors.length ? `  errors ${r.errors}` : ""}`,
    );
    if (png && r.errors.length === 0) {
      const out = join(HERE, "out/straight");
      mkdirSync(out, { recursive: true });
      const svg = writeStructuredSvg(r.ir, r.layout, r.fig.fonts, r.fig.assets);
      const pdf = svgToPdf(svg, { fontSet: r.fig.fonts });
      if (!pdf.ok) throw new Error(JSON.stringify(pdf.diagnostics));
      const base = join(out, `${c.file.split("/").at(-1)?.replace(".sumi.yaml", "")}-${v}`);
      writeFileSync(`${base}.pdf`, pdf.value);
      execFileSync("pdftoppm", ["-r", "150", "-png", "-singlefile", `${base}.pdf`, base]);
    }
  }
}
mkdirSync(join(HERE, "results"), { recursive: true });
writeFileSync(join(HERE, "results/straight.json"), `${JSON.stringify(results, null, 2)}\n`);
