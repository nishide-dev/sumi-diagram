# Run 7 request-states / A
Start: 2026-11-13 15:38:36

## Plan
- Placement: document, ~160mm wide → `paper-double` + `figure.target.minFontSize: 8pt`, theme `sumi`.
- Engine: auto (state machine per layout-tips "choose the engine"); closest example: decision-flow.
- Content checklist: states Received, Validating, Queued, Running, Completed, Failed, Retrying, Cancelled; initial pseudo-state;
  transitions submit, start check, valid, invalid, dispatched, success, error (attempts left), backoff elapsed,
  error (retries exhausted), cancel (from any active state); terminals = Completed / Failed / Cancelled.
- Visual language: states = rounded boxes (box); terminal states = solid tone (green / red / gray) inside a "Terminal" group;
  active states in an "Active" group whose single `cancel` edge stands for "cancel from any active state".

## Renders
1. draft1 (auto, right): 361mm wide (limit 180), and every edge label is 7pt (sumi theme's edge size) → 10× geometry/text-too-small against minFontSize 8pt. The theme cannot draw 8pt edge labels, so transition conditions must become 8pt `label` nodes placed on the line (state —line→ condition —arrow→ state). Switch to structured layout to control where those waypoints go.
2. structured v1: 178.7 × 50.8mm, 0 errors, 1 warning (unsatisfied-align start/received: grid cells take no align struts). Looks: start dot misaligned and its line cuts the group title area; invalid → Failed takes a long detour along the bottom; cancel line crosses the "no retries left" line; group title floats mid-frame.
3. v2 (retry loop above the main row, terminal column on the right): 178.3 × 59.3mm, 2 warnings (unsatisfied-align for a grid cell; edge-on-border for invalid → Failed), cancel crosses succeeded. Main row now reads well; Failed sits low, its two inputs hug the group border.
4. v3 (Failed aligned with "no retries left", invalid enters Failed from below, cancel leaves the group low): 178.3 × 60.7mm, 0 errors / 0 warnings / 2 infos. Remaining by eye: terminal boxes ragged (three x positions, three widths), nothing says "terminal" in words, invalid and cancel lines almost touch at the group's right border.
5. v4 (dashed "Terminal" group, equal 64pt terminal boxes): 182.9mm wide → exceeds-page-width by 2.9mm; widest columns are the "backoff elapsed" and "error, no retries left" labels.
6. v5 (labels broken onto two lines): 174.8 × 62.6mm, 0/0/2. By eye: a block-sized void at the top of the Terminal frame (Completed is held level with Running, below the retry loop), invalid line runs along the bottom and nearly meets the cancel line.
7. v6 (retry loop below the main row, invalid/no-retries above it, Failed first in the Terminal column): 174.8 × 58.2mm, 1 warning (unsatisfied-align c-exhausted/failed), edge-near-border info. By eye: invalid line humps over the "error, no retries left" label; cancel leaves the group at its very bottom and climbs.
8. v7 (invalid moved to the top row; fmt had collapsed the grid onto one line, so my first edit silently missed, re-applied): 174.8 × 60.7mm, 0/0/3 infos. By eye: arrowheads into the terminal boxes sit on the dashed Terminal frame (edge-near-border info); empty bottom-left of the Active panel.
9. v8 (Terminal as a `plain` titled group, Active title bottom-left in the empty corner): 176.4 × 60.7mm, 0/0/2. By eye: both arrows into Failed jog just before the box.
10. v9 (invalid into Failed from the north, c-exhausted aligned with Failed): worse, 2 warnings (edge-crosses-label on the Terminal title, unsatisfied-align for a grid cell) + micro-jog. Reverted to v8.
11. final = v8 layout re-rendered: 176.4 × 60.7mm, paper-double, theme sumi.

## Self-critique of final.png (checklist)
- Content: 8 states present (Received, Validating, Queued, Running, Retrying in "Active (can be cancelled)"; Completed, Failed, Cancelled under "Terminal states", solid green / red / gray). Every transition carries an 8pt condition: submitted, accepted, valid, invalid, worker free, succeeded, error + retries left, backoff elapsed, error + no retries left, cancel (one edge from the Active frame = cancel from any active state). Directions checked in the PNG.
- Readability: all text 8pt (meets target); no label on a line; main path one straight row left→right; retry loop is a closed rectangle below Queued–Running; error paths above.
- Weak spots kept: the Active panel is mostly empty (group-empty-area 84%, bottom-left; the panel title now sits there); the two arrows into Failed each make a small jog; terminal boxes have a fixed 64pt width so they line up, active boxes keep label widths; 176mm wide instead of the ~160mm aimed for (still under 180mm).

## Summary
- End: 2026-11-13 15:44:59
- Renders: 12 `sumi render` runs (draft1 + 11 structured) and 1 `lint --geometry`.
- Final lint: `lint` 0/0/0; render / `lint --geometry`: 0 errors, 0 warnings, 2 infos (placement-usage: 180 × 60.7mm reserved, 98% width; group-empty-area 84% for "Active": the empty corner holds the panel title, kept).
- Hard:
  - The `sumi` theme draws edge labels at 7pt, so with `target.minFontSize: 8pt` every edge label is an error (`geometry/text-too-small`, whose hint says "use a theme or variant with a larger font size" — there is none for theme `sumi`). Transition conditions had to become `label` nodes spliced into each edge (line + arrow), doubling the edge count and forcing the structured engine. The Skill does not mention this idiom for state machines or for a minFontSize above the edge size.
  - Auto layout (recommended for state machines) gave 361mm with right-direction; no control over it.
  - `sumi fmt` collapsed my multi-line grid `items` into one long line, so a later string edit silently missed (one wasted render).
  - Grid cells can't take align struts (`layout/unsatisfied-align`), so lining a waypoint label up with a terminal box outside the grid failed; anchors into Failed still jog.
  - Width is dominated by in-line condition labels; to fit I broke two labels onto two lines.
- Sumi could not express: 8pt edge labels in theme `sumi`; UML final-state (bullseye) marker; a group-to-node "from any state" edge is possible but its source point on the frame is only controllable via `fromAnchor`.
