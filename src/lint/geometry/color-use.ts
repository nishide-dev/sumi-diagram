/**
 * `geometry/theme-color-use` (#513): a figure that picks a theme should look
 * like that theme. A theme may carry `colorUse` guidance (a neutral base with
 * a few accent tones, pale and outlined variants rather than blocks of color);
 * this rule compares the figure's nodes and groups against it:
 *
 * - **accents**: the chromatic tones (every tone but `gray`) that nodes and
 *   groups set, against `maxAccentTones`;
 * - **heavy area**: the share of node area (bounding boxes) that chromatic
 *   nodes of a `heavyVariants` variant cover, against `maxHeavyShare`;
 * - **solid hues**: nodes of variant `solid` with a chromatic tone, against
 *   `maxSolidNodes`: sumi's dark block is the neutral `emphasis`, while a toned
 *   `solid` is a saturated red, green or blue (5A, 7A and 1A of #509).
 *
 * Icons and embedded images, labels, junctions and the parts of legends do not
 * count. The rule is `info`: color taste is guidance, not a defect (like
 * `geometry/color-harmony` and `geometry/color-on-panel`), and the thresholds
 * leave every gallery figure and example rendered in its own theme quiet
 * (docs/design/decisions/513-theme-color-use.md).
 */

import { getTheme } from "../../core/theme/builtin";
import { deltaE, toOklch } from "../../core/theme/color-math";
import { resolveStyle } from "../../core/theme/resolve";
import type { Theme, ThemeColorUse } from "../../core/theme/schema";
import { defineGeometryRule, type LintFinding } from "../rule";
import type { GeometryElement } from "./context";

/** Components that draw no area of their own: text, junction dots, rules, operators, images. */
const UNPAINTED = new Set([
  "sumi/label",
  "sumi/junction",
  "sumi/separator",
  "sumi/operator",
  "sumi/image",
]);
/** A paint within this CIE76 distance of the theme's own color for the tone is that color. */
const SAME_PAINT = 1;
/**
 * An overriding paint below this OKLCH chroma is a true gray. Pale tones sit
 * just above it (sumi's blue fill has 0.012), so a pale tint overridden with
 * another pale tint stays chromatic; a warm gray such as #efeddd (0.016) too.
 */
const NEUTRAL_CHROMA = 0.008;

export interface ToneUse {
  /** The tone's name; `gray` when an override paints the gray tone in a hue. */
  readonly tone: string;
  /** The nodes and groups that paint it, in document order. */
  readonly elements: readonly GeometryElement[];
}

export interface ColorUse {
  /** The accent hues used, most used first. */
  readonly accents: readonly ToneUse[];
  /** Chromatic nodes of a heavy variant, in document order. */
  readonly heavy: readonly GeometryElement[];
  /** Their share of the painted node area (0 to 1). */
  readonly heavyShare: number;
  /** Chromatic nodes of variant `solid`, in document order. */
  readonly solid: readonly GeometryElement[];
}

const area = (element: GeometryElement): number =>
  element.bbox === undefined ? 0 : element.bbox.width * element.bbox.height;

const isHex = (color: string): boolean => /^#[0-9a-f]{6}$/i.test(color);

/** The color the element is mainly painted in: the fill of a block, else its frame. */
function paintOf(element: GeometryElement, heavy: boolean): string | undefined {
  const { style } = element.ir;
  const frame = style.strokeWidth.units > 0 ? style.stroke : style.fill;
  const color = heavy ? style.fill : frame;
  return isHex(color) ? color.toLowerCase() : undefined;
}

/**
 * The hue an element paints, or `undefined` if it paints a neutral. The tone's
 * name says so unless the figure overrides the paint (`solidFills`,
 * `themeOverrides.tones`, a palette): then the resolved color is judged.
 */
const NEUTRALS = new WeakMap<Theme, readonly string[]>();
const NEUTRAL_VARIANTS = ["default", "emphasis", "muted", "solid", "filled", "outlined", "tinted"];

/** Colors the theme paints in gray (tone `gray` or none) on a box, for every variant. */
function neutralsOf(theme: Theme | undefined): readonly string[] {
  if (theme === undefined) return [];
  const known = NEUTRALS.get(theme);
  if (known !== undefined) return known;
  const colors = new Set<string>();
  for (const variant of NEUTRAL_VARIANTS) {
    for (const tone of [undefined, "gray"] as const) {
      const { style } = resolveStyle(theme, {
        kind: "node",
        id: "sumi/box",
        variant,
        ...(tone !== undefined && { tone }),
      });
      for (const color of [style.fill, style.stroke, style.fontColor]) {
        if (isHex(color)) colors.add(color.toLowerCase());
      }
    }
  }
  const list = [...colors];
  NEUTRALS.set(theme, list);
  return list;
}

function hueOf(
  element: GeometryElement,
  theme: Theme | undefined,
  heavy: boolean,
): string | undefined {
  const { ir } = element;
  if (ir.kind === "edge") return undefined;
  const tone = ir.tone ?? "gray";
  const actual = paintOf(element, heavy);
  const paintFor = (withTone: boolean): string | undefined => {
    if (theme === undefined) return undefined;
    const { style } = resolveStyle(theme, {
      kind: ir.kind,
      id: ir.component,
      variant: ir.variant,
      ...(withTone && ir.tone !== undefined && { tone: ir.tone }),
    });
    const color = heavy ? style.fill : style.strokeWidth.units > 0 ? style.stroke : style.fill;
    return isHex(color) ? color : undefined;
  };
  if (actual === undefined) return tone === "gray" ? undefined : tone;
  const own = paintFor(true);
  if (own !== undefined && deltaE(actual, own) <= SAME_PAINT)
    return tone === "gray" ? undefined : tone;
  // The theme's own neutrals (ink, canvas, gray tone and the dark block) are no hue.
  if (neutralsOf(theme).some((color) => deltaE(actual, color) <= SAME_PAINT)) return undefined;
  // An override: judge the painted color, whatever the tone's name.
  return toOklch(actual).c < NEUTRAL_CHROMA ? undefined : tone;
}

/** Measures what the figure's nodes and groups paint, against the heavy variants of `guidance`. */
export function colorUseOf(
  elements: readonly GeometryElement[],
  guidance: Pick<ThemeColorUse, "heavyVariants">,
  theme?: Theme,
): ColorUse {
  const byTone = new Map<string, GeometryElement[]>();
  const heavy: GeometryElement[] = [];
  const solid: GeometryElement[] = [];
  let painted = 0;
  let heavyArea = 0;
  for (const element of elements) {
    const { ir } = element;
    if (ir.kind === "edge") continue;
    // A legend's samples repeat the figure's colors: they are not choices of their own.
    if (ir.legend !== undefined) continue;
    if (ir.kind === "node" && (ir.image !== undefined || UNPAINTED.has(ir.component))) continue;
    const isHeavy = ir.kind === "node" && guidance.heavyVariants.includes(ir.variant);
    const hue = hueOf(element, theme, isHeavy);
    if (hue !== undefined) byTone.set(hue, [...(byTone.get(hue) ?? []), element]);
    if (ir.kind !== "node") continue;
    painted += area(element);
    if (isHeavy && hue !== undefined) {
      heavy.push(element);
      if (ir.variant === "solid") solid.push(element);
      heavyArea += area(element);
    }
  }
  const accents = [...byTone]
    .map(([tone, list]) => ({ tone, elements: list }))
    .sort((a, b) => b.elements.length - a.elements.length);
  return { accents, heavy, heavyShare: painted === 0 ? 0 : heavyArea / painted, solid };
}

const names = (elements: readonly GeometryElement[], count = 4): string => {
  const list = elements.slice(0, count).map((e) => e.name);
  return list.join(", ") + (elements.length > count ? `, and ${elements.length - count} more` : "");
};

const percent = (share: number): string => `${Math.round(share * 100)}%`;

/** The findings for a figure's color use against a theme's guidance. */
export function colorUseFindings(
  themeId: string,
  figureId: string,
  elements: readonly GeometryElement[],
  guidance: ThemeColorUse,
  theme?: Theme,
): LintFinding[] {
  const use = colorUseOf(elements, guidance, theme);
  const subject = { kind: "figure", id: figureId } as const;
  const path = ["figure", "theme"];
  const findings: LintFinding[] = [];
  const calm = guidance.preferredVariants.filter((v) => v !== "emphasis");
  const target = calm[0] ?? "default";
  const variants = guidance.heavyVariants.join(" or ");
  if (use.accents.length > guidance.maxAccentTones) {
    const extra = use.accents.slice(guidance.maxAccentTones);
    const kept = use.accents.slice(0, guidance.maxAccentTones);
    findings.push({
      message: `The figure uses ${use.accents.length} accent tones (${use.accents.map((a) => a.tone).join(", ")}); theme ${themeId} is neutral with at most ${guidance.maxAccentTones}.`,
      path,
      subject,
      hint: `Keep ${kept.map((a) => a.tone).join(", ") || "gray"} for what carries meaning and change ${extra
        .map((a) => `${a.tone} (${names(a.elements, 3)})`)
        .join(", ")} to tone gray or to a kept tone.`,
      related: extra.flatMap((a) =>
        a.elements.slice(0, 2).map((e) => ({
          path: e.docPath,
          message: `${e.name[0]?.toUpperCase()}${e.name.slice(1)} sets tone ${a.tone}.`,
        })),
      ),
    });
  }
  if (use.heavyShare > guidance.maxHeavyShare) {
    findings.push({
      message: `${percent(use.heavyShare)} of the node area is a block of color (${use.heavy.length} ${use.heavy.length === 1 ? "node" : "nodes"} of variant ${variants} with a tone: ${names(use.heavy)}); theme ${themeId} allows ${percent(guidance.maxHeavyShare)}.`,
      path,
      subject,
      hint: `Change most of them from ${[...new Set(use.heavy.map((e) => e.ir.variant))].join(" / ")} to ${calm.join(" or ") || target}${guidance.preferredVariants.includes("emphasis") ? ", and keep emphasis (without a tone) for the one element that matters" : ""}.`,
      related: use.heavy.slice(0, 3).map((e) => ({
        path: e.docPath,
        message: `${e.name[0]?.toUpperCase()}${e.name.slice(1)} is ${e.ir.variant} with tone ${e.ir.tone}.`,
      })),
    });
  }
  if (use.solid.length > guidance.maxSolidNodes) {
    findings.push({
      message: `${use.solid.length} ${use.solid.length === 1 ? "node is" : "nodes are"} solid with a tone (${use.solid
        .slice(0, 4)
        .map((e) => `${e.name} ${e.ir.tone}`)
        .join(
          ", ",
        )}${use.solid.length > 4 ? `, and ${use.solid.length - 4} more` : ""}): a dark block of saturated hue; theme ${themeId} allows ${guidance.maxSolidNodes === 0 ? "none" : `${guidance.maxSolidNodes}`}.`,
      path,
      subject,
      hint: `For the one element that matters, set variant emphasis and delete its tone (emphasis keeps a node's tone, so it would stay a hue); give the rest ${calm.join(" or ") || target} with the tone.`,
      related: use.solid.slice(0, 3).map((e) => ({
        path: e.docPath,
        message: `${e.name[0]?.toUpperCase()}${e.name.slice(1)} is solid with tone ${e.ir.tone}.`,
      })),
    });
  }
  return findings;
}

export const themeColorUse = defineGeometryRule({
  id: "geometry/theme-color-use",
  description:
    "The figure uses more accent tones or more blocks of color (filled and solid variants) than its theme's color guidance prefers.",
  defaultSeverity: "info",
  fixable: false,
  run(context) {
    const { ir } = context;
    const theme = getTheme(ir.meta.themeId);
    const guidance = theme?.colorUse;
    if (guidance === undefined) return [];
    return colorUseFindings(ir.meta.themeId, ir.meta.id, context.elements, guidance, theme);
  },
});
