/**
 * Runs the svg2pdf PoC compiled to wasm32-unknown-unknown (svg2pdf-poc, raw C
 * ABI) from Bun, with no WASI and no host imports. The module would be
 * embedded in the single binary (`bun build --compile` can embed files).
 */

import { readFileSync } from "node:fs";

interface Exports {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  add_font(ptr: number, len: number): void;
  convert(ptr: number, len: number, textToPaths: number): number;
  output_ptr(): number;
}

export async function loadSvg2Pdf(wasmPath: string, fonts: Uint8Array[]) {
  const { instance } = await WebAssembly.instantiate(readFileSync(wasmPath), {});
  const wasm = instance.exports as unknown as Exports;
  const pass = (bytes: Uint8Array): number => {
    const ptr = wasm.alloc(bytes.length);
    new Uint8Array(wasm.memory.buffer, ptr, bytes.length).set(bytes);
    return ptr;
  };
  for (const font of fonts) wasm.add_font(pass(font), font.length);

  return (svg: Uint8Array, textToPaths = false): Uint8Array => {
    const n = wasm.convert(pass(svg), svg.length, textToPaths ? 1 : 0);
    const out = new Uint8Array(wasm.memory.buffer, wasm.output_ptr(), Math.abs(n)).slice();
    if (n <= 0) throw new Error(new TextDecoder().decode(out));
    return out;
  };
}
