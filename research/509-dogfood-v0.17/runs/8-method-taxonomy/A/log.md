# Run 8 method-taxonomy, condition A

Start: 2026-11-13 15:38:37

- render 1 (draft1): 186mm wide (too wide), titles collide with set outlines/labels
- render 2: compressed coordinates, titles below, set padding 2.5mm
- render 3: hull sets (boxes crossed neighbouring ellipse outlines)
- (lint: props.height 9mm rejected, must be multiple of 0.5pt; used 25.5pt)
- render 4: dropped years (minimal text), equal box height 9mm, titles aligned with justify: space-between
- render 5: spread architecture columns (GraphSAGE touched spectral hull), mirrored SSL triangle, title gap 6mm
- render 6: shortened section titles (lint/long-label)

End: 2026-11-13 15:42:08

## Summary

- Renders: 6 (draft1 + 5). One extra lint-only round (props.height 9mm rejected).
- Final: 171.45mm x 44.63mm, paper-double, theme sumi, target height 70mm (63.8% used).
- Final lint (`lint --geometry`): 0 errors / 1 warning / 1 info.
  - warning lint/no-edges: kept, a taxonomy has no connections. The message says
    "2 nodes" although the figure has 15 nodes (looks like a miscount, probably only
    root-level label/separator nodes outside place boxes are counted).
  - info geometry/placement-usage: informational.
- Design: structured; one place box per perspective; method names as equal-height boxes;
  categories as hull `sets` (blue spectral, green spatial, orange attention); overlap
  members GCN (spectral+spatial) and GAT (spatial+attention) sit in the mixed overlap
  tint. Self-supervised is a dashed gray set beside a dashed separator, as a training
  perspective rather than an architecture family. Captions name the two perspectives.
  Years were drawn as sublabels in draft1 and dropped (minimal text).
- Self-critique vs TriCL (compare script): density fine for a taxonomy, consistent
  vocabulary, 3 hues + gray, short text. No main-flow item applies. Box widths differ
  (name length); equal widths would not fit 180mm.

## What was hard

- Sets take no space in arrange trees: in draft1 the section titles collided with set
  outlines and labels and the figure was 186mm wide; needed manual gaps.
- Ellipse sets (default-ish) were large and the boxes of one set crossed the outline of
  its neighbour, making membership ambiguous; no lint reported a box straddling a
  non-member set's outline (set-contains-non-member did not fire either). Switching to
  `shape: hull` fixed it.
- `props.height: 9mm` rejected (must be a multiple of 0.5pt); mm values are awkward.
- `compare` requires options before the file arguments (`-o` after files fails).
- Aligning the two captions needed `justify: space-between` on both stacks.

## What Sumi could not express

- A 4-way overlap layout would be hard by hand; I kept self-supervised as a separate
  set rather than overlapping it with the architecture sets (no factual overlap drawn).
- No lint for a node box crossing another set's outline.
