# Run 5 agent-loop, condition A

Start: 2026-11-13 15:38:35

## Plan

Content checklist: user request → LLM; LLM → plan; plan → tools (search, code execution, files);
tools act on environment; environment → observation; observation → LLM (loop);
LLM ↔ short-term memory, LLM ↔ long-term memory; LLM → final answer (exit).

Placement: blog, ~160mm wide, min text 9pt → profile paper-double, theme sumi, target.minFontSize 9pt.
Engine: structured (the loop must read as a ring; auto layout gives no control over that).

Visual language: LLM = focus (solid); loop steps (plan, observation) = tinted blue;
tools = boxes in a "Tools" group; environment = muted-ish box; memory = cylinders (orange);
request/answer = parallelograms (I/O). Loop edges = emphasis; memory edges = dashed double-arrow.

Sketch (A, ring):
          [short-term] [long-term]
[request] →  [ LLM ] → [Plan] → [Tools: search/code/files]
[answer]  ←    ↑                         ↓
             [Observation] ←────── [Environment]

## Render 1 (draft1)

- 154mm × 94mm. 16 errors `geometry/text-too-small`: the `sumi` theme draws node text at 8pt and edge
  labels at 7pt (only group titles are 9pt), and `minFontSize` is a check, not a size. No field
  in Sumi enlarges text, and `fit: scale` only shrinks. **9pt cannot be met with `sumi` at native size.**
- Decision: a blog SVG is scaled to its column (160mm). Make the figure about 124mm wide so that
  7pt edge labels display at 7 × 160/124 ≈ 9pt and node text at ≈10.3pt. Keep `minFontSize: 9pt`
  in the YAML as instructed; the remaining text-too-small errors are this limitation.
- Look: large void between memory/tools; LLM (the focus) is the smallest box; emphasis edges
  very heavy; "tool call" label collides with Plan; memory group oversized. Loop does read.
- Switch to `place` (unit mm) for a compact ring with a "repeat until done" label in its middle.

## Render 3 (place v1; render 2 failed lint: box size must be a multiple of 0.5pt, `22mm` rejected)

- 127mm × 90mm, ring reads at a glance. Memory group dominates the top (tall cylinders + frame);
  tools have heavy black frames unlike the other blocks; loop label floats without a mark.
- Fix: drop the Memory frame (two short cylinders, one dashed read/write edge each), tools tinted
  gray, a repeat icon beside the loop label in blue.

## Renders 4–6

- Render 4: cylinders with `height: 34pt` → `geometry/label-overflow` (the caps eat the room); removed the height.
- Render 5: memory read/write edges jog (anchors off-centre); tools tinted gray on the beige group
  fill reads muddy; Plan narrower than Observation / Environment.
- Fix: LLM 85pt wide with `fromAnchor: straight` to each cylinder; loop step boxes 76pt wide;
  tool boxes `outlined`.

- Render 6: `layout/no-route` LLM → Plan (wider LLM now touches Plan in my `place` coordinates); re-spaced x.
- Render 7: 76pt step boxes too wide, Plan crowds LLM and Tools; reduced to 64pt.
- Render 8 = final.

## Self-critique of final (checklist)

1. Density/holes: the ring interior is intentional (carries "repeat until done"); a void remains
   above Tools (right of the memory cylinders) and below Final answer. Kept: filling it would mean
   moving memory away from the LLM it serves.
2. Sizes: loop steps equal width (64pt); LLM largest (focus); cylinders taller than I would like
   (cannot shorten without label overflow).
3. Vocabulary: blue = loop path (edges, Plan, Observation, LLM solid), green = environment,
   orange = memory, dashed double arrows = memory read/write, parallelograms = I/O.
4. Colour: 3 hues on the sumi cream canvas; tools outlined, no colour on colour except the
   Tools group's sand fill under outlined boxes.
5. Text: short noun labels; three edge words (call, act, result) + done + read / write.
6. Flow: clockwise LLM → Plan → Tools → Environment → Observation → LLM; entry and exit on the left.
7. Main subject: the LLM block and the blue ring.

## Result

- End: 2026-11-13 15:42 (clock as reported by `date`; start 15:38:35)
- Renders: 8 render invocations (6 SVGs written; render 2 stopped at lint, render 6 at no-route).
- Final: 133mm × 84mm, paper-double, theme sumi, target.minFontSize 9pt.
- Final lint (`lint --geometry`): **17 errors, 0 warnings, 1 info**.
  - 17 × `geometry/text-too-small` (12 node labels at 8pt, 5 edge labels at 7pt): unfixable in
    the `sumi` theme, which has no text above 8pt for nodes / 7pt for edges and no way to enlarge
    text; kept. Mitigation: the figure is 133mm wide, so in a 160mm blog column it is shown at
    120%: node text ≈ 9.6pt, edge labels ≈ 8.4pt (still under 9pt for edge labels).
  - info `geometry/placement-usage`.

## What was hard / what Sumi could not express

- 9pt minimum vs. the sumi theme's 8/7pt text: `minFontSize` is only a check; there is no
  text-size override and `fit: scale` never enlarges. `figure.target` has no notion of the web
  case (displayed width ≠ printed width), so the error cannot be satisfied honestly.
- `props.width` must be a multiple of 0.5pt: `22mm` is rejected; had to write `62.5pt`.
- Cylinder `height` small enough to look balanced overflows the two-line label (caps eat room).
- `place` needs manual coordinates; widening one box made the LLM → Plan edge unroutable
  (`layout/no-route`), so every width change needs re-spacing by hand.
- No way to draw a circular loop arrow around the ring; the loop is a rectangle of orthogonal
  edges plus a repeat icon and label in its middle.
