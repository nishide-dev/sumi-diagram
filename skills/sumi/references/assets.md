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
- The icon is one text line tall (1 em) and the node is sized around it.
  Its color is the node's text color, so variants and tones apply as to
  a label.
- Not supported: icon and label together, icons on groups, emoji.

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
  fine; `..`, absolute paths and URLs are not; a symbolic link that leads
  outside is refused when rendering). Copy the file next to the YAML if
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
- No label (`component/unexpected-label`): attach or place a `label` node
  next to it. A `tone` colors the background (visible around `contain`).

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
| `asset/unknown-icon-set` | only `tabler/` exists |
| `asset/icon-with-label` | remove the label, or move the text into a separate `label` node |
| `asset/icon-unsupported` | put the icon on a `box`, `circle`, `label`, … |
| `asset/invalid-path` | relative path without `..`, `\`, a scheme or a leading `/`, naming a file |
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
