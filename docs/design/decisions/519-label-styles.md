# #519 ラベルの文字スタイルと自己ループの曲線

## 背景

#509 で、エージェントが行の見出し・手法名を太字にする、名前の下に小さい灰色の副題を置く、「L×」を大きくする、を Sumi でできず、html ノードで代用した。ループを表す曲線の矢印もなかった。

## 決定（A: 文字スタイル）

- 自由なフォントサイズ・色は与えず、テーマの文字の役割から選ぶ。ノードに `text: small | body | heading | large`、`weight: regular | bold`、`sublabelInk: default | muted`（structured のみ。auto は `layout/structured-only`）。
- `text` はラベルの大きさ。`small` はテーマの小さい文字（辺ラベルの `base.edge.fontSize`。ノード本文より大きくならない）、`body` は variant の大きさ（既定）、`heading` はグループ題の大きさ（`base.group.fontSize`。本文より小さくならない）、`large` は本文の 1.5 倍（0.5pt 単位で丸める。「L×」のような反復の印用）。`textScale`（#514）後のテーマから引くので、倍率に追従する。sumi テーマでは 7 / 8 / 9 / 12pt。
- `weight` はラベルの太さを variant の `bold` に代えて決める。`weight` を書いたノードの sublabel は常に標準の太さにする（太字の名前の下の通常の副題）。書かないノードは従来どおり sublabel がラベルと同じ太さで、既存の出力は変わらない。
- `sublabelInk: muted` は sublabel をテーマの muted 色（`sumi/label` の muted variant の文字色。chat の注記と同じ出所）で描く。ノードの塗り（なければキャンバス）の上で 4.5:1 に満たないとき（solid・emphasis などの濃い塗り）は、塗りに合わせて選ばれたラベル色を塗りへ 35%・25%・15% 寄せた色（4.5:1 以上）にし、それも無理ならラベル色にする。dim されたノードでは dim の文字色に従う。sublabel のないノードは `component/sublabel-ink-without-sublabel`（警告）。
- 実装は解決後のノード style に載せる。`text` と `weight` は `fontSize` / `bold` を置き換えるだけなので、配置・SVG・PDF・編集可能 PPTX・text-too-small・profile の最小サイズ・label-overflow は新しい経路なしで正しい大きさを測る。sublabel の差分だけは `NodeStyle.sublabel`（`bold`、`fontColor`）に持たせ、`sublabelTextStyle()` を配置・輪郭伸長・描画が共通に使う。sublabel の大きさはラベルの大きさの 7/8 のまま。
- 見送り: 任意の `fontSize`・`color`、グループ・辺ラベルの `text`（グループは `groupLabelWeight` がある）、sublabel の `text`。

## 決定（B: ループ）

- 既存の `route: curve`（#366）を、自分自身への辺で使えるようにする。新しい項目は増やさない。ノードの一辺から出て同じ辺へ戻る三次ベジェ 1 本で、既定は北辺の 0.7 から出て 0.3 に入る（時計回り）。`fromAnchor` / `toAnchor` で辺と両端を選ぶ（同じ辺の別オフセット。片方だけなら他方は 1 − オフセット）。高さは辺の文字サイズの 2.25 倍（制御点は 3 倍の高さで、三次ベジェの頂点はその 3 / 4）。ラベルはループの外側（時計回りなら接線の右）に置く。矢じりは終端接線で向く。
- 円・菱形などは両端をバウンディングボックスの辺上の位置から中心へ投影して輪郭に置く（`route: curve` の明示アンカーと同じ）。
- 二つのノードの間の戻り矢印は、既存の `route: curve` に同じ辺のアンカーを指定する（アーチ）。専用の指定は設けない。
- 構造: 反復用の領域は確保しない。重なりは `geometry/edge-through-node` などの既存の標本化 lint が報告する。junction・`straight` アンカー・異なる辺のアンカー・端が同じ点は `layout/no-route`（位置付き）。auto は既存の `layout/structured-only`。SVG・PDF・画像 PPTX・編集可能 freeform PPTX は曲線を保つ。glued は既存どおり `pptx/unsupported-geometry`。
- 見送り: 反復回数などを辺の上に置く専用の部品、ループの大きさの指定、複数の自己ループの自動配置（アンカーで分ける）。

- ループが内容の外へはみ出して全体を平行移動するとき、`sets`（外形・矩形・ラベル）もノードと同じ量だけ移す。
