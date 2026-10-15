import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bundledD2Path,
  fontAssetsDir,
  installPrefix,
  isCompiledModulePath,
  RELEASE_LAYOUT,
  RUN_MODE,
} from "./install-layout";
import { FONT_ASSETS_DIR } from "./theme/fonts";

const REPO = join(import.meta.dir, "..", "..");

let root: string;
let prefix: string;
let sumi: string;
beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "sumi layout ")));
  prefix = join(root, "opt", "sumi 1.0");
  sumi = join(prefix, RELEASE_LAYOUT.sumi);
  await mkdir(join(prefix, "bin"), { recursive: true });
  await writeFile(sumi, "");
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("isCompiledModulePath", () => {
  test.each([
    ["/$bunfs/root/sumi", true],
    ["B:/~BUN/root/sumi.exe", true],
    ["B:\\~BUN\\root\\sumi.exe", true],
    ["/home/me/sumi/src/core/install-layout.ts", false],
    ["/tmp/$bunfs/root", false],
  ])("%s → %p", (path, expected) => {
    expect(isCompiledModulePath(path)).toBe(expected);
  });

  test("tests run from source", () => {
    expect(RUN_MODE).toBe("source");
  });
});

describe("installPrefix", () => {
  test("is the parent of the executable's directory", () => {
    expect(installPrefix(sumi)).toBe(prefix);
  });

  test("resolves a symlink to the executable", async () => {
    const linkDir = join(root, "link bin");
    await mkdir(linkDir);
    await symlink(sumi, join(linkDir, "sumi"));
    expect(installPrefix(join(linkDir, "sumi"))).toBe(prefix);
  });

  test("keeps a path that does not exist", () => {
    expect(installPrefix(join(root, "nowhere", "bin", "sumi"))).toBe(join(root, "nowhere"));
  });
});

describe("fontAssetsDir", () => {
  test("from source: <repo>/assets/fonts", () => {
    expect(fontAssetsDir({ mode: "source", sourceRoot: "/repo" })).toBe("/repo/assets/fonts");
    expect(fontAssetsDir()).toBe(join(REPO, "assets", "fonts"));
    expect(FONT_ASSETS_DIR).toBe(join(REPO, "assets", "fonts"));
  });

  test("compiled: <prefix>/share/sumi/fonts", () => {
    expect(fontAssetsDir({ mode: "compiled", execPath: sumi })).toBe(
      join(prefix, "share", "sumi", "fonts"),
    );
  });
});

describe("bundledD2Path", () => {
  test("from source: none", () => {
    expect(bundledD2Path({ mode: "source", execPath: sumi })).toBeUndefined();
    expect(bundledD2Path()).toBeUndefined();
  });

  test("compiled: <prefix>/libexec/sumi/d2", () => {
    expect(bundledD2Path({ mode: "compiled", execPath: sumi })).toBe(
      join(prefix, "libexec", "sumi", "d2"),
    );
  });
});
