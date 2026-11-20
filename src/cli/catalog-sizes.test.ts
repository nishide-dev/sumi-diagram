/**
 * `sumi catalog --sizes` (#611): the default sizes from the same code as the
 * Skill's `references/sizes.md`, and the mockup template's size block.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  defaultSizes,
  SIZE_SETTINGS,
  type SizeSetting,
  sizesCss,
} from "../layout/structured/default-sizes";
import { run } from "./program";

const ROOT = resolve(import.meta.dir, "..", "..");
const SIZES_MD = join(ROOT, "skills/sumi/references/sizes.md");
const TEMPLATE = join(ROOT, "skills/sumi/references/mockup-template.html");

async function sumi(args: string[]) {
  let stdout = "";
  let stderr = "";
  const exitCode = await run(["catalog", ...args], {
    stdout: {
      write: (chunk: string) => {
        stdout += chunk;
      },
    },
    stderr: {
      write: (chunk: string) => {
        stderr += chunk;
      },
    },
    env: {},
  });
  return { exitCode, stdout, stderr };
}

async function sizesJson(args: string[]): Promise<SizeSetting[]> {
  const result = await sumi(["--sizes", "--json", ...args]);
  expect(result).toMatchObject({ exitCode: 0, stderr: "" });
  return JSON.parse(result.stdout).settings;
}

/** The node size table of sizes.md: component cell → one "W × H" cell per setting. */
function markdownSizes(): Map<string, string[]> {
  const text = readFileSync(SIZES_MD, "utf8");
  const table = text.slice(text.indexOf("### Node sizes"));
  const rows = new Map<string, string[]>();
  for (const line of table.split("\n")) {
    const cells = line.split(" | ");
    if (!line.startsWith("| `sumi/")) continue;
    rows.set(
      cells[0]?.slice(2) ?? "",
      cells.slice(1).map((c) => c.replace(/ \|$/, "")),
    );
  }
  return rows;
}

describe("sumi catalog --sizes", () => {
  test("by default prints the settings of sizes.md, with the same numbers (#611)", async () => {
    const settings = await sizesJson([]);
    expect(settings.map((s) => [s.profile, s.textScale, s.theme, s.density])).toEqual(
      SIZE_SETTINGS.map((s) => [s.profile, s.textScale, "sumi", "normal"]),
    );
    const rows = markdownSizes();
    expect(rows.size).toBeGreaterThan(20);
    for (const [index, setting] of settings.entries()) {
      for (const size of setting.components) {
        const note = size.props?.size === undefined ? "" : ` (\`size: ${size.props.size}\`)`;
        const cells = rows.get(`\`${size.component}\`${note}`);
        const unlabelled = size.label === null && size.props === null ? " (no label)" : "";
        expect(cells?.[index], size.component).toBe(
          `${size.width.mm}mm × ${size.height.mm}mm${unlabelled}`,
        );
      }
      const md = readFileSync(SIZES_MD, "utf8");
      for (const id of setting.sizedByProps) expect(md).toContain(`\`${id}\``);
    }
  });

  test("the spacing matches sizes.md's table for every profile and density", async () => {
    const md = readFileSync(SIZES_MD, "utf8");
    for (const profile of ["paper-single", "paper-double", "screen-doc", "presentation-16x9"]) {
      for (const density of ["normal", "compact"]) {
        const [setting] = await sizesJson([
          "--profile",
          profile,
          "--density",
          density,
          "--component",
          "box",
        ]);
        const s = setting?.spacing;
        if (s === undefined) throw new Error("no setting");
        expect(md).toContain(
          `| ${profile} | ${density} | ${s.gap.mm}mm | ${s.groupPadding.pt}pt (${s.groupPadding.mm}mm) |`,
        );
      }
    }
  });

  test("text sizes, lines and the operators follow the profile and the text scale", async () => {
    const [paper] = await sizesJson(["--profile", "paper-double"]);
    const [screen] = await sizesJson(["--profile", "screen-doc"]);
    expect(paper?.text).toMatchObject({ nodePt: 8, groupPt: 9, edgePt: 7, minPt: 7 });
    expect(screen?.textScale).toBe(1.5);
    expect(screen?.text).toMatchObject({ nodePt: 12, groupPt: 13.5, edgePt: 10.5, minPt: 10 });
    const op = (s: SizeSetting | undefined, size?: string) =>
      s?.components.find((c) => c.component === "sumi/operator" && c.props?.size === size)?.width
        .mm;
    expect([op(paper), op(paper, "large"), op(paper, "xlarge")]).toEqual([5.64, 8.47, 11.29]);
    const [big] = await sizesJson(["--profile", "paper-double", "--text-scale", "2"]);
    expect(big?.text.nodePt).toBe(16);
  });

  test("measures your own labels, so a narrower box predicts label-overflow", async () => {
    const [setting] = await sizesJson([
      "--profile",
      "paper-double",
      "--component",
      "box",
      "--component",
      "sumi/diamond",
      "--label",
      "Encoder",
      "--label",
      "Multi-Head Attention",
    ]);
    const box = setting?.components.filter((c) => c.component === "sumi/box") ?? [];
    expect(box.map((c) => c.label)).toEqual(["Encoder", "Multi-Head Attention"]);
    expect(box[0]?.width.mm).toBe(16.05);
    expect(box[1]?.width.mm ?? 0).toBeGreaterThan(30);
    expect(setting?.components.map((c) => c.component)).toEqual([
      "sumi/box",
      "sumi/box",
      "sumi/diamond",
      "sumi/diamond",
    ]);
  });

  test("compact density keeps the width and lowers a box", async () => {
    const [normal] = await sizesJson(["--profile", "paper-double", "--component", "box"]);
    const [compact] = await sizesJson([
      "--profile",
      "paper-double",
      "--density",
      "compact",
      "--component",
      "box",
    ]);
    expect(compact?.components[0]?.width.mm).toBe(normal?.components[0]?.width.mm as number);
    expect(compact?.components[0]?.height.mm ?? 99).toBeLessThan(
      normal?.components[0]?.height.mm ?? 0,
    );
  });

  test("the table names the setting, then one row per component", async () => {
    const result = await sumi(["--sizes", "--profile", "paper-double", "--theme", "minimal"]);
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(result.stdout).toStartWith("paper-double, density normal, theme minimal, textScale 1\n");
    expect(result.stdout).toContain("font set sumi/biz-ud-gothic");
    expect(result.stdout).toMatch(/^COMPONENT\s+WIDTH\s+HEIGHT\s+PROPS\s+LABEL$/m);
    expect(result.stdout).toMatch(/^sumi\/box\s+\d+(\.\d+)?mm\s+6mm\s+-\s+"Encoder"$/m);
    expect(result.stdout).toMatch(/^Sized by their props.*sumi\/matrix$/m);
  });

  test("--css prints @font-face rules and the template's size variables", async () => {
    const result = await sumi(["--sizes", "--css", "--profile", "paper-double"]);
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(result.stdout).toMatch(/^@font-face \{ font-family: "Sumi Latin"; src: url\("file:/m);
    const setting = defaultSizes({ profile: "paper-double" });
    expect(result.stdout).toEndWith(sizesCss(setting));
    expect(sizesCss(setting)).toContain("--op: 5.64mm;");
  });

  test("the mockup template's size block is the CLI's paper-double block (#611)", () => {
    const text = readFileSync(TEMPLATE, "utf8");
    const begin = "/* BEGIN SUMI SIZES */\n";
    const start = text.indexOf(begin) + begin.length;
    const end = text.indexOf("  /* END SUMI SIZES */");
    expect(start).toBeGreaterThan(begin.length);
    expect(text.slice(start, end)).toBe(sizesCss(defaultSizes({ profile: "paper-double" })));
    // Every size variable the template uses is one the CLI prints.
    const printed = new Set(
      [...sizesCss(defaultSizes({ profile: "screen-doc" })).matchAll(/^\s+(--[a-z-]+):/gm)].map(
        (m) => m[1],
      ),
    );
    const colours = new Set(["--canvas", "--ink", "--panel", "--arrow", "--pt"]);
    for (const [, name] of text.matchAll(/var\((--[a-z-]+)\)/g)) {
      if (name === undefined || colours.has(name) || /^--(blue|gray)/.test(name)) continue;
      expect(printed.has(name), name).toBe(true);
    }
  });

  test("rejects bad usage with exit 2 and prints nothing", async () => {
    for (const args of [
      ["--profile", "paper-double"],
      ["--css"],
      ["--sizes", "--section", "themes"],
      ["--sizes", "--css"],
      ["--sizes", "--css", "--json", "--profile", "paper-double"],
      ["--sizes", "--css", "--profile", "paper-double", "--component", "box"],
      ["--sizes", "--profile", "a4"],
      ["--sizes", "--theme", "nope"],
      ["--sizes", "--component", "nope"],
      ["--sizes", "--component", "separator"],
      ["--sizes", "--text-scale", "abc"],
      ["--sizes", "--text-scale", "9"],
      ["--sizes", "--density", "loose"],
    ]) {
      const result = await sumi(args);
      expect(result.exitCode, args.join(" ")).toBe(2);
      expect(result.stdout, args.join(" ")).toBe("");
      expect(result.stderr, args.join(" ")).not.toBe("");
    }
  });
});
