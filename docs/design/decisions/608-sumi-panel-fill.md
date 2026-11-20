# #608 sumi テーマのパネルを白にする

## 背景

`sumi` は何も指定しないグループと `muted` のグループを砂色（既定 #efeddd、`muted` は #e1d9bc）で塗っていた。figure-format.md は「`muted` は academic 以外で白」と書いており、実装と食い違っていた。また有彩色のノードを 3 つ以上入れるとテーマ自身の塗りで `geometry/color-on-panel` が出る一方、その hint の「パネルを白にする」を 1 か所で行う手段が示されていなかった（#603 の試用で 5 本）。#595 でキャンバスを白にした後は、白い紙の上の砂色のパネルが一層目立つ。

## 決定

- `sumi` / `sumi-dark` の既定のグループと `muted` のグループの塗りをキャンバスの色にする（`sumi`: 白、`sumi-dark`: 紺 #30364f）。枠（`muted` の灰色 1pt）と見出しは変えない。`paper` の既定（白いパネルと枠）と同じ考え方で、色は意味を持つ要素だけが持つ。
- 砂色は 1 段手間をかけて選ぶ。1 つのパネルなら `variant: filled`（#e1d9bc、従来どおり）、図全体なら `figure.themeOverrides.groupFill: "#efeddd"` で従来の既定パネルに戻る（`groupFill` は tone のないグループに効く既存の上書き）。
- `themeOverrides.canvas` で替えたキャンバスにもパネルは従う（クリーム色のキャンバスならクリーム色のパネル）。#595 の「クリーム色の上書きは #595 前の SVG とバイト一致」は成り立たなくなる。`groupFill: "#efeddd"` を足すと既定のパネルは戻るが、`groupFill` は `muted` と `filled` のグループにも効くため、それらの色（従来 #e1d9bc）までは戻らない。
- `geometry/color-on-panel` の hint は、示す変更で本当にパネルが白（キャンバス）になるかを確かめてから出す。図のテーマに上書き（キャンバス・パレット・tone）を適用したテーマで、変更後のグループの塗りを描画と同じ解決（`containerFill`: `resolveStyle` と `groupFill` の適用条件 `takesGroupFill`）で求める。
  - 試す順: tone を外す → 塗る variant を穏やかにする（`filled`→`default`、`filled-dashed`→`dashed`、`muted`→`default`）→ 両方。最初に白になるものを示す。
  - どれでも白にならなければ（既に白以外の `groupFill` がある、パレットがパネルを塗るテーマ）、`themeOverrides.groupFill` をキャンバスの色にするよう、現在の値（またはテーマのパネルの色）と共に示す。tone があれば tone を外すことも添える（tone は `groupFill` より優先される）。
  - 組み込みでないテーマでは解決できないため、一般的な hint に留める。
  - テストでは hint のとおりに YAML を直して再描画し、指摘が消えることを確かめる（tone・filled・filled-dashed・既存の `groupFill`・パレット・sumi-dark）。
- figure-format.md（Groups の既定の塗り、テーマ表、パレットの説明）、diagnostics.md、docs/themes.md、docs/lint-rules.md とテーマの説明文を実装に合わせた。

## 影響

- 出力が変わるのは `sumi` / `sumi-dark` で既定か `muted` のグループを描く図だけ。ギャラリー 12 枚（compare の pipeline 4、container・zoom・dim・strokes の各 2）と Skill のベースレイアウト 9 枚（actors-and-tools、agent-loop、encoder-block、layered-stack、nested-containers、pipeline-linear、projected-planes、stacked-planes、three-panel-flow）の SVG・PNG・previews.json を作り直した。
- 論文の再現図（examples/）は変わらない（色を固定しているため。reproduction-hashes は更新なし）。README の図は `plain` のグループだけなので変わらない。
- `lint --geometry` は Skill のベースレイアウト 30 件と README 図で `color-on-panel` の info が 7 件から 0 件になり、ほかの診断は変わらなかった。ギャラリーの `sumi-dark` では pipeline と strokes の `color-on-panel` が消えた。
- パレット: 白（キャンバス）は「紙」として塗り替えないため、`paper` と同じく `sumi` の既定のパネルはパレットでも白のまま。`filled` と `muted`（palette の soft）は従来どおり色が付く。

## 採らなかった案

- 文書と hint だけを実装（砂色）に合わせる: 白い紙に貼る図でテーマ自身の塗りが lint を出し続け、#603 の 5 本で同じ手直しが要る。
- 枠を `paper` のような細い明るい灰色（0.5pt）にする: 白いパネルではノードの枠と見分けやすくなるが、変更が大きく、レイアウトとコントラスト系 lint にも及ぶ。利用者の確認後に別 issue で検討する。
- `sumi-dark` は変えない: 紺のパネル #383f58 でも `color-on-panel` が出ており（ギャラリーの pipeline・strokes）、明暗で振る舞いを揃えるため同じ規則にした。
