# #365 グループの枠を右上に重ねる

## 背景

GCN Figure 1 の特徴マップ群には、頂点を含む前面カードと、その右上の背面カードが必要である。画像の `props.layers` は内容も複製するため流用できず、`stack` ノードには子要素を入れられない。

## 決定

- `groups[].props.layers: { count, offset }` を container の component props として追加する。グループの一般的な配置指定（`arrange`、`labelAt`、`caption`）とは異なる部品の描画オプションなので props に置く。グループも registry の props 検証を通し、画像と同じ Zod の layers スキーマを共有する。count は前面を含む整数 1–16、offset は正の 0.5pt 刻みの長さ。不正値・未知フィールドは既存の `component/*` 診断で示す。
- footprint は前面の幅・高さにそれぞれ `(count - 1) * offset` を足した矩形。前面は footprint の左下、背面は同じサイズを右上にずらす。背面から前面へ同じ fill / stroke / dash / radius で描画し、タイトル・子・padding は前面だけに置く。tone と dim は既存 style を共有する。塗りが透明な variant は透明のままなので、背面の線が透けて見える。
- arrange の計測・stretch・包含・canvas・caption・SVG inspection・geometry lint は footprint を使う。タイトルは前面で計算し、キャプションは footprint の下の中央に置く。`label: "$C$"`、`labelAt: top-left` は既存の math-italic を使う。本文の字形を複製しない。
- 辺の接続矩形とルータの枠境界・横断コストは前面。背面カードは装飾なので経路の障害物にしない。子から北・東へ出る orthogonal / straight の辺と zoom は背面帯を横断でき、前面枠をグループ境界として扱う。カード・子の後に辺を描画し、背面の塗りが辺を隠さない。`route: curve` は現行 schema に存在しない。
- ラベルは経路と異なり、前面の枠線と背面の上・右の帯（階段状の隙間を含む）を避ける。footprint は配置・包含に残すが、edge-label placement には前面枠と背面帯を別々に渡す。矢印のない辺も通常位置が枠・背面帯と重なるときは候補探索する。明示位置の診断と geometry lint も同じ幾何を参照し、置けないラベルは `geometry/label-collision` で報告する。積層の辺ラベルは行ごとの文字だけでなく背景の箱も検査し、行間の不透明な塗りによる枠の消失を見逃さない。
- 全組み込み theme の `default` / `muted` / `filled` / `dashed` を対象とする。`filled` は枠線がなくても塗りのあるカードなので対応する。`plain` はカード自体がなく指定の意味がないため `component/invalid-prop`。count 1 でも同じ契約を検証する。
- structured layout に対応する。auto は `layout/structured-only` で停止する。D2 の container は子配置・タイトル・辺の終端を同じ枠へ結びつけており、描画後の複製だけでは footprint と接続の契約を保証できない。暗黙にレイアウトエンジンを変更しない。
- SVG / PDF / picture PPTX は同じ SVG から描画する。editable PPTX は count > 1 を `pptx/unsupported-geometry`（props.layers の位置、picture モードへのヒント付き）で拒否する。単一 DrawingML オブジェクトへ複数枠をまとめると接続サイトが footprint に移り、別オブジェクトへ分けるには ID / 接続 / 編集時のグループ契約が別途必要になる。count 1 は既存の編集可能な単一枠のまま。

## 採らなかった案

- group 直下の `layers`: ノードの props.layers と異なる書き方になり、部品のオプションを schema に直接固定してしまう。
- 内容込みのグループ複製: 子・ラベル・辺が背面に重複するため採用しない。
- 全体を前面枠として接続: 右上の辺が背面で途切れるため採用しない。
- 背面帯を経路障害物にする案: GCN の Z1 → Y1 や X1..X4 の東向きの辺を妨げる。装飾を横断不可にする意味はないため、PR #377 のレビューで撤回し、帯の予約はラベルに限定した。

## 互換性と検証

layers がないグループは同じ寸法・描画順・出力のまま。count 1 も描画は同じ。既存 props のないグループへ既定値を書き足さず、metadata も維持する。不明な group props は従来の schema/unknown-field から component/unknown-prop に変わる（新しい有効な props フィールドを追加したため）。

既存の対象 YAML を自身の theme および全組み込み theme で変更前後に描画し、SVG / PDF / picture PPTX / D2 の SHA-256 を比較する。research と名前に c-h3world を含むファイルを除外する。新機能は全 theme × framed variant、4 枚、左上の数式タイトル＋下キャプション、前面への接続、不正値、plain / auto / editable の診断、入れ子、count 1 を回帰テストで検証する。視覚確認用の生成物は `.sumi/preview/` に置き、CLI の PDF を pdftoppm で PNG 化して確認する。

PR #377 の回帰テストでは4枚のグループ内から北・東へ出る orthogonal / straight の辺が迂回せず背面帯を通り、SVG のカードより後に描画されることを検証する。`label-stack` の junction 間に `Layer\nWeights` を置く再現では、前面・背面の枠を覆うラベルに collision が出ること、十分な高さがある場合は衝突なく配置すること、footprint 内部に収まる前面枠・背面帯の衝突も検出することを検証する。
