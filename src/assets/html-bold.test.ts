import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { Renderer } from "@takumi-rs/wasm/node";
import { FONT_ASSETS_DIR } from "../core/theme/fonts";
import { loadEngine, runEngine } from "../render/pdf/engine";
import { smearSyntheticBold } from "./html-bold";

const mono = readFileSync(`${FONT_ASSETS_DIR}/biz-ud-gothic/BIZUDGothic-Regular.ttf`);

async function raw(html: string): Promise<string> {
  const renderer = new Renderer();
  try {
    return await renderer.renderSvg(html, {
      width: 60,
      height: 40,
      fonts: [{ name: "M", data: mono, weight: 400 }],
    });
  } finally {
    renderer.free();
  }
}

/** Alpha-weighted ink per row of the picture resvg makes of `svg`. */
function inkRows(svg: string): number[] {
  const out = runEngine(loadEngine(), new TextEncoder().encode(svg), [mono], "picture");
  if (!out.ok) throw new Error(out.message);
  const png = out.pdf.subarray(
    4,
    4 + new DataView(out.pdf.buffer, out.pdf.byteOffset).getUint32(0, true),
  );
  const view = new DataView(png.buffer, png.byteOffset);
  let width = 0;
  let height = 0;
  const idat: Uint8Array[] = [];
  for (let at = 8; at < png.length; ) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const body = png.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = new DataView(body.buffer, body.byteOffset).getUint32(0);
      height = new DataView(body.buffer, body.byteOffset).getUint32(4);
    }
    if (type === "IDAT") idat.push(body);
    at += 12 + length;
  }
  const data = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const px = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = data[y * (stride + 1)] as number;
    for (let x = 0; x < stride; x++) {
      const v = data[y * (stride + 1) + 1 + x] as number;
      const left = x >= 4 ? (px[y * stride + x - 4] as number) : 0;
      const up = y ? (px[(y - 1) * stride + x] as number) : 0;
      const ul = y && x >= 4 ? (px[(y - 1) * stride + x - 4] as number) : 0;
      const paeth = () => {
        const p = left + up - ul;
        const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - ul)];
        return pa <= pb && pa <= pc ? left : pb <= pc ? up : ul;
      };
      px[y * stride + x] = (v + [0, left, up, (left + up) >> 1, paeth()][filter]!) & 255;
    }
  }
  const rows: number[] = [];
  for (let y = 0; y < height; y++) {
    let ink = 0;
    for (let x = 0; x < width; x++) ink += px[y * stride + x * 4 + 3] as number;
    rows.push(ink);
  }
  return rows;
}

/** Rows between the dot and the stem of "i": a blank row between two inked runs. */
function dotStemGap(rows: number[]): number {
  const first = rows.findIndex((r) => r > 0);
  const last = rows.length - 1 - [...rows].reverse().findIndex((r) => r > 0);
  const inked = rows.slice(first, last + 1);
  let gap = 0;
  for (const r of inked) if (r < 40) gap++;
  return gap;
}

const card = (color: string, extra = "") =>
  `<div style="font-family:M;font-size:14px;font-weight:700;color:${color};${extra}">i</div>`;

test("the dot of a synthetic-bold i stays separate from its stem, which the stroked output loses (#495)", async () => {
  for (const color of ["#000000", "rgba(0,0,0,0.5)"]) {
    const svg = await raw(card(color));
    expect(svg).toContain("stroke-width");
    const fixed = smearSyntheticBold(svg);
    expect(fixed).not.toContain("stroke-width");
    // Regular text sets the gap; the stroke eats a row of it, the smear does not.
    const regular = dotStemGap(inkRows(await raw(card(color).replace("700", "400"))));
    expect(dotStemGap(inkRows(fixed))).toBe(regular);
    expect(dotStemGap(inkRows(svg))).toBeLessThan(regular);
  }
});

test("rewriting keeps opacity and a path-level transform and ignores non-bold strokes", () => {
  const out = smearSyntheticBold(
    '<path stroke-width=".5" stroke-opacity=".5" fill-opacity=".5" transform="rotate(5)" stroke="#f00" fill="#f00" d="M0 0h1v1Z"/>',
  );
  expect(out).toBe(
    '<g fill="#f00" opacity=".5"><path d="M0 0h1v1Z" transform="rotate(5) translate(-0.25 0)"/><path d="M0 0h1v1Z" transform="rotate(5) translate(0.25 0)"/></g>',
  );
  for (const keep of [
    '<path d="M0 0h50" fill="none" stroke="#f00" stroke-width="2" stroke-dasharray="6 5"/>',
    '<path d="M0 0h1v1Z" fill="#fff" stroke="#000" stroke-width=".5"/>',
    '<path d="M0 0h1v1Z" fill="#fff" fill-opacity=".5" stroke="#fff" stroke-width=".5"/>',
    '<path d="M0 0h1v1Z" fill="#fff"/>',
  ])
    expect(smearSyntheticBold(keep)).toBe(keep);
});

test("regular text and solid, dashed and dotted borders pass through byte for byte", async () => {
  for (const html of [
    '<div style="font-family:M;font-size:14px">figure.sumi.yaml</div>',
    '<div style="width:50px;height:30px;border:2px solid red;border-radius:6px"></div>',
    '<div style="width:50px;height:30px;border:2px dashed red"></div>',
    '<div style="width:50px;height:30px;border:2px dotted red"></div>',
  ]) {
    const svg = await raw(html);
    expect(smearSyntheticBold(svg)).toBe(svg);
  }
});
