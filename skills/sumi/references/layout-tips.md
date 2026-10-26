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
below do not apply (measure with `sumi render` as usual). The rest of this
page is about **auto**.

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
  `down`) runs through it when the label is wider than about half the group. Mitigations: put the first node of a flow inside
  the group (see `examples/pipeline` in the repository), keep the number of
  edges crossing the border small, or accept it and mention it. `sumi render`
  reports it as `geometry/edge-crosses-label` (warning).
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
  or report; the figure has no legend.
