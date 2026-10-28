# Structured layout

Sumi has two layout engines. **auto** (the default) hands the figure to
D2 + ELK, which place everything along one `direction`. **structured** places
elements exactly where you put them in nested stacks and rows and routes the
edges itself (orthogonal lines, shared trunks). It is newer than the
0.3 releases: if `sumi lint` reports `schema/unknown-field` for `arrange`
(and `sumi catalog --kind node` lists no `operator` / `junction`), the
installed CLI predates it — tell the user and use auto instead. Group
`labelAt` and `caption`, edge `labelAt` / `labelSide`, `figure.layout.align`,
`figure.layout.fanIn` and the `legend` component came later (0.5.0; the
examples that use them say `requires: ">=0.5.0"`): if `lint` reports
`schema/unsatisfied-requires`, `schema/unknown-field` for them or
`component/unknown` for `legend`, the CLI predates them — drop `requires`
and fall back to the older ways noted below.

## Which engine

| Figure | Engine |
| --- | --- |
| Flowcharts, pipelines, decision flows, state or dependency graphs, architecture overviews whose positions do not matter | auto (`figure.layout.direction`) |
| Paper block diagrams: stacked layers, residual connections, columns that must line up, blocks of equal width, side notes (`N×`), operators (⊕) on the main path | structured (`figure.layout.arrange`) |

`figure.layout.engine` (`auto` | `structured`) picks the engine; leave it
out and **a figure with `figure.layout.arrange` is structured, one without
it auto** — so `engine` is not needed. An explicit `engine: auto` wins over
`arrange`. Under auto, the structured-only fields (`figure.layout.arrange`,
`align` and `fanIn`, `groups[].arrange`, `nodes[].attach`,
`edges[].fromAnchor` / `toAnchor` / `labelAt` / `labelSide`) and the
`legend` component are errors (`layout/structured-only`): remove them, or
switch the figure to structured (root `arrange`, no `engine: auto`, every
element placed). Group `labelAt` and `caption` work in both engines.
`figure.layout.direction` is ignored by structured (each box has its own).

What differs in practice:

- **Every node and group must be placed exactly once**: listed in one
  arrange tree, or attached with `attach`. Nothing is placed for you.
- Label math (`$...$`) is drawn only in structured figures
  ([figure-format](figure-format.md#labels)).
- Rendering does not use D2 (`sumi render` works without it), so
  `--emit-d2` is refused (exit 2). `geometry/reversed-edge` is not checked.
- Icons, images, tones, `operator` and `junction` work in both engines.

## Arrange trees

```yaml
figure:
  layout:
    arrange:                   # root tree: places the root elements
      row:                     # a box is exactly one of stack (vertical) or row (horizontal)
        gap: 6mm               # space between items; default 4mm (8mm on slides)
        align: end             # start | center | end | stretch (cross axis)
        items:                 # IDs of nodes / groups, or nested boxes
          - stack: { direction: up, items: [ a, b, c ] }
          - encoder            # a group: its own children go in its own tree
groups:
  - id: encoder
    label: Encoder
    arrange:                   # the group's tree places its children
      stack: { gap: 3mm, align: stretch, items: [ d, e ] }
```

- `stack` lays items top to bottom (`direction: down`, default) or bottom to
  top (`up`: the first item is at the bottom, like a network drawn from
  input to output). `row` lays items left to right (`right`, default) or
  right to left (`left`).
- `gap`: a length with a unit (`3mm`, `6pt`) or `0` (items touch — e.g. a
  block and its `Add & Norm` drawn as one unit; do not connect touching
  items with an edge, see `layout/no-route` below).
- `align` places items across the box: in a stack `start` = left, in a row
  `start` = top. `stretch` makes items as wide (stack) or tall (row) as the
  widest: boxes, groups and box-like nodes stretch; `label`, `circle`,
  `square`, `trapezoid`, `stack`, `operator`, `junction` and nodes with an
  explicit size on that axis are centered instead. Nested boxes of the
  same kind inherit `align`; other boxes start at `center`.
- A side column next to a tall stack: put both in a `row` and pick the
  row's `align` (`center` to center it vertically, `end` to line up the
  bottoms).
- **An item belongs to the owner of the tree**: items of `groups[].arrange`
  are members of that group, items of the root tree are at the root. Do not
  also write `group:` (if you do, it must match, else `layout/group-mismatch`).
  A group is placed as one item in its parent's tree.
- To line up elements of **different** trees (a skip connection drawn
  straight across two columns), use [`align`](#aligning-across-trees), not
  `gap` tweaks.

## Group titles and captions

A group's `label` (its title) sits at the **top centre** inside the border,
in a band above the members. An edge entering the group from above near
the title is routed around it: it detours and its arrowhead ends just under
the title (or crosses it, `geometry/edge-crosses-label`). Move the title
with **`labelAt`**: `top-left`, `top` (default), `top-right`, `bottom-left`,
`bottom` or `bottom-right` — always inside the border; at `bottom*` the
band is below the members. Pick a place no edge enters: `bottom` for a
group entered from above, the corner away from the entering edges
otherwise. A corner helps only when the title is narrow: a title wider
than about half the group still covers the centre, and the edge detours
**without any diagnostic** — look at the preview. `labelAt` without a
`label` gets `component/label-at-without-label` (warning).

**`caption`** puts text centered **under** the group's border, outside it,
like a sub-figure caption (`(a) …`): line breaks and label math as in a
node label; the position is fixed. It is drawn as a label node with the
reserved ID `<group>-caption` (a node or group of yours with that ID is
`ref/reserved-id`); diagnostics about it point at `caption`. Edges cannot
end on it; a node attached `south` of the group goes under the caption.

The router treats the caption as an obstacle, so **an edge between a
member and an element below the group can detour around the caption**
when the caption blocks its route (out to the side and back under the
border) — an input entering from below (`direction: up`) as well as an
output leaving downwards. No diagnostic names the caption (at most
`geometry/edge-on-border` where the detour runs along the border): look
at the preview. In a centred stack (member, caption and the other end on
one vertical), a `toAnchor: west` on the member does not help. If it detours, put the caption on an outer group that
also holds the other end (a panel around input, block and output, below;
it draws its own border), or place the other end beside the group (a
`row`) so the edge crosses a side.

```yaml
# expect-render: fits
version: 1
requires: ">=0.5.0"
figure:
  id: caption-panel
  theme: academic
  profile: paper-single
  layout:
    arrange:
      stack: { items: [ panel ] }
groups:
  - id: panel                    # the caption sits under x, not between x and the block
    caption: (a) one block
    arrange:
      stack: { direction: up, gap: 3mm, items: [ x, block, y ] }
  - id: block
    arrange:
      stack: { direction: up, gap: 3mm, items: [ norm, attn ] }
nodes:
  - { id: x, component: label, label: $x$ }
  - { id: norm, component: box, label: Layer Norm }
  - { id: attn, component: box, label: Attention }
  - { id: y, component: label, label: $y$ }
edges:
  - { from: x, to: norm }
  - { from: norm, to: attn }
  - { from: attn, to: y }
```

```yaml
# expect-render: fits
version: 1
requires: ">=0.5.0"
figure:
  id: group-title
  theme: academic
  profile: paper-single
  layout:
    arrange:
      stack: { gap: 4mm, items: [ batch, train ] }
groups:
  - id: train
    label: Training step
    labelAt: bottom              # the edge from batch enters at the top centre
    caption: (b) one optimisation step
    arrange:
      stack: { gap: 3mm, items: [ model, loss ] }
nodes:
  - { id: batch, component: box, label: Batch }
  - { id: model, component: box, label: Model }
  - { id: loss, component: box, label: Loss }
edges:
  - { from: batch, to: model }
  - { from: model, to: loss }
```

Both fields also work in auto figures (there the default title place is
`top-left`; at `bottom*` D2 still leaves the title's space at the top, and
edges leaving a group downwards cross its caption). With a CLI older than
0.5.0, leave out the group's `label` and `attach` a `label` node beside
the group instead.

## Attach: side notes

```yaml
- { id: pe, component: circle, icon: tabler/wave-sine, attach: { to: add, side: west, gap: 1mm } }
- { id: pe-label, component: label, label: "Positional\nEncoding", attach: { to: pe, side: west, gap: 0.5mm } }
- { id: repeat, component: label, label: "N×", attach: { to: encoder, side: east, gap: 2mm } }
```

`attach: { to, side, gap }` puts a node outside the trees, centered on the
`side` (`north`, `east`, `south`, `west`) of a node or group, `gap` away
(default 0). Attachments chain (`pe-label` → `pe` → `add`). An attached node
belongs to the same group as its target, and that group (or the canvas)
grows to hold it. Use it for labels beside a block, `N×` beside a group, an
input feeding an operator from the side.

**An attached node takes no space in the tree**: its neighbours are placed
as if it were not there. Attached into the `gap` between two items of a
stack or row, it can overlap the next item (`geometry/node-overlap`,
`geometry/label-collision`) or blocks the edges that need that gap
(`layout/no-route`). For example
`{ id: op, component: operator, props: { symbol: plus }, attach: { to: a, side: south, gap: 1mm } }`
with `a` and `b` in a stack with `gap: 3mm` draws the ⊕ on top of `b`.
This is the current behaviour. Instead:

- put the element **in the tree**, between the two items
  (`items: [ a, op, b ]`, edges `a → op → b`): it gets its own place and
  the gaps on both sides route;
- or widen that `gap` beyond the attach `gap` plus the attached node's
  size, and further if an edge must pass beside it (the ⊕ above needs
  `gap: 7mm`).

Attach on a side where no other item is placed (beside a stack, above or
below a row).

## Aligning across trees

Each box aligns only its own items. To put elements of different boxes on
one line — a U-Net's concat ⊕ level with its encoder block so the skip
runs straight, an encoder output level with the decoder block it feeds —
list them in **`figure.layout.align`** instead of tuning `gap`s:

```yaml
figure:
  layout:
    arrange: { … }
    align:
      - { y: [ enc1, cat1 ] }            # same height: one horizontal line
      - { x: [ head, legend ], at: start } # same left edge: one vertical line
```

- Each constraint is exactly one of `y: [ids]` (centres at one height;
  `at: start` = tops, `at: end` = bottoms) or `x: [ids]` (centres on one
  vertical; `start` = left edges, `end` = right edges), with at least two
  node or group IDs (attached nodes too: they move with their target).
- Sumi only **adds space** before or after items in a stack (for `y`) or
  row (for `x`) that holds just one of them — never inside a `gap: 0` box,
  so touching blocks stay touching. So it can align elements in different
  branches — `y`
  across stacks side by side in a row, `x` across rows in a stack — but
  not two items of the same stack on `y`, nor of one stack on `x`. Two
  items of one row on `y` (e.g. `at: start` to line up their tops) need a
  stack around one of them: `items: [ a, { stack: { items: [ key ] } } ]`.
  Put an element **in the tree** (not `attach`ed into a gap) when it
  should take part.
- A constraint it cannot meet is `layout/unsatisfied-align` (warning, from
  `sumi render` / `lint --geometry`, not plain `lint`): the figure is drawn
  with the closest placement; the message gives the distance left, the
  hint whether the items cannot be moved apart (same box, `gap: 0`) or
  another constraint pulls them away. `layout/align-search-limit`
  (warning) means a figure with very many constraints stopped searching.
- **`align` can enlarge the figure.** The added space also moves
  everything after it and grows the enclosing boxes: aligning a small item
  with one deep inside a tall branch can push that whole branch down and
  leave a large empty band. When the figure grows by more than 5mm and
  10% in width or height, render reports `layout/align-grew-figure`
  (info) with the size before and after. If the growth is intended (a
  U-Net level pushed down for a straight skip), keep it; otherwise align an
  item that can move alone (wrap it in its own `stack` / `row`), bring the
  two closer in the tree, or drop the constraint and use an anchor instead.

```yaml
# expect-render: fits
version: 1
requires: ">=0.5.0"
figure:
  id: unet-skips
  theme: academic
  profile: paper-single
  layout:
    arrange:
      stack:
        gap: 5mm
        items:
          - row:
              gap: 12mm
              align: start
              items:
                - stack: { gap: 6mm, items: [ enc1, enc2 ] }
                - stack: { gap: 3mm, items: [ y, dec1, cat1, dec2, cat2 ] }
          - bottleneck
          - key
    align: # straight skips: each concat level with its encoder level
      - { y: [ enc1, cat1 ] }
      - { y: [ enc2, cat2 ] }
nodes:
  - { id: enc1, component: box, label: "Conv ×2\n64", tone: blue }
  - { id: enc2, component: box, label: "Conv ×2\n128", tone: blue }
  - { id: bottleneck, component: box, label: "Conv ×2\n256", variant: emphasis }
  - { id: cat2, component: operator, props: { symbol: concat } }
  - { id: dec2, component: box, label: "Conv ×2\n128", tone: green }
  - { id: cat1, component: operator, props: { symbol: concat } }
  - { id: dec1, component: box, label: "Conv ×2\n64", tone: green }
  - { id: y, component: label, label: '$\hat{y}$' }
  - id: key
    component: legend
    props:
      entries:
        - { edge: { variant: dashed }, label: skip connection }
edges:
  - { from: enc1, to: enc2, label: pool, labelSide: right }
  - { from: enc2, to: bottleneck, fromAnchor: south, toAnchor: west, label: pool }
  - { from: bottleneck, to: cat2, fromAnchor: east, toAnchor: south, label: up }
  - { from: cat2, to: dec2 }
  - { from: dec2, to: cat1 }
  - { from: cat1, to: dec1 }
  - { from: dec1, to: y }
  - { from: enc2, to: cat2, variant: dashed }
  - { from: enc1, to: cat1, variant: dashed }
```

The concat operators are items of the decoder stack (not attached), and
the two `align` constraints push `enc1` and `enc2` down to their levels,
so both dashed skips are single horizontal lines. The `key` legend is
[below](#legends).

## Edges: anchors, junctions and trunks

The router draws orthogonal lines around nodes (never through them) in
YAML order, greedily: edges declared first get the best routes.

- **Anchors**: `fromAnchor` / `toAnchor` pick the side of an end: `west`,
  or `"south:0.2"` for a position along it (0..1: left → right on
  north/south, top → bottom on east/west; default 0.5). Quote values with a
  `:`. Several edges between the same two elements are spread out
  automatically. Two ends that face each other within 1pt of one line are
  drawn as a straight line: one end (an anchored one too) moves along its
  side by up to 1pt, so an anchor read off a render to 4 decimals still
  gives a straight drop. If both ends share their points with other edges
  and neither can move, `layout/unaligned-ends` (warning) says so: write
  the same position for both.
- **`straight`** (`toAnchor: straight` / `fromAnchor: straight`): the end
  sits in line with the other end, on the side facing it, so the line
  enters (leaves) straight with no jog. Use it for narrow boxes in a row
  feeding a wide one (patches into a projection, encoders into a
  refiner) instead of computing `"south:0.3127"` by hand; put it on the
  end at the **wide** box (`fromAnchor` when the wide box is the source).
  The side is never written. The other end, if unanchored, takes the
  facing side; parallel edges stay parallel lines. Two sources in line
  with the same point merge there (also with `fanIn: spread`, which
  spreads only the other ends). If the other element's centre is not over
  the side (at least 3pt inside its corners), or the two are diagonal or
  overlapping, `layout/straight-off-side` (warning) and the end acts as
  if it had no anchor: line them up in the tree, or write a side anchor.
- **Default sides** (an end without an anchor) follow the arrange tree:
  take the box where the two ends' branches part (their nearest common
  box); in a stack the ends use north / south, in a row east / west,
  towards the other end. An attached node counts as its target's place. If
  the two ends overlap along that box's axis, or no box separates them (a
  node and what it is attached to), the side facing the other end is used.
  Write an anchor whenever you mean another side.
- **Junction** (`component: junction`, a small dot): where a line splits
  or merges. Place it in the tree like any node, between the blocks it
  connects; connect into it with `component: line` (an arrowhead would hide
  the dot). Every edge touching a junction is drawn as one connected net.
  `variant: hidden` draws no dot: the lines fork smoothly, as in paper
  figures. Keep the dot where another line crosses nearby (it is what tells
  a join from a crossing). A hidden junction with one incoming arrow is an
  **open end**: the arrow stops in empty space (e.g. a block's output at the
  top of a stack: `{ id: out, component: junction, variant: hidden }`, then
  `{ from: add, to: out }`). Put it straight in line, since an arrowhead
  needs a straight stretch before its tip. Every line meets a junction at
  its centre: `fromAnchor` / `toAnchor` on a junction end are ignored
  (`component/anchor-on-junction`, warning). To change where a line
  enters, anchor its other end or move the junction in the tree.

  ```yaml
  # residual connection: split before the block, re-enter at the side
  - { from: split, to: attention, toAnchor: "south:0.2" }   # Q
  - { from: split, to: attention, toAnchor: "south:0.5" }   # K
  - { from: split, to: attention, toAnchor: "south:0.8" }   # V
  - { from: split, to: norm, toAnchor: west }               # residual
  ```

- **Shared trunk (bus)**: edges leaving the same element at the same anchor
  (same side and position) share one line until they branch, e.g. one
  conditioning MLP feeding four blocks:
  `{ from: mlp, fromAnchor: north, to: ss1, toAnchor: east }`, … for each
  target. An edge entering a port and one leaving it never share a line:
  the end without an anchor moves along the side; if both are anchored at
  the same point, it is `layout/no-route`, so anchor them at different
  positions.
- **Fan-in (`figure.layout.fanIn`)**: by default (`merge`), edges from
  different elements entering the same side of an element without a
  `toAnchor` meet at one port and merge into one trunk, like a bus. With
  `fanIn: spread` (on `figure.layout`, next to `arrange`) Sumi **tries**
  to bring them in at separate points spread along that side, ordered by
  where their sources are. Spread is an attempt, not a guarantee: if it
  would put two ends on one point that `merge` kept apart, or leave an edge
  unrouted that `merge` routes, Sumi silently draws the **whole figure**
  as `merge` (no diagnostic). Spread is also skipped for a single side
  when a spread point would land on an end that is already there. If the
  preview still shows lines sharing an entry point, spread was skipped for
  that side or the whole figure fell back to `merge`: give those ends
  separate anchors
  (`toAnchor: "north:0.3"`, …). Anchored ends and junction ends are not
  moved; to merge on purpose under `spread`, route the edges through a
  `junction`. Spread can add crossings (the separate lines cross others
  one by one) and changes the routes of a figure written for `merge`.
  **When to spread**: several sources feeding several targets (workers →
  stores) where the merged trunks make lines wrap around blocks or make it
  unclear which source reaches which target. Default sides send all edges
  from one direction into the same side, so a merged trunk may detour;
  `spread` can remove such detours (in one measured architecture figure,
  three detouring edges became none, crossings 3 → 6), or anchor the ends
  on separate points (`toAnchor: "north:0.3"`, …) for full control.
- **Operator** (`component: operator`, `props: { symbol: plus }`; also
  `minus`, `times`, `dot`, `concat`): a small circle with a symbol, no
  label. Arrows may end on it; a side input usually comes from an attached
  node through a `line`.
- **Edge labels** sit on the last segment, just before the target's
  arrowhead (above it if that segment is horizontal, right of it if
  vertical); on an edge with only a source arrowhead, by that arrowhead on
  the first segment; on a `line` (no arrowhead), mid-way along the longest
  segment. Where that spot would touch a line or a group border (a short
  final segment, a trunk forking off right behind the arrowhead, the border
  of the group the edge enters), the label moves to the other side or back
  past the line or border. Other collisions are not avoided; keep labels to
  a word or a math symbol and check the preview.
- **Placing an edge label**: `labelAt: start | middle | end` puts it on the
  first segment (by the source), the longest one, or the last one (by the
  target). Without `labelAt` (e.g. `labelSide` alone) the segment is the
  default one above: `end` with a target arrowhead, `start` with only a
  source arrowhead, `middle` with none; `labelSide: left | right` on that side **as
  seen travelling from source to target** (left of a rightward line is
  above it, left of a downward line is to its right — not compass sides,
  since the router picks the direction). Either can be written alone. The
  label slides along that segment to avoid lines, arrowheads, borders,
  nodes and other labels, but never leaves the segment and side you
  named: if nothing there is clear it stays and Sumi reports
  `layout/edge-label-overlap` (warning; try the other side, another
  `labelAt`, or remove both to let the router choose). Use them to say
  which edge a label belongs to (`K,V` at the `start`, by its source) or
  to keep it on the outer side of a bend.
- Line corners are drawn rounded (radius up to 4pt, smaller in tight spots);
  there is no option to make them sharp. Editable PPTX keeps sharp corners.
  The router keeps a straight run of the arrowhead plus the radius before an
  arrowhead where moving a bend gives it; in a group padding or gap too
  tight for that, the arrowhead still comes right after the corner.
- Trunks and side paths run close beside the blocks (about 3pt away); the
  lever to move them is the `gap` of the enclosing box, not a coordinate.

Three workers writing to one store, each line entering on its own (without
`fanIn: spread` the three lines join above the store and enter as one
arrow):

```yaml
# expect-render: fits
version: 1
requires: ">=0.5.0"
figure:
  id: fan-in
  theme: color
  profile: paper-single
  layout:
    fanIn: spread
    arrange:
      stack:
        gap: 6mm
        items:
          - row: { gap: 4mm, items: [ infer, train, prep ] }
          - store
nodes:
  - { id: infer, component: box, label: Inference }
  - { id: train, component: box, label: Training }
  - { id: prep, component: box, label: Preprocess }
  - { id: store, component: cylinder, label: Feature store }
edges:
  - { from: infer, to: store }
  - { from: train, to: store }
  - { from: prep, to: store }
```

### Crossings (`layout/edge-crossing`)

The router does not forbid crossings, so dense figures keep some. `sumi
render` (and `lint --geometry`) reports each point where two separate
lines cross as `layout/edge-crossing`, an **info**: it does not fail the
render or count as a warning. A shared trunk counts as one line, so one
point is one diagnostic (at most 10, then one summary). The diagnostic
sits on one edge of the line routed later (its first edge through that
point, which need not be the edge you wrote last); the message names both
sides and the point in mm from the top left, and `related` gives the YAML
position of every other edge involved. Fix the
ones that hurt reading: move the edge you want straight **earlier** in
`edges`, leave from or enter another side (`fromAnchor` / `toAnchor`), or
change the arrangement (`gap`, item order, `align`). Some crossings
cannot be avoided (two lines that swap sides); keep those and mention the
count in the report. A figure whose expected result is drawn with
crossings is still clean: errors and warnings are what must reach 0.

## Legends

A **`legend`** node (`component: legend`, structured only) draws a
framed key: one row per entry, top to bottom, each a **sample** and its
text. An entry has exactly one of `edge` (a sample line, with the edge
fields `component` — default `arrow` — and `variant`) or `node` (a small
sample box: `component` — default `box` —, `variant`, `tone`), plus
`label` (math allowed). The samples are drawn by the same theme rules as
real edges and nodes, so a `variant: dashed` sample has exactly the dash,
arrowhead and width of the dashed edges. No colors are written. The
legend's own `label` is its title; `variant: plain` drops the frame;
`tone` colors the frame.

```yaml
- id: key
  component: legend
  props:
    entries:
      - { edge: { variant: dashed }, label: parameter update }
      - { edge: { component: line }, label: data flow }
      - { node: { tone: red }, label: loss terms }
```

- Place it in the tree like any node (a corner of the root stack or row);
  `align` and edges can name it. It cannot be `attach`ed
  (`layout/attached-legend`).
- `lint/unused-legend-entry` (warning): no node or edge of the figure has
  that entry's component, variant (and tone, for boxes). Fix the entry or
  the elements it should explain; do not keep a key for styles not drawn.
- The legend expands into nodes and edges named `<legend>-<n>-label`,
  `-box`, `-line`, `-start`, `-end` (n = entry number): your own IDs must
  not use these (`ref/reserved-id`). Up to 20 entries; a sample box cannot
  be a `label`, `image`, `operator`, `junction` or another `legend`
  (`component/invalid-prop`).
- Auto figures have no legend: say what the variants mean in the caption
  or the report.

## Spacing that routes

An arrow between two facing sides needs a gap longer than its arrowhead:
about **1.5mm in `academic`, 2.5mm in `minimal` / `color`, 4mm in `slides`**.
3mm (academic: 2mm) between connected blocks is a good start; `gap: 0` only
for blocks that touch with no edge between them. Paths that turn (residuals)
run in the gap left beside the blocks: if they look cramped, add `gap` to
the enclosing row or put the turning edge's target side (`toAnchor: west`)
where there is room.

## Fixing `layout/*`

| Code | Fix |
| --- | --- |
| `layout/structured-only` | the figure is auto: delete the field, or switch to structured (root `figure.layout.arrange`, remove `engine: auto`, place everything) |
| `layout/unplaced` | add the ID to the tree named in the hint (the root tree, or its group's `arrange`), or `attach` it. In a structured figure every node and group needs a place |
| `layout/duplicate-placement` | the element is in two trees, or in a tree and attached: keep one |
| `layout/unknown-item` | an `items` entry is not a node or group ID (edges are never placed): use the hint's ID |
| `layout/unknown-attach-target` | `attach.to` names no node or group: fix the ID |
| `layout/group-mismatch` | `group:` disagrees with the tree that places the element: delete `group:` (the tree decides) or move the ID into that group's `arrange` |
| `layout/group-cycle`, `layout/attach-cycle` | a group placed inside itself, or attachments in a loop: break the loop |
| `layout/invalid-anchor` | write `north`, `east`, `south` or `west`, optionally `:` and a number from 0 to 1; or `straight` (no side) |
| `layout/no-route` (render) | the ends touch (`gap: 0`), are closer than the arrowhead, or are boxed in (also by a node attached into the gap, see [attach](#attach-side-notes)): widen that `gap` (see above; even a `line` needs a gap > 0), or anchor the edge on other sides |
| `layout/unknown-align-item`, `layout/duplicate-align-item`, `layout/invalid-align` | an `align` entry names no node or group (edges cannot be aligned), names one twice, or has fewer than two IDs: fix the list ([align](#aligning-across-trees)) |
| `layout/unsatisfied-align` (render, warning) | the constraint cannot be met; follow the hint: put the items in different boxes, wrap one in its own `stack` / `row`, or drop a constraint that pulls the other way |
| `layout/align-search-limit` (render, warning) | too many constraints to solve; remove ones that are already met by the boxes |
| `layout/align-grew-figure` (render, info) | `align` made the figure much larger; keep it if intended, else align an item that can move alone, or drop the constraint ([align](#aligning-across-trees)) |
| `layout/edge-label-overlap` (render, warning) | an edge label with `labelAt` / `labelSide` has no clear spot on that segment and side: the other `labelSide`, another `labelAt`, remove both, or make room (`gap`, anchors, a shorter label) |
| `layout/edge-crossing` (render, info) | two lines cross; see [crossings](#crossings-layoutedge-crossing) |
| `layout/attached-legend` | a legend cannot be attached: list it in an arrange tree |

Geometry warnings after a structured render (`label-collision`,
`edge-crosses-label`) usually come from edge labels, crossing nets or a
group title in the way: move the title (`labelAt`, see
[group titles](#group-titles-and-captions)), place the edge label
(`labelAt` / `labelSide`), reorder the edges (earlier = straighter),
shorten the label, or add `gap`.

A complete structured figure is in [examples](examples.md#4-success-a-structured-block-diagram).
