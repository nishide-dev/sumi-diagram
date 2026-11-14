# #485 編集可能 PPTX の中抜き矢じりと破線の連続性

## 背景

#483 以降、auto の SVG は塗らない矢じり（triangle、diamond、circle）を塗りなしの marker とし、線を矢じりの根元で切る。編集可能 PPTX は DrawingML の矢じり（`headEnd` / `tailEnd`）を使うが、これは線の色で塗りつぶされ、塗らない形を表せない。そのため塗らない triangle、diamond、circle は未対応として拒否していた。また #483 の線分割では、破線の各部分で模様が先頭から始まり、SVG のマスクで切った線と位相がずれた。

## 中抜き矢じり

塗らない triangle、diamond、circle は、SVG と同じ外形の塗りなし図形として線とは別に描く。PowerPoint の矢じりを使わない。

- `untrimmedRoutes()` は D2 の経路を戻す際、SVG の切った経路を `data-sumi-cut`、線を隠した経路に `data-sumi-hidden` を残す。編集可能 PPTX はこの経路を線として使う。矢じりの根元で止まり、矢じりの中に線は入らない。両端の矢じりが接して線が残らない辺は線を描かない。
- 矢じりの外形は marker から求める。`headFrame()` に `outlines()` を追加し、polygon は折れ線、circle は 4 本の三次ベジェで利用者座標へ写す。切った経路に合わせて調整された marker の `refX` / `refY` と数値の `orient` も `headFrame()` が読む。
- 外形は閉じた freeform（塗りなし、marker の線色と線幅）。破線にはしない。
- この矢じりを持つ辺は、glued でも freeform で描く（矢じりが接続線の端に付かないため）。接続は維持されない。
- `arrow`（凹んだ矢じり）は変えない。D2 は `filled: false` でも `arrow` を塗りつぶすため、SVG は塗った凹多角形、編集可能 PPTX は開いた山形のままで、形の差は残る。box と cross は従来どおり未対応。

## 破線の連続性

DrawingML の破線は線の始点から始まり、位相を指定できない。SVG の `stroke-dasharray` と `stroke-dashoffset` を保つ必要がある破線（切った経路の `stroke-dashoffset` が 0 でない、またはマスクの下を通る）は、破線を 1 本ずつ実線の部分経路として描く（`explodeDashes()`）。

- 経路を折れ線（曲線は 32 分割）にし、offset から始めて破線の区間を並べ、各破線をマスクで切る（`splitMaskedPath()`）。1 つの図形に全部の破線を部分経路として入れる。
- PowerPoint の矢じりは短い（1 単位）実線の図形の端に付ける。破線の隙間が経路の端に当たっても矢じりが先端に出る。
- 点線（長さ 0 の破線）は PowerPoint の `sysDot` のままで、位相は合わせない。
- 破線の種類を後から変えると、分割した破線は 1 本の線として変わらない。この制約は許容する。

## 検証

LibreOffice が無い環境のため、DrawingML の XML を単体テストと統合テストで確認した。PowerPoint での目視は未実施。
