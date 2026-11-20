# Run 7 deepseek-r1 log

Start: 2026-11-20 16:37:48

End: 2026-11-20 16:44:48

## Setup
- Sumi v0.19.1 binary, `sumi doctor --skill-version 0.19.1`: Ready to render; Skill matches CLI.
- Theme `sumi`, profile `screen-doc`, `themeOverrides.textScale: 1.5` (catalog `textScaleFor.screen-doc`).
- Source: arXiv HTML of 2501.12948 (current version, with Dev1/Dev2/Dev3 checkpoints and appendices).

## Layout and mockup
- Base layout: `multi-stage-data-flow` (stages with data stores, solid = flow, dashed = data, legend), adapted
  to a single `place` (unit 1mm) because the procedure branches three times from the base model.
- Mockup: yes (`mockup.html` / `mockup.png`), because the arrangement is not obvious (three branches from one
  base model, data feeding back into later stages, a split to distillation). The mockup fixed the structure
  (5 columns x 5 rows, base model on the left, R1-Zero lane on top, final lane on the bottom). Its text overflowed
  some boxes; I corrected widths in the YAML rather than redrawing the mockup.
- Probe figure rendered in the scratchpad to read tone colours for the mockup (first probe failed: a group without
  an arrange -> layout/unplaced).

## Facts shown (section references, arXiv 2501.12948 HTML)
- DeepSeek-V3-Base is the base of R1-Zero and R1 (Sec. 1, App. A.1).
- R1-Zero: RL (GRPO) directly on the base, rule-based rewards (accuracy + format) (Sec. 2.1, 2.2).
- Cold-start data: "thousands" of long CoT with a conversational, human-aligned thinking style (Sec. 3);
  made by converting R1-Zero outputs into a readable style, expanded and verified (App. B.3.2) -> edge "readable rewrite".
- Cold-start SFT and the second SFT both fine-tune DeepSeek-V3-Base (App. B.4.2) -> both SFT boxes take the base's weights.
- Reasoning RL (first RL stage of R1) adds a language consistency reward (Sec. 3.2.1).
- Rejection sampling from the first-stage RL checkpoint, ~600k reasoning samples (App. B.3.3).
- ~200k non-reasoning samples, reusing DeepSeek-V3's SFT data (App. B.3.3) -> "~200k, from V3".
- ~800k SFT data in total (App. B.3.3, Table 5: 804,745).
- Second RL stage: rule-based rewards for reasoning + reward models (helpfulness, safety) for general data (+ language) (Sec. 3.1, 3.2.2) -> "+ reward models".
- Distillation: fine-tune Qwen2.5-Math-1.5B/7B, Qwen2.5-14B/32B, Llama-3.1-8B, Llama-3.3-70B-Instruct on the 800k data, 2-3 epochs (App. B.4.3, Table 6) -> "Qwen2.5 · Llama 1.5B–70B", "SFT only".
- GRPO is used for every RL stage (Sec. 2.1; Sec. 3.2.1 sets the GRPO clip ratio) -> legend "RL stage (GRPO)".
- Not shown: the intermediate checkpoint names Dev1/Dev2/Dev3 (Fig. 2 caption, Sec. 4). They were edge labels in the
  draft, but the 7.5mm gaps between columns at screen-doc width could not hold them; dropped (presentation choice).

## Renders
- 6 renders of the figure (draft1, then 5 of figure.sumi.yaml incl. one 0.03mm too wide) + 2 probe attempts + 1 mockup screenshot.
- draft1: 5 geometry/label-overflow errors (fixed widths, a two-line R1-Zero), 4 dash-hidden warnings, 1 edge-crosses-label, 2 infos.
- Final `lint --geometry`: 0 errors, 0 warnings, 0 infos. Size 199.14mm x 140.93mm (screen-doc max 200 x 150).

## What was hard
- Width: screen-doc at textScale 1.5 gives 12pt labels in a 194mm content width; five columns of 34mm boxes leave
  ~7mm gaps, too narrow for edge labels (Dev1/Dev3) and for dashed arrows (geometry/dash-hidden).
- Cylinder with a label + sublabel needs props.height >= 65pt (23mm), far taller than the 13mm boxes beside it;
  that broke the row rhythm, so I switched data to the `stack` component (a stack of sheets), which reads as a dataset.
- The `stack` component's label is centred on the front sheet, so long labels touch its left edge unless the node is wider.
- The exceeds-page-width hint was useful (0.02mm to remove); fixed by moving one node.

## What Sumi could not express / workarounds
- No way to show the checkpoint name at a point on an edge without an edge label that needs room; would like a small
  edge "tag" (e.g. a label on the line itself) or a node badge.
- Cylinder minimum height for two text lines is large; workaround: `stack` component.
- Non-reasoning data enters "SFT data" from the side via `fromAnchor: south, toAnchor: east` to avoid a too-short horizontal dashed arrow.
- Step 7.4 (critique against references) is mandatory only for paper figures; this is a README figure, so I did a self-check
  against the step 7 checklist instead (content complete, arrows correct, no overlaps, one legend, one form per kind).
