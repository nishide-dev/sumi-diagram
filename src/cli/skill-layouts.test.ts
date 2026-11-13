import { describe, expect, test } from "bun:test";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { formatFigureSource } from "../core/figure/format";
import { lintFigure, lintGeometry } from "../lint";
import { renderFigure } from "../render/render";

const LAYOUTS = join(resolve(import.meta.dir, "../.."), "skills/sumi/layouts");
const NAMES = readdirSync(LAYOUTS, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const read = (name: string, extension: string) =>
  readFileSync(join(LAYOUTS, name, `${name}.${extension}`), "utf8");

describe("Skill base layouts (#511)", () => {
  test("there are layouts, and the index lists exactly the directories", () => {
    expect(NAMES.length).toBeGreaterThanOrEqual(4);
    const index = readFileSync(join(LAYOUTS, "README.md"), "utf8");
    const listed = [...index.matchAll(/\]\(([a-z0-9-]+)\/\1\.sumi\.yaml\)/g)]
      .map((match) => match[1])
      .sort();
    expect(listed).toEqual(NAMES);
    for (const name of NAMES) expect(index).toContain(`(${name}/${name}.png)`);
  });

  test.each(NAMES)(
    "%s has real files and a header comment with purpose, use and changes",
    (name) => {
      expect(readdirSync(join(LAYOUTS, name)).sort()).toEqual(
        [`${name}.png`, `${name}.sumi.yaml`, `${name}.svg`].sort(),
      );
      for (const file of readdirSync(join(LAYOUTS, name))) {
        expect(lstatSync(join(LAYOUTS, name, file)).isSymbolicLink()).toBe(false);
      }
      const header = read(name, "sumi.yaml").split("\nversion:")[0] ?? "";
      for (const key of ["# Layout:", "# Use when:", "# Structure:", "# Change:", "# Lint:"]) {
        expect(header, key).toContain(key);
      }
      // Neutral content only: no author names or affiliations in a figure.
      expect(read(name, "sumi.yaml")).not.toMatch(/\b(univ|institute|laborator)/i);
    },
  );

  test.each(NAMES)("%s is fmt-clean", (name) => {
    const source = read(name, "sumi.yaml");
    const formatted = formatFigureSource(source);
    if (!formatted.ok) throw new Error(JSON.stringify(formatted.diagnostics));
    expect(formatted.changed).toBe(false);
  });

  test.each(NAMES)(
    "%s lints and renders with no errors or warnings, and the SVG is current",
    async (name) => {
      const source = read(name, "sumi.yaml");
      const file = `skills/sumi/layouts/${name}/${name}.sumi.yaml`;
      const lint = lintFigure(source, { file });
      expect(lint.summary.errors + lint.summary.warnings, JSON.stringify(lint.diagnostics)).toBe(0);
      const result = await renderFigure(source, { file, assetBase: join(LAYOUTS, name) });
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      const geometry = [...result.diagnostics, ...lintGeometry(result.value, { source, file })];
      const blocking = geometry.filter((d) => d.severity !== "info");
      expect(blocking, JSON.stringify(blocking)).toEqual([]);
      expect(result.value.svg).toBe(read(name, "svg"));
    },
  );
});
