# #385 ジャンクションの幹が曲がる角を緩やかに保つ

## 背景

`examples/transformer` の decoder 中段で、下の Add & Norm から出た線が hidden junction（`dec-split2`）を通り、
Multi-Head Attention の 3 つの入力（K・V は encoder から、Q は junction から）へ分かれる。
この分岐の角が、ほかの分岐より急に見えた。

測定（単位は 0.5pt、半径の上限は 8）:

- junction は積み重ねの隙間の中央、箱の下端から 14.67 の位置にある。矢じりの前の部屋（`arrowRoom()` = 矢じり 8 + 半径 8 = 16）の端が bus の行なので、
  bus は junction より 1.33 だけ箱から遠い。
- 幹は junction まで上がり、Q の線がそこから 1.33 だけ戻って bus へ曲がる。角の脚が 1.33 しかなく、半径が 1.33（0.67pt）に切り詰められ、
  junction の上に 1.33 のとげも出ていた。
- encoder の入力の分岐も位置関係は同じだが、幹が中央の入力へまっすぐ通り抜ける T 字なので、1.33 の丸みは目立たない。幹が曲がる分岐だけが急に見えた。
- bus から矢じりへ上がる角は 4（部屋 16 から矢じり 8 を除いた脚 8 の半分）。encoder と同じで、2pt の幹が残る。

原因は bus の高さの選び方ではなく、junction が bus の行からずれていること。半径の上限の式と矢じりの直線部分の確保は正しい。

## 決定

- ルーターの前処理 `junctionsOnBus`（`routeEdges` の先頭）: hidden junction に、矢じりのある辺が横から来ていて、junction が矢じりの部屋の中
  （`矢じりの長さ <= ahead < room`）にあるとき、junction を矢じりの向きに `room - ahead` だけ動かし、bus の行（部屋の端）に載せる。
  幹は junction でそのまま bus へ曲がる。bus の高さと矢じりの角は変えない。
- 動かすのは hidden junction だけ。ノードは動かさない。動かす向きは矢じりの向きの一本だけ。次の場合は動かさない。
  - junction の真正面に同じ辺の矢じりがある T 字（幹が曲がらない）、辺ごとに動かす量が違う、junction どうしが辺でつながる。
  - ほかの端が動かした後に半径（8）以上離れない、動かす線に近く並んだ（`STRAIGHT_MARGIN` 以内の）ポートがある。
  - 動かす軸が `layout.align` または arrange の `centerOn` で拘束されている。座標配置の直接の項目も動かさない。
  - junction 自身が attach されている、または junction に attach されたノードがある。接触していなくても配置関係を保つ。
  - straight / curve / zoom の辺が接続している。これらは直交 bus の移動要求を作らない。混在時も直接経路の端点・接線などの条件をここでは検証できないため、junction を動かさない。
  - junction の長方形を移動中も含めて覆う swept rectangle が、ほかのノードの外接長方形（線幅を含む）、グループ境界、タイトル、背面カードの障害物と接触する。
  - 移動前に入っていたグループの前面長方形に swept rectangle 全体が収まらない。親グループについては必ず四辺を検査し、北・西への脱出や中心だけが内側にある移動も拒否する。
  - 接続端や親グループなど必要な情報を解決できない。判断が不確かなときは配置済み位置を保持する。
  - 先に採用した junction の swept rectangle と交わる（複数の移動同士の衝突も防ぐ）。
- 動かした後の幹の角は junction の弧で、半径は幹の長さの半分（13.33 / 2 = 6.67）。幹の長さの全部を使うには junction の弧の上限（隣の角に半分を残す規則）を
  外す必要があり、ほかの図に影響するので、この issue では行わない。
- 診断は足さない。矢じりの角は変わらず 4 で、`arrowhead-cramped` / `arrowhead-on-bend` の条件にも触れない。

結果（transformer, 単位 0.5pt）: 幹の角 1.33 → 6.67、矢じりへの角 4 → 4（変更なし）、bus の高さは変更なし、junction のとげは消える。

## 採らなかった案

- 矢じりの部屋を junction の行で終える: bus が箱に近づき、矢じりの角が 2.67 に小さくなる。
- 例の YAML の gap を広げる: 原因は junction の位置なので、図ごとの回避にしない。

## 互換性

リポジトリの全 `*.sumi.yaml`（research/ と非公開の図を除く）を、図自身のテーマと built-in 5 テーマで render し、SVG と診断出力のハッシュを比べた。
変わるのは `examples/transformer`（`skills/sumi/examples/transformer` は同じ内容）と `tests/fixtures/figures/compact/a-transformer`（変種）だけ。
encoder の分岐、masked 分岐などの T 字は動かないので変わらない。

## レビュー後の制約保護

配置の solve 後に junction を動かすため、配置だけを試す alignment hint では回帰を検出できなかった。
transformer に `align: [{ y: [dec-split2, enc-split2] }]` を加えた再現では 345.039 が 346.366 に変わり、
`stack.centerOn: j` の再現では中心が 59.5 から 65 に変わっていた。回帰テストは `routeEdges` の最終結果で等式と元の座標を確認する。
`dec-split2` の南に gap 0 の 2pt × 1pt ノードを attach した再現では、移動により発生していた 3 件の `layout/no-route` がなくなり、attach 関係も保持される。
padding 0 の検証済み profile と 5pt の外部ターゲットの再現は北・西とも脱出しない。
7pt の上向き stack の直線・曲線辺は bus を要求せず、混在する直線・曲線・zoom 辺も端点を保持する。

レビュー修正は安全性が証明できる範囲だけの最適化とする。制約付き配置を再 solve して他の要素を移動する案は採らない。
ノードの外接長方形による衝突判定は、非矩形の空いている角でも移動を見送ることがあるが、配置の契約を優先する。
回帰テストは移動のガードを無効化すると失敗することを確認した。障害物は到着点だけでなく移動途中に置き、ノード・別グループ・タイトル・背面カードを個別に検査する。

レビュー修正前後の互換性比較は既存 101 YAML × 6 テーマ設定（自身のテーマ + built-in 5 テーマ）の 606 通り。
SVG / PDF / PPTX / D2（生成される場合）の SHA-256 はすべて一致した。402 通りは描画成功、204 通りは不正入力・空図・未登録のテスト用部品などで前後とも出力なし。
research/ と非公開の図は除外した。既存の transformer の改善は維持され、今回追加の golden 更新は不要。
transformer と alignment・attach 障害物・`centerOn`・straight・curve の再現は CLI の PDF 出力を `pdftoppm -png` で画像化して確認した。
