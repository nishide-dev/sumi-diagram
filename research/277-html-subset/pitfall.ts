/** Failure-mode preview: whitespace between flex children inside a white-space:pre container. */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEngine, runEngine } from "../../src/render/pdf/engine";
import { base, fontFiles, sourceHtml, takumi, takumiMeasure } from "./gen";

const svg = await takumi(sourceHtml("html-pitfall", "code-window-pre-container"));
const r = runEngine(
  loadEngine(),
  new TextEncoder().encode(svg),
  [fontFiles.mono, fontFiles.inter],
  "picture",
);
if (!r.ok) throw new Error(r.message);
const n = new DataView(r.pdf.buffer, r.pdf.byteOffset).getUint32(0, true);
writeFileSync(join(base, "out", "pitfall-takumi.png"), r.pdf.subarray(4, n + 4));
const m: any = await takumiMeasure(sourceHtml("html-pitfall", "code-window-pre-container"));
const runs: string[] = [];
(function w(x: any) {
  for (const q of x.runs ?? []) runs.push(JSON.stringify(q.text));
  for (const c of x.children ?? []) w(c);
})(m);
console.log(runs.join(" "));
