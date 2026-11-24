# Run 6 tongyi-dr
Start: 2026-11-22 03:03:28
End: 2026-11-22 03:08:08 (wall clock as reported by `date`; about 5 min by that clock)

Request: README row 6, Tongyi DeepResearch Technical Report (arXiv 2510.24701), agent loop + training framework, `presentation-16x9`, theme `sumi` (+ `themeOverrides.textScale: 2`, per `textScaleFor`).

## Process
- `sumi doctor --skill-version 0.20.0`: Ready, versions match.
- Layout: started from `layouts/agent-loop` (Observe/Plan/Act + memory + tools) for panel (a); `train-infer-panels` and `actors-and-tools` viewed but not used. Panel (b) planned from scratch as a linear chain with side inputs.
- Mockup: yes (two panels plus a loop = "non-trivial" by the Skill). Sizes from `catalog --sizes --css --text-scale 2`, colours from a probe render (blue/green/orange tinted, default box). The mockup showed inner group titles (`above-left`) colliding with the panel title and the update edge; fixed in YAML by using `top-left` and dropping the inner "Agent" frame.
- Renders: 7 (draft1 + 6 rounds), plus one colour probe.
  1. draft1: 361.6 x 206.2mm, `exceeds-page-width` / `-height` errors; `update` edge crossed the "Agent" group title (3 warnings).
  2. Applied the width hint's verified values (train padding 9.5pt, row gap 7mm, post padding 9.5pt, post gap 6mm), removed the Agent frame, tightened stack gaps: clean, 338.3 x 170.4mm.
  3. Widened panel (a) gaps (row 22mm, stack 13mm) to fill space; `result` edge got a 1.2mm jog (`avoidable-bend`).
  4. Anchors west:0.85 -> east: `avoidable-bend` with a verified anchor hint.
  5. Applied hint anchors `west:0.924` / `east:0.191`: clean.
  6. Two-line "Real + simulated\nenvironments", row gap 11mm to lengthen short stage arrows: 341.8mm too wide.
  7. Row gap 9mm, side-input row gap 6mm: clean, 329.1 x 185.4mm.
- Critique (done myself with `scripts/compare` against `layouts/agent-loop` and `examples/llada`): sizes consistent; three tones within `colorUse` (max 3); short labels only; flow readable left to right. Weak points kept: empty strip at right of panel (a); no legend for the three tones; neither panel has a clear focus element.

## Final lint
`lint --geometry`: 0 errors, 0 warnings, 0 infos. Render: 329.14mm x 185.38mm, fits presentation-16x9.

## Facts shown (arXiv 2510.24701)
- (a) ReAct rollout: Thought -> Action -> Observation triplets; final action is the answer/report (Sec. 3.1).
- Context management: agent conditions on question + evolving report S_t (compressed memory) + last action/observation (Sec. 3.1, Eq. 3). Drawn as Report S_t <-> Thought "update".
- Tools: Search, Visit, Python Interpreter (shown as "Python"), Google Scholar ("Scholar"), File Parser (Sec. 3.4.3, App. D).
- (b) Base model Qwen3-30B-A3B-Base (Sec. 3.2).
- Agentic CPT: Stage 1 32K, Stage 2 128K context (Sec. 3.3.1); fed by agentic data synthesis (question synthesis, planning / reasoning / decision-making actions; Sec. 3.3.2).
- Post-training: SFT cold start -> agentic RL -> model merging "at the last stage of the pipeline" (Sec. 3.4.2-3.4.4).
- QA synthesis (high-quality data synthesis, Sec. 3.4.1) -> SFT; real-world + simulated (offline Wikipedia) environments -> RL (Sec. 3.4.3).
- Not shown (space / minimal text): Heavy mode (n parallel agents + synthesis, Sec. 4.3), 30.5B / 3.3B active, SFT 40K -> 128K stages, GRPO-based algorithm and 0/1 reward, the synthesized data also feeding RL (only drawn into SFT).

## What was hard / what Sumi could not express / workarounds
- Slide text at 16pt makes every box large: a 6-step chain barely fits 338.7mm; I had to split labels into two lines and accept the width hint's tighter paddings.
- The width hint is excellent (verified values) but its suggested values were then partly undone when I later widened gaps for balance; a "balance" hint (where slack exists) would help.
- Cross-tree `align` (data box under its stage) silently stretches row gaps (SFT -> RL arrow grew long); no diagnostic says why one gap is much longer than its siblings.
- `labelAt: above-left` on inner groups collides with the outer panel title / incoming edges; fixed by `top-left`.
- `grid` uses `rowGap`/`columnGap`, not `gap` (schema error on first try); incomplete last row needs an explicit `null`.
- The Skill's "Slides" tip (layout-tips) still says use the `slides` theme, while SKILL.md step 3 says `sumi` + `textScale: 2`; minor inconsistency.
- No legend: adding one costs ~15mm height on a slide already at 185mm.
