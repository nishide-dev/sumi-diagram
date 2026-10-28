# Worked examples

Real runs of the workflow (outputs abbreviated). `sumi` is the skill's
`scripts/sumi` wrapper. Every complete figure on this page is checked by the
repository's tests (`src/cli/skill.test.ts`): a `# expect-error:` comment
lists the errors `sumi lint` must report, `# expect-render: fits` means no
diagnostics after rendering, `too-wide` exactly
`geometry/exceeds-page-width`, and a list of codes exactly those.

## 1. Success: a decision flow

Request: "Draw a flowchart of a cache lookup for one column of a paper:
request, check the cache, check freshness, fetch from origin on a miss or
stale entry, update the cache, respond."

The content is fully given, the target is `paper-single`; nothing to ask.

```sh
$ sumi doctor
ok      d2             D2 v0.9.0 (env: …/.sumi/bin/d2)
ok      fonts          3 bundled font files present, sha256 verified
ok      geometry-lint  font metrics readable for 3 font files; …
Ready to render.
$ sumi catalog --kind node      # → ellipse (terminals), diamond (decisions), box (steps)
```

```yaml
# expect-render: fits
version: 1
figure:
  id: cache-lookup
  title: Cache lookup
  theme: minimal
  profile: paper-single
  layout:
    direction: down

nodes:
  - id: request
    component: ellipse
    label: Request
  - id: cached
    component: diamond
    label: "In cache?"
  - id: fresh
    component: diamond
    label: "Fresh?"
  - id: fetch
    component: box
    label: "Fetch from\norigin"
  - id: update
    component: box
    label: Update cache
  - id: respond
    component: ellipse
    label: Response
    variant: emphasis

edges:
  - from: request
    to: cached
  - from: cached
    to: fresh
    label: "yes"
  - from: cached
    to: fetch
    label: "no"
  - from: fresh
    to: respond
    label: "yes"
  - from: fresh
    to: fetch
    label: "no"
    variant: dashed
  - from: fetch
    to: update
  - from: update
    to: respond
```

```sh
$ sumi fmt cache-lookup.sumi.yaml
$ sumi lint --json cache-lookup.sumi.yaml | jq -c .summary
{"errors":0,"warnings":0,"infos":0}
$ sumi render cache-lookup.sumi.yaml
Wrote cache-lookup.svg: 48.86mm × 154.87mm (paper-single, max width 88mm; theme minimal).
                                 # no geometry diagnostics, exit 0
$ <skill-dir>/scripts/preview cache-lookup.svg   # then Read the PNG
```

Inspection: top-to-bottom flow, both decisions readable, edge labels sit on
their lines (known, see layout-tips). Report: files, 48.9 × 154.9mm within
paper-single, no diagnostics (lint and geometry); note that the figure is tall (6 layers) and
that `emphasis` marks the end state and `dashed` the stale-entry path.

## 2. Failure: an unknown component

Request: "A small web service architecture: browser, web server and API in
an application tier; database, cache and job queue in a data tier; a worker
that consumes the queue." A first draft used a component name that sounded
right but is not in the catalog:

```yaml
# expect-error: component/unknown
version: 1
figure:
  id: web-service
  profile: paper-double
groups:
  - id: data
    label: Data
nodes:
  - id: api
    component: box
    label: API
  - id: db
    component: database
    label: Database
    group: data
edges:
  - from: api
    to: db
```

```sh
$ sumi lint --json web-service.sumi.yaml | jq -c '.results[0].diagnostics[] | {code,path,hint}'
{"code":"component/unknown","path":["nodes",1,"component"],"hint":"Known node components: box, square, circle, ellipse, diamond, hexagon, parallelogram, cylinder, document, label."}
$ sumi catalog --kind node | grep -i storage
sumi/cylinder       node  default,emphasis,muted,filled,outlined  A cylinder, e.g. for storage.
```

Fix: `component: cylinder` at `nodes[1].component`, then `fmt` → `lint`
(0 errors). Do not invent a `database` component or ask for one to be
added; the catalog has a generic shape for the role.

## 3. Failure: too wide for the target

Request: "An ETL pipeline for one paper column: raw files → extract →
clean → load → warehouse → report, with rejected rows going from clean
straight to the report." Lint is clean, but the render reports the size:

```yaml
# expect-render: too-wide
version: 1
figure:
  id: etl-pipeline
  theme: academic
  profile: paper-single
  layout:
    direction: right
nodes:
  - id: sources
    component: parallelogram
    label: Raw files
  - id: extract
    component: box
    label: Extract
  - id: clean
    component: box
    label: Clean
  - id: load
    component: box
    label: Load
    variant: emphasis
  - id: warehouse
    component: cylinder
    label: Warehouse
  - id: report
    component: document
    label: Report
edges:
  - from: sources
    to: extract
  - from: extract
    to: clean
  - from: clean
    to: load
  - from: load
    to: warehouse
  - from: warehouse
    to: report
  - from: clean
    to: report
    label: rejects
    variant: dashed
```

```sh
$ sumi render etl-pipeline.sumi.yaml; echo "exit $?"
etl-pipeline.sumi.yaml:4:3 error geometry/exceeds-page-width The figure is 182.56mm wide, more than the 88mm maximum width of profile "paper-single".
  hint: Sumi never shrinks a figure on its own. Lay it out top to bottom (layout.direction: down), or shorten long labels. Or print it smaller as drawn with `figure.fit: scale` (its text must then print at 5pt or more).
Wrote etl-pipeline.svg: 182.56mm × 32.46mm (paper-single, max width 88mm, TOO WIDE; theme academic).
exit 1
```

The SVG is written despite the error, so it can be inspected.

Fix: a six-step chain cannot fit 88mm side by side, so change the layout,
not the target: `direction: down`. (`fit: scale` would shrink it to 48%,
its 8pt text to 3.9pt: an error.)

```yaml
# expect-render: fits
version: 1
figure:
  id: etl-pipeline
  theme: academic
  profile: paper-single
  layout:
    direction: down
nodes:
  - id: sources
    component: parallelogram
    label: Raw files
  - id: extract
    component: box
    label: Extract
  - id: clean
    component: box
    label: Clean
  - id: load
    component: box
    label: Load
    variant: emphasis
  - id: warehouse
    component: cylinder
    label: Warehouse
  - id: report
    component: document
    label: Report
edges:
  - from: sources
    to: extract
  - from: extract
    to: clean
  - from: clean
    to: load
  - from: load
    to: warehouse
  - from: warehouse
    to: report
  - from: clean
    to: report
    label: rejects
    variant: dashed
```

```sh
$ sumi render etl-pipeline.sumi.yaml; echo "exit $?"
Wrote etl-pipeline.svg: 42.69mm × 130mm (paper-single, max width 88mm; theme academic).
exit 0
```

Had `down` still been too wide (e.g. many parallel branches), the next
step is to ask the user whether `paper-double` is acceptable — not to
switch silently.

## 4. Success: a structured block diagram

Request: "For one paper column, draw a Transformer encoder layer the way
papers do: inputs at the bottom, input embedding, positional encoding added
with a ⊕, then N× [multi-head attention + add & norm, feed forward + add &
norm] with residual connections; math labels for the inputs and outputs."

Stacked layers, residuals and a side note are a structured figure
([layout-tips](layout-tips.md#choose-the-engine-first)). Icon search:

```sh
$ sumi catalog --icons "wave sine"
tabler/wave-sine
```

```yaml
# expect-render: fits
version: 1
figure:
  id: encoder-block
  theme: academic
  profile: paper-single
  layout:
    arrange:
      stack:
        direction: up # first item at the bottom
        gap: 4mm
        items: [ inputs, embedding, add-pe, encoder, outputs ]

groups:
  - id: encoder
    arrange:
      stack:
        direction: up
        gap: 3mm
        align: stretch # every block as wide as the widest
        items:
          - split1
          - stack: { direction: up, gap: 0, items: [ attention, norm1 ] } # touching blocks
          - split2
          - stack: { direction: up, gap: 0, items: [ feed-forward, norm2 ] }

nodes:
  - { id: inputs, component: label, label: '$x_1,\,\ldots,\,x_n$' }
  - { id: embedding, component: box, label: Input Embedding, tone: pink }
  - { id: add-pe, component: operator, props: { symbol: plus } }
  - { id: pe, component: circle, icon: tabler/wave-sine, attach: { to: add-pe, side: west, gap: 1mm } }
  - { id: pe-label, component: label, label: "Positional\nEncoding", attach: { to: pe, side: west, gap: 0.5mm } }
  - { id: split1, component: junction, variant: hidden }
  - { id: attention, component: box, label: "Multi-Head\nAttention", tone: orange }
  - { id: norm1, component: box, label: Add & Norm, tone: yellow }
  - { id: split2, component: junction, variant: hidden }
  - { id: feed-forward, component: box, label: Feed Forward, tone: blue }
  - { id: norm2, component: box, label: Add & Norm, tone: yellow }
  - { id: repeat, component: label, label: '$N \times$', attach: { to: encoder, side: east, gap: 2mm } }
  - { id: outputs, component: label, label: '$h_1,\,\ldots,\,h_n$' }

edges:
  - { from: inputs, to: embedding }
  - { from: embedding, to: add-pe }
  - { from: pe, to: add-pe, component: line }
  - { from: add-pe, to: split1, component: line }
  # one junction fans out to Q, K, V and the residual
  - { from: split1, to: attention, toAnchor: "south:0.2" }
  - { from: split1, to: attention, toAnchor: "south:0.5" }
  - { from: split1, to: attention, toAnchor: "south:0.8" }
  - { from: split1, to: norm1, toAnchor: west } # residual
  - { from: norm1, to: split2, component: line }
  - { from: split2, to: feed-forward }
  - { from: split2, to: norm2, toAnchor: west } # residual
  - { from: norm2, to: outputs }
```

```sh
$ sumi fmt encoder-block.sumi.yaml && sumi lint encoder-block.sumi.yaml
0 errors, 0 warnings, 0 infos
$ sumi render encoder-block.sumi.yaml
Wrote encoder-block.svg: 51.68mm × 81.49mm (paper-single, max width 88mm; theme academic).
```

Points to note: every node and group appears once, in a tree or with
`attach` (the positional encoding and its caption hang off the ⊕, `N×` off
the group); the group's members come from its `arrange`, so no `group:`
fields; `gap: 0` stacks join each block to its `Add & Norm` with no edge
between them; edges into junctions are `line`s; the junctions are
`variant: hidden`, so Q, K, V and the residual fork off the line along
rounded turns without a dot (nothing else crosses there); math labels are
single-quoted and use `\,` after commas. `academic` maps the tones to gray
steps; with `theme: color` the same YAML is in color.

## 5. Failure: no room for the arrows

Request: "A pre-norm MLP block with a residual, in color, for one column."
A first draft packed the stack tightly. `lint` is clean (routing happens
at render time), but:

```yaml
# expect-render: layout/no-route, layout/no-route, layout/no-route, layout/no-route
version: 1
figure:
  id: mlp-block
  theme: color
  profile: paper-single
  layout:
    arrange:
      stack: { direction: up, gap: 1.5mm, align: stretch, items: [ x, split, norm, mlp, add, y ] }
nodes:
  - { id: x, component: label, label: $x$ }
  - { id: split, component: junction }
  - { id: norm, component: box, label: Layer Norm, tone: yellow }
  - { id: mlp, component: box, label: MLP, tone: blue }
  - { id: add, component: operator, props: { symbol: plus } }
  - { id: y, component: label, label: $y$ }
edges:
  - { from: x, to: split, component: line }
  - { from: split, to: norm }
  - { from: norm, to: mlp }
  - { from: mlp, to: add }
  - { from: split, to: add, toAnchor: west } # residual
  - { from: add, to: y }
```

```sh
$ sumi render mlp-block.sumi.yaml; echo "exit $?"
mlp-block.sumi.yaml:18:5 error layout/no-route No route was found for edge edges[1] from "split" to "norm": the ends are closer than its arrowhead at the target is long.
  hint: Leave room around the elements it connects (…), connect other sides with fromAnchor / toAnchor, or use a different anchor for each end.
…                                # the same for edges[2], edges[3] and edges[5]
4 errors, 0 warnings, 0 infos
exit 1
```

No SVG is written for a routing error. The default `color` arrows (1pt
lines) have arrowheads about 2.1mm long, more than the 1.5mm gap; the `line` from `x` and the residual route
fine. Fix: `gap: 3mm` (not `gap: 0`, which leaves no room at all):

```yaml
# expect-render: fits
version: 1
figure:
  id: mlp-block
  theme: color
  profile: paper-single
  layout:
    arrange:
      stack: { direction: up, gap: 3mm, align: stretch, items: [ x, split, norm, mlp, add, y ] }
nodes:
  - { id: x, component: label, label: $x$ }
  - { id: split, component: junction }
  - { id: norm, component: box, label: Layer Norm, tone: yellow }
  - { id: mlp, component: box, label: MLP, tone: blue }
  - { id: add, component: operator, props: { symbol: plus } }
  - { id: y, component: label, label: $y$ }
edges:
  - { from: x, to: split, component: line }
  - { from: split, to: norm }
  - { from: norm, to: mlp }
  - { from: mlp, to: add }
  - { from: split, to: add, toAnchor: west } # residual
  - { from: add, to: y }
```

```sh
$ sumi render mlp-block.sumi.yaml; echo "exit $?"
Wrote mlp-block.svg: 27.52mm × 44.8mm (paper-single, max width 88mm; theme color).
exit 0
```

## 6. Success: a paper figure

Request: "For a full-width figure in our paper, in the style of the DiT
paper: (a) the model — four patches into the encoder, layer norm, a linear
head with two 32×32×4 outputs, noise and variance; (b) the encoder block
enlarged — input tokens, layer norm, self-attention, a residual add; (c)
the cross-attention variant we compared against, drawn pale."

A figure modelled on a published one: structured, theme `paper`, and the
[paper figure recipe](layout-tips.md#paper-figure-recipe). The target
(`paper-double`) is given; nothing to ask.

```yaml
# expect-render: fits
version: 1
figure:
  id: paper-recipe
  theme: paper # rounded boxes, pastel tones, thin edges, Inter
  profile: paper-double
  fit: scale # only acts if still too wide: printed smaller (text must reach 5pt)
  layout:
    density: compact # tighter default gaps and padding; write no gaps of your own
    arrange:
      row:
        align: stretch # panels equally tall, so the captions share a line
        items: [ model, block, cross ]
groups:
  - id: model
    caption: (a) Model
    variant: plain # a panel without a frame
    arrange:
      stack:
        direction: up
        align: stretch
        items: [ patches, encoder, norm, head, { row: { items: [ noise, sigma ] } } ]
  - id: block # the paper container: light gray, rounded
    caption: (b) Encoder block
    arrange: # a stretched group centres its tree vertically: a row with align: end moves it to the bottom
      row: { align: end, items: [ { stack: { direction: up, align: stretch, items: [ b-in, b-norm, b-attn, b-add, b-out ] } } ] }
  - id: cross
    caption: (c) Cross-attention variant
    dim: true # the compared variant: pale, with everything inside
    arrange:
      row: { align: end, items: [ { stack: { direction: up, align: stretch, items: [ c-in, c-norm, c-attn, c-add, c-out ] } } ] }
nodes:
  - id: patches
    component: tokens # one node for a row of cells; edges name a cell
    tone: purple
    props: { variant: outlined, gap: 1.5pt, cells: [ P1, P2, P3, P4 ] }
  - { id: encoder, component: box, label: Encoder, props: { height: 28pt } }
  - { id: norm, component: box, label: Layer Norm, tone: blue, variant: filled }
  - { id: head, component: box, label: Linear, tone: green, variant: filled }
  - { id: noise, component: box, label: Noise, sublabel: 32 × 32 × 4, tone: gray, variant: filled }
  - { id: sigma, component: box, label: Variance, sublabel: 32 × 32 × 4, tone: gray, variant: filled }
  - { id: b-in, component: box, label: Input Tokens, tone: gray, variant: filled }
  - { id: b-norm, component: box, label: Layer Norm, tone: blue, variant: filled }
  - { id: b-attn, component: box, label: Self-Attention, tone: orange, variant: filled }
  - { id: b-add, component: operator, props: { symbol: plus } }
  - { id: b-out, component: junction, variant: hidden }
  - { id: c-in, component: box, label: Input Tokens, tone: gray, variant: filled }
  - { id: c-norm, component: box, label: Layer Norm, tone: blue, variant: filled }
  - { id: c-attn, component: box, label: Cross-Attention, tone: red, variant: filled }
  - { id: c-add, component: operator, props: { symbol: plus } }
  - { id: c-out, component: junction, variant: hidden }
edges:
  - { from: patches.1, to: encoder, toAnchor: straight } # each cell straight up
  - { from: patches.2, to: encoder, toAnchor: straight }
  - { from: patches.3, to: encoder, toAnchor: straight }
  - { from: patches.4, to: encoder, toAnchor: straight }
  - { from: encoder, to: norm, component: line }
  - { from: norm, to: head, component: line }
  - { from: head, fromAnchor: straight, to: noise } # leaves the wide box in line
  - { from: head, fromAnchor: straight, to: sigma }
  - { from: encoder, to: block, component: zoom } # dashed corner-to-corner callout
  - { from: b-in, to: b-norm, component: line }
  - { from: b-norm, to: b-attn, component: line }
  - { from: b-attn, to: b-add, component: line }
  - { from: b-in, to: b-add, toAnchor: west, tone: blue } # residual, colored
  - { from: b-add, to: b-out }
  - { from: c-in, to: c-norm, component: line }
  - { from: c-norm, to: c-attn, component: line }
  - { from: c-attn, to: c-add, component: line }
  - { from: c-in, to: c-add, toAnchor: west }
  - { from: c-add, to: c-out }
```

```sh
$ sumi fmt paper-recipe.sumi.yaml && sumi lint paper-recipe.sumi.yaml
0 errors, 0 warnings, 0 infos
$ sumi render paper-recipe.sumi.yaml
Wrote paper-recipe.svg: 116.24mm × 54.15mm (paper-double, max width 180mm; theme paper).
```

Points to note: the three panels are groups in one `row` with
`align: stretch`, so the captions share a line — (a) is `variant: plain`
(no frame) rather than a stack with a label under it; (b) and (c) put
their stack in a `row` with `align: end` so the inputs sit at the bottom
of the stretched panels. `filled` boxes have no border, the `outlined`
tokens a purple frame and text, the residual a blue line. `dim: true`
pales the whole of (c), caption included, with one field. The four patch
edges and the two outputs use `straight` on the wide box's end, so every
line is vertical with no jog. The `zoom` edge draws the dashed callout
from the encoder's corners to panel (b). `density: compact` sets the
spacing, so no `gap` is written. `fit: scale` changes nothing here (the
figure fits); had it been wider than 180mm it would be printed at 180mm
and `render` would print `scaled to …%` — tell the user. A matrix
(attention mask) would be one more node: see
[matrices](structured.md#matrices).
