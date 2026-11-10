/**
 * What the component gallery (#17) renders: one sample figure per catalog
 * component showing every variant, the examples, and one figure compared
 * across themes and profiles. Pure: no D2, no file system writes.
 *
 * Everything is derived from `buildCatalog()` and the built-in theme and
 * profile maps, so a new component, variant, theme or profile appears in the
 * gallery without touching this file.
 */

import { BUILTIN_PROFILES } from "../../src/core/profile/builtin";
import { createBuiltinRegistry, FLOW_ARROW_IDS } from "../../src/core/registry/builtins";
import { buildCatalog, type CatalogEntry } from "../../src/core/registry/catalog";
import { BUILTIN_THEMES } from "../../src/core/theme/builtin";
import { PALETTE_NAMES } from "../../src/core/theme/palette";
import { TONE_NAMES } from "../../src/core/theme/tones";

/** Output directory of the gallery, relative to the repository root. */
export const GALLERY_DIR = "docs/gallery";

/** Profile of the component samples: wide enough for every sample. */
export const SAMPLE_PROFILE = "paper-double";

/**
 * Profile of a `slides` sample that shows more than three node or group
 * variants side by side (#174): `slides` text and lines are twice as large,
 * so such a row does not fit {@link SAMPLE_PROFILE}. It is the profile
 * `slides` is meant for. Samples with marks, images or a structured layout
 * keep {@link SAMPLE_PROFILE}.
 */
export const WIDE_SAMPLE_PROFILE = "presentation-16x9";

/** The profile a component's sample is rendered with under `theme`. */
export function sampleProfile(entry: CatalogEntry, theme: string): string {
  const row =
    (entry.kind === "group" ||
      (entry.kind === "node" && entry.mark === undefined && entry.embed === undefined)) &&
    entry.engines === undefined;
  return theme === "slides" && row && entry.variants.length > 3
    ? WIDE_SAMPLE_PROFILE
    : SAMPLE_PROFILE;
}

/**
 * The directory the `sumi/image` sample's files are read from (#94), relative
 * to the repository root: the self-made test images.
 */
export const SAMPLE_ASSET_DIR = "tests/fixtures/assets";

/** The example compared across every theme × profile. */
export const COMPARISON_EXAMPLE = "examples/pipeline/pipeline.sumi.yaml";

/**
 * The structured example compared across every theme (#264): the Transformer,
 * which uses stacks, rows, groups, attached notes, operators and shared trunks.
 */
export const THEME_COMPARISON_EXAMPLE = "examples/transformer/transformer.sumi.yaml";

/** Profile the structured theme comparison is drawn with (wide enough for every theme). */
export const THEME_COMPARISON_PROFILE = "paper-double";

export const THEMES: readonly string[] = [...BUILTIN_THEMES.keys()];
export const PROFILES: readonly string[] = [...BUILTIN_PROFILES.keys()];

/** One rendering of a source: the source as written, or with `--theme` / `--profile`. */
export interface Rendering {
  /** Output path relative to the repository root. */
  output: string;
  theme: string;
  profile: string;
  /** Overrides passed to the renderer (`sumi render --theme/--profile`); empty for the source as written. */
  overrides: { theme?: string; profile?: string };
}

export interface ComponentSample {
  entry: CatalogEntry;
  /** File name the snippet is shown under (not written to disk). */
  fileName: string;
  /** The `*.sumi.yaml` source of the sample. */
  source: string;
  /** One rendering per built-in theme; the first is the source as written. */
  renderings: Rendering[];
  /** Where image paths resolve (repository-relative), for a sample with images (#94). */
  assetBase?: string;
}

export interface ExampleEntry {
  /** Source path relative to the repository root. */
  source: string;
  /** The committed SVG next to the source. */
  rendering: Rendering;
}

export interface Comparison {
  source: string;
  /** theme × profile, themes outer. */
  renderings: Rendering[];
}

/** File-name stem of a component ID: `sumi/box` → `sumi-box`. */
export const componentStem = (entry: CatalogEntry): string => entry.id.replace("/", "-");

/**
 * The sample figure of a component: every variant once, labeled with its name.
 * Nodes stand alone, each group holds one `box`, and each edge connects its
 * own pair of `box` nodes. Laid out to the right.
 *
 * Marks take no label (#92), so a `box` named after the variant points at
 * each one: a glyph mark (`operator`) once per variant and once per glyph, a
 * point mark (`junction`) once per variant, branching to two boxes. An image
 * (#94) also takes no label: a `box` points at it once per variant, and once
 * per other fit and format ({@link SAMPLE_ASSET_DIR}).
 *
 * A component the auto engine cannot draw (manifest `engines`, #131) gets a
 * structured sample instead ({@link structuredSample}).
 */
export function sampleSource(entry: CatalogEntry, theme: string): string {
  if (entry.engines !== undefined && !entry.engines.includes("auto")) {
    return structuredSample(entry, theme);
  }
  const lines = [
    `# ${entry.id}: every variant. Generated by \`bun run gallery\` (#17).`,
    "version: 1",
    "figure:",
    `  id: gallery-${componentStem(entry)}`,
    `  title: ${entry.id}`,
    `  theme: ${theme}`,
    `  profile: ${SAMPLE_PROFILE}`,
    "  layout:",
    // Edges, marks and images are drawn as chains, one per row.
    `    direction: ${entry.kind === "edge" || (entry.kind === "node" && (entry.mark !== undefined || entry.embed !== undefined)) ? "right" : "down"}`,
  ];
  const variants = entry.variants;
  // Seven shape variants no longer fit in a single D2 row (#214).
  // An explicit two-row sample keeps every theme at its natural text size.
  if (
    entry.kind === "node" &&
    entry.mark === undefined &&
    entry.embed === undefined &&
    variants.includes("solid")
  ) {
    lines.splice(
      lines.length - 1,
      1,
      "    arrange:",
      "      stack:",
      "        items:",
      `          - row: { items: [${variants.slice(0, 4).join(", ")}] }`,
      `          - row: { items: [${variants.slice(4).join(", ")}] }`,
      ...(entry.id === "sumi/bowtie"
        ? [
            `          - row: { items: [${variants
              .slice(0, 4)
              .map((v) => `split-${v}`)
              .join(", ")}] }`,
            `          - row: { items: [${variants
              .slice(4)
              .map((v) => `split-${v}`)
              .join(", ")}] }`,
          ]
        : []),
      ...(entry.id === "sumi/trapezoid"
        ? ["north", "east", "west"].flatMap((side) => [
            `          - row: { items: [${variants
              .slice(0, 4)
              .map((v) => `${side}-${v}`)
              .join(", ")}] }`,
            `          - row: { items: [${variants
              .slice(4)
              .map((v) => `${side}-${v}`)
              .join(", ")}] }`,
          ])
        : []),
      ...(entry.id === "sumi/bubble"
        ? [
            "          - row: { items: [tail-left, tail-right, tail-top, tail-bottom] }",
            "          - row: { items: [english, japanese] }",
          ]
        : []),
    );
  }
  if (entry.kind === "node" && entry.embed !== undefined) {
    lines.push(...(entry.id === "sumi/html" ? htmlSample(entry) : imageSample(entry)));
    return `${lines.join("\n")}\n`;
  }
  if (entry.kind === "node" && entry.mark !== undefined) {
    lines.push(...markSample(entry, entry.mark));
    return `${lines.join("\n")}\n`;
  }
  switch (entry.kind) {
    case "node":
      lines.push("", "nodes:");
      for (const v of variants) {
        lines.push(`  - id: ${v}`, `    component: ${entry.id}`, `    label: ${v}`);
        if (v !== "default") lines.push(`    variant: ${v}`);
        if (entry.id === "sumi/waveform")
          lines.push(
            "    props:",
            "      samples: [0, 0.1, -0.3, 0.7, -1, 0.5, -0.8, 0.3, -0.1, 0]",
            `      mode: ${v === "outlined" ? "line" : "bars"}`,
          );
      }
      if (entry.id === "sumi/bowtie") {
        for (const v of variants)
          lines.push(
            `  - { id: split-${v}, component: bowtie, label: "${v === "filled" ? "filled" : "S"}", variant: ${v}, props: { gap: ${v === "filled" ? 8 : 64} } }`,
          );
      }
      if (entry.id === "sumi/trapezoid") {
        for (const narrow of ["north", "east", "west"])
          for (const v of variants)
            lines.push(
              `  - { id: ${narrow}-${v}, component: trapezoid, label: "${narrow}", variant: ${v}, props: { narrow: ${narrow}, width: 90pt, height: 44pt } }`,
            );
      }
      if (entry.id === "sumi/bubble") {
        for (const tail of ["left", "right", "top", "bottom"])
          lines.push(
            `  - { id: tail-${tail}, component: bubble, label: ${tail}, props: { tail: ${tail} } }`,
          );
        lines.push(
          '  - { id: english, component: bubble, label: "Messages wrap inside a chat bubble.", props: { tail: left, maxWidth: 120pt } }',
          '  - { id: japanese, component: bubble, variant: filled, label: "日本語の文章も吹き出しで折り返します。", props: { tail: right, maxWidth: 120pt } }',
        );
      }
      break;
    case "group": {
      // Six frames no longer fit in one row (#427): two explicit rows of three.
      const rows = variants.length > 5;
      if (rows) {
        const half = Math.ceil(variants.length / 2);
        lines.splice(
          lines.length - 1,
          1,
          "    arrange:",
          "      stack:",
          "        items:",
          `          - row: { items: [${variants.slice(0, half).join(", ")}] }`,
          `          - row: { items: [${variants.slice(half).join(", ")}] }`,
        );
      }
      lines.push("", "groups:");
      for (const v of variants) {
        lines.push(`  - id: ${v}`, `    component: ${entry.id}`, `    label: ${v}`);
        if (v !== "default") lines.push(`    variant: ${v}`);
        if (rows) lines.push(`    arrange: { row: { items: [${v}-member] } }`);
      }
      lines.push("", "nodes:");
      for (const v of variants) {
        lines.push(`  - id: ${v}-member`, "    component: box", "    label: member");
        if (!rows) lines.push(`    group: ${v}`);
      }
      break;
    }
    case "edge":
      lines.push("", "nodes:");
      for (const v of variants) {
        for (const end of ["a", "b"]) {
          lines.push(
            `  - id: ${v}-${end}`,
            "    component: box",
            `    label: ${end.toUpperCase()}`,
          );
        }
      }
      lines.push("", "edges:");
      for (const v of variants) {
        lines.push(`  - from: ${v}-a`, `    to: ${v}-b`, `    component: ${entry.id}`);
        lines.push(`    label: ${v}`);
        if (v !== "default") lines.push(`    variant: ${v}`);
      }
      break;
  }
  return `${lines.join("\n")}\n`;
}

/**
 * The structured sample of a component the auto engine cannot draw (#131).
 * `sumi/legend`: a short chain of nodes and edges, and below it one legend
 * per variant (titled with the variant) whose entries explain them.
 * `sumi/zoom` (#176): one row per variant, a block and to its right a
 * container titled with the variant that shows it enlarged.
 * `sumi/tokens` (#181): per variant, a box with edges into cells of a token
 * sequence below it, and a key cluster written as lines.
 * `sumi/matrix` (#180): per variant, a box with an edge into a mask with
 * toned headers and a hatched class, and a legend made from its classes.
 * Throws for
 * another component: a new structured-only component needs a sample here
 * (the gallery and its tests fail rather than leave it out).
 */
export function structuredSample(entry: CatalogEntry, theme: string): string {
  if (entry.id === "sumi/zoom") return zoomSample(entry, theme);
  if (entry.id === "sumi/tokens") return tokensSample(entry, theme);
  if (entry.id === "sumi/matrix") return matrixSample(entry, theme);
  if (entry.id === "sumi/bracket") return bracketSample(entry, theme);
  if (entry.id === "sumi/separator") return separatorSample(entry, theme);
  if (FLOW_ARROW_IDS.includes(entry.id)) return flowArrowSample(entry, theme);
  if (entry.id !== "sumi/legend") {
    throw new Error(`no structured gallery sample for ${entry.id}; add one to structuredSample()`);
  }
  const lines = [
    `# ${entry.id}: every variant. Generated by \`bun run gallery\` (#17, #131).`,
    "version: 1",
    "figure:",
    `  id: gallery-${componentStem(entry)}`,
    `  title: ${entry.id}`,
    `  theme: ${theme}`,
    `  profile: ${SAMPLE_PROFILE}`,
    "  layout:",
    "    arrange:",
    "      stack:",
    "        gap: 6mm",
    "        items:",
    "          - row: { gap: 8mm, align: center, items: [input, model, output] }",
    `          - row: { gap: 6mm, align: start, items: [${entry.variants.join(", ")}] }`,
    "",
    "nodes:",
    "  - id: input",
    "    component: box",
    "    label: input",
    "    tone: blue",
    "  - id: model",
    "    component: box",
    "    label: model",
    "  - id: output",
    "    component: box",
    "    label: output",
  ];
  for (const v of entry.variants) {
    lines.push(`  - id: ${v}`, `    component: ${entry.id}`, `    label: ${v}`);
    if (v !== "default") lines.push(`    variant: ${v}`);
    lines.push(
      "    props:",
      "      entries:",
      "        - { edge: {}, label: data flow }",
      "        - { edge: { variant: dashed }, label: skip connection }",
      "        - { node: { tone: blue }, label: input }",
    );
  }
  lines.push(
    "",
    "edges:",
    "  - from: input",
    "    to: model",
    "  - from: model",
    "    to: output",
    "  - from: input",
    "    to: output",
    "    variant: dashed",
    "    fromAnchor: north",
    "    toAnchor: north",
  );
  return `${lines.join("\n")}\n`;
}

/**
 * The flow markers (#426): per variant, an arrow between two stage boxes in a
 * row; below, the four directions side by side.
 */
function flowArrowSample(entry: CatalogEntry, theme: string): string {
  const directions = ["right", "left", "up", "down"];
  const rows = [
    ...entry.variants.map(
      (v) => `          - row: { gap: 3mm, align: center, items: [${v}-a, ${v}, ${v}-b] }`,
    ),
    `          - row: { gap: 6mm, align: center, items: [${directions.map((d) => `dir-${d}`).join(", ")}] }`,
  ];
  const nodes = [
    ...entry.variants.flatMap((v) => [
      `  - { id: ${v}-a, component: box, label: ${v} }`,
      `  - { id: ${v}, component: ${entry.name}, variant: ${v} }`,
      `  - { id: ${v}-b, component: box, label: stage }`,
    ]),
    ...directions.map(
      (d) => `  - { id: dir-${d}, component: ${entry.name}, props: { direction: ${d} } }`,
    ),
  ];
  return [
    `# ${entry.id}: every variant and direction. Generated by \`bun run gallery\` (#426).`,
    "version: 1",
    "figure:",
    `  id: gallery-${componentStem(entry)}`,
    `  title: ${entry.id}`,
    `  theme: ${theme}`,
    `  profile: ${SAMPLE_PROFILE}`,
    "  layout:",
    "    arrange:",
    "      stack:",
    "        gap: 4mm",
    "        items:",
    ...rows,
    "nodes:",
    ...nodes,
    "",
  ].join("\n");
}

function separatorSample(entry: CatalogEntry, theme: string): string {
  const rows = entry.variants.map(
    (v) =>
      `          - stack: { gap: 3mm, items: [${v}-title, { row: { gap: 4mm, items: [${v}-a, ${v}-vertical, ${v}-b] } }, ${v}-horizontal, ${v}-c] }`,
  );
  const nodes = entry.variants.flatMap((v) => [
    `  - { id: ${v}-title, component: label, label: ${v} }`,
    `  - { id: ${v}-a, component: box, label: A }`,
    `  - { id: ${v}-b, component: box, label: B }`,
    `  - { id: ${v}-c, component: box, label: C }`,
    `  - { id: ${v}-vertical, component: separator, variant: ${v} }`,
    `  - { id: ${v}-horizontal, component: separator, variant: ${v} }`,
  ]);
  return [
    `# ${entry.id}: every variant and orientation. Generated by \`bun run gallery\`.`,
    "version: 1",
    "figure:",
    `  id: gallery-${componentStem(entry)}`,
    `  title: ${entry.id}`,
    `  theme: ${theme}`,
    `  profile: ${SAMPLE_PROFILE}`,
    "  layout:",
    "    arrange:",
    "      row:",
    "        gap: 8mm",
    "        items:",
    ...rows,
    "nodes:",
    ...nodes,
    "",
  ].join("\n");
}

function zoomSample(entry: CatalogEntry, theme: string): string {
  const rows = entry.variants.map(
    (v) => `          - row: { gap: 10mm, align: center, items: [${v}-block, ${v}] }`,
  );
  const lines = [
    `# ${entry.id}: every variant. Generated by \`bun run gallery\` (#17, #176).`,
    "version: 1",
    "figure:",
    `  id: gallery-${componentStem(entry)}`,
    `  title: ${entry.id}`,
    `  theme: ${theme}`,
    `  profile: ${SAMPLE_PROFILE}`,
    "  layout:",
    "    arrange:",
    "      stack:",
    "        gap: 6mm",
    "        items:",
    ...rows,
    "",
    "groups:",
  ];
  for (const v of entry.variants) {
    lines.push(
      `  - id: ${v}`,
      `    label: ${v}`,
      `    arrange: { row: { gap: 5mm, items: [${v}-in, ${v}-out] } }`,
    );
  }
  lines.push("", "nodes:");
  for (const v of entry.variants) {
    lines.push(
      `  - id: ${v}-block`,
      "    component: box",
      "    label: block",
      `  - id: ${v}-in`,
      "    component: box",
      "    label: in",
      `  - id: ${v}-out`,
      "    component: box",
      "    label: out",
    );
  }
  lines.push("", "edges:");
  for (const v of entry.variants) {
    lines.push(`  - from: ${v}-block`, `    to: ${v}`, `    component: ${entry.id}`);
    if (v !== "default") lines.push(`    variant: ${v}`);
  }
  for (const v of entry.variants) lines.push(`  - from: ${v}-in`, `    to: ${v}-out`);
  return `${lines.join("\n")}\n`;
}

function tokensSample(entry: CatalogEntry, theme: string): string {
  const lines = [
    `# ${entry.id}: every variant. Generated by \`bun run gallery\` (#17, #181).`,
    "version: 1",
    "figure:",
    `  id: gallery-${componentStem(entry)}`,
    `  title: ${entry.id}`,
    `  theme: ${theme}`,
    `  profile: ${SAMPLE_PROFILE}`,
    "  layout:",
    "    arrange:",
    "      stack:",
    "        gap: 6mm",
    "        items:",
    ...entry.variants.flatMap((v) => [
      `          - ${v}-model`,
      `          - row: { gap: 6mm, align: center, items: [${v}, ${v}-keys] }`,
    ]),
    "",
    "nodes:",
  ];
  for (const v of entry.variants) {
    lines.push(
      `  - id: ${v}-model`,
      "    component: box",
      `    label: ${v}`,
      `  - id: ${v}`,
      `    component: ${entry.id}`,
    );
    if (v !== "default") lines.push(`    variant: ${v}`);
    lines.push(
      "    tone: purple",
      "    props:",
      "      gap: 1.5pt",
      "      cells:",
      "        - { id: cls, label: CLS, tone: gray }",
      "        - t1",
      "        - t2",
      "        - t3",
      "        - { separator: dotted, tone: gray, height: 24pt }",
      "        - { label: '…', component: label }",
      `  - id: ${v}-keys`,
      `    component: ${entry.id}`,
    );
    if (v !== "default") lines.push(`    variant: ${v}`);
    lines.push(
      "    tone: orange",
      "    props: { gap: 1pt, component: square, lineAlign: center, lines: [[W], [A, S, D]] }",
    );
  }
  lines.push("", "edges:");
  for (const v of entry.variants) {
    lines.push(
      `  - from: ${v}-model`,
      `    to: ${v}.cls`,
      `  - from: ${v}-model`,
      `    to: ${v}.3`,
      // The whole sequence as an endpoint (#281).
      `  - from: ${v}-model`,
      `    to: ${v}-keys`,
    );
  }
  return `${lines.join("\n")}\n`;
}

/**
 * `sumi/bracket` (#281): per variant, a column of tokens with a curly brace
 * and one with a square bracket attached to its east side, each with an edge
 * from the spine to a box; below them, a token row with a bracket attached
 * to its south side.
 */
function bracketSample(entry: CatalogEntry, theme: string): string {
  const lines = [
    `# ${entry.id}: every variant. Generated by \`bun run gallery\` (#17, #281).`,
    "version: 1",
    "figure:",
    `  id: gallery-${componentStem(entry)}`,
    `  title: ${entry.id}`,
    `  theme: ${theme}`,
    `  profile: ${SAMPLE_PROFILE}`,
    "  layout:",
    "    arrange:",
    "      stack:",
    "        gap: 6mm",
    "        items:",
    ...entry.variants.map(
      (v) =>
        `          - row: { gap: 14mm, align: center, items: [${v}-curly-set, ${v}-curly-out, ${v}-square-set, ${v}-square-out] }`,
    ),
    "          - { row: { gap: 6mm, items: [row-set] } }",
    "",
    "nodes:",
  ];
  for (const v of entry.variants) {
    for (const form of ["curly", "square"]) {
      const id = `${v}-${form}`;
      lines.push(
        `  - { id: ${id}-set, component: tokens, tone: gray, props: { direction: down, gap: 1.5pt, cells: [a, b, c] } }`,
        `  - id: ${id}`,
        `    component: ${entry.id}`,
      );
      if (v !== "default") lines.push(`    variant: ${v}`);
      lines.push(
        `    attach: { to: ${id}-set, side: east, gap: 1.5mm }`,
        `    props: { form: ${form} }`,
        `  - { id: ${id}-out, component: box, label: ${v} }`,
      );
    }
  }
  lines.push(
    "  - { id: row-set, component: tokens, tone: gray, props: { gap: 1.5pt, cells: [a, b, c] } }",
    `  - { id: row-bracket, component: ${entry.id}, attach: { to: row-set, side: south, gap: 1.5mm }, props: { form: curly, points: south } }`,
    "  - { id: row-out, component: box, label: below, attach: { to: row-bracket, side: south, gap: 8mm } }",
    "",
    "edges:",
  );
  for (const v of entry.variants) {
    for (const form of ["curly", "square"]) {
      lines.push(`  - { from: ${v}-${form}, to: ${v}-${form}-out }`);
    }
  }
  lines.push("  - { from: row-bracket, to: row-out }");
  return `${lines.join("\n")}\n`;
}

function matrixSample(entry: CatalogEntry, theme: string): string {
  const lines = [
    `# ${entry.id}: every variant. Generated by \`bun run gallery\` (#17, #180).`,
    "version: 1",
    "figure:",
    `  id: gallery-${componentStem(entry)}`,
    `  title: ${entry.id}`,
    `  theme: ${theme}`,
    `  profile: ${SAMPLE_PROFILE}`,
    "  layout:",
    "    arrange:",
    "      stack:",
    "        gap: 6mm",
    "        items:",
    ...entry.variants.map(
      (v) =>
        `          - stack: { gap: 3mm, align: start, items: [{ row: { gap: 6mm, align: center, items: [${v}-input, ${v}, ${v}-key] } }, ${v}-sim] }`,
    ),
    "",
    "nodes:",
  ];
  for (const v of entry.variants) {
    lines.push(
      `  - id: ${v}-input`,
      "    component: box",
      `    label: ${v}`,
      `  - id: ${v}`,
      `    component: ${entry.id}`,
    );
    if (v !== "default") lines.push(`    variant: ${v}`);
    lines.push(
      "    props:",
      "      rows: [S, { label: '$A_1$', tone: purple }, { label: '$V_1$', tone: orange }, P]",
      "      columns: [S, { label: '$A_1$', tone: purple }, { label: '$V_1$', tone: orange }, P]",
      "      cellWidth: 22pt",
      "      gap: 2pt",
      "      variant: filled",
      "      classes:",
      "        o: { tone: green, label: Allowed }",
      "        L: { tone: orange, label: Link }",
      "        x: { pattern: hatch, variant: outlined, label: Masked }",
      "      cells: [o x o x, o o L x, o L o x, x x x o]",
      `  - id: ${v}-key`,
      "    component: legend",
      "    props:",
      `      entries: [{ class: ${v}.o }, { class: ${v}.L }, { class: ${v}.x }]`,
      // Text cells, a highlighted diagonal and an ellipsis row and column (#280).
      `  - id: ${v}-sim`,
      `    component: ${entry.id}`,
      "    props:",
      "      cellWidth: 38pt",
      "      cellHeight: 26pt",
      "      variant: outlined",
      "      flush: true",
      "      classes:",
      "        d: { tone: blue, variant: tinted }",
      "        n: {}",
      "      ellipsisRows: [3]",
      "      ellipsisColumns: [3]",
      "      cells:",
      "        - [{ class: d, text: '$I_1 T_1$' }, { class: n, text: '$I_1 T_2$' }, n, { class: n, text: '$I_1 T_N$' }]",
      "        - [{ class: n, text: '$I_2 T_1$' }, { class: d, text: '$I_2 T_2$' }, n, { class: n, text: '$I_2 T_N$' }]",
      "        - [n, n, n, n]",
      "        - [{ class: n, text: '$I_N T_1$' }, { class: n, text: '$I_N T_2$' }, n, { class: d, text: '$I_N T_N$' }]",
    );
  }
  lines.push("", "edges:");
  for (const v of entry.variants) lines.push(`  - from: ${v}-input`, `    to: ${v}`);
  return `${lines.join("\n")}\n`;
}

type MarkedEntry = Extract<CatalogEntry, { kind: "node" }>;

function htmlSample(entry: CatalogEntry): string[] {
  return [
    "",
    "nodes:",
    ...entry.variants.flatMap((v) => [
      `  - id: ${v}`,
      "    component: html",
      `    variant: ${v}`,
      "    props:",
      "      viewport: 320x176",
      "      width: 160pt",
      "      html: |",
      '        <div style="display:flex;flex-direction:column;gap:12px;padding:16px;width:320px;height:176px;background-color:var(--sumi-bg);border:2px solid var(--sumi-accent);border-radius:12px">',
      `          <b style="font-size:24px;color:var(--sumi-accent)">${v}</b>`,
      '          <div style="font-family:var(--sumi-mono);white-space:pre;font-size:18px">  render(text)</div>',
      '          <p style="font-size:18px;color:var(--sumi-muted)">HTML / CSS · 日本語</p>',
      "        </div>",
    ]),
  ];
}

function imageSample(entry: MarkedEntry): string[] {
  const rows = [
    ...entry.variants.map((v) => ({
      id: v,
      variant: v,
      props: "{ src: gradient.png, height: 24pt }",
    })),
    {
      id: "cover",
      variant: "default",
      props: "{ src: gradient.png, width: 48pt, height: 18pt, fit: cover }",
    },
    { id: "svg", variant: "default", props: "{ src: shapes.svg, height: 24pt }" },
    {
      id: "layers",
      variant: "framed",
      props: "{ src: gradient.png, height: 24pt, layers: { count: 4, offset: 3pt } }",
    },
    ...entry.variants.map((variant) => ({
      id: `inline-${variant}`,
      variant,
      props: `{ height: 24pt, svg: '<svg viewBox="0 0 120 60"><path d="M10 30H20M25 15V45M35 5V55M45 20V40M55 10V50M65 22V38M75 15V45M85 25V35M95 30H110" fill="none" stroke="#c04050" stroke-width="3"/></svg>' }`,
    })),
    {
      id: "code-window",
      variant: "default",
      props: `{ height: 24pt, svg: '<svg viewBox="0 0 120 60"><rect width="120" height="60" rx="4" fill="#202938"/><circle cx="10" cy="9" r="3" fill="#ef7070"/><circle cx="20" cy="9" r="3" fill="#e9c46a"/><circle cx="30" cy="9" r="3" fill="#74c69d"/><path d="M10 25H30M10 43H22" stroke="#c4a7e7" stroke-width="3"/><path d="M35 25H75M20 34H55" stroke="#89b4fa" stroke-width="3"/><path d="M60 34H100M27 43H55" stroke="#a6e3a1" stroke-width="3"/></svg>' }`,
    },
  ];
  const nodes: string[] = [];
  const edges: string[] = [];
  for (const row of rows) {
    nodes.push(`  - id: ${row.id}`, "    component: box", `    label: ${row.id}`);
    nodes.push(`  - id: ${row.id}-${entry.name}`, `    component: ${entry.id}`);
    if (row.variant !== "default") nodes.push(`    variant: ${row.variant}`);
    nodes.push(`    props: ${row.props}`);
    edges.push(`  - from: ${row.id}`, `    to: ${row.id}-${entry.name}`);
  }
  return ["", "nodes:", ...nodes, "", "edges:", ...edges];
}

function markSample(entry: MarkedEntry, mark: NonNullable<MarkedEntry["mark"]>): string[] {
  const nodes: string[] = [];
  const edges: string[] = [];
  const box = (id: string, label: string) =>
    nodes.push(`  - id: ${id}`, "    component: box", `    label: ${label}`);
  const markNode = (id: string, variant: string, props?: string) => {
    nodes.push(`  - id: ${id}`, `    component: ${entry.id}`);
    if (variant !== "default") nodes.push(`    variant: ${variant}`);
    if (props !== undefined) nodes.push(`    props: ${props}`);
  };
  const edge = (from: string, to: string, component?: string) => {
    edges.push(`  - from: ${from}`, `    to: ${to}`);
    if (component !== undefined) edges.push(`    component: ${component}`);
  };
  if (mark.type === "glyph") {
    const [first = ""] = Object.keys(mark.glyphs);
    const rows = [
      ...entry.variants.map((v) => ({ id: v, variant: v, value: first })),
      ...Object.keys(mark.glyphs).map((g) => ({ id: g, variant: "default", value: g })),
    ];
    for (const row of rows) {
      box(row.id, row.id);
      markNode(`${row.id}-${entry.name}`, row.variant, `{ ${mark.prop}: ${row.value} }`);
      edge(row.id, `${row.id}-${entry.name}`);
    }
    // The operator's bounded sizes (#311): the default row continues with a large and an xlarge operator.
    if (entry.name === "operator") {
      let from = `default-${entry.name}`;
      for (const size of ["large", "xlarge"]) {
        const id = `size-${size}-${entry.name}`;
        markNode(id, "default", `{ ${mark.prop}: ${first}, size: ${size} }`);
        edge(from, id);
        from = id;
      }
    }
  } else {
    for (const v of entry.variants) {
      box(v, v);
      markNode(`${v}-${entry.name}`, v);
      // A line into the point: an arrowhead would cover the dot.
      edge(v, `${v}-${entry.name}`, "line");
      for (const end of ["a", "b"]) {
        box(`${v}-${end}`, end.toUpperCase());
        edge(`${v}-${entry.name}`, `${v}-${end}`);
      }
    }
  }
  return ["", "nodes:", ...nodes, "", "edges:", ...edges];
}

export function componentSamples(): ComponentSample[] {
  const [first = "minimal"] = THEMES;
  return buildCatalog(createBuiltinRegistry()).components.map((entry) => ({
    entry,
    fileName: `${componentStem(entry)}.sumi.yaml`,
    source: sampleSource(entry, first),
    ...(entry.kind === "node" && entry.embed !== undefined && { assetBase: SAMPLE_ASSET_DIR }),
    renderings: THEMES.map((theme) => {
      const profile = sampleProfile(entry, theme);
      return {
        output: `${GALLERY_DIR}/components/${componentStem(entry)}.${theme}.svg`,
        theme,
        profile,
        overrides: {
          ...(theme !== first && { theme }),
          ...(profile !== SAMPLE_PROFILE && { profile }),
        },
      };
    }),
  }));
}

/** One figure under every theme: every tone (#92), or a dimmed group (#175). */
export interface ToneSample {
  fileName: string;
  source: string;
  /** One rendering per built-in theme; the first is the source as written. */
  renderings: Rendering[];
}

/**
 * Every tone on a box, laid out as a grid of two rows, plus a toned group
 * holding an untoned box and a toned operator.
 */
export function toneSample(): ToneSample {
  const [first = "minimal"] = THEMES;
  const half = Math.ceil(TONE_NAMES.length / 2);
  const lines = [
    "# Every tone. Generated by `bun run gallery` (#92).",
    "version: 1",
    "figure:",
    "  id: gallery-tones",
    "  title: Tones",
    `  theme: ${first}`,
    `  profile: ${SAMPLE_PROFILE}`,
    "  layout:",
    "    direction: down",
    "",
    "groups:",
    "  - id: group",
    "    label: group (blue)",
    "    tone: blue",
    "",
    "nodes:",
  ];
  for (const tone of TONE_NAMES) {
    lines.push(`  - id: ${tone}`, "    component: box", `    label: ${tone}`, `    tone: ${tone}`);
  }
  lines.push(
    "  - id: member",
    "    component: box",
    "    label: no tone",
    "    group: group",
    "  - id: operator",
    "    component: operator",
    "    tone: orange",
    "    props: { symbol: plus }",
    "    group: group",
    "",
    "edges:",
  );
  // Each tone of the first row above one of the second.
  for (const [i, tone] of TONE_NAMES.slice(0, half).entries()) {
    const below = TONE_NAMES[i + half];
    if (below !== undefined) lines.push(`  - from: ${tone}`, `    to: ${below}`);
  }
  lines.push("  - from: member", "    to: operator");
  return {
    fileName: "tones.sumi.yaml",
    source: `${lines.join("\n")}\n`,
    renderings: THEMES.map((theme) => ({
      output: `${GALLERY_DIR}/tones/tones.${theme}.svg`,
      theme,
      profile: SAMPLE_PROFILE,
      overrides: theme === first ? {} : { theme },
    })),
  };
}

/**
 * A dimmed group (#175) beside the same group drawn as it is, under every
 * theme: toned boxes, an operator, a labeled arrow, a nested dashed group and
 * the caption. The arrow from the left panel into the dimmed one is not
 * dimmed (only edges with both ends inside are).
 */
export function dimSample(): ToneSample {
  const [first = "minimal"] = THEMES;
  const panel = (id: string, dim: boolean) => [
    `  - id: ${id}`,
    `    label: ${dim ? "Dimmed" : "As written"}`,
    `    caption: (${dim ? "b" : "a"}) ${dim ? "dimmed" : "not dimmed"}`,
    ...(dim ? ["    dim: true"] : []),
    `    arrange: { stack: { gap: 10mm, items: [${id}-in, ${id}-op, ${id}-sub] } }`,
    `  - id: ${id}-sub`,
    "    label: nested",
    "    labelAt: bottom",
    "    variant: dashed",
    "    tone: blue",
    `    arrange: { stack: { items: [${id}-out] } }`,
  ];
  const nodes = (id: string) => [
    `  - { id: ${id}-in, component: box, label: Input, tone: orange }`,
    `  - { id: ${id}-op, component: operator, props: { symbol: plus } }`,
    `  - { id: ${id}-out, component: box, label: Output, tone: green }`,
  ];
  const edges = (id: string) => [
    `  - { from: ${id}-in, to: ${id}-op, label: x }`,
    `  - { from: ${id}-op, to: ${id}-out }`,
  ];
  const lines = [
    "# A dimmed group beside the same group as written. Generated by `bun run gallery` (#175).",
    "version: 1",
    "figure:",
    "  id: gallery-dim",
    "  title: Dimmed group",
    `  theme: ${first}`,
    `  profile: ${SAMPLE_PROFILE}`,
    "  layout:",
    "    arrange: { row: { gap: 8mm, align: stretch, items: [plain, dimmed] } }",
    "",
    "groups:",
    ...panel("plain", false),
    ...panel("dimmed", true),
    "",
    "nodes:",
    ...nodes("plain"),
    ...nodes("dimmed"),
    "",
    "edges:",
    ...edges("plain"),
    ...edges("dimmed"),
    "  - { from: plain-op, to: dimmed-op, component: line, variant: dashed }",
  ];
  return {
    fileName: "dim.sumi.yaml",
    source: `${lines.join("\n")}\n`,
    renderings: THEMES.map((theme) => ({
      output: `${GALLERY_DIR}/dim/dim.${theme}.svg`,
      theme,
      profile: SAMPLE_PROFILE,
      overrides: theme === first ? {} : { theme },
    })),
  };
}

/**
 * Node glyphs (#408): the feature vectors of a paper figure on icon nodes,
 * whose colour follows the stage (plain, encoder output, integrated), and a
 * box with a row vector, a dot and a pill, under every theme.
 */
export function glyphSample(): ToneSample {
  const [first = "minimal"] = THEMES;
  const lines = [
    "# Feature vectors, dots and pills on nodes, soft and solid. Generated by `bun run gallery` (#408).",
    "version: 1",
    "figure:",
    "  id: gallery-glyphs",
    "  title: Node glyphs",
    `  theme: ${first}`,
    `  profile: ${SAMPLE_PROFILE}`,
    "  layout:",
    "    arrange:",
    "      stack:",
    "        gap: 8mm",
    "        items:",
    "          - row: { gap: 10mm, align: center, items: [paper, encoder, encoded, pooled] }",
    "          - row: { gap: 12mm, align: center, items: [tagged, solid] }",
    "",
    "nodes:",
    "  - { id: paper, component: label, icon: tabler/file-text, glyphs: [{ kind: vector, cells: 3, dx: 0.3, dy: -0.25 }] }",
    "  - { id: encoder, component: box, label: Encoder }",
    "  - { id: encoded, component: label, icon: tabler/file-text, glyphs: [{ kind: vector, cells: 3, tone: orange, dx: 0.3, dy: -0.25 }] }",
    "  - { id: pooled, component: label, icon: tabler/flask, glyphs: [{ kind: vector, tones: [blue, green, pink], dx: 0.3, dy: -0.25 }] }",
    "  - id: tagged",
    "    component: box",
    "    label: Row, dot and pill",
    "    glyphs:",
    "      - { kind: vector, cells: 4, direction: right, tone: yellow, at: south-east, dx: -0.4, dy: 0.25 }",
    "      - { kind: dot, tone: green, at: north-west }",
    "      - { kind: pill, tone: purple, at: north, dy: -0.1 }",
    "  - id: solid",
    "    component: box",
    "    label: Solid cells",
    "    glyphs:",
    "      - { kind: vector, cells: 3, strength: solid, tone: blue, at: north-east, dx: 0.2, dy: -0.3 }",
    "      - { kind: vector, direction: right, strength: solid, tones: [orange, green, pink], at: south, dy: 0.3 }",
    "",
    "edges:",
    "  - { from: paper, to: encoder }",
    "  - { from: encoder, to: encoded }",
    "  - { from: encoded, to: pooled }",
  ];
  return {
    fileName: "glyphs.sumi.yaml",
    source: `${lines.join("\n")}\n`,
    renderings: THEMES.map((theme) => ({
      output: `${GALLERY_DIR}/glyphs/glyphs.${theme}.svg`,
      theme,
      profile: SAMPLE_PROFILE,
      overrides: theme === first ? {} : { theme },
    })),
  };
}

/**
 * Every tone as an outline and on an edge (#177): a column of `outlined`
 * cells (a tokens node) and a column of default cells with the same tones
 * (the fill), joined by an edge of each tone, and a legend with outlined
 * and edge samples. Structured, so the legend can be drawn.
 */
export function outlinedToneSample(): ToneSample {
  const [first = "minimal"] = THEMES;
  const column = (id: string, variant?: string) => [
    `  - id: ${id}`,
    "    component: tokens",
    "    props:",
    "      direction: down",
    "      gap: 2mm",
    "      align: stretch",
    ...(variant === undefined ? [] : [`      variant: ${variant}`]),
    "      cells:",
    ...TONE_NAMES.map((tone) => `        - { id: ${tone}, label: ${tone}, tone: ${tone} }`),
  ];
  const lines = [
    "# Every tone as an outline and on edges. Generated by `bun run gallery` (#177).",
    "version: 1",
    "figure:",
    "  id: gallery-outlined-tones",
    "  title: Outlined tones and edge tones",
    `  theme: ${first}`,
    `  profile: ${SAMPLE_PROFILE}`,
    "  layout:",
    "    arrange:",
    "      row: { gap: 12mm, align: start, items: [outlined, filled, key] }",
    "",
    "nodes:",
    ...column("outlined", "outlined"),
    ...column("filled"),
    "  - id: key",
    "    component: legend",
    "    props:",
    "      entries:",
    "        - { node: { variant: outlined, tone: gray }, label: outlined (gray) }",
    "        - { node: { variant: outlined, tone: orange }, label: outlined (orange) }",
    "        - { node: { tone: orange }, label: default (orange) }",
    "        - { edge: { tone: orange }, label: edge (orange) }",
    "",
    "edges:",
    ...TONE_NAMES.map(
      (tone) => `  - { from: outlined.${tone}, to: filled.${tone}, tone: ${tone} }`,
    ),
  ];
  return {
    fileName: "outlined-tones.sumi.yaml",
    source: `${lines.join("\n")}\n`,
    renderings: THEMES.map((theme) => ({
      output: `${GALLERY_DIR}/tones/outlined.${theme}.svg`,
      theme,
      profile: SAMPLE_PROFILE,
      overrides: theme === first ? {} : { theme },
    })),
  };
}

/** Both filled tone variants, every tone, token cells and legend samples (#214). */
export function filledToneSample(): ToneSample {
  const [first = "minimal"] = THEMES;
  const source = [
    "# Solid and tinted tones. Generated by `bun run gallery` (#214).",
    "version: 1",
    "figure:",
    "  id: gallery-filled-tones",
    `  theme: ${first}`,
    `  profile: ${SAMPLE_PROFILE}`,
    "  layout:",
    "    arrange:",
    "      row: { gap: 8mm, align: start, items: [solid, tinted, key] }",
    "nodes:",
    ...["solid", "tinted"].flatMap((variant) => [
      `  - id: ${variant}`,
      "    component: tokens",
      "    props:",
      "      direction: down",
      "      gap: 2mm",
      "      align: stretch",
      `      variant: ${variant}`,
      "      cells:",
      ...TONE_NAMES.map((tone) => `        - { id: ${tone}, label: ${tone}, tone: ${tone} }`),
    ]),
    "  - id: key",
    "    component: legend",
    "    props:",
    "      entries:",
    "        - { node: { variant: solid, tone: blue }, label: solid }",
    "        - { node: { variant: tinted, tone: blue }, label: tinted }",
    "edges:",
    ...TONE_NAMES.map((tone) => `  - { from: solid.${tone}, to: tinted.${tone}, tone: ${tone} }`),
  ].join("\n");
  return {
    fileName: "filled-tones.sumi.yaml",
    source: `${source}\n`,
    renderings: THEMES.map((theme) => ({
      output: `${GALLERY_DIR}/tones/filled.${theme}.svg`,
      theme,
      profile: SAMPLE_PROFILE,
      overrides: theme === first ? {} : { theme },
    })),
  };
}

/** The examples' sources, sorted; each renders to the SVG next to it, as written. */
export function exampleEntries(sources: readonly string[]): ExampleEntry[] {
  return [...sources].sort().map((source) => ({
    source,
    rendering: {
      output: source.replace(/\.sumi\.yaml$/, ".svg"),
      // Filled in from the rendered figure's metadata.
      theme: "",
      profile: "",
      overrides: {},
    },
  }));
}

/** {@link COMPARISON_EXAMPLE} under every theme × profile, always through overrides. */
export function comparison(): Comparison {
  const stem = COMPARISON_EXAMPLE.replace(/^.*\//, "").replace(/\.sumi\.yaml$/, "");
  return {
    source: COMPARISON_EXAMPLE,
    renderings: THEMES.flatMap((theme) =>
      PROFILES.map((profile) => ({
        output: `${GALLERY_DIR}/compare/${stem}.${theme}.${profile}.svg`,
        theme,
        profile,
        overrides: { theme, profile },
      })),
    ),
  };
}

/**
 * {@link THEME_COMPARISON_EXAMPLE} under every theme, always through
 * overrides. `slides` doubles the text and so uses its own profile,
 * `presentation-16x9`; the other themes use {@link THEME_COMPARISON_PROFILE}.
 */
export function themeComparison(): Comparison {
  const stem = THEME_COMPARISON_EXAMPLE.replace(/^.*\//, "").replace(/\.sumi\.yaml$/, "");
  return {
    source: THEME_COMPARISON_EXAMPLE,
    renderings: THEMES.map((theme) => {
      const profile = theme === "slides" ? WIDE_SAMPLE_PROFILE : THEME_COMPARISON_PROFILE;
      return {
        output: `${GALLERY_DIR}/themes/${stem}.${theme}.svg`,
        theme,
        profile,
        overrides: { theme, profile },
      };
    }),
  };
}

/**
 * Set enclosures (#407) under every theme: a Venn diagram of two overlapping
 * sets with a member in both, a hull around four nodes with an ellipse around
 * two of them (a subset), ellipses tilted to their members (`angle: auto`) or
 * by a given angle (#430), and the four variants around one node each.
 * Structured, since sets are drawn by the structured layout; the members are
 * placed with `place` in units wide enough for the `slides` theme.
 */
export function setsSample(): ToneSample {
  const [first = "minimal"] = THEMES;
  const source = `# Set enclosures: overlapping sets for Venn diagrams and hyperedges. Generated by \`bun run gallery\` (#407).
version: 1
figure:
  id: gallery-sets
  title: Set enclosures
  theme: ${first}
  profile: paper-double
  layout:
    arrange:
      stack:
        gap: 14mm
        items:
          - row:
              gap: 22mm
              align: center
              items:
                - place:
                    unit: 12mm
                    items:
                      - { item: a1, at: [0, 0] }
                      - { item: a2, at: [0.1, 1.6] }
                      - { item: ab, at: [1.5, 0.8] }
                      - { item: b1, at: [2.9, 0] }
                      - { item: b2, at: [2.9, 1.6] }
                - place:
                    unit: 12mm
                    items:
                      - { item: p, at: [0.5, 0] }
                      - { item: r, at: [2.3, 0.5] }
                      - { item: q, at: [1.2, 1.0] }
                      - { item: s, at: [0, 1.7] }
                      - { item: t, at: [2.0, 2.1] }
          - row:
              gap: 14mm
              align: center
              items:
                - place:
                    unit: 10mm
                    items:
                      - { item: t1, at: [0, 3.2] }
                      - { item: t2, at: [1.6, 1.8] }
                      - { item: t3, at: [2.7, 3.0] }
                      - { item: t4, at: [3.0, 0.6] }
                - place:
                    unit: 10mm
                    items:
                      - { item: u1, at: [0, 0] }
                      - { item: u2, at: [1.5, 0.9] }
                      - { item: u3, at: [2.9, 1.8] }
          - row:
              gap: 22mm
              items: [d, f, o, h]

nodes:
  - { id: a1, component: box, label: a1 }
  - { id: a2, component: box, label: a2 }
  - { id: ab, component: box, label: ab }
  - { id: b1, component: box, label: b1 }
  - { id: b2, component: box, label: b2 }
  - { id: p, component: circle, label: p }
  - { id: q, component: circle, label: q }
  - { id: r, component: circle, label: r }
  - { id: s, component: circle, label: s }
  - { id: t, component: circle, label: t }
  - { id: t1, component: circle, label: t1 }
  - { id: t2, component: circle, label: t2 }
  - { id: t3, component: circle, label: t3 }
  - { id: t4, component: circle, label: t4 }
  - { id: u1, component: box, label: u1 }
  - { id: u2, component: box, label: u2 }
  - { id: u3, component: box, label: u3 }
  - { id: d, component: box, label: d }
  - { id: f, component: box, label: f }
  - { id: o, component: box, label: o }
  - { id: h, component: box, label: h }

edges:
  - { from: b2, to: s, component: line, route: straight }
  - { from: d, to: f }
  - { from: f, to: o }
  - { from: o, to: h }

sets:
  - { id: left, label: Left, members: [a1, a2, ab], tone: blue, labelAt: top-left }
  - { id: right, label: Right, members: [ab, b1, b2], tone: green, labelAt: top }
  - { id: outer, label: Hull, members: [p, q, r, s, t], tone: gray, shape: hull, padding: 9mm, labelAt: right }
  - { id: inner, members: [q], tone: orange, shape: circle, padding: 3mm }
  - { id: tilted, label: "angle: auto", members: [t1, t2, t3, t4], tone: blue, shape: ellipse, angle: auto, padding: 4mm, labelAt: top-left }
  - { id: fixed, label: "angle: 30", members: [u1, u2, u3], tone: purple, shape: ellipse, angle: 30, padding: 4mm, labelAt: top-right }
  - { id: default, label: default, members: [d], tone: blue, labelAt: bottom }
  - { id: filled, label: filled, members: [f], tone: orange, variant: filled, labelAt: bottom }
  - { id: outlined, label: outlined, members: [o], tone: green, variant: outlined, labelAt: bottom }
  - { id: dashed, label: dashed, members: [h], tone: purple, variant: dashed, labelAt: bottom }
`;
  return {
    fileName: "sets.sumi.yaml",
    source,
    renderings: THEMES.map((theme) => ({
      output: `${GALLERY_DIR}/sets/sets.${theme}.svg`,
      theme,
      profile: SAMPLE_PROFILE,
      overrides: theme === first ? {} : { theme },
    })),
  };
}

/**
 * Stroke options (#427) under every theme: edges of two widths, dashed and
 * dotted lines, three arrowhead sizes, and group and set frames of different
 * widths, corners and line types, all per element (the figure-wide
 * `themeOverrides` `lineWidth` / `frameWidth` / `arrowheadScale` /
 * `cornerRadius` set the same fields for every element). Structured layout.
 */
export function strokeSample(): ToneSample {
  const [first = "minimal"] = THEMES;
  const source = `# Stroke options: line widths, dotted lines, arrowhead sizes and frame corners. Generated by \`bun run gallery\` (#427).
version: 1
figure:
  id: gallery-strokes
  title: Stroke options
  theme: ${first}
  profile: paper-double
  layout:
    arrange:
      stack:
        gap: 9mm
        items:
          - row: { gap: 24mm, items: [ w1, w2, w3, w4 ] }
          - row: { gap: 24mm, items: [ d1, d2, d3, d4 ] }
          - row: { gap: 24mm, items: [ h1, h2, h3, h4, h5, h6 ] }
          - row: { gap: 10mm, items: [ framed, rounded, dotted-frame ] }

groups:
  - { id: framed, label: "0.5pt, square", lineWidth: 0.5pt, cornerRadius: 0pt, arrange: { row: { items: [ m1 ] } } }
  - { id: rounded, label: "2pt, 8pt corners", lineWidth: 2pt, cornerRadius: 8pt, arrange: { row: { items: [ m2 ] } } }
  - { id: dotted-frame, label: dotted, variant: dotted, arrange: { row: { items: [ m3 ] } } }

nodes:
  - { id: w1, component: box, label: A }
  - { id: w2, component: box, label: B }
  - { id: w3, component: box, label: C }
  - { id: w4, component: box, label: D }
  - { id: d1, component: box, label: A }
  - { id: d2, component: box, label: B }
  - { id: d3, component: box, label: C }
  - { id: d4, component: box, label: D }
  - { id: h1, component: box, label: A }
  - { id: h2, component: box, label: B }
  - { id: h3, component: box, label: C }
  - { id: h4, component: box, label: D }
  - { id: h5, component: box, label: E }
  - { id: h6, component: box, label: F }
  - { id: m1, component: box, label: member }
  - { id: m2, component: box, label: member }
  - { id: m3, component: box, label: member }

edges:
  - { from: w1, to: w2, lineWidth: 0.5pt, label: 0.5pt }
  - { from: w3, to: w4, lineWidth: 2pt, label: 2pt }
  - { from: d1, to: d2, variant: dashed, label: dashed }
  - { from: d3, to: d4, variant: dotted, tone: blue, label: dotted }
  - { from: h1, to: h2, arrowheadScale: 0.6 }
  - { from: h3, to: h4 }
  - { from: h5, to: h6, arrowheadScale: 1.6 }
`;
  return {
    fileName: "strokes.sumi.yaml",
    source,
    renderings: THEMES.map((theme) => ({
      output: `${GALLERY_DIR}/strokes/strokes.${theme}.svg`,
      theme,
      profile: SAMPLE_PROFILE,
      overrides: theme === first ? {} : { theme },
    })),
  };
}

/** The theme the palette sample is drawn with: the color theme palettes suit best. */
export const PALETTE_SAMPLE_THEME = "paper";

/** One figure under every built-in palette (#417): the source differs only in its palette. */
export interface PaletteSample {
  fileName: string;
  /** The source with the first palette; the others change only `themeOverrides.palette`. */
  source: string;
  /** One rendering per built-in palette, with the source it is rendered from. */
  renderings: (Rendering & { palette: string; source: string })[];
}

/**
 * A small pipeline in every built-in palette (#417): panels, default, solid,
 * filled and outlined nodes, an emphasized node and edge, a set, a legend with
 * every variant, and a row of the eight tones (#423), which the palette derives.
 */
export function paletteSample(): PaletteSample {
  const sourceFor = (palette: string) =>
    `# One figure in every built-in palette. Generated by \`bun run gallery\` (#417).
version: 1
figure:
  id: gallery-palette
  title: Palette
  theme: ${PALETTE_SAMPLE_THEME}
  profile: ${SAMPLE_PROFILE}
  themeOverrides:
    palette: ${palette}
  layout:
    arrange:
      row:
        gap: 9mm
        align: center
        items:
          - stack:
              gap: 6mm
              align: center
              items:
                - row: { gap: 9mm, align: center, items: [input, encoder, head, out] }
                - row: { gap: 3mm, items: [t-gray, t-red, t-orange, t-yellow, t-green, t-blue, t-purple, t-pink] }
          - key

groups:
  - id: encoder
    arrange: { row: { gap: 7mm, items: [embed, attn, ffn] } }

nodes:
  - { id: input, component: box, label: Input }
  - { id: embed, component: box, label: Embed }
  - { id: attn, component: box, label: Attention, variant: solid }
  - { id: ffn, component: box, label: FFN, variant: filled }
  - { id: head, component: box, label: Head, variant: emphasis }
  - { id: out, component: box, label: Output, variant: outlined }
${["gray", "red", "orange", "yellow", "green", "blue", "purple", "pink"]
  .map(
    (tone) =>
      `  - { id: t-${tone}, component: box, label: ${tone}, tone: ${tone}, variant: tinted }`,
  )
  .join("\n")}
  - id: key
    component: legend
    props:
      entries:
        - { node: {}, label: default }
        - { node: { variant: solid }, label: solid }
        - { node: { variant: tinted }, label: tinted }
        - { node: { variant: filled }, label: filled }
        - { node: { variant: outlined }, label: outlined }
        - { node: { variant: emphasis }, label: emphasis }
        - { node: { variant: muted }, label: muted }
        - { edge: { variant: emphasis }, label: emphasis edge }

edges:
  - { from: input, to: embed }
  - { from: embed, to: attn }
  - { from: attn, to: ffn }
  - { from: ffn, to: head, variant: emphasis }
  - { from: head, to: out }

sets:
  - { id: decoder, label: Decoder, members: [head, out], shape: rect, labelAt: bottom }
`;
  const [first = "cool-blue"] = PALETTE_NAMES;
  return {
    fileName: "palette.sumi.yaml",
    source: sourceFor(first),
    renderings: PALETTE_NAMES.map((palette) => ({
      output: `${GALLERY_DIR}/palettes/palettes.${palette}.svg`,
      theme: PALETTE_SAMPLE_THEME,
      profile: SAMPLE_PROFILE,
      overrides: {},
      palette,
      source: sourceFor(palette),
    })),
  };
}

/**
 * Legend samples (#409): a legend under a small figure of icon nodes with
 * feature vectors, a pair of edges and a set, whose entries show an icon, a
 * glyph, an edge and a set swatch in a row, grouped under headings and
 * wrapped, under every theme. The figure uses what its legend explains, so
 * `lint/unused-legend-entry` stays quiet.
 */
export function legendSample(): ToneSample {
  const [first = "minimal"] = THEMES;
  const source = `# Contrastive pre-training on a document hypergraph: the encoder turns raw features into embeddings, and related items are pulled together. Generated by \`bun run gallery\` (#456).
version: 1
figure:
  id: gallery-legend-samples
  title: Legend samples
  theme: ${first}
  profile: paper-double
  layout:
    arrange:
      stack:
        gap: 2mm
        align: center
        items:
          - row: { gap: 5mm, align: center, items: [input, a1, encoder, a2, space] }
          - key

groups:
  - id: input
    label: (a) Document hypergraph
    labelAt: bottom
    arrange:
      grid:
        columns: 3
        rowGap: 6mm
        columnGap: 9mm
        items: [d1, t1, s1, d2, t2, s2]
  - id: space
    label: (b) Embedding space
    labelAt: bottom
    arrange:
      grid:
        columns: 3
        rowGap: 9mm
        columnGap: 14mm
        items: [f1, e1, g2, f2, e2, g1]

nodes:
  - { id: d1, component: label, icon: tabler/file-text, iconSize: 1.6, glyphs: [{ kind: vector, tone: gray, direction: right, at: north, dy: -0.35 }] }
  - { id: t1, component: label, icon: tabler/letter-t, iconSize: 1.6, glyphs: [{ kind: vector, tone: gray, direction: right, at: north, dy: -0.35 }] }
  - { id: s1, component: label, icon: tabler/flask, iconSize: 1.6, glyphs: [{ kind: vector, tone: gray, direction: right, at: north, dy: -0.35 }] }
  - { id: d2, component: label, icon: tabler/file-text, iconSize: 1.6, glyphs: [{ kind: vector, tone: gray, direction: right, at: north, dy: -0.35 }] }
  - { id: t2, component: label, icon: tabler/letter-t, iconSize: 1.6, glyphs: [{ kind: vector, tone: gray, direction: right, at: north, dy: -0.35 }] }
  - { id: s2, component: label, icon: tabler/flask, iconSize: 1.6, glyphs: [{ kind: vector, tone: gray, direction: right, at: north, dy: -0.35 }] }
  - { id: a1, component: block-arrow }
  - { id: encoder, component: box, label: "Hypergraph\\nencoder", variant: tinted, tone: blue }
  - { id: a2, component: block-arrow }
  - { id: e1, component: label, icon: tabler/file-text, iconSize: 1.6, glyphs: [{ kind: vector, tone: orange, strength: solid, direction: right, at: north, dy: -0.35 }] }
  - { id: f1, component: label, icon: tabler/letter-t, iconSize: 1.6, glyphs: [{ kind: vector, tone: orange, strength: solid, direction: right, at: north, dy: -0.35 }] }
  - { id: g1, component: label, icon: tabler/flask, iconSize: 1.6, glyphs: [{ kind: vector, tone: orange, strength: solid, direction: right, at: north, dy: -0.35 }] }
  - { id: g2, component: label, icon: tabler/flask, iconSize: 1.6, glyphs: [{ kind: vector, tone: orange, strength: solid, direction: right, at: north, dy: -0.35 }] }
  - { id: e2, component: label, icon: tabler/file-text, iconSize: 1.6, glyphs: [{ kind: vector, tone: orange, strength: solid, direction: right, at: north, dy: -0.35 }] }
  - { id: f2, component: label, icon: tabler/letter-t, iconSize: 1.6, glyphs: [{ kind: vector, tone: orange, strength: solid, direction: right, at: north, dy: -0.35 }] }
  - id: key
    component: legend
    variant: plain
    props:
      flow: row
      headings: inline
      perRow: 4
      entries:
        - { heading: "Nodes", icon: tabler/file-text, label: Paper }
        - { icon: tabler/letter-t, label: Title }
        - { icon: tabler/flask, label: Compound }
        - { set: { tone: green }, label: Hyperedge }
        - { heading: "Features", glyph: { kind: vector, tone: gray, direction: right }, label: Raw }
        - { glyph: { kind: vector, tone: orange, strength: solid, direction: right }, label: Encoded }
        - { heading: "Pairs", edge: { component: double-arrow, tone: blue }, label: Positive }
        - { edge: { component: double-arrow, variant: dashed, tone: red }, label: Negative }

edges:
  - { from: f1, to: e1, component: double-arrow, tone: blue }
  - { from: e1, to: g2, component: double-arrow, variant: dashed, tone: red }
  - { from: f2, to: e2, component: double-arrow, tone: blue }
  - { from: e2, to: g1, component: double-arrow, variant: dashed, tone: red }

sets:
  - { id: h1, members: [d1, t1, s1], shape: rect, tone: green, padding: 3mm, enclose: footprint }
  - { id: h2, members: [d2, t2], shape: rect, tone: green, padding: 3mm, enclose: footprint }
`;
  return {
    fileName: "legend-samples.sumi.yaml",
    source,
    renderings: THEMES.map((theme) => ({
      output: `${GALLERY_DIR}/legend-samples/legend-samples.${theme}.svg`,
      theme,
      profile: theme === "slides" ? WIDE_SAMPLE_PROFILE : SAMPLE_PROFILE,
      overrides: {
        ...(theme !== first && { theme }),
        ...(theme === "slides" && { profile: WIDE_SAMPLE_PROFILE }),
      },
    })),
  };
}
