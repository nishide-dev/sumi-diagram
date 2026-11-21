# #612 matrix の見出し・タイトル・淡いセル・罫線だけの表

## 背景

#603 の dogfood（v0.19）で 4 枚の図が `matrix` で引っかかった。

- 列の見出しはセル幅の label で、折り返しも幅の指定もない。24pt のセルに「PPL ↓」「MMLU ↑」を置くと
  `geometry/label-collision` になった（run 2）。
- `label` は枠（`plain` のコンテナ）の内側に入り、枠に余白が残る。辺は見えない余白の端で止まり、行列の手前の
  何もないところで終わった（run 3。回避策は別の label ノードと `flush`）。
- `variant: muted` のセルは box の muted と同じ（sumi では濃紺の枠、`tone: gray` なら塗りも tinted と同じ）で、
  淡くならない（run 1・6）。淡くするには `themeOverrides.tones.gray` が要った。
- 表は全セルを枠で囲み、図の中で最も重い。論文の表のような罫線だけのスタイルがない（run 2）。
- `themeOverrides.tones.gray` で淡くした灰色（線 #a3a8b4、OKLCH の彩度 0.018）が、`geometry/theme-color-use`
  で 4 つ目のアクセントに数えられた（run 1）。

## 決定

すべて `matrix` の props の追加で、既定の出力は変えない（`muted` のセルと color-use の判定を除く。互換性の節）。

- **`labelAt: top | above-left | above | above-right`**（省略時 `top` = 今までどおり枠の内側）。`above*` は
  枠グループの `labelAt`（#517 の枠の外のタイトル）にそのまま渡し、枠の余白をなくす（`flush` と同じ。
  `MatrixExpansion.flush`）。辺は見出しとセルの外接矩形で終わる。`above-left` / `above-right` のタイトルは
  余白のない枠の端に揃える（エンジンの `#groupLabelCenter` で、`flush` の matrix の枠だけ横の inset を 0 に）。
  `flush: true` とタイトルの併用は、`labelAt: above*` のときだけ許す（今までどおり内側のタイトルとはエラー）。
- **`wrapHeaders: true`** で見出しを語の境目で折り返す。列の見出しはセル幅（または **`columnHeaderWidth`**）、
  行の見出しと corner は `headerWidth`（指定したときだけ）。幅はフォントが決まる IR で測る
  （`MatrixPartExpansion.wrap` に pt で記録し、`wrapWords()` で折り返す）。`wrapBubbleText()`（bubble 用）は
  収まらない語の中で切るが、見出しで「MML / U」と切れるより少しはみ出す方が読みやすいので、語の中では切らない
  別の関数にした。日本語は `Intl.Segmenter` の語の境目で切り、閉じ括弧などを行頭にしない。
  折り返した列の見出しは高さが揃わないので、セルの側に揃える（上なら `align: end`）。`wrapHeaders` のないときの
  配置は変えない。`columnHeaderWidth` は `wrapHeaders` が必要（`component/invalid-prop`）。見出しの箱はセル幅の
  まま（列の中央に置くため）で、広い折り返し幅の文字は列の間の gap にはみ出す。
- **`rules: true`** は論文の表: セルの枠をなくし（`doc.paints` の `borderless`。塗りと文字は残す）、表の上下と
  列の見出しの下に `sumi/separator`（`solid`）の罫線 `<matrix>-rule-top` / `-rule-mid` / `-rule-bottom` を置く。
  中の罫線は線幅の半分（`thin`）。separator は自分の入った stack の幅いっぱいに引かれるので、行の見出しの下まで
  届く。罫線と文字の間は `headerGap`。凡例の見本は枠を残す（枠のない default のセルの見本は見えないため）。
  separator を辺の端点にできない検査は、展開された部品の場合に matrix の ID で誤検出していたので、要素自身の ID で
  見るようにした。
- **`muted` のセルを淡く**: セルとその凡例の見本に `doc.paints` の `pale` を付け、テーマの段で `paleStyle()` を
  掛ける。塗りはキャンバスへ 50% 寄せ、枠（とハッチ）はキャンバスに対するコントラストが 2.5:1 になるまで、文字は
  新しい塗りに対して 3:1 になるまで寄せる（1% 刻みで決定的）。2.5:1 は `geometry/low-stroke-contrast` の
  輪郭の基準 2:1 より上で、sumi のパネル（#efeddd）の上でも 2:1 を保つ。テーマごとの色を足さず、どのテーマでも
  （暗いキャンバスでも）同じ規則で淡くなる。box 全般の `muted` は変えない。
- **color-use**: tone `gray`（または tone なし）の塗りは、OKLCH の彩度 0.04 未満なら中立とする（今までは
  上書きされた色をすべての tone で 0.008 未満のときだけ中立とした）。sumi 自身の灰色の線 #4e566b が 0.036、
  灰色の塗り #e1dece が 0.022 なので、図が淡く・濃くした灰色（上書き、淡いセル）はアクセントに数えない。
  灰色をはっきりした色相（例 #3060c0）で塗った場合は今までどおり数える。

## 採らなかった案

- **`labelAt: above` を既定にする**（#603 の review の提案）: タイトル付きの matrix の出力がすべて変わる。
  既存の図を変えないため opt-in にし、Skill で「辺が向かう matrix には `labelAt: above`」と案内した。
- **列の見出しの箱をセルより広くする**: 見出しの行と セルの行の幅が変わり、`end` / `start` 揃えでは列の中央に
  来ない。grid に組み替えると既存の配置が変わる。折り返し幅だけを広げ、箱はセル幅のままにした。
- **淡いセルをテーマの `dim` の色で描く**: sumi の `dim` は線も文字も #4e566b で淡くならない。
- **box 全般の `muted` を淡くする**: 多くの例と再現図が変わる。#612 は matrix のセルに限る。
- **見本も罫線スタイルで枠なしにする**: default のセルの見本が白い四角になり見えない。

## 互換性

- 新しい props は省略時に今までどおり。`docs/gallery/` と `examples/` の SVG・PDF は変わらない（`bun run gallery`
  で変わったのは matrix の props の説明の 2 ファイルだけ）。再現図のソース（reproduction hash）は変えていない。
- 出力が変わる図（意図した変更）: `muted` の class を持つ Skill のベースレイアウト 2 枚。
  - `skills/sumi/layouts/feature-table`（「not supported」のセルと見本が淡い灰色に）
  - `skills/sumi/layouts/projected-planes`（「low」のセルと見本が淡い灰色に）
  どちらも lint の結果は変わらない（feature-table は 0 件、projected-planes は既知の `color-on-panel` の info 2 件）。
- `geometry/theme-color-use` は、淡い・濃い灰色の上書きを数えなくなる分だけ info が減ることがある。既存の例・
  ギャラリー・lint の golden で変わったものはない。
- 予約 ID に `<matrix>-rule-top` / `-rule-mid` / `-rule-bottom` が加わる（`rules: true` のときだけ使う）。
