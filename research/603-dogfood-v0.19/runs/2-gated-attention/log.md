# Run 2 gated-attention log

Start: 2026-11-20 16:31:54
End: 2026-11-20 16:37 (wall clock as reported by `date`)

## Setup
- `sumi doctor --skill-version 0.19.1`: Ready to render; Skill matches CLI.
- Source: arXiv 2505.06708 HTML (Sec. 2.1, 2.2, 3.2, Table 1, Fig. 1 caption).
- Theme `sumi`, profile `paper-single` (88 mm), structured layout.

## Layout and mockup
- Base layout: `encoder-block`, panel (b) idiom (bottom-up block stack inside a plain
  panel, thin 0.75pt lines and arrowheadScale 0.6 taken from it), plus the `feature-table`
  idiom (matrix with classes + legend from classes) for panel (b). Neither fits alone.
- Mockup: yes (`mockup.html` / `mockup.png`), because it is two panels with side notes on
  five operators; Skill says mock up anything with several panels. Colours from a probe
  render of the `sumi` theme. Two mockup rounds (first had broken subscripts and a table
  floating too high).

## Source facts shown
- Gate form Y' = Y ⊙ σ(XW_θ), X = hidden state after pre-norm (Sec. 2.2, Eq. 5, fn. 1):
  drawn as the σ(XW_θ) box feeding the G1 multiply.
- Layer: Q/K/V projections from X (Eq. 1), SDPA (Eq. 2), multi-head concat + output
  projection W_O (Eq. 3-4).
- Positions (Sec. 2.2, Fig. 1 left): G1 after SDPA, G2 after value, G3 after key,
  G4 after query, G5 after dense output.
- Adopted: G1, head-specific, multiplicative sigmoid (Sec. 2.2 default; Sec. 3.2 best).
  Shown as orange accent, "per head" = head-specific.
- Table 1 (15A2B MoE, 400B tokens), elementwise sigmoid rows 1, 5-9: avg PPL / MMLU:
  baseline 6.026/58.79; G1 5.761/60.82; G2 5.820/59.17; G3 6.016/59.18; G4 5.981/58.74;
  G5 6.017/59.41.

## Renders: 6 (plus 1 theme probe)
1. draft1: lint 0/0/0 after 4 lint rounds (no-route x8 with `place` from the mockup since
   Sumi's operators/boxes are larger than drawn -> switched panel (a) to stack + grid;
   then exceeds-page-width 103.9 -> 88 mm by group padding 1 mm, narrower W boxes,
   column gap, attach instead of centerOn row).
2. final round 2: exceeded width (89.1 mm) after adding a legend and wider cells.
3. cellWidth 29pt: fits; table and legend pushed apart by `justify: space-between`.
4. removed space-between, "No gate" header: 90.3 mm, too wide again.
5. back to "None": fits; compare with transformer + llada.
6. thinner lines/arrowheads (0.75pt, 0.6) and 2.5pt matrix gap: final.

## Final lint
`lint --geometry`: 0 errors, 0 warnings, 0 infos. 87.31 mm × 80.61 mm.

## Critique (self, checklist; no subagent per study rules)
- Density: (b) has an empty band under the legend and the table's top is not level with
  panel (a)'s top; accepted so the two captions stay on one line.
- Sizes: arrowheads were heavy at default scale for an 88 mm figure -> 0.6.
- Vocabulary: orange = adopted G1 in both panels; gray outlined = other positions; blue
  only for SDPA. One legend.
- Colour: white ground, blue + orange accent. Text: short labels only.
- Main subject: G1 operator is large + orange; table row G1 orange.

## What was hard / Sumi limits / workarounds
- The mockup (drawn at a guessed operator size of 4 mm) did not survive `place`:
  sumi operators are ~5.6 mm, large ones 8.5 mm, so 8 `layout/no-route`. The mockup
  guide does not give component default sizes; I had to switch to stack/grid.
- Fitting 88 mm took most rounds: plain groups still add ~4.5 mm padding per side
  (`props.padding` fixes it), and attached labels/side boxes overhang the panel.
  The width hint's "verified edits" (row gap 0, columnGap 0) were never the edits I wanted.
- Matrix column headers are only as wide as a cell: "PPL ↓"/"MMLU ↑" collided at 24pt
  (label-collision) and nearly touch at 29pt; no header wrap or headerWidth for columns.
- Long row headers ("G1 SDPA", "No gate") do not fit paper-single; used G1-G5/None and
  rely on panel (a) for the mapping.
- Wanted: an edge-label-like small label for G-numbers (attached labels are 8pt node
  text, a bit large next to 5.6 mm operators); no way to make attached label smaller.
- No way to say "this is elementwise vs headwise" compactly; left to the caption.
