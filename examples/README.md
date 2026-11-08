# Examples

Generic, domain-neutral figures built only from the built-in components
(`docs/design/phase1.md` §3), and reproductions of public figures. Each directory
holds the source (`*.sumi.yaml`, the primary source), its rendered SVG and that SVG
as a vector PDF (#59). Every source is a link to the canonical copy in
[`skills/sumi/examples/`](../skills/sumi/examples/README.md), which also holds the
PNG previews and assets that the Claude Code Skill ships (an index of what each
example shows and how to use them). Edit the YAML there, then run `bun run gallery`
and `bun run skill:previews`.

| Example | Theme / Profile | Shows |
| --- | --- | --- |
| [`pipeline/`](pipeline/pipeline.sumi.yaml) | `academic` / `paper-single` | groups (default and muted container), box, parallelogram, cylinder, document, emphasis / muted variants, `arrow`, `double-arrow`, dashed edge, edge labels |
| [`decision-flow/`](decision-flow/decision-flow.sumi.yaml) | `minimal` / `paper-single` | ellipse terminals, parallelogram input, diamond decisions, a retry loop, a `label` note attached with a `line`, emphasis / muted / dashed variants |
| [`system-architecture/`](system-architecture/system-architecture.sumi.yaml) | `academic` / `paper-double` | three tiers as groups (default and muted), hexagon entry point, cylinders and a document in the data tier, `double-arrow` reads/writes, a dashed path |
| [`grouped/`](grouped/grouped.sumi.yaml) | `minimal` / `paper-double` | nested groups (three levels, one muted), two parallel paths crossing group boundaries at every level, ellipse and document outside the groups |
| [`transformer/`](transformer/transformer.sumi.yaml) | `paper` / `paper-single` | the structured layout (`figure.layout.arrange`, design doc §6.23) with `density: compact`: stacks and rows, `align: stretch`, attached notes, operators and hidden junctions (smooth forks), anchored edges and shared trunks (the Transformer architecture, 78mm wide) |
| [`dit-block/`](dit-block/dit-block.sumi.yaml) | `paper` / `paper-double` | the faithful four-panel DiT figure: Latent Diffusion Transformer, adaLN-Zero, Cross-Attention and In-Context Conditioning; structured layout with `fit: scale`, filled tones with sublabels, a plain (frameless) group, dimmed alternatives, a `zoom` callout, label math, and four labeled conditioning taps over a shared bus (180mm × 84.69mm) |
| [`embedding-gemma/`](embedding-gemma/embedding-gemma.sumi.yaml) | `paper` / `paper-double` | EmbeddingGemma 2 Figure 1: restricted `html` prompt and syntax-colored code cards, exact-color HTML encoder blocks, illustrative sample-driven `waveform`, ten `tokens`, orthogonal multimodal joins and an output bus, and original synthetic guitar/video/scatter SVG assets with a deterministic generator (171.8mm × 145.17mm) |
| [`clip/`](clip/clip.sumi.yaml) | `paper` / `paper-double` | Radford et al. (2021), Figure 1: contrastive pre-training, a text-derived classifier and zero-shot prediction; square theme overrides, sharp shared comb buses, trapezoid encoders, monospace cards, a curly bracket, formula matrices and an original synthetic vector dog (180mm × 67.64mm) |
| [`gcn/`](gcn/gcn.sumi.yaml) | `paper` / `paper-double` | Kipf & Welling (2017), Figure 1: a multi-layer graph convolutional network; vertices placed by coordinates (`place`), the same graph shape in two layers drawn as stacked cards (`props.layers`), colored curves that converge on and spread from the hidden layers (`route: curve`), straight undirected graph edges, per-figure tone colors and white cards (`themeOverrides.tones`, `groupFill`), and an original synthetic t-SNE-style point cloud (178.86mm × 65.44mm) |
| [`llama4-moe/`](llama4-moe/llama4-moe.sumi.yaml) | `llama` / `paper-double` | Meta AI (2025), the Llama 4 mixture-of-experts figure: the `llama` theme (dark solid blocks, borderless muted panels, a white muted inner panel, a filled router, an emphasis shared expert, 1pt lines and open chevron arrowheads), alternating Attention/FFN with a dashed `zoom` into the expanded MoE panel, a ⊕ operator, and hidden-junction forks that share one bus even with a short `···` label among the experts (156.28mm × 107.77mm) |
| [`chat/`](chat/chat.sumi.yaml) | `llama` / `paper-single` | a generic Japanese conversation using `bubble` nodes and the `chat` arrangement: a 今日 divider, timestamps, read receipts, an initial in a circle, consecutive messages and automatic wrapping; white incoming bubbles and pale green outgoing ones (83.96mm × 59.09mm) |
| [`llm-dialogue/`](llm-dialogue/llm-dialogue.sumi.yaml) | `llama` / `paper-single` | an original illustrative user–assistant math dialogue: `chat` with avatars on both sides (bundled user/robot icons), explicit speaker notes, a multi-line answer with inline math and a follow-up question (83.96mm × 61.56mm) |

`pipeline` and `decision-flow` use `direction: down`: four or more nodes in a
row to the right are already wider than `paper-single` (88mm).
`system-architecture` and `grouped` use `direction: right` so that edges enter
groups from the side (with `direction: down` they cross the groups' centered
labels, `geometry/edge-crosses-label`), which makes them wider than one paper
column: they use `paper-double` (180mm).

All twelve pass `sumi lint --geometry` without errors or warnings (CLIP uses
`--config examples/clip/lint.json`, as explained below). The five
structured `paper` figures use the color, ML-paper style and are laid out and routed by Sumi
itself, without D2. `transformer` fits one column; `dit-block` is wider than
`paper-double` and is scaled down to it (`fit: scale`), as is `clip`.

`embedding-gemma` uses a moderate 171.8mm width without scaling: the five
input columns and the full audio caption remain legible (native labels are
8pt, HTML text is at least 7.69pt). One 88mm paper column would make these
labels too small. Its HTML blocks and native solid token cells share exactly
the same encoder colors: blue `#3d9df5`, amber `#e8a20c`, and red `#e04848`,
using `themeOverrides.solidFills`. The waveform keeps its red signal with an
independent black `props.frameStroke`. The dashed encoder group retains its
light gray fill with a blue-gray `#527da5` border and matching label, via
`themeOverrides.dashedGroupStroke`. Only `edgeCorners: sharp` is set: the
boxes stay rounded, while the shared buses and T-joins are sharp. Every edge
uses `variant: emphasis` for black 1pt lines (twice paper's default 0.5pt)
and correspondingly heavier arrowheads. The layout and dimensions are preserved.
The PDF was rasterized with `pdftoppm` and compared with the reference,
including text, input merges and the output bus. Regenerate its original
vector assets with `bun examples/embedding-gemma/generate-assets.ts`, then
run `bun run gallery`. The seeded 63-point scatter balances blue, amber and
red, with mixed pie-split points distributed across all three base colors.
It is illustrative, as are the explicit waveform amplitudes; neither is
measured model/audio data. This complete example supports SVG, PDF and
picture PPTX. Editable PPTX rejects its HTML/image nodes with located
`pptx/unsupported-asset` diagnostics, an existing exporter limitation;
the new palette/frame controls themselves support editable PPTX.

The gallery generator requires **no errors and no warnings**; info diagnostics
are allowed. These are the infos from each example as written (including
geometry lint):

| Example | Info diagnostics |
| --- | --- |
| `pipeline` | none |
| `decision-flow` | none |
| `system-architecture` | none |
| `grouped` | none |
| `transformer` | none |
| `dit-block` | 7: `geometry/heavy-scaling` ×1 (81.38%, with the width breakdown before scaling); `geometry/script-too-small` ×1 (math scripts down to 3.99pt after scaling); `geometry/group-empty-area` ×2 (the equal-height Cross-Attention and In-Context panels); `geometry/arrowhead-cramped` ×3 (conditioning taps, 1.63pt straight stems after scaling) |
| `embedding-gemma` | none (sharp joins and 1pt edges remove the previous three `geometry/edge-near-border` infos) |
| `clip` | 2: `geometry/heavy-scaling` ×1 (71.81%, with the width breakdown before scaling); `geometry/script-too-small` ×1 (math scripts down to 4.02pt after scaling; body text is 5.74pt, above the 5pt scaled minimum) |
| `gcn` | 2: `geometry/group-empty-area` ×2 (the input and output layers: the graphs keep the original's sparse vertex positions) |
| `llama4-moe` | none |
| `chat` | none |
| `llm-dialogue` | none |

Both conversation figures use an 80mm chat column, with 8pt body text and 7pt
annotations, without scaling. `chat` reproduces only the reference's conversation
area, using generic speaker IDs, a letter avatar and theme colors; it contains no
phone frame, app header or input bar. Consecutive messages share an indent and
omit the repeated avatar and tail. `llm-dialogue` is an invented example, not a
measured model response. `paper`, `academic` and `llama` were compared as PDF
previews; `llama` keeps Inter text and uses softer slate outlines. Both final PDFs
were rasterized with `pdftoppm` and inspected, with the Japanese chat alongside
the reference conversation area.

The DiT and CLIP scaling infos are accepted to preserve their complete reference
arrangements at 180mm. Inspect the vector PDF for inline-math labels: `rsvg-convert` drops
the space before inline math, a known rasterizer issue ([#266](https://github.com/nishide-dev/sumi-diagram/issues/266)).

CLIP preserves the reference's one-line panel headings. Its local lint config
raises only `lint/long-label.maxLineWidth` from 40 to 48 for the 45-character
panel-2 heading; every rule remains enabled and `maxWarnings` is zero.
This is a character-count heuristic, not a font-size or overflow exemption:
geometry lint still checks the actual one-line heading at the printed size.
Highlighted matrix labels use the same gray ink as the other cells via
`\textcolor{gray}{…}`, retaining the blue tinted fill and frame. The cards,
label list, prompt and answer use the bundled BIZ UDGothic mono font (§6.76);
its sans-serif glyphs differ from the reference's typewriter face.
CLIP uses independent `figure.themeOverrides` options: `nodeCorners: square`
for square node/group frames and expanded cells, `edgeCorners: sharp` for
sharp wires and hidden junctions/forks, and `groupLabelWeight: regular`.
Either corner option also works alone (sharp wires can retain rounded boxes).
Editable PPTX preserves square frame joins and sharp wire caps/joins in both
connector modes; CLIP itself uses picture export because it contains images.

Verify and regenerate with:

```sh
bun src/cli/index.ts lint --geometry --config examples/clip/lint.json examples/clip/clip.sumi.yaml
bun examples/clip/assets/generate.ts  # regenerate the original synthetic SVG
```

The original `research/271-clip/` experiment is retained unchanged as a historical
record of the earlier decisions and limitations; `examples/clip/` is the polished
version. The citation is in the YAML header. The dog is an original illustration,
not a paper crop or an external photograph. The curly label-list bracket is a
deliberate alternative to the reference's fan-in. The 4.02pt script info is
accepted to retain the full matrix at 180mm; there are no cramped-arrow infos.
The output and magnified buses/encoders were inspected using Sumi's resvg PNG
fallback (which retains the bundled fonts), against the reference Figure 1.

The [component gallery](../docs/gallery/README.md) has a page for every
built-in component, a page with every example, and pages that compare themes
(the Transformer above under each one) and profiles.

## Rendering

Render with `sumi render` (or its alias `bun run example:render`, which
regenerates the committed SVGs). It needs the pinned D2 CLI:

```sh
bun run d2:install                                           # once
bun src/cli/index.ts render examples/pipeline/pipeline.sumi.yaml  # writes examples/pipeline/pipeline.svg
bun run example:render examples/pipeline/pipeline.sumi.yaml  # the same
bun run example:render <figure.sumi.yaml> <out.svg>          # any figure, any output path
```

Both run the shared render pipeline (`renderFigure()` from
`src/render`, #11): compile, the D2 CLI backend, SVG finalization and
inspection. They print diagnostics and write the finalized SVG: D2's output
with `width`/`height` in pt on the root `<svg>` (1 D2 unit = 0.5pt), so viewers
show the physical size, and Sumi's deterministic `<metadata>` (versions, theme,
profile, font set, sha256 of the YAML and the D2 source). It also prints the
output size and whether it fits the profile's `page.maxWidth`. It does not run
the lint of #12/#13.

## Committed SVGs

The SVGs are committed so the examples can be viewed without installing
anything. They are small (about 25KB, with the font subset embedded) and
deterministic for a given D2 version, font set and source. A test
(`src/compiler/builtins-render.test.ts`, run in CI) re-renders every example
and fails if a committed SVG is stale or wider than its profile allows; after
changing an example, the compiler, a theme or the fonts, re-render every
example and the gallery with one command:

```sh
bun run gallery         # re-renders examples/*/*.{svg,pdf} and docs/gallery/
bun run gallery:check   # fails if any of them is stale (run in CI)
```

## Committed PDFs

`<name>.pdf` is `<name>.svg` converted by `sumi render -o <name>.pdf`'s PDF
engine (krilla + krilla-svg compiled to WebAssembly): one page of the SVG's size in pt,
text in subsets of the bundled fonts, no raster images. They are
byte-identical goldens: `src/render/pdf/pdf.test.ts` converts the committed
SVGs on Linux and macOS in CI and compares the bytes, and checks the page
size, fonts and every label's position against Sumi's own measurement.
