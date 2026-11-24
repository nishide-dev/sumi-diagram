/**
 * `geometry/panel-misaligned` (#641, design record
 * `docs/design/decisions/641-panel-rows.md`): groups side by side in a row
 * (panels) whose frames start or end at different heights, or whose titles
 * sit at different heights, read as a ragged figure. The hint is the row's
 * `panels: true`, which gives every panel the row's height, puts its content
 * right under its title and matches the title bands, written out at the row's
 * path. It is not laid out as a trial: what it does is fixed by the engine.
 */

import type { GroupIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";
import { formatDocPath } from "../../core/diagnostics";
import { mmToPt } from "../../core/units";
import type { GroupLayout } from "../../layout/ir";
import { panelRows } from "../../layout/structured/panels";
import { defineGeometryRule, type LintFinding } from "../rule";
import { drawnUnits, mmText } from "./common";
import type { GeometryContext } from "./context";

export const PANEL_MISALIGNED = "geometry/panel-misaligned";

/** The least offset (printed, in units: 1mm) between panels that counts. */
export const MIN_PANEL_OFFSET = mmToPt(1) * 2;

/** Whether a group's frame is drawn: a visible border or fill. */
function framed(group: GroupIR): boolean {
  const { stroke, strokeWidth, fill, opacity } = group.style;
  if (opacity <= 0) return false;
  return (stroke !== "transparent" && strokeWidth.units > 0) || fill !== "transparent";
}

/** The spread (largest minus smallest) of `values`; 0 for fewer than two. */
function spread(values: readonly number[]): number {
  return values.length < 2 ? 0 : Math.max(...values) - Math.min(...values);
}

export interface PanelOffsets {
  readonly tops: number;
  readonly bottoms: number;
  readonly titles: number;
  readonly captions: number;
}

/**
 * How far the frames, titles and captions (#130) of a row's panels are apart
 * (drawn units); `captionTop` gives the top of a caption node's box.
 */
export function panelOffsets(
  panels: readonly GroupLayout[],
  irs: readonly GroupIR[],
  captionTop: (key: ElementKey) => number | undefined,
): PanelOffsets {
  const frames = panels.filter((_, i) => framed(irs[i] as GroupIR));
  const titles = panels.filter(
    (p, i) => p.label !== undefined && (irs[i] as GroupIR).labelAt?.startsWith("bottom") !== true,
  );
  return {
    tops: spread(frames.map((p) => p.rect.y)),
    bottoms: spread(frames.map((p) => p.rect.y + p.rect.height)),
    titles: spread(titles.map((p) => (p.label as NonNullable<GroupLayout["label"]>).box.y)),
    captions: spread(
      irs.flatMap((g) => {
        const top = g.caption === undefined ? undefined : captionTop(g.caption);
        return top === undefined ? [] : [top];
      }),
    ),
  };
}

export const panelMisaligned = defineGeometryRule({
  id: PANEL_MISALIGNED,
  description:
    "Groups side by side in a row (panels) have frame tops, frame bottoms, titles or captions at different heights (1mm or more); the row's panels: true gives them one height, content under the titles and one title band.",
  defaultSeverity: "info",
  fixable: false,
  run(context: GeometryContext) {
    const placed = context.placed;
    if (placed === undefined || placed.ir.meta.engine !== "structured") return [];
    const least = drawnUnits(context, MIN_PANEL_OFFSET);
    const layouts = new Map(placed.layout.groups.map((g) => [g.key, g]));
    const captions = new Map(
      placed.layout.nodes.map((n) => [n.key, n.label?.box.y ?? n.rect.y] as const),
    );
    const rows = panelRows(placed.ir, (group) => context.get(group.key)?.docPath);
    return rows.flatMap((row): LintFinding[] => {
      if (row.box.panels === true || row.panels.length < 2) return [];
      const irs = row.panels.filter((g) => layouts.get(g.key)?.quad === undefined);
      const panels = irs.map((g) => layouts.get(g.key)).filter((g) => g !== undefined);
      if (panels.length !== irs.length || panels.length < 2) return [];
      const offsets = panelOffsets(panels, irs, (key) => captions.get(key));
      const parts = [
        offsets.tops >= least && `frame tops ${mmText(context, offsets.tops)} apart`,
        offsets.bottoms >= least && `frame bottoms ${mmText(context, offsets.bottoms)} apart`,
        offsets.titles >= least && `titles ${mmText(context, offsets.titles)} apart`,
        offsets.captions >= least && `captions ${mmText(context, offsets.captions)} apart`,
      ].filter((part) => typeof part === "string");
      if (parts.length === 0) return [];
      const names = irs.map((g) => context.get(g.key)?.name ?? `group "${g.id}"`);
      const path = formatDocPath(row.path);
      return [
        {
          message: `The panels side by side in ${path} (${names.join(", ")}) are not aligned: ${parts.join(", ")}.`,
          path: row.path,
          hint: `Add panels: true to the row at ${path} (its other fields stay): each panel then takes the row's height (frames share their top and bottom), its content sits right under its title (contentAlign: top unless the group writes contentAlign), and the titles share one band height unless that would make the row taller, so the headings line up and, with that band, the first rows too; nodes in the row keep align. Keep the offset if it is intended.`,
          related: irs.flatMap((g) => {
            const element = context.get(g.key);
            return element === undefined
              ? []
              : [{ path: element.docPath, message: `${element.name} is a panel of this row.` }];
          }),
        },
      ];
    });
  },
});
