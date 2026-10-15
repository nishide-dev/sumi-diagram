/**
 * Style resolution (design doc §4.3) and stage `theme` (`style` in §0).
 *
 * Order, property by property with later layers winning: Sumi's built-in kind
 * defaults → theme `base.<kind>` → `components.<id>.default` →
 * `components.<id>.<variant>`. A variant the manifest has but the theme does
 * not define falls back to `default` with a `theme/missing-variant` warning.
 */

import { type CheckState, type ElementKey, figureElements } from "../check-state";
import type { Diagnostic } from "../diagnostics";
import type { Locator } from "../figure/yaml";
import type { FontUsage } from "../profile/constrain";
import type { ComponentId, ComponentKind } from "../registry/manifest";
import { resolveTheme } from "./builtin";
import type { Theme } from "./schema";
import { mergeStyle, type ResolvedStyle, type StyleOf } from "./style";

export interface StyleTarget<K extends ComponentKind = ComponentKind> {
  kind: K;
  /** Canonical component ID. */
  id: ComponentId;
  variant: string;
}

export interface StyleResolution<K extends ComponentKind = ComponentKind> {
  /** The complete, frozen effective style. */
  style: StyleOf<K>;
  /** `true` if the theme does not define the (non-default) variant; `default` was used. */
  missingVariant: boolean;
}

/** Resolves the effective style of a component variant under a theme. */
export function resolveStyle<K extends ComponentKind>(
  theme: Theme,
  target: StyleTarget<K>,
): StyleResolution<K> {
  const { kind, id, variant } = target;
  const layers = theme.components.get(id);
  const variantLayer = variant === "default" ? undefined : layers?.get(variant);
  return {
    style: mergeStyle(kind, [theme.base[kind], layers?.get("default"), variantLayer]),
    missingVariant: variant !== "default" && variantLayer === undefined,
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

  for (const { key, path, subject } of figureElements(state.doc)) {
    const component = state.components?.get(key);
    if (state.invalid.has(key) || component === undefined) continue;
    const { id, manifest, variant } = component;
    const { style, missingVariant } = resolveStyle(theme, { kind: manifest.kind, id, variant });
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
    styles.set(key, style);
  }
  return theme;
}

/**
 * Effective font sizes for the `profile` stage: one per styled element that
 * has a label. Unlabeled elements draw no text, so their font size cannot
 * violate a minimum.
 */
export function labelFontUsages(state: CheckState): FontUsage[] {
  const usages: FontUsage[] = [];
  for (const { key, element } of figureElements(state.doc)) {
    const style = state.styles?.get(key);
    if (style !== undefined && element.label !== "") {
      usages.push({ key, fontSizePt: style.fontSize.pt });
    }
  }
  return usages;
}
