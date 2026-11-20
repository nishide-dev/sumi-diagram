# Default sizes, gaps and paddings

What a structured figure is made of before you write any size: the profile's
spacing and the natural size of each node component. Use it to plan widths (and the
`place` coordinates of a [mockup](mockup.md)) before the first render, so the first
draft is close to the page width instead of 200–460mm wide.

- A row is as wide as its items plus `(items - 1) × gap`; a stack as wide as its widest
  item; a grid as its column widths plus `(columns - 1) × columnGap`.
- A group (a panel) adds its padding on both sides: `props.padding` replaces the
  profile's (a multiple of 0.5pt, e.g. `3pt` for a tight frame). Nested plain groups used
  only for arranging cost that padding each: use an arrange box (`row`, `stack`) instead.
- A box is its label plus the node padding on each side, so its width grows with the
  text: about 1.6mm per Latin character of 8pt text (`sumi/label` below is "Encoder" alone),
  2.8mm per Japanese character.
  A title wider than the group's content sets the group's width.
- `align: stretch` draws the items of a stack as wide as the widest; the widest one still
  sets the width. `sumi render --explain-width` prints every group's and box's natural
  width, padding and gaps, and marks what sets the width; `geometry/exceeds-page-width`
  names it and gives values that fit ([diagnostics](diagnostics.md#too-wide-the-width-breakdown)).
- Text sizes and the sizes below scale with `figure.themeOverrides.textScale`; gaps and
  paddings come from the profile and do not.

The tables are generated from the code (`bun run test src/cli/skill-sizes.test.ts`
checks them; `SUMI_UPDATE_GOLDEN=1` rewrites them).

<!-- BEGIN GENERATED SIZES -->
### Spacing (structured layout)

| profile | density | `gap` (rows, stacks, grid gaps) | group padding (each side) | a group adds to the width | node padding left/right, top/bottom | margin | max width |
| --- | --- | --- | --- | --- | --- | --- | --- |
| paper-single | normal | 4mm | 8pt (2.82mm) | 5.64mm | 7pt, 3.5pt | 1.94mm | 88mm |
| paper-single | compact | 2.5mm | 6pt (2.12mm) | 4.23mm | 7pt, 1.5pt | 1.94mm | 88mm |
| paper-double | normal | 4mm | 8pt (2.82mm) | 5.64mm | 7pt, 3.5pt | 1.94mm | 180mm |
| paper-double | compact | 2.5mm | 6pt (2.12mm) | 4.23mm | 7pt, 1.5pt | 1.94mm | 180mm |
| screen-doc | normal | 6mm | 12pt (4.23mm) | 8.47mm | 10.5pt, 5pt | 3mm | 200mm |
| screen-doc | compact | 4mm | 9pt (3.18mm) | 6.35mm | 10.5pt, 2pt | 3mm | 200mm |
| presentation-16x9 | normal | 8mm | 16pt (5.64mm) | 11.29mm | 14pt, 7pt | 4.06mm | 338.7mm |
| presentation-16x9 | compact | 5mm | 12pt (4.23mm) | 8.47mm | 14pt, 3pt | 4.06mm | 338.7mm |

### Node sizes with the one-word label "Encoder" (theme `sumi`, width × height)

| component | paper (`paper-single` / `paper-double`) | `screen-doc`, textScale 1.5 | `presentation-16x9`, textScale 2 |
| --- | --- | --- | --- |
| `sumi/box` | 16.05mm × 6mm | 24.17mm × 8.82mm | 32.1mm × 11.99mm |
| `sumi/square` | 16.05mm × 16.05mm | 24.17mm × 24.17mm | 32.1mm × 32.1mm |
| `sumi/circle` | 13.23mm × 13.23mm | 19.76mm × 19.76mm | 26.46mm × 26.46mm |
| `sumi/ellipse` | 22.75mm × 8.64mm | 34.22mm × 12.52mm | 45.51mm × 17.11mm |
| `sumi/diamond` | 32.1mm × 11.99mm | 48.33mm × 17.64mm | 64.21mm × 23.99mm |
| `sumi/hexagon` | 22.75mm × 6mm | 34.57mm × 8.82mm | 45.51mm × 11.99mm |
| `sumi/parallelogram` | 23.46mm × 6mm | 31.57mm × 8.82mm | 39.51mm × 11.99mm |
| `sumi/cylinder` | 16.05mm × 18.7mm | 24.17mm × 21.52mm | 32.1mm × 24.69mm |
| `sumi/document` | 16.05mm × 8.11mm | 24.17mm × 11.99mm | 32.1mm × 16.23mm |
| `sumi/trapezoid` | 20.99mm × 6mm | 31.22mm × 8.82mm | 41.8mm × 11.99mm |
| `sumi/bowtie` | 16.05mm × 11.99mm | 24.17mm × 17.64mm | 32.1mm × 23.99mm |
| `sumi/stack` | 18.87mm × 8.82mm | 26.99mm × 11.64mm | 34.93mm × 14.82mm |
| `sumi/bracket` | 2.12mm × 8.47mm (no label) | 2.12mm × 8.47mm (no label) | 2.12mm × 8.47mm (no label) |
| `sumi/bubble` | 20.99mm × 10.94mm | 31.57mm × 16.23mm | 41.98mm × 21.87mm |
| `sumi/block-arrow` | 4.59mm × 2.82mm (no label) | 6.88mm × 4.23mm (no label) | 9.17mm × 5.64mm (no label) |
| `sumi/triangle-arrow` | 2.65mm × 2.82mm (no label) | 3.88mm × 4.23mm (no label) | 5.12mm × 5.64mm (no label) |
| `sumi/chevron` | 2.12mm × 2.82mm (no label) | 3mm × 4.23mm (no label) | 4.06mm × 5.64mm (no label) |
| `sumi/initial` | 3.53mm × 3.53mm (no label) | 5.29mm × 5.29mm (no label) | 7.06mm × 7.06mm (no label) |
| `sumi/final` | 4.94mm × 4.94mm (no label) | 7.41mm × 7.41mm (no label) | 9.88mm × 9.88mm (no label) |
| `sumi/label` | 11.11mm × 3.53mm | 16.76mm × 5.29mm | 22.23mm × 7.06mm |
| `sumi/operator` | 5.64mm × 5.64mm | 8.47mm × 8.47mm | 11.29mm × 11.29mm |
| `sumi/operator` (`size: large`) | 8.47mm × 8.47mm | 12.7mm × 12.7mm | 16.93mm × 16.93mm |
| `sumi/operator` (`size: xlarge`) | 11.29mm × 11.29mm | 16.93mm × 16.93mm | 22.58mm × 22.58mm |
| `sumi/junction` | 1.06mm × 1.06mm (no label) | 1.59mm × 1.59mm (no label) | 2.12mm × 2.12mm (no label) |

Sized by their props, not by a label (see `sumi catalog`): `sumi/cuboid`, `sumi/image`, `sumi/html`, `sumi/waveform`, `sumi/legend`, `sumi/tokens`, `sumi/matrix`. A `sumi/separator` spans its row and takes no width beyond the gaps around it.
<!-- END GENERATED SIZES -->
