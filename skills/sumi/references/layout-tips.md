# Layout tips

**Purpose.** Pick the layout engine, make a figure fit its target, and design
a paper figure that reads well, from content or from a reference. Contents:
[choose the engine](#choose-the-engine-first) · [auto layout](#auto-layout-d2--elk) ·
[direction vs. width](#direction-vs-target-width) · [slides](#slides-presentation-16x9) ·
[too wide with `right`, too tall with `down`](#too-wide-with-right-too-tall-with-down) ·
[shrinking](#shrinking-to-the-page-width-figurefit-scale) ·
[compact spacing](#compact-spacing-figurelayoutdensity-compact) ·
[**design principles**](#design-principles) ·
[**plan the layout**](#plan-the-layout-before-writing-yaml) ·
[paper figure recipe](#paper-figure-recipe) ·
[two panels with a divider](#two-panels-with-a-dashed-divider) ·
[labels and groups](#labels-and-groups)

## Choose the engine first

| The figure is… | Use |
| --- | --- |
| a flow: flowchart, pipeline, decision flow, state machine, dependency or call graph, an architecture overview where only the connections matter | **auto** (default): `figure.layout.direction` |
| a paper block diagram: stacked layers, residual or skip connections, columns that must line up, blocks of equal width, notes beside a block (`N×`), operators (⊕) and split points, math labels, token rows, patches | **structured**: `figure.layout.arrange` ([structured](structured.md)) |

A figure is structured when it has `figure.layout.arrange` (and no `engine:
auto`). When unsure start with auto: it needs no placement and suits most
diagrams; switch when the user wants a particular arrangement or the figure is a
paper block diagram. Structured figures need every element placed and their sizes
come from the arrange tree, so the direction tables below do not apply (measure
with `sumi render`). The rest of this page up to
[design principles](#design-principles) is mostly about auto.

## Auto layout (D2 + ELK)

Auto figures are laid out by D2 + ELK (layered). You control only the root
`direction`, grouping, the order of elements and label length; there are no
coordinates, anchors or per-group directions. Measure, don't guess: `sumi render`
prints the final size and the preview shows the result.

## Direction vs. target width

Each layer (one step along `direction`) adds roughly a node's width plus an 8mm
layer gap (paper profiles). Measured with short labels:

| Figure | `right` | `down` |
| --- | --- | --- |
| 5-step chain, `minimal` | 127mm × 15mm | 26mm × 90mm |
| 7-step chain, `academic` | 180mm × 15mm | 23mm × 127mm |

- With these short labels, `paper-single` (88mm) holds about 3 nodes side by side,
  `paper-double` (180mm) about 6–7. For longer chains compare `down`, rows and
  scaling by measured size and final text, rather than using node count as a rule.
- Branches spread perpendicular to `direction`: a `down` decision flow with
  two-way branches grows sideways by about one node per branch.
- Paper profiles allow at most 220mm height (`geometry/exceeds-page-height`):
  with `down`, 5 layers take about 90mm and 6–7 layers 125–150mm, tall for one
  column. Prefer fewer layers (merge trivial steps only if the user agrees), or
  split the figure.
- Do not fix width by switching to a bigger profile on your own: the profile is
  the user's target.

## Slides (`presentation-16x9`)

Use `theme: slides` + `profile: presentation-16x9`: the profile requires 14pt text
and only `slides` meets it (16pt text); `minimal` and `academic` fail every labelled
element with `profile/font-too-small` by design (the profile never enlarges text).
A slide is about 338mm × 190mm and `slides` spacing makes figures 1.5–2× larger than
on paper: 3–4 layers `right` take about 280mm × 100mm, while long flows can overflow
both ways (`examples/pipeline`, `examples/decision-flow`: 240–250mm tall `down`, 356 /
434mm wide `right`; for any other figure render and check `size`). On
`geometry/exceeds-page-height` / `-width` try the other direction, then split the
figure or drop trivial steps (ask the user); never switch theme or profile alone.

## Too wide with `right`, too tall with `down`

One candidate when a long flow overflows both ways is to wrap it: make the figure **structured** and
lay the steps out in two rows, one `row` per line inside a `stack`
([arrange trees](structured.md#arrange-trees)). With `direction: left` on the second
row the flow snakes back under the end of the first, so the edge that turns is a
short vertical one:

```yaml
# expect-render: fits
version: 1
figure:
  id: two-row-pipeline
  theme: minimal
  profile: paper-single
  layout:
    arrange:                     # structured: every node is placed here
      stack:
        gap: 6mm
        align: end               # right-align the rows: batch sits above model
        items:
          - row: { gap: 4mm, items: [ load, clean, split, batch ] }
          - row: { gap: 4mm, direction: left, items: [ model, loss, update, save ] }
nodes:
  - { id: load, component: box, label: Load }
  - { id: clean, component: box, label: Clean }
  - { id: split, component: box, label: Split }
  - { id: batch, component: box, label: Batch }
  - { id: model, component: box, label: Model }
  - { id: loss, component: box, label: Loss }
  - { id: update, component: box, label: Update }
  - { id: save, component: box, label: Save }
edges:
  - { from: load, to: clean }
  - { from: clean, to: split }
  - { from: split, to: batch }
  - { from: batch, to: model }
  - { from: model, to: loss }
  - { from: loss, to: update }
  - { from: update, to: save }
```

Split where the content has a natural break (data preparation, then training). If
the rows hold groups, each group's `arrange` lays out its members; if two rows still
do not fit use three, or split the figure (ask the user). For a measured breakdown
of where the width goes, read the hint of `geometry/exceeds-page-width`
([diagnostics](diagnostics.md#too-wide-the-width-breakdown)).

## Shrinking to the page width (`figure.fit: scale`)

A dense paper figure laid out as intended (several panels side by side) can stay
too wide. `figure.fit: scale` (both engines) prints the whole figure smaller, at the
profile's maximum width, without moving anything: the SVG keeps its coordinates
and gets a smaller `width` / `height`, and the PDF page and PPTX slide are that
size. It never enlarges and does not fix the height. `sumi render` prints `scaled
to 70%`; `--json` has `size.scale`.

When scaled text has at most **20% headroom** over its effective minimum (or falls
below it), `geometry/heavy-scaling` (info) gives the smallest final size, including
math scripts and placed HTML, minimum, headroom, scale and width breakdown
**before scaling**. A low scale with readable text can pass; a high scale can still
need review. Suppress an intentional choice
with `--rule geometry/heavy-scaling=off` on `lint --geometry`.

Text is checked at its printed size: the 8pt / 7pt of the built-in themes must
print at 5pt or more on paper profiles (`geometry/text-too-small`), so a figure can
shrink to about 70% (7pt edge labels reach 4.9pt just below). Subscripts of label
math print smaller and are reported once as information (`geometry/script-too-small`).
`figure.target.minFontSize` overrides the minimum (at least 4.5pt); optional
`minLineWidth` warns on thin final diagram strokes. Choose scaling or re-arranging
by final readability and reserved page area; neither always wins. Report the trade-off.

## Compact spacing (`figure.layout.density: compact`)

Published block diagrams pack boxes tighter than Sumi's default. `density:
compact` (structured only) uses the profile's tighter set: on paper profiles the
default `gap` is 2.5mm instead of 4mm, group padding 6pt instead of 8pt, the
padding above and below a label 1.5pt instead of 3.5pt (a one-line box 13pt tall
instead of 17pt for 8pt text); left/right padding stays 7pt. Page, text sizes and
minimum font size do not change.

```yaml
figure:
  theme: paper
  profile: paper-double
  fit: scale
  layout:
    density: compact
    arrange: …
```

- It changes defaults only: a `gap` you wrote stays, so add the line and **remove the gaps
  written for normal spacing** (keep deliberate ones: `gap: 0`, small token gaps, room for
  an edge label or badge). Use it for dense paper figures, usually with `fit: scale`: a
  compact figure shrinks less and its text prints larger.
- Keep at least about 2.5mm between items joined by an arrow in themes with 1pt edges
  (`minimal`, `color`); with 0.5pt edges (`paper`, `academic`) 1.5mm still routes. An edge
  that bends between two items needs more (`layout/no-route` names it: give that box its
  own `gap`), as does a colliding edge label or badge (`geometry/label-collision`,
  `layout/edge-label-overlap`).

## Design principles

A paper figure is read in seconds, beside its caption. Check every candidate
arrangement and the preview against these general information-design rules; each
names its Sumi means.

- **One reading direction.** The main path runs one way, inputs to outputs:
  bottom to top for a stack of layers, left to right for a pipeline. Side paths
  (residuals, skips, feedback) run beside it, never back across it. *Sumi:* the
  root `stack: { direction: up }` or `row`; side entries with `toAnchor: west`;
  main-path edges first in `edges` (earlier edges route straighter).
- **One focus.** The one or two elements the figure is about stand out; the rest
  is quieter; a compared baseline is pale. *Sumi:* `emphasis`, `solid`, operator
  `size: large` for the focus; pastel `filled` for the rest; `dim: true` on a
  compared panel.
- **Shared lines.** Elements at one level share a top, centre or edge; stacked
  blocks are equally wide; repeated units sit on a grid. Straight edges follow.
  *Sumi:* `align: stretch`, `grid` (+ `span`), `figure.layout.align` across trees,
  `straight` anchors.
- **Proximity groups.** Space inside a group is smaller than space between groups;
  reuse two or three gap values. Frame a group only when the frame means
  something. *Sumi:* a `gap` per box (e.g. 3mm inside, 6mm between) or the
  `density: compact` defaults; panels as `variant: plain` groups.
- **No unexplained voids.** Whitespace should say something: separate groups, keep
  a shared line (inputs aligned at the bottom of side-by-side panels), or set the
  focus apart. An empty region about a block in size or larger is a reason to look
  again: if it is disproportionate and explains nothing (typically a tall narrow
  column, such as a vertical list above a head, beside a wide short one),
  **re-arrange**: put the outputs or note beside their source, turn a vertical list
  into a row, reorder a row. Never add elements or enlarge boxes to fill it.
  *Sumi:* change the tree, `attach`, tokens `direction`. `geometry/dead-space`
  (info) names up to three non-overlapping empty rectangles outside bodies,
  groups, arrows and labels: at least 27% of the canvas and 10mm on both sides
  at printed size. Outer margins are excluded; intentional whitespace can be
  suppressed on `lint --geometry` with `--rule geometry/dead-space=off`.
  Follow a verified hint if it helps; otherwise inspect the preview.
  `geometry/group-empty-area` instead checks the space inside a group
  (75% outside its title and direct children; edges not counted).
- **Fit the placement.** Establish width, maximum height, height budget and minimum
  final text size. Content determines shape; column/full width does not prescribe
  an aspect ratio. *Sumi:* profile, `figure.target`, and measured `sumi render` size.
  Compare reserved profile width × height, final text, whitespace and reading direction.
- **Colour encodes a role.** One tone per kind of element (all norms `blue`), the
  same in every panel, three or four tones at most; plumbing (inputs, junctions)
  stays neutral. Say what tones and dashes mean. *Sumi:* `tone` + one variant per
  kind; a [`legend`](structured.md#legends) or the caption.
- **Notes at their target.** A size, `N×` or symbol sits next to what it explains;
  an edge label is a word on its own edge. *Sumi:* `attach` (`side`, `gap`),
  `sublabel`, edge `labelAt` / `labelSide`; a legend in the tree beside its panel.
- **One meaning per line style.** Solid arrow: data flow; `line`: into a junction
  or ⊕; dashed: optional, skip or callout; a toned edge only for a path you name.
  *Sumi:* edge `component`, `variant: dashed`, `tone`, `zoom`.
- **Panels with one message each.** Split for two levels of detail (an overview
  and an enlarged block) or for variants compared; panels equally tall, captions
  on one line, the same tones for the same parts. *Sumi:* groups in a `row` with
  `align: stretch`, `caption`, `separator`, `zoom`, `dim`.
- **Short labels.** Noun phrases of one to three words in one casing style;
  symbols in math, shapes in a sublabel; no sentences in boxes. *Sumi:* `\n`,
  `'$x_t$'`, `sublabel`.

Auto figures follow the same rules where they apply: declare nodes and edges in
reading order; give `emphasis`, `muted` and `dashed` one meaning each and say it in
the caption or report (auto figures have no legend).

## Plan the layout before writing YAML

When the user describes the content (no figure to copy), or a reference figure
does not fit the target, plan before writing:

1. **List the elements and their roles**: inputs, main-path steps, outputs, side
   inputs, repeated units, notes (sizes, `N×`), compared variants. Mark the main
   path and the focus. Keep an element/connection checklist for the final review.
2. **Establish placement constraints**, then choose candidates from a strip,
   vertical stack, folded rows, L/T branches or separate panels. The content,
   not the profile name, determines which directions make sense.
3. **Sketch two candidate arrangements** as small ASCII drawings, one text line per
   row of the arrange tree. E.g. four sensors fused, a detector, three alert types:

   ```text
   A: alerts stacked over the detector     B: alerts as a row beside it
          [a3]                                [Detector] → [a1][a2][a3]
          [a2]                                [        Fusion        ]
          [a1]                                [s1]  [s2]  [s3]  [s4]
       [Detector]
   [        Fusion        ]
   [s1]  [s2]  [s3]  [s4]
   ```

4. **Render and compare** final text/line minima, hard page limits, height budget,
   reserved area, unused width, unexplained whitespace, crossings and main-path
   turns. Discard candidates violating hard limits; explain the remaining trade-off.
   Shorter labels or merged steps cost detail (ask the user); compact spacing costs
   separation; scaling costs final text size; folding costs height and continuity;
   panels cost cross-references; a different placement is the user's decision.
5. **Write the tree from the sketch**: each sketch row is a `row`, each column a
   `stack`, repeated units a `grid` or `tokens`, notes `attach`ed. For inputs
   below/above a main-flow node, use a stack with `centerOn: <main-node>` inside
   the centered row: [side-input pattern](structured.md#side-inputs-on-a-main-flow).
   It reserves input space (including tokens) while preserving the main centerline.
6. **After rendering**, check every element and directed connection against the
   checklist in both YAML and a preview at final printed size. Look for empty regions of a block or more,
   unaligned edges and notes far from their targets. Keep space that groups,
   aligns or sets apart; fix a disproportionate, unexplained void by moving notes or
   outputs or changing the arrangement, not by adding elements.

## Paper figure recipe

A paper figure is a **structured** figure with the `paper` theme. Start from
[example 6](examples.md#6-success-a-paper-figure) and the arrangement you planned (or
the reference's arrangement), then map each look you want to a field:

| To draw | Write |
| --- | --- |
| rounded pastel boxes, thin black lines, small arrowheads, sans-serif | `figure.theme: paper` (`academic` for a grayscale, square-cornered figure) |
| boxes without a border (pastel fill only) | `variant: filled` + `tone` ([variants](figure-format.md#tones-and-variants)) |
| white boxes with a coloured frame and text (encoders, tokens) | `variant: outlined` + `tone` |
| strong coloured cells or operators with white text | `variant: solid` + `tone` |
| pastel cells with matching coloured border and text | `variant: tinted` + `tone` |
| coloured lines | `tone` on the edge |
| a panel without a frame, a shaded panel, a dashed panel | group `variant: plain` / `filled` / `dashed`, with `caption: (a) …` |
| panels of equal height with captions on one line | the panels in one `row` with `align: stretch` ([captions](structured.md#group-titles-and-captions)) |
| panels separated by a dashed vertical (or horizontal) line | a `separator` between them ([recipe below](#two-panels-with-a-dashed-divider)) |
| a pale panel (a variant compared against) | `dim: true` on the group ([dimmed](figure-format.md#dimmed-groups)) |
| dashed lines from a block to the panel that enlarges it | an edge `component: zoom` ([zoom](structured.md#zoom-callouts)) |
| lines entering a wide block straight above each narrow one | `toAnchor: straight` on the wide end ([anchors](structured.md#edges-anchors-junctions-and-trunks)) |
| a row of token cells or patches | `component: tokens`; edges name a cell `<node>.<cell>` or the whole node ([tokens](structured.md#token-sequences)); several rows of cells: `lines` + `lineAlign` |
| patches cut from one picture | `figure.assets` + `crop` on images or tokens image cells ([assets](assets.md#patches-from-one-picture)) |
| a framed photo, a bigger ⊕ | `variant: framed` on the image; operator `props.size: large` ([assets](assets.md#framed-images-and-operator-size)) |
| an attention mask, a grid of classes with hatched cells | `component: matrix` + legend `{ class: … }` ([matrices](structured.md#matrices)) |
| a size or shape in smaller text under a name | `sublabel` ([sublabels](structured.md#sublabels)) |
| a vertical title (a tall encoder, an axis) | `labelRotation: -90` ([turned labels](structured.md#turned-labels)) |
| left-aligned prompt text | `textAlign: left` ([text align](structured.md#text-align)) |
| coloured words inside a label | `$\textcolor{orange}{\text{word}}$` ([labels](figure-format.md#labels)) |
| a bowtie shape, an emoji on a corner | `component: bowtie`; `badge: { icon: emoji/fire, corner: north-east }` ([badges](assets.md#corner-badges)) |
| a table: row headings, repeated columns | a `grid` ([tables](structured.md#tables)) |
| boxes packed tightly | `figure.layout.density: compact`, without your own `gap`s |
| a figure wider than the page at its natural size | `figure.fit: scale` ([shrinking](#shrinking-to-the-page-width-figurefit-scale)); say it is scaled |
| repeated video frames | an image's `props.layers: { count: 4, offset: 3pt }` ([layers](assets.md#stacked-copies-layers)) |

Order of work: content and arrangement first (the arrange tree, `align: stretch`
panels), then the looks (`paper`, variants, tones, `dim`). Compare `density: compact`,
scaling and alternative arrangements by the target metrics. Check previews against
the [principles](#design-principles) (and the reference, if there is one). **Not
expressible** (say so instead of approximating silently): raw colours and free
coordinates (tones only; `themeOverrides.solidFills` retints solid fills), and free
font sizes (use an [html](html.md) card for a large `N×`).

### Two panels with a dashed divider

An overview panel and the enlarged part beside it (an inspection pipeline: one
picture cut into four tiles → encoder → a score per tile; the encoder's layers on
the right). Panels are `variant: plain` groups whose `label` is the panel title. The
root row's `align: stretch` makes both panels and the dashed `separator` full height,
and its `gap` is the whitespace on each side of the line. `align: stretch` inside the
left panel makes the encoder as wide as the tile rows, so the panel's edges line up;
the right panel repeats the encoder's tone, and the two columns are about equally
tall, so neither leaves an unexplained void. Edges do not cross the separator: the shared
title names the link.

```yaml
# expect-render: fits
version: 1
figure:
  id: panel-divider
  theme: paper
  profile: paper-single
  assets:
    part:
      svg: |
        <svg viewBox="0 0 120 120">
          <rect width="120" height="120" fill="#e4e9ef"/>
          <rect x="20" y="30" width="80" height="60" rx="8" fill="#7d8fa6"/>
          <circle cx="82" cy="78" r="9" fill="#c04050"/>
        </svg>
  layout:
    arrange: { row: { gap: 5mm, align: stretch, items: [ overview, divider, detail ] } }
groups:
  - id: overview
    label: Inspection
    variant: plain
    arrange: { stack: { gap: 5mm, align: stretch, items: [ tiles, encoder, scores ] } }
  - id: detail
    label: Tile Encoder
    variant: plain
    arrange: { stack: { gap: 3mm, align: stretch, items: [ conv, norm, pool ] } }
nodes:
  - id: tiles
    component: tokens
    props:
      width: 24pt
      gap: 3pt
      cells:
        - { asset: part, crop: [ 0, 0, 60, 60 ], variant: framed }
        - { asset: part, crop: [ 60, 0, 60, 60 ], variant: framed }
        - { asset: part, crop: [ 0, 60, 60, 60 ], variant: framed }
        - { asset: part, crop: [ 60, 60, 60, 60 ], variant: framed }
  - { id: encoder, component: box, label: Tile Encoder, tone: green, variant: filled }
  - id: scores
    component: tokens
    tone: purple
    props: { variant: outlined, gap: 3pt, width: 24pt, cells: [ '$s_1$', '$s_2$', '$s_3$', '$s_4$' ] }
  - { id: divider, component: separator, variant: dashed }
  - { id: conv, component: box, label: Conv 3×3, tone: green, variant: filled }
  - { id: norm, component: box, label: Norm, tone: green, variant: filled }
  - { id: pool, component: box, label: Pooling, tone: green, variant: filled }
edges:
  - { from: tiles, to: encoder }
  - { from: encoder, to: scores }
  - { from: conv, to: norm }
  - { from: norm, to: pool }
```

## Labels and groups

- Node size follows the label ([keep it short](#design-principles)): avoid explicit
  `width` / `height` unless sizes must match (a box smaller than its label
  overflows). `circle` / `square` keep 1:1, so long labels make them huge: use
  `ellipse` / `box`.
- Auto edge labels get a background box and are placed by ELK, often near a bend: one
  or two words, only where meaningful (`"yes"` / `"no"`, a protocol).
- Use groups for real structure (tiers, subsystems, phases), one level of nesting is
  usually enough. An element talking to several groups often lays out better outside
  all of them. A group-to-own-member edge is `lint/ancestor-edge`.
- **Edges entering a group can cross its title** (auto: top-left; wider than about half
  the group): `labelAt` (`top-right`, or `bottom` for a group entered from above; D2
  still keeps the space at the top), put the flow's first node inside the group
  (`examples/pipeline`), keep few edges crossing the border, or mention it
  (`geometry/edge-crosses-label`). `caption` in auto: an edge leaving the group
  downwards crosses it; leave sideways or use structured.
- **Cycles inside a group may be reversed** (`geometry/reversed-edge`): swap the loop's
  nodes in `nodes`, or keep retry loops outside groups (`examples/decision-flow`).
