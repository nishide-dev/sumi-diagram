# #247: 矢じりの手前の直線と全図の互換性

設計は [§6.70](../design/phase1.md#670-247-のグループ内の矢じりの前に見える直線を残す)。作業ブランチは `fix/247-arrowhead-stem`。

## 比較方法と結果

リポジトリの既存 `*.sumi.yaml` 150 個を列挙し、それぞれの元の Theme と組み込みの `minimal` / `academic` / `slides` / `color` / `paper` で `renderFigure()`。画像の基準ディレクトリは各 YAML のディレクトリ。計 900 通りを変更前後に描き、成功した SVG と、そこから変換した PDF・画像方式 PPTX・編集可能 PPTX、auto の D2 ソースを SHA-256 で比較した。検証用スクリプト・hash は作業用の `.sumi/review/247-corpus.ts` と `before.json` / `before-count.json` / `final.json` に保存した。

| 対象 | 成功 | バイト変更 | 一致 |
| --- | ---: | ---: | ---: |
| SVG | 628 | 65 | 563 |
| PDF | 628 | 65 | 563 |
| 画像方式 PPTX | 628 | 65 | 563 |
| 編集可能 PPTX | 428 | 5 | 423 |
| D2 | 222 | 0 | 222 |

描画成功 628 / 失敗 272 は前後一致。編集可能 PPTX の非対応による失敗も同じ。新しい API / YAML のフィールドはなく、グループ内の狭い矢じり接近を持たない図はバイト一致した。

## 変更する YAML の全一覧

以下の **13 図すべてで `own`, `minimal`, `academic`, `color`, `paper` の 5 通り**が変わる（65 通り）。`slides` は前後とも描画に失敗する。理由は全件共通で、encoder 西・decoder 東の矢じりの直線を確保する padding 拡張と、その側での stub / 丸めの変更。幅と横方向の中心・それに伴う接続が動く。

1. `examples/transformer/transformer.sumi.yaml`
2. `research/109-dogfood-v0.4/figures/seq2seq-attention.sumi.yaml`
3. `research/124-stage-b/figures/seq2seq-attention.side-kv.sumi.yaml`
4. `research/124-stage-b/figures/seq2seq-attention.sumi.yaml`
5. `research/135-skill-dogfood/figures/seq2seq-attention.sumi.yaml`
6. `research/167-stage-c/figures/a-transformer.sumi.yaml`
7. `research/173-paper-theme/figures/a-transformer.sumi.yaml`
8. `research/182-compact/figures/a-transformer.sumi.yaml`
9. `research/185-acceptance/figures/a-transformer.sumi.yaml`
10. `research/86-paper-figures/figures/ideal/a-transformer.sumi.yaml`
11. `tests/fixtures/figures/compact/a-transformer.sumi.yaml`
12. `tests/fixtures/figures/layout/a-transformer.sumi.yaml`
13. `tests/fixtures/figures/layout/align-side-kv.sumi.yaml`

編集可能 PPTX が変わるのは 12 の 5 通り。他の変更図は以前から編集可能形式の非対応要素を持ち、その失敗は変わらない。

## 生成ファイルの全変更

`bun run gallery` で再生成:

- `examples/transformer/transformer.svg`: 矢じりの手前の直線と、余白拡張による横位置・幅。
- `examples/transformer/transformer.pdf`: 上記 SVG の PDF。
- `docs/gallery/README.md`, `docs/gallery/index.html`: Transformer の表示寸法。
- `tests/fixtures/layout/a-transformer.layout.json`
- `tests/fixtures/layout/a-transformer.routed.layout.json`
- `tests/fixtures/layout/align-side-kv.layout.json`
- `tests/fixtures/layout/align-side-kv.routed.layout.json`

最後の 4 個は対象 figure の配置・経路 snapshot。この変更から gallery の正規生成対象に含めた。他の部品・全 variant × 全 Theme・tone・dim・比較 gallery の SVG はすべて同じ。

`SUMI_UPDATE_GOLDEN=1 CI=1 bun test src/render/pdf src/render/pptx src/render/assets.integration.test.ts` で再生成:

- `tests/fixtures/pptx-sha256.json`: Transformer の画像方式 PPTX 1 件だけ。

他の PDF / PPTX / assets hash は同じ。hash ファイルの手編集は行っていない。

## lint の判断と観察

- 新規 `geometry/arrowhead-cramped`: **1,124 → 799 件、222 → 163 通り**。修正前の図にも同じ新 rule を適用して集計し、そのときの SVG hash が元の baseline と全件一致することを確かめた。多くはグループの余白でない狭い接近や `fit` 後の直線であるため、既存 warning の閾値を引き上げず info にした。
- `geometry/arrowhead-on-bend`: 前後とも 0 件。
- `geometry/edge-jog`: **79 → 113 件**。余白の非対称拡張で、外のノードとグループ内のノードの横の中心に短い差ができる。受け入れ Transformer own は 0 → 4 件、各 0.66pt。これは新しい rule の誤検出ではなく描かれた小さな段差なので、そのまま報告する。
- `geometry/edge-touches-label`: 19 → 15 件。
- `geometry/exceeds-page-width`: 126 → 128 件。増えたのは `research/135-skill-dogfood/figures/seq2seq-attention.sumi.yaml` の own / academic。必要な直線のために幅が増え、上限を越えた。minimal / color の既存の幅超過も維持する。
- 上記以外の既存幾何 rule の件数は同じ。

## 視覚確認

受け入れ図を `.sumi/review/247-transformer.svg` に CLI で描き、`rsvg-convert --zoom 4` の PNG を開いて確認した。原論文の Figure 1 の PNG と比較し、短い直線が矢じりの背後に見えること、枠から 3pt の clearance が残ること、encoder / decoder の残差のまとまりが保たれることを確認した。原図では直線と矢じりが同じ桁の長さで、2pt の stem / 4pt の矢じりはその比率を小さい紙面の中で控えめに再現する。

受け入れ図は **75.32 → 76.02mm × 114.12mm**。5 本の残差の端は **8 → 12 unit** の直線になり、見える stem は **0 → 4 unit**。丸めはこの stem を使い切らず、必要なら角の半径を減らす。拡大画像では上記の小さな段差も確認できる。原図の厳密な形・全寸法を再現する変更ではない。

## 最終検証

- `bun run check`: 成功（警告なし）。
- `bun run typecheck`: 成功。
- `CI=1 bun test`: **3,195 pass / 13 skip / 0 fail**。
- `bun run gallery:check`: **169 ファイル**一致（全 variant × 全 Theme を含む）。
- `bun run schema:check`: 一致。
- 指定の PDF / PPTX / assets golden 更新: **594 pass / 0 fail**。

部品 manifest・画像 / emoji の importer・archive は変更していない。カタログ・JSON Schema に新フィールドはなく、Skill の診断・structured 配置の説明だけを更新した。
