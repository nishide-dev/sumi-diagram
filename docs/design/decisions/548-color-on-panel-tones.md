# #548 `geometry/color-on-panel` を tone 間でそろえる

## 背景

#539 で、`geometry/color-on-panel` が緑のパネルでは出て、同じ使い方の青のパネルでは出なかった。再現: `theme: sumi` で、グループ（パネル）に同じ tone の `filled` の箱を 3 つ置く。パネルが `gray` でも、箱と同じ tone でも、red・orange・yellow・green では出て、blue・purple・pink では出なかった。

比べていた値は、要素自身の色（`filled` は塗り）の OKLCH 彩度と固定のしきい値 `COLORED_CHROMA` = 0.025 だった。sumi の淡い塗りの彩度は gray 0.022、red 0.028、orange 0.029、yellow 0.040、green 0.029、blue 0.012、purple 0.019、pink 0.020。blue・purple・pink は、パレットの設計上、彩度が低いために「無彩色」扱いになった。しきい値の境目ではなく、tone の定義と彩度の判定のずれである。

## 決定

- ノードが書いた tone（`ElementIR.tone`、#513 で追加）を `PaintItem.tone` に持つ。`gray` 以外の tone を書いたノードは、彩度が `TONED_CHROMA` = 0.008 以上なら色付きとする。tone を書かないノード・`gray`・set は従来どおり彩度 0.025 以上。
- 0.008 は `geometry/theme-color-use` の `NEUTRAL_CHROMA` と同じで、白（0）やテーマの無彩色のインク・塗りは入らない。そのため、白い `outlined` の箱が色付きのパネルに載っても数えない（paper・color・llama・sumi・academic で、パネルが blue・green・gray の場合を確かめた）。
- パネルの色や tone には依存しない。パネルと同じ tone の箱でも、gray パネルの上でも、全 tone で同じ結果になる。

## 採らなかった案

- 彩度のしきい値を下げる: gray の暖かい灰色（sumi の gray は 0.022）を拾う。
- パネルとの色相・彩度の距離で判定する（最初の実装）: パネルと同じ tone の箱では距離が 0 でそろわず、色付きのパネルでは白い箱まで色付きになった。レビューで見つかり、取り下げた。
- 違う理由を文書にするだけ: 青は見た目に緑と同じく色として読めるので、説明がつかない。

## 互換性

info の診断で、SVG の出力は変わらない。examples・docs/assets・skills/sumi/layouts の全図で `color-on-panel` の件数を変更前と比べ、変わらなかった。パネルに blue・purple・pink（sumi 以外のテーマでは同様に彩度の低い tone）の箱が 3 つ以上載る図で、新たに出ることがある。
