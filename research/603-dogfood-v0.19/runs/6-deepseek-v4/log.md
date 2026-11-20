# Run 6 deepseek-v4

Start: 2026-11-20 16:37:18

## Source (arXiv 2606.19348, read via arxiv.org/html)
- Sec. 2 / Fig. 2 caption: hybrid CSA + HCA attention layers, DeepSeekMoE FFNs, residuals strengthened with mHC.
- Sec. 2.2 mHC: residual stream widened to n_hc x d; X_{l+1} = B_l X_l + C_l F_l(A_l X_l) (Eq. 1);
  A_l input map (1 x n_hc), C_l output map (n_hc x 1), B_l residual map projected onto doubly stochastic
  matrices by Sinkhorn-Knopp (t_max = 20). Sec. 4.2.1: n_hc = 4.
- Sec. 2.3.1 CSA: compress every m tokens into one KV entry (m = 4, Sec. 4.2.1); lightning indexer scores
  compressed entries, top-k kept (k = 1024 Pro / 512 Flash); shared-KV MQA; grouped output projection.
- Sec. 2.3.2 HCA: compress m' >> m tokens into one (m' = 128), no sparse selection, dense attention over all.
- Sec. 2.3.3 / Fig. 3-4 captions: both add n_win = 128 sliding-window uncompressed KV entries.
- Sec. 4.2.1: later layers alternate CSA and HCA (first two layers differ: SWA in Flash, HCA in Pro).
- Sec. 2.1: DeepSeekMoE with shared + fine-grained routed experts; affinity Sqrt(Softplus); hash routing
  replaces dense FFN in the initial blocks. Sec. 4.2.1: 1 shared, 384 routed (Pro; 256 Flash), 6 active,
  hash routing in first 3 MoE layers.
- Interpretation (not stated explicitly): mHC drawn around each sublayer (attention and MoE), as F_l in Eq. 1.

## Process
- Layout: started from `encoder-block` (overview + opened block with residual bypasses); MoE panel borrows
  idioms from `moe-router` layout and `llama4-moe` example (zoom into panels).
- Mockup: yes (several panels + zoom; arrangement not obvious). 2 rounds (round 2: shorter MoE panel,
  indexer moved left of the compressed row to clear the window edge, panel letters).
- Theme `sumi` (per request; Skill would recommend `paper`), profile `paper-double`.

## Rounds (renders: 10 of figure YAML, plus 1 probe and 2 mockup screenshots)
1. draft1: 248mm wide (TOO WIDE), sand-filled panels (`sumi` groups are filled; colour-on-panel infos),
   muted gray cells indistinguishable from tinted gray, legend row 179mm wide.
2. `groupFill: '#ffffff'`, `outlined` gray for not-selected cells/idle experts, selected entries drawn as
   separate edges, legend perRow 3, CSA/HCA rows aligned with `figure.layout.align` -> 204mm.
3. MoE panel coordinates compressed, legend moved under (a) -> 193mm, B_l boxes overlapped mixers
   (`layout/place-overlap`), `hash-note` vs `experts-label` collision.
4-6. B_l boxes moved, tokens 16 -> 12 cells, legend back to the right column, block padding 1pt,
   ×L moved closer -> 183.4mm. Width hint said "the right stack is 125.41mm: attn 125.41, moe 125.41,
   legend 125.41" (all stretched to the same width), so it did not say which child set the width;
   found by trial: the legend (shortening one entry label -> 176.2mm).
7. Self-critique with `scripts/compare` against llama4-moe and llada (no subagent per study rules).
8-10. Window labels; tried `align x` of csa-kv.k1 with csa-sel.s1 -> `layout/align-splits-tokens`
   (pulled the tokens apart), reverted.

## Final
- figure.sumi.yaml -> final.svg 176.2 x 130.7 mm, paper-double, theme sumi.
- lint --geometry: 0 errors, 0 warnings, 2 infos (geometry/group-empty-area on "block" 75.8% and
  "moe" 75.9%: the block column is thin boxes with residual side paths; the MoE panel width is set by
  panel (b) below it. Kept.)

## Self-critique (checklist, against llama4-moe / llada)
1. Density: (b) has an empty band between its title and the CSA/HCA titles (plain sub-group titles +
   padding); bottom-left beside the legend is empty. Less dense than LLaDA.
2. Sizes consistent; thin strokes match the encoder-block layout.
3. Vocabulary: one tone per kind, but gray covers three kinds (tokens, residual streams, mHC maps) to
   stay within 3 accent tones; mHC, one of the three subjects, has no colour of its own.
4. Colour: white ground, 3 tints (orange attention, green experts, blue compressed KV). OK.
5. Text: short labels only.
6. Flow: (a) bottom-up; (b) bottom-up; (c) left-to-right. Panel letters: (b) is below (c) because the
   panels sit beside the sublayer they zoom from (attention lower, MoE upper) -> letters do not follow
   top-to-bottom reading. CSA's top-k edges (k1 -> s1, k3 -> s2) jog sideways.
7. No single focus: the request names three things (CSA/HCA, mHC, MoE), all equal weight.

## What was hard / what Sumi could not express
- mHC is n_hc = 4 parallel residual streams mixed by B_l: Sumi has no "bundle of parallel lines"; drawn
  as 4-cell tokens at input/output and one line in between, so the width-4 stream is not visible
  along the residual path.
- Sliding-window entries are a subset of the raw tokens: no way to mark a span of cells (bracket would
  work but adds text); used an edge from one cell labelled "window".
- `sumi` theme fills groups sand by default; the white-panel advice needs `themeOverrides.groupFill`.
- `muted` on a gray-toned cell looks identical to `tinted` gray; used `outlined`.
- Width hint for a stretched stack reports all children at the same width; finding the culprit
  (legend) took 3 renders.
- Aligning one cell of a tokens row to another tree splits the tokens (`layout/align-splits-tokens`);
  could not get straight top-k edges.
- `labelAt` for the window label: `start` puts it far right of a vertical segment; `middle` put it
  beside another edge (CSA). Kept start for CSA, middle for HCA.
- Workarounds: `place` (unit 1mm) for (a) and (c) from mockup coordinates; groupFill override.
- The paper does not say explicitly that mHC wraps each sublayer; drawn so per Eq. 1 with F_l = sublayer
  (interpretation, flagged above). Expert cells/selected entries are schematic (not actual indices).
End: 2026-11-20 16:45:27
