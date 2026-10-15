/**
 * Built-in themes (design doc §4.3) and lookup by name. Both are
 * domain-neutral and use the bundled font set; every variant of every built-in
 * component is defined, so the built-in components never fall back with
 * `theme/missing-variant`.
 *
 * - `minimal`: monochrome. Emphasis is a heavier outline and bold text.
 * - `academic`: restrained, for papers. Thin lines, black text, emphasis by a
 *   light gray fill and a slightly heavier outline; prints well in grayscale.
 */

import { type DocPath, didYouMean } from "../diagnostics";
import { errorAt } from "../figure/report";
import type { Locator } from "../figure/yaml";
import type { Result } from "../result";
import { DEFAULT_FONT_SET_ID } from "./fonts";
import { type StyleLayerInput, type Theme, type ThemeDefinition, validateTheme } from "./schema";

/** Node components with the variants default, emphasis and muted. */
const SHAPE_NODES = [
  "box",
  "square",
  "circle",
  "ellipse",
  "diamond",
  "hexagon",
  "parallelogram",
  "cylinder",
  "document",
];
const EDGES = ["arrow", "line", "double-arrow"];

interface VariantStyles {
  shape: { emphasis: StyleLayerInput; muted: StyleLayerInput };
  label: { default: StyleLayerInput; muted: StyleLayerInput };
  container: { muted: StyleLayerInput };
  edge: { dashed: StyleLayerInput; emphasis: StyleLayerInput; muted: StyleLayerInput };
}

/** Expands per-category variant styles to every built-in component. */
function componentStyles(styles: VariantStyles): NonNullable<ThemeDefinition["components"]> {
  return {
    ...Object.fromEntries(SHAPE_NODES.map((name) => [name, styles.shape])),
    label: styles.label,
    container: styles.container,
    ...Object.fromEntries(EDGES.map((name) => [name, styles.edge])),
  };
}

export const BUILTIN_THEME_DEFINITIONS: readonly ThemeDefinition[] = [
  {
    version: 1,
    id: "minimal",
    description: "Monochrome theme with clear outlines",
    fonts: DEFAULT_FONT_SET_ID,
    tokens: {
      color: { fg: "#1f2328", bg: "#ffffff", muted: "#6e7781", surface: "#f6f8fa" },
      size: { text: "8pt", small: "7pt", heading: "9pt" },
      line: { regular: "1pt", bold: "2pt" },
      dash: { regular: 4 },
    },
    base: {
      node: {
        fill: "{color.bg}",
        stroke: "{color.fg}",
        strokeWidth: "{line.regular}",
        fontSize: "{size.text}",
        fontColor: "{color.fg}",
      },
      group: {
        fill: "{color.surface}",
        stroke: "{color.muted}",
        strokeWidth: "{line.regular}",
        fontSize: "{size.heading}",
        fontColor: "{color.fg}",
        bold: true,
      },
      edge: {
        fill: "{color.bg}",
        stroke: "{color.fg}",
        strokeWidth: "{line.regular}",
        fontSize: "{size.small}",
        fontColor: "{color.fg}",
        filled: true,
      },
    },
    components: componentStyles({
      shape: {
        emphasis: { strokeWidth: "{line.bold}", bold: true },
        muted: { stroke: "{color.muted}", fontColor: "{color.muted}" },
      },
      label: {
        default: { fill: "transparent", strokeWidth: "0pt" },
        muted: { fontColor: "{color.muted}" },
      },
      container: { muted: { fill: "{color.bg}", fontColor: "{color.muted}", bold: false } },
      edge: {
        dashed: { strokeDash: "{dash.regular}" },
        emphasis: { strokeWidth: "{line.bold}" },
        muted: { stroke: "{color.muted}", fontColor: "{color.muted}" },
      },
    }),
  },
  {
    version: 1,
    id: "academic",
    description: "Restrained theme for papers: thin lines, black text, gray emphasis",
    fonts: DEFAULT_FONT_SET_ID,
    tokens: {
      color: {
        text: "#000000",
        line: "#000000",
        paper: "#ffffff",
        muted: "#595959",
        highlight: "#e6e6e6",
        frame: "#808080",
      },
      size: { text: "8pt", small: "7pt", heading: "8pt" },
      line: { thin: "0.5pt", regular: "{line.thin}", bold: "1pt" },
      dash: { regular: 3 },
    },
    base: {
      node: {
        fill: "{color.paper}",
        stroke: "{color.line}",
        strokeWidth: "{line.regular}",
        fontSize: "{size.text}",
        fontColor: "{color.text}",
      },
      group: {
        fill: "transparent",
        stroke: "{color.frame}",
        strokeWidth: "{line.regular}",
        fontSize: "{size.heading}",
        fontColor: "{color.text}",
        bold: true,
      },
      edge: {
        fill: "{color.paper}",
        stroke: "{color.line}",
        strokeWidth: "{line.regular}",
        fontSize: "{size.small}",
        fontColor: "{color.text}",
        filled: true,
      },
    },
    components: componentStyles({
      shape: {
        emphasis: { fill: "{color.highlight}", strokeWidth: "{line.bold}" },
        muted: { stroke: "{color.muted}", fontColor: "{color.muted}" },
      },
      label: {
        default: { fill: "transparent", strokeWidth: "0pt" },
        muted: { fontColor: "{color.muted}" },
      },
      container: { muted: { strokeDash: "{dash.regular}", fontColor: "{color.muted}" } },
      edge: {
        dashed: { strokeDash: "{dash.regular}" },
        emphasis: { strokeWidth: "{line.bold}" },
        muted: { stroke: "{color.muted}", fontColor: "{color.muted}" },
      },
    }),
  },
];

/** Built-in themes by ID, validated once at load against the built-in components. */
export const BUILTIN_THEMES: ReadonlyMap<string, Theme> = new Map(
  BUILTIN_THEME_DEFINITIONS.map((definition) => {
    const result = validateTheme(definition);
    if (!result.ok) {
      const messages = result.diagnostics.map((d) => `${d.code}: ${d.message}`).join(" ");
      throw new Error(`internal error: invalid built-in theme "${definition.id}": ${messages}`);
    }
    return [result.value.id, result.value];
  }),
);

/** Returns the built-in theme with the given ID, if any. */
export function getTheme(id: string): Theme | undefined {
  return BUILTIN_THEMES.get(id);
}

/**
 * Resolves a theme name such as `figure.theme`. An unknown name is reported as
 * `theme/unknown` at `path`, with the closest built-in name as a hint.
 */
export function resolveTheme(
  name: string,
  path: DocPath = ["figure", "theme"],
  locate: Locator = () => undefined,
): Result<Theme> {
  const theme = getTheme(name);
  if (theme) return { ok: true, value: theme, diagnostics: [] };
  const names = [...BUILTIN_THEMES.keys()];
  const available = `Available themes: ${names.join(", ")}.`;
  const suggestion = didYouMean(name, names);
  return {
    ok: false,
    diagnostics: [
      errorAt(locate, "theme/unknown", `Unknown theme "${name}".`, path, {
        hint: suggestion ? `${suggestion} ${available}` : available,
      }),
    ],
  };
}
