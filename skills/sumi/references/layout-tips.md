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

Sumi 0.4 figures needed workarounds that now have a field (0.5.0). Use the
field; fall back only when the CLI reports it as unknown.

| Wanted | 0.4 workaround | Now |
| --- | --- | --- |
| a group title out of the way of edges | drop the group `label`, `attach` a `label` node beside the group | `labelAt` on the group ([titles](structured.md#group-titles-and-captions)) |
| "(a) …" under a panel | a `label` node attached `south` | `caption` on the group |
| separate entry points for edges into one block | a `toAnchor` per edge (`"north:0.2"`, `"north:0.5"`, …) | `figure.layout.fanIn: spread`; anchors still for exact positions ([fan-in](structured.md#edges-anchors-junctions-and-trunks)) |
| two blocks of different columns on one line (straight skips) | nested stacks with tuned `gap`s | `figure.layout.align` ([align](structured.md#aligning-across-trees)) |
| which edge a label belongs to, or the outer side of a bend | reordering edges, anchors | edge `labelAt` / `labelSide` |
| `ŷ`, `x̃`, `θ̄` in math | `$y'$`, a typed `ŷ` outside `$...$` | `'$\hat{y}$'`, `'$\tilde{x}$'`, `'$\bar\theta$'` ([label math](figure-format.md#label-math)) |
| "dashed = skip connection" | a sentence in the caption | a `legend` node ([legends](structured.md#legends)) |
| knowing where lines cross | looking at the preview | `layout/edge-crossing` infos from `sumi render` |

A structured figure 0.4 drew is drawn the same by 0.5 (it may gain
`layout/edge-crossing` infos), except that an end without an anchor now
takes its side from the arrange tree
([default sides](structured.md#edges-anchors-junctions-and-trunks)), which
can change some routes: anchor the ends whose side matters.
