# #427 線の太さ・点線・矢じりの大きさ

## 背景

TriCL（#420）と LLaDA（#421）の再現では、元の図との差の多くが線の重さだった。Sumi の枠と辺は元の図より太く、全体が重く見える。これまでは次のものを指定できなかった。

- 辺の太さ、点線（破線だけだった）、矢じりの大きさ
- グループ・集合・凡例の枠の太さと角の丸み
- ノードの枠の太さ（variant の既定が固定）

点線は破線で、太い矢印は emphasis の辺で代用していた。元の図（TriCL）の点線は、線幅の約 3 倍の間隔の丸い点、矢じりは線幅 0.5pt 前後に対して長さ 2〜3pt である。

## 決定

**構造化レイアウトで描く**。`themeOverrides` の 4 つと要素の `lineWidth` / `cornerRadius` / `arrowheadScale` は、`auto` の図で書くと `layout/structured-only`（D2 には矢じりの大きさと 0.25pt 刻みの幅がない）。`variant: dotted` は `auto` でも書けるが、D2 に点がないので最も細かい破線（`stroke-dash: 1`）で描く。

### 図全体の既定（`figure.themeOverrides`）

| キー | 効く先 | 値 |
| --- | --- | --- |
| `lineWidth` | 辺とノードの枠（凡例の枠を除く） | 0.25pt の倍数、0.25pt〜4pt |
| `frameWidth` | グループ・集合・凡例の枠 | 同上 |
| `arrowheadScale` | すべての矢じり | 0.5〜2 の数 |
| `cornerRadius` | グループ・集合（rect）・凡例の枠の角 | 0.5pt の倍数、0〜10pt |

- `lineWidth` はテーマの「標準の太さ」を置き換える。テーマが別の太さで描く variant（emphasis の太い辺、zoom の細い線）は、**同じ部品の default variant の太さに対する比**を保つ（例: paper で 0.5pt → 0.25pt にすると、1pt の emphasis は 0.5pt）。0.25pt の倍数に丸め、7.5pt（スタイルの上限）で止める。枠のない（太さ 0 の）要素は枠なしのまま。
- `frameWidth` は、テーマが枠を描くグループ・集合・凡例に、その太さをそのまま与える。`plain` や枠なしのテーマの既定には効かない。
- `cornerRadius` は `nodeCorners: square` より弱い（square が勝つ）。ノードの角は `nodeCorners` と要素ごとの `cornerRadius` で決める。

### 要素ごとの指定

- `lineWidth`: ノード・グループ・辺・集合。図全体の指定より優先し、その太さをそのまま使う（ratio は掛けない）。枠のない variant には効かない。`legend` ノードに書くと枠の太さ、凡例の `edge` エントリに書くと見本の線の太さ。
- `arrowheadScale`: 辺。`1` は図全体の指定を打ち消す。凡例の `edge` エントリにも書ける。
- `cornerRadius`: ノード・グループ・集合。
- `variant: dotted`: 辺、`container`、集合。テーマの `dashed` の色・塗りのまま、破線ではなく丸い点で描く（`strokeDotted`）。テーマに層を足さないので、どのテーマでも使える。

スタイル（`ResolvedStyle`）には、`strokeDotted`（`true` のときだけ）と辺の `arrowheadScale`（1 でないときだけ）を足した。指定しない図のスタイルにこのキーは現れない。

### 点線の描き方

- SVG・PDF: 長さ 0 の dash と丸い線端（`stroke-dasharray="0,<3w>"` と `stroke-linecap="round"`）。点の直径は線幅 w、中心の間隔は 3w（`DOT_PERIOD`。TriCL の点線が約 3）。0.5pt の線では 1.5pt 間隔。
- structured の wire は `sharp`（`edgeCorners: sharp`）でも、点線は丸い線端を保つ。同じ線の枝が 1 本の幹に束ねられる（`lineKey`）ときは、点線かどうかも区別する。
- picture PPTX は SVG を画像にするのでそのまま。
- editable PPTX: `<a:prstDash val="sysDot"/>` と `cap="rnd"`（PowerPoint の「丸点」）。点の間隔は PowerPoint の既定（2w）で、SVG・PDF の 3w とは少し違う。

### 矢じりの大きさ

- 矢じりの長さは `edgeArrowheadLength(style)` = `(4 + 4 × 線幅) × arrowheadScale`（単位は D2 unit。1 のときは従来の式そのまま）。三角形の幅は長さと同じ。開いた矢じり（#386）は確保された矩形に収まるまま、`openArrowhead()` が同じ長さから計算する。
- ルーターの確保する長さ（`arrowRoom()`、グループ余白の矢じり + stem、ジャンクション付近の押し出し）、線を止める位置、ラベルの回避、`geometry/arrowhead-on-bend`・`arrowhead-cramped`・dead-space の lint は、すべて `edgeArrowheadLength()` を読む。小さくすれば確保する余白も小さくなり、大きくすれば増える。`arrowheadLength(strokeUnits, scale)` に scale を足したので、確保と描画が食い違わない。
- editable PPTX の矢じりは `sm` / `med` / `lg`（約 4 / 6 / 10pt）の 3 段階しかない。`arrowheadScale` を指定した辺は、スケール後の長さに最も近い段階を選ぶ（指定しない辺は従来どおり）。

### 検証の範囲

- 太さは 0.25pt の倍数で 0.25pt〜4pt。pt の文字列だけ（`0.5pt`）。範囲外・倍数でない・mm や数値は `schema/invalid-value`。
- `arrowheadScale` は 0.5〜2。`cornerRadius` は 0.5pt の倍数で 0〜10pt。
- 0.25pt の太さは D2 の整数 unit に収まらないので、`StyleLength.units` は 0.5 を取りうる（SVG は問題ない）。`auto` では書けないので D2 には渡らない。

## 採らなかった案

- すべての太さを一律に置き換える案: emphasis と通常の線の差が消え、意味（強調）が失われる。比を保つほうが、テーマごとの 0.5pt / 1pt の組み合わせでも自然。
- 辺の `width` という名前: ノードの `props.width`（大きさ）と紛らわしい。`lineWidth` に統一した。
- 点の間隔を PowerPoint の `sysDot`（2w）に合わせる案: 0.5pt の線で点の間の隙間が 0.5pt になり、印刷で破線に見える。原図（約 3w）に合わせた。
- editable PPTX で `custDash` の `d` をほぼ 0 にする案: PowerPoint での丸点の描画が保証されない。標準のプリセットを選んだ。
- `dotted` を各テーマの variant として足す案: 9 つの定義に同じ層を足すことになる。`dashed` を写して点にするほうが一か所で済む。
- `auto` でも幅だけ使えるようにする案: 0.25pt 刻みが D2 に渡せず、丸めると「視覚的な長さは丸めない」（§4.1）に反する。

## 互換性

新しいキーを書かない図の出力は変わらない。スタイルに新しいキーは現れず、`arrowheadLength(units)` は従来の式と同じ値、点線でない線の SVG は同じ文字列のまま（`lineKey` と wire の線端の属性は点線のときだけ変わる）。対象 YAML（research と非公開の図を除く）を自身のテーマと全組み込みテーマで変更前後に描画し、SVG・D2・PDF・picture PPTX・editable PPTX の SHA-256 が一致することを確かめた（結果は PR 本文）。

ギャラリーには、`dotted` の variant が辺・container・集合の見本に加わる。`examples/strokes` を足した（TriCL の一部を 0.5pt の線で再現）。

回帰テスト: `src/render/strokes.integration.test.ts`（スキーマの範囲、`auto` での拒否、各 scale の矢じりの長さと lint、太さ・角・集合・凡例への反映、点線の SVG・PDF・picture / editable PPTX、指定しない図が従来どおりであること）。

## 既知の制限

- 丸い点は構造化レイアウトだけ（`auto` は最も細かい破線）。
- editable PPTX の矢じりは 3 段階、点線の間隔は PowerPoint のもの。
- 凡例の集合の見本に個別の太さは指定できない（`frameWidth` に従う）。
