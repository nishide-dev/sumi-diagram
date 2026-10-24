/**
 * Builds the PDF engine (`bun run pdf:wasm`; #59, design doc §6.12) from
 * `native/pdf-wasm/`:
 *
 * 1. Resolves checksum-verified crates.io packages from Cargo.lock (no patches).
 * 2. `cargo build --release --locked --target wasm32-unknown-unknown` with the
 *    toolchain pinned in `rust-toolchain.toml`. Local paths are remapped
 *    (`--remap-path-prefix`) so panic locations embedded in the module do not
 *    depend on the checkout or `CARGO_HOME`.
 * 3. Copies the module to `assets/wasm/sumi-pdf.wasm` and writes its
 *    sha256 into `src/render/pdf/engine.ts` (`PDF_WASM_SHA256`).
 * 4. Regenerates the third-party list (`native/pdf-wasm/THIRD_PARTY.md`)
 *    and the license files of every crate compiled into the module
 *    (`native/pdf-wasm/licenses/<crate>-<version>/`, shipped in the
 *    release tarball under `licenses/pdf-wasm/`) from `cargo metadata`.
 *
 * The reference build is linux-x64: CI runs this there and fails if anything
 * committed changes (`git diff`). Each host builds the same bytes every time,
 * but hosts differ in a few code bytes (darwin-arm64 vs linux-x64; not paths,
 * presumably LLVM folding float constants with the host's math library), so a
 * module built elsewhere is for local testing. To commit a change, take the
 * module the CI job uploads when it differs and install it with
 *
 *   bun run pdf:wasm --adopt <sumi-pdf.wasm>
 *
 * which copies it and updates `PDF_WASM_SHA256` without building.
 *
 * Needs rustup; nothing is installed system-wide except the pinned toolchain
 * and its wasm32 target (rustup's own directories).
 */

import { chmod, copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";
import { type CommandArgv, runCommand } from "../src/core/subprocess";
import { sha256Hex } from "./release/lib";

const ROOT = resolve(import.meta.dir, "..");
const CRATE = join(ROOT, "native", "pdf-wasm");
const WASM_OUT = join(ROOT, "assets", "wasm", "sumi-pdf.wasm");
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

// These releases omit workspace-root licenses from their .crate packages.
// Their .cargo_vcs_info.json pins this exact source revision.
const KRILLA_SOURCE = "3ffdf0588cf98050aad6edba51ca70162e1fb5b5";
const KRILLA_LICENSES = {
  LICENSE_APACHE: "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30",
  LICENSE_MIT: "9d1eb142840c7acfd5511b4dd298cece3f0053f5809228906445cd8a3365592f",
  "NOTICE.md": "7aa87a70e18c9c160b5a14e24b46a8e407858b21fed635920c701657b4bd7976",
};
async function verifiedText(url: string, expected: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (sha256Hex(bytes) !== expected) throw new Error(`${url}: license checksum mismatch`);
  return bytes;
}

async function writeLicenses(meta: CargoMetadata): Promise<void> {
  const { embedded, buildOnly } = classify(meta);
  await rm(LICENSES, { recursive: true, force: true });
  const rows: string[] = [];
  for (const pkg of embedded) {
    const dir = resolve(pkg.manifest_path, "..");
    let files = (await readdir(dir)).filter((f) => LICENSE_FILE.test(f)).sort();
    if (pkg.license === null) throw new Error(`${pkg.name} ${pkg.version} declares no license`);
    const out = join(LICENSES, `${pkg.name}-${pkg.version}`);
    await mkdir(out, { recursive: true });
    if (
      files.length === 0 &&
      ((pkg.name === "krilla" && pkg.version === "0.8.2") ||
        (pkg.name === "krilla-svg" && pkg.version === "0.8.1"))
    ) {
      const vcs = JSON.parse(await readFile(join(dir, ".cargo_vcs_info.json"), "utf8"));
      if (vcs.git?.sha1 !== KRILLA_SOURCE)
        throw new Error(`${pkg.name}: unexpected source revision`);
      for (const [file, sha] of Object.entries(KRILLA_LICENSES)) {
        await writeFile(
          join(out, file),
          await verifiedText(
            `https://raw.githubusercontent.com/LaurenzV/krilla/${KRILLA_SOURCE}/${file}`,
            sha,
          ),
        );
      }
      await writeFile(
        join(out, "LICENSE-MPL-2.0"),
        await verifiedText(
          "https://raw.githubusercontent.com/spdx/license-list-data/v3.27.0/text/MPL-2.0.txt",
          "66a3107d5ad6a058aab753eaac2047ccb2ed0e39465dd0fe5844da3e300d5172",
        ),
      );
      files = [...Object.keys(KRILLA_LICENSES), "LICENSE-MPL-2.0"].sort();
    } else {
      if (files.length === 0)
        throw new Error(`${pkg.name} ${pkg.version} has no license file in ${dir}`);
      for (const file of files) await copyFile(join(dir, file), join(out, file));
    }
    rows.push(
      `| ${pkg.name} | ${pkg.version} | ${pkg.license} | ${files.map((f) => `\`${pkg.name}-${pkg.version}/${f}\``).join(", ")} |`,
    );
  }
  const build = buildOnly.map((p) => `| ${p.name} | ${p.version} | ${p.license ?? "?"} |`);
  const text = `# Third-party crates in sumi-pdf.wasm

Generated by \`bun run pdf:wasm\` from \`cargo metadata\` (Cargo.lock, target
\`${TARGET}\`); do not edit by hand. Shipped in the release tarball as
\`licenses/pdf-wasm/\` (design doc §6.8, §6.12).

## Compiled into the module

Every crate below is compiled for \`assets/wasm/sumi-pdf.wasm\` (the
normal dependencies Cargo resolves for the wasm target; link-time
optimization may drop parts of some), which is embedded in \`bin/sumi\`.
Their license files, copied unmodified (see the krilla exception below), are in
\`licenses/<crate>-<version>/\`.

| Crate | Version | License (SPDX) | License files |
| --- | --- | --- | --- |
${rows.join("\n")}

krilla and krilla-svg are unmodified crates.io packages. Cargo.lock pins
their versions and package checksums. Their packages omit workspace license
files, so LICENSE_APACHE, LICENSE_MIT and NOTICE.md come from their package's
source revision https://github.com/LaurenzV/krilla/tree/${KRILLA_SOURCE}.
Each file's SHA-256 is pinned and checked in scripts/build-pdf-wasm.ts.
NOTICE.md identifies MPL-2.0 portions of content_draw_path; the unmodified
corresponding source is available at that revision (crates/krilla/src/).
The MPL-2.0 text is copied from SPDX license-list-data v3.27.0, also checksum
verified. Unicode data licenses and other crate notices are included too.

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
  const pattern = /(export const PDF_WASM_SHA256 =\s*")[0-9a-f]{64}(";)/;
  if (!pattern.test(source)) throw new Error(`PDF_WASM_SHA256 not found in ${ENGINE_TS}`);
  const updated = source.replace(pattern, `$1${sha}$2`);
  if (updated !== source) {
    await writeFile(ENGINE_TS, updated);
    log(`Updated PDF_WASM_SHA256 in ${relative(ROOT, ENGINE_TS)}`);
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
      `--remap-path-prefix=${CRATE}=/sumi-pdf`,
      `--remap-path-prefix=${cargoHome}=/cargo`,
    ].join("\x1f"),
  };
  log(`Toolchain ${channel} (${sysroot})`);

  await run(["cargo", "build", "--release", "--locked", "--target", TARGET], env);
  const built = join(CRATE, "target", TARGET, "release", "sumi_pdf.wasm");
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
    console.error("Usage: bun run pdf:wasm [--adopt <sumi-pdf.wasm>]");
    process.exit(2);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
