/**
 * End-to-end tests of the `sumi` CLI: each test spawns the real entry point
 * (`bun src/cli/index.ts …`) and checks exit code, stdout and stderr.
 *
 * `render` needs the pinned D2: skipped locally without it (with a message),
 * required in CI (`CI` set).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmod, copyFile, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pkg from "../../package.json";
import { checkD2Version, findD2Binary } from "../backends/d2/binary";
import { D2_VERSION } from "../backends/d2/version";
import { createBuiltinRegistry } from "../core/registry/builtins";
import { buildCatalog } from "../core/registry/catalog";
import { runCommand } from "../core/subprocess";
import { readSvgMetadata } from "../render";
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
      ["--geometry"],
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
});

describe("sumi catalog", () => {
  test("--json prints exactly buildCatalog()", async () => {
    const result = await sumi(["catalog", "--json"]);
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    const json = JSON.parse(result.stdout);
    expect(json).toEqual(JSON.parse(JSON.stringify(buildCatalog(createBuiltinRegistry()))));
    expect(json.version).toBe(1);
  });

  test("--kind filters; the table lists IDs", async () => {
    const json = JSON.parse((await sumi(["catalog", "--json", "--kind", "group"])).stdout);
    expect(json.components.map((c: { id: string }) => c.id)).toEqual(["sumi/container"]);
    const table = await sumi(["catalog", "--kind", "edge"]);
    expect(table.exitCode).toBe(0);
    expect(table.stdout.split("\n")[0]).toMatch(/^ID\s+KIND\s+VARIANTS\s+DESCRIPTION$/);
    expect(table.stdout).toContain("sumi/arrow");
    expect(table.stdout).not.toContain("sumi/box");
    expect((await sumi(["catalog", "--kind", "shape"])).exitCode).toBe(2);
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
      runtime: { bun: Bun.version, platform: process.platform, arch: process.arch },
      ok: false,
    });
    expect(json.checks.map((c: { id: string }) => c.id)).toEqual(["d2", "fonts", "geometry-lint"]);
    expect(json.checks[0]).toMatchObject({ id: "d2", status: "error", required: true });
    expect(json.checks[0].hint).toContain("d2:install");
    expect(json.checks[1]).toMatchObject({ id: "fonts", status: "ok", required: true });
    expect(json.checks[1].details.files).toHaveLength(3);
    expect(json.checks[2]).toMatchObject({ status: "skipped", required: false });
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

const d2 = findD2Binary({ projectRoot: ROOT });
const d2Available = d2.ok && (await checkD2Version(d2.value.path)).ok;
if (!d2Available && !process.env.CI) {
  console.warn(
    `[cli render] D2 v${D2_VERSION} not found; skipping. Run \`bun run d2:install\` to enable.`,
  );
}

describe.skipIf(!d2Available && !process.env.CI)("sumi render (D2)", () => {
  const env = () => ({ SUMI_D2_PATH: d2.ok ? d2.value.path : "" });

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
    expect(result.stdout).toMatch(/^Wrote default\.svg: [\d.]+mm × [\d.]+mm \(paper-single/);
    const svg = await readFile(join(dir, "default.svg"), "utf8");
    expect(svg).toContain("<svg");
    const metadata = readSvgMetadata(svg);
    expect(metadata.ok && metadata.value?.profile).toBe("paper-single");
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
});
