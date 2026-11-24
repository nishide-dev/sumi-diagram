# Run 5 qwen3-omni log
Start: 2026-11-22 03:03:27

## Request
Row 5: Qwen3-Omni Technical Report (arXiv:2509.17765), dense architecture, Thinker (MoE, text) and Talker (streaming speech, multi-codebook) as separate parts; theme `sumi`, profile `paper-double`.

## Plan
- Skill v0.20.0, `sumi doctor --skill-version 0.20.0`: Ready to render, Skill matches CLI.
- Base layout: **encoder-block** (overview panel + one part opened beside it with a `zoom`). Panel (a) kept the `place` (unit 1mm) idiom; panel (b) became a top-down stack instead of the bottom-up residual block. Example also viewed: llama4-moe (zoom into a panel).
- Mockup: **yes** (two panels, a zoom and a per-frame feedback loop: not an obvious one-direction flow). Colours taken from a probe render in `sumi` (blue #d9e4e6/#3d5d77, orange #efdfce/#814b2d, green #dce7d3/#426344, gray #e1dece/#4e566b), sizes from `sumi catalog --sizes --css`. Two mockup rounds (round 1: Thinker→Talker gap too narrow for its label, Code2Wav box too narrow, caption wrapped). The `place` centres of (a) were copied from the mockup.
- Visual language: blue = perception encoders, orange = Thinker / text, green = Talker / speech (incl. codec tokens and speech waveforms), gray = the codec-side modules (MTP, Code2Wav), plain outlined boxes = raw inputs.

## Source facts shown (section refs)
- Thinker–Talker architecture; both are MoE (§2.1, abstract).
- Inputs: text as tokens (byte-level BPE, §2.3); audio → Audio encoder AuT, 650M (Table 1), 12.5 Hz token rate (§2.2); image/video → vision encoder SigLIP2-So400M, 540M (Table 1, §2.3).
- Thinker: MoE Transformer 30B-A3B (Table 1) → text output.
- Talker: MoE Transformer 3B-A0.3B (Table 1), conditioned on audio-visual multimodal features from the Thinker (§2.1) and the current turn's streamed text (§2.4); does not take the Thinker's high-level text representations (§2.1: hence the edge from "Text output", not from the Thinker's hidden states, carries text).
- Theoretical end-to-end first-packet latency 234 ms (audio, cold start; abstract, Table 1/2).
- Per step: Talker backbone takes the aggregated codebook features of the current frame, a linear head predicts codebook 0, the MTP module (dense, 80M) produces the residual codebooks, Code2Wav (causal ConvNet, 200M) turns them into waveform immediately (§2.1, §2.4, §2.5, Table 1); one token = 80 ms of audio at 12.5 Hz (§2.5).
- Number of codebooks is not stated in §2, so the codes row is c0, c1, c2, … without a count.
- Not shown (kept text short): separate system prompts, TM-RoPE details, AuT training data, concurrency tables.

## Renders
Probe render (colours) + 4 renders of the figure: draft1 (1 error geometry/exceeds-page-width 192.97mm, 4 warnings: zoom lines crossing two edge labels, residual-codebooks label over MTP and the group border; 2 infos edge-label-detached / on-corner), round 2 (5 warnings: tag label over Thinker/Talker, MTP label collision, zoom crossing), round 3 (clean), round 4 (clean; widened Talker so its label is not touching the frame, moved "streamed text" label).

## Final lint
`lint --geometry`: **0 errors, 0 warnings, 0 infos**. Size 179.21mm × 98.43mm (paper-double).

## Self-critique against encoder-block + llada (scripts/compare)
1 density: a void under the inputs / Thinker in (a) (the speech output hangs below Talker, panel (b) is taller than (a)'s content); kept. Thinker is a large empty tinted block. 2 sizes: consistent. 3 vocabulary: one tone per role across panels; waveforms used for audio in and out. 4 colour: three hues + gray, no colour on colour. 5 text: two-line boxes (name + size) only. 6 flow: left→right then down, zoom into (b). 7 main subject: Thinker is the most prominent; Talker smaller although it is half the subject.

## What was hard / Sumi gaps / workarounds
- Width: the first render was 13mm too wide; the hint's verified edits (gap 0mm etc.) did not fit the intent; I shrank by hand (two-line "Image /\nvideo", narrower boxes, shorter Code2Wav label split differently).
- `labelSide` on a downward edge: `left` put the label on the east side (left of the direction of travel), so I needed `right` to put it on the west side. Not obvious from the docs; cost one render.
- `labelStyle: tag` on a short horizontal edge between two tall boxes overlapped both boxes; plain beside label worked once the gap was 17mm.
- Edge labels on short vertical edges in a narrow panel (residual codebooks) collide with the next box and the group border; needed a bigger stack gap (8mm), which makes (b) taller than (a).
- Zoom lines are not routed and crossed edge labels near the zoom source; moving labels to the other side (labelSide) fixed it.
- No way to say "this edge carries a stream" other than a label; no per-panel height balancing.
End: 2026-11-22 03:08:19
