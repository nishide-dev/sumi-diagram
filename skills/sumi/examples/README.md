# Reference figures

Thirteen complete figures, each a YAML plus a PNG preview. Look at the closest ones
**before you write a figure and again after you render it**. They are references
for idioms (how boxes are arranged, which tone marks what, how notes are attached),
not templates to copy content from. The paper figures cite their public paper in
the YAML header; the illustrations are original synthetic assets, not private
figure material.

## How to use

1. Pick the 1–2 examples closest to your figure by type and features (tables below).
2. View the PNG (the Read tool shows images) to see the intended finish.
3. Read the YAML to see how it is built: layout, components, tones, notes, edges.
4. Reuse the idioms, not the content: your labels, connections and numbers come
   from the user.
5. After rendering, compare your output PNG with the example's: spacing, text
   size, tone use, how notes and edges are drawn. Fix the differences that are yours.

## Structured paper figures (`figure.layout.arrange`)

| Name | What it shows | Key features | Theme / profile | Files |
| --- | --- | --- | --- | --- |
| Transformer | Encoder–decoder architecture (*Attention Is All You Need*) | stacks and rows, `align: stretch`, `attach` notes, operators and hidden junctions (smooth forks), residual trunks, icons, semantic tones, `density: compact` | `paper` / `paper-single` | [YAML](transformer/transformer.sumi.yaml), [PNG](transformer/transformer.png) |
| DiT block | Diffusion Transformer block variants and conditioning | four panels, `zoom`, dimmed groups, plain group, residuals, label math, filled tones with sublabels, `fit: scale` | `paper` / `paper-double` | [YAML](dit-block/dit-block.sumi.yaml), [PNG](dit-block/dit-block.png) |
| CLIP | Contrastive pre-training and zero-shot classification | panels, `grid`, `tokens`, `matrix`, curly bracket, shared image assets and crops, shared comb buses, monospace cards, `themeOverrides` (square/sharp corners) | `paper` / `paper-double` | [YAML](clip/clip.sumi.yaml), [PNG](clip/clip.png), [assets](clip/assets/) |
| EmbeddingGemma | Multimodal inputs into a shared embedding space | `html` cards, image assets, `waveform`, `tokens`, aligned columns, orthogonal joins and an output bus, exact-color `themeOverrides` | `paper` / `paper-double` | [YAML](embedding-gemma/embedding-gemma.sumi.yaml), [PNG](embedding-gemma/embedding-gemma.png), [assets](embedding-gemma/assets/), [generator](embedding-gemma/generate-assets.ts) |
| GCN | Multi-layer graph convolutional network (Kipf & Welling) | `place` (vertices by coordinates), repeated graph shape as stacked cards (`props.layers`), colored `route: curve` edges, undirected edges, per-figure tone colors (`themeOverrides.tones`, `groupFill`), picture asset | `paper` / `paper-double` | [YAML](gcn/gcn.sumi.yaml), [PNG](gcn/gcn.png), [assets and generator](gcn/assets/) |
| LLaDA | Pre-training, SFT and sampling of a masked diffusion language model (Nie et al.) | a dense, wide figure with minimal text: one `place` at the reference's pixel coordinates (unit = 1 reference px), `tokens` rows with per-cell tones recoloured by `themeOverrides.tones`, a mask-cell SVG asset (`figure.assets`), hidden-junction arrows, `sets` as frames, curly `bracket`, `labelRotation`, `fit: scale` | `paper` / `paper-double` | [YAML](llada/llada.sumi.yaml), [PNG](llada/llada.png), [assets](llada/assets/) |
| Llama 4 MoE | Mixture-of-experts transformer block (Meta AI) | the `llama` theme (dark solid blocks, borderless muted panels, open chevron arrowheads), alternating Attention/FFN, dashed `zoom` into an expanded panel, ⊕ operator, hidden-junction forks sharing one bus | `llama` / `paper-double` | [YAML](llama4-moe/llama4-moe.sumi.yaml), [PNG](llama4-moe/llama4-moe.png) |

## Conversations (`chat` arrangement)

| Name | What it shows | Key features | Theme / profile | Files |
| --- | --- | --- | --- | --- |
| Chat | A generic Japanese conversation | `bubble` nodes, `chat` arrangement, date divider, timestamps, read receipts, letter avatar, consecutive messages, automatic wrapping | `llama` / `paper-single` | [YAML](chat/chat.sumi.yaml), [PNG](chat/chat.png) |
| LLM dialogue | A user–assistant math dialogue | `chat` with avatars on both sides (bundled icons), speaker notes, multi-line answer with inline math | `llama` / `paper-single` | [YAML](llm-dialogue/llm-dialogue.sumi.yaml), [PNG](llm-dialogue/llm-dialogue.png) |

## Generic diagrams (automatic layout)

| Name | What it shows | Key features | Theme / profile | Files |
| --- | --- | --- | --- | --- |
| Pipeline | Input, stages, storage and output with a side store | groups (default and muted), box, parallelogram, cylinder, document, emphasis/muted variants, `double-arrow`, dashed edge, edge labels, `direction: down` for one column | `academic` / `paper-single` | [YAML](pipeline/pipeline.sumi.yaml), [PNG](pipeline/pipeline.png) |
| Decision flow | Start, input, two decisions, a retry loop and a note | ellipse terminals, diamond decisions, retry loop kept outside groups, `label` note attached with a `line`, dashed variants | `minimal` / `paper-single` | [YAML](decision-flow/decision-flow.sumi.yaml), [PNG](decision-flow/decision-flow.png) |
| System architecture | Clients, entry point, service tier and data tier | tiers as groups, hexagon entry, cylinders, `double-arrow` reads/writes, dashed path, `direction: right` so edges enter groups from the side | `academic` / `paper-double` | [YAML](system-architecture/system-architecture.sumi.yaml), [PNG](system-architecture/system-architecture.png) |
| Grouped | Nested modules with two parallel paths | three nested group levels, a muted group, paths crossing group boundaries, elements outside the groups | `minimal` / `paper-double` | [YAML](grouped/grouped.sumi.yaml), [PNG](grouped/grouped.png) |

Choosing quickly: a paper block diagram with residuals or notes starts from
Transformer or DiT; multi-panel figures with images or matrices from CLIP or
EmbeddingGemma; graphs on coordinates from GCN; a dense wide figure of cell rows and short arrows from LLaDA; a dark-theme model figure from
Llama 4 MoE; messages from Chat or LLM dialogue; flows and tiers from the generic four.

For a consistent visual vocabulary across panels, study GCN (the same vertex and
edge look in every layer and tone meaning throughout) and Llama 4 MoE (the same
block style and arrow in every panel); [plan it first](../references/layout-tips.md#plan-the-visual-language-before-drawing).

Copy a figure's entire directory when adapting it so its relative asset paths stay
valid. Asset generators require Bun and write next to themselves, for example
`bun clip/assets/generate.ts`, `bun gcn/assets/generate.ts` or
`bun embedding-gemma/generate-assets.ts` from this directory. Every YAML renders
from inside its own directory with the same Sumi CLI as any other figure.

## Maintaining previews (in the repository)

The real YAMLs, assets and generators live here; `examples/<name>/` in the
repository links to the YAMLs. CLIP, EmbeddingGemma and GCN assets also have checked
copies under `examples/<name>/assets/`: Sumi's asset sandbox rejects symlinks
outside a figure's directory. After changing canonical assets, copy them to those
repository directories; tests enforce matching file lists and bytes (including
the generators). The EmbeddingGemma generator retains a repository-side link
for existing commands. Generated SVG, PDF and lint reports remain in the
repository example directories. Regenerate PDFs with `bun run gallery`, then PNGs with
`bun run skill:previews` (Poppler required). The latter runs
`pdftoppm -png -r 150 -singlefile` on each PDF. Tests validate PNG data and compare
its aspect ratio with the PDF page, allowing pixel rounding; PNG bytes are not
compared across operating systems. The installed Skill needs neither Poppler nor
the repository's generated PDFs to view these PNGs.
