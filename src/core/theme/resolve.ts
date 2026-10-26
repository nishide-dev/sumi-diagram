/**
 * Style resolution (design doc §4.3) and stage `theme` (`style` in §0).
 *
 * Order, property by property with later layers winning: Sumi's built-in kind
 * defaults → theme `base.<kind>` → `components.<id>.default` →
 * `components.<id>.<variant>` → `tones.<tone>` (only for a node or group that
 * sets `tone`; colors only). A variant the manifest has but the theme does not
 * define falls back to `default` with a `theme/missing-variant` warning; a
 * tone the theme does not define is left out with `theme/missing-tone`.
 */

import { type CheckState, type ElementKey, figureElements } from "../check-state";
import type { Diagnostic } from "../diagnostics";
import type { Locator } from "../figure/yaml";
import type { FontUsage } from "../profile/constrain";
import type { ComponentId, ComponentKind } from "../registry/manifest";
import { resolveTheme } from "./builtin";
import type { Theme } from "./schema";
import { mergeStyle, type ResolvedStyle, type StyleOf } from "./style";
import type { Tone } from "./tones";

export interface StyleTarget<K extends ComponentKind = ComponentKind> {
  kind: K;
  /** Canonical component ID. */
  id: ComponentId;
  variant: string;
  /** The element's tone, if it sets one (nodes and groups only). */
  tone?: Tone | undefined;
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
  const toned = tone !== undefined && kind !== "edge";
  const toneLayer = toned ? theme.tones.get(tone) : undefined;
  return {
    style: mergeStyle(kind, [theme.base[kind], layers?.get("default"), variantLayer, toneLayer]),
    missingVariant: variant !== "default" && variantLayer === undefined,
    missingTone: toned && toneLayer === undefined,
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

  for (const entry of figureElements(state.doc)) {
    const { key, path, subject } = entry;
    const component = state.components?.get(key);
    if (state.invalid.has(key) || component === undefined) continue;
    const { id, manifest, variant } = component;
    const tone = entry.kind === "edge" ? undefined : entry.element.tone;
    const { style, missingVariant, missingTone } = resolveStyle(theme, {
      kind: manifest.kind,
      id,
      variant,
      tone,
    });
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
        hint: `Add tones.${tone} to the theme, or use another tone.`,
      };
      state.diagnostics.push(warning);
    }
    styles.set(key, style);
  }
  return theme;
}

/**
 * Effective font sizes for the `profile` stage: one per styled element that
 * has a label, or draws a glyph mark (`sumi/operator`). Other unlabeled
 * elements draw no text, so their font size cannot violate a minimum.
 */
export function labelFontUsages(state: CheckState): FontUsage[] {
  const usages: FontUsage[] = [];
  for (const { key, element } of figureElements(state.doc)) {
    const style = state.styles?.get(key);
    const manifest = state.components?.get(key)?.manifest;
    const glyph = manifest?.kind === "node" && manifest.mark?.type === "glyph";
    if (style !== undefined && (element.label !== "" || glyph)) {
      usages.push({ key, fontSizePt: style.fontSize.pt });
    }
  }
  return usages;
}
