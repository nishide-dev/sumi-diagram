# Layout tips

Sumi lays figures out with D2 + ELK (layered layout). You control only the
root `direction`, grouping, the order of elements and label length; there
are no coordinates, ports or per-group directions. Measure, don't guess:
`sumi render` prints the final size, and the preview shows the result.

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

Its minimum font size is 14pt, but both built-in themes use 7–9pt text, so
every labelled element fails with `profile/font-too-small`. There is no way
to enlarge text from a figure. Tell the user; options are to render for
`paper-double` and scale the SVG on the slide, or wait for a slide theme.
Do not try to work around it.

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
