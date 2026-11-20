/**
 * Default sizes of a structured figure (#607, #611): the structured layout's
 * spacing per profile and density, the text sizes and line widths the theme
 * draws with, and the natural size of each node component, measured by laying
 * out a one-node figure with the real engine and fonts.
 *
 * One source for every output, so they cannot drift:
 * - `sumi catalog --sizes` (`defaultSizes()`, and `sizesCss()` for the
 *   Skill's mockup template), for any profile, theme, density, text scale and label;
 * - the Skill's table `skills/sumi/references/sizes.md` (`defaultSizesMarkdown()`),
 *   kept in sync by `src/cli/skill-sizes.test.ts` (`SUMI_UPDATE_GOLDEN=1` rewrites it).
 */
import { pathToFileURL } from "node:url";
import { compileFigure } from "../../compiler/compile";
import type { Diagnostic } from "../../core/diagnostics";
import { BUILTIN_PROFILES } from "../../core/profile/builtin";
import { type Profile, spacedProfile } from "../../core/profile/schema";
import { builtinRegistry } from "../../core/registry/builtins";
import { BUILTIN_THEMES } from "../../core/theme/builtin";
import { themeCatalogEntry } from "../../core/theme/catalog";
import { getFontSet, LATIN_FONT_SET_ID } from "../../core/theme/fonts";
import { formatMm, formatPt, ptToMm, roundToD2Units } from "../../core/units";
import { placeStructured } from "./engine";

/** The settings the Skill's component table is measured in: a profile and its text scale. */
export const SIZE_SETTINGS = [
  { profile: "paper-double", textScale: 1, title: "paper (`paper-single` / `paper-double`)" },
  { profile: "screen-doc", textScale: 1.5, title: "`screen-doc`, textScale 1.5" },
  { profile: "presentation-16x9", textScale: 2, title: "`presentation-16x9`, textScale 2" },
] as const;

/** The theme sizes are measured in unless another is asked for. */
export const SIZE_THEME = "sumi";
/** The label sizes are measured with unless others are asked for. */
export const SIZE_LABEL = "Encoder";

export const SIZE_DENSITIES = ["normal", "compact"] as const;
export type SizeDensity = (typeof SIZE_DENSITIES)[number];

/** A length in pt and in mm, each rounded to two decimals (mm from the rounded pt). */
export interface SizeLength {
  pt: number;
  mm: number;
}

/** The structured layout's spacing in one profile and density. */
export interface SizeSpacing {
  /** The gap between the items of a row, stack or grid. */
  gap: SizeLength;
  /** A group's padding on each side; a group adds twice this to the width. */
  groupPadding: SizeLength;
  /** A box's padding left and right of its label. */
  nodePaddingX: SizeLength;
  /** A box's padding above and below its label. */
  nodePaddingY: SizeLength;
  /** The margin around the figure. */
  margin: SizeLength;
  /** The profile's page width, `null` when it has none. */
  maxWidth: SizeLength | null;
}

/** The natural size of one node: a component with props or a label (`null`: measured without one). */
export interface ComponentSize {
  component: string;
  props: Record<string, string> | null;
  label: string | null;
  width: SizeLength;
  height: SizeLength;
}

/** Everything `sumi catalog --sizes` reports for one profile, density, theme and text scale. */
export interface SizeSetting {
  profile: string;
  density: SizeDensity;
  theme: string;
  textScale: number;
  /** The font set and the text sizes in pt (times the text scale, rounded as Sumi does). */
  text: { fontSet: string; nodePt: number; groupPt: number; edgePt: number; minPt: number };
  /** Line widths in pt: a node's frame, a group's frame and an edge. */
  lines: { nodePt: number; groupPt: number; edgePt: number };
  /** A node's corner radius in pt. */
  radiusPt: number;
  spacing: SizeSpacing;
  components: ComponentSize[];
  /** Node components sized by their props rather than a label (see `sumi catalog`). */
  sizedByProps: string[];
}

export interface SizeOptions {
  profile: string;
  /** Default {@link SIZE_THEME}. */
  theme?: string;
  /** Default `normal`. */
  density?: SizeDensity;
  /** Default: the scale the theme needs for the profile (its catalog's `textScaleFor`), else 1. */
  textScale?: number;
  /** Labels to measure each component with. Default `[SIZE_LABEL]`. */
  labels?: readonly string[];
  /** Node components to measure (short names or IDs). Default: all. */
  components?: readonly string[];
}

/** A size request Sumi cannot answer (unknown profile, theme or component, bad text scale). */
export class SizeError extends Error {
  override name = "SizeError";
}

const roundPt = (pt: number) => Math.round(pt * 100) / 100;
const length = (pt: number): SizeLength => {
  const rounded = roundPt(pt);
  return { pt: rounded, mm: Number(ptToMm(rounded).toFixed(2)) };
};
const mmText = (pt: number) => formatMm(roundPt(pt));

/** Components measured with props (one row each), not with a label. */
const WITH_PROPS: Readonly<
  Record<string, readonly { props: Record<string, string>; note: string }[]>
> = {
  "sumi/operator": [
    { props: { symbol: "plus" }, note: "" },
    { props: { symbol: "plus", size: "large" }, note: " (`size: large`)" },
    { props: { symbol: "plus", size: "xlarge" }, note: " (`size: xlarge`)" },
  ],
};

/** Decoration whose size the row it is in decides. */
const SKIPPED = new Set(["sumi/separator"]);

function profileOf(id: string): Profile {
  const profile = BUILTIN_PROFILES.get(id);
  if (profile === undefined) {
    throw new SizeError(
      `Unknown profile "${id}"; choose one of ${[...BUILTIN_PROFILES.keys()].join(", ")}.`,
    );
  }
  return profile;
}

/** The text scale a theme needs for a profile (`textScaleFor` in `sumi catalog`), else 1. */
export function defaultTextScale(theme: string, profile: string): number {
  const resolved = BUILTIN_THEMES.get(theme);
  if (resolved === undefined) {
    throw new SizeError(
      `Unknown theme "${theme}"; choose one of ${[...BUILTIN_THEMES.keys()].join(", ")}.`,
    );
  }
  return themeCatalogEntry(resolved).textScaleFor[profileOf(profile).id] ?? 1;
}

/** The spacing of a profile in a density. */
export function sizeSpacing(profileId: string, density: SizeDensity = "normal"): SizeSpacing {
  const profile = profileOf(profileId);
  const spaced = spacedProfile(profile, density === "compact" ? "compact" : undefined);
  const { arrangeGap, groupPadding, nodePaddingX, nodePaddingY } = spaced.layout;
  return {
    gap: length(arrangeGap.pt),
    groupPadding: length(groupPadding.pt),
    nodePaddingX: length(nodePaddingX.pt),
    nodePaddingY: length(nodePaddingY.pt),
    // The structured engine keeps the margin in whole layout units (0.5pt).
    margin: length(roundToD2Units(profile.margin) / 2),
    maxWidth: profile.page.maxWidth === undefined ? null : length(profile.page.maxWidth.pt),
  };
}

interface Frame {
  profile: string;
  theme: string;
  density: SizeDensity;
  textScale: number;
}

/** A structured figure in the frame's settings, as JSON (which is YAML). */
function figureText(
  frame: Frame,
  arrange: unknown,
  nodes: unknown[],
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    version: 1,
    figure: {
      id: "size",
      theme: frame.theme,
      profile: frame.profile,
      ...(frame.textScale === 1 ? {} : { themeOverrides: { textScale: frame.textScale } }),
      layout: {
        engine: "structured",
        ...(frame.density === "compact" ? { density: "compact" } : {}),
        arrange,
      },
    },
    nodes,
    ...extra,
  });
}

const firstError = (diagnostics: readonly Diagnostic[]) => {
  const d = diagnostics.find((x) => x.severity === "error");
  return d === undefined ? "The settings do not compile." : `${d.code}: ${d.message}`;
};

/** The natural size of one node in pt, or `undefined` when it does not lay out this way. */
function measure(
  frame: Frame,
  component: string,
  label: string | null,
  props: Record<string, string> | null,
): { width: number; height: number } | undefined {
  const node = {
    id: "n",
    component,
    ...(label === null ? {} : { label }),
    ...(props === null ? {} : { props }),
  };
  const compiled = compileFigure(figureText(frame, { row: { items: ["n"] } }, [node]));
  if (!compiled.ok) return undefined;
  try {
    const placed = placeStructured(compiled.value.ir);
    const rect = placed.layout.nodes.find((n) => n.key === "n:n")?.rect;
    return rect === undefined ? undefined : { width: rect.width / 2, height: rect.height / 2 };
  } catch {
    return undefined;
  }
}

/** The text sizes, line widths and radius Sumi resolves for a box, a group and an edge. */
function probeStyles(frame: Frame): Pick<SizeSetting, "text" | "lines" | "radiusPt"> {
  const text = figureText(
    frame,
    { row: { items: ["g"] } },
    [
      { id: "a", component: "sumi/box", label: "A", group: "g" },
      { id: "b", component: "sumi/box", label: "B", group: "g" },
    ],
    {
      groups: [{ id: "g", label: "G", arrange: { row: { items: ["a", "b"] } } }],
      edges: [{ from: "a", to: "b", label: "x" }],
    },
  );
  const compiled = compileFigure(text);
  if (!compiled.ok) throw new SizeError(firstError(compiled.diagnostics));
  const { ir } = compiled.value;
  const node = ir.nodes[0]?.style;
  const group = ir.groups[0]?.style;
  const edge = ir.edges[0]?.style;
  if (node === undefined || group === undefined || edge === undefined) {
    throw new Error("internal error: the size probe lost an element");
  }
  return {
    text: {
      fontSet: ir.meta.fontSetId,
      nodePt: node.fontSize.pt,
      groupPt: group.fontSize.pt,
      edgePt: edge.fontSize.pt,
      minPt: profileOf(frame.profile).typography.minFontSize.pt,
    },
    lines: {
      nodePt: node.strokeWidth.pt,
      groupPt: group.strokeWidth.pt,
      edgePt: edge.strokeWidth.pt,
    },
    radiusPt: node.radius?.pt ?? 0,
  };
}

/** The canonical IDs of the node components to measure, in registry order. */
function componentIds(refs: readonly string[] | undefined): string[] {
  const registry = builtinRegistry();
  const all = registry
    .list({ kind: "node" })
    .map((m) => `${m.namespace}/${m.name}`)
    .filter((id) => !SKIPPED.has(id));
  if (refs === undefined) return all;
  const wanted = new Set<string>();
  for (const ref of refs) {
    const resolved = registry.resolve(ref, "node");
    if (!resolved.ok) {
      const d = resolved.diagnostics[0];
      throw new SizeError(
        [d?.message ?? `Unknown node component "${ref}".`, d?.hint].filter(Boolean).join(" "),
      );
    }
    const id = `${resolved.value.namespace}/${resolved.value.name}`;
    if (SKIPPED.has(id)) {
      throw new SizeError(`${id} spans its row and has no size of its own.`);
    }
    wanted.add(id);
  }
  return all.filter((id) => wanted.has(id));
}

/** The node sizes of a frame: one row per component and label (or props variant). */
function componentSizes(
  frame: Frame,
  ids: readonly string[],
  labels: readonly string[],
): Pick<SizeSetting, "components" | "sizedByProps"> {
  const components: ComponentSize[] = [];
  const sizedByProps: string[] = [];
  const row = (
    component: string,
    label: string | null,
    props: Record<string, string> | null,
    size: { width: number; height: number },
  ) => {
    components.push({
      component,
      props,
      label,
      width: length(size.width),
      height: length(size.height),
    });
  };
  for (const id of ids) {
    const variants = WITH_PROPS[id];
    if (variants !== undefined) {
      for (const { props } of variants) {
        const size = measure(frame, id, null, props);
        if (size !== undefined) row(id, null, props, size);
      }
      continue;
    }
    let unlabelled = false;
    for (const label of labels) {
      const labelled = measure(frame, id, label, null);
      if (labelled === undefined) unlabelled = true;
      else row(id, label, null, labelled);
    }
    if (!unlabelled) continue;
    const size = measure(frame, id, null, null);
    if (size === undefined) sizedByProps.push(id);
    else row(id, null, null, size);
  }
  return { components, sizedByProps };
}

/** What `sumi catalog --sizes` reports for one setting. */
export function defaultSizes(options: SizeOptions): SizeSetting {
  const theme = options.theme ?? SIZE_THEME;
  // Validates the profile and the theme before anything is measured.
  const fallbackScale = defaultTextScale(theme, options.profile);
  const frame: Frame = {
    profile: options.profile,
    theme,
    density: options.density ?? "normal",
    textScale: options.textScale ?? fallbackScale,
  };
  const ids = componentIds(options.components);
  // The probe also validates the text scale.
  const styles = probeStyles(frame);
  return {
    ...frame,
    ...styles,
    spacing: sizeSpacing(frame.profile, frame.density),
    ...componentSizes(frame, ids, options.labels ?? [SIZE_LABEL]),
  };
}

const sameProps = (a: Record<string, string> | null, b: Record<string, string> | null) =>
  JSON.stringify(a) === JSON.stringify(b);

const findSize = (
  setting: SizeSetting,
  id: string,
  props: Record<string, string> | null = null,
): ComponentSize | undefined =>
  setting.components.find((c) => c.component === id && sameProps(c.props, props));

/** CSS font families of a font set: the bundled faces of `fontFaceCss()` first, then system names. */
function fontFamilies(fontSet: string): string {
  return [
    ...(fontSet === LATIN_FONT_SET_ID ? ['"Sumi Latin"', '"Sumi"', '"Inter"'] : ['"Sumi"']),
    '"BIZ UDPGothic"',
    "sans-serif",
  ].join(", ");
}

/**
 * `@font-face` rules for the bundled files of a font set, as `file:` URLs on
 * this machine: "Sumi Latin" (Latin text, when the set has it) and "Sumi".
 */
export function fontFaceCss(fontSet: string): string {
  const set = getFontSet(fontSet);
  if (set === undefined) return "";
  const face = (family: string, file: string, weight: number) =>
    `@font-face { font-family: "${family}"; src: url("${pathToFileURL(file).href}"); font-weight: ${weight} }\n`;
  return [
    ...(set.latin === undefined ? [] : [face("Sumi Latin", set.latin, 400)]),
    ...(set.latinBold === undefined ? [] : [face("Sumi Latin", set.latinBold, 700)]),
    face("Sumi", set.regular, 400),
    face("Sumi", set.bold, 700),
  ].join("");
}

/**
 * The size variables of the Skill's mockup template
 * (`skills/sumi/references/mockup-template.html`) for one setting: fonts,
 * text sizes and line widths in pt; spacing and the sizes of a one-line box
 * and of the operators in mm.
 */
export function sizesCss(setting: SizeSetting): string {
  const mm = (value: SizeLength | undefined) => (value === undefined ? "0mm" : `${value.mm}mm`);
  const box = setting.components.find((c) => c.component === "sumi/box");
  const op = (size?: string) =>
    findSize(setting, "sumi/operator", { symbol: "plus", ...(size === undefined ? {} : { size }) })
      ?.width;
  const { spacing, text, lines } = setting;
  const vars: [string, string, string][] = [
    ["--font", fontFamilies(text.fontSet), `font set ${text.fontSet}`],
    ["--fs-node", String(text.nodePt), "pt: node text"],
    ["--fs-group", String(text.groupPt), "pt: group title"],
    ["--fs-edge", String(text.edgePt), `pt: edge label (profile minimum ${text.minPt}pt)`],
    ["--frame-w", String(lines.nodePt), "pt: a node's frame"],
    ["--group-frame-w", String(lines.groupPt), "pt: a group's frame"],
    ["--edge-w", String(lines.edgePt), "pt: an edge"],
    ["--radius", `${roundPt(setting.radiusPt)}pt`, "a node's corners"],
    ["--gap", mm(spacing.gap), "between the items of a row, stack or grid"],
    ["--group-pad", mm(spacing.groupPadding), "a group's padding, each side"],
    ["--node-pad-x", mm(spacing.nodePaddingX), "a box's padding left and right of its label"],
    ["--node-pad-y", mm(spacing.nodePaddingY), "a box's padding above and below its label"],
    ["--box-h", mm(box?.height), "a one-line box's height"],
    ["--op", mm(op()), "an operator"],
    ["--op-large", mm(op("large")), "an operator, size: large"],
    ["--op-xlarge", mm(op("xlarge")), "an operator, size: xlarge"],
    ["--margin", mm(spacing.margin), "around the figure"],
    [
      "--page-w",
      spacing.maxWidth === null ? "none" : mm(spacing.maxWidth),
      "the profile's page width",
    ],
  ];
  // The font list is long: align the comments of the other lines.
  const width = Math.max(...vars.slice(1).map(([name, value]) => `${name}: ${value};`.length));
  const density = setting.density === "compact" ? " --density compact" : "";
  const head = `/* sumi catalog --sizes --css --profile ${setting.profile} --theme ${setting.theme} --text-scale ${setting.textScale}${density} */`;
  const body = vars.map(
    ([name, value, note]) => `  ${`${name}: ${value};`.padEnd(width)}  /* ${note} */`,
  );
  return `${head}\n:root {\n${body.join("\n")}\n}\n`;
}

function spacingTable(): string[] {
  const rows = [
    "| profile | density | `gap` (rows, stacks, grid gaps) | group padding (each side) | a group adds to the width | node padding left/right, top/bottom | margin | max width |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const profile of BUILTIN_PROFILES.values()) {
    for (const density of SIZE_DENSITIES) {
      const { gap, groupPadding, nodePaddingX, nodePaddingY, margin, maxWidth } = sizeSpacing(
        profile.id,
        density,
      );
      rows.push(
        `| ${profile.id} | ${density} | ${formatMm(gap.pt)} | ${formatPt(groupPadding.pt)} (${mmText(groupPadding.pt)}) | ${mmText(2 * groupPadding.pt)} | ${formatPt(nodePaddingX.pt)}, ${formatPt(nodePaddingY.pt)} | ${mmText(margin.pt)} | ${maxWidth === null ? "none" : mmText(maxWidth.pt)} |`,
      );
    }
  }
  return rows;
}

function componentTable(): string[] {
  const rows = [
    `| component | ${SIZE_SETTINGS.map((s) => s.title).join(" | ")} |`,
    `| --- | ${SIZE_SETTINGS.map(() => "---").join(" | ")} |`,
  ];
  const settings = SIZE_SETTINGS.map((s) =>
    defaultSizes({ profile: s.profile, theme: SIZE_THEME, textScale: s.textScale }),
  );
  const cell = (size: ComponentSize, note = "") =>
    `${size.width.mm}mm × ${size.height.mm}mm${note}`;
  const needsProps: string[] = [];
  for (const id of componentIds(undefined)) {
    const variants = WITH_PROPS[id];
    if (variants !== undefined) {
      for (const { props, note } of variants) {
        const cells = settings.map((s) => {
          const size = findSize(s, id, props);
          return size === undefined ? "–" : cell(size);
        });
        rows.push(`| \`${id}\`${note} | ${cells.join(" | ")} |`);
      }
      continue;
    }
    const sizes = settings.map((s) => s.components.find((c) => c.component === id));
    if (sizes.some((size) => size === undefined)) {
      needsProps.push(`\`${id}\``);
      continue;
    }
    const cells = sizes.map((size) =>
      size === undefined ? "" : cell(size, size.label === null ? " (no label)" : ""),
    );
    rows.push(`| \`${id}\` | ${cells.join(" | ")} |`);
  }
  return [
    ...rows,
    "",
    `Sized by their props, not by a label (see \`sumi catalog\`): ${needsProps.join(", ")}. A \`sumi/separator\` spans its row and takes no width beyond the gaps around it.`,
  ];
}

/** The generated part of `sizes.md`. */
export function defaultSizesMarkdown(): string {
  return [
    "### Spacing (structured layout)",
    "",
    ...spacingTable(),
    "",
    `### Node sizes with the one-word label "${SIZE_LABEL}" (theme \`${SIZE_THEME}\`, width × height)`,
    "",
    ...componentTable(),
    "",
  ].join("\n");
}
