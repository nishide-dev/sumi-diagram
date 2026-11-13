# Run 3-data-pipeline / B

Start: 2026-11-13 15:38:38

## Phase 1: mockup

- Read `$SUMI catalog`, the `sumi` theme (canvas #f8f8ee, ink #30364f, tone fills/lines) and SKILL.md.
- Checked first: the `sumi` theme draws node text at 8pt and edge labels at 7pt, fixed (themeOverrides cannot change fonts). A test figure with `target.minFontSize: 9pt` gives `geometry/text-too-small` errors on every label. So no `sumi` figure can pass a 9pt target at 1:1.
- Decision: design the figure narrower than the README column (about 140mm natural width), so that a README that scales the SVG to 160mm shows 8pt text at about 9.1pt. Edge labels (7pt) would still be about 8pt, so avoid them where possible or accept them.
- Mockup round 1 (140mm × 50mm, 8pt Inter, Sumi colours): a loop on a 4×3 grid. Top row data prep left to right (Collect → Validate → Transform → Feature store cylinder), bottom row model lifecycle right to left (Train → Evaluate → Deploy (emphasis) → Monitor), feedback up the left column (Monitor ⇢ Labeling ⇢ Collect, dashed orange, "quality drop", "relabel, recollect"), Validate → Quarantine (red cylinder, "failed checks").
- Looked at mockup.png: the loop reads at a glance, colours mean something (orange = feedback, red = failure, navy solid = production). Kept it after round 1; the empty middle-right cell is the inside of the loop.

## Phase 2: reproduction in Sumi

Structured layout: one 4×3 `grid` (two blank cells `~`), all boxes `props.width: 74pt` (26mm, must be a multiple of 0.5pt so mm values had to be converted), row heights from the boxes (25.5pt) and cylinders.

- Render 1 (draft1): matched the mockup at once except the cylinders. With the mockup's 9–10mm height the top cap ellipse covers the label (`geometry/label-overflow` on both cylinders, "Feature store" drawn across the cap line).
- Render 2: removed the cylinder heights. Natural cylinders are ~55pt tall, figure grew from 51.5mm to 66.3mm, the middle row became a tall void.
- Searched heights in memory (`lint --geometry`, not counted as renders): a cylinder needs at least 46pt (16mm) whatever its width; 44pt still overflows.
- Render 3 (final): cylinders 74pt × 46pt, rowGap 8mm → 7mm. 138.5mm × 59.4mm.

Self-critique of final.png against the mockup and the step-7 checklist: every requested element is present (Collect → Validate → Transform → Feature store → Train → Evaluate → Deploy, Monitor ⇢ Labeling ⇢ Collect feedback labelled "quality drop" / "relabel, recollect", Validate → Quarantine "failed checks"); all arrows point the right way; no label touches a line; the loop reads clockwise. Kept.

## Where Sumi could not match the mockup

- **Text size.** `sumi` fixes node text at 8pt and edge labels at 7pt; `themeOverrides` cannot change fonts, and `label` nodes have no size. A 9pt `target.minFontSize` cannot pass with this theme. I kept the target as instructed and kept the figure narrow (138.5mm) so that a README scaling it to a 160mm column shows node text at ~9.2pt and edge labels at ~8.1pt (edge labels stay under 9pt).
- **Cylinders.** Sumi's cylinder needs ≥46pt height for a one-line label (its cap ellipse is deep), so the stores are taller (16mm) than the mockup's flat drums (9–10mm), adding ~8mm to the height.
- **Corners.** `sumi` nodes have square corners; the mockup used 2pt radii. No per-figure node corner radius for nodes (`cornerRadius` only rounds groups/sets/legends). Minor.
- **Units.** `props.width` must be a multiple of 0.5pt, so `26mm` is refused; wrote 74pt.

## Final lint summary

- `sumi lint`: 0 errors, 0 warnings, 0 infos.
- `sumi render` (geometry): **13 errors**, 0 warnings, 1 info.
  - 13 × `geometry/text-too-small` (10 node labels at 8pt, 3 edge labels at 7pt vs the 9pt target): kept, the `sumi` theme has no larger text; see above.
  - 1 × `geometry/placement-usage` (info): 180mm × 59.44mm reserved, width use 76.9% (intended: narrow figure for upscaling in the README).

## Counts

- Renders: 3 (draft1, cylinder natural size, final), plus 1 test render of a 2-node figure and 8 in-memory `lint --geometry` trials for the cylinder height.
- Mockup rounds: 1 (screenshot looked publishable at once).

## What was hard

- Finding out that the 9pt target is unreachable with `sumi` (the hint "use a theme or variant with a larger font size" points at no variant that exists; only `slides` is larger).
- Cylinder minimum height is not documented; found by trial.

End: 2026-11-13 15:41:49
