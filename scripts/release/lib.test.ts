import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "../../src/core/subprocess";
import {
  archiveBaseName,
  bunCompileTarget,
  bundledPackages,
  createTar,
  findLicenseFile,
  formatSha256Sums,
  gzipDeterministic,
  hostTarget,
  parseBuildArgs,
  parseSha256Sums,
  RELEASE_TARGETS,
  sha256Hex,
  type TarEntry,
  UsageError,
} from "./lib";

describe("parseBuildArgs", () => {
  test("parses target, version and outdir", () => {
    expect(
      parseBuildArgs(["--target", "linux-x64", "--version", "1.2.3", "--outdir", "out"], "1.2.3"),
    ).toEqual({ target: "linux-x64", version: "1.2.3", outdir: "out" });
    expect(parseBuildArgs(["--target=darwin-arm64", "--version=v1.2.3"], "1.2.3")).toEqual({
      target: "darwin-arm64",
      version: "1.2.3",
      outdir: "dist/release",
    });
  });

  test("defaults the version to package.json's", () => {
    expect(parseBuildArgs(["--target", "darwin-x64"], "0.4.0-rc.1").version).toBe("0.4.0-rc.1");
  });

  test.each([
    [[], "--target is required"],
    [["--target", "win32-x64"], 'Unsupported target "win32-x64"'],
    [["--target"], "--target needs a value"],
    [["--target", "--version", "1.0.0"], "--target needs a value"],
    [["--target", "linux-x64", "--target", "linux-x64"], "more than once"],
    [["--target", "linux-x64", "--force"], 'Unknown argument "--force"'],
    [["--target", "linux-x64", "--version", "1.0"], "not a semantic version"],
    [["--target", "linux-x64", "--version", "2.0.0"], "does not match package.json (1.0.0)"],
  ])("rejects %j", (argv, message) => {
    expect(() => parseBuildArgs(argv, "1.0.0")).toThrow(UsageError);
    expect(() => parseBuildArgs(argv, "1.0.0")).toThrow(message);
  });
});

describe("targets", () => {
  test("x64 builds use Bun's baseline runtime", () => {
    expect(RELEASE_TARGETS.map(bunCompileTarget)).toEqual([
      "bun-darwin-arm64",
      "bun-darwin-x64-baseline",
      "bun-linux-x64-baseline",
      "bun-linux-arm64",
    ]);
  });

  test("hostTarget maps platform and arch", () => {
    expect(hostTarget("linux", "arm64")).toBe("linux-arm64");
    expect(hostTarget("win32", "x64")).toBeUndefined();
  });

  test("archiveBaseName", () => {
    expect(archiveBaseName("0.1.0", "darwin-arm64")).toBe("sumi-0.1.0-darwin-arm64");
  });
});

describe("bundled npm packages", () => {
  test("derives packages from metafile inputs", () => {
    const packages = bundledPackages([
      "src/cli/index.ts",
      "package.json",
      "node_modules/zod/v4/core/core.js",
      "node_modules/commander/index.js",
      "node_modules/commander/lib/command.js",
      "node_modules/@scope/pkg/dist/index.js",
      "node_modules/a/node_modules/b/index.js",
    ]);
    expect([...packages]).toEqual([
      ["@scope/pkg", "node_modules/@scope/pkg"],
      ["b", "node_modules/a/node_modules/b"],
      ["commander", "node_modules/commander"],
      ["zod", "node_modules/zod"],
    ]);
  });

  test("rejects two bundled copies of one package", () => {
    expect(() =>
      bundledPackages(["node_modules/b/index.js", "node_modules/a/node_modules/b/index.js"]),
    ).toThrow("Two copies of b");
  });

  test("finds the license file", () => {
    expect(findLicenseFile(["package.json", "LICENSE", "README.md"])).toBe("LICENSE");
    expect(findLicenseFile(["license.md", "index.js"])).toBe("license.md");
    expect(findLicenseFile(["LICENCE-MIT"])).toBe("LICENCE-MIT");
    expect(findLicenseFile(["COPYING"])).toBe("COPYING");
    expect(findLicenseFile(["index.js", "licensed.js"])).toBeUndefined();
  });
});

describe("SHA256SUMS", () => {
  test("round-trips and sorts by name", () => {
    const a = sha256Hex("a");
    const b = sha256Hex("b");
    const text = formatSha256Sums([
      { name: "z dir/b", sha256: b },
      { name: "a", sha256: a },
    ]);
    expect(text).toBe(`${a}  a\n${b}  z dir/b\n`);
    expect(parseSha256Sums(text)).toEqual(
      new Map([
        ["a", a],
        ["z dir/b", b],
      ]),
    );
    expect(() => parseSha256Sums("nope  a\n")).toThrow("Malformed");
  });
});

describe("createTar", () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "sumi tar "));
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const longDir = `pkg/${"d".repeat(80)}`;
  const entries: TarEntry[] = [
    {
      path: "pkg/bin/tool",
      type: "file",
      mode: 0o755,
      data: new TextEncoder().encode("#!/bin/sh\n"),
    },
    { path: "pkg", type: "directory", mode: 0o755 },
    { path: "pkg/bin", type: "directory", mode: 0o755 },
    { path: "pkg/empty.txt", type: "file", mode: 0o644, data: new Uint8Array() },
    { path: longDir, type: "directory", mode: 0o755 },
    {
      path: `${longDir}/${"f".repeat(60)}.txt`,
      type: "file",
      mode: 0o644,
      data: new Uint8Array(1500).fill(65),
    },
  ];

  test("is deterministic and independent of entry order", () => {
    const one = gzipDeterministic(createTar(entries, 1_700_000_000));
    const two = gzipDeterministic(createTar([...entries].reverse(), 1_700_000_000));
    expect(sha256Hex(one)).toBe(sha256Hex(two));
    expect([...one.subarray(4, 10)]).toEqual([0, 0, 0, 0, 2, 3]);
  });

  test("extracts with the system tar, keeping modes and long paths", async () => {
    const archive = join(root, "test.tar.gz");
    await writeFile(archive, gzipDeterministic(createTar(entries, 1_700_000_000)));
    const out = join(root, "out");
    await mkdir(out);
    const result = await runCommand(["tar", "-xzf", archive, "-C", out]);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);

    expect(await readFile(join(out, "pkg/bin/tool"), "utf8")).toBe("#!/bin/sh\n");
    expect((await stat(join(out, "pkg/bin/tool"))).mode & 0o777).toBe(0o755);
    expect((await stat(join(out, "pkg/empty.txt"))).size).toBe(0);
    const long = await readFile(join(out, longDir, `${"f".repeat(60)}.txt`));
    expect(long.length).toBe(1500);
    expect((await stat(join(out, "pkg/bin/tool"))).mtimeMs).toBe(1_700_000_000_000);
  });

  test("rejects a path too long for ustar", () => {
    expect(() => createTar([{ path: "x".repeat(300), type: "directory", mode: 0o755 }], 0)).toThrow(
      "too long",
    );
  });
});
