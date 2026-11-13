# Run 8 method-taxonomy — condition B
Start: 2026-11-13 15:38:35

## Phase 1: HTML mockup
- Content plan (graph representation learning taxonomy): four families as a chain of overlapping ellipse sets
  Spectral | Spatial | Attention | Self-supervised; adjacent overlaps hold hybrid methods:
  Spectral∩Spatial = GCN, Spatial∩Attention = GAT, Attention∩Self-supervised = Graph-BERT.
  Exclusive members: Spectral CNN, ChebNet / GraphSAGE, GIN / Graph Transformer, SAN / DGI, GraphCL.
- Visual language: set = tinted ellipse in one tone per family (blue, green, orange, purple); method = small outlined box;
  hybrid method = emphasis (dark navy) box; one legend at the bottom.
- Round 1: 4 ellipses rx 29; middle sets' exclusive regions too narrow at centre line, chips crossed outlines.
  Insight: exclusive region of a middle set widens away from the centre line, lens narrows -> lens chips on the centre line,
  exclusive chips above/below.
- Round 2: rx 28, spacing 37 mm, ry 22; Graph-BERT broken into two lines to fit its lens.
- Round 3: ry 23.5, chips at ±10 mm. Accepted (Graph Transformer just touches the purple outline). 172 × 70 mm.

## Phase 2: Sumi reproduction (sumi theme, paper-double, structured: one root place, unit 1mm + legend)
- Render 1 (draft1): chips placed at the mockup coordinates, four `shape: ellipse` sets. Lint 0/0/0; render 2 warnings
  (geometry/set-label-collision Attention vs Self-supervised): the fitted ellipses came out at different sizes and heights,
  so labels sat at different heights and collided; Graph Transformer touched the purple outline.
- Render 2: uniform chip widths + hidden-junction anchors at the outer ends. Worse: 58pt-wide chips crossed into the
  neighbouring lenses (no lint caught this: a member box crossing another set's outline is not reported unless its
  centre/quarter is inside).
- Render 3: natural chip widths; every set gets hidden junctions at top and bottom (and at the outer side for the end sets)
  so the smallest-enclosing ellipses come out about equal. Clean, close to the mockup.
- Render 4: chips further from the centre line (±14.5mm), anchors ±21.5mm: no chip touches a foreign outline.
- Render 5 (final): dropped per-node cornerRadius so the chips match the legend sample (a legend node sample cannot take
  cornerRadius: `component/unknown-prop`).
- Renders: 5 (plus one lint-only failure: cornerRadius in a legend entry).
- Final: 162.6 × 74.3 mm, paper-double. Final lint (lint --geometry): 0 errors / 0 warnings / 0 infos.

### Self-critique (checklist)
- Content: 4 families, 2–3 representatives each, 3 overlaps (GCN, GAT, Graph-BERT) shown in lenses and as dark chips; legend explains the chip styles. Nothing extra.
- Readability: all text 7–8pt; no chip crosses a foreign outline; labels clear.
- Weak points: block-sized empty space in the middle of each circle (Venn geometry: lenses on the centre line, exclusive members above/below); ellipses came out nearly circular rather than the mockup's wider ellipses; set labels sit ~1mm apart in height.

### Where Sumi could not match the mockup
- Set label typography: the mockup has a bold family name over a smaller grey descriptor; a set label is one style (regular, tone colour), so both lines share one size/weight.
- Set shape cannot be specified (rx/ry); it is the smallest ellipse around members. Needed invisible hidden-junction members as anchors to make the four sets equal; even so the sizes differ slightly (they depend on chip extents), so labels are not on one baseline.
- Emphasis chips: theme declares bold, but the overlap chips look regular weight in the render (not verified further).
- Legend node samples cannot take cornerRadius, so rounded chips (mockup) were dropped for consistency with the key.

### What was hard
- Fitting a 4-set chain Venn in 180mm: middle sets' exclusive regions are narrow at the centre line; solved in the mockup first (lens chips on the centre line, exclusive chips above/below), which transferred directly to `place` coordinates.
- No lint for a member chip crossing a neighbouring set's outline.

End: 2026-11-13 15:43:18
