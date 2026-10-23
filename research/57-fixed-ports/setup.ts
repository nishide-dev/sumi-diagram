/** Isolated, integrity-checked research dependency; never changes package.json or bun.lock. */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runCommand } from "../../src/core/subprocess";

export const ELK_VERSION = "0.12.0";
export const ELK_INTEGRITY =
  "YZcKynxVxYoKIOEpywEPwCFdg+BTbxQRNf3pbwdDCvc8O3kQD8bmIwSxKU1eOTVc4Xo+VG9Te+575mlfvOrhEQ==";
export const TOOLS = join(import.meta.dir, ".tools");
export const PACKAGE = join(TOOLS, "elkjs");
export const BUNDLE = join(PACKAGE, "lib", "elk.bundled.js");

export async function setup(): Promise<void> {
  await mkdir(TOOLS, { recursive: true });
  const archive = join(TOOLS, `elkjs-${ELK_VERSION}.tgz`);
  let bytes: Uint8Array;
  try {
    bytes = await readFile(archive);
  } catch {
    const response = await fetch(`https://registry.npmjs.org/elkjs/-/elkjs-${ELK_VERSION}.tgz`);
    if (!response.ok) throw new Error(`elkjs download: ${response.status}`);
    bytes = new Uint8Array(await response.arrayBuffer());
  }
  if (new Bun.CryptoHasher("sha512").update(bytes).digest("base64") !== ELK_INTEGRITY)
    throw new Error("elkjs tarball integrity mismatch");
  await writeFile(archive, bytes);
  await rm(PACKAGE, { recursive: true, force: true });
  await mkdir(PACKAGE);
  const tar = await runCommand(["tar", "-xzf", archive, "--strip-components=1", "-C", PACKAGE]);
  if (tar.exitCode !== 0) throw new Error(tar.stderr);
}

if (import.meta.main) await setup();
