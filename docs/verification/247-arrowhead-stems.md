# #247: 矢じりの手前の直線と全図の互換性

設計は [§6.70](../design/phase1.md#670-247-のグループ内の矢じりの前に見える直線を残す)。作業ブランチは `fix/247-arrowhead-stem`。

## 比較方法と結果

`origin/main`（`42cb386`）を `git archive` で一時ディレクトリに展開し（`node_modules` と `.sumi/bin` は本 worktree へのリンク）、リポジトリの既存 `*.sumi.yaml` **151 個**を、それぞれの元の Theme と組み込みの `minimal` / `academic` / `slides` / `color` / `paper` で `renderFigure()` し、計 **906 通り**の SVG の SHA-256（描画失敗は診断コード）を変更前後で比較した。画像の基準ディレクトリは各 YAML のディレクトリ。PDF・PPTX・auto の D2 は SVG / D2 ソースから決まり、D2 は structured の変更の影響を受けない。

| 対象 | 通り | バイト変更 | 一致 |
| --- | ---: | ---: | ---: |
| SVG（成功・失敗の診断を含む） | 906 | 65 | 841 |

新しい API / YAML のフィールドはなく、グループ内に側から入る矢じりを持たない図はバイト一致した。

## 変更する YAML の全一覧

以下の **13 図すべてで `own`, `minimal`, `academic`, `color`, `paper` の 5 通り**が変わる（65 通り）。`slides` は前後とも描画に失敗する。理由は全件共通で、encoder 西・decoder 東の矢じりの直線を確保する padding 拡張（内容と枠の中心線を揃えるため反対側も同量広げる）と、その側での stub / 丸めの変更。幅と横方向の位置が動く。

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

`tests/fixtures/pptx-sha256.json` の更新は Transformer の画像方式 PPTX 1 件。

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

全 906 通りの描画成功分に geometry lint を適用した件数（変更前 → 後）。

- 新規 `geometry/arrowhead-cramped`: 後で **824 件**（変更前は規則がないため 0）。多くはグループの余白でない狭い接近や `fit` 後の直線のため info にした。以前の記録の 1,124 → 799 件は対称化前・旧コーパスでの値で、再計測していない。
- `geometry/edge-jog`: **75 → 73 件**。受け入れ Transformer は 0 件のまま（片側だけ広げる中間版では 0.66pt の段差が 4 件出た。原因と対策は設計 §6.70）。
- `geometry/edge-touches-label`: **19 → 7 件**（seq2seq 系 3 図と align-side-kv の own / academic / paper の 12 通りで 1 件ずつ解消）。
- `geometry/exceeds-page-width`: **126 → 135 件**。増えたのは `examples/transformer` の minimal / color、`research/135-skill-dogfood/figures/seq2seq-attention.sumi.yaml` の own / academic、`research/167-stage-c/figures/a-transformer.sumi.yaml` の own / minimal / color、`research/173-paper-theme/figures/a-transformer.sumi.yaml` の minimal / color。必要な直線と対称な余白のために幅が増え、上限を越えた。
- 上記以外の既存幾何 rule の件数は同じ。`geometry/arrowhead-on-bend` は前後とも 0 件。

## 視覚確認

受け入れ図を CLI で描き、`rsvg-convert -z 3` の PNG を開いて確認した。短い直線が矢じりの背後に見えること、枠から 3pt の clearance が残ること、Linear → decoder と ⊕ → decoder の辺・encoder の ⊕ → 内部の辺が直線であること、encoder / decoder の残差のまとまりが保たれることを確認した。`examples/transformer`（academic）も同様。受け入れ図は **75.32 → 77.08mm × 114.12mm**（片側だけ広げる中間版は 76.02mm）。5 本の残差の端は 8 → 12 unit の直線になり、見える stem は 0 → 4 unit。丸めはこの stem を使い切らず、必要なら角の半径を減らす。原図の厳密な形・全寸法を再現する変更ではない。

## 最終検証

- `bun run check` / `bun run typecheck` / `CI=1 bun test` / `bun run gallery:check` / `bun run schema:check`: 成功（`CI=1 bun test` は 3,318 pass / 0 fail、gallery は 169 ファイル一致）。
- `SUMI_UPDATE_GOLDEN=1 CI=1 bun test src/render/pdf src/render/pptx src/render/assets.integration.test.ts`: 594 pass / 0 fail。hash ファイルの手編集は行っていない。

## main 取り込み後の #246 / #251 の 3 テスト

`origin/main` 自体で `src/layout/route/split-bowtie.test.ts` の 3 件（bent anchored routes / parallel / trapezoids）が失敗する（本ブランチと無関係。グループのない fixture）。図全体の x 起点が 11 → 12.988 unit に動いた（split bowtie の寸法・ラベルの変更。#245 / #249 のいずれか）のに、#251 の期待値が絶対座標のままだったため。本ブランチでは期待値を積み段の左端（`placed.nodes[0].rect.x`）からの相対値にして、意図（口の位置・折れ方）を変えずに直した。

部品 manifest・画像 / emoji の importer・archive は変更していない。カタログ・JSON Schema に新フィールドはなく、Skill の診断・structured 配置の説明だけを更新した。

## #260 矢じり手前の角の半径

設計は [§6.73](../design/phase1.md)。作業ブランチは `fix/260-rounded-stem-corner`。グループ内で横から入る矢じりの手前の角が直角だったため（弧に使える長さが 0 unit）、余白に半径 4 unit（2pt）の分を足した。

### 比較

`origin/main`（`919eddd`）を `git archive` で展開し（`node_modules` と `.sumi/bin` は本 worktree へのリンク）、既存 `*.sumi.yaml` **151 個** ×（自テーマ + 組み込み 5 Theme の `--theme X --profile paper-double`）= **906 通り**を CLI で描き、SVG の SHA-256 を比較した。

- 変更は #247 と同じ **13 図 × 5 通り = 65 通り**（`slides` は前後とも描画失敗）。他の 841 通りはバイト一致。13 図は上の一覧と同じ（Transformer 系と seq2seq 系、`align-side-kv`）。
- `geometry/arrowhead-cramped`: 824 → 824 件、`geometry/edge-jog`: 73 → 73 件。
- `geometry/exceeds-page-width`: **増加 1 件・解消 0 件**（この比較の件数は 232 → 233。`--profile paper-double` を付けた比較なので #247 の件数とは別）。増えたのは `examples/transformer`（own = academic）で 87.49 → 88.90mm。例の row の `gap` を 2mm から 1mm にして **87.84mm** に収めた（比較は変更前の例のままの値）。
- `geometry/edge-touches-label`（info）: 7 → 15 件。`research/124-stage-b` の seq2seq 2 図、`research/135-skill-dogfood` の seq2seq、`tests/fixtures/figures/layout/align-side-kv` の color / minimal の 8 通りで 1 件ずつ増えた（解消はなし）。枠の幅が変わったためで、info のまま記録する。

### 幅の変化

受け入れ図 A（paper）は **77.08 → 78.49mm × 114.12mm**（+1.41mm。左右 4 unit ずつ）。`examples/transformer` は 87.49mm → 87.84mm（`gap` を 1mm にした後。academic）。

### 視覚確認

`rsvg-convert -z 12` の拡大 PNG で、受け入れ図の Add & Norm に入る残差（encoder 左・decoder 右）を確認した。角が丸く曲がり、短い直線、矢じりの順になる。Linear・⊕ の幹は直線で、枠には触れない。`examples/transformer` も同様。

### 再生成

`bun run gallery`（8 ファイル）と `SUMI_UPDATE_GOLDEN=1 CI=1 bun test src/render/pdf src/render/pptx src/render/assets.integration.test.ts` で再生成。`research/185-acceptance/previews` は `a-transformer.png` だけが変わる。hash ファイルの手編集は行っていない。
