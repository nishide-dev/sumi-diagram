import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assignShards,
  DEFAULT_SHARDS,
  discoverTestFiles,
  durationsFromJunit,
  hashPath,
  isTestFile,
  verifyPartition,
} from "./test-shard";

const files = ["a.test.ts", "b.test.ts", "c.test.ts", "d.test.ts", "e.test.ts", "new.test.ts"];
const durations = {
  "a.test.ts": 100,
  "b.test.ts": 40,
  "c.test.ts": 40,
  "d.test.ts": 20,
  "e.test.ts": 1,
};

describe("assignShards", () => {
  test("covers every file exactly once", () => {
    for (const total of [1, 2, 3, 4, 7]) {
      verifyPartition(files, assignShards(files, durations, total));
    }
  });

  test("balances recorded durations (longest first onto the lightest shard)", () => {
    const shards = assignShards(files.slice(0, 5), durations, 2);
    expect(shards[0]).toEqual(["a.test.ts", "e.test.ts"]);
    expect(shards[1]).toEqual(["b.test.ts", "c.test.ts", "d.test.ts"]);
  });

  test("is deterministic and independent of the input order", () => {
    const reversed = [...files].reverse();
    expect(assignShards(reversed, durations, 3)).toEqual(assignShards(files, durations, 3));
  });

  test("places a file without a duration by a stable hash of its path", () => {
    const shards = assignShards(files, durations, 4);
    expect(shards[hashPath("new.test.ts") % 4]).toContain("new.test.ts");
    // Adding an unrecorded file leaves every other file where it was.
    const without = assignShards(
      files.filter((f) => f !== "new.test.ts"),
      durations,
      4,
    );
    for (let i = 0; i < 4; i++) {
      expect(shards[i]?.filter((f) => f !== "new.test.ts")).toEqual(without[i]);
    }
  });

  test("rejects an invalid shard count", () => {
    expect(() => assignShards(files, durations, 0)).toThrow();
  });
});

describe("verifyPartition", () => {
  test("detects a dropped file", () => {
    expect(() => verifyPartition(["a", "b"], [["a"], []])).toThrow("Not in any shard: b");
  });
  test("detects a duplicated file", () => {
    expect(() => verifyPartition(["a"], [["a"], ["a"]])).toThrow("shard 1 and shard 2");
  });
  test("detects a file that is not a test file", () => {
    expect(() => verifyPartition(["a"], [["a", "z"], []])).toThrow("Not a test file: z");
  });
});

describe("durationsFromJunit", () => {
  test("sums test case times per file and rounds to 0.1s", () => {
    const xml = `<testsuites>
<testcase name="x" classname="s" time="1.04" file="src/a.test.ts" line="1" />
<testcase name="y" classname="s" time="0.52" file="src/a.test.ts" line="2" />
<testcase name="z" classname="s" time="0.0001" file="src/b.test.ts" line="3" />
</testsuites>`;
    expect(durationsFromJunit(xml)).toEqual({ "src/a.test.ts": 1.6, "src/b.test.ts": 0.1 });
  });
});

describe("the repository", () => {
  test("every discovered test file is covered by the default shards", () => {
    const found = discoverTestFiles();
    expect(found).toContain("scripts/test-shard.test.ts");
    verifyPartition(found, assignShards(found, {}, DEFAULT_SHARDS));
  });

  test("the CI matrix runs exactly the shards the splitter is told about", async () => {
    const ci = await Bun.file(join(import.meta.dir, "..", ".github/workflows/ci.yml")).text();
    const total = Number(/^\s*TEST_SHARDS:\s*(\d+)\s*$/m.exec(ci)?.[1]);
    const matrix = /^\s*shard:\s*\[([^\]]*)\]/m.exec(ci)?.[1] ?? "";
    expect(total).toBe(DEFAULT_SHARDS);
    expect(matrix.split(",").map((s) => Number(s.trim()))).toEqual(
      Array.from({ length: total }, (_, i) => i + 1),
    );
  });
});

describe("discoverTestFiles", () => {
  test("finds what bun test runs: .test/_test/.spec/_spec and every JS/TS extension", () => {
    const root = mkdtempSync(join(tmpdir(), "shard-"));
    try {
      const make = (path: string) => {
        mkdirSync(join(root, path, ".."), { recursive: true });
        writeFileSync(join(root, path), "");
      };
      const runs = [
        "a_test.ts",
        "b_spec.ts",
        "c.test.mts",
        "d.spec.cts",
        "e.test.tsx",
        "sub/h.test.js",
      ];
      const skipped = [
        ".hid/f.test.ts",
        "node_modules/x/g.test.ts",
        "notest.ts",
        "i.test.json",
        "j-test.ts",
      ];
      for (const f of [...runs, ...skipped]) make(f);
      expect(discoverTestFiles(root)).toEqual([...runs].sort());
      expect(runs.every(isTestFile)).toBe(true);
      expect(skipped.some(isTestFile)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
