# Instructions given to each run (#509)

You make **one** figure with Sumi, a diagram-as-code CLI, and record how it went. You are part of a study that compares two ways of working, so follow the condition you are given exactly.

## Setup

- Repository: `/Users/ryusei0623/projects/sumi-diagram` (read-only for you, except your output directory).
- Sumi binary (published v0.17.1): `SUMI=/private/tmp/claude-501/-Users-ryusei0623-projects-sumi-diagram/74e76402-151b-4c53-9b81-178b74b55e4d/scratchpad/rel0171/bin/sumi`. Use `$SUMI` wherever the Skill says `sumi`.
- Skill: `skills/sumi/SKILL.md`, with `skills/sumi/references/` and `skills/sumi/examples/`.
- Your request is one row of the table in `research/509-dogfood-v0.17/README.md` (subject, placement, required content). Theme: `sumi`. Placements: `paper-double` and `presentation-16x9` are profiles. README, blog and document figures have no profile of their own: use `paper-double` (≤180mm wide; aim for about 160mm) and set `figure.target.minFontSize` to the size given.
- Output directory: `research/509-dogfood-v0.17/runs/<#>-<slug>/<A|B>/`. Write only there.

## Rules

- Do not open any other directory under `research/` (including other runs of this study) or any private figures, and never name them.
- No author names, affiliations or e-mail addresses in the figure.
- Do not edit repository files outside your output directory. No git commands that change state. Do not start subagents.
- Write `log.md` as you go, starting with the start time (`date '+%F %T'`).

## Conditions

### A — direct

Follow `SKILL.md` as written: plan, look up components with `$SUMI catalog`, write the YAML, render, lint, look at the PNG yourself, compare candidates where the Skill says so, fix, repeat. Where the Skill suggests a fresh view by a subagent, do that critique yourself instead (look at the PNG against the checklist).

### B — HTML mockup first

1. **Design the figure as an HTML/CSS mockup**, as a designer working with a design system, limited to Sumi's vocabulary:
   - Read `$SUMI catalog` and the `sumi` theme in `src/core/theme/builtin.ts` (canvas, ink, tone colours; Inter text). Use only what Sumi can draw: its node shapes and components, groups, sets, edges and arrowheads, row / stack / grid / place arrangements, tones and variants.
   - Size the page in real units: the placement's width in CSS `mm`, real font sizes in `pt`. Draw arrows with inline SVG.
   - Screenshot it: `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars --window-size=<w>,<h> --screenshot=<dir>/mockup.png file://<dir>/mockup.html`, look at the PNG and refine it until it is a figure you would publish (up to about three rounds).
2. **Reproduce the mockup in Sumi**, treating `mockup.png` as the original (as in a paper reproduction), following `SKILL.md` for writing, rendering, linting and checking (the critique by yourself, as in A). Note in `log.md` where Sumi could not match the mockup and why.

## Files to leave

- `draft1.sumi.yaml`, `draft1.svg`, `draft1.png`: the first version that rendered, before any change after looking at it.
- `figure.sumi.yaml`, `final.svg`, `final.png`: your final version.
- B only: `mockup.html`, `mockup.png`.
- PNGs: `rsvg-convert -w 1600 -b '#f8f8ee' <svg> -o <png>`.
- `log.md`: start and end time, number of renders, final lint summary (errors / warnings / infos, and why any were kept), what was hard, what Sumi could not express.

## Report back

In under 200 words: output directory, minutes taken, number of renders, final lint counts, and the three biggest problems you met (in Sumi, the Skill or your own figure).
