import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { COMMIT_TYPES, checkTitle } from "./rules";

function problemsOf(title: string): string[] {
  const result = checkTitle(title);
  if (result.ok) throw new Error(`expected "${title}" to fail`);
  return result.problems;
}

describe("checkTitle accepts", () => {
  // The examples in CONTRIBUTING.md, real titles from this repository, and
  // summaries that must not be mistaken for violations.
  const valid = [
    "feat(registry): add component manifest loader",
    "fix(compiler): handle missing edge targets",
    "docs: describe output profile options",
    "test(lint): cover duplicate node ids",
    "ci: run typecheck on pull requests",
    "feat(schema)!: rename `nodes` to `elements`",
    "feat!: drop the v0 figure format",
    "feat(gallery): add a component gallery and generic examples (#38)",
    "fix(svg): handle SVG output from D2 v0.9",
    "build: bump D2 to 0.9.1",
    "chore: 2 small cleanups",
    "fix(cli): `sumi fmt` keeps comments",
    "feat(theme): support café → naïve labels × 2",
    "refactor(core/figure): split validate.ts",
    "perf(d2): reuse the temp dir",
  ];
  for (const title of valid) {
    test(title, () => {
      expect(checkTitle(title).ok).toBe(true);
    });
  }

  test("every documented type", () => {
    for (const type of COMMIT_TYPES) expect(checkTitle(`${type}: do it`).ok).toBe(true);
  });

  test("parses type, scope, breaking and summary", () => {
    expect(checkTitle("feat(schema)!: rename nodes")).toEqual({
      ok: true,
      value: { type: "feat", scope: "schema", breaking: true, summary: "rename nodes" },
    });
    expect(checkTitle("docs: x")).toEqual({
      ok: true,
      value: { type: "docs", breaking: false, summary: "x" },
    });
  });
});

describe("checkTitle rejects", () => {
  const invalid: [title: string, problem: string][] = [
    ["", "empty"],
    ["   ", "empty"],
    ["Add a release workflow", "Missing `<type>: ` prefix"],
    ["feat add a thing", "Missing `<type>: ` prefix"],
    ["feat!(cli): add a thing", "Missing `<type>: ` prefix"],
    ["style: format files", "Use `chore`"],
    ["feature(cli): add a thing", "Use `feat`"],
    ["Feat(cli): add a thing", "Use lowercase `feat`"],
    ["wip: something", "Unknown type `wip`"],
    ["feat(): add a thing", "The scope is empty"],
    ["feat( ): add a thing", "The scope is empty"],
    ["feat(CLI): add a thing", "Invalid scope `CLI`"],
    ["feat(cli d2): add a thing", "Invalid scope"],
    ["feat:add a thing", "exactly one space"],
    ["feat(cli):  add a thing", "exactly one space"],
    ["feat(cli):", "summary after the colon is empty"],
    ["feat(cli): ", "summary after the colon is empty"],
    ["feat(cli): Add a thing", "Start the summary in lowercase (`add`, not `Add`)"],
    ["feat(cli): add a thing.", "Remove the period"],
    [" feat(cli): add a thing", "leading or trailing whitespace"],
    ["feat(cli): add a thing ", "leading or trailing whitespace"],
    ["feat(cli): add a thing\n\nbody", "single line"],
    ["feat(cli): 図の描画を追加", "Write the title in English"],
    ["feat(cli): add ｆｕｌｌ-width text", "Write the title in English"],
    ["fix: カタカナ", "Write the title in English"],
  ];
  for (const [title, problem] of invalid) {
    test(JSON.stringify(title), () => {
      expect(problemsOf(title).join("\n")).toContain(problem);
    });
  }

  test("reports every problem at once", () => {
    // Japanese, type, empty scope, spacing, capitalized summary, final period.
    expect(problemsOf("Feature():Add 機能.")).toHaveLength(6);
  });
});

describe("scripts/commitlint.ts", () => {
  const script = join(import.meta.dir, "..", "commitlint.ts");
  const run = (args: string[]) =>
    Bun.spawnSync([process.execPath, script, ...args], { stdout: "pipe", stderr: "pipe" });

  test("--title exits 0 for a valid title and 1 with the problems otherwise", () => {
    expect(run(["--title", "ci: add a PR title check"]).exitCode).toBe(0);
    const bad = run(["--title", "Add a PR title check"]);
    expect(bad.exitCode).toBe(1);
    expect(bad.stderr.toString()).toContain("Missing `<type>: ` prefix");
  });

  test("a revision range checks each commit subject", () => {
    const empty = run(["HEAD..HEAD"]);
    expect(empty.exitCode).toBe(0);
    expect(empty.stdout.toString()).toContain("No commits in HEAD..HEAD.");
    expect(run(["no-such-revision..HEAD"]).exitCode).toBe(2);
  });

  test("usage errors exit 2", () => {
    expect(run([]).exitCode).toBe(2);
    expect(run(["--title"]).exitCode).toBe(2);
    expect(run(["--bogus"]).exitCode).toBe(2);
  });
});
