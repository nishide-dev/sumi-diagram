import { readFileSync } from "node:fs";
import satori from "satori";
import { htmlToVdom } from "../html-vdom";

const t0 = performance.now();
const font = readFileSync(process.argv[2]!);
const svg = await satori(
  htmlToVdom('<div style="display:flex;background:#eee;font-size:20px">Hello 日本</div>') as never,
  { width: 200, height: 50, fonts: [{ name: "F", data: font, weight: 400, style: "normal" }] },
);
console.log("satori ok", svg.length, Math.round(performance.now() - t0), "ms");
