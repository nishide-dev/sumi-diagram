/**
 * Style resolution (design doc §4.3) and stage `theme` (`style` in §0).
 *
 * Order, property by property with later layers winning: Sumi's built-in kind
 * defaults → theme `base.<kind>` → `components.<id>.default` →
 * `components.<id>.<variant>` → the tone's layer (only for an element that
 * sets `tone`; colors only). The tone's layer is `tones.<tone>` (the fill)
 * for a node or group, and `toneLines.<tone>` (the line and text colors,
 * #177) for a node or group in the {@link OUTLINED_VARIANT} variant and for
 * an edge. A variant the manifest has but the theme does not define falls
 * back to `default` with a `theme/missing-variant` warning; a tone the theme
 * does not define is left out with `theme/missing-tone`.
 * Node `solid` and `tinted` (#214) compose `tones` and `toneLines` instead;
 * their neutral default is gray. Tinted ink is darkened for text contrast.
 *
 * A dimmed element (#175: inside a group with `dim: true`, see `dim.ts`) then
 * takes the theme's dim colors.
 */

import { type CheckState, type ElementKey, figureElements, groupKey } from "../check-state";
import type { Diagnostic, DocPath } from "../diagnostics";
import type { Locator } from "../figure/yaml";
import type { FontUsage } from "../profile/constrain";
import type { ComponentId, ComponentKind } from "../registry/manifest";
import { resolveTheme } from "./builtin";
import { dimmedElements, dimStyle } from "./dim";
import { filledToneNode } from "./node-variants";
import type { Theme } from "./schema";
import {
  mergeStyle,
  type NodeStyle,
  type ResolvedStyle,
  type StyleOf,
  sublabelFontSize,
} from "./style";
import type { Tone } from "./tones";

/**
 * The variant whose tone colors the outline and the text instead of the
 * fill (#177, design doc §6.54): a node or group in it takes
 * `toneLines.<tone>`, not `tones.<tone>`.
 */
export const OUTLINED_VARIANT = "outlined";

export interface StyleTarget<K extends ComponentKind = ComponentKind> {
  kind: K;
  /** Canonical component ID. */
  id: ComponentId;
  variant: string;
  /** The element's tone, if it sets one. */
  tone?: Tone | undefined;
  /**
   * Take the tone's line layer (`toneLines`) whatever the variant: the text
   * of a matrix header with a tone (#180).
   */
  toneText?: boolean | undefined;
}

/** Which of a theme's tone layers an element takes: `tones` or `toneLines` (#177). */
export function toneField(kind: ComponentKind, variant: string): "tones" | "toneLines" {
  return kind === "edge" || variant === OUTLINED_VARIANT ? "toneLines" : "tones";
}

export interface StyleResolution<K extends ComponentKind = ComponentKind> {
  /** The complete, frozen effective style. */
  style: StyleOf<K>;
  /** `true` if the theme does not define the (non-default) variant; `default` was used. */
  missingVariant: boolean;
  /** `true` if a tone was requested that the theme does not define; it was left out. */
  missingTone: boolean;
}

/** Resolves the effective style of a component variant under a theme. */
export function resolveStyle<K extends ComponentKind>(
  theme: Theme,
  target: StyleTarget<K>,
): StyleResolution<K> {
  const { kind, id, variant, tone } = target;
  const layers = theme.components.get(id);
  const variantLayer = variant === "default" ? undefined : layers?.get(variant);
  const field = target.toneText === true ? "toneLines" : toneField(kind, variant);
  const toneLayer = tone === undefined ? undefined : theme[field].get(tone);
  // Compose both palettes only for the new node variants. Gray is their neutral default.
  if (
    kind === "node" &&
    variantLayer !== undefined &&
    (variant === "solid" || variant === "tinted") &&
    target.toneText !== true
  ) {
    const fill = theme.tones.get(tone ?? "gray")?.fill;
    const ink = theme.toneLines.get(tone ?? "gray")?.stroke;
    const paint =
      ink !== undefined && (variant === "solid" || fill !== undefined)
        ? filledToneNode(variant, fill ?? "#ffffff", ink, id === "sumi/stack")
        : undefined;
    return {
      style: mergeStyle(kind, [theme.base[kind], layers?.get("default"), variantLayer, paint]),
      missingVariant: false,
      missingTone:
        tone !== undefined && (ink === undefined || (variant === "tinted" && fill === undefined)),
    };
  }
  return {
    style: mergeStyle(kind, [theme.base[kind], layers?.get("default"), variantLayer, toneLayer]),
    missingVariant: variant !== "default" && variantLayer === undefined,
    missingTone: tone !== undefined && toneLayer === undefined,
  };
}

/**
 * Runs the `theme` stage: resolves `figure.theme` (reporting `theme/unknown`)
 * and records the effective style of every valid element with a resolved
 * component in `state.styles`. Returns the theme, or `undefined` if the figure
 * has none or it is unknown (then no element is styled).
 */
export function styleFigure(state: CheckState, locate: Locator): Theme | undefined {
  const styles = new Map<ElementKey, ResolvedStyle>();
  state.styles = styles;
  const name = state.doc.figure?.theme;
  if (name === undefined) return undefined;
  const resolved = resolveTheme(name, ["figure", "theme"], locate);
  state.diagnostics.push(...resolved.diagnostics);
  if (!resolved.ok) return undefined;
  const theme = resolved.value;
  const dimmed = dimmedElements(state.doc);
  reportDim(state, locate, theme, dimmed);

  for (const entry of figureElements(state.doc)) {
    const { key, path, subject } = entry;
    const component = state.components?.get(key);
    if (state.invalid.has(key) || component === undefined) continue;
    const { id, manifest, variant } = component;
    const tone = entry.element.tone;
    const paint = state.doc.paints?.get(key);
    const resolution = resolveStyle(theme, {
      kind: manifest.kind,
      id,
      variant,
      tone,
      ...(paint?.toneText === true && { toneText: true }),
    });
    const { missingVariant, missingTone } = resolution;
    // A hatched matrix cell or legend sample (#180): lines in the tone's line color, gray's without one.
    const painted =
      paint?.hatch === true && resolution.style.kind === "node"
        ? hatched(theme, resolution.style, tone)
        : resolution.style;
    // A node's own `mono` (#279) overrides the theme's: true needs the font set's mono font.
    const mono = entry.kind === "node" ? entry.element.mono : paint?.mono;
    if (mono === true && theme.fontSet.mono === undefined) {
      const at = [...path, "mono"];
      const location = locate(at);
      state.diagnostics.push({
        code: "theme/missing-font",
        severity: "error",
        message: `Node "${subject.id}" asks for monospace text, but font set ${theme.fontSet.id} has no mono font.`,
        path: at,
        ...(location !== undefined && { location }),
        subject,
        hint: "Use a theme whose font set has a mono font (every built-in theme has one), or remove mono.",
      });
      state.invalid.add(key);
      continue;
    }
    const style: ResolvedStyle =
      mono === undefined || mono === painted.mono ? painted : Object.freeze({ ...painted, mono });
    if (missingVariant) {
      const at = [...path, "variant"];
      const location = locate(at);
      const warning: Diagnostic = {
        code: "theme/missing-variant",
        severity: "warning",
        message: `Theme "${theme.id}" does not define variant "${variant}" of ${id}; using its default style.`,
        path: at,
        ...(location !== undefined && { location }),
        subject,
        hint: `Add components.${id}.${variant} to the theme, or use another variant.`,
      };
      state.diagnostics.push(warning);
    }
    if (missingTone) {
      const at = [...path, "tone"];
      const location = locate(at);
      const warning: Diagnostic = {
        code: "theme/missing-tone",
        severity: "warning",
        message: `Theme "${theme.id}" does not define tone "${tone}"; ${subject.kind} "${subject.id}" is drawn without it.`,
        path: at,
        ...(location !== undefined && { location }),
        subject,
        hint: `Add ${manifest.kind === "node" && (variant === "solid" || variant === "tinted") ? (variant === "solid" ? "toneLines" : "tones and toneLines") : paint?.toneText === true ? "toneLines" : toneField(manifest.kind, variant)}.${tone} to the theme, or use another tone.`,
      };
      state.diagnostics.push(warning);
    }
    const dim = theme.dim !== undefined && dimmed.has(key) ? theme.dim : undefined;
    const dimmedStyle =
      dim === undefined
        ? style
        : dimStyle(style, dim, manifest.kind === "node" && variant === "solid");
    styles.set(
      key,
      dim !== undefined && id === "sumi/stack" && variant === "solid"
        ? Object.freeze({ ...dimmedStyle, stroke: dimmedStyle.fontColor })
        : dimmedStyle,
    );
  }
  return theme;
}

/**
 * The style of a hatched node (#180): its hatch lines take the stroke of
 * the tone's line layer (`toneLines.<tone>`, gray's without a tone), or the
 * node's own stroke if the theme has neither.
 */
function hatched(theme: Theme, style: NodeStyle, tone: Tone | undefined): NodeStyle {
  const hatch = theme.toneLines.get(tone ?? "gray")?.stroke ?? style.stroke;
  return Object.freeze({ ...style, hatch });
}

/**
 * Warnings about `dim` (#175): a theme without dim colors (`theme/missing-dim`
 * at each `dim: true`; the groups are drawn as they are), and an image inside
 * a dimmed group (`theme/undimmed-image`: an image is drawn as it is, since
 * Sumi dims by color, not by opacity).
 */
export function reportDim(
  state: CheckState,
  locate: Locator,
  theme: Theme,
  dimmed: ReadonlyMap<ElementKey, DocPath>,
): void {
  const warn = (diagnostic: Omit<Diagnostic, "severity" | "location">) => {
    const location = locate(diagnostic.path ?? []);
    state.diagnostics.push({
      ...diagnostic,
      severity: "warning",
      ...(location !== undefined && { location }),
    });
  };
  if (theme.dim === undefined) {
    for (const [index, g] of (state.doc.groups ?? []).entries()) {
      if (g?.dim !== true || state.invalid.has(groupKey(g.id))) continue;
      warn({
        code: "theme/missing-dim",
        message: `Theme "${theme.id}" defines no dim colors; group "${g.id}" is drawn as it is.`,
        path: ["groups", index, "dim"],
        subject: { kind: "group", id: g.id },
        hint: "Add dim (fontColor, stroke, lighten) to the theme, or use a built-in theme.",
      });
    }
    return;
  }
  for (const { key, path, subject, element } of figureElements(state.doc)) {
    const from = dimmed.get(key);
    if (from === undefined || state.invalid.has(key)) continue;
    const manifest = state.components?.get(key)?.manifest;
    if (manifest?.kind !== "node" || manifest.embed !== "image") continue;
    const group = state.doc.groups?.[from[1] as number]?.id ?? "";
    warn({
      code: "theme/undimmed-image",
      message: `Image "${element.id ?? subject.id}" is inside dimmed group "${group}" but is drawn as it is; Sumi dims colors, not images.`,
      path: [...path],
      subject,
      hint: "Move the image out of the dimmed group, or use a paler image file.",
    });
  }
}

/**
 * Effective font sizes for the `profile` stage: one per styled element that
 * draws text: a label, or a glyph mark (`sumi/operator`). Point marks
 * (`sumi/junction`) and unlabeled elements draw no text, so their font size
 * cannot violate a minimum. A node's sublabel (#184) adds its own, smaller
 * size.
 */
export function labelFontUsages(state: CheckState): FontUsage[] {
  const usages: FontUsage[] = [];
  for (const { key, element } of figureElements(state.doc)) {
    const style = state.styles?.get(key);
    // A mark draws its glyph (or, for a point, nothing) instead of the label.
    const manifest = state.components?.get(key)?.manifest;
    const mark = manifest?.kind === "node" ? manifest.mark : undefined;
    const text = mark === undefined ? element.label !== "" : mark.type === "glyph";
    if (style !== undefined && text) {
      usages.push({ key, fontSizePt: style.fontSize.pt });
    }
    // A node's sublabel (#184) is drawn smaller than its label.
    const sublabel = "sublabel" in element ? element.sublabel : undefined;
    if (style !== undefined && mark === undefined && sublabel !== undefined) {
      usages.push({ key, fontSizePt: sublabelFontSize(style.fontSize).pt, sublabel: true });
    }
  }
  return usages;
}
