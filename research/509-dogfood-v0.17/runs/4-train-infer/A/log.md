# Run 4 train-infer, condition A

Start: 2026-11-13 15:38:36

## Plan

Read SKILL.md, layout-tips (placement, design principles, visual language, critique), structured.md (arrange, separators, tokens, legends, align, edges). Closest examples: LLaDA (training vs sampling with token rows) and DiT block (panels, captions).

Placement: paper-double, theme sumi. Aim ~160mm wide; height budget not given (assume <= 80mm).

Content checklist:
- Training panel: input tokens; masking -> masked input; Encoder; Decoder; predictions at masked positions; Loss (prediction vs original tokens).
- Inference panel: input tokens; Encoder; iterative generation (Decoder repeated, generated token fed back); output tokens.
- Shared weights: training Encoder = inference Encoder, training Decoder = inference Decoder.

Visual language:
| Kind | Form | Tone |
| --- | --- | --- |
| observed tokens | tokens cells, tinted | blue |
| mask token | tokens cell, solid gray "M" | gray |
| predicted / generated tokens | tokens cells, tinted | orange |
| Encoder | box filled | green |
| Decoder | box filled | purple |
| loss | box (accent) | red |
| data flow | arrow | ink |
| shared weights | dashed double-arrow between panels | ink |
| panels | groups with captions (a) Training (b) Inference, separator | neutral |

Candidates: (A) two panels side by side, each a top-down stack, shared-weight links horizontal across the divider; (B) two panels stacked, each flowing left to right, shared-weight links vertical.

## Rounds

1. draft1 (render 1): 131 x 91mm. Inference input far above its encoder (align grew the figure), dashed "target" edge from the input row to Loss crossed both shared-weight links, "append" loop label collided with the "Iterative generation" group title. 3 warnings, 7 infos.
2. Render 2: aligned inference input with the masked row; replaced the long target edge with local target tokens (x2, x4) feeding Loss from the right; title moved top-right. Group title took its own row and pushed the decoder down; loop label hit the frame.
3. Render 3: title bottom-left, loop over the top. Output edge ran on the frame border; `fromAnchor: straight` had no effect (layout/straight-off-side).
4. Render 4: dropped the group title, attached a "Iterative\ngeneration" label east of the dashed frame; `align x` put y_t over y_T so the output edge drops straight; centerOn for the loss row (left a large void on the left: width 173mm).
5. Render 5: loss row without centerOn, `fromAnchor: straight` from Decoder; 134mm wide. Compared against LLaDA and DiT with scripts/compare (self-critique, no subagent).
6. Candidate B (render 6): panels stacked, flows left to right, shared-weight links vertical. 144 x 86mm. Rejected: the request puts training left and inference right; also the vertical links crossed the caption area.
7. Render 7 (critique fixes): five hues (blue, green, purple, orange, red + navy mask) reduced to blue tokens / orange predictions / purple models / red loss accent; tokens borderless (filled) like the LLaDA reference so they weigh the same as the model boxes; panel gap 16mm.
8. Render 8: `density: compact` candidate: 139 x 75mm vs 142 x 85mm, same text size, removes the sparse-figure info and the self-set 80mm budget warning. Chosen.
9. Render 9: final.svg.

Self-critique against the checklist (final): density acceptable (no sparse info), still looser than LLaDA; sizes consistent; one vocabulary (same Encoder/Decoder boxes in both panels, tokens by role); colour 3 hues + red accent on cream; text minimal; flow top-down in both panels; focus: shared weights via the two horizontal dashed links. Remaining weakness: training Encoder-Decoder gap is longer than needed because the decoder aligns with the inference decoder inside the loop frame (align grew the figure 11mm).

## Final lint

`sumi lint`: 0 errors, 0 warnings, 0 infos. `sumi render`: 0 errors, 0 warnings, 3 infos, kept:
- layout/align-grew-figure: intended, keeps both shared-weight links horizontal.
- geometry/placement-usage: report only (139 x 75mm, 77% width, 94% of the 80mm budget I assumed).
- geometry/group-empty-area (loop frame 79% empty): the frame must hold the loop arrow above Decoder and y_t.

Size: 138.99mm x 75.32mm, paper-double, theme sumi, no scaling (text at theme sizes 7-9pt).

## What was hard

- Group titles always reserve a full row inside the frame: a small dashed loop frame with a title grew the figure and pushed one side's decoder down; the title then collided with the loop arrow or the output edge in every labelAt position. Workaround: untitled frame plus an attached label.
- `fromAnchor/toAnchor: straight` silently fails when the narrow end lies outside the wide box; needed to rearrange (drop centerOn) before it worked. centerOn reserves symmetric space and created a 30mm void.
- The `compare` script needs `-o` before the inputs (passing it after is read as a file name).
- Height budget: the request gives none; I assumed 80mm.

## What Sumi could not express

- A loop/iteration marker other than a frame + back edge (no "x T" repeat badge on a group without an html leaf or label).
- Shared weights as a property (no tied-weights mark); drawn as dashed double-arrows across the divider.
- A mask cell as a crossed box would need an SVG asset; used a solid gray "M" cell.

Renders: 9 (including 1 rejected candidate and 1 compact candidate)
End: 2026-11-13 15:43:00
