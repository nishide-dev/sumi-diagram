# log 1-vit-block S
start: 2026-11-14 03:00:54

## Plan
- Request: ViT encoder block, paper-double, theme sumi; target minFontSize 7pt.
- Layout: started from skills/sumi/layouts/encoder-block (structural match: overview panel + one block drawn open with residuals). Closest examples viewed: dit-block, transformer.
- Mockup: no. The base layout already fixes the two-panel arrangement and the adaptation keeps it (labels only, same counts: 3x3 image -> 9 patches -> 9 + class token); mockup.md says a small edit that keeps the layout needs none. Noted that SKILL step 4 lists "several panels" as non-trivial, so this is a judgement call.
- Visual language: blue tinted = image / patch data; gray = neutral ops (LayerNorm, linear projection, position cells); orange = attention; green = MLP (block MLP and MLP Head); navy emphasis = Transformer Encoder (focus); dark solid cell = class token.

## Rounds
1. draft1: labels replaced. lint --geometry: 0 E / 1 W (geometry/zoom-crosses-node: zoom line through cell 9) / 2 I (placement-usage, sparse-figure). Visually the embedding row was shifted right of the projection/encoder because longer west labels ("Position embedding", "Patch embedding") grow the tokens frame and place centres the frame by default.
2. emb placed with origin: body at the encoder centre (53.8mm): rows re-aligned, warning gone; class-token column now under MLP Head. Still sparse-figure info (top-left void).
3. Candidate density: compact + row gap 10mm: sparse info gone but panel (b) shrank and became shorter than (a), leaving voids above/below it. Rejected.
4. No compact, row gap 14 -> 10mm: sparse info gone, panels balanced. Final.
- Critique vs dit-block + llada (scripts/compare): flow bottom-up in both panels, one focus (encoder), 3 hues + navy; looser than the references (8pt text at 156mm), top-left void beside MLP Head kept because the head sits over the class-token column it reads.

## Final
- Renders: 4 (draft1, round 2, compact candidate, final).
- Final lint --geometry: 0 errors, 0 warnings, 1 info (geometry/placement-usage, informational: 180mm x 102.5mm reserved, width use 86.5%).
- Size: 155.75mm x 102.48mm, paper-double, theme sumi.

## What was hard / what Sumi could not express
- The tokens frame-vs-body origin trap: longer attached labels silently move a placed token row; only visible in the PNG (lint flagged an indirect symptom, zoom-crosses-node).
- Position + patch embedding addition is implied by stacking two token rows; no explicit "+" between rows without extra nodes.
- The MLP Head reads only the class token output; shown by aligning the head over the class column, not by a dedicated edge from that cell out of the encoder (the encoder is one box).
- compact density applies to both panels; shrinking one panel unbalanced the row.
end: 2026-11-14 03:03:11
