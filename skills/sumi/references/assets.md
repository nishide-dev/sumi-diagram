# Icons and images

Sumi embeds two kinds of pictures, in both layout engines (introduced in
0.4.0): icons from the bundled Tabler Icons set, and the user's own PNG,
JPEG or SVG files. It checks and embeds them; it never draws, edits or
resizes the pixels. Do not draw a picture with shapes, and do not invent an
image file: use an icon, or ask the user for the file.

## Icons

```sh
sumi catalog --icons "wave"            # every bundled icon whose name contains all words
sumi catalog --icons "arrow right"     # several words: quote them as one argument
```

Each line is a ready-made reference (`tabler/wave-sine`). Tabler Icons
(outline, no brand logos) has about 4,800 icons; search by what the icon
shows (`brain`, `database`, `photo`, `world`), not by the concept.

```yaml
- { id: pe, component: circle, icon: tabler/wave-sine }
- { id: model, component: box, icon: tabler/brain, tone: purple }
- { id: hint, component: label, icon: tabler/bulb }          # a bare icon
```

- `icon:` goes on a node with a plain shape (`box`, `circle`, `ellipse`,
  `diamond`, …) or a `label`. Not on `operator`, `junction`, `trapezoid`,
  `stack`, `image` (`asset/icon-unsupported`), nor on groups.
- **The icon replaces the label**: writing both is `asset/icon-with-label`.
  To caption an icon, attach a `label` node beside it (structured) or put
  the text in a neighbouring node.
- The icon is one text line tall (1 em), with no size option; the node is
  sized around it (a `circle` adds a ring of padding — use a bare `label`
  node for a small inline icon). Its color is the node's text color, so
  variants and tones apply as to a label.
- **Icon and text on one block**: not possible in one node. In a structured
  figure, keep the text block and `attach` a `label` node carrying the icon
  to a side that has no edges (e.g. `{ id: cond-icon, component: label,
  icon: tabler/clock, attach: { to: cond, side: south, gap: 1mm } }`); say
  so in the report.
- `emoji/<name>` (0.7.0; expanded in #234) uses 3,124 bundled Fluent Emoji Flat
  SVGs (Microsoft, MIT). They keep their original multicolour palette in
  every theme and in SVG, PDF and picture PPTX. **Colour emoji deliberately
  retain their palette inside `dim: true` groups**, for both replacement icons
  and badges, without `theme/undimmed-image`; choose Tabler for an icon that
  follows dimmed text colour. Unicode emoji in labels still have missing-glyph lint.
- Not supported: replacement icon and label together, icons on groups.

Find emoji by English name, just like Tabler. Searches include both sets;
use the returned `emoji/…` reference verbatim. The catalog's icon section
reports each set's count; the empty search lists all supported names (JSON
clients can select entries beginning with `emoji/`).

```sh
sumi catalog --section icons
sumi catalog --icons "smiling face"
sumi catalog --icons "artist dark" --json
sumi catalog --icons "" --json
```

All original 47 names, including `emoji/fire` and `emoji/snowflake`, remain
available. Fifty upstream icons need SVG references, clipping, gradients or
filters and are excluded; using one (for example `emoji/teacher`) reports
`asset/unsupported-icon` with the importer reason, rather than a spelling hint.

## Corner badges (0.7.0)

```yaml
- { id: lora, component: bowtie, label: LoRA, tone: pink, badge: { icon: emoji/fire, corner: north-east } }
- { id: qkv, component: box, label: QKV, badge: { icon: emoji/snowflake, corner: north-east } }
```

`badge` is independent of `label` and replacement `icon`. Its one-em square
is centered on the bounding-box corner (`north-east`, `south-east`,
`south-west`, `north-west`), including on an outline or image node. It
accepts bundled Tabler references too. Structured layout reserves the
actual union of body and badge in rows/stacks, attachments, groups and the canvas
(including bodies smaller than half an em); auto composes it after D2
placement, so use geometry lint to check surrounding room.
`geometry/badge-collision` warns about foreign bodies/labels/badges/edges,
its own label/sublabel or canvas clipping. Overlap with its own body and
ancestor-group bodies is intentional; ancestor titles are still checked.
`legend`, `tokens`, `matrix` and point junctions cannot carry badges
(`component/badge-unsupported`); put the badge on an ordinary node.
Editable PPTX rejects badges (`pptx/unsupported-asset`); picture PPTX keeps
their colour SVG and PNG fallback. All exports retain the MIT notice.

## Images

```yaml
- id: sample
  component: image
  variant: framed                # default (no border) | framed (theme border)
  props:
    src: gradient.png            # relative to the YAML file
    height: 34pt                 # width or height (or both) is required
    fit: contain                 # contain (default) | cover | fill, when both sizes are given
```

- `src` is a path **relative to the directory of the `.sumi.yaml`**, with
  `/` separators, and must stay inside that directory (subdirectories are
  fine; a path that leads out with `..`, absolute paths and URLs are not;
  a symbolic link that leads outside is refused when rendering). Copy the file next to the YAML if
  needed — ask the user before copying their files.
- `width` / `height`: give at least one (lengths with a unit, multiples of
  0.5pt); the other follows the image's aspect ratio. With both, `fit`
  decides: `contain` (whole image, margins), `cover` (fills, crops),
  `fill` (stretches).
- Formats: PNG, JPEG, SVG only (no WebP / GIF). At most 16 MiB per file,
  32 MiB per figure, 8192 px per side and 16.7 megapixels; Sumi never
  downscales, so resize the file instead.
- SVG files must be plain drawings: `path`, `rect`, `circle`, `ellipse`,
  `line`, `polyline`, `polygon`, `g` with fill / stroke / opacity /
  transform. Scripts, links, embedded images, `<style>`, `<text>`,
  gradients, filters, masks, `<defs>`/`<use>` are refused.
- `sha256` (optional, 64 hex digits) pins the file's content.
- `layers: { count: 4, offset: 3pt }` (optional) repeats the **same unchanged
  image** behind the front one, diagonally up-right. `count` includes the
  front (integer 1–16); `offset` is positive, a multiple of 0.5pt. Width and
  height size **one copy**; layout, obstacles and geometry lint use the
  whole stack: each side grows by `(count - 1) × offset`. Edge ports are
  selected on that footprint, then extended to the first painted copy along
  the edge's approach (preserving arrowhead/stroke clearance). A port that
  cannot reach any copy is rejected (`layout/no-route` in structured,
  `svg/outline-edge-miss` in D2). Both engines and
  all fit modes work. SVG stores the image once per stack with `defs`/`use`;
  PDF reuses its embedded image. Editable PPTX refuses it with the existing
  `pptx/unsupported-asset`; use the default picture PPTX. Invalid layer
  values use `component/invalid-prop` / `component/unknown-prop`.
- No label (`component/unexpected-label`): attach or place a `label` node
  next to it. A `tone` colors the background (visible around `contain`).
  Image sublabels are also forbidden. The node means the **whole stack**:
  attached labels center on its footprint, and enclosing group captions
  include that footprint. A south-centered attachment sits right of the
  front image's center by **spread / 2**, where spread is
  `(count - 1) × offset` (4.5pt for four copies at 3pt).

`sumi lint` checks the path's form; the file itself is read by
`sumi render` / `sumi lint --geometry`. A complete figure with an image
(`gradient.png` next to the YAML) and icons:

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

## Fixing `asset/*`

| Code | Fix |
| --- | --- |
| `asset/unknown-icon` | use the hint's name, or search with `sumi catalog --icons "<word>"` |
| `asset/unsupported-icon` | the name exists upstream but needs unsupported SVG features; choose a supported name from `sumi catalog --icons "<word>"` (also applies to badges) |
| `asset/unknown-icon-set` | use `tabler/` or `emoji/` |
| `asset/icon-with-label` | remove the label, or move the text into a separate `label` node |
| `asset/icon-unsupported` | put the icon on a `box`, `circle`, `label`, … |
| `asset/invalid-path` | a relative path with `/` (no `\`, scheme or leading `/`) that names a file and does not leave the directory through `..` |
| `asset/outside-base` | the path (through a symbolic link) leaves the YAML's directory: copy the real file in |
| `asset/not-found` | check the path; it is relative to the YAML file, not the current directory |
| `asset/unsupported-format`, `asset/format-mismatch`, `asset/invalid-image` | convert to PNG / JPEG / SVG; make the extension match the content; re-export a broken file |
| `asset/too-large`, `asset/too-many-pixels` | resize or recompress the file (Sumi will not) |
| `asset/sha256-mismatch` | the file changed: confirm with the user, then update `sha256` (the message gives the actual value) |
| `asset/unsafe-svg`, `asset/unsupported-svg` | the message and `related` give the SVG line and column; re-export it as plain shapes (text to outlines, no embedded images or styles), or use a PNG |
| `asset/no-base-directory`, `asset/icons-unavailable` | not a figure problem (library use without a file, damaged install): report it |

## Output formats

SVG, PDF and the default (picture) PPTX keep icons and images; PDF keeps
SVG images as vectors and JPEG unchanged. The experimental editable PPTX
(`--pptx-mode editable`) refuses figures with icons or images
(`pptx/unsupported-asset`) and writes nothing: use the picture PPTX.
