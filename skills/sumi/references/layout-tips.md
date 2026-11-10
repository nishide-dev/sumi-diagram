# Layout tips

**Purpose.** Pick the layout engine, choose a figure's shape for its placement,
and design a paper figure that reads well, from content or from a reference.
Contents: [choose the engine](#choose-the-engine-first) ·
[**fit the placement**](#fit-the-placement) ·
[when width runs short](#when-width-runs-short) · [auto layout](#auto-layout-d2--elk) ·
[direction vs. width](#direction-vs-target-width) · [slides](#slides-presentation-16x9) ·
[folding into rows](#folding-a-flow-into-rows) ·
[shrinking](#shrinking-to-the-page-width-figurefit-scale) ·
[compact spacing](#compact-spacing-figurelayoutdensity-compact) ·
[**design principles**](#design-principles) ·
[**plan the layout**](#plan-the-layout-before-writing-yaml) ·
[paper figure recipe](#paper-figure-recipe) ·
[critique against references](#critique-against-references) ·
[two panels with a divider](#two-panels-with-a-dashed-divider) ·
[labels and groups](#labels-and-groups)

## Choose the engine first

| The figure is… | Use |
| --- | --- |
| a flow: flowchart, pipeline, decision flow, state machine, dependency or call graph, an architecture overview where only the connections matter | **auto** (default): `figure.layout.direction` |
| a paper block diagram: stacked layers, residual or skip connections, columns that must line up, blocks of equal width, notes beside a block (`N×`), operators (⊕) and split points, math labels, token rows, patches | **structured**: `figure.layout.arrange` ([structured](structured.md)) |
| a small graph/network with authored vertex positions, or matching input/output graph shapes | **structured**: [`place`](structured.md#coordinate-placement) with the same unit and coordinates in each group; `line` + `route: straight` for undirected edges |

A figure is structured when it has `figure.layout.arrange` (and no `engine:
auto`). When unsure start with auto: it needs no arrange tree and suits most
diagrams; switch when the user wants a particular arrangement or the figure is a
paper block diagram. Structured sizes come from the arrange tree, so the direction
tables below (auto) do not apply: measure with `sumi render`.

## Fit the placement

Shape is a consequence of the placement and the content, not a convention. No
placement prescribes an aspect ratio, a direction or a number of rows: a full-width
ML method figure is often one wide row, but a one-column first-page overview, a
README figure, a slide or a figure from another field may be tall, square or split
into panels. Measure candidates instead of applying a rule:

1. **Constraints.** From the user or the venue (SKILL.md step 1); report any you
   assume. Field details: [`figure.target`](figure-format.md#themes-and-profiles).

   | Constraint | Hard? | Sumi |
   | --- | --- | --- |
   | width W (column, full width, single-column text width, slide, web column) | yes | `profile`; for a W between or below the profiles use the wider (or `paper-single`), keep `size.widthMm` ≤ W and count reserved area as W × height yourself (`fit: scale` and `placement-usage` use the profile width) |
   | maximum height (paper profiles 220mm, slides 190.5mm; venues differ) | yes | profile, `geometry/exceeds-page-height` |
   | minimum final text size (venues differ widely, in print or on a slide) | yes | `figure.target.minFontSize`, `geometry/text-too-small`; math scripts (0.7×: 8pt → 5.6pt) are checked against it by `geometry/script-below-target` |
   | minimum line width, if the venue sets one | yes | `figure.target.minLineWidth`, `geometry/line-too-thin` |
   | height budget: what the document can spare | no | `figure.target.height`, `geometry/exceeds-target-height` |
   | reading context: print, screen, projection; beside a caption or alone | no | theme; which sizes read comfortably |

   A full-width figure reserves the whole text width × its height, however narrow
   it is, so its cost is height and unused width is wasted; a column figure
   reserves column width × height. On the web the size is not physical: the page
   scales the SVG to its column, so text px = text pt × column px ÷ figure width in pt
   (1mm = 2.835pt).
2. **Candidates.** Count the content's structure (main-path length, side inputs,
   parallel branches, nesting, independent topics, longest labels, natural breaks)
   and build two to four candidates from: a **strip** (main path one way, side
   inputs and branches perpendicular), a **vertical stack**, **folded rows** at a
   natural break ([folding](#folding-a-flow-into-rows)), an **L/T** (main strip, a
   training or detail branch below), **panels** (overview and detail, inference
   and training), **condensed** (shorter labels, merged steps:
   [costs](#when-width-runs-short)). Do not pick one by rule.
3. **Render and measure** each (separate files or successive edits) with a
   `figure.target`: `sumi render --json` gives `size` (printed mm, `scale`);
   `geometry/placement-usage` the reserved area, width use and budget use;
   `geometry/heavy-scaling` / `text-too-small` final text against the minimum;
   `geometry/dead-space` voids, `layout/edge-crossing` crossings (structured).
4. **Drop** candidates that break a hard constraint (an error, or
   `geometry/line-too-thin`).
5. **Compare** the rest on: reserved area (and height against the budget), final
   text size and its headroom over the minimum, main-path turns and reversals,
   unexplained whitespace, crossings and detours. Do not add these into one score:
   drop a candidate no better on any of them than another, and weigh the rest.
6. **Choose and report why**, e.g. "a 46mm strip with 6.8pt text against an 87mm
   two-row version at 8pt; the venue allows 5pt, so the strip reserves half the
   area". When the choice depends on the user's priority (area or text size), show
   both and ask.

### When width runs short

No option always wins; each spends something different. Combine them (shorter
labels plus a small scale) and compare the results as above.

| Option | Costs | Consider when |
| --- | --- | --- |
| shorten labels | detail (moves to caption or text) | labels set the box widths (width breakdown); symbols or abbreviations are defined in the text. Keep the meaning. A tall block can turn its title (`labelRotation: -90`) |
| merge steps | content granularity | neighbouring steps are one sentence in the text and not the point of the figure. **Ask the user** |
| tighten spacing (`density: compact`, smaller `gap`s) | separation of groups | gaps are a large share of the width; inside/between-group spacing stays distinct |
| scale (`figure.fit: scale`) | final text and line size | the scaled text keeps headroom over the venue minimum (easy at 5pt, rarely at 9pt or on slides). Unavailable when the minimum equals the theme's smallest text (`paper` 7pt edge labels and sublabels at a 7pt minimum) |
| fold into rows | height (reserved area) and reading continuity | scaling would break the minimum; there is a natural break; the height budget has room; a long chain in a narrow column |
| split into panels | cross-referencing between panels | there are two or more topics, each readable alone |
| change placement (column → full width, one figure → two) | the document's layout | nothing above meets the constraints. **The user decides** |

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

- With these labels about 3 nodes fit side by side in 88mm and 6–7 in 180mm; longer
  labels fit fewer. Use the numbers to estimate candidates, not as a rule.
- Branches spread perpendicular to `direction`: a `down` decision flow with
  two-way branches grows sideways by about one node per branch.
- With `down`, 5 layers take about 90mm and 6–7 layers 125–150mm; whether that is
  too tall depends on the height budget and the 220mm maximum, not on the column.
- Do not fix width by switching to a bigger profile on your own: the profile is
  the user's target.

## Slides (`presentation-16x9`)

Use `theme: slides` + `profile: presentation-16x9`: the profile requires 14pt text
and only `slides` meets it (16pt text); `minimal` and `academic` fail every labelled
element with `profile/font-too-small` by design (the profile never enlarges text).
Slide guidance often asks for 18pt or more: set `figure.target.minFontSize`. A slide
is about 338mm × 190mm and `slides` spacing makes figures 1.5–2× larger than on
paper: 3–4 layers `right` take about 280mm × 100mm, while long flows can overflow
both ways (`examples/pipeline`, `examples/decision-flow`: 240–250mm tall `down`, 356 /
434mm wide `right`; for any other figure render and check `size`). On
`geometry/exceeds-page-height` / `-width` compare the
[options](#when-width-runs-short); never switch theme or profile alone.

## Folding a flow into rows

To build the folded-rows candidate, make the figure **structured** and lay the steps
out in rows, one `row` per line inside a `stack`
([arrange trees](structured.md#arrange-trees)). With `direction: left` on the second
row the flow snakes back under the end of the first, so the edge that turns is a
short vertical one (the second row then reads right to left; keeping both rows left
to right costs a long return edge instead):

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
the rows hold groups, each group's `arrange` lays out its members. For a measured
breakdown of where the width goes, read the hint of `geometry/exceeds-page-width`
([diagnostics](diagnostics.md#too-wide-the-width-breakdown)).

## Shrinking to the page width (`figure.fit: scale`)

`figure.fit: scale` (both engines) prints the whole figure smaller, at the
profile's maximum width, without moving anything: the SVG keeps its coordinates
and gets a smaller `width` / `height`, and the PDF page and PPTX slide are that
size. It never enlarges and does not fix the height. `sumi render` prints `scaled
to 70%`; `--json` has `size.scale`.

Text is checked at its printed size: by default the 8pt / 7pt of the built-in
themes must print at 5pt or more on paper profiles (`geometry/text-too-small`), so a
figure can shrink to about 70%; `figure.target.minFontSize` replaces that minimum
and also judges math scripts (0.7 × base) at their final size, scaled or not
(`geometry/script-below-target`, warning: an 8pt `$q_1$` prints at 5.6pt). Without a
target, subscripts of scaled label math are reported once as information
(`geometry/script-too-small`). When the smallest scaled text (including scripts and
placed HTML) has at most **20% headroom** over the minimum, `geometry/heavy-scaling`
(info) gives that size, the minimum, headroom, scale and the width breakdown
**before scaling**: compare with the other [options](#when-width-runs-short). A low
scale with readable text can pass. Suppress an intentional choice with `--rule
geometry/heavy-scaling=off` on `lint --geometry`; say in the report that it is scaled.

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
  an edge label or badge). Use it for dense figures; with `fit: scale` a compact figure
  shrinks less and its text prints larger.
- Keep at least about 2.5mm between items joined by an arrow in themes with 1pt edges
  (`minimal`, `color`); with 0.5pt edges (`paper`, `academic`) 1.5mm still routes; a
  labelled edge needs a gap wider than its label. An edge
  that bends between two items needs more (`layout/no-route` names it: give that box its
  own `gap`), as does a colliding edge label or badge (`geometry/label-collision`,
  `layout/edge-label-overlap`).

## Design principles

A paper figure is read in seconds, beside its caption. Check every candidate
arrangement and the preview against these general information-design rules; each
names its Sumi means.

- **One reading direction.** The main path runs one way, inputs to outputs
  (e.g. bottom to top for a stack of layers); a fold or turn has a reason. Side paths
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
  (canvas) and `geometry/group-empty-area` (inside a group) report large voids
  ([geometry lint](diagnostics.md#geometry-lint-geometry)); follow a verified hint,
  else inspect the preview; silence intentional space with `--rule …=off`.
- **Fit the placement.** Shape follows the placement's constraints and the
  content, chosen among measured candidates ([fit the placement](#fit-the-placement)).
  *Sumi:* profile, `figure.target`, the size `sumi render` prints.
- **Colour encodes a role.** A white page; one tone per kind of element (all norms
  `blue`), the same in every panel, two or three hues and one accent at most;
  plumbing (inputs, junctions) stays neutral; no translucent colour over a coloured
  surface ([colour and ground](#plan-the-visual-language-before-drawing)). Say what tones and dashes mean. *Sumi:* `tone` + one variant per
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

## Plan the visual language before drawing

A paper figure is understood through a few repeated pictures, not many boxes. Before
planning the arrangement, write a table with one row per kind of thing in the figure
and decide its one visual form and tone:

| Kind of thing | Visual form | Tone |
| --- | --- | --- |
| objects, entities (papers, users, images) | icon node | one per type |
| representations, embeddings, vectors | glyph vector beside its object | the object's tone |
| collections, groups, hyperedges, clusters | set enclosure | one tint per set |
| operations, mappings, aggregation | arrow (edge label of a word or two), or one short box | neutral |
| stages, steps | numbered columns (`row` of panels with captions `(a)`, `(b)`) | neutral |
| stage flow, what feeds what | a `block-arrow` or `triangle-arrow` between the columns, not a thin edge ([flow arrows](structured.md#flow-arrows)) | neutral ink |
| losses, objectives | one short box or a dashed edge to the thing it trains | one accent |

Fill it from the paper, not from a template: drop rows that do not occur, add your
own. Then **pick a palette** for the mood and the medium (the table's tones keep their
meaning on top of it: a palette derives every tone in its own lightness and chroma, each in its hue): `sumi catalog --section palettes` lists eight; choose by character
and by where the figure is read. A cool, calm figure: `cool-blue` or `slate`; warm or
friendly: `coral` or `terracotta`; quiet, natural: `sage` (green) or `seafoam` (teal); soft: `lavender`;
a strong accent for one result: `cyan-pink`. Set it once with `themeOverrides.palette`
and do not mix per-element colours that fight it; for black-and-white print use the
`academic` theme without a palette. Then follow these rules while writing the YAML:

- **Colour and ground.** Keep the page **white**: `paper` panels are white with a thin
  frame, so leave them alone (a gray or tinted panel only when the reference has one:
  `variant: filled`, `themeOverrides.groupFill`). Colour only what carries meaning, in
  **at most 2–3 hues plus one accent** (a loss, the result), the palest tones at the
  same lightness. Never lay a translucent colour over a coloured or gray surface: it
  mixes into mud, and the overlap of two such colours more so. Sets are opaque pale
  tints for that reason (an overlap is painted in the product of its tints); do not
  put colour-on-colour on a filled panel either. The colour exemplar is **LLaDA**
  (`examples/llada`: white ground, a few muted related tones, one red accent). TriCL is
  a density and composition benchmark, not a colour exemplar: copy its proportions, not
  its gray panels. `geometry/muddy-color` and `geometry/color-on-panel` check this
  ([diagnostics](diagnostics.md#geometry-lint-geometry)).
- **Pictures for things, arrows for operations.** Objects and data are icons, glyphs
  and sets; an operation is an edge or at most a few short boxes. If a box holds a
  verb phrase plus a formula, it belongs in the paper body.
- **Minimal text.** Short labels only; leave equations to the text unless the
  symbol itself is the point (`sublabel` or an [html](html.md) card for one).
- **One vocabulary.** A kind of thing keeps its form, tone and size in every panel
  (stage 2 reuses stage 1's icons and sets, not a new diagram type); one tone means
  one thing.
- **One legend**, in one place (usually the bottom), covering every tone and mark
  that needs explaining ([legends](structured.md#legends)); no per-panel keys.
- **Read in order.** Stages go left to right or top to bottom as numbered columns,
  with a block arrow or triangle between them to carry the flow;
  no edge leaves its panel except the main flow, so repeat a small icon instead of
  drawing a long edge.

Sumi features for each form:

- **Icons**: `label` or `box` with `icon:` ([icons](assets.md#icons), find names with
  `sumi catalog --icons`); make an icon larger with `iconSize` (`2`, or `"12mm"`),
  never by enclosing it in a circle; tones from [tones and variants](figure-format.md#tones-and-variants).
- **Feature vectors, dots, pills**: node `glyphs` ([glyphs](assets.md#glyphs)).
  Give each mark a meaning: for example, soft raw vectors and solid embedding vectors,
  a multi-tone row for concatenation, and dot / pill marks for trainable / frozen models.
- **Sets and hyperedges**: top-level `sets` ([set enclosures](structured.md#set-enclosures)).
- **Small graphs**: `place` with coordinates ([coordinate placement](structured.md#coordinate-placement)).
- **Per-figure colors**: `themeOverrides.palette` for a whole scheme, `tones` and the
  other keys for single colours ([palettes](figure-format.md#themes-and-profiles)).
  Reproducing a published figure: sample its colours and pin every fill, frame and panel
  (`tones`, `groupFill`, `groupStroke`, `solidFills`, node `tone`) so no theme default
  shows; the bundled reproductions do.
- **Panels, numbered columns**: groups with `caption` in one `row`
  ([captions](structured.md#group-titles-and-captions)).

The GCN and Llama 4 MoE [examples](../examples/README.md) keep one vocabulary across
all their panels.

**A dense, wide figure** (many small pictures, little text) is easiest to place by
coordinates, as the TriCL [example](../examples/README.md) does: one root `place` with
every card, box and label at a measured centre (1pt per 3.3 px of the reference), each
card a group with its own `place` for its vertices. Then the original's gray panels behind a column are
`rect` [sets](structured.md#set-enclosures) (they take no space, so the boxes inside stay
on one line and the edges between columns run straight), a node with `glyphs` or an
explicit size of at most 10pt (not a `box`) needs no label (`lint/empty-label` skips it), and each card's
frame is its content plus group padding, so size it by the vertex spread. Measure the
reference first: element sizes and gaps as a fraction of the width, and check the
rendered text against its elements.

**Dense reproductions.** A wide figure of cell rows, short arrows and frames (the LLaDA
example) is drawn in one [`place`](structured.md#coordinate-placement) whose `unit` is the
reference's pixel (e.g. `unit: 0.3113pt` so a 53 px cell is a 16.5pt tokens cell) and
`fit: scale`: measure each element's centre in the reference, write it as `at`, and
the proportions, gaps and canvas fill follow. A short arrow that must not touch its
neighbours is a `route: straight` edge between two hidden junctions placed at its ends.
Compare at the same width after each round. Colours that exceed the eight tones are
set by recolouring tones (`fill` for pale cells, `line` for `solid` ones).

## Plan the layout before writing YAML

When the user describes the content (no figure to copy), or a reference figure
does not fit the target, plan before writing:

1. **List the elements and their roles**: inputs, main-path steps, outputs, side
   inputs, repeated units, notes (sizes, `N×`), compared variants. Mark the main
   path and the focus. This list, with each connection and its direction, is the
   content checklist of SKILL.md step 7; also count the structure for step 2 of
   [fit the placement](#fit-the-placement).
2. **Get the placement constraints and pick candidate shapes** as in
   [fit the placement](#fit-the-placement) (steps 1–2).
3. **Sketch the candidates** as small ASCII drawings, one text line per
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

4. **Write a tree per sketch**: each sketch row is a `row`, each column a
   `stack`, repeated units a `grid` or `tokens`, notes `attach`ed. For inputs
   below/above a main-flow node, use a stack with `centerOn: <main-node>` inside
   the centered row: [side-input pattern](structured.md#side-inputs-on-a-main-flow).
   It reserves input space (including tokens) while preserving the main centerline.
5. **Render, measure, compare and choose** as in
   [fit the placement](#fit-the-placement) (steps 3–6); say why in your report.
6. **Check the chosen figure**: the content check (SKILL.md step 7) first, then
   empty regions of a block or more, unaligned edges and notes far from their
   targets. Keep space that groups, aligns or sets apart; fix a disproportionate,
   unexplained void by moving notes or outputs or changing the arrangement, not by
   adding elements.

## Critique against references

Lint sees only part of what makes a paper figure weak. After the content check
(SKILL.md step 7), look at your figure next to good ones, at the same width:

```sh
<skill-dir>/scripts/compare figure.svg <skill-dir>/examples/llada/llada.png   # → figure-compare.png
```

- Pass your figure (`.svg`, `.pdf` or `.png`) first, then 1–2 reference PNGs from
  [examples](../examples/README.md): the closest by type and, for a dense overview,
  `tricl/tricl.png` or `llada/llada.png` (the density benchmarks).
- Images are stacked, or `--side` puts them left to right; `-w <px>` sets the common
  width (default 1200); `-o <png>` moves the output (default `figure-compare.png`
  beside your figure). It needs ImageMagick; without it the script says so and exits 1:
  view the PNGs one after another then.
- Open the result with Read. Prefer a fresh view: give a subagent only that image and
  the checklist below (not your YAML or intentions) and ask for a verdict per item.

Checklist (answer each with what you see; "fine" is not an answer):

1. **Density and holes.** Is yours as full as the reference, or sparse and loose? Any
   block-sized empty area that groups or aligns nothing?
2. **Element sizes.** Are the same kinds of boxes, icons and arrows about equally
   large, with stroke weights and arrowheads as deliberate as the reference's?
3. **One visual vocabulary.** Does each kind of thing keep one form and tone in every
   panel, with one legend, as in your visual-language table? Advice, not a rule: the same kind of
   element (e.g. every set, whether entity-entity or entity-attribute) should usually share
   one fill and border, and emphasis reads better as an accent colour than as a different
   form. Whether each panel has a frame is a case-by-case call.
4. **Colour harmony.** A white ground with a few related tones (at most 2–3 hues and
   one accent), each with a meaning, like LLaDA; or gray panels, colour on colour,
   clashing or saturated colours? Anything translucent over a coloured surface?
   Neutrals for structure?
5. **Text amount.** Only short labels in the figure? Formulas, definitions and
   explanations belong in the caption.
6. **Stage flow.** Can the eye follow the stages (numbered columns, one main flow
   direction) without crossing or backtracking?
7. **Main subject.** Is the one thing the figure is about clearly the most prominent?

Verify before you fix. A critic (you or a subagent) sees only pixels and can be wrong
about measurable things: "unequal sizes", "different colour", "translucent" or
"misaligned" must be checked against the YAML (`size`, `fill`, `opacity`, placement),
`sumi lint --geometry --json` or the SVG before you accept it. Drop claims that do not
hold; fix the ones that do. Judgements (density, balance, flow) have no number: weigh
them against the reference.

Fix what fails (arrangement, sizes, tones, text), re-render, and compare again until
no item fails or the rest is justified in your report. The `lint` infos about density
and colour (`geometry/sparse-figure`, `geometry/text-heavy-nodes`, `geometry/color-harmony`, `geometry/muddy-color`, `geometry/color-on-panel`) are inputs to this critique:
they are rough, and a figure can pass them and still fail the checklist.

## Paper figure recipe

A paper figure is a **structured** figure with the `paper` theme. Start from
[example 6](examples.md#6-success-a-paper-figure) and the arrangement you planned (or
the reference's arrangement), then map each look you want to a field:

| To draw | Write |
| --- | --- |
| rounded pastel boxes, thin black lines, small arrowheads, sans-serif | `figure.theme: paper` (`academic` for a grayscale, square-cornered figure) |
| boxes without a border (pastel fill only) | `variant: filled` + `tone` ([variants](figure-format.md#tones-and-variants)) |
| white boxes with a coloured frame and text (encoders, tokens) | `variant: outlined` + `tone` |
| strong coloured cells or operators with contrasting text (dark ink on yellow) | `variant: solid` + `tone` |
| pastel cells with matching coloured border and text | `variant: tinted` + `tone` |
| coloured lines | `tone` on the edge |
| thin 0.5pt frames and lines, small arrowheads (paper figures usually want this; heavy default lines are the commonest difference from the original) | `themeOverrides: { lineWidth: 0.5pt, frameWidth: 0.5pt, arrowheadScale: 0.6 }` ([line weights](figure-format.md#themes-and-profiles)) |
| dotted coloured lines | edge `variant: dotted` + `tone` (`lineWidth: 0.5pt` for one edge) |
| a white framed panel (`paper`'s default), a panel without a frame, a shaded gray panel (only if the reference has one), a dashed panel | group (default) / `plain` / `filled` / `dashed`, with `caption: (a) …` |
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
| the whole figure printed smaller than its natural size | `figure.fit: scale` ([shrinking](#shrinking-to-the-page-width-figurefit-scale); one of the [options](#when-width-runs-short)); say it is scaled |
| repeated video frames | an image's `props.layers: { count: 4, offset: 3pt }` ([layers](assets.md#stacked-copies-layers)) |

Order of work: content and arrangement first (the arrange tree, `align: stretch`
panels), then the looks (`paper`, variants, tones, `dim`). Treat `density: compact`,
scaling and other arrangements as candidates ([fit the placement](#fit-the-placement)). Check previews against
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
