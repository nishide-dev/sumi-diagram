# Run 1 d4rt log

Start: 2026-11-22 03:03:27

## Planning
- Source: arXiv 2512.08924 HTML, read Sec. 2, 2.1 (query, Table 1, extrinsics/intrinsics), 2.2 (architecture), 2.3, Sec. 4 (model sizes).
- Theme `sumi` (given), profile `paper-double` (given). Structured layout.
- Base layout: `three-panel-flow` (three captioned panels in a row), adapted: block arrows dropped in favour of real edges (F feeds the decoder), panel (a) borrows the cuboid idiom from `cnn-volumes`/`conv3d`, panel (c) the `matrix rules: true` table idiom.
- Mockup: yes (three panels, cross-panel edge, table aligned to query fields: arrangement not obvious). mockup.html / mockup.png, one round. Colours from a probe render (blue #d9e4e6/#3d5d77, orange #efdfce/#814b2d, ink #30364f).
  Mockup check: all checklist items present; void in top of (b); P box and query cells too narrow (template outlines in red) -> widen in YAML.
- Visual language: video / scene features = blue (cuboid, F token column, RGB patch); query and its fixed fields = orange accent; model blocks neutral, decoder (focus) `emphasis`; output P orange outlined.

## Source facts shown
- Video V in R^{T x H x W x 3} -> encoder E -> Global Scene Representation F (N x C), computed once, fixed in the second stage (Sec. 2, 2.1).
- Encoder: ViT with interleaved local frame-wise and global self-attention (Sec. 2.2).
- Query q = (u, v, t_src, t_tgt, t_cam) (Sec. 2.1); query token also gets an embedding of the local 9x9 RGB patch at (u, v) (Sec. 2.2).
- Decoder: small cross-attention transformer; each query decoded independently into F, outputs 3D point P (Sec. 2.1, 2.2).
- Table 1 query patterns (colspans checked in the HTML): point track (u, v, t_src fixed; t_tgt = t_cam = 1..T), point cloud (1..W, 1..H, t_src = t_tgt = 1..T, t_cam fixed), depth map (1..W, 1..H, t_src = t_tgt = t_cam = 1..T), extrinsics (1..h, 1..w grid, t_src = t_tgt fixed, t_cam 1..T), intrinsics (1..h, 1..w, all three = 1..T).

## Rounds
1. draft1: 216.8mm wide (error exceeds-page-width), label-collision of the cuboid's W dim with the "Video V" label; lint warning empty-label on the patch box. PNG looked right in content.
2. Dims dropped (video label south, "T frames"), encoder one-line label + sublabel, decoder note shortened, matrix narrower, align {y: [feat, dec]}: 194.4mm.
3. --explain-width; gaps/cells trimmed: 184.2mm, matrix row header collided (headerWidth 37pt too small for "Point cloud").
4. Panel (b) turned into a column (query below, decoder, P above), note moved into caption "(b) Decode queries independently": 186.4 -> 182.9mm. The cross-tree align pushed panel (a) down so its frame no longer matched the others (row with align: stretch); removed align, F lined up with the decoder anyway.
5. Matrix `flush: true` removed the frame padding: 177.3mm, fits. Patch made a 3x3 `tokens` grid (fixes empty-label), orange (u, v, t_src) label explains the highlighted cuboid cell.
6. Critique (compare vs clip, llada; done myself, no subagent): adjacent "fixed" cells merged into one band -> matrix gap 1pt; P label spacing. Final.

Renders: 9 of the figure (plus 1 colour probe, 1 mockup screenshot).

## Final lint
- `sumi lint`: 0 errors / 0 warnings / 0 infos.
- `sumi lint --geometry` / render: 0 errors / 0 warnings / 2 infos (geometry/content-band on panels (a) and (c): content centred in stretched panels; kept on purpose so F stays on the decoder's line and the table is centred).
- Size 178.68mm x 58.03mm, paper-double, theme sumi.

## What was hard / Sumi limits / workarounds
- Width: three panels at 8pt in 180mm. The width breakdown was useful, but its "Fits" search gave no verified edit; the big wins (matrix `flush: true`, turning panel (b) into a column) were found by hand. `flush` is documented as being for touching headers, not as a width saver for a framed table; with `rules: true` the padding looks like a bug-like extra margin.
- Table 1 of the paper uses merged cells (colspan, e.g. t_src = t_tgt spanning). `matrix` has no colspan, so tied fields are written as "= t_src" text cells.
- `figure.layout.align` across panels in an `align: stretch` row moved one panel down and broke the equal-height frames, with no diagnostic; removed it.
- Cuboid `dims` labels (W/H/T) placed far from the faces and collided with an attached title; dropped dims.
- No way to draw the 9x9 patch being cropped from the video's highlighted cell without a cross-panel line; used a label "(u, v, t_src)" in the query's orange instead.
- Patch and query edges into the decoder merge into one trunk (reads as "added to the query token", which matches Sec. 2.2, but it was not chosen).
- Skill step 1 recommends theme `paper`; this study fixes `sumi`, used as given. No legend: the two tones are named by labels in place (blue = video / scene features, orange = query).
End: 2026-11-22 03:10:29
