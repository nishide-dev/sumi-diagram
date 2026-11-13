# Run 1 vit-block / B

Start: 2026-11-13 15:38:36

## Mockup (condition B, step 1)

- Read catalog + sumi theme colours (canvas #f8f8ee, ink #30364f, panel #efeddd, tones blue/orange/green/gray).
- Plan: (a) overview bottom-up: image 3x3 → split → 9 flattened patches → Linear projection → token row (class token solid + 9 patch embeddings) with a position row 0..9 above → Transformer encoder (emphasis, focus) → MLP head (class token only) → Class. (b) encoder block bottom-up in a framed panel with L×: LayerNorm → MHA (Q,K,V) → ⊕ residual, LayerNorm → MLP → ⊕ residual. Zoom lines (a)→(b).
- Visual language: blue = patch data, gray = norms / linear / positions, orange = attention, green = MLP, navy solid = focus (encoder, class token).
- Round 1: arrowheads far too big (marker units), "split" overlapped its arrow, MHA box tight.
- Round 2: fixed; looks publishable. Round 3: dropped the duplicate "L×" beside the encoder in (a) (only the block in (b) carries it).
- Known weakness: block-sized void top-right of (a) (above the encoder right of MLP head); accepted, the zoom lines run through it.

## Sumi reproduction (step 2)

- Panel (a) as one `place` (unit 1mm) at the mockup's centres; panel (b) as a stack with hidden junctions and ⊕ (Transformer example idioms); zoom edge encoder → block; `themeOverrides` lineWidth/frameWidth 0.75pt, arrowheadScale 0.6, solidFills gray = ink (navy class-token cell).
- Render 1 (draft1): lint clean; render 0 E / 2 W (zoom-crosses-node on emb cells) / 1 I (sparse-figure). Token row sat ~8mm right and 4mm high of the mockup: a `place` `at` is the centre of the *footprint*, which includes attached labels (Position / Patch embedding / class token), so mockup centres don't transfer for nodes with attachments. Q/K/V side arrows had small jogs (fromAnchor needed as well as toAnchor).
- Render 2: sed missed the emb coordinate (fmt had rewritten `[a, b]` to `[ a, b ]`), no change.
- Render 3: emb moved by measured offset → overlaps Linear (place-overlap, node-overlap, label-collision warnings).
- Render 4 (final): emb/encoder nudged up. Render 0/0/0; `lint --geometry` 0 errors / 0 warnings / 0 infos. 151.2 × 102.5mm, paper-double.
- Critique (self, compare with mockup + transformer example): content complete (patch split + linear embedding, position embeddings 0..9, class token, encoder with L×, block LayerNorm → MHA → ⊕ residual, LayerNorm → MLP → ⊕ residual, MLP head → class); one focus (encoder); 3 hues + navy accent. Kept: block-sized void top-right of (a), same as mockup (zoom lines run through it).

## Where Sumi did not match the mockup

- Emphasis box label is regular weight 8pt (mockup: bold 9pt); "L×" is a plain 8pt label (mockup bold 9pt) — label size/weight is not settable (only via an html node).
- Node corners render near-square in `sumi` (mockup used 1mm radius).
- "*" in the class-token cell is small (cell text size fixed).
- place `at` = footprint centre incl. attachments → had to correct coordinates by measuring the render.
- Encoder block panel (b) came out larger/looser than the mockup (default stack gaps and box heights); "Image" label sits lower than "Flattened patches" (different token heights, attached labels).
- Caption of (a) sits far below its content because of `align: stretch` with the taller (b).

## Summary

- Renders: 4 (plus 1 `lint --geometry`). Mockup rounds: 3.
- Final lint: 0 errors / 0 warnings / 0 infos.
End: 2026-11-13 15:43:16
