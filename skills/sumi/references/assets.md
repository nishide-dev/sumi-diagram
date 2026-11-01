# Icons and images

Sumi embeds two kinds of pictures, in both layout engines (introduced in
0.4.0): icons from the bundled Tabler Icons set, and the user's own PNG,
JPEG or SVG files. It checks and embeds them; it never draws, edits or
resizes the pixels. Prefer existing components and icons. For a small custom
drawing, use inline SVG (0.10.0) below; for photos, ask the user for the file.

## Restricted HTML cards (0.11.0)

Use dedicated `component: html`, as a standalone leaf or with `group:` inside a container.
Required props: `html` and `viewport: 320x176` in CSS px. Optional `width`, `height`,
`fit: contain|cover|fill`, and variants `default|framed` use image placement.
One missing dimension preserves the viewport aspect ratio; neither means natural size
(0.75pt per CSS px, rounded to 0.5pt). Do not put `props.html` on `image`.

Only `div/span/p/b/i/br` and a quoted inline `style` attribute are accepted.
Only ASCII space/tab/LF/FF/CR separate tags and attributes. Self-closing syntax
is allowed only for `br`; close every other element explicitly.
Use flex/grid layout, position/edges, dimensions, margin/padding/gap, color/background-color,
border/radius, font properties, line-height, letter-spacing, text-align, white-space,
opacity and `box-sizing:border-box`. Unknown CSS is an error, never silently ignored.
No images/SVG/scripts/style tags, events/classes, URLs, @rules, custom properties,
overflow (including hidden), transforms, gradients, shadows or filters.
CSS escapes, entities and comments inside style are rejected.
Declarations are tokenized with quote/parenthesis awareness; every property has
a complete value grammar. Malformed quotes/parentheses and non-ASCII CSS whitespace
point to the offending declaration, including later lines of a style.
Units, keywords and named colors are case-insensitive (`40PX`, `FLEX`, `RED`).
`border` takes exactly one width, style and color in any order (`solid 1px #ccc`).
`flex` accepts a grow number (`1`), grow/shrink/basis (`1 1 0`), or `none|auto|initial`.
Lengths use px/pt/em/% or unitless 0 (negative values and percentages only where
appropriate). All decimals have at most **two fractional digits**, without exponents:

| Numeric value | Inclusive accepted range |
| --- | --- |
| Length magnitude | 0, or 1–2048px / 0.75–1536pt / 0.1–16em / 1–100% |
| Resolved font-size | 0, or 1–2048 CSS px; inherited em/% are resolved before checking |
| Other em lengths | Also at most 2048 CSS px using the element's resolved font-size |
| flex-grow / flex-shrink (also inside flex), fr tracks | 0–64 |
| Unitless line-height | 0–8 (lengths use the length limits) |
| Opacity / numeric RGBA alpha | 0–1 |
| RGB channels | 0–255, or 0–100% (all three channels use the same unit) |
| Percentage RGBA alpha | 0–100% |
| font-weight | 100–900 in steps of 100, or normal/bold; bundled faces select regular/bold |
| order | Integer −512–512 |
| Grid line / span | Nonzero integer −64–64 / positive integer 1–64 |
| repeat count / expanded template tracks | 1–64 / at most 64; at most 16 top-level track entries |

These are local value budgets tied to the maximum 2048px viewport side, not a
promise that content fits a smaller viewport. Normal layout and paint rounding still applies.
Colors accept #hex, comma-separated rgb()/rgba() (including percentages), and this fixed list: transparent, black,
silver, gray, white, maroon, red, purple, fuchsia, green, lime, olive, yellow,
navy, blue, teal, aqua, orange, rebeccapurple. Grid supports basic tracks and
`repeat(2,1fr)`. Unverified functions including calc(),
min(), max(), clamp(), hsl() and minmax() are rejected.

Theme variables: `--sumi-fg`, `--sumi-muted`, `--sumi-accent`, `--sumi-bg`,
`--sumi-font`, `--sumi-mono`; use `var(--sumi-accent)` without fallbacks.
font-family may only use the font/mono variables or bundled family names
`BIZ UDPGothic`, `BIZ UDGothic`, `Inter`. No font fetching.
The fg/muted/accent/bg variables are colors and cannot be used as dimensions
or font families; font/mono variables are font lists and cannot be used as
colors or dimensions. Injected values are type-checked too. Explicit families
select supplied fonts, but Takumi retains its bundled Geist fallback even after
clearFonts(). `lint/missing-glyph` checks measured HTML text against the selected
bundled families/weight; Geist fallback does not count. Replace unsupported characters
or choose a covering family list, e.g. `Inter,'BIZ UDPGothic'` for Latin + Japanese.
**Put `white-space:pre` on each line div, not the parent** (indentation between
children otherwise becomes extra lines). Takumi uses **border-box**, not browser
content-box. Budget: 128KiB, 512 elements, depth24; viewport ≤2048 per side and
2,097,152 total pixels. Text becomes outlines: no PDF text search/copy or editable
PPTX text; use SVG/PDF/picture PPTX. Normal `lint`, `lint --geometry`, and render
measure HTML, with diagnostics pointing at the offending element inside `props.html`:
- `asset/html-overflow` (warning): a box/run exceeds viewport by more than 0.5 CSS px.
  Increase viewport or fix CSS dimensions/spacing/wrapping/position. Increasing only
  placed width/height does not fix clipping.
- `geometry/text-too-small` (error): resolved CSS font-size × viewport-to-placed-size
  scale × page-fit scale is below the same profile minimum as normal labels. Increase
  font-size or placed size relative to viewport; avoid excessive `figure.fit: scale`.
  contain uses the smaller axis, cover the larger; fill conservatively uses the smaller.
- `lint/missing-glyph` (warning): fix the selected family or text as above; whitespace,
  controls and default-ignorables are excluded. Hidden (`display:none`) text is ignored.
Source ownership follows inline roots containing block/absolute children, mixed flows,
whitespace and `<br>`. Sumi uses its validated parse, with a dedicated entity decoder.
If a measured box/run cannot be matched unambiguously, its location falls back to the
nearest unambiguous ancestor; candidate elements' resolved font styles still undergo
size and glyph checks. Multiple candidate styles are checked conservatively, so an
ambiguous mapping may over-report rather than silently omit a text check.
Also inspect the rendered result. Preflight diagnostics: `asset/unsafe-html`,
`asset/unsupported-css`; size budgets reuse `asset/too-large`. Repeated font-size
declarations use the last value; resolved-size errors point only at that declaration.

In the repository, representative HTML code/card/token/flex-grid fixtures under
`tests/fixtures/assets/html-*.sumi.yaml` have shared SVG/PDF/picture PPTX SHA-256
goldens for academic and paper. Linux/macOS CI and compiled release smoke check
the same hashes; platform-specific golden exceptions are not used.

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
- `emoji/<name>` (0.7.0; expanded in 0.8.0) uses 3,124 bundled Fluent Emoji Flat
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

### Inline SVG (0.10.0)

Use exactly one of `props.src` and `props.svg`. Write a complete SVG document
with a `viewBox` (or positive width/height); a literal block is easiest:

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

The same allow-list importer as file SVG is used, without interpolation.
**Text must be outlined as paths or represented by shapes**; `<text>` and
`<tspan>` are unsupported, and outlined text is not searchable in PDF.
HTML/`foreignObject`, scripts, events, external/internal references (`href`,
`use`, `url(...)`), embedded images, DTD/entities, `<style>`, `defs`, clipping,
masks, gradients and filters are rejected. Use native Sumi labels outside
the image for readable/searchable text. For restricted HTML, use the dedicated
`html` component described above.

`width`, `height`, `fit`, frames, tones and layers work as for files. Internal
colors stay as written (`currentColor` is not a theme variable). SVG, PDF and
picture PPTX are supported; editable PPTX reports `pptx/unsupported-asset`.
The image viewport clips drawing overflow; geometry lint checks the outer
placement, not the drawing's internal text/line size or containment.

The UTF-8 source counts toward the shared 16 MiB/asset and 32 MiB/figure
budgets; the importer allows at most 20,000 elements and 32 levels. Raw decoded
source bytes (including whitespace) are hashed into `assets-sha256`; optional
`sha256` pins those bytes. Diagnostics point into literal blocks and single-line
quoted scalars; folded/multiline quoted scalars fall back to the whole scalar.

### File images

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
| `asset/unsupported-format`, `asset/format-mismatch`, `asset/invalid-image` | convert to PNG / JPEG / SVG; make the extension match the content; re-export a broken file; give exactly one of `props.src` or `props.svg` |
| `asset/too-large`, `asset/too-many-pixels` | resize or recompress the file (Sumi will not) |
| `asset/sha256-mismatch` | the file changed: confirm with the user, then update `sha256` (the message gives the actual value) |
| `asset/unsafe-svg`, `asset/unsupported-svg` | the message and `related` give the SVG line and column; re-export it as plain shapes (text to outlines, no embedded images or styles), or use a PNG |
| `asset/no-base-directory`, `asset/icons-unavailable` | not a figure problem (library use without a file, damaged install): report it |

## Output formats

SVG, PDF and the default (picture) PPTX keep icons and images; PDF keeps
SVG images as vectors and JPEG unchanged. The experimental editable PPTX
(`--pptx-mode editable`) refuses figures with icons or images
(`pptx/unsupported-asset`) and writes nothing: use the picture PPTX.
