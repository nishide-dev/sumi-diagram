# Run 3 deep-crl

Start: 2026-11-20 16:31:55

## Setup
- Sumi v0.19.1 binary, `sumi doctor --skill-version 0.19.1`: Ready to render, Skill matches CLI.
- Target: slide (`presentation-16x9`, 338.7 x 190.5 mm, min 14pt), theme `sumi`, `textScale: 2` (catalog `textScaleFor.presentation-16x9`).
- Engine: structured (block diagram + loop + opened block).

## Source facts shown (arXiv 2503.14858, HTML)
- Sec. 3 (Preliminaries, Contrastive RL): actor-critic; critic = state-action encoder phi(s,a) and goal encoder psi(g); critic output = l2 distance between the embeddings; trained with InfoNCE where (s_i,a_i,g_i) with g a future state of the same trajectory is the positive and goals from other random trajectories are negatives; policy pi_theta(a|s,g) trained to maximize the critic f(s,a,g); online setting, "a replay buffer stores the most recent trajectories".
- Sec. 4.1 (Architectural components): residual block = four repeated units of Dense, LayerNorm, Swish; residual connection applied right after the block's final activation (h_{i+1} = h_i + F(h_i)); depth = total number of Dense layers, so N blocks = depth 4N; actor and both critic encoders are scaled together.
- Sec. 4.4: depth up to 1024 (critic encoders; actor kept at 512 there). Figure says "depth 4N, up to 1024".

## Layout
- Base layout: `encoder-block` (overview + one repeated block opened with `zoom`, residual bypass), combined with the loop idea of `agent-loop`. Examples viewed: `clip` (contrastive matrix with tinted diagonal), `agent-loop` layout PNG.
- Mockup: yes (loop + two panels = non-trivial). Clockwise loop Actor -> Environment -> Replay buffer -> encoders -> critic matrix -> InfoNCE loss, dashed "maximize critic" back to the actor; the encoders sit at the right edge of panel (a) so the zoom into panel (b) does not cross the loop. Mockup round 1: math is raw text in HTML (expected); buffer->psi edge crosses the zoom line (zoom is not routed; accepted).

## Rounds (6 renders of the figure + 1 colour probe + 1 mockup screenshot)
1. draft1: 467mm wide (legend in one row = 340mm), `state s, goal g` label collided with Environment, cylinder too short for its label (label-overflow error), skip edge ran on the dashed x4 frame (edge-on-border), matrix `label` title made edges end in empty space (the matrix frame is borderless but edges stop at it), positive cells and network boxes had the same blue tinted look.
2. Legend `perRow: 2`, separate critic title label and `flush: true` matrix, positive class `pattern: hatch`, cylinder 21mm, `labelSide` on the two actor/env edges, residual skip drawn through two hidden junctions in a `place` box: 364mm wide; zoom line crossed the `future g` label.
3. Tighter coordinates, `N×` note dropped in favour of a caption: 343mm (4.7mm over); `future g` edge squeezed against Encoder phi.
4. Encoders moved left, `future g` from `south:0.88`, dashed edge leaves the critic title: 336.9mm, geometry lint clean.
5. Self-critique (compare against encoder-block and llada): captions of (a) and (b) on different lines, depth note hanging under caption (b), Dense blue = same look as "residual network" in the legend, Environment same gray as layers. Fixed with `align: stretch` on the root row, depth note in the (b) stack, Dense and Environment re-toned: 350.8mm (too wide because the depth note was one long line).
6. Depth note reworded into two short lines: 334.3 x 173.4mm, fits.

## Final
- `lint`: 0 errors / 0 warnings / 0 infos; `lint --geometry`: 0 / 0 / 0. Size 334.26 x 173.39mm (presentation-16x9), text 16pt node / 14pt edge (textScale 2).
- Critique checklist (self, no subagent): density fine for a slide, one blue = residual network (actor, phi, psi), orange = loss only, hatch = positive pairs; one legend; clockwise loop with one dashed back edge; focus = Encoder phi (emphasis) opened by the zoom. Remaining judgement: some empty room under InfoNCE loss to the left of the matrix; zoom line crosses the `future g` edge (zoom is not routed, no diagnostic now).

## What was hard / what Sumi could not express
- Width on a slide: textScale 2 doubles everything, so the legend in one row alone was 340mm; the width hint was precise and helped every round.
- A `matrix` with `label` puts the title inside its borderless frame, so edges stop short of the visible cells; workaround: separate `label` node + `flush: true`.
- A skip connection around a framed (dashed) sub-group hugs the frame (`edge-on-border`); workaround: explicit hidden-junction corners in a `place` box. No way to give a single edge an offset/lane.
- The two `actor <-> env` edges with labels between close boxes collided until `labelSide` was set; label default side is not obvious.
- No nested repeat notation (x4 inside N x): used an attached `x4` label and a text note for N; `N×` attached next to the block cost 10mm width.
- Legend `node` sample cannot show emphasis vs tinted distinction for "opened" encoder (not needed in the end).
- Mockup HTML cannot render label math; mockup shows raw `$...$` text.
End: 2026-11-20 16:38:01
