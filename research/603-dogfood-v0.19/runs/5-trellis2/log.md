# Run 5 trellis2

Start: 2026-11-20 16:31:54

## Source facts used (arXiv 2512.14692, HTML)
- §3.1: O-Voxel = sparse voxels on an N×N×N grid; each active voxel stores a shape feature and a material feature ("omni-voxel": geometry + appearance).
- §3.1.1 Flexible dual grid (shape): dual vertex v, edge-intersection flags δ (3 edges), splitting weight γ. Mesh → O-Voxel: mark voxels whose edges the mesh intersects, Hermite data, QEF solve. O-Voxel → mesh: connect dual vertices into quads, split into triangles by γ.
- §3.1.2 Material: PBR attributes base colour c, metallic m, roughness r, opacity α.
- §3.2 SC-VAE: fully sparse-convolutional U-shaped VAE with residual autoencoding layers; 16× spatial downsampling; a 1024³ textured asset → ~9.6K latent tokens; early-pruning upsampler in the decoder; two SC-VAEs (shape and material).
- §3.3 Generation: flow matching, DiT backbones, image conditioning (DINOv3 features); three stages: (1) sparse structure (occupancy layout), (2) geometry latents in active voxels, (3) material latents conditioned on image + geometry latents. 1024³ output ↔ 64³ latent resolution.
- Decoding: SC-VAE decoders → O-Voxel → mesh + PBR textures (§3.1 conversions).

## Plan
Theme `sumi` (prompt), profile `paper-double`, structured.
Visual language: mesh / 3D asset = tabler/mesh icon; O-Voxel = gridded `cuboid` with active voxels highlighted;
shape = blue, material = orange (attribute tokens and latents); occupancy / structure = gray; models (encoder, decoder, DiT) = neutral boxes/trapezoids; stage flow = block arrows; latent = small gridded cuboids (the focus).
Base layout: three-panel-flow (panels (a)(b)(c) with block arrows) + cuboid idioms from conv3d / cnn-volumes.
Mockup: yes (several panels, arrangement not obvious).
render 1
render 2
render 3
render 4
render 5
render 6
render 7
render 8

## Rounds
- Mockup (1 screenshot): two panels on top ((a) O-Voxel, (b) SC-VAE), (c) generation full width below. Mockup showed a void in (b) and a label overlapping the grid in (a); carried into YAML with fixes.
- Draft 1 (render 1): lint clean; infos color-on-panel ×2 (sumi theme fills untoned groups #efeddd) and group-empty-area on (c). Trapezoid encoder/decoder grew huge from two-line labels; icons tiny at iconSize 2.
- Round 2–3: themeOverrides.groupFill '#ffffff' (white panels), iconSize 10mm, fixed-size trapezoids with one-word labels, (b) O-Voxels drawn like (a) (gray grid + purple active voxels), purple zoom from one active voxel to the attribute tokens. Gap 9mm overflowed width by 2mm (exceeds-page-width), 8mm fits.
- Round 4: added "16× down" under the encoder. Compared with llada + conv3d (scripts/compare; output kept in scratchpad, not here). Self-critique: (c) loose (image icon on its own row), (b) has empty bands top/bottom, no single focus.
- Round 5–8: moved image into the (c) row with the conditioning trunk above (cond→Geometry/Material DiT north anchors), panel padding 6mm so the trunk clears the frame; widths re-tuned (6.5mm → too wide by 1.2mm, padding → too wide by 3.4mm, gap 5.5mm fits).

## Final
- Size 179.39 × 97.19 mm, paper-double, theme sumi. Renders: 8 (+1 mockup screenshot).
- Final lint (lint + lint --geometry): 0 errors / 0 warnings / 0 infos.
- Layout: three-panel-flow (adapted to 2+1 panels) with conv3d / cnn-volumes cuboid idioms. Mockup: yes.
- Hard: width is right at the limit (179.4mm); every padding/gap change is ±2–4mm against the 180mm cap and needed a render to know. Trapezoid size follows its label, so a two-line label made a 30mm-tall encoder.
- Sumi could not express: a mesh picture (used tabler/mesh icon, small and generic); active voxels only visible on the front/top/right surfaces (highlight inside the volume draws nothing), so the "surface" of active voxels is a staircase on the front face; no way to attach a text label to an icon node (icon-with-label error → separate attached label nodes); the sumi theme fills untoned panels beige, which triggers its own color-on-panel info until groupFill is overridden.
- Kept: panel (b) has empty bands above/below because the row stretches panels to (a)'s height (equal-height panels by design). Only one encoder/decoder drawn although the paper trains two SC-VAEs (shape and material); the two latent tones carry that.
- No legend: tones are explained by the "shape" / "material" labels in (a) and the latent labels in (c).
- Mistake: one scripts/compare output was first written outside the run directory by a wrong relative -o path; moved to the scratchpad immediately.

End: 2026-11-20 16:37:41
