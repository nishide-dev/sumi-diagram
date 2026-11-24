# Run 2 hivemind log

Start: 2026-11-22 03:03:27

End: 2026-11-22 03:08:43 (wall clock as reported by `date`; the run felt much longer, so the clock may be off)

## Request
Row 2 `hivemind`: Artificial Hivemind (arXiv 2510.22954), matrix, model × model similarity of
response embeddings showing inter-model homogeneity, `paper-single`, theme `sumi`.

## Process
- `sumi doctor --skill-version 0.20.0`: Ready, Skill and CLI match.
- Base layout: **feature-table** (the only matrix layout; methods × properties `matrix` + legend).
  Kept matrix + legend under a stack, replaced the classes with a binned similarity ramp.
- Mockup: **yes** (mockup.html / mockup.png). The figure adds a 3-step measurement strip above
  the matrix (two parts), and the cell colour ramp / triangular shape was not obvious, so I
  mocked it at 88 mm with the probe colours of `sumi`. Mockup found: banker's rounding error in my
  script (fixed), third strip box overflow (shortened label).
- Probe figure rendered to read `sumi` tone fills (tinted yellow/orange/red fills are all very
  pale, ~#efdfce, so they do not form a visible ramp).
- Renders: 8 of the figure (+1 probe). draft1 = first render (too wide: legend 114 mm).
- Critique: `scripts/compare` against layouts/feature-table and examples/attention-sheet,
  done by me (no subagent per prompt). Checklist: density ok (empty upper triangle is the
  triangular display, by design); sizes: strip boxes heavier than borderless cells (tried
  `variant: muted`, little visible change, kept); one vocabulary ok except legend samples
  keep frames while `rules: true` cells have none; colour = one warm ramp + sand neutral,
  ok; text short; flow top→bottom; main subject = matrix.

## Final lint
`lint --geometry`: 0 errors, 0 warnings, 0 infos. 87.49 × 88.55 mm, paper-single.

## Source facts shown (arXiv 2510.22954 v2)
- §3: Infinity-Chat100 = 100 open-ended queries; 50 responses per model per query
  ("Intra-model repetition" paragraph); embeddings from text-embedding-3-small (footnote 1);
  Fig. 6: average pairwise sentence-embedding similarity between responses of different
  models, top-p 0.9, T 1.0. The figure shows 8 of the 25 main-paper models (one flagship per
  family, my selection): gpt-4o-2024-11-20, claude-3-5-sonnet-20241022,
  Llama-3.3-70B-Instruct, gemini-2.0-flash, qwen-max-2025-01-25, DeepSeek-V3,
  Mistral-Large-Instruct-2411, phi-4. Labels shortened (Claude 3.5, Mistral L., column
  abbreviations GPT/Cla/Lla/Gem/Qwen/DS/Mis/Phi).
- Values: Appendix C.3, Tables 7–11 (percent, one decimal), parsed from the arXiv HTML.
  Check: DeepSeek-V3 × qwen-max 81.6 and × gpt-4o 81.4 match §3 text "0.82" and "0.81".
  Diagonal = same-model value from the same tables (e.g. gpt-4o 88.2, matches Fig. 6 ".88").
- Bins (my presentation): ≥80, 77–80, 75–77, <75; within-one-model in sand.
- Not shown: the 71–82% range over all 25 models (§3), intra-model 79% > 0.8 (Fig. 4).
  Metric name (cosine) not stated in the paper, so the figure says only "similarity".

## What was hard / Sumi limits / workarounds
1. No continuous or sequential colour scale for `matrix`. Tones of `sumi` have nearly the same
   pale fill in tinted/filled, so a heatmap ramp needed `themeOverrides.tones` (red/orange/yellow
   fill + text overridden to a warm ramp). Three hues stand in for one ramp; no lint objected.
2. No borderless/empty cell class for a triangular matrix: bordered `muted` blanks looked
   like data. Workaround: `rules: true`, which drops all cell borders (and so empty cells vanish).
   But legend samples keep their frames (the `< 75` sample is a framed white box while its
   cells are bare numbers) — legend and `rules` cells disagree.
3. Column headers cannot rotate; at 22pt cells, model names do not fit, so I used 2–4 letter
   abbreviations (Gem/Qwen nearly touch). Width was the binding constraint (87.5/88 mm).
4. Legend `flow: row` width: 5 entries were 114 mm; `perRow: 4` was still 89.4 mm (the
   width hint said "No fitting edit verified" and offered nothing; frame padding of the legend
   is not obvious); `perRow: 3` fits. The hint for the strip row (`gap 3mm`) was exact and worked.
5. Rounding: the tables give one decimal; rounding to two digits (".79") disagrees with Fig. 6
   for x.5 values (78.5 shown as .78 in the paper). Showed the table's one-decimal percent values.
6. `sumi catalog --sizes --label "a\nb"` measured the shell-literal `\n` as one line (my quoting;
   needs $'..').
