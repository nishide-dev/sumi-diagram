import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runCommand } from "../../core/subprocess";
import { createFakeD2 } from "./fake-d2";
import { installD2 } from "./install";
import { D2_TARBALL_BINARY, type D2ReleaseAsset } from "./version";

let root: string;
let counter = 0;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "sumi d2 install "));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Builds a release-shaped tarball holding a fake `d2` that reports `version`. */
async function fakeRelease(
  version: string,
): Promise<{ tarball: Uint8Array; asset: D2ReleaseAsset }> {
  const src = join(root, `release ${counter++}`);
  await createFakeD2(join(src, dirname(D2_TARBALL_BINARY)), { version });
  const archive = join(src, "d2.tar.gz");
  const tar = await runCommand(["tar", "-czf", archive, "-C", src, D2_TARBALL_BINARY]);
  if (tar.exitCode !== 0) throw new Error(tar.stderr);
  const tarball = new Uint8Array(await readFile(archive));
  const sha256 = new Bun.CryptoHasher("sha256").update(tarball).digest("hex");
  return { tarball, asset: { name: "d2-test.tar.gz", sha256 } };
}

function destinationIn(name: string): string {
  return join(root, name, "bin dir", "d2");
}

describe("installD2", () => {
  test("installs a verified binary and skips an existing pinned install", async () => {
    const { tarball, asset } = await fakeRelease("v0.9.0");
    const destination = destinationIn("single");
    const download = async () => tarball;

    expect(await installD2({ destination, asset, download })).toBe("installed");
    expect(await readdir(dirname(destination))).toEqual(["d2"]);
    expect(await installD2({ destination, asset, download })).toBe("already-installed");
  });

  test("concurrent installs to one destination do not interfere", async () => {
    const { tarball, asset } = await fakeRelease("v0.9.0");
    const destination = destinationIn("concurrent");
    const outcomes = await Promise.all(
      Array.from({ length: 4 }, () =>
        installD2({ destination, asset, force: true, download: async () => tarball }),
      ),
    );
    expect(outcomes).toEqual(["installed", "installed", "installed", "installed"]);
    expect(await readdir(dirname(destination))).toEqual(["d2"]);
    const version = await runCommand([destination, "--version"]);
    expect(version.stdout.trim()).toBe("v0.9.0");
  });

  test("rejects a checksum mismatch without touching the destination", async () => {
    const { tarball, asset } = await fakeRelease("v0.9.0");
    const destination = destinationIn("mismatch");
    const tampered = Uint8Array.from([...tarball, 0]);
    await expect(installD2({ destination, asset, download: async () => tampered })).rejects.toThrow(
      "SHA-256 mismatch",
    );
    expect(await Bun.file(destination).exists()).toBe(false);
  });

  test("cleans up its work directory when the extracted binary fails verification", async () => {
    const { tarball, asset } = await fakeRelease("v0.7.1");
    const destination = destinationIn("bad version");
    await expect(installD2({ destination, asset, download: async () => tarball })).rejects.toThrow(
      "v0.7.1",
    );
    expect(await readdir(dirname(destination))).toEqual([]);
  });

  test("rejects platforms without a release", async () => {
    await expect(
      installD2({ destination: destinationIn("windows"), platform: "win32", arch: "x64" }),
    ).rejects.toThrow("no prebuilt release for win32-x64");
  });
});
