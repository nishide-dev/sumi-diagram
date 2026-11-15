# #546 線のラベルの既定の間隔を `sumi` / `sumi-dark` で広げる

[#546 の配置 lint](546-placement-lint.md) の残り。#538 の再計測で「線のラベルが線から約 0.5mm」と記録された。これはルータの既定の間隔 `EDGE_LABEL_GAP`（3 unit = 1.5pt）そのもので、`geometry/edge-label-hugging` は 1pt をしきい値にしたため拾えなかった。

## 背景

- 間隔を決める場所は `labelGap()`（`src/layout/route/labels.ts`）1 か所で、`EDGE_LABEL_GAP × textScale` を返す。構造化ルータの 3 つの置き方（既定・`labelAt` / `labelSide`・直線）がすべてこれを通る。D2 経路（auto）はラベルを線の上に置いて線を隠す設計なので対象外。
- 印刷時の字の輪郭から線までは、`paper-double`（`fit: scale` で縮小）で 0.4〜0.5mm。字の左右の余白と縮小を足してもほぼ間隔そのまま。
- 全体の既定を 6 unit にしてみると、`examples/`（dit-block・gcn・tricl）の SVG と、`tests/fixtures/figures/` の再現図の golden（align-unet、b-adaln-panel ほか）が動く。再現図は原図に合わせて固定するので、全体の既定は変えられない。

## 決定

- テーマに任意の `edgeLabelGap`（unit、整数 1〜24）を足す。EdgeStyle の `labelGap` に写り、`labelGap()` は `style.labelGap ?? EDGE_LABEL_GAP` に `textScale` を掛ける。
- `sumi` と `sumi-dark` が `edgeLabelGap: 6`（3pt）を持つ。字の輪郭から線まで約 1.0mm（約 1.0〜1.4mm）で、文字高の約半分にあたる。ほかのテーマ（paper・llama・minimal・academic など）は持たず、既定の 3 unit のまま。再現図と `examples/` は `paper` / `llama` / `minimal` / `academic` なので出力が変わらない。
- `geometry/edge-label-hugging` は、`labelGap` を持つテーマでは「間隔（`textScale` 込み）の 75%（描画時）未満」を詰まりすぎとする。`sumi` では 4.5 unit 未満で、既定の置き場所（約 6 unit）より詰めて置いた図だけが出る。持たないテーマでは従来どおり印刷時 1pt 未満。
- 1mm の目標は、文字高の約半分と、線幅 1pt の線との間に空きとして見える最小の幅から決めた。印刷時の縮小（`fit: scale`）では約 0.8〜1.0mm になる。

## 採らなかった案

- 全テーマの既定を 6 unit にする: 再現図と `examples/` の出力が動く。再現図は原図への忠実さを保つ。
- しきい値だけを 0.5mm に上げる: 既定の置き場所がすべて「誤り」になる（#546-placement-lint の記録のとおり）。
- 図ごとの `themeOverrides` にする: 新しい図を描く人（と Skill）が毎回書くことになる。テーマの性質として持つほうが既定で効く。

## 互換性

- 出力が変わる: `sumi` / `sumi-dark` の図のうち、線のラベルがあるもの。Skill のレイアウト 15 図（agent-loop・compare-rows・decision-tree・encoder-block・encoder-decoder・layered-stack・loop-cycle・microservices-bus・moe-router・pipeline-feedback・pipeline-linear・residual-skip-stack・state-machine・timeline-lanes・train-infer-panels）、`docs/assets/architecture.{light,dark}.svg`、`docs/gallery/dim/dim.sumi{,-dark}.svg`。`bun run gallery` と `bun run skill:previews` で更新した。
- 変わらない: `examples/` と固定した再現図（YAML のハッシュも golden も）、`paper` などほかのテーマの図、auto（D2）の図。
- `edge-label-hugging` の診断は、`sumi` 系では出なくなり（既定の置き場所が通る）、ほかのテーマでは変わらない。
