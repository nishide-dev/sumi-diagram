/**
 * Keeps the Claude Code Skill (`.claude/skills/sumi`, #15) honest: its
 * metadata is well formed, its links resolve, every component, theme,
 * profile and diagnostic code it names exists, and every complete figure in
 * it passes `sumi lint` (or fails with exactly the documented errors).
 * Figures marked `# expect-render:` are also rendered with the pinned D2 when
 * it is installed (required in CI) and geometry-linted: `fits` means no
 * diagnostics, `too-wide` exactly `geometry/exceeds-page-width`.
 */

import { describe, expect, test } from "bun:test";
import { accessSync, constants, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { checkD2Version, findD2Binary } from "../backends/d2/binary";
import { BUILTIN_PROFILES } from "../core/profile/builtin";
import { createBuiltinRegistry } from "../core/registry/builtins";
import { buildCatalog } from "../core/registry/catalog";
import { BUILTIN_THEMES } from "../core/theme/builtin";
import { BUILTIN_FONT_SETS } from "../core/theme/fonts";
import { lintRenderedFigure } from "../lint/geometry";
import { lintFigure } from "../lint/lint";

const ROOT = resolve(import.meta.dir, "..", "..");
const SKILL_DIR = join(ROOT, ".claude", "skills", "sumi");
const SKILL_MD = join(SKILL_DIR, "SKILL.md");

const STAGES = [
  "yaml",
  "schema",
  "ref",
  "component",
  "theme",
  "profile",
  "compile",
  "backend",
  "svg",
  "lint",
  "geometry",
];

function markdownFiles(): string[] {
  const references = join(SKILL_DIR, "references");
  return [
    SKILL_MD,
    ...readdirSync(references)
      .filter((name) => name.endsWith(".md"))
      .map((name) => join(references, name)),
  ];
}

const docs = markdownFiles().map((path) => ({
  path,
  name: path.slice(SKILL_DIR.length + 1),
  text: readFileSync(path, "utf8"),
}));

interface CodeBlock {
  doc: string;
  lang: string;
  body: string;
  line: number;
}

function codeBlocks(): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  for (const doc of docs) {
    const pattern = /^```(\w*)\n([\s\S]*?)^```$/gm;
    for (const match of doc.text.matchAll(pattern)) {
      const line = doc.text.slice(0, match.index).split("\n").length;
      blocks.push({ doc: doc.name, lang: match[1] ?? "", body: match[2] ?? "", line });
    }
  }
  return blocks;
}

const blocks = codeBlocks();

const binary = findD2Binary();
const d2Available = binary.ok && (await checkD2Version(binary.value.path)).ok;
/** A complete figure: a YAML block with a top-level `version: 1`. */
const figures = blocks.filter((b) => b.lang === "yaml" && /^version: 1$/m.test(b.body));

function marker(body: string, name: string): string | undefined {
  return new RegExp(`^# ${name}: (.+)$`, "m").exec(body)?.[1]?.trim();
}

/** Every `"<stage>/<rule>"` string literal in the non-test sources. */
function knownCodes(): Set<string> {
  const codes = new Set<string>();
  const literal = new RegExp(`"((?:${STAGES.join("|")})/[a-z0-9-]+)"`, "g");
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith(".ts") && !path.endsWith(".test.ts")) {
        for (const match of readFileSync(path, "utf8").matchAll(literal)) codes.add(match[1] ?? "");
      }
    }
  };
  walk(join(ROOT, "src"));
  return codes;
}

describe("skill metadata", () => {
  const text = readFileSync(SKILL_MD, "utf8");
  const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(text);

  test("SKILL.md has name and description frontmatter", () => {
    expect(frontmatter).not.toBeNull();
    const meta = parseYaml(frontmatter?.[1] ?? "") as Record<string, unknown>;
    expect(Object.keys(meta).sort()).toEqual(["description", "name"]);
    expect(meta.name).toBe("sumi");
    expect(typeof meta.description).toBe("string");
    const description = meta.description as string;
    expect(description.length).toBeGreaterThan(100);
    expect(description.length).toBeLessThanOrEqual(1024);
    expect(description).not.toMatch(/[<>]/);
  });

  test("SKILL.md body stays short (details belong in references/)", () => {
    const body = text.slice(frontmatter?.[0].length ?? 0);
    expect(body.split("\n").length).toBeLessThan(250);
  });

  test("helper scripts exist and are executable", () => {
    for (const script of ["sumi", "preview"]) {
      expect(() => accessSync(join(SKILL_DIR, "scripts", script), constants.X_OK)).not.toThrow();
    }
  });
});

describe("skill references", () => {
  test.each(docs.map((d) => [d.name, d] as const))("%s: relative links resolve", (_, doc) => {
    for (const match of doc.text.matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)) {
      const target = match[1] ?? "";
      if (/^[a-z]+:/.test(target)) continue;
      expect(existsSync(resolve(dirname(doc.path), target)), `${doc.name} → ${target}`).toBe(true);
    }
  });

  test("repository paths named in the docs exist", () => {
    for (const doc of docs) {
      for (const match of doc.text.matchAll(
        /`((?:schema|docs|examples|src)\/[^`\s]*(?:\.[a-z]+|\/))`/g,
      )) {
        expect(existsSync(join(ROOT, match[1] ?? "")), `${doc.name}: ${match[1]}`).toBe(true);
      }
    }
  });

  test("every `sumi/<name>` is a built-in component or font set", () => {
    const valid = new Set([
      ...createBuiltinRegistry()
        .list()
        .map((m) => `${m.namespace}/${m.name}`),
      ...BUILTIN_FONT_SETS.keys(),
    ]);
    for (const doc of docs) {
      for (const match of doc.text.matchAll(/(?<![.\w])sumi\/([a-z][a-z0-9-]*)/g)) {
        expect(valid.has(match[0]), `${doc.name}: ${match[0]}`).toBe(true);
      }
    }
  });

  test("every diagnostic code named in the docs exists", () => {
    const codes = knownCodes();
    const pattern = new RegExp(`\\b((?:${STAGES.join("|")})/[a-z0-9-]+)(?![\\w./-])`, "g");
    for (const doc of docs) {
      for (const match of doc.text.matchAll(pattern)) {
        const code = match[1] ?? "";
        expect(codes.has(code), `${doc.name}: ${code}`).toBe(true);
      }
    }
  });

  test("the theme and profile tables list exactly the built-ins", () => {
    const text = readFileSync(join(SKILL_DIR, "references", "figure-format.md"), "utf8");
    const rows = (header: string) =>
      [
        ...text.matchAll(
          new RegExp(`^\\| ${header} \\|[^\\n]*\\n\\|[- |]+\\|\\n((?:\\|.*\\n)+)`, "gm"),
        ),
      ]
        .flatMap((m) => (m[1] ?? "").trim().split("\n"))
        .map((row) => /^\| `([^`]+)`/.exec(row)?.[1]);
    expect(rows("Theme").sort()).toEqual([...BUILTIN_THEMES.keys()].sort());
    expect(rows("Profile").sort()).toEqual([...BUILTIN_PROFILES.keys()].sort());
  });

  test("themes and profiles in code blocks and CLI flags exist", () => {
    for (const block of blocks) {
      if (marker(block.body, "expect-error") !== undefined) continue;
      for (const match of block.body.matchAll(/(?:\btheme:|--theme)\s+([a-z][a-z0-9-]*)/g)) {
        expect(BUILTIN_THEMES.has(match[1] ?? ""), `${block.doc}:${block.line}`).toBe(true);
      }
      for (const match of block.body.matchAll(/(?:\bprofile:|--profile)\s+([a-z][a-z0-9-]*)/g)) {
        expect(BUILTIN_PROFILES.has(match[1] ?? ""), `${block.doc}:${block.line}`).toBe(true);
      }
    }
  });
});

describe("figures in the skill", () => {
  test("there are complete figures, including failure examples", () => {
    expect(figures.length).toBeGreaterThanOrEqual(4);
    expect(figures.some((f) => marker(f.body, "expect-error") !== undefined)).toBe(true);
  });

  test.each(figures.map((f) => [`${f.doc}:${f.line}`, f] as const))(
    "%s lints as documented",
    (_, figure) => {
      const report = lintFigure(figure.body, { file: `${figure.doc}:${figure.line}` });
      const expected = marker(figure.body, "expect-error");
      if (expected === undefined) {
        expect(report.diagnostics).toEqual([]);
      } else {
        const errors = report.diagnostics.filter((d) => d.severity === "error").map((d) => d.code);
        expect(errors.sort()).toEqual(expected.split(/,\s*/).sort());
      }
    },
  );

  const rendered = figures.filter((f) => marker(f.body, "expect-render") !== undefined);

  test
    .skipIf(!d2Available && !process.env.CI)
    .each(rendered.map((f) => [`${f.doc}:${f.line}`, f] as const))(
    "%s renders with the documented geometry",
    async (_, figure) => {
      const report = await lintRenderedFigure(figure.body);
      expect(report.rendered).toBeDefined();
      const codes = report.diagnostics.map((d) => d.code);
      const expected = marker(figure.body, "expect-render");
      expect(codes).toEqual(expected === "fits" ? [] : ["geometry/exceeds-page-width"]);
    },
  );
});

describe("CLI wrapper", () => {
  test("scripts/sumi runs the CLI from any directory", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "sumi-skill-"));
    try {
      const proc = Bun.spawnSync([join(SKILL_DIR, "scripts", "sumi"), "catalog", "--json"], {
        cwd,
        env: { ...process.env, NO_COLOR: "1" },
      });
      expect(proc.exitCode).toBe(0);
      expect(JSON.parse(proc.stdout.toString())).toEqual(buildCatalog(createBuiltinRegistry()));
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
