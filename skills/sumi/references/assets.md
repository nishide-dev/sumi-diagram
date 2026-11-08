# Icons and images

**Purpose.** Sumi embeds icons from the bundled sets (Tabler, colour emoji),
and the user's own PNG, JPEG or SVG pictures, in both layout engines. It checks
and embeds them; it never draws, edits or resizes pixels. Prefer existing
components and icons. For a small custom drawing use inline SVG, for photos ask
the user for the file, for rich text a card see [html](html.md).

Contents: [minimal example](#minimal-example) · [icons](#icons) ·
[corner badges](#corner-badges) · [file images](#file-images) ·
[inline SVG](#inline-svg) · [one picture, many uses (`figure.assets`, crop)](#reusing-one-picture-figureassets) ·
[patch grids and tokens image cells](#patches-from-one-picture) ·
[stacked copies (`layers`)](#stacked-copies-layers) · [framed images and operator size](#framed-images-and-operator-size) ·
[fixing `asset/*`](#fixing-asset)

## Minimal example

A complete figure with an image (`gradient.png` next to the YAML) and an icon:

```yaml
# expect-render: fits
version: 1
figure:
  id: photo-to-label
  theme: color
  profile: paper-single
  layout:
    arrange:
      row: { gap: 4mm, items: [ photo, model, result ] }
nodes:
  - { id: photo, component: image, variant: framed, props: { src: gradient.png, height: 28pt } }
  - { id: model, component: box, icon: tabler/brain, tone: purple }
  - { id: result, component: label, label: '$p(y \mid x)$' }
  - { id: model-name, component: label, label: Classifier, attach: { to: model, side: south, gap: 1mm } }
edges:
  - { from: photo, to: model }
  - { from: model, to: result }
```

## Icons

```sh
sumi catalog --icons "wave"            # every bundled icon whose name contains all words
sumi catalog --icons "arrow right"     # several words: quote them as one argument
```

Each line is a ready-made reference (`tabler/wave-sine`); use it verbatim. Tabler
(outline, no brand logos, about 4,800 icons) is searched by what the icon shows
(`brain`, `database`, `photo`, `world`), not by the concept.

```yaml
- { id: pe, component: circle, icon: tabler/wave-sine }
- { id: model, component: box, icon: tabler/brain, tone: purple }
- { id: hint, component: label, icon: tabler/bulb }          # a bare icon
```

- `icon:` goes on a node with a plain shape (`box`, `circle`, `ellipse`,
  `diamond`, …) or a `label`; not on `operator`, `junction`, `trapezoid`, `stack`,
  `image` (`asset/icon-unsupported`) or groups.
- **The icon replaces the label** (both: `asset/icon-with-label`). To caption an
  icon attach a `label` node beside it (structured) or use a neighbouring node.
  Icon and text on one block is not possible in one node: attach a `label` node
  carrying the icon to a side without edges (`{ id: cond-icon, component: label,
  icon: tabler/clock, attach: { to: cond, side: south, gap: 1mm } }`) and say so
  in the report.
- The icon is one text line tall (1 em) unless `iconSize` sets it: a number is a
  multiple of the node's font size (`iconSize: 2.5`), a string a length
  (`iconSize: "12mm"`). **Size icons with `iconSize`; do not wrap them in a
  `circle` or `box` to make them bigger.** A bare `label` with `icon` and
  `iconSize` is sized to exactly the icon (no padding), so edges end on its
  square; a `box` or `circle` adds padding around it. `iconSize` needs an `icon`
  (`asset/icon-size-without-icon`); badges stay one em. Its colour is the
  node's text colour, so variants and tones apply. A legend `icon` entry takes
  the same `iconSize`. A sized Tabler icon keeps the printed stroke of a 1 em icon (the stroke width is divided by the extra scale); emoji are unchanged. Tabler artwork has a margin of about 1/12 of its side, so
  a large icon's edge ends slightly short of the strokes: use a small `gap`.
- **`emoji/<name>`**: 3,124 bundled Fluent Emoji Flat SVGs (Microsoft, MIT) keep their
  multicolour palette in every theme and output, **also inside `dim: true` groups**
  (icons and badges, no `theme/undimmed-image`); use Tabler for an icon that follows
  dimmed text colour. Unicode emoji in labels still hit `lint/missing-glyph`. The 47
  original names (`emoji/fire`, `emoji/snowflake`) remain; fifty upstream icons needing
  SVG references, clipping, gradients or filters are excluded and report
  `asset/unsupported-icon` with the importer's reason.
- Search covers both sets (English names); the empty search lists all:

```sh
sumi catalog --section icons            # counts per set
sumi catalog --icons "smiling face"
sumi catalog --icons "artist dark" --json
sumi catalog --icons "" --json          # entries beginning with emoji/ are emoji
```

## Corner badges

```yaml
- { id: lora, component: bowtie, label: LoRA, tone: pink, badge: { icon: emoji/fire, corner: north-east } }
- { id: qkv, component: box, label: QKV, badge: { icon: emoji/snowflake, corner: north-east } }
```

`badge` is independent of `label` and replacement `icon`. Its one-em square is
centred on the bounding-box corner (`north-east`, `south-east`, `south-west`,
`north-west`), also on outline and image nodes, and takes Tabler references too.
Structured layout reserves the union of body and badge in rows/stacks,
attachments, groups and the canvas; auto composes it after D2 placement, so check
the room with geometry lint. `geometry/badge-collision` warns about foreign
bodies, labels, badges, edges, its own label/sublabel or canvas clipping (overlap
with its own body and ancestor-group bodies is intended; ancestor titles are
checked). `legend`, `tokens`, `matrix`, `bracket` and point junctions cannot carry
badges (`component/badge-unsupported`): put it on an ordinary node. Editable PPTX
rejects badges (`pptx/unsupported-asset`); picture PPTX keeps them. Exports keep the MIT notice.

## Glyphs

`glyphs` (since 0.16.0) puts small marks over a node's border, e.g. the three-cell
feature vector a paper figure draws at the corner of an icon:

```yaml
- { id: doc, component: label, icon: tabler/file-text,
    glyphs: [{ kind: vector, cells: 3, tone: blue, dx: 0.3 }] }
- { id: out, component: box, label: Out, glyphs: [{ kind: vector, direction: right, tones: [pink, none, green], at: south }, { kind: dot, at: north-west }] }
```

- `kind`: `vector` (cells; `cells` default 3, `direction: down|right`, `tone` for
  all cells or `tones` one per cell (not both), `none` = the theme's default box fill, not the node's own fill), `dot`, `pill`
  (`width`, default twice its height). Up to 8 glyphs per node, each with its
  own `at`. For an icon on a corner use `badge`.
- `at`: a corner or side middle (`north`, `north-east`, ..., default `north-east`);
  the glyph is centred there, moved by `dx` / `dy` ems (right / down, 1 em = the
  node's font size). For an icon node centred on a corner use `dx: 0.3`.
- `strength: soft` (default) fills with the tone like a node (pale); `solid` fills
  with the tone's accent (its line colour: a dark hue in `color` / `paper`-like
  themes, a gray step in `minimal` / `academic`) and a 0.5pt ink outline, so 3pt
  cells stay readable. `none` stays the default box fill in both.
- `size`: cell side, dot diameter or pill height, a length such as `2.5pt` (default
  0.4 em: about 3pt at 7.5pt text). `outline: false` drops the thin outline.
- Structured layout reserves the union of body and glyphs (rows, stacks,
  attachments, groups, canvas); auto draws them after D2 placement. Edges attach
  to the body, never to a glyph. Glyphs need no icon asset: SVG, PDF, picture
  and editable PPTX all draw them (editable PPTX cannot carry icon nodes).
- `geometry/glyph-collision` warns about foreign bodies, labels, badges, glyphs,
  edges (also a glyph on the side an edge leaves), its own text or canvas
  clipping; an own icon may be touched. `legend`, `tokens`, `matrix`, `bracket`
  and point junctions cannot carry glyphs (`component/glyph-unsupported`).
  `at: center` puts a glyph on the middle of the body (covering a label is reported); a
  [legend](structured.md#legends) entry's `glyph` sample takes the same fields.

## File images

```yaml
- id: sample
  component: image
  variant: framed                # default (no border) | framed (see below)
  props:
    src: gradient.png            # relative to the YAML file
    height: 34pt                 # width or height (or both) is required
    fit: contain                 # contain (default) | cover | fill, when both sizes are given
```

- `src` is a path **relative to the directory of the `.sumi.yaml`**, with `/`
  separators, staying inside it (subdirectories fine; `..`, absolute paths and
  URLs are not; a symlink leading outside is refused at render). Copy the file
  next to the YAML if needed, after asking the user.
- `width` / `height`: at least one (lengths with a unit, multiples of 0.5pt); the
  other follows the aspect ratio. With both, `fit`: `contain` (whole image,
  margins), `cover` (fills, crops), `fill` (stretches).
- PNG, JPEG, SVG only (no WebP / GIF); at most 16 MiB per file, 32 MiB per figure,
  8192 px per side, 16.7 megapixels; Sumi never downscales: resize the file.
- SVG files must be plain drawings: `path`, `rect`, `circle`, `ellipse`, `line`,
  `polyline`, `polygon`, `g` with fill / stroke / opacity / transform. Scripts,
  links, embedded images, `<style>`, `<text>`, gradients, filters, masks,
  `<defs>` / `<use>` are refused.
- `sha256` (optional, 64 hex digits) pins the content.
- No label (`component/unexpected-label`) and no sublabel: attach a `label` node.
  A `tone` colours the background (visible around `contain`).

`sumi lint` checks the path's form; the file itself is read by `sumi render` /
`sumi lint --geometry`. A path that leaves the directory:

```yaml
# expect-error: asset/invalid-path
version: 1
figure:
  id: logo-outside
  layout:
    arrange:
      row: { items: [ logo, name ] }
nodes:
  - { id: logo, component: image, props: { src: ../shared/logo.png, height: 20pt } }
  - { id: name, component: label, label: Our method }
edges:
  - { from: logo, to: name, component: line }
```

Fix: copy (with the user's consent) `logo.png` next to the figure and write
`src: logo.png`.

## Inline SVG

Use exactly one of `props.src`, `props.svg` and `props.asset`. Write a complete
SVG document with a `viewBox` (or positive width/height); a literal block is easiest:

```yaml
- id: waveform
  component: image
  props:
    width: 48pt
    svg: |
      <svg viewBox="0 0 120 40">
        <path d="M10 20H20M30 10V30M40 5V35M50 15V25M60 8V32M70 15V25M80 20H110" fill="none" stroke="#c04050" stroke-width="2"/>
      </svg>
```

The same allow-list importer as file SVG is used, without interpolation. **Text must be
outlined as paths or shapes** (`<text>` / `<tspan>` unsupported); HTML/`foreignObject`,
scripts, events, references (`href`, `use`, `url(...)`), embedded images, DTD/entities,
`<style>`, `defs`, clipping, masks, gradients and filters are rejected; use native labels
outside the image for searchable text. `width`, `height`, `fit`, frames, tones and layers
work as for files; internal colours stay as written (`currentColor` is not a theme variable). SVG, PDF and picture PPTX are
supported (editable PPTX: `pptx/unsupported-asset`). The viewport clips overflow; geometry
lint checks the outer placement only.

The UTF-8 source counts toward the shared 16 MiB per asset / 32 MiB per figure
budgets (at most 20,000 elements, 32 levels). Raw decoded bytes (whitespace
included) are hashed into `assets-sha256`; optional `sha256` pins them. Diagnostics
point into literal blocks and single-line quoted scalars (folded or multiline
quoted scalars: the whole scalar).

## Reusing one picture: `figure.assets`

Do not paste the same SVG into many nodes. Define it once under `figure.assets`
(an ID as the name; `svg:` as above or `src:` for a file, each with an optional
`sha256`: quote it, an all-digit hash is read as a number) and name it in
`props.asset`. The asset goes through the importer once; every image naming it
shares the result. `props.crop: [x, y, width, height]` (positive numbers in the
asset's viewBox coordinates, inside it) draws only that rectangle, so patches are
cut from one picture. `crop` works on **SVG assets only** (not PNG/JPEG) and needs
`asset`; `src`, `svg` and `asset` are exclusive on one image. Each use embeds its
own copy (a crop is its own SVG): the budgets count the asset once, but a raster
asset used N times makes the SVG about N times larger.

Provenance: `assets-sha256` gets one `asset <name> <sha256>` line per entry and
`asset-use <node id> <name> [crop]` per image. Errors: `asset/unknown-asset` (name
not in `figure.assets`; the hint names the closest), `asset/invalid-crop` (no
`asset`, a raster asset, or outside the viewBox; the message gives the viewBox),
and the usual `asset/*` codes located at the `figure.assets` entry.

### Patches from one picture

A 3×3 patch grid of one 120×120 picture (each patch 40×40) next to the whole
picture:

```yaml
# expect-render: fits
version: 1
figure:
  id: patches
  theme: paper
  assets:
    photo:
      svg: |
        <svg viewBox="0 0 120 120">
          <rect width="120" height="120" fill="#dde8f5"/>
          <circle cx="60" cy="60" r="45" fill="#c04050"/>
          <path d="M0 120L60 20L120 120Z" fill="#3a7d5c"/>
        </svg>
  layout:
    arrange:
      row:
        gap: 12mm
        items: [whole, { grid: { columns: 3, items: [p0, p1, p2, p3, p4, p5, p6, p7, p8] } }]
nodes:
  - { id: whole, component: image, props: { asset: photo, width: 60pt } }
  - { id: p0, component: image, variant: framed, props: { asset: photo, crop: [0, 0, 40, 40], width: 40pt } }
  - { id: p1, component: image, variant: framed, props: { asset: photo, crop: [40, 0, 40, 40], width: 40pt } }
  - { id: p2, component: image, variant: framed, props: { asset: photo, crop: [80, 0, 40, 40], width: 40pt } }
  - { id: p3, component: image, variant: framed, props: { asset: photo, crop: [0, 40, 40, 40], width: 40pt } }
  - { id: p4, component: image, variant: framed, props: { asset: photo, crop: [40, 40, 40, 40], width: 40pt } }
  - { id: p5, component: image, variant: framed, props: { asset: photo, crop: [80, 40, 40, 40], width: 40pt } }
  - { id: p6, component: image, variant: framed, props: { asset: photo, crop: [0, 80, 40, 40], width: 40pt } }
  - { id: p7, component: image, variant: framed, props: { asset: photo, crop: [40, 80, 40, 40], width: 40pt } }
  - { id: p8, component: image, variant: framed, props: { asset: photo, crop: [80, 80, 40, 40], width: 40pt } }
edges:
  - { from: whole, to: p3 }
```

For a **row or column** of patches use one `tokens` node with image cells instead
of one `image` node plus an edge each. A cell with `asset` is drawn as an `image`
(no `label`, `component` or `mono`; `variant` `default` or `framed`, `tone`, `crop`
and `fit` as on an image); its size is the cell's or the tokens' `width` /
`height` (one is enough: the aspect ratio gives the other). Image and text cells
mix, and edges address them as `<node>.<cell>` or the whole node:

```yaml
# expect-render: fits
version: 1
figure:
  id: patch-row
  theme: paper
  assets:
    photo:
      svg: |
        <svg viewBox="0 0 120 120">
          <rect width="120" height="120" fill="#dde8f5"/>
          <circle cx="60" cy="60" r="45" fill="#c04050"/>
        </svg>
  layout:
    arrange: { stack: { direction: up, gap: 6mm, items: [patches, proj] } }
nodes:
  - id: patches
    component: tokens
    props:
      width: 30pt
      gap: 4pt
      cells:
        - { asset: photo, crop: [0, 0, 60, 60], variant: framed }
        - { asset: photo, crop: [60, 0, 60, 60], variant: framed }
        - "…"
  - { id: proj, component: box, label: Projection, tone: green, variant: filled }
edges:
  - { from: patches, to: proj }
```

### Stacked copies (`layers`)

Groups also accept `props.layers: { count, offset }` to repeat frames only;
see [stacked group frames](structured.md#group-titles-and-captions) for the
structured-only layout, front-frame connections and export limitations.

`layers: { count: 4, offset: 3pt }` on an image (file, inline or asset) repeats the
**same unchanged image** behind the front one, diagonally up-right (repeated video
frames). `count` includes the front (integer 1–16); `offset` is positive, a multiple
of 0.5pt; width and height size **one copy**. The node means the **whole stack**:
layout, obstacles, geometry lint, attached labels and group captions use the footprint
(each side grows by `(count - 1) × offset`; a south-centred attachment sits right of
the front image's centre by half that spread). Edge ports are chosen on the footprint
and extended to the first painted copy; one that cannot reach a copy is rejected
(`layout/no-route`, or `svg/outline-edge-miss` in D2). SVG stores the image once
(`defs`/`use`), PDF reuses it; editable PPTX refuses it (`pptx/unsupported-asset`).
Invalid values: `component/invalid-prop` / `component/unknown-prop`.

## Framed images and operator size

`variant: framed` draws a border: under `paper` 0.5pt like its edges, in other
themes their node frame. `operator` takes `props.size: regular | large | xlarge`
(1x / 1.5x / 2x) when the ⊕ should read as clearly as the pictures around it:

```yaml
# expect-render: fits
version: 1
figure:
  id: framed-add
  theme: paper
  layout:
    arrange: { row: { gap: 8mm, align: center, items: [photo, add, result] } }
nodes:
  - { id: photo, component: image, variant: framed, props: { src: gradient.png, height: 32pt } }
  - { id: add, component: operator, props: { symbol: plus, size: large } }
  - { id: result, component: image, variant: framed, props: { src: gradient.jpg, height: 32pt } }
edges:
  - { from: photo, to: add, component: line }
  - { from: add, to: result }
```

## Fixing `asset/*`

| Code | Fix |
| --- | --- |
| `asset/unknown-icon` | use the hint's name, or search `sumi catalog --icons "<word>"` |
| `asset/unsupported-icon` | the name exists upstream but needs unsupported SVG features: choose another (also for badges) |
| `asset/unknown-icon-set` | use `tabler/` or `emoji/` |
| `asset/icon-with-label` | remove the label, or move the text into a separate `label` node |
| `asset/icon-unsupported` | put the icon on a `box`, `circle`, `label`, … |
| `asset/icon-size-without-icon` | `iconSize` belongs to a node with `icon`: add the icon or remove it |
| `asset/invalid-path` | a relative path with `/` (no `\`, scheme or leading `/`) naming a file and not leaving the directory through `..` |
| `asset/outside-base` | the path (through a symlink) leaves the YAML's directory: copy the real file in |
| `asset/not-found` | the path is relative to the YAML file, not the current directory |
| `asset/unsupported-format`, `asset/format-mismatch`, `asset/invalid-image` | convert to PNG / JPEG / SVG; make the extension match the content; re-export a broken file; give exactly one of `props.src`, `props.svg`, `props.asset` |
| `asset/too-large`, `asset/too-many-pixels` | resize or recompress the file (Sumi will not) |
| `asset/unknown-asset` | the hint names the closest `figure.assets` entry; define the asset first |
| `asset/invalid-crop` | `props.crop` needs `props.asset` of an SVG; keep `[x, y, w, h]` inside the viewBox (the message prints it) |
| `asset/sha256-mismatch` | the file changed: confirm with the user, then update `sha256` (the message gives the actual value) |
| `asset/unsafe-svg`, `asset/unsupported-svg` | the message and `related` give the line and column; re-export as plain shapes (text to outlines, no embedded images or styles), or use a PNG |
| `asset/unsafe-html`, `asset/unsupported-css`, `asset/html-overflow` | [html](html.md#diagnostics) |
| `asset/no-base-directory`, `asset/icons-unavailable` | not a figure problem (library use without a file, damaged install): report it |

SVG, PDF and the default (picture) PPTX keep icons and images (PDF keeps SVG
images as vectors and JPEG unchanged); the experimental editable PPTX refuses them
and writes nothing: use the picture PPTX.
