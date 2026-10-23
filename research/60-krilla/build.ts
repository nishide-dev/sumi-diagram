import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const manifest = "research/60-krilla/wasm/Cargo.toml";
const toolchain = "1.98.1";
function run(args: string[], env = process.env): string {
  const result = Bun.spawnSync(args, { cwd: root, env });
  if (result.exitCode !== 0) throw new Error(`${args.join(" ")}: ${result.stderr}`);
  return result.stdout.toString().trim();
}
const sysroot = run(["rustup", "run", toolchain, "rustc", "--print", "sysroot"]);
const env = {
  ...process.env,
  PATH: `${sysroot}/bin:${process.env.PATH}`,
  DYLD_FALLBACK_LIBRARY_PATH: `${sysroot}/lib`,
  RUSTFLAGS: `--remap-path-prefix=${root}=/sumi --remap-path-prefix=${process.env.CARGO_HOME ?? `${process.env.HOME}/.cargo`}=/cargo`,
};
run(
  [
    "cargo",
    "build",
    "--manifest-path",
    manifest,
    "--release",
    "--locked",
    "--target",
    "wasm32-unknown-unknown",
  ],
  env,
);
const metadata = JSON.parse(
  run(
    [
      "cargo",
      "metadata",
      "--manifest-path",
      manifest,
      "--locked",
      "--format-version",
      "1",
      "--filter-platform",
      "wasm32-unknown-unknown",
    ],
    env,
  ),
) as {
  packages: { name: string; version: string; license: string | null }[];
};
const bytes = readFileSync(
  resolve(
    root,
    "research/60-krilla/wasm/target/wasm32-unknown-unknown/release/sumi_krilla_poc.wasm",
  ),
);
mkdirSync(resolve(root, "research/60-krilla/out"), { recursive: true });
const report = {
  toolchain,
  wasmBytes: bytes.length,
  wasmSha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  gzipBytes: Bun.gzipSync(bytes).length,
  licenses: metadata.packages
    .map(({ name, version, license }) => ({ name, version, license }))
    .sort((a, b) => a.name.localeCompare(b.name)),
};
await Bun.write(
  resolve(root, "research/60-krilla/out/build.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(
  JSON.stringify({ ...report, licenses: [...new Set(report.licenses.map((p) => p.license))] }),
);
