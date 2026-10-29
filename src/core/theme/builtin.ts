/**
 * Built-in themes (design doc §4.3) and lookup by name. They are
 * domain-neutral and use the bundled font sets; every variant of every built-in
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
 * - `paper` (#173, design doc §6.52): for paper figures, after the reference
 *   figures of #167 (Transformer, DiT, H3-World). Rounded boxes and groups,
 *   pastel tone fills measured from those figures, black 1pt frames, light
 *   gray panels, 0.5pt edges (so arrowheads are small: their size follows the
 *   edge's line width) and Inter for Latin text in structured figures (font
 *   set `sumi/inter-biz-ud-gothic`, #172).
 *
 * Every built-in theme defines `dim` (#175): the gray text and lines and the
 * paler fills of a group with `dim: true` and everything inside it.
 *
 * Tones (#92, design doc §6.20) only change colors, and only of elements
 * that set `tone`. The monochrome themes map the eight tones to three gray
 * fills, so a toned figure still prints in grayscale; tones in the same step
 * look alike there (use `color` to tell all of them apart).
 *
 * Each tone also has a line color (`toneLines`, #177, design doc §6.54): a
 * dark shade of the hue for the outline and text of an `outlined` node and
 * for the line, arrowheads and label of an edge. Every line color has a
 * contrast of at least 4.5:1 on white, so it stays readable as text. The
 * monochrome themes map the tones to three gray steps, as their fills.
 */

import { type DocPath, didYouMean } from "../diagnostics";
import { errorAt } from "../figure/report";
import type { Locator } from "../figure/yaml";
import type { Result } from "../result";
import { DEFAULT_FONT_SET_ID, LATIN_FONT_SET_ID } from "./fonts";
import { type StyleLayerInput, type Theme, type ThemeDefinition, validateTheme } from "./schema";
import { TONE_NAMES, type Tone } from "./tones";

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
  operator?: { default: StyleLayerInput };
  shape: {
    emphasis: StyleLayerInput;
    muted: StyleLayerInput;
    filled: StyleLayerInput;
    outlined: StyleLayerInput;
  };
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

/**
 * Node `outlined` (#177, design doc §6.54): the page's background with the
 * outline and text in a tone's line color, tone gray's unless the node sets
 * a tone (then `toneLines.<tone>` replaces both).
 */
const outlinedNode = (paper: string, line: string): StyleLayerInput => ({
  fill: paper,
  stroke: line,
  fontColor: line,
});
const outlineVariants = (shaded: string): Omit<VariantStyles["container"], "muted"> => ({
  plain: { fill: "transparent", strokeWidth: "0pt" },
  filled: { fill: shaded, strokeWidth: "0pt" },
  dashed: { fill: "transparent", strokeDash: "{dash.regular}" },
});

/** Expands per-category variant styles to every built-in component. */
function componentStyles(styles: VariantStyles): NonNullable<ThemeDefinition["components"]> {
  const shape = {
    ...styles.shape,
    solid: {
      fill: styles.shape.outlined.stroke ?? "#000000",
      stroke: styles.shape.outlined.stroke ?? "#000000",
      fontColor: "#ffffff",
    },
    tinted: { ...styles.shape.outlined, fill: styles.shape.filled.fill ?? "#ffffff" },
  };
  const { filled: _, ...stack } = shape;
  return {
    ...Object.fromEntries(SHAPE_NODES.map((name) => [name, shape])),
    ...(styles.operator && { operator: { ...shape, ...styles.operator } }),
    // Without outlines a stack's rectangles merge into one shape (#174).
    stack: { ...stack, solid: { ...stack.solid, stroke: "#ffffff" } },
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
 * Rounds the corners of the rectangular nodes (box, square) and of the
 * legend's frame (#173). Other shapes have no corners to round (circles,
 * diamonds, …) or draw their own outline (stack, document, …); groups take
 * their radius from `base.group`.
 */
function roundedBoxes(
  components: NonNullable<ThemeDefinition["components"]>,
  node: string,
  legend: string,
): NonNullable<ThemeDefinition["components"]> {
  const rounded = { ...components };
  for (const name of ["box", "square"]) {
    rounded[name] = { ...rounded[name], default: { ...rounded[name]?.default, radius: node } };
  }
  rounded.legend = {
    ...rounded.legend,
    default: { ...rounded.legend?.default, radius: legend },
  };
  return rounded;
}

/**
 * Gray fills of the tones in a monochrome theme, in three steps. Hues usually
 * drawn next to each other (warm and cool, light and dark) land in different
 * steps, e.g. orange or blue blocks beside yellow ones.
 */
function grayTones(light: string, middle: string, dark: string): Record<Tone, StyleLayerInput> {
  return Object.fromEntries(
    Object.entries(graySteps(light, middle, dark)).map(([tone, fill]) => [tone, { fill }]),
  ) as Record<Tone, StyleLayerInput>;
}

/**
 * Gray line colors of the tones in a monochrome theme (#177), in the same
 * three steps as {@link grayTones}: a light fill has the lightest line.
 */
function grayToneLines(light: string, middle: string, dark: string): Record<Tone, StyleLayerInput> {
  return toneLines(graySteps(light, middle, dark));
}

/** Line and text colors (#177) from one color per tone. */
function toneLines(colors: Record<Tone, string>): Record<Tone, StyleLayerInput> {
  return Object.fromEntries(
    Object.entries(colors).map(([tone, color]) => [tone, { stroke: color, fontColor: color }]),
  ) as Record<Tone, StyleLayerInput>;
}

/** The three gray steps of the tones (see {@link grayTones}). */
function graySteps(light: string, middle: string, dark: string): Record<Tone, string> {
  return {
    gray: middle,
    red: dark,
    orange: middle,
    yellow: light,
    green: light,
    blue: middle,
    purple: dark,
    pink: dark,
  };
}

/** References to the eight tokens `<group>.<tone>`, e.g. `{line.orange}`. */
function toneTokens(group: string): Record<Tone, string> {
  return Object.fromEntries(TONE_NAMES.map((tone) => [tone, `{${group}.${tone}}`])) as Record<
    Tone,
    string
  >;
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
        outlined: outlinedNode("{color.bg}", "#525252"), // tone gray's line
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
    toneLines: grayToneLines("#757575", "#525252", "#2e2e2e"),
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
        outlined: outlinedNode("{color.paper}", "#525252"), // tone gray's line
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
    toneLines: grayToneLines("#757575", "#525252", "#2e2e2e"),
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
        outlined: outlinedNode("{color.bg}", "#474747"), // tone gray's line
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
    // Darker than minimal's line colors, as the fills.
    toneLines: grayToneLines("#666666", "#474747", "#262626"),
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
      // Line and text colors of the tones (#177): dark shades of the same
      // hues, each with a contrast of at least 4.8:1 on white.
      ink: {
        gray: "#57606a",
        red: "#cf222e",
        orange: "#bc4c00",
        yellow: "#9a6700",
        green: "#1a7f37",
        blue: "#0969da",
        purple: "#8250df",
        pink: "#bf3989",
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
        outlined: outlinedNode("{color.bg}", "{ink.gray}"),
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
    toneLines: toneLines(toneTokens("ink")),
    dim: DIM_GRAY,
  },
  {
    version: 1,
    id: "paper",
    description:
      "For paper figures: rounded corners, pastel tone fills, small arrowheads, Inter for Latin text",
    fonts: LATIN_FONT_SET_ID,
    tokens: {
      color: {
        text: "#000000",
        line: "#000000",
        paper: "#ffffff",
        // Contrast 4.7:1 on white: muted text stays readable at 7pt.
        muted: "#737373",
        // The light gray of the panels in the Transformer and DiT figures.
        surface: "#f3f3f5",
      },
      // Pastel fills measured from the reference figures (Transformer, DiT);
      // the text (black) keeps a contrast of at least 15:1 on each.
      tone: {
        gray: "#dcdee6",
        red: "#f6dcdb",
        orange: "#f9e0bc",
        yellow: "#f1f4c6",
        green: "#d0e6cd",
        blue: "#cddff6",
        purple: "#dfdcef",
        pink: "#f6d8e5",
      },
      // Line and text colors of the tones (#177): the hues of H3-World's
      // colored frames, text and edges, darkened where needed to a contrast
      // of at least 4.5:1 on white.
      ink: {
        gray: "#6b6e78",
        red: "#c0392b",
        orange: "#bd5410",
        yellow: "#857500",
        green: "#3f7d3a",
        blue: "#2f62b0",
        purple: "#7240a8",
        pink: "#b8336a",
      },
      size: { text: "8pt", small: "7pt", heading: "9pt" },
      // Frames 1pt as in the Transformer figure; edges 0.5pt, which keeps
      // the arrowhead small (its size follows the edge's line width).
      line: { regular: "1pt", edge: "0.5pt", bold: "1.5pt" },
      radius: { node: "2pt", group: "6pt", legend: "3pt" },
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
        fill: "{color.surface}",
        stroke: "{color.line}",
        strokeWidth: "{line.regular}",
        radius: "{radius.group}",
        fontSize: "{size.heading}",
        fontColor: "{color.text}",
        bold: true,
      },
      edge: {
        fill: "{color.paper}",
        stroke: "{color.line}",
        strokeWidth: "{line.edge}",
        fontSize: "{size.small}",
        fontColor: "{color.text}",
        filled: true,
      },
    },
    components: roundedBoxes(
      componentStyles({
        shape: {
          emphasis: { strokeWidth: "{line.bold}", bold: true },
          muted: { stroke: "{color.muted}", fontColor: "{color.muted}" },
          // The borderless rounded fills of the DiT and H3-World figures (#174).
          filled: filledNode("{tone.gray}"),
          // White with a colored frame and text: H3-World's encoders, tokens and keys (#177).
          outlined: outlinedNode("{color.paper}", "{ink.gray}"),
        },
        // The circle is twice the glyph's font size: 14pt rather than 16pt
        // (#215). A 0.5pt frame balances the smaller regular-weight symbol
        // with paper's edges; emphasis retains its existing bold frame.
        operator: { default: { fontSize: "{size.small}", strokeWidth: "{line.edge}" } },
        label: {
          default: { fill: "transparent", strokeWidth: "0pt" },
          muted: { fontColor: "{color.muted}" },
        },
        junction: junctionStyles("{color.line}", "{color.muted}"),
        container: {
          // As the dimmed panels of the DiT figure: gray frame and title, white.
          muted: {
            fill: "{color.paper}",
            stroke: "{color.muted}",
            fontColor: "{color.muted}",
            bold: false,
          },
          // Borderless light gray panels (H3-World (a)(b)), a dashed frame
          // without fill (its (c)), both rounded like every group.
          ...outlineVariants("{color.surface}"),
        },
        legend: legendStyles("{color.paper}", "{color.muted}"),
        edge: {
          dashed: { strokeDash: "{dash.regular}" },
          emphasis: { strokeWidth: "{line.regular}" },
          muted: { stroke: "{color.muted}", fontColor: "{color.muted}" },
        },
      }),
      "{radius.node}",
      "{radius.legend}",
    ),
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
    toneLines: toneLines(toneTokens("ink")),
    // Measured from the dimmed panels of the DiT figure (#175): gray text and
    // lines #949494, tone fills and the panel's surface halfway to white
    // (blue #cddff6 → #e6effb, the surface #f3f3f5 → #f9f9fa).
    dim: { fontColor: "#949494", stroke: "#949494", lighten: 0.5 },
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
