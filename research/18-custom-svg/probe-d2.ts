/**
 * #18: probes of D2 v0.9.0 behaviour that the design memo relies on
 * (docs/research/18-custom-svg-components.md). Plain D2 sources rendered with
 * the pinned binary; prints one line per finding and writes the SVGs to
 * `out/probe-*.svg`.
 *
 *   bun research/18-custom-svg/probe-d2.ts
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { findD2Binary } from "../../src/backends/d2/binary";
import { parsePath } from "../../src/render/geometry";
import { attribute, childElements, classList, descendants, parseXml } from "../../src/render/xml";

const OUT = join(import.meta.dir, "out");

const TRAPEZOID_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><path d="M20 0 L80 0 L100 50 L0 50 Z" fill="#eee" stroke="#000"/></svg>';
const DATA_URI = `data:image/svg+xml;base64,${Buffer.from(TRAPEZOID_SVG).toString("base64")}`;

const PROBES: Record<string, string> = {
  // (b) shape: image with an SVG data URI, default label position and center-center.
  image: `direction: right
a: { label: "In" }
img: { label: "Trap"; shape: image; icon: "${DATA_URI}"; width: 160; height: 70 }
imgc: { label: "Trap"; shape: image; icon: "${DATA_URI}"; width: 160; height: 70; label.near: center-center }
a -> img -> imgc
`,
  // D2's own edge clipping on non-rectangular built-ins, and style.multiple (a native "stack").
  builtin: `direction: right
a: { label: "In" }
step: { label: "Step"; shape: step }
multi: { label: "Stack"; shape: rectangle; style.multiple: true }
b: { label: "Out" }
a -> step -> multi -> b
`,
  // (a) placeholder rectangle with an explicit footprint.
  placeholder: `direction: right
a: { label: "In" }
c: { label: "In 2" }
t: { label: "Trap"; shape: rectangle; width: 160; height: 70 }
a -> t
c -> t
`,
};

interface Shape {
  tag: string;
  box: string;
  label?: string;
}

function summarize(svg: string) {
  const parsed = parseXml(svg);
  if (!parsed.ok) throw new Error(parsed.message);
  const shapes = new Map<string, Shape>();
  const ends: string[] = [];
  for (const g of descendants(parsed.root)) {
    if (g.name !== "g") continue;
    const shape = childElements(g).find((c) => classList(c).includes("shape"));
    const key = Buffer.from(classList(g)[0] ?? "", "base64").toString();
    if (shape !== undefined) {
      const drawn = childElements(shape);
      const first = drawn[0];
      const n = (name: string) => attribute(first ?? shape, name);
      const text = childElements(g).find((c) => c.name === "text");
      shapes.set(key, {
        tag: drawn.map((d) => d.name).join("+"),
        box:
          n("width") === undefined
            ? `d=${n("d")}`
            : `x=${n("x")} y=${n("y")} w=${n("width")} h=${n("height")}`,
        ...(text && { label: `text x=${attribute(text, "x")} y=${attribute(text, "y")}` }),
      });
    }
    const path = childElements(g).find((c) => classList(c).includes("connection"));
    if (path !== undefined) {
      const parsedPath = parsePath(attribute(path, "d") ?? "");
      if (!parsedPath.ok) continue;
      const first = parsedPath.segments[0]?.to;
      const last = parsedPath.segments.at(-1)?.to;
      ends.push(`${key}: (${first?.x}, ${first?.y}) → (${last?.x}, ${last?.y})`);
    }
  }
  return { shapes, ends };
}

const found = findD2Binary();
if (!found.ok) throw new Error("D2 not found; run `bun run d2:install`.");
const d2 = found.value.path;
for (const [name, source] of Object.entries(PROBES)) {
  const input = join(OUT, `probe-${name}.d2`);
  const output = join(OUT, `probe-${name}.svg`);
  writeFileSync(input, source);
  const proc = Bun.spawnSync([d2, "--layout", "elk", "--omit-version", input, output]);
  if (proc.exitCode !== 0) throw new Error(proc.stderr.toString());
  const { shapes, ends } = summarize(await Bun.file(output).text());
  console.log(`## ${name}`);
  for (const [key, s] of shapes) {
    console.log(`  ${key}: <${s.tag}> ${s.box.slice(0, 90)}${s.label ? `; ${s.label}` : ""}`);
  }
  for (const end of ends) console.log(`  edge ${end}`);
}
