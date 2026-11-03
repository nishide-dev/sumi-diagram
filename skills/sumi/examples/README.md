# Public-paper reference figures

Consult these reference figures **only when the user asks for that model or figure
style**. They are not templates for unrelated figures. Each YAML cites its public
paper; the illustrations are original synthetic assets, not private figure material.

| Name | What it shows | Sumi features demonstrated | Files |
| --- | --- | --- | --- |
| Transformer | Encoder–decoder architecture from *Attention Is All You Need* | Structured stacks, residual trunks, attached notes and operators, icons, semantic tones | [YAML](transformer/transformer.sumi.yaml), [PNG](transformer/transformer.png) |
| DiT block | Diffusion Transformer block variants and conditioning | Multiple panels, zoom, dimmed groups, residuals, math labels, fit-to-width | [YAML](dit-block/dit-block.sumi.yaml), [PNG](dit-block/dit-block.png) |
| CLIP | Contrastive training and zero-shot classification | Multiple panels, shared image assets and crops, token sequences, matrices | [YAML](clip/clip.sumi.yaml), [PNG](clip/clip.png), [assets and generator](clip/assets/) |
| EmbeddingGemma | EmbeddingGemma 2 multimodal inputs and a shared embedding space | HTML cards, image assets, waveform, tokens, aligned columns | [YAML](embedding-gemma/embedding-gemma.sumi.yaml), [PNG](embedding-gemma/embedding-gemma.png), [assets](embedding-gemma/assets/), [generator](embedding-gemma/generate-assets.ts) |

Copy a figure's entire directory when adapting it so its relative asset paths stay
valid. Asset generators require Bun and write next to themselves:
`bun clip/assets/generate.ts` or `bun embedding-gemma/generate-assets.ts` from this
directory. Rendering the YAML uses the same Sumi CLI as any other figure.

## Maintaining previews (in the repository)

The real YAMLs, assets and generators live here; `examples/<name>/` in the
repository links to the YAMLs. CLIP and EmbeddingGemma assets also have checked
copies under `examples/<name>/assets/`: Sumi's asset sandbox rejects symlinks
outside a figure's directory. After changing canonical assets, copy them to those
repository directories; tests enforce matching file lists and bytes (including
the CLIP generator). The EmbeddingGemma generator retains a repository-side link
for existing commands. Generated SVG, PDF and lint reports remain in the
repository example directories. Regenerate PDFs with `bun run gallery`, then PNGs with
`bun run skill:previews` (Poppler required). The latter runs
`pdftoppm -png -r 150 -singlefile` on each PDF. Tests validate PNG data and compare
its aspect ratio with the PDF page, allowing pixel rounding; PNG bytes are not
compared across operating systems. The installed Skill needs neither Poppler nor
the repository's generated PDFs to view these PNGs.
