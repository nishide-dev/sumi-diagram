# Base layouts

Generic, content-light starting skeletons for the arrangements that come up again and
again. **Pick the closest one before you write a figure, copy its directory and adapt
it** (labels, counts, tones). Each is a checked `*.sumi.yaml` with a header comment
(purpose, when to use, structure, what to change, lint result), its SVG and a PNG
thumbnail (view it with Read). Unlike the [examples](../examples/README.md), which show
finished figures and reproduce published ones, these carry placeholder labels
("Stage A", "Item B1") that you replace with the user's content; never ship a
placeholder.

## How to use

1. Match the request to the table below by structure, not by topic. None fits: use the
   closest [example](../examples/README.md) instead, or start from scratch.
2. View the PNG, read the YAML header and the YAML, and plan the adaptation: what to
   keep, change, add or delete. Then mock it up when the [mockup](../references/mockup.md)
   step requires it, and only then adapt the YAML. Say which layout you started from
   in the report.
3. Copy the directory, rename `figure.id`, replace every label, and change the count of
   stages, rows, items or sets by copying or deleting whole units (a node with its edges,
   a grid row of the same width). Keep the alignments (`align`, `place` coordinates,
   shared columns) consistent when you do. **Apply the theme, profile and `textScale`
   chosen in step 1** to `figure.theme`, `figure.profile` and `figure.themeOverrides`:
   the layout's own `sumi` / `paper-double` are only its defaults. A narrower profile or
   another theme changes the fit, so recheck the size and geometry.
4. Loop `fmt` → `lint --geometry` → `render` as usual, then check the figure by eye
   against the user's content (step 7). The layout is lint-clean; your adaptation must be too.

The layouts use the default `sumi` theme and a paper profile; switching the theme or
profile is the usual `figure.theme` / `figure.profile` edit (a slide needs
`textScale: 2`, see [text scale](../references/figure-format.md#text-scale)).

## Layouts

| Name | Structure | Use when | Thumbnail |
| --- | --- | --- | --- |
| [encoder-block](encoder-block/encoder-block.sumi.yaml) | Overview panel (input, pieces, embedding, stack, head) and one repeated block opened beside it, with residual bypasses | A model is a stack of identical blocks and one block needs its inner structure shown | [PNG](encoder-block/encoder-block.png) |
| [train-infer-panels](train-infer-panels/train-infer-panels.sumi.yaml) | Two panels side by side, stages joined by dashed "shared weights" arrows, token rows, an iteration loop, a legend | One model, two modes (training vs inference, teacher vs student) with the same stages | [PNG](train-infer-panels/train-infer-panels.png) |
| [compare-rows](compare-rows/compare-rows.sumi.yaml) | Three rows on one column grid; later rows add steps (orange) and a dashed feedback loop | Comparing variants of a pipeline step by step | [PNG](compare-rows/compare-rows.png) |
| [set-taxonomy](set-taxonomy/set-taxonomy.sumi.yaml) | A row of four overlapping ellipses with items inside and shared items in the overlaps | A non-exclusive taxonomy: families that overlap | [PNG](set-taxonomy/set-taxonomy.png) |

## Maintaining (in the repository)

`bun run gallery` regenerates each SVG and `gallery:check` fails when one is stale; the
PNGs come from `bun run skill:previews` (needs Chrome or Quick Look), which also writes
`previews.json`, the SHA-256 of each SVG its PNG was made from; the test fails when a PNG is older
than its SVG, so rerun it after `gallery`. Tests (`src/cli/skill-layouts.test.ts`) check
that every directory renders, is `fmt`- and `lint`-clean with no errors or warnings, that
the SVG is current and that this table lists exactly the directories. Add a layout by
drawing it with the Skill's workflow (mockup, YAML, review), giving it the header
comment, then adding a row here. Keep the content generic: no paper, product, author or
affiliation names.
