# Reading and fixing diagnostics

`geometry/group-empty-area` (info, render / `lint --geometry` only): at
least 75% of a group's frame lies outside its title and direct children's
bounding boxes, with overlaps counted once and edges excluded. This is an
occupancy estimate, not empty pixels; nested groups occupy their whole
footprint and generated tokens/matrix/legend frames are skipped. Consider
`align: stretch` with inner `justify: stretch`, or `justify: space-between`
for fixed-size items; reduce gaps or avoid stretching a panel for tighter
title/caption spacing. Intentional whitespace needs no change; this does
not consume `maxWarnings`. The conservative threshold need not report
every panel worth improving.

## Weighted structured stretch

- `component/grow-unsupported`: `grow` is written on expanded `tokens`, `matrix`
  or `legend`; error at the original field. Remove it and weight ordinary nodes
  under their immediate row/stack's `justify: stretch` instead.

## Corner badges (0.7.0)

- `component/badge-unsupported`: the node expands into parts (`legend`,
  `tokens`, `matrix`), is a point junction or a `bracket`. Put the badge on an ordinary
  shape, outline or image instead.
- `geometry/badge-collision` (warning): change the corner or increase gaps /
  margin; the badge must avoid labels, other bodies/badges/edges and the
  canvas boundary. Its own body may overlap.
- Invalid badge icon names use `asset/unknown-icon` or
  `asset/unknown-icon-set` at `badge.icon`; search `sumi catalog --icons`.

Every stage reports problems as the same diagnostic object. In
`sumi lint --json` they are under `results[i].diagnostics`; in
`sumi render --json` under `diagnostics`:

```json
{
  "code": "component/unknown-variant",
  "severity": "error",
  "message": "Unknown variant \"bold\" for sumi/box.",
  "path": ["nodes", 1, "variant"],
  "location": { "file": "f.sumi.yaml", "line": 13, "column": 14 },
  "subject": { "kind": "node", "id": "b" },
  "hint": "Variants of sumi/box: default, emphasis, muted, filled, outlined, solid, tinted.",
  "related": [{ "message": "…", "location": { "line": 5, "column": 5 } }]
}
```

- `code` is `<stage>/<rule>` and stable — branch on it, not on `message`.
- `path` is the place in the YAML to change (`["edges", 0, "to"]` = the `to`
  of the first edge). `location` is the same place as line/column.
- `hint`, when present, lists the valid values or a near match (edit
  distance). Prefer it over your own guess.
- `summary` has `errors` / `warnings` / `infos`; exit code 1 means errors
  (or more warnings than `--max-warnings`). Infos (`lint/self-loop`,
  `layout/edge-crossing`) never fail a run: read them, fix what is easy,
  and report the rest.

## Working through a report

1. Fix all errors of the earliest stages first: `yaml` → `schema` → `ref` →
   `layout` → `component` → `asset` → `theme` → `profile` → `lint`. A broken element is skipped by
   later stages, so its other problems show up only after the first fix.
2. Fix every diagnostic you can in one edit, then run `fmt` and `lint` again.
3. If a diagnostic's fix would change the content or needs a user decision,
   stop and ask (see "When to stop and ask" in SKILL.md).

## By stage

| Codes | Meaning | Fix |
| --- | --- | --- |
| `yaml/syntax` | not valid YAML (often an unquoted `:` or `#` in a label, or bad indentation) | quote the value / fix indentation at `location` |
| `yaml/duplicate-key`, `yaml/alias-not-allowed`, `yaml/tag-not-allowed`, `yaml/multiple-documents`, `yaml/non-string-key` | YAML features Sumi does not accept | remove the duplicate / anchor / tag / extra document |
| `schema/unknown-field` | a key the schema does not have (`color`, `style`, `children`, …) | delete it; express it with a component, variant or `group:` |
| `schema/reserved-key` | a key named `__proto__` anywhere in the file (e.g. a matrix class); it would be dropped | rename it |
| `schema/missing-field` | a required field is missing (`version`, `figure.id`, node `component`, edge `from`/`to`) | add it |
| `schema/invalid-id` | ID does not match `^[a-z][a-z0-9_-]{0,63}$` | use the hint's lowercase form; update references to it |
| `schema/invalid-type`, `schema/invalid-value` | wrong type or value (e.g. number as label, unknown `direction`) | quote strings; use an allowed value |
| `schema/unsupported-version`, `schema/unsatisfied-requires` | `version` is not 1, or `requires` names a newer Sumi | use `version: 1`; drop `requires` or ask the user |
| `ref/unknown-endpoint` | edge `from`/`to` is not a node or group ID | use the ID from the hint, or add the missing element if the content calls for it |
| `ref/unknown-group` | `group:` names a group that does not exist | add the group under `groups:` or fix the ID |
| `ref/duplicate-id` | two nodes/groups (or two edges) share an ID | rename one; nodes and groups share an ID space |
| `ref/group-cycle` | groups contain each other | fix the `group:` chain |
| `ref/reserved-id` | an ID of yours is one Sumi generates: `<group>-caption` for a group's `caption`, `<legend>-<n>-label` / `-box` / `-line` / `-start` / `-end` for a legend's entries, `<tokens>-<cell>` for a cell of a `tokens` node, `<matrix>-<r>-<c>` / `-row-<r>` / `-col-<c>` / `-corner` for the parts of a `matrix` (`related` names which) | rename your element |
| `ref/unknown-cell` | `<node>.<cell>` names no cell: the node is not a `tokens` node, or has no cell with that `id` (cells without one are numbered from 1) | use the hint's cell, or the plain ID for an element that is not tokens ([tokens](structured.md#token-sequences)) |
| `ref/unknown-class` | a legend entry's `class` (`<matrix>.<class>`) names no matrix, or no class of it | use the hint's class, or the matrix's ID ([matrices](structured.md#matrices)) |
| `layout/structured-only` | `arrange`, `attach`, node `sublabel` / `labelRotation`, `fromAnchor` / `toAnchor`, edge `labelAt` / `labelSide`, `figure.layout.align` / `fanIn` / `density`, or a `legend`, `tokens`, `matrix` or `zoom` in an auto figure (no `figure.layout.arrange`, or `engine: auto`) | remove the field, or make the figure structured: root `figure.layout.arrange`, no `engine: auto`, every element placed |
| `layout/unplaced`, `layout/duplicate-placement`, `layout/unknown-item`, `layout/unknown-attach-target`, `layout/group-mismatch`, `layout/group-cycle`, `layout/attach-cycle`, `layout/invalid-anchor`, `layout/attached-legend`, `layout/attached-tokens`, `layout/attached-matrix` | structured figures: every node and group must be placed exactly once, in an arrange tree or by `attach` (a legend, tokens or matrix only in a tree) | per code in [structured](structured.md#fixing-layout); follow the hint |
| `layout/no-route` | `sumi render` of a structured figure: an edge cannot be routed (ends touching, closer than the arrowhead, or boxed in; the message and `related` name the nodes in the way, often an `attach`ed one), or a `zoom` edge's ends overlap (an element and its own group) | widen that `gap` (arrows need about 1.5mm in `academic`, 2.5mm in `minimal` / `color`, 4mm in `slides`), or anchor the edge on other sides ([structured](structured.md#spacing-that-routes)) |
| `layout/unknown-align-item`, `layout/duplicate-align-item`, `layout/invalid-align` | a `figure.layout.align` constraint names an unknown or edge ID, the same ID twice, or fewer than two IDs | fix the list ([align](structured.md#aligning-across-trees)); an entry with both or neither of `x` / `y` is `schema/invalid-value` |
| `layout/grid-span-overflow`, `layout/grid-item-count` | a grid item crosses its row boundary, or the last row is incomplete | reduce span or complete the row; use explicit `null` for a deliberate blank cell ([grids](structured.md#grids)) |
| `layout/auto-only` | a component whose catalog `engines` excludes structured is used in a structured figure (no built-in component does this today; `legend` is the reverse case, `layout/structured-only`) | use another component, or the auto layout if the user agrees |
| `component/unknown` | component name not in the registry | choose one from `sumi catalog` (the hint lists the right kind) |
| `component/wrong-kind` | a node component on an edge, etc. | use a component of the right kind |
| `component/unknown-variant` | variant not listed for that component | use one from the hint / catalog |
| `component/unknown-prop`, `component/invalid-prop` | prop not in the component's schema, or a bad value (e.g. `px`, not a multiple of 0.5pt; an `image` without `width` or `height`) | remove it, or use the value the hint suggests |
| `component/missing-label` | a text-only component (`label`) has no text | give it a label or use another component |
| `component/unexpected-label` | `operator`, `junction`, `image`, `bracket` or a `zoom` edge has a label (they draw a symbol, a dot, a picture, a line, two lines) | remove the label; put a `label` node next to it if text is needed (for `zoom`, title the zoomed-in group) |
| `component/invalid-math` | unsupported or malformed `$...$` label math in a structured figure (the message gives the label characters) | use the supported subset (Greek, `_`, `^`, symbols, accents over one character such as `\hat{y}`, `\mathrm`, `\text`), close the `$`, or write `\$` for a dollar sign; wide accents (`\widehat`, `\overline`) and `\hat{xy}` are not supported ([label math](figure-format.md#label-math)) |
| `component/unsupported-in-auto` (warning) | `$...$` label math with a command, `_` or `^` in an `auto` figure, which D2 draws as written (`$x$` is drawn as written too, without a warning) | use the structured layout (`figure.layout.arrange`) or drop the `$...$` |
| `component/label-at-without-label` (warning) | a group has `labelAt` but no (or an empty) `label` | add the title, or remove `labelAt` |
| `component/label-rotation-unsupported` | `labelRotation` on a node that draws an icon, `operator`, `junction`, `image`, `bracket` or a `legend` | remove `labelRotation`; put a turned `label` node next to it if needed |
| `component/label-rotation-without-label` (warning) | a node has `labelRotation` but no (or an empty) `label` | add the label, or remove `labelRotation` |
| `component/sublabel-unsupported` | `sublabel` on a node that draws an icon, `operator`, `junction`, `image`, `bracket` or a `legend` | remove `sublabel`; put a `label` node next to it if needed |
| `component/sublabel-without-label` | a node has `sublabel` but no (or an empty) `label` | add the label, or write the text as the `label` |
| `component/invalid-prop` on a legend entry | an entry with both or neither of `edge` / `node`, or a sample box that is a mark, text or picture (`operator`, `junction`, `label`, `image`, `legend`) | one of `edge` / `node` per entry; a shape such as `box` or `circle` for boxes |
| `component/tone-unsupported` | `tone` on a `junction` (drawn in the line color) | remove the tone |
| `component/anchor-on-junction` (warning) | `fromAnchor` / `toAnchor` on an edge end at a `junction`: every line meets the dot's center, so the anchor is ignored | remove the anchor; anchor the edge's other end, or move the junction (arrange tree, `attach`) |
| `component/anchor-on-zoom` (warning) | `fromAnchor` / `toAnchor` on a `zoom` edge, whose corners follow from where the target lies | remove the anchor; to join other corners, place the target on another side of the source |
| `component/deprecated` (warning) | still works but is being replaced | switch to the replacement in the message |
| `asset/*` | icons (`icon:`) and images (`component: image`): unknown icon, label next to an icon, a `src` that leaves the YAML's directory (lint); missing, unsupported, too large or unsafe files (render) | per code in [assets](assets.md#fixing-asset) |
| `theme/unknown` | `figure.theme` is not built in | `minimal`, `academic`, `slides`, `color` or `paper` (see hint) |
| `theme/missing-variant` (warning) | the theme has no style for that variant | usually ignore; choose another variant if it matters |
| `theme/missing-tone` (warning) | the theme has no color for that tone (built-in themes define every tone) | usually ignore; choose another tone if it matters |
| `theme/undimmed-image` (warning) | a `component: image` inside a group with `dim: true` is drawn at full color (dimming is by color, not opacity) | move the image out of the dimmed group, or use a paler image file |
| `theme/missing-dim` (warning) | the theme has no dim colors, so `dim: true` draws the group as it is (built-in themes define them) | usually ignore |
| other `theme/*` | a problem in a theme definition | not fixable in the figure — report it |
| `profile/unknown` | `figure.profile` is not built in | `paper-single`, `paper-double` or `presentation-16x9` (see hint) |
| `profile/font-too-small` | text is smaller than the profile's minimum (a `sublabel` is 7/8 of its node's size) | a user decision: another profile or theme. For `presentation-16x9` (14pt minimum) use theme `slides`; `minimal`, `academic`, `color` and `paper` fail it |
| `lint/*` | structural warnings — see `docs/lint-rules.md` | below |

### Structural lint (`lint/*`)

| Code | Default | Fix |
| --- | --- | --- |
| `lint/empty-figure` | warning | add nodes |
| `lint/no-edges` | warning | connect the nodes, or keep it if unconnected nodes are intended (say so) |
| `lint/ancestor-edge` | warning | connect elements that are both inside or both outside the group |
| `lint/self-loop` | info | remove if unintended |
| `lint/duplicate-edge` | warning | remove the duplicate or give it a different label |
| `lint/empty-label` | warning | add a label, or keep it for a deliberate blank shape |
| `lint/long-label` | warning | shorten or break with `\n` (≤ 40 columns per line, CJK = 2, ≤ 4 lines) |
| `lint/missing-glyph` | warning | replace the character (emoji and rare CJK are not in the font) |
| `lint/literal-newline` | warning | a label has `\n` as two characters outside `$...$` (single-quoted or plain YAML), drawn as written: double-quote it and double math backslashes, as the hint shows (`"Scale, Shift\n$\\gamma_1$"`), or use a `\|-` block ([math and line breaks](figure-format.md#math-and-line-breaks-in-one-label)) |
| `lint/unused-legend-entry` | warning | no edge / node has that legend entry's component, variant and tone: fix the entry, or the elements it should explain ([legends](structured.md#legends)) |
| `lint/unused-matrix-class` | warning | no cell of the matrix uses that class: remove it, or write it in the cells ([matrices](structured.md#matrices)) |

To silence a rule for one run: `sumi lint --rule lint/no-edges=off`. There
is no per-figure suppression; mention kept warnings in your report instead.

### Render (`sumi render`)

| Codes | Meaning | Fix |
| --- | --- | --- |
| `svg/empty-figure` | no nodes or groups to draw | add elements |
| `layout/unsatisfied-align` (warning) | structured: an `align` constraint could not be met after greedy search and bounded two-step lookahead; drawn with the closest placement, the message gives the distance | follow the hint: the items share a box (put them in different boxes, or wrap one in its own `stack` / `row`) or another constraint pulls them apart; centring can couple constraints without shared IDs, so if the fallback cannot align table headings, use `align: start` on the parent row ([align](structured.md#aligning-across-trees)) |
| `layout/align-search-limit` (warning) | structured: so many `align` constraints that the search stopped | remove constraints the boxes already satisfy, or split the figure |
| `layout/align-grew-figure` (info) | structured: the `align` struts made the figure wider / taller than without `align` (by more than 5mm and 10%); the message gives the sizes before and after | look at the render: if the added space is unwanted, align an item that can move alone (wrap it in its own `stack` / `row`), or drop the constraint ([align](structured.md#aligning-across-trees)) |
| `layout/edge-label-overlap` (warning) | structured: an edge label with `labelAt` / `labelSide` found no clear spot on its segment and side, so it overlaps what the message names | the other `labelSide`, another `labelAt`, remove both, or make room (`gap`, anchors, shorter label) |
| `layout/straight-off-side` (warning) | structured: an end written `straight` has no side facing the other end in line with its centre (the centre is past the side's corner margin of 3pt, the two are diagonal, or they overlap / one holds the other / a self-loop), so it was drawn as an end without an anchor; or it resolved but could not be put in line (parallel edges from a wide element into a narrow one keep separate points) | put the two in line (one above the other in a stack, side by side in a row; `align`), widen the box, write `straight` on the wide element's end instead, or write a side anchor (`"north:0.3"`) ([anchors](structured.md#edges-anchors-junctions-and-trunks)) |
| `layout/unaligned-ends` (warning) | structured: facing ends are within 1pt of alignment (or were before a split bowtie gap moved a port to a painted lip), but shared ports, anchors or side limits prevent straightening | align with the painted lip, remove the neighbour's anchor, or give one end an unshared point with room to move |
| `layout/edge-crossing` (info) | structured: two separate lines cross (at most 10 listed, then a summary; the shared hint is on the first only) | optional: move the edge to straighten earlier in `edges`, use anchors, or change the arrangement; keep unavoidable ones ([crossings](structured.md#crossings-layoutedge-crossing)) |
| `backend/d2-not-found`, `backend/d2-version-mismatch` | D2 missing or not v0.9.0 | user reinstalls the release tarball (D2 is bundled), runs `bun run d2:install` in a source checkout, or sets `SUMI_D2_PATH`; stop |
| `backend/d2-failed`, `backend/d2-timeout`, `backend/empty-output`, `backend/io-error`, `backend/invalid-args` | D2 itself failed | not a figure problem; report with the message (use `--emit-d2 out.d2` to keep the generated source; structured figures do not use D2 and refuse `--emit-d2` with exit 2) |
| `svg/outline-edge-miss` (warning) | an edge end could not be extended to its custom outline; that end is kept unchanged | inspect the gap and report the diagnostic; do not invent port coordinates |
| `svg/outline-edge-crossing` (warning) | extended edge segments intersect near the same custom node | inspect the node named in the message and both edges (`related`); try another direction or grouping if appropriate |
| `svg/outline-radius-ignored` (warning) | polygon outlines cannot apply the theme's rounded corners | report the limitation; changing the theme is a user decision |
| other `svg/*` (`svg/invalid`, `svg/missing-element`, `svg/missing-font-face`, …) | the SVG did not pass Sumi's own checks | a Sumi bug, not a figure problem; report it |
| `pdf/input-too-large`, `pdf/missing-font`, `pdf/unresolved-font`, `pdf/engine-unavailable`, `pdf/conversion-failed` | the PDF conversion (`-o x.pdf` / `--format pdf`) failed; no PDF is written | not a figure problem: `sumi doctor` for the fonts; otherwise report it with the message (the SVG renders without `--format pdf`) |
| `pptx/unsupported-size` | a slide side exceeds 56 inches, the SVG lacks valid pt dimensions, or (editable mode) `figure.fit: scale` shrinks text below 1pt | use a smaller profile only if the user agrees; report invalid finalized SVG dimensions as a bug; text below 1pt: use the picture PPTX or shrink less |
| `pptx/experimental-editable` (warning), `pptx/glued-routing` (warning) | explicit experimental editable export; glued routes become straight and labels stay fixed | report the boundaries; keep picture PPTX unless editable objects were requested |
| `pptx/unsupported-asset` | the editable PPTX cannot carry icons or images; nothing is written | use the default picture PPTX (drop `--pptx-mode editable`), or ask whether the icons/images may go |
| `pptx/unsupported-geometry` | the editable exporter cannot represent this SVG/arrowhead or glued self-loop | use the default freeform route mode for self-loops, or picture PPTX; report unexpected Sumi SVG structures |
| `pptx/input-too-large`, `pptx/missing-font`, `pptx/unresolved-font`, `pptx/engine-unavailable`, `pptx/conversion-failed` | picture PPTX conversion failed; no PPTX is written | `sumi doctor` for fonts; otherwise report the message; inspect the SVG separately |

### Geometry lint (`geometry/*`)

Reported by `sumi render` (unless `--no-geometry`) and `sumi lint
--geometry`, after rendering. Labels are re-measured with the theme's font,
so the checks match what is drawn. The SVG is still written; errors make the
exit code 1. Configure like structural rules
(`--rule geometry/node-overlap=off`). Details: `docs/lint-rules.md`.

| Code | Default | Fix |
| --- | --- | --- |
| `geometry/exceeds-page-width` | error | shorter labels; auto: `direction: down`, fewer nodes side by side; structured: re-arrange the trees (a long row as two rows), smaller `gap`s; too wide and too tall: [two rows](layout-tips.md#too-wide-with-right-too-tall-with-down); a wider profile only if the user agrees and the figure is not already on `paper-double` |
| `geometry/exceeds-page-height` | error | paper profiles 220mm, `presentation-16x9` 190.5mm (no profile allows more than 220mm): auto: `direction: right`, fewer layers; structured: re-arrange the trees (a long stack as a row of stacks), smaller `gap`s; or split the figure |
| `geometry/text-too-small` | error | as `profile/font-too-small` (a safety net after rendering); with `figure.fit: scale`, a label printed below 5pt (paper profiles) after shrinking — a 7pt `sublabel` already does at 71% (the message names the sublabel): make the figure narrower so it shrinks less, or write the text into the label |
| `geometry/script-too-small` | info | with `figure.fit: scale`, subscripts / superscripts of label math print below 5pt after shrinking; one finding per figure; information only (scripts are exempt from the minimum) |
| `geometry/label-overflow` | error | remove or enlarge explicit `width`/`height` (the `path` points at `props` then), shorten or break the label, or use a shape with more room for text (`box`) |
| `geometry/out-of-canvas` | error | shorten labels; if it persists, report it as a Sumi bug |
| `geometry/node-overlap` | warning | review explicit sizes; auto: put the nodes in the same group; structured: an attached node in a `gap` overlaps its neighbour, put it in the tree, attach it to a free side, or widen the `gap` ([attach](structured.md#attach-side-notes)) |
| `geometry/label-collision` | warning | a label overlaps another label, a node's shape or a group's border: shorten labels; move a group title with `labelAt`; auto: change `direction` or grouping; structured: place the edge label (`labelAt` / `labelSide`), change the `gap`, anchors or attach side (an edge label on a group's border: widen the `gap` before the group so the label fits outside it) |
| `geometry/edge-crosses-label` | warning | auto: connect elements inside the group rather than the group, change `direction`, shorten the label (see layout-tips); both: move the group's title away from the entering edge with `labelAt` (structured default: top centre; auto: top-left) ([group titles](structured.md#group-titles-and-captions)); structured: or enter from the side with an anchor |
| `geometry/edge-through-node` | warning | an edge is drawn across a node it does not connect: change `layout.direction` or the grouping so the layout has a free path |
| `geometry/arrowhead-on-bend` | warning | the straight run from an arrowhead's tip to the preceding painted bend is shorter than the head (more than 0.5pt short). Includes the part under the head; checks source and target independently. Structured: head length = 4 + 4 × stroke width in 0.5pt units; D2: triangle markers only, accounting for their tip offset. Move `fromAnchor` / `toAnchor`, widen the gap, or rearrange the nodes to leave a straight approach |
| `geometry/arrowhead-cramped` | info | a structured arrowhead has less than **2pt of visible straight stem before a painted bend**, after rounding and `fit: scale` (0.002-unit print tolerance). Source and target are independent; excludes straight edges, invisible edges, legend samples, and overlaps already reported by `geometry/arrowhead-on-bend`. Tight group padding grows automatically; for other approaches widen the gap, change anchors, or reduce fit scaling. D2 is outside this rule's initial scope. Promote with `{"rules":{"geometry/arrowhead-cramped":"warning"}}` if needed |
| `geometry/edge-jog` | info | a painted edge has a straight segment shorter than **1pt at printed size** between two right-angle bends (a micro S-jog or step; 0.002-unit SVG quantization tolerance). Joins touching subpaths of that edge and merges collinear points; excludes curve chords, end stubs, gaps, branches and invisible edges. Includes `fit: scale`. Defaults to info in this patch release so existing fixed-port/shared-trunk steps do not break `--max-warnings 0`. Promote with rule configuration `{"rules":{"geometry/edge-jog":"warning"}}` if desired. Align `fromAnchor` / `toAnchor`, widen the gap, or rearrange nodes to remove the tiny step |
| `geometry/zoom-crosses-node` | warning | a straight line of a `zoom` edge crosses a node (zoom lines are never bent around nodes): move that node, or move the source or the zoomed-in view (item order, `gap`) so the lines pass beside it |
| `geometry/edge-on-border` | warning | an edge is drawn on a group's border (strokes touch for 3mm or more): structured: move its ends with `fromAnchor` / `toAnchor`, reorder the arrange items or change a `gap` so it does not pass along the group; auto: change `direction` or grouping |
| `geometry/edge-near-border` | info | as `edge-on-border`, for an edge less than 1.5pt beside the border; often the router's turn just outside a group (no anchor fixes it): look at the figure and leave it if it reads clearly |
| `geometry/edge-near-edge` | warning | two edges run less than 1.5pt apart for 3mm or more (a trunk they share exactly is fine): give one another anchor, merge them into one trunk (same anchor, or `figure.layout.fanIn: merge`), or change the arrangement |
| `geometry/edge-touches-label` | info | an edge passes less than 1.5pt from the letters of a group title, caption or `label` node: as `edge-crosses-label` (move the title with `labelAt`, or the edge's ends) |
| `geometry/aspect-distorted` | warning | fewer edges on that `circle`/`square`, or use `ellipse`/`box` |
| `geometry/reversed-edge` | warning | ELK reversed the wrong edge of a cycle (typically a loop inside a group): swap the order of the loop's nodes in `nodes`, or move the loop out of the group |

For custom outline components, `geometry/label-overflow` checks the renderer's
safe label rectangle and, only when the outline is stroked, overlap with boundary
segments (including the inner edges of a split bowtie). Filled-only split bowties
may overlay text across both bodies and the gap; shape collisions use its convex collision region
(or the outline's convex hull). A label may fit the layout rectangle and still
overflow its safe area. Automatically generated dimensions do not count as
explicit `props`: those findings point at `label`. Partial or fully explicit
dimensions point at `props`. Concave silhouettes use a conservative convex
hull for collisions, so a warning in a small empty step may be intentional.
