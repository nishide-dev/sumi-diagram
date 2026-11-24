# #644 matrix の色の段階・結合セル・列の見出しの回転

## 背景

#639 の dogfood（v0.20.0）の run 1・2 で、`matrix` の表現が足りなかった。

- 連続した色の段階（ramp）がない。run 2 は `themeOverrides.tones` で red・orange・yellow の塗りを上書きし、
  3 つの class を 1 つの段階に見せた。`geometry/theme-color-use` はこれを 3 つの色相として数えなかったが、
  図の意味（値の大小）と色の決め方（3 つの tone）が食い違っていた。
- 結合セルを描けず、Table 1 の「t_src = t_tgt」を「= t_src」と文字で書いた。
- 列の見出しを回転できず、モデル名を 2〜4 文字の略称（GPT・Cla・Lla…）にした。
- `rules: true` のセルには枠がないのに、凡例の見本は枠付きで描かれる。「< 75」の見本は白い枠の箱なのに、
  セルは淡い灰色の数字だけだった（#612 で「default のセルの見本が白い四角で見えない」ため見本の枠を残した）。

## 決定

すべて `matrix` と `legend` の props の追加で、書かない図の出力は変えない（`rules: true` の凡例の見本を除く。
互換性の節）。

### 色の段階（`scale`）

- **`props.scale: {from, to, tone, steps, decimals, showValues, label}`**。セルを `{value: 78.5}` と書くと、
  値の位置 `t = (value − from) / (to − from)`（0〜1 に切り詰める）の色で塗る。`from > to` なら小さい値が濃い。
  `steps: n`（2〜9）は範囲を n 等分し、各区間を 1 色にする（区間 k の色は `t = k/(n−1)`）。
- **色は tone の 2 色から作る**。淡い端は tone の `filled` の塗りをキャンバスへ 50% 寄せた色、濃い端は tone の
  `solid` の塗り（`solid` に塗りがなければ枠の色）。間は OKLab で線形に混ぜる（`src/core/theme/ramp.ts`）。
  テーマが tone ごとに持つ色だけを使うので、sumi・sumi-dark・paper・academic（灰色の段階）など、どのテーマ・
  パレット・`themeOverrides.tones` でもその図の tone の色で段階ができる。暗いキャンバスでは淡い端がキャンバスに
  近い暗い色、濃い端が明るい色になり、「キャンバスから離れるほど強い」が保たれる。
- **文字**: セルの値（`decimals` で桁を揃える。`showValues: false` で出さない。セル自身の `text` が優先）は、
  `filled` の文字色、`solid` の文字色の順に 4.5:1 を保つ方を使う。どちらも届かない中間の段では、暗い方の文字色を
  黒へ寄せた色か白のうち、コントラストの高い方にする。全組み込みテーマ × 全 tone × 21 段で 4.5:1 以上を
  テストで確かめた（以前の比較では中間の段で 3.2:1 まで下がった）。
- **実装**: 展開でセルを `sumi/box`・`variant: filled`・`tone` にし、`doc.paints` に `ramp: t` を付ける。テーマの段で
  `rampStyle()` が塗りと文字色を置き換える（枠と大きさはそのまま）。`rules: true` なら枠なし（`borderless`）。
  セルは class か value のどちらか（両方は `component/invalid-prop`）。`scale` があれば `classes` は省略できる。
  value を書いて `scale` がなければ `component/invalid-prop`。
- **凡例**: `legend` の entry `{scale: <matrix>}` は、両端の値（`from` / `to` を `decimals` で）の間に見本の箱を並べた
  帯を描く。箱は `steps` の数（連続の段階では 5 個、`t = 0, 0.25, …, 1`）で、セルと同じ `ramp` で塗る。
  文字は entry の `label`、なければ `scale.label`、どちらもなければ帯だけ。scale のない matrix や matrix でない ID
  を指すと `ref/unknown-scale`。予約 ID に `<legend>-<n>-step-<k>`・`-low`・`-high` が加わる。
- **色の lint**:
  - IR のノードに `scaleStep` を付ける（段階で塗ったセルと凡例の見本）。
  - `geometry/theme-color-use`: tone は 1 つのアクセントとして数えるが、heavy（色の塊）の面積には入れない。
    ヒートマップのセルはデータそのもので、`filled` を選んだ結果ではない。
  - `geometry/color-harmony`: 段階の淡い段は「彩度の違う淡い塗りの混在」に数えない（段階は淡いものから濃い
    ものまでが目的）。明度 0.7 未満の濃い段は `solid` の塗りと同じく線の色として色相に数える。
  - `geometry/muddy-color`: 段階の段は対象外。不透明で、テーマ自身の 2 色を混ぜた色なので、合成による濁りは
    起きない。暗いキャンバスの orange・yellow の段階の中間は ochre の範囲を通る（sumi-dark の orange の
    `solid` の塗り #f1c6a7 自体が判定の境界にある）が、それは段階の性質で、図の色の選び方の誤りではない。

### 結合セル（`span`）

- リストで書いた行のセルに **`span: 2`**（列の数）または **`span: {rows, columns}`**。HTML の表と同じく、下の行は
  上から結合されたセルが覆う位置を書かない。各行が覆う列の数（結合セルは覆う列を数える）は 1 行目と同じでなければ
  ならない。行を越える `span`、上からの結合セルと重なる `span`、省略記号の行・列をまたぐ `span` は
  `component/invalid-prop`（書いた `span` の位置）。配置は `matrixGrid()`（`builtins.ts`）が決め、スキーマの検査と
  展開が同じ関数を使う。
- 結合セルは左上の位置の ID（`<matrix>-<row>-<column>`）を持ち、覆う位置とその間の `gap` を合わせた大きさの
  箱になる。覆われた位置にノードはない。
- 結合セルのある matrix だけ、セルを行の row の代わりに **`place`**（単位 0.5pt）で各セルの中心に置き、行の見出しは
  セルの高さの stack にして横に並べる。結合のない matrix は今までどおりの row / stack なので出力は変わらない。

### 列の見出しの回転（`headerRotate`）

- **`headerRotate: 90 | -90`** で列の見出しのラベルに `labelRotation` を付ける（#178 の回転をそのまま使う）。
  見出しの箱は列の幅で、高さは回転した文字の幅になる（構造化レイアウトが回転した文字の大きさで箱を測るので、
  幅の超過・重なりの lint は回転した文字を見る）。高さの違う見出しは `wrapHeaders` と同じくセルの側に揃える。
  回転した見出しは折り返さない（`wrapHeaders` は行の見出しと corner にだけ効く）。`columns` がなければ
  `component/invalid-prop`。
- 編集可能な PPTX では、回転したラベルは今までどおり別のテキストボックス（`<key> label`）になる。テストの検査を
  その形に合わせた。

### `rules: true` の凡例の見本

- `rules: true` の matrix の class の見本は、セルと同じく枠なし（`borderless`）にする。
- セルに見える塗りがない class（キャンバスとの CIE76 の差が 2 以下。sumi の `muted` は白）は、枠を外すと見本が
  消える。その class の最初のセルの文字を、セルと同じ variant・淡さで見本にする（run 2 なら淡い灰色の「74.1」）。
  `pattern: hatch` の class は斜線が見えるので枠なしの箱のまま。塗りも文字もない class（セル自体が何も描かない）
  だけは、今までどおり枠付きの箱を残す。

## 採らなかった案

- **`scale.palette: warm` のような名前の付いた多色の段階**（#639 の提案）: Sumi のパレット（#417）は図の色の
  役割（panel・tint・accent・ink）の写しで、段階の色の並びではない。多色の段階は色相を 2 つ以上使い、
  `geometry/theme-color-use` の「アクセントの数」とも合わない。1 つの tone の段階にし、テーマ・パレット・tone の
  上書きにそのまま従うようにした。発散型（2 色）の段階は需要が出てから別に扱う。
- **SVG のグラデーションの凡例**: PDF・PPTX の出力経路で同じ見た目を保証できない。見本の箱を並べた帯にした
  （段階付きの scale では、そのまま各段の色になる）。
- **OKLCH で色相を固定して混ぜる**: 暗いキャンバスで淡い端の色相がキャンバスの青に寄り、色相の補間が回り込む。
  OKLab の線形補間の方が単純で、明るいテーマでは差がない。
- **結合セルを grid の `span` で置く**: arrange の grid は列の結合しか持たず、行の結合がない。`place` なら行・列の
  両方を同じ規則で置け、結合のない matrix の配置は変えずに済む。
- **任意の角度（45° など）の見出し**: 回転した文字の外接矩形と、隣の見出しへのはみ出しの測り方を新しく決める
  必要がある。#178 の ±90° の回転は測定・SVG・PDF・PPTX が揃っているので、それに限った。
- **凡例の見本を常に枠なしにする**: 塗りも文字もない class の見本が何もない空白になる。

## 互換性

- 新しい props（`scale`・セルの `value` / `span`・`headerRotate`・凡例の `scale`）は省略時に今までどおり。
- 出力が変わるのは `rules: true` の matrix の class を凡例に載せた図だけ。`examples/`・`docs/gallery/`・
  Skill のベースレイアウトにはそのような図がなく、`bun run gallery` で変わったのは matrix・legend の props の
  説明と新しい例だけだった。再現図のソースは変えていない（reproduction hash は新しい例の 2 行の追加のみ）。
- 新しい例 `examples/transfer-heatmap`（sumi、paper-single）: 連続の段階、`headerRotate: -90`、`rules: true`、
  `span: 2` の結合セル、段階の帯と 2 つの class の凡例。`lint --geometry` は 0 件。
- 新しい診断コード `ref/unknown-scale`。
