import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../..");
const manifest = join(import.meta.dir, "reproduction-hashes.json");
const update = "SUMI_UPDATE_REPRODUCTIONS=1 bun test src/compiler/reproduction-hashes.test.ts";

function git(...args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd: root });
  if (result.exitCode !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.toString()}`);
  return result.stdout.toString();
}

/**
 * The figure sources of every example, at any depth: a figure, a referenced asset or the script
 * that generates one, as tracked by git (a source must be added to git to be covered). A regular
 * file is recorded by its content with line endings normalized, so a CRLF checkout hashes the
 * same; a symlink by its target as git stores it, never by reading the checkout, which holds the
 * link text where symlinks are not supported.
 */
function sources(): Record<string, string> {
  const entries = git("ls-files", "-s", "-z", "examples", "skills/sumi/examples")
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const [info = "", path = ""] = line.split("\t");
      const [mode = "", blob = ""] = info.split(" ");
      return { mode, blob, path };
    })
    .filter(({ path }) => /\.sumi\.yaml$|\/assets\/|\/generate[^/]*\.ts$/.test(path))
    .sort((a, b) => a.path.localeCompare(b.path));
  return Object.fromEntries(
    entries.map(({ mode, blob, path }) => {
      if (mode === "120000") return [path, `symlink:${git("cat-file", "-p", blob)}`];
      const bytes = readFileSync(join(root, path));
      const text = bytes.toString("utf8");
      const normalized = text.includes("\0") ? bytes : text.replace(/\r\n/g, "\n");
      return [path, createHash("sha256").update(normalized).digest("hex")];
    }),
  );
}

test("example sources match the reproduction manifest", () => {
  const actual = sources();
  if (process.env.SUMI_UPDATE_REPRODUCTIONS === "1") {
    writeFileSync(manifest, `${JSON.stringify(actual, null, 2)}\n`);
  }
  let expected: Record<string, string> = {};
  try {
    expected = JSON.parse(readFileSync(manifest, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read reproduction manifest. For an intended change, run ${update}`, {
      cause: error,
    });
  }
  const changed = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].filter(
    (path) => expected[path] !== actual[path],
  );
  expect(
    changed,
    `Reproductions must stay faithful to the original figure. Record lint findings as expected diagnostics instead of editing the figure. Update the manifest only for an intended change (git add new sources first): ${update}\nChanged, added, or removed paths: ${changed.join(", ")}`,
  ).toEqual([]);
});
