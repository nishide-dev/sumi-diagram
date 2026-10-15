import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkD2Version, findD2Binary, parseD2Version } from "./binary";
import { createFakeD2 } from "./fake-d2";
import { D2_RELEASE_ASSETS, d2ReleaseAsset, MANAGED_D2_PATH } from "./version";

let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "sumi d2 binary "));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("parseD2Version", () => {
  test.each([
    ["v0.9.0\n", "0.9.0"],
    ["0.9.0", "0.9.0"],
    ["  v0.10.12  ", "0.10.12"],
    ["v0.9.0-HEAD\n", "0.9.0-HEAD"],
  ])("parses %j", (output, expected) => {
    expect(parseD2Version(output)).toBe(expected);
  });

  test.each(["", "d2 v0.9.0", "v0.9", "unknown\n", "v0.9.0\nextra"])("rejects %j", (output) => {
    expect(parseD2Version(output)).toBeUndefined();
  });
});

describe("d2ReleaseAsset", () => {
  test("maps Node platform/arch to the release asset", () => {
    expect(d2ReleaseAsset("darwin", "arm64")?.name).toBe("d2-v0.9.0-macos-arm64.tar.gz");
    expect(d2ReleaseAsset("linux", "x64")?.name).toBe("d2-v0.9.0-linux-amd64.tar.gz");
    expect(d2ReleaseAsset("win32", "x64")).toBeUndefined();
    expect(d2ReleaseAsset("toString", "")).toBeUndefined();
  });

  test("pins a lowercase SHA-256 for every platform", () => {
    for (const asset of Object.values(D2_RELEASE_ASSETS)) {
      expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe("findD2Binary", () => {
  let option: string;
  let fromEnv: string;
  let project: string;
  let pathDir: string;

  beforeAll(async () => {
    option = (await createFakeD2(join(root, "option"))).path;
    fromEnv = (await createFakeD2(join(root, "env"))).path;
    project = join(root, "project");
    await createFakeD2(join(project, ".sumi", "bin"));
    pathDir = join(root, "path bin");
    await createFakeD2(pathDir);
  });

  const managed = () => join(project, MANAGED_D2_PATH);
  const emptyProject = () => join(root, "empty");

  test("prefers the explicit option", () => {
    const result = findD2Binary({
      binaryPath: option,
      env: { SUMI_D2_PATH: fromEnv, PATH: pathDir },
      projectRoot: project,
    });
    expect(result).toMatchObject({ ok: true, value: { path: option, source: "option" } });
  });

  test("then SUMI_D2_PATH", () => {
    const result = findD2Binary({
      env: { SUMI_D2_PATH: fromEnv, PATH: pathDir },
      projectRoot: project,
    });
    expect(result).toMatchObject({ ok: true, value: { path: fromEnv, source: "env" } });
  });

  test("then the managed binary", () => {
    const result = findD2Binary({ env: { PATH: pathDir }, projectRoot: project });
    expect(result).toMatchObject({ ok: true, value: { path: managed(), source: "managed" } });
  });

  test("then d2 on PATH", () => {
    const result = findD2Binary({ env: { PATH: pathDir }, projectRoot: emptyProject() });
    expect(result).toMatchObject({
      ok: true,
      value: { path: join(pathDir, "d2"), source: "path" },
    });
  });

  test("ignores an empty SUMI_D2_PATH", () => {
    const result = findD2Binary({ env: { SUMI_D2_PATH: "", PATH: pathDir }, projectRoot: project });
    expect(result).toMatchObject({ ok: true, value: { source: "managed" } });
  });

  test("does not fall through when an explicit path is missing", () => {
    const result = findD2Binary({
      binaryPath: join(root, "missing", "d2"),
      env: { PATH: pathDir },
      projectRoot: project,
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("backend/d2-not-found");

    const fromEnvMissing = findD2Binary({
      env: { SUMI_D2_PATH: join(root, "missing", "d2"), PATH: pathDir },
      projectRoot: project,
    });
    expect(fromEnvMissing.diagnostics[0]?.message).toContain("SUMI_D2_PATH");
  });

  test("reports d2-not-found with an install hint", () => {
    const result = findD2Binary({ env: { PATH: "" }, projectRoot: emptyProject() });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "backend/d2-not-found",
        severity: "error",
        hint: expect.stringContaining("bun run d2:install"),
      }),
    ]);
  });
});

describe("checkD2Version", () => {
  test("accepts the pinned version", async () => {
    const fake = await createFakeD2(join(root, "ok"), { version: "v0.9.0" });
    expect(await checkD2Version(fake.path)).toEqual({ ok: true, value: "0.9.0", diagnostics: [] });
  });

  test("rejects another version", async () => {
    const fake = await createFakeD2(join(root, "old"), { version: "v0.7.1" });
    const result = await checkD2Version(fake.path);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "backend/d2-version-mismatch",
        severity: "error",
        message: expect.stringContaining("v0.7.1"),
      }),
    ]);
  });

  test("downgrades a mismatch to a warning when allowed", async () => {
    const fake = await createFakeD2(join(root, "new"), { version: "v0.10.0" });
    const result = await checkD2Version(fake.path, { allowVersionMismatch: true });
    expect(result).toMatchObject({
      ok: true,
      value: "0.10.0",
      diagnostics: [{ code: "backend/d2-version-mismatch", severity: "warning" }],
    });
  });

  test("rejects unrecognised version output", async () => {
    const fake = await createFakeD2(join(root, "garbage"), { version: "not a version" });
    const result = await checkD2Version(fake.path);
    expect(result.diagnostics[0]).toMatchObject({
      code: "backend/d2-version-mismatch",
      message: expect.stringContaining("unrecognised"),
    });
  });

  test("reports a binary that fails or cannot run as not found", async () => {
    const failing = await createFakeD2(join(root, "failing"), { versionExitCode: 2 });
    expect((await checkD2Version(failing.path)).diagnostics[0]?.code).toBe("backend/d2-not-found");

    const dir = join(root, "not executable");
    await mkdir(dir, { recursive: true });
    const path = join(dir, "d2");
    await Bun.write(path, "not a program");
    await chmod(path, 0o644);
    expect((await checkD2Version(path)).diagnostics[0]?.code).toBe("backend/d2-not-found");
  });
});
