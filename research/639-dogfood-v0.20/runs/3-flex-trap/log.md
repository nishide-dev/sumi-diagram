Start: 2026-11-22 03:03:28

## Setup
- Request: row 3 (flex-trap), arXiv 2601.15165, side-by-side comparison, paper-double, theme sumi.
- doctor: Ready to render; Skill 0.20.0 matches CLI 0.20.0.
- Read source via arXiv HTML (v4).

## Source facts to show (section refs)
- §2.1: masked diffusion LM starts fully masked and unmasks iteratively; AR (left-to-right) is the special case that always unmasks the leftmost mask.
- §3: "Arbitrary order" = confidence-based decoding (unmask the most confident tokens first, low-confidence remasking); "AR order" = strict left to right.
- §3.2 "Adaptive decoding bypasses logical forks": arbitrary order defers hard, high-entropy tokens; the most bypassed are logical connectors ("Therefore", "Since") = forking tokens.
- §3.2 "entropy degradation": once future context is filled in, entropy at the forks drops sharply; the fork is pre-resolved.
- §3.1 / Fig. 3-4: arbitrary order has a flatter Pass@k curve; its solutions are largely a subset of AR's (HumanEval: 21.3% solved only by AR vs 0.6% the other way). Narrower solution coverage = diversity collapses.
- §4.2: JustGRPO: during RL only, treat the dLLM as an AR policy (past observed, future masked; next-token softmax), so the sequence likelihood is an exact product over next-token probabilities and standard GRPO applies unmodified. AR constraint is a training-time scaffold; no causal mask in the architecture.
- §5.2: at inference JustGRPO keeps parallel decoding (EB sampler).
- Table 1 (not drawn, only for reference): GSM8K 89.1, MATH-500 45.1, HumanEval 49.4, MBPP 52.4.

## Layout choice
- Closest base layouts: two-panel-compare (baseline vs ours with divider) and three-panel-flow. Started from two-panel-compare for (a)/(b) with a dashed separator, plus a full-width (c) strip under them; token rows idiom from llada/three-panel-flow.
- Mockup: yes; the arrangement (two compared panels + a method strip, token rows over steps, a fan-out) is not obvious and has several panels, so the Skill requires one.

## Mockup
- mockup.html / mockup.png, 2 rounds. Round 1 drew an arrow from every step row to a path (wrong meaning: the fan must start from the t=3 state) and arrowed GRPO into the inference rows; round 2 fans from t=3, uses a block arrow to "Inference", adds the legend. Colours from a probe render (sumi: blue #d9e4e6/#3d5d77, orange #efdfce/#814b2d, gray #e1dece/#4e566b, ink #30364f); sizes from `catalog --sizes --css`.

## Visual language
| kind | form | tone |
| prompt token | tokens cell | gray tinted |
| decoded token | tokens cell | blue tinted |
| masked token | tokens cell "M" | muted (white) |
| forking token | tokens cell | orange tinted (the one accent) |
| reasoning path / outcome | small default box | neutral |
| training steps in (c) | short boxes, GRPO = emphasis (focus) | neutral / navy |
| stage change RL -> inference | block-arrow | ink |

## Renders (5 renders of the figure + 1 lint --geometry; probe not counted)
1. draft1: lint clean, render 189.8mm wide (geometry/exceeds-page-width, 9.8mm over); 3 infos geometry/token-column-drift. t=3 step label and path boxes pushed off by the fork note attached under the fork cell (attached note enlarges the row footprint, so align: center centres label against row+note). (b)'s path edge bent.
2. Paths attached east of rows, a_p1 attached to a_t2: 185mm (5mm over); a_t3 -> a_p1 edge routed from the top of the fork cell around; still the t=3 offset.
3. Fan via attach chain (p2 east of t3, p1 north / p3 south of p2), notes moved out of attach into the stack + figure.layout.align x [note, fork cell]: align moved the *cell* (layout/align-splits-tokens warnings) rather than the free note; 191mm.
4. Dropped align, moved (b)'s fork to the same column as (a)'s (cell 4) so a centred note sits under it, cells 6mm -> 5mm, attach gap 6mm, paths 12mm: 170.0mm, all clean.
5. Panel stack gap 6 -> 4mm: final 170.04 x 112.89mm.

## Final lint
`lint --geometry` and `render`: 0 errors, 0 warnings, 0 infos.

## Self critique (compare with llada + two-panel-compare; no subagent per prompt)
1 Density: (a)/(b) dense enough; (c) has a band under its title and below the content (the Inference sub-title makes the row taller and the row is centred). Kept.
2 Sizes: one cell size (5mm) everywhere, one box height.
3 Vocabulary: same four cell kinds in all panels, one legend. (c) is framed, (a)/(b) are plain with a dashed divider: deliberate, (c) is the proposed method.
4 Colour: white, sand-gray, blue, one orange accent, navy emphasis on GRPO only. OK.
5 Text: two-line result notes under (a)/(b) are the longest text; acceptable.
6 Flow: (a)/(b) top-down steps then right to outcomes; (c) left to right then block arrow.
7 Main subject: fan of three paths vs one path is the most visible contrast; GRPO focus in (c).

## What was hard / what Sumi could not express
- An attached note under one tokens cell enlarges the row's footprint, so a sibling label in the same row (t=3) and attached boxes centre on row+note, not on the cells. No way to attach a note without it taking part in row alignment.
- figure.layout.align {x: [note, tokens.cell]} moved the cell (splitting the tokens) instead of the free note in a stack; there's no "move only this one" priority. Workaround: put the fork in the middle column so a centred note is under it.
- geometry/token-column-drift hint says "give both rows the same cell width and gap", but they already had identical cells; the drift came from the step labels' different widths (t=1 4.51mm vs t=2 4.59mm). Fixed by props.width 5mm on the step labels.
- exceeds-page-width width path in round 2 stopped at the token stack (54.9mm) and did not name the attached path boxes that made the panel 84.5mm; "No single edit verified to fit" every time, trial layouts skipped as too large.
- A row of a fan from the whole tokens node: edge to a box attached above routed from the top of a cell (round 2). Needed fromAnchor: east plus an attach chain.
- No per-cell sublabel/marker for "current position x_k" in (c) without adding a cell tone (would add a 4th hue), so (c)'s token row only shows observed/masked.
- Not drawn (kept to the caption): Table 1 numbers (GSM8K 89.1 etc.), EB sampler name, HumanEval 21.3% vs 0.6%.

End: 2026-11-22 03:08:54
