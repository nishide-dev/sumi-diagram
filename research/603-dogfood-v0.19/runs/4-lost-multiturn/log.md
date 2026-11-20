# Run 4 lost-multiturn

Start: 2026-11-20 16:31:55

## Source (arXiv 2505.06120, HTML) — facts shown
- Sec. 3.1 / Fig. 2: a fully-specified instruction is split into shards; shard 1 states the high-level intent, later shards add one detail each. GSM8K example (Jay's snowballs): full text "Jay is making snowballs to prepare for a snowball fight with his sister. He can build 20 snowballs in an hour, but 2 melt every 15 minutes. How long will it take before he has 60 snowballs?"; shards S1 "How long before Jay's ready for the snowball fight?", S2 "He's preparing for a snowball fight with his sister.", S3 "He can make 20 snowballs per hour.", S4 "He's trying to get to 60 total.", S5 "The problem is that 2 melt every 15 minutes." (shortened in the figure where noted).
- Sec. 3.2: user simulator (GPT-4o-mini) sees the full sharded instruction, reveals at most one shard per turn (rephrased); assistant = evaluated LLM; strategy classifier labels each reply (clarification, refusal, hedging, interrogation, discussion, missing, answer attempt); answer extractor isolates the answer of an answer attempt; task-specific evaluator scores it. Ends when an attempt is correct or the simulator runs out of shards at the start of a turn.
- Sec. 3.3: FULL = whole instruction in one turn (baseline); SHARDED = one shard per turn.
- Sec. 6.1 / abstract: average −39% from Full to Sharded across 15 LLMs and six tasks.
- Illustrative (not from the source): which strategy the assistant uses in each turn of panel (c) (clarification, wrong attempt at turn 2, correct at turn 5). Shard order S1..S5 is one possible order.

## Plan
- Layout: started from no base layout exactly; closest were `two-panel-compare` (baseline vs method) and the `llm-dialogue` example (chat); used the chat idiom plus a pipeline-feedback-like strip. Base layout used: none (from scratch, idioms from two-panel-compare / pipeline-feedback / llm-dialogue).
- Mockup: yes (4 panels incl. a loop; arrangement not obvious). 2 mockup rounds (round 1: text overflow in card/S1, missing end node and "no attempt" path).
- Visual language: blue tinted = user side (shards, user bubbles, user simulator); navy emphasis = assistant under test (focus); orange tinted = answer attempts (what gets scored); muted = helper roles; final marker = end.
- Theme sumi, profile paper-double.

## Renders
1. draft1: 224 x 135mm, TOO WIDE (error), label collision of the two loop-back edge labels, info edge-label-on-corner.
2. 219 x 121mm, still too wide (removed the nested plain groups "left"/"shards" that added padding), S1 label-overflow at 40mm.
3. 190 x 124mm, too wide.
4. 179 x 122mm fits; chat-overflow warning in (c), long edge label warning.
5. 179 x 126mm, clean (0/0/0).
6. moved the −39% note under (b) to fill the void there: height grew to 130mm and (c) got a void at top (row align: stretch centres the chat) → reverted.
7. final = render 5 again, clean.
Total renders: 7 (plus 1 probe render for colours; 2 mockup screenshots).

## Final
- final.svg: 178.7 x 125.8mm, paper-double, theme sumi. Lint (incl. --geometry): 0 errors, 0 warnings, 0 infos.
- Content check: (a) instruction → 5 shards (S1 = intent); (b) whole instruction in one user turn, one scored answer attempt; (c) one shard per user turn, strategy per assistant turn, ends at a correct attempt; (d) user simulator → assistant → strategy classifier → (if answer attempt) answer extractor → evaluator → end if correct, else next turn until no shards are left. All arrows point the right way.
- Critique vs llada / llm-dialogue (done myself, no subagent): (1) looser than LLaDA, block-sized void under (b) and left of (d) title; (2) sizes consistent; (3) blue = user side everywhere, orange = scored answer attempts; but the assistant is navy in (d) and white/orange bubbles in (c) — kept, the bubble colour carries the strategy instead; no legend (roles are named in (d), meta notes name speakers) — justified, but a reviewer may want one; (4) white ground, 2 hues + navy, fine; (5) text-heavier than LLaDA because the example instruction and shards are the content; (6) flow (a)→(b)/(c)→(d) reads, (d) loop clear; (7) (c) is the largest panel.

## What was hard / what Sumi could not express
- Width: the first draft was 224mm. Nested plain groups used only for arranging add padding; replacing them with anonymous arrange boxes saved ~30mm. The width hint was helpful but only offered "row gap 0".
- Chat bubbles: no way to make the assistant bubble in (c) and the "Assistant" box in (d) share a look without making every assistant bubble navy (emphasis bubble would be heavy). No avatar used, to save width.
- A branch "no answer attempt → next turn" from the classifier: with two back-edges to the same node, their labels collided at the target end (geometry/label-collision); I merged them into one loop from the evaluator and labelled the classifier→extractor edge "if attempt" (simplification; the classifier's non-attempt path is implicit).
- Edge label "if attempt" is placed above the row, away from its edge (structured router chose it), and "1 shard"/"reply" sit tight between boxes.
- Balancing two column heights: row align: stretch centres a chat vertically inside a taller panel, leaving a void at the top; no way to let the left stack fill the height except moving content.
- S5 user bubble wraps to two lines at the chat's maxWidth; the bubble text width is controlled only through chat width x maxWidth.
- Mockup text sizes (system font) differed from Sumi's measured widths (S1 wrapped in the mockup, not in Sumi; card padding in Sumi was larger).

End: 2026-11-20 16:37:41
