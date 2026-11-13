# Reading and fixing diagnostics

**Purpose.** Every stage reports problems as the same diagnostic object; fix
what `lint` / `render` report and run them again. Contents:
[the object](#the-diagnostic-object) · [working through a report](#working-through-a-report) ·
[by stage](#by-stage) · [fixing `layout/*`](#fixing-layout) ·
[structural lint](#structural-lint-lint) · [render](#render-sumi-render) ·
[geometry lint](#geometry-lint-geometry) ·
[too wide: the width breakdown](#too-wide-the-width-breakdown) ·
[asset codes](assets.md#fixing-asset)

## The diagnostic object

In `sumi lint --json` diagnostics are under `results[i].diagnostics`; in
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

- `code` is `<stage>/<rule>` and stable: branch on it, not on `message`.
- `path` is the place in the YAML to change (`["edges", 0, "to"]` = the `to` of
  the first edge); `location` is the same as line/column.
- `hint`, when present, lists valid values or a near match (edit distance), or a
  **verified** remedy (below). Prefer it over your own guess.
- `summary` has `errors` / `warnings` / `infos`; exit code 1 means errors (or
  more warnings than `--max-warnings`). Infos (`lint/self-loop`,
  `layout/edge-crossing`) never fail a run: read them, fix what is easy, report the rest.

## Working through a report

1. Fix all errors of the earliest stages first: `yaml` → `schema` → `ref` →
   `layout` → `component` → `asset` → `theme` → `profile` → `lint`. A broken
   element is skipped by later stages, so its other problems show up only after
   the first fix.
2. Fix every diagnostic you can in one edit, then run `fmt` and `lint` again.
3. If a fix would change the content or needs a user decision, stop and ask
   (SKILL.md, "When to stop and ask").

**Verified hints.** Several structured hints (grid span and cell alignment,
`layout/straight-off-side`, `geometry/exceeds-page-width`) recommend an edit
only after applying it to an in-memory copy and re-running layout and routing
(at most six trials per diagnostic; bounded by element and arrange-tree size).
Width/scaling and empty-area trials support inline SVGs (`props.svg` and
`figure.assets`) and bundled icons. They skip external asset files and HTML;
the hint states the reason. A hint without a verified edit is neutral wording.
Apply one edit and re-check: independent savings are not additive.

## By stage

| Codes | Meaning | Fix |
| --- | --- | --- |
| `yaml/syntax` | not valid YAML (often an unquoted `:` or `#` in a label, bad indentation) | quote the value / fix indentation at `location` |
| `yaml/duplicate-key`, `yaml/alias-not-allowed`, `yaml/tag-not-allowed`, `yaml/multiple-documents`, `yaml/non-string-key` | YAML features Sumi does not accept | remove the duplicate / anchor / tag / extra document |
| `schema/unknown-field` | a key the schema does not have (`color`, `style`, `children`, …); also a field newer than the CLI ([feature versions](figure-format.md#feature-versions)) | delete it; express it with a component, variant or `group:` |
| `schema/reserved-key` | a key named `__proto__` (e.g. a matrix class); it would be dropped | rename it |
| `schema/missing-field` | a required field is missing (`version`, `figure.id`, node `component`, edge `from`/`to`) | add it |
| `schema/invalid-id` | ID does not match `^[a-z][a-z0-9_-]{0,63}$` | use the hint's lowercase form; update references |
| `schema/invalid-type`, `schema/invalid-value` | wrong type or value (number as label, unknown `direction`) | quote strings; use an allowed value |
| `schema/unsupported-version`, `schema/unsatisfied-requires` | `version` is not 1, or `requires` names a newer Sumi | use `version: 1`; drop `requires` or ask the user |
| `ref/unknown-endpoint` | edge `from`/`to` is not a node or group ID | use the hint's ID, or add the missing element if the content calls for it |
| `ref/unknown-group` | `group:` names no group | add it under `groups:` or fix the ID |
| `ref/duplicate-id` | two nodes/groups (or two edges) share an ID | rename one (nodes and groups share an ID space) |
| `ref/set-angle-needs-ellipse` | a set has `angle` but its shape is not `ellipse` | use `shape: ellipse` (`angle: auto` fits the tilt to the members), or remove `angle` ([sets](structured.md#set-enclosures)) |
| `ref/unknown-set-member`, `ref/duplicate-set-member` | a `sets[].members` entry is not a node or group ID, or is listed twice | use the hint's ID; list each member once ([sets](structured.md#set-enclosures)) |
| `ref/group-cycle` | groups contain each other | fix the `group:` chain |
| `ref/reserved-id` | an ID of yours is one Sumi generates: `<group>-caption`, `<legend>-<n>-label` / `-heading` / `-box` / `-line` / `-start` / `-end` / `-set` (a set ID), `<tokens>-<cell>`, `<matrix>-<r>-<c>` / `-row-<r>` / `-col-<c>` / `-corner` | rename your element |
| `ref/unknown-cell` | `<node>.<cell>` names no cell: not a `tokens` node, or no cell with that `id` (unnamed cells count from 1, across `lines`) | use the hint's cell ([tokens](structured.md#token-sequences)) |
| `ref/unknown-class` | a legend entry's `class` (`<matrix>.<class>`) names no matrix or class | use the hint's class ([matrices](structured.md#matrices)) |
| `layout/structured-only` | a structured-only field or component in an auto figure ([engine rules](structured.md#engine-rules)) | remove it, or make the figure structured: root `figure.layout.arrange`, no `engine: auto`, every element placed |
| `layout/set-overlap-budget` | more than 1024 overlap regions; deeper intersections may omit colors | reduce the overlapping sets or split the figure ([sets](structured.md#set-enclosures)) |
| other `layout/*` (structure) | placement errors | [below](#fixing-layout) |
| `layout/auto-only` | a component whose catalog `engines` excludes structured is used in a structured figure (no built-in does) | use another component |
| `component/unknown` | name not in the registry (or a component newer than the CLI) | choose from `sumi catalog` (the hint lists the right kind) |
| `component/wrong-kind` | a node component on an edge, etc. | a component of the right kind |
| `component/unknown-variant` | variant not listed for that component | one from the hint / catalog |
| `component/unknown-prop`, `component/invalid-prop` | prop not in the schema, or a bad value (e.g. `px`, a bare number; an `image` without `width` or `height`) | remove it or use the hint's value |
| `component/missing-label` | a text-only component (`label`) has no text | give it a label |
| `component/unexpected-label` | `operator`, `junction`, `image`, `bracket`, `separator`, a flow arrow or a `zoom` edge has a label | remove it; put a `label` node next to it (for `zoom`, title the zoomed-in group) |
| `component/invalid-math` | unsupported or malformed `$...$` (the message gives the characters) | use the supported subset, close the `$`, or write `\$` ([label math](figure-format.md#label-math)) |
| `component/unsupported-in-auto` (warning) | label math with a command, `_` or `^` in an auto figure, drawn as written | use the structured layout or drop the `$...$` |
| `component/label-at-without-label`, `component/label-rotation-without-label`, `component/sublabel-without-label` | `labelAt` / `labelRotation` / `sublabel` without a (non-empty) label (the sublabel one is an error) | add the label, or remove the field |
| `component/label-rotation-unsupported`, `component/sublabel-unsupported` | on an icon, `operator`, `junction`, `image`, `bracket` or `legend` node | remove it; put a `label` node next to it |
| `component/invalid-prop` on a legend entry | both or neither of `edge` / `node` / `class` / `icon` / `glyph` / `set`, `perRow` or `headings` without `flow: row`, or a sample box that is a mark, text or picture | one sample per entry; a shape such as `box` |
| `component/tone-unsupported` | `tone` on a `junction` | remove it |
| `component/anchor-on-junction`, `component/anchor-on-zoom` (warnings) | an anchor on an end at a `junction` (every line meets the dot's centre) or on a `zoom` edge (corners follow the target's place) | remove the anchor; anchor the other end or move the junction / target |
| `component/grow-unsupported` | `grow` on expanded `tokens`, `matrix`, `legend`, `separator` or a flow arrow | remove it; weight ordinary nodes under their row/stack's `justify: stretch` |
| `component/separator-placement` | a `separator` with `attach` or directly in a grid cell | put it directly in a row or stack |
| `component/separator-connection` | a `separator` as an edge endpoint | connect the panels' real nodes |
| `component/flow-arrow-connection` | a `block-arrow`, `triangle-arrow` or `chevron` as an edge endpoint | connect the nodes on either side; the arrow is only a marker in the row |
| `component/badge-unsupported` | a badge on a `legend`, `tokens`, `matrix`, point junction or `bracket` | put it on an ordinary shape, outline or image |
| `component/glyph-unsupported` | `glyphs` on a `legend`, `tokens`, `matrix`, point junction or `bracket` | put them on an ordinary shape, outline or image |
| `component/deprecated` (warning) | still works but is being replaced | switch to the replacement named |
| `asset/*` | icons, images, figure assets, HTML | [assets](assets.md#fixing-asset), [html](html.md#diagnostics) |
| `theme/unknown` | `figure.theme` is not built in | `minimal`, `academic`, `slides`, `color`, `paper`, `llama`, `sumi` or `sumi-dark` |
| `theme/missing-variant`, `theme/missing-tone`, `theme/missing-dim` (warnings) | the theme lacks a style (built-ins define all) | usually ignore |
| `theme/low-contrast` (warning) | an overridden tone's text (`themeOverrides.tones.<tone>.text`, else `line`) has under 4.5:1 on its fill (tinted) or on white (outlined, edge labels, icon-only labels, `\textcolor`) | darker `text`, paler `fill`, or omit `text` for tinted-only tones |
| `theme/undimmed-image` (warning) | an `image` in a `dim: true` group is drawn at full colour (dimming is by colour, not opacity) | move it out, or use a paler file |
| other `theme/*` | a problem in a theme definition | not fixable in the figure: report it |
| `profile/unknown` | `figure.profile` is not built in | `paper-single`, `paper-double` or `presentation-16x9` |
| `profile/font-too-small` | text below the profile's minimum (a `sublabel` is 7/8 of its node's size) | a user decision: another profile or theme. `presentation-16x9` (14pt) needs theme `slides`; `minimal`, `academic`, `color`, `paper` fail it |
| `lint/*` | structural warnings (`docs/lint-rules.md`) | [below](#structural-lint-lint) |

## Fixing `layout/*`

| Code | Fix |
| --- | --- |
| `layout/unplaced` | add the ID to the tree named in the hint (root tree or its group's `arrange`), or `attach` it |
| `layout/duplicate-placement` | the element is in two trees, or in a tree and attached: keep one |
| `layout/unknown-item` | an `items` entry is not a node or group ID (edges are never placed): use the hint's ID |
| `layout/unknown-attach-target` | `attach.to` names no node or group |
| `layout/invalid-center-on` | stack/row `centerOn` must name a direct item, with `justify` omitted or `center`; use the whole tokens node ID, not a cell |
| `layout/group-mismatch` | `group:` disagrees with the tree: delete `group:` or move the ID into that group's `arrange` |
| `layout/group-cycle`, `layout/attach-cycle` | a group placed inside itself, or attachments in a loop |
| `layout/invalid-anchor` | `north`, `east`, `south`, `west`, optionally `:` and 0..1; or `straight` (no side) |
| `layout/no-route` with `route: straight` | separate overlapping ends, choose anchors meeting their outlines and facing outwards, increase the gap for arrowheads, or omit `route` (also on zoom callouts); obstacle and label overlaps are geometry warnings |
| `layout/attached-legend`, `layout/attached-tokens`, `layout/attached-matrix` | these cannot be attached: list them in an arrange tree |
| `layout/grid-span-overflow`, `layout/grid-item-count` | a grid item crosses its row boundary / the last row is incomplete: reduce the span or complete the row; `null` for a deliberate blank ([grids](structured.md#grids)) |
| `layout/place-overlap` (render, warning) | natural footprints overlap at the reported centers; separate the coordinates or increase `place.unit`. Touching is allowed; placement never moves items automatically ([coordinates](structured.md#coordinate-placement)) |
| `layout/chat-unknown-speaker`, `layout/chat-unknown-avatar` | use a name in `chat.speakers` / an existing avatar node ID ([chat](structured.md#chat-conversations)) |
| `layout/chat-non-bubble` | message `node` must reference a `bubble` node |
| `layout/chat-overflow` (render, warning) | widen `chat.width`, lower `maxWidth` or shorten the meta note; visuals retain their authored sizes |
| `layout/no-route` (render) | the ends touch (`gap: 0`), are closer than the arrowhead, or are boxed in (the message and `related` name the node, often an `attach`ed one); on a `zoom` edge the ends overlap | widen that `gap` (arrows need about 1.5mm in `academic` / `paper`, 2.5mm in `minimal` / `color`, 4mm in `slides`; even a `line` needs > 0), anchor other sides ([spacing](structured.md#spacing-that-routes)); for `zoom` put the view beside, above or below the source |
| `layout/unknown-align-item`, `layout/duplicate-align-item`, `layout/invalid-align` | an `align` entry names no node or group (edges cannot be aligned), names one twice, or has fewer than two IDs; an entry with both or neither of `x` / `y` is `schema/invalid-value` ([align](structured.md#aligning-across-trees)) |
| `layout/unsatisfied-align` (render, warning) | the constraint could not be met; drawn closest, the message gives the distance | follow the hint: items share a box (use different boxes or wrap one in its own `stack` / `row`) or another constraint pulls them apart; for table headings `align: start` on the parent row |
| `layout/align-search-limit` (render, warning) | too many constraints: remove ones the boxes already satisfy, or split the figure |
| `layout/align-splits-tokens` (render, warning) | `align` named a cell of a one-line `tokens` row and added space between its cells | align the whole sequence (`at: start` / `end`) or give both rows the same cell width and `gap` |
| `layout/center-on-void` (render, info) | `centerOn` reserved more than 5mm (and a quarter of the box) of empty room on its short side | keep it if intended; else drop `centerOn` and use `align`, or move inputs to the empty side |
| `layout/align-grew-figure` (render, info) | `align` struts made the figure much larger (more than 5mm and 10%); keep if intended (`figure.layout.alignGrowth: allow` silences it), else align an item that can move alone, or drop the constraint |
| `layout/edge-label-overlap` (render, warning) | an edge label with `labelAt` / `labelSide` has no clear spot: the other `labelSide`, another `labelAt`, neither, or make room (`gap`, anchors, shorter label) |
| `layout/group-title-offset` (render, info) | aligned group frames have offset contents because of title space: align the connected nodes with `figure.layout.align: [{y: [source, target]}]`, or use a caption/untitled frame |
| `layout/straight-off-side` (render, warning) | a `straight` end has no side facing the other end in line with its centre (past the 3pt corner margin, diagonal, overlapping, or parallel edges from a wide element into a narrow one) | line them up in the tree (`align`), widen the box, put `straight` on the wide end, or write a side anchor; verified recommendations: [grids](structured.md#grids) |
| `layout/unaligned-ends` (render, warning) | facing ends are within 1pt of alignment but shared ports, anchors or side limits prevent straightening | align with the painted lip, remove the neighbour's anchor, or give one end an unshared point with room |
| `layout/edge-crossing` (render, info) | two lines cross (at most 10 listed): optional; move the edge earlier in `edges`, use anchors, rearrange; keep unavoidable ones ([crossings](structured.md#crossings-layoutedge-crossing)) |

## Structural lint (`lint/*`)

| Code | Default | Fix |
| --- | --- | --- |
| `lint/empty-figure` | warning | add nodes |
| `lint/no-edges` | warning | connect the nodes, or keep it if unconnected nodes are intended (say so); chat visuals do not require edges; nodes in a set's `members` (or in a member group) are not counted |
| `lint/ancestor-edge` | warning | connect elements both inside or both outside the group |
| `lint/self-loop` | info | remove if unintended |
| `lint/duplicate-edge` | warning | remove it or give it a different label |
| `lint/empty-label` | warning | add a label, or keep it for a deliberate blank shape |
| `lint/long-label` | warning | shorten or break with `\n` (≤ 40 columns per line, CJK = 2, ≤ 4 lines) |
| `lint/missing-glyph` | warning | replace the character (emoji and rare CJK are not in the font); for HTML choose covering bundled families (Geist fallback does not count) |
| `lint/literal-newline` | warning | `\n` as two characters outside `$...$` (single-quoted or plain YAML): double-quote it and double math backslashes (`"Scale, Shift\n$\\gamma_1$"`), or a `\|-` block ([math and line breaks](figure-format.md#math-and-line-breaks-in-one-label)) |
| `lint/unused-legend-entry` | warning | no edge / node has the entry's component, variant and tone, no node draws its `icon` or has its `glyph`, or no set has its swatch's variant and tone: fix the entry or the elements ([legends](structured.md#legends)) |
| `lint/icon-enclosure` | info | a plain `circle` / `box` holds only an `icon` (no tone, variant, size, badge or glyphs): use `component: label` with `icon` and `iconSize`; give the frame a tone or variant if its shape means something |
| `lint/unused-matrix-class` | warning | no cell uses the class: remove it or use it ([matrices](structured.md#matrices)) |

`sumi lint --rule lint/no-edges=off` silences a rule for one run. There is no
per-figure suppression: mention kept warnings in your report.

## Render (`sumi render`)

| Codes | Meaning | Fix |
| --- | --- | --- |
| `svg/empty-figure` | no nodes or groups to draw | add elements |
| `backend/d2-not-found`, `backend/d2-version-mismatch` | D2 missing or not v0.9.0 | user reinstalls the release tarball (D2 bundled), runs `bun run d2:install` in a checkout, or sets `SUMI_D2_PATH`; stop |
| `backend/d2-failed`, `backend/d2-timeout`, `backend/empty-output`, `backend/io-error`, `backend/invalid-args` | D2 itself failed | not a figure problem; report the message (`--emit-d2 out.d2` keeps the source; structured figures refuse it with exit 2) |
| `svg/outline-edge-miss` (warning) | an edge end could not be extended to its custom outline; kept unchanged | inspect the gap and report; do not invent port coordinates |
| `svg/outline-edge-crossing` (warning) | extended edge segments intersect near a custom node | inspect the node and both edges (`related`); another direction or grouping |
| `svg/outline-radius-ignored` (warning) | polygon outlines cannot apply rounded corners | report; changing the theme is a user decision |
| other `svg/*` (`svg/invalid`, `svg/missing-element`, `svg/missing-font-face`, …) | the SVG failed Sumi's own checks | a Sumi bug: report it |
| `pdf/*` (`input-too-large`, `missing-font`, `unresolved-font`, `engine-unavailable`, `conversion-failed`), `pptx/*` conversion codes (same names) | PDF / picture PPTX conversion failed; nothing written | `sumi doctor` for fonts; else report the message (the SVG still renders) |
| `pptx/unsupported-size` | a slide side over 56 inches, an SVG without valid pt dimensions, or (editable) `fit: scale` shrinking text below 1pt | a smaller profile only if the user agrees; for tiny text use picture PPTX or shrink less; invalid SVG dimensions are a bug |
| `pptx/experimental-editable`, `pptx/glued-routing` (warnings) | explicit experimental editable export; glued routes become straight, labels fixed | report the boundaries; keep picture PPTX unless editable was requested |
| `pptx/unsupported-asset`, `pptx/unsupported-geometry` | editable PPTX cannot carry icons, images, HTML, or this SVG/arrowhead/glued self-loop; nothing written | default picture PPTX (freeform mode for self-loops); report unexpected structures |

## Geometry lint (`geometry/*`)

Reported by `sumi render` (unless `--no-geometry`) and `sumi lint --geometry`
after rendering, with labels re-measured in the theme's font. The SVG is still
written; errors make the exit code 1. Configure like structural rules
(`--rule geometry/node-overlap=off`); details `docs/lint-rules.md`.

| Code | Default | Fix |
| --- | --- | --- |
| `geometry/exceeds-page-width` | error | see [too wide](#too-wide-the-width-breakdown); a wider profile only if the user agrees and the figure is not already on `paper-double` |
| `geometry/exceeds-page-height` | error | paper profiles 220mm, `presentation-16x9` 190.5mm: candidates: auto `direction: right`, fewer layers; structured a long stack as a row of stacks, smaller `gap`s; split the figure (ask) ([options](layout-tips.md#when-width-runs-short)) |
| `geometry/text-too-small` | error | as `profile/font-too-small` (safety net); under `figure.fit: scale` a label printed below 5pt (or `figure.target.minFontSize`; a 7pt `sublabel` does at 71%): make the figure narrower so it shrinks less, or write the text into the label. HTML: font-size × placed/viewport scale × page-fit scale |
| `geometry/script-too-small` | info | with `fit: scale`, math scripts print below the scaled profile minimum (paper: 5pt); one finding per figure; scripts remain exempt from errors; not used when `target.minFontSize` is set |
| `geometry/script-below-target` | warning | with `figure.target.minFontSize`, a math script (0.7 × base) prints below it at the final size, scaled or not; one finding per label, positioned; raise the base text to min ÷ 0.7 or avoid scripts |
| `geometry/heavy-scaling` | info | scaled final text (including scripts/HTML) is at most 120% of the effective minimum; reports final size, minimum, headroom, scale and natural-width attribution; compare readable text and reserved area |
| `geometry/exceeds-target-height` | warning | printed height exceeds `figure.target.height`; reports budget, actual height and vertical placement attribution; change arrangement or the budget, not automatic height scaling |
| `geometry/placement-usage` | info | an explicit target reports reserved profile width × printed height, width utilization and optional height-budget use: compare these across candidates at the same placement ([fit the placement](layout-tips.md#fit-the-placement)); no single value is good or bad |
| `geometry/line-too-thin` | warning | final diagram border/wire width is below `figure.target.minLineWidth`; use thicker theme strokes or less scaling; imported image/icon/HTML strokes are excluded |
| `geometry/dead-space` | info | up to three empty rectangles, each ≥27% of canvas and ≥10mm on both sides at printed size, with position and mm; outside group/body/label/arrow footprints, excluding outer margins; review unexplained voids, keep intentional space |
| `geometry/color-harmony` | info | the figure's colours clash (OKLCH): more than seven hue families; pastel and saturated fills mixed (chroma ratio ≥3 with a fill ≥0.10) or fill lightness spread >0.30; with a palette, ≥2 colours outside its band (a fill off the tint's lightness by >0.10, or any colour >1.4× as vivid as the palette's tones), usually explicit `themeOverrides.tones`. Not counted in `maxWarnings`. Drop the explicit tone colours (the palette derives its own), or use fewer hues and colours of similar lightness and chroma |
| `geometry/muddy-color` | warning | a chromatic fill's final colour loses chroma, darkens into gray, or drifts in hue compared with white; also detects khaki, olive and tan fills and strokes (not text). Mixed set overlaps are judged against their own paint, including translucent layers above. Use a lighter, warmer yellow or a clearer peach, or paint translucent fills on white and avoid overlapping them |
| `geometry/translucent-over-color` | warning | a fill with opacity below 1 over a surface that is not white (a panel, another fill); its colour then depends on what lies beneath: opaque pale colour on a white panel instead |
| `geometry/low-stroke-contrast` | info / warning | an edge (info under 3:1, warning under 1.5:1) or an outline-only node's frame (info under 2:1) barely stands out from the colour painted behind it. Darken the line or its tone, or lighten the panel; group frames, operators, junctions, zoom lines and dimmed elements are not checked |
| `geometry/color-on-panel` | info | a group filled with a non-white colour holds three or more coloured nodes or sets (own chroma ≥0.025): the colours compete with the panel's. Keep the panel white with a thin frame (`paper`'s default), colour only what carries meaning. Not counted in `maxWarnings` |
| `geometry/label-overflow` | error | remove or enlarge explicit `width`/`height` (`path` points at `props`), shorten or break the label, or use a roomier shape (`box`); when scaled, sizes include printed and pre-scale (YAML-unit) values, including rotated label bounds |
| `geometry/out-of-canvas` | error | shorten labels; if it persists, a Sumi bug |
| `geometry/node-overlap` | warning | review explicit sizes; auto: same group; structured: an attached node in a `gap` overlaps its neighbour: put it in the tree, attach to a free side, or widen the `gap` ([attach](structured.md#attach-side-notes)) |
| `geometry/label-collision` | warning | a label overlaps another label, a shape or a group border, or an `attach`ed label touches another text ("touches", gap < 1pt): shorten; move a group title with `labelAt`; auto: change `direction` or grouping; structured: place the edge label, change `gap`, anchors or attach side |
| `geometry/edge-crosses-label` | warning | auto: connect elements inside the group rather than the group, change `direction`, shorten the label; both: move the group's title away from the entering edge with `labelAt` ([titles](structured.md#group-titles-and-captions)); structured: or enter from the side with an anchor |
| `geometry/edge-through-node` | warning | an edge crosses a node it does not connect (a `route: straight` line also when it only brushes the outline): change `direction` or grouping, or use side anchors |
| `geometry/arrowhead-on-bend` | warning | the straight run from a tip to the preceding bend is shorter than the head (structured head = 4 + 4 × stroke width in 0.5pt units; D2 triangle and open markers only): move the anchor, widen the gap, or rearrange |
| `geometry/dash-hidden` | warning | less than about two dash or dot periods fit on a painted subpath, including legend samples; rounded segments and sharp branch junctions restart the pattern, and arrowhead shape affects the available wire: increase the gap or edge length, or use a smaller `arrowheadScale` |
| `geometry/theme-color-use` | info | the theme (`sumi`, `sumi-dark`) prefers a gray base, at most three accent tones and `tinted` / `outlined` / `emphasis` over blocks of colour: more `gray`-excluded tones, or more node area in `filled` / `solid` with a tone, or any `solid` node with a tone (use `emphasis` for the dark block), than its `colorUse` allows. Recolour the named tones to gray or a kept tone, and the named nodes to `tinted`; or `--rule geometry/theme-color-use=off` |
| `geometry/arrowhead-cramped` | info | a structured head has under 1pt of visible stem before a bend (the router aims at 2pt before `fit`; after rounding and `fit`; not for straight, invisible or legend edges): tight group padding grows automatically; else widen the gap, change anchors, reduce shrinking. Promote with `{"rules":{"geometry/arrowhead-cramped":"warning"}}` |
| `geometry/edge-jog` | info | a straight segment under 1pt (printed) between two right-angle bends: align `fromAnchor` / `toAnchor`, widen the gap, or rearrange. Promotable like the rule above |
| `geometry/zoom-crosses-node` | warning | a zoom line crosses a node: move it, or the source or view |
| `geometry/edge-on-border` | warning | an edge runs on a group border (3mm or more; short pieces of edges merging into one trunk on the same line add up): structured: move the ends with anchors, reorder items or change a `gap`; auto: change `direction` or grouping |
| `geometry/edge-near-border` | info | as above, less than 1.5pt beside the border; often the router's turn outside a group: leave it if it reads clearly |
| `geometry/edge-near-edge` | warning | two edges run less than 1.5pt apart for 3mm or more (an exactly shared trunk is fine): independent facing connectors separate automatically when the channel fits; for a narrow channel follow the hint's numeric port-to-port minimum by increasing the row/column gap and keeping it clear. For close fixed legs change anchors or cell spacing; merge a trunk only for genuinely shared endpoints |
| `geometry/edge-touches-label` | info | an edge passes within 1.5pt of a group title, caption or `label`: as `edge-crosses-label` |
| `geometry/aspect-distorted` | warning | fewer edges on that `circle` / `square`, or `ellipse` / `box` |
| `geometry/reversed-edge` | warning | ELK reversed an edge of a cycle (typically inside a group): swap the loop's nodes in `nodes`, or move it out of the group |
| `geometry/set-contains-non-member` | warning | a set's outline covers a node that is not one of its `members` (its centre, or a quarter of its box, lies inside): add it, move it clear (`place` coordinates, gaps), or fit closer with `shape: hull`, `ellipse` with `angle: auto`, or a smaller `padding` ([sets](structured.md#set-enclosures)) |
| `geometry/set-label-collision` | warning | a set's label overlaps another label, a node, an edge's route or another set's boundary (a subset's label inside its superset is fine): change `labelAt`, shorten it, or move the sets apart |
| `geometry/set-outline-crosses-text` | warning | a set's outline crosses or touches (within 0.5pt) text it does not enclose: a non-member's label, a group title or caption, an edge label; a member's own text and text wholly inside the outline are fine | move the members or the text apart, use a smaller `padding`, or fit closer with `shape: ellipse` + `angle: auto` |
| `geometry/badge-collision` | warning | a badge touches labels, other bodies, badges, edges or the canvas edge (its own body may overlap): change the corner, increase gaps / margin; invalid badge icons: `asset/unknown-icon` at `badge.icon` |
| `geometry/glyph-collision` | warning | a glyph (feature vector, dot, pill) touches other bodies, labels, badges, glyphs, edges or the canvas edge, or covers its own text (its own body and icon may be touched): change `at`, `dx` / `dy` or `size`, attach the edge elsewhere, or increase gaps / margin |
| `geometry/group-empty-area` | info | at least 75% of a group's frame lies outside its title and direct children (occupancy estimate; nested groups count fully; tokens/matrix/legend frames skipped; not counted in `maxWarnings`): consider `align: stretch` with inner `justify: stretch`, `justify: space-between`, smaller gaps, or do not stretch the panel; intentional whitespace needs no change |
| `geometry/sparse-figure` | info | paper profile or `figure.target`; at least 30 drawn nodes, node bodies/text/badges/glyphs cover under 34% of the canvas and each node gets more than 330mm² of printed canvas (not counted in `maxWarnings`): see [density](#density-of-paper-figures) |
| `geometry/text-heavy-nodes` | info | paper profile or `figure.target`; a figure of 12+ nodes with at least 2 nodes whose label holds 36+ characters (chat `bubble` excluded): move formulas and explanations to the caption, shorten labels to names, use a small `sublabel` |

Custom outlines: `geometry/label-overflow` checks the renderer's safe label
rectangle and, for stroked outlines, overlap with boundary segments (including
a split bowtie's inner edges; a filled-only split bowtie may overlay text across
both bodies and the gap). Concave silhouettes use their convex hull, so a
warning in a small empty step may be intentional. Generated dimensions are not
explicit `props`: those findings point at `label`; partial or explicit ones at `props`.

## Too wide: the width breakdown

`geometry/exceeds-page-width` (render / `lint --geometry`) keeps its hint short and
in the order you act on it: **1.** `Width to remove` (the overflow in mm), **2.** `Sets
the width`: the row, grid or auto footprint that sets the page width and its three
widest items (a grid item names its column or span), **3.** `Verified layout edits`:
concrete edits (row `gap`, grid `columnGap`, explicit node `width`, `attach.gap`; tried
in order of their own size) recommended only if the trial shows a smaller width, ranked
by mm saved (up to 3; trial reductions are independent, not additive), and **4.** the
reminder that Sumi never shrinks a figure on its own. The fine-grained breakdown is not
in the hint: it follows as `related` notes (and in `--json` under `related`): every
item width and the total of observed gaps of the widest run, the descendant runs, the
horizontal overhang of attached nodes beyond their container, the largest label
overhang and the top-level span. **Auto:** only the top-level horizontal footprint and
observed gaps, not ELK's internal layers or spacing; no trials run. Overlapping
x-ranges and grid spans are merged, blank tracks cannot be reconstructed; margins,
strokes, edges and labels can also widen the page. Lengths are printed mm;
`geometry/heavy-scaling` shows the same headline for the natural, pre-scaling width,
so it remains available under `fit: scale`.

Procedure: apply the hint's edit (or shorten labels), re-run, repeat: a second
row may become the widest. If it is still too wide, build candidates from the
[options](layout-tips.md#when-width-runs-short) (auto: the other `direction`;
structured: [rows](layout-tips.md#folding-a-flow-into-rows), smaller `gap`s, panels;
`figure.fit: scale`) and compare them measured; a wider profile is the user's decision.

## Density of paper figures

`geometry/sparse-figure` and `geometry/text-heavy-nodes` are info, but for a paper
figure treat them as work to do: change the layout until they are gone, and suppress
one only when the sparseness or the sentences are the point of the figure.
Thresholds come from dense reference figures (TriCL, LLaDA: fill 36-41%, 78-194mm² per node)
and sparse trial figures (27-32%, 378-433mm² per node).

- Sparse: shrink the canvas rather than add content: smaller `gap`s and padding,
  `layout.density: compact`, a lower `figure.target.height`, or larger elements
  (bigger text, icons) so the same content fills a smaller area. The message names
  the largest empty area: move the legend or scattered labels into it.
- Text-heavy: a box holds a name, not a sentence. Move formulas and explanations to
  the caption, or split into a title and a short `sublabel`.
- Low stroke contrast (`geometry/low-stroke-contrast`): an edge (info under 3:1, warning under 1.5:1) or the frame of an outline-only node (info under 2:1) barely stands out from what is painted behind it (canvas, panel, set, earlier nodes). Each severity requires at least 10 units below its threshold. Darken the line or its tone, or lighten the panel; a paper reproduction keeps the original's pale lines and records the info.
