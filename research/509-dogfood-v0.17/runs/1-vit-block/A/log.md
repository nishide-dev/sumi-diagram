# Run 1 vit-block, condition A

Start: 2026-11-13 15:38:36

## Plan (15:45)

Read SKILL.md, examples README, transformer + dit-block examples (PNG + YAML), figure-format,
layout-tips (placement, design principles, visual language, critique checklist), structured
(arrange, side inputs, flow arrows, attach, edges/anchors, legends, zoom, tokens), assets (crop).
`sumi doctor`: ready (0.17.1).

Target: paper-double (180mm max, aim ~160mm), theme `sumi`, profile minimum 7pt. Height budget
assumed 90mm (`figure.target.height`). Structured layout (paper block diagram).

Content checklist:
- input image → split into 3×3 patches (synthetic inline SVG picture, cropped)
- patches → linear projection (of flattened patches) → patch embeddings
- class token prepended; position embeddings (0..9) added to every token
- tokens → Transformer encoder (L×)
- encoder block: LayerNorm → Multi-Head Attention → ⊕ residual; LayerNorm → MLP → ⊕ residual
- class-token output → MLP head → class

Visual language:
| kind | form | tone |
| image / patches | picture asset, crops as framed image tokens | neutral |
| patch embeddings | tokens cells | blue |
| class token (and its path: MLP head, class) | tokens cell / box | orange (accent) |
| position embeddings | tokens cells numbered 0..9 | gray outlined |
| encoder sublayers (MHA, MLP) | filled box | green |
| LayerNorm | filled box | gray |
| residual add | operator ⊕ | neutral |
| encoder detail | zoom callout to panel (b), L× attached | neutral |

Layout candidates: (A) two panels side by side: (a) overview stack bottom→top, (b) block detail
stack bottom→top, zoom from encoder box; (B) overview as a left→right strip with the block below.
Start with A (ViT's natural reading: tokens upward), consider B if too tall.
render 1
render 2: compact, patch columns aligned with tokens, wider proj/encoder, L× only in (b)
render 3: align constraints on whole tokens nodes (cell-level align split the patch row)
render 4: thin strokes (lineWidth/frameWidth 0.5pt, arrowheadScale 0.7) after reference critique
render 5: arrowheadScale 0.9 (0.7 heads were too small at print size)

## Result

End: 2026-11-13 15:43:08
Renders: 5 (draft1 + 4 revisions). Final: 145.34mm × 81.32mm, paper-double, theme sumi, 8pt text
(7pt minimum), height budget 90mm (my assumption) at 90.4%.

Final lint (`lint --geometry`): 0 errors, 0 warnings, 1 info (geometry/placement-usage, which a
`figure.target` always reports).

Draft 1 → final:
- draft1: 97mm tall (over the 90mm budget), zoom line through the last output-token cell
  (geometry/zoom-crosses-node), one bent arrow from the patch row into the projection, L× twice.
- density: compact and a smaller picture: 81mm; projection/encoder 10pt wider than the token rows
  so the zoom corners clear the output row; L× only beside the block in (b).
- Patch cells aligned under the embedding columns (one straight arrow per patch into the
  projection, one out of it per token).
- Self-critique against dit-block and llada (scripts/compare): strokes and arrowheads were
  heavy against the 16pt cells → lineWidth/frameWidth 0.5pt, arrowheadScale 0.9 (0.7 was too small).

## What was hard

- `figure.layout.align` on a tokens **cell** (`{ x: [patches.1, emb.e1] }`) split the single-line
  tokens node: the space was inserted between cell 1 and cell 2, tearing the patch row apart
  and producing two layout/straight-off-side warnings. No diagnostic said the row was broken.
  Aligning whole tokens nodes (`{ x: [patches, emb], at: end }`, `{ x: [out, emb] }`) worked.
  structured.md only warns about this for multi-line tokens.
- `{ x: [head, out.c0] }` moved the whole output-token row instead of the MLP head, so the
  output row no longer lined up with the encoder; which side moves is not predictable from
  the docs. Pinning both to `emb` (fixed) fixed it.
- scripts/compare takes `-o` only before the image arguments (`compare final.png ... -o x`
  failed with "no such file: -o"); the docs show it after.
- Zoom lines are straight from corners: an element as wide as the source just above it gets
  hit; the fix was widening the source, not obvious from the hint.

## What Sumi could not express

- The addition of position embeddings to tokens: drawn as a position row stacked on the token
  row (as in the ViT paper) with a legend, not as an explicit ⊕ per token.
- The "*" class token is a plain cell label; there is no way to set a cell's text size.
