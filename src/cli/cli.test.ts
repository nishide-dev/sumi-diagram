/**
 * End-to-end tests of the `sumi` CLI: each test spawns the real entry point
 * (`bun src/cli/index.ts …`) and checks exit code, stdout and stderr.
 *
 * `render` needs the pinned D2: skipped locally without it (with a message),
 * required in CI (`CI` set).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import {
  chmod,
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import pkg from "../../package.json";
import { checkD2Version, findD2Binary } from "../backends/d2/binary";
import { D2_VERSION } from "../backends/d2/version";
import { buildFullCatalog } from "../core/catalog";
import { BUILTIN_PROFILES } from "../core/profile/builtin";
import { createBuiltinRegistry } from "../core/registry/builtins";
import { buildCatalog } from "../core/registry/catalog";
import { runCommand } from "../core/subprocess";
import { BUILTIN_THEMES } from "../core/theme/builtin";
import { BUNDLED_FONT_SHA256 } from "../core/theme/fonts";
import { readSvgMetadata } from "../render";
import { isCaseInsensitiveDir } from "./io";
import { run } from "./program";

const ROOT = join(import.meta.dir, "..", "..");
const ENTRY = join(import.meta.dir, "index.ts");
const FIXTURES = join(ROOT, "tests", "fixtures", "figures");
const TIMEOUT_MS = 30_000;

const baseEnv = (): Record<string, string | undefined> => {
  const { NO_COLOR: _n, FORCE_COLOR: _f, SUMI_D2_PATH: _d, SUMI_DEBUG: _s, ...env } = process.env;
  return env;
};

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "sumi-cli-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function sumi(args: string[], options: { cwd?: string; env?: Record<string, string> } = {}) {
  return runCommand([process.execPath, ENTRY, ...args], {
    cwd: options.cwd ?? dir,
    env: { ...baseEnv(), ...options.env },
    timeoutMs: TIMEOUT_MS,
  });
}

/**
 * Runs `sumi` with stdout connected to a pipe whose reader is already gone
 * (like `sumi … | head -c 0`): the read end is closed right after spawning,
 * before the child can write, so every stdout write fails with EPIPE.
 */
async function sumiClosedStdout(
  args: string[],
  options: { env?: Record<string, string> } = {},
): Promise<{ exitCode: number | null; stderr: string }> {
  const child = spawn(process.execPath, [ENTRY, ...args], {
    cwd: dir,
    env: { ...baseEnv(), ...options.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.destroy();
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code));
  });
  return { exitCode, stderr };
}

/** Copies a fixture into the temp dir and returns its file name there. */
async function copyFixture(name: string, as = name.replace(/^.*\//, "")): Promise<string> {
  await copyFile(join(FIXTURES, name), join(dir, as));
  return as;
}

describe("sumi (global)", () => {
  test("--version prints the package version", async () => {
    const result = await sumi(["--version"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(pkg.version);
  });

  test("--help lists every command, stream roles and exit codes", async () => {
    const result = await sumi(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: sumi");
    for (const command of ["render", "lint", "fmt", "doctor", "catalog"]) {
      expect(result.stdout).toContain(`  ${command} `);
    }
    expect(result.stdout).toContain("Exit codes:");
    expect(result.stderr).toBe("");
  });

  test("each command has help", async () => {
    for (const command of ["render", "lint", "fmt", "doctor", "catalog"]) {
      const result = await sumi([command, "--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(`Usage: sumi ${command}`);
    }
  });

  test("an unknown option, unknown command or missing argument is a usage error (2)", async () => {
    for (const args of [["--no-such-option"], ["frobnicate"], ["lint"], ["render"], []]) {
      const result = await sumi(args);
      expect(result.exitCode).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).not.toBe("");
    }
    expect((await sumi(["--no-such-option"])).stderr).toContain("unknown option");
  });
});

describe("sumi lint", () => {
  test("a clean figure exits 0 with a summary on stdout", async () => {
    const file = await copyFixture("lint/clean.sumi.yaml");
    const result = await sumi(["lint", file]);
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(result.stdout).toBe("0 errors, 0 warnings, 0 infos\n");
  });

  test("errors exit 1; diagnostics name the file as given", async () => {
    const file = await copyFixture("invalid/ref-unknown-endpoint.sumi.yaml");
    const result = await sumi(["lint", file]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(`${file}:11:9 error ref/unknown-endpoint`);
    expect(result.stdout).toEndWith("1 error, 2 warnings, 0 infos\n");
  });

  test("invalid YAML exits 1 with a yaml diagnostic", async () => {
    const file = await copyFixture("invalid/yaml-syntax.sumi.yaml");
    const result = await sumi(["lint", file]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("error yaml/syntax");
  });

  test("warnings pass unless --max-warnings is exceeded (over all files)", async () => {
    const a = await copyFixture("lint/ancestor-edge.sumi.yaml");
    const b = await copyFixture("lint/no-edges.sumi.yaml");
    expect((await sumi(["lint", a, b])).exitCode).toBe(0);
    const over = await sumi(["lint", "--max-warnings", "2", a, b]);
    expect(over.exitCode).toBe(1);
    expect(over.stdout).toContain("Too many warnings (3; maximum 2).");
    expect((await sumi(["lint", "--max-warnings", "3", a, b])).exitCode).toBe(0);
  });

  test("--rule and --config change rule levels; flags win over the file", async () => {
    const file = await copyFixture("lint/self-loop.sumi.yaml");
    expect((await sumi(["lint", file])).exitCode).toBe(0);
    expect((await sumi(["lint", "--rule", "lint/self-loop=error", file])).exitCode).toBe(1);
    await writeFile(
      join(dir, "lint.json"),
      JSON.stringify({ rules: { "lint/self-loop": "error" } }),
    );
    expect((await sumi(["lint", "--config", "lint.json", file])).exitCode).toBe(1);
    const off = await sumi(["lint", "--config", "lint.json", "--rule", "lint/self-loop=off", file]);
    expect(off).toMatchObject({ exitCode: 0, stdout: "0 errors, 0 warnings, 0 infos\n" });
  });

  test("invalid configuration is a usage error (2)", async () => {
    const file = await copyFixture("lint/clean.sumi.yaml");
    const unknown = await sumi(["lint", "--rule", "lint/self-lop=off", file]);
    expect(unknown.exitCode).toBe(2);
    expect(unknown.stderr).toContain('Did you mean "lint/self-loop"?');
    for (const args of [
      ["--rule", "lint/self-loop"],
      ["--rule", "lint/self-loop=loud"],
      ["--max-warnings", "-1"],
      ["--config", "missing.json"],
      ["--geometry", "--rule", "geometry/no-such-rule=off"],
    ]) {
      const result = await sumi(["lint", ...args, file]);
      expect(result.exitCode).toBe(2);
      expect(result.stdout).toBe("");
    }
    await writeFile(join(dir, "bad.json"), "{ not json");
    expect((await sumi(["lint", "--config", "bad.json", file])).exitCode).toBe(2);
  });

  test("a missing file is a usage error (2); other files are still linted", async () => {
    const file = await copyFixture("lint/self-loop.sumi.yaml");
    const result = await sumi(["lint", "missing.sumi.yaml", file]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe(
      "sumi: error: Cannot read missing.sumi.yaml: no such file or directory\n",
    );
    expect(result.stdout).toContain("info lint/self-loop");
  });

  test("--json prints one versioned envelope per file and a total summary", async () => {
    const a = await copyFixture("lint/self-loop.sumi.yaml");
    const b = await copyFixture("lint/clean.sumi.yaml");
    const result = await sumi(["lint", "--json", a, b]);
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    const json = JSON.parse(result.stdout);
    expect(Object.keys(json)).toEqual(["version", "results", "summary"]);
    expect(json.version).toBe(1);
    expect(json.results.map((r: { file: string }) => r.file)).toEqual([a, b]);
    expect(Object.keys(json.results[0])).toEqual(["version", "file", "diagnostics", "summary"]);
    expect(json.results[0].diagnostics[0]).toMatchObject({
      code: "lint/self-loop",
      severity: "info",
      location: { file: a, line: 9, column: 5 },
    });
    expect(json.summary).toEqual({ errors: 0, warnings: 0, infos: 1 });
  });

  test("output is deterministic and uncolored unless forced", async () => {
    const file = await copyFixture("lint/ancestor-edge.sumi.yaml");
    const first = await sumi(["lint", file]);
    expect((await sumi(["lint", file])).stdout).toBe(first.stdout);
    expect(first.stdout).not.toContain("\u001b[");
    const forced = await sumi(["lint", file], { env: { FORCE_COLOR: "1" } });
    expect(forced.stdout).toContain("\u001b[33mwarning\u001b[0m");
    const disabled = await sumi(["lint", "--no-color", file], { env: { FORCE_COLOR: "1" } });
    expect(disabled.stdout).toBe(first.stdout);
    const noColor = await sumi(["lint", file], { env: { FORCE_COLOR: "1", NO_COLOR: "1" } });
    expect(noColor.stdout).toBe(first.stdout);
  });
});

describe("sumi fmt", () => {
  const unformatted = `# A figure.
version:   1
figure:
    id: demo     # trailing comment
    title: 'Quoted'

nodes:
- id: a
  component: box
  # the label
  label: "A\\tB"
`;
  const formatted = `# A figure.
version: 1
figure:
  id: demo # trailing comment
  title: 'Quoted'

nodes:
  - id: a
    component: box
    # the label
    label: "A\\tB"
`;

  test("--check exits 0 for formatted and 1 for unformatted files, writing nothing", async () => {
    await writeFile(join(dir, "ok.sumi.yaml"), formatted);
    await writeFile(join(dir, "messy.sumi.yaml"), unformatted);
    expect(await sumi(["fmt", "--check", "ok.sumi.yaml"])).toMatchObject({
      exitCode: 0,
      stdout: "",
      stderr: "",
    });
    expect(await sumi(["fmt", "--check", "ok.sumi.yaml", "messy.sumi.yaml"])).toMatchObject({
      exitCode: 1,
      stdout: "messy.sumi.yaml\n",
      stderr: "",
    });
    expect(await readFile(join(dir, "messy.sumi.yaml"), "utf8")).toBe(unformatted);
  });

  test("rewrites files in place keeping comments and permissions, then is a no-op", async () => {
    const path = join(dir, "inplace.sumi.yaml");
    await writeFile(path, unformatted);
    await chmod(path, 0o640);
    expect(await sumi(["fmt", "inplace.sumi.yaml"])).toMatchObject({
      exitCode: 0,
      stdout: "inplace.sumi.yaml\n",
      stderr: "",
    });
    expect(await readFile(path, "utf8")).toBe(formatted);
    expect((await stat(path)).mode & 0o777).toBe(0o640);
    expect(await sumi(["fmt", "inplace.sumi.yaml"])).toMatchObject({ exitCode: 0, stdout: "" });
  });

  test("--stdout prints the formatted text without writing", async () => {
    await writeFile(join(dir, "stdout.sumi.yaml"), unformatted);
    expect(await sumi(["fmt", "--stdout", "stdout.sumi.yaml"])).toMatchObject({
      exitCode: 0,
      stdout: formatted,
      stderr: "",
    });
    expect(await readFile(join(dir, "stdout.sumi.yaml"), "utf8")).toBe(unformatted);
  });

  test("--canonical-order puts known keys in schema order", async () => {
    await writeFile(join(dir, "order.sumi.yaml"), "figure:\n  id: x\nversion: 1\n");
    const result = await sumi(["fmt", "--stdout", "--canonical-order", "order.sumi.yaml"]);
    expect(result.stdout).toBe("version: 1\nfigure:\n  id: x\n");
  });

  test("refuses invalid YAML (exit 1, diagnostics on stderr, file untouched)", async () => {
    const file = await copyFixture("invalid/yaml-duplicate-key.sumi.yaml");
    const before = await readFile(join(dir, file), "utf8");
    const result = await sumi(["fmt", file]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("error yaml/duplicate-key");
    expect(await readFile(join(dir, file), "utf8")).toBe(before);
  });

  test("usage errors exit 2", async () => {
    await writeFile(join(dir, "u.sumi.yaml"), formatted);
    for (const args of [
      ["--check", "--stdout", "u.sumi.yaml"],
      ["--stdout", "u.sumi.yaml", "u.sumi.yaml"],
      ["missing.sumi.yaml"],
    ]) {
      const result = await sumi(["fmt", ...args]);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toStartWith("sumi: error: ");
    }
  });

  test("formats the target of a symbolic link and keeps the link", async () => {
    await mkdir(join(dir, "fmt-real"));
    const target = join(dir, "fmt-real", "target.sumi.yaml");
    const link = join(dir, "fmt-link.sumi.yaml");
    await writeFile(target, unformatted);
    await symlink(join("fmt-real", "target.sumi.yaml"), link);

    expect(await sumi(["fmt", "fmt-link.sumi.yaml"])).toMatchObject({
      exitCode: 0,
      stdout: "fmt-link.sumi.yaml\n",
      stderr: "",
    });
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(await readFile(target, "utf8")).toBe(formatted);
    expect(await readdir(join(dir, "fmt-real"))).toEqual(["target.sumi.yaml"]);

    // The target itself, too.
    await writeFile(target, unformatted);
    expect((await sumi(["fmt", "fmt-real/target.sumi.yaml"])).exitCode).toBe(0);
    expect(await readFile(target, "utf8")).toBe(formatted);
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
  });

  test("a broken symbolic link is a usage error", async () => {
    await symlink(join(dir, "no-such-target.sumi.yaml"), join(dir, "broken.sumi.yaml"));
    const result = await sumi(["fmt", "broken.sumi.yaml"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toStartWith("sumi: error: Cannot read broken.sumi.yaml");
  });
});

describe("sumi render (output paths)", () => {
  // Checked before D2 runs, so no D2 is needed.
  let input: string;
  beforeAll(async () => {
    await mkdir(join(dir, "real"));
    await symlink("real", join(dir, "alias"));
    await copyFile(join(FIXTURES, "lint/clean.sumi.yaml"), join(dir, "real", "fig.sumi.yaml"));
    input = await readFile(join(dir, "real", "fig.sumi.yaml"), "utf8");
  });

  test("refuses to overwrite the input, also through a symlinked directory", async () => {
    for (const args of [
      ["-o", "alias/fig.sumi.yaml"],
      ["--emit-d2", "alias/fig.sumi.yaml"],
      ["-o", "./real/../real/fig.sumi.yaml"],
    ]) {
      const result = await sumi(["render", "real/fig.sumi.yaml", ...args]);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("would overwrite the input file real/fig.sumi.yaml");
      expect(await readFile(join(dir, "real", "fig.sumi.yaml"), "utf8")).toBe(input);
    }
  });

  test("refuses the same file for --out and --emit-d2", async () => {
    for (const d2 of ["result.svg", "./result.svg", "alias/../real/../result.svg"]) {
      const result = await sumi([
        "render",
        "real/fig.sumi.yaml",
        "-o",
        "result.svg",
        "--emit-d2",
        d2,
      ]);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("are the same file");
    }
    const aliased = await sumi([
      "render",
      "real/fig.sumi.yaml",
      "-o",
      "real/out.svg",
      "--emit-d2",
      "alias/out.svg",
    ]);
    expect(aliased.exitCode).toBe(2);
    expect(aliased.stderr).toContain("are the same file");
    expect(await Bun.file(join(dir, "real", "out.svg")).exists()).toBe(false);
  });

  test("refuses outputs differing only by case on a case-insensitive file system", async () => {
    if (!(await isCaseInsensitiveDir(await realpath(dir)))) {
      console.warn("[cli render] the temp file system is case-sensitive; skipping the case test.");
      return;
    }
    const result = await sumi([
      "render",
      "real/fig.sumi.yaml",
      "-o",
      "result.svg",
      "--emit-d2",
      "RESULT.svg",
    ]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("are the same file");
    const input = await sumi(["render", "real/fig.sumi.yaml", "-o", "real/FIG.SUMI.YAML"]);
    expect(input.exitCode).toBe(2);
    expect(input.stderr).toContain("would overwrite the input file");
  });
});

describe("sumi catalog", () => {
  test("--json prints exactly buildFullCatalog(): components, themes and profiles", async () => {
    const result = await sumi(["catalog", "--json"]);
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    const json = JSON.parse(result.stdout);
    expect(json).toEqual(JSON.parse(JSON.stringify(buildFullCatalog(createBuiltinRegistry()))));
    expect(Object.keys(json)).toEqual(["version", "components", "themes", "profiles"]);
    expect(json.version).toBe(1);
    // The version 1 contract of #14 is unchanged: the components are buildCatalog()'s.
    expect(json.components).toEqual(
      JSON.parse(JSON.stringify(buildCatalog(createBuiltinRegistry()).components)),
    );
    expect(json.themes.map((t: { id: string }) => t.id)).toEqual([...BUILTIN_THEMES.keys()]);
    expect(json.profiles.map((p: { id: string }) => p.id)).toEqual([...BUILTIN_PROFILES.keys()]);
    for (const theme of json.themes) {
      expect(Object.keys(theme)).toEqual([
        "id",
        "description",
        "fonts",
        "fontSizePt",
        "missingVariants",
        "compatibleProfiles",
      ]);
    }
    for (const profile of json.profiles) {
      expect(Object.keys(profile)).toEqual([
        "id",
        "description",
        "page",
        "margin",
        "typography",
        "layout",
      ]);
    }
  });

  test("--section selects sections; --kind alone keeps the components-only output", async () => {
    const sections = JSON.parse(
      (await sumi(["catalog", "--json", "--section", "profiles", "--section", "themes"])).stdout,
    );
    expect(Object.keys(sections)).toEqual(["version", "themes", "profiles"]);
    // As before #37: `--kind` without `--section` prints { version, components }.
    const kind = JSON.parse((await sumi(["catalog", "--json", "--kind", "group"])).stdout);
    expect(kind).toEqual(
      JSON.parse(JSON.stringify(buildCatalog(createBuiltinRegistry(), { kind: "group" }))),
    );
    const both = JSON.parse(
      (
        await sumi([
          "catalog",
          "--json",
          "--kind",
          "edge",
          "--section",
          "components",
          "--section",
          "themes",
        ])
      ).stdout,
    );
    expect(Object.keys(both)).toEqual(["version", "components", "themes"]);
    expect(both.components.every((c: { kind: string }) => c.kind === "edge")).toBe(true);

    for (const args of [
      ["--section", "fonts"],
      ["--kind", "shape"],
      ["--kind", "node", "--section", "themes"],
    ]) {
      const result = await sumi(["catalog", ...args]);
      expect(result.exitCode, args.join(" ")).toBe(2);
      expect(result.stdout).toBe("");
    }
  });

  test("the table lists every section, or one without titles", async () => {
    const all = await sumi(["catalog"]);
    expect(all).toMatchObject({ exitCode: 0, stderr: "" });
    expect(all.stdout).toMatch(/^Components:\nID\s+KIND\s+VARIANTS\s+DESCRIPTION$/m);
    expect(all.stdout).toMatch(/^Themes:\nID\s+FONT SIZE\s+FONTS\s+PROFILES\s+DESCRIPTION$/m);
    expect(all.stdout).toMatch(/^Profiles:\nID\s+MAX WIDTH\s+MAX HEIGHT\s+MIN FONT\s+/m);
    for (const id of [...BUILTIN_THEMES.keys(), ...BUILTIN_PROFILES.keys()]) {
      expect(all.stdout).toMatch(new RegExp(`^${id} `, "m"));
    }
    expect(all.stdout).toMatch(/^paper-single\s+88mm\s+220mm\s+7pt\s+2mm\/8mm\/4mm\s/m);

    const table = await sumi(["catalog", "--kind", "edge"]);
    expect(table.exitCode).toBe(0);
    expect(table.stdout.split("\n")[0]).toMatch(/^ID\s+KIND\s+VARIANTS\s+DESCRIPTION$/);
    expect(table.stdout).toContain("sumi/arrow");
    expect(table.stdout).not.toContain("sumi/box");
    expect(table.stdout).not.toContain("Themes:");

    const profiles = await sumi(["catalog", "--section", "profiles"]);
    expect(profiles.stdout.split("\n")[0]).toMatch(/^ID\s+MAX WIDTH/);
  });
});

describe("sumi doctor", () => {
  test("--json reports versions and checks; a missing D2 fails with exit 1", async () => {
    const result = await sumi(["doctor", "--json"], {
      env: { SUMI_D2_PATH: join(dir, "no-such-d2") },
    });
    expect(result.exitCode).toBe(1);
    const json = JSON.parse(result.stdout);
    expect(Object.keys(json)).toEqual(["version", "sumi", "runtime", "checks", "ok"]);
    expect(json).toMatchObject({
      version: 1,
      sumi: { version: pkg.version },
      runtime: {
        bun: Bun.version,
        platform: process.platform,
        arch: process.arch,
        mode: "source",
      },
      ok: false,
    });
    expect(json.checks.map((c: { id: string }) => c.id)).toEqual(["d2", "fonts", "geometry-lint"]);
    expect(json.checks[0]).toMatchObject({ id: "d2", status: "error", required: true });
    expect(json.checks[0].hint).toContain("d2:install");
    expect(json.checks[1]).toMatchObject({ id: "fonts", status: "ok", required: true });
    expect(json.checks[1].details.files).toHaveLength(3);
    // The actual font hashes are recorded (CI prints them), matching the pinned table.
    const pinned = new Set(BUNDLED_FONT_SHA256.values());
    for (const file of json.checks[1].details.files) {
      expect(pinned.has(file.sha256)).toBe(true);
    }
    // Geometry lint needs only the bundled fonts' metrics (D2 is checked separately).
    expect(json.checks[2]).toMatchObject({ id: "geometry-lint", status: "ok", required: false });
    expect(json.checks[2].details.files).toHaveLength(3);
  });

  test("text output names each check", async () => {
    const result = await sumi(["doctor"], { env: { SUMI_D2_PATH: join(dir, "no-such-d2") } });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(`Sumi ${pkg.version}`);
    expect(result.stdout).toMatch(/^error\s+d2\s+/m);
    expect(result.stdout).toMatch(/^ok\s+fonts\s+/m);
    expect(result.stdout).toContain("Some required checks failed.");
  });
});

describe("stdout closed by the reader (EPIPE)", () => {
  // Each command discards the rest of its output without a message or stack
  // trace and exits with its own status (design §6.4).
  test("catalog --json exits 0 quietly", async () => {
    expect(await sumiClosedStdout(["catalog", "--json"])).toEqual({ exitCode: 0, stderr: "" });
  });

  test("lint --json keeps its own exit code (0 clean, 1 with errors)", async () => {
    const clean = await copyFixture("lint/clean.sumi.yaml", "epipe-clean.sumi.yaml");
    expect(await sumiClosedStdout(["lint", clean, "--json"])).toEqual({ exitCode: 0, stderr: "" });
    const broken = await copyFixture(
      "invalid/ref-unknown-endpoint.sumi.yaml",
      "epipe-bad.sumi.yaml",
    );
    expect(await sumiClosedStdout(["lint", broken, "--json"])).toEqual({
      exitCode: 1,
      stderr: "",
    });
  });

  test("doctor keeps its own exit code", async () => {
    const result = await sumiClosedStdout(["doctor"], {
      env: { SUMI_D2_PATH: join(dir, "no-such-d2") },
    });
    expect(result).toEqual({ exitCode: 1, stderr: "" });
  });

  test("fmt --stdout exits 0 quietly and leaves the file alone", async () => {
    const file = await copyFixture("lint/clean.sumi.yaml", "epipe-fmt.sumi.yaml");
    const before = await readFile(join(dir, file), "utf8");
    expect(await sumiClosedStdout(["fmt", "--stdout", file])).toEqual({ exitCode: 0, stderr: "" });
    expect(await readFile(join(dir, file), "utf8")).toBe(before);
  });

  test("SUMI_DEBUG=1 notes the closed stream on stderr", async () => {
    const result = await sumiClosedStdout(["catalog"], { env: { SUMI_DEBUG: "1" } });
    expect(result).toEqual({
      exitCode: 0,
      stderr:
        "sumi: debug: stdout was closed by its reader (EPIPE); the rest of the output was discarded.\n",
    });
  });
});

const d2 = findD2Binary({ projectRoot: ROOT });
const d2Available = d2.ok && (await checkD2Version(d2.value.path)).ok;
if (!d2Available && !process.env.CI) {
  console.warn(
    `[cli render] D2 v${D2_VERSION} not found; skipping. Run \`bun run d2:install\` to enable.`,
  );
}

describe.skipIf(!d2Available && !process.env.CI)("sumi render (D2)", () => {
  const env = () => ({ SUMI_D2_PATH: d2.ok ? d2.value.path : "" });

  test("render --json with a closed stdout still writes the complete SVG", async () => {
    const file = await copyFixture("lint/clean.sumi.yaml", "epipe-render.sumi.yaml");
    const reference = await sumi(["render", file, "-o", "epipe-reference.svg"], { env: env() });
    expect(reference.exitCode).toBe(0);
    const result = await sumiClosedStdout(["render", file, "--json"], { env: env() });
    expect(result).toEqual({ exitCode: 0, stderr: "" });
    const svg = await readFile(join(dir, "epipe-render.svg"), "utf8");
    expect(svg.trimEnd()).toEndWith("</svg>");
    expect(svg).toBe(await readFile(join(dir, "epipe-reference.svg"), "utf8"));
  });

  test("render -o - with a closed stdout exits 0 without a stack trace", async () => {
    const file = await copyFixture("lint/clean.sumi.yaml", "epipe-stdout.sumi.yaml");
    const result = await sumiClosedStdout(["render", file, "-o", "-"], { env: env() });
    expect(result).toEqual({ exitCode: 0, stderr: "" });
  });

  test("doctor passes with the pinned D2", async () => {
    const result = await sumi(["doctor", "--json"], { env: env() });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).checks[0]).toMatchObject({
      status: "ok",
      details: { version: D2_VERSION, source: "env" },
    });
  });

  test("writes <input>.svg by default and reports the size on stdout", async () => {
    const file = await copyFixture("lint/clean.sumi.yaml", "default.sumi.yaml");
    const result = await sumi(["render", file], { env: env() });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(result.stdout).toMatch(/^Wrote default\.svg: [\d.]+mm × [\d.]+mm \(paper-double/);
    const svg = await readFile(join(dir, "default.svg"), "utf8");
    expect(svg).toContain("<svg");
    const metadata = readSvgMetadata(svg);
    expect(metadata.ok && metadata.value?.profile).toBe("paper-double");
  });

  test("--theme / --profile override the file; --emit-d2 writes the D2 source", async () => {
    const file = await copyFixture("lint/clean.sumi.yaml", "override.sumi.yaml");
    const result = await sumi(
      [
        "render",
        file,
        "-o",
        "override-out.svg",
        "--emit-d2",
        "override.d2",
        "--theme",
        "academic",
        "--profile",
        "paper-double",
      ],
      { env: env() },
    );
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(result.stdout).toContain("Wrote override.d2.");
    const metadata = readSvgMetadata(await readFile(join(dir, "override-out.svg"), "utf8"));
    expect(metadata.ok && metadata.value).toMatchObject({
      theme: "academic",
      profile: "paper-double",
    });
    expect(await readFile(join(dir, "override.d2"), "utf8")).toContain('"n_');
  });

  test("-o - writes only the SVG to stdout; output is deterministic", async () => {
    const file = await copyFixture("lint/clean.sumi.yaml", "stdout.sumi.yaml");
    const first = await sumi(["render", file, "-o", "-"], { env: env() });
    expect(first).toMatchObject({ exitCode: 0, stderr: "" });
    expect(first.stdout).toStartWith("<?xml");
    expect((await sumi(["render", file, "-o", "-"], { env: env() })).stdout).toBe(first.stdout);
  });

  test("geometry errors exit 1 but still write the SVG; --no-geometry skips them", async () => {
    const file = await copyFixture("geometry/exceeds-page-width.sumi.yaml", "wide.sumi.yaml");
    const result = await sumi(["render", file], { env: env() });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(
      /^wide\.sumi\.yaml:5:3 error geometry\/exceeds-page-width The figure is [\d.]+mm wide, more than the 88mm maximum width of profile "paper-single"\.$/m,
    );
    expect(result.stdout).toMatch(/^Wrote wide\.svg: .*TOO WIDE/);
    expect(await Bun.file(join(dir, "wide.svg")).exists()).toBe(true);

    const json = JSON.parse((await sumi(["render", "--json", file], { env: env() })).stdout);
    expect(json.output).toBe("wide.svg");
    expect(json.summary.errors).toBe(1);
    expect(json.size).toMatchObject({
      profile: { id: "paper-single", maxWidthMm: 88, maxHeightMm: 220, minFontSizePt: 7 },
      fits: false,
    });
    expect(json.size.widthMm).toBeGreaterThan(88);

    const skipped = await sumi(["render", "--no-geometry", file], { env: env() });
    expect(skipped).toMatchObject({ exitCode: 0, stderr: "" });
  }, 60_000);

  test("lint --geometry renders and runs the geometry rules", async () => {
    const clean = await copyFixture("lint/clean.sumi.yaml", "geo-clean.sumi.yaml");
    const wide = await copyFixture("geometry/exceeds-page-width.sumi.yaml", "geo-wide.sumi.yaml");
    const overflow = await copyFixture(
      "geometry/label-overflow.sumi.yaml",
      "geo-overflow.sumi.yaml",
    );
    expect((await sumi(["lint", "--geometry", clean], { env: env() })).exitCode).toBe(0);

    const result = await sumi(["lint", "--geometry", wide, overflow], { env: env() });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("geo-wide.sumi.yaml:5:3 error geometry/exceeds-page-width");
    expect(result.stdout).toContain("geo-overflow.sumi.yaml:15:7 error geometry/label-overflow");
    // Without --geometry, the same files pass: nothing is rendered.
    expect((await sumi(["lint", wide, overflow], { env: env() })).exitCode).toBe(0);
    // Nothing is written next to the input.
    expect(await Bun.file(join(dir, "geo-wide.svg")).exists()).toBe(false);

    const json = JSON.parse(
      (await sumi(["lint", "--geometry", "--json", wide], { env: env() })).stdout,
    );
    expect(json.results[0].diagnostics.map((d: { code: string }) => d.code)).toEqual([
      "geometry/exceeds-page-width",
    ]);
    expect(json.results[0]).not.toHaveProperty("rendered");
    expect(json.results[0].size).toMatchObject({ profile: { id: "paper-single" }, fits: false });
    // Without --geometry, nothing is rendered and there is no size.
    const plain = JSON.parse((await sumi(["lint", "--json", wide], { env: env() })).stdout);
    expect(plain.results[0]).not.toHaveProperty("size");

    const off = await sumi(
      ["lint", "--geometry", "--rule", "geometry/exceeds-page-width=warning", wide],
      { env: env() },
    );
    expect(off.exitCode).toBe(0);
    expect(off.stdout).toContain("warning geometry/exceeds-page-width");
  }, 60_000);

  test("lint --geometry without D2 reports the backend error (exit 1)", async () => {
    const file = await copyFixture("lint/clean.sumi.yaml", "geo-nod2.sumi.yaml");
    const result = await sumi(["lint", "--geometry", file], {
      env: { SUMI_D2_PATH: join(dir, "no-such-d2") },
    });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("backend/");
    const json = JSON.parse(
      (
        await sumi(["lint", "--geometry", "--json", file], {
          env: { SUMI_D2_PATH: join(dir, "no-such-d2") },
        })
      ).stdout,
    );
    expect(json.results[0].size).toBeNull();
  });

  test("--json prints the envelope with the files written", async () => {
    const file = await copyFixture("lint/self-loop.sumi.yaml", "json.sumi.yaml");
    const result = await sumi(["render", "--json", file], { env: env() });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    const json = JSON.parse(result.stdout);
    expect(json).toMatchObject({
      version: 1,
      file,
      output: "json.svg",
      d2: null,
      summary: { errors: 0, warnings: 0, infos: 0 },
    });
    expect(Object.keys(json)).toEqual([
      "version",
      "file",
      "diagnostics",
      "summary",
      "output",
      "d2",
      "size",
    ]);
    // The size is the SVG's own width / height (pt) and agrees with the profile's limits.
    const svg = await readFile(join(dir, "json.svg"), "utf8");
    const width = Number(/<svg[^>]* width="([\d.]+)pt"/.exec(svg)?.[1]);
    const height = Number(/<svg[^>]* height="([\d.]+)pt"/.exec(svg)?.[1]);
    expect(json.size).toEqual({
      widthPt: width,
      heightPt: height,
      widthMm: Math.round(((width * 25.4) / 72) * 100) / 100,
      heightMm: Math.round(((height * 25.4) / 72) * 100) / 100,
      profile: { id: "paper-single", maxWidthMm: 88, maxHeightMm: 220, minFontSizePt: 7 },
      fits: true,
    });

    const override = JSON.parse(
      (await sumi(["render", "--json", "--profile", "paper-double", file], { env: env() })).stdout,
    );
    expect(override.size.profile).toMatchObject({ id: "paper-double", maxWidthMm: 180 });
  });

  test("errors exit 1 with diagnostics on stderr and no SVG", async () => {
    const file = await copyFixture("invalid/ref-unknown-endpoint.sumi.yaml", "bad.sumi.yaml");
    const result = await sumi(["render", file], { env: env() });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("bad.sumi.yaml:11:9 error ref/unknown-endpoint");
    expect(await Bun.file(join(dir, "bad.svg")).exists()).toBe(false);

    const empty = await copyFixture("lint/empty-figure.sumi.yaml", "empty.sumi.yaml");
    const json = JSON.parse((await sumi(["render", "--json", empty], { env: env() })).stdout);
    expect(json.output).toBeNull();
    expect(json.size).toBeNull();
    expect(json.diagnostics.map((d: { code: string }) => d.code)).toContain("svg/empty-figure");
  });

  test("usage errors exit 2", async () => {
    const file = await copyFixture("lint/clean.sumi.yaml", "usage.sumi.yaml");
    for (const args of [
      ["missing.sumi.yaml"],
      [file, "--theme", "minimall"],
      [file, "--profile", "a4"],
      [file, "-o", file],
      [file, "--json", "-o", "-"],
    ]) {
      const result = await sumi(["render", ...args], { env: env() });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toStartWith("sumi: error: ");
    }
    const suggestion = await sumi(["render", file, "--theme", "minimall"], { env: env() });
    expect(suggestion.stderr).toContain('Did you mean "minimal"?');
  });

  test("a missing D2 is reported as a diagnostic (exit 1)", async () => {
    const file = await copyFixture("lint/clean.sumi.yaml", "nod2.sumi.yaml");
    const result = await sumi(["render", file], {
      env: { SUMI_D2_PATH: join(dir, "no-such-d2") },
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("backend/d2-not-found");
  });

  test("an output link retargeted at the input while rendering does not overwrite the input", async () => {
    await mkdir(join(dir, "race"));
    await copyFile(join(FIXTURES, "lint/clean.sumi.yaml"), join(dir, "race", "fig.sumi.yaml"));
    const input = await readFile(join(dir, "race", "fig.sumi.yaml"), "utf8");
    await writeFile(join(dir, "race", "elsewhere.svg"), "");
    await symlink("elsewhere.svg", join(dir, "race", "linked.svg"));
    const sink = { write: () => {} };
    const swaps: string[] = [];
    const code = await run(
      ["render", "race/fig.sumi.yaml", "-o", "race/linked.svg", "--emit-d2", "race/new.d2"],
      {
        stdout: sink,
        stderr: sink,
        cwd: dir,
        env: { ...baseEnv(), ...env() },
        hooks: {
          // Between validation and the rename: point both outputs at the input.
          beforeCommit: async (display) => {
            swaps.push(display);
            const path = join(dir, display);
            await rm(path, { force: true });
            await symlink("fig.sumi.yaml", path);
          },
        },
      },
    );
    expect(code).toBe(0);
    expect(swaps).toEqual(["race/new.d2", "race/linked.svg"]);
    expect(await readFile(join(dir, "race", "fig.sumi.yaml"), "utf8")).toBe(input);
    expect(await readFile(join(dir, "race", "elsewhere.svg"), "utf8")).toStartWith("<?xml");
    expect(await readFile(join(dir, "race", "new.d2"), "utf8")).toContain('"n_');
  });

  test("the second output is refused if the file system says it is the first (hard link)", async () => {
    await mkdir(join(dir, "twice"));
    await copyFile(join(FIXTURES, "lint/clean.sumi.yaml"), join(dir, "twice", "fig.sumi.yaml"));
    const renderTwice = async () => {
      let stderr = "";
      const code = await run(
        ["render", "twice/fig.sumi.yaml", "-o", "twice/out.svg", "--emit-d2", "twice/out.d2"],
        {
          stdout: { write: () => {} },
          stderr: {
            write: (chunk: string) => {
              stderr += chunk;
            },
          },
          cwd: dir,
          env: { ...baseEnv(), ...env() },
          hooks: {
            beforeCommit: async (display) => {
              if (display !== "twice/out.svg") return;
              await rm(join(dir, "twice", "out.svg"), { force: true });
              await link(join(dir, "twice", "out.d2"), join(dir, "twice", "out.svg"));
            },
          },
        },
      );
      return { code, stderr };
    };

    // out.d2 is created by this run, so it is removed again.
    const created = await renderTwice();
    expect(created.code).toBe(2);
    expect(created.stderr).toBe(
      "sumi: error: Cannot write twice/out.svg: it is the same file as twice/out.d2.\n",
    );
    expect(await Bun.file(join(dir, "twice", "out.d2")).exists()).toBe(false);

    // An out.d2 that existed before keeps its new content.
    await rm(join(dir, "twice", "out.svg"));
    await writeFile(join(dir, "twice", "out.d2"), "OLD");
    expect((await renderTwice()).code).toBe(2);
    expect(await readFile(join(dir, "twice", "out.d2"), "utf8")).toContain('"n_');
  });

  test("the rollback does not delete a file elsewhere when the output directory was swapped", async () => {
    await mkdir(join(dir, "swap"));
    await mkdir(join(dir, "other"));
    await copyFile(join(FIXTURES, "lint/clean.sumi.yaml"), join(dir, "fig-swap.sumi.yaml"));
    await writeFile(join(dir, "other", "out.d2"), "PRECIOUS");
    let stderr = "";
    const code = await run(
      ["render", "fig-swap.sumi.yaml", "-o", "swap/out.svg", "--emit-d2", "swap/out.d2"],
      {
        stdout: { write: () => {} },
        stderr: {
          write: (chunk: string) => {
            stderr += chunk;
          },
        },
        cwd: dir,
        env: { ...baseEnv(), ...env() },
        hooks: {
          beforeCommit: async (display) => {
            if (display !== "swap/out.svg") return;
            await rename(join(dir, "swap"), join(dir, "swap-old"));
            await symlink("other", join(dir, "swap"));
          },
        },
      },
    );
    expect(code).toBe(2);
    expect(stderr).toContain("Cannot write swap/out.svg: its directory changed");
    expect(stderr).toContain("Did not remove swap/out.d2: it changed after it was written.");
    expect(await readFile(join(dir, "other", "out.d2"), "utf8")).toBe("PRECIOUS");
    expect(await readFile(join(dir, "swap-old", "out.d2"), "utf8")).toContain('"n_');
  });

  test("outputs the file system folds together (Σ.svg / ς.svg) are refused", async () => {
    await mkdir(join(dir, "fold"));
    if (!(await isCaseInsensitiveDir(await realpath(join(dir, "fold"))))) {
      console.warn("[cli render] the temp file system is case-sensitive; skipping the Σ/ς test.");
      return;
    }
    await copyFile(join(FIXTURES, "lint/clean.sumi.yaml"), join(dir, "fold", "fig.sumi.yaml"));
    const result = await sumi(
      ["render", "fold/fig.sumi.yaml", "-o", "fold/Σ.svg", "--emit-d2", "fold/ς.svg"],
      { env: env() },
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("is the same file as fold/ς.svg");
    expect(await readdir(join(dir, "fold"))).toEqual(["fig.sumi.yaml"]);
  });
});

describe("run() in process", () => {
  const capture = () => {
    let text = "";
    return {
      stream: {
        write: (chunk: string) => {
          text += chunk;
        },
      },
      text: () => text,
    };
  };

  test("returns the exit code and writes to the given streams", async () => {
    const out = capture();
    const err = capture();
    const code = await run(["lint", "lint/clean.sumi.yaml"], {
      stdout: out.stream,
      stderr: err.stream,
      cwd: FIXTURES,
      env: {},
    });
    expect(code).toBe(0);
    expect(out.text()).toBe("0 errors, 0 warnings, 0 infos\n");
    expect(err.text()).toBe("");
  });

  test("internal errors exit 2 with a one-line message; SUMI_DEBUG=1 adds the stack", async () => {
    const failing = {
      write: (chunk: string) => {
        if (chunk.includes("errors")) throw new Error("disk on fire");
      },
    };
    for (const [env, stack] of [
      [{}, false],
      [{ SUMI_DEBUG: "1" }, true],
    ] as const) {
      const err = capture();
      const code = await run(["lint", "lint/clean.sumi.yaml"], {
        stdout: failing,
        stderr: err.stream,
        cwd: FIXTURES,
        env,
      });
      expect(code).toBe(2);
      expect(err.text()).toStartWith("sumi: internal error: disk on fire\n");
      expect(err.text().includes("    at ")).toBe(stack);
    }
  });

  const errorCode = (error: unknown) => (error as { code?: unknown } | undefined)?.code;

  /** A real `Writable` whose writes fail asynchronously with `code`, as a pipe or full disk does. */
  const failingWritable = (code: string, delayMs = 1) => {
    return new Writable({
      write(_chunk, _encoding, callback) {
        setTimeout(() => callback(Object.assign(new Error(`write ${code}`), { code })), delayMs);
      },
    });
  };

  test("EPIPE on stdout is quiet and keeps the command's own exit code", async () => {
    const err = capture();
    const code = await run(["lint", "invalid/ref-unknown-endpoint.sumi.yaml"], {
      stdout: failingWritable("EPIPE"),
      stderr: err.stream,
      cwd: FIXTURES,
      env: {},
    });
    expect(code).toBe(1);
    expect(err.text()).toBe("");
  });

  test("other write errors exit 2 with a one-line message", async () => {
    const err = capture();
    const code = await run(["lint", "lint/clean.sumi.yaml"], {
      stdout: failingWritable("ENOSPC"),
      stderr: err.stream,
      cwd: FIXTURES,
      env: {},
    });
    expect(code).toBe(2);
    expect(err.text()).toBe("sumi: error: cannot write to stdout: write ENOSPC\n");
  });

  test("a failure of the final stderr lines is folded into the exit code", async () => {
    // stdout EPIPE + SUMI_DEBUG=1 writes a debug line to stderr after the
    // first wait; its (delayed) failure must still count.
    for (const [stderrCode, expected] of [
      ["ENOSPC", 2],
      ["EPIPE", 1],
    ] as const) {
      const code = await run(["lint", "invalid/ref-unknown-endpoint.sumi.yaml"], {
        stdout: failingWritable("EPIPE"),
        stderr: failingWritable(stderrCode, 20),
        cwd: FIXTURES,
        env: { SUMI_DEBUG: "1" },
      });
      expect(code).toBe(expected);
    }
  });

  test("repeated runs on the same streams do not accumulate listeners", async () => {
    const ok = () =>
      new Writable({
        write(_chunk, _encoding, callback) {
          setTimeout(callback, 1);
        },
      });
    const streams = { stdout: ok(), stderr: ok() };
    const broken = { stdout: failingWritable("EPIPE"), stderr: failingWritable("ENOSPC") };
    const counts = (pair: { stdout: Writable; stderr: Writable }) => [
      pair.stdout.listenerCount("error"),
      pair.stderr.listenerCount("error"),
    ];
    const initial = [counts(streams), counts(broken)];
    for (let i = 0; i < 15; i++) {
      // Success, usage error and failing streams (normal and error paths).
      await run(["lint", "lint/clean.sumi.yaml"], { ...streams, cwd: FIXTURES, env: {} });
      await run(["lint", "--no-such-flag"], { ...streams, cwd: FIXTURES, env: {} });
      await run(["catalog"], { ...broken, cwd: FIXTURES, env: { SUMI_DEBUG: "1" } });
    }
    // One persistent listener per stream, however many runs.
    const once = initial.map((pair) => pair.map((n) => n + 1));
    expect([counts(streams), counts(broken)]).toEqual(once);
  });

  test("a late error event (asynchronous destroy) after run() returns is not uncaught", async () => {
    let emitted: unknown;
    const stdout = new Writable({
      write(_chunk, _encoding, callback) {
        callback(Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
      },
      destroy(error, callback) {
        setTimeout(() => callback(error), 30);
      },
    });
    const emit = stdout.emit.bind(stdout);
    // Throws (an uncaught error in the timer) if no listener is left.
    stdout.emit = ((event: string, ...args: unknown[]) => {
      if (event === "error") emitted = args[0];
      return emit(event, ...args);
    }) as typeof stdout.emit;
    const err = capture();
    const code = await run(["catalog"], { stdout, stderr: err.stream, cwd: FIXTURES, env: {} });
    expect(code).toBe(0);
    expect(err.text()).toBe("");
    expect(emitted).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(errorCode(emitted)).toBe("EPIPE");
  });
});
