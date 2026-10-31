---
name: sumi
description: Build, check and render diagrams as code with the Sumi CLI (*.sumi.yaml → SVG). Use when the user asks to make, draw, fix or render a diagram, figure, flowchart, pipeline, decision flow, block or architecture diagram "with Sumi", "as code", or as a *.sumi.yaml file, including Japanese requests such as 図・ダイアグラム・フローチャート・構成図・アーキテクチャ図・処理の流れ図を作って／描いて／Sumi で. Discovers components with `sumi catalog`, writes the YAML, then runs fmt → lint → render and inspects the SVG.
---

# Sumi: diagrams as code

Sumi turns a declarative `*.sumi.yaml` figure into an SVG, using only
predefined components, built-in themes and output profiles. Your job is to
write that YAML from the user's content and drive it through the CLI until
it is clean — never to draw the SVG yourself, and never to edit generated
`.svg` or `.d2` files.

## Ground rules

- **Use only what Sumi provides.** Components, variants and props, themes
  and profiles come from `sumi catalog --json` (`components`, `themes`,
  `profiles`); fields from the Figure Schema
  ([references/figure-format.md](references/figure-format.md)). Never
  invent a component, variant, prop, field, theme, profile, style or icon
  name. If the diagram needs something Sumi lacks (free colors or
  coordinates, a domain-specific shape), say so and use the closest
  generic component.
- **Do not fabricate content.** Labels and relationships come from the user
  or from sources they point you to. Keep facts (what is connected to what,
  names, numbers) separate from presentation (layout, variants, grouping).
  If a fact is missing or ambiguous, ask; do not fill gaps with plausible
  text. Shortening a label for space is presentation; changing its meaning is not.
- **Let the CLI decide.** Treat diagnostics as the source of truth and fix
  what they report; do not guess whether something is valid.

## Prerequisites

The skill drives the Sumi CLI but does not contain it. Install a release
(macOS / Linux) from [GitHub Releases](https://github.com/nishide-dev/sumi-diagram/releases):
extract `sumi-<version>-<target>.tar.gz` intact, put its `bin/sumi` on `PATH`
(D2 and fonts are bundled), check with `sumi doctor`. Optional: `SUMI_BIN`,
`SUMI_D2_PATH` (D2 v0.9.0). A source checkout needs Bun + `bun run d2:install`.

## Running the CLI

```sh
<skill-dir>/scripts/sumi <command> ...   # <skill-dir> = the base directory of this skill
```

This wrapper runs `$SUMI_BIN`, else the Sumi source checkout it lives in,
else `sumi` on `PATH`, else a checkout around the current directory;
otherwise it exits 127 with install instructions — relay them and stop
(install nothing without asking). Use the absolute path in every command
(shell variables do not persist). Below, `sumi` means the wrapper.

## Workflow

### 1. Clarify the figure

Before writing YAML, make sure you know:

- **Content**: the elements (steps, components, states), the connections
  between them and their exact labels; which elements belong together.
- **Target**: one paper column (`paper-single`, max 88mm wide), a full-width
  paper figure (`paper-double`, 180mm) or a slide (`presentation-16x9`).
  This is the user's decision — ask if it is not stated. What fits on a
  slide: [layout-tips](references/layout-tips.md).
- **Theme**: `minimal` (default), `academic`, `color`, `slides` (needed
  for a slide) or `paper` — **recommend `paper` for a color paper figure**
  (pastel tones, rounded corners, thin lines, Inter, as published ML figures;
  `academic` if it must be grayscale for black-and-white print). And the output path (default: next to the user's
  other files, named `<figure-id>.sumi.yaml`).
- **Layout** (your choice, not a question): flows and graphs use the
  default **auto** layout; paper block diagrams (stacked layers, residuals,
  aligned columns, ⊕ operators, math labels) use the **structured** layout.
  See [layout-tips](references/layout-tips.md#choose-the-engine-first).

Ask once, briefly, for what is missing. If the user says to go ahead, use
`paper-single` + `minimal` (`paper` for a paper figure) and say so in your report.

### 2. Check the environment (once per session)

```sh
sumi doctor
```

Exit 0 and `Ready to render.` means D2, the fonts and the geometry lint
are in place. If a check fails, relay its `hint` and stop — except that a
`d2` failure alone does not block structured figures (no D2 needed). For
`d2`: reinstall the release tarball, `bun run d2:install` in a checkout, or
set `SUMI_D2_PATH` (v0.9.0).

### 3. Discover components, themes and profiles

```sh
sumi catalog --json              # { version, components, themes, profiles }
sumi catalog --json --section themes --section profiles   # only those sections
sumi catalog --kind node         # human-readable table, one kind of component
sumi catalog --icons "wave sine" # bundled icons whose names contain all the words
```

Pick each node, group and edge component from `components`, matching the
`description` to the element's role (e.g. `diamond` for a decision,
`cylinder` for storage, `stack` for a collection of layers if available).
Use only listed variants and props; `engines`, when present, lists the
only layout engines a component works in. The theme's `compatibleProfiles`
must include the profile, else labelled elements fail with
`profile/font-too-small`. Page limits and spacing are in `profiles`
([figure-format](references/figure-format.md#discovering-themes-and-profiles)).
Colour symbols: 47 bundled `emoji/` names ([assets](references/assets.md#icons), catalog) keep their palette even in dimmed groups; Tabler follows text colour.

### 4. Write the figure

Read [references/figure-format.md](references/figure-format.md) before
writing your first figure. Essentials:

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
- `from` / `to` reference node or group IDs; quote labels such as `"yes"`,
  `"no"` and anything containing `:` or `#`.
- Choose `direction` for the target width: a chain of 4+ nodes laid out
  `right` does not fit `paper-single`; prefer `down` ([layout-tips](references/layout-tips.md)).
- **Structured figures** add `figure.layout.arrange` (nested `stack` /
  `row` boxes listing every node and group once), `attach`, anchors,
  `align`, `legend`, `tokens`, `bracket`, `matrix`, `zoom`: read [references/structured.md](references/structured.md)
  first; for a figure modelled on a published one, the [paper figure recipe](references/layout-tips.md#paper-figure-recipe). Label math
  (`'$\hat{y}_t$'`) works only there; with a line break, double-quote it and
  double backslashes (`"A\n$\\gamma$"`). Any group takes `labelAt` and
  `caption` (edges to elements below it can detour around the caption).
- Icons (`icon: tabler/<name>`, in place of a label) and image files
  (`component: image`): [references/assets.md](references/assets.md).

### 5. Format, lint, fix

```sh
sumi fmt figure.sumi.yaml
sumi lint --json figure.sumi.yaml
```

`lint` checks everything that does not need rendering: YAML, schema,
references, layout, components, assets, theme, profile and the structural
`lint/*` rules. Each diagnostic has `code`, `severity`, `message`, `path`
(where in the YAML, e.g. `["nodes", 2, "variant"]`), `location` and often
a `hint` with the valid values or a near match. Fix the YAML at `path`
following the `hint`, then `fmt` and `lint` again. Errors on an element hide
follow-up errors, so new diagnostics can appear after a fix — that is
progress. Per-code fixes: [references/diagnostics.md](references/diagnostics.md).

Exit codes: 0 clean (warnings allowed), 1 problems found, 2 usage error
(bad flag, unknown `--theme`/`--profile`, unreadable file) — fix the command.
Resolve every error. Fix warnings unless intended (e.g. `lint/no-edges` for
deliberately unconnected nodes) and mention the ones you keep.

### 6. Render and check geometry

Render only after lint is clean (`render` does not run the `lint/*` rules).

```sh
sumi render figure.sumi.yaml              # writes figure.svg, then runs geometry lint
sumi render --json figure.sumi.yaml       # same; diagnostics as JSON ("output" = SVG path, "size")
sumi lint --geometry --json figure.sumi.yaml   # lint + render in memory + geometry; writes nothing
sumi render figure.sumi.yaml -o figure.pdf     # vector PDF instead (or --format pdf); same checks
```

Write a PDF (page = figure size, text stays text) or `-o figure.pptx` (one
picture, not editable shapes) only when the user asks; inspect the SVG
(step 7) either way. Limits: [output formats](references/figure-format.md#output-formats).

`render` measures the drawn figure and reports `geometry/*` diagnostics
(page size, label overflow, overlaps, labels crossed by edges). Geometry
errors make it exit 1 but **the SVG is still written**, so you can look at
the problem. It prints `Wrote figure.svg: <W>mm × <H>mm (…)`; with
`--json`, read `size` (`widthMm`, `heightMm`, limits, `fits`; `null` if
nothing was rendered).

- `geometry/exceeds-page-width` / `-height`: shorten labels, change the
  layout. Auto: the other `layout.direction`; if both overflow, see
  [layout-tips](references/layout-tips.md#too-wide-with-right-too-tall-with-down).
  Structured ignores it: re-arrange the trees (a long row as two rows),
  reduce `gap`s. A wider profile (none allows over 220mm height), if not on it,
  is the user's choice: ask, never switch on your own.
- Geometry warnings (`edge-crosses-label`, `label-collision`, …) are
  readability problems D2/ELK does not always let you fix; try the
  workarounds in [layout-tips](references/layout-tips.md) once or twice,
  then keep them and mention them in the report.
- Structured: `layout/no-route` (no SVG written) means an edge has no room:
  widen that `gap` or move an attached node out of it ([structured](references/structured.md#spacing-that-routes)).
  Render also reports `layout/unsatisfied-align`, `layout/edge-label-overlap`
  (warnings), `layout/edge-crossing` (info: fix if easy, else report the
  count) and `layout/align-grew-figure` (info: `align` enlarged the figure). `--emit-d2` is refused for structured figures (they do not use D2).
- Render errors (`svg/*`, `backend/*`, `asset/*`) and every `geometry/*`
  code are in [diagnostics](references/diagnostics.md).

### 7. Inspect the result

Look at the rendered figure; clean diagnostics do not guarantee readability.
Rasterize it and open the printed PNG path with the Read tool:

```sh
<skill-dir>/scripts/preview figure.svg    # prints a temporary PNG path
```

It uses Quick Look on macOS (padded to a square: the blank space is not
part of the figure), else `rsvg-convert`; exit 1 if neither exists — skip
this step and say so in the report. Check: reading order follows
`direction` (or the arrange tree); no label overlaps a line or a shape;
no edge crosses or detours around a group title (move it: `labelAt`);
nothing is huge or squashed; text is legible. Quirks: [layout-tips](references/layout-tips.md).

### 8. Report

Tell the user: the files written (YAML and SVG), the size and profile, the
final lint and render summaries (and any warnings you kept, with reasons), the
assumptions you made, and anything you could not verify (e.g. content you
were unsure of). Show the YAML only if asked or if it is short.

## When to stop and ask

Stop, report the current state (last diagnostics, what you tried) and ask
instead of guessing when:

- the same error persists after **3 fix attempts**, or a figure is not clean
  after **6 fix rounds** in total;
- a fix would change the content (dropping or merging elements, rewording
  a label beyond shortening, inventing a connection);
- the fix needs a choice that belongs to the user: profile or theme, page
  size, splitting the figure into several figures;
- the diagram needs a capability Sumi does not have;
- a command exits 2 for a reason you cannot fix (e.g. D2 missing).

## References

[figure-format](references/figure-format.md) (fields, IDs, labels, math and
accents, groups, edges, tones, themes, profiles, common mistakes) ·
[structured](references/structured.md) (arrange trees, group titles and
captions, attach, align, anchors, fan-in, edge labels, crossings, legends, tokens, brackets, matrices) ·
[assets](references/assets.md) (icons, images) · [diagnostics](references/diagnostics.md)
(fixes by code) · [layout-tips](references/layout-tips.md) (choosing the
engine, auto issues, paper figure recipe, workarounds → fields) · [examples](references/examples.md)
