/** Generation helpers shared by the scripts. Runs under both Bun and Node (type stripping). */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as T from "@takumi-rs/wasm/node";
import satori from "satori";
import { htmlToVdom } from "./html-vdom";

export const base = dirname(fileURLToPath(import.meta.url));
const fontDir = join(base, "../../assets/fonts");
const read = (p: string) => readFileSync(join(fontDir, p));
export const fontFiles = {
  mono: read("biz-ud-gothic/BIZUDGothic-Regular.ttf"),
  inter: read("inter/Inter-Regular.ttf"),
  interBold: read("inter/Inter-Bold.ttf"),
};
const specs = [
  { name: "BIZ UDGothic", data: fontFiles.mono, weight: 400 },
  { name: "Inter", data: fontFiles.inter, weight: 400 },
  { name: "Inter", data: fontFiles.interBold, weight: 700 },
] as const;

let renderer: T.Renderer | undefined;
export async function takumi(html: string, w = 320, h = 176): Promise<string> {
  renderer ??= new T.Renderer();
  return renderer.renderSvg(html, {
    width: w,
    height: h,
    fonts: specs.map((s) => ({ ...s })) as never,
  });
}
export async function takumiMeasure(html: string, w = 320, h = 176) {
  renderer ??= new T.Renderer();
  return renderer.measure(html, {
    width: w,
    height: h,
    fonts: specs.map((s) => ({ ...s })) as never,
  });
}
export async function satoriSvg(html: string, embedFont = true, w = 320, h = 176): Promise<string> {
  return satori(
    htmlToVdom(html) as never,
    {
      width: w,
      height: h,
      embedFont,
      fonts: specs.map((s) => ({ ...s, style: "normal" as const })),
    } as never,
  );
}
export const sourceHtml = (dir: string, name: string) =>
  readFileSync(join(base, dir, `${name}.html`), "utf8");
