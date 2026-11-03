# Layout tips

**Purpose.** Pick the layout engine, make a figure fit its target, and reproduce
the look of a published paper figure. Contents:
[choose the engine](#choose-the-engine-first) · [auto layout](#auto-layout-d2--elk) ·
[direction vs. width](#direction-vs-target-width) · [slides](#slides-presentation-16x9) ·
[too wide with `right`, too tall with `down`](#too-wide-with-right-too-tall-with-down) ·
[shrinking](#shrinking-to-the-page-width-figurefit-scale) ·
[compact spacing](#compact-spacing-figurelayoutdensity-compact) ·
[**paper figure recipe**](#paper-figure-recipe) ·
[two panels with a divider](#two-panels-with-a-dashed-divider) ·
[labels and groups](#labels-and-groups) · [reading order](#reading-order-and-emphasis)

## Choose the engine first

| The figure is… | Use |
| --- | --- |
| a flow: flowchart, pipeline, decision flow, state machine, dependency or call graph, an architecture overview where only the connections matter | **auto** (default): `figure.layout.direction` |
| a paper block diagram: stacked layers, residual or skip connections, columns that must line up, blocks of equal width, notes beside a block (`N×`), operators (⊕) and split points, math labels, token rows, patches | **structured**: `figure.layout.arrange` ([structured](structured.md)) |

A figure is structured when it has `figure.layout.arrange` (and no `engine:
auto`). When unsure start with auto: it needs no placement and suits most
diagrams; switch when the user wants a particular arrangement or the figure
reproduces a paper's block diagram. Structured figures need every element placed
and their sizes come from the arrange tree, so the direction tables below do not
apply (measure with `sumi render`). The rest of this page up to
[paper figure recipe](#paper-figure-recipe) is mostly about auto.

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

- `paper-single` (88mm): at most about 3 nodes side by side; use `direction: down`
  for any chain of four or more. `paper-double` (180mm): about 6–7.
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

When a long flow overflows both ways, wrap it: make the figure **structured** and
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

Text is checked at its printed size: the 8pt / 7pt of the built-in themes must
print at 5pt or more on paper profiles (`geometry/text-too-small`), so a figure can
shrink to about 70% (7pt edge labels reach 4.9pt just below). Subscripts of label
math print smaller and are reported once as information (`geometry/script-too-small`).
Prefer re-arranging when it fits without shrinking; use `fit: scale` for figures
modelled on published ones (whose text is often 5–6pt) and tell the user.

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

## Paper figure recipe

A figure modelled on a published paper figure is a **structured** figure with the
`paper` theme. Start from [example 6](examples.md#6-success-a-paper-figure) and map
what the original shows:

| The original shows | Write |
| --- | --- |
| rounded pastel boxes, thin black lines, small arrowheads, sans-serif | `figure.theme: paper` (`academic` for a grayscale, square-cornered figure) |
| boxes without a border (pastel fill only) | `variant: filled` + `tone` ([variants](figure-format.md#tones-and-variants)) |
| white boxes with a coloured frame and text (encoders, tokens, keys) | `variant: outlined` + `tone` |
| strong coloured keys or operators with white text | `variant: solid` + `tone` |
| pastel cells with matching coloured border and text | `variant: tinted` + `tone` |
| coloured lines | `tone` on the edge |
| a panel without a frame, a shaded panel, a dashed panel | group `variant: plain` / `filled` / `dashed`, with `caption: (a) …` |
| panels of equal height with captions on one line | the panels in one `row` with `align: stretch` ([captions](structured.md#group-titles-and-captions)) |
| panels separated by a dashed vertical (or horizontal) line | a `separator` between them ([recipe below](#two-panels-with-a-dashed-divider)) |
| a pale panel (a variant compared against) | `dim: true` on the group ([dimmed](figure-format.md#dimmed-groups)) |
| dashed lines from a block to the panel that enlarges it | an edge `component: zoom` ([zoom](structured.md#zoom-callouts)) |
| lines entering a wide block straight above each narrow one | `toAnchor: straight` on the wide end ([anchors](structured.md#edges-anchors-junctions-and-trunks)) |
| a row of token cells, keys, patches | `component: tokens`; edges name a cell `<node>.<cell>` or the whole node ([tokens](structured.md#token-sequences)); key clusters: `lines` + `lineAlign` |
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
panels), then the looks (`paper`, variants, tones, `dim`), then `density: compact`,
and `fit: scale` last if still too wide. Check the preview against the original
after each step. **Not expressible** (say so instead of approximating silently):
raw colours and free coordinates (tones only; `themeOverrides.solidFills` retints
solid fills), and free font sizes (use an [html](html.md) card for a large `N×`).

### Two panels with a dashed divider

The ViT-like layout: a titled left panel (patches cut from one picture → projection
→ token row), a dashed vertical `separator`, and a titled right panel. Panels are
`variant: plain` groups whose `label` is the panel title; the row's `align: stretch`
gives the separator the full height; the row's `gap` is the whitespace on each side
of the line.

```yaml
# expect-render: fits
version: 1
figure:
  id: vit-like
  theme: paper
  profile: paper-double
  assets:
    photo:
      svg: |
        <svg viewBox="0 0 120 120">
          <rect width="120" height="120" fill="#dde8f5"/>
          <circle cx="60" cy="60" r="45" fill="#c04050"/>
        </svg>
  layout:
    arrange: { row: { gap: 6mm, align: stretch, items: [vit, divider, encoder] } }
groups:
  - id: vit
    label: Vision Transformer (ViT)
    variant: plain
    arrange: { stack: { direction: up, gap: 5mm, items: [patches, proj, seq] } }
  - id: encoder
    label: Transformer Encoder
    variant: plain
    arrange: { stack: { direction: up, gap: 5mm, items: [norm, attn, mlp, head] } }
nodes:
  - id: patches
    component: tokens
    props:
      width: 28pt
      gap: 4pt
      cells:
        - { asset: photo, crop: [0, 0, 60, 60], variant: framed }
        - { asset: photo, crop: [60, 0, 60, 60], variant: framed }
        - { asset: photo, crop: [0, 60, 60, 60], variant: framed }
        - { asset: photo, crop: [60, 60, 60, 60], variant: framed }
  - { id: proj, component: box, label: Linear Projection, tone: green, variant: filled }
  - id: seq
    component: tokens
    tone: purple
    props: { variant: outlined, gap: 1.5pt, cells: [ "0*", "1", "2", "3", "4" ] }
  - { id: divider, component: separator, variant: dashed }
  - { id: norm, component: box, label: Norm, tone: blue, variant: filled }
  - { id: attn, component: box, label: Multi-Head Attention, tone: orange, variant: filled }
  - { id: mlp, component: box, label: MLP, tone: yellow, variant: filled }
  - { id: head, component: box, label: MLP Head, tone: gray, variant: filled }
edges:
  - { from: patches, to: proj }
  - { from: proj, to: seq }
  - { from: norm, to: attn }
  - { from: attn, to: mlp }
  - { from: mlp, to: head }
```

## Labels and groups

- Short noun-phrase labels lay out best; break long ones with `\n`. Node size follows
  the label: avoid explicit `width` / `height` unless sizes must match (a box smaller
  than its label overflows). `circle` / `square` keep 1:1, so long labels make them
  huge: use `ellipse` / `box`.
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

## Reading order and emphasis

- Declare nodes and edges in reading order so the YAML reviews easily against the
  content.
- Use variants consistently: `emphasis` for the one or two elements the figure is
  about, `muted` for context or optional parts, `dashed` edges for optional or
  asynchronous flows. Say what they mean in the caption or report: auto figures have
  no legend (structured ones can carry a [`legend`](structured.md#legends)).
