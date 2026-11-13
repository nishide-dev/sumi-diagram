# Run 4-train-infer / B

Start: 2026-11-13 15:38:37

## Step 1: HTML mockup (15:40:34)

- Read catalog and the sumi theme (canvas #f8f8ee, ink #30364f, panel #efeddd, shade #e1d9bc, tone fills/inks).
- Design: two panels side by side, each a vertical flow. (a) training: token row with masks -> Encoder -> Decoder -> predictions at masked positions -> loss. (b) inference: prompt + masked answer -> Encoder -> [Iterative generation group: Decoder -> partially unmasked row, remask loop x T] -> output row. Shared weights = dashed double arrows Encoder<->Encoder and Decoder<->Decoder across the gap. Legend: token / mask / prediction.
- Round 1: panel frames made the shared-weights lines and labels cross borders; group title collided with the Encoder->Decoder arrow; remask label overflowed.
- Round 2: panels made plain (title only, no frame), group title moved below the group, loop label widened.
- Round 3: output arrow leaves the group's bottom, legend drops the redundant shared-weights entry. Accepted.

## Step 2: reproduction in Sumi

- Read SKILL.md, examples index (viewed llada, dit-block PNGs), structured.md sections (arrange, separators, group titles, align, edges, legends, tokens), figure-format tones/variants.
- First lint: 3 errors — empty-label `label` cells used as placeholders in the prediction token row (component/missing-label). Split predictions into two tokens nodes (pred_a, pred_b) in a row, aligned to input cells with `layout.align` x constraints.
- Render 1 (draft1): 186mm wide -> geometry/exceeds-page-width (error, SVG written). Token cells had a 4mm default gap and were square; decoder fan-out and loss fan-in merged into shared trunks instead of the mockup's straight drops.
- Render 2: tokens gap 0 / width 22pt / height 15pt, panel gap 26 -> 18mm, fromAnchor/toAnchor: straight on the wide Decoder/Loss ends. 150mm wide, clean apart from sparse-figure info. The lower shared-weights label sat on the dashed group border.
- Render 3: caption+tokens in a tight inner stack (1.5mm); shared-weights labels at labelAt: start (clear of the border).
- Compared final against llada.png and mockup.png with scripts/compare (self-critique).
- Render 4 (final): density: compact -> 147.3 x 83.4mm (paper-double), close to the mockup's 160 x 84mm.

Renders: 4 (plus one compare raster).

Final lint: `lint` 0/0/0; `render` 0 errors, 0 warnings, 1 info (geometry/sparse-figure, 25.1% coverage). Kept: the empty space is the gap the shared-weight arrows need between the panels and the strip right of the legend; filling it would mean changing the two-panel composition the mockup chose.

### Where Sumi did not match the mockup
- Iterative-generation group: mockup had a sand (shade) fill AND a dashed border; Sumi container variants give either dashed-without-fill or muted-with-fill (solid border), so the fill was dropped. Its title is the 9pt group heading (regular weight in rsvg), larger than the mockup's 7pt bold caption.
- Panel titles: plain-group labels render at heading size; bold in Chrome-based compare, regular in rsvg-convert PNG (font-weight rendering differs by rasterizer).
- Token cells cannot be empty placeholders, so a sparse prediction row (cells only at masked positions) needs separate tokens nodes plus x-align constraints per segment.
- Remask loop label placed by the router above the loop's last segment rather than beside the vertical part; acceptable.
- Mockup token cells were 8 x 5.5mm with 0.75pt frames; Sumi cells use the node line width (1pt), a little heavier.

### What was hard
- Knowing in advance that `label` cells cannot be empty and that default fan-out merges into trunks (needed `straight` anchors).
- First render 6mm too wide: the mockup's 160mm budget did not account for Sumi's default cell gap and attach widths; the width hint (trial edits) made it quick to fix.

End: 2026-11-13 15:42:54
