# Structured layout

**Purpose.** The structured layout places every element exactly where you
put it, in nested stacks, rows, grids and coordinate boxes, and routes the edges itself
(orthogonal lines, shared trunks). Use it for paper block diagrams; for
flows use auto ([layout-tips](layout-tips.md#choose-the-engine-first)).
Everything on this page is **structured only** unless it says otherwise.
Feature versions and what to do on an older CLI:
[figure-format](figure-format.md#feature-versions).

Contents: [minimal example](#minimal-example) · [engine rules](#engine-rules) ·
[arrange trees](#arrange-trees) · [grids](#grids) · [coordinates](#coordinate-placement) · [panel separators](#panel-separators) ·
[group titles and captions](#group-titles-and-captions) · [sublabels](#sublabels) ·
[turned labels](#turned-labels) · [text align](#text-align) · [attach](#attach-side-notes) ·
[align](#aligning-across-trees) · [tables](#tables) ·
[edges](#edges-anchors-junctions-and-trunks) · [crossings](#crossings-layoutedge-crossing) ·
[legends](#legends) · [zoom](#zoom-callouts) · [brackets](#brackets) ·
[tokens](#token-sequences) · [matrices](#matrices) · [spacing](#spacing-that-routes) ·
[fixing layout codes](diagnostics.md#fixing-layout)

## Minimal example

```yaml
# expect-render: fits
version: 1
figure:
  id: minimal-structured
  theme: paper
  layout:
    arrange:                    # its presence makes the figure structured
      stack: { direction: up, gap: 4mm, items: [ x, block, y ] }   # first item at the bottom
nodes:
  - { id: x, component: label, label: $x$ }
  - { id: block, component: box, label: Layer Norm, tone: blue, variant: filled }
  - { id: y, component: label, label: $y$ }
edges:
  - { from: x, to: block }
  - { from: block, to: y }
```

## Engine rules

`figure.layout.engine` (`auto` | `structured`) is rarely needed: **a figure
with `figure.layout.arrange` is structured, one without it auto**; an
explicit `engine: auto` wins. Under auto, every structured-only field
(`arrange`, `align`, `alignGrowth`, `fanIn`, `density`, `attach`, `sublabel`,
`labelRotation`, `textAlign`, `grow`, `fromAnchor` / `toAnchor`, edge
`labelAt` / `labelSide` / `route`, and the `legend`, `tokens`, `matrix`, `bracket`,
`separator` and `zoom` components) is `layout/structured-only`: remove it or
make the figure structured. Group `labelAt` and `caption`, icons, images,
tones, `operator`, `junction`, `dim` and the paper variants work in both.

- **Every node and group must be placed exactly once**: in one arrange tree
  or with `attach`. Nothing is placed for you.
- `figure.layout.direction` is ignored (each box has its own).
- Label math (`$...$`) is drawn only here ([label math](figure-format.md#label-math)).
- No D2 is needed (`sumi render` works without it); `--emit-d2` is refused
  (exit 2) and `geometry/reversed-edge` is not checked.

## Arrange trees

```yaml
figure:
  layout:
    arrange:                   # root tree: places the root elements
      row:                     # exactly one of stack / row / grid / place / chat
        gap: 6mm               # default 4mm (8mm on slides; 2.5mm with density: compact)
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

- `stack` runs top to bottom (`direction: down`, default) or bottom to top
  (`up`: the first item is at the bottom, like a network drawn from input to
  output). `row` runs left to right (`right`, default) or right to left (`left`).
- `gap`: a length with a unit or `0` (items touch, e.g. a filter and its
  gain; never connect touching items with an edge: `layout/no-route`).
- `align` places items across the box (stack: `start` = left; row: `start` =
  top). `stretch` widens (stack) or heightens (row) boxes, groups and
  box-like nodes to the largest; `label`, `circle`, `square`, `trapezoid`,
  `stack`, `operator`, `junction` and nodes with an explicit size on that axis
  are centred instead. Nested boxes of the same kind inherit `align`; others
  start at `center`.
- A side column next to a tall stack: both in a `row`, then the row's `align`
  (`center`, or `end` to line up the bottoms).
- **An item belongs to the owner of the tree**: items of `groups[].arrange`
  are members of that group; root items are at the root. Do not also write
  `group:` (a mismatch is `layout/group-mismatch`). A group is one item in its
  parent's tree.
- Elements of **different** trees on one line: [`align`](#aligning-across-trees), not `gap` tweaks.

**Filling extra height: `justify` and `grow`.** To fill a short column beside a
matrix set the row's `align: stretch` and the column stack's `justify: stretch`:
extra height goes to resizable items by relative weight (equal by default),
keeping the written `gap` (in a wide row inside a stretching stack it grows
widths). `justify` does not inherit, does nothing at natural size, and is not
accepted on `grid`; omitted or `center` keeps centred placement. Explicit sizes
on the growing axis, fixed-aspect shapes, text and custom outlines stay fixed;
bowtie, trapezoid and badged boxes can grow. `nodes[].grow` (number > 0, at most
1000, default 1) weights the **extra** space under the immediate box's `justify:
stretch` (`grow: 0.6` gets 60% of an unweighted sibling's extra); whole 0.5pt
increments by largest remainders (ties in visual order), a fractional leftover
stays as centred padding; no effect at natural size, under other modes, in
grid/attach or on non-stretchable shapes. Expanded `tokens`, `matrix`, `legend`
reject it (`component/grow-unsupported`). `justify: space-between` keeps sizes
and spreads extra room between items (one item stays centred). For tighter
title/caption spacing do not stretch a panel to an unrelated sibling: use
`align: start` there and stretch only its inner columns.

## Coordinate placement

Use `place` for small graphs whose shape you choose. `unit` is a positive length
(`mm`, `cm`, `in`, `pt`); each `at: [x, y]` is the item's center in multiples of
that unit, with y downward. Signed and fractional numbers are allowed; each scaled
coordinate must be within ±100000pt. The box is the union of its natural item
footprints, without reserving space back to the origin. Nodes/groups retain labels,
tones, captions, attach and edges; nested arrange boxes work too. A node's badge or
a group's caption extends its footprint without changing the body's authored center.

The parent places the box like any other item; extra space centers the whole shape
without stretching its contents. `place` has no `gap`, `align`, `justify` or `centerOn`;
use those on its parent. Cross-tree `align` can move the whole box via an enclosing
stack/row, but cannot change authored offsets; impossible constraints report
`layout/unsatisfied-align`. Repeat coordinates **and unit** to repeat a graph's shape
in two groups. Overlapping item footprints report `layout/place-overlap` (render
warning, both source positions); touching is allowed. Unknown/repeated IDs use the
usual arrange diagnostics. Straight edges through another vertex remain geometry
warnings, so move the vertex or change the edge.

```yaml
# expect-render: fits
version: 1
figure:
  id: four-vertex-graph
  theme: paper
  layout:
    arrange:
      place:
        unit: 6mm
        items:
          - { item: a, at: [1.5, 0] }
          - { item: b, at: [0, 2] }
          - { item: c, at: [0.5, 4] }
          - { item: d, at: [3, 3] }
nodes:
  - { id: a, component: circle, label: A, tone: blue }
  - { id: b, component: circle, label: B, tone: orange }
  - { id: c, component: circle, label: C, tone: green }
  - { id: d, component: circle, label: D, tone: purple }
edges:
  - { from: a, to: b, component: line, route: straight }
  - { from: b, to: c, component: line, route: straight }
  - { from: b, to: d, component: line, route: straight }
```

## Set enclosures

`sets` draws a translucent shape around nodes and groups after they are placed: Venn
diagrams, the hyperedges of a hypergraph, clusters, containment. Membership is
many-to-many and independent of groups: a node listed in two sets lies in their overlap,
and the two tints show through each other. Sets are a top-level list (own ID space);
members are node or group IDs (a group stands for its whole frame; `unknown member` is
`ref/unknown-set-member`, a repeat `ref/duplicate-set-member`). Structured layout only
(`layout/structured-only` in an auto figure).

| Field | Meaning |
| --- | --- |
| `members` | node / group IDs to enclose |
| `shape` | `circle` (default: the smallest circle around the members, like a classic Venn), `ellipse` (axis-parallel, at most 3:1, for a row of members), `hull` (rounded convex hull, for irregular members), `rect` (rounded rectangle) |
| `padding` | room between members and outline (default: the profile's group padding) |
| `label`, `labelAt` | outside the outline: `top` (default), `bottom`, `left`, `right`, or beside a diagonal extreme `top-left`, `top-right`, `bottom-left`, `bottom-right`. For a label inside, make a `label` node a member |
| `tone`, `variant` | the tone's line color draws outline, label and (at low opacity) the tint in every theme, gray without a tone. `default` tint + outline, `filled` tint, `outlined` outline, `dashed`; `fillOpacity` (0..1) overrides the tint |

- A set takes **no space** in the arrange trees: place the members first (`place` gives
  exact positions), then leave room around them for the outline and label, since the
  canvas grows to hold them. Sets are drawn over groups and under nodes and edges; an
  edge may cross a set's boundary.
- Put the shared member where the shapes overlap. A node inside an outline that is not a
  member reads as one: `geometry/set-contains-non-member` (warning) names it; add it to
  `members`, move it, or fit closer (`hull`, `ellipse`, smaller `padding`). A set label
  over text, a node, an edge or another set's boundary is `geometry/set-label-collision`:
  change `labelAt`. A subset's label inside its superset is fine.
- SVG, PDF and picture PPTX keep the opacity; editable PPTX draws each set as a
  freeform shape with alpha (and a text box for the label).

```yaml
# expect-render: fits
version: 1
figure:
  id: hyperedges
  theme: paper
  layout:
    arrange:
      place:
        unit: 7mm
        items:
          - { item: p1, at: [0, 0.3] }
          - { item: p2, at: [0.2, 1.9] }
          - { item: shared, at: [1.5, 1.1] }
          - { item: title, at: [2.8, 0.3] }
          - { item: abstract, at: [2.8, 1.9] }
nodes:
  - { id: p1, component: circle, icon: tabler/file-text, tone: blue, variant: tinted }
  - { id: p2, component: circle, icon: tabler/file-text, tone: blue, variant: tinted }
  - { id: shared, component: circle, icon: tabler/file-text, tone: gray, variant: tinted }
  - { id: title, component: circle, icon: tabler/letter-t, tone: green, variant: tinted }
  - { id: abstract, component: circle, icon: tabler/align-left, tone: green, variant: tinted }
edges:
  - { from: shared, to: abstract, component: line }
sets:
  - { id: e1, label: Entities, members: [p1, p2, shared], tone: blue, labelAt: top-left }
  - { id: e2, label: Attributes, members: [shared, title, abstract], tone: green, labelAt: top-right }
```

## Chat conversations

Use `chat` at the root, inside a group, or as a nested arrange box. Declare message
content as ordinary `bubble` nodes so IDs and edges keep working:

```yaml
# expect-render: fits
version: 1
figure:
  id: chat
  theme: paper
  layout:
    arrange:
      chat:
        width: 80mm
        maxWidth: 0.7
        speakers:
          friend: { side: left, avatar: avatar }
          me: { side: right, tone: green, variant: filled }
        items:
          - divider: 今日
          - { node: hello, from: friend, meta: "23:10" }
          - { node: reply, from: me, meta: [既読, "23:11"] }
nodes:
  - { id: avatar, component: circle, label: Y, variant: filled, tone: gray, props: { width: 16pt, height: 16pt } }
  - { id: hello, component: bubble, label: 次いつ遊ぶ？ }
  - { id: reply, component: bubble, label: いつでも！ }
```

`width` defaults from the profile's page width, margins and one group's padding.
`maxWidth` is the maximum natural bubble footprint: a column fraction `(0, 1]`
(default `0.7`) or a physical length such as `48mm`. Japanese and English wrap
inside it, including `sublabel` text. Chat's `maxWidth` (including its default)
overrides a message node's `props.maxWidth`. Explicit node width/height remain
authored constraints; indivisible formulas can exceed the natural maximum.
Messages are left-aligned text; the arrangement sets tail side and `tailAt: start`.
Consecutive messages by the same speaker drop the horn and avatar, keep the body
indent and use a smaller gap. Dividers reset the run. The avatar is an existing
node (circle, image, etc.), top-aligned with the first bubble and repeated on later
runs; do not place it separately. Edges referencing the authored avatar ID attach
only to its first occurrence; later copies do not clone or retarget those edges.
Right speakers have no avatar unless specified.
Left defaults to white `default` bubbles; right to theme `gray` / `filled`.
Node tone and explicitly written variant override speaker defaults.

Meta notes (string or list of lines) use the theme's small, muted annotation text,
bottom-aligned on the inner side of the bubble; outgoing notes are right-aligned.
Avatar top and meta bottom alignment use the node body, while badge overhang is
still reserved for spacing and collision avoidance. Continuation indentation uses
the actual horn depth, including the renderer's clamp for small explicit widths.
Dividers are centered muted pills. Both participate in page bounds and collision
lint. Spacing follows the profile, including `density: compact`. Chat columns stay
rigid under parent stretch, centered in extra space. Unknown speakers/avatars,
non-bubble message nodes and normal unknown/duplicate placements are errors;
`layout/chat-overflow` warns when visuals exceed the column: widen it, reduce
`maxWidth` or shorten the note. Keep the phone frame, header and input bar separate.

The bundled [chat](../examples/chat/chat.sumi.yaml) example shows a complete Japanese
conversation with a date divider, read receipts and an initial avatar;
[llm-dialogue](../examples/llm-dialogue/llm-dialogue.sumi.yaml) shows an English paper-single
dialogue with generic user/robot circle icons, speaker meta notes and multi-line
inline math. Both use `llama`, need no scaling and have no lint diagnostics.
Use `|-` for explicit multi-line answers; keep each `$...$` expression short
enough to fit the bubble, since math expressions do not wrap internally.

## Side inputs on a main flow

Put the main node and its side inputs in a **stack with `centerOn`**, inside
a centered row. The inputs reserve their full width and height, including
tokens; the named node stays on the row's centerline without `layout.align`
constraints or wrapping the other main-flow nodes.

```yaml
version: 1
figure:
  id: side-input
  layout:
    arrange:
      row:
        items:
          - encoder
          - stack:
              centerOn: decoder
              gap: 4mm
              items: [decoder, queries]
          - output
nodes:
  - { id: encoder, component: box, label: Encoder }
  - { id: decoder, component: box, label: Decoder }
  - { id: output, component: box, label: Output }
  - id: queries
    component: tokens
    props: { cells: [q1, q2, q3] }
edges:
  - { from: encoder, to: decoder }
  - { from: decoder, to: output }
  - { from: queries, to: decoder, fromAnchor: north, toAnchor: south }
```

- `centerOn` names a **direct node or group item** in that stack/row (use the
  tokens node ID for a whole sequence, not a cell). The box reserves symmetric
  main-axis space about that item's body center; its opposite side can contain
  blank space, especially inside a framed group. It does not change membership.
- To put the inputs **above**, use `direction: up` and reverse the input edge's
  anchors. For side inputs beside a vertical flow, put a `row` with `centerOn`
  inside a centered `stack` (`right`/`left` selects the side).
- Keep the outer box's `align` omitted or `center`. The inner box's cross-axis
  `align` still works normally. `centerOn` allows only omitted/`center` `justify`;
  a non-direct reference or another justification is `layout/invalid-center-on`.
- Inputs are ordinary arrange items: use `gap` for arrow clearance and connect
  them explicitly. Reserve `attach` for small annotations whose space you manage.
  An attached label takes no space: one on the main flow's path ends in
  `layout/no-route` (or `geometry/edge-crosses-label` with `route: straight`),
  so put it in the stack. An edge from another row enters the `centerOn` node
  from a side its inputs (items or nested boxes) do not use.

## Grids

A grid keeps rows and columns lined up (tables, patch grids, rows of equal columns):

```yaml
arrange:
  grid:
    columns: 4
    rowGap: 6mm
    columnGap: 4mm
    align: start
    items: [ dataset, sample, augment, augmented, model, loss, { item: optimizer, span: 2 } ]
```

- Items fill left to right, then top to bottom; `direction` is not accepted.
  An item is an ID, a nested stack / row / grid / place, `null` (YAML `~`), or
  `{ item: ID-or-box-or-null, span: N }` (spans cover columns only).
- **Every row must be complete**: crossing a row boundary is
  `layout/grid-span-overflow`, an incomplete last row `layout/grid-item-count`.
  Empty lists and strings are invalid. A deliberate blank cell is `null` (or
  `{ item: null, span: N }`): zero size, no node, obstacle or net endpoint,
  edges may pass through; a hidden junction is not a blank cell.
  `fmt --canonical-order` writes blanks as `null`.
- Column widths are the widest single-cell item; a spanning deficit is shared
  equally among its columns. Row heights are the tallest item (items are always
  vertically centred). `align` (`start` / `center` default / `end` / `stretch`)
  places items horizontally in each cell; stretch changes resizable widths
  only. Grid alignment is not inherited. Omitted gaps use the profile's arrange
  gap (compact density included). Extra room centres the whole grid.
- Cells take no `align` struts (nested stack / row boxes and ancestors still
  can): to align a grid cell vertically with something in another tree, wrap
  it (`{ stack: { items: [cell] } }` for `y`, a row for `x`). Sumi suggests
  the wrapper only after a trial layout shows it removes the diagnostic. Cells
  of the same grid are tracks of that grid: no wrapper separates them, so put
  them in the same grid row (`y`) or column (`x`). `layout/unsatisfied-align`
  names this limit.

**Span does not imply stretch.** `{ item: projection, span: 9 }` reserves nine
columns, but with the default `align: center` the box keeps its natural width. For
a box that must cover the columns below it set **`align: stretch` on the grid** and
leave `props.width` unset (fixed-width and non-resizable components, e.g. circles,
keep their width). `straight` lines up an endpoint but does not widen the box; if
outer columns miss its sides `layout/straight-off-side` (sometimes `layout/no-route`)
explains the span / natural-width cause, and recommends stretch or removing
`props.width` only after an in-memory trial confirmed it (else neutral wording).
Put `straight` at the wide box's end and check the routes.

## Panel separators

`component: separator` divides panels instead of hidden junctions plus a
dashed `line`. It spans its enclosing row's height (vertical line) or
stack's width (horizontal line), also with `align: start` / `center` /
`end`, nested boxes and reversed directions. It adds no size: use the box's
`gap` for whitespace on each side. Variants `default` / `dashed` (dashed) and
`solid`; `tone` colours it. No props, label, sublabel, badge, rotation or
`grow`. It is decoration (no geometry-lint obstacle, no edge endpoint:
`component/separator-connection`) and goes directly in a row or stack, not
`attach`ed or in a grid (`component/separator-placement`). For panels above
and below use an outer `stack`. A complete two-panel figure with titles is
the [panel recipe](layout-tips.md#two-panels-with-a-dashed-divider).

```yaml
# expect-render: fits
version: 1
figure:
  id: two-panels
  theme: paper
  layout:
    arrange: { row: { gap: 6mm, items: [left, divider, right] } }
groups:
  - { id: left, variant: plain, arrange: { stack: { items: [a, b] } } }
  - { id: right, variant: plain, arrange: { stack: { items: [c] } } }
nodes:
  - { id: a, component: box, label: Input }
  - { id: b, component: box, label: Encoder }
  - { id: divider, component: separator, variant: dashed }
  - { id: c, component: box, label: Detail }
edges:
  - { from: a, to: b }
```

## Group titles and captions

**Stacked group frames.** Use `props.layers: { count: 4, offset: 3pt }` on a
group (structured layout). `count` includes the front card (1–16); `offset` is
a positive length on the 0.5pt grid, diagonally up-right, matching image layers.
Only frames repeat, with the same fill/stroke, tone and dim colors; the front
keeps its title, children and padding. Rows, stacks, grids, obstacles, geometry
lint and the centred caption reserve the whole footprint. `label: '$C$'` with
`labelAt: top-left` puts an italic math title on the front card.
Use `default`, `muted`, `filled` or `dashed`; `plain` has no frame and reports
`component/invalid-prop`. Auto layout reports `layout/structured-only`.
Edges address the front frame and are painted above the cards. Rear cards are
decoration: orthogonal, `route: straight` and zoom edges may cross their north/east
bands, including edges leaving a child inside the group. Edge labels prefer to
avoid the front border and rear bands; if no clear place exists, geometry lint
reports `geometry/label-collision`. Keep enough space for multiline labels so their
opaque backgrounds do not hide card borders. SVG, PDF and picture PPTX preserve the stack;
editable PPTX reports `pptx/unsupported-geometry` for more than one card.


A group's `label` sits at the **top centre** inside the border. An edge entering from above
near it detours around it, ending just under it (or crosses it: `geometry/edge-crosses-label`).
Move it with **`labelAt`**: `top-left`, `top` (default), `top-right`, `bottom-left`, `bottom`,
`bottom-right` (always inside the border), choosing a place no edge enters (`bottom` for a
group entered from above). A corner helps only for a narrow title: one wider than about half
the group still covers the centre and the edge detours **without any diagnostic**: look at
the preview. `labelAt` without a `label` is `component/label-at-without-label`. Both `labelAt`
and `caption` work in auto figures too (default place `top-left`; at `bottom*` D2 still leaves
the space at the top, and edges leaving the group downwards cross its caption).

**Attachments and title centring.** The title is centred on the **whole group
frame**, attached members included, even with `variant: plain`: an input
attached west widens the frame and the title moves left of the body's centre.
To title only the body give it an inner group and attach the input to that
group (a sibling); an untitled outer group holds both as one panel. This centers
the input on the titled frame, so its edge jogs to the block's content center
(`layout/group-title-offset`); use an untitled body or a caption for a straight input:

```yaml
# expect-render: layout/group-title-offset
version: 1
figure:
  id: body-title
  theme: paper
  layout:
    arrange: { row: { items: [panel] } }
groups:
  - id: panel
    variant: plain
    arrange: { stack: { items: [body] } }
  - id: body
    label: Body
    variant: plain
    arrange: { stack: { items: [block] } }
nodes:
  - { id: block, component: box, label: Block }
  - { id: input, component: box, label: Input, attach: { to: body, side: west, gap: 6pt } }
edges:
  - { from: input, to: block }
```

**`caption`** puts text centred **under** the border, outside it (`(a) …`; line breaks
and math as in a label; fixed position). It is a label node with the reserved ID
`<group>-caption` (`ref/reserved-id`); diagnostics point at `caption`; edges cannot end on
it; a node attached `south` goes under it. The router treats it as an obstacle, so **an
edge between a member and an element below the group can detour around it** (inputs from
below with `direction: up` as well), with no diagnostic (at most `geometry/edge-on-border`):
look at the preview. `toAnchor: west` on the member does not help; put the caption on an
outer group that also holds the other end (`variant: plain` hides its border), or place
the other end beside the group (a `row`) so the edge crosses a side.

**Panels of equal height.** Panels (groups with captions) in one `row` with `align:
stretch` grow to the tallest so captions share a line. A frameless panel next to framed
ones is a group with `variant: plain` and a `caption`, not a stack with a `label` node
under it (its items are centred in the extra height). A stretched group's tree is
**centred vertically**; to sit content at the bottom make the tree a `row` with `align:
end` around the stack: `arrange: { row: { align: end, items: [ { stack: { direction: up,
items: […] } } ] } }` ([example 6](examples.md#6-success-a-paper-figure)).

```yaml
# expect-render: fits
version: 1
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

## Sublabels

**`sublabel`** draws a second, smaller text right under a node's label, e.g.
a tensor size (`label: Mask, sublabel: "64 × 64"`): 7/8 of the label's
size rounded down to 0.5pt (7pt under 8pt; 14pt under 16pt in `slides`),
centred, the node sized around both. Line breaks and math work as in labels;
with `labelRotation` both turn together. It needs a label
(`component/sublabel-without-label`); an `icon`, `operator`, `junction`,
`image` or `legend` takes none (`component/sublabel-unsupported`). It is
checked like any text: `profile/font-too-small`, and under `figure.fit: scale`
`geometry/text-too-small` at its printed size (7pt shrunk to 70% prints 4.9pt).
For a second line of the same size use `\n` in the label.

```yaml
# expect-render: fits
version: 1
figure:
  id: sublabels
  theme: color
  layout:
    arrange: { row: { gap: 6mm, items: [features, mask] } }
nodes:
  - { id: features, component: box, label: "Feature\nMap", sublabel: "64 × 64 × 3", tone: gray }
  - { id: mask, component: box, label: Mask, sublabel: "64 × 64", tone: gray }
edges:
  - { from: features, to: mask }
```

## Turned labels

**`labelRotation: -90`** draws a node's label reading bottom to top (`90`: top
to bottom): the title of a tall encoder box, a vertical axis label. Only `90`
and `-90`; nodes only. The node is sized around the turned text (a `label`
becomes tall and narrow); with explicit `props.width` / `height`
`geometry/label-overflow` checks the turned text. Line breaks and math turn
with it. On an `icon`, `operator`, `junction`, `image` or `legend` it is
`component/label-rotation-unsupported`; without a label a warning
(`component/label-rotation-without-label`).

```yaml
# expect-render: fits
version: 1
figure:
  id: turned-labels
  theme: academic
  layout:
    arrange: { row: { gap: 6mm, items: [query, backbone, out] } }
nodes:
  - { id: query, component: label, label: Query, labelRotation: -90 }
  - { id: backbone, component: box, label: Shared Backbone, labelRotation: -90 }
  - { id: out, component: box, label: Latent }
edges:
  - { from: query, to: backbone }
  - { from: backbone, to: out }
```

## Text align

`textAlign: left | center | right` on a node aligns its label and sublabel
lines within their shared, widest-line text block (default centred). It does
not wrap text or change padding: add line breaks yourself. Typical use: left-aligned prompt boxes.

```yaml
# expect-render: fits
version: 1
figure:
  id: prompt-box
  theme: paper
  layout:
    arrange: { stack: { items: [prompt] } }
nodes:
  - { id: prompt, component: box, label: "A photo of a cat\nsitting on a mat", textAlign: left, mono: true }
```

## Attach: side notes

```yaml
- { id: config, component: circle, icon: tabler/adjustments, attach: { to: add, side: west, gap: 1mm } }
- { id: config-label, component: label, label: "Sensor\nconfig", attach: { to: config, side: west, gap: 0.5mm } }
- { id: repeat, component: label, label: "N×", attach: { to: encoder, side: east, gap: 2mm } }
```

`attach: { to, side, gap }` puts a node outside the trees, centred on the
`side` of a node or group, `gap` away (default 0); chains work (`config-label` →
`config` → `add`). The attached node joins its target's group, which (or the
canvas) grows to hold it. Corner sides `north-east`, `south-east`,
`south-west`, `north-west` place it outside both sides with the gap on each
axis (a [badge](assets.md#corner-badges) is instead centred on the corner);
edge anchors still take only the four sides. Use it for a label beside a
block, `N×` beside a group, an input feeding an operator from the side.

A `label` has no size choice (the theme's text size; `paper`: 8pt). A larger annotation is
an `html` leaf with an inline `font-size` ([html](html.md); not editable PPTX):

```yaml
- { id: lx, component: html, props: { viewport: 40x20, width: 40pt, html: '<span style="font-family:var(--sumi-font);font-size:14px">L×</span>' } }
```

**An attached node takes no space in the tree**: neighbours are placed as if
it were absent. Attached into the `gap` between two items it can overlap the
next one (`geometry/node-overlap`, `geometry/label-collision`) or block the
edges that need the gap (`layout/no-route`): e.g. a ⊕ attached `south` of `a`
in a stack with `gap: 3mm` is drawn on top of `b`. Instead put the element **in
the tree** between the two items (`items: [ a, op, b ]`, edges `a → op → b`), or
widen that `gap` beyond the attach `gap` plus the node's size (more if an edge
must pass beside it; the ⊕ above needs `gap: 7mm`). Attach on a side where no
other item is placed (beside a stack, above or below a row).

## Aligning across trees

Each box aligns only its own items. To put elements of different boxes on one
line (a U-Net's concat ⊕ level with its encoder block so the skip runs
straight) list them in **`figure.layout.align`** instead of tuning `gap`s:

```yaml
figure:
  layout:
    arrange: { … }
    align:
      - { y: [ enc1, cat1 ] }            # same height: one horizontal line
      - { x: [ head, legend ], at: start } # same left edge: one vertical line
```

- A constraint is exactly one of `y: [ids]` (centres at one height; `at: start`
  = tops, `at: end` = bottoms) or `x: [ids]` (centres on one vertical; `start` =
  left edges, `end` = right edges), with at least two node or group IDs
  (attached nodes too: they move with their target).
- Sumi only **adds space** before or after items in a stack (for `y`) or row
  (for `x`) that holds just one of them, never inside a `gap: 0` box. So it
  aligns elements in different branches (`y` across stacks side by side in a
  row, `x` across rows in a stack), not two items of one stack on `y` nor of
  one row on `x`. Two items of one row on `y` need a stack around one:
  `items: [ a, { stack: { items: [ key ] } } ]`. Put the element **in the tree**
  (not `attach`ed into a gap).
- An unmeetable constraint is `layout/unsatisfied-align` (warning; from `sumi
  render` / `lint --geometry`, not plain `lint`): the figure is drawn with the
  closest placement; the message gives the distance left, the hint whether the
  items cannot be moved apart (same box, `gap: 0`) or another constraint pulls
  them away. `layout/align-search-limit` (warning): too many constraints.
- **Centring can couple constraints that share no IDs** (space added to a centred
  branch shifts its other items). Sumi tries a bounded two-step lookahead after the
  greedy search; a gap above 0.01 layout units that survives it is not fixed by more
  space: for table headings use `align: start` on the parent `row` (`stack` for
  transposed tables) so they move down/right independently. The warning describes
  a real gap even when its distance rounds to `0.01mm`.
- **`align` can enlarge the figure**: the added space moves everything after it
  and grows the enclosing boxes. When the figure grows by more than 5mm and 10%
  render reports `layout/align-grew-figure` (info) with both sizes. Keep it if
  intended (a U-Net level pushed down for a straight skip); otherwise align an
  item that can move alone (wrap it in its own `stack` / `row`), bring the two
  closer in the tree, or use an anchor instead. For an intended growth set
  `figure.layout.alignGrowth: allow` to drop this info.

```yaml
# expect-render: fits
version: 1
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

The concat operators are items of the decoder stack (not attached), and the two
`align` constraints push `enc1` and `enc2` down to their levels, so both dashed
skips are single horizontal lines. The `key` legend is [below](#legends).

## Tables

A table-like block (rows of the same kinds of element repeated in columns,
with row headings) is a [grid](#grids): headings in the first column, one
column per repeated unit, a `null` cell and a `span` for an element under
the columns. `align: stretch` makes the columns even and the ensemble box as wide
as the columns; `straight` anchors give vertical lines. (Alternative when
columns hold items of different heights: a `row` of column `stack`s plus one
`y` [align](#aligning-across-trees) per heading, with the root row at
`align: start`, since `align` only adds space.) A tokens node takes part
through one cell (`k0.1`) or as a whole (`k0`).

```yaml
# expect-render: fits
version: 1
figure:
  id: model-table
  theme: paper
  profile: paper-double
  layout:
    arrange:
      grid:
        columns: 4
        rowGap: 4mm
        columnGap: 4mm
        align: stretch
        items:
          - h-data                    # row 1: heading, then one cell per column
          - d0
          - d1
          - d2
          - h-flags
          - k0
          - k1
          - k2
          - h-model
          - p0
          - p1
          - p2
          - null                      # blank under the headings
          - { item: merge, span: 3 }
nodes:
  - { id: h-data, component: label, label: Data }
  - { id: h-flags, component: label, label: Options }
  - { id: h-model, component: label, label: Models }
  - { id: d0, component: box, label: Split 0, tone: gray, variant: filled }
  - { id: d1, component: box, label: Split 1, tone: gray, variant: filled }
  - { id: d2, component: box, label: Split 2, tone: gray, variant: filled }
  - { id: k0, component: tokens, tone: orange, props: { component: square, variant: outlined, gap: 1pt, width: 11pt, height: 11pt, cells: [ a, b, c ] } }
  - { id: k1, component: tokens, tone: orange, props: { component: square, variant: outlined, gap: 1pt, width: 11pt, height: 11pt, cells: [ { label: a, variant: filled }, b, c ] } }
  - { id: k2, component: tokens, tone: orange, props: { component: square, variant: outlined, gap: 1pt, width: 11pt, height: 11pt, cells: [ a, b, { label: c, variant: filled } ] } }
  - { id: p0, component: box, label: Model, tone: purple, variant: outlined }
  - { id: p1, component: box, label: Model, tone: purple, variant: outlined }
  - { id: p2, component: box, label: Model, tone: purple, variant: outlined }
  - { id: merge, component: box, label: Ensemble, tone: gray, variant: filled }
edges:
  - { from: p0, to: merge, toAnchor: straight }
  - { from: p1, to: merge, toAnchor: straight }
  - { from: p2, to: merge, toAnchor: straight }
```

## Edges: anchors, junctions and trunks

The router draws orthogonal lines around nodes (never through them) in YAML order,
greedily: edges declared first get the best routes.

Independent crossing connectors between two rows (or columns) get separate
middle lanes automatically when the clear channel fits their stubs, arrowhead
room and 1.5pt stroke-to-stroke spacing. Keep the correspondence order: do not
reorder a row just to remove the crossing. If `geometry/edge-near-edge` remains,
use its numeric port-to-port minimum to increase the **gap between rows**, and
keep nodes/titles out of that channel. Close fixed legs need more space between
ports (anchors or cell spacing); a larger row gap alone does not separate them.
Shared trunks keep their existing routing. There is no per-edge lane coordinate.

- **Diagonal correspondences**: use `route: straight` on each correspondence,
  e.g. for stacked rows `{ from: predictions.1, to: targets.3, route: straight,
  fromAnchor: south, toAnchor: north }` (side by side: `east` / `west`). Each is one
  independent segment with **no obstacle avoidance**: centre-to-centre ends between
  tokens cells can cut through neighbouring cells, so give side anchors. Where edge
  labels crowd, use an attached `label` node instead.
  Automatic ends follow the centre-to-centre line to the shapes' outlines;
  side anchors pick exact box positions (projected onto non-rectangular outlines).
  A `straight` anchor on this route uses the same automatic endpoint.
  Arrowheads follow the diagonal. Labels stay horizontal, default at the midpoint
  on the left facing source → target; `labelAt: start | middle | end` and
  `labelSide: left | right` choose another position. Labels do not dodge obstacles.
  Inspect crossings: `geometry/edge-through-node` (also when the line only clips
  or brushes a node or tokens cell: its stroke touches the outline),
  `geometry/edge-crosses-label` and `geometry/label-collision` locate overlaps;
  move endpoints, labels or nodes, or use side anchors.
  Self-loops, overlapping endpoint boxes, missing outline intersections, inward-facing anchors, insufficient
  arrowhead room and `component: zoom` conflicts are `layout/no-route` errors.
  PDF and picture/editable PPTX support the line; glued PPTX snaps to its connection
  sites as usual. Omit `route` for the existing orthogonal router.
- **Smooth bundles**: `route: curve` draws one independent cubic Bézier, without
  obstacle avoidance. Outline endpoints and anchors follow `route: straight`.
  All incident curves at a junction share one oriented direction, including a
  curved through-edge: curves arrive along it and depart along it, so they continue
  in the same direction through the junction without a cusp. Explicit side anchors
  override that direction.
  At ordinary nodes, automatic tangents follow the
  endpoint chord; side anchors/fixed ports use their outward side normal.
  Arrowheads follow the end tangent; `tone` works as on straight edges. Labels
  stay horizontal, left of the local tangent at the arc-length midpoint by default;
  `labelAt` and `labelSide` also work. Node/label crossings are sampled and reported
  with YAML positions. Move the arrangement or anchors to clear them.
  SVG, PDF, picture PPTX and editable **freeform** PPTX preserve the curve;
  editable **glued** returns `pptx/unsupported-geometry` (choose freeform).

```yaml
# expect-render: fits
version: 1
figure:
  id: smooth-bundle
  theme: paper
  layout:
    arrange:
      row:
        gap: 10mm
        items: [{ stack: { items: [x1, x2] } }, j1, j2, { stack: { items: [z1, z2] } }]
nodes:
  - { id: x1, component: circle, label: X1 }
  - { id: x2, component: circle, label: X2 }
  - { id: j1, component: junction, variant: hidden }
  - { id: j2, component: junction, variant: hidden }
  - { id: z1, component: circle, label: Z1 }
  - { id: z2, component: circle, label: Z2 }
edges:
  - { from: x1, to: j1, route: curve, component: line, tone: blue }
  - { from: x2, to: j1, route: curve, component: line, tone: orange }
  - { from: j1, to: j2, component: line, variant: dashed }
  - { from: j2, to: z1, route: curve, tone: blue }
  - { from: j2, to: z2, route: curve, tone: orange }
```

- **Anchors**: `fromAnchor` / `toAnchor` pick the side of an end: `west`, or
  `"south:0.2"` for a position along it (0..1: left → right on north/south, top →
  bottom on east/west; default 0.5; quote values with `:`). Several edges between
  the same two elements spread out automatically. Ends facing each other within 1pt
  of one line are drawn straight (one end moves up to 1pt, so an anchor read off a
  render still gives a straight drop); if both share points with other edges and
  neither can move, `layout/unaligned-ends` (warning): write the same position for
  both. With a split `bowtie` (`props.gap`) a north/south port in the empty gap moves
  to the nearest painted lip (left on ties), explicit anchors too; an unshared,
  unanchored neighbour follows the lip's line if the ends were aligned before,
  otherwise `layout/unaligned-ends` reports the remaining step.
- **`straight`** (`toAnchor: straight` / `fromAnchor: straight`): the end sits in line
  with the other end on the side facing it, so the line has no jog. Use it for narrow
  boxes in a row feeding a wide one (patches into a projection, models into an
  ensemble) instead of computing `"south:0.3127"`; put it on the **wide** box's end
  (`fromAnchor` when it is the source). No side is written; an unanchored other end
  takes the facing side. Two sources in line with one point merge there. If the other
  element's centre is not over the side (at least 3pt inside its corners), the two are
  diagonal or overlapping, or parallel edges run from a wide box into a narrow one,
  `layout/straight-off-side` (warning) and the end acts as if unanchored: line them up
  in the tree, put `straight` on the wide end, or write a side anchor.
- **Two inputs from another column, one from its own**: the two edges from the other
  column leave its top block with `fromAnchor: north` (one shared trunk) and enter at
  `toAnchor: "south:0.2"` and `"south:0.4"`, the column's own input at `"south:0.8"`;
  with the default `"south:0.5"` the lines tangle (no diagnostic: look at the preview).
- **Default sides** (no anchor) follow the arrange tree: take the box where the two
  ends' branches part; in a stack the ends use north / south, in a row east / west,
  towards the other end (an attached node counts as its target's place). If the ends
  overlap along that axis, or no box separates them, the facing side is used. Write an
  anchor whenever you mean another side.
- **Junction** (`component: junction`, a small dot): where a line splits or merges.
  Place it in the tree between the blocks it connects and connect into it with
  `component: line` (an arrowhead would hide the dot); every edge touching it is one
  connected net. `variant: hidden` draws no dot: lines fork smoothly as in paper figures
  (keep the dot where another line crosses nearby). A hidden junction with one incoming
  arrow is an **open end** (`{ id: out, component: junction, variant: hidden }`,
  `{ from: add, to: out }`); put it straight in line, since an arrowhead needs a straight
  stretch. Lines meet a junction at its centre: anchors on a junction end are ignored
  (`component/anchor-on-junction`, warning).

  ```yaml
  # one input entering a block at three points, plus a bypass to the side of the ⊕
  - { from: split, to: mixer, toAnchor: "south:0.2" }
  - { from: split, to: mixer, toAnchor: "south:0.5" }
  - { from: split, to: mixer, toAnchor: "south:0.8" }
  - { from: split, to: add, toAnchor: west }               # bypass
  ```

- **Shared trunk (bus)**: edges leaving one element at the same anchor share a line until
  they branch (`{ from: mlp, fromAnchor: north, to: ss1, toAnchor: east }`, … per
  target). An edge entering a port and one leaving it never share a line; both anchored
  at one point is `layout/no-route`.
  A hidden junction feeding the same vertical side of unequal-height targets
  (e.g. boxes with a short `label` among them) prefers one horizontal bus with
  full arrowhead room for every target. The shorter target gets a longer arrow;
  obstacles and tight gaps can still force a detour. Equal-height targets keep
  their existing routing.
- **Fan-in (`figure.layout.fanIn`)**: by default (`merge`) edges from different elements
  entering one side without a `toAnchor` merge into one trunk. `fanIn: spread` (next to
  `arrange`) **tries** to bring them in at separate points ordered by their sources; if
  that would put two ends on one point or leave an edge unrouted, the **whole figure** is
  silently drawn as `merge` (a single side is skipped when a point would land on an
  existing end). If the preview still shows shared entry points, anchor them. Anchored
  and junction ends are not moved; to merge on purpose use a `junction`. Spread can add
  crossings (one measured figure: detours 3 → 0, crossings 3 → 6): use it when several
  sources feed several targets and merged trunks wrap around blocks.
- **Operator** (`component: operator`, `props: { symbol: plus }`; also `minus`, `times`,
  `dot`, `concat`): a small circle with a symbol, no label; arrows may end on it, a side
  input usually comes from an attached node through a `line`. `props.size: regular |
  large | xlarge` (1x / 1.5x / 2x) makes it more visible
  ([example](assets.md#framed-images-and-operator-size)).
- **Edge labels** sit on the last segment before the target's arrowhead (above a
  horizontal one, right of a vertical one); with only a source arrowhead, by it on the
  first segment; on a `line`, mid-way along the longest. Where that touches a line or a
  group border the label moves. On short spans, a label that overlaps a node can move
  farther away from the line instead of widening the gap; check the preview.
  **`labelAt: start | middle | end`** picks the
  first, longest or last segment; **`labelSide: left | right`** the side **as seen
  travelling from source to target** (left of a rightward line is above it). Either
  alone is fine (default segment: `end` with a target arrowhead, `start` with only a
  source one, `middle` with none). The label slides along that segment and keeps its
  side; a short span may need extra distance from the line to clear nodes or labels.
  If nothing there is clear `layout/edge-label-overlap` (warning:
  the other side, another `labelAt`, or neither). Use them to say which edge a label
  belongs to (`K,V` at the `start`).
- **Titled group alignment**: frame centers and content centers differ because the
  title reserves space. `layout/group-title-offset` (info) explains a horizontal jog
  between aligned frames. Align the connected nodes, e.g.
  `figure.layout.align: [{ y: [encoderOut, decoderIn] }]`, or use a caption/untitled group.
- **Corners and arrowheads**: lines are drawn rounded (radius up to 4pt).
  `figure.themeOverrides.edgeCorners: sharp` gives sharp turns with butt caps and miter
  joins (zoom wires too; editable PPTX keeps sharp centrelines). The router keeps a
  straight run of head plus radius where moving a bend gives it; tight group padding
  grows automatically for the head plus a 2pt stem and 3pt border clearance. A tight gap
  elsewhere can still leave the head right after a corner: `geometry/arrowhead-cramped`
  (info). A hidden junction in a stack gap that feeds a bus from aside, just short of the
  head's room, moves onto the bus row (nodes never move), so its trunk turns into the bus
  with a gentle corner. It stays at its placed position when that axis is constrained by
  `layout.align` or `centerOn`, it has an attachment or an incident straight/curve/zoom edge,
  or its swept rectangle meets a node, group border, title or back-card obstacle. Uncertain
  checks keep the original position. Trunks and side paths run about 3pt beside blocks; the lever is the
  enclosing box's `gap`, not a coordinate.

Three workers writing to one store, each line entering on its own (without
`fanIn: spread` the lines join above the store and enter as one arrow):

```yaml
# expect-render: fits
version: 1
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

The router does not forbid crossings. `sumi render` (and `lint --geometry`) reports
each point where two separate lines cross as `layout/edge-crossing`, an **info** (does
not fail the render or count as a warning). A shared trunk is one line; at most 10 are
listed, then a summary; the message names both sides and the point in mm and `related`
gives every other edge. Fix the ones that hurt reading: move the edge you want straight
**earlier** in `edges`, use another side, or change the arrangement (`gap`, item order,
`align`). Keep unavoidable ones (two lines swapping sides) and report the count.

## Legends

A **`legend`** node draws a framed key: one row per entry, a **sample** and its
text. An entry has exactly one of `edge` (a sample line: `component` default
`arrow`, `variant`, `tone`), `node` (a small sample box: `component` default
`box`, `variant`, `tone`) or `class` (the sample of a [matrix](#matrices) class,
`<matrix>.<class>`), plus `label` (math allowed; a `class` entry defaults to the
class's label). Since 0.16.0 three more samples: `icon: tabler/file-text` (an
icon one text line tall, or `iconSize` as on a node), `glyph: { kind: vector, tone: blue, strength: solid }`
(the fields of a node [glyph](assets.md#glyphs) except `at` / `dx` / `dy`: `kind`,
`cells`, `direction`, `tone`, `tones`, `strength`, `size`, `width`, `outline`) and
`set: { tone: green, variant: dashed, fillOpacity: 0.3 }` (a small translucent
rectangle painted like a [set](#set-enclosures)). A paired arrow is
`edge: { component: double-arrow, tone: red }`; edge variants are `default`,
`dashed`, `emphasis`, `muted` (there is no dotted line). Samples are drawn by the
same theme rules as real edges, nodes, glyphs and sets, so no colours are written. The legend's own `label` is its title;
`variant: plain` drops the frame; `tone` colours it. Entry text is left-aligned (a
wrapped `\n` entry keeps its lines flush left); `textAlign: center | right` on the legend
changes it.

```yaml
- id: key
  component: legend
  props:
    entries:
      - { edge: { variant: dashed }, label: parameter update }
      - { edge: { component: line }, label: data flow }
      - { node: { tone: red }, label: loss terms }
      - { node: { variant: outlined, tone: purple }, label: encoders }
      - { edge: { tone: orange }, label: latent path }
```

**Layout** (since 0.16.0): `flow: column` (default, one entry per line) or
`flow: row` (the entries side by side; `perRow: 3` wraps after 3 per line, row only).
An entry's `heading: "Entity:"` starts a group: the heading is drawn at the start of
its own line (a row: in one table column, as wide as the widest heading, with the
group's lines, wrapped ones included, starting at one x beside it) and the following
entries without a heading belong to it. `labelAt: left` puts an entry's text before its
sample (Paper followed by its icon). One legend can hold a whole paper key at the bottom:

```yaml
- id: key
  component: legend
  variant: plain
  props:
    flow: row
    entries:
      - { heading: "Entity:", icon: tabler/file-text, labelAt: left, label: Paper }
      - { heading: "Feature:", glyph: { kind: vector, tone: blue, strength: solid }, labelAt: left, label: Initial }
      - { glyph: { kind: vector, tone: orange, strength: solid }, labelAt: left, label: Integrated }
      - { heading: "Pairs:", edge: { component: double-arrow, tone: blue }, label: Positive }
      - { set: { tone: green }, label: Hyperedge }
```

- Place it in the tree like a node; `align` and edges can name it; it cannot be attached
  (`layout/attached-legend`). `lint/unused-legend-entry` (warning): no node or edge has the
  entry's component, variant and tone, no node draws the `icon` (or a badge of it), has a
  `glyph` of the entry's kind, strength and tones, or no set has the swatch's variant
  and tone (`class` entries never; `lint/unused-matrix-class` covers those): fix the
  entry or the elements; keep no key for styles not drawn.
- It expands into nodes, edges and a set `<legend>-<n>-label`, `-heading`, `-box`, `-line`,
  `-start`, `-end`, `-set` (`ref/reserved-id`). Up to 20 entries; a sample box cannot be a `label`, `image`,
  `operator`, `junction` or `legend` (`component/invalid-prop`). Auto figures have no
  legend: say what variants mean in the caption or report. Headings are plain text
  (no bold). An icon sample in an editable PPTX is the node icon limit
  (`pptx/unsupported-asset`); glyph, set and edge samples are shapes.

## Zoom callouts

A **`zoom`** edge (catalog `"engines": ["structured"]`) shows that a group or node is an
enlarged view of another element: two straight lines, dashed by default (`variant:
solid`, `muted`), from the source's corners to the matching corners of the target. No
label or anchors (`component/unexpected-label`, `component/anchor-on-zoom`).

```yaml
edges:
  - { from: block, to: block-detail, component: zoom }
```

The corners follow where the target lies (to the right: source top-right and bottom-right
→ target top-left and bottom-left; likewise left, below, above; apart on both axes the
larger gap decides): place the target beside, above or below the source (overlapping ends
are `layout/no-route`). It is not routed: other lines may cross it, it is left out of
`layout/edge-crossing`, and a node in its way is `geometry/zoom-crosses-node` (warning):
move the node, or the source or view.

## Brackets

A **`bracket`** node gathers a row or column into one edge. `props.form` is
`square` (default) or `curly`; **`props.points`** is `east` (default), `west`,
`north` or `south`: the side of the spine or brace tip (an east-pointing bracket
gathers elements to its west). Edges meet the spine's middle / brace tip on that
side even when the other end is off-axis; the route bends after the port.

- Attach it to a group, matrix or [whole token sequence](#token-sequences). `east` /
  `west` attachments match the target's height, `north` / `south` its width; `points` is
  independent of `attach.side`: set both. Explicit `props.width` / `height` win; natural
  size 6pt deep × 24pt long (corner attachments keep it).
- Reserve room in the arrange `gap` for its depth, `attach.gap` and the outgoing arrow
  (6pt bracket, 2pt attach gap, row `gap: 18mm` leaves a readable arrow; off-axis routes
  need room for the first bend). No label, `labelRotation`, `sublabel` or `badge`.
  Variants: `default`, `emphasis`, `muted`, `outlined` (line in the node's tone).

```yaml
# expect-render: fits
version: 1
figure:
  id: bracketed-sequence
  theme: paper
  layout:
    arrange: { row: { gap: 18mm, items: [seq, out] } }
nodes:
  - id: seq
    component: tokens
    props: { direction: down, gap: 0, width: 40pt, height: 22pt, cells: [a, b, c] }
  - id: br
    component: bracket
    attach: { to: seq, side: east, gap: 2pt }
    props: { form: curly, points: east }
  - { id: out, component: box, label: Output }
edges:
  - { from: br, to: out }
```

## Token sequences

A **`tokens`** node writes a row (or column) of cells (sequence tokens, patches,
options) as one node; edges address its cells.

```yaml
# expect-render: fits
version: 1
figure:
  id: token-sequence
  theme: color
  layout:
    arrange:
      stack:
        gap: 5mm
        items:
          - pool
          - row: { gap: 6mm, align: end, items: [seq, cluster] }
nodes:
  - { id: pool, component: box, label: Pooling, tone: gray }
  - id: seq
    component: tokens
    tone: purple
    props:
      gap: 1.5pt
      height: 14pt
      cells:
        - { id: prefix, label: Prefix, tone: gray }
        - { id: x1, label: '$x_1$' }
        - { id: x2, label: '$x_2$' }
        - { label: '…', component: label }
  - id: cluster
    component: tokens
    props: { gap: 1pt, component: square, lineAlign: center, lines: [[a], [{ label: b, tone: orange }, c, d]] }
edges:
  - { from: pool, to: seq.x2 }
```

- **Cells.** A cell is a label string or `{ id, label, tone, mono, component,
  variant, width, height }`; `props.component` / `variant` / `width` / `height`
  and the node's `tone` are the defaults. An ellipsis is `{ label: '…',
  component: label }` or math such as `'$A_{\ldots}$'`. A `props.variant`
  must be supported by the node's own component (`props.component`, default
  `box`), or it is an error at `props.variant`. A cell that overrides the
  component with one lacking that variant (the `label` component in the
  ellipsis above, with `props.variant: outlined`) falls back to `default`. An
  explicit cell `variant` must be supported. The node has no label of
  its own (put a `label` node beside it). `props.variant: outlined` gives shape
  cells (not `label` cells) a coloured frame and text in their tone; a cell's `variant: solid` is a
  selected cell (strong fill, white text); `tinted` gives pastel highlighted cells
  (both also work in legend `node` samples).
- **Direction and lines.** `gap` and `align` are those of an arrange box;
  `direction: down` makes a column. `lines: [[a], [b, c, d]]` (instead of
  `cells`) stacks several rows, `lineGap` apart, e.g. a small cluster.
  **`lineAlign`** places the lines across (the catalog lists the values;
  omitted inherits from the enclosing box): `start` flushes the shorter lines to
  the start (left for a row), `center` centres them, `end` flushes them to the
  end, `stretch` as `align: stretch` (resizable cells widen, fixed-size ones such
  as `square` stay centred). Aligning a cell of multi-line tokens keeps the whole
  block's cell offsets and `lineAlign`; if the outer arrangement cannot move the
  block, `layout/unsatisfied-align`: wrap the tokens in a `row` (for `x`) or
  `stack` (`y`). Naming the whole node aligns its frame, not a cell.
- **Addressing.** Edges, `attach.to` and `align` name a cell **`<node>.<cell>`**:
  its `id`, or its 1-based position when it has none (`cluster.3`). With `lines`
  positions count continuously in **written line order**, then written cell
  order; they do not restart per line or change with `direction`: for
  `lines: [["0", "1"], [a, b]]`, `emb.1` is `"0"`, `emb.2` is `"1"`, `emb.3` is
  `a`, `emb.4` is `b`. A cell with an `id` uses it (and still counts toward later
  positions): prefer ids when editing lines. The node's own ID names the **whole
  sequence** (`{ from: encoder, to: seq }`; an [attached bracket](#brackets)
  gathers it): Sumi lays the cells out in a frame group with that ID (no border,
  fill or padding); tokens that nothing names as a whole get no frame.
  Whole-sequence edge endpoints use the cells' bounding rectangle, excluding
  attached annotations, even when a wide note enlarges the layout frame or
  `align: stretch` widens it (`fromAnchor: east` starts at the last cell).
- **Dividers.** `{ separator: dotted }` (optionally `id`, `tone`, `width`, `height`;
  no label, component or variant) draws a dotted line across the sequence (vertical
  for `right` / `left`, horizontal for `down` / `up`), reserving 6pt along the
  direction and inheriting the other size from the tokens (14pt if absent); `gap`
  applies on both sides. It counts as a cell for positions. An edge to one targets
  its invisible reserved rectangle, **not the dotted line**; PDF and PPTX keep the line.
- **Image cells.** `{ asset: photo, crop: [0, 0, 40, 40], variant: framed }`
  draws an entry of `figure.assets` as a picture cell: a column of patches is one
  node instead of nine `image` nodes and edges
  ([assets](assets.md#reusing-one-picture-figureassets)).
- Each cell is drawn as a node `<node>-<cell>` (`seq-x2`, `cluster-2`): diagnostics
  name it so; your IDs must avoid them (`ref/reserved-id`); an unknown cell is
  `ref/unknown-cell`. Place tokens in a tree, never with `attach`
  (`layout/attached-tokens`). Cells without a label are fine; a cell cannot be an
  `operator`, `junction`, `image`, `legend` or `tokens` (`component/invalid-prop`).

Cell numbering and line alignment in one figure (`cluster.1` is `a`, `cluster.4` is `d`):

```yaml
# expect-render: fits
version: 1
figure:
  id: cluster-lines
  theme: paper
  layout:
    arrange: { row: { gap: 10mm, align: center, items: [cluster, select] } }
nodes:
  - id: cluster
    component: tokens
    props:
      component: square
      width: 11pt
      height: 11pt
      gap: 1pt
      lineGap: 2pt
      lineAlign: center      # start | center | end | stretch: the short first line sits over the middle
      lines: [[a], [b, c, d]]
  - { id: select, component: box, label: Selection, tone: orange, variant: filled }
edges:
  - { from: cluster.4, to: select }   # d: lines count 1 (a), 2 (b), 3 (c), 4 (d)
```

## Matrices

A **`matrix`** node draws a grid of cells coloured by **class** (an attention
mask, allowed and blocked pairs) with optional row and column headers.

```yaml
# expect-render: fits
version: 1
figure:
  id: pair-mask
  theme: paper
  layout:
    arrange: { row: { gap: 5mm, align: center, items: [scores, mask, key] } }
nodes:
  - { id: scores, component: box, label: Scores, tone: blue, variant: filled }
  - id: mask
    component: matrix
    props:
      corner: i / j
      rows: [P, { label: '$x_1$', tone: purple }, { label: '$y_1$', tone: orange }]
      columns: [P, { label: '$x_1$', tone: purple }, { label: '$y_1$', tone: orange }]
      cellWidth: 12pt
      gap: 1.5pt
      variant: filled
      classes:
        o: { tone: green, label: Allowed }
        L: { tone: orange, label: "x–y pair" }
        .: { pattern: hatch, label: Masked }
      cells: [o.o, ooL, oLo]
  - id: key
    component: legend
    props:
      entries: [{ class: mask.o }, { class: mask.L }, { class: mask.. }]
edges:
  - { from: scores, to: mask }
```

- `classes` names each class (1–16 characters, e.g. `o`, `.`) with a `tone`, box `variant`,
  `pattern: hatch` (diagonal lines in the tone's line colour) and a legend `label`. `cells`
  lists rows top to bottom: class names in a list, or a string (names separated by spaces,
  or the characters themselves when every name is one character: `"o..L"`). `rows` /
  `columns` are headers (text, math allowed, or `{ label, tone }`); `corner` sits between
  them (needs both). Tuning: `cellWidth` (10pt), `cellHeight` (= width), `gap` (0),
  `headerGap`, `headerWidth`, `rowsAt: right`, `columnsAt: bottom`, `variant`. A legend
  entry `{ class: <matrix>.<class> }` draws a class's sample with its label.
- **Text and ellipsis cells.** A list-row cell may be `{ class, text }` (text, math allowed,
  in a cell keeping its class's look) or `{ ellipsis: "…" | "⋮" | "⋱" }`; `ellipsisRows:
  [4]` / `ellipsisColumns: [4]` (1-based) turn whole rows / columns into ellipsis slots
  (`⋮`, `…`, `⋱` at crossings) that keep the cell size and draw only the symbol. `flush:
  true` removes the frame's padding so other nodes' headers can touch the matrix (no
  `label`).
- The matrix is a borderless frame with its ID (its `label` is a title above it) around
  nodes `<matrix>-<row>-<column>` (1-based), `<matrix>-row-<r>`, `<matrix>-col-<c>`,
  `<matrix>-corner` (`ref/reserved-id`). Cells are not addressable: connect to the whole
  matrix; never `attach` it (`layout/attached-matrix`). Headers are as high / wide as a
  cell: text taller than `cellHeight + gap` collides (`geometry/label-collision`).
- Every row needs as many cells as the first, every name a class, and `rows` / `columns`
  must match the grid (`component/invalid-prop`). An unused class is
  `lint/unused-matrix-class`; a legend `class` naming none is `ref/unknown-class`.

Text and ellipsis cells (`{ class, text }`, `{ ellipsis }`, `ellipsisRows`, `ellipsisColumns`):

```yaml
# expect-render: fits
version: 1
figure:
  id: similarity
  theme: paper
  layout: { arrange: { row: { items: [sim] } } }
nodes:
  - id: sim
    component: matrix
    props:
      cellWidth: 30pt
      cellHeight: 18pt
      classes: { d: { tone: blue, variant: tinted }, o: {} }
      ellipsisRows: [3]
      ellipsisColumns: [3]
      cells:
        - [{ class: d, text: '$a_1\cdot b_1$' }, o, o, { class: o, text: '$a_1\cdot b_N$' }]
        - [o, { class: d, text: '$a_2\cdot b_2$' }, o, o]
        - [o, o, o, o]
        - [{ class: o, text: '$a_N\cdot b_1$' }, o, o, { ellipsis: "…" }]
```

## Spacing that routes

An arrow between two facing sides needs a gap longer than its arrowhead:
about **1.5mm in `academic` and `paper`, 2.5mm in `minimal` / `color`, 4mm in
`slides`**. 3mm (2mm in academic / paper) between connected blocks is a good
start, or no `gap` under `density: compact` (2.5mm); `gap: 0` only for blocks
that touch with no edge between them. Paths that turn (residuals) run in the
gap beside the blocks: if cramped, add `gap` to the enclosing row or put the
turning edge's target side (`toAnchor: west`) where there is room.

Geometry warnings after a structured render (`label-collision`,
`edge-crosses-label`) usually come from edge labels, crossing nets or a group
title in the way: move the title (`labelAt`), place the edge label (`labelAt` /
`labelSide`), reorder the edges (earlier = straighter), shorten the label, or
add `gap`. A complete block diagram: [example 4](examples.md#4-success-a-structured-block-diagram).
Per-code fixes for `layout/*`: [diagnostics](diagnostics.md#fixing-layout).
