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
  - 動かした位置が親グループの外になる。
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
