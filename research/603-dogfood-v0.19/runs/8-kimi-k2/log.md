# Run 8 kimi-k2 log

Start: 2026-11-20 16:38:00

## Setup
- `sumi doctor --skill-version 0.19.1`: Ready to render; Skill matches CLI.
- Source: arXiv HTML 2507.20534 (Kimi K2 tech report). Theme `sumi`, profile `paper-double`.

## Source facts shown (section refs)
- §3.1.1 (under §3.1 Supervised Fine-Tuning), three stages: tool spec generation, agent & task generation, trajectory generation.
  - 3000+ real MCP tools fetched from GitHub; 20,000+ synthetic tools from hierarchical domain evolution; both form a tool repository.
  - Thousands of agents: varied system prompts + tool combinations from the repository.
  - Tasks generated per agent, each paired with an explicit rubric.
  - Multi-turn trajectories: LLM-simulated users, a tool simulator (world-model-like, stateful) executes calls; real execution sandboxes for coding/SWE.
  - LLM judge scores each trajectory against its rubric; only successful ones are kept (training data).
- §3.3.1 colocated architecture: training and inference engines live on the same workers; one offloads its GPU resources while the other works.
- §3.3.2 distributed checkpoint engine colocated on training nodes; broadcasts full parameter set; inference engines pull their shard; full update < 30 s.
- §3.3.4 agentic rollout: environments such as a virtual machine or code interpreter as services; partial rollout; Gym-style interface.
- Caveat (recorded, not hidden): the paper ties the §3.1.1 data to SFT, not directly to RL. The request says the data "flows into" the RL loop; the figure therefore shows kept trajectories -> SFT model -> policy entering the colocated RL loop (SFT before RL, §3.2 / self-critique "SFT stage"), rather than inventing a direct data->RL edge.

## Layout and mockup
- Base layout: `three-panel-flow` (framed captioned panels joined by a block arrow), reduced to two panels; loop in panel (b) inspired by `pipeline-feedback`/`agent-loop`.
- Mockup: yes (two panels + a loop = non-obvious arrangement per SKILL.md). Colours probed from a rendered probe in `sumi`. Round 1 issues: "Kept trajectories" overflowed its box, panel (b) crowded (checkpoint engine squeezed beside), edge labels touching frames.
- Examples viewed: llada (colour/density), agent-loop layout.

## Rounds
1. draft1: lint clean; render 234.6mm wide (error exceeds-page-width), `muted` panels drawn as dark sand fill (#e1d9bc) with color-on-panel infos, label collisions (actions/obs., broadcast).
2. groupFill '#ffffff', density compact, repository as a plain column item, two-line engine labels: 199.5mm; cylinder stretched by row `align: stretch`; agent->judge edge on the dashed border.
3. Tried `figure.layout.align` y [agent, judge], [sft, infer]: +30mm height (align-grew-figure), dropped; cylinder height 16mm too small (label-overflow, hint said 56pt).
4. `fit: scale` (94.8%), cylinder 20mm, extra 5mm gap between Rollouts and Filtering: 0 errors/0 warnings.
5. Panel (a) columns `align: center` so the stage headings sit on their content (was a void under each heading).
6. Critique vs llada + three-panel-flow (compare.png): voids in (a) above/below columns; SFT link implicit -> "Policy / after SFT"; tightening panel (b) gaps brought back label collisions (reverted in 7).
7-8. Gaps restored; Rollouts gap 5.5mm cleared arrowhead-cramped infos.

## Critique (self, per checklist; no subagent per study rules)
1. Density: (a) has ~10mm bands above/below the columns because (b) is taller; accepted (stretching would separate headings from content again).
2. Sizes: one box size per column (matchWidth), uniform 1pt frames.
3. Vocabulary: blue tinted = data, green tinted = model/engine (Agent in (a) and engines in (b)), gray outlined = simulator/environment, orange = judge; one legend.
4. Colour: white ground, 3 accent tones (theme colorUse max 3), no colour on filled panels.
5. Text: short labels; numbers only as sublabels.
6. Flow: left to right in (a), block arrow, top-down loop in (b) with dashed broadcast return.
7. Main subject: no single emphasised element; the two panels carry equal weight.

## Final
- End: 2026-11-20 16:43:57
- Renders: 8 of the figure (+1 colour probe, +1 mockup screenshot).
- Final `lint`: 0/0/0. `render`: 0 errors, 0 warnings, 1 info (geometry/arrowhead-cramped on synth->repo: the bend sits right before the arrowhead; kept, the head is still readable). 180mm x 78.5mm, scaled to 93.5% (`fit: scale`; smallest text 7pt*0.935 = 6.5pt, above the 5pt scaled minimum).
- Layout: three-panel-flow (two panels). Mockup: yes.

## What was hard / what Sumi could not express
- Width: five stage columns + a loop panel did not fit 180mm at natural size; ended with `fit: scale` 93.5%. The width hint was very useful (named the runs and verified edits).
- figure-format.md says a `muted` group has "a solid gray border and a white background" in non-academic themes, but in `sumi` it is a dark sand fill (#e1d9bc), darker than the default group; the white panel needed `themeOverrides.groupFill`. Doc/theme mismatch.
- `figure.layout.align` to put agent and judge on one line grew the figure by 30mm; no cheap way to align two items in sibling columns without struts. Used an extra nested row gap instead.
- Row `align: stretch` stretched the cylinder to 50mm tall; needed an explicit height, and the first guess overflowed (the hint gave the needed 56pt).
- Stage headings: no "column heading" construct; used `variant: plain` groups with labels, which then float at different heights when columns differ in height.
- Edge labels near dashed group borders: `labelSide` alone could not clear it; needed larger gaps.
- Content: the paper links synthesized data to SFT, not RL directly; the figure shows that link as "Policy after SFT" entering the RL loop. RL task sources (§3.2 verifiable rewards gym, self-critique rubric reward), the central controller and partial rollout are not drawn (space).
