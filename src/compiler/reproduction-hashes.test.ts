import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../..");
const manifest = join(import.meta.dir, "reproduction-hashes.json");
const update = "SUMI_UPDATE_REPRODUCTIONS=1 bun test src/compiler/reproduction-hashes.test.ts";

/**
 * The figure sources of every example: tracked regular files (symlinks are covered by their
 * targets, and a checkout without symlink support would otherwise hash the link text) that are a
 * figure, a referenced asset or the script that generates one, at any depth.
 */
function sourcePaths(): string[] {
  const listed = Bun.spawnSync(
    ["git", "ls-files", "-s", "-z", "examples", "skills/sumi/examples"],
    {
      cwd: root,
    },
  );
  if (listed.exitCode !== 0) throw new Error(`git ls-files failed: ${listed.stderr.toString()}`);
  return listed.stdout
    .toString()
    .split("\0")
    .filter(Boolean)
    .map((line) => line.split("\t") as [string, string])
    .filter(([info]) => !info.startsWith("120000"))
    .map(([, path]) => path)
    .filter((path) => /\.sumi\.yaml$|\/assets\/|\/generate[^/]*\.ts$/.test(path))
    .sort();
}

test("example sources match the reproduction manifest", () => {
  const paths = sourcePaths();
  const hashes = Object.fromEntries(
    paths.map((path) => [
      path,
      createHash("sha256")
        .update(readFileSync(join(root, path)))
        .digest("hex"),
    ]),
  );
  if (process.env.SUMI_UPDATE_REPRODUCTIONS === "1") {
    writeFileSync(manifest, `${JSON.stringify(hashes, null, 2)}\n`);
  }
  let expected: Record<string, string> = {};
  try {
    expected = JSON.parse(readFileSync(manifest, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read reproduction manifest. For an intended change, run ${update}`, {
      cause: error,
    });
  }
  const changed = [...new Set([...Object.keys(expected), ...paths])].filter(
    (path) => expected[path] !== hashes[path],
  );
  expect(
    changed,
    `Reproductions must stay faithful to the original figure. Record lint findings as expected diagnostics instead of editing the figure. Update the manifest only for an intended change: ${update}\nChanged, added, or removed paths: ${changed.join(", ")}`,
  ).toEqual([]);
});
