---
name: sumi
description: Build, check and render diagrams as code with the Sumi CLI (*.sumi.yaml → SVG). Use when the user asks to make, draw, fix or render a diagram, figure, flowchart, pipeline, decision flow, block or architecture diagram "with Sumi", "as code", or as a *.sumi.yaml file, including Japanese requests such as 図・ダイアグラム・フローチャート・構成図・アーキテクチャ図・処理の流れ図を作って／描いて／Sumi で. Discovers components with `sumi catalog`, writes the YAML, then runs fmt → lint → render and inspects the SVG.
---

# Sumi: diagrams as code

Sumi turns declarative `*.sumi.yaml` into SVG using predefined components, themes and
profiles. Write YAML from the user's content and drive the CLI until clean. Never draw
SVG yourself or edit generated `.svg` / `.d2` files (a throwaway [mockup](references/mockup.md) is the exception).

## Ground rules

- **Use only what Sumi provides.** Components, variants, props, themes and
  profiles come from `sumi catalog --json`; fields from the Figure Schema
  ([figure-format](references/figure-format.md)). Never invent a component,
  variant, prop, field, theme, profile, style or icon name. If the diagram needs
  something Sumi lacks (free colors, a domain-specific shape), say
  so and use the closest generic component.
- **Do not fabricate content.** Labels and relationships come from the user or
  sources they point to. Keep facts (connections, names, numbers) separate from
  presentation (layout, variants, grouping). If a fact is missing or ambiguous,
  ask. Shortening a label for space is presentation; changing its meaning is not.
- **Let the CLI decide.** Diagnostics are the source of truth; do not guess validity.

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

The wrapper runs `$SUMI_BIN`, else its own Sumi checkout, else `sumi` on `PATH`, else
a checkout around the current directory; otherwise it exits 127 with install
instructions: relay them and stop (install nothing without asking). Use its absolute
path; below, `sumi` means the wrapper.

## Workflow

### 1. Clarify the figure

Before writing YAML, make sure you know:

- **Content**: the elements, their connections and exact labels; what belongs
  together. Keep a checklist (elements, directed labelled connections, inputs and
  outputs) for step 7.
- **Target** (the user's decision): where it goes (one column of a two-column paper,
  full width, a single-column paper's text width, a first-page overview, a README or
  web page, a slide), the venue's minimum text and line sizes and the height it may
  take. Width picks the profile (`screen-doc` for a README or web page, `presentation-16x9` for a slide); minimums and the height budget go in `figure.target`
  (a venue maximum below the profile's: set `height`, which only warns) ([placement](references/layout-tips.md#fit-the-placement)).
- **Theme**: `minimal` (default), `academic`, `color`, `slides` (a slide; any 7-9pt theme needs `textScale: 2` there)
  or `paper` — **recommend `paper` for a color paper figure** (`academic` if grayscale).
  Colour: white ground, colour only for meaning (2–3 hues + one accent), nothing translucent over colour; LLaDA is the exemplar ([colour](references/layout-tips.md#plan-the-visual-language-before-drawing)).
  Output: next to the user's files, `<figure-id>.sumi.yaml`.
- **Layout** (your choice, not a question): **auto** for flows and graphs;
  **structured** for paper block diagrams (layers, residuals, aligned columns, ⊕, math,
  tokens; [choose](references/layout-tips.md#choose-the-engine-first)), planned first ([paper figure workflow](#paper-figure-workflow)).

Ask once, briefly, for what is missing. If told to go ahead, assume `paper-single` +
`minimal` (`paper` for a paper figure) and report it.

### 2. Check the environment (once per session)

```sh
sumi doctor
```

Exit 0 and `Ready to render.` means D2, fonts and geometry lint are in place. If a
check fails, relay its `hint` and stop (a lone `d2` failure does not block structured
figures): reinstall the tarball, `bun run d2:install`, or set `SUMI_D2_PATH` (v0.9.0).

### 3. Discover components, themes and profiles

```sh
sumi catalog --json              # components, themes, profiles, icons, targets, sets
sumi catalog --json --section themes --section profiles   # only those sections
sumi catalog --kind node         # human-readable table, one kind of component
sumi catalog --icons "wave sine" # bundled icons whose names contain all the words
```

Pick each component from `components` by its `description` (`diamond` for a decision,
`cylinder` for storage). Symbols are components too: `operator` draws ⊕ ⊗ ⊖ ⊙ and
concat (`props.symbol: plus | times | minus | dot | concat`), `junction` a branch dot. Use only listed variants and props; `engines`, when present, lists the only layout engines it works in. The theme's
`compatibleProfiles` must include the profile, else labels fail with `profile/font-too-small`: `textScaleFor.<profile>`
is the `figure.themeOverrides.textScale` that fixes it (`sumi`: 2 for slides, 1.5 for `screen-doc`, a README); never lower
`target.minFontSize` or draw small and enlarge ([text scale](references/figure-format.md#text-scale)). Icons:
[assets](references/assets.md#icons).

### 4. Write the figure

**Start from the closest base layout.** Pick one by structure in the [layouts index](layouts/README.md) and view its PNG; plan the adaptation (labels, counts, tones, theme and profile from step 1), saying which layout you used. None fits: plan from scratch.

**Non-trivial layout? Then mock it up** (several panels, loops, state machines, sets, taxonomies, anything whose
arrangement is not obvious, however few nodes; skip only for an obvious one-directional flow): sketch the planned figure as an HTML/CSS page at real size
in Sumi's vocabulary and theme colours and check it against the step 1 checklist
([mockup](references/mockup.md), [template](references/mockup-template.html)). Then write the YAML: adapt the copied layout, or reproduce the mockup.

Then open the [examples index](examples/README.md), choose the 1–2 closest examples
by figure type and features, view their PNGs (Read shows images) and read their YAML.
Reuse their idioms (arrange boxes, tones, notes), never their content. Then read
[references/figure-format.md](references/figure-format.md) before your first figure. Essentials:

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
  - {id: api, component: box, label: "API\nserver", group: backend}
  - {id: db, component: cylinder, label: Database, group: backend}
edges:
  - {from: api, to: db, label: query}
```

- Every node needs `component`; groups default to `container`, edges to `arrow`.
  `from` / `to` reference node or group IDs; quote labels such as `"yes"`, `"no"`
  and anything containing `:` or `#`.
- Shape follows placement and content, not a rule. If it is not obvious (a short chain
  that fits is), render 2–4 candidates and compare ([fit the placement](references/layout-tips.md#fit-the-placement)).
- **Structured figures** add `figure.layout.arrange` (nested `stack` / `row` / `grid` / `place` / `chat`
  boxes listing every node and group once), `attach`, anchors, `align`, `sets`
  (overlapping Venn / hyperedge enclosures), and the `legend`, `tokens`, `matrix`, `bracket`, `separator`, `zoom` components and the `block-arrow` / `triangle-arrow` / `chevron` flow markers: read
  [structured](references/structured.md) first; a paper figure: the [paper figure
  workflow](#paper-figure-workflow). Label math (`'$\hat{y}_t$'`) works only there;
  with a line break, double-quote it and double backslashes (`"A\n$\\gamma$"`). Any
  group takes `labelAt` and `caption`.
- Icons, images, `figure.assets`: [assets](references/assets.md); rich cards: [html](references/html.md).

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
fix warnings unless intended (`lint/no-edges`), mentioning those you keep.

### 6. Render and check geometry

Render only after lint is clean (`render` does not run the `lint/*` rules).

```sh
sumi render figure.sumi.yaml              # writes figure.svg, then runs geometry lint
sumi render --json figure.sumi.yaml       # diagnostics as JSON ("output" = SVG path, "size")
sumi lint --geometry --json figure.sumi.yaml   # lint + render in memory + geometry; writes nothing
sumi render figure.sumi.yaml -o figure.pdf     # vector PDF (or -o figure.pptx); same checks
```

Write PDF or PPTX (one picture) only when asked ([output formats](references/figure-format.md#output-formats)); inspect the SVG either way.
`render` reports `geometry/*` diagnostics (page size, text size, overflow, overlaps).
Geometry errors exit 1 but **the SVG is still written**. It prints `Wrote figure.svg:
<W>mm × <H>mm (…)`; `--json` has `size` (`widthMm`, `heightMm`, limits, `fits`; `scale` if scaled).

- `geometry/exceeds-page-width` / `-height`: the width hint measures where the width goes and, if a trial verified it, names an edit: apply one, re-run ([width breakdown](references/diagnostics.md#too-wide-the-width-breakdown)). Else compare the [options](references/layout-tips.md#when-width-runs-short) and what each costs. A wider profile is the user's choice: ask, never switch on your own.
- `figure.target` adds `geometry/exceeds-target-height` (over budget) and
  `geometry/placement-usage` (reserved area: compare candidates by it).
- Geometry warnings (`edge-crosses-label`, `label-collision`, …): try the
  [layout-tips](references/layout-tips.md) workarounds once or twice, then keep and report them.
- Structured: `layout/no-route` (no SVG written): an edge has no room; widen that `gap`
  or move an attached node out of it ([spacing](references/structured.md#spacing-that-routes)).
  Also `layout/unsatisfied-align`, `layout/edge-label-overlap` (warnings),
  `layout/edge-crossing`, `layout/align-grew-figure` (infos); no `--emit-d2`.
- Other `svg/*`, `backend/*`, `asset/*`, `geometry/*` codes: [diagnostics](references/diagnostics.md).

### 7. Check content, then readability

Clean diagnostics prove neither. The script rasterizes the SVG (Quick Look, Chrome, else
`rsvg-convert`, which ignores embedded fonts: regular-looking bold is a preview artefact; exit 1
if none: skip the PNG, say so); open the PNG with Read, ~6 px per printed mm of the larger side:

```sh
<skill-dir>/scripts/preview figure.svg 1080   # 180 × 60mm; writes figure.png beside the SVG (-o <png> to move it)
```

1. **Content.** Tick each item of the step 1 checklist in the YAML (node, label, edge
   `from` → `to`) and in the PNG (present, readable, arrow pointing the right way);
   nothing may be added. Fix omissions, wrong directions and labels before layout
   polish. In the YAML but unreadable in the PNG is a legibility defect: fix size or spacing.
2. **Readability.** Reading order follows `direction` (or the tree); no label overlaps
   a line or shape; no edge crosses a group title (`labelAt`); nothing is huge or
   squashed; a block-sized void has a reason (grouping, alignment), else re-arrange.
3. **Consistency (paper figures).** Against the visual-language table: the same kind
   of thing looks the same in every panel (usually one fill and border per kind, e.g. all sets; emphasise with an accent colour rather than another form; judge panel frames case by case); no text-heavy boxes; one legend; no edge
   crosses a panel except the main flow; the figure reads without its caption; resolve
   `geometry/sparse-figure` and `text-heavy-nodes` ([density](references/diagnostics.md#density-of-paper-figures)), never suppress.
4. **Critique against references (paper figures, mandatory).** `<skill-dir>/scripts/compare figure.svg <ref.png>...`
   stacks yours with the closest examples (plus `tricl`/`llada` if dense); critique by the [checklist](references/layout-tips.md#critique-against-references),
   ideally by a fresh view (a subagent shown only image and checklist); verify each measurable claim (size, colour, opacity, position) in the YAML or `sumi` output before acting; fix, repeat.

### 8. Report

Tell the user: files written (YAML, SVG), size and profile, placement constraints, candidates compared and why, final lint and render summaries (kept warnings with reasons), assumptions, what you could not verify. Show the YAML only if asked or short.

## Paper figure workflow

Paper figures are structured, theme `paper`, built to the [design principles](references/layout-tips.md#design-principles).
With **content only** (the usual case), first [plan the visual language](references/layout-tips.md#plan-the-visual-language-before-drawing)
(a table: each kind of thing, one visual form and tone), then [plan the layout](references/layout-tips.md#plan-the-layout-before-writing-yaml): roles, placement constraints, candidates rendered and compared.
Objects and data are pictures (icons, glyphs, `sets`), operations arrows; minimal text; one vocabulary and tone meaning in every panel; one legend; numbered stage columns. With **a reference figure**, map each look to a field ([recipe](references/layout-tips.md#paper-figure-recipe))
and keep its arrangement unless it breaks the placement or the principles (say so). Read as needed:

1. [Example 6](references/examples.md#6-success-a-paper-figure) (three panels, zoom, dimmed variant).
2. Structure: [arrange trees](references/structured.md#arrange-trees), [grids](references/structured.md#grids), [titles and captions](references/structured.md#group-titles-and-captions), [panel separators](references/structured.md#panel-separators), [two panels with a divider](references/layout-tips.md#two-panels-with-a-dashed-divider).
3. Cells: [tokens](references/structured.md#token-sequences) (numbering, `lines`, `lineAlign`), [matrices](references/structured.md#matrices).
4. Pictures: [crop, shared assets](references/assets.md#reusing-one-picture-figureassets), [framed images, operator size](references/assets.md#framed-images-and-operator-size), [html](references/html.md) cards.
5. Looks: [tones and variants](references/figure-format.md#tones-and-variants), [themeOverrides](references/figure-format.md#themes-and-profiles), [`fit: scale`, `density: compact`](references/layout-tips.md#shrinking-to-the-page-width-figurefit-scale).
6. Loop `fmt` → `lint` → `render` ([diagnostics](references/diagnostics.md)), then step 7 (its step 4 is mandatory).

## When to stop and ask
Stop, report the state (last diagnostics, attempts) and ask when:

- the same error persists after **3 fix attempts**, or the figure is not clean after **6 rounds**;
- a fix would change the content (dropping or merging elements, rewording, inventing a connection);
- the fix needs the user's choice: profile or theme, page size, splitting the figure;
- the diagram needs a capability Sumi does not have;
- a command exits 2 for a reason you cannot fix (e.g. D2 missing).

## References
[Layouts](layouts/README.md): generic starting skeletons to adapt (step 4) · [Examples](examples/README.md): look at the closest ones before writing and after
rendering (steps 4 and 7); they are references for idioms, not content to copy.
[figure-format](references/figure-format.md) (fields, labels, math, tones, groups, themes,
profiles, target) · [structured](references/structured.md) (arrange trees, grids, attach,
align, anchors, sets, legends, zoom, tokens, matrices) · [assets](references/assets.md) ·
[html](references/html.md) · [mockup](references/mockup.md) · [diagnostics](references/diagnostics.md) (fixes by code) ·
[layout-tips](references/layout-tips.md) (engine, placement, width options, design
principles, planning, paper recipe) · [examples](references/examples.md)
