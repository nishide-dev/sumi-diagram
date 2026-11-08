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
import { chatVisuals } from "../figure/chat";
import type { Locator } from "../figure/yaml";
import type { FontUsage } from "../profile/constrain";
import { OPERATOR_SIZES, SEPARATOR_ID } from "../registry/builtins";
import type { ComponentId, ComponentKind } from "../registry/manifest";
import { resolveTheme } from "./builtin";
import { dimmedElements, dimStyle } from "./dim";
import { contrastRatio as contrast, filledToneNode, readableInk } from "./node-variants";
import { figureTheme } from "./overrides";
import type { Theme, ToneOverride } from "./schema";
import { withRadius, withStrokes } from "./strokes";
import {
  mergeStyle,
  type NodeStyle,
  type ResolvedStyle,
  type StyleLayer,
  type StyleOf,
  sublabelFontSize,
} from "./style";
import { isTone, type Tone } from "./tones";

/**
 * The variant whose tone colors the outline and the text instead of the
 * fill (#177, design doc §6.54): a node or group in it takes
 * `toneLines.<tone>`, not `tones.<tone>`.
 */
export const OUTLINED_VARIANT = "outlined";

const CONTAINER_ID = "sumi/container";

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

/**
 * The variant that draws a dashed element's line as round dots (#427): an
 * edge or a container takes the theme's `dashed` style with dots instead of
 * dashes, so no theme needs a layer of its own.
 */
export const DOTTED_VARIANT = "dotted";

/** Resolves the effective style of a component variant under a theme. */
export function resolveStyle<K extends ComponentKind>(
  theme: Theme,
  target: StyleTarget<K>,
): StyleResolution<K> {
  const { kind, id, variant, tone } = target;
  if (variant === DOTTED_VARIANT && (kind === "edge" || id === CONTAINER_ID)) {
    const dashed = resolveStyle(theme, { ...target, variant: "dashed" });
    return {
      ...dashed,
      style: Object.freeze({ ...dashed.style, strokeDash: 0, strokeDotted: true }) as StyleOf<K>,
    };
  }
  const layers = theme.components.get(id);
  const variantLayer = variant === "default" ? undefined : layers?.get(variant);
  const field =
    target.toneText === true || id === SEPARATOR_ID ? "toneLines" : toneField(kind, variant);
  const toneLayer = tone === undefined ? undefined : theme[field].get(tone);
  // Compose both palettes only for the new node variants. Gray is their neutral default.
  if (
    kind === "node" &&
    id !== SEPARATOR_ID &&
    variantLayer !== undefined &&
    (variant === "solid" || variant === "tinted") &&
    target.toneText !== true
  ) {
    const fill = theme.tones.get(tone ?? "gray")?.fill;
    const ink = theme.toneLines.get(tone ?? "gray")?.stroke;
    const filled =
      ink !== undefined && (variant === "solid" || fill !== undefined)
        ? filledToneNode(variant, fill ?? "#ffffff", ink, id === "sumi/stack")
        : undefined;
    const paint = overriddenTone(filled, variant, theme.toneOverrides?.get(tone ?? "gray"));
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
 * A tinted or solid node in a tone the figure overrides (#380). Tinted: an
 * explicit `line` is the frame as written (only text is darkened for
 * contrast), and an explicit `text` the text as written. Solid: the fill is
 * the line color, so its white text is contrast-adjusted as with
 * `solidFills`; `text` (meant for pale fills) does not apply.
 */
function overriddenTone(
  paint: StyleLayer | undefined,
  variant: "solid" | "tinted",
  override: ToneOverride | undefined,
): StyleLayer | undefined {
  if (paint === undefined || override === undefined) return paint;
  if (variant === "solid")
    return override.line === undefined
      ? paint
      : { ...paint, fontColor: readableInk(override.line, "#ffffff") };
  return {
    ...paint,
    ...(override.line !== undefined && { stroke: override.line }),
    ...(override.text !== undefined && { fontColor: override.text }),
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
  const overrides = state.doc.figure?.themeOverrides;
  const theme = figureTheme(resolved.value, overrides);
  reportToneContrast(state, locate, theme);
  const dimmed = dimmedElements(state.doc);
  const chatParts = chatVisuals(state);
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
    const hatchedStyle =
      paint?.hatch === true && resolution.style.kind === "node"
        ? hatched(theme, resolution.style, tone)
        : resolution.style;
    // The empty body of a glyph or set sample in a legend (#409): nothing is drawn but the sample.
    const painted =
      paint?.bare === true && hatchedStyle.kind === "node"
        ? Object.freeze({
            ...hatchedStyle,
            fill: "transparent",
            stroke: "transparent",
            strokeWidth: { pt: 0, units: 0 },
          })
        : hatchedStyle;
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
    let style: ResolvedStyle =
      mono === undefined || mono === painted.mono ? painted : Object.freeze({ ...painted, mono });
    if (chatParts.has(key)) {
      // Annotation size follows the theme's small edge text; muted label ink is theme-owned.
      const small = resolveStyle(theme, { kind: "edge", id: "sumi/line", variant: "default" }).style
        .fontSize;
      const muted = resolveStyle(theme, { kind: "node", id: "sumi/label", variant: "muted" }).style
        .fontColor;
      style = Object.freeze({ ...style, fontSize: small, fontColor: muted });
    }
    const solidFill = overrides?.solidFills?.[tone ?? "gray"];
    if (
      solidFill !== undefined &&
      style.kind === "node" &&
      variant === "solid" &&
      id !== SEPARATOR_ID
    )
      style = Object.freeze({
        ...style,
        fill: solidFill,
        stroke: id === "sumi/stack" ? "#ffffff" : solidFill,
        fontColor: readableInk(solidFill, "#ffffff"),
      });
    if (
      overrides?.dashedGroupStroke !== undefined &&
      style.kind === "group" &&
      variant === "dashed"
    )
      style = Object.freeze({ ...style, stroke: overrides.dashedGroupStroke });
    else if (overrides?.groupStroke !== undefined && id === CONTAINER_ID && style.kind === "group")
      style = Object.freeze({ ...style, stroke: overrides.groupStroke });
    if (
      overrides?.groupFill !== undefined &&
      id === CONTAINER_ID &&
      style.kind === "group" &&
      tone === undefined &&
      style.fill !== "transparent"
    )
      style = Object.freeze({ ...style, fill: overrides.groupFill });
    // `sumi/operator` props.size (#311): the circle is a multiple of the font size, so scale that.
    if (id === "sumi/operator" && style.kind === "node") {
      const scale = OPERATOR_SIZES[component.props.size as keyof typeof OPERATOR_SIZES] ?? 1;
      if (scale !== 1) {
        const units = Math.round(style.fontSize.units * scale);
        style = Object.freeze({ ...style, fontSize: { pt: units / 2, units } });
      }
    }
    // Line widths, arrowhead sizes and frame corners (#427): the figure's, then the element's.
    {
      const frame = style.kind === "group";
      const reference =
        overrides?.lineWidth === undefined || frame
          ? style.strokeWidth
          : resolveStyle(theme, { kind: manifest.kind, id, variant: "default" }).style.strokeWidth;
      style = withStrokes(style, {
        figure: overrides,
        element: entry.element,
        frame,
        reference,
      });
      if (frame) style = withRadius(style, overrides?.cornerRadius);
    }
    if (overrides?.nodeCorners === "square" && style.kind !== "edge")
      style = Object.freeze({ ...style, radius: { pt: 0, units: 0 } });
    style = withRadius(style, entry.kind === "edge" ? undefined : entry.element.cornerRadius);
    if (overrides?.groupLabelWeight !== undefined && style.kind === "group")
      style = Object.freeze({ ...style, bold: overrides.groupLabelWeight === "bold" });
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
        : dimStyle(
            style,
            dim,
            manifest.kind === "node" && variant === "solid" && id !== SEPARATOR_ID,
          );
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
 * `theme/low-contrast` (#380): an overridden tone's text is drawn without
 * contrast adjustment in two places, so warn below 4.5:1 where the figure
 * actually draws it:
 * - an explicit `text` on the tone's fill: tinted nodes in the tone (gray
 *   for an untoned tinted node);
 * - the tone's text (`text`, else `line`) on white: outlined elements and
 *   labelled edges in the tone, toned matrix headers, `\textcolor` runs.
 */
function reportToneContrast(state: CheckState, locate: Locator, theme: Theme): void {
  if (theme.toneOverrides === undefined) return;
  const { onFill, onWhite } = toneTextUses(state);
  for (const [tone, override] of theme.toneOverrides) {
    const warn = (field: "text" | "line", color: string, background: string, where: string) => {
      const ratio = contrast(background, color);
      if (ratio >= 4.5) return;
      const path = ["figure", "themeOverrides", "tones", tone, field];
      const location = locate(path);
      state.diagnostics.push({
        code: "theme/low-contrast",
        severity: "warning",
        message: `Text color ${color} of tone "${tone}" has a contrast of ${ratio.toFixed(2)}:1 ${where}; text needs at least 4.5:1.`,
        path,
        ...(location !== undefined && { location }),
        hint:
          field === "line"
            ? "Set a darker text color for the tone (or use a darker line color)."
            : "Use a darker text color (or a paler fill), or omit text to darken the line color automatically on fills.",
      });
    };
    const fill = theme.tones.get(tone)?.fill;
    if (
      onFill.has(tone) &&
      override.text !== undefined &&
      fill !== undefined &&
      /^#[0-9a-f]{6}$/i.test(fill)
    )
      warn("text", override.text, fill, `on its fill ${fill} (tinted nodes)`);
    const ink = override.text ?? override.line;
    if (onWhite.has(tone) && ink !== undefined)
      warn(
        override.text !== undefined ? "text" : "line",
        ink,
        "#ffffff",
        "on white (outlined text, toned edge labels, \\textcolor runs)",
      );
  }
}

/** Where a figure draws tone text without adjusting it (#380): see {@link reportToneContrast}. */
function toneTextUses(state: CheckState): { onFill: Set<Tone>; onWhite: Set<Tone> } {
  const onFill = new Set<Tone>();
  const onWhite = new Set<Tone>();
  for (const { key, kind, element } of figureElements(state.doc)) {
    const component = state.components?.get(key);
    const tone = element.tone;
    if (component?.manifest.kind === "node" && component.variant === "tinted")
      onFill.add(tone ?? "gray");
    if (
      tone !== undefined &&
      (component?.variant === OUTLINED_VARIANT ||
        state.doc.paints?.get(key)?.toneText === true ||
        (kind === "edge" && element.label !== undefined && element.label !== ""))
    )
      onWhite.add(tone);
    const texts = [element.label, "sublabel" in element ? element.sublabel : undefined];
    for (const text of texts)
      for (const match of typeof text === "string" ? text.matchAll(/\\textcolor\{(\w+)\}/g) : [])
        if (isTone(match[1] ?? "")) onWhite.add(match[1] as Tone);
  }
  return { onFill, onWhite };
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
