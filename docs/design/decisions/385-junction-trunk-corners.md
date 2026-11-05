# #385 ジャンクションの幹が曲がる角を緩やかに保つ

## 背景

`examples/transformer` の decoder 中段で、下の Add & Norm から出た線が hidden junction（`dec-split2`）を通り、
Multi-Head Attention の 3 つの入力（K・V は encoder から、Q は junction から）へ分かれる。
この分岐で、幹が横線（bus）へ曲がる角が、ほかの分岐より極端に急に見えた。

測定（単位は 0.5pt）:

- junction は箱の下端から 14.67 下にある。矢じりの前の「部屋」（`arrowRoom()` = 矢じり 8 + 半径 8 = 16）の端が bus の行になるので、
  bus は junction より 1.33 下を通る。
- 幹は junction まで上がり、そこから Q の線が 1.33 だけ下がって bus へ曲がる。つまり幹の角の脚が 1.33 しかなく、
  半径が 1.33（0.67pt）に切り詰められていた。しかも junction の上に 1.33 のとげが出ていた。
- encoder の入力の分岐も junction と bus の位置関係は同じだが、幹がまっすぐ中央の入力へ通り抜ける T 字なので、
  1.33 の丸みは目立たない。幹が曲がる分岐だけが急に見えていた。
- 矢じりへ上がる角は両方とも 4（2pt）。矢じりの長さ 8 を除いた脚 8 の半分で、`arrowhead-cramped` の 2pt の幹がちょうど残る。

原因は「bus の高さの選び方」。部屋の端という固定の行が junction を 1.33 だけ越えるため、半径の上限が脚の長さで決まっていた。
半径の上限の式（脚の半分、矢じりの直線部分の確保）自体は正しい。

## 決定

- ルーター（`#clearJunctionTurns`, `junctionBusRoom`）: 矢じりの端 `end` に対し、hidden junction が横にずれて部屋の中（`lane + 半径/2 <= ahead < room`）にあるときは、
  その矢じりの部屋を junction の行（`ahead`）で終える。bus は junction の行を通り、幹は junction で bus へ曲がる（脚は幹の長さの半分、ここでは 7.3）。
  同じ箱の同じ辺に入るほかの矢じり（K・V）も同じ部屋にそろえ、bus を 1 行にする。
- junction の真正面に同じ辺の矢じりがある T 字（幹がまっすぐ通り抜ける）は対象外。出力を変えない。
- 書き出し（`wire.ts`, `structured.ts`）: 矢じりの端の角は、矢じりの直線部分に加えて 2pt の幹（`ARROWHEAD_STEM_UNITS`）が残る半径までにする
  （`stemStart` / `stemEnd`）。部屋が 16 のときは従来の「脚の半分」と同じ 4 なので変わらず、部屋が短いときだけ半径が小さくなり、
  `geometry/arrowhead-cramped` を出さずに済む。
- 診断は足さない。junction の行まで寄せた結果、矢じりの角は 2.67 になるが、幹は 2pt 残るので `arrowhead-cramped` の基準を満たす。
  空間が足りない場合の既存の診断（`geometry/arrowhead-on-bend`、`geometry/arrowhead-cramped`）はそのまま働く。

結果（transformer, 単位 0.5pt）: 幹の角 1.33 → 7.3、矢じりへの角 4 → 2.67（K・V・Q とも）、bus は 3 本とも junction の行。

## 採らなかった案

- bus を junction の下へ 8 以上離す: 幹が junction まで上がって折り返すので、junction の上に 8 のとげが出る。
- 例の YAML の gap を広げる: ルーターが junction の位置を見ていないことが原因なので、図ごとの回避にしない。
- 矢じりの角の半径の「脚の半分」を最後の脚で外す: 多くの図の角が変わる。この issue の範囲を超える。

## 互換性

リポジトリの全 `*.sumi.yaml`（research/ と非公開の図を除く）を、図自身のテーマと built-in 5 テーマで render し、SVG と診断出力のハッシュを比べた。
出力が変わる図は次の 3 つ（`own` と `paper` / `academic` で変わるもの。`minimal` `slides` `color` は junction の位置が条件に合わず変わらない）。

- `examples/transformer`（`skills/sumi/examples/transformer` は同じ内容）と `tests/fixtures/figures/compact/a-transformer`（同じ図の変種）: 上の修正。
- `tests/fixtures/figures/layout/arrowhead-room-jog`: 矢じり前の脚が短く、角が 2pt の幹を残さなかった（`arrowhead-cramped` の info が出ていた）。幹を残す半径に小さくなり、info が消えた。

ほかの図の SVG と診断出力は変わらない。
