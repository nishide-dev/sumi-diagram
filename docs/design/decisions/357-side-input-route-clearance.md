# #357 centerOn の側入力と主経路の辺の確認

## 背景

全幅の図の確認で、`direction: up` の `centerOn` stack に置いた object queries
（tokens とラベル）の領域を encoder → decoder の辺が通ったのに診断が出なかった、
という観察が 1 件あった。#350 の `centerOn` は側入力の幅を予約するため、
主経路の辺が側入力を通ることは設計上ないはずで、まず再現を試した。

## 再現の結果

再現できなかった。次の組み合わせを自動で 1344 通り（上下の stack 方向、row の
align 3 種、エンコーダの高さ 2 種、ラベルの置き方 7 種、項目順、gap、`fanIn:
spread`、`route: straight`）描画し、主経路の辺が tokens とラベルの矩形を通る
のに診断が無い図を探した。見つかった数件は、すべて明示的な `route: straight`
（ルーターが障害物を避けない指定）で、矩形の判定の誤差とみられ、実際の
交差は確認できなかった。通常の経路では次のとおりだった。

- ツリーに置いたラベルは stack が幅を予約し、辺は隙間を通る。
- `attach` したラベルは経路の障害物になり、避けられない場合は
  `layout/no-route`（error、位置つき。障害物の `attach` 先を示す hint つき）で止まる。
- `route: straight` は既存の `geometry/edge-crosses-label` が警告する。
- row の `direction: left` / `right` と縦の主経路でも同じだった。

エージェントの図は、1 回の観察にとどまり、入力も残っていない。おそらく
`attach` したラベルが経路を塞いだ時点で出る `layout/no-route`、または
`route: straight` を使っていた可能性があるが、確認できていない。

## 決定

エンジンは変更しない。原因の見つからない挙動を推測で変えると、`centerOn` を
使わない既存の図の出力を壊す危険があるため。代わりに、上記の保証を回帰試験
（`src/layout/structured/side-input-routes.test.ts`）として固定する。

主経路の辺が側入力（tokens の各セルとラベル）の矩形を通る図は、位置つきの
診断（`geometry/edge-crosses-label` など）を持つか、描画が位置つきの error で
止まることを検査する。方向（上下左右）、align、ラベルの置き方、`fanIn`、
`route: straight` を組み合わせる。

## 互換性

実装を変えないため、既存の図の出力は変わらない。再現する図が見つかった場合は
#357 に最小の YAML を添えて追記する。
