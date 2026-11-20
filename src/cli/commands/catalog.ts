/**
 * `sumi catalog`: components, themes, profiles, icons, placement targets, sets and palettes. stdout: one
 * table per section, or with `--json` exactly `buildFullCatalog()`
 * (`{ version: 1, components?, themes?, profiles?, icons?, targets?, sets?, palettes? }`, see
 * `CATALOG_VERSION`). Exit 0.
 *
 * Sections: `--section <name>` (repeatable) selects them; without it, all
 * are printed — except with `--kind`, which filters components and,
 * without `--section`, prints only components (as before #37).
 *
 * `--icons <words>` (#94) lists the bundled icons whose name contains every
 * word (case-insensitive; `""` lists all) as `icon:` references, one per
 * line, or with `--json` `{ version, query, icons: ["tabler/…", …] }`. It
 * cannot be combined with `--section` or `--kind`.
 *
 * `--sizes` (#611) prints the default sizes of a structured figure instead:
 * per setting (profile, density, theme, text scale) the text sizes, line
 * widths, spacing and the natural size of each node component, from the same
 * code as the Skill's `references/sizes.md` (`defaultSizes()`). Without
 * `--profile` it prints paper-double, screen-doc and presentation-16x9 at the
 * theme's text scale for each. `--json` prints `{ version, settings: [...] }`;
 * `--css` (one `--profile`) prints the mockup template's size variables.
 */

import { InvalidArgumentError } from "commander";
import { type IconSetInfo, iconNames, iconSets } from "../../assets/icons";
import {
  buildFullCatalog,
  CATALOG_SECTIONS,
  type CatalogSection,
  type FullCatalog,
} from "../../core/catalog";
import type { ProfileCatalogEntry } from "../../core/profile/catalog";
import { builtinRegistry } from "../../core/registry/builtins";
import { CATALOG_VERSION, type CatalogEntry } from "../../core/registry/catalog";
import type { ComponentKind } from "../../core/registry/manifest";
import type { ThemeCatalogEntry } from "../../core/theme/catalog";
import {
  type ComponentSize,
  defaultSizes,
  fontFaceCss,
  SIZE_DENSITIES,
  SIZE_SETTINGS,
  type SizeDensity,
  SizeError,
  type SizeSetting,
  sizesCss,
} from "../../layout/structured/default-sizes";
import { type CliContext, EXIT, type ExitCode, UsageError } from "../io";

export interface CatalogCommandOptions {
  json?: boolean;
  /** `--icons <words>`: search the bundled icons instead of printing the catalog. */
  icons?: string;
  kind?: ComponentKind;
  /** `--section`, repeatable. */
  section?: CatalogSection[];
  /** `--sizes`: print the default sizes instead of the catalog (#611). */
  sizes?: boolean;
  /** `--css`: with `--sizes`, the mockup template's size variables. */
  css?: boolean;
  profile?: string;
  theme?: string;
  density?: SizeDensity;
  textScale?: number;
  /** `--label`, repeatable. */
  label?: string[];
  /** `--component`, repeatable. */
  component?: string[];
}

/** Parses `--text-scale`: a number (the figure schema checks the range and step). */
export function parseTextScale(value: string): number {
  const scale = Number(value);
  if (value.trim() === "" || !Number.isFinite(scale)) {
    throw new InvalidArgumentError("Expected a number, e.g. 1.5.");
  }
  return scale;
}

export const SIZE_DENSITY_CHOICES: readonly string[] = SIZE_DENSITIES;

/** Parses one `--section` value and appends it (repeatable option). */
export function collectSection(value: string, previous: CatalogSection[] = []): CatalogSection[] {
  if (!(CATALOG_SECTIONS as readonly string[]).includes(value)) {
    throw new InvalidArgumentError(`Allowed choices are ${CATALOG_SECTIONS.join(", ")}.`);
  }
  return previous.includes(value as CatalogSection)
    ? previous
    : [...previous, value as CatalogSection];
}

const SIZE_ONLY = [
  ["css", "--css"],
  ["profile", "--profile"],
  ["theme", "--theme"],
  ["density", "--density"],
  ["textScale", "--text-scale"],
  ["label", "--label"],
  ["component", "--component"],
] as const;

export function catalogCommand(options: CatalogCommandOptions, context: CliContext): ExitCode {
  if (options.sizes) return sizesCommand(options, context);
  const sizeOnly = SIZE_ONLY.filter(([key]) => options[key] !== undefined).map(([, flag]) => flag);
  if (sizeOnly.length > 0)
    throw new UsageError(
      `${sizeOnly.join(", ")} ${sizeOnly.length === 1 ? "needs" : "need"} --sizes.`,
    );
  if (options.icons !== undefined) {
    if (options.section !== undefined || options.kind !== undefined) {
      throw new UsageError("--icons cannot be combined with --section or --kind.");
    }
    const icons = searchIcons(options.icons);
    context.stdout.write(
      options.json
        ? `${JSON.stringify({ version: CATALOG_VERSION, query: options.icons, icons }, null, 2)}\n`
        : icons.map((ref) => `${ref}\n`).join(""),
    );
    return EXIT.ok;
  }
  const sections =
    options.section ??
    (options.kind === undefined ? [...CATALOG_SECTIONS] : (["components"] as CatalogSection[]));
  if (options.kind !== undefined && !sections.includes("components")) {
    throw new UsageError("--kind filters components; add --section components.");
  }
  const catalog = buildFullCatalog(builtinRegistry(), { sections, kind: options.kind });
  context.stdout.write(
    options.json ? `${JSON.stringify(catalog, null, 2)}\n` : formatCatalogText(catalog),
  );
  return EXIT.ok;
}

function sizesCommand(options: CatalogCommandOptions, context: CliContext): ExitCode {
  if (options.section !== undefined || options.kind !== undefined || options.icons !== undefined) {
    throw new UsageError("--sizes cannot be combined with --section, --kind or --icons.");
  }
  if (options.css && options.json) throw new UsageError("--css and --json cannot be combined.");
  if (options.css && options.profile === undefined) {
    throw new UsageError("--css needs one --profile.");
  }
  if (options.css && (options.component !== undefined || options.label !== undefined)) {
    throw new UsageError(
      "--css cannot be combined with --component or --label: its sizes are those of a one-word box.",
    );
  }
  const profiles =
    options.profile === undefined ? SIZE_SETTINGS.map((s) => s.profile) : [options.profile];
  let settings: SizeSetting[];
  try {
    settings = profiles.map((profile) =>
      defaultSizes({
        profile,
        ...(options.theme !== undefined && { theme: options.theme }),
        ...(options.density !== undefined && { density: options.density }),
        ...(options.textScale !== undefined && { textScale: options.textScale }),
        ...(options.label !== undefined && { labels: options.label }),
        ...(options.component !== undefined && { components: options.component }),
        // The CSS needs no overflow search.
        ...(options.css === true && { minWidths: false }),
      }),
    );
  } catch (error) {
    if (error instanceof SizeError) throw new UsageError(error.message);
    throw error;
  }
  const [first] = settings;
  if (options.css && first !== undefined) {
    context.stdout.write(`${fontFaceCss(first.text.fontSet)}${sizesCss(first)}`);
  } else if (options.json) {
    context.stdout.write(`${JSON.stringify({ version: CATALOG_VERSION, settings }, null, 2)}\n`);
  } else {
    context.stdout.write(settings.map(formatSizesText).join("\n"));
  }
  return EXIT.ok;
}

const propsText = (props: Record<string, string> | null) =>
  props === null
    ? "-"
    : Object.entries(props)
        .map(([key, value]) => `${key}: ${value}`)
        .join(", ");

const sizeText = (size: ComponentSize) => [`${size.width.mm}mm`, `${size.height.mm}mm`];

/** One setting of `--sizes`: its text, lines and spacing, then one row per measured node. */
export function formatSizesText(setting: SizeSetting): string {
  const { text, lines, spacing } = setting;
  const header = [
    `${setting.profile}, density ${setting.density}, theme ${setting.theme}, textScale ${setting.textScale}`,
    `  Text: node ${text.nodePt}pt, group ${text.groupPt}pt, edge ${text.edgePt}pt (profile minimum ${text.minPt}pt; font set ${text.fontSet})`,
    `  Lines: node ${lines.nodePt}pt, group ${lines.groupPt}pt, edge ${lines.edgePt}pt; corner radius ${setting.radiusPt}pt`,
    `  Spacing: gap ${spacing.gap.mm}mm, group padding ${spacing.groupPadding.pt}pt (${spacing.groupPadding.mm}mm) each side, node padding ${spacing.nodePaddingX.pt}pt left/right and ${spacing.nodePaddingY.pt}pt top/bottom, margin ${spacing.margin.mm}mm, max width ${spacing.maxWidth === null ? "none" : `${spacing.maxWidth.mm}mm`}`,
  ];
  const table = formatTable(
    ["COMPONENT", "WIDTH", "HEIGHT", "MIN WIDTH", "PROPS", "LABEL"],
    setting.components.map((size) => [
      size.component,
      ...sizeText(size),
      size.minWidth === null ? "-" : `${size.minWidth.mm}mm`,
      propsText(size.props),
      size.label === null ? "(no label)" : JSON.stringify(size.label),
    ]),
  );
  const byProps =
    setting.sizedByProps.length === 0
      ? ""
      : `Sized by their props, not by a label (see sumi catalog): ${setting.sizedByProps.join(", ")}\n`;
  const note =
    "WIDTH × HEIGHT: the natural size (label plus padding). MIN WIDTH: the narrowest props.width that passes geometry/label-overflow.\n";
  return `${header.join("\n")}\n${table}${note}${byProps}`;
}

/** The human-readable catalog: one table per section, titled when there are several. */
export function formatCatalogText(catalog: FullCatalog): string {
  const tables: [string, string][] = [];
  if (catalog.components) tables.push(["Components", formatCatalogTable(catalog.components)]);
  if (catalog.themes) tables.push(["Themes", formatThemeTable(catalog.themes)]);
  if (catalog.profiles) tables.push(["Profiles", formatProfileTable(catalog.profiles)]);
  if (catalog.icons) tables.push(["Icons", formatIconTable(catalog.icons)]);
  if (catalog.targets) {
    tables.push([
      "Targets",
      `${catalog.targets.path}: ${catalog.targets.description}\n${formatTable(
        ["FIELD", "DESCRIPTION"],
        Object.entries(catalog.targets.schema.properties ?? {}).map(([name, schema]) => [
          name,
          typeof schema === "object" ? (schema.description ?? "") : "",
        ]),
      )}`,
    ]);
  }
  if (catalog.sets) {
    tables.push([
      "Sets",
      `${catalog.sets.path}: ${catalog.sets.description}\n${formatTable(
        ["FIELD", "DESCRIPTION"],
        Object.entries(catalog.sets.schema.properties ?? {}).map(([name, schema]) => [
          name,
          typeof schema === "object" ? (schema.description ?? "") : "",
        ]),
      )}`,
    ]);
  }
  if (catalog.palettes) {
    tables.push([
      "Palettes",
      `${catalog.palettes.path}: ${catalog.palettes.description} Source: ${catalog.palettes.source}.\n${formatTable(
        ["ID", "PANEL", "TINT", "ACCENT", "INK", "MUTED", "STRONG", "DESCRIPTION"],
        catalog.palettes.palettes.map((p) => [
          p.id,
          p.roles.panel,
          p.roles.tint,
          p.roles.accent,
          p.roles.ink,
          p.roles.muted,
          p.roles.strong,
          `${p.description} (colors ${p.colors.join(" ")})`,
        ]),
      )}`,
    ]);
  }
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

/** The profiles a theme meets, then those it meets with `themeOverrides.textScale` (#514). */
function profileCell(entry: ThemeCatalogEntry): string {
  const scaled = Object.entries(entry.textScaleFor).map(([id, scale]) => `${id} x${scale}`);
  const plain = entry.compatibleProfiles.join(",") || "-";
  return scaled.length === 0 ? plain : `${plain}; with textScale: ${scaled.join(", ")}`;
}

/** One row per theme: ID, font sizes, font set, compatible profiles and description; then the themes' color guidance (#513). */
export function formatThemeTable(entries: readonly ThemeCatalogEntry[]): string {
  const table = formatTable(
    ["ID", "FONT SIZE", "FONTS", "PROFILES", "DESCRIPTION"],
    entries.map((entry) => {
      const { min, max } = entry.fontSizePt;
      const missing = Object.values(entry.missingVariants).flat().length;
      return [
        entry.id,
        min === max ? `${min}pt` : `${min}-${max}pt`,
        entry.fonts.id,
        profileCell(entry),
        `${entry.description ?? ""}${missing === 0 ? "" : ` (${missing} variants unstyled)`}`,
      ];
    }),
  );
  const guided = entries.filter((entry) => entry.colorUse !== null);
  if (guided.length === 0) return table;
  const lines = guided.map(({ id, colorUse }) => {
    const use = colorUse as NonNullable<typeof colorUse>;
    return `  ${id}: gray base, at most ${use.maxAccentTones} accent tones; prefer ${use.preferredVariants.join(", ")}; ${use.heavyVariants.join("/")} with a tone on at most ${Math.round(use.maxHeavyShare * 100)}% of the node area; ${use.maxSolidNodes === 0 ? "no" : `at most ${use.maxSolidNodes}`} solid node with a tone`;
  });
  return `${table}\nColor use (geometry/theme-color-use):\n${lines.join("\n")}`;
}

/** One row per profile: ID, page limits, minimum font size, spacing and description. */
export function formatProfileTable(entries: readonly ProfileCatalogEntry[]): string {
  return formatTable(
    ["ID", "MAX WIDTH", "MAX HEIGHT", "MIN FONT", "MARGIN/GAP/PADDING", "DESCRIPTION"],
    entries.map((entry) => [
      entry.id,
      entry.page.maxWidth?.written ?? "-",
      entry.page.maxHeight?.written ?? "-",
      entry.typography.minScaledFontSize === undefined
        ? entry.typography.minFontSize.written
        : `${entry.typography.minFontSize.written} (scaled ${entry.typography.minScaledFontSize.written})`,
      [entry.margin, entry.layout.layerGap, entry.layout.containerPadding]
        .map((length) => length.written)
        .join("/"),
      entry.description,
    ]),
  );
}

/** One row per bundled icon set: ID, version, license, count and what is bundled. */
export function formatIconTable(entries: readonly IconSetInfo[]): string {
  return formatTable(
    ["ID", "VERSION", "LICENSE", "ICONS", "DESCRIPTION"],
    entries.map((e) => [
      e.id,
      e.version,
      e.license,
      String(e.count),
      `${e.name}: ${e.contents} (${e.source}); find names with --icons <words>`,
    ]),
  );
}

/** `icon:` references (`<set>/<name>`) of the bundled icons whose name contains every word. */
export function searchIcons(query: string): string[] {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w !== "");
  return iconSets().flatMap((set) =>
    iconNames(set.id)
      .filter((name) => words.every((w) => name.includes(w)))
      .map((name) => `${set.id}/${name}`),
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
