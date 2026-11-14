/**
 * Stage `ref` for set enclosures (#407, design record 407): checks the IDs
 * of `sets` and their members.
 *
 * - Set IDs form their own ID space, like edge IDs: a set may share an ID
 *   with a node (`ref/duplicate-id` between sets only).
 * - A member is a node or a group of the figure (`ref/unknown-set-member`),
 *   listed once (`ref/duplicate-set-member`). A member that is itself
 *   invalid is left alone: it has its own diagnostic.
 * - `angle` turns an ellipse (#430): on another shape it is an error
 *   (`ref/set-angle-needs-ellipse`), since a circle, hull or rectangle has
 *   no orientation to set.
 * - `minWidth` / `minHeight` set the least size of the outline (#518): on a
 *   hull they are an error (`ref/set-min-size-needs-fixed-shape`).
 * - `width` / `height` set the exact size (#545): on a hull they are an error
 *   too, and with the minimum of the same axis they are a conflict
 *   (`ref/set-size-conflict`).
 * - Sets are drawn by the structured layout only (`layout/structured-only`).
 *
 * A set with an error is dropped from the document (`doc.sets[i]` becomes
 * `undefined`), so later stages never see one.
 */

import { type CheckState, groupKey, nodeKey } from "../check-state";
import { type Diagnostic, type DocPath, didYouMean } from "../diagnostics";
import { errorAt, relatedAt } from "./report";
import type { Locator } from "./yaml";

/** Runs the set checks on `state.doc`. */
export function checkSets(state: CheckState, locate: Locator): void {
  const { doc } = state;
  const sets = doc.sets;
  if (sets === undefined || doc.figure === undefined) return;
  const subject = (id: string) => ({ kind: "set", id }) as const;
  const report = (index: number, diagnostic: Diagnostic) => {
    state.diagnostics.push(diagnostic);
    sets[index] = undefined;
  };

  if (doc.figure.layout.engine === "auto") {
    for (const [index, set] of sets.entries()) {
      if (set === undefined) continue;
      report(
        index,
        errorAt(
          locate,
          "layout/structured-only",
          `"sets" needs the structured layout engine, but this figure uses the auto engine.`,
          ["sets", index],
          {
            atKey: true,
            subject: subject(set.id),
            hint: 'The structured layout is selected by figure.layout.arrange or "engine: structured"; otherwise remove sets.',
          },
        ),
      );
    }
    return;
  }

  const known = new Set<string>();
  for (const g of doc.groups ?? []) if (g !== undefined) known.add(g.id);
  for (const n of doc.nodes ?? []) if (n !== undefined) known.add(n.id);
  // IDs that exist but have an error of their own: not reported again.
  const invalid = (id: string) => state.invalid.has(nodeKey(id)) || state.invalid.has(groupKey(id));
  const first = new Map<string, number>();
  for (const [index, set] of sets.entries()) {
    if (set === undefined) continue;
    const path: DocPath = ["sets", index];
    const earlier = first.get(set.id);
    if (earlier !== undefined) {
      report(
        index,
        errorAt(
          locate,
          "ref/duplicate-id",
          `Set ID "${set.id}" is already used by sets[${earlier}].`,
          [...path, "id"],
          {
            subject: subject(set.id),
            hint: "Set IDs must be unique among sets.",
            related: [relatedAt(locate, ["sets", earlier, "id"], "First defined here.")],
          },
        ),
      );
      continue;
    }
    first.set(set.id, index);
    if (set.angle !== undefined && set.shape !== "ellipse") {
      report(
        index,
        errorAt(
          locate,
          "ref/set-angle-needs-ellipse",
          `Set "${set.id}" has angle, but its shape is ${set.shape}; only an ellipse can be turned.`,
          [...path, "angle"],
          {
            subject: subject(set.id),
            hint: "Use shape: ellipse (angle: auto fits the tilt to the members), or remove angle.",
          },
        ),
      );
      continue;
    }
    for (const axis of ["Width", "Height"] as const) {
      const exact = axis === "Width" ? set.width : set.height;
      const least = axis === "Width" ? set.minWidth : set.minHeight;
      if (exact === undefined || least === undefined) continue;
      report(
        index,
        errorAt(
          locate,
          "ref/set-size-conflict",
          `Set "${set.id}" has both ${axis.toLowerCase()} and min${axis}; an exact size already says the least.`,
          [...path, `min${axis}`],
          {
            subject: subject(set.id),
            hint: `Remove min${axis}, or remove ${axis.toLowerCase()} to keep the fitted size as a minimum.`,
          },
        ),
      );
    }
    if (sets[index] === undefined) continue;
    if (
      set.shape === "hull" &&
      (set.minWidth !== undefined ||
        set.minHeight !== undefined ||
        set.width !== undefined ||
        set.height !== undefined)
    ) {
      report(
        index,
        errorAt(
          locate,
          "ref/set-min-size-needs-fixed-shape",
          `Set "${set.id}" has a size (width, height, minWidth or minHeight), but its shape is hull; a hull follows its members and has no size to set.`,
          [
            ...path,
            (["width", "height", "minWidth", "minHeight"] as const).find(
              (field) => set[field] !== undefined,
            ) ?? "width",
          ],
          {
            subject: subject(set.id),
            hint: "Use shape: circle, ellipse or rect, or remove the size.",
          },
        ),
      );
      continue;
    }
    const seen = new Map<string, number>();
    let failed = false;
    for (const [m, member] of set.members.entries()) {
      const at = [...path, "members", m];
      const before = seen.get(member);
      if (before !== undefined) {
        state.diagnostics.push(
          errorAt(
            locate,
            "ref/duplicate-set-member",
            `"${member}" is listed twice in the members of set "${set.id}".`,
            at,
            {
              subject: subject(set.id),
              hint: "List each member once.",
              related: [relatedAt(locate, [...path, "members", before], "First listed here.")],
            },
          ),
        );
        failed = true;
        continue;
      }
      seen.set(member, m);
      if (known.has(member) || invalid(member)) continue;
      state.diagnostics.push(
        errorAt(
          locate,
          "ref/unknown-set-member",
          `Unknown member "${member}" in set "${set.id}"; members must be node or group IDs.`,
          at,
          { subject: subject(set.id), hint: didYouMean(member, known) },
        ),
      );
      failed = true;
    }
    if (failed) sets[index] = undefined;
  }
}
