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
import type { ThemeColorUse } from "../../core/theme/schema";
import type { Tone } from "../../core/theme/tones";
import { defineGeometryRule, type LintFinding } from "../rule";
import type { GeometryElement } from "./context";

/** Components that draw no area of their own: text, junction dots, rules, operators. */
const UNPAINTED = new Set(["sumi/label", "sumi/junction", "sumi/separator", "sumi/operator"]);

export interface ToneUse {
  readonly tone: Tone;
  /** Names of the nodes and groups that set the tone, in document order. */
  readonly elements: readonly GeometryElement[];
}

export interface ColorUse {
  /** The accent tones used, most used first. */
  readonly accents: readonly ToneUse[];
  /** Chromatic nodes of a heavy variant, in document order. */
  readonly heavy: readonly GeometryElement[];
  /** Their share of the painted node area (0 to 1). */
  readonly heavyShare: number;
  /** Nodes of variant `solid` with a tone other than `gray`, in document order. */
  readonly solid: readonly GeometryElement[];
}

const area = (element: GeometryElement): number =>
  element.bbox === undefined ? 0 : element.bbox.width * element.bbox.height;

/** Measures what the figure's nodes and groups paint, against the heavy variants of `guidance`. */
export function colorUseOf(
  elements: readonly GeometryElement[],
  guidance: Pick<ThemeColorUse, "heavyVariants">,
): ColorUse {
  const byTone = new Map<Tone, GeometryElement[]>();
  const heavy: GeometryElement[] = [];
  const solid: GeometryElement[] = [];
  let painted = 0;
  let heavyArea = 0;
  for (const element of elements) {
    const { ir } = element;
    if (ir.kind === "edge") continue;
    if (ir.kind === "node" && (ir.icon !== undefined || ir.image !== undefined)) continue;
    const isPart = ir.legend !== undefined;
    const counts = !(ir.kind === "node" && UNPAINTED.has(ir.component));
    const { tone } = ir;
    if (tone !== undefined && tone !== "gray" && counts) {
      byTone.set(tone, [...(byTone.get(tone) ?? []), element]);
    }
    if (ir.kind !== "node" || !counts || isPart) continue;
    painted += area(element);
    if (tone !== undefined && tone !== "gray" && guidance.heavyVariants.includes(ir.variant)) {
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
): LintFinding[] {
  const use = colorUseOf(elements, guidance);
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
      message: `${percent(use.heavyShare)} of the node area is a block of color (${use.heavy.length} nodes of variant ${variants} with a tone: ${names(use.heavy)}); theme ${themeId} allows ${percent(guidance.maxHeavyShare)}.`,
      path,
      subject,
      hint: `Change most of them from ${[...new Set(use.heavy.map((e) => e.ir.variant))].join(" / ")} to ${calm.join(" or ") || target}${guidance.preferredVariants.includes("emphasis") ? ", and keep emphasis for the one element that matters" : ""}.`,
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
      hint: `Use variant emphasis (the theme's own dark block) for the one element that matters and ${calm.join(" or ") || target} for the rest.`,
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
    const guidance = getTheme(ir.meta.themeId)?.colorUse;
    if (guidance === undefined) return [];
    return colorUseFindings(ir.meta.themeId, ir.meta.id, context.elements, guidance);
  },
});
