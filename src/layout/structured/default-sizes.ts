/**
 * The table of default sizes in the Skill (#607,
 * `skills/sumi/references/sizes.md`): the structured layout's spacing per
 * profile and the natural size of each node component with a one-word label,
 * measured by laying out a one-node figure with the real engine and fonts.
 * `src/cli/skill-sizes.test.ts` keeps the reference in sync with it
 * (`SUMI_UPDATE_GOLDEN=1` rewrites it).
 */
import { compileFigure } from "../../compiler/compile";
import { BUILTIN_PROFILES } from "../../core/profile/builtin";
import { spacedProfile } from "../../core/profile/schema";
import { createBuiltinRegistry } from "../../core/registry/builtins";
import { formatMm, formatPt, roundToD2Units } from "../../core/units";
import { placeStructured } from "./engine";

/** The settings the component sizes are measured in: a theme, a profile and its text scale. */
export const SIZE_SETTINGS = [
  { profile: "paper-double", textScale: 1, title: "paper (`paper-single` / `paper-double`)" },
  { profile: "screen-doc", textScale: 1.5, title: "`screen-doc`, textScale 1.5" },
  { profile: "presentation-16x9", textScale: 2, title: "`presentation-16x9`, textScale 2" },
] as const;

export const SIZE_THEME = "sumi";
export const SIZE_LABEL = "Encoder";

const mmText = (pt: number) => formatMm(Math.round(pt * 100) / 100);

function spacingTable(): string[] {
  const rows = [
    "| profile | density | `gap` (rows, stacks, grid gaps) | group padding (each side) | a group adds to the width | node padding left/right, top/bottom | margin | max width |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const profile of BUILTIN_PROFILES.values()) {
    for (const density of ["normal", "compact"] as const) {
      const spaced = spacedProfile(profile, density === "compact" ? "compact" : undefined);
      const { arrangeGap, groupPadding, nodePaddingX, nodePaddingY } = spaced.layout;
      // The structured engine keeps the margin in whole layout units (0.5pt).
      const margin = roundToD2Units(profile.margin) / 2;
      rows.push(
        `| ${profile.id} | ${density} | ${formatMm(arrangeGap.pt)} | ${formatPt(groupPadding.pt)} (${mmText(groupPadding.pt)}) | ${mmText(2 * groupPadding.pt)} | ${formatPt(nodePaddingX.pt)}, ${formatPt(nodePaddingY.pt)} | ${mmText(margin)} | ${profile.page.maxWidth === undefined ? "none" : mmText(profile.page.maxWidth.pt)} |`,
      );
    }
  }
  return rows;
}

/** Components measured with props (one row each), not with a label. */
const WITH_PROPS: Readonly<Record<string, readonly { props: string; note: string }[]>> = {
  "sumi/operator": [
    { props: "{ symbol: plus }", note: "" },
    { props: "{ symbol: plus, size: large }", note: " (`size: large`)" },
    { props: "{ symbol: plus, size: xlarge }", note: " (`size: xlarge`)" },
  ],
};

/** Decoration whose size the row it is in decides. */
const SKIPPED = new Set(["sumi/separator"]);

/** The natural size of one node of `component`, or `undefined` when it needs props. */
function measure(
  component: string,
  setting: (typeof SIZE_SETTINGS)[number],
  label: boolean,
  props?: string,
): { width: number; height: number } | undefined {
  const text = `version: 1
figure:
  id: size
  theme: ${SIZE_THEME}
  profile: ${setting.profile}
${setting.textScale === 1 ? "" : `  themeOverrides: { textScale: ${setting.textScale} }\n`}  layout: { engine: structured, arrange: { row: { items: [n] } } }
nodes:
  - { id: n, component: ${component}${label ? `, label: ${SIZE_LABEL}` : ""}${props === undefined ? "" : `, props: ${props}`} }
`;
  const compiled = compileFigure(text);
  if (!compiled.ok) return undefined;
  try {
    const placed = placeStructured(compiled.value.ir);
    const node = placed.layout.nodes.find((n) => n.key === "n:n");
    if (node === undefined) return undefined;
    return { width: node.rect.width / 2, height: node.rect.height / 2 };
  } catch {
    return undefined;
  }
}

function componentTable(): string[] {
  const rows = [
    `| component | ${SIZE_SETTINGS.map((s) => s.title).join(" | ")} |`,
    `| --- | ${SIZE_SETTINGS.map(() => "---").join(" | ")} |`,
  ];
  const needsProps: string[] = [];
  const registry = createBuiltinRegistry();
  for (const manifest of registry.list({ kind: "node" })) {
    const id = `${manifest.namespace}/${manifest.name}`;
    if (SKIPPED.has(id)) continue;
    const variants = WITH_PROPS[id];
    if (variants !== undefined) {
      for (const { props, note } of variants) {
        const sizes = SIZE_SETTINGS.map((setting) => measure(id, setting, false, props));
        rows.push(
          `| \`${id}\`${note} | ${sizes.map((size) => (size === undefined ? "–" : `${mmText(size.width)} × ${mmText(size.height)}`)).join(" | ")} |`,
        );
      }
      continue;
    }
    const cells = SIZE_SETTINGS.map((setting) => {
      const labelled = measure(id, setting, true);
      const size = labelled ?? measure(id, setting, false);
      if (size === undefined) return undefined;
      return `${mmText(size.width)} × ${mmText(size.height)}${labelled === undefined ? " (no label)" : ""}`;
    });
    if (cells.some((c) => c === undefined)) {
      needsProps.push(`\`${id}\``);
      continue;
    }
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
