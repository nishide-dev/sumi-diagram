# Run 7 olmo3 log

Start: 2026-11-22 03:03:27

End: 2026-11-22 03:10 (wall clock as reported by `date`)

## Setup
- Request: row 7 (olmo3), Olmo 3 tech report, arXiv 2512.13961 (read from arxiv.org/html). Theme `sumi`, profile `paper-double`.
- `sumi doctor --skill-version 0.20.0`: Ready to render; Skill and CLI match.

## Layout and mockup
- Base layout: `pipeline-branch-merge` (one flow forking into parallel rows, without the merge), with the shared column grid idea of `compare-rows` (SFT / DPO / RLVR in the same columns in every row, RL-Zero leaving the SFT and DPO cells empty).
- Mockup: yes (`mockup.html`, `mockup.png`). Reason: two panels plus a fork and a cross edge (warm start), and it was not clear whether one strip would fit 180mm. The mockup showed ~190mm wide and that the RL-Zero edge label needs the empty SFT/DPO cells; both carried into the YAML.
- Colours from a probe render (blue tinted #d9e4e6/#3d5d77, green tinted #dce7d3/#426344, emphasis #30364f).
- Visual language: blue tinted box = base-training stage on Dolma 3 data; green tinted box = post-training stage on Dolci data; navy `emphasis` box = released checkpoint; dashed arrow = initialisation (warm start); token counts as notes under their stage. Panel titles explain the two tones, so no legend.
- Candidates: one strip (chosen; 179mm × 44mm, 8pt text, no scaling) vs. folding base training above post-training (rejected in planning: the fork from Base would have to run back left) vs. `fit: scale` at 0.95 (rejected after shortening "Olmo 3 Base" to two lines removed the need).

## Source facts shown (section refs)
- Base model training in three stages (§2.1): pretraining on Dolma 3 Mix, up to 5.9T tokens (§2.1, §3.4); midtraining on Dolma 3 Dolmino Mix, 100B tokens (§2.1, §3.5); long-context extension on Dolma 3 Longmino Mix, 50B tokens for 7B and 100B for 32B (§2.1, §3.6). Result: Olmo 3 Base, 7B and 32B (§1).
- Post-training on the Dolci suite into three variants (§2.2):
  - Olmo 3 Think: SFT (Dolci Think SFT) → DPO (Dolci Think DPO) → RLVR (Dolci Think RL, OlmoRL) (§2.2, §4.2-4.4); 7B and 32B.
  - Olmo 3 Instruct: SFT (Dolci Instruct SFT) → DPO (Dolci Instruct DPO) → RLVR (§2.2, §5.2-5.4); its SFT starts from the Olmo 3 Think SFT model as a "warm-start" (§5.2.2, "Starting from Olmo 3 Think SFT"); 7B and 32B (§1).
  - Olmo 3 RL-Zero: RLVR directly from Olmo 3 Base on Dolci RL-Zero, four domains: math, code, precise instruction following (IF), general mix (§2.2, §6.1); 7B (§1).
- Not shown (scope): Olmo 3.1 Think 32B (extended RL, §2.2/§2.4), the "up to 65K context" result (§2.1), dataset names per row (the panel title says Dolci).

## Renders
- 5 renders of the figure (draft1, compact density, tighter gaps + notes, two-line note + stretch, two-line Base), plus 1 colour probe and 4 throwaway diagnostic renders to find what widened panel (b). Final `lint --geometry`: 0 errors, 0 warnings, 0 infos.

## Changes after draft1
- draft1: 197mm wide (exceeds-page-width), RL-Zero curve through the Instruct SFT box with its label on DPO/SFT (edge-through-node, label-collision ×3), edge-on-border, text-heavy-nodes (stage boxes with two sublabel lines).
- Fixes: dropped `route: curve` on the fork (orthogonal trunk; RL-Zero edge now runs through the empty cells with its label there); token counts moved out of the boxes into attached notes (fixed text-heavy); `density: compact`, gaps 3mm, `props.padding: 2mm`; "50B (7B)\n100B (32B)" on two lines; model column `align: stretch` so the four checkpoints are equally wide; "Olmo 3\nBase" on two lines to reach 179mm.

## Critique (done myself against compare-rows and llada, checklist)
1. Density: full strip; a small void under panel (a) next to the two-line note, and above panel (a) because the panels have different heights (kept: the panels are centred on the main flow).
2. Sizes: stage boxes equal height per panel; checkpoints equal width after stretch.
3. Vocabulary: one form per kind; no legend needed (panel titles name the data suites, the dashed edge is labelled).
4. Colour: white ground, two pale tints + navy; the four navy checkpoints are the heaviest marks (deliberate: they are the released models), but the right half is darker than the left.
5. Text: short labels; numbers as notes.
6. Flow: one left-to-right reading; one fork.
7. Main subject: the branching into Think / Instruct / RL-Zero is clear.

## What was hard / Sumi limits / workarounds
- `props.padding: 2mm` on panel (b) was silently overridden: the width breakdown reports "padding 13pt + 13pt" (in draft1 it said "(profile default)") even with compact density and an explicit padding. Only removing the edges entering the panel from outside restored 5.5pt; a `plain` variant or no junction did not. It costs ~5mm of the 180mm. Probably the automatic growth for arrowhead room (`geometry/arrowhead-cramped` docs mention "tight group padding grows automatically"), but neither the hint nor `--explain-width` says why, and the right side grows too though no edge enters there.
- The width hint offered only "row gap 0mm" as a verified edit; the real savings (shorter labels, two-line labels) had to be found by hand.
- `route: curve` fork (the base layout's idiom) does not avoid obstacles; with an empty-cell row it went through a box. Orthogonal routing was better here.
- Sumi cannot say "50B for 7B / 100B for 32B" compactly; used a two-line note.
