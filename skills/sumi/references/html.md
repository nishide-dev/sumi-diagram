# Restricted HTML cards

**Purpose.** `component: html` draws a small card (a prompt, code, a caption
with mixed sizes, a token cell with rich text) from a restricted HTML/CSS
subset, as outlines in SVG / PDF / picture PPTX. Use it when a label cannot
express the text: a larger `N×`, mixed fonts, a padded code box. Prefer plain
labels otherwise: HTML text is not searchable or copyable in PDF and not
editable in PPTX. Contents: [minimal example](#minimal-example) ·
[rules](#what-is-accepted) · [limits](#value-limits) · [diagnostics](#diagnostics).

## Minimal example

```yaml
# expect-render: fits
version: 1
figure: { id: html-card, theme: paper, layout: { arrange: { row: { items: [card] } } } }
nodes:
  - id: card
    component: html
    props:
      viewport: 320x120
      width: 160pt
      html: |
        <div style="padding:12px;background-color:var(--sumi-bg);color:var(--sumi-fg);border:2px solid var(--sumi-accent);font-size:18px;line-height:1.5">
          <b style="font-size:24px">Prompt</b>
          <div style="font-family:var(--sumi-mono);font-size:16px;white-space:pre">  a photo of a cat</div>
        </div>
```

Required props: `html` and `viewport: <W>x<H>` in CSS px (each side at most
2048, at most 2,097,152 pixels). Optional `width`, `height` (one missing keeps
the viewport's aspect ratio; neither means natural size, 0.75pt per CSS px
rounded to 0.5pt), `fit: contain|cover|fill` (as for images) and variants
`default|framed`. Use it as a standalone leaf or with `group:` inside a
container; never put `props.html` on `image`.

## What is accepted

- **Elements**: only `div`, `span`, `p`, `b`, `i`, `br` and a quoted inline
  `style` attribute; only ASCII space/tab/LF/FF/CR separate tags and attributes.
  Self-closing syntax only for `br`; close every other element. No
  images/SVG/scripts/`style` tags, events, classes, URLs, @rules, custom
  properties, `overflow` (hidden too), transforms, gradients, shadows, filters.
  CSS escapes, entities and comments inside `style` are rejected. Unknown CSS is
  an error, never ignored.
- **CSS**: flex/grid layout, position/edges, dimensions, margin/padding/gap,
  `color` / `background-color`, border/radius, font properties, `line-height`,
  `letter-spacing`, `text-align`, `white-space`, `opacity`, `box-sizing:border-box`.
  Units, keywords and named colours are case-insensitive (`40PX`, `FLEX`, `RED`). `border` takes one
  width, style and colour in any order (`solid 1px #ccc`); `flex` a grow number
  (`1`), grow/shrink/basis (`1 1 0`) or `none|auto|initial`; grid supports basic
  tracks and `repeat(2,1fr)`. Lengths use px/pt/em/% or unitless 0. Colours:
  `#hex`, comma-separated `rgb()` / `rgba()` (percentages too) and transparent,
  black, silver, gray, white, maroon, red, purple, fuchsia, green, lime, olive,
  yellow, navy, blue, teal, aqua, orange, rebeccapurple. `calc()`, `min()`,
  `max()`, `clamp()`, `hsl()`, `minmax()` are rejected. Decimals have at most
  **two fractional digits**, no exponents.
- **Theme variables**: `--sumi-fg`, `--sumi-muted`, `--sumi-accent`, `--sumi-bg`
  (colours only), `--sumi-font`, `--sumi-mono` (font lists only); write
  `var(--sumi-accent)` without fallbacks. `font-family` may use only the font/mono
  variables or the bundled `BIZ UDPGothic`, `BIZ UDGothic`, `Inter` (no font
  fetching). Takumi keeps a Geist fallback that does not count for
  `lint/missing-glyph`: choose a covering list, e.g. `Inter,'BIZ UDPGothic'` for
  Latin + Japanese.
- **Gotchas**: put `white-space:pre` on **each line div**, not the parent
  (indentation between children becomes extra lines). Takumi uses **border-box**,
  not the browser's content-box. Budget: 128KiB, 512 elements, depth 24.

## Value limits

Decimals have at most two fractional digits. Length magnitude: 0, or 1–2048px /
0.75–1536pt / 0.1–16em / 1–100%; resolved font-size 0 or 1–2048px (other em lengths
also at most 2048px); flex-grow / shrink and `fr` 0–64; unitless line-height 0–8;
opacity and numeric alpha 0–1 (percentage alpha 0–100%); RGB channels 0–255 or
0–100% (one unit for all three); font-weight 100–900 in steps of 100 or normal/bold
(regular/bold faces); order −512–512; grid line −64–64 (nonzero), span 1–64; repeat
count 1–64 and at most 64 expanded tracks, 16 top-level entries. These are budgets
tied to the 2048px viewport side, not a promise that content fits a smaller viewport.

## Diagnostics

`lint`, `lint --geometry` and render measure the HTML; diagnostics point at the
offending element inside `props.html` (an ambiguous mapping falls back to the
nearest unambiguous ancestor and may over-report rather than omit a check;
repeated `font-size` declarations use the last one). Always inspect the rendered
result too.

- `asset/unsafe-html`, `asset/unsupported-css`: preflight; sizes reuse `asset/too-large`.
- `asset/html-overflow` (warning): a box/run exceeds the viewport by more than
  0.5 CSS px: enlarge the viewport or fix dimensions, spacing, wrapping or
  position (raising only the placed `width` / `height` does not fix clipping).
- `geometry/text-too-small` (error): resolved font-size × viewport-to-placed scale
  × page-fit scale is below the profile minimum: raise the font-size or the placed
  size relative to the viewport; avoid heavy `fit: scale` (`contain` uses the
  smaller axis, `cover` the larger, `fill` conservatively the smaller).
- `lint/missing-glyph` (warning): change the family or text as above (whitespace,
  controls and `display:none` text are ignored).

## Theme background

`--sumi-bg` is the active theme's canvas color: white, cream in `sumi`, navy in `sumi-dark`.
