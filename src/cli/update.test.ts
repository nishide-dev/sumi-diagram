/**
 * `sumi update` and the doctor's notices through the CLI entry point (#597),
 * in process, with a fake release directory, a mocked fetch and temp dirs.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pkg from "../../package.json";
import { runCommand } from "../core/subprocess";
import {
  archiveName,
  type FetchLike,
  platformTarget,
  type UpdateEnvironment,
} from "../core/update";
import { run } from "./program";

const TARGET = platformTarget() ?? "linux-x64";
let root: string;
let env: Record<string, string | undefined>;
let fetched: number;

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    stdout: { write: (c: string) => out.push(c) },
    stderr: { write: (c: string) => err.push(c) },
  };
}

async function sumi(args: string[], update: UpdateEnvironment = {}, extraEnv = {}) {
  const io = capture();
  const code = await run(args, {
    stdout: io.stdout,
    stderr: io.stderr,
    cwd: root,
    env: { ...env, ...extraEnv },
    update: { mode: "compiled", ...update },
  });
  return { code, stdout: io.out.join(""), stderr: io.err.join("") };
}

async function release(version: string) {
  const name = archiveName(version, TARGET);
  const stage = await mkdtemp(join(root, "stage-"));
  await mkdir(join(stage, name, "bin"), { recursive: true });
  await writeFile(join(stage, name, "bin", "sumi"), `#!/bin/sh\necho ${version}\n`);
  await chmod(join(stage, name, "bin", "sumi"), 0o755);
  const tarball = join(root, "server", `${name}.tar.gz`);
  await runCommand(["tar", "-czf", tarball, "-C", stage, name]);
  const sum = new Bun.CryptoHasher("sha256").update(await readFile(tarball)).digest("hex");
  await writeFile(join(root, "server", "SHA256SUMS"), `${sum}  ${name}.tar.gz\n`);
}

async function install(version: string): Promise<string> {
  const exe = join(root, "home", archiveName(version, TARGET), "bin", "sumi");
  await mkdir(join(exe, ".."), { recursive: true });
  await writeFile(exe, `#!/bin/sh\necho ${version}\n`);
  await chmod(exe, 0o755);
  await symlink(exe, join(root, "bin", "sumi"));
  return exe;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sumi-update-cli-"));
  await Promise.all(["home", "bin", "server", "cache"].map((d) => mkdir(join(root, d))));
  await writeFile(join(root, "server", "latest.json"), JSON.stringify({ tag_name: "v9.9.9" }));
  fetched = 0;
  env = {
    HOME: join(root, "nohome"),
    XDG_CACHE_HOME: join(root, "cache"),
    SUMI_HOME: join(root, "home"),
    SUMI_BIN_DIR: join(root, "bin"),
    SUMI_DOWNLOAD_BASE: join(root, "server"),
    SUMI_LATEST_URL: join(root, "server", "latest.json"),
    SUMI_D2_PATH: join(root, "no-d2"),
  };
});
afterEach(() => rm(root, { recursive: true, force: true }));

const mockFetch =
  (tag: string): FetchLike =>
  async () => {
    fetched++;
    return new Response(JSON.stringify({ tag_name: tag }));
  };

describe("sumi update", () => {
  test("--check: exit 1 when an update is available, 0 when up to date", async () => {
    const exe = await install("0.19.0");
    const available = await sumi(["update", "--check"], { execPath: exe });
    expect(available.code).toBe(1);
    expect(available.stdout).toBe("Sumi 9.9.9 is available (you have 0.19.0): run `sumi update`\n");
    await writeFile(join(root, "server", "latest.json"), JSON.stringify({ tag_name: "v0.19.0" }));
    const current = await sumi(["update", "--check"], { execPath: exe });
    expect(current.code).toBe(0);
    expect(current.stdout).toBe("Sumi 0.19.0 is up to date.\n");
  });

  test("--check with an unreachable release source exits 2 with a diagnostic", async () => {
    const exe = await install("0.19.0");
    const result = await sumi(
      ["update", "--check"],
      {
        execPath: exe,
        fetch: async () => new Response("", { status: 500 }),
      },
      { SUMI_LATEST_URL: "https://example.test/latest" },
    );
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("sumi: error[update/download-failed]");
  });

  test("updates, then reports the new version", async () => {
    const exe = await install("0.19.0");
    await release("9.9.9");
    const result = await sumi(["update"], { execPath: exe });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Updating Sumi 0.19.0 -> 9.9.9");
    expect(result.stdout).toContain("Run `sumi doctor`");
    expect((await runCommand([join(root, "bin", "sumi")])).stdout.trim()).toBe("9.9.9");
  });

  test("a checksum mismatch exits 2, names the diagnostic and keeps the old version", async () => {
    const exe = await install("0.19.0");
    await release("9.9.9");
    await writeFile(
      join(root, "server", "SHA256SUMS"),
      `${"1".repeat(64)}  ${archiveName("9.9.9", TARGET)}.tar.gz\n`,
    );
    const result = await sumi(["update"], { execPath: exe });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("update/checksum-mismatch");
    expect((await runCommand([join(root, "bin", "sumi")])).stdout.trim()).toBe("0.19.0");
  });

  test("--version can downgrade", async () => {
    const exe = await install("0.19.0");
    await release("0.18.0");
    const result = await sumi(["update", "--version", "0.18.0"], { execPath: exe });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Downgrading Sumi 0.19.0 -> 0.18.0");
  });

  test("outside the install.sh layout it refuses and prints the install command", async () => {
    const result = await sumi(["update"], { mode: "source" });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("update/unsupported-layout");
    expect(result.stderr).toContain("install.sh | sh");
  });
});

describe("sumi doctor notices", () => {
  beforeEach(() => {
    delete env.SUMI_LATEST_URL;
  });

  test("a newer release gets one line, once a day from the cache", async () => {
    const first = await sumi(["doctor"], { fetch: mockFetch("v9.9.9") });
    expect(first.stdout).toContain(
      `Sumi 9.9.9 is available (you have ${pkg.version}): run \`sumi update\``,
    );
    const second = await sumi(["doctor"], { fetch: mockFetch("v10.0.0") });
    expect(second.stdout).toContain("Sumi 9.9.9 is available");
    expect(fetched).toBe(1);
  });

  test("an up-to-date CLI prints nothing", async () => {
    const result = await sumi(["doctor"], { fetch: mockFetch(`v${pkg.version}`) });
    expect(result.stdout).not.toContain("is available");
  });

  test("--json carries the notice and the Skill report", async () => {
    const result = await sumi(["doctor", "--json", "--skill-version", "0.1.0"], {
      fetch: mockFetch("v9.9.9"),
    });
    const json = JSON.parse(result.stdout);
    expect(json.update).toMatchObject({ latest: "9.9.9", available: true });
    expect(json.skill).toMatchObject({ version: "0.1.0", status: "skill-outdated" });
  });

  test("is suppressed by --no-update-check, CI and SUMI_NO_UPDATE_CHECK=1, and offline is silent", async () => {
    const options = { fetch: mockFetch("v9.9.9") };
    expect((await sumi(["doctor", "--no-update-check"], options)).stdout).not.toContain(
      "available",
    );
    expect((await sumi(["doctor"], options, { CI: "1" })).stdout).not.toContain("available");
    expect((await sumi(["doctor"], options, { SUMI_NO_UPDATE_CHECK: "1" })).stdout).not.toContain(
      "available",
    );
    expect(fetched).toBe(0);
    const offline = await sumi(["doctor"], {
      fetch: async () => {
        throw new Error("offline");
      },
    });
    expect(offline.stdout).not.toContain("available");
    expect(offline.stderr).toBe("");
  });

  test("other commands never check", async () => {
    const result = await sumi(["catalog", "--section", "themes"], { fetch: mockFetch("v9.9.9") });
    expect(result.stdout).not.toContain("available");
    expect(fetched).toBe(0);
  });

  test("--skill-version names the older side", async () => {
    const old = await sumi(["doctor", "--no-update-check", "--skill-version", "0.0.1"]);
    expect(old.stdout).toContain(
      `The Skill (0.0.1) is older than the CLI (${pkg.version}): run \`npx skills update sumi\``,
    );
    const newer = await sumi(["doctor", "--no-update-check", "--skill-version", "99.0.0"]);
    expect(newer.stdout).toContain(
      `The CLI (${pkg.version}) is older than the Skill (99.0.0): run \`sumi update\``,
    );
    const same = await sumi(["doctor", "--no-update-check", "--skill-version", pkg.version]);
    expect(same.stdout).toContain("matches the CLI");
  });
});
