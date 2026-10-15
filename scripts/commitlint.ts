/**
 * Checks PR titles and commit subjects against CONTRIBUTING.md (#16); the
 * rules and what is not checked are listed in `scripts/commitlint/rules.ts`.
 *
 *   bun run commitlint --title "feat(cli): add doctor"   # one PR title
 *   bun run commitlint origin/main..HEAD                 # subjects of non-merge commits
 *
 * Exit 0 if everything passes, 1 if anything fails, 2 on usage errors. The
 * PR title workflow passes the title through the environment
 * (`--title "$PR_TITLE"`), never by interpolating it into the shell script.
 */

import { checkTitle } from "./commitlint/rules";

const USAGE = "Usage: bun scripts/commitlint.ts --title <title> | <git revision range>";

function report(label: string, title: string): boolean {
  const result = checkTitle(title);
  if (result.ok) {
    console.log(`ok    ${label}: ${title}`);
    return true;
  }
  console.error(`error ${label}: ${title}`);
  for (const problem of result.problems) console.error(`        - ${problem}`);
  return false;
}

const args = process.argv.slice(2);
let ok = true;
if (args[0] === "--title" && args.length === 2) {
  ok = report("title", args[1] ?? "");
} else if (args.length === 1 && args[0] !== undefined && !args[0].startsWith("-")) {
  const range = args[0];
  const log = Bun.spawnSync(["git", "log", "--no-merges", "--format=%h%x00%s", range, "--"], {
    stderr: "pipe",
  });
  if (log.exitCode !== 0) {
    console.error(`git log ${range} failed: ${log.stderr.toString().trim()}`);
    process.exit(2);
  }
  const lines = log.stdout.toString().split("\n").filter(Boolean);
  for (const line of lines) {
    const [hash = "", subject = ""] = line.split("\0");
    if (!report(hash, subject)) ok = false;
  }
  if (lines.length === 0) console.log(`No commits in ${range}.`);
} else {
  console.error(USAGE);
  process.exit(2);
}

if (!ok) {
  console.error("\nSee CONTRIBUTING.md (コミットメッセージ / Pull Request) for the rules.");
  process.exit(1);
}
