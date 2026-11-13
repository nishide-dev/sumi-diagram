# Run 7 request-states (S)

Start: 2026-11-14 03:00:53

## Plan
- Profile `screen-doc` + `textScale: 1.5` (Skill's `textScaleFor` for sumi), theme `sumi`, `target.minFontSize: 8pt` (actual text 12pt nodes / 10.5pt edges).
- `sumi doctor`: d2 missing (only d2 failed) -> structured layout only, which the Skill recommends anyway for a cyclic state machine.
- Base layout: none (the four seeds are encoder-block, train-infer-panels, compare-rows, set-taxonomy; none is a state machine). Planned from scratch.
- Mockup: yes, required by the Skill (state machine with a retry loop).
- Probe render for colours: ink #30364f, canvas #f8f8ee, group #efeddd/#4e566b, green #dce7d3/#426344, red #efd8d0/#813f40, gray #e1dece/#4e566b; frames/edges 1.5pt; node 12pt, edge 10.5pt, group 13.5pt bold.
- Conditions on transitions are not given in the request; I chose standard ones (assumption): 到着, 受理, 検証OK, ワーカー割当, 成功, エラー, バックオフ後, 上限超過, 検証エラー, キャンセル要求 (from the whole 進行中 group).
- Visual language: non-terminal states = default box; terminal states = tinted (完了 green, 失敗 red, キャンセル gray) inside a "終端状態" frame; error transitions red edges, success green edge; initial = sumi/initial.

## Rounds
1. Mockup (mockup.html/png, 165 x 100mm): main path in one row inside a "進行中" frame, retry loop under 待機/実行中, terminal states in a bottom row under their sources, cancel as one edge from the 進行中 frame. Passed the checklist on the first round (left-bottom void of the frame kept: the 検証エラー line runs through it).
2. draft1 (place, unit 1mm, mockup centres): matched the mockup closely. Differences: the group title is drawn inside the frame and reserves space, so the frame grew upward and the initial dot (placed outside the group) was 4.06mm off the 受付 line (jog in the 到着 arrow); captions are regular weight while titles are bold, so "終端状態" (caption) did not match "進行中" (title).
3. Tried figure.layout.align {y: [start, received]}: layout/unsatisfied-align (align cannot move items in a place box). Instead moved the dot's y by 4.06mm.
4. Terminal frame: caption -> title. labelAt top put "終端状態" on one line with the three edge labels (cluttered); labelAt bottom (final) moved it away and let the edge labels sit in the gap between the frames.

## Result
- Files: figure.sumi.yaml, final.svg (156.99 x 89.43mm, screen-doc, textScale 1.5; nodes 12pt, edges 10.5pt, titles 13.5pt; target minFontSize 8pt met), final.png; draft1.*; mockup.*.
- Renders: 5 of the figure (draft1 + 4 edits incl. 1 failed align attempt counted) + 1 colour probe in the scratchpad; 1 mockup screenshot.
- Final lint (lint --geometry): 0 errors, 0 warnings, 3 infos: placement-usage (information), group-empty-area for both frames (intentional: a state machine with two rows in the 進行中 frame and three terminal states aligned under their source states; the void carries the 検証エラー line).
- Layout used: none (no base layout for state machines). Mockup: yes (Skill requires one for state machines).
- Hard: d2 missing in the snapshot (doctor fails), irrelevant for structured. Group title inside the frame shifts the frame relative to mockup coordinates (a title above the border as in the mockup template is not what Sumi draws). Choosing where edge labels go on vertical edges crossing two frames.
- Sumi could not express: a UML final pseudostate per terminal state cleanly without extra width (used a "終端状態" frame + tones instead); align across a place box; caption weight matching title weight.
- Assumed transition conditions (not given by the request): 到着, 受理, 検証OK, ワーカー割当, 成功, エラー, バックオフ後, 上限超過, 検証エラー, キャンセル要求.

End: 2026-11-14 03:06:17
