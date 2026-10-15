/**
 * `sumi catalog`: the available components, themes and profiles. stdout: one
 * table per section, or with `--json` exactly `buildFullCatalog()`
 * (`{ version: 1, components?, themes?, profiles? }`, see
 * `CATALOG_VERSION`). Exit 0.
 *
 * Sections: `--section <name>` (repeatable) selects them; without it, all
 * three are printed — except with `--kind`, which filters components and,
 * without `--section`, prints only components (as before #37).
 */

import { InvalidArgumentError } from "commander";
import {
  buildFullCatalog,
  CATALOG_SECTIONS,
  type CatalogSection,
  type FullCatalog,
} from "../../core/catalog";
import type { ProfileCatalogEntry } from "../../core/profile/catalog";
import { createBuiltinRegistry } from "../../core/registry/builtins";
import type { CatalogEntry } from "../../core/registry/catalog";
import type { ComponentKind } from "../../core/registry/manifest";
import type { ThemeCatalogEntry } from "../../core/theme/catalog";
import { type CliContext, EXIT, type ExitCode, UsageError } from "../io";

export interface CatalogCommandOptions {
  json?: boolean;
  kind?: ComponentKind;
  /** `--section`, repeatable. */
  section?: CatalogSection[];
}

/** Parses one `--section` value and appends it (repeatable option). */
export function collectSection(value: string, previous: CatalogSection[] = []): CatalogSection[] {
  if (!(CATALOG_SECTIONS as readonly string[]).includes(value)) {
    throw new InvalidArgumentError(`Allowed choices are ${CATALOG_SECTIONS.join(", ")}.`);
  }
  return previous.includes(value as CatalogSection)
    ? previous
    : [...previous, value as CatalogSection];
}

export function catalogCommand(options: CatalogCommandOptions, context: CliContext): ExitCode {
  const sections =
    options.section ??
    (options.kind === undefined ? [...CATALOG_SECTIONS] : (["components"] as CatalogSection[]));
  if (options.kind !== undefined && !sections.includes("components")) {
    throw new UsageError("--kind filters components; add --section components.");
  }
  const catalog = buildFullCatalog(createBuiltinRegistry(), { sections, kind: options.kind });
  context.stdout.write(
    options.json ? `${JSON.stringify(catalog, null, 2)}\n` : formatCatalogText(catalog),
  );
  return EXIT.ok;
}

/** The human-readable catalog: one table per section, titled when there are several. */
export function formatCatalogText(catalog: FullCatalog): string {
  const tables: [string, string][] = [];
  if (catalog.components) tables.push(["Components", formatCatalogTable(catalog.components)]);
  if (catalog.themes) tables.push(["Themes", formatThemeTable(catalog.themes)]);
  if (catalog.profiles) tables.push(["Profiles", formatProfileTable(catalog.profiles)]);
  if (tables.length === 1) return tables[0]?.[1] ?? "";
  return tables.map(([title, table]) => `${title}:\n${table}`).join("\n");
}

/** One row per component: ID, kind, variants and description (deprecations noted). */
export function formatCatalogTable(entries: readonly CatalogEntry[]): string {
  return formatTable(
    ["ID", "KIND", "VARIANTS", "DESCRIPTION"],
    entries.map((entry) => {
      const deprecated =
        entry.deprecated === undefined
          ? ""
          : ` (deprecated since ${entry.deprecated.since}${entry.deprecated.replacement === undefined ? "" : `; use ${entry.deprecated.replacement}`})`;
      return [entry.id, entry.kind, entry.variants.join(","), `${entry.description}${deprecated}`];
    }),
  );
}

/** One row per theme: ID, font sizes, font set, compatible profiles and description. */
export function formatThemeTable(entries: readonly ThemeCatalogEntry[]): string {
  return formatTable(
    ["ID", "FONT SIZE", "FONTS", "PROFILES", "DESCRIPTION"],
    entries.map((entry) => {
      const { min, max } = entry.fontSizePt;
      const missing = Object.values(entry.missingVariants).flat().length;
      return [
        entry.id,
        min === max ? `${min}pt` : `${min}-${max}pt`,
        entry.fonts.id,
        entry.compatibleProfiles.join(",") || "-",
        `${entry.description ?? ""}${missing === 0 ? "" : ` (${missing} variants unstyled)`}`,
      ];
    }),
  );
}

/** One row per profile: ID, page limits, minimum font size, spacing and description. */
export function formatProfileTable(entries: readonly ProfileCatalogEntry[]): string {
  return formatTable(
    ["ID", "MAX WIDTH", "MAX HEIGHT", "MIN FONT", "MARGIN/GAP/PADDING", "DESCRIPTION"],
    entries.map((entry) => [
      entry.id,
      entry.page.maxWidth?.written ?? "-",
      entry.page.maxHeight?.written ?? "-",
      entry.typography.minFontSize.written,
      [entry.margin, entry.layout.layerGap, entry.layout.containerPadding]
        .map((length) => length.written)
        .join("/"),
      entry.description,
    ]),
  );
}

function formatTable(header: string[], rows: string[][]): string {
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => row[i]?.length ?? 0)),
  );
  const line = (cells: string[]) =>
    cells
      .map((cell, i) => (i === cells.length - 1 ? cell : cell.padEnd(widths[i] ?? 0)))
      .join("  ");
  return `${[header, ...rows].map(line).join("\n")}\n`;
}
