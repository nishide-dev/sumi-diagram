# Figure format (`*.sumi.yaml`, Figure Schema v1)

The authoritative definitions are `schema/figure.v1.schema.json` (generated)
and `docs/design/phase1.md` §2 in the repository. This page is the subset you
need to write a figure.

## Structure

```yaml
version: 1                 # required, always 1
figure:                    # required
  id: request-flow         # required ID
  title: Request handling  # optional, not drawn
  theme: minimal           # optional, default minimal
  profile: paper-single    # optional, default paper-single
  layout:
    direction: down        # optional: right (default) | down | left | up
    # arrange: …           # optional: switches to the structured layout (structured.md)
groups: []                 # optional
nodes: []                  # optional (an empty figure gets a lint warning)
edges: []                  # optional
metadata: {}               # optional, any JSON-compatible data; not drawn
```

| Element | Fields (required in bold) | Defaults |
| --- | --- | --- |
| group | **`id`**, `label`, `component`, `variant`, `tone`, `group`, `arrange`¹ | component `container`, variant `default`, no tone, no parent |
| node | **`id`**, **`component`**, `label`, `variant`, `tone`, `icon`, `props`, `group`, `attach`¹ | variant `default`, no label, no tone, no group |
| edge | **`from`**, **`to`**, `id`, `label`, `component`, `variant`, `props`, `fromAnchor`¹, `toAnchor`¹ | component `arrow`, variant `default` |

¹ Structured layout only (a figure with `figure.layout.arrange`); see
[structured](structured.md). `icon`: see [assets](assets.md).

Every object is strict: an unknown key is an error (`schema/unknown-field`).
There is no per-element style, color, font or coordinate field — appearance
is chosen with `variant` and `tone` (below), size with the `width` /
`height` props of node components (see the catalog), and position by the
layout: `direction` in auto figures, arrange trees, `attach` and edge
anchors in structured ones ([structured](structured.md)).

## Tones

`tone` on a node or group picks a color category: `gray`, `red`, `orange`,
`yellow`, `green`, `blue`, `purple` or `pink`. The theme decides the color:
`color` fills each tone with its own pastel hue; `minimal`, `academic` and
`slides` stay monochrome and map the tones to three gray fills (tones in the
same step look alike: yellow/green, gray/orange/blue, red/purple/pink). A tone
changes only the fill, on top of the variant. Use tones to encode categories
consistently (e.g. all attention blocks `orange`), not for decoration; when the
user wants distinguishable colors, use theme `color`.

```yaml
nodes:
  - { id: attention, component: box, label: Attention, tone: orange }
  - { id: norm, component: box, label: Norm, tone: yellow }
```

## IDs

- Pattern `^[a-z][a-z0-9_-]{0,63}$`: lowercase letter first, then lowercase
  letters, digits, `_`, `-`. No uppercase, dots, spaces or non-ASCII.
- Nodes and groups share one ID space (a node and a group cannot both be
  `api`). Edge IDs are a separate space and optional; an edge without `id`
  is referred to as `edges[<index>]` in diagnostics.
- IDs are data, not text: a node without `label` is drawn without text
  (the ID is never shown). Derive IDs from the label (`Load data` → `load-data`).

## Labels

- Plain text. `\n` inside a double-quoted string breaks the line. No
  Markdown or HTML.
- Label math: see [below](#label-math).
- Quote labels that YAML could misread: `"yes"`, `"no"`, `"on"`, numbers
  (`"2024"`), anything with `: ` or ` #`, or starting with `[`, `{`, `*`, `&`, `!`, `%`, `@`.
- Keep lines short: the `lint/long-label` rule warns above 40 columns per
  line (CJK characters count as 2) or more than 4 lines.
- Japanese and other CJK text is supported by the bundled font; emoji and
  rare characters are not (`lint/missing-glyph`). Structured figures also
  draw characters such as `₂` or `∼` with the bundled math font.

## Label math

Structured figures only (with `figure.layout.arrange`; in auto figures the
`$...$` is drawn as written, with a `component/unsupported-in-auto`
warning). `$...$` inside any label (nodes, groups, edges) is a small TeX
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
- Spacing: spaces inside `$...$` are ignored; Sumi adds TeX's space around
  binary operators and relations, but **none after a comma**: write
  `$x_1,\,\ldots,\,x_n$` for spaced lists (`\,` `\:` `\;` `\quad` `~`).
- Math is drawn in regular weight even in bold labels (`emphasis`).
- `\$` (outside `$...$`) is a literal dollar sign; in auto figures it is
  drawn as written.
- Not supported (`component/invalid-math`): `\frac`, `\sqrt`, `\mathbf`,
  `\mathbb`, matrices, `$$`, nested scripts, an unclosed `$` or `{`,
  characters it does not know (`@`, `ℝ`, …). Rewrite with
  the subset (`a/b`, `\mathrm{…}`), put text in `\text{…}`, or type a
  special character outside the `$...$` (`'$x \in$ ℝ$^d$'`: structured
  figures draw `ℝ`, `₂`, `∼`, `⋯` and similar with the math font).
- **Quote math labels in single quotes**: backslashes stay literal
  (`label: '$\alpha_1$'`). In a flow mapping (`{ … }`) a label containing
  `,` must be quoted, otherwise YAML splits it and Sumi reports
  `schema/unknown-field` for the rest (`Unknown field "\beta_1$"`):
  `{ id: ss, …, label: '$\gamma_1,\,\beta_1$' }`. In double quotes `\` must be
  doubled.

## Groups

- A group is a container drawn around its members. Membership is declared
  on the **child**: `group: <group-id>` on a node or on another group
  (nesting is allowed; cycles are `ref/group-cycle`).
- A group's only group component is `container` (check the catalog).
- Groups can be edge endpoints.
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

## Components, variants and props

Always take these from `sumi catalog --json`. Each entry has `id`
(`sumi/<name>`; in YAML write either `box` or `sumi/box`), `kind`
(`node` / `group` / `edge` — a node component cannot be used for an edge),
`variants` and `props` (a JSON Schema; `additionalProperties: false`).

- Variants are a closed list per component (typically `default`, `emphasis`,
  `muted`; edges also `dashed`). Use them to encode meaning consistently
  (e.g. `muted` for secondary elements), not for decoration.
- Node sizes (`props.width` / `props.height`) are lengths with a unit
  (`mm`, `cm`, `in`, `pt`) and must be a multiple of 0.5pt. Many mm values
  are not (`12mm` = 34.02pt); prefer `pt` (`34pt`). Omit sizes unless needed:
  nodes are sized to their labels.
- `label` components (`sumi/label`) draw text without a border and need a
  non-empty label.
- `image` embeds a PNG, JPEG or SVG file (`props.src`, plus `width` or
  `height`), and `icon: tabler/<name>` puts a bundled icon in a node in
  place of its label: see [assets](assets.md).
- `operator` draws a small circle with a symbol (`props.symbol`: `plus`,
  `minus`, `times`, `dot` or `concat`) and `junction` a small dot where lines
  branch or merge. Both take **no label** (`component/unexpected-label`) and no
  size props: the theme sizes them. `junction` takes no `tone`. Connect into a
  junction with `line` (an arrowhead would cover the dot). Introduced in 0.4.0;
  use them only when the installed CLI lists them.

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
`sumi catalog --json` lists them (see
[below](#discovering-themes-and-profiles)); the hint of `theme/unknown` /
`profile/unknown` names them too. The tables are a summary.

| Theme | Look |
| --- | --- |
| `minimal` | monochrome with clear outlines (default) |
| `academic` | restrained, for papers: thin lines, black text, gray emphasis |
| `slides` | for slides: 16pt text (14pt on edges, 18pt container labels), 2pt lines; use with `presentation-16x9` |
| `color` | general purpose with color: like `minimal`, but tones are pastel fills and emphasis is blue (0.4.0) |

`minimal`, `academic` and `color` use 8pt text (7pt on edges). All four use the
bundled `sumi/biz-ud-gothic` font set (Latin and Japanese).

| Profile | Max width | Max height | Min font size | Use |
| --- | --- | --- | --- | --- |
| `paper-single` | 88mm | — | 7pt | one column of a two-column paper (default) |
| `paper-double` | 180mm | — | 7pt | full page width |
| `presentation-16x9` | 338.7mm | 190.5mm | 14pt | slides; only `slides` meets its 14pt minimum (see layout-tips) |

`sumi render --theme <name> --profile <name>` overrides them for one render
without editing the file.

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
      "typography": { "minFontSize": { "written": "7pt", "pt": 7, "mm": 2.47 } },
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
diagnostics.

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
| `$...$` in a figure without `arrange` | `component/unsupported-in-auto` (warning) | use the structured layout, or plain text |
| `label:` and `icon:` on one node | `asset/icon-with-label` | keep one; put the text in an attached `label` node |
| `toAnchor: west` in a figure without `arrange` | `layout/structured-only` | remove it, or switch to the structured layout |
| `props: { width: 10px }` | `component/invalid-prop` | `mm` / `cm` / `in` / `pt`, multiple of 0.5pt |
| `children:` / `nodes:` inside a group | `schema/unknown-field` | put `group: <id>` on each child |
| `label: 2024` | `schema/invalid-type` | `label: "2024"` |
| `label: Step 1: parse` | `yaml/syntax` | quote the label |
| edge to a misspelled ID | `ref/unknown-endpoint` | use the ID from the hint |
| `theme: dark`, `profile: a4` | `theme/unknown`, `profile/unknown` | a built-in name from the tables above |
