/**
 * Built-in themes (design doc §4.3) and lookup by name. Both are
 * domain-neutral and use the bundled font set; every variant of every built-in
 * component is defined, so the built-in components never fall back with
 * `theme/missing-variant`.
 *
 * - `minimal`: monochrome. Emphasis is a heavier outline and bold text.
 * - `academic`: restrained, for papers. Thin lines, black text, emphasis by a
 *   light gray fill and a slightly heavier outline; prints well in grayscale.
 * - `slides`: for projection (#36). Text at least 14pt (the minimum of
 *   `presentation-16x9`) and lines twice as thick as `minimal`, matching the
 *   doubled text; darker grays so muted text stays readable on a projector.
 *   Monochrome like the others; emphasis is a heavier outline, bold text and a
 *   light gray fill.
 * - `color` (#92): general purpose, with color. Outlines and text as
 *   `minimal`; tones are soft pastel fills and emphasis uses a blue accent.
 *
 * Every built-in theme defines `dim` (#175): the gray text and lines and the
 * paler fills of a group with `dim: true` and everything inside it.
 *
 * Tones (#92, design doc §6.20) only change colors, and only of nodes and
 * groups that set `tone`. The monochrome themes map the eight tones to three
 * gray fills, so a toned figure still prints in grayscale; tones in the same
 * step look alike there (use `color` to tell all of them apart).
 */

import { type DocPath, didYouMean } from "../diagnostics";
import { errorAt } from "../figure/report";
import type { Locator } from "../figure/yaml";
import type { Result } from "../result";
import { DEFAULT_FONT_SET_ID } from "./fonts";
import { type StyleLayerInput, type Theme, type ThemeDefinition, validateTheme } from "./schema";
import type { Tone } from "./tones";

/**
 * Node components with the variants default, emphasis and muted, and (all
 * but `stack`) filled (#174).
 */
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
  "trapezoid",
  "stack",
  "operator",
];
const EDGES = ["arrow", "line", "double-arrow"];

interface VariantStyles {
  shape: { emphasis: StyleLayerInput; muted: StyleLayerInput; filled: StyleLayerInput };
  label: { default: StyleLayerInput; muted: StyleLayerInput };
  junction: { default: StyleLayerInput; muted: StyleLayerInput; hidden: StyleLayerInput };
  container: {
    muted: StyleLayerInput;
    plain: StyleLayerInput;
    filled: StyleLayerInput;
    dashed: StyleLayerInput;
  };
  legend: { default: StyleLayerInput; plain: StyleLayerInput };
  edge: { dashed: StyleLayerInput; emphasis: StyleLayerInput; muted: StyleLayerInput };
}

/**
 * A legend (#131) is drawn as a frame around its entries: on the page's
 * background in the group's frame color, or without a frame (`plain`).
 */
const legendStyles = (paper: string, frame: string): VariantStyles["legend"] => ({
  default: { fill: paper, stroke: frame },
  plain: { fill: "transparent", strokeWidth: "0pt" },
});

/**
 * Borderless and dashed variants (#174, design doc §6.49). "No border" is a
 * zero stroke width, so the geometry rules see no border while the shape
 * keeps its rectangle (inspect, captions, `labelAt`).
 *
 * - node `filled`: the fill without the outline; tone gray's fill unless the
 *   node sets a tone.
 * - container `plain`: neither border nor fill, only the title or caption;
 *   `filled`: a shaded fill without a border; `dashed`: a dashed border
 *   without a fill. A tone sets the fill of any of them.
 */
const filledNode = (fill: string): StyleLayerInput => ({ fill, strokeWidth: "0pt" });
const outlineVariants = (shaded: string): Omit<VariantStyles["container"], "muted"> => ({
  plain: { fill: "transparent", strokeWidth: "0pt" },
  filled: { fill: shaded, strokeWidth: "0pt" },
  dashed: { fill: "transparent", strokeDash: "{dash.regular}" },
});

/** Expands per-category variant styles to every built-in component. */
function componentStyles(styles: VariantStyles): NonNullable<ThemeDefinition["components"]> {
  const { filled: _, ...stack } = styles.shape;
  return {
    ...Object.fromEntries(SHAPE_NODES.map((name) => [name, styles.shape])),
    // Without outlines a stack's rectangles merge into one shape (#174).
    stack,
    label: styles.label,
    junction: styles.junction,
    // An image (#94) is drawn as it is: no background, and a frame only when asked for.
    image: {
      default: { fill: "transparent", strokeWidth: "0pt" },
      framed: { fill: "transparent", strokeWidth: "{line.regular}" },
    },
    container: styles.container,
    legend: styles.legend,
    ...Object.fromEntries(EDGES.map((name) => [name, styles.edge])),
    // A zoom callout (#176) is dashed like a dashed edge; `solid` drops the
    // dashes and `muted` takes the muted edge's color.
    zoom: {
      default: styles.edge.dashed,
      solid: { strokeDash: 0 },
      muted: styles.edge.muted,
    },
  };
}

/**
 * Gray fills of the tones in a monochrome theme, in three steps. Hues usually
 * drawn next to each other (warm and cool, light and dark) land in different
 * steps, e.g. orange or blue blocks beside yellow ones.
 */
function grayTones(light: string, middle: string, dark: string): Record<Tone, StyleLayerInput> {
  const steps: Record<Tone, string> = {
    gray: middle,
    red: dark,
    orange: middle,
    yellow: light,
    green: light,
    blue: middle,
    purple: dark,
    pink: dark,
  };
  return Object.fromEntries(
    Object.entries(steps).map(([tone, fill]) => [tone, { fill }]),
  ) as Record<Tone, StyleLayerInput>;
}

/**
 * A junction is a dot in the line color. A hidden junction (#101) draws
 * nothing: its lines meet without a dot (structured figures round the turn
 * through it), or a line ends there in open space. Its zero stroke width
 * makes the point one unit (the mark's smallest size), so in `auto` the gap
 * D2 leaves between lines ending on its outline is closed by their round caps.
 */
const junctionStyles = (line: string, muted: string): VariantStyles["junction"] => ({
  default: { fill: line, stroke: line },
  muted: { fill: muted, stroke: muted },
  hidden: { fill: "transparent", stroke: "transparent", strokeWidth: "0pt" },
});

/**
 * Dim colors (#175, design doc §6.53) of `minimal` and `color`: text and lines
 * in a light gray (about 3:1 on white, like the dimmed panels of DiT's Fig. 3)
 * and fills halfway to white, so a tone stays recognizable but pale.
 */
const DIM_GRAY: NonNullable<ThemeDefinition["dim"]> = {
  fontColor: "#8c959f",
  stroke: "#8c959f",
  lighten: 0.5,
};

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
        filled: filledNode("#e3e3e3"), // tone gray (theme.test.ts checks it)
      },
      label: {
        default: { fill: "transparent", strokeWidth: "0pt" },
        muted: { fontColor: "{color.muted}" },
      },
      junction: junctionStyles("{color.fg}", "{color.muted}"),
      container: {
        muted: { fill: "{color.bg}", fontColor: "{color.muted}", bold: false },
        ...outlineVariants("{color.surface}"),
      },
      legend: legendStyles("{color.bg}", "{color.muted}"),
      edge: {
        dashed: { strokeDash: "{dash.regular}" },
        emphasis: { strokeWidth: "{line.bold}" },
        muted: { stroke: "{color.muted}", fontColor: "{color.muted}" },
      },
    }),
    tones: grayTones("#f2f2f2", "#e3e3e3", "#d4d4d4"),
    dim: DIM_GRAY,
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
        surface: "#f2f2f2",
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
        filled: filledNode("#e3e3e3"), // tone gray (theme.test.ts checks it)
      },
      label: {
        default: { fill: "transparent", strokeWidth: "0pt" },
        muted: { fontColor: "{color.muted}" },
      },
      junction: junctionStyles("{color.line}", "{color.muted}"),
      container: {
        muted: { strokeDash: "{dash.regular}", fontColor: "{color.muted}" },
        ...outlineVariants("{color.surface}"),
      },
      legend: legendStyles("{color.paper}", "{color.frame}"),
      edge: {
        dashed: { strokeDash: "{dash.regular}" },
        emphasis: { strokeWidth: "{line.bold}" },
        muted: { stroke: "{color.muted}", fontColor: "{color.muted}" },
      },
    }),
    tones: grayTones("#f2f2f2", "#e3e3e3", "#d4d4d4"),
    dim: { fontColor: "#8c8c8c", stroke: "#8c8c8c", lighten: 0.5 },
  },
  {
    version: 1,
    id: "slides",
    description: "Large text and thick lines for slides (use with presentation-16x9)",
    fonts: DEFAULT_FONT_SET_ID,
    tokens: {
      // Projectors wash out light grays: muted is darker than minimal's
      // (contrast about 7:1 on white) and the fills stay clearly visible.
      color: {
        fg: "#1a1a1a",
        bg: "#ffffff",
        muted: "#595959",
        surface: "#f2f2f2",
        highlight: "#e0e0e0",
      },
      // presentation-16x9 requires 14pt; edge labels, the smallest text, meet it.
      size: { text: "16pt", small: "14pt", heading: "18pt" },
      // Twice minimal's lines, matching the doubled text.
      line: { regular: "2pt", bold: "4pt" },
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
        emphasis: { fill: "{color.highlight}", strokeWidth: "{line.bold}", bold: true },
        muted: { stroke: "{color.muted}", fontColor: "{color.muted}" },
        filled: filledNode("#d9d9d9"), // tone gray (theme.test.ts checks it)
      },
      label: {
        default: { fill: "transparent", strokeWidth: "0pt" },
        muted: { fontColor: "{color.muted}" },
      },
      junction: junctionStyles("{color.fg}", "{color.muted}"),
      container: {
        muted: { fill: "{color.bg}", fontColor: "{color.muted}", bold: false },
        ...outlineVariants("{color.surface}"),
      },
      legend: legendStyles("{color.bg}", "{color.muted}"),
      edge: {
        dashed: { strokeDash: "{dash.regular}" },
        emphasis: { strokeWidth: "{line.bold}" },
        muted: { stroke: "{color.muted}", fontColor: "{color.muted}" },
      },
    }),
    // Darker than minimal's steps: projectors wash out light grays.
    tones: grayTones("#ebebeb", "#d9d9d9", "#c7c7c7"),
    // Projectors wash out light grays: a darker gray and fills kept nearer their tones.
    dim: { fontColor: "#808080", stroke: "#808080", lighten: 0.4 },
  },
  {
    version: 1,
    id: "color",
    description: "General-purpose theme with color: pastel tone fills, blue accent for emphasis",
    fonts: DEFAULT_FONT_SET_ID,
    tokens: {
      color: {
        fg: "#1f2328",
        bg: "#ffffff",
        muted: "#6e7781",
        surface: "#f6f8fa",
        accent: "#0969da",
      },
      // Light fills: the text (fg) keeps a contrast of at least 11:1 on each.
      tone: {
        gray: "#e6e6e6",
        red: "#f8d0cc",
        orange: "#fbe1c0",
        yellow: "#f7f0b8",
        green: "#d3ead4",
        blue: "#cfe8f3",
        purple: "#e0dcf2",
        pink: "#f9dbe8",
      },
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
        emphasis: { stroke: "{color.accent}", strokeWidth: "{line.bold}", bold: true },
        muted: { stroke: "{color.muted}", fontColor: "{color.muted}" },
        filled: filledNode("{tone.gray}"),
      },
      label: {
        default: { fill: "transparent", strokeWidth: "0pt" },
        muted: { fontColor: "{color.muted}" },
      },
      junction: junctionStyles("{color.fg}", "{color.muted}"),
      container: {
        muted: { fill: "{color.bg}", fontColor: "{color.muted}", bold: false },
        ...outlineVariants("{color.surface}"),
      },
      legend: legendStyles("{color.bg}", "{color.muted}"),
      edge: {
        dashed: { strokeDash: "{dash.regular}" },
        emphasis: { stroke: "{color.accent}", strokeWidth: "{line.bold}" },
        muted: { stroke: "{color.muted}", fontColor: "{color.muted}" },
      },
    }),
    tones: {
      gray: { fill: "{tone.gray}" },
      red: { fill: "{tone.red}" },
      orange: { fill: "{tone.orange}" },
      yellow: { fill: "{tone.yellow}" },
      green: { fill: "{tone.green}" },
      blue: { fill: "{tone.blue}" },
      purple: { fill: "{tone.purple}" },
      pink: { fill: "{tone.pink}" },
    },
    dim: DIM_GRAY,
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
