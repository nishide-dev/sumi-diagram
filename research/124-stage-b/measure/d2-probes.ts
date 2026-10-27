/**
 * What the pinned D2 (v0.9.0, ELK) offers for label positions (#124 §1–§2):
 * group (container) `label.near`, edge `label.near`, and arrowhead labels.
 * Each probe is compiled with `d2 --layout elk` (edge probes also with
 * `dagre`); the result records whether
 * D2 accepts it and where the label's text lands relative to its shape.
 *
 *   bun research/124-stage-b/measure/d2-probes.ts            # print the results
 *   bun research/124-stage-b/measure/d2-probes.ts --record   # also write results/d2-probes.json
 *
 * Needs `bun run d2:install` (.sumi/bin/d2). Writes out/d2/*.d2 / *.svg.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../patch";

const D2 = join(ROOT, ".sumi/bin/d2");
const OUT = join(import.meta.dir, "../out/d2");
mkdirSync(OUT, { recursive: true });

interface Probe {
  name: string;
  source: string;
  /** The label text to locate, and the D2 key of the shape it belongs to (for a container / node). */
  text: string;
  shape?: string;
}

const NEARS = [
  "top-left",
  "top-center",
  "top-right",
  "center-left",
  "center-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
  "outside-top-left",
  "outside-top-center",
  "outside-bottom-center",
  "outside-left-center",
  "outside-right-center",
];

const probes: Probe[] = [
  ...NEARS.map((near) => ({
    name: `group-${near}`,
    source: `g: Group {\n  label.near: ${near}\n  a -> b\n}\nx -> g.a\n`,
    text: "Group",
    shape: "g",
  })),
  ...["top-center", "bottom-center", "center-left", "outside-top-center"].map((near) => ({
    name: `edge-label-near-${near}`,
    source: `a -> b: {\n  label: lbl\n  label.near: ${near}\n}\n`,
    text: "lbl",
  })),
  // Legend / caption building blocks for the auto engine (#124 §3).
  {
    name: "legend-root-near-bottom-right",
    source:
      'a -> b\nb -> c\nkey: Key {\n  near: bottom-right\n  grid-columns: 3\n  p1: "" {shape: circle; width: 2; height: 2}\n  p2: "" {shape: circle; width: 2; height: 2}\n  t: skip {shape: text}\n}\nkey.p1 -> key.p2: {style.stroke-dash: 3}\n',
    text: "skip",
    shape: "key",
  },
  {
    name: "legend-child-near",
    source: "g: G {\n  a -> b\n  key: Key {near: bottom-right}\n}\n",
    text: "Key",
  },
  {
    name: "caption-wrapper-outside-bottom",
    source:
      'w: "(a) Encoder" {\n  label.near: outside-bottom-center\n  style.stroke-width: 0\n  g: Group {\n    label.near: top-left\n    a -> b\n  }\n}\n',
    text: "(a) Encoder",
    shape: "w",
  },
  {
    name: "edge-label-default",
    source: "a -> b: {\n  label: lbl\n}\n",
    text: "lbl",
  },
  {
    name: "edge-target-arrowhead-label",
    source: "a -> b: {\n  target-arrowhead.label: lbl\n}\n",
    text: "lbl",
  },
  {
    name: "edge-source-arrowhead-label",
    source: "a -> b: {\n  source-arrowhead.label: lbl\n}\n",
    text: "lbl",
  },
  {
    name: "edge-label-position-attr",
    source: "a -> b: {\n  label: lbl\n  label.position: 0.2\n}\n",
    text: "lbl",
  },
];

/** The first `<text …>` whose content is `text`: its x / y attributes. */
function textAt(svg: string, text: string): { x: number; y: number } | undefined {
  const re = /<text\b([^>]*)>([^<]*)<\/text>/g;
  for (const m of svg.matchAll(re)) {
    if (m[2]?.trim() !== text) continue;
    const x = /\bx="([-\d.]+)"/.exec(m[1] ?? "");
    const y = /\by="([-\d.]+)"/.exec(m[1] ?? "");
    if (x && y) return { x: Number(x[1]), y: Number(y[1]) };
  }
  return undefined;
}

/** The first `<rect>` inside the shape group of D2 key `key` (class = base64 of the key). */
function shapeRect(svg: string, key: string) {
  const cls = Buffer.from(key).toString("base64");
  const at = svg.indexOf(`class="${cls}"`);
  if (at < 0) return undefined;
  const rect = /<rect\b([^>]*)>/.exec(svg.slice(at));
  if (!rect) return undefined;
  const n = (a: string) => Number(new RegExp(`\\b${a}="([-\\d.]+)"`).exec(rect[1] ?? "")?.[1]);
  return { x: n("x"), y: n("y"), width: n("width"), height: n("height") };
}

// Sumi's auto engine uses ELK; the edge probes also run with dagre, to tell
// "ELK ignores it" from "D2 ignores it".
const runs = probes.flatMap((p) =>
  (p.name.startsWith("edge-") ? ["elk", "dagre"] : ["elk"]).map((layout) => ({ ...p, layout })),
);

const results = runs.map((p) => {
  const base = `${p.name}.${p.layout}`;
  const d2 = join(OUT, `${base}.d2`);
  const svgPath = join(OUT, `${base}.svg`);
  writeFileSync(d2, p.source);
  const run = Bun.spawnSync([D2, "--layout", p.layout, d2, svgPath]);
  if (run.exitCode !== 0) {
    const error = run.stderr
      .toString()
      .trim()
      .split("\n")[0]
      ?.replace(/^.*\.d2:/, "<file>:");
    return { probe: p.name, layout: p.layout, accepted: false, error };
  }
  const svg = readFileSync(svgPath, "utf8");
  const at = textAt(svg, p.text);
  const rect = p.shape === undefined ? undefined : shapeRect(svg, p.shape);
  const relative =
    at && rect
      ? {
          dx: Math.round((at.x - rect.x) * 10) / 10,
          dy: Math.round((at.y - rect.y) * 10) / 10,
          width: rect.width,
          height: rect.height,
        }
      : undefined;
  return {
    probe: p.name,
    layout: p.layout,
    accepted: true,
    text: at,
    ...(relative && { relative }),
  };
});

const version = Bun.spawnSync([D2, "--version"]).stdout.toString().trim();
const report = `${JSON.stringify({ d2: version, results }, null, 1)}\n`;
if (process.argv.includes("--record")) {
  const dir = join(import.meta.dir, "../results");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "d2-probes.json"), report);
}
process.stdout.write(report);
