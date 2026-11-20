/**
 * The Skill's table of default sizes (#607, `skills/sumi/references/sizes.md`)
 * is generated from the layout engine and the profiles
 * (`defaultSizesMarkdown()`); this keeps it in sync. Rewrite it with
 * `SUMI_UPDATE_GOLDEN=1 bun run test src/cli/skill-sizes.test.ts`.
 */
import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { defaultSizesMarkdown } from "../layout/structured/default-sizes";

const FILE = join(resolve(import.meta.dir, "..", ".."), "skills/sumi/references/sizes.md");
const BEGIN = "<!-- BEGIN GENERATED SIZES -->\n";
const END = "<!-- END GENERATED SIZES -->";

test("the Skill's size tables match the code (#607)", () => {
  const text = readFileSync(FILE, "utf8");
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const generated = defaultSizesMarkdown();
  const updated = `${text.slice(0, start + BEGIN.length)}${generated}${text.slice(end)}`;
  if (process.env.SUMI_UPDATE_GOLDEN === "1") writeFileSync(FILE, updated);
  expect(text).toBe(updated);
});
