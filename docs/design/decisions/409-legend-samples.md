# #409 凡例の見本（アイコン・添え物・矢印・集合の塗り）と並べ方

## 背景

論文の図は、凡例を図の下の 1 か所にまとめ、「Entity: Paper（文書のアイコン）」「Attributes: Title（T）　Abstract（≡）　Compound（フラスコ）」
「Node Feature: Initial（特徴ベクトル）　Encoder Output（同）」「↔ Positive Pair（青）／↔ Negative Pair（赤）」のように、
見本つきの項目を横に並べる。#131 の `legend` は、辺の見本・箱の見本・行列の class の見本を縦 1 列に
並べるだけで、アイコンも特徴ベクトルも集合の塗りも置けず、見出しもなかった。論文図の試行では、
アイコンの凡例のために `label` ノードを 8 個並べて偽の凡例を作った。

## 決定

### 見本を 3 種足す（既存の `edge` / `node` / `class` は変えない）

項目の見本はちょうど 1 つ（`edge` / `node` / `class` / `icon` / `glyph` / `set`）。2 つ以上、または 0 個は
`component/invalid-prop`（項目の位置）。

- `icon: tabler/file-text`: アイコン ID（ノードの `icon` と同じ。1 em 角）。展開すると `label` ノード
  `<legend>-<n>-box` が `icon` を持つ。アイコンの検査（`asset/*`）はそのまま働き、診断は項目の `icon` を指す
  （`src/assets/check.ts` で、凡例の部品のアイコンの位置を項目に付け替える）。
- `glyph: { kind, cells, direction, tone, tones, strength, size, width, outline }`: ノードの `glyphs[]` と同じ
  フィールド（#408。`at` / `dx` / `dy` は持たない）。検査の規則（`tones` の長さ、`tone` と `tones` の併用不可、
  `kind` と合わないフィールド）も共有する（`glyphShape` と `checkGlyph` を `schema.ts` から使う）。
- `edge`（既存）: 線種は部品と variant、矢じりは部品で決まる。`line`（なし）・`arrow`（終点）・
  `double-arrow`（両端）、variant `dashed`、`tone`。「↔ Positive pair」は
  `edge: { component: double-arrow, tone: blue }`。点線の variant は辺に存在しないので足さない（制限）。
- `set: { variant, tone, fillOpacity }`: 集合の塗りの見本。`variant`（default・filled・outlined・dashed）と
  `tone` は集合と同じ意味で、同じスタイル解決（`resolveSetStyle`）で描く。

### 添え物と集合の見本は、本物の部品に展開する

凡例は、見本と文字を実在のノード・辺に展開する（#131）。この方針を保つ。新しい描画の経路は足さない。

- 添え物の見本: 空の `box`（`<legend>-<n>-box`）の中央に、`at: center` の添え物を 1 つ置く。箱の大きさは
  添え物の大きさ（`glyphSize()`: セルの一辺は文字の 0.4 倍、`size` があればそれ）を D2 の単位（0.5pt）へ切り上げた値。
  添え物の位置に **`center`** を足した（`GLYPH_POSITIONS` の追加。ノードの `glyphs[].at` でも書ける。
  自分のラベルに重なるときは `geometry/glyph-collision`）。
- 集合の見本: 空の `box` を、見本の箱（幅 2.5 em・高さ 1.125 em）の大きさにし、余白 0・形 `rect` の
  **集合** `<legend>-<n>-set`（メンバーはその箱だけ）で囲む。集合の描画（半透明の塗り・線・破線・
  テーマの角丸、SVG・PDF・picture と editable の PPTX）がそのまま使え、集合と同じ見た目になる。
  集合の ID は集合だけの空間。作者の集合が同じ ID を取ると `ref/reserved-id`（`sets[i].id` を指す、
  subject は `set`）。
- 見本の箱は塗りも線もない: `ExpandedPaint` に `bare`（テーマ段で塗りと線を `transparent` / 0 にする）を足した。
  `label` で作らないのは、`sumi/label` が空の文字を `component/missing-label` で拒否するため。

### 並べ方

| フィールド | 場所 | 意味 |
| --- | --- | --- |
| `flow` | `props` | `column`（既定。1 行に 1 項目、従来のまま）／`row`（項目を横に並べる）。 |
| `perRow` | `props` | `flow: row` のとき、1 行の項目数。あふれると次の行に折り返す。`flow: row` なしでは `component/invalid-prop`（`perRow` の位置）。 |
| `heading` | 項目 | この項目から新しいグループを始める。見出しはグループの行の先頭（`column` では見出しだけの行）に、見出しの文字のノード `<legend>-<n>-heading` として置く。見出しのない項目は直前のグループに属する。 |
| `labelAt` | 項目 | 文字を見本の右（既定）か左（`left`）に置く。「Paper（アイコン）」のような並びのため。 |

- `flow: row` の 1 行は、項目を `entryGap`（文字 1.5 em、7.5pt の文字で約 11pt）で隔てて並べる。グループごとに
  `perRow` で折り返す。見出しのあるグループは、見出しとグループの行（stack）を 1 行とする **表**（2 列の grid、
  列の間は `textGap`）の行にする。見出しは全グループで 1 つの列に揃い（幅は最も広い見出し）、項目は
  共通の x から始まり、折り返した行も最初の項目の下から始まる。見出しのない先頭のグループ（見出しより前の項目）は
  表の外の普通の行で、見出しのない凡例の展開は変わらない。
  （初版は見出しを最初の項目の左に置く行にしていたが、折り返した行が左端に戻り、見出しの幅の違いで項目の
  列が揃わなかったため改めた。見出しの幅を測って固定する案は、ノードの幅の中で文字が中央に寄るため採らず、grid にした。）
- 全体は従来どおり、左寄せの縦の stack（行間 `rowGap`）。見出しも文字も同じ `label` で、
  文字の下限の検査（`geometry/text-too-small`）がそのまま掛かる。見出しは太字にしない（`label` に太さの指定がないため）。
- 項目は最大 20 のまま。予約 ID は `<legend>-<n>-label`・`-heading`・`-box`・`-line`・`-start`・`-end`・`-set`。

### lint

`lint/unused-legend-entry` を新しい見本にも拡げる。

- `icon`: そのアイコンを `icon` か `badge.icon` に持つ、作者のノードがない。
- `glyph`: 種類・`strength`・tone（重複を除いた順序）が同じ添え物を持つノードがない。セルの数は比べない。
- `set`: `variant` と `tone` が同じ、作者の集合がない（凡例の見本の集合は数えない）。
- 辺と箱は従来のまま。

見出しは何も説明しないので対象外。

## 採らなかった案

- 見本の種類を 1 つの `sample: { kind: ... }` にまとめる: 既存の `edge` / `node` / `class` の書き方が変わり、
  既存の図の書き換えが要る。フィールドを足すだけなら既存はそのまま。
- `badge` や `tokens` を見本にする: `badge` は角にしか置けず、`tokens` は独立した部品。添え物（#408）を
  そのまま使う方が、図の中の添え物と凡例の見本が同じ寸法・色になる。
- 集合の見本を、ノードの塗りの不透明度で描く: ノードに半透明の塗りはなく、集合の見た目と食い違う。
  集合を本物にすれば、テーマ・PDF・PPTX の描画と `themeOverrides.tones` がそのまま効く。
- 見出しを別のフィールド（`groups: [{ heading, entries }]`）にする: 項目の列が二重になり、
  `entries` だけを読む既存の検査・診断の位置・予約 ID の番号が崩れる。項目に `heading` を足せば、通し番号は変わらない。
- 点線の辺の見本: 辺の variant にない線種を凡例だけに足すと、図の辺では描けないものの凡例ができる。
  必要なら辺の variant として別 issue で足す。
- 見出しの太字: `label` の variant に太さがない。見出しのためだけに足さない。

## 互換性

既存の項目（`edge` / `node` / `class`）と、`flow` / `perRow` / `heading` / `labelAt` を書かない凡例は、
展開の木・ID・順序とも変わらない。すべての `*.sumi.yaml`（research/ と非公開の図を除く）を、自身の theme と
全組み込み theme で変更前後に描画し、SVG・PDF・picture PPTX・editable PPTX・D2 の sha256 を比べた。結果は PR に記す。

出力が変わるもの（意図したもの）:

- JSON Schema（`schema/figure.v1.schema.json`）: `glyphs[].at` に `center` を足した（部品の props は図のスキーマに入らない）。
- `sumi catalog` の `legend` の説明と props のスキーマ（`icon` / `glyph` / `set` / `heading` / `labelAt` / `flow` / `perRow`）、
  ギャラリーの `sumi/legend` の説明文。
- ギャラリー: 新しい「Legend samples」（`docs/gallery/legend-samples.md` と各テーマの SVG）。
- 凡例の `component/invalid-prop` の文言（「"edge", "node", "class", "icon", "glyph" or "set"」）。

## 制限

- editable PPTX は、アイコンのノードを従来どおり描けない（`pptx/unsupported-asset`）。アイコンの見本も同じ。
  添え物・集合・辺・文字は図形として描ける。
- 辺の見本は、辺にある線種（実線・破線）だけ。点線はない。
- 見出しは太字でない。見本の大きさは文字の大きさに従い、アイコンは 1 em。
- 集合の見本は矩形のみ（円・凸包の見本はない）。
- `flow: row` の折り返しは項目の数（`perRow`）で決まり、幅では決まらない。幅が足りないときは `geometry/exceeds-page-width`
  が出るので、`perRow` を減らす。
- 凡例は structured のみ（従来どおり）。
