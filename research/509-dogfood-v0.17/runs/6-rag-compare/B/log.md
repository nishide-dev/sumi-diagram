# Run 6 rag-compare, condition B

Start: 2026-11-13 15:38:36

## Mockup (condition B, step 1)

- Read `sumi catalog`, the `sumi` theme in `src/core/theme/builtin.ts` (canvas #f8f8ee, ink #30364f, panel #efeddd, tone fills/lines), SKILL.md, structured.md (grids, sets, legends, captions).
- Placement issue found before drawing: theme `sumi` is only compatible with paper profiles; with `presentation-16x9` every label fails `profile/font-too-small` (8pt < 14pt). Decision: keep `profile: presentation-16x9` (as asked) and set `figure.target.minFontSize: 7pt`, and design the figure at about 160mm wide so that it is scaled ~2x when placed on the slide (8pt -> ~16pt, 7pt edge labels -> ~14pt). Sumi cannot enlarge the theme's text, so this is the only way to keep both theme `sumi` and the slide profile.
- Design: one grid, rows = methods, columns = stage (Query | Plan | Retrieve | Re-rank | Verify | Generate | Answer) so the same stage lines up across methods and missing stages show as a longer arrow. Shared steps = default box; steps a variant adds = orange tinted box; legend at the bottom. Pale row bands. Agentic loop Verify -> Retrieve below the row.
- Mockup rounds: 3 (round 1: SVG edge-label font size in user units wrong; round 2: method subtitle wrapped, legend cut off, Answer crowded; round 3: loop label off the line, page height trimmed to 160 x 70mm).

## Sumi reproduction (step 2)

Renders: 6 (draft1 + 5 revisions), plus one 2-node probe outside this directory to check theme `sumi` x `presentation-16x9`.

1. draft1: one structured grid (8 columns: method | Query | Plan | Retrieve | Re-rank | Verify | Generate | Answer), `null` cells for missing stages, rect `sets` (yellow, filled, fillOpacity 0.1) as row bands, plain row legend. First lint attempt: grid items written as nested lists (schema error; grids take one flat list).
   Problems seen in draft1: bands had ragged left edges and touched each other (sets fit the members; centred method labels of different widths); edge labels sat near the target end; the loop label sat at the left end outside band 3 (`geometry/set-outline-crosses-text`); 190mm wide.
2. Equal box sizes (`props.width/height`) and `labelAt: middle`. Lengths in mm were rejected (`component/invalid-prop`: 18mm is not a multiple of 0.5pt) -> rewritten as 51pt / 22.5pt. `textAlign: left` on a fixed-width label did not left-align the text in the box (it aligns lines inside the centred text block).
3. Grid `align: start` to left-align the method names. This also moved the hidden junctions I used for the loop to the column start and broke the loop.
4. Loop back to a direct edge `v3 -> r3` with south anchors and `labelAt: middle`; one unconnected hidden junction (`pad`) in a 4th grid row as a band-3 member so the band reaches below the loop label.
5-6. rowGap 8 -> 6mm, set padding 2.5 -> 2mm (gaps between the bands like the mockup).

Final: 168.8mm x 71.08mm, profile presentation-16x9, theme sumi, `target.minFontSize: 7pt`.

Final lint (`lint` and `lint --geometry`): 0 errors / 0 warnings / 1 info (`geometry/placement-usage`: width use 49.8% of the 338.7mm slide; intended, the figure is drawn at ~half size and meant to be scaled ~2x onto the slide, see above).

### Where Sumi could not match the mockup

- Theme `sumi` + `presentation-16x9`: 8pt text fails the slide's 14pt minimum; I lowered the check with `target.minFontSize: 7pt`. There is no way to have `sumi` colours at slide text sizes (themeOverrides cannot change font sizes; `slides` theme has its own colours). On a slide this figure must be scaled up by the user (~2x: 8pt -> ~16pt, 7pt edge labels -> ~14pt).
- Method names: the mockup has a bold 9pt name over a grey 7pt subtitle; Sumi nodes have no bold or colour field for labels, so the name is regular 8pt and the sublabel 7pt in ink colour.
- Boxes: the mockup had slightly rounded boxes; the `sumi` theme draws square node corners (kept the theme's look; a per-node cornerRadius exists but I did not add it).
- Row bands: a set encloses only its members, so I needed a dummy hidden junction to stretch band 3 under the loop label; set padding is uniform, so band heights cannot be set independently.
- The legend sits a bit lower with more space under it than in the mockup.

### What was hard

- Discovering that the requested theme and profile are incompatible (only visible in the theme table / first lint).
- Grid alignment is one value for all columns: left-aligning one column moved hidden junctions in another.
- Lengths must be multiples of 0.5pt, so natural mm values are rejected.

End: 2026-11-13 15:43:14
