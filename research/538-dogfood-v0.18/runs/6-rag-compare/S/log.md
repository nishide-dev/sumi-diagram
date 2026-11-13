# Run 6 rag-compare (S)

Start: 2026-11-14 03:00:53

Request: row 6 rag-compare, presentation-16x9, theme sumi, textScale 2 (catalog textScaleFor).

## Plan
- Layout: started from base layout `compare-rows` (three rows on one shared column grid, added steps orange, dashed feedback loop). Closest example besides it: none closer (generic examples are auto-layout); used the layout's idioms directly.
- Mockup: no. The arrangement is the layout's own (a three-row comparison, which mockup.md names as the case to skip); the one loop is already drawn the same way in the layout, so the arrangement was obvious.
- Checklist: Naive RAG (Retrieve -> Generate), RAG with reranking (Retrieve -> Rerank -> Generate), Agentic RAG (Plan -> Retrieve, iterative -> Verify -> Generate). Query/Answer endpoints added as muted input/output boxes (presentation). 8-column grid so every step has its own column across rows.

## Rounds
1. draft1: 297 x 94mm, lint 0/0/0, render 1 warning geometry/dash-hidden (legend dashed sample). Seen: wide and short for a slide, row titles not bold/left-aligned, loop label squeezed between line and loop, unequal box widths, legend sample cramped.
2. Taller rowGap (22mm), row titles text: heading + weight: bold + textAlign left, box props width/height (first tried node-level width/height -> schema/unknown-field; they belong in props), loop label labelSide: left (below), legend arrowheadScale 0.75. dash-hidden remained.
3. arrowheadScale 0.5 still warned (lint --geometry). Legend has no sample-length prop, so dropped the dashed legend entry and labelled the loop itself "iterate retrieval". Final: 327.2 x 123.65mm.

Renders: 3 (render) + 1 lint --geometry in-memory.

## Final lint
lint: 0 errors / 0 warnings / 0 infos; render geometry: 0 / 0 / 0.

## What was hard / what Sumi could not express
- Legend samples do not grow with textScale 2: the sample box sits almost touching its text and a dashed edge sample is too short to show the dash (geometry/dash-hidden) even with arrowheadScale 0.5; no prop for sample length. Had to drop the legend entry.
- Node width/height are props, not node fields (schema error suggested "weight" for height).
- Figure is 327 x 124mm: wide strip on a 16:9 slide (roughly 2.6:1); filling the height would need much bigger row gaps, which reads worse. Leaves room for a slide title.
- Long arrows across empty slots (Query -> Retrieve in rows 1-2) are the price of the shared column grid.

End: 2026-11-14 03:02:37
