import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
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
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CliContext,
  destinationKey,
  isCaseInsensitiveDir,
  protectedFile,
  removeWritten,
  resolveDestination,
  sameDestination,
  writeDestination,
} from "./io";

let dir: string;
let context: CliContext;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "sumi-io-"));
  const sink = { write: () => {} };
  context = { stdout: sink, stderr: sink, cwd: dir, env: {} };
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A fresh subdirectory with an input file `in.yaml` ("INPUT"). */
async function scenario(name: string): Promise<string> {
  const root = join(dir, name);
  await mkdir(root);
  await writeFile(join(root, "in.yaml"), "INPUT");
  return name;
}

describe("destinationKey / sameDestination", () => {
  const at = (name: string, caseInsensitive: boolean) => ({
    display: name,
    dir: "/out",
    name,
    caseInsensitive,
  });

  test("names differing only by case are the same file only on case-insensitive file systems", () => {
    expect(sameDestination(at("result.svg", true), at("RESULT.svg", true))).toBe(true);
    expect(sameDestination(at("result.svg", false), at("RESULT.svg", false))).toBe(false);
    expect(destinationKey(at("Résumé.svg", true))).toBe(
      destinationKey(at("résumé.svg".toUpperCase(), true)),
    );
  });

  test("existing files with the same identity are the same file", () => {
    const a = { ...at("a.svg", false), identity: "1:2" as const };
    const b = { ...at("b.svg", false), identity: "1:2" as const };
    expect(sameDestination(a, b)).toBe(true);
    expect(sameDestination(a, { ...b, identity: "1:3" })).toBe(false);
  });
});

describe("isCaseInsensitiveDir", () => {
  test("agrees with the file system and leaves no probe file behind", async () => {
    const root = await scenario("case-probe");
    await writeFile(join(dir, root, "lower.txt"), "");
    const actual = await stat(join(dir, root, "LOWER.TXT")).then(
      () => true,
      () => false,
    );
    expect(await isCaseInsensitiveDir(join(dir, root))).toBe(actual);
    expect((await readdir(join(dir, root))).sort()).toEqual(["in.yaml", "lower.txt"]);
  });
});

describe("resolveDestination + writeDestination", () => {
  test("follows a link to its target once; retargeting the link later does not redirect the write", async () => {
    const root = await scenario("retarget");
    await writeFile(join(dir, root, "other.svg"), "OLD");
    await symlink("other.svg", join(dir, root, "out.svg"));
    const input = await resolveDestination(context, `${root}/in.yaml`);
    const out = await resolveDestination(context, `${root}/out.svg`);
    expect(out.name).toBe("other.svg");

    await writeDestination(out, "SVG", {
      protect: [protectedFile(input)],
      beforeCommit: async () => {
        await unlink(join(dir, root, "out.svg"));
        await symlink("in.yaml", join(dir, root, "out.svg"));
      },
    });
    expect(await readFile(join(dir, root, "in.yaml"), "utf8")).toBe("INPUT");
    expect(await readFile(join(dir, root, "other.svg"), "utf8")).toBe("SVG");
  });

  test("a link created at a new output path is replaced, not followed", async () => {
    const root = await scenario("new-link");
    const input = await resolveDestination(context, `${root}/in.yaml`);
    const out = await resolveDestination(context, `${root}/new.svg`);
    await writeDestination(out, "SVG", {
      protect: [protectedFile(input)],
      beforeCommit: () => symlink("in.yaml", join(dir, root, "new.svg")),
    });
    expect(await readFile(join(dir, root, "in.yaml"), "utf8")).toBe("INPUT");
    expect((await lstat(join(dir, root, "new.svg"))).isSymbolicLink()).toBe(false);
    expect(await readFile(join(dir, root, "new.svg"), "utf8")).toBe("SVG");
  });

  test("refuses when a parent directory is swapped for a link", async () => {
    const root = await scenario("parent-swap");
    await mkdir(join(dir, root, "d"));
    const input = await resolveDestination(context, `${root}/in.yaml`);
    const out = await resolveDestination(context, `${root}/d/in.yaml`);
    const write = writeDestination(out, "SVG", {
      protect: [protectedFile(input)],
      beforeCommit: async () => {
        await rename(join(dir, root, "d"), join(dir, root, "d-old"));
        await symlink(".", join(dir, root, "d"));
      },
    });
    await expect(write).rejects.toThrow("its directory changed");
    expect(await readFile(join(dir, root, "in.yaml"), "utf8")).toBe("INPUT");
    // Only the abandoned temporary file can remain in the moved directory.
    expect((await readdir(join(dir, root, "d-old"))).every((n) => n.endsWith(".tmp"))).toBe(true);
  });

  test("refuses when the destination became the protected file", async () => {
    const root = await scenario("hard-link");
    const input = await resolveDestination(context, `${root}/in.yaml`);
    const out = await resolveDestination(context, `${root}/out.svg`);
    const write = writeDestination(out, "SVG", {
      protect: [protectedFile(input)],
      beforeCommit: () => link(join(dir, root, "in.yaml"), join(dir, root, "out.svg")),
    });
    await expect(write).rejects.toThrow("is the same file as");
    expect(await readFile(join(dir, root, "in.yaml"), "utf8")).toBe("INPUT");
    expect((await readdir(join(dir, root))).sort()).toEqual(["in.yaml", "out.svg"]);
  });

  test("refuses a second output that the file system says is the first one (hard link)", async () => {
    const root = await scenario("second-output");
    const first = await writeDestination(
      await resolveDestination(context, `${root}/a.svg`),
      "FIRST",
    );
    expect(first.created).toBe(true);
    const second = await resolveDestination(context, `${root}/b.d2`);
    const write = writeDestination(second, "SECOND", {
      protect: [first],
      beforeCommit: () => link(first.path, join(dir, root, "b.d2")),
    });
    await expect(write).rejects.toThrow(
      `Cannot write ${root}/b.d2: it is the same file as ${root}/a.svg.`,
    );
    expect(await readFile(join(dir, root, "a.svg"), "utf8")).toBe("FIRST");
    expect((await readdir(join(dir, root))).sort()).toEqual(["a.svg", "b.d2", "in.yaml"]);
  });

  test("catches names the file system folds together beyond lowercasing (Σ / ς)", async () => {
    const root = await scenario("sigma");
    const folder = join(dir, root);
    if (!(await isCaseInsensitiveDir(await realpath(folder)))) {
      console.warn("[cli io] the temp file system is case-sensitive; skipping the Σ/ς test.");
      return;
    }
    const upper = await resolveDestination(context, `${root}/Σ.svg`);
    const final = await resolveDestination(context, `${root}/ς.svg`);
    // The name heuristic does not model this folding ...
    expect(sameDestination(upper, final)).toBe(false);
    const first = await writeDestination(upper, "FIRST");
    if (
      !(await stat(join(folder, "ς.svg")).then(
        () => true,
        () => false,
      ))
    ) {
      console.warn("[cli io] this file system does not fold Σ and ς; skipping.");
      return;
    }
    // ... but the identity check right before the rename does.
    await expect(writeDestination(final, "SECOND", { protect: [first] })).rejects.toThrow(
      "is the same file as",
    );
    expect(await readFile(first.path, "utf8")).toBe("FIRST");
  });

  test("removeWritten deletes only the file it wrote", async () => {
    const root = await scenario("remove");
    await mkdir(join(dir, root, "d"));
    await mkdir(join(dir, root, "elsewhere"));
    await writeFile(join(dir, root, "elsewhere", "out.d2"), "PRECIOUS");
    const write = () =>
      resolveDestination(context, `${root}/d/out.d2`).then((d) => writeDestination(d, "D2"));

    const kept = await write();
    await rename(join(dir, root, "d"), join(dir, root, "d-old"));
    await symlink("elsewhere", join(dir, root, "d"));
    expect(await removeWritten(kept)).toBe(false);
    expect(await readFile(join(dir, root, "elsewhere", "out.d2"), "utf8")).toBe("PRECIOUS");

    await unlink(join(dir, root, "d"));
    await mkdir(join(dir, root, "d"));
    const replaced = await write();
    // Replace it with a different file (created while the old one exists, so no inode reuse).
    await writeFile(`${replaced.path}.new`, "NEW FILE");
    await rename(`${replaced.path}.new`, replaced.path);
    expect(await removeWritten(replaced)).toBe(false);
    expect(await readFile(replaced.path, "utf8")).toBe("NEW FILE");

    const own = await write();
    expect(await removeWritten(own)).toBe(true);
    expect(await Bun.file(own.path).exists()).toBe(false);
  });

  test("a broken link is a usage error", async () => {
    const root = await scenario("broken");
    await symlink("missing", join(dir, root, "out.svg"));
    await expect(resolveDestination(context, `${root}/out.svg`)).rejects.toThrow(
      "broken symbolic link",
    );
  });
});
