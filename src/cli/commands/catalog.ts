/**
 * `sumi catalog`: the available components. stdout: a table, or with `--json`
 * exactly `buildCatalog()` (versioned, see `CATALOG_VERSION`). Exit 0.
 */

import { createBuiltinRegistry } from "../../core/registry/builtins";
import { buildCatalog, type CatalogEntry } from "../../core/registry/catalog";
import type { ComponentKind } from "../../core/registry/manifest";
import { type CliContext, EXIT, type ExitCode } from "../io";

export interface CatalogCommandOptions {
  json?: boolean;
  kind?: ComponentKind;
}

export function catalogCommand(options: CatalogCommandOptions, context: CliContext): ExitCode {
  const catalog = buildCatalog(createBuiltinRegistry(), { kind: options.kind });
  context.stdout.write(
    options.json ? `${JSON.stringify(catalog, null, 2)}\n` : formatCatalogTable(catalog.components),
  );
  return EXIT.ok;
}

/** One row per component: ID, kind, variants and description (deprecations noted). */
export function formatCatalogTable(entries: readonly CatalogEntry[]): string {
  const header = ["ID", "KIND", "VARIANTS", "DESCRIPTION"];
  const rows = entries.map((entry) => {
    const deprecated =
      entry.deprecated === undefined
        ? ""
        : ` (deprecated since ${entry.deprecated.since}${entry.deprecated.replacement === undefined ? "" : `; use ${entry.deprecated.replacement}`})`;
    return [entry.id, entry.kind, entry.variants.join(","), `${entry.description}${deprecated}`];
  });
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => row[i]?.length ?? 0)),
  );
  const line = (cells: string[]) =>
    cells
      .map((cell, i) => (i === cells.length - 1 ? cell : cell.padEnd(widths[i] ?? 0)))
      .join("  ");
  return `${[header, ...rows].map(line).join("\n")}\n`;
}
