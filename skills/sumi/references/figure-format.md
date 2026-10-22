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
groups: []                 # optional
nodes: []                  # optional (an empty figure gets a lint warning)
edges: []                  # optional
metadata: {}               # optional, any JSON-compatible data; not drawn
```

| Element | Fields (required in bold) | Defaults |
| --- | --- | --- |
| group | **`id`**, `label`, `component`, `variant`, `group` | component `container`, variant `default`, no parent |
| node | **`id`**, **`component`**, `label`, `variant`, `props`, `group` | variant `default`, no label, no group |
| edge | **`from`**, **`to`**, `id`, `label`, `component`, `variant`, `props` | component `arrow`, variant `default` |

Every object is strict: an unknown key is an error (`schema/unknown-field`).
There is no per-element style, color, font, size, position or port field —
appearance is chosen with `variant`, size with the `width` / `height` props
of node components (see the catalog).

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
  Markdown, HTML or LaTeX.
- Quote labels that YAML could misread: `"yes"`, `"no"`, `"on"`, numbers
  (`"2024"`), anything with `: ` or ` #`, or starting with `[`, `{`, `*`, `&`, `!`, `%`, `@`.
- Keep lines short: the `lint/long-label` rule warns above 40 columns per
  line (CJK characters count as 2) or more than 4 lines.
- Japanese and other CJK text is supported by the bundled font; emoji and
  rare characters are not (`lint/missing-glyph`).

## Groups

- A group is a container drawn around its members. Membership is declared
  on the **child**: `group: <group-id>` on a node or on another group
  (nesting is allowed; cycles are `ref/group-cycle`).
- A group's only group component is `container` (check the catalog).
- Groups can be edge endpoints.

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

The outline contract is foundation work; render-pipeline composition and the
components using it follow separately. The current built-in component entries
omit `render`. Keep using their catalog IDs, variants and props.

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

`minimal` and `academic` use 8pt text (7pt on edges). All three use the
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
        "description": "BIZ UDPGothic (regular, bold) and BIZ UDGothic (mono) v1.051: Latin and Japanese, OFL-1.1",
        "styles": ["regular", "bold", "mono"]
      },
      "fontSizePt": { "min": 7, "max": 9, "base": { "node": 8, "group": 9, "edge": 7 } },
      "missingVariants": {},
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
| `color:`, `style:`, `shape:` on a node | `schema/unknown-field` | remove; use a component or variant |
| `props: { width: 10px }` | `component/invalid-prop` | `mm` / `cm` / `in` / `pt`, multiple of 0.5pt |
| `children:` / `nodes:` inside a group | `schema/unknown-field` | put `group: <id>` on each child |
| `label: 2024` | `schema/invalid-type` | `label: "2024"` |
| `label: Step 1: parse` | `yaml/syntax` | quote the label |
| edge to a misspelled ID | `ref/unknown-endpoint` | use the ID from the hint |
| `theme: dark`, `profile: a4` | `theme/unknown`, `profile/unknown` | a built-in name from the tables above |
