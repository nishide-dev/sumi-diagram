# Themes

A theme decides how a figure looks: colors, corners, line widths, groups and fonts. It never changes the layout rules or the page limits, which belong to the [profile](usage.md#themes-and-profiles). Choose one with `figure.theme` or `--theme`; the same YAML renders under every theme.

Sumi has five built-in themes:

- **`minimal`** (default): monochrome with clear outlines. A neutral starting point.
- **`academic`**: grayscale and print-friendly, in the manner of a journal. Nothing is colored, so the figure prints the same on a black-and-white printer.
- **`color`**: general purpose with color. The lines and type of `minimal`, with pastel tones and a blue accent.
- **`paper`**: color ML-paper style, after published Transformer and DiT figures: pastel tones, rounded corners, thin frames and edges, light gray panels, Inter for Latin text.
- **`slides`**: large text and thick lines for projection, used with the `presentation-16x9` profile.

`academic` and `paper` are both for papers; choose by how the paper is printed. **Grayscale or black-and-white print: `academic`. A color ML paper: `paper`.**

## Comparison

| | `minimal` | `academic` | `slides` | `color` | `paper` |
| --- | --- | --- | --- | --- | --- |
| Purpose | general, neutral default | journal figures, grayscale print | projection | general, with color | color ML-paper figures |
| Color | monochrome; tones are 3 gray steps | grayscale only; tones are 3 gray steps | monochrome, darker grays; tones are 3 gray steps | pastel tone fills, blue emphasis | pastel tone fills and colored tone lines; blue is one of the tones |
| Corners | square | square | square | square | rounded (boxes 2pt, groups 6pt) |
| Lines | 1pt, emphasis 2pt | 0.5pt, emphasis 1pt | 2pt, emphasis 4pt | 1pt, emphasis 2pt | frames 1pt, edges 0.5pt (small arrowheads); emphasis: shapes 1.5pt, edges 1pt |
| Groups | light gray fill, gray frame | no fill, gray frame | light gray fill, gray frame | light gray fill, gray frame | light gray panel, black 1pt frame, rounded |
| Font | BIZ UDPGothic; 8pt, edges 7pt | BIZ UDPGothic; 8pt, edges 7pt | BIZ UDPGothic; 16pt, edges 14pt | BIZ UDPGothic; 8pt, edges 7pt | Inter for Latin text in structured figures, BIZ UDPGothic for Japanese; 8pt, edges 7pt |
| Typical profile | `paper-single`, `paper-double` | `paper-single`, `paper-double` | `presentation-16x9` | `paper-single`, `paper-double` | `paper-single`, `paper-double` |

## The same structured figure under every theme

The Transformer ([`examples/transformer`](../examples/transformer/transformer.sumi.yaml), structured layout), drawn with `--theme` overrides. `slides` uses its own profile, `presentation-16x9`, and this tall figure is taller than a slide there.

| `minimal` | `academic` | `slides` | `color` | `paper` |
| --- | --- | --- | --- | --- |
| <img src="gallery/themes/transformer.minimal.svg" alt="Transformer, theme minimal"> | <img src="gallery/themes/transformer.academic.svg" alt="Transformer, theme academic"> | <img src="gallery/themes/transformer.slides.svg" alt="Transformer, theme slides"> | <img src="gallery/themes/transformer.color.svg" alt="Transformer, theme color"> | <img src="gallery/themes/transformer.paper.svg" alt="Transformer, theme paper"> |

## The same auto-layout figure under every theme

The pipeline ([`examples/pipeline`](../examples/pipeline/pipeline.sumi.yaml), automatic layout), with the `paper-single` profile.

| `minimal` | `academic` | `slides` | `color` | `paper` |
| --- | --- | --- | --- | --- |
| <img src="gallery/compare/pipeline.minimal.paper-single.svg" alt="Pipeline, theme minimal"> | <img src="gallery/compare/pipeline.academic.paper-single.svg" alt="Pipeline, theme academic"> | <img src="gallery/compare/pipeline.slides.paper-single.svg" alt="Pipeline, theme slides"> | <img src="gallery/compare/pipeline.color.paper-single.svg" alt="Pipeline, theme color"> | <img src="gallery/compare/pipeline.paper.paper-single.svg" alt="Pipeline, theme paper"> |

`paper-single` imposes a minimum font size (7pt), not a maximum: `slides` text meets it. This pipeline renders within the page limits, with two collision warnings (`geometry/label-collision` and `geometry/edge-crosses-label`). These are distinct from the `geometry/exceeds-page-height` error under `presentation-16x9`, where the larger spacing makes this tall pipeline exceed the slide height; see the [profile comparison](gallery/compare.md). For projection, use `slides` with `presentation-16x9` and a shallower layout.

## More

- [Gallery: themes](gallery/themes.md), [tones](gallery/tones.md), [dimmed groups](gallery/dim.md) and the [theme and profile matrix](gallery/compare.md)
- [User guide: themes and profiles](usage.md#themes-and-profiles)
- Japanese: [テーマの比較](themes-ja.md)
