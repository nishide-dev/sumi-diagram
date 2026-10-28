# Layout tips

## Choose the engine first

| The figure is… | Use |
| --- | --- |
| a flow: flowchart, pipeline, decision flow, state machine, dependency or call graph, an architecture overview where only the connections matter | **auto** (default): `figure.layout.direction` |
| a paper block diagram: a network drawn as stacked layers, residual or skip connections, columns that must line up, blocks of equal width, notes beside a block (`N×`), operators (⊕) and split points, math labels | **structured**: `figure.layout.arrange` ([structured](structured.md)) |

The figure is structured when it has `figure.layout.arrange` (and no
`engine: auto`). When
unsure, start with auto: it needs no placement and suits most diagrams;
switch when the user wants a particular arrangement or the figure
reproduces a paper's block diagram. Structured figures need every element
placed; their sizes come from the arrange tree, so the direction tables
below do not apply (measure with `sumi render` as usual). Most of this
page is about **auto**; structured figures are summarised
[at the end](#structured-from-workarounds-to-fields).

## Auto layout (D2 + ELK)

Auto figures are laid out by D2 + ELK (layered layout). You control only
the root `direction`, grouping, the order of elements and label length;
there are no coordinates, anchors or per-group directions. Measure, don't
guess: `sumi render` prints the final size, and the preview shows the
result.

## Direction vs. target width

Each layer (one step along `direction`) adds roughly the width of a node
plus an 8mm layer gap (paper profiles). Measured with short labels
(`Collect`, `Clean`, …, `Step 1`, …):

| Figure | `right` | `down` |
| --- | --- | --- |
| 5-step chain, `minimal` | 127mm × 15mm | 26mm × 90mm |
| 7-step chain, `academic` | 180mm × 15mm | 23mm × 127mm |

- `paper-single` (88mm): at most about 3 nodes side by side. Use
  `direction: down` for any chain of four or more steps.
- `paper-double` (180mm): about 6–7 nodes side by side.
- Branches spread perpendicular to `direction`: a `down` decision flow
  with two-way branches grows sideways by about one node per branch.
- Height: paper profiles allow at most 220mm (`geometry/exceeds-page-height`).
  With `down`, 5 layers take about 90mm and 6–7 layers 125–150mm; that
  fits but is tall for one column. Prefer fewer layers (merge trivial
  steps only if the user agrees), or split the figure.
- Do not fix width by switching to a bigger profile on your own: the
  profile is the user's target.

## Slides (`presentation-16x9`)

For slides use `theme: slides` + `profile: presentation-16x9`. The profile
requires 14pt text; only `slides` meets it (16pt text, 14pt edge labels).
`minimal` and `academic` (7–9pt) fail every labelled element with
`profile/font-too-small` by design. Themes and profiles stay independent:
the profile never enlarges text, so pick the theme to match.

- A slide is about 338mm × 190mm, and `slides` text plus the profile's
  doubled spacing (16mm layer gap) make figures about 1.5–2 times larger
  than on paper. Wide, shallow figures fit: 3–4 layers with `direction:
  right` (e.g. three tiers of containers) take about 280mm × 100mm.
- Long flows can overflow either way. Two measured examples, the 6–7-layer
  `examples/pipeline` and `examples/decision-flow` in the repository, came
  out about 240–250mm tall with `down` and 356mm / 434mm wide with
  `right` — over the page both ways. That holds for those two figures
  only; for any other figure, do not assume: render it and check `size`
  from `render --json` and the `geometry/*` diagnostics. On
  `geometry/exceeds-page-height` or `-width`, try the other direction,
  then split the figure into several slides or drop trivial steps (ask the
  user); do not switch the theme or profile on your own.

## Too wide with `right`, too tall with `down`

When a long flow overflows both ways (on paper or slides), wrap it: switch
the figure to **structured** and lay the steps out in two rows, one `row`
per line inside a `stack`
([structured](structured.md#arrange-trees)). With `direction: left` on the
second row the flow snakes back under the end of the first, so the edge
that turns is a short vertical one:

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

Split where the content has a natural break (e.g. data preparation, then
training). If the rows hold groups, each group's own `arrange` lays out its
members; if two rows still do not fit, use three, or split the figure (ask
the user).

## Shrinking to the page width (`figure.fit: scale`)

A dense paper figure laid out as intended (several panels side by side) can
stay too wide. `figure.fit: scale` (0.6.0, both engines) prints the whole
figure smaller, at the profile's maximum width, without moving anything: the
SVG keeps its coordinates and gets a smaller `width` / `height`, and the PDF
page and the PPTX slide are that size. It never enlarges, and it does not fix
the height (`geometry/exceeds-page-height` is still checked after shrinking).
`sumi render` prints `scaled to 70%`; `--json` has `size.scale`.

Text is then checked at its printed size: the 8pt / 7pt of the built-in
themes must print at 5pt or more on the paper profiles
(`geometry/text-too-small`), so a figure can shrink to about 70% (edge labels
at 7pt reach 4.9pt just below that). Subscripts of label math print smaller
and are reported once as information (`geometry/script-too-small`). Prefer
re-arranging when it fits without shrinking; use `fit: scale` for figures
modelled on published ones, whose text is often 5–6pt, and tell the user it
is scaled.

## Compact spacing (`figure.layout.density: compact`)

Published block diagrams pack their boxes more tightly than Sumi's default
spacing. `figure.layout.density: compact` (0.6.0, structured only) lays the
figure out with the profile's tighter set: on the paper profiles the default
`gap` is 2.5mm instead of 4mm, group padding 6pt instead of 8pt, and the
padding above and below a label 1.5pt instead of 3.5pt (a one-line box is
13pt tall instead of 17pt for 8pt text); the padding left and right stays
7pt. The page, the text sizes and the minimum font size do not change.

```yaml
figure:
  theme: paper
  profile: paper-double
  fit: scale
  layout:
    density: compact
    arrange: …
```

- It changes defaults only: a `gap` written in the figure stays as written.
  To make a figure compact, add the line and **remove the gaps you wrote for
  the normal spacing** (keep the deliberate ones: `gap: 0`, small gaps
  between keys or tokens, room you added for an edge label or a badge).
- Use it for dense paper figures, usually with `fit: scale`: a compact
  figure is also narrower, so it shrinks less and its text prints larger.
- Keep at least about 2.5mm between items joined by an arrow with themes
  whose edges are 1pt (`minimal`, `color`: 6pt arrowheads); with 0.5pt edges
  (`paper`, `academic`: 4pt arrowheads) gaps down to 1.5mm still route. An
  edge that bends between two items (one block feeding two side by side)
  needs more; `layout/no-route` names it — give that box its own `gap`.
- If an edge label or an attached badge collides after removing gaps
  (`geometry/label-collision`, `layout/edge-label-overlap`), write a larger
  `gap` on that box only.

## Paper figure recipe

A figure modelled on a published paper figure (an architecture overview, a
block and its variants side by side) is a **structured** figure; these
0.6.0 fields reproduce the look of such figures. Start from
[example 6](examples.md#6-success-a-paper-figure) and map what the original
shows:

| The original shows | Write |
| --- | --- |
| rounded pastel boxes, thin black lines, small arrowheads, sans-serif text | `figure.theme: paper` |
| boxes without a border (a pastel fill only) | `variant: filled` + `tone` ([variants](figure-format.md#components-variants-and-props)) |
| white boxes with a colored frame and text (encoders, tokens, keys) | `variant: outlined` + `tone` |
| colored lines | `tone` on the edge ([tones](figure-format.md#tones)) |
| a panel without a frame, a shaded panel, a dashed panel | group `variant: plain` / `filled` / `dashed`, with `caption: (a) …` |
| panels of equal height with captions on one line | the panels in one `row` with `align: stretch` ([captions](structured.md#group-titles-and-captions)) |
| a pale panel (a variant compared against) | `dim: true` on the group ([dimmed groups](figure-format.md#dimmed-groups)) |
| dashed lines from a block to the panel that enlarges it | an edge `component: zoom` ([zoom](structured.md#zoom-callouts)) |
| lines entering a wide block straight above each narrow one | `toAnchor: straight` / `fromAnchor: straight` on the wide end ([anchors](structured.md#edges-anchors-junctions-and-trunks)) |
| a row of token cells, keys, patches | `component: tokens`; edges name a cell as `<node>.<cell>` ([tokens](structured.md#token-sequences)) |
| an attention mask, a grid of classes with hatched cells | `component: matrix` + legend `{ class: … }` entries ([matrices](structured.md#matrices)) |
| a size or shape in smaller text under a name | `sublabel` ([sublabels](structured.md#sublabels)) |
| a vertical title (a tall encoder, an axis) | `labelRotation: -90` ([turned labels](structured.md#turned-labels)) |
| rows and columns lined up like a table | column `stack`s in a `row` plus `align` ([tables](structured.md#tables-columns-of-stacks)) |
| boxes packed tightly | `figure.layout.density: compact`, without your own `gap`s ([compact](#compact-spacing-figurelayoutdensity-compact)) |
| a figure wider than the page at its natural size | `figure.fit: scale` ([shrinking](#shrinking-to-the-page-width-figurefit-scale)); say it is scaled |

Order of work: content and arrangement first (the arrange tree,
`align: stretch` panels), then the looks (`paper`, variants, tones, `dim`),
then `density: compact`, and `fit: scale` last if it is still too wide.
Check the preview against the original after each step. Not yet
expressible (say so instead of approximating silently): colored text
spans and left-aligned labels, stacked copies of an image, emoji badges, a
bowtie shape, a font size of your own (a large `N×`), and white text on a
saturated fill.

## Labels

- Short, noun-phrase labels lay out best. Break long ones with `\n`
  (`"Fetch from\norigin"`) rather than letting nodes grow wide.
- Edge labels get a small background box (the theme's edge `fill`) and are
  placed on the line by ELK, often near a bend;
  keep them to one or two words and only where they carry meaning
  (`"yes"` / `"no"` on decision branches, a protocol, a data name).
- `circle` and `square` keep a 1:1 aspect ratio, so a long label makes
  them very large; use `ellipse` / `box` for longer text. ELK may also
  stretch circles that have many edges.
- Node size follows the label. Avoid explicit `width` / `height` unless
  sizes must match; a box smaller than its label overflows.

## Groups

- Use groups for real structure (tiers, subsystems, phases), not for
  decoration. One level of nesting is usually enough.
- **Edges entering a group can cross its label**: the group label sits at
  the top-left corner, and an edge coming from outside (especially with
  `down`) runs through it when the label is wider than about half the group.
  Mitigations: move the title with `labelAt` (`top-right`, or `bottom` for
  a group entered from above; D2 still keeps the title's space at the
  top), put the first node of a flow inside the group (see
  `examples/pipeline` in the repository), keep the number of edges crossing
  the border small, or accept it and mention it. `sumi render` reports it
  as `geometry/edge-crosses-label` (warning).
- `caption` puts a sub-figure caption under a group (both engines). In
  auto figures an edge leaving the group downwards crosses the caption
  (`geometry/edge-crosses-label`): leave sideways (`direction: right`) or
  use the structured layout, whose router avoids it.
- **Cycles inside a group may be reversed**: wrapping a loop (A → B → A) in
  a container can make ELK flip it so the flow reads backwards; `sumi render`
  reports it as `geometry/reversed-edge`. Swapping the order of the loop's
  nodes in `nodes` usually fixes it; otherwise keep retry loops outside
  groups (see `examples/decision-flow`).
- Edges between a group and its own member trigger `lint/ancestor-edge`;
  connect to a node inside the group instead.
- An element that talks to several groups (a worker reading from a queue
  and writing to a database) often lays out better outside all of them
  than inside one, where its edges wrap around the figure.

## Reading order and emphasis

- Declare nodes and edges in reading order so the YAML is easy to review
  against the content.
- Use variants consistently: `emphasis` for the one or two elements the
  figure is about, `muted` for context or optional parts, `dashed` edges
  for optional or asynchronous flows. Say what they mean in the caption
  or report: auto figures have no legend (structured ones can carry a
  `legend` component, see [structured](structured.md#legends)).

## Structured: from workarounds to fields

Older figures needed workarounds that now have a field (0.5.0 for the
first rows, 0.6.0 for the rest). Use the field; fall back only when the CLI
reports it as unknown.

| Wanted | Workaround | Now |
| --- | --- | --- |
| a group title out of the way of edges | drop the group `label`, `attach` a `label` node beside the group | `labelAt` on the group ([titles](structured.md#group-titles-and-captions)) |
| "(a) …" under a panel | a `label` node attached `south` | `caption` on the group |
| separate entry points for edges into one block | a `toAnchor` per edge (`"north:0.2"`, `"north:0.5"`, …) | `figure.layout.fanIn: spread`; anchors still for exact positions ([fan-in](structured.md#edges-anchors-junctions-and-trunks)) |
| two blocks of different columns on one line (straight skips) | nested stacks with tuned `gap`s | `figure.layout.align` ([align](structured.md#aligning-across-trees)) |
| which edge a label belongs to, or the outer side of a bend | reordering edges, anchors | edge `labelAt` / `labelSide` |
| `ŷ`, `x̃`, `θ̄` in math | `$y'$`, a typed `ŷ` outside `$...$` | `'$\hat{y}$'`, `'$\tilde{x}$'`, `'$\bar\theta$'` ([label math](figure-format.md#label-math)) |
| "dashed = skip connection" | a sentence in the caption | a `legend` node ([legends](structured.md#legends)) |
| knowing where lines cross | looking at the preview | `layout/edge-crossing` infos from `sumi render` |
| a pale panel | `variant: muted` on every node and edge inside (fills stay strong) | `dim: true` on the group |
| a frameless panel whose caption lines up | a stack with a `label` node under it | a group with `variant: plain` and `caption` |
| an edge entering straight above its source | `toAnchor: "north:0.295"` computed from a render, or fixed column widths | `toAnchor: straight` |
| dashed callout lines to an enlarged panel | two dashed `line`s with `"east:0"` / `"west:0"` anchors | `component: zoom` |
| a row of tokens, keys or matrix cells | one node per cell (`lint/empty-label` on empty ones) | `tokens`, `matrix` |
| a smaller second line | a second label line of the same size | `sublabel` |
| a figure too wide for the page | ignore `exceeds-page-width` and shrink it in LaTeX | `figure.fit: scale` |

A structured figure 0.4 drew is drawn the same by 0.5 (it may gain
`layout/edge-crossing` infos), except that an end without an anchor now
takes its side from the arrange tree
([default sides](structured.md#edges-anchors-junctions-and-trunks)), which
can change some routes: anchor the ends whose side matters.
