# Run 10 multi-agent-research

Start: 2026-11-20 16:38:07

## Plan
- Request: row 10, Anthropic engineering blog "How we built our multi-agent research system" (2025-06-13), system architecture, `presentation-16x9`, theme `sumi` (textScale 2 per catalog `textScaleFor`).
- Base layout: `agent-loop` (agent panel with steps, memory beside, side resources). Adapted: lead panel as a row of steps + decision, memory under Plan, subagent panel and citation agent as a second tier, return edge to the user along the bottom.
- Mockup: yes (loop + two panels + return path: not an obvious one-directional flow). Round 1 problems: the "yes" loop crossed the long panel title; the subagents' activity (search + interleaved thinking) was missing; "query" label touched the frame. Round 2 fixed all three (shorter title, caption on the subagent panel).

## Source facts shown (section "Architecture overview for Research" and its process diagram)
- Orchestrator-worker pattern: a lead agent coordinates, delegating to specialised subagents in parallel.
- User query -> LeadResearcher enters an iterative research process; it thinks through the approach and saves its plan to Memory (context may be truncated beyond 200,000 tokens).
- LeadResearcher creates subagents with specific research tasks (the post: 3-5 subagents in parallel); each subagent does web searches and evaluates tool results with interleaved thinking, returning findings.
- LeadResearcher synthesizes results and decides whether more research is needed; if so it can create more subagents or refine its strategy (the "yes" loop back to Spawn).
- When enough information is gathered it exits the loop and passes findings to a CitationAgent, which places citations; the cited report is returned to the user.

## Rounds
1. draft1: 1 error `geometry/label-overflow` (diamond 50x28mm too small for "More\nresearch?" at 16pt), info `geometry/color-on-panel` (three orange subagents on the sand panel). By eye: the "yes" loop ran inside the lead panel with its label beside Spawn, and the bottom return edge brushed the subagent caption.
2. Diamond 62x34mm, subagent panel `variant: muted`, loop `route: curve`, a hidden junction row under the user so the return edge has its own lane. Result: 343mm wide and 190.85mm tall (both over the slide), the curve arched far above the panel, and `muted` in `sumi` is a darker sand fill (#e1d9bc), not white, so the info stayed.
3. Lead row gap 18->14mm, panel `props.padding: 28pt` so the orthogonal loop has room inside, subagents and citation agent back to white boxes, stack gap 16mm: clean, 310x164mm. Return label sat next to Memory (ambiguous).
4. Padding 20pt, return label moved to the bottom segment: 2 warnings (`layout/edge-label-overlap`, `geometry/label-collision`: "yes" with `labelAt: start` on the panel border).
5. "yes" `labelAt: middle`: clean.
6. Critique (compare vs layouts/agent-loop and examples/system-architecture, done myself): density and flow fine; colour was only one hue (blue Memory), main subject not marked -> orange tint on "Spawn subagents" (the delegation step that makes it orchestrator-worker), like agent-loop's orange Plan. Final.

Renders: 6 written SVGs (draft1 + 5) plus 1 `lint --geometry`.

## Final
- `lint --geometry`: 0 errors, 0 warnings, 0 infos. 304.45 x 155.75mm, presentation-16x9, theme sumi, textScale 2.
- Layout: agent-loop (adapted). Mockup: yes (mockup.html / mockup.png, 2 rounds).
- Differences from the mockup: lines are 2pt at textScale 2 (mockup drew 1pt); the "yes" loop runs inside the panel (orthogonal router) rather than over it; the lead panel needs extra padding for that lane, which leaves some empty sand below the steps; the user is a tabler/user outline icon (small) with an attached "User" label.

## What was hard / what Sumi could not express
- No per-edge lane control: the "yes" loop over the panel top could not be drawn orthogonally outside the frame; `route: curve` arches high (≈+25mm height) and pushed the figure over the slide height. Workaround: larger group padding (all sides, so also empty space at the bottom of the panel).
- The return edge to the user needed a hidden junction in an extra stack row to get a lane below the caption (otherwise it brushed the caption).
- `variant: muted` on a group in `sumi` is a darker sand fill, while figure-format.md says "other themes: a solid gray border and a white background" — the info's hint ("make the panel white") had no direct one-field fix in `sumi`; I dropped the colour from the subagents instead.
- `geometry/label-overflow` on a diamond: the hint does not give the size that fits; I guessed 62x34mm.
- Edge label next to the diamond's tip ("yes") and the diamond's long horizontal footprint use a lot of width at 16pt.

End: 2026-11-20 16:43:06
