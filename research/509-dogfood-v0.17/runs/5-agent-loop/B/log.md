# Run 5-agent-loop / B

Start: 2026-11-13 15:38:38

## Mockup (condition B)

- Read `$SUMI catalog` and the `sumi` theme (canvas #f8f8ee, ink #30364f, muted #4e566b, panel #efeddd, tone fills/lines; 8pt node text, 7pt edge text, 9pt bold group titles, 1pt lines / 2pt emphasis).
- Plan: in/out on the left (User request -> LLM -> Final answer), memory above the LLM, and the loop as a ring to the right: LLM -> Plan -> Tools -> Environment -> Observation -> LLM, drawn with emphasis (2pt) edges; a muted note "repeat until done" in the ring.
- Tones: LLM emphasis (navy block); memory orange cylinders; tools blue; environment/observation green; request/answer plain parallelograms.
- Mockup sized 160mm x 80mm, all text 9pt (the placement's minimum), Inter from assets/fonts.
- Round 1 (160x90mm): memory too far from LLM, vertical void. Round 2: rows pulled up 10mm, Plan->Tools gap widened. Accepted after round 2.
- Found before writing YAML: the sumi theme draws node labels at 8pt and edge labels at 7pt; themeOverrides cannot change font sizes, so `target.minFontSize: 9pt` cannot be met with ordinary labels (test figure: geometry/text-too-small errors on every node and edge label).

## Sumi reproduction

Renders (sumi render / lint --geometry): 9 in total
1. scratch test (two boxes) to check the 9pt target with the sumi theme: every label fails geometry/text-too-small.
2. draft1: grid 4x3 (memory alone in row 0). First YAML used mm sizes and failed lint (component/invalid-prop: sizes must be multiples of 0.5pt; 26mm etc. are not) -> converted to pt. Rendered 171.8 x 92.1mm. Seen: cylinder labels cut by the top ellipse (geometry/label-overflow), the "repeat until done" note sat in row 2 on the result edge, which detoured around it, oversized emphasis arrowheads, memory far from LLM because the tall Tools row pushed it up, group titles regular weight.
3. Root row of four column stacks + figure.layout.align (llm/request/plan level, observation/answer/environment level), arrowheadScale 0.6 on loop edges, groupLabelWeight: bold. The extra align { y: [loop-note, files] } pulled Search away from Code execution inside the Tools stack (align adds space inside the stack holding the item) -> dropped; align the Tools group instead.
4. Cylinders at 62.5 x 36pt still overflow.
5-7. Probes (lint --geometry) for cylinder height: 40pt and 44pt overflow, 48pt fits (a 22mm-wide cylinder needs ~17mm height for one 8pt line; the mockup's 10mm cylinder is not possible).
8. Fixed cylinders, memory gap 9mm.
9. Final: cornerRadius 2pt on boxes, 4pt on group frames, alignGrowth: allow (intended growth). 164.9 x 84.5mm.

Self-critique of final.png against the mockup and the request: all elements present (user request, LLM, plan, tools: search / code execution / files, observation, short- and long-term memory, environment, final answer); the loop LLM -> Plan -> Tools -> Environment -> Observation -> LLM is a closed ring of heavy edges and reads at a glance; in/out on the left; no label on a line; arrows point the right way.

## Final lint

- `sumi lint`: 0 errors, 0 warnings, 0 infos.
- `sumi render` / `lint --geometry`: 19 errors, 0 warnings, 1 info.
  - 19 x geometry/text-too-small (error), kept: the request asks for text >= 9pt (`target.minFontSize: 9pt`), but the sumi theme draws node labels at 8pt and edge labels at 7pt, and themeOverrides cannot change font sizes. Only html cards could reach 9pt; rebuilding every node and edge label as html was not a reasonable use of Sumi (unsearchable text, no edge labels). The only label that passes is the 9pt group titles.
  - geometry/placement-usage (info): 180 x 84.5mm reserved, 91.6% width use.

## Where Sumi could not match the mockup

- Text size: mockup 9pt everywhere; Sumi 8pt nodes, 7pt edge labels (the 9pt target is unmet; see above).
- Cylinders: mockup 21 x 10mm; Sumi needs about 22 x 17mm for one line, so Memory is taller and the figure 4.5mm taller than the mockup.
- Grid rows cannot overlap: in the mockup the Tools panel rises into the Memory band; in Sumi this needed column stacks plus cross-tree align (grid version was 92mm tall).
- Group titles: groupLabelWeight: bold is set and the SVG uses the bold class, but the rsvg PNG shows them in what looks like regular weight (same for the emphasis LLM label).
- Sizes in mm are rejected unless they are multiples of 0.5pt (had to convert all to pt).
- The loop note cannot be centred inside the ring by reference to the ring; it sits in the Plan column at a fixed gap.

## What was hard

- Discovering that the 9pt target is impossible in the sumi theme only after a test render (catalog lists the theme as 7-9pt but gives no way to raise sizes).
- Cylinder minimum height is not visible in the catalog; found by probing.
- Cross-tree align moving items inside the same stack (Search pushed away from Code execution).

End: 2026-11-13 15:43:42
