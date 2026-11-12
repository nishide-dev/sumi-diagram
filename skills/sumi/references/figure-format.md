# Figure format (`*.sumi.yaml`, Figure Schema v1)

**Purpose.** The subset of the schema you need to write a figure. The
authoritative definitions are `schema/figure.v1.schema.json` (generated) and
`docs/design/phase1.md` §2 in the repository; component props always come from
`sumi catalog --json`.

Contents: [structure](#structure) · [feature versions](#feature-versions) ·
[IDs](#ids) · [labels](#labels) · [label math](#label-math) ·
[tones and variants](#tones-and-variants) · [dimmed groups](#dimmed-groups) ·
[groups](#groups) · [edges](#edges-and-the-connection-table) ·
[components](#components-variants-and-props) · [themes and profiles](#themes-and-profiles) ·
[discovering them](#discovering-themes-and-profiles) · [output formats](#output-formats) ·
[YAML restrictions](#yaml-restrictions) · [common mistakes](#common-mistakes)

## Structure

```yaml
version: 1                 # required, always 1
# requires: ">=0.5.0"      # optional: the oldest Sumi that can draw the figure
figure:                    # required
  id: request-flow         # required ID
  title: Request handling  # optional, not drawn
  theme: minimal           # optional, default minimal
  # themeOverrides: { palette: cool-blue, nodeCorners: square, edgeCorners: sharp }
  profile: paper-single    # optional, default paper-single
  # target: { height: 60mm, minFontSize: 5pt, minLineWidth: 0.5pt } # placement lint
  # fit: scale             # optional: shrink a too-wide figure to the profile width (layout-tips)
  # assets: { photo: { svg: … } }   # optional: pictures shared by image nodes (assets.md)
  layout:
    direction: down        # optional: right (default) | down | left | up
    # arrange: …           # optional: switches to the structured layout (structured.md)
    # align: […]¹, alignGrowth: allow¹, fanIn: merge | spread¹   (structured.md)
    # density: compact¹    # optional: tighter default gaps and padding (layout-tips)
groups: []                 # optional
nodes: []                  # optional (an empty figure gets a lint warning)
edges: []                  # optional
sets: []                   # optional: enclosures around nodes that may overlap¹ (structured.md)
metadata: {}               # optional, any JSON-compatible data; not drawn
```

| Element | Fields (required in bold) | Defaults |
| --- | --- | --- |
| group | **`id`**, `label`, `labelAt`, `caption`, `component`, `variant`, `tone`, `dim`, `group`, `arrange`¹ | component `container`, variant `default`, no tone, not dimmed, no parent |
| node | **`id`**, **`component`**, `label`, `sublabel`¹, `labelRotation`¹, `textAlign`¹, `grow`¹, `variant`, `tone`, `mono`, `icon`, `iconSize`, `badge`, `glyphs`, `props`, `group`, `attach`¹ | variant `default`, no label, no tone, no group, grow `1` |
| set¹ | **`id`**, **`members`**, `label`, `labelAt`, `shape`, `angle`, `padding`, `enclose`, `variant`, `tone`, `fillOpacity` | shape `circle`, labelAt `top`, enclose `body`, variant `default`, no tone (gray), padding = the profile's group padding |
| edge | **`from`**, **`to`**, `id`, `label`, `labelAt`¹, `labelSide`¹, `route`¹, `component`, `variant`, `tone`, `props`, `fromAnchor`¹, `toAnchor`¹ | component `arrow`, variant `default`, no tone |

¹ Structured layout only (a figure with `figure.layout.arrange`):
[structured](structured.md) (`grow`: [filling extra height](structured.md#arrange-trees)).
Exception: `bubble` supports `textAlign` in auto layout too.
`icon` / `badge` / `glyphs`: [assets](assets.md#glyphs). Group `labelAt` / `caption`: [groups](#groups).

Every object is strict: an unknown key is `schema/unknown-field`. There is no
general per-element style, colour, font or coordinate field: appearance is
`variant` and `tone`, size the `width` / `height` props of node components, and
position the layout (`direction` in auto figures; arrange trees, `attach` and
anchors in structured ones). Conversations use a [`chat` arrange box](structured.md#chat-conversations)
with ordinary `bubble` nodes, speakers, meta notes and date dividers.

In built-in chromatic themes, the yellow tone's line (edges and outlined or
tinted frames; not a solid node, whose outline is its bright fill) has at least
3:1 contrast on white and the theme's default group fill. Darker fills, including palette-filled panels, and
explicit overrides are not guaranteed.

## Feature versions

`sumi --version` prints the installed CLI's version. Newer fields are errors
on an older CLI (`schema/unknown-field`, `component/unknown`,
`component/unknown-variant`): upgrade, or leave the feature out. Write
`requires: ">=X"` only when `sumi --version` prints X or later: an older Sumi then
stops with one `schema/unsatisfied-requires` instead of a list of unknown fields
(a source checkout between releases fails on it too: leave it out).

| Since | Features |
| --- | --- |
| 0.4.0 | structured layout (`arrange`, `attach`, anchors), `operator`, `junction`, icons, `image`, theme `color` |
| 0.5.0 | group `labelAt` / `caption`, edge `labelAt` / `labelSide`, `figure.layout.align` / `fanIn`, label-math accents, `legend` |
| 0.6.0 | `paper` theme; `filled` / `outlined` / `plain` / `dashed` variants, edge `tone`, group `dim`, `figure.fit`, `layout.density`, `sublabel`, `labelRotation`, `straight` anchors, `zoom`, `tokens`, `matrix` |
| 0.7.0 | `bowtie`, corner badges and corner `attach.side`, `emoji/` icons, dotted `tokens` dividers |
| 0.10.0 | inline SVG images, `waveform`, `bracket`, whole-sequence `tokens` edges, matrix text and ellipsis cells |
| 0.11.0 | `html` component |
| 0.12.0 | `separator`, `figure.assets` with `crop` and tokens image cells, operator `size`, grid hints, width-overflow breakdown |
| 0.16.0 | `sets`: overlapping enclosures for Venn diagrams and hyperedges (`shape: ellipse` with `angle`: tilted ellipses); node `glyphs`; `legend` samples `icon` / `glyph` / `set`, `flow`, `perRow`, `heading`, `labelAt`; node `iconSize` (and a legend `icon` entry's) sizes an icon without an enclosing shape; a `tone` on an icon-only `label` colours the icon (a legend `icon` entry: `iconTone`); stroke options: `themeOverrides` `lineWidth` / `frameWidth` / `arrowheadScale` / `cornerRadius`, element `lineWidth` / `cornerRadius` / `arrowheadScale`, `dotted` variant; `block-arrow`, `triangle-arrow`, `chevron` flow markers |
| 0.16.1 | Set `enclose: footprint` includes member glyphs and padding; the default `body` preserves existing outlines. |

## IDs

- Pattern `^[a-z][a-z0-9_-]{0,63}$`: lowercase first, then lowercase letters,
  digits, `_`, `-`. No uppercase, dots, spaces or non-ASCII.
- Nodes and groups share one ID space. Edge IDs are a separate, optional space
  (an edge without `id` is `edges[<index>]` in diagnostics).
- IDs are data, not text: a node without `label` is drawn without text. Derive
  IDs from the label (`Load data` → `load-data`).

## Labels

- Plain text. `\n` inside a double-quoted string breaks the line; in a single-
  quoted or unquoted label it is drawn as the two characters (`lint/literal-newline`).
  No Markdown or HTML. Math and line breaks together:
  [below](#math-and-line-breaks-in-one-label).
- Quote labels YAML could misread: `"yes"`, `"no"`, `"on"`, numbers (`"2024"`),
  anything with `: ` or ` #`, or starting with `[`, `{`, `*`, `&`, `!`, `%`, `@`.
- Keep lines short: `lint/long-label` warns above 40 columns per line (CJK
  counts 2) or more than 4 lines.
- Japanese and other CJK text is supported by the bundled font; emoji and rare
  characters are not (`lint/missing-glyph`). Structured figures also draw
  characters such as `₂` or `∼` with the bundled math font.
- Structured labels support `\textcolor{<tone>}{…}` inside `$…$` only:
  `label: 'The character $\textcolor{orange}{\text{\{stands still\}}}$, camera $\textcolor{blue}{\text{\{holds steady\}}}$'`.
  Wrap words in `\text{…}`; escape visible braces as `\{` / `\}`. Use a tone name
  (the eight below), never a raw colour. The theme's tone-line text colour is used
  in SVG, PDF and PPTX; inherited `dim` overrides it. Outside math it stays
  literal; in auto figures math stays literal with its usual warning. Tone-line
  colours guarantee contrast against white, not toned fills (a paper node with
  `tone: orange` and `$\textcolor{orange}{\text{Highlight}}$` gives `#bd5410` on
  `#f9e0bc`, about 3.70:1): prefer a white fill for coloured phrases.
- `textAlign: left | center | right` (structured, or `bubble` in either layout): [text align](structured.md#text-align). Bubbles default to `left`.
- `mono: true` on a node (and tokens cells; not groups or edges) draws label and
  sublabel in the theme's monospace font (BIZ UDGothic in every built-in theme):
  class names, code, prompts. `mono: false` turns off a variant's monospace text;
  math keeps its fonts and `\textcolor` spans their colours
  (`A photo of a $\textcolor{blue}{\text{\{object\}}}$.`). On a tokens node it is
  the cells' default.

## Label math

In structured labels, write ordinary spaces around inline math, e.g.
`'Timestep $t$'`. SVG preserves spaces at text-run boundaries (including in
librsvg); no non-breaking-space workaround is needed. PDF and PPTX keep the
same text and measured spacing.

Structured figures only. Auto figures draw every label as written, dollar signs
included (math with a command, `_` or `^` gets `component/unsupported-in-auto`).
`$...$` inside any label (nodes, groups, edges) is a small TeX subset drawn as
real, searchable text in the bundled STIX Two math fonts:

- Letters and lowercase Greek are italic variables (`$x$`, `$\alpha$`, or `α`
  typed directly); digits, uppercase Greek and symbols are upright.
- `_` / `^`: one level of sub/superscript, one character or `{…}`
  (`$W_{\mathrm{out}}$`; not `$x_{i_j}$`), 0.7× the label size; both on one base
  are drawn one after the other, not stacked.
- Commands: Greek (`\alpha` … `\omega`, `\Gamma` …), operators and relations (`\times`
  `\cdot` `\pm` `\oplus` `\otimes` `\odot` `\leq` `\geq` `\neq` `\approx` `\sim` `\equiv`
  `\in` `\to` `\Rightarrow` `\mapsto` …), `\infty` `\partial` `\nabla` `\sum` `\prod` `\int`
  `\ldots` `\cdots` `\langle` `\rangle` `\emptyset`, functions (`\log` `\exp` `\sin` `\tanh` `\max` …;
  others `\operatorname{softmax}`; no space after one: `$\tanh\,x$`), `\mathrm{…}`,
  `\mathit{…}`, `\text{…}` (any text, Japanese too).
- Write ∅ ("no object", empty set) as `$\emptyset$`: a typed ∅ in Inter looks like ø.
- **Accents** `\hat` `\tilde` `\bar` `\dot` `\ddot` `\vec` over **one** character
  or command: `$\hat{y}$`, `$\hat y$`, `$\bar\theta$`, `$\hat{\nabla}$`. A script
  after the accent belongs to the accented letter (`$\hat\theta_t$`); accents work
  inside scripts and `\mathrm{…}`; they keep the font of what they cover.
- Spacing: spaces inside `$...$` are ignored; Sumi adds TeX's space around binary
  operators and relations but **none after a comma**: `$x_1,\,\ldots,\,x_n$`
  (`\,` `\:` `\;` `\quad` `~`). Math is regular weight even in bold labels.
  `\$` outside `$...$` is a literal dollar sign.
- Not supported (`component/invalid-math`): `\frac`, `\sqrt`, `\mathbf`,
  `\mathbb`, wide accents (`\widehat`, `\widetilde`, `\overline`,
  `\overrightarrow`), an accent over several characters (`\hat{xy}`,
  `\hat{x_t}`: write `\hat{x}_t`) or another accent, matrices, `$$`, nested
  scripts, an unclosed `$` or `{`, unknown characters (`@`, `ℝ`, `ŷ`). Use the
  subset (`a/b`, `\hat{y}` for `ŷ`), put text in `\text{…}`, or type a special
  character outside `$...$` (`'$x \in$ ℝ$^d$'`). For a bar over several letters
  try `$\bar{x}\bar{y}$` or `$z^{*}$`.
- **Quote math labels in single quotes** (backslashes stay literal:
  `label: '$\alpha_1$'`). In a flow mapping `{ … }` a label with `,` must be
  quoted or YAML splits it (`schema/unknown-field`, `Unknown field "\beta_1$"`):
  `{ id: ss, …, label: '$\gamma_1,\,\beta_1$' }`. In double quotes double every `\`.

### Math and line breaks in one label

Single quotes keep backslashes but never break the line (`'Scale, Shift\n$\gamma_1$'`
is one line with a visible `\n`; `lint/literal-newline`). Use either:

- **Double quotes, every math backslash doubled**: `\n` breaks the line,
  `\\gamma` is `\gamma`, `\\,` is `\,`.
- **A block scalar `|-`** (not `|`, which keeps a final newline and adds an empty
  last line): each line is a line of the label, backslashes stay literal.

```yaml
nodes:
  - { id: ss1, component: box, label: "Scale, Shift\n$\\gamma_1,\\,\\beta_1$" }
  - id: ss2
    component: box
    label: |-
      Scale, Shift
      $\gamma_2,\,\beta_2$
```

Both draw two lines (structured figures; auto draws the math as written). Inside
`$...$`, `\nu`, `\neq` and `\nabla` are commands, not line breaks.

## Tones and variants

`tone` on a node or group picks a colour category: `gray`, `red`, `orange`,
`yellow`, `green`, `blue`, `purple`, `pink`. The theme decides the colour:
`color` and `paper` give each its own pastel hue; `minimal`, `academic` and
`slides` map them to three gray fills (yellow/green, gray/orange/blue,
red/purple/pink look alike). Use tones to encode categories consistently (all
attention blocks `orange`), not for decoration; when the user wants
distinguishable colours use `color` (`paper` for a paper figure).

```yaml
nodes:
  - { id: attention, component: box, label: Attention, tone: orange }
  - { id: encoder, component: box, label: Text Encoder, tone: purple, variant: outlined }
edges:
  - { from: attention, to: encoder, tone: orange }
```

Variants (closed list per component; typically `default`, `emphasis`, `muted`;
edges also `dashed` and `dotted`) change how the tone is drawn:

| Variant | Looks | Works on |
| --- | --- | --- |
| `default` | tone as a pastel fill, black frame | all |
| `filled` | tone fill without outline (a block cannot be both `filled` and `muted`) | box-like shapes, `operator` (not `stack`) |
| `outlined` | white node, outline and text in the tone's line colour (without a tone: gray's line) | box-like shapes, `operator`, `stack` |
| `tinted` | pastel fill, matching coloured border and text (encoders, highlighted cells); text ink darkens just enough for 4.5:1 | box-like shapes, `operator`, `stack` |
| `solid` | strong tone fill with contrasting text (yellow uses dark ink); solid stacks use contrasting separators | box-like shapes, `operator`, `stack` |
| `muted`, `emphasis` | quieter / heavier | most; `emphasis` on an edge: heavier line and head (`paper`: black 1pt vs 0.5pt) |

`outlined`, `tinted`, `solid` can also be set on tokens cells and legend node
samples. On an **edge**, `tone` colours the line, arrowheads and label (the tone's
line colour: a dark hue in `color` / `paper`, one of three grays in the monochrome
themes). All built-in themes keep 4.5:1 text contrast for non-dimmed nodes. Two
edges of different tones entering the same point of a node overlap: give them
different `toAnchor`s or `fanIn: spread`. Inside a `dim: true` group, outlined
frames and toned edges take the dim gray.

## Dimmed groups

`dim: true` on a group draws it pale together with everything inside: nested groups, nodes
(legends and tokens cells too), its caption and the edges whose two ends are both inside:
the panels of variants a paper compares against. Text and lines take the theme's dim gray
and fills move toward white (tones stay recognisable); sizes, dashes, fonts and layout do
not change. Write it once on the group instead of `variant: muted` on every element (tone
fills stay strong).

```yaml
groups:
  - { id: gated, caption: (c) Gated variant, dim: true, arrange: … }
```

- Only `true` is accepted; it cannot be turned off inside. An edge with one end outside is
  drawn as written: move both ends inside or give it `variant: muted`.
- An `image` inside is drawn as is (`theme/undimmed-image`, warning): Sumi dims by colour,
  never opacity; colour emoji keep their palette too.

## Groups

- A group is a container drawn around its members. Membership is declared on the
  **child**: `group: <group-id>` on a node or another group (nesting is allowed;
  cycles are `ref/group-cycle`). In structured figures membership follows the
  group's `arrange` tree and `group:` can be omitted.
- The only group component is `container`. Groups can be edge endpoints.
- `labelAt` places the title inside the border: `top-left`, `top`, `top-right`,
  `bottom-left`, `bottom`, `bottom-right` (default `top-left` in auto, `top` in
  structured). `caption` adds a sub-figure caption centred under the border
  (`caption: (a) data and augmentation`), both engines. Details:
  [titles and captions](structured.md#group-titles-and-captions).
- Variants: `muted` quiets the frame and title (`academic`: a **dashed** gray
  border, which reads like a dashed edge: avoid it there when the figure has dashed
  edges or say what each means; other themes: a solid gray border and a white
  background, a `tone` sets the fill). `plain` draws neither border nor fill, only
  title and caption (a panel whose caption must line up with framed panels);
  `filled` a shaded fill without border; `dashed` a dashed border without fill; `dotted` the same with round dots (structured; finest dash in `auto`). A
  `tone` sets the fill of any of them (`plain` with a tone looks like `filled`: use
  `filled`). An undrawn border is not geometry-linted, and an edge label inside a
  `plain` group gets the background beneath it. To make a whole panel pale use
  [`dim: true`](#dimmed-groups).

## Edges and the connection table

| Case | Result |
| --- | --- |
| node ↔ node, node ↔ group, group ↔ group | allowed |
| self-loop (`from` = `to`) | allowed, `lint/self-loop` info |
| several edges between one pair | allowed; identical ones (endpoints, component, label) get `lint/duplicate-edge` |
| group ↔ its own descendant | allowed, `lint/ancestor-edge` warning (the line crosses the border and label) |
| unknown endpoint | error `ref/unknown-endpoint` |

Direction comes from the edge component: `arrow` points `from` → `to`,
`double-arrow` has heads at both ends, `line` none. `zoom` (structured) is a
callout, not a connection ([zoom](structured.md#zoom-callouts)).

## Components, variants and props

Take these from `sumi catalog --json`. Each entry has `id` (`sumi/<name>`; write
`box` or `sumi/box`), `kind` (`node` / `group` / `edge`; a node component cannot
be an edge), `variants`, `props` (a JSON Schema, `additionalProperties: false`),
`engines` when restricted, `since`. Read allowed prop values from
`props.properties.<prop>.enum`, not from examples: for `sumi/tokens`,
`lineAlign.enum` is `["start", "center", "end", "stretch"]`. `default` is the
omitted value, `required` lists mandatory props; nested objects and unions keep
their own `properties`, `enum`, `const` and `anyOf`.

- Sizes (`props.width` / `height`): lengths with a unit (`mm`, `cm`, `in`, `pt`),
  a multiple of 0.5pt (`12mm` = 34.02pt is not: prefer `pt`). Omit sizes unless
  needed: nodes are sized to their labels.
- `label` (`sumi/label`) draws text without a border and needs a non-empty label.
- **Shapes**: `box`, `square`, `circle`, `ellipse`, `diamond`, `hexagon`,
  `parallelogram`, `cylinder`, `document`. `circle` and `square` keep 1:1.
  `trapezoid` has a wider top (`props.narrow: south|north|east|west` picks the
  narrow edge) and `stack` draws three overlapping rectangles with the label on the
  front one; both are outline components (below). `bowtie` with `props.gap: 8`
  draws two separate opposing trapezoids with one label centred across both halves
  and the gap when its text is readable on white (contrast 4.5:1); lower-contrast
  text (`solid` white) sits on the left body. Stroked variants report
  label/outline crossings: use `filled` or leave the text enough gap (0 or omitted
  keeps the joined shape). Gap is 0–64 D2 units (0.5pt each), clamped to half the
  width for a small explicit size; the whole node, gap included, blocks other
  edges; a north/south port aimed into the gap moves to the nearest painted lip
  (left on a tie), and structured layout aligns a movable neighbour with it
  (otherwise `layout/unaligned-ends`). All work in auto and structured layouts and
  as native editable PPTX shapes (badges remain picture-PPTX only).
- `operator` draws a small circle with a symbol (`props.symbol`: `plus`, `minus`,
  `times`, `dot`, `concat`), `junction` a small dot where lines branch or merge.
  Both take **no label** (`component/unexpected-label`) and no width / height. In
  `paper` an operator has a 7pt symbol in a 14pt circle with a 0.5pt outline
  (emphasis 1.5pt; filled no outline; sizes before `fit: scale`).
  **`props.size: regular | large | xlarge`** (1x / 1.5x / 2x of the theme's size,
  circle and symbol together, outline weight unchanged; `paper` `large` = 21pt
  circle, 10.5pt symbol; else `component/invalid-prop` at `props.size`) makes a ⊕
  stand out. `junction` takes no `tone`; connect into it with `line` (an arrowhead
  would cover the dot); `variant: hidden` draws no dot (lines meet smoothly; only
  where no other line crosses nearby) and an arrow into it ends in open space.
- **`bubble`** (since 0.15.2): a generously rounded speech bubble / callout.
  `props.tail: left | right | top | bottom | none` (default `none`);
  `tailAt: start | center | end | <length>` (default `start`, `0` allowed).
  Positions run from the body's top on left/right or left on top/bottom and
  clamp to fit the base; `start` on left/right replaces only the top corner
  with a small horn. Other positions and top/bottom use a short symmetric curved
  wedge. `tailSize` overrides the theme-derived depth: 0.3 × radius for side horns,
  0.5 × radius for other side positions, 0.6 × radius for top/bottom.
  Radius is 1.1 × font size; neither radius nor tail grows with message height.
  The tail sits outside
  the body but inside its reserved footprint; edges attach to the body, never
  to the tip. `width` / `height` size that **whole footprint**. Text wraps
  automatically (Japanese included); `maxWidth` sets the text-line width
  (default 120pt), also constrained by an explicit width. Newlines remain.
  Lines default to start alignment; `textAlign: center | right` overrides it
  in either layout, using the existing node field.
  `default` is white with a frame; `filled` / `solid` are borderless and use
  the usual tones; other shape variants also work. Both layouts and SVG,
  PDF, picture and editable PPTX use one closed path, without a tail seam.
  The component takes text; use separate `image` nodes for pictures.
- **`block-arrow`, `triangle-arrow`, `chevron`** (since 0.16.0, structured only): a
  flow marker placed in a row or stack between stages, not an edge: a thick arrow
  (1.6 em long, 1 em thick), a solid triangle (0.9 em) or a chevron (0.7 em), in
  the theme's ink with no outline. `props.direction: right | left | up | down`
  (default `right`), `length` (along the arrow, whichever way it points) and
  `thickness`; `block-arrow` `head` (head length, a fraction of the shorter side,
  default 0.5) and `shaft` (fraction of the thickness, 0.5); `chevron` `head`
  (depth of the tip). Variants `default` (ink), `muted` (gray), `outlined`;
  `tone` colours it. No label, sublabel, badge, glyphs or `grow`, and never an
  edge endpoint (`component/flow-arrow-connection`). Editable PPTX uses the
  `rightArrow`, `triangle` and `chevron` presets. See [flow arrows](structured.md#flow-arrows).
- `image` (PNG, JPEG, SVG file, inline SVG or shared asset), `icon: tabler/<name>`
  / `emoji/<name>` replacing a label, `badge`, `props.layers`: [assets](assets.md).
  `html` (restricted HTML card): [html](html.md).
- `waveform`: required `props.samples` (2–2048 finite amplitudes in [-1, 1],
  evenly spaced, no resampling); `mode: bars` (default, mirrored absolute
  amplitudes) or `line` (signed values); optional `width` / `height` (omitted:
  fit an optional label below, minimum 80×48pt); variants `default`, `emphasis`,
  `muted`, `outlined` (with a `tone` colours signal and frame; others tone the
  background); `props.frameStroke: '#RRGGBB'` sets the frame colour (overridden by
  inherited `dim`). Both layouts and all outputs. Supply real data or explicitly
  marked illustrative samples; never invent measurements; no audio decoding.

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

- Structured-only components (the catalog marks `"engines": ["structured"]`):
  `legend`, `tokens`, `matrix`, `bracket`, `separator`, `block-arrow`, `triangle-arrow`, `chevron`, edge `zoom`: see
  [structured](structured.md). Components without `engines` work in both.

**Catalog render metadata.** A node manifest may carry a `render` block that `catalog
--json` keeps as the entry's `render` field (below). It is manifest metadata, **not** a
field of Figure YAML or `props`, and a renderer ID is not a component ID. `trapezoid`
and `stack` use outline renderers with fixed slant / layer parameters.

```json
{
  "type": "outline",
  "renderer": "sumi/trapezoid",
  "params": { "slant": 0.4 }
}
```

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

They are built in; a figure cannot define its own. `sumi catalog --json` lists them
([below](#discovering-themes-and-profiles)); the hint of `theme/unknown` /
`profile/unknown` names them too.

| Theme | Look |
| --- | --- |
| `minimal` | monochrome with clear outlines (default) |
| `academic` | grayscale, print-friendly journal style: 0.5pt black lines, square corners, groups without fill, tones as gray steps, gray emphasis; no color |
| `slides` | for slides: 16pt text (14pt on edges, 18pt container labels), 2pt lines; use with `presentation-16x9` |
| `color` | general purpose with color: like `minimal`, but tones are pastel fills and emphasis is blue |
| `paper` | color ML-paper style: pastel tone fills, rounded boxes (2pt) and groups (6pt), black 1pt frames, light gray groups, thin 0.5pt edges with small arrowheads, framed images with a 0.5pt border, Inter for Latin text |
| `llama` | after Meta's Llama 4 MoE figure: 1pt slate lines and frames with **open chevron arrowheads** (a small gap before the box), white boxes with a gray frame, `solid` = dark slate block with white text, `emphasis` = blue accent block, `filled` = gray borderless block, `muted` = pale borderless block, borderless pale groups with a regular-weight title (`muted` group: white panel), rounded corners (3pt / 5pt), Inter for Latin text |
| `sumi` | warm cream canvas, navy ink and sand accents |
| `sumi-dark` | navy canvas, cream ink and sand accents |

`minimal`, `academic`, `color`, `paper` and `llama` use 8pt text (7pt on edges). `academic` is
for black-and-white journals, `paper` for the coloured figures of ML papers; both fit
`paper-single` / `paper-double`, and the same YAML renders under either with
`--theme`. Fonts: `minimal`, `academic`, `slides`, `color`, `sumi` and `sumi-dark` use `sumi/biz-ud-gothic`
(Latin and Japanese); `paper` and `llama` use `sumi/inter-biz-ud-gothic` (structured figures:
Inter for Latin, BIZ UDPGothic for Japanese; auto figures all BIZ UDPGothic). Inter's
line box is taller (1.21em vs 1.00em), so a small node with explicit `width` /
`height` can fail `geometry/label-overflow` under `paper`: a one-character key in a
square needs about 1.4× the text size (11pt for 8pt text); otherwise leave sizes out.

| Profile | Max width | Max height | Min font size | Use |
| --- | --- | --- | --- | --- |
| `paper-single` | 88mm | 220mm | 7pt | one column of a two-column paper (default) |
| `paper-double` | 180mm | 220mm | 7pt | full page width |
| `presentation-16x9` | 338.7mm | 190.5mm | 14pt | slides; only `slides` meets its 14pt minimum |

`sumi render --theme <name> --profile <name>` overrides them for one render. With
`figure.fit: scale` a too-wide figure is printed smaller and text is checked at its
printed size against `minScaledFontSize` (5pt on paper profiles;
[shrinking](layout-tips.md#shrinking-to-the-page-width-figurefit-scale)).

**`figure.target`** optionally describes this figure's placement (both engines).
All three fields take a length with a unit; omitted fields retain profile defaults:

- `height: 60mm`: positive printed-height **budget**, margins included. Exceeding
  it gives `geometry/exceeds-target-height` (warning) with vertical attribution.
  The profile's maximum height stays a hard limit; height never triggers scaling.
- `minFontSize: 5pt`: overrides both profile font minima, up or down, with a floor
  of **4.5pt**. This is a check, not a request to resize text. Run `lint --geometry`:
  final labels, sublabels and placed HTML below it give `geometry/text-too-small`
  (error). Math scripts remain information-only when scaled.
- `minLineWidth: 0.5pt`: positive final diagram border/wire minimum;
  `geometry/line-too-thin` warns below it, including after scaling. Imported
  image/icon/HTML strokes are excluded.

With any explicit target (even `{}`), `geometry/placement-usage` reports reserved
profile width × printed height (mm²), width utilization and optional height-budget
use. Compare candidates at the same placement ([fit the placement](layout-tips.md#fit-the-placement));
it is not an aspect-ratio score. Discover the target schema with `sumi catalog --json --section targets`.

**`figure.themeOverrides`** refines the theme for this figure only (strict: unknown keys
`schema/unknown-field`, bad values `schema/invalid-value`; fonts, spacing and line widths
stay the theme's):

- `palette: cool-blue` recolours the whole figure with a built-in four-colour palette
  (below). Tones, `groupFill` and the other keys refine it.
- `nodeCorners: square` removes node/group frame radii (also expanded matrix/tokens cells
  and legend frames; circles, cylinders, curly brackets keep their outlines; auto figures too).
- `edgeCorners: sharp` draws structured wires with sharp turns, T-joins at hidden junctions,
  butt caps and miter joins (zoom wires too; editable PPTX flat caps). Independent of
  `nodeCorners`.
- `groupLabelWeight: regular | bold` sets every group heading's weight.
- `solidFills: { blue: '#3d9df5', orange: '#e8a20c', red: '#e04848' }` replaces the solid
  fill and border of those tones (expanded nodes and solid glyphs/legend samples too); white text stays if it meets 4.5:1,
  else it darkens; other variants, tone-line text and edges keep the palette.
- `dashedGroupStroke: '#527da5'` changes only dashed group borders.
- `tones: { blue: { fill: '#dfe1ea', line: '#5f6a95', text: '#000000' } }` recolours a tone
  everywhere it appears: `fill` = pale fills (default/filled/tinted, toned groups, matrix
  classes, legend samples); `line` = outlined/tinted frames, toned edges and arrowheads,
  hatches, solid fills (`solidFills` wins), html `--sumi-accent` (blue); a `fill`-only override does not change solid fills. A `line` override replaces even the bright built-in yellow solid fill, and its text is adjusted to at least 4.5:1; `text` =
  outlined/tinted text, toned edge labels, `\textcolor`, drawn as written. Without `text`,
  tinted text is the line darkened to 4.5:1 and white-ground text is the line. `text` never
  applies to solid nodes (white, contrast-adjusted) or default-variant text. Overriding
  `gray` also recolours untoned tinted/solid nodes. `theme/low-contrast` warns when used text
  is under 4.5:1 on the tone's fill (tinted) or on white (outlined, edge labels, `\textcolor`).
- `groupFill: '#ffffff'` / `groupStroke: '#000000'` set container group fills (untoned,
  non-transparent variants) and frames (toned groups too; `dashedGroupStroke` wins), stacked
  `layers` cards too.

Colours are strict `#RRGGBB` and apply before inherited dimming.

**Line weights, dots and arrowheads** (structured layout; the options below give
`layout/structured-only` in `auto`, where `dotted` is drawn as D2's finest dash). Paper figures want thin lines: `themeOverrides: { lineWidth: 0.5pt, frameWidth:
0.5pt, arrowheadScale: 0.6, cornerRadius: 2pt }`.
- `lineWidth` replaces the regular width of node frames and edges; widths are multiples of
  0.25pt from 0.25pt to 4pt. A heavier variant (`emphasis`) or lighter one (`zoom`) keeps its
  ratio to the theme's regular width; borderless stays borderless.
- `frameWidth` sets the frames of groups, sets and legends (those the theme draws).
- `arrowheadScale` (0.5 to 2) multiplies every arrowhead (4 + 4 × width units); the router's
  room and the lints follow. `cornerRadius` (multiple of 0.5pt, up to 10pt) rounds group, set
  (rect) and legend frames; `nodeCorners: square` still squares them.
- Per element, these win: `lineWidth` on a node, group, edge or set (on a `legend` node it is
  the frame; in a legend `edge` entry the sample's), `arrowheadScale` on an edge, `cornerRadius`
  on a node, group or set. `variant: dotted` on an edge, `container` or set draws round dots
  three line widths apart (the theme's `dashed` colours and fill); use `dashed` for dashes.
  Editable PPTX uses PowerPoint's round-dot preset and the nearest of its three head sizes.

**Palettes.** `themeOverrides.palette: <name>` gives the figure one coherent colour scheme
on any theme (`minimal`, `color`, `paper`, `llama`, …; `academic` is grayscale by design, so
leave it unpainted for black-and-white print). Names: `cool-blue` (navy, high contrast),
`slate` (muted blue-gray), `coral` (warm), `terracotta` (earthy), `sage` (muted green),
`lavender`, `cyan-pink` (cyan with a hot accent), `seafoam` (green-teal). A
palette recolours text, frames, edges and arrowheads (ink), the group panels a theme fills (the palest colour; `paper`'s default groups are white and stay white, so a palette does not tint every panel: only `variant: filled` groups and an explicit `groupFill` take it),
`filled`/`tinted` nodes and the `gray` tone (the tint), `solid` fills and outlined frames
(the accent colour, deepened for white text), `muted` groups (a paler panel and a palette
frame) and `emphasis` nodes and edges (the accent). It never changes sizes, fonts or line
weights. The tones are derived from the palette too: `gray` is its neutral, and `red`, `orange`,
`yellow`, `green`, `blue`, `purple`, `pink` keep their own hue (`tone: green` is still green) but
take the palette's lightness and chroma (fills at its tint, lines at its strong colour), so a
tone carries its meaning while the whole figure stays in one family of colours. Every text keeps
4.5:1 on its fill in every palette. Yellow fills are kept light and warm; muted orange fills are kept peach-like. Chromatic yellow uses a golden stroke (at least 3:1 on white and the palette panel) and neutral ink for text; monochrome themes retain gray tones. Darker filled-group tint backgrounds can require a custom contrasting line. List the colours and the derived tones with
`sumi catalog --section palettes`; an unknown name is `schema/invalid-value` with the closest
name. Explicit `tones`, `groupFill`, `groupStroke` and `solidFills` win over the palette, but
tone colours of your own next to a palette are what `geometry/color-harmony` reports (it clashes
unless they match the palette's lightness and chroma): leave `tones` out.

## Discovering themes and profiles

```sh
sumi catalog --json --section themes --section profiles
```

prints `{ "version": 1, "themes": [...], "profiles": [...] }` (plain `--json` adds
`components`, `icons`, the `targets` and `sets` input schemas and the `palettes`; `--icons`
searches icons). One entry of each:

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
      "compatibleProfiles": ["paper-single", "paper-double"],
      "arrowhead": "triangle"
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

- `compatibleProfiles`: profiles whose minimum font size every component and variant
  of the theme meets; another profile fails with `profile/font-too-small` for
  labelled elements (the user decides).
- `fonts.styles`: `italic: true` / `mono: true` need `italic` / `mono` here.
  `missingVariants`: variants the theme lacks (fallback `default`,
  `theme/missing-variant`); `tones`: the tones it colours (all, for built-ins).
- `arrowhead`: the theme's standard arrowhead, `triangle` (filled) or `open` (a
  chevron the line runs into; `llama`). It replaces every triangle end in SVG, PDF and
  PPTX (editable PPTX: the native open `arrow` end).
- `page.maxWidth` / `maxHeight` (`null` = no limit) include the margin; `layerGap`
  is the space between layers (nodes in a layer are always 10pt apart);
  `typography.minScaledFontSize` is the minimum printed size under `fit: scale`.

After rendering, `sumi render --json` (and each result of `sumi lint --geometry
--json`) reports the output size in `size` (`null` if nothing was rendered):

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

`fits` covers width and height only (fonts are diagnostics). With `fit: scale` the
sizes are the printed ones and `"scale"` (e.g. `0.7004`) is added.

## Output formats

`sumi render -o figure.svg|.pdf|.pptx` picks the format by extension (`--format
svg|pdf|pptx` is explicit); only SVG supports stdout. PPTX is one picture (outlined
SVG plus PNG fallback): shapes and text are not editable and the picture keeps its
physical size (slide sides under 1 inch are padded, over 56 inches rejected; PNG at
192dpi, at most 8192px per side and 16 million pixels; `--json` size describes the
figure, not the padding). Do not promise SVG support in every app
(`docs/verification/61-pptx.md`). Only when the user requests experimental editable
objects use `--pptx-mode editable`: it refuses icons, images and HTML
(`pptx/unsupported-asset`); `--pptx-connectors freeform` (default) keeps routes
unglued, `glued` replaces them with straight connectors whose labels do not follow
edits; fonts are referenced, not embedded. Promise no exact appearance, layout after
editing or YAML round-trip (`docs/verification/62-editable-pptx.md`).

## YAML restrictions

One document per file (no `---`), no anchors / aliases / merge keys (`&`, `*`,
`<<`), no tags, no duplicate keys. Comments are fine and kept by `sumi fmt`. Plain
`sumi fmt file` prints `file: changed` or `file: unchanged` on stderr per file
(stdout lists only rewritten names); `--check` lists files that would change (exit
1), `--stdout` writes only YAML; neither adds status lines.

## Common mistakes

Per-code fixes: [diagnostics](diagnostics.md). The ones agents repeat:

| Mistake | Diagnostic | Fix |
| --- | --- | --- |
| uppercase ID, invented component or variant, `color:` on a node | `schema/invalid-id`, `component/unknown`, `component/unknown-variant`, `schema/unknown-field` | lowercase ID; a catalog name; `tone` |
| `label: $\gamma_1,\beta_1$` inside `{ … }` | `schema/unknown-field` | single-quote it: `'$\gamma_1,\,\beta_1$'` |
| `label: 'Scale\n$\gamma$'` | `lint/literal-newline` | `"Scale\n$\\gamma$"` or a `\|-` block |
| math, `toAnchor`, edge `labelAt`, `align`, `legend`… in an auto figure | `component/unsupported-in-auto`, `layout/structured-only` | make the figure structured, or remove it |
| `label:` and `icon:` on one node | `asset/icon-with-label` | keep one; attach a `label` node |
| an icon wrapped in a `circle` to make it bigger | none (looks bad) | `component: label` with `icon` and `iconSize: 2` |
| `labelAt: top-center` (group), `labelSide: above` | `schema/invalid-value` | group: `top-left`, `top`, `top-right`, `bottom-left`, `bottom`, `bottom-right`; edge `labelAt`: `start` / `middle` / `end`; `labelSide`: `left` / `right` |
| `width: 10px`; `label: 2024`; `label: Step 1: parse` | `component/invalid-prop`, `schema/invalid-type`, `yaml/syntax` | `pt` / `mm` units; quote the label |
| `variant: muted` on every element of a panel | none | `dim: true` on the group |
