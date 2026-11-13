# Run 7 request-states / B

Start: 2026-11-13 15:38:36

## Step 1: HTML mockup

- Read SKILL.md, `sumi catalog`, the `sumi` theme (canvas #f8f8ee, ink #30364f, muted #4e566b, tone fills; square corners; edge labels 7pt, node text 8pt, group heading 9pt bold).
- Design: 160mm × 64mm. Happy path left to right (Received → Validating → Queued → Running → Completed) as 2pt emphasis arrows; start dot above Received; retry loop below (Running → Retrying → Queued); terminal states stacked in a dashed "Terminal states" column on the right (Cancelled gray, Completed green, Failed red, filled tones); "cancel requested" shared trunk across the top from Queued and Running; "invalid" from Validating routed under everything into Failed.
- Transition labels drawn as 8pt text (the target minimum) — anticipated Sumi problem: edge labels are 7pt in the `sumi` theme, so they would fail `minFontSize: 8pt`; plan to use `label` nodes.
- Round 1: arrowheads far too large (marker units), "cancel requested" ran into the arrowhead, "attempts left"/"error" touched lines.
- Round 2: fixed marker size, moved labels. Accepted as the mockup (mockup.png).

## Step 2: Sumi reproduction

- Engine: structured, one `place` box with `unit: 1mm` and the mockup's centre coordinates; terminal states as a `dashed` container (`stack`, gap 10mm) placed as one item; states as `box` with explicit sizes (19mm → 54pt, 8mm → 22.5pt, Retrying 65pt; sizes must be multiples of 0.5pt, so mm values from the mockup had to be converted).
- Transition conditions are `label` nodes placed by coordinates, not edge labels: the `sumi` theme draws edge labels at 7pt and fonts cannot be overridden, so edge labels would fail `figure.target.minFontSize: 8pt` (`geometry/text-too-small`).
- Render 1 (draft1): 0 errors, 2 warnings, 2 infos. `layout/place-overlap` + `geometry/label-collision` ("success" on the group border: the group came out wider than in the mockup, padding 4mm), `geometry/edge-near-border` ("invalid" route ran along the group's bottom frame), group content sat 1.2mm lower than the main row (group title reserves space; place cannot align across) so Running → Completed and Retrying → Failed had jogs; the junction start dot is tiny (r 1.5pt).
- Render 2: moved group up/right, "success" left, "invalid" label above its line, start dot = `circle` 7pt solid. Clean, but small step jogs on the cancel trunk and on Retrying → Failed: the router keeps clearance from the placed label nodes.
- Render 3: raised those labels, start dot → `emphasis` (navy). 3 `geometry/edge-jog` infos (0.06–0.21pt micro-jogs).
- Render 4: shifted the group 0.08mm so Cancelled/Failed centres equal the trunk/Retrying centres; one jog left (label clearance).
- Render 5 (final): raised "retries exhausted" 0.4mm. Clean.

Renders: 5 (plus 2 mockup screenshots).

Final lint (`lint --geometry`): 0 errors, 0 warnings, 1 info (`geometry/placement-usage`, informational: 180mm × 61.2mm reserved, 162.5mm wide).

Self-critique (content checklist): 8 states present (Received, Validating, Queued, Running, Completed, Failed, Retrying, Cancelled); 11 transitions, each labelled with its condition (submitted, parsed, valid, worker free, success, error, attempts left, retries exhausted, invalid, cancel requested ×2 on a shared trunk); terminal states grouped and tone-coded; start marked by a dot. Arrows point the right way.

## Where Sumi could not match the mockup

- Edge labels: 7pt in the `sumi` theme with no override → had to hand-place 10 `label` nodes by coordinates; they are routing obstacles, so moving a label 1mm changes routes (caused micro-jogs that took 3 renders to remove).
- No cross-tree alignment inside `place`: the group's title offset meant the group centre had to be tuned by hand (to 0.08mm) to line up Completed/Failed/Cancelled with the main row, the retry row and the cancel trunk.
- The group is larger than its mockup frame (fixed padding), so it covered the "success" label and the "invalid" route at first; route y-positions cannot be set (the "invalid" line still runs ~0.7mm below the group's bottom frame, no warning).
- Start marker: `junction` dot is too small to read as an initial state; used a 7pt `circle` (emphasis) instead. No UML-style final-state marker; terminality shown by the dashed group + filled tones.
- Emphasis (2pt) arrowheads are larger than in the mockup; group title renders regular weight in the rsvg PNG (the SVG asks for Inter Bold).

## What was hard

- Converting the mockup's mm geometry to Sumi's 0.5pt-multiple sizes and place centres.
- Chasing sub-point jogs caused by label-node clearance in the router.
End: 2026-11-13 15:43:30
