# #350 主経路の中心を保つ側入力

## 背景

DETR の試行では、decoder と object queries を stack にまとめると、その
stack 全体の中心が主経路の row に揃い、decoder の中心がずれた。`attach`
では入力の幅を隣との間隔に予約できず、tokens 自体も attach できなかった。
背景調査は #346 の `research/345-figure-placement/README.md`。内容の形として
「主経路を一列にし、側入力を直交方向へ出す」型を選べるようにする。

## 決定

stack / row に任意の `centerOn: <直接の項目ID>` を追加する。主軸に沿った
箱の中心を、その項目の本体中心に合わせる。項目全体の自然寸法と gap、
align の strut を測り、中心から両端までの距離の大きい方を左右（上下）に
予約する。配置は予約した先頭の余白を加えるだけで、探索を追加しない。
バッジは占有寸法に含むが基準は本体中心、caption の生成 stack では元の
group 本体を基準にする。全体参照された tokens は従来の透明 frame に展開する。

例: `row.items: [encoder, {stack: {centerOn: decoder, items: [decoder, queries]}}, output]`。
外の row の `align` は省略または `center` とする。queries は普通の配置項目
なので、tokens・通常の箱・グループが使え、横幅も予約される。入力との辺は
明示する。`direction: up` は上側、row の `centerOn` は縦の主経路の側入力に使える。

指定は直接の項目に限定し、セルや別の階層を指す指定を受け付けない。
`justify` は省略または `center` だけとし、不正な組み合わせは共通 Diagnostic
`layout/invalid-center-on`（error、指定箇所のソース位置つき）で停止する。
伸長によって基準の中心が移動する曖昧さを避ける。既存の cross-axis `align`
とグループ所属の規則はそのまま使う。

## 採らなかった案

- `attach.reserveSpace` と tokens の attach 対応: target の祖先のどの箱に
  どちら側の余白を伝播するか、複数の入力・attach 連鎖の扱いが増える。
  既存 attach の「木の場所を取らない」という契約との違いも分かりにくい。
- tokens の attach だけ許可: 隣との重なりを解決しない。
- すべての主経路を stack で包み `layout.align` を指定: 既存機能で可能だが、
  作者に無関係なパネルの調整まで要求する。
- 新しい side-input 専用部品: 部品の意味と配置を混ぜ、汎用の組み合わせを制限する。
- 非対称の alignment baseline を全レイアウトに導入: 余白を節約できる一方、
  grid・stretch・align の全てへ新たな寸法契約が必要。今回は明示した箱だけを
  対称に予約する。枠付き group 内には反対側の空白が残るトレードオフがある。

## 互換性と検証

`centerOn` がない箱は追加余白ゼロで、旧来の計算・配置を維持する。スキーマと
Skill の型を追加し、attach の契約は変えない。既存全 YAML × 自身のテーマと
組み込み5テーマを変更前後で描画し、SVG / PDF / PPTX / D2 の SHA-256 を比較する。
構文・参照など意図的に無効な fixture は失敗する診断コードも比較する。

回帰試験は上下左右、幅の広い tokens の側入力、全テーマの主経路の直線性と
幾何 lint、tokens 全体を中心に指定する場合、caption のある group、不正な指定を
含む。追加の作例は CLI の PDF 出力を `pdftoppm -png` で画像化して確認する。

実測では既存162ファイル × 6条件 = 972条件で差分ゼロだった。690条件は描画に
成功し、282条件は既存の無効な入力などで失敗（診断コード一致）。新しい
`side-inputs.sumi.yaml` の6条件だけが追加され、既存 golden の更新は不要だった。
上下の側入力 × 5テーマの10画像で、主経路・入力の向き・ラベルと箱の間隔を確認した。
