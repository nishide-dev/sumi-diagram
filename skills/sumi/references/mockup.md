# Mockup first

For a figure whose layout is not obvious, sketch an HTML/CSS mockup limited to what Sumi can
draw, check it, then reproduce it in YAML. In a blind study (8 figures) this beat writing YAML
directly on 6 of 8 (mean 22.0 vs 18.9 of 30), on every criterion, most on colour and
composition. The gain was largest for several panels, loops, state machines, sets and
taxonomies; one-directional flows (a pipeline, a three-row comparison) did better directly. The
mockup's quality caps the result, so fix the mockup, not the YAML, when the picture is wrong.

Rule: if the arrangement is not obvious, mock it up, however few nodes there are (a three-state
machine with a loop, two panels, a Venn pair). Several panels, loops or feedback, state machines,
sets and taxonomies qualify. Skip it only when the arrangement is obvious: a one-directional flow
(a pipeline, a three-row comparison). Size and editing an existing figure are secondary: a small
edit that keeps the layout needs none.

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

Fill these CSS variables in [mockup-template.html](mockup-template.html) (a page at the real
size, boxes positioned in mm, an inline SVG layer for arrows): `--canvas`; `--ink` and the
tone fills and lines from the probe; `--font`; `--fs-node`, `--fs-group`, `--fs-edge` in pt
(`fontSizePt.base` times `figure.themeOverrides.textScale`, rounded to 0.5pt as Sumi does; the
catalog's `textScaleFor` gives the scale a profile needs);
`--frame-w` and `--edge-w` in pt (the theme's line widths: `themeOverrides` `frameWidth` / `lineWidth` when set, else
measure the probe SVG's `stroke-width` against its width in mm; `paper` draws 1pt frames and 0.5pt edges);
`--arrow` (the arrowhead's colour: the edge colour). Nothing in the page uses a literal colour.

## 2. Draw only what Sumi can draw

Real size: the page is the figure's width and height in CSS `mm` (`@page` and a `#fig` box), text
in `pt` via the `--fs-*` variables, lines via `--frame-w` / `--edge-w`. Position everything in mm so a
coordinate maps to `place` (`unit: 1mm`). Inside inline SVG one user unit is 1mm (1pt = 0.3528mm), and
use `markerUnits="userSpaceOnUse"` for arrowheads.

Vocabulary (confirm names with `sumi catalog --json`, never invent):

- Nodes: `box`, `square`, `circle`, `ellipse`, `diamond`, `cylinder` and the other catalog
  components; symbols (`operator`, `junction`), `label`, icons, `tokens`, `matrix`, `bracket`,
  `separator`, `legend`, flow markers (`block-arrow`, `triangle-arrow`, `chevron`), `zoom`;
  blank token cells.
- Looks: a tone from the theme's list; a variant from that component's own entry in the catalog
  (variants differ by component, e.g. `tinted`, `outlined`, `emphasis`, `dashed`); state markers
  (`sumi/initial`, `sumi/final`); corner radius and line width only through `themeOverrides`. One font size per role, regular or bold only.
- Groups: a frame with the title inside the border (`labelAt: top-left` / `top` / `top-right`) or above it (`labelAt: above-left` / `above` / `above-right`, structured layout), or a `caption`; the frame's `props.padding` (inner margin); nest them; `dim`.
- `sets`: overlapping ellipses (Venn) or hyperedge enclosures; nothing freehand.
- Edges: straight, orthogonal or curved lines between element sides, an arrowhead from the
  theme's list (open or triangle), solid / dashed / dotted, a label beside the line, never over a
  box or another label. No gradient, shadow, rotation of boxes, free colours or custom shapes.
- Layout: it must be expressible as `row` / `stack` / `grid` / `place` / `chat`. Free positions
  go on a mm grid so each box has one centre.

Ground: the theme's `canvas` (`sumi` #f8f8ee, `sumi-dark` #30364f, `minimal` white). Where
`colorUse` is not `null`, follow it: at most `maxAccentTones` accent tones, `preferredVariants`
for most boxes, heavy fills (`heavyVariants`) for one focus at most and within `maxHeavyShare`.
Otherwise colour only for meaning, 2-3 hues plus one accent. The same kind of thing looks the
same everywhere.

## 3. Screenshot and check the mockup

Chrome headless at 3 device pixels per CSS px (1mm = 3.78px; window = mm * 3.78, rounded up):

```sh
chrome="${SUMI_CHROME:-$(command -v google-chrome || command -v chromium || echo "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")}"
url="$(python3 -c 'import pathlib,sys; print(pathlib.Path(sys.argv[1]).resolve().as_uri())' mockup.html)"
"$chrome" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=3 \
  --window-size=605,378 --screenshot="$PWD/mockup.png" "$url"   # 160 x 100mm
```

The first line picks `$SUMI_CHROME`, else `google-chrome` / `chromium` on `PATH`, else the macOS
path; the second builds a percent-encoded `file://` URL (`scripts/preview` finds the same binaries but rasterises SVG only, not HTML). Open the PNG with Read. Without Chrome: the mockup is a disposable sketch, not a deliverable (SKILL.md's rule against
drawing SVG is about the figure itself), so you may write it as plain SVG at real size and
rasterise it with `scripts/preview` (Quick Look, or `rsvg-convert`, which ignores embedded fonts:
judge layout, not typography). With no rasteriser at all, write the sketch as a table of boxes
with mm centres and sizes, check it against the checklist as text, go on to the YAML, and tell the
user that no mockup image was checked.

Check the mockup with the Skill's step 1 checklist (every element, labelled directed edge, input
and output present, arrows the right way) and the readability and visual-language checks of step
7 (reading order, no overlap, one meaning per tone and form, no text-heavy boxes, no block-sized
void without a reason). Fix the mockup until it passes; then reproduce.

## 4. Reproduce it in YAML

- Free layouts (panels, loops, state machines): one `place` per panel with `unit: 1mm`, each
  item at its mockup centre. A node's `at` is always its own body centre (attached labels and
  badges do not move it); write **`origin: body`** on groups and token sequences, whose default
  `at` is the centre of the frame grown to hold attached nodes. A `place` box is normalised to
  its contents: page coordinates do not keep outer whitespace, nor the alignment between
  separately placed panels, so put panels in a `row` / `stack` / `grid` (or one `place`) and align
  them there, then check the render against the mockup.
- Regular layouts: `row` / `stack` / `grid` for aligned parts (taxonomy columns, token rows); `gap` in
  mm. Sizes: `width` / `height` in mm are fine (rounded to 0.5pt); text sizes and weights come
  from the theme, not the mockup.
- Edges: `from` / `to` plus `fromAnchor` / `toAnchor` for the sides the mockup uses; loops and
  jogs need both anchors. Tone and variant from the mockup's colour roles.
- Sets: `sets` with `shape: ellipse` and the mockup's `angle`; group titles `labelAt`.
- Render, `lint --geometry`, compare the SVG with the mockup PNG (`scripts/compare --side figure.svg mockup.png`
  puts them side by side; without `--side` they are stacked), and correct YAML toward the mockup; change the mockup only when it was wrong.

Keep a short log beside the figure (a few lines, not a report): the mockup rounds, and each place
Sumi did not match it, for example text weight or size not settable, corner radius, a footprint
offset, default gaps looser than drawn. Report those to the user with the final figure.
