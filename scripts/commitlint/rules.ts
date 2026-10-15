/**
 * Checks a commit subject or PR title against the Conventional Commits rules
 * in CONTRIBUTING.md (#16). PR titles become the squash-merge commit, so both
 * use the same rules.
 *
 * Checked:
 * - the form `<type>(<scope>)!: <summary>`, with `(<scope>)` and `!` optional
 * - `<type>` is one of {@link COMMIT_TYPES} (lowercase; `style` is not used)
 * - `<scope>`, when present, is non-empty: lowercase letters, digits and
 *   `-` `_` `.` `/` (module names such as `cli`, `d2`, `lint`)
 * - exactly one space after the colon, and a non-empty summary
 * - the summary does not start with a capitalized word (`Add`), does not end
 *   with a period, and has no leading or trailing whitespace
 * - no Japanese (kana, CJK ideographs, full-width forms) anywhere: titles and
 *   commit messages are English
 *
 * Deliberately not checked, to avoid false positives: whether the text is
 * "really" English or in the imperative mood, its length, acronyms or code at
 * the start of the summary (`SVG`, `D2`, `` `sumi fmt` `` pass), and accented
 * Latin or symbols such as `→` and `×`.
 */

export const COMMIT_TYPES = [
  "feat",
  "fix",
  "docs",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "chore",
] as const;

export type CommitType = (typeof COMMIT_TYPES)[number];

export interface ParsedTitle {
  type: CommitType;
  scope?: string;
  breaking: boolean;
  summary: string;
}

export type TitleCheck = { ok: true; value: ParsedTitle } | { ok: false; problems: string[] };

/** Common non-standard types and the type CONTRIBUTING.md uses instead. */
const TYPE_ALIASES: Record<string, CommitType> = {
  feature: "feat",
  bugfix: "fix",
  doc: "docs",
  style: "chore",
  tests: "test",
  deps: "build",
};

const HEADER = /^(?<type>[^\s(!:]+)(?:\((?<scope>[^)]*)\))?(?<bang>!)?:(?<rest>.*)$/s;
const SCOPE = /^[a-z0-9][a-z0-9._/-]*$/;
/** Hiragana, katakana, CJK ideographs and symbols, half/full-width forms. */
const JAPANESE = /[　-ヿ㐀-䶿一-鿿豈-﫿＀-￯]/u;
const FORMAT = "Use `<type>(<scope>): <summary>` or `<type>: <summary>`.";

/** Checks one title or commit subject (the first line of a commit message). */
export function checkTitle(title: string): TitleCheck {
  const problems: string[] = [];
  if (title.trim() === "") return { ok: false, problems: [`The title is empty. ${FORMAT}`] };
  if (title.includes("\n")) problems.push("The title must be a single line.");
  if (title !== title.trim()) problems.push("Remove leading or trailing whitespace.");
  if (JAPANESE.test(title)) {
    problems.push("Write the title in English (Japanese text found); the body may be Japanese.");
  }

  const match = HEADER.exec(title.trim());
  if (match?.groups === undefined) {
    return { ok: false, problems: [...problems, `Missing \`<type>: \` prefix. ${FORMAT}`] };
  }
  const { type = "", scope, bang, rest = "" } = match.groups;

  const allowed = (COMMIT_TYPES as readonly string[]).includes(type);
  if (!allowed) {
    const alias = TYPE_ALIASES[type.toLowerCase()];
    const lower = type.toLowerCase();
    const hint =
      alias !== undefined
        ? ` Use \`${alias}\`.`
        : (COMMIT_TYPES as readonly string[]).includes(lower)
          ? ` Use lowercase \`${lower}\`.`
          : "";
    problems.push(`Unknown type \`${type}\`.${hint} Allowed: ${COMMIT_TYPES.join(", ")}.`);
  }
  if (scope !== undefined) {
    if (scope.trim() === "") {
      problems.push(
        "The scope is empty; write `feat: …` without parentheses instead of `feat(): …`.",
      );
    } else if (!SCOPE.test(scope)) {
      problems.push(
        `Invalid scope \`${scope}\`: use a short lowercase module name such as \`cli\` or \`d2\`.`,
      );
    }
  }

  if (!rest.startsWith(" ") || rest.startsWith("  ")) {
    problems.push("Put exactly one space after the colon.");
  }
  const summary = rest.trim();
  if (summary === "") {
    problems.push("The summary after the colon is empty.");
  } else {
    if (/^[A-Z][a-z]/.test(summary)) {
      const word = summary.split(" ")[0] ?? summary;
      problems.push(
        `Start the summary in lowercase (\`${word.toLowerCase()}\`, not \`${word}\`); acronyms such as SVG are fine.`,
      );
    }
    if (summary.endsWith(".")) problems.push("Remove the period at the end of the summary.");
  }

  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    value: {
      type: type as CommitType,
      ...(scope !== undefined && { scope }),
      breaking: bang !== undefined,
      summary,
    },
  };
}
