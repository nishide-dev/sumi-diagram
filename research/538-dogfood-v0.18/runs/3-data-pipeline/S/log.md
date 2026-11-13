# Run 3 data-pipeline (S)

Start: 2026-11-14 03:00:53

## Plan
- Request: row 3 data-pipeline. README figure ~160mm, text >= 9pt. Theme sumi, profile screen-doc (Skill: README/web), textScale 1.5 (catalog textScaleFor.screen-doc), target.minFontSize 9pt.
- Checklist: Collect -> Validate -> Transform -> Feature store -> Train -> Evaluate -> Deploy; Monitor (watches deployed model) -> back to Collect with "quality drop -> re-collect & relabel"; Validate -> Quarantine (failed data).
- Base layout: none fits exactly (layouts: encoder-block, train-infer-panels, compare-rows, set-taxonomy). Closest idiom = compare-rows (aligned chain on a column grid + dashed feedback edge); planned from scratch, borrowing that idiom. Examples looked at: pipeline, decision-flow (YAML), compare-rows PNG.
- Mockup: yes — the figure has a feedback loop (Skill: loops qualify; skip only for an obvious one-directional flow).
- Shape: 8 stages at 12pt don't fit one 160mm row -> two rows snaking into a ring (row 2 runs right-to-left), so the feedback edge is a short vertical edge Monitor -> Collect; Quarantine above Validate. Red = failure/degradation (quarantine, feedback); everything else neutral.
- Probe render for colours: ink #30364f, canvas #f8f8ee, red tinted #efd8d0/#813f40, lines 1.5pt at textScale 1.5, node 12pt, edge 10.5pt.

## Rounds
1. Mockup (mockup.html/png), 160 x 58mm: ring of two rows, checked against checklist — all items present, no changes needed.
2. YAML from mockup (grid 4 cols x 3 rows), lint clean -> render draft1 (154 x 78mm). Problems vs mockup: cylinders auto-sized very tall (23mm), boxes of different widths per column, edge labels sit almost on the dashed lines.
3. Gave boxes width 30mm and cylinders 34 x 13mm -> lint --geometry: geometry/label-overflow on both cylinders (caps need props.height >= 52pt). Changed cylinders to 32 x 18.5mm, columnGap 11 -> 9mm (width was 167mm > 160mm) -> final (157 x 72mm).

Renders: 2 figure renders (draft1, final) + 1 colour probe; 1 extra lint --geometry round that failed before rendering.

## Final lint
0 errors, 0 warnings, 1 info (geometry/placement-usage: informational report of reserved area, nothing to fix).

## Self-check (no subagent)
- Content: all 7 main stages + Monitor, feedback Monitor -> Collect labelled "quality drop: re-collect, relabel", Validate -> Quarantine "failed checks"; arrows correct.
- Readability: 12pt node text, 10.5pt edge labels (>= 9pt target) at 157mm. Edge labels sit very close (~0.5mm) to their dashed lines; not reported by lint. Top-right void beside Quarantine (side branch; kept).

## Hard / not expressible
- Cylinder height is coupled to cap size: a 13mm-tall cylinder cannot hold a one-line label at 12pt; minimum ~18.5mm, so storage looks bulky next to 9mm boxes.
- No control of edge-label offset from the line (structured router puts labels nearly on the line); no left-aligned multi-line edge label.
- "Labeling" has no node in the request's main chain, so it lives only in the feedback label (avoided inventing a stage).
- Mockup -> YAML mapping was easy with a grid (no place needed).

End: 2026-11-14 03:03:33
