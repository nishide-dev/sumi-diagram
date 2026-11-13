# Instructions given to each run (#538)

You make **one** figure with Sumi, a diagram-as-code CLI, and record how it went. You are part of a study that measures how well an agent does when it follows the Sumi Skill as written.

## Setup

- Repository snapshot: `/Users/ryusei0623/projects/sumi-diagram/.claude/worktrees/s538` (read-only for you, except your output directory). Use only this directory, not any other checkout.
- Sumi: `SUMI=/Users/ryusei0623/projects/sumi-diagram/.claude/worktrees/s538/.sumi/sumi-snapshot`. Use `$SUMI` wherever the Skill says `sumi`.
- Skill: `skills/sumi/SKILL.md` in the snapshot, with its `references/`, `layouts/`, `examples/` and `scripts/`.
- Your request is one row of the table in `research/538-dogfood-v0.18/README.md` (subject, placement, required content). Theme: `sumi`. Placements: `paper-double` and `presentation-16x9` are profiles. For README, blog and document figures, use the profile the Skill recommends for a screen placement (about 160mm wide), and make sure text is at least the size given in the table.
- Output directory: `research/538-dogfood-v0.18/runs/<#>-<slug>/S/`. Write only there.

## Rules

- Do not open any other directory under `research/` (including other runs of this study) or any private figures, and never name them.
- No author names, affiliations or e-mail addresses in the figure.
- Do not edit repository files outside your output directory. No git commands that change state. Do not start subagents: where the Skill suggests a fresh view by a subagent, do that critique yourself (look at the PNG against the checklist).
- Write `log.md` as you go, starting with the start time (`date '+%F %T'`).

## What to do

Follow `SKILL.md` exactly as written, from planning to the final check, including its steps about choosing a base layout and making a mockup first when the layout is not obvious. Record in `log.md` which layout you started from (or none), whether you made a mockup and why.

## Files to leave

- `draft1.sumi.yaml`, `draft1.svg`, `draft1.png`: the first version that rendered, before any change after looking at it.
- `figure.sumi.yaml`, `final.svg`, `final.png`: your final version.
- If you made a mockup: `mockup.html`, `mockup.png`.
- PNGs: render with the Skill's `scripts/preview` (it uses headless Chrome) at 1600px wide.
- `log.md`: start and end time, number of renders, final lint summary (errors / warnings / infos, and why any were kept), layout used, mockup yes/no, what was hard, what Sumi could not express.

## Report back

In under 200 words: output directory, minutes taken, number of renders, final lint counts, layout used, mockup yes/no, and the three biggest problems you met (in Sumi, the Skill or your own figure).
