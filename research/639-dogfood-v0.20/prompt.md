# Instructions given to each run (#639)

You make **one** figure with Sumi, a diagram-as-code CLI, from a recent paper, tech report or technical document, and record how it went. You are part of a study that looks at how well an agent does when it follows the Sumi Skill as written, to find what to improve in Sumi, the Skill and the lint.

## Setup

- Repository snapshot: `/Users/ryusei0623/projects/sumi-diagram-wt/t639` (read-only for you, except your output directory). Use only this directory, not any other checkout.
- Sumi: `SUMI=/private/tmp/claude-501/-Users-ryusei0623-projects-sumi-diagram/74e76402-151b-4c53-9b81-178b74b55e4d/scratchpad/v0200/sumi-0.20.0-darwin-arm64/bin/sumi` (the released v0.20.0 binary). Use `$SUMI` wherever the Skill says `sumi`, and set `SUMI_NO_UPDATE_CHECK=1`.
- Skill: `skills/sumi/SKILL.md` in the snapshot, with its `references/`, `layouts/`, `examples/` and `scripts/`.
- Your request is one row of the table in `research/639-dogfood-v0.20/README.md` (source URL, figure type, what the figure should explain, placement/profile). Theme: `sumi`. Read the source itself (web fetch the URL; arXiv HTML at `https://arxiv.org/html/<id>` is usually easiest) and draw the figure from its text. Do not copy the source's own figures; you may look at them to understand the content, but design your own.
- Output directory: `research/639-dogfood-v0.20/runs/<#>-<slug>/`. Write only there.

## Rules

- Do not open any other directory under `research/` (including other runs of this study) or any private figures, and never name them.
- No author names, affiliations or e-mail addresses in the figure.
- Do not edit repository files outside your output directory. No git commands that change state. Do not start subagents: where the Skill suggests a fresh view by a subagent, do that critique yourself (look at the PNG against the checklist).
- Write `log.md` as you go, starting with the start time (`date '+%F %T'`).

## What to do

Follow `SKILL.md` exactly as written, from planning to the final check, including its steps about choosing a base layout and making a mockup first when the layout is not obvious. Record in `log.md` which layout you started from (or none), whether you made a mockup and why, and the facts from the source that the figure shows (with section references), so a reviewer can check them.

## Files to leave

- `draft1.sumi.yaml`, `draft1.svg`, `draft1.png`: the first version that rendered, before any change after looking at it.
- `figure.sumi.yaml`, `final.svg`, `final.png`: your final version.
- If you made a mockup: `mockup.html`, `mockup.png`.
- PNGs: render with the Skill's `scripts/preview` (it uses headless Chrome) at 1600px wide.
- `log.md`: start and end time, number of renders, final lint summary (errors / warnings / infos, and why any were kept), layout used, mockup yes/no, the source facts shown, what was hard, what Sumi could not express, and any workaround you used.

## Report back

In under 200 words: output directory, minutes taken, number of renders, final lint counts, layout used, mockup yes/no, and the three biggest problems you met (in Sumi, the Skill or your own figure).
