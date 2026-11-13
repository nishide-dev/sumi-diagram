# Run 3-data-pipeline / A
Start: 2026-11-13 15:38:36
End: 2026-11-13 15:41:39 (about 3 minutes wall clock)

## Request

#3 data-pipeline: collect → validate → transform → feature store → train → evaluate → deploy;
monitoring detects quality drop and feeds back to collection/labelling; failed data quarantined.
README, ~160mm wide → `paper-double`, `figure.target.minFontSize: 9pt`, theme `sumi`.

## Process

1. Read SKILL.md, layout-tips (placement, auto vs structured), structured.md (grids, anchors,
   side inputs, attach), html.md; looked at examples `pipeline` and `decision-flow`.
   Chose structured (grid of 7 columns) so the main strip stays on one line and the side
   elements sit in exact columns.
2. Probe (lint --geometry on a 2-node figure): the `sumi` theme draws node text at 8pt and
   edge labels at 7pt with no font-size control, so `minFontSize: 9pt` cannot be met by any
   labelled node or edge (only 9pt group titles pass). Only `html` leaves could carry larger
   text; rejected (html.md says prefer plain labels; it would replace every box).
3. draft1 (render 1): quarantine above Validate, Monitor below Deploy, dashed orange feedback
   along the bottom into the Ingest group (Collect + Label). Box widths uneven; 108×28mm void
   top-right; feedback label at the end, close to the corner.
4. Candidate B (render 2, after a lint failure: `props.width: 18mm` rejected, widths must be a
   multiple of 0.5pt, used 51pt): Monitor above Deploy with the feedback over the top, quarantine
   below Validate; all boxes 51pt wide. Compared with draft1: same height class (67 vs 69mm),
   width use 93% vs 87%, one void either way (bottom-right 115×27mm vs top-right 108×28mm).
   Chose B: the loop reads as a ring over the main strip and the failure branch drops down,
   away from it. A folded two-row candidate was not rendered: the 7-step strip already fits
   160mm with room and folding would only cost height.
5. Final edits: feedback label moved to the middle of its long segment ("quality drop:
   re-collect, relabel"). Tried shrinking the cylinders with `props.height` (40/32pt):
   `geometry/label-overflow` until 56pt (9 in-memory geometry lints to find it), which is
   taller than the natural size, so heights were removed again.

Renders: 4 SVG writes (draft1, B, final×2) + 10 in-memory `lint --geometry` runs (probe + height search).

## Final lint (`lint --geometry figure.sumi.yaml`)

12 errors, 0 warnings, 2 infos.
- 12 × `geometry/text-too-small` (10 node labels at 8pt, 2 edge labels at 7pt vs the 9pt target):
  kept, not fixable in the `sumi` theme (fixed 8/7pt text, no per-figure font size). Printed size
  167.6mm × 67.4mm, so on a ~160mm README column text displays at about 8pt / 7pt.
- info `geometry/placement-usage` (180 × 67.4mm, 93% width use).
- info `geometry/dead-space` bottom-right 115×27mm (right of the quarantine branch): kept;
  its suggested fix (remove the explicit width of `features` or `train`) undoes the
  equal-width boxes. Plain lint: 0/0/0.

## What was hard

- The 9pt minimum is unreachable with the requested theme: `figure.target.minFontSize` is a
  check only, and there is no font-size knob (theme `fontSizePt.max` is 9 for group titles only).
- `props.width` in mm fails unless it lands on a 0.5pt multiple (18mm → 51pt); the hint helps,
  but mm is the unit a figure is planned in.
- Cylinders cannot be made shorter than about 56pt at 51pt width (label-overflow), so the
  quarantine store is visually heavy and leaves a void beside it.

## What Sumi could not express

- Larger text for a README/web placement (≥ 9pt) with the `sumi` theme.
- A compact (flatter) cylinder for a side store.
