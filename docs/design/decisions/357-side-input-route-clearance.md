# #357 centerOn の側入力を通る主経路の辺

## 背景

全幅の図の確認で、`direction: up` の `centerOn` stack に置いた object queries
（tokens とラベル）の領域を encoder → decoder の辺が通ったのに診断が出なかった。
#350 の `centerOn` は側入力の幅を予約するが、別の row から入る辺の端点は考慮していなかった。

## 再現と原因

同じ row の中の辺は、上下の stack・align・ラベルの置き方・`fanIn`・`route:
straight` を 1344 通り試しても再現しなかった。再現したのは、外側の stack の
2 つの row のうち上の row に encoder があり、下の row（`direction: left`）の
先頭に `centerOn: decoder` の stack（`direction: up`、項目は decoder・queries・
ラベル）がある図である。encoder と decoder は別の row にあるので、既定の端点の側を
決める `arrangeSides` は共通の箱（外側の stack）の順序から decoder の north を
選ぶ。north は側入力が占める面で、そこにはすでに queries が入る。

ルーターは tokens とラベルを障害物として扱っており、通り抜けてはいなかった。
代わりに、north の入口に向かって側入力の外側をぐるりと回り、最後の区間で
queries の辺と同じ線に重なった。ラベルすれすれの迂回で、かつ重なりは
ファンインの合流（共有の幹）として許されるため、`edge-crosses-label`・
`edge-through-node`・`edge-near-edge` はどれも報告しなかった。

## 決定

`resolveEnds` の既定の端点（アンカー未指定）で、端点の要素が `centerOn` の
基準であり、選んだ側が兄弟項目（側入力）のある側で、相手の端が兄弟の外にある
ときは、その側を使わず直交する 2 辺から選ぶ。空きが大きい方（辺の先に最も近い
他のノードまでの距離）を優先し、同じなら相手の中心に近い方を選ぶ。アンカー、
`straight`、`fanIn: spread` の位置、兄弟どうしの辺は従来どおり。側入力が
占める面を主経路が使わないので、迂回と合流が起きない。診断は増やさない。

この変更の範囲は `centerOn` の基準だけで、一般のノードの既定の側は変えない。

## 採らなかった案

- 迂回した経路を検出して新しい診断を出す: 原因（端点の側の選択）を直さず、
  作者に毎回 `toAnchor` の指定を求める。
- 全ノードで障害物の前の側を避ける: `centerOn` を使わない既存の図の出力が変わる。

## 互換性と検証

`centerOn` の基準でない端点、同じ row・stack 内の辺、アンカー指定の端点は
変更しない。リポジトリの全 `*.sumi.yaml`（research/ と c-h3world を除く 103
ファイル）を自身のテーマと組み込み 5 テーマの 618 条件で変更前後に描画し、SVG の
SHA-256（失敗は診断コード）を比較して差分ゼロだった。回帰試験は
`src/layout/structured/side-input-routes.test.ts`（上下左右、別 row からの辺、
修正なしでは失敗する）。
