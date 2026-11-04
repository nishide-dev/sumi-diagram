---
name: sumi
description: Build, check and render diagrams as code with the Sumi CLI (*.sumi.yaml → SVG). Use when the user asks to make, draw, fix or render a diagram, figure, flowchart, pipeline, decision flow, block or architecture diagram "with Sumi", "as code", or as a *.sumi.yaml file, including Japanese requests such as 図・ダイアグラム・フローチャート・構成図・アーキテクチャ図・処理の流れ図を作って／描いて／Sumi で. Discovers components with `sumi catalog`, writes the YAML, then runs fmt → lint → render and inspects the SVG.
---

# Sumi: diagrams as code

Sumi turns declarative `*.sumi.yaml` into SVG using predefined components,
built-in themes and output profiles. Write YAML from the user's content and
drive it through the CLI until clean. Never draw SVG yourself or edit generated `.svg` / `.d2` files.

## Ground rules

- **Use only what Sumi provides.** Components, variants, props, themes and
  profiles come from `sumi catalog --json`; fields from the Figure Schema
  ([figure-format](references/figure-format.md)). Never invent a component,
  variant, prop, field, theme, profile, style or icon name. If the diagram needs
  something Sumi lacks (free colors or coordinates, a domain-specific shape), say
  so and use the closest generic component.
- **Do not fabricate content.** Labels and relationships come from the user or
  sources they point to. Keep facts (connections, names, numbers) separate from
  presentation (layout, variants, grouping). If a fact is missing or ambiguous,
  ask. Shortening a label for space is presentation; changing its meaning is not.
- **Let the CLI decide.** Diagnostics are the source of truth; do not guess
  whether something is valid.

## Prerequisites

The skill drives the Sumi CLI but does not contain it. Install a release (macOS /
Linux) from [GitHub Releases](https://github.com/nishide-dev/sumi-diagram/releases):
extract `sumi-<version>-<target>.tar.gz` intact, put its `bin/sumi` on `PATH` (D2
and fonts are bundled), check with `sumi doctor`. Optional: `SUMI_BIN`, `SUMI_D2_PATH`
(D2 v0.9.0). A source checkout needs Bun + `bun run d2:install`.

## Running the CLI

```sh
<skill-dir>/scripts/sumi <command> ...   # <skill-dir> = the base directory of this skill
```

The wrapper runs `$SUMI_BIN`, else the Sumi checkout it lives in, else `sumi` on
`PATH`, else a checkout around the current directory; otherwise it exits 127 with
install instructions: relay them and stop (install nothing without asking). Use the
absolute path in every command. Below, `sumi` means the wrapper.

## Workflow

### 1. Clarify the figure

Before writing YAML, make sure you know:

- **Content**: the elements (steps, components, states), the connections between
  them and their exact labels; which elements belong together.
- **Target**: ask placement width, maximum height, height budget and venue minimum
  text size (column, full width, single-column paper, teaser, README or slide).
  Use a matching profile and optional `figure.target`; [placement](references/figure-format.md#themes-and-profiles).
- **Theme**: `minimal` (default), `academic`, `color`, `slides` (needed for a slide)
  or `paper` — **recommend `paper` for a color paper figure** (`academic` if it must
  be grayscale). And the output path (default: next to the user's other files,
  named `<figure-id>.sumi.yaml`).
- **Layout** (your choice, not a question): flows and graphs use the default
  **auto** layout; paper block diagrams (stacked layers, residuals, aligned columns,
  ⊕ operators, math labels, token rows) the **structured** layout
  ([choose](references/layout-tips.md#choose-the-engine-first)), planned first
  ([paper figure workflow](#paper-figure-workflow)).

Ask once, briefly, for what is missing. If told to go ahead, use `paper-single`
+ `minimal` (`paper` for a paper figure) and say so in your report.

### 2. Check the environment (once per session)

```sh
sumi doctor
```

Exit 0 and `Ready to render.` means D2, fonts and geometry lint are in place. If a
check fails, relay its `hint` and stop, except that a `d2` failure alone does not
block structured figures. For `d2`: reinstall the release tarball, `bun run
d2:install` in a checkout, or set `SUMI_D2_PATH` (v0.9.0).

### 3. Discover components, themes and profiles

```sh
sumi catalog --json              # components, themes, profiles, icons, targets
sumi catalog --json --section themes --section profiles   # only those sections
sumi catalog --kind node         # human-readable table, one kind of component
sumi catalog --icons "wave sine" # bundled icons whose names contain all the words
```

Pick each component from `components`, matching the `description` to the element's
role (`diamond` for a decision, `cylinder` for storage). Use only listed variants and
props; `engines`, when present, lists the only layout engines it works in. The theme's
`compatibleProfiles` must include the profile, else labelled elements fail with
`profile/font-too-small`
([figure-format](references/figure-format.md#discovering-themes-and-profiles)). Icons:
[assets](references/assets.md#icons).

### 4. Write the figure

Read [references/figure-format.md](references/figure-format.md) before writing your
first figure. Essentials:

```yaml
version: 1
figure:
  id: my-figure            # IDs: ^[a-z][a-z0-9_-]{0,63}$ (lowercase)
  theme: minimal
  profile: paper-single
  layout:
    direction: down        # right | down | left | up
groups:
  - id: backend
    label: Backend
nodes:                     # label: plain text, \n breaks the line; group: set on the child
  - { id: api, component: box, label: "API\nserver", group: backend }
  - { id: db, component: cylinder, label: Database, group: backend }
edges:
  - { from: api, to: db, label: query }
```

- Every node needs `component`; groups default to `container`, edges to `arrow`.
  `from` / `to` reference node or group IDs; quote labels such as `"yes"`, `"no"`
  and anything containing `:` or `#`.
- Long `right` chains often exceed a column; measure and compare `down`, rows and scaling ([layout-tips](references/layout-tips.md)).
- **Structured figures** add `figure.layout.arrange` (nested `stack` / `row` / `grid`
  boxes listing every node and group once), `attach`, anchors, `align`, and the
  `legend`, `tokens`, `matrix`, `bracket`, `separator`, `zoom` components: read
  [structured](references/structured.md) first; a paper figure: the [paper figure
  workflow](#paper-figure-workflow). Label math (`'$\hat{y}_t$'`) works only there;
  with a line break, double-quote it and double backslashes (`"A\n$\\gamma$"`). Any
  group takes `labelAt` and `caption`.
- Icons, images, `figure.assets` pictures: [assets](references/assets.md); rich
  text cards: [html](references/html.md).

### 5. Format, lint, fix

```sh
sumi fmt figure.sumi.yaml
sumi lint --json figure.sumi.yaml
```

`lint` checks everything that does not need rendering (YAML, schema, references,
layout, components, assets, theme, profile, `lint/*` rules). Each diagnostic has
`code`, `severity`, `message`, `path` (where in the YAML, e.g. `["nodes", 2,
"variant"]`), `location` and often a `hint` with valid values, a near match or a
verified edit. Fix the YAML at `path`, then `fmt` and `lint` again. Errors on an
element hide follow-up errors, so new diagnostics after a fix are progress. Per-code
fixes: [diagnostics](references/diagnostics.md).

Exit codes: 0 clean (warnings allowed), 1 problems found, 2 usage error (bad flag,
unknown `--theme`/`--profile`, unreadable file): fix the command. Resolve every error;
fix warnings unless intended (`lint/no-edges` for deliberately unconnected nodes) and
mention the ones you keep.

### 6. Render and check geometry

Render only after lint is clean (`render` does not run the `lint/*` rules).

```sh
sumi render figure.sumi.yaml              # writes figure.svg, then runs geometry lint
sumi render --json figure.sumi.yaml       # diagnostics as JSON ("output" = SVG path, "size")
sumi lint --geometry --json figure.sumi.yaml   # lint + render in memory + geometry; writes nothing
sumi render figure.sumi.yaml -o figure.pdf     # vector PDF (or -o figure.pptx); same checks
```

Write PDF or PPTX (one picture, not editable shapes) only when the user asks ([output
formats](references/figure-format.md#output-formats)); inspect the SVG either way.
`render` reports `geometry/*` diagnostics (page size, label overflow, overlaps, labels
crossed by edges). Geometry errors make it exit 1 but **the SVG is still written**. It
prints `Wrote figure.svg: <W>mm × <H>mm (…)`; `--json` has `size` (`widthMm`,
`heightMm`, limits, `fits`; `null` if nothing was rendered).

- `geometry/exceeds-page-width` / `-height`: the width hint measures where the width
  goes and, if a trial verified it, names an edit: apply one, re-run ([width
  breakdown](references/diagnostics.md#too-wide-the-width-breakdown)). Else shorten
  labels, change the layout. Auto: the other `direction`; if both overflow,
  [layout-tips](references/layout-tips.md#too-wide-with-right-too-tall-with-down).
  Structured: re-arrange the trees (a long row as two rows), reduce `gap`s. A wider
  profile is the user's choice: ask, never switch on your own.
- Geometry warnings (`edge-crosses-label`, `label-collision`, …): try the
  [layout-tips](references/layout-tips.md) workarounds once or twice, then keep and report them.
- Structured: `layout/no-route` (no SVG written): an edge has no room; widen that `gap`
  or move an attached node out of it ([spacing](references/structured.md#spacing-that-routes)).
  Also `layout/unsatisfied-align`, `layout/edge-label-overlap` (warnings),
  `layout/edge-crossing`, `layout/align-grew-figure` (infos); no `--emit-d2`.
- Other render errors (`svg/*`, `backend/*`, `asset/*`) and all `geometry/*` codes:
  [diagnostics](references/diagnostics.md).

### 7. Inspect the result

Clean diagnostics do not guarantee readability. There is no `sumi preview` command: this
Skill's script rasterizes the SVG, then open the printed PNG with the Read tool:

```sh
<skill-dir>/scripts/preview figure.svg    # prints a temporary PNG path
```

It uses Quick Look on macOS (padded to a square: the blank space is not part of the
figure), else `rsvg-convert`; exit 1 if neither exists: skip this and say so. Check:
reading order follows `direction` (or the arrange tree); no label overlaps a line or
shape; no edge crosses or detours around a group title (`labelAt`); nothing is huge or
squashed; text is legible; an empty region of a block or more is there for a reason
(grouping, alignment, emphasis); otherwise re-arrange, never pad.

### 8. Report

Tell the user: the files written (YAML and SVG), size and profile, the final lint and
render summaries (kept warnings with reasons), your assumptions, and anything you
could not verify. Show the YAML only if asked or if it is short.

## Paper figure workflow

Paper figures are structured, theme `paper`, built to the [design principles](references/layout-tips.md#design-principles)
(reading direction, focus, shared lines, no unexplained voids, colour by role, notes at
their target). With **content only** (the usual case), [plan the layout](references/layout-tips.md#plan-the-layout-before-writing-yaml)
before writing YAML: roles, main direction, two ASCII sketches compared on empty space,
aspect ratio, alignment and crossings. With **a reference figure**, map each look to a
field ([recipe](references/layout-tips.md#paper-figure-recipe)) and keep its arrangement
unless it breaks the width or the principles (say so). Then read as needed:

1. [Example 6](references/examples.md#6-success-a-paper-figure) (three panels, zoom, dimmed variant).
2. Structure: [arrange trees](references/structured.md#arrange-trees), [grids](references/structured.md#grids), [titles and captions](references/structured.md#group-titles-and-captions), [panel separators](references/structured.md#panel-separators), [two panels with a divider](references/layout-tips.md#two-panels-with-a-dashed-divider).
3. Cells: [tokens](references/structured.md#token-sequences) (numbering, `lines`, `lineAlign`), [matrices](references/structured.md#matrices).
4. Pictures: [crop, shared assets](references/assets.md#reusing-one-picture-figureassets), [framed images, operator size](references/assets.md#framed-images-and-operator-size), [html](references/html.md) cards.
5. Looks: [tones and variants](references/figure-format.md#tones-and-variants), [themeOverrides](references/figure-format.md#themes-and-profiles), [`fit: scale`, `density: compact`](references/layout-tips.md#shrinking-to-the-page-width-figurefit-scale).
6. Loop `fmt` → `lint` → `render` with [diagnostics](references/diagnostics.md). Review any
   block-sized void: keep it if it groups or aligns, else move notes or outputs.

## When to stop and ask

Stop, report the current state (last diagnostics, what you tried) and ask when:

- the same error persists after **3 fix attempts**, or a figure is not clean after **6
  fix rounds** in total;
- a fix would change the content (dropping or merging elements, rewording beyond
  shortening, inventing a connection);
- the fix needs the user's choice: profile or theme, page size, splitting the figure;
- the diagram needs a capability Sumi does not have;
- a command exits 2 for a reason you cannot fix (e.g. D2 missing).

## References
Consult [reference figures](examples/README.md) only when the user asks for that model or figure style; they are not templates for unrelated figures.
[figure-format](references/figure-format.md) (fields, feature versions, labels, math,
tones and variants, groups, components, themes, profiles, mistakes) ·
[structured](references/structured.md) (arrange trees, grids, separators, titles, attach,
align, anchors, legends, zoom, brackets, tokens, matrices) · [assets](references/assets.md)
(icons, images, crop) · [html](references/html.md) · [diagnostics](references/diagnostics.md)
(fixes by code) · [layout-tips](references/layout-tips.md) (engine, fitting, design
principles, layout planning, paper recipe) · [examples](references/examples.md)
