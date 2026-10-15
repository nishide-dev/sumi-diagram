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
import {
  accessSync,
  constants,
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { checkD2Version, findD2Binary } from "../backends/d2/binary";
import { buildFullCatalog } from "../core/catalog";
import { BUILTIN_PROFILES } from "../core/profile/builtin";
import { createBuiltinRegistry } from "../core/registry/builtins";
import { BUILTIN_THEMES } from "../core/theme/builtin";
import { BUILTIN_FONT_SETS } from "../core/theme/fonts";
import { lintRenderedFigure } from "../lint/geometry";
import { lintFigure } from "../lint/lint";
import { toSize } from "../render/geometry";
import { outputSize } from "../render/size";
import { parseXml } from "../render/xml";

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

  test("documented catalog entries are exactly what `sumi catalog --json` prints", () => {
    const catalog = buildFullCatalog(createBuiltinRegistry());
    const documented = blocks
      .filter((b) => b.lang === "json")
      .map((b) => JSON.parse(b.body) as Record<string, unknown>)
      .filter((json) => "themes" in json || "profiles" in json);
    expect(documented.length).toBeGreaterThan(0);
    for (const json of documented) {
      expect(json.version).toBe(catalog.version);
      for (const section of ["themes", "profiles"] as const) {
        for (const entry of (json[section] ?? []) as { id: string }[]) {
          expect(entry).toEqual(catalog[section]?.find((e) => e.id === entry.id) as never);
        }
      }
    }
  });

  test("the documented `size` of render --json has the CLI's shape", () => {
    const shape = (value: unknown): unknown =>
      value === null || typeof value !== "object"
        ? value === null
          ? "null"
          : typeof value
        : Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v)]));
    const sizes = blocks
      .filter((b) => b.lang === "json")
      .map((b) => JSON.parse(b.body) as Record<string, unknown>)
      .filter((json) => "size" in json)
      .map((json) => json.size);
    expect(sizes.length).toBeGreaterThan(0);
    const actual = outputSize({
      canvas: {
        viewBox: { x: 0, y: 0, width: 2, height: 2 },
        width: toSize(2),
        height: toSize(2),
      },
      profile: { id: "p", maxWidthPt: 10, maxHeightPt: 10, minFontSizePt: 7 },
    });
    for (const size of sizes) expect(shape(size)).toEqual(shape(actual));
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

/** Runs a skill script from a fresh temporary directory outside the repository. */
async function runScript(
  script: string,
  args: string[],
  env: Record<string, string | undefined> = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const cwd = await mkdtemp(join(tmpdir(), "sumi-skill-"));
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...process.env, NO_COLOR: "1", ...env })) {
    if (value !== undefined) merged[key] = value;
  }
  try {
    const proc = Bun.spawnSync([join(SKILL_DIR, "scripts", script), ...args], {
      cwd,
      env: merged,
    });
    return {
      exitCode: proc.exitCode,
      stdout: proc.stdout.toString(),
      stderr: proc.stderr.toString(),
    };
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

interface DoctorCheck {
  id: string;
  status: string;
  message: string;
  details?: { path?: string; source?: string };
}

function d2Check(stdout: string): DoctorCheck | undefined {
  const report = JSON.parse(stdout) as { checks: DoctorCheck[] };
  return report.checks.find((c) => c.id === "d2");
}

const MANAGED_D2 = join(ROOT, ".sumi", "bin", "d2");

describe("scripts/sumi", () => {
  test("runs the CLI from any directory", async () => {
    const run = await runScript("sumi", ["catalog", "--json"]);
    expect(run.exitCode).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual(buildFullCatalog(createBuiltinRegistry()));
  });

  // Needs the managed D2 (`bun run d2:install`); required in CI.
  test.skipIf(!existsSync(MANAGED_D2) && !process.env.CI)(
    "defaults SUMI_D2_PATH to the repository's managed D2",
    async () => {
      const run = await runScript("sumi", ["doctor", "--json"], { SUMI_D2_PATH: undefined });
      expect(d2Check(run.stdout)).toMatchObject({
        status: "ok",
        details: { path: MANAGED_D2, source: "env" },
      });
    },
  );

  test("keeps an explicit SUMI_D2_PATH", async () => {
    const explicit = join(tmpdir(), "sumi-skill-no-such-dir", "d2");
    const run = await runScript("sumi", ["doctor", "--json"], { SUMI_D2_PATH: explicit });
    expect(run.exitCode).toBe(1);
    const check = d2Check(run.stdout);
    expect(check?.status).toBe("error");
    expect(check?.message).toContain(explicit);
  });
});

/**
 * `scripts/preview` with a stand-in `qlmanage` first on PATH, so the test runs
 * on any platform: the stand-in records the wrapper SVG it is given and writes
 * a dummy PNG, or fails when FAKE_QL_FAIL is set.
 */
describe("scripts/preview", () => {
  async function withFakeQuickLook(
    fn: (env: Record<string, string>, dirs: { work: string; tmp: string }) => Promise<void>,
  ) {
    const work = await mkdtemp(join(tmpdir(), "sumi-preview-test-"));
    const bin = join(work, "bin");
    const tmp = join(work, "tmp");
    await mkdir(bin);
    await mkdir(tmp);
    await writeFile(
      join(bin, "qlmanage"),
      [
        "#!/bin/sh",
        'if [ -n "$FAKE_QL_FAIL" ]; then exit 1; fi',
        'cp "$6" "$FAKE_QL_CAPTURE"',
        'printf png > "$5/$(basename "$6").png"',
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    try {
      await fn(
        {
          PATH: `${bin}:${process.env.PATH ?? ""}`,
          TMPDIR: tmp,
          FAKE_QL_CAPTURE: join(work, "wrapper.svg"),
        },
        { work, tmp },
      );
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }

  const XML_ENTITIES: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
  };
  const unescapeXml = (value: string) =>
    value.replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => XML_ENTITIES[name] ?? "");

  test("references the SVG by a well-formed file URL, whatever its path", async () => {
    await withFakeQuickLook(async (env, { work, tmp }) => {
      const dir = join(work, `R&D #1 "q" 'a' <b> 図 100%`);
      await mkdir(dir);
      const svg = join(dir, "fig#1 & 50%.svg");
      await writeFile(svg, "<svg xmlns='http://www.w3.org/2000/svg'/>");

      const run = await runScript("preview", [svg, "400"], env);
      expect(run.stderr).toBe("");
      expect(run.exitCode).toBe(0);
      const png = run.stdout.trim();
      expect(png.endsWith("/fig#1 & 50%.png")).toBe(true);
      expect(dirname(dirname(png))).toBe(tmp);
      // Only the PNG is kept.
      expect(readdirSync(dirname(png))).toEqual(["fig#1 & 50%.png"]);

      const wrapper = readFileSync(env.FAKE_QL_CAPTURE ?? "", "utf8");
      expect(parseXml(wrapper).ok).toBe(true);
      const href = /<image href="([^"]*)"/.exec(wrapper)?.[1] ?? "";
      const url = new URL(unescapeXml(href));
      expect(url.protocol).toBe("file:");
      expect(url.hash).toBe("");
      expect(realpathSync(fileURLToPath(url))).toBe(realpathSync(svg));
    });
  });

  test("keeps the PNG of an input named like its intermediate file (figure.svg)", async () => {
    await withFakeQuickLook(async (env, { work }) => {
      const svg = join(work, "figure.svg");
      await writeFile(svg, "<svg xmlns='http://www.w3.org/2000/svg'/>");
      const run = await runScript("preview", [svg], env);
      expect(run.stderr).toBe("");
      expect(run.exitCode).toBe(0);
      const png = run.stdout.trim();
      expect(png.endsWith("/figure.png")).toBe(true);
      expect(readdirSync(dirname(png))).toEqual(["figure.png"]);
    });
  });

  test("leaves nothing behind when the converter fails", async () => {
    await withFakeQuickLook(async (env, { work, tmp }) => {
      const svg = join(work, "figure.svg");
      await writeFile(svg, "<svg xmlns='http://www.w3.org/2000/svg'/>");
      const run = await runScript("preview", [svg], { ...env, FAKE_QL_FAIL: "1" });
      expect(run.exitCode).not.toBe(0);
      expect(run.stdout).toBe("");
      expect(readdirSync(tmp)).toEqual([]);
    });
  });
});
