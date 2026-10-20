/**
 * Builds the PDF engine (`bun run pdf:wasm`; #59, design doc §6.12) from
 * `native/svg2pdf-wasm/`:
 *
 * 1. Downloads svg2pdf 0.13.0 from crates.io, verifies its sha256, unpacks it
 *    to `native/svg2pdf-wasm/vendor/` (gitignored) and applies
 *    `svg2pdf-deterministic.patch` (the crate's `[patch.crates-io]` points there).
 * 2. `cargo build --release --locked --target wasm32-unknown-unknown` with the
 *    toolchain pinned in `rust-toolchain.toml`. Local paths are remapped
 *    (`--remap-path-prefix`) so panic locations embedded in the module do not
 *    depend on the checkout or `CARGO_HOME`.
 * 3. Copies the module to `assets/wasm/sumi-svg2pdf.wasm` and writes its
 *    sha256 into `src/render/pdf/engine.ts` (`SVG2PDF_WASM_SHA256`).
 * 4. Regenerates the third-party list (`native/svg2pdf-wasm/THIRD_PARTY.md`)
 *    and the license files of every crate compiled into the module
 *    (`native/svg2pdf-wasm/licenses/<crate>-<version>/`, shipped in the
 *    release tarball under `licenses/svg2pdf-wasm/`) from `cargo metadata`.
 *
 * The reference build is linux-x64: CI runs this there and fails if anything
 * committed changes (`git diff`). Each host builds the same bytes every time,
 * but hosts differ in a few code bytes (darwin-arm64 vs linux-x64; not paths,
 * presumably LLVM folding float constants with the host's math library), so a
 * module built elsewhere is for local testing. To commit a change, take the
 * module the CI job uploads when it differs and install it with
 *
 *   bun run pdf:wasm --adopt <sumi-svg2pdf.wasm>
 *
 * which copies it and updates `SVG2PDF_WASM_SHA256` without building.
 *
 * Needs rustup; nothing is installed system-wide except the pinned toolchain
 * and its wasm32 target (rustup's own directories).
 */

import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";
import { type CommandArgv, runCommand } from "../src/core/subprocess";
import { sha256Hex } from "./release/lib";

const ROOT = resolve(import.meta.dir, "..");
const CRATE = join(ROOT, "native", "svg2pdf-wasm");
const VENDOR = join(CRATE, "vendor");
const SVG2PDF = {
  name: "svg2pdf",
  version: "0.13.0",
  sha256: "e50dc062439cc1a396181059c80932a6e6bd731b130e674c597c0c8874b6df22",
};
const WASM_OUT = join(ROOT, "assets", "wasm", "sumi-svg2pdf.wasm");
const ENGINE_TS = join(ROOT, "src", "render", "pdf", "engine.ts");
const LICENSES = join(CRATE, "licenses");
const THIRD_PARTY = join(CRATE, "THIRD_PARTY.md");
const TARGET = "wasm32-unknown-unknown";

const log = (message: string) => console.error(message);

async function run(argv: CommandArgv, env: Record<string, string> = {}): Promise<string> {
  const result = await runCommand(argv, {
    cwd: CRATE,
    timeoutMs: 1_800_000,
    env: { ...process.env, ...env },
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `${argv.join(" ")} exited with ${result.exitCode ?? result.signal}:\n${result.stderr}${result.stdout}`,
    );
  }
  return result.stdout;
}

async function toolchain(): Promise<string> {
  const toml = await readFile(join(CRATE, "rust-toolchain.toml"), "utf8");
  const channel = /^channel\s*=\s*"([^"]+)"/m.exec(toml)?.[1];
  if (channel === undefined) throw new Error("rust-toolchain.toml has no channel");
  return channel;
}

/** svg2pdf 0.13.0 from crates.io (sha256-verified), freshly unpacked and patched. */
async function vendorSvg2pdf(): Promise<void> {
  const crateFile = join(VENDOR, `${SVG2PDF.name}-${SVG2PDF.version}.crate`);
  await mkdir(VENDOR, { recursive: true });
  if (!existsSync(crateFile) || sha256Hex(await readFile(crateFile)) !== SVG2PDF.sha256) {
    const url = `https://static.crates.io/crates/${SVG2PDF.name}/${SVG2PDF.name}-${SVG2PDF.version}.crate`;
    log(`Downloading ${url}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const actual = sha256Hex(bytes);
    if (actual !== SVG2PDF.sha256) {
      throw new Error(`${url}: sha256 ${actual}, expected ${SVG2PDF.sha256}`);
    }
    await writeFile(crateFile, bytes);
  }
  const dir = join(VENDOR, `${SVG2PDF.name}-${SVG2PDF.version}`);
  await rm(dir, { recursive: true, force: true });
  await run(["tar", "-xzf", crateFile, "-C", VENDOR]);
  await run(["patch", "-d", dir, "-p1", "-i", join(CRATE, "svg2pdf-deterministic.patch")]);
  log(`Unpacked and patched ${relative(ROOT, dir)} (crate sha256 ${SVG2PDF.sha256})`);
}

interface CargoPackage {
  id: string;
  name: string;
  version: string;
  license: string | null;
  repository: string | null;
  manifest_path: string;
  targets: { kind: string[] }[];
}

interface CargoMetadata {
  packages: CargoPackage[];
  resolve: {
    root: string;
    nodes: { id: string; deps: { pkg: string; dep_kinds: { kind: string | null }[] }[] }[];
  };
}

/**
 * Crates compiled into the module (normal dependencies reachable from the
 * root for the wasm target) and crates used only while building it
 * (proc-macros and their dependencies).
 */
function classify(meta: CargoMetadata): { embedded: CargoPackage[]; buildOnly: CargoPackage[] } {
  const byId = new Map(meta.packages.map((p) => [p.id, p]));
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
  const isProcMacro = (p: CargoPackage) => p.targets.some((t) => t.kind.includes("proc-macro"));
  const embedded = new Set<string>();
  const buildOnly = new Set<string>();
  const walk = (id: string, into: Set<string>) => {
    if (into.has(id)) return;
    into.add(id);
    for (const dep of nodes.get(id)?.deps ?? []) {
      const normal = dep.dep_kinds.some((k) => k.kind === null);
      const build = dep.dep_kinds.some((k) => k.kind === "build");
      const pkg = byId.get(dep.pkg);
      if (pkg === undefined) continue;
      if (into === embedded && normal && !isProcMacro(pkg)) walk(dep.pkg, embedded);
      else if (normal || build) walk(dep.pkg, buildOnly);
    }
  };
  walk(meta.resolve.root, embedded);
  embedded.delete(meta.resolve.root);
  for (const id of embedded) buildOnly.delete(id);
  const sorted = (ids: Set<string>) =>
    [...ids]
      .map((id) => byId.get(id))
      .filter((p): p is CargoPackage => p !== undefined)
      .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  return { embedded: sorted(embedded), buildOnly: sorted(buildOnly) };
}

const LICENSE_FILE = /^(licen[cs]e|copying|notice|copyright|unlicense)([-._].*)?$/i;

async function writeLicenses(meta: CargoMetadata): Promise<void> {
  const { embedded, buildOnly } = classify(meta);
  await rm(LICENSES, { recursive: true, force: true });
  const rows: string[] = [];
  for (const pkg of embedded) {
    const dir = resolve(pkg.manifest_path, "..");
    const files = (await readdir(dir)).filter((f) => LICENSE_FILE.test(f)).sort();
    if (files.length === 0) {
      throw new Error(`${pkg.name} ${pkg.version} has no license file in ${dir}`);
    }
    if (pkg.license === null) throw new Error(`${pkg.name} ${pkg.version} declares no license`);
    const out = join(LICENSES, `${pkg.name}-${pkg.version}`);
    await mkdir(out, { recursive: true });
    for (const file of files) await copyFile(join(dir, file), join(out, file));
    const patched = pkg.name === SVG2PDF.name ? " (patched, see below)" : "";
    rows.push(
      `| ${pkg.name} | ${pkg.version}${patched} | ${pkg.license} | ${files.map((f) => `\`${pkg.name}-${pkg.version}/${f}\``).join(", ")} |`,
    );
  }
  const build = buildOnly.map((p) => `| ${p.name} | ${p.version} | ${p.license ?? "?"} |`);
  const text = `# Third-party crates in sumi-svg2pdf.wasm

Generated by \`bun run pdf:wasm\` from \`cargo metadata\` (Cargo.lock, target
\`${TARGET}\`); do not edit by hand. Shipped in the release tarball as
\`licenses/svg2pdf-wasm/\` (design doc §6.8, §6.12).

## Compiled into the module

Every crate below is compiled for \`assets/wasm/sumi-svg2pdf.wasm\` (the
normal dependencies Cargo resolves for the wasm target; link-time
optimization may drop parts of some), which is embedded in \`bin/sumi\`.
Their license files, copied unmodified from the crate packages, are in
\`licenses/<crate>-<version>/\`.

| Crate | Version | License (SPDX) | License files |
| --- | --- | --- | --- |
${rows.join("\n")}

svg2pdf's NOTICE says which parts are under other licenses: the ICC profiles
in \`src/icc/\` (CC0-1.0; the sRGB profile is written into every PDF) and
parts of \`src/util/helper.rs\` and \`src/render/path.rs\` (MPL-2.0). The MPL-2.0
source is the crate itself: https://crates.io/crates/svg2pdf/0.13.0 (sha256
\`${SVG2PDF.sha256}\`), modified only by
\`native/svg2pdf-wasm/svg2pdf-deterministic.patch\` (which does not touch those
files). The CC BY-SA 4.0 file listed in that NOTICE is a test fixture that is
not in the crate package.

## Used only to build the module (not shipped)

| Crate | Version | License (SPDX) |
| --- | --- | --- |
${build.join("\n")}
`;
  await writeFile(THIRD_PARTY, text);
  log(
    `Wrote ${relative(ROOT, THIRD_PARTY)}: ${embedded.length} embedded crates, ${buildOnly.length} build-only`,
  );
}

async function updateEngineSha(sha: string): Promise<void> {
  const source = await readFile(ENGINE_TS, "utf8");
  const pattern = /(export const SVG2PDF_WASM_SHA256 =\s*")[0-9a-f]{64}(";)/;
  if (!pattern.test(source)) throw new Error(`SVG2PDF_WASM_SHA256 not found in ${ENGINE_TS}`);
  const updated = source.replace(pattern, `$1${sha}$2`);
  if (updated !== source) {
    await writeFile(ENGINE_TS, updated);
    log(`Updated SVG2PDF_WASM_SHA256 in ${relative(ROOT, ENGINE_TS)}`);
  }
}

/** The host the committed module is built on (CI's `pdf-wasm` job). */
const REFERENCE_HOST = "linux-x64";

/** `--adopt <file>`: installs a module built elsewhere (the CI artifact) without building. */
async function adopt(file: string): Promise<void> {
  const bytes = await readFile(file);
  if (bytes.subarray(0, 4).toString("latin1") !== "\0asm") {
    throw new Error(`${file} is not a WebAssembly module`);
  }
  const sha = sha256Hex(bytes);
  await copyFile(file, WASM_OUT);
  await chmod(WASM_OUT, 0o644);
  await updateEngineSha(sha);
  log(`Adopted ${file} as ${relative(ROOT, WASM_OUT)}: ${bytes.length} bytes, sha256 ${sha}`);
  console.log(sha);
}

async function main(): Promise<void> {
  const host = `${process.platform}-${process.arch}`;
  if (host !== REFERENCE_HOST) {
    log(
      `Note: the committed module is built on ${REFERENCE_HOST}; on ${host} a few bytes differ. Use this build for local testing; commit the one from CI (--adopt).`,
    );
  }
  const channel = await toolchain();
  const rustup = (args: string[]) => run(["rustup", ...args]);
  await rustup(["toolchain", "install", channel, "--profile", "minimal", "--target", TARGET]);
  const sysroot = (await rustup(["run", channel, "rustc", "--print", "sysroot"])).trim();
  const cargoHome = process.env.CARGO_HOME ?? join(homedir(), ".cargo");
  const env = {
    // The pinned toolchain's own cargo / rustc first (not whatever rustup proxy is on PATH).
    PATH: `${join(sysroot, "bin")}:${process.env.PATH ?? ""}`,
    // Some rustup installs (macOS) lack the rpath from rust-lld to libLLVM.
    DYLD_FALLBACK_LIBRARY_PATH: join(sysroot, "lib"),
    CARGO_TARGET_DIR: join(CRATE, "target"),
    CARGO_ENCODED_RUSTFLAGS: [
      `--remap-path-prefix=${CRATE}=/sumi-svg2pdf`,
      `--remap-path-prefix=${cargoHome}=/cargo`,
    ].join("\x1f"),
  };
  log(`Toolchain ${channel} (${sysroot})`);

  await vendorSvg2pdf();
  await run(["cargo", "build", "--release", "--locked", "--target", TARGET], env);
  const built = join(CRATE, "target", TARGET, "release", "sumi_svg2pdf.wasm");
  const bytes = await readFile(built);
  const sha = sha256Hex(bytes);
  await mkdir(resolve(WASM_OUT, ".."), { recursive: true });
  await copyFile(built, WASM_OUT);
  await chmod(WASM_OUT, 0o644); // cargo's output is executable; the committed file is data
  await updateEngineSha(sha);
  log(`Wrote ${relative(ROOT, WASM_OUT)}: ${bytes.length} bytes, sha256 ${sha}`);

  const meta = JSON.parse(
    await run(
      ["cargo", "metadata", "--format-version", "1", "--locked", "--filter-platform", TARGET],
      env,
    ),
  ) as CargoMetadata;
  await writeLicenses(meta);
  console.log(sha);
}

const args = process.argv.slice(2);
try {
  if (args[0] === "--adopt" && args[1] !== undefined && args.length === 2) await adopt(args[1]);
  else if (args.length === 0) await main();
  else {
    console.error("Usage: bun run pdf:wasm [--adopt <sumi-svg2pdf.wasm>]");
    process.exit(2);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
