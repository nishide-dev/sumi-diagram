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

- **Use only what Sumi provides.** Components, variants and props come from
  `sumi catalog --json`; fields from the Figure Schema; themes and profiles
  from the lists in [references/figure-format.md](references/figure-format.md)
  (or the hint of a `theme/unknown` / `profile/unknown` diagnostic). Never
  invent a component, variant, prop, field, theme, profile or style. If the
  diagram needs something Sumi lacks (icons, colors per node, ports, a
  domain-specific shape), say so and use the closest generic component.
- **Do not fabricate content.** Labels and relationships come from the user
  or from sources they point you to. Keep facts (what is connected to what,
  names, numbers) separate from presentation (layout, variants, grouping).
  If a fact is missing or ambiguous, ask; do not fill gaps with plausible
  text. Shortening a label for space is presentation; changing its meaning is not.
- **Let the CLI decide.** Treat diagnostics as the source of truth and fix
  what they report; do not guess whether something is valid.

## Running the CLI

This skill ships a wrapper that runs Sumi from this repository's source from
any directory and points it at the repository's pinned D2:

```sh
<skill-dir>/scripts/sumi <command> ...   # <skill-dir> = the base directory of this skill
```

Use the absolute path in every command (shell variables do not persist
between Bash calls). Below, `sumi` means that wrapper. If the wrapper is
unavailable (skill copied outside the repository) but a `sumi` executable is
on `PATH`, use that instead. Do not install anything without asking.

## Workflow

### 1. Clarify the figure

Before writing YAML, make sure you know:

- **Content**: the elements (steps, components, states), the connections
  between them and their exact labels; which elements belong together.
- **Target**: one paper column (`paper-single`, max 88mm wide), a full-width
  paper figure (`paper-double`, 180mm) or a slide (`presentation-16x9`).
  This is the user's decision — ask if it is not stated. See
  [layout-tips](references/layout-tips.md) for the current limits of
  `presentation-16x9`.
- **Theme** (`minimal` or `academic`; default `minimal`) and the output
  path (default: the figure next to the user's other files, named
  `<figure-id>.sumi.yaml`).

Ask once, briefly, for what is missing. If the user says to go ahead
without answering, use `paper-single` + `minimal` and state the assumption
in your report.

### 2. Check the environment (once per session)

```sh
sumi doctor
```

Exit 0 and `Ready to render.` means D2, the fonts and the geometry lint
are in place. If the `d2` check fails, tell the user to run
`bun run d2:install` in the repository (or set `SUMI_D2_PATH` to a D2
v0.9.0 binary) and stop. `sumi lint` without `--geometry` works without D2.

### 3. Discover components

```sh
sumi catalog --json              # all components: id, kind, variants, props (JSON Schema)
sumi catalog --kind node         # human-readable table, one kind
```

Pick each node, group and edge component from this output, matching the
`description` to the element's role (e.g. `diamond` for a decision,
`cylinder` for storage). Use a variant only if it is listed for that
component, and props only if they are in its `props` schema.

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
nodes:
  - id: api
    component: box
    label: "API\nserver"   # plain text; \n breaks the line
    group: backend         # membership is declared on the child
  - id: db
    component: cylinder
    label: Database
    group: backend
edges:
  - from: api
    to: db
    label: query
```

- Every node needs `component`; groups default to `container`, edges to `arrow`.
- `from` / `to` reference node or group IDs; quote labels such as `"yes"`,
  `"no"` and anything containing `:` or `#`.
- Choose `direction` for the target width: chains of four or more nodes
  laid out `right` do not fit `paper-single` — prefer `down`
  ([layout-tips](references/layout-tips.md)).
- Editors can validate against `schema/figure.v1.schema.json`.

### 5. Format, lint, fix

```sh
sumi fmt figure.sumi.yaml
sumi lint --json figure.sumi.yaml
```

`lint` checks everything that does not need rendering: YAML, schema,
references, components, theme, profile and the structural `lint/*` rules.
Each diagnostic has `code`, `severity`, `message`, `path` (where in the
YAML, e.g. `["nodes", 2, "variant"]`), `location` (line/column) and often a
`hint` with the valid values or a near match. Fix the YAML at `path`
following the `hint`, then run `fmt` and `lint` again. Errors on an element
hide follow-up errors that depend on it, so new diagnostics can appear after
a fix — that is progress. Per-code fixes:
[references/diagnostics.md](references/diagnostics.md).

Exit codes (all commands): 0 clean (warnings allowed), 1 problems found,
2 usage error (bad flag, unknown `--theme`/`--profile`, unreadable file) —
fix the command, not the figure.

Resolve every error. Fix warnings unless they are intended (e.g.
`lint/no-edges` for a deliberate set of unconnected nodes) and mention the
ones you keep.

### 6. Render and check geometry

Render only after lint is clean (`render` does not run the `lint/*` rules).

```sh
sumi render figure.sumi.yaml              # writes figure.svg, then runs geometry lint
sumi render --json figure.sumi.yaml       # same; diagnostics as JSON ("output" = SVG path)
sumi lint --geometry --json figure.sumi.yaml   # lint + render in memory + geometry; writes nothing
```

`render` measures the drawn figure and reports `geometry/*` diagnostics
(page width/height, label overflow, overlaps, labels crossed by edges).
Geometry errors make it exit 1 but **the SVG is still written**, so you can
look at the problem. The text mode also prints `Wrote figure.svg: <W>mm ×
<H>mm (<profile>, max width <M>mm[, TOO WIDE]; theme <theme>)`.

- `geometry/exceeds-page-width`: change the layout (usually
  `direction: down`) or shorten labels. The hint also mentions a wider
  profile — that is the user's choice; ask, never switch on your own.
- Geometry warnings (`edge-crosses-label`, `label-collision`, …) are
  readability problems D2/ELK does not always let you fix; try the
  workarounds in [layout-tips](references/layout-tips.md) once or twice,
  then keep them and mention them in the report.
- Render errors (`svg/*`, `backend/*`) and every `geometry/*` code are in
  [diagnostics](references/diagnostics.md).

### 7. Inspect the result

Look at the rendered figure; clean diagnostics do not guarantee readability.
Rasterize it and open the printed PNG path with the Read tool:

```sh
<skill-dir>/scripts/preview figure.svg    # prints a temporary PNG path
```

It uses Quick Look on macOS and `rsvg-convert` elsewhere (exit 1 if
neither exists — then skip this step and say so in the report). Check:
reading order follows `direction`; no label overlaps a line or a shape;
edges do not cross group labels; nothing is unexpectedly huge or squashed;
text is legible. Known D2/ELK layout quirks and their workarounds are in
[layout-tips](references/layout-tips.md).

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

[figure-format](references/figure-format.md) (fields, IDs, groups, edges,
themes, profiles, common mistakes) · [diagnostics](references/diagnostics.md)
(fixes by code) · [layout-tips](references/layout-tips.md) (direction, labels,
groups, known layout issues) · [examples](references/examples.md) (one
success, two failure-and-fix runs)
