# #445 アイコンだけのノードを tone で色づける

## 背景

論文の図の 4 回目の試行で、entity（論文）と attribute（タイトルなど）をアイコンの色で区別したかったが、
アイコンだけのノード（`label` に `icon`）は `tone` を無視するため、常に文字色で描かれた。色を付けるには箱で
囲む必要があり、「アイコンを囲まない」決まり（[#424](424-icon-size.md)）と両立しなかった。

## 決定

- アイコンだけの `label` ノード（`sumi/label` で `icon` と `tone` を持つもの）の文字色を、テーマの
  `toneLines.<tone>`（なければ `stroke`）の色にする。Tabler のアイコンは線を `currentColor`（ノードの文字色）で
  描くので、この 1 点で SVG・PDF・PPTX のすべてがそろう。実装は `styleFigure()`（`src/core/theme/resolve.ts`）の
  `inksIcon()` の分岐だけで、IR の新しい項目はない。
- 塗りのあるアイコン（emoji）は `currentColor` を使わないので変わらない。tone を指定しないアイコン、
  `box` / `circle` など形のあるノード（tone は従来どおり形の塗り）も変わらない。
- 凡例の `icon` の見本に `iconTone`（`iconSize` と同じく `icon` と同じ項目に書く。`tone` と同じ名前の列挙）を足す。
  展開される `label` ノード `<legend>-<n>-box` の `tone` に渡すだけなので、ノードと同じ経路で同じ色になる。
  `edge.tone` や `node.tone` と区別するため、項目直下の `tone` ではなく `iconTone` とした。
  `icon` のない項目の `iconTone` は `schema/invalid-value`（`iconTone` の位置）。
- コントラストの lint: `theme/low-contrast`（#380）が白の上で確かめる色の使い方に「アイコンだけの `label` の
  tone」を足した。図が上書きした tone の `text`（なければ `line`）が白の上で 4.5:1 未満なら、従来の
  outlined・辺ラベルと同じ警告を出す。組み込みテーマの tone は元から検査の対象外（パレットが保証する）。

## 採らなかった案

- **`iconColor` のような新しい項目**: tone はすでにテーマごとの配色の語彙で、組み込みの 6 テーマ・パレット・
  `themeOverrides.tones` が効く。色の直接指定は配色の調和の lint（#423）も外れる。
- **`box` / `circle` の中のアイコンにも tone で線を付ける**: それらの tone は形の塗りで、意味が変わってしまう。
- **tone の塗りを `label` に描く**: `label` は形を持たない。囲みを避けるという目的に反する。

## 互換性

- tone を持たないアイコンだけの `label`、emoji、形のあるノード、バッジの図の出力は変わらない。
- 同じ `label` ノードに `badge` があるとき、バッジのアイコンも同じ文字色で描かれるため、tone の色になる
  （アイコンだけの `label` に tone とバッジの両方を付けた図のみ）。
- リポジトリ内のすべての `*.sumi.yaml` を、図自身のテーマと組み込みの 6 テーマで描き、SVG と D2 の sha256 を
  変更前後で比べた（`research/` と非公開の図は除く）。すべて一致した（`tone` を指定したアイコンだけの `label` が既存の図にないため）。
- 公開した型の追加: 凡例の項目の `iconTone`（マニフェストの props なので、図の JSON Schema は変わらない）。
