# Worked examples

For a requested model or figure style only, consult the [bundled reference figures](../examples/README.md); they are not templates for unrelated figures.

**Purpose.** Real runs of the workflow (outputs abbreviated); `sumi` is the
skill's `scripts/sumi` wrapper. Contents: 1 [decision flow](#1-success-a-decision-flow) ·
2 [unknown component](#2-failure-an-unknown-component) · 3 [too wide](#3-failure-too-wide-for-the-target) ·
4 [structured block diagram](#4-success-a-structured-block-diagram) ·
5 [no room for arrows](#5-failure-no-room-for-the-arrows) · 6 [paper figure](#6-success-a-paper-figure).
Every complete figure in the Skill is checked by `src/cli/skill.test.ts`: a
`# expect-error:` comment lists the errors `sumi lint` must report,
`# expect-render: fits` means no diagnostics after rendering, `too-wide` exactly
`geometry/exceeds-page-width`, and a list of codes exactly those.

## 1. Success: a decision flow

Request: "Draw a flowchart of a cache lookup for one column of a paper:
request, check the cache, check freshness, fetch from origin on a miss or
stale entry, update the cache, respond."

The content is fully given, the target is `paper-single`; nothing to ask.

```sh
$ sumi doctor            # → ... Ready to render.
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
  - { id: request, component: ellipse, label: Request }
  - { id: cached, component: diamond, label: "In cache?" }
  - { id: fresh, component: diamond, label: "Fresh?" }
  - { id: fetch, component: box, label: "Fetch from\norigin" }
  - { id: update, component: box, label: Update cache }
  - { id: respond, component: ellipse, label: Response, variant: emphasis }
edges:
  - { from: request, to: cached }
  - { from: cached, to: fresh, label: "yes" }
  - { from: cached, to: fetch, label: "no" }
  - { from: fresh, to: respond, label: "yes" }
  - { from: fresh, to: fetch, label: "no", variant: dashed }
  - { from: fetch, to: update }
  - { from: update, to: respond }
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
  - { id: api, component: box, label: API }
  - { id: db, component: database, label: Database, group: data }
edges:
  - { from: api, to: db }
```

```sh
$ sumi lint --json web-service.sumi.yaml | jq -c '.results[0].diagnostics[] | {code,path,hint}'
{"code":"component/unknown","path":["nodes",1,"component"],"hint":"Known node components: box, square, circle, ellipse, diamond, hexagon, parallelogram, cylinder, document, label."}
$ sumi catalog --kind node | grep -i storage
sumi/cylinder       node  default,emphasis,muted,filled,outlined,solid,tinted  A cylinder, e.g. for storage.
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
  - { id: sources, component: parallelogram, label: Raw files }
  - { id: extract, component: box, label: Extract }
  - { id: clean, component: box, label: Clean }
  - { id: load, component: box, label: Load, variant: emphasis }
  - { id: warehouse, component: cylinder, label: Warehouse }
  - { id: report, component: document, label: Report }
edges:
  - { from: sources, to: extract }
  - { from: extract, to: clean }
  - { from: clean, to: load }
  - { from: load, to: warehouse }
  - { from: warehouse, to: report }
  - { from: clean, to: report, label: rejects, variant: dashed }
```

```sh
$ sumi render etl-pipeline.sumi.yaml; echo "exit $?"
etl-pipeline.sumi.yaml:4:3 error geometry/exceeds-page-width The figure is 171.63mm wide, more than the 88mm maximum width of profile "paper-single".
  hint: Width to remove: 83.63mm. Widest horizontal run: auto horizontal footprint = 167.39mm (127.71mm occupied x-projection + 39.69mm observed gaps). Items: node "sources" 31.4mm, … Sumi never shrinks a figure on its own. … The minimum printed font size with `figure.fit: scale` is 5pt.
Wrote etl-pipeline.svg: 171.63mm × 24.17mm (paper-single, max width 88mm, TOO WIDE; theme academic).
exit 1
```

The SVG is written despite the error, so it can be inspected.

Fix: a six-step chain cannot fit 88mm side by side, so change the layout, not
the target: `direction: right` → `direction: down` (`fit: scale` would shrink it
to 51%, its 8pt text to 4.1pt: an error). The fixed figure, checked by the tests:

```yaml
# expect-render: fits
version: 1
figure: { id: etl-pipeline, theme: academic, profile: paper-single, layout: { direction: down } }
nodes:
  - { id: sources, component: parallelogram, label: Raw files }
  - { id: extract, component: box, label: Extract }
  - { id: clean, component: box, label: Clean }
  - { id: load, component: box, label: Load, variant: emphasis }
  - { id: warehouse, component: cylinder, label: Warehouse }
  - { id: report, component: document, label: Report }
edges:
  - { from: sources, to: extract }
  - { from: extract, to: clean }
  - { from: clean, to: load }
  - { from: load, to: warehouse }
  - { from: warehouse, to: report }
  - { from: clean, to: report, label: rejects, variant: dashed }
```

```sh
$ sumi render etl-pipeline.sumi.yaml; echo "exit $?"
Wrote etl-pipeline.svg: 42.69mm × 119.42mm (paper-single, max width 88mm; theme academic).
exit 0
```

Had `down` still been too wide (e.g. many parallel branches), the next
step is to ask the user whether `paper-double` is acceptable — not to
switch silently.

## 4. Success: a structured block diagram

Request: "For one paper column, draw our sensor front end: the raw signal at the
bottom, calibration with the sensor configuration fed in from the side, then K×
[a low-, band- and high-pass filter, each with its own gain, combined and added to a
bypass of the filters]; math labels for the signals." A stage of touching blocks, a
bypass and a side note are a structured figure
([choose](layout-tips.md#choose-the-engine-first)); icon search `sumi catalog --icons
adjustments` → `tabler/adjustments`.

```yaml
# expect-render: fits
version: 1
figure:
  id: sensor-frontend
  theme: academic
  profile: paper-single
  layout:
    arrange:
      stack:
        direction: up # first item at the bottom
        gap: 4mm
        items: [ raw, calibrate, stage, clean ]

groups:
  - id: stage
    arrange:
      stack:
        direction: up
        gap: 3mm
        align: stretch # Combine as wide as the three bands
        items:
          - split
          - row:
              gap: 3mm
              items:
                # one touching filter + gain pair per band
                - stack: { direction: up, gap: 0, align: stretch, items: [ low, gain-low ] }
                - stack: { direction: up, gap: 0, align: stretch, items: [ band, gain-band ] }
                - stack: { direction: up, gap: 0, align: stretch, items: [ high, gain-high ] }
          - combine
          - add

nodes:
  - { id: raw, component: label, label: '$u_t$' }
  - { id: calibrate, component: box, label: Calibration, tone: gray }
  - { id: config, component: circle, icon: tabler/adjustments, attach: { to: calibrate, side: west, gap: 2mm } }
  - { id: config-label, component: label, label: "Sensor\nconfig", attach: { to: config, side: west, gap: 0.5mm } }
  - { id: split, component: junction, variant: hidden }
  - { id: low, component: box, label: Low-pass, tone: blue }
  - { id: gain-low, component: box, label: '$g_1$', tone: yellow }
  - { id: band, component: box, label: Band-pass, tone: blue }
  - { id: gain-band, component: box, label: '$g_2$', tone: yellow }
  - { id: high, component: box, label: High-pass, tone: blue }
  - { id: gain-high, component: box, label: '$g_3$', tone: yellow }
  - { id: combine, component: box, label: Combine, tone: green }
  - { id: add, component: operator, props: { symbol: plus } }
  - { id: repeat, component: label, label: '$K \times$', attach: { to: stage, side: east, gap: 2mm } }
  - { id: clean, component: label, label: '$\hat{y}_t$' }

edges:
  - { from: raw, to: calibrate }
  - { from: config, to: calibrate, component: line }
  - { from: calibrate, to: split, component: line }
  # one hidden junction fans out to the three bands and the bypass
  - { from: split, to: low }
  - { from: split, to: band }
  - { from: split, to: high }
  - { from: gain-low, to: combine, toAnchor: straight }
  - { from: gain-band, to: combine, toAnchor: straight }
  - { from: gain-high, to: combine, toAnchor: straight }
  - { from: combine, to: add }
  - { from: split, to: add, toAnchor: west } # bypass around the filters
  - { from: add, to: clean }
```

```sh
$ sumi fmt sensor-frontend.sumi.yaml && sumi lint sensor-frontend.sumi.yaml
0 errors, 0 warnings, 0 infos
$ sumi render sensor-frontend.sumi.yaml
Wrote sensor-frontend.svg: 83.26mm × 68.09mm (paper-single, max width 88mm; theme academic).
```

Points to note: every node and group appears once, in a tree or with `attach`
(`config-label` → `config` → `calibrate` is a chain); members come from the group's
`arrange` (no `group:`); `gap: 0` stacks join each filter to its gain; the edge into the
junction is a `line` and the junction `hidden`, so the three bands and the bypass fork
without a dot; the bypass enters the ⊕ at `west`; `align: stretch` makes Combine as wide
as the bands, so `straight` gives three vertical lines; math labels are single-quoted. `academic` maps tones
to gray steps; `theme: color` colours the same YAML.

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

No SVG is written for a routing error. The default `color` arrows (1pt lines)
have arrowheads about 2.1mm long, more than the 1.5mm gap; the `line` from `x` and
the residual route fine. Fix: `gap: 3mm` (not `gap: 0`, which leaves no room at
all), checked by the tests:

```yaml
# expect-render: fits
version: 1
figure:
  id: mlp-block
  theme: color
  layout: { arrange: { stack: { direction: up, gap: 3mm, align: stretch, items: [ x, split, norm, mlp, add, y ] } } }
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
  - { from: split, to: add, toAnchor: west }
  - { from: add, to: y }
```

`render` then prints `Wrote mlp-block.svg: 27.52mm × 44.8mm (paper-single, max
width 88mm; theme color).`, exit 0.

## 6. Success: a paper figure

Request: "For a full-width figure: (a) our model: four input chunks into the backbone,
a norm, a linear head with two 64 × 64 outputs (mean and scale); (b) the backbone block
enlarged; (c) the gated variant we compared against, drawn pale." Structured, theme
`paper`, [planned](layout-tips.md#plan-the-layout-before-writing-yaml) as one row of
three equally tall panels, model first (left to right: overview, detail, comparison);
`paper-double` is given, nothing to ask.

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
        items: [ model, block, gated ]
groups:
  - id: model
    caption: (a) Model
    variant: plain # a panel without a frame
    arrange:
      stack:
        direction: up
        align: stretch
        items: [ chunks, backbone, norm, head, { row: { items: [ mean, scale ] } } ]
  - id: block # the paper container: light gray, rounded
    caption: (b) Backbone block
    arrange:
      # a stretched group centres its tree vertically: a row with align: end moves it to the bottom
      row: { align: end, items: [ { stack: { direction: up, align: stretch, items: [ b-in, b-norm, b-conv, b-add, b-out ] } } ] }
  - id: gated
    caption: (c) Gated variant
    dim: true # the compared variant: pale, with everything inside
    arrange:
      row: { align: end, items: [ { stack: { direction: up, align: stretch, items: [ g-in, g-norm, g-conv, g-add, g-out ] } } ] }
nodes:
  - id: chunks
    component: tokens # one node for a row of cells; edges name a cell
    tone: purple
    props: { variant: outlined, gap: 1.5pt, cells: [ C1, C2, C3, C4 ] }
  - { id: backbone, component: box, label: Backbone, props: { height: 28pt } }
  - { id: norm, component: box, label: Norm, tone: blue, variant: filled }
  - { id: head, component: box, label: Linear, tone: green, variant: filled }
  - { id: mean, component: box, label: Mean, sublabel: 64 × 64, tone: gray, variant: filled }
  - { id: scale, component: box, label: Scale, sublabel: 64 × 64, tone: gray, variant: filled }
  - { id: b-in, component: box, label: Input, tone: gray, variant: filled }
  - { id: b-norm, component: box, label: Norm, tone: blue, variant: filled }
  - { id: b-conv, component: box, label: Conv 3×3, tone: orange, variant: filled }
  - { id: b-add, component: operator, props: { symbol: plus } }
  - { id: b-out, component: junction, variant: hidden }
  - { id: g-in, component: box, label: Input, tone: gray, variant: filled }
  - { id: g-norm, component: box, label: Norm, tone: blue, variant: filled }
  - { id: g-conv, component: box, label: Gated Conv, tone: red, variant: filled }
  - { id: g-add, component: operator, props: { symbol: plus } }
  - { id: g-out, component: junction, variant: hidden }
edges:
  - { from: chunks.1, to: backbone, toAnchor: straight } # each cell straight up
  - { from: chunks.2, to: backbone, toAnchor: straight }
  - { from: chunks.3, to: backbone, toAnchor: straight }
  - { from: chunks.4, to: backbone, toAnchor: straight }
  - { from: backbone, to: norm, component: line }
  - { from: norm, to: head, component: line }
  - { from: head, fromAnchor: straight, to: mean } # leaves the wide box in line
  - { from: head, fromAnchor: straight, to: scale }
  - { from: backbone, to: block, component: zoom } # dashed corner-to-corner callout
  - { from: b-in, to: b-norm, component: line }
  - { from: b-norm, to: b-conv, component: line }
  - { from: b-conv, to: b-add, component: line }
  - { from: b-in, to: b-add, toAnchor: west, tone: blue } # residual, colored
  - { from: b-add, to: b-out }
  - { from: g-in, to: g-norm, component: line }
  - { from: g-norm, to: g-conv, component: line }
  - { from: g-conv, to: g-add, component: line }
  - { from: g-in, to: g-add, toAnchor: west }
  - { from: g-add, to: g-out }
```

```sh
$ sumi fmt paper-recipe.sumi.yaml && sumi lint paper-recipe.sumi.yaml
0 errors, 0 warnings, 0 infos
$ sumi render paper-recipe.sumi.yaml
Wrote paper-recipe.svg: 100.89mm × 54.15mm (paper-double, max width 180mm; theme paper).
```

Points to note (the YAML comments say the rest): (b) and (c) put their stack in a
`row` with `align: end` so their inputs sit at the bottom, level with (a)'s; every panel
reads bottom to top and repeats the tones of the same parts (norms `blue`). Had the
figure been wider than 180mm, `render` would print `scaled to …%`: tell the user.
