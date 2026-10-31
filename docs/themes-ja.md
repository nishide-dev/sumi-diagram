# テーマ

テーマは図の見た目（色・角・線の太さ・グループ・フォント）を決めます。レイアウトの規則やページの制約は変えません（それは[プロファイル](usage-ja.md#テーマとプロファイル)の役割です）。`figure.theme` または `--theme` で選び、同じ YAML をどのテーマでも描画できます。

組み込みテーマは 5 つです。

- **`minimal`**（既定）: 白黒で輪郭のはっきりしたテーマ。中立の出発点です。
- **`academic`**: 白黒（グレースケール）で印刷できるジャーナル調。色を一切使わないので、白黒プリンターでも同じ見た目になります。
- **`color`**: 色を使う汎用テーマ。`minimal` と同じ線・文字で、tone は淡い色、強調は青です。
- **`paper`**: カラーの ML 論文風。公開されている Transformer・DiT の図を手本に、パステルの tone、角丸、細い枠線とエッジ、薄い灰色のパネル、欧文は Inter です。
- **`slides`**: 投影向けの大きな文字と太い線。`presentation-16x9` プロファイルと組み合わせます。

`academic` と `paper` はどちらも論文向けです。**白黒・グレースケールで印刷するなら `academic`、カラーの ML 論文なら `paper`** を選びます。

## 比較表

| | `minimal` | `academic` | `slides` | `color` | `paper` |
| --- | --- | --- | --- | --- | --- |
| 用途 | 汎用・中立の既定 | ジャーナルの図、白黒印刷 | 投影 | 色を使う汎用 | カラーの ML 論文の図 |
| 色 | 白黒。tone は 3 段階の灰色 | 灰色のみ。tone は 3 段階の灰色 | 白黒（濃いめの灰色）。tone は 3 段階の灰色 | パステルの tone、強調は青 | パステルの tone と tone ごとの線色。青は tone の 1 つ |
| 角 | 四角 | 四角 | 四角 | 四角 | 角丸（箱 2pt、グループ 6pt） |
| 線 | 1pt、強調 2pt | 0.5pt、強調 1pt | 2pt、強調 4pt | 1pt、強調 2pt | 枠 1pt、エッジ 0.5pt（矢じりは小さい）、強調 1.5pt |
| グループ | 薄い灰色の塗り、灰色の枠 | 塗りなし、灰色の枠 | 薄い灰色の塗り、灰色の枠 | 薄い灰色の塗り、灰色の枠 | 薄い灰色のパネル、黒 1pt の枠、角丸 |
| フォント | BIZ UDPGothic。8pt、エッジ 7pt | BIZ UDPGothic。8pt、エッジ 7pt | BIZ UDPGothic。16pt、エッジ 14pt | BIZ UDPGothic。8pt、エッジ 7pt | structured の図の欧文は Inter、日本語は BIZ UDPGothic。8pt、エッジ 7pt |
| 典型的なプロファイル | `paper-single`、`paper-double` | `paper-single`、`paper-double` | `presentation-16x9` | `paper-single`、`paper-double` | `paper-single`、`paper-double` |

## 同じ structured の図を 5 テーマで

Transformer（[`examples/transformer`](../examples/transformer/transformer.sumi.yaml)、structured レイアウト）を `--theme` で描き分けたものです。`slides` は専用の `presentation-16x9` で描いており、この縦長の図はスライドより高くなります。

| `minimal` | `academic` | `slides` | `color` | `paper` |
| --- | --- | --- | --- | --- |
| <img src="gallery/themes/transformer.minimal.svg" alt="テーマ minimal の Transformer"> | <img src="gallery/themes/transformer.academic.svg" alt="テーマ academic の Transformer"> | <img src="gallery/themes/transformer.slides.svg" alt="テーマ slides の Transformer"> | <img src="gallery/themes/transformer.color.svg" alt="テーマ color の Transformer"> | <img src="gallery/themes/transformer.paper.svg" alt="テーマ paper の Transformer"> |

## 同じ自動配置の図を 5 テーマで

pipeline（[`examples/pipeline`](../examples/pipeline/pipeline.sumi.yaml)、自動配置）を `paper-single` プロファイルで描いたものです。

| `minimal` | `academic` | `slides` | `color` | `paper` |
| --- | --- | --- | --- | --- |
| <img src="gallery/compare/pipeline.minimal.paper-single.svg" alt="テーマ minimal の pipeline"> | <img src="gallery/compare/pipeline.academic.paper-single.svg" alt="テーマ academic の pipeline"> | <img src="gallery/compare/pipeline.slides.paper-single.svg" alt="テーマ slides の pipeline"> | <img src="gallery/compare/pipeline.color.paper-single.svg" alt="テーマ color の pipeline"> | <img src="gallery/compare/pipeline.paper.paper-single.svg" alt="テーマ paper の pipeline"> |

`slides` の文字は `paper-single` には大きすぎます（図は描かれますが、[プロファイルの比較](gallery/compare.md)にあるとおり geometry の error が出ます）。`presentation-16x9` と組み合わせてください。

## 関連

- [ギャラリー: テーマ](gallery/themes.md)・[tone](gallery/tones.md)・[dim](gallery/dim.md)・[テーマ × プロファイルの一覧](gallery/compare.md)
- [利用ガイド: テーマとプロファイル](usage-ja.md#テーマとプロファイル)
- English: [Themes](themes.md)
