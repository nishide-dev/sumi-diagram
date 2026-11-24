# Themes

A theme decides how a figure looks: colors, corners, line widths, groups and fonts. It never changes the layout rules or the page limits, which belong to the [profile](usage.md#themes-and-profiles). Choose one with `figure.theme` or `--theme`; the same YAML renders under every theme.

`figure.background: transparent` (or `render --background transparent`) omits the outer canvas while retaining the theme canvas as the assumed ground for contrast and label backgrounds.

`figure.themeOverrides.canvas: "#RRGGBB"` replaces a theme's canvas for one figure. The colors derived from the canvas (palette variants, cuboid faces, set overlaps, dimming) and the contrast lints follow it; `sumi catalog --json` lists each theme's own `canvas`.

Sumi has eight built-in themes:

- **`minimal`** (default): monochrome with clear outlines. A neutral starting point.
- **`academic`**: grayscale and print-friendly, in the manner of a journal. Nothing is colored, so the figure prints the same on a black-and-white printer.
- **`color`**: general purpose with color. The lines and type of `minimal`, with pastel tones and a blue accent.
- **`paper`**: color ML-paper style, after published Transformer and DiT figures: pastel tones, rounded corners, thin frames and edges, white framed panels (gray only when asked: `variant: filled`, `groupFill`), Inter for Latin text.
- **`slides`**: large text and thick lines for projection, used with the `presentation-16x9` profile.
- **`llama`**: after the mixture-of-experts figure of Meta's Llama 4 announcement: slate lines with open chevron arrowheads, gray-framed white boxes, dark slate `solid` blocks, a blue `emphasis` block, borderless pale panels, Inter for Latin text.
- **`sumi`**: white canvas (so a figure pastes into a paper or slide as is) with navy ink and sand accents, white panels with a thin pale gray frame (0.5pt #a9aebc, quieter than the 1pt navy node outlines; `variant: filled` for a sand one; `themeOverrides.groupFill: "#efeddd"` brings back the sand panels from before v0.20.0), Inter for Latin text; the design system of the project site, whose pages draw it on a cream plate. `figure.themeOverrides.canvas: "#f8f8ee"` brings back the former cream canvas, or any other `#RRGGBB`.
- **`sumi-dark`**: the dark counterpart: navy canvas, cream ink and sand accents, canvas-colored panels with a thin pale frame (0.5pt #6f7791), Inter for Latin text.

**`sumi` is the recommended theme** for papers, READMEs and slides (`textScale: 1.5` for `screen-doc`, `2` for `presentation-16x9`). `academic` and `paper` are the other paper themes: **grayscale or black-and-white print: `academic`; the pastel color ML-paper look, or a reference drawn in it: `paper`.**

## Comparison

| | `minimal` | `academic` | `slides` | `color` | `paper` | `llama` | `sumi` | `sumi-dark` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Purpose | general, neutral default | journal figures, grayscale print | projection | general, with color | color ML-paper figures | figures in the style of the Llama 4 MoE figure | recommended: papers, READMEs, slides (with `textScale`) | the same on a dark page |
| Color | monochrome; tones are 3 gray steps | grayscale only; tones are 3 gray steps | monochrome, darker grays; tones are 3 gray steps | pastel tone fills, blue emphasis | pastel tone fills and colored tone lines; blue is one of the tones | slate and gray; `solid` dark slate, `emphasis` blue accent, `filled` / `muted` borderless gray / pale blocks; pale tone fills | navy ink, sand accents; gray base, pale tone fills (at most 3 accent tones) | cream ink on navy, sand accents; pale tone fills |
| Corners | square | square | square | square | rounded (boxes 2pt, groups 6pt) | rounded (boxes 3pt, groups 5pt) | square | square |
| Lines | 1pt, emphasis 2pt | 0.5pt, emphasis 1pt | 2pt, emphasis 4pt | 1pt, emphasis 2pt | frames 1pt, edges 0.5pt (small arrowheads); emphasis: shapes 1.5pt, edges 1pt | frames and edges 1pt, **open chevron arrowheads** (a small gap before the box); emphasis edges 1.5pt blue, zoom lines 0.5pt | 1pt (node frames, edges), emphasis edges 2pt | as `sumi` |
| Groups | light gray fill, gray frame | no fill, gray frame | light gray fill, gray frame | light gray fill, gray frame | white panel, pale gray 0.5pt frame, rounded (`filled`: light gray, no frame) | pale borderless panel, regular-weight title; `muted`: white panel | white panel, thin pale gray frame 0.5pt (`filled`: sand) | canvas-colored panel, thin pale frame 0.5pt (`filled`: lighter navy) |
| Font | BIZ UDPGothic; 8pt, edges 7pt | BIZ UDPGothic; 8pt, edges 7pt | BIZ UDPGothic; 16pt, edges 14pt | BIZ UDPGothic; 8pt, edges 7pt | Inter for Latin text in structured figures, BIZ UDPGothic for Japanese; 8pt, edges 7pt | as `paper` | as `paper`; group titles 9pt | as `paper`; group titles 9pt |
| Typical profile | `paper-single`, `paper-double` | `paper-single`, `paper-double` | `presentation-16x9` | `paper-single`, `paper-double` | `paper-single`, `paper-double` | `paper-single`, `paper-double` | `paper-single`, `paper-double`; `screen-doc` (`textScale: 1.5`), `presentation-16x9` (`textScale: 2`) | as `sumi` |

## The same structured figure under every theme

The Transformer ([`examples/transformer`](../examples/transformer/transformer.sumi.yaml), structured layout), drawn with `--theme` overrides. `slides` uses its own profile, `presentation-16x9`, and this tall figure is taller than a slide there.

| `minimal` | `academic` | `slides` | `color` | `paper` | `llama` | `sumi` | `sumi-dark` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| <img src="gallery/themes/transformer.minimal.svg" alt="Transformer, theme minimal"> | <img src="gallery/themes/transformer.academic.svg" alt="Transformer, theme academic"> | <img src="gallery/themes/transformer.slides.svg" alt="Transformer, theme slides"> | <img src="gallery/themes/transformer.color.svg" alt="Transformer, theme color"> | <img src="gallery/themes/transformer.paper.svg" alt="Transformer, theme paper"> | <img src="gallery/themes/transformer.llama.svg" alt="Transformer, theme llama"> | <img src="gallery/themes/transformer.sumi.svg" alt="Transformer, theme sumi"> | <img src="gallery/themes/transformer.sumi-dark.svg" alt="Transformer, theme sumi-dark"> |

## The same auto-layout figure under every theme

The pipeline ([`examples/pipeline`](../examples/pipeline/pipeline.sumi.yaml), automatic layout), with the `paper-single` profile.

| `minimal` | `academic` | `slides` | `color` | `paper` | `llama` | `sumi` | `sumi-dark` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| <img src="gallery/compare/pipeline.minimal.paper-single.svg" alt="Pipeline, theme minimal"> | <img src="gallery/compare/pipeline.academic.paper-single.svg" alt="Pipeline, theme academic"> | <img src="gallery/compare/pipeline.slides.paper-single.svg" alt="Pipeline, theme slides"> | <img src="gallery/compare/pipeline.color.paper-single.svg" alt="Pipeline, theme color"> | <img src="gallery/compare/pipeline.paper.paper-single.svg" alt="Pipeline, theme paper"> | <img src="gallery/compare/pipeline.llama.paper-single.svg" alt="Pipeline, theme llama"> | <img src="gallery/compare/pipeline.sumi.paper-single.svg" alt="Pipeline, theme sumi"> | <img src="gallery/compare/pipeline.sumi-dark.paper-single.svg" alt="Pipeline, theme sumi-dark"> |

`paper-single` imposes a minimum font size (7pt), not a maximum: `slides` text meets it. This pipeline renders within the page limits, with two collision warnings (`geometry/label-collision` and `geometry/edge-crosses-label`). These are distinct from the `geometry/exceeds-page-height` error under `presentation-16x9`, where the larger spacing makes this tall pipeline exceed the slide height; see the [profile comparison](gallery/compare.md). For projection, use `sumi` with `textScale: 2` (or `slides`) on `presentation-16x9`, and a shallower layout.

## Edge label gap

A theme can set the space between an edge label and its line (`edgeLabelGap`, in units of 0.5pt; `sumi catalog --section themes --json` as `themes[].edgeLabelGap`, `null` for the router's 3). `sumi` and `sumi-dark` use 6 (about 1mm from line to glyphs); the other themes keep 3, so reproductions are unchanged. It follows `textScale`.

## Color use

A theme can say how its colors are meant to be used (`colorUse`; `sumi catalog --section themes`, and `--json` as `themes[].colorUse`, `null` when a theme gives none). `sumi` and `sumi-dark` do, so that a figure that picks them looks like them:

| Field | `sumi`, `sumi-dark` | Meaning |
| --- | --- | --- |
| `maxAccentTones` | 3 | the most tones other than `gray` one figure uses; `gray` is the base |
| `preferredVariants` | `tinted`, `outlined`, `emphasis` | pale fills, outlines, and one dark `emphasis` for the element that matters |
| `heavyVariants` | `filled`, `solid` | variants that paint a block of the tone's color |
| `maxHeavyShare` | 0.3 | the most node area that chromatic nodes of a heavy variant may cover |
| `maxSolidNodes` | 0 | the most `solid` nodes with a tone other than `gray`; the theme's own dark block is `emphasis` |

The info diagnostic `geometry/theme-color-use` compares a figure with it and names the tones and variants to change; icons, embedded images and legend samples do not count, and a theme without guidance reports nothing. Gray base, one or two accents, `tinted` for the rest: a figure that does this needs no change.

## Palettes

`figure.themeOverrides.palette: <name>` recolors any theme with one of eight built-in four-color palettes (`cool-blue`, `slate`, `coral`, `terracotta`, `sage`, `lavender`, `cyan-pink`, `seafoam`): text, frames and edges take the palette's ink, group panels its palest color, filled nodes and the `gray` tone its tint, `solid` fills and `emphasis` its accent. Sizes and fonts stay the theme's. Contrasts are measured against the theme's canvas; on a dark canvas (`sumi-dark`) the palette draws a dark variant of itself (panels a step lighter than the canvas, light ink, the accent and tones lightened in their hue). See the [palette gallery](gallery/palettes.md) and `sumi catalog --section palettes`.

An explicit `themeOverrides.tones.<tone>.line` sets that tone's solid fill, including yellow; its text is adjusted to at least 4.5:1 rather than the built-in yellow's 7:1. A `fill`-only tone override does not change solid fills. `solidFills.<tone>` takes precedence over `line` and also applies to solid glyphs and legend samples.

## More

- [Gallery: themes](gallery/themes.md), [tones](gallery/tones.md), [dimmed groups](gallery/dim.md) and the [theme and profile matrix](gallery/compare.md)
- [User guide: themes and profiles](usage.md#themes-and-profiles)
- Japanese: [テーマの比較](themes-ja.md)
