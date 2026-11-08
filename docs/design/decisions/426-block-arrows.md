# #426 段階の間に置くブロック矢印・三角・山形

## 背景

論文の図やスライドでは、段階と段階の間に太い矢印（➡︎）や三角（▶︎）を置いて流れを示す
（TriCL の Figure 1、hypergraph の原図）。Sumi の矢印は辺の矢じりだけで、「形としての矢印」がなく、
細い辺で代用すると流れが弱く見えた。

## 決定

- 部品は3つ。`sumi/block-arrow`（軸と頭を持つ太い矢印）、`sumi/triangle-arrow`（塗りの三角）、
  `sumi/chevron`（山形）。`since: 0.16.0`、structured のみ（`engines: ["structured"]`）。
  row・stack・`place` の項目として普通のノードのように置く。
- 描画は1つの輪郭レンダラ `sumi/flow-arrow`（`labelless`）にまとめ、manifest が `form`
  （`block` / `triangle` / `chevron`）を固定する。向きは右向きの局所座標で形を作り、
  `direction` で写す。閉じた1本の polygon なので SVG・PDF・picture PPTX は既存の経路のまま、
  新しい backend は増えない。
- props。`direction: right|left|up|down`（既定 right）、`length`（矢印の軸方向。向きによらない）、
  `thickness`（軸と直交方向）。block-arrow は `head`（頭の長さ。短い辺に対する比、0.1〜1、既定 0.5）と
  `shaft`（軸の太さ。thickness に対する比、0.1〜0.9、既定 0.5）、chevron は `head`（先端の深さ。同じ比）。
  `length` / `thickness` は 0.5pt の倍数の長さ。`head` / `shaft` を「短い辺に対する比」としたのは
  PowerPoint の preset（`rightArrow` の adj2 は短い辺 ss に対する比）とそのまま対応させるため。
- 既定の大きさはテーマの文字サイズ（em）の倍数で、紙面の大きさで読める。太さは 1 em、長さは
  block 1.6 em、triangle 0.9 em、chevron 0.7 em。コンパイラが `style.fontSize.units` を `em` として
  輪郭の params に渡す（bubble の radius と同じ手法）。labelless なので footprint は 1x1 の仮ラベルを
  無視して `length` × `thickness`（上下向きは入れ替え）を返す。
- 見た目。既定は線の色（文字色。tone を付けると tone の線色）で塗り、枠なし。`muted` は灰色の塗り
  （各テーマの muted の線色。llama は `color.muted`）、`outlined` は枠線だけ（ページ色の塗り）。
  variants は `default` / `muted` / `outlined` の3つ。既定の「塗りと枠を同じ色にして線幅0」は
  テーマ定義の層ではなく `resolveStyle` で決める（`flowArrowStyle`）。層は枠の太さを `outlined` と
  共有するため、既定の層に線幅0を置くと outlined の枠も消える。全組み込みテーマで警告なしに解決する。
- 辺の端点にはしない（流れを示す印）。辺の `from` / `to` に使うと `component/flow-arrow-connection`
  （error）。`attach` はできる。label・labelRotation・sublabel・badge・glyphs・`grow` は他の
  無ラベル部品（bracket / separator）と同じ診断で拒む。`lint/empty-label` は出さない。
  幾何 lint は形として扱うので、他の辺が矢印を横切れば `edge-through-node` を報告する。
  輪郭は凸包を衝突領域とする既定のまま（chevron の切れ込みは保守的に埋まる）。
- structured の既存の挙動をそのまま使う。outline 部品は `align: stretch` の対象外・main 軸の成長なし
  のため、矢印は引き伸ばされず、`align: center` で行の中央に置かれる。
- 輪郭契約の `safeArea` は、本体の内側であることを検査される。ラベルがないので軸上の小さな正方形
  （shaft・head は軸方向の1/4、chevron は帯の中央）を返す。頭が長さいっぱいのブロック矢印は
  軸が消えるので三角形として描く。chevron の先端の深さは長さの0.8倍までに丸め、帯の幅を残す。
- editable PPTX は PowerPoint の preset を使う: `rightArrow`（adj1=軸の太さ、adj2=頭の長さ）、
  `triangle`、`chevron`（adj=深さ）。上向きを基準とする triangle 以外は右向きが基準で、
  `flipH` / `flipV` と `rot` を `xfrm` に付ける。回した図形は縦横を入れ替えた箱を同じ中心に置く。
  adj は丸め後の実際の寸法から計算するので、SVG と同じ形になる。枠線の結合は SVG 既定の miter。

## 採らなかった案

- 辺の端点にも使えるようにする案: 流れの印であり、接続点と混同する。本物のノードをつなぐ方が
  図の意味が保たれる（separator と同じ判断）。
- 1つの部品に `form` を持たせる案: カタログの部品名がそのまま用途（`block-arrow` など）になる方が、
  Skill と利用者にとって探しやすい。レンダラは共通にした。
- auto（D2）対応: D2 は段階の間の並びを制御できない。row / stack / place の中で使う部品なので
  structured のみとした。
- 既定を tone の塗り（淡い色）にする案: 参照図は黒の太い矢印で、`solid` の箱と色が揃う方が自然。
  淡い色は `muted` と tone で得られる。
- tinted / solid / emphasis の variant: 矢印の既定が solid 相当のため重複する。必要になれば追加する。

## 検証と互換性

- 4方向×3形の輪郭契約（閉じた polygon・footprint に収まる・先端の位置・極端な縦横比と head / shaft）、
  既定寸法と明示寸法、head / shaft の比、パラメータの範囲を単体テストで固定した。
- 全テーマ×3形×variant×tone の解決、診断（label・badge・glyphs・grow・辺の端点・engine）、
  `lint/empty-label` が出ないことを registry のテストで固定した。
- 全テーマ×3形×4方向を実際に描画し、寸法が em の倍数であること、パネルの間で行の中央に
  あること、幾何 lint・経路検査が通ること、PDF と picture PPTX が出力できること、
  editable PPTX が preset と `rot` / `flip` を持つことを検査した。stack と `place` の例も含む。
- ギャラリーに3部品を全テーマで追加した（`bun run gallery`）。PDF・PPTX の golden は
  文書化されたコマンドで再生成し、追加分のみが変わった（既存の hash は不変）。
- `.sumi/preview/flow-arrows.pdf` を `pdftoppm -png` で開き、参照図（TriCL の ➡︎、hypergraph の原図の ▶︎）と
  見比べた。パネルの中央に矢印が置かれ、太さ・長さが読めることを確認した。llama では既定が薄い灰色に
  なっていたため、塗りを枠線の色ではなく文字色にした。
- 互換性。リポジトリ内の `*.sumi.yaml`（research/ と非公開の図を除く116図）を自テーマ＋全組み込みテーマで
  描画し、SVG・PDF・picture PPTX と D2 ソースの sha256 を変更前後で比較した（812組）。差分は0件。
  描画できない241組のエラーコードも一致。既存の図の出力は変わらない。
  変わる出力は、未知の node 部品の hint が列挙する部品一覧に3部品が加わることだけ
  （`tests/fixtures/lint-output/no-cascade.*`）。
