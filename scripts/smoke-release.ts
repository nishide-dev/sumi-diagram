/**
 * Smoke-tests a release tarball (`bun run release:smoke <tarball> [--keep]`;
 * design doc §6.8, #20). Used by CI (release.yml, ci.yml) and by hand.
 *
 * Extracts the tarball into a fresh temporary directory whose path contains a
 * space, then runs the extracted `sumi` from an empty working directory
 * outside the repository, with a minimal environment: `PATH` limited to the
 * system directories (no Bun or Node.js), a temporary `HOME`, and no
 * `SUMI_D2_PATH`, so only the files in the tarball can satisfy it. Checks:
 *
 * 1. the tarball's `.sha256` (when present next to it) and the inner `SHA256SUMS`
 * 2. `sumi --version` matches `VERSION`
 * 3. `sumi doctor --json` passes, in compiled mode, with the bundled D2
 * 4. `sumi render` of a figure with Japanese labels exits 0 and writes a
 *    well-formed SVG that contains the labels
 * 5. the same through a symlink to `bin/sumi` in another directory
 *
 * Exits 1 on the first failure.
 */

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import pkg from "../package.json";
import { RELEASE_LAYOUT } from "../src/core/install-layout";
import { runCommand } from "../src/core/subprocess";
import { descendants, parseXml, textContent } from "../src/render/xml";
import { parseSha256Sums, sha256Hex } from "./release/lib";

const SYSTEM_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

const FIGURE = `version: 1
figure:
  id: smoke
  title: リリース smoke test
  layout:
    direction: down

groups:
  - id: system
    label: 処理系

nodes:
  - id: input
    component: box
    label: 入力データ
  - id: parse
    component: box
    label: 構文解析
    group: system
  - id: output
    component: cylinder
    label: 出力 (SVG)

edges:
  - from: input
    to: parse
    label: 読み込み
  - from: parse
    to: output
`;
const EXPECTED_LABELS = ["入力データ", "構文解析", "出力 (SVG)", "読み込み", "処理系"];

class SmokeFailure extends Error {}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new SmokeFailure(message);
}

function step(message: string): void {
  console.log(`ok - ${message}`);
}

async function smoke(tarballArg: string, keep: boolean): Promise<void> {
  const tarball = resolve(tarballArg);
  check(existsSync(tarball), `${tarball} does not exist`);
  const name = basename(tarball).replace(/\.tar\.gz$/, "");
  const bytes = await readFile(tarball);

  // 1a. The tarball's own checksum, if published next to it.
  for (const sums of [`${tarball}.sha256`, join(dirname(tarball), "SHA256SUMS")]) {
    if (!existsSync(sums)) continue;
    const expected = parseSha256Sums(await readFile(sums, "utf8")).get(basename(tarball));
    if (expected === undefined) continue;
    check(sha256Hex(bytes) === expected, `${basename(tarball)} does not match ${sums}`);
    step(`tarball sha256 matches ${basename(sums)}`);
  }

  const root = await mkdtemp(join(tmpdir(), "sumi smoke "));
  try {
    const extracted = join(root, "install dir");
    const work = join(root, "work dir");
    const home = join(root, "home");
    await Promise.all([extracted, work, home].map((d) => mkdir(d, { recursive: true })));

    const tar = await runCommand(["tar", "-xzf", tarball, "-C", extracted]);
    check(tar.exitCode === 0, `tar failed: ${tar.stderr}`);
    const top = await readdir(extracted);
    check(
      top.length === 1 && top[0] === name,
      `expected one top-level directory ${name}, got ${top.join(", ")}`,
    );
    const prefix = join(extracted, name);
    step(`extracted to "${prefix}"`);

    // 1b. Every file listed in the inner SHA256SUMS, and nothing unlisted.
    const inner = parseSha256Sums(await readFile(join(prefix, "SHA256SUMS"), "utf8"));
    for (const path of Object.values(RELEASE_LAYOUT)) {
      check(
        [...inner.keys()].some((f) => f === path || f.startsWith(`${path}/`)),
        `SHA256SUMS lists nothing under ${path}`,
      );
    }
    for (const required of [
      "LICENSE",
      "NOTICE",
      "licenses/d2/LICENSE.txt",
      "licenses/biz-ud-gothic/OFL.txt",
      "licenses/bun/LICENSE.md",
    ]) {
      check(inner.has(required), `the tarball lacks ${required}`);
    }
    // Every production dependency is bundled into bin/sumi and needs its license text.
    for (const dependency of Object.keys(pkg.dependencies)) {
      check(
        [...inner.keys()].some((f) => f.startsWith(`licenses/npm/${dependency}/`)),
        `the tarball lacks the license of the bundled npm package ${dependency}`,
      );
    }
    for (const [file, expected] of inner) {
      check(sha256Hex(await readFile(join(prefix, file))) === expected, `${file}: sha256 mismatch`);
    }
    step(`${inner.size} files match the inner SHA256SUMS`);

    const env: Record<string, string> = { PATH: SYSTEM_PATH, HOME: home, TMPDIR: root, LANG: "C" };
    for (const runtime of ["bun", "node"]) {
      check(
        Bun.which(runtime, { PATH: SYSTEM_PATH }) === null,
        `${runtime} is on the restricted PATH (${SYSTEM_PATH}); the smoke test would not prove the binary is standalone`,
      );
    }
    const sumiAt = async (sumi: string, args: string[]) => {
      const result = await runCommand([sumi, ...args], { cwd: work, env, timeoutMs: 120_000 });
      const out = `${result.stdout}${result.stderr}`.trim();
      check(
        result.exitCode === 0,
        `sumi ${args.join(" ")} exited with ${result.exitCode ?? result.signal}:\n${out}`,
      );
      return result.stdout;
    };
    const sumi = join(prefix, RELEASE_LAYOUT.sumi);

    // 2. Version.
    const version = (await readFile(join(prefix, "VERSION"), "utf8")).trim();
    const reported = (await sumiAt(sumi, ["--version"])).trim();
    check(reported === version, `sumi --version printed "${reported}", VERSION says "${version}"`);
    step(`sumi --version: ${reported} (without Bun or Node.js on PATH)`);

    // 3. Doctor, through the binary and through a symlink elsewhere.
    const doctor = async (path: string, label: string) => {
      const report = JSON.parse(await sumiAt(path, ["doctor", "--json"]));
      check(report.ok === true, `${label}: doctor reported failures`);
      check(
        report.runtime?.mode === "compiled",
        `${label}: runtime mode is ${report.runtime?.mode}`,
      );
      const d2 = report.checks.find((c: { id: string }) => c.id === "d2");
      check(
        d2?.status === "ok" && d2.details?.source === "bundled",
        `${label}: D2 is not the bundled one: ${JSON.stringify(d2)}`,
      );
      check(
        d2.details.path === join(await realpath(prefix), RELEASE_LAYOUT.d2),
        `${label}: unexpected D2 path ${d2.details.path}`,
      );
      const fonts = report.checks.find((c: { id: string }) => c.id === "fonts");
      check(fonts?.status === "ok", `${label}: fonts check failed: ${JSON.stringify(fonts)}`);
      step(`${label}: sumi doctor ok (bundled D2, ${fonts.message})`);
    };
    await doctor(sumi, "direct");
    const linkDir = join(root, "link bin");
    await mkdir(linkDir);
    await symlink(sumi, join(linkDir, "sumi"));
    await doctor(join(linkDir, "sumi"), "symlink");

    // 4. Render a figure with Japanese labels.
    await Bun.write(join(work, "図.sumi.yaml"), FIGURE);
    for (const [path, label] of [
      [sumi, "direct"],
      [join(linkDir, "sumi"), "symlink"],
    ] as const) {
      const svgPath = join(work, `出力-${label}.svg`);
      await sumiAt(path, ["render", "図.sumi.yaml", "-o", svgPath]);
      const svg = await readFile(svgPath, "utf8");
      const parsed = parseXml(svg);
      check(
        parsed.ok,
        `${label}: rendered SVG is not well-formed XML: ${parsed.ok ? "" : parsed.message}`,
      );
      check(parsed.root.name === "svg", `${label}: root element is <${parsed.root.name}>`);
      const texts = [...descendants(parsed.root)]
        .filter((e) => e.name === "text")
        .map((e) => textContent(e));
      const missing = EXPECTED_LABELS.filter((l) => !texts.some((t) => t.includes(l)));
      check(missing.length === 0, `${label}: SVG lacks the labels ${missing.join(", ")}`);
      step(`${label}: sumi render wrote a valid SVG (${svg.length} bytes) with Japanese labels`);
    }

    console.log(`\nSmoke test passed: ${basename(tarball)}`);
  } finally {
    if (keep) console.log(`Kept ${root}`);
    else await rm(root, { recursive: true, force: true });
  }
}

const args = Bun.argv.slice(2);
const keep = args.includes("--keep");
const positional = args.filter((a) => a !== "--keep");
if (positional.length !== 1 || positional[0]?.startsWith("-")) {
  console.error("Usage: bun run release:smoke <sumi-<version>-<target>.tar.gz> [--keep]");
  process.exit(2);
}
try {
  await smoke(positional[0] as string, keep);
} catch (error) {
  console.error(`not ok - ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
