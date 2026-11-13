# Run 6 rag-compare, condition A

Start: 2026-11-13 15:38:36

## Plan
- Request: compare naive RAG, RAG with reranking, agentic RAG on a 16:9 slide; theme `sumi`, profile `presentation-16x9`.
- Note: `sumi catalog` lists `sumi` as compatible with paper-single/paper-double only (7-9pt text); `presentation-16x9` needs 14pt. Expect `profile/font-too-small`; will check what the CLI says.
- Layout: structured `grid`, one row per method, columns aligned by stage role (Query | Plan | Retrieve | Rerank/Verify | Generate | Answer), blank cells (`null`) where a method has no stage, so added stages stand out. Method name as row title on the left. Stages a method adds get an accent tone; loop arrow Verify -> Retrieve for iterative retrieval.
- Visual language: query/answer = parallelogram (I/O, neutral); shared stages (Retrieve, Generate) = box default; added stages = box tone (orange/sand accent); loop = dashed arrow with label.

## Render 1 (draft1) 15:40:05
- Lint: 19 x profile/font-too-small with theme sumi + presentation-16x9 (sumi is 7-9pt; profile needs 14pt; fonts cannot be overridden). Workaround: keep profile as the upper bound, set figure.target.minFontSize: 7pt (target overrides profile minima). Rationale: the figure is placed scaled on the slide; aim for ~165mm wide so it scales ~2x to the 338mm slide (8pt -> ~16pt, 7pt edge labels -> ~14pt).
- draft1: 216 x 71mm, 0/0/1 (placement-usage). Looks clean but too wide (scale only 1.57x -> 12.5pt), long empty arrows across blank cells in rows 1-2, method titles not prominent, loop label sits off to the left, no key for the orange added stages.

## Renders 2-3 (candidates) 15:41:01
- candA: each method a framed group (title top-left) with a row, columns aligned with figure.layout.align x; legend row at the bottom. 196 x 119mm. 1 warning layout/unsatisfied-align (q1/q2 0.43mm off: parallelogram widths differ?), 3 group-empty-area infos. Group title band + padding cost a lot of height; groupLabelWeight: bold did not look bold in the PNG.
- candB: three vertical columns side by side, align y. 138 x 136mm (square, not slide-shaped), long empty drops in naive column, "gaps found" label placed on the main edge instead of the loop edge (misleading), 1 unsatisfied-align warning.
- Choice: rows (A) read better left-to-right and suit 16:9; go back to the grid of draft1 (compact, exact columns) and add the legend and the "verified" label.

## Renders 4-7 (grid, iterating) 
- r4: grid + legend + density compact, columnGap 5mm: 188 x 66mm. Problems: arrowheads into the Answer parallelograms overlap the slanted side (the arrow ends at the bounding box, not the outline); Agentic row taller because of "Retrieve\n(iterative)"; loop label off to the left; still too wide for ~2x slide scaling.
- r5: I/O as muted ellipses, single-line Retrieve (the loop shows the iteration), labelSide: right on the loop: ellipses too large and tall; labelSide right gave layout/edge-label-overlap (label on its own line).
- r6: I/O as muted boxes, loop label labelAt: middle, columnGap 6mm: 178 x 69mm, clean.
- r7 (final): columnGap 5mm, legend gap 8mm, method title left-aligned: 171.6 x 70.6mm.

## Self-critique of final (checklist)
- Content: three methods; naive Query->Retrieve->Generate->Answer; reranking adds Rerank; agentic Query->Plan->Retrieve->Verify->Generate->Answer with dashed loop Verify->Retrieve ("gaps found") and "verified" to Generate. Stages aligned in columns so added stages (orange tint, one accent) stand out; legend explains tint and dashed loop.
- Readability: no overlaps; lint 0/0/1. Font on slide: placed at full slide width (338.7mm) the scale is 1.97x -> nodes ~15.8pt, edge labels/legend ~13.8pt (slightly under 14pt).
- Weak points kept: method titles are plain regular labels (labels cannot be bold; group titles could be, but framed groups cost height); long arrows across blank cells in rows 1-2 (intended: they show the missing stages); strip aspect 2.4:1 rather than 16:9 (leaves room for a slide title); bottom margin under the legend a little larger than the top.

## Summary
End: 2026-11-13 15:42:18
Renders: 7 (draft1, 2 candidates, 4 iterations of the chosen layout).
Final lint (lint --geometry): 0 errors, 0 warnings, 1 info (geometry/placement-usage, informational: 171.6mm of the 338.7mm profile width used, by design since the figure is scaled up on the slide).
Hard:
- theme sumi is not compatible with presentation-16x9 (7-9pt text vs 14pt minimum; no font-size override). Worked around with figure.target.minFontSize: 7pt and sizing the figure to ~half the slide width so it scales ~2x. The Skill only says "use slides theme" for slides; nothing on a non-slides theme on a slide.
- Arrowheads into a parallelogram overlap its slanted side (ends at bounding box).
- labelSide: right on a short loop gave edge-label-overlap; the default loop label sat at one end of the long segment, not centred (labelAt: middle fixed it).
- sumi fmt collapsed the hand-formatted grid rows into one long items line (row structure no longer visible in the YAML).
- groupLabelWeight: bold did not look bold in candidate A (sumi theme); text is outlined in the SVG so I could not verify the weight.
Not expressible: bold/larger text for a plain label (row titles); a font scale to make the sumi theme meet slide minima.
