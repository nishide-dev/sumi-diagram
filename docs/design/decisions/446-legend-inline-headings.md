# #446 凡例の見出しを同じ行に並べる（headings: inline）

## 背景

4 回目の論文図の試行（TriCL 型）では、凡例の見出し（Nodes:・Hyperedges: など）が必ず改行され（#409）、
論文の 1〜2 行にまとまった凡例（「Entity (paper) ▯　Title T　…　Initial feature ▯　…」）を書けなかった。
見出しのあるグループは、見出し列と項目の列の 2 列の表になり、表の幅が図の幅を決めた。
凡例が幅を決めていても、`geometry/exceeds-page-width` の内訳は「stack の幅」としか言わず、凡例が原因だと分からなかった。

## 決定

- 凡例の props に `headings: line | inline` を足す（既定は `line` = 従来の表）。`flow: row` でのみ使え、
  `flow: row` なしでは `component/invalid-prop`（`headings` の位置。`perRow` と同じ扱い）。
- `inline`: 表を作らない。見出しは、そのグループの最初の項目の直前（間隔は `textGap`）に置き、
  1 つの単位にする。グループを `entryGap` で隔てて同じ行に並べ、1 行は `perRow` 項目まで。`perRow` は項目の数で、見出しは数えない。
  改行は見出しの前に入れる（グループが 1 行に収まるなら割らず、グループごと次の行へ送る）。1 つのグループだけで `perRow` を
  超えるときに限り割る。その場合は見出しと、その行を並べた stack の 2 列の表にし、続きの行は見出しの幅だけ字下げする
  （ぶら下げインデント）。割ったグループの後は新しい行から始める。見出しのない先頭のグループも同じ規則に従う。
- 展開で作る部品・予約 ID・通し番号は変わらない。変わるのは arrange の木だけ。
- 診断: `geometry/exceeds-page-width` のヒントに、凡例の枠が他のどの最上位の要素よりも広いとき
  「Legend "<id>" sets the width of the figure (…)」と、`flow: row` と `perRow`・項目を減らす手を足す。
  新しい診断コードは足さない（既存のヒントの明示）。

## 採らなかった案

- 幅で折り返す: 構造化レイアウトの arrange は子の幅を測る前に木を決めるため、折り返しの位置を幅で決められない。
  `perRow` の数のまま（#409 の制限と同じ）。
- 見出しを折り返した行の先頭にも置く: 見出しは 1 回だけ読む。繰り返すと凡例が長くなる。
- `inline` を `flow` の値にする: `flow` は項目の向き、`headings` は見出しの置き場所で、別の軸。

## 互換性

`headings` を書かない凡例は、展開の木・出力とも変わらない。凡例を持つ全 `*.sumi.yaml`（research/ と非公開の図を除く）を、
自身の theme と全組み込み theme で変更前後に描画し、SVG・PDF・picture PPTX の sha256 が一致することを確かめた。
出力が変わるもの: JSON Schema には入らない（部品の props）。`sumi catalog` の legend の props と
ギャラリーの `sumi/legend` の props の表。`exceeds-page-width` のヒントは、凡例が幅を決める図に 1 文足される。
