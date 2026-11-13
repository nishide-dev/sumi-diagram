# Mockup first

For a figure whose layout is not obvious, sketch an HTML/CSS mockup limited to what Sumi can
draw, check it, then reproduce it in YAML. In a blind study (8 figures) this beat writing YAML
directly on 6 of 8 (mean 22.0 vs 18.9 of 30), on every criterion, most on colour and
composition. The gain was largest for several panels, loops, state machines, sets and
taxonomies; one-directional flows (a pipeline, a three-row comparison) did better directly. The
mockup's quality caps the result, so fix the mockup, not the YAML, when the picture is wrong.

Use it for: several panels, loops or feedback, state machines, sets and taxonomies, anything
whose arrangement you cannot see before drawing. Skip it for: a one-directional flow, a small
figure (about 6 nodes or fewer), an edit to an existing figure.

## 1. Take the theme's values from Sumi

Never hard-code a theme's colours; read them for the chosen theme and profile, so it works for
any theme.

- `sumi catalog --json --section themes --section profiles`: `canvas`, `fonts` (the font set and
  its styles), `fontSizePt` (`base.node` / `group` / `edge`, `min`), `colorUse` (the theme's
  colour-use guidance: `maxAccentTones`, `preferredVariants`, `heavyVariants`, `maxHeavyShare`;
  `null` means none), `textScaleFor`, `arrowhead`; the profile's width.
- Colours: tone fills and lines are not in the catalog. Render a probe figure in that theme (a
  `tinted` node for each tone you plan to use, one `filled`, one `emphasis`, a group, an arrow;
  `sumi render probe.sumi.yaml`) and copy the fills and strokes from the SVG
  (`grep -o '\(fill\|stroke\)="#[0-9a-f]*"'`). Palettes: `sumi catalog --section palettes`.
- Fonts: `fonts.id` names a bundled set (the font files ship in the release tarball's fonts directory).
  Load them with `@font-face`, else use the closest system face and judge widths with margin.
- Text sizes come from the theme and profile (times `textScale`), in pt. A mockup text smaller
  than the profile minimum is a defect.

Start from [mockup-template.html](mockup-template.html): CSS variables for these values, a page
at the real size, boxes positioned in mm, an inline SVG layer for arrows.

## 2. Draw only what Sumi can draw

Real size: the page is the figure's width and height in CSS `mm` (`@page` and a `#fig` box), text
in `pt` (`calc(8 * 0.3528mm)`), lines 0.75pt. Position everything in mm so a coordinate maps to
`place` (`unit: 1mm`). Inside inline SVG one user unit is 1mm: `stroke-width` 0.265 is 0.75pt, and
use `markerUnits="userSpaceOnUse"` for arrowheads.

Vocabulary (confirm names with `sumi catalog --json`, never invent):

- Nodes: `box`, `square`, `circle`, `ellipse`, `diamond`, `cylinder` and the other catalog
  components; symbols (`operator`, `junction`), `label`, icons, `tokens`, `matrix`, `bracket`,
  `separator`, `legend`, flow markers (`block-arrow`, `triangle-arrow`, `chevron`), `zoom`;
  blank token cells.
- Looks: a tone from the theme's list; variants `default`, `emphasis`, `muted`, `dashed`,
  `dotted`, `filled`, `outlined`, `solid`, `tinted`, `plain`; state markers; corner radius and
  line width only through `themeOverrides`. One font size per role, regular or bold only.
- Groups: a frame with the title above the border or a `caption`; nest them; `dim`.
- `sets`: overlapping ellipses (Venn) or hyperedge enclosures; nothing freehand.
- Edges: straight, orthogonal or curved lines between element sides, an arrowhead from the
  theme's list (open or triangle), solid / dashed / dotted, a label beside the line, never over a
  box or another label. No gradient, shadow, rotation of boxes, free colours or custom shapes.
- Layout: it must be expressible as `row` / `stack` / `grid` / `place` / `chat`. Free positions
  go on a mm grid so each box has one centre.

Colour as the theme's `colorUse` says: white (canvas) ground, at most `maxAccentTones` accent
tones, `preferredVariants` for most boxes, heavy fills (`heavyVariants`) for one focus at most
and within `maxHeavyShare`. The same kind of thing looks the same everywhere.

## 3. Screenshot and check the mockup

Chrome headless at 3 device pixels per CSS px (1mm = 3.78px; window = mm * 3.78, rounded up):

```sh
chrome --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=3 \
  --window-size=605,378 --screenshot=mockup.png file://$PWD/mockup.html   # 160 x 100mm
```

`chrome` is `$SUMI_CHROME`, `google-chrome`, `chromium`, or on macOS
`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` (`scripts/preview` finds the same
binaries but rasterises SVG only, not HTML). Open the PNG with Read. Without Chrome: draw the
mockup as a plain SVG at real size and rasterise it with `scripts/preview` (Quick Look,
`rsvg-convert`), or write the sketch as a table of boxes with mm centres and sizes and judge it
from the first render of the YAML; say that no mockup image was checked.

Check the mockup with the Skill's step 1 checklist (every element, labelled directed edge, input
and output present, arrows the right way) and the readability and visual-language checks of step
7 (reading order, no overlap, one meaning per tone and form, no text-heavy boxes, no block-sized
void without a reason). Fix the mockup until it passes; then reproduce.

## 4. Reproduce it in YAML

- Free layouts (panels, loops, state machines): one `place` per panel with `unit: 1mm`, each
  item at its mockup centre with **`origin: body`** on groups and token sequences, so `at` is the
  body centre and not the larger footprint. Nodes keep their own centre, but a node with an
  attached label or badge grows its footprint: measure the first render and correct by that offset.
- Regular layouts: `row` / `stack` / `grid` for aligned parts (taxonomy columns, token rows); `gap` in
  mm. Sizes: `width` / `height` in mm are fine (rounded to 0.5pt); text sizes and weights come
  from the theme, not the mockup.
- Edges: `from` / `to` plus `fromAnchor` / `toAnchor` for the sides the mockup uses; loops and
  jogs need both anchors. Tone and variant from the mockup's colour roles.
- Sets: `sets` with `shape: ellipse` and the mockup's `angle`; group titles `labelAt`.
- Render, `lint --geometry`, compare the SVG with the mockup PNG side by side (`scripts/compare`
  stacks images), and correct YAML toward the mockup; change the mockup only when it was wrong.

Keep a short log beside the figure (a few lines, not a report): the mockup rounds, and each place
Sumi did not match it, for example text weight or size not settable, corner radius, a footprint
offset, default gaps looser than drawn. Report those to the user with the final figure.
