/**
 * Stage `profile` (`constrain` in design doc §0): resolves the figure's output
 * profile and checks constraints that are known before layout.
 *
 * Takes effective font sizes as plain input so it does not depend on how the
 * `theme` stage represents resolved styles.
 */

import type { CheckState, ElementKey } from "../check-state";
import type { DiagnosticSubject, DocPath } from "../diagnostics";
import { errorAt, relatedAt } from "../figure/report";
import type { Locator } from "../figure/yaml";
import { sublabelFontSize } from "../theme/style";
import { scaleFontSize, scaleToReach } from "../theme/text-scale";
import { formatPt } from "../units";
import { resolveProfile } from "./builtin";
import type { Profile } from "./schema";

/** The effective font size of one element, as resolved by the `theme` stage. */
export interface FontUsage {
  key: ElementKey;
  fontSizePt: number;
  /** The size is the element's sublabel's (#184), not its label's. */
  sublabel?: true;
}

export interface ConstrainInput {
  /** Effective font sizes of the elements used in the figure. */
  fonts?: Iterable<FontUsage>;
}

const PROFILE_PATH: DocPath = ["figure", "profile"];

/**
 * Runs the `profile` stage: resolves `figure.profile` (reporting
 * `profile/unknown`) and, if it resolves, checks the font sizes. Returns the
 * profile, or `undefined` if the figure has none or it is unknown.
 */
export function constrainFigure(
  state: CheckState,
  locate: Locator,
  input: ConstrainInput = {},
): Profile | undefined {
  const profile = resolveFigureProfile(state, locate);
  if (profile && input.fonts) checkFontSizes(state, profile, input.fonts, locate);
  return profile;
}

/**
 * Resolves `figure.profile` against the built-in profiles. Reports
 * `profile/unknown` and returns `undefined` for an unknown name; returns
 * `undefined` silently if `figure` itself could not be read.
 */
export function resolveFigureProfile(state: CheckState, locate: Locator): Profile | undefined {
  const name = state.doc.figure?.profile;
  if (name === undefined) return undefined;
  const result = resolveProfile(name, PROFILE_PATH, locate);
  state.diagnostics.push(...result.diagnostics);
  return result.ok ? result.value : undefined;
}

/**
 * Reports `profile/font-too-small` for each valid element whose effective font
 * size is below the profile's `minFontSize`. Sizes are compared in pt without
 * quantization.
 */
export function checkFontSizes(
  state: CheckState,
  profile: Profile,
  fonts: Iterable<FontUsage>,
  locate: Locator,
): void {
  // An explicit placement minimum is checked at final size by geometry lint,
  // including placed HTML and sublabels. Do not reject it against the profile
  // before rendering (in particular when the author lowers the minimum).
  if (state.doc.figure?.target?.minFontSize !== undefined) return;
  const min = profile.typography.minFontSize.pt;
  const current = state.doc.figure?.themeOverrides?.textScale ?? 1;
  const list = [...fonts];
  const scale = neededScale(list, min, current, state);
  for (const { key, fontSizePt, sublabel } of fonts) {
    if (state.invalid.has(key) || fontSizePt >= min) continue;
    const element = locateElement(state, key);
    const { subject } = element;
    const path = sublabel ? [...element.path, "sublabel"] : element.path;
    const name = sublabel ? `the sublabel of ${element.name}` : element.name;
    state.diagnostics.push(
      errorAt(
        locate,
        "profile/font-too-small",
        `Font size ${formatPt(fontSizePt)} of ${name} is below the minimum ${formatPt(min)} of profile "${profile.id}".`,
        path,
        {
          subject,
          hint: fontHint(scale, current, sublabel === true),
          related: [relatedAt(locate, PROFILE_PATH, `Profile "${profile.id}" is selected here.`)],
        },
      ),
    );
    state.invalid.add(key);
  }
}

/**
 * The one text scale (#514) that lifts every text of the figure that is below
 * `min` to it, as a multiple of 0.25 (the figure's own, `current`, replaced);
 * `undefined` if the largest scale does not.
 *
 * A drawn size is the theme's size scaled and rounded, which cannot be undone
 * by a division (rounding, the 4pt floor). So the theme sizes (whole 0.5pt)
 * that draw as `fontSizePt` at the `current` scale (a sublabel: as its
 * label's 7/8) are listed, and the scale must serve the worst of them.
 */
function neededScale(
  fonts: readonly FontUsage[],
  min: number,
  current: number,
  state: CheckState,
): number | undefined {
  let needed = current;
  for (const { key, fontSizePt, sublabel } of fonts) {
    if (state.invalid.has(key) || fontSizePt >= min) continue;
    const drawn = (units: number): number => {
      const label = scaleFontSize({ pt: units / 2, units }, current);
      return sublabel === true ? sublabelFontSize(label).units : label.units;
    };
    for (let units = 8; units <= 100; units++) {
      if (drawn(units) !== Math.round(fontSizePt * 2)) continue;
      const scale = scaleToReach(units / 2, min, sublabel === true);
      if (scale === undefined) return undefined;
      needed = Math.max(needed, scale);
    }
  }
  return needed;
}

/** The hint of `profile/font-too-small`: the text scale that fixes the figure, then the other ways. */
function fontHint(scale: number | undefined, current: number, sublabel: boolean): string {
  const control =
    scale !== undefined && scale > current
      ? `Set figure.themeOverrides.textScale: ${scale} (scales the theme's text, lines and arrowheads together; now ${current}), or `
      : "";
  const others = sublabel
    ? "use a variant or theme with a larger font size, a profile with a smaller minimum, or put the text into the label (a sublabel is drawn at 7/8 of its node's font size, rounded down to 0.5pt)."
    : "use a variant or theme with a larger font size, or a profile with a smaller minimum.";
  return control === "" ? `${others[0]?.toUpperCase()}${others.slice(1)}` : `${control}${others}`;
}

/**
 * The diagnostic subject, document path and display name of an element key.
 * Edges without an ID are identified as `edges[<index>]`, as in the `ref` stage.
 */
function locateElement(
  state: CheckState,
  key: ElementKey,
): { subject: DiagnosticSubject; path: DocPath; name: string } {
  const id = key.slice(2);
  // A group's caption (#130) and the parts of a legend (#131) are written as
  // a field of another element.
  const origin = state.doc.expanded?.get(key);
  if (origin !== undefined) {
    return { subject: { ...origin.subject }, path: [...origin.path], name: origin.name };
  }
  if (key.startsWith("e:") && id.startsWith("#")) {
    const index = Number(id.slice(1));
    const subject = { kind: "edge", id: `edges[${index}]` } as const;
    return { subject, path: ["edges", index], name: `edge ${subject.id}` };
  }
  const [kind, collection] = key.startsWith("e:")
    ? (["edge", "edges"] as const)
    : key.startsWith("g:")
      ? (["group", "groups"] as const)
      : (["node", "nodes"] as const);
  const index = state.doc[collection]?.findIndex((element) => element?.id === id) ?? -1;
  return {
    subject: { kind, id },
    path: index >= 0 ? [collection, index] : [],
    name: `${kind} "${id}"`,
  };
}
