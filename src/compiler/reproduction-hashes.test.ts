import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../..");
const manifest = join(import.meta.dir, "reproduction-hashes.json");
const update = "SUMI_UPDATE_REPRODUCTIONS=1 bun test src/compiler/reproduction-hashes.test.ts";

test("example YAML contents match the reproduction manifest", () => {
  const paths = ["examples", "skills/sumi/examples"]
    .flatMap((base) =>
      readdirSync(join(root, base), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .flatMap((entry) =>
          readdirSync(join(root, base, entry.name))
            .filter((name) => name.endsWith(".sumi.yaml"))
            .map((name) => `${base}/${entry.name}/${name}`),
        ),
    )
    .sort();
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
