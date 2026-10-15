import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
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
      protect: input,
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
      protect: input,
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
      protect: input,
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
      protect: input,
      beforeCommit: () => link(join(dir, root, "in.yaml"), join(dir, root, "out.svg")),
    });
    await expect(write).rejects.toThrow("now refers to");
    expect(await readFile(join(dir, root, "in.yaml"), "utf8")).toBe("INPUT");
    expect((await readdir(join(dir, root))).sort()).toEqual(["in.yaml", "out.svg"]);
  });

  test("a broken link is a usage error", async () => {
    const root = await scenario("broken");
    await symlink("missing", join(dir, root, "out.svg"));
    await expect(resolveDestination(context, `${root}/out.svg`)).rejects.toThrow(
      "broken symbolic link",
    );
  });
});
