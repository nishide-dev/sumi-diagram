# #408 ノードに添える小さな添え物（glyphs）

## 背景

論文の図では、アイコンで「もの」を示し、その右上に小さな特徴ベクトル（色付きのセルの縦列）を添えて、
表現が付いていることを示す。段階ごとにベクトルの色が変わり、凡例にも同じベクトルが並ぶ。
Sumi では `badge`（アイコン 1 つを角に置く）しかなく、`tokens` は独立した部品で、ノードに付けられない。
`badge` と同じ経路（足跡・lint・各 writer）で、色付きのセル・点・pill を添えられるようにする。

## 決定

### 新しいノードのフィールド `glyphs` を足す（`badge` は拡張しない）

```yaml
- { id: doc, component: label, icon: tabler/file-text,
    glyphs: [{ kind: vector, cells: 3, tone: blue, dx: 0.3 }] }
```

`glyphs` は 1〜8 個の配列。各要素は次のとおり。

- `kind`: `vector`（セルの列）／`dot`（円）／`pill`（丸い棒）。
- `at`: 本体の外接矩形の角か辺の中央（8 通り、既定 `north-east`）。添え物の中心がそこに載る
  （`badge` が角に中心を置くのと同じ）。`dx` / `dy`（em、右・下が正、±10 まで）で動かす。
- `size`: セルの一辺・点の直径・pill の高さ。既定は **ノードの font size の 0.4 倍**
  （紙面の 7.5pt の文字で約 3pt）。`width`（pill のみ）は長さで、既定は高さの 2.2 倍。
- `cells`（既定 3、最大 16）、`direction: down|right`（既定 down）、`tone`（全セル）、
  `tones`（セルごと。長さがセル数。`none` は無色）。`vector` のみ。
- `outline`（既定 true）: セルごとの細い枠。

各フィールドの組み合わせの誤り（`dot` に `cells`、`tones` の長さ違い、`pill` 以外の `width` など）は
位置付きの `schema/invalid-value`。`legend` / `tokens` / `matrix` / `bracket` / 点の junction には
付けられず `component/glyph-unsupported`（`badge` の `component/badge-unsupported` と同じ対象）。

### なぜ `badge` の拡張ではないか

- `badge` は 1 個・アイコン専用・角のみ・1 em 固定で、ロード済みアイコン資産（`assets.badges`）に依存する。
  ベクトルを足すと、スキーマの共用体・資産の読み込み・PPTX の拒否理由がすべて分岐する。
- 添え物は資産を必要としない。新しいフィールドなら、`hasAssets()` や資産の来歴（`assets-sha256`）に触れず、
  既存の図の出力が変わらないことを構造的に保証できる。
- アイコンの添え物は `badge` が既にある。`glyphs` に `icon` を重ねて持たせると同じ機能が二重になる。
  アイコンは `badge`、ベクトル・点・pill は `glyphs` と分担し、どちらも同じ足跡の経路に載せる。

`attach` の拡張も採らない。`attach` は別のノードを置く仕組みで、ノードとして ID・ラベル・辺の端点になる。
添え物は辺の端点にならず、ラベルも持たない。ID を持たない装飾にする方が、辺・配置の制約を増やさない。

### 解決（`GlyphIR`）

コンパイラが 1 回だけ、テーマとノードの style から `GlyphIR` を作る（`src/assets/glyphs.ts`）。

- 寸法は D2 単位（0.5pt）に直した値。パーツ（セル・点・pill）は添え物自身の枠での座標・大きさ・角丸・塗り。
- 塗りは `sumi/box` の `default` variant を、その `tone` で解決した色（なければ素の塗り）。
  枠線の色はその style の stroke、幅は stroke 幅の 0.6 倍を 0.5〜1.5 単位（0.25〜0.75pt）に収めた細線。
  塗りは「色の tone」をそのままテーマが決めるので、テーマごとに配色が変わる（paper は灰、color は淡色）。
- 薄表示（`dim`）のグループ内のノードでは、塗りと枠をテーマの dim 色にする。
- 配置・描画・lint が同じ数値を読む。足跡は「パーツの外接矩形＋枠の半分」。

### 配置（structured）

足跡は badge と同じ張り出し（overhang）として扱う。行・スタック・attach・グループ・キャンバスが
本体と badge と glyph の和を確保し、本体の大きさは変えない（明示の `width` / `height` も本体の寸法）。
glyph 付きノードは cross 軸の stretch・グリッド hint の対象外（badge と同じ）。
辺は本体に接続し、添え物には接続しない。辺の経路探索の障害物は従来どおり本体。
auto（D2）では配置後に合成して描くだけで、D2 の配置には影響しない。lint で重なりを確認する。

### 出力

`g.sumi-glyphs`（中に添え物ごとの `g.sumi-glyph.sumi-glyph-<kind>`、パーツは `<rect>`、点と pill は `rx` 付き）を、
ノードの `<g>` の末尾（badge の後）に置く。`g.shape` の外なので、検査は従来どおり本体だけを読む。

- SVG・PDF・picture PPTX: 同じ SVG から出る（新しい backend はない）。
- editable PPTX: `g.sumi-glyphs` の `<rect>` ごとに、塗り・枠のある図形を 1 つずつ（名前 `<key> glyph <n>`）。
  アイコン・画像・badge を持つノードを拒否する既存の `pptx/unsupported-asset` は変えない
  （アイコンノードは glyph の有無にかかわらず editable では描けない）。

### lint

- 新規 `geometry/glyph-collision`（既定 warning、`fixable: false`）。添え物の足跡が、キャンバス外、
  他の要素の本体・ラベル・badge・glyph・辺、自身の文字ラベル、自身の badge や別の glyph に重なる場合。
  自身の本体、自身のアイコン、祖先グループの本体は意図した重なりとして除外する。
  辺は本体に接続するので、辺が出る側の中央に置くと辺と重なって警告される。
- `dead-space`・`empty-space`・幅・高さの内訳・`group-empty-area` は足跡に glyph を含める。

## 採らなかった案

- `badge.vector`: 上のとおり、badge の共用体と資産経路が分岐する。
- 既定の位置を角の外側に置く案（添え物の内側の角を本体の角に合わせる）: アイコンの周りの余白が
  ノードごとに違うため、外側に出すぎる図と重なる図の両方が出る。`badge` と同じ「中心を置く」ほうが
  予測しやすく、`dx` / `dy` で調整できる。
- セルごとの隙間（gap）: 隣接するセルの枠を共有して、2〜3pt のセルを細い線で区切る方が紙面で読める。
- 彩度の高い塗り（`solid`）の使用: テーマの tone の意味（淡色／灰）に従う。濃い色が必要な図は
  テーマ側の tone を調整する。

## 互換性

`glyphs` を書かない図の出力は変わらない。すべての `*.sumi.yaml`（research/ と非公開の図を除く）を
各テーマで変更前後に描き、SVG・PDF・PPTX（picture / editable）・D2 の sha256 が一致することを確かめた。
新しいギャラリー（`docs/gallery/glyphs.md` と各テーマの SVG）と、検証用の fixture は新規で、
既存のギャラリー・examples の出力は変わらない。

## 制限

- editable PPTX は、アイコン・画像を持つノードを従来どおり描けない（添え物は図形として描ける）。
- 添え物の色は tone（テーマの塗り）で、任意の色指定はない。
- 添え物を辺の端点にしたり、ラベルを付けたりはできない（独立したノードを `attach` で置く）。
