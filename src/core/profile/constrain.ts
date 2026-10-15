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
import { formatPt } from "../units";
import { resolveProfile } from "./builtin";
import type { Profile } from "./schema";

/** The effective font size of one element, as resolved by the `theme` stage. */
export interface FontUsage {
  key: ElementKey;
  fontSizePt: number;
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
  const min = profile.typography.minFontSize.pt;
  for (const { key, fontSizePt } of fonts) {
    if (state.invalid.has(key) || fontSizePt >= min) continue;
    const { subject, path, name } = locateElement(state, key);
    state.diagnostics.push(
      errorAt(
        locate,
        "profile/font-too-small",
        `Font size ${formatPt(fontSizePt)} of ${name} is below the minimum ${formatPt(min)} of profile "${profile.id}".`,
        path,
        {
          subject,
          hint: "Use a variant or theme with a larger font size, or a profile with a smaller minimum.",
          related: [relatedAt(locate, PROFILE_PATH, `Profile "${profile.id}" is selected here.`)],
        },
      ),
    );
    state.invalid.add(key);
  }
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
