# Figure format (`*.sumi.yaml`, Figure Schema v1)

Structured arrange trees also accept `grid: { columns, rowGap?, columnGap?, align?, items }`;
items may use `{ item: ID-or-box, span: N }` for column spans. See
[grids](structured.md#grids) for complete-row and alignment rules.

The authoritative definitions are `schema/figure.v1.schema.json` (generated)
and `docs/design/phase1.md` §2 in the repository. This page is the subset you
need to write a figure.

## Sample-driven waveform (0.10.0)

`component: waveform` (`sumi/waveform`) accepts required `props.samples`:
2–2048 finite amplitudes in [-1, 1]. `mode: bars` (default) mirrors absolute
amplitudes about the center; `mode: line` joins signed values. All samples are
evenly spaced without resampling. Optional `width` / `height` use normal size
lengths; omitted sizes fit an optional label below the signal (minimum 80×48pt).
Variants: `default`, `emphasis`, `muted`, `outlined`. Use `outlined` plus a
`tone` to color the signal and frame; other variants tone the background.
Works in auto and structured layouts and SVG/PDF/picture/native editable PPTX.
Supply actual data or explicitly identified illustrative samples; do not invent
audio measurements. No audio decoding, seed mode, playback, or random synthesis.

```yaml
version: 1
figure: { id: waveform-example }
nodes:
  - id: signal
    component: waveform
    variant: outlined
    tone: red
    props:
      samples: [0, -0.2, 0.7, -1, 0.4, 0]
      mode: line
      width: 80pt
      height: 48pt
```

## Structure

```yaml
version: 1                 # required, always 1
# requires: ">=0.5.0"      # optional: the oldest Sumi that can draw the figure
figure:                    # required
  id: request-flow         # required ID
  title: Request handling  # optional, not drawn
  theme: minimal           # optional, default minimal
  # themeOverrides: { nodeCorners: square, edgeCorners: sharp, groupLabelWeight: regular }
  profile: paper-single    # optional, default paper-single
  # fit: scale             # optional (0.6.0): shrink a too-wide figure to the profile width (layout-tips)
  layout:
    direction: down        # optional: right (default) | down | left | up
    # arrange: …           # optional: switches to the structured layout (structured.md)
    # align: […]¹, fanIn: merge | spread¹   (structured.md)
    # density: compact¹    # optional (0.6.0): tighter default gaps and padding (layout-tips)
groups: []                 # optional
nodes: []                  # optional (an empty figure gets a lint warning)
edges: []                  # optional
metadata: {}               # optional, any JSON-compatible data; not drawn
```

| Element | Fields (required in bold) | Defaults |
| --- | --- | --- |
| group | **`id`**, `label`, `labelAt`, `caption`, `component`, `variant`, `tone`, `dim`, `group`, `arrange`¹ | component `container`, variant `default`, no tone, not dimmed, no parent |
| node | **`id`**, **`component`**, `label`, `sublabel`¹, `labelRotation`¹, `textAlign`¹, `grow`¹, `variant`, `tone`, `mono`, `icon`, `badge`, `props`, `group`, `attach`¹ | variant `default`, no label, no tone, no group, grow `1` |
| edge | **`from`**, **`to`**, `id`, `label`, `labelAt`¹, `labelSide`¹, `component`, `variant`, `tone`, `props`, `fromAnchor`¹, `toAnchor`¹ | component `arrow`, variant `default`, no tone |

¹ Structured layout only (a figure with `figure.layout.arrange`); see
[structured](structured.md): `sublabel` ([sublabels](structured.md#sublabels)),
`labelRotation` (`90` / `-90`, [turned labels](structured.md#turned-labels)).
`grow`: `0 < grow <= 1000`, relative extra-space weight under the immediate
row/stack's `justify: stretch`, in whole 0.5pt increments (largest remainder,
visual-order ties), not a final-size ratio. Sub-unit remainder is centered padding.
No effect without extra space, in other justify modes, grid/attach, on fixed
main-axis sizes or non-stretchable shapes; does not inherit. Expanded tokens,
matrix and legend reject it with `component/grow-unsupported`.
`icon` / `badge`: [assets](assets.md). The `bowtie` outline component,
corner badges and corner `attach.side` values are new in 0.7.0.
`bowtie` takes `props.gap: 8` to draw two separate opposing trapezoids
with one label centered across both halves and the gap when its resolved text
is readable on the white page (contrast at least 4.5:1). Lower-contrast text
(including `solid` white text) sits on the left painted body, sized to hold it.
Centered labels fit the total width without doubling it; `filled` text may overlay the bodies. Stroked
variants report label/outline crossings: use `filled` or leave enough gap for
the text (0 or omitted keeps the joined shape). Gap is a number
from 0–64 in D2 units (each 0.5pt), clamped to half the width for a small
explicit size. The whole node, including the gap, blocks other edges; a
north/south port aimed into the gap moves to the nearest painted lip (left
on a tie). Structured layout aligns a movable neighbour with that lip when
the original ports were aligned; otherwise an unavoidable lip step is
reported as `layout/unaligned-ends`. `trapezoid` takes `props.narrow: south|north|east|west` to choose
the narrow edge; the default `south` keeps the wide top. Both work in auto
and structured layouts and as native editable PPTX shapes; badges remain
picture-PPTX only.
Group `labelAt` / `caption`: [groups](#groups);
`dim` (both engines): [dimmed groups](#dimmed-groups).

**Versions.** Group `labelAt` / `caption`, edge `labelAt` / `labelSide`,
`figure.layout.align` / `fanIn`, label-math accents and the `legend`
component are new in 0.5.0. The paper-figure features are new in 0.6.0:
`figure.fit`, `figure.layout.density`, `sublabel`, `labelRotation`, group
`dim`, edge `tone`, `straight` anchors, the `paper` theme, the `filled`,
`outlined`, `plain` and `dashed` variants, and the `zoom`, `tokens` and
`matrix` components. When you use them and `sumi --version` prints that
version or later, you may add `requires: ">=0.5.0"` (or `">=0.6.0"`): an
older Sumi then stops with one clear `schema/unsatisfied-requires` instead
of a list of unknown fields. A CLI that prints an older version (e.g. a
source checkout between releases) fails on it too: leave it out.

Every object is strict: an unknown key is an error (`schema/unknown-field`).
There is no per-element style, color, font or coordinate field — appearance
is chosen with `variant` and `tone` (below), size with the `width` /
`height` props of node components (see the catalog), and position by the
layout: `direction` in auto figures, arrange trees, `attach` and edge
anchors in structured ones ([structured](structured.md)).

## Tones

`tone` on a node or group picks a color category: `gray`, `red`, `orange`,
`yellow`, `green`, `blue`, `purple` or `pink`. The theme decides the color:
`color` and `paper` fill each tone with its own pastel hue; `minimal`, `academic` and
`slides` stay monochrome and map the tones to three gray fills (tones in the
same step look alike: yellow/green, gray/orange/blue, red/purple/pink). A tone
changes only the fill, on top of the variant. Use tones to encode categories
consistently (e.g. all attention blocks `orange`), not for decoration; when the
user wants distinguishable colors, use theme `color` (or `paper` for a paper
figure).

```yaml
nodes:
  - { id: attention, component: box, label: Attention, tone: orange }
  - { id: norm, component: box, label: Norm, tone: yellow }
```

**Colored frames and lines** (0.6.0): with `variant: outlined`
(box-like shapes, `operator`, `stack`) the tone colors the **outline and
the text** of a white node instead of its fill — boxes with a colored
border and colored text, as in many paper figures (an encoder, token
cells, keys). Without a tone an outlined node takes tone gray's line. On
an **edge**, `tone` colors the line, its arrowheads and its label. Both
use the tone's line color: a dark shade of the hue in `color` and `paper`
(readable as text), one of three grays in the monochrome themes.

```yaml
nodes:
  - { id: encoder, component: box, label: H3 Encoder, tone: purple, variant: outlined }
  - { id: vae, component: box, label: VAE Encoder, tone: orange, variant: outlined }
edges:
  - { from: encoder, to: vae, tone: orange }
```

- `solid` gives a shape a strong tone fill and white text (pressed keys,
  operators); `tinted` gives it a pastel fill, matching colored border and
  colored text (encoders, action cells). Both default to gray without `tone`,
  work on box-like shapes, `operator` and `stack`, and can be selected in
  tokens cells and legend node samples. For non-dimmed nodes, all built-in
  themes meet 4.5:1 text contrast; tinted ink darkens just enough to contrast
  with its pastel fill. Solid stacks use white separators to distinguish layers.
  Example: `{ id: encoder, component: box, label: Encoder, tone: purple, variant: tinted }`.
  Inside `dim: true`, text and borders take dim gray and fills lighten;
  solid fills remain areas, and their dim gray text darkens as needed to keep
  at least 3:1 contrast. Dimmed solid stacks use that text gray for separators.
- `mono: true` on a node draws its label and sublabel in the theme's
  monospace font (BIZ UDGothic in every built-in theme), e.g. class names,
  code, prompts. `mono: false` turns off a variant's monospace text. Math
  between `$...$` keeps the math fonts, and `\textcolor` spans keep their
  colors, so `A photo of a $\textcolor{blue}{\text{\{object\}}}$.` works.
  On a tokens node `mono` is the default of its cells; a cell can set its own.
  It is a field of nodes (and tokens cells), not of groups or edges.
- Pick `outlined` for white with colored frame and text, the default variant
  for pastel with a black frame, or `filled` for pastel without a frame.
- Two edges of different tones that enter the same point of a node overlap
  (the shared entry, [fan-in](structured.md)): give them different
  `toAnchor`s (e.g. `north` and `south`) or `fanIn: spread`.
- Inside a group with `dim: true` ([dimmed groups](#dimmed-groups)), an
  outlined frame and a toned edge take the dim gray like everything else.
- An older CLI reports `component/unknown-variant` for `outlined` and
  `schema/unknown-field` for an edge's `tone`: leave them out.

## Dimmed groups

`dim: true` on a group draws it pale together with everything inside it —
nested groups, nodes (also legends and tokens cells), its caption, and the
edges whose two ends are both inside — e.g. the panels of variants a paper
compares against but does not use. Text and lines take the theme's dim gray
and fills move toward white (a tone stays recognizable but pale); sizes,
dashes, fonts and the layout do not change, and the group keeps its own
`variant` and `tone`. Write it once on the group instead of `variant: muted`
on every element.

```yaml
groups:
  - { id: cross, caption: Block with cross-attention, dim: true, arrange: … }
```

- Only `true` is accepted (omit the field otherwise); it cannot be turned off
  inside a dimmed group, and a nested `dim` changes nothing.
- An edge with one end outside the group (into or out of it, a `zoom` from
  outside) is drawn as written. To dim it too, move both ends inside or give
  it `variant: muted`.
- `component: image` inside a dimmed group is drawn as it is
  (`theme/undimmed-image`, warning): Sumi dims by color, never by opacity.

## IDs

- Pattern `^[a-z][a-z0-9_-]{0,63}$`: lowercase letter first, then lowercase
  letters, digits, `_`, `-`. No uppercase, dots, spaces or non-ASCII.
- Nodes and groups share one ID space (a node and a group cannot both be
  `api`). Edge IDs are a separate space and optional; an edge without `id`
  is referred to as `edges[<index>]` in diagnostics.
- IDs are data, not text: a node without `label` is drawn without text
  (the ID is never shown). Derive IDs from the label (`Load data` → `load-data`).

## Labels

- Plain text. `\n` inside a double-quoted string breaks the line; in a
  single-quoted or unquoted label it is drawn as the two characters `\n`
  (`lint/literal-newline`). No Markdown or HTML. Math and line breaks in
  one label: [below](#math-and-line-breaks-in-one-label).
- Label math: see [below](#label-math).
- Structured labels support `\textcolor{<tone>}{…}` inside `$…$` only:
  `label: 'The character $\textcolor{orange}{\text{\{stands still\}}}$, camera $\textcolor{blue}{\text{\{holds steady\}}}$'`.
  Wrap words in `\text{…}`; escape visible braces as `\{` / `\}`. Use a tone
  name (the eight names above), never a raw color. The theme's tone-line text
  color is used in SVG, PDF and PPTX; inherited `dim` overrides it.
  Outside math it stays literal; inside `\text{…}` the existing escape rules
  apply. Auto math stays literal with its usual warning.
  Tone-line text colors guarantee contrast against white, not against toned
  fills; span colors do not adapt to the background. For example, a paper
  node with `tone: orange` and
  `label: '$\textcolor{orange}{\text{Highlight}}$'` uses text `#bd5410` on fill
  `#f9e0bc` (about 3.70:1). Prefer a white fill for colored phrases when you
  need the tone-line contrast guarantee.
- `textAlign: left | center | right` on a node (structured only) aligns its
  label and sublabel lines within their shared, widest-line text block.
  Omit it for the existing centered output. It does not wrap text or change
  node padding. Add line breaks explicitly for narrow prompt boxes.
- Quote labels that YAML could misread: `"yes"`, `"no"`, `"on"`, numbers
  (`"2024"`), anything with `: ` or ` #`, or starting with `[`, `{`, `*`, `&`, `!`, `%`, `@`.
- Keep lines short: the `lint/long-label` rule warns above 40 columns per
  line (CJK characters count as 2) or more than 4 lines.
- Japanese and other CJK text is supported by the bundled font; emoji and
  rare characters are not (`lint/missing-glyph`). Structured figures also
  draw characters such as `₂` or `∼` with the bundled math font.

## Label math

Structured figures only. Auto figures draw every label as written,
dollar signs included; math with a command, `_` or `^` gets a
`component/unsupported-in-auto` warning, but `$x$` lints clean and still
shows its `$`. `$...$` inside any label (nodes, groups, edges) is a small TeX
subset drawn as real, searchable text in the bundled STIX Two math fonts:

- Letters and lowercase Greek are italic variables (`$x$`, `$\alpha$`, or
  `α` typed directly); digits, uppercase Greek and symbols are upright.
- `_` / `^`: one level of subscript / superscript, one character or `{…}`
  (`$W_{\mathrm{out}}$`, `$x_{ij}$`; not `$x_{i_j}$`). Scripts are 0.7×
  the label size; a sub- and superscript on one base are drawn one after
  the other, not stacked (`$x_i^2$`).
- Commands: Greek (`\alpha` … `\omega`, `\Gamma` …), operators and
  relations (`\times` `\cdot` `\pm` `\oplus` `\otimes` `\odot` `\leq`
  `\geq` `\neq` `\approx` `\sim` `\equiv` `\in` `\to` `\Rightarrow`
  `\mapsto` …), `\infty` `\partial` `\nabla` `\sum` `\prod` `\int` `\ldots`
  `\cdots` `\langle` `\rangle`, functions (`\log` `\exp` `\sin` `\tanh` `\max`
  …; others as `\operatorname{softmax}`; no space is added after a
  function name: `$\tanh\,x$`), `\mathrm{…}`, `\mathit{…}`,
  `\text{…}` (any text, Japanese too).
- **Accents**: `\hat` `\tilde` `\bar` `\dot` `\ddot` `\vec` over **one**
  character or command: `$\hat{y}$`, `$\hat y$`, `$\tilde{x}$`,
  `$\bar\theta$`, `$\vec{W}$`, `$\hat{\nabla}$`. A script after the
  accent belongs to the accented letter (`$\hat\theta_t$`); accents also
  work inside scripts (`$x_{\hat i}$`) and `\mathrm{…}`. The accent keeps
  the font of what it covers: a letter stays an italic variable, while
  `$\mathrm{\hat{y}}$` and `$\hat{\nabla}$` stay upright.
- Spacing: spaces inside `$...$` are ignored; Sumi adds TeX's space around
  binary operators and relations, but **none after a comma**: write
  `$x_1,\,\ldots,\,x_n$` for spaced lists (`\,` `\:` `\;` `\quad` `~`).
- Math is drawn in regular weight even in bold labels (`emphasis`).
- `\$` (outside `$...$`) is a literal dollar sign; in auto figures it is
  drawn as written.
- Not supported (`component/invalid-math`): `\frac`, `\sqrt`, `\mathbf`,
  `\mathbb`, wide accents (`\widehat`, `\widetilde`, `\overline`,
  `\overrightarrow`, …), an accent over several characters (`\hat{xy}`,
  `\hat{x_t}`: write `\hat{x}_t`) or over another accent (`\hat\hat x`),
  matrices, `$$`, nested scripts, an unclosed `$` or `{`,
  characters it does not know (`@`, `ℝ`, `ŷ`, …). Rewrite with
  the subset (`a/b`, `\mathrm{…}`, `\hat{y}` for `ŷ`), put text in
  `\text{…}`, or type a special character outside the `$...$`
  (`'$x \in$ ℝ$^d$'`: structured figures draw `ℝ`, `₂`, `∼`, `⋯` and
  similar with the math font). For a bar over several letters
  (`\overline{xy}`), ask whether another notation will do
  (`$\bar{x}\bar{y}$`, `$z^{*}$`). Before 0.5.0 accents were errors too:
  with an older CLI, type the accented letter outside the `$...$`
  (`'ŷ$_t$'`) or write `$y'$`.
- **Quote math labels in single quotes**: backslashes stay literal
  (`label: '$\alpha_1$'`). In a flow mapping (`{ … }`) a label containing
  `,` must be quoted, otherwise YAML splits it and Sumi reports
  `schema/unknown-field` for the rest (`Unknown field "\beta_1$"`):
  `{ id: ss, …, label: '$\gamma_1,\,\beta_1$' }`. In double quotes `\` must be
  doubled.

### Math and line breaks in one label

Single quotes keep backslashes but never break the line:
`'Scale, Shift\n$\gamma_1$'` is drawn on one line with a visible `\n`
(`lint/literal-newline` warns). For a label with both, use one of:

- **Double quotes, every math backslash doubled**: `\n` breaks the line,
  `\\gamma` is `\gamma`, `\\,` is `\,`.
- **A block scalar `|-`**: each line of the block is a line of the label
  and backslashes stay literal. Use `|-`, not `|`: `|` keeps the final
  newline, which adds an empty last line (no diagnostic).

```yaml
nodes:
  - { id: ss1, component: box, label: "Scale, Shift\n$\\gamma_1,\\,\\beta_1$" }
  - id: ss2
    component: box
    label: |-
      Scale, Shift
      $\gamma_2,\,\beta_2$
```

Both draw two lines: `Scale, Shift`, then γ and β with their subscripts
(structured figures; math is drawn as written in auto ones). Inside `$...$`, `\nu`,
`\neq` and `\nabla` are commands, not line breaks, and are not reported.

## Groups

- A group is a container drawn around its members. Membership is declared
  on the **child**: `group: <group-id>` on a node or on another group
  (nesting is allowed; cycles are `ref/group-cycle`).
- A group's only group component is `container` (check the catalog).
- Groups can be edge endpoints.
- `labelAt` places the group's `label` (its title) inside the border:
  `top-left`, `top`, `top-right`, `bottom-left`, `bottom`, `bottom-right`.
  Default: `top-left` in auto figures, `top` (centre) in structured ones.
  Move it away from the side where edges enter.
- `caption` adds a sub-figure caption centered under the border
  (`caption: (a) data and augmentation`), outside the group. Both engines;
  details and an example in
  [structured](structured.md#group-titles-and-captions). In structured
  figures, edges to elements below a captioned group can detour around
  the caption when it blocks their route (see there).
- `variant: muted` (container) quiets the group; how depends on the
  theme. `academic`: a **dashed** gray border, gray title, transparent
  fill. `minimal`, `color`, `slides`, `paper`: the same solid gray border, a white
  background instead of the shaded one (without `tone`; a `tone` sets the
  fill) and a gray, non-bold title. In `academic`, a muted group's dashed border reads like
  a dashed edge (a skip, an optional flow): avoid `muted` there when the
  figure has dashed edges, or say what each means (a `legend`). `muted`
  quiets only the group's own frame and title; to make a whole panel pale
  with its contents, use [`dim: true`](#dimmed-groups) instead.
- Frame variants (container, every theme): `plain` draws neither border
  nor fill, only the title and caption (a panel of a multi-panel figure
  whose caption must line up with the framed panels' ones); `filled` a
  shaded fill without a border; `dashed` a dashed border without a fill.
  A `tone` sets the fill of any of them (`plain` with a tone looks like
  `filled`: use `filled`). A border that is not drawn is not reported by
  the geometry lint (`edge-near-border`, a label over the border), and an
  edge label inside a `plain` group gets the background beneath it.
- In structured figures, membership follows the group's `arrange` tree;
  `group:` can be omitted ([structured](structured.md#arrange-trees)).

## Edges and the connection table

| Case | Result |
| --- | --- |
| node ↔ node | allowed |
| node ↔ group, group ↔ group | allowed |
| self-loop (`from` = `to`) | allowed, `lint/self-loop` info |
| several edges between the same pair | allowed; identical ones (same endpoints, component and label) get `lint/duplicate-edge` |
| group ↔ its own descendant | allowed, but `lint/ancestor-edge` warning (the line crosses the group border and label) |
| unknown endpoint | error `ref/unknown-endpoint` |

Direction comes from the edge component, not from a field: `arrow` points
`from` → `to`, `double-arrow` has heads at both ends, `line` has none.
`zoom` (structured only) is not a connection but a callout: two dashed
lines from the corners of `from` to those of `to` (see
[structured](structured.md#zoom-callouts)).

## Components, variants and props

Always take these from `sumi catalog --json`. Each entry has `id`
(`sumi/<name>`; in YAML write either `box` or `sumi/box`), `kind`
(`node` / `group` / `edge` — a node component cannot be used for an edge),
`variants` and `props` (a JSON Schema; `additionalProperties: false`).

- Variants are a closed list per component (typically `default`, `emphasis`,
  `muted`; edges also `dashed`). Use them to encode meaning consistently
  (e.g. `muted` for secondary elements), not for decoration.
- `variant: filled` (box-like shapes and `operator`, not `stack`) draws
  the fill without the outline: a borderless block, as in many paper
  figures. Give it a `tone`; without one it takes tone gray's fill. A
  variant is one value, so a block cannot be both `filled` and `muted`
  (but a `filled` block inside a group with `dim: true` is drawn pale).
- `variant: outlined` (box-like shapes, `operator` and `stack`) draws a
  white node whose outline and text take the tone's line color
  ([tones](#tones)).
- Node sizes (`props.width` / `props.height`) are lengths with a unit
  (`mm`, `cm`, `in`, `pt`) and must be a multiple of 0.5pt. Many mm values
  are not (`12mm` = 34.02pt); prefer `pt` (`34pt`). Omit sizes unless needed:
  nodes are sized to their labels.
- `label` components (`sumi/label`) draw text without a border and need a
  non-empty label.
- `image` embeds a PNG, JPEG or SVG file (`props.src`, plus `width` or
  `height`), and `icon: tabler/<name>` puts a bundled icon in a node in
  place of its label. `props.layers: { count: 4, offset: 3pt }` stacks unchanged
  copies up-right, with a footprint that includes them: see [assets](assets.md).
- `operator` draws a small circle with a symbol (`props.symbol`: `plus`,
  `minus`, `times`, `dot` or `concat`) and `junction` a small dot where lines
  branch or merge. Both take **no label** (`component/unexpected-label`) and no
  size props: the theme sizes them. In `paper`, an operator has a 7pt symbol
  in a 14pt circle with a 0.5pt outline (emphasis: 1.5pt; filled: no outline).
  These are sizes before `fit: scale`; other themes keep their own sizes.
  `junction` takes no `tone`. Connect into a
  junction with `line` (an arrowhead would cover the dot). `variant: hidden`
  draws no dot: lines meet smoothly there (use it only where no other line
  crosses nearby, since the dot is what tells a join from a crossing), and an
  arrow into a hidden junction ends in open space. Introduced in 0.4.0;
  use them only when the installed CLI lists them.
- `legend` (structured only, 0.5.0) draws a key of sample lines and boxes
  with their meaning (`props.entries`); the catalog marks it with
  `"engines": ["structured"]`. See [structured](structured.md#legends).
  Components without `engines` work in both engines.
- `zoom` (edge, structured only, 0.6.0) joins an element to a view that
  shows it enlarged: see [structured](structured.md#zoom-callouts).
- `tokens` (structured only) writes a row of cells (sequence tokens,
  keys) as one node; edges name a cell as `<node>.<cell>`, or the whole
  sequence as `<node>` (0.10.0): see
  [structured](structured.md#token-sequences).
- `bracket` (structured only, 0.10.0) is a square bracket or curly brace
  that gathers the elements it is `attach`ed to (a whole `tokens` node, a
  group, a matrix); edges leave from its spine: see
  [structured](structured.md#brackets).
- `matrix` (structured only) draws a grid of cells colored by class
  (tone, variant, `pattern: hatch`) with row and column headers, e.g. an
  attention mask; cells may hold text (`{ class, text }`) and ellipsis
  slots (`ellipsisRows` / `ellipsisColumns`, `{ ellipsis: "…" }`); a legend
  entry `{ class: <matrix>.<class> }` explains a class: see
  [structured](structured.md#matrices).

### Catalog render metadata

A node component manifest may include a `render` block. For example, this
metadata identifies an outline renderer with fixed, validated parameters:

```json
{
  "type": "outline",
  "renderer": "sumi/trapezoid",
  "params": { "slant": 0.4 }
}
```

When present, `catalog --json` keeps this block as the component entry's
`render` field, including parameter defaults applied during registration.
Without it the component uses its ordinary D2 shape. This is **manifest /
catalog metadata**, not a field to write in Figure YAML or `props`. A renderer
ID is not a component ID: select the component listed in the catalog.

The render pipeline composes these outlines and adjusts labels and edge ends.
It measures auto-sized outlines with two D2 passes; explicit width and height
use one pass. A written dimension is preserved when only one is specified.
The built-in `trapezoid` and `stack` node components use these renderers
(introduced in 0.3.0; use them only when the installed CLI lists them).
`trapezoid` has a wider top and narrower bottom; `stack` draws three overlapping
rectangles with the label on the front one. Both offer `default`, `emphasis`
and `muted`, with optional `width` / `height` props. Slant, layer count and
offset are fixed manifest parameters, not YAML props. Other ordinary built-in
components omit `render`.

```yaml
# expect-render: fits
version: 1
figure:
  id: outline-pipeline
  theme: academic
  profile: paper-double
  layout: { direction: right }
groups:
  - { id: processing, label: Processing }
nodes:
  - { id: filter, component: trapezoid, label: Filter, group: processing }
  - { id: jobs, component: stack, label: Jobs, variant: emphasis, group: processing }
edges:
  - { from: filter, to: jobs }
```

## Themes and profiles

They are built in; there is no way to define your own in a figure.
`figure.themeOverrides` refines the selected theme for this figure only:
`nodeCorners: square` removes node/group frame radii, including expanded
matrix/tokens cells and legend frames. Intrinsically curved shapes (circles,
cylinders, curly brackets) retain their outlines. Editable PPTX frames use
miter stroke joins. Auto/D2 figures also get square node/group frames.
Independently, `edgeCorners: sharp` draws structured wires with sharp turns
and T-joins at hidden junctions/forks, butt caps and miter joins. Routed
bends stay connected for real miter joins while shared trunks are drawn once.
Zoom wires (including dashed ones) also use butt caps and miter joins in SVG,
PDF and picture PPTX. Editable
PPTX wires use flat caps and miter joins in both freeform and glued modes;
auto/D2 wire routing remains D2's. Use both options for square frames and
sharp wires, or only `edgeCorners: sharp` to keep rounded frames.
`groupLabelWeight: regular | bold` overrides every group heading's weight,
including expanded frames. Omit any field to keep its existing default.
These are figure-wide presets, not per-element styles; theme colors, fonts,
spacing and line widths remain selected by the built-in theme.
The override object is strict: unknown keys produce `schema/unknown-field`,
and unsupported values produce `schema/invalid-value`, located at the key
or value in the YAML.
`sumi catalog --json` lists them (see
[below](#discovering-themes-and-profiles)); the hint of `theme/unknown` /
`profile/unknown` names them too. The tables are a summary.

| Theme | Look |
| --- | --- |
| `minimal` | monochrome with clear outlines (default) |
| `academic` | grayscale, print-friendly journal style: 0.5pt black lines, square corners, groups without fill, tones as gray steps, gray emphasis; no color |
| `slides` | for slides: 16pt text (14pt on edges, 18pt container labels), 2pt lines; use with `presentation-16x9` |
| `color` | general purpose with color: like `minimal`, but tones are pastel fills and emphasis is blue (0.4.0) |
| `paper` | color ML-paper style: pastel tone fills, rounded boxes (2pt) and groups (6pt), black 1pt frames, light gray groups, thin 0.5pt edges with small arrowheads, Inter for Latin text (0.6.0) |

`minimal`, `academic`, `color` and `paper` use 8pt text (7pt on edges).

Choosing between the two paper themes: `academic` is for a journal that
prints in black and white (nothing in it is colored, tones become gray steps);
`paper` is for the colored figures of ML papers (pastel tones, rounded
corners). Both fit `paper-single` / `paper-double`. A figure's look is the
theme alone: the same YAML renders under either with `--theme`.
`minimal`, `academic`, `slides` and `color` use the bundled
`sumi/biz-ud-gothic` font set (Latin and Japanese). `paper` uses
`sumi/inter-biz-ud-gothic`: in structured figures Latin text is drawn with
Inter, Japanese with BIZ UDPGothic; auto (D2) figures stay all BIZ UDPGothic.
Inter is narrower than BIZ UDPGothic but its line box is taller (1.21em
against 1.00em), so a small node with explicit `width` / `height` can fail
`geometry/label-overflow` under `paper`. For a one-character key or token
in a square, make the side about 1.4× the text size (11pt for 8pt text);
this is only for such single-character squares, not a rule for widths:
longer labels need their measured width, so prefer leaving `width` /
`height` out and letting the node size itself.

| Profile | Max width | Max height | Min font size | Use |
| --- | --- | --- | --- | --- |
| `paper-single` | 88mm | — | 7pt | one column of a two-column paper (default) |
| `paper-double` | 180mm | — | 7pt | full page width |
| `presentation-16x9` | 338.7mm | 190.5mm | 14pt | slides; only `slides` meets its 14pt minimum (see layout-tips) |

`sumi render --theme <name> --profile <name>` overrides them for one render
without editing the file.

With `figure.fit: scale` (0.6.0) a figure wider than the profile is printed
smaller, at the profile's width; text is then checked at its printed size
against the profile's minimum for scaled figures (5pt for the paper profiles,
`minScaledFontSize` in `sumi catalog --json`; see
[layout-tips](layout-tips.md#shrinking-to-the-page-width-figurefit-scale)).

## Discovering themes and profiles

```sh
sumi catalog --json --section themes --section profiles
```

prints `{ "version": 1, "themes": [...], "profiles": [...] }` (plain
`sumi catalog --json` adds `components`). One entry of each:

```json
{
  "version": 1,
  "themes": [
    {
      "id": "minimal",
      "description": "Monochrome theme with clear outlines",
      "fonts": {
        "id": "sumi/biz-ud-gothic",
        "description": "BIZ UDPGothic (regular, bold) and BIZ UDGothic (mono) v1.051: Latin and Japanese; STIX Two Math and STIX Two Text Italic v2.13 (math): label math; OFL-1.1",
        "styles": ["regular", "bold", "mono"]
      },
      "fontSizePt": { "min": 7, "max": 9, "base": { "node": 8, "group": 9, "edge": 7 } },
      "missingVariants": {},
      "tones": ["gray", "red", "orange", "yellow", "green", "blue", "purple", "pink"],
      "toneLines": ["gray", "red", "orange", "yellow", "green", "blue", "purple", "pink"],
      "compatibleProfiles": ["paper-single", "paper-double"]
    }
  ],
  "profiles": [
    {
      "id": "paper-single",
      "description": "Single-column figure in a two-column paper",
      "page": {
        "maxWidth": { "written": "88mm", "pt": 249.45, "mm": 88 },
        "maxHeight": { "written": "220mm", "pt": 623.62, "mm": 220 }
      },
      "margin": { "written": "2mm", "pt": 5.67, "mm": 2, "d2Units": 11 },
      "typography": {
        "minFontSize": { "written": "7pt", "pt": 7, "mm": 2.47 },
        "minScaledFontSize": { "written": "5pt", "pt": 5, "mm": 1.76 }
      },
      "layout": {
        "layerGap": { "written": "8mm", "pt": 22.68, "mm": 8, "d2Units": 45 },
        "containerPadding": { "written": "4mm", "pt": 11.34, "mm": 4, "d2Units": 23 }
      }
    }
  ]
}
```

- `compatibleProfiles`: profiles whose minimum font size every component
  and variant of the theme meets. A profile outside it fails
  with `profile/font-too-small` for labelled elements; changing the theme
  or profile is the user's decision.
- `fonts.styles`: `italic: true` / `mono: true` need `italic` / `mono` here.
- `missingVariants`: variants the theme does not style (they fall back to
  `default` with `theme/missing-variant`); empty for the built-ins.
- `tones`: the tone names the theme colors (every tone for the built-ins).
- `page.maxWidth` / `maxHeight` (`null` = no limit) include the margin.
  `layerGap` is the space between layers; nodes in the same layer are always
  10pt apart.
- `typography.minScaledFontSize` (paper profiles, 5pt): the minimum printed
  font size once `figure.fit: scale` shrinks a figure; absent means
  `minFontSize`.

After rendering, `sumi render --json` (and each result of
`sumi lint --geometry --json`) reports the output size against these limits
in `size` (`null` if nothing was rendered):

```json
{
  "size": {
    "widthPt": 138.5,
    "heightPt": 439,
    "widthMm": 48.86,
    "heightMm": 154.87,
    "profile": { "id": "paper-single", "maxWidthMm": 88, "maxHeightMm": 220, "minFontSizePt": 7 },
    "fits": true
  }
}
```

`fits` covers width and height only; font sizes are reported as
diagnostics. With `figure.fit: scale` the sizes are the printed ones and
`"scale"` (e.g. `0.7004`) is added when the figure was shrunk.

## Output formats

`sumi render -o figure.svg`, `-o figure.pdf`, or `-o figure.pptx` selects the
format by extension; `--format svg|pdf|pptx` is explicit. SVG alone supports stdout.
PPTX is one picture with outlined SVG plus PNG fallback: shapes and text are not
individually editable, and a slide app's PDF export need not stay vector.
The picture keeps its physical size; slide sides under 1 inch are padded, and
over 56 inches are rejected. PNG aims for 192dpi, bounded to 8192px per side and
about 16 million pixels. `--json` size still describes the figure, not added padding.
Do not promise SVG support in every app; app verification is recorded in the
repository's `docs/verification/61-pptx.md`.

Only when the user requests experimental editable objects, use
`--pptx-mode editable`; it refuses figures with icons or images
(`pptx/unsupported-asset`). The default `--pptx-connectors freeform` preserves
the initial route but does not glue edges. `--pptx-connectors glued` replaces
routes with straight connectors; labels do not follow later edits. Fonts
are referenced, not embedded, and may be substituted by the viewer. Do not
promise exact appearance, layout preservation after editing, grouped
container movement or YAML round-trip. See the repository's
`docs/verification/62-editable-pptx.md` for the Mac verification and limits.

## YAML restrictions

One document per file (no `---`), no anchors / aliases / merge keys (`&`,
`*`, `<<`), no tags (`!foo`), no duplicate keys. Comments are fine and are
preserved by `sumi fmt`.

## Common mistakes

| Mistake | Diagnostic | Fix |
| --- | --- | --- |
| `id: LoadData` | `schema/invalid-id` | `id: load-data` (the hint suggests the lowercase form) |
| `component: server`, `component: database` | `component/unknown` | pick from the catalog (`box`, `cylinder`, …) |
| `component: box` on an edge | `component/wrong-kind` | `arrow`, `line` or `double-arrow` |
| `variant: bold`, `variant: thick` | `component/unknown-variant` | a variant listed for that component |
| `color:`, `style:`, `shape:` on a node | `schema/unknown-field` | remove; use a component, variant or `tone` |
| `label: $\gamma_1,\beta_1$` inside `{ … }` | `schema/unknown-field` (`"\beta_1$"`) | single-quote it: `label: '$\gamma_1,\,\beta_1$'` |
| `label: 'Scale\n$\gamma$'` (single quotes and `\n`) | `lint/literal-newline` (warning; drawn on one line with `\n`) | `"Scale\n$\\gamma$"` or a `\|-` block ([math and line breaks](#math-and-line-breaks-in-one-label)) |
| `$\alpha_1$` (math with a command, `_` or `^`) in an auto figure | `component/unsupported-in-auto` (warning; `$x$` gets none but is drawn with its `$`) | use the structured layout, or plain text |
| `label:` and `icon:` on one node | `asset/icon-with-label` | keep one; put the text in an attached `label` node |
| `toAnchor: west` in an auto figure | `layout/structured-only` | remove it, or switch to the structured layout |
| edge `labelAt`, `align`, `fanIn`, `density` or a `legend` in an auto figure | `layout/structured-only` | remove it, or switch to the structured layout (group `labelAt` and `caption` are fine) |
| `labelAt: top-center` on a group, `labelAt: end` on a group | `schema/invalid-value` | group: `top-left`, `top`, `top-right`, `bottom-left`, `bottom`, `bottom-right`; edge: `start`, `middle`, `end` |
| `labelSide: above` / `north` on an edge | `schema/invalid-value` | `left` or `right`, relative to the direction of travel |
| `'$\widehat{xy}$'`, `'$\hat{xy}$'` | `component/invalid-math` | one character per accent: `'$\hat{x}\hat{y}$'`, or another notation |
| a node with ID `train-caption` when group `train` has a caption | `ref/reserved-id` | rename the node |
| `props: { width: 10px }` | `component/invalid-prop` | `mm` / `cm` / `in` / `pt`, multiple of 0.5pt |
| `children:` / `nodes:` inside a group | `schema/unknown-field` | put `group: <id>` on each child |
| `label: 2024` | `schema/invalid-type` | `label: "2024"` |
| `label: Step 1: parse` | `yaml/syntax` | quote the label |
| edge to a misspelled ID | `ref/unknown-endpoint` | use the ID from the hint |
| `theme: dark`, `profile: a4` | `theme/unknown`, `profile/unknown` | a built-in name from the tables above |
| `variant: muted` on every node and edge of a panel to make it pale | (none; the tone fills stay strong) | `dim: true` on the group |
| `requires: ">=0.6.0"` with a CLI that prints 0.5.x | `schema/unsatisfied-requires` | upgrade, or leave `requires` out (and the 0.6.0 fields the CLI rejects) |
