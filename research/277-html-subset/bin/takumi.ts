import { readFileSync } from "node:fs";
import { Renderer } from "@takumi-rs/wasm/node";

const t0 = performance.now();
const font = readFileSync(process.argv[2]!);
const r = new Renderer();
const svg = await r.renderSvg(
  '<div style="display:flex;background:#eee;font-size:20px;font-family:F">Hello 日本</div>',
  { width: 200, height: 50, fonts: [{ name: "F", data: font, weight: 400 }] as never },
);
console.log("takumi ok", svg.length, Math.round(performance.now() - t0), "ms");
