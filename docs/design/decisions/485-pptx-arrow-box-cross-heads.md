# #485 編集可能 PPTX の arrow・box・cross の矢じりと点線の位相

`485-pptx-hollow-heads-dashes.md`（#555）で残した 3 点の記録。

## arrow・box・cross の矢じり

- `arrow`・`box`・`cross` は、塗りの有無にかかわらず、SVG の marker から求めた外形を線とは別の freeform として描く。DrawingML の `stealth` は使わない。PowerPoint の矢じりは 3 段階の大きさしか選べず、凹みの深さも指定できないため、SVG の凹多角形（先端、後ろの角 2 つ、深さ 3/12 の凹み）と一致する保証がなく、LibreOffice / PowerPoint で目視もできなかった。marker から描けば寸法が SVG と一致する。
- `arrow`: D2 は `filled: false` でも塗るので、marker の fill（線色）で塗った閉じた図形にする。
- `box`: 塗る場合は線を切らず、marker の fill で塗る。塗らない場合は #555 の中抜き矢じりと同じ（線は箱の根元で止まり、箱は塗りなしの外形）。
- `cross`: D2 は塗らない場合も canvas 色で塗る。塗る場合は marker の fill（白）で塗った 12 頂点の十字に、中心から外へ伸びる線の図形を重ねる。塗らない場合は fill を外す（線は十字の中を通る）。
- D2 の塗る矢じり（fill あり、stroke なし）は、PPTX でも線を引かない（以前の図形は線で一回り太かった）。stroke を持つ marker（中抜き、box、cross）は marker の線色と線幅で描く。
- `headFrame()` は `<g>` で包まれた図形（cross）と、`translate` / `rotate` の `transform` を読む。`<g>` の fill / stroke / stroke-width は中の図形に引き継ぐ。`HeadOutline.source` が引き継いだ後の図形を返す。ほかの transform は従来どおり拒否する。
- structured のレイアウトは marker を持たず、`drawArrowhead()` が `arrow`（凹んだ閉じた多角形）、`box`（多角形）、`cross`（2 本の斜めの線）を直接描く。編集可能 PPTX は同じ関数の出力を読んで同じ形の freeform にし（塗る場合は fill のみ、塗らない場合は線のみ、SVG と同じ）、線は `arrowheadInset()` で矢じりの根元まで切る（SVG の wire と同じ）。`open` は従来どおり DrawingML の開いた山形。
- marker の `stroke-width` は marker の座標系の値なので、`headFrame()` と同じ倍率（viewBox と markerWidth/Height、strokeWidth 単位）を掛けて線幅にする（`HeadOutline.strokeScale`）。
- この矢じりを持つ辺は #555 と同じく glued でも freeform で描く（接続は維持されない）。`open` は引き続き DrawingML の開いた山形のままで、SVG の形と一致する。

## 点線の位相

- 点線は幅 0 の破線（`stroke-dasharray="0,n"`）で、PowerPoint の `sysDot` のままにする（編集で変えられる）。
- ラベルのマスクの隙間で分けた各部分は、#555 の `alignDashPhase()` で SVG の次の点の位置から始める。`sysDot` の周期（PowerPoint 側）と SVG の周期（幅の 3 倍）は一致しないので、揃うのは各部分の最初の点だけで、その先の点は少しずつずれる。
- 次の点までより短い部分は点を持たない。終点の矢じりを持つ部分がそうなったときは、矢じりだけを別の図形として描く（#555 と同じ）。
- 点線の `0,n` を出すのは structured の wire だけで、structured はラベルにマスクではなく背景の rect を使うので、点線の wire は分割されない（テストで 1 本のままであることを確かめる）。auto は点線の `stroke-dasharray` を `0,n` で出さない（D2 の最も細かい破線 `1,1`）ので、マスクで分割される点線は現在どの SVG からも出ない。位置合わせは `0,n` とマスクを持つ SVG に備えたもので、テストは自動レイアウトの SVG の破線とマスクを書き換えて、位置合わせ・短くて点を持たない部分の破棄・矢じりだけを別の図形にする分岐を確かめる。

## 検証

LibreOffice が無い環境のため、DrawingML の XML を統合テストで確認した。PowerPoint での目視は未実施。
