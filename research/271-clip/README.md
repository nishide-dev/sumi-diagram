# CLIP Figure 1 の再現実験（#271）

Sumi 0.9.0 / Bun 1.3.14 の既存機能だけで、CLIP 論文の Figure 1
「Summary of our approach」を再構成した。`src/` の変更や SVG の後加工はない。
一次ソースは [clip.sumi.yaml](clip.sumi.yaml)。

![CLIP の3パネル構成の再現](preview.png)

## 参照と比較範囲

- Radford et al. (2021), *Learning Transferable Visual Models From Natural Language
  Supervision*, [arXiv:2103.00020v1](https://arxiv.org/abs/2103.00020v1)。
- [論文 HTML](https://arxiv.org/html/2103.00020v1) の Figure 1 キャプション、
  §2.3（バッチ内の N×N 組合せと正例）、§3.1.2（テキストから生成する分類器）、
  §3.1.4（プロンプト）を確認した。
- 比較は依頼文の原図記述と上記本文に基づく**構造比較**。
  原図画像のダウンロード・切り出し・保存やピクセル差分比較は行っていない。
  出力の `preview.png` は実際に開いて目視した。
- 写真の代わりに、ImageMagick のグラデーションと図形で生成した犬の合成画像を使用。
  `assets/synthetic-dog.png` は原図の画像・外部写真・個人情報を含まない。
  実写の再現ではなく、入力画像の位置と役割を示す仮画像である。

## テーマ・レイアウトの判断

`paper` は紫の Text Encoder、緑の Image Encoder、青の正例・選択結果を
同時に区別でき、細い矢印と Inter の本文もカラー論文図に適している。
`academic` は色がグレーになるため採用しなかった。
`paper-double`（180mm）を論文の全幅図として選び、structured の
grid / row / stack で左に事前学習、右上に分類器生成、右下に予測を配置した。
`fit: scale` により約87%に縮小し、最終サイズは **180 × 87.01mm**。
任意の色・座標・フォント設定は追加していない。

## 原図の構造との比較

| パネル | 原図の構造 | 今回の対応・差分 | 対処・次の改善 |
| --- | --- | --- | --- |
| (1) 対比事前学習 | 重なったキャプション → 紫の台形 → T₁…Tₙ、写真 → 緑の台形 → I₁…Iₙ、N×N 類似度と青い対角 | `stack` の「Pepper the aussie pup」、画像3枚、向き付き台形、T 行 / I 列、Iᵢ·Tⱼ を持つ表を配置。1,2,3,…,N の5行5列で省略を表現 | 構造は再現。テキスト行と行列列は33ptで統一。ネイティブ matrix のラベル対応後に表を置換する |
| (2) 分類器生成 | 等幅の plane / car / dog / ⋮ / bird を括ってプロンプトへ → Text Encoder → T₁…Tₙ | ラベル列と青い `{object}` を含む文、紫の台形、T 行を再現。等幅と括弧は未再現。ラベル列中央の dog 行を集合の代表接続点として矢印を引いた | 等幅ラベルと collection bracket が必要。dog のみを処理する意味ではなく、全クラスへテンプレートを適用する |
| (3) ゼロショット予測 | 写真 → Image Encoder → I₁、I₁·T₁…I₁·Tₙ、T₃ を選んで犬の文へ | 合成犬画像、緑の台形、I₁、青い第3スコア、青い dog を含む結果文を再現。分類器の再利用は右側を回る矢印で示した | T 行の末尾とスコア行末尾を代表端点とする。集合全体を接続するポートがあれば意味をさらに明確化できる |

ここで N は任意のバッチ数 / クラス数を表す記号であり、5クラスに固定した実験結果ではない。
スコアも数値の実測値ではなく、原図同様に内積の記号表示である。

## できること・異なること・不足機能

「未対応」を既存機能と混同しないように、今回実際に使えたものも記録する。
以下の英語タイトルは**フォローアップ Issue 案**であり、新規 Issue は作成していない。

| 項目 | 判定・観察 | 現在の対処 / 提案する修正・Issue タイトル |
| --- | --- | --- |
| 3パネルの配置 | 対応済み。grid の空セルで左上を空け、右側は2段にできる | 現在の structured 構成を継続。再利用時は `Add reusable multi-panel figure recipes` |
| 台形エンコーダ | 対応済み。`narrow: south/east` で縦横のフローを区別 | 幅が小さいと文字が斜辺にはみ出すため、横向きは80×48pt。原図と同一の傾斜角・縦横比にはできない。案: `Expose validated trapezoid slant presets` |
| 重なったテキストカード | 対応済み。`stack` で3枚の輪郭と前面テキスト | 枚数・ずれは固定で、カードごとに異なる文は持てない。案: `Support heterogeneous content in stacked cards` |
| 重なった写真 | 対応済み。`image.props.layers` で3枚を上右にずらせる | すべて同じ合成画像のコピー。異なる写真のバッチは単一ノードで表せない。案: `Support distinct assets in image layers` |
| 等幅ラベル | 未対応。カタログに mono フォントはあるが Figure Schema にノードの mono 選択がない | 今回は通常の Inter。案: `Expose monospace text styling in figure labels` |
| 色付き文字列 | 対応済み。数式内の `\textcolor{blue}{\text{…}}` で `{object}` と dog を着色 | プレーンテキストの任意 span ではない。現方式を使用し、使い勝手の改善案: `Add semantic colored spans to plain text labels` |
| 行列の対角強調 | 色自体は既存 matrix の classes でも対応済み。ただし matrix のセルは文字を持てない | 今回は tokens 5行で式と青の `tinted` 対角を共存。データを手で重複記述。案: `Support labeled matrix cells and diagonal selectors` |
| 省略セル | tokens は対応済み。`component: label` の … / ⋮ / ⋱ を配置できる | ネイティブ matrix は省略専用セルを持たない。今回の省略行・列は罫線を描かない。案: `Support ellipsis rows and columns in matrices` |
| ラベル列の括弧 | 専用部品なし。括弧を巨大な文字や外部画像にせず省略 | 今回は中央から矢印で代用。案: `Add collection brackets with group-level ports` |
| トークン集合への接続 | 個別セルは端点にできるが tokens 全体は端点にできない | 中央 / 末尾セルを代表端点にして接続。案: `Add aggregate ports for token sequences` |
| 原図の線・配色・文字密度 | テーマのパレット、角丸、線幅、フォント、表の大きさが原図と異なる | 厳密なトレースではなく意味の一致を優先。案: `Add compact paper table styling presets` |
| 縮小後の読みやすさ | 本文約6.96pt、添字約4.87pt。PNG で全体と式を判読できるが印刷時の添字は小さい | 現在は info として記録。案: `Add fit-aware math script sizing for paper figures` |
| 矢印の曲がり | 原図の括弧・短い接続と異なり、分類器の出力は右側を迂回する | 衝突のない端点を選択。案: `Preserve minimum arrow stems after figure scaling` |

## 再現手順

リポジトリのルートで実行する。Bun と ImageMagick 7 が必要。
structured のため描画時に D2 は不要。

```sh
# 合成画像を再生成する場合のみ（コミット済み PNG でも描画可能）
sh research/271-clip/generate-assets.sh

# fmt → lint --geometry → render → 同じ Sumi/resvg エンジンで PNG 化
bun research/271-clip/render.ts

bun run check
bun run typecheck
bun test
```

`render.ts` は CLI の JSON summary に errors / warnings があれば失敗し、
プレビューが150,000 bytes以上でも失敗する。Sumi の既存 picture-PPTX 用 PNG
fallback をメモリ上で取り出し、ImageMagick で1500px幅・128色にする。
SVG のレイアウト・テキスト・画像は変更しない。

| ファイル | 役割 |
| --- | --- |
| `clip.sumi.yaml` | 編集対象の一次ソース |
| `assets/synthetic-dog.png` | ImageMagick で生成した仮画像（コミット対象） |
| `generate-assets.sh` | 外部入力なしの仮画像生成手順 |
| `render.ts` | 描画・診断・プレビュー生成手順 |
| `preview.png` | 目視したプレビュー、56,478 bytes（150KB未満） |
| `out/clip.svg` | 再生成可能な SVG、git 管理外 |
| `out/lint.json`, `out/render.json` | 絶対パスを含むローカル診断、git 管理外 |

`.gitignore` は `out/` のみを無視し、`assets/` は無視しない。
生成物を `out/` に集約することで既存の Biome 除外規則とも整合させる。

## 検証結果

- Sumi の `doctor`: フォント・geometry lint・D2 がすべて正常。
- `lint --geometry --json` と `render --json`: **errors 0 / warnings 0 / infos 3**。
- info 内訳: `geometry/script-too-small` 1件（添字4.87pt）、
  `geometry/arrowhead-cramped` 2件（プロンプト→分類器、I₁→選択スコア、直線部1.74pt）。
  いずれも preview で接続と文字を識別できることを確認した。
- プレビュー目視: 左のテキスト入力と写真入力が行列の上下・左右に整列し、
  青い対角4セルと省略記号が見える。右上のクラス列とプロンプトは読め、
  右下の青い第3スコアから dog の文への接続も追える。
- `bun run check`: 423ファイル、指摘なし。`bun run typecheck`: 成功。
- `bun test`: **3321 pass / 13 skip / 0 fail**（133ファイル、約293秒）。
  初回は120秒のツール制限に達したため、600秒の上限で全体を再実行した。
  既存の #124 prototype のスキップ通知も出たが、失敗はない。

受け入れ条件の図と差分一覧は用意できたが、等幅・括弧・集合ポートなどの改善は
この実験の範囲外のため、関連付けは `Refs #271` とする。
