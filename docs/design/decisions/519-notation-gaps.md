# #519 状態遷移の記号・破線の箱・塗り付き破線のグループ・textAlign

## 背景

#509 の手順 B の再現で、下絵（HTML）にある要素が Sumi で代用なしでは描けなかった。
このPRは、そのうち不具合 2 件と、開始・終了の記号、箱の `dashed`、グループの塗り付き破線を扱う。

## 決定

- 平行四辺形への矢印。再現できなかった。ポートは外接矩形の辺の上に置かれるが、`ports.ts` が
  その点から内向きに輪郭（`shapeOutline`）まで動かして経路の端にする。6A の下絵と同じ配置で
  確かめると、矢じりの先は斜めの辺の上（高さの中央）で止まっていて、矢じりは辺の外側にある。
  矢じりの縁と辺の角度が小さい（約 25 度）ため辺に寄って見えるだけで、重なってはいない。
  菱形・六角形・楕円も輪郭で止まる。回帰テストで、平行四辺形・菱形・六角形・楕円への辺の端が
  輪郭上にあることを固定した。見た目の寄りは別の課題として残す。
- `textAlign: left | right`。固定幅のラベルで効かなかったのは、文字ブロックを常にノードの中央に
  置き、`textAlign` はその中の行揃えにしか使っていなかったため。幅が文字より広い矩形のノード
  （box・square・label。外形を持つ部品は除く）では、ブロックごとノードの内側の余白に寄せる。
  幅がちょうど文字のノードは位置が変わらない。回転ラベルと下付きのキャプションは対象外。
- `dashed`（箱）。`box` など塗りのある形（`FILLABLE_NODE_VARIANTS`）と `stack` に variant を
  追加した。既定の塗りに破線の枠を付けるだけで、tone は塗りを決める。テーマ定義は
  `componentStyles` が全テーマに同じ `dashed` の層（`strokeDash: {dash.regular}`）を足す。
- グループ `filled-dashed`。`filled` の塗りと `dashed` の破線の枠を併せ持つ。層は各テーマの
  `container.filled` と `container.dashed` から `componentStyles` で作るので、テーマごとの定義は
  増えない。
- 開始・終了の記号。`sumi/initial`（塗りの点）と `sumi/final`（輪を持つ点）の2部品、
  1つの輪郭レンダラ `sumi/state-marker`（`labelless`、manifest が `kind` を固定）。
  輪郭は円を 48 角形で近似した閉じた polygon で、辺はその輪郭に付く。ラベルは取らない
  （`component/unexpected-label`）。既定の直径は文字サイズの 1.25 em（initial）・1.75 em（final）で、
  `props.size` で変えられる。junction の点（線幅の 3 倍）では小さすぎたため、点の仕組みとは分けた。
  色は `solid` の塗り（ink）で、variant は `default` のみ（muted は sumi テーマで既定と同色になるため置かない）。枠線は引かず塗りだけで描く（線が径を広げ、final の輪と点の隙間を埋めるため）。最小の直径は 6pt。
- `filled-dashed` の枠色は `themeOverrides.dashedGroupStroke` が `dashed` と同じく優先する。破線の枠は塗りがあっても `low-stroke-contrast` の検査対象にする。

## 後続

- ラベルの太さ・色をテーマの文字の役割から選ぶ案、ループを表す曲線の矢印は別の課題。
