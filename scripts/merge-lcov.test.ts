import { expect, test } from "bun:test";
import { type LineHits, lineTable, mergeLcov } from "./merge-lcov";

const shardA = "TN:\nSF:src/a.ts\nFNF:1\nFNH:1\nDA:1,3\nDA:2,0\nDA:3,0\nend_of_record\n";
const shardB =
  "TN:\nSF:src/a.ts\nDA:1,0\nDA:2,5\nDA:3,0\nend_of_record\nSF:src/b.ts\nDA:7,1\nend_of_record\n";

test("sums line hits across shard reports", () => {
  const hits: LineHits = new Map();
  mergeLcov(shardA, hits);
  mergeLcov(shardB, hits);
  expect([...(hits.get("src/a.ts") ?? [])]).toEqual([
    [1, 3],
    [2, 5],
    [3, 0],
  ]);
  expect(hits.get("src/b.ts")?.get(7)).toBe(1);
});

test("reports the merged percentage, not the shard-local one", () => {
  const hits: LineHits = new Map();
  mergeLcov(shardA, hits);
  mergeLcov(shardB, hits);
  const table = lineTable(hits);
  expect(table).toContain("src/a.ts");
  expect(table).toMatch(/src\/a\.ts\s+\|\s+66\.67/);
  expect(table).toMatch(/All files\s+\|\s+75\.00/);
});
