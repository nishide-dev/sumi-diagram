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
| [pipeline-linear](pipeline-linear/pipeline-linear.sumi.yaml) | Input, one frame containing four stages, output | A single chain with no loops or branches | [PNG](pipeline-linear/pipeline-linear.png) |
| [pipeline-feedback](pipeline-feedback/pipeline-feedback.sumi.yaml) | A row of stages ending in a check that loops back, plus a repeated stage | Iterative refinement, validate-and-retry | [PNG](pipeline-feedback/pipeline-feedback.png) |
| [pipeline-branch-merge](pipeline-branch-merge/pipeline-branch-merge.sumi.yaml) | One flow forks into parallel branches and joins before the output | Ensembles, multi-view or multi-scale features, map-reduce | [PNG](pipeline-branch-merge/pipeline-branch-merge.png) |
| [multi-stage-data-flow](multi-stage-data-flow/multi-stage-data-flow.sumi.yaml) | Data → preprocessing → model → evaluation with a store under each stage | The chain and what each stage saves or loads (datasets, checkpoints, metrics) | [PNG](multi-stage-data-flow/multi-stage-data-flow.png) |
| [encoder-decoder](encoder-decoder/encoder-decoder.sumi.yaml) | Encoder and decoder stacks side by side; the encoder's last layer feeds every decoder layer | Seq2seq, encoder-decoder transformers, two towers | [PNG](encoder-decoder/encoder-decoder.png) |
| [residual-skip-stack](residual-skip-stack/residual-skip-stack.sumi.yaml) | One bottom-up column with long skips to mirror layers (one column) | U-Net, hourglass, autoencoder with skips | [PNG](residual-skip-stack/residual-skip-stack.png) |
| [moe-router](moe-router/moe-router.sumi.yaml) | A router dispatching to a column of experts, merged by a weighted sum | Mixture of experts, top-k routing, gated ensembles | [PNG](moe-router/moe-router.png) |
| [layered-stack](layered-stack/layered-stack.sumi.yaml) | Stacked full-width bands with one path drawn through them | Application / middleware / OS, protocol stacks, abstraction levels | [PNG](layered-stack/layered-stack.png) |
| [two-panel-compare](two-panel-compare/two-panel-compare.sumi.yaml) | Baseline and proposed method in two panels with identical shared steps | Baseline vs ours, before vs after | [PNG](two-panel-compare/two-panel-compare.png) |
| [three-panel-flow](three-panel-flow/three-panel-flow.sumi.yaml) | Three framed panels (a) (b) (c) joined by block arrows | A method in three stages that each need their own small picture | [PNG](three-panel-flow/three-panel-flow.png) |
| [feature-table](feature-table/feature-table.sumi.yaml) | A methods × properties `matrix` (one column) | Related-work or capability comparison with the proposed row standing out | [PNG](feature-table/feature-table.png) |
| [ablation-grid](ablation-grid/ablation-grid.sumi.yaml) | One row per variant of the same pipeline with components removed | Ablations: full model vs w/o A vs w/o B | [PNG](ablation-grid/ablation-grid.png) |
| [loop-cycle](loop-cycle/loop-cycle.sumi.yaml) | A ring of three stages, entered from above and left at the side | A loop that must read as a loop (generate, evaluate, update) | [PNG](loop-cycle/loop-cycle.png) |
| [state-machine](state-machine/state-machine.sumi.yaml) | Start dot, four states, labelled transitions, a self-loop, an end ring | Protocols, lifecycles, modes with retries | [PNG](state-machine/state-machine.png) |
| [agent-loop](agent-loop/agent-loop.sumi.yaml) | Observe → plan → act closed through the environment, memory and tools beside | LLM agents, controllers, planners with side resources | [PNG](agent-loop/agent-loop.png) |
| [decision-tree](decision-tree/decision-tree.sumi.yaml) | One root question, two follow-ups, four outcome leaves | Choosing by a few yes/no questions | [PNG](decision-tree/decision-tree.png) |
| [timeline-lanes](timeline-lanes/timeline-lanes.sumi.yaml) | A time axis with three lanes of activities spanning periods, dependencies | Project plans, training schedules, parallel tracks over time | [PNG](timeline-lanes/timeline-lanes.png) |
| [hierarchy-tree](hierarchy-tree/hierarchy-tree.sumi.yaml) | Root, categories, items and sub-items, top down with shared trunks | Taxonomies with one parent each, org charts, decompositions | [PNG](hierarchy-tree/hierarchy-tree.png) |
| [venn-three](venn-three/venn-three.sumi.yaml) | Three-set Venn with an item in each of the seven regions | Items sharing one, two or three properties | [PNG](venn-three/venn-three.png) |
| [nested-containers](nested-containers/nested-containers.sumi.yaml) | System frame holding subsystem frames, external actors outside | What lives inside what and what crosses the boundaries | [PNG](nested-containers/nested-containers.png) |
| [client-service-data](client-service-data/client-service-data.sumi.yaml) | Clients, entry, services, data stores as four columns | System overviews, backends, serving stacks | [PNG](client-service-data/client-service-data.png) |
| [microservices-bus](microservices-bus/microservices-bus.sumi.yaml) | Producers above and consumers below one shared bus (one column) | Event bus, message queue, pub/sub | [PNG](microservices-bus/microservices-bus.png) |

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
