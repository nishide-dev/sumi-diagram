# Run 5 agent-loop (S)

Start: 2026-11-14 03:00:54

## Plan
- `sumi doctor`: d2 missing in the snapshot (fonts, geometry ok). Structured layout does not need D2, so the figure is structured (it needs anchors/loop routing anyway).
- Placement: blog, ~160mm wide → profile `screen-doc`, theme `sumi`, `textScale: 1.5` (catalog `textScaleFor`), `target.minFontSize: 9pt`. Keep width ≤160mm myself.
- Base layout: none of the four (encoder-block, train-infer-panels, compare-rows, set-taxonomy) has a cycle of steps with side stores; planned from scratch. Looked at train-infer-panels (iteration loop) and decision-flow example for idioms.
- Mockup: yes — the figure is a loop (Skill: loops require a mockup).
- Checklist: User request (in), LLM, Plan, Tools {Search, Code execution, Files}, Observation, Short-term memory, Long-term memory, Environment, Final answer (out). Loop: LLM → Plan → Tool call → Environment → Observation → LLM; LLM ↔ memories; request → LLM; LLM → final answer when done.
- Render 1 (draft1): 169.7 × 110.6mm, 0 errors, 1 warning (label-collision: 'act' over Code execution). Before that 1 failed render attempt (place-overlap + 2 no-route: bottom row too close; Sumi boxes larger than mockup).
- Render 2: width over 160mm fixed (LLM 48→40mm, "Code\nexecution" on two lines narrows Tools, Plan 24mm); loop edges from `emphasis` to default (emphasis arrowheads were huge at textScale 1.5); dropped "act" label; aligned short-term memory with LLM. 159.8 × 113.2mm, clean.
- Render 3: raised bottom row → `label-collision` (tool call vs Plan). Render 4: lowered again, clean, but the "result" edge label sat over the Observation/Environment corners with **no diagnostic**. Render 5: removed that label (Observation names the result). Render 6: Tools→Environment arrow was cramped (no diagnostic), widened gap.
- Renders: 7 figure renders (1 failed with no-route, draft1, 5 revisions) + 1 colour probe + 2 mockup screenshots. Stopped at the Skill's 6-round limit.
- Final: 159.8 × 111.8mm, screen-doc, textScale 1.5 (node 12pt, edge 10.5pt ≥ 9pt target). Lint: 0 errors / 0 warnings / 1 info (geometry/placement-usage, informational).
- Self critique (no subagent): content checklist all present and arrows correct; loop reads clockwise LLM → Plan → Tools → Environment → Observation → LLM with a refresh icon + "until done" in the middle; 3 accent tones (orange in/out, green memory, blue tools) + navy emphasis on LLM. Remaining: empty corner under Memory (bottom-left), Tools group sets the height; "tool call" label hugs the Plan box.
- Hard / not expressible: Sumi's boxes were larger than the mockup (Inter metrics + padding) so the first place collided; a loop "badge" needs two nodes (icon label + attached text: a label cannot carry icon and text); an edge label overlapping node frames and a cramped arrowhead were not reported; emphasis edges scale arrowheads heavily with textScale; no way to say "Environment" contains the tools' effects other than a separate dashed box.

End: 2026-11-14 03:06:43
