# #351 inline SVG の配置試行と縮小前の診断寸法

## 背景

`geometry/exceeds-page-width`・`geometry/heavy-scaling` と空白領域の修正案は、コピーした IR の配置・経路・SVG を検査して確かめる。従来は `image` ノードが一つでもあると試行を省き、外部ファイルを読まない inline SVG まで除外していた。また、縮小された図の `geometry/label-overflow` は印刷寸法だけを表示し、明示した `props.width` / `props.height` と照合できなかった。

## 決定

- 既存の `loadFigureAssets` で inline SVG・共有 `figure.assets`・同梱アイコンを検査・準備し、試行の SVG writer に渡す。共有資産の crop も通常の描画経路を使う。元の IR は変更せず、試行中に外部ファイルを読むための base directory は渡さない。
- image の幅の削除は候補に含めない。描画後の IR には縦横比から補完された寸法もあり、その幅だけを消して試すと YAML の幅削除を再現できず、必須寸法がなくなる場合もある。gap・配置・通常ノードの幅の編集は引き続き試行する。
- 外部 `props.src`、共有資産の `src`、HTML、配置木なし、既存の要素数・配置木サイズ制限は引き続き試行を省く。それぞれ理由を hint に明記する。未使用の共有資産も通常の loader の検査対象なので、外部 `src` の判定に含める。
- 試行回数上限 6、80 要素、配置木の延べ 240 item と列数の制限、profile / measurer の引き継ぎと再帰防止は維持する。資産の byte / pixel 制限も通常と同じ。
- `geometry/label-overflow` は縮小時だけ、ラベル（回転後の外接矩形）と形状の双方について、印刷寸法に加え `before scaling (YAML units)` の pt 寸法を表示する。回転前の文字列寸法ではない。縮小しない図のメッセージ・path・related は維持する。

## 任意項目の判断・採らなかった案

### グループ見出しの文字サイズ（今回は対応しない）

現状の `figure.themeOverrides.groupLabelWeight` は太さのみを変更し、文字サイズは選択したテーマが決める。サイズ指定の追加は、図全体の override とグループ単位の指定のどちらを契約にするか、半 pt の量子化、profile の最小文字サイズと診断位置、caption や展開された matrix / tokens / legend の内部 group への適用範囲を定義する必要がある。既定の paper 見出しを一律に小さくする案は既存図のレイアウトを変える。今回は診断の修正に絞り、文字サイズの API は追加しない。必要なら既存の `groupLabelWeight: regular` で太字だけを解除できる。

### Skill preview の正方形余白（今回は対応しない）

macOS の Quick Look は正方形 thumbnail で縦長・横長の図が欠けるため、wrapper が正方形に収めている。wrapper を外すだけでは欠ける問題が再発する。余白を除くには画像の crop と実際の thumbnail 倍率に対応する座標計算が要り、macOS 専用の `sips`、または追加の可搬ツールとその検証が必要になる。`rsvg-convert` へ一律変更すると埋め込みフォントが反映されない。今回はフォントと図全体の可視性を優先し、既存の可搬な preview 経路を維持する。余白なし・埋め込みフォントで確認する場合は、同じ YAML を CLI で PDF 出力し（SVG と同じ描画を経由）、`pdftoppm -png` で画像化する。

## 互換性・検証

描画・コンパイラ・テーマ・スキーマの出力は変更しない。全 `*.sumi.yaml` を元のテーマと全組み込みテーマで変更前後に描画し、SVG / PDF / PPTX / D2 の SHA-256 を照合する。意図的に不正な fixture や古い研究入力の失敗も記録し、成功・失敗の変化を照合する。golden の変更は不要。

inline `props.svg` と共有 SVG + crop の実描画で、gap を減らした際の実測幅削減と verified hint を照合する。外部ファイル・HTML・大きい図の省略と、縮小された回転ラベルの寸法・source path を回帰テストにする。従来の挙動に戻すと新規テストが失敗することも確認する。
