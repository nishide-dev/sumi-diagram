# Run 1 — nsa

Start: 2026-11-20 16:31:54

End: 2026-11-20 16:36:55

## Summary
- Request: row #1 (nsa), theme `sumi`, profile `paper-double`. Final: 176.21mm x 61.21mm.
- Renders: 6 of the figure (draft1 = render 1, which was 197mm wide; final = render 6), plus 1 colour probe and 2 mockup screenshots.
- Final `lint --geometry`: 0 errors / 0 warnings / 2 infos.
  - `geometry/theme-color-use` (4 accent tones: gray, blue, orange, green). Kept: gray is the neutral "skipped block" (recoloured pale via `themeOverrides.tones.gray`), the three hues are the three branches. The lint counts gray as an accent.
  - `geometry/group-empty-area` panel_a 75.5% (threshold 75%): the space is taken by the curved fan-out/fan-in edges and the q_t -> gate line, which the measure leaves out.
- Base layout: `pipeline-branch-merge` (fork with a junction, three branch rows, curved merges into an operator), changed into a `place` panel copied from the mockup coordinates. Examples looked at: `llada` (colour and density), `attention-sheet` (matrix + class legend idiom).
- Mockup: yes (two panels, gate side input, dashed cross-branch edge: not an obvious one-way flow). `mockup.html` / `mockup.png`, 2 rounds (moved the "block scores" label off the line, legend spacing).

## Source facts shown (arXiv 2502.11089, HTML)
- Sec. 3.2, Eq. 5: o_t* = sum over c in {cmp, slc, win} of g_t^c * Attn(q_t, K~_t^c, V~_t^c): three branches, each its own attention, mixed by gate scores.
- Sec. 3.2: g_t^c in [0,1] comes from an MLP and a sigmoid on input features -> "Gate MLP + sigma". The figure feeds the gate from q_t (the current token's features); the paper says "input features", so this is a slight simplification.
- Sec. 3.3.1, Eq. 7: compression maps each block of keys/values (length l, stride d) to one key through a learnable MLP phi -> "Compress blocks", row "cmp" keeps every block (coarsely).
- Sec. 3.3.2, Eq. 8-12: selection importance scores reuse the compression branch's attention scores -> dashed edge "block scores" from the compression attention to "Select top-n blocks"; top-n blocks kept -> row "slc".
- Sec. 4.1: n = 16 selected blocks including 1 fixed initial block and 2 local blocks; l = 32, d = 16, l' = 64, w = 512. Panel (b) is schematic (10 blocks, 5 selected: block 1, three chosen, the last two local blocks); the numbers themselves are not in the figure.
- Sec. 3.3.3: sliding window keeps the most recent w tokens -> row "win" keeps only the last blocks.
- Sec. 3.3.3: the three branches get independent keys/values -> separate branch rows from one k/v source.

## What was hard / what Sumi could not express
- First render 17mm too wide: the 2-per-row legend with long entry texts set panel (b)'s width (71mm). Shortened entries, 10 instead of 12 columns, tightened panel (a) x coordinates. The width hint's breakdown pointed straight at the legend, which helped.
- A pale "skipped" cell: `variant: muted` on a matrix class still draws the navy outline, and gray outlined draws #4e566b (near the ink). Needed `themeOverrides.tones.gray` (line #a3a8b4); that first raised `theme/low-contrast` until a text colour was added, then made the colour-use lint count gray as a fourth accent.
- Overlapping compression blocks (stride d < length l) cannot be shown by matrix cells (no overlap); drawn as one cell per block.
- q_t really enters all three attentions as well as the gate; drawing that with the structured router would need a bus crossing the branch rows, so only q_t -> gate is drawn (attention boxes say "Attention"). This is the main content simplification.
- In `place`, moving the gate down by 3mm did not reduce the empty top-left corner, because the place box is normalised to its contents (as the docs say); the q_t line leaves a void that group-empty-area flags.
- Critique done myself (no subagent) with `scripts/compare` against llada and pipeline-branch-merge: fixed panel (b) being sparse (bigger cells), the dark skipped cells, axis label distance.
