# #215 の意図した出力変更一覧

各行の SVG・PDF・画像方式 PPTX が変更（計 177 出力）。すべて paper の operator の縮小・細線化と、それに伴う配置・経路・fit の再計算による。D2 の変更はない。own は YAML に書かれた paper。45 ファイルを PDF → PNG にし、4 枚の一覧で目視確認した。過去の不具合の再現図にある重なりは保持される。

- `examples/dit-block/dit-block.sumi.yaml @ paper` — SVG / PDF / PPTX
- `examples/transformer/transformer.sumi.yaml @ paper` — SVG / PDF / PPTX
- `research/109-dogfood-v0.4/figures/seq2seq-attention.sumi.yaml @ paper` — SVG / PDF / PPTX
- `research/109-dogfood-v0.4/figures/unet-small.sumi.yaml @ paper` — SVG / PDF / PPTX
- `research/109-dogfood-v0.4/repro/attach-in-gap.sumi.yaml @ paper` — SVG / PDF / PPTX
- `research/124-stage-b/figures/seq2seq-attention.side-kv.sumi.yaml @ paper` — SVG / PDF / PPTX
- `research/124-stage-b/figures/seq2seq-attention.sumi.yaml @ paper` — SVG / PDF / PPTX
- `research/124-stage-b/figures/unet-small.sumi.yaml @ paper` — SVG / PDF / PPTX
- `research/135-skill-dogfood/figures/seq2seq-attention.sumi.yaml @ paper` — SVG / PDF / PPTX
- `research/135-skill-dogfood/figures/unet-small.sumi.yaml @ paper` — SVG / PDF / PPTX
- `research/151-dogfood-v0.5/figures/dit-block.sumi.yaml @ paper` — SVG / PDF / PPTX
- `research/151-dogfood-v0.5/figures/se-comparison.sumi.yaml @ paper` — SVG / PDF / PPTX
- `research/151-dogfood-v0.5/repro/junction-detour.sumi.yaml @ paper` — SVG / PDF / PPTX
- `research/167-stage-c/figures/a-transformer.sumi.yaml @ paper` — SVG / PDF / PPTX
- `research/167-stage-c/figures/b-dit.sumi.yaml @ paper` — SVG / PDF / PPTX
- `research/167-stage-c/figures/c-h3world.sumi.yaml @ paper` — SVG / PDF / PPTX
- `research/167-stage-c/repro/operator-loop.sumi.yaml @ paper` — SVG / PDF / PPTX
- `research/173-paper-theme/figures/a-transformer.sumi.yaml @ own` — SVG / PDF / PPTX
- `research/173-paper-theme/figures/a-transformer.sumi.yaml @ paper` — SVG / PDF / PPTX
- `research/173-paper-theme/figures/b-dit.sumi.yaml @ own` — SVG / PDF / PPTX
- `research/173-paper-theme/figures/b-dit.sumi.yaml @ paper` — SVG / PDF / PPTX
- `research/173-paper-theme/figures/c-h3world.sumi.yaml @ own` — SVG / PDF / PPTX
- `research/173-paper-theme/figures/c-h3world.sumi.yaml @ paper` — SVG / PDF / PPTX
- `research/176-zoom-edge/figures/b-dit.sumi.yaml @ paper` — SVG / PDF / PPTX
- `research/176-zoom-edge/figures/c-h3world.sumi.yaml @ paper` — SVG / PDF / PPTX
- `research/177-outlined-tones/figures/c-h3world.sumi.yaml @ own` — SVG / PDF / PPTX
- `research/177-outlined-tones/figures/c-h3world.sumi.yaml @ paper` — SVG / PDF / PPTX
- `research/180-matrix/figures/c-h3world.sumi.yaml @ own` — SVG / PDF / PPTX
- `research/180-matrix/figures/c-h3world.sumi.yaml @ paper` — SVG / PDF / PPTX
- `research/181-tokens/figures/c-h3world.sumi.yaml @ paper` — SVG / PDF / PPTX
- `research/182-compact/figures/a-transformer.sumi.yaml @ own` — SVG / PDF / PPTX
- `research/182-compact/figures/a-transformer.sumi.yaml @ paper` — SVG / PDF / PPTX
- `research/182-compact/figures/b-dit-tight.sumi.yaml @ own` — SVG / PDF / PPTX
- `research/182-compact/figures/b-dit-tight.sumi.yaml @ paper` — SVG / PDF / PPTX
- `research/182-compact/figures/b-dit.sumi.yaml @ own` — SVG / PDF / PPTX
- `research/182-compact/figures/b-dit.sumi.yaml @ paper` — SVG / PDF / PPTX
- `research/182-compact/figures/c-h3world.sumi.yaml @ own` — SVG / PDF / PPTX
- `research/182-compact/figures/c-h3world.sumi.yaml @ paper` — SVG / PDF / PPTX
- `research/185-acceptance/figures/a-transformer.sumi.yaml @ own` — SVG / PDF / PPTX
- `research/185-acceptance/figures/a-transformer.sumi.yaml @ paper` — SVG / PDF / PPTX
- `research/185-acceptance/figures/b-dit.sumi.yaml @ own` — SVG / PDF / PPTX
- `research/185-acceptance/figures/b-dit.sumi.yaml @ paper` — SVG / PDF / PPTX
- `research/185-acceptance/figures/c-h3world.sumi.yaml @ own` — SVG / PDF / PPTX
- `research/185-acceptance/figures/c-h3world.sumi.yaml @ paper` — SVG / PDF / PPTX
- `research/86-paper-figures/figures/ideal/a-transformer.sumi.yaml @ paper` — SVG / PDF / PPTX
- `research/86-paper-figures/figures/ideal/b-adaln-panel.sumi.yaml @ paper` — SVG / PDF / PPTX
- `tests/fixtures/figures/compact/a-transformer.sumi.yaml @ own` — SVG / PDF / PPTX
- `tests/fixtures/figures/compact/a-transformer.sumi.yaml @ paper` — SVG / PDF / PPTX
- `tests/fixtures/figures/compact/b-dit.sumi.yaml @ own` — SVG / PDF / PPTX
- `tests/fixtures/figures/compact/b-dit.sumi.yaml @ paper` — SVG / PDF / PPTX
- `tests/fixtures/figures/dim/b-dit.sumi.yaml @ paper` — SVG / PDF / PPTX
- `tests/fixtures/figures/fit/b-dit.sumi.yaml @ paper` — SVG / PDF / PPTX
- `tests/fixtures/figures/fit/c-h3world.sumi.yaml @ paper` — SVG / PDF / PPTX
- `tests/fixtures/figures/layout/a-transformer.sumi.yaml @ paper` — SVG / PDF / PPTX
- `tests/fixtures/figures/layout/align-side-kv.sumi.yaml @ paper` — SVG / PDF / PPTX
- `tests/fixtures/figures/layout/align-unet.sumi.yaml @ paper` — SVG / PDF / PPTX
- `tests/fixtures/figures/layout/b-adaln-panel.sumi.yaml @ paper` — SVG / PDF / PPTX
- `tests/fixtures/figures/sublabel/b-dit.sumi.yaml @ paper` — SVG / PDF / PPTX
- `tests/fixtures/figures/variants/b-dit-plain.sumi.yaml @ paper` — SVG / PDF / PPTX

ギャラリーの変更: `docs/gallery/components/sumi-operator.paper.svg`（全 symbol・variant）、`docs/gallery/tones/tones.paper.svg`（tone）、`docs/gallery/dim/dim.paper.svg`（薄表示）。後二者はラベルなし mark のため、PDF/PPTX corpus の対象外。目次 README / HTML はサイズ表示のみ。PDF corpus 1 件、画像方式 PPTX corpus 1 件、編集可能 PPTX corpus は operator の freeform / glued 各 1 件（slide XML も各 1 件）を指定の更新手順で再生成した。

受け入れ図の PNG 3 件と `research/215-paper-operator/previews/c-h3world.png` は同じ変更のプレビュー。その他の Theme、operator を含まない paper、既存の D2 はバイト一致。
