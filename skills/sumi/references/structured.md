# Structured layout

Sumi has two layout engines. **auto** (the default) hands the figure to
D2 + ELK, which place everything along one `direction`. **structured** places
elements exactly where you put them in nested stacks and rows and routes the
edges itself (orthogonal lines, shared trunks). It is newer than the
0.3 releases: if `sumi lint` reports `schema/unknown-field` for `arrange`
(and `sumi catalog --kind node` lists no `operator` / `junction`), the
installed CLI predates it — tell the user and use auto instead.

## Which engine

| Figure | Engine |
| --- | --- |
| Flowcharts, pipelines, decision flows, state or dependency graphs, architecture overviews whose positions do not matter | auto (`figure.layout.direction`) |
| Paper block diagrams: stacked layers, residual connections, columns that must line up, blocks of equal width, side notes (`N×`), operators (⊕) on the main path | structured (`figure.layout.arrange`) |

`figure.layout.engine` (`auto` | `structured`) picks the engine; leave it
out and **a figure with `figure.layout.arrange` is structured, one without
it auto** — so `engine` is not needed. An explicit `engine: auto` wins over
`arrange`. Under auto, the structured-only fields (`figure.layout.arrange`,
`groups[].arrange`, `nodes[].attach`, `edges[].fromAnchor` / `toAnchor`)
are errors (`layout/structured-only`): remove the field, or switch the
figure to structured (root `arrange`, no `engine: auto`, every element
placed).
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
- **A group's label sits at the top centre**, above its members. An edge
  entering the group from above is routed around the label, so it detours
  and its arrowhead ends just under the label (or crosses it when there is
  no other way: `geometry/edge-crosses-label`). Workarounds: enter from
  the side (`toAnchor: west`) or off-centre (`toAnchor: "north:0.2"`); place the members so the one
  entered from above is not under the label; or leave out the group's
  `label` and attach a `label` node beside the group instead (drawn in
  the node label style, not the group's):

```yaml
# expect-render: fits
version: 1
figure:
  id: side-title
  theme: academic
  profile: paper-single
  layout:
    arrange:
      stack: { gap: 4mm, items: [ batch, train ] }
groups:
  - id: train                  # no label: nothing at the top centre
    arrange:
      stack: { gap: 3mm, items: [ model, loss ] }
nodes:
  - { id: batch, component: box, label: Batch }
  - { id: model, component: box, label: Model }
  - { id: loss, component: box, label: Loss }
  - { id: train-title, component: label, label: "Training\nstep", attach: { to: train, side: east, gap: 1mm } }
edges:
  - { from: batch, to: model }
  - { from: model, to: loss }
```

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

## Edges: anchors, junctions and trunks

The router draws orthogonal lines around nodes (never through them) in
YAML order, greedily: edges declared first get the best routes.

- **Anchors**: `fromAnchor` / `toAnchor` pick the side of an end: `west`,
  or `"south:0.2"` for a position along it (0..1: left → right on
  north/south, top → bottom on east/west; default 0.5). Quote values with a
  `:`. Without an anchor the router uses the side facing the other end.
  Several edges between the same two elements are spread out automatically.
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
  needs a straight stretch before its tip.

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
  target. Edges entering the same port merge the same way. An edge entering
  a port and one leaving it never share a line: the end without an anchor
  moves along the side; if both are anchored at the same point, it is
  `layout/no-route`, so anchor them at different positions.
- **Operator** (`component: operator`, `props: { symbol: plus }`; also
  `minus`, `times`, `dot`, `concat`): a small circle with a symbol, no
  label. Arrows may end on it; a side input usually comes from an attached
  node through a `line`.
- **Edge labels** sit on the last segment, just before the arrowhead (above
  it if that segment is horizontal, right of it if vertical), or mid-line on
  a `line`. Where that spot would touch a line or a group border (a short
  final segment, a trunk forking off right behind the arrowhead, the border
  of the group the edge enters), the label moves to the other side or back
  past the line or border. Other collisions are not avoided; keep labels to
  a word or a math symbol and check the preview.
- Line corners are drawn rounded (radius up to 4pt, smaller in tight spots);
  there is no option to make them sharp. Editable PPTX keeps sharp corners.
  The router keeps a straight run of the arrowhead plus the radius before an
  arrowhead where moving a bend gives it; in a group padding or gap too
  tight for that, the arrowhead still comes right after the corner.
- Trunks and side paths run close beside the blocks (about 3pt away); the
  lever to move them is the `gap` of the enclosing box, not a coordinate.

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
| `layout/invalid-anchor` | write `north`, `east`, `south` or `west`, optionally `:` and a number from 0 to 1 |
| `layout/no-route` (render) | the ends touch (`gap: 0`), are closer than the arrowhead, or are boxed in (also by a node attached into the gap, see [attach](#attach-side-notes)): widen that `gap` (see above; even a `line` needs a gap > 0), or anchor the edge on other sides |

Geometry warnings after a structured render (`label-collision`,
`edge-crosses-label`) usually come from edge labels, crossing nets or a
group label in the way (see [arrange trees](#arrange-trees)): shorten the
label, reorder the edges (earlier = straighter), or add `gap`.

A complete structured figure is in [examples](examples.md#4-success-a-structured-block-diagram).
