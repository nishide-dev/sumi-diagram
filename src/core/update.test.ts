import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "./subprocess";
import {
  archiveName,
  CHECK_INTERVAL_MS,
  cacheFile,
  checkForUpdate,
  checksumFor,
  compareSkillVersion,
  compareVersions,
  detectInstall,
  type FetchLike,
  normalizeVersion,
  platformTarget,
  RETRY_AFTER_FAILURE_MS,
  resolveLatestVersion,
  runUpdate,
  type UpdateEnvironment,
  UpdateError,
  updateCheckDisabled,
} from "./update";

const TARGET = platformTarget() ?? "linux-x64";
let root: string;
let home: string;
let bin: string;
let server: string;
let env: Record<string, string | undefined>;

/** A fake release: a shell script that prints its version, inside `sumi-<v>-<target>/`. */
async function makeRelease(version: string, options: { broken?: boolean } = {}): Promise<void> {
  const name = archiveName(version, TARGET);
  const stage = await mkdtemp(join(root, "stage-"));
  await mkdir(join(stage, name, "bin"), { recursive: true });
  const script = options.broken ? "#!/bin/sh\nexit 3\n" : `#!/bin/sh\necho ${version}\n`;
  await writeFile(join(stage, name, "bin", "sumi"), script);
  await chmod(join(stage, name, "bin", "sumi"), 0o755);
  const tarball = join(server, `${name}.tar.gz`);
  const made = await runCommand(["tar", "-czf", tarball, "-C", stage, name]);
  expect(made.exitCode).toBe(0);
  await rm(stage, { recursive: true });
  const sum = new Bun.CryptoHasher("sha256").update(await readFile(tarball)).digest("hex");
  await writeFile(join(server, "SHA256SUMS"), `${sum}  ${name}.tar.gz\n`);
}

/** An install.sh-shaped install of `version`. */
async function makeInstall(version: string): Promise<string> {
  const name = archiveName(version, TARGET);
  await mkdir(join(home, name, "bin"), { recursive: true });
  const exe = join(home, name, "bin", "sumi");
  await writeFile(exe, `#!/bin/sh\necho ${version}\n`);
  await chmod(exe, 0o755);
  await symlink(exe, join(bin, "sumi"));
  return exe;
}

function update(extra: Partial<UpdateEnvironment> = {}, exec?: string): UpdateEnvironment {
  return { mode: "compiled", ...(exec !== undefined && { execPath: exec }), ...extra };
}

const dirs = async (path: string) => (await readdir(path)).sort();

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sumi-update-"));
  home = join(root, "home");
  bin = join(root, "bin");
  server = join(root, "server");
  await Promise.all([mkdir(home), mkdir(bin), mkdir(server)]);
  await writeFile(join(server, "latest.json"), JSON.stringify({ tag_name: "v0.20.0" }));
  env = {
    HOME: join(root, "nohome"),
    SUMI_HOME: home,
    SUMI_BIN_DIR: bin,
    SUMI_DOWNLOAD_BASE: server,
    SUMI_LATEST_URL: join(server, "latest.json"),
  };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("versions and targets", () => {
  test("compares and normalizes versions", () => {
    expect(compareVersions("0.19.1", "0.19.0")).toBe(1);
    expect(compareVersions("0.9.0", "0.19.0")).toBe(-1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0", "1.0.0-rc.1")).toBe(1);
    expect(normalizeVersion("v0.20.1")).toBe("0.20.1");
    expect(normalizeVersion("latest")).toBeUndefined();
    expect(normalizeVersion("0.20")).toBeUndefined();
  });

  test("maps platforms to release targets", () => {
    expect(platformTarget("darwin", "arm64")).toBe("darwin-arm64");
    expect(platformTarget("darwin", "x64")).toBe("darwin-x64");
    expect(platformTarget("linux", "x64")).toBe("linux-x64");
    expect(platformTarget("linux", "arm64")).toBe("linux-arm64");
    expect(platformTarget("win32", "x64")).toBeUndefined();
    expect(platformTarget("linux", "ia32")).toBeUndefined();
    expect(archiveName("0.20.0", "linux-x64")).toBe("sumi-0.20.0-linux-x64");
  });

  test("finds one checksum per archive and rejects bad lines", () => {
    const hash = "a".repeat(64);
    expect(checksumFor(`${hash}  x.tar.gz\n${"b".repeat(64)} *y.tar.gz\n`, "y.tar.gz")).toBe(
      "b".repeat(64),
    );
    expect(() => checksumFor(`${hash}  x.tar.gz\n`, "y.tar.gz")).toThrow(UpdateError);
    expect(() => checksumFor(`${hash}  x.tar.gz\n${hash}  x.tar.gz\n`, "x.tar.gz")).toThrow(
      "Duplicate",
    );
    expect(() => checksumFor("zz  x.tar.gz\n", "x.tar.gz")).toThrow("invalid checksum");
  });
});

describe("latest release", () => {
  test("is read from the API through fetch, from a path or from file://", async () => {
    const urls: string[] = [];
    const f: FetchLike = async (url) => {
      urls.push(url);
      return new Response(JSON.stringify({ tag_name: "v1.2.3" }));
    };
    expect(await resolveLatestVersion({}, f)).toBe("1.2.3");
    expect(urls).toEqual(["https://api.github.com/repos/nishide-dev/sumi-diagram/releases/latest"]);
    expect(await resolveLatestVersion({ SUMI_LATEST_URL: "https://mirror/x" }, f)).toBe("1.2.3");
    expect(urls[1]).toBe("https://mirror/x");
    expect(await resolveLatestVersion(env, f)).toBe("0.20.0");
    expect(await resolveLatestVersion({ SUMI_LATEST_URL: `file://${server}/latest.json` }, f)).toBe(
      "0.20.0",
    );
  });

  test("HTTP errors and bad JSON are update errors", async () => {
    const down: FetchLike = async () => new Response("no", { status: 503 });
    await expect(resolveLatestVersion({}, down)).rejects.toMatchObject({
      diagnostic: { code: "update/download-failed" },
    });
    const junk: FetchLike = async () => new Response("<html>");
    await expect(resolveLatestVersion({}, junk)).rejects.toMatchObject({
      diagnostic: { code: "update/bad-release-info" },
    });
  });
});

describe("install layout detection", () => {
  test("recognizes install.sh's layout through the bin symlink", async () => {
    await makeInstall("0.19.0");
    const found = await detectInstall({ env, execPath: join(bin, "sumi"), mode: "compiled" });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.layout).toMatchObject({ version: "0.19.0", target: TARGET });
    expect(found.layout.prefix).toBe(join(await realHome(), archiveName("0.19.0", TARGET)));
  });

  test("refuses source runs, foreign layouts, a mismatching SUMI_HOME and other platforms", async () => {
    const exe = await makeInstall("0.19.0");
    expect((await detectInstall({ env, execPath: exe, mode: "source" })).ok).toBe(false);
    const elsewhere = join(root, "opt", "sumi");
    await mkdir(join(root, "opt"), { recursive: true });
    await writeFile(elsewhere, "#!/bin/sh\n");
    const foreign = await detectInstall({ env, execPath: elsewhere, mode: "compiled" });
    expect(foreign).toMatchObject({ ok: false });
    const wrongHome = await detectInstall({
      env: { ...env, SUMI_HOME: join(root, "other") },
      execPath: exe,
      mode: "compiled",
    });
    expect(wrongHome).toMatchObject({ ok: false });
    const platform = await detectInstall({
      env,
      execPath: exe,
      mode: "compiled",
      platform: "win32",
    });
    expect(platform).toMatchObject({ ok: false });
    const arch = await detectInstall({
      env,
      execPath: exe,
      mode: "compiled",
      platform: TARGET.startsWith("darwin") ? "linux" : "darwin",
    });
    expect(arch).toMatchObject({ ok: false });
  });

  test("a manually extracted release (no sumi symlink to it) is refused", async () => {
    const exe = await makeInstall("0.19.0");
    await rm(join(bin, "sumi"));
    const found = await detectInstall({ env, execPath: exe, mode: "compiled" });
    expect(found.ok).toBe(false);
    await symlink(join(root, "elsewhere"), join(bin, "sumi"));
    expect((await detectInstall({ env, execPath: exe, mode: "compiled" })).ok).toBe(false);
  });

  test("the install marker names the bin directory when SUMI_BIN_DIR is not set", async () => {
    const exe = await makeInstall("0.19.0");
    const bare = { ...env, SUMI_BIN_DIR: "" };
    expect((await detectInstall({ env: bare, execPath: exe, mode: "compiled" })).ok).toBe(false);
    await writeFile(join(home, ".sumi-install"), `bin=${bin}\n`);
    const found = await detectInstall({ env: bare, execPath: exe, mode: "compiled" });
    expect(found.ok).toBe(true);
  });

  test("an empty SUMI_HOME is treated as unset", async () => {
    const exe = await makeInstall("0.19.0");
    const found = await detectInstall({
      env: { ...env, SUMI_HOME: "" },
      execPath: exe,
      mode: "compiled",
    });
    expect(found.ok).toBe(true);
  });
});

async function realHome(): Promise<string> {
  const { realpath } = await import("node:fs/promises");
  return realpath(home);
}

describe("sumi update", () => {
  test("installs the new release, switches the link and removes the old one", async () => {
    const exe = await makeInstall("0.19.0");
    await makeRelease("0.20.0");
    const lines: string[] = [];
    const outcome = await runUpdate({
      env,
      log: (l) => lines.push(l),
      update: update({}, exe),
    });
    expect(outcome).toMatchObject({
      status: "updated",
      from: "0.19.0",
      to: "0.20.0",
      direction: "upgrade",
    });
    expect(await dirs(home)).toEqual([archiveName("0.20.0", TARGET)]);
    const target = await readlink(join(bin, "sumi"));
    expect(target).toBe(join(await realHome(), archiveName("0.20.0", TARGET), "bin", "sumi"));
    const run = await runCommand([join(bin, "sumi")]);
    expect(run.stdout.trim()).toBe("0.20.0");
    expect(lines.join("\n")).toContain("Checksum verified");
    expect(await dirs(bin)).toEqual(["sumi"]);
  });

  test("is a no-op when up to date, and when latest is older than the running version", async () => {
    const exe = await makeInstall("0.20.0");
    expect(await runUpdate({ env, update: update({}, exe) })).toMatchObject({
      status: "up-to-date",
    });
    await writeFile(join(server, "latest.json"), JSON.stringify({ tag_name: "v0.19.0" }));
    expect(await runUpdate({ env, update: update({}, exe) })).toMatchObject({
      status: "up-to-date",
    });
    expect(await dirs(home)).toEqual([archiveName("0.20.0", TARGET)]);
  });

  test("--check reports without touching anything", async () => {
    const exe = await makeInstall("0.19.0");
    const before = await dirs(home);
    const failing: FetchLike = async () => {
      throw new Error("no archive fetch expected");
    };
    expect(await runUpdate({ env, check: true, update: update({ fetch: failing }, exe) })).toEqual({
      status: "available",
      current: "0.19.0",
      latest: "0.20.0",
    });
    expect(await dirs(home)).toEqual(before);
  });

  test("--version installs a specific, even older, release", async () => {
    const exe = await makeInstall("0.20.0");
    await makeRelease("0.18.2");
    const outcome = await runUpdate({ env, version: "v0.18.2", update: update({}, exe) });
    expect(outcome).toMatchObject({ status: "updated", to: "0.18.2", direction: "downgrade" });
    expect((await runCommand([join(bin, "sumi")])).stdout.trim()).toBe("0.18.2");
    expect(
      await runUpdate({
        env,
        version: "0.20.0",
        check: true,
        update: update({}, join(bin, "sumi")),
      }),
    ).toMatchObject({ status: "available" });
  });

  test("rejects an invalid --version", async () => {
    const exe = await makeInstall("0.19.0");
    await expect(
      runUpdate({ env, version: "nope", update: update({}, exe) }),
    ).rejects.toMatchObject({
      diagnostic: { code: "update/bad-version" },
    });
  });

  test("a checksum mismatch keeps the old version and leaves no leftovers", async () => {
    const exe = await makeInstall("0.19.0");
    await makeRelease("0.20.0");
    await writeFile(
      join(server, "SHA256SUMS"),
      `${"0".repeat(64)}  ${archiveName("0.20.0", TARGET)}.tar.gz\n`,
    );
    await expect(runUpdate({ env, update: update({}, exe) })).rejects.toMatchObject({
      diagnostic: { code: "update/checksum-mismatch" },
    });
    expect(await dirs(home)).toEqual([archiveName("0.19.0", TARGET)]);
    expect((await runCommand([join(bin, "sumi")])).stdout.trim()).toBe("0.19.0");
  });

  test("a missing archive or checksum entry keeps the old version", async () => {
    const exe = await makeInstall("0.19.0");
    await expect(runUpdate({ env, update: update({}, exe) })).rejects.toMatchObject({
      diagnostic: { code: "update/download-failed" },
    });
    await makeRelease("0.20.0");
    await writeFile(join(server, "SHA256SUMS"), "");
    await expect(runUpdate({ env, update: update({}, exe) })).rejects.toMatchObject({
      diagnostic: { code: "update/checksum-missing" },
    });
    expect(await dirs(home)).toEqual([archiveName("0.19.0", TARGET)]);
  });

  test("a release that does not run is rejected before anything changes", async () => {
    const exe = await makeInstall("0.19.0");
    await makeRelease("0.20.0", { broken: true });
    await expect(runUpdate({ env, update: update({}, exe) })).rejects.toMatchObject({
      diagnostic: { code: "update/verify-failed" },
    });
    expect(await dirs(home)).toEqual([archiveName("0.19.0", TARGET)]);
  });

  test("an archive with unexpected entries is rejected", async () => {
    const exe = await makeInstall("0.19.0");
    const name = archiveName("0.20.0", TARGET);
    const stage = await mkdtemp(join(root, "evil-"));
    await mkdir(join(stage, "other", "bin"), { recursive: true });
    await writeFile(join(stage, "other", "bin", "sumi"), "#!/bin/sh\n");
    const tarball = join(server, `${name}.tar.gz`);
    await runCommand(["tar", "-czf", tarball, "-C", stage, "other"]);
    const sum = new Bun.CryptoHasher("sha256").update(await readFile(tarball)).digest("hex");
    await writeFile(join(server, "SHA256SUMS"), `${sum}  ${name}.tar.gz\n`);
    await expect(runUpdate({ env, update: update({}, exe) })).rejects.toMatchObject({
      diagnostic: { code: "update/bad-archive" },
    });
    expect(await dirs(home)).toEqual([archiveName("0.19.0", TARGET)]);
  });

  test("a failure before the link switch (interrupted swap) restores the old install", async () => {
    const exe = await makeInstall("0.19.0");
    await makeRelease("0.20.0");
    const hooks = update(
      {
        beforeSwitch: () => {
          throw new Error("interrupted");
        },
      },
      exe,
    );
    await expect(runUpdate({ env, update: hooks })).rejects.toMatchObject({
      diagnostic: { code: "update/failed" },
    });
    expect(await dirs(home)).toEqual([archiveName("0.19.0", TARGET)]);
    expect((await runCommand([join(bin, "sumi")])).stdout.trim()).toBe("0.19.0");
    expect(await dirs(bin)).toEqual(["sumi"]);
  });

  test("an update killed after staging leaves the old link working; stale staging is cleaned next time", async () => {
    const exe = await makeInstall("0.19.0");
    await makeRelease("0.20.0");
    const stale = join(home, ".sumi-update.dead");
    await mkdir(join(stale, "x"), { recursive: true });
    const old = new Date(Date.now() - 3 * 3600 * 1000);
    await utimes(stale, old, old);
    const fresh = join(home, ".sumi-update.live");
    await mkdir(fresh);
    await runUpdate({ env, update: update({}, exe) });
    expect(await dirs(home)).toEqual([".sumi-update.live", archiveName("0.20.0", TARGET)]);
  });

  test("never deletes an existing destination: a working one is reused, a broken one refused", async () => {
    const exe = await makeInstall("0.19.0");
    await makeRelease("0.20.0");
    // A leftover 0.20.0 directory that works: reused, link switched.
    const leftover = join(home, archiveName("0.20.0", TARGET), "bin");
    await mkdir(leftover, { recursive: true });
    await writeFile(join(leftover, "sumi"), "#!/bin/sh\necho 0.20.0\n");
    await chmod(join(leftover, "sumi"), 0o755);
    await writeFile(join(leftover, "keep"), "mine");
    await runUpdate({ env, update: update({}, exe) });
    expect(await readFile(join(leftover, "keep"), "utf8")).toBe("mine");
    expect((await runCommand([join(bin, "sumi")])).stdout.trim()).toBe("0.20.0");
  });

  test("a broken destination directory is refused and left alone", async () => {
    const exe = await makeInstall("0.19.0");
    await makeRelease("0.20.0");
    const broken = join(home, archiveName("0.20.0", TARGET));
    await mkdir(broken, { recursive: true });
    await writeFile(join(broken, "precious"), "data");
    await expect(runUpdate({ env, update: update({}, exe) })).rejects.toMatchObject({
      diagnostic: { code: "update/destination-exists" },
    });
    expect(await readFile(join(broken, "precious"), "utf8")).toBe("data");
    expect((await runCommand([join(bin, "sumi")])).stdout.trim()).toBe("0.19.0");
  });

  test("archives with links are rejected before extraction", async () => {
    const exe = await makeInstall("0.19.0");
    const name = archiveName("0.20.0", TARGET);
    for (const kind of ["bin-to-sh", "outside", "hardlink"]) {
      const stage = await mkdtemp(join(root, "evil-"));
      await mkdir(join(stage, name, "bin"), { recursive: true });
      if (kind === "bin-to-sh") await symlink("/bin/sh", join(stage, name, "bin", "sumi"));
      else {
        await writeFile(join(stage, name, "bin", "sumi"), "#!/bin/sh\necho 0.20.0\n");
        await chmod(join(stage, name, "bin", "sumi"), 0o755);
        if (kind === "outside") await symlink("/etc", join(stage, name, "link"));
        else await runCommand(["ln", join(stage, name, "bin", "sumi"), join(stage, name, "hard")]);
      }
      const tarball = join(server, `${name}.tar.gz`);
      expect((await runCommand(["tar", "-czf", tarball, "-C", stage, name])).exitCode).toBe(0);
      const sum = new Bun.CryptoHasher("sha256").update(await readFile(tarball)).digest("hex");
      await writeFile(join(server, "SHA256SUMS"), `${sum}  ${name}.tar.gz\n`);
      await expect(runUpdate({ env, update: update({}, exe) })).rejects.toMatchObject({
        diagnostic: { code: "update/bad-archive" },
      });
      expect(await dirs(home)).toEqual([archiveName("0.19.0", TARGET)]);
    }
  });

  test("a link that moved before the switch aborts the update", async () => {
    const exe = await makeInstall("0.19.0");
    await makeRelease("0.20.0");
    const moved = update(
      {
        beforeSwitch: async () => {
          await rm(join(bin, "sumi"));
          await symlink(join(root, "other"), join(bin, "sumi"));
        },
      },
      exe,
    );
    await expect(runUpdate({ env, update: moved })).rejects.toMatchObject({
      diagnostic: { code: "update/link-changed" },
    });
    expect(await readlink(join(bin, "sumi"))).toBe(join(root, "other"));
    expect(await dirs(home)).toEqual([archiveName("0.19.0", TARGET)]);
  });

  test("two concurrent updates: one runs, the other is refused cleanly", async () => {
    const exe = await makeInstall("0.19.0");
    await makeRelease("0.20.0");
    const results = await Promise.allSettled([
      runUpdate({ env, update: update({}, exe) }),
      runUpdate({ env, update: update({}, exe) }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason.diagnostic.code).toBe("update/locked");
    expect((await runCommand([join(bin, "sumi")])).stdout.trim()).toBe("0.20.0");
    expect(await dirs(home)).toEqual([archiveName("0.20.0", TARGET)]);
  });

  test("a stale lock (dead process) is taken over", async () => {
    const exe = await makeInstall("0.19.0");
    await makeRelease("0.20.0");
    await writeFile(join(home, ".sumi-lock"), `999999999 ${Date.now()}\n`);
    await runUpdate({ env, update: update({}, exe) });
    expect(await dirs(home)).toEqual([archiveName("0.20.0", TARGET)]);
    await writeFile(join(home, ".sumi-lock"), `${process.pid} ${Date.now()}\n`);
    await expect(
      runUpdate({ env, version: "0.19.0", update: update({}, join(bin, "sumi")) }),
    ).rejects.toMatchObject({ diagnostic: { code: "update/locked" } });
  });

  test("a non-install.sh layout is refused with the install command and nothing is touched", async () => {
    const lone = join(root, "opt", "sumi");
    await mkdir(join(root, "opt"), { recursive: true });
    await writeFile(lone, "#!/bin/sh\n");
    await makeRelease("0.20.0");
    const error = await runUpdate({ env, update: update({}, lone) }).catch((e) => e);
    expect(error).toBeInstanceOf(UpdateError);
    expect(error.diagnostic.code).toBe("update/unsupported-layout");
    expect(error.diagnostic.hint).toContain("install.sh | sh");
    expect(await dirs(home)).toEqual([]);
    const source = await runUpdate({ env, update: { mode: "source" } }).catch((e) => e);
    expect(source.diagnostic.code).toBe("update/unsupported-layout");
  });

  test("downloads over HTTP through the injected fetch", async () => {
    const exe = await makeInstall("0.19.0");
    await makeRelease("0.20.0");
    const urls: string[] = [];
    const f: FetchLike = async (url) => {
      urls.push(url);
      if (url.endsWith("/latest")) return new Response(JSON.stringify({ tag_name: "v0.20.0" }));
      const file = url.split("/").pop() ?? "";
      return new Response(await readFile(join(server, file)));
    };
    const httpEnv = { ...env };
    httpEnv.SUMI_LATEST_URL = "https://example.test/latest";
    httpEnv.SUMI_DOWNLOAD_BASE = "https://example.test/dl/";
    await runUpdate({ env: httpEnv, update: update({ fetch: f }, exe) });
    expect(urls).toEqual([
      "https://example.test/latest",
      `https://example.test/dl/${archiveName("0.20.0", TARGET)}.tar.gz`,
      "https://example.test/dl/SHA256SUMS",
    ]);
  });
});

describe("update notice", () => {
  let now: number;
  let calls: number;
  let latest: string;
  const f: FetchLike = async () => {
    calls++;
    return new Response(JSON.stringify({ tag_name: `v${latest}` }));
  };
  const notice = (
    extra: Record<string, string | undefined> = {},
    flag: Partial<UpdateEnvironment> = {},
  ) =>
    checkForUpdate({
      env: { XDG_CACHE_HOME: join(root, "cache"), ...extra },
      current: "0.19.0",
      update: { mode: "compiled", fetch: f, now: () => now, ...flag },
    });

  beforeEach(() => {
    now = 1_000_000_000_000;
    calls = 0;
    latest = "0.20.0";
  });

  test("checks the network once, then answers from the cache for a day", async () => {
    expect(await notice()).toEqual({
      current: "0.19.0",
      latest: "0.20.0",
      available: true,
      source: "network",
    });
    now += CHECK_INTERVAL_MS - 1;
    latest = "0.21.0";
    expect(await notice()).toMatchObject({ latest: "0.20.0", source: "cache" });
    expect(calls).toBe(1);
    now += 2;
    expect(await notice()).toMatchObject({ latest: "0.21.0", source: "network" });
    expect(calls).toBe(2);
    const cached = JSON.parse(
      await readFile(join(root, "cache", "sumi", "update-check.json"), "utf8"),
    );
    expect(cached).toEqual({ checkedAt: now, latest: "0.21.0" });
  });

  test("is not available when up to date", async () => {
    latest = "0.19.0";
    expect(await notice()).toMatchObject({ available: false });
  });

  test("is silent offline and retries only after an hour", async () => {
    const offline: Partial<UpdateEnvironment> = {
      fetch: async () => {
        calls++;
        throw new Error("offline");
      },
    };
    expect(await notice({}, offline)).toBeUndefined();
    now += RETRY_AFTER_FAILURE_MS - 1;
    expect(await notice({}, offline)).toBeUndefined();
    expect(calls).toBe(1);
    now += 2;
    expect(await notice({}, offline)).toBeUndefined();
    expect(calls).toBe(2);
  });

  test("keeps showing the cached version when a later check fails", async () => {
    await notice();
    now += CHECK_INTERVAL_MS + 1;
    const offline = {
      fetch: async () => {
        throw new Error("offline");
      },
    };
    expect(await notice({}, offline)).toMatchObject({ latest: "0.20.0", source: "cache" });
  });

  test("is skipped in CI, with SUMI_NO_UPDATE_CHECK=1, from source, and without a cache dir", async () => {
    expect(await notice({ CI: "true" })).toBeUndefined();
    expect(await notice({ CI: "1" })).toBeUndefined();
    expect(await notice({ SUMI_NO_UPDATE_CHECK: "1" })).toBeUndefined();
    expect(await notice({}, { mode: "source" })).toBeUndefined();
    expect(calls).toBe(0);
    expect(updateCheckDisabled({ CI: "" })).toBe(false);
    expect(updateCheckDisabled({ CI: "false" })).toBe(false);
    expect(updateCheckDisabled({ SUMI_NO_UPDATE_CHECK: "0" })).toBe(false);
    expect(cacheFile({})).toBeUndefined();
    expect(cacheFile({ HOME: "/h" })).toBe("/h/.cache/sumi/update-check.json");
  });

  test("a hung server is cut off by the timeout", async () => {
    const hung: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const started = performance.now();
    expect(await notice({}, { fetch: hung })).toBeUndefined();
    expect(performance.now() - started).toBeLessThan(5000);
  });
});

describe("skill version", () => {
  test("names the side to update", () => {
    expect(compareSkillVersion("0.19.0", "0.19.0")).toMatchObject({ status: "current" });
    const old = compareSkillVersion("0.18.2", "0.19.0");
    expect(old.status).toBe("skill-outdated");
    expect(old.message).toContain("npx skills update sumi");
    const cli = compareSkillVersion("0.20.0", "0.19.0");
    expect(cli.status).toBe("cli-outdated");
    expect(cli.message).toContain("`sumi update`");
    expect(compareSkillVersion("banana", "0.19.0").status).toBe("invalid");
  });
});
