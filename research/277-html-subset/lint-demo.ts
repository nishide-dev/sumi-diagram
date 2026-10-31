/** Can content bounds / text size be measured? Takumi measure() gives a layout tree with text runs. */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { base, sourceHtml, takumiMeasure } from "./gen";

type M = {
  width: number;
  height: number;
  transform: number[];
  children: M[];
  runs: { text: string; x: number; y: number; width: number; height: number }[];
};
function boxes(
  n: M,
  _ox = 0,
  _oy = 0,
  acc: { kind: string; text?: string; x: number; y: number; w: number; h: number }[] = [],
) {
  // measure() transforms are already absolute (root-relative), not parent-relative.
  const x = n.transform[4]!;
  const y = n.transform[5]!;
  acc.push({ kind: "box", x, y, w: n.width, h: n.height });
  for (const r of n.runs)
    acc.push({ kind: "run", text: r.text, x: x + r.x, y: y + r.y, w: r.width, h: r.height });
  for (const c of n.children) boxes(c, x, y, acc);
  return acc;
}
const cases: Record<string, string> = {
  "text-card": sourceHtml("html-safe", "text-card"),
  "overflow-fixed-box": `<div style="display:flex;width:320px;height:176px;background:#fff"><div style="display:flex;width:60px;height:20px;font-size:16px;font-family:Inter;white-space:nowrap">A very long unbroken sentence that overflows</div></div>`,
  "tiny-text": `<div style="display:flex;width:320px;height:176px"><div style="display:flex;font-size:5px;font-family:Inter">tiny</div></div>`,
};
const out: Record<string, unknown> = {};
for (const [name, html] of Object.entries(cases)) {
  const m = (await takumiMeasure(html)) as unknown as M;
  const all = boxes(m);
  const runs = all.filter((b) => b.kind === "run");
  const maxRight = Math.max(...all.map((b) => b.x + b.w));
  const maxBottom = Math.max(...all.map((b) => b.y + b.h));
  out[name] = {
    root: [m.width, m.height],
    contentBounds: { maxRight: +maxRight.toFixed(2), maxBottom: +maxBottom.toFixed(2) },
    overflowsRoot: maxRight > m.width + 0.01 || maxBottom > m.height + 0.01,
    runs: runs.slice(0, 6).map((r) => ({
      text: r.text,
      x: +r.x.toFixed(1),
      y: +r.y.toFixed(1),
      w: +r.w.toFixed(1),
      h: +r.h.toFixed(1),
    })),
    minRunHeightPx: runs.length ? Math.min(...runs.map((r) => r.h)) : null,
  };
}
console.log(JSON.stringify(out, null, 1));
writeFileSync(join(base, "out", "lint-demo.json"), JSON.stringify(out, null, 2));
