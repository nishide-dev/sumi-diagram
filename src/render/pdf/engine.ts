/**
 * The PDF engine (#59): svg2pdf 0.13.0 (with Sumi's determinism patch)
 * compiled to `wasm32-unknown-unknown` from `native/svg2pdf-wasm/` by
 * `bun run pdf:wasm`, committed as `assets/wasm/sumi-svg2pdf.wasm`.
 *
 * The module is imported as a file, so `bun build --compile` embeds it in the
 * single binary (a `/$bunfs/` path there, the file in the checkout when run
 * from source). It has no imports (no WASI, no host functions): it can only
 * read the SVG and font bytes handed to it and return bytes.
 *
 * The bytes are checked against {@link SVG2PDF_WASM_SHA256} before use. Each
 * conversion gets a fresh instance of the compiled module, so no state (fonts,
 * grown memory) carries over from one conversion to the next.
 */

import { readFileSync } from "node:fs";
import wasmPath from "../../../assets/wasm/sumi-svg2pdf.wasm" with { type: "file" };

/** sha256 of `assets/wasm/sumi-svg2pdf.wasm`; written by `bun run pdf:wasm`. */
export const SVG2PDF_WASM_SHA256 =
  "7a8ea73e55d113facda46ed261f6dd144d1fee341ab02d96bccd3bc128e7e71d";

/** The svg2pdf release the engine is built from (crates.io, plus the determinism patch). */
export const SVG2PDF_VERSION = "0.13.0";

/** Path of the engine module (inside the binary's `/$bunfs/` when compiled). */
export const SVG2PDF_WASM_PATH: string = wasmPath;

interface EngineExports {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  add_font(ptr: number, len: number): void;
  convert(ptr: number, len: number): number;
  output_ptr(): number;
}

export type EngineResult = { ok: true; pdf: Uint8Array } | { ok: false; message: string };

let compiled: WebAssembly.Module | undefined;

/**
 * Loads and compiles the engine once per process. Throws if the module is
 * missing or does not match {@link SVG2PDF_WASM_SHA256}.
 */
export function loadEngine(path: string = SVG2PDF_WASM_PATH): WebAssembly.Module {
  if (compiled !== undefined && path === SVG2PDF_WASM_PATH) return compiled;
  const bytes = readFileSync(path);
  const actual = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  if (actual !== SVG2PDF_WASM_SHA256) {
    throw new Error(
      `the PDF engine ${path} has sha256 ${actual}, expected ${SVG2PDF_WASM_SHA256} (rebuild it with \`bun run pdf:wasm\`)`,
    );
  }
  const module = new WebAssembly.Module(bytes);
  if (path === SVG2PDF_WASM_PATH) compiled = module;
  return module;
}

/**
 * Converts an SVG whose fonts are already resolved to real family names
 * (`resolveSvgFonts()`), with exactly the given font files available. The
 * first font is the fallback for text that names no known family.
 *
 * A trap of the module (out-of-bounds access after a stack overflow, out of
 * memory, `unreachable` after a Rust panic) or a module without the expected
 * exports is returned as a failure, never thrown. The instance is discarded
 * either way; the next call gets a fresh one.
 */
export function runEngine(
  module: WebAssembly.Module,
  svg: Uint8Array,
  fonts: readonly Uint8Array[],
): EngineResult {
  try {
    const instance = new WebAssembly.Instance(module, {});
    const wasm = instance.exports as unknown as EngineExports;
    const pass = (bytes: Uint8Array): number => {
      const ptr = wasm.alloc(bytes.length);
      new Uint8Array(wasm.memory.buffer, ptr, bytes.length).set(bytes);
      return ptr;
    };
    for (const font of fonts) wasm.add_font(pass(font), font.length);
    const n = wasm.convert(pass(svg), svg.length);
    const out = new Uint8Array(wasm.memory.buffer, wasm.output_ptr(), Math.abs(n)).slice();
    return n > 0 ? { ok: true, pdf: out } : { ok: false, message: new TextDecoder().decode(out) };
  } catch (e) {
    const reason = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    return {
      ok: false,
      message: `the engine stopped (${reason.replace(/\s*\(evaluating .*\)$/, "")})`,
    };
  }
}
