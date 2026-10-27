# #124 論文図の段階 B の範囲（#109 の dogfooding から）

- 対象: [#124](https://github.com/nishide-dev/sumi-diagram/issues/124)。関連: #80（ロードマップ）、#86（[論文図の調査](86-paper-figures.md)）、#109（[v0.4.0 の dogfooding](../../research/109-dogfood-v0.4/README.md)）、v0.4.1（[リリースノート](../releases/v0.4.1.md)）
- 調査日: 2026-10-27。環境: macOS 26.2 / arm64（Apple M4 Pro）、Bun 1.3.14、Sumi の基点 `5cf29f6`（v0.4.1）、固定 D2 v0.9.0、製品の WASM エンジン（krilla 0.8.2 / resvg 0.47.0、無変更）、同梱の BIZ UDPGothic 1.051・STIX Two Math / Text Italic 2.13。画像の確認に Poppler 26.04.0、ImageMagick 7.1.2、Google Chrome 156.0.8078.48
- 試作・再現手順: [`research/124-stage-b/`](../../research/124-stage-b/README.md)。測定値は `results/*.json`、描画の縮小版は `previews/`

本文では、**実測**（スクリプトで測った値・確かめた挙動）と**判断**（それに基づく採否・設計）を分けて書く。判断の段落・表の列には「判断」と明記する。#109 の頻度は「4 図中に必要になった図の数」。

## 0. 結論

| # | 項目（#109 の頻度） | 判断 | エンジン | Issue（§5） |
| --- | --- | --- | --- | --- |
| 1 | グループ見出しの位置（3） | **採る**: `groups[].labelAt`（`top-left` `top` `top-right` `bottom-left` `bottom` `bottom-right`）。既定は今のまま | 両方（auto は D2 の `label.near`。全 13 値を受け付けることを実測） | 1 |
| 2 | 辺のラベルの位置（3） | **採る**: `edges[].labelAt`（`start` `middle` `end`）と `labelSide`（`left` `right`、進む向きに対して） | structured。auto では `layout/structured-only`（D2 v0.9.0 は辺の `label.near` を受け付けるが位置を変えない。実測） | 2 |
| 3 | キャプションと線種の凡例（2） | **採る**: `groups[].caption` と部品 `legend`（`props.entries` が辺・ノードのフィールドを指す）。どちらも既存の要素への展開で実装 | caption は両方（auto は透明な外側の container、実測）。legend は structured（auto は後回し） | 4・5 |
| 4 | 長いフローの折り返しと grid（2） | **grid を採る（優先度は低い）**。auto の折り返しは採らない（D2 の grid の辺は中心を結ぶ直線、#86 §3.1） | structured | 9 |
| 5 | 箱をまたぐ整列（2） | **採る**: `figure.layout.align`（`{ y: [a, b] }`）。**依存を足さない** strut（詰め物）の固定点反復。kiwi は採らない | structured | 6 |
| 6 | 数式のアクセント（2） | **採る**: `\hat` `\tilde` `\bar` `\dot` `\ddot` `\vec`。アクセントの位置は Sumi が基底の字形の箱から決める（GPOS に頼らない） | structured（数式は structured のみ） | 3 |
| 7 | 密な図の交差・遠回り（目視） | 費用の調整・辺の順序・rip-up・交渉は**採らない**（単独の案では交差の点の減少は最大 1 で、遠回りが増えるか 8 倍遅い。組み合わせで 2 点減らせたが遠回りが 1 → 4 に増えた）。**交差の報告（info）を採る**。fan-in の口の分散と配置の木による辺の選択は、遠回りを消すが交差の点が増えるので**利用者の判断**（§8） | structured | 7・8 |

- すべて Figure v1 への任意フィールド・部品の追加で、`requires: ">=0.5.0"`。**既存の図・examples・golden は変わらない**（§3 の各項目で根拠を示す。項目 8 だけは採る場合に一部の利用者の structured の図の経路が変わる）。
- 4 図を提案構文で書き直した（`research/124-stage-b/figures/`）。試作で描ける範囲（キャプション・凡例の展開、整列、上端左右の見出し、辺の `labelAt`、項目 8 の経路）を描いた結果は §4。図 4（U-Net）は整列で skip が水平になり、経路長 266.6 → 142.3mm・折れ 10 → 2。図 3 は anchor を 1 つも書かずに、#109 で手で付けた anchor と同等の「どのワーカーがどのストアへ行くか読める」経路になった（遠回り 1 → 0）。
- milestone 案「v0.5.0 — Paper figures stage B」を 10 件の Issue に分けた（§5）。拡大の引き出し線・薄い表示などは後回し（§6）。

## 1. 参照した版・固定した入力

| 対象 | 版 | 確認方法 |
| --- | --- | --- |
| Sumi | `5cf29f6`（v0.4.1） | 試作は製品の `src/` を import するか、実行時に読み込んで `out/` に改変コピーを書く（パッチはそれぞれちょうど 1 回一致しなければ例外）。改変コピーはフックなしで製品と同じ出力（テストでバイト一致を確認） |
| D2 | v0.9.0 | 固定バイナリ（`bun run d2:install`）で `measure/d2-probes.ts` |
| フォント | BIZ UDPGothic 1.051、STIX Two Math / Text Italic 2.13 | 同梱ファイル（sha256 は製品の `BUNDLED_FONT_SHA256`） |
| PDF/PNG エンジン | `assets/wasm/sumi-pdf.wasm`（krilla 0.8.2 / resvg 0.47.0） | 製品の `runEngine` / `svgToPdf` |
| 図 | #109 の 4 図（`research/109-dogfood-v0.4/figures/`）、作例 2（`examples/transformer`・`dit-block`）、fixture 2（`tests/fixtures/figures/layout/`）、ルータのテストの合成図 2（`synthetic()` の複製） | |

ダウンロードは行っていない（Chrome と Poppler / ImageMagick は画像の確認だけに使う）。

## 2. 構文の方針（判断）

#86 §2.1 の方針（定義と配置を分ける、各要素はちょうど 1 回置く、向きと揃えは箱ごと、見た目は Theme の範囲、汎用の部品だけ）をそのまま守り、段階 B では次を足す。

- **位置は名前で指定する**: `labelAt`（見出しも辺のラベルも同じフィールド名。値の集合は要素の種類ごとに Zod の enum で閉じる）、`labelSide`、`at`（整列の基準）。座標・オフセットの数値は書かせない（LLM に座標を推測させない。#86 §3.3）。
- **既定値は今の出力**: 新しいフィールドを書かない図は、structured も auto もバイト単位で同じ。既定を変えたいものは利用者の判断に回す（§8）。
- **展開で作れるものは展開で作る**: `caption` と `legend` は、コンパイル時に既存の要素（label ノード・hidden junction・辺・group・stack / row）に展開する。配置・経路・inspect・幾何 lint・PDF・PPTX の契約を変えずに済む（§3.3 で試作が描けることを確認）。
- **auto（D2/ELK）で効かないものは黙って無視しない**: §6.19 と同じく、structured 専用のフィールドを auto で書いたら `layout/structured-only`（error、そのキーの位置）。D2 で表現できるもの（グループ見出しの位置、キャプション）は auto でも効かせる。
- **実測（v0.4.1 の反応）**: 草案を `requires` を外して `checkFigure()` に渡すと、未知のフィールドは `labelAt` `labelSide` `caption` `align` だけ、未知の部品は `legend` だけになる（`results/drafts.json`）。ただし `figure.layout` に未知のフィールド（`align`）があると、`figure.layout` が無効になって engine の推定が auto に倒れ、数式ラベルに `component/unsupported-in-auto` が 1〜5 件付く（図 1 の別案と図 4）。`requires: ">=0.5.0"` を書けば最初に `schema/unsatisfied-requires` だけで止まるので（4 草案とも確認。テストで固定）、この連鎖は利用者には見えない。

## 3. 項目ごとの調査

各項目は「必要（#109 の根拠）」「理想の YAML」「エンジン」「層」「互換性」「検証」「大きさ・リスク」「判断」の順に書く。層の略号: schema（Zod と JSON Schema）、IR（Figure IR）、engine（`src/layout/structured/`）、router（`src/layout/route/`）、writer（`src/render/structured.ts`）、D2（`src/compiler/d2.ts`）、inspect / lint（`src/render/inspect.ts`、`src/lint/`）、PPTX（編集可能方式）、Skill。

### 3.1 グループ見出しの位置

**必要**: 図 1・2・3。structured の見出しは上端中央に固定で（設計 §6.21）、上から入る辺とぶつかる。#109 では図 1・3 で見出しを消して `attach` の label で代用し、図 2 は `toAnchor: "north:0.85"` でずらした。v0.4.1 では Skill に回避策を書いた（`structured.md`）。

**理想の YAML**:

```yaml
groups:
  - id: decoder
    label: Decoder
    labelAt: top-left        # top-left | top | top-right | bottom-left | bottom | bottom-right
  - id: gpu
    label: GPU pool
    labelAt: bottom
```

**エンジン（実測）**: 固定 D2 v0.9.0（ELK）で container の `label.near` を 13 値すべて試した（`measure/d2-probes.ts`、`results/d2-probes.json`）。

| `label.near` | 受け付け | 見出しの位置（container の左上から） | container の大きさ |
| --- | --- | --- | --- |
| `top-left` / `top-center` / `top-right` | ○ | 上端の内側（dy 33）、左・中・右 | 153 × 302 |
| `bottom-left` / `bottom-center` / `bottom-right` | ○ | 下端の内側（dy 289） | 153 × 302 |
| `center-left` / `center-right` | ○ | 側面の内側 | 185 × 302（見出しの分だけ広がる） |
| `outside-top-*` / `outside-bottom-center` | ○ | 枠の外 | 153 × 261（見出しの分だけ低くなる） |
| `outside-left-center` / `outside-right-center` | ○ | 枠の外の横 | 117 × 302 |

auto は今 `label.near: top-left` を固定で書いている（`GROUP_LABEL_NEAR`）。提案の 6 値は D2 の `top-left` `top-center` `top-right` `bottom-left` `bottom-center` `bottom-right` にそのまま写せる。

**structured の試作（実測）**: `top-left` / `top-right` は、配置エンジンが見出しの帯（上端）を既に取っているので、帯の中で見出しを左右に寄せるだけで実現できる（`labels.ts` の `applyGroupLabelAt`。ルータは `group.label.box` を障害物として避けるので、寄せた位置で避ける）。図 1 の草案（両グループの見出しを `top-left` で戻した）は、同じ草案を見出しの位置なし（上端中央）で描いた場合と比べて、遠回りが 1 → 0、余分な経路長（§3.7 の excess）が 35.5 → 21.9mm、折れが 31 → 27 になった（`results/drafts.json` の `withoutLabelPositions` と `productRouter`）。一方、図 2 で `Training step` を `top-left` にすると、今度は左上から入る `batch` の辺のラベルと見出しが重なった（`checkRoutes` の label 衝突 1、`alternatives`）。草案の `top-right` では衝突 0。**どの角が空いているかは図による**ので、位置は作者が選び、重なりは既存の `geometry/label-collision` / `edge-crosses-label` が報告する形にする。

**層**: schema・IR（`GroupIR.labelAt`）・engine（`bottom*` は見出しの帯を下端に取る。`#labelSpace` を上下で分ける）・writer（見出しの anchor）・router（変更なし。`group.label.box` を見る）・D2（`label.near` を書き分ける）・lint（`edge-crosses-label` の hint を「`labelAt` を変える」に。v0.4.1 で engine ごとに出し分けた文言の延長）・PPTX（見出しの位置は inspect の結果から作るので変更なしの見込み。テストで確認）・Skill。

**互換性**: 任意フィールドで、省略時は今の位置（structured は上端中央、auto は左上）。既存の SVG / PDF / PPTX は不変。

**検証**: 6 値 × 2 エンジンの fixture で、inspect の見出しの箱が group の枠の内側の指定の角にあること、幾何 lint 0 件、Layout IR の golden、D2 ソースの golden（`label.near`）。図 1 の草案が見出し付きで lint 0 件。

**大きさ・リスク**: S〜M（engine の帯の上下で約 60 行、D2 で数行、テスト）。リスクは低い。

**判断**: 採る。外側（`outside-*`）と側面（`center-*`）は、#109 で必要にならず、structured では `attach` の label で代用できるので入れない（§6）。既定を auto に合わせて左上にする案は、既存の structured の golden（`examples/dit-block` の見出し）が変わるので利用者の判断に回す（§8 Q2）。

### 3.2 辺のラベルの位置

**必要**: 図 1・2・3。図 1 の `K,V` が矢じりの下で Add & Norm との間に入り、どの辺のラベルか分かりにくい。図 2 の `update θ` は v0.4.1（#116）で手前の線を覆わなくなったが、位置は選べない。図 3 の `gRPC` は枠線に乗った（v0.4.1 で検出・回避）。

**理想の YAML**:

```yaml
edges:
  - { from: enc-norm2, to: dec-cross, label: '$K,V$', labelAt: start }        # start | middle | end
  - { from: enc1, to: enc2, label: pool, labelSide: right }                    # left | right（from → to に進む向きに対して）
```

- 既定は今の規則（矢じりのある辺は矢じりの手前 `end`、`line` は最も長い線分の中央 `middle`。側は水平なら上・垂直なら右）。
- `labelSide` は「進む向きに対して左 / 右」。上下・東西の絶対の向きにしないのは、経路の線分の向きはルータが決めるので、作者が YAML の時点で知らないため（TikZ の `auto` / `swap` と同じ考え方）。

**エンジン（実測）**: D2 v0.9.0 は辺の `label.near` を**受け付けるが位置を変えない**。`top-center` `bottom-center` `center-left` `outside-top-center` のどれも既定と同じ座標（ELK で (38.5, 164)、dagre で (26.5, 132)）。`label.position` は `unexpected field position` で拒否される。矢じりのラベル（`source-arrowhead.label` / `target-arrowhead.label`）は効き、端の近くに置かれる（ELK で target (55.5, 138)、source (53.5, 99)）が、D2 の SVG では塗りの class が中央のラベルと違い（`fill-N1` と `fill-N2`）、同じ `<g>` に別の `<text>` として出る。inspect は要素ごとに複数の label を読める（`labels: LabelGeometry[]`）が、その経路は確かめていない。

**structured の試作（実測）**: `labelAt` は、ルータの改変コピーの `HOOKS.labelEdge` でラベルの配置（`placeEdgeLabel`）に代わりの辺（`middle`: 矢じりなし、`start`: 矢じりを始点に）を渡して試した。図 1 の草案の `labelAt: start` で `K,V` は encoder の出口の脇に置かれ、衝突 0。図 1 の別案では `K,V` に `labelAt: middle` を付けると label 衝突が 1 → 0 になった（`withoutLabelPositions` との比較）。一方、図 2 の `update θ` に `labelAt: middle` を付けると、最も長い線分（loss の下を通る破線）の中央、つまり loss の箱と損失曲線の線の上に置かれ、衝突が 3 件（node・node のラベル・別の辺）出た（`alternatives`）。**`middle` も #116 の候補探索（線・枠・node を避けて位置をずらす）を通す必要がある**（受け入れ条件に入れる）。`labelSide` は `placeEdgeLabel` の中の側の選び方（`beside(..., side)`）を変える必要があり、試作していない。

**層**: schema・IR（`EdgeIR.labelAt` / `labelSide`）・router（`labels.ts`: 候補の起点と側。避ける規則は #116 のまま）・writer（変更なし）・D2（auto は `layout/structured-only`）・lint（変更なし）・PPTX（編集可能方式はラベルの箱を inspect から作るので変更なしの見込み）・Skill。

**互換性**: 任意フィールド。省略時の配置は今のまま（`labels.ts` の既定の分岐を変えない）。

**検証**: 3 × 2 の組み合わせ × 水平 / 垂直 / L 字の経路で、ラベルの箱の中心が指定の線分の指定の側にあること（Layout IR で検査）、`checkRoutes` の label 衝突 0、#116 の回避の回帰テスト（短い最後の線分）、図 1・2 の草案。

**大きさ・リスク**: M（`labels.ts` 約 100 行とテスト）。リスクは「指定どおりに置くと衝突する」場合の扱い。判断: 指定の位置と側を優先し、その範囲の中だけで #116 の候補を探す。範囲の中に候補がなければ指定の位置のまま置き、`geometry/label-collision` で報告する（黙って反対側に動かさない）。

**判断**: 採る。auto は今回は `layout/structured-only` にする。矢じりのラベルで `start` / `end` を auto に写す案は、D2 の塗りの class と inspect の確認が要るので後回し（§6）。

### 3.3 キャプションと線種の凡例

**必要**: 図 2・4。「破線 = skip」「破線 = 教師信号・更新」の凡例が描けない（B2）。キャプション（(a) …）は #86 §9.2 の `panel` / `caption`。

**理想の YAML**:

```yaml
groups:
  - id: data-stage
    label: Data
    caption: (a) data and augmentation        # group の枠の下に中央揃え
nodes:
  - id: key
    component: legend
    props:
      entries:
        - { edge: { variant: dashed }, label: skip connection (copy) }
        - { edge: { component: line }, label: data flow }
        - { node: { tone: blue }, label: encoder }
```

- 凡例の項目は、説明したい辺・ノードのフィールド（`variant` `component` `tone`）をそのまま書く。色の値は書かない（Theme が決める）。同じ値の辺・ノードが図にない項目は lint で警告できる（`lint/unused-legend-entry`、案）。#86 §7 の「凡例は class の定義と同じデータから作る」の、行列に限らない一般化。
- 図全体のキャプション（"Figure 3. …"）は従来どおり LaTeX の責務で、描かない（#86 §8）。

**展開（試作で実測）**: `lower.ts` が草案を v0.4.1 の要素に展開して描いた。

- `caption`: group の親の木での位置を `stack { gap: 1mm, items: [group, <group>-caption] }` に置き換え、`label` ノードを足す。
- `legend`: 同じ ID の group に、項目ごとの `row`（hidden junction 2 点を `row { gap: 6mm }` に置き、項目の `edge` フィールドを持つ辺でつなぐ見本の線、または項目の `node` フィールドを持つ小さな box、の後に `label`）を `stack` で並べる。

図 2・4 の草案で、展開した図は `checkFigure` の診断 0 で、試作が描いた図そのもの（図 4 は整列後、図 2 は見出しの位置を適用後）を製品の finalize・inspect に通した幾何 lint も 0 件だった（`results/drafts.json` の `geometryLint`。`previews/draft-training-pipeline.png`、`align-unet-before-after.png` の右）。見本の線は製品のルータが直線で引き、破線の位相・矢じり・線幅は本物の辺と同じ描き方になる。

**エンジン（実測）**: auto では次を確かめた。

- キャプション: 透明な外側の container に `label.near: outside-bottom-center` を付け、中に元の group を入れると、キャプションが枠の下の中央に出る（受け付け、`caption-wrapper-outside-bottom`）。
- 凡例: root の container に `near: bottom-right` と `grid-columns: 3` を付けた凡例（見本の 2 点と辺、文字）は描ける（受け付け、`legend-root-near-bottom-right`）。ただし `near` の定数は root の要素だけ（子に書くと `constant near keys can only be set on root level shapes`）。見本の点を見えなくする処理（hidden junction の auto 側、§6.26）と、grid の中の辺が中心を結ぶ直線になる性質（ここでは都合がよい）に依存する。

**層**: caption は schema・IR（展開はコンパイラの IR 生成の前、検査の後）・D2（外側の container）・inspect（外側の container は見えない group）・Skill。legend は部品の manifest（`props.entries` の検査）・展開・catalog / gallery（CONTRIBUTING の部品の手順）・Skill。

**互換性**: 任意フィールドと新しい部品。部品の追加なので gallery に legend の見本が**追加**される（既存の見本・examples は不変）。展開で生まれる要素の ID は `<id>-caption` などの予約した形にし、利用者の ID と衝突したら `layout/duplicate-placement` ではなく専用の診断（`component/reserved-id`、案）にする。

**検証**: 展開の単体テスト（木の置き換え、ID の衝突、位置付きの診断）、図 2・4 の草案の描画と幾何 lint 0 件、legend の全 Theme × variant の gallery、`lint/unused-legend-entry`。auto の caption は D2 ソースの golden と inspect。

**大きさ・リスク**: caption S（展開 約 40 行、D2 約 30 行）。legend M（部品・展開・gallery・lint 約 200 行）。リスクは、展開した要素が利用者に見える場所（診断のパス、`--emit-d2`）で、診断は元の `caption` / `legend` の位置を指す必要がある。

**判断**: caption は両エンジンで採る。legend は structured で採り、auto は後回し（§6。D2 で作れることは確かめたが、見本の点の扱いと inspect の確認が要る。凡例が要った図 2・4 は 4 図とも structured）。#86 §8 の `component: panel`（左上の太字の見出し＋キャプション）は、`labelAt: top-left` と `caption` で代替できるので作らない。

### 3.4 長いフローの折り返しと grid

**必要**: 図 2・3。auto は `direction: right` でも `down` でも `paper-double` を超え（342mm / 244.8mm など）、structured で手で 2 行にした（B3）。v0.4.1 で Skill に 2 行への折り返しを書いた。

**理想の YAML**:

```yaml
arrange:
  grid:
    columns: 4
    rowGap: 6mm
    columnGap: 4mm
    align: center
    items: [ dataset, sample, augment, augmented, model, loss, { item: optimizer, span: 2 } ]
```

- 項目は左から右、上から下（読む順）。`span` は横に何列分を取るか。列の幅は列の最大、行の高さは行の最大で、表のように揃う（#86 図 C の草案と同じ形。`column-gap` は既存のフィールド名に合わせて `columnGap` にした）。

**エンジン（判断）**: auto の折り返しは作らない。D2 の grid container は配置はできるが、grid の中の辺は中心を結ぶ直線で、間のブロックを貫通する（#86 §3.1 の実測）。D2/ELK には「n 個ごとに次の行」という指定もない。structured では、今でも `stack` の中に `row` を並べて折り返せる（#109 の図 2・3 の最終形）。grid が足すのは「別の行の要素が列で揃う」ことで、それは §3.5 の整列とも重なる（grid は「各行の上端を揃える整列制約」の特別な場合として書ける）。

**層**: schema（箱の種類に `grid`）・IR・engine（列幅・行高の計算と配置。1 パスで解ける。整列の strut とは独立）・Skill。router / writer / lint は Layout IR の矩形を使うので変更なし。

**互換性**: 任意の新しい箱。既存の図は不変。

**検証**: span・空のセル（`component: junction` の hidden か、セルの省略の扱いは実装 Issue で決める）・`direction` の扱い、列が揃うこと（Layout IR の矩形の x が列ごとに一致）、図 2 を grid で書いた fixture。

**大きさ・リスク**: M（engine 約 150 行、schema、fmt の順序、テスト）。リスクは低いが、#109 の 4 図では grid でなければ描けない図はなかった。

**判断**: 採るが、milestone の中で優先度は最も低い（§5 の 9 番）。auto の折り返しは採らない（Skill の案内のまま）。

### 3.5 箱をまたぐ整列

**必要**: 図 1・4。図 4（U-Net）で concat の operator を encoder の箱と同じ高さにできず、skip の破線が最後に曲がった（B7）。図 1 で encoder の出力と decoder の Cross-Attention の高さを揃えられない。

**理想の YAML**:

```yaml
figure:
  layout:
    arrange: { ... }
    align:
      - { y: [ enc1, cat1 ] }              # 中心の y を揃える（水平な 1 本の線の上に並ぶ）
      - { y: [ enc-norm2, dec-cross ] }
      - { x: [ a, b ], at: start }          # 左端を揃える（at: center | start | end）
```

- `y: [...]` は「y が等しい」。配置の木の外（`figure.layout`）に置くのは、木をまたぐ関係だから（§2.1 の「配置は配置に書く」）。group の中だけの整列も同じ書き方で書ける。

**試作（実測）**: 依存を足さない方式を試した（`align/solve.ts`）。

- 製品の配置エンジンの改変コピーに、項目の前（`lead`）と後（`trail`）に主軸の詰め物（strut）を足す入力を 3 か所のパッチで加えた。strut なしでは製品と同じ出力（テストで確認）。
- 固定点の反復: 制約ごとに、最も上（左）の項目の前に不足分の `lead`（その項目を下へ押す）と、最も下の項目の後に `trail`（終端揃えの箱の中で上へ押す）の 2 案を、その項目の経路上で「軸の向きの箱のうち、制約のほかの項目を含まない最も深いもの」に置いて配置し直し、全制約の残差の和が小さい方を採る。どの制約の残差も 0.01 unit 以下になる（和は 2 案の比較にだけ使う）か、改善がないか、50 回で止める。
- 最初の版は、図 1 で `gap: 0` の stack（Add & Norm とブロックの一体）の中に strut を入れて、ブロックと Add & Norm を引き離した。**`gap: 0` の箱には入れない**規則を足した（受け入れ条件に入れる）。

| 草案 | 制約 | 反復 / 配置の回数 | 残差 | strut | 解く時間（配置 1 回） | 大きさ（前 → 後） | 経路長・折れ（前 → 後） |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 図 4（U-Net） | 3（`y`） | 1 / 7 | 0 | `enc1` の前 148.0、`enc2` の前 32.0、`enc3` の前 32.0 unit | 1.06ms（0.15ms） | 57.7 × 108.7 → 57.7 × 110.6mm | 266.6 → 142.3mm、10 → 2 |
| 図 1 の別案（K,V を横から） | 1（`y`） | 1 / 3 | 0 | Cross-Attention の組の後に 24 unit | 0.69ms（0.20ms） | 83.4 × 122.2 → 83.4 × 126.5mm | 300.6 → 304.8mm、29 → 24 |

（`results/align.json`。時間は 9 回の中央値。前は同じ草案を整列なしで配置した値。）

図 4 は skip の破線 3 本がすべて水平の直線になり、#109 で使った隠れ junction の角・16mm の間隔の調整が要らなくなった（`previews/align-unet-before-after.png`）。図 1 の別案は K,V が encoder の出口から Cross-Attention の西へ 1 本の水平線になった（`previews/align-seq2seq-side-kv-before-after.png`）。

**kiwi との比較（判断）**: #86 §3.4 で @lume/kiwi 0.4.4（Cassowary、BSD-3、minify 12,641 bytes）を測った。kiwi を使うには、今の 1 パスの箱モデル（大きさを下から、位置を上から決める）を、すべての項目の位置を変数にした線形制約として書き直す必要がある（stretch・中央揃え・attach のはみ出しも制約になる）。strut の反復は、製品の配置をそのまま使い、足すのは「項目の前後の余白」という説明できる入力だけで、#109 の 2 図は 1 回の反復で解けた。決定的（Map の走査順・浮動小数の丸めは配置エンジンと同じ）で、1 図あたり 1ms 程度。**今回は kiwi を採らない**。strut で解けない形（両方の項目が終端揃えの箱の中で動けない、互いに矛盾する制約）は残差として検出し、診断にする。

**層**: schema・IR（`FigureIR.align`）・layout 段の検査（未知の ID、同じ要素の 2 回の出現、attach された要素は対象の位置に従う）・engine（strut の入力と反復。`src/layout/structured/align.ts`、案）・Skill。router / writer は変更なし。

**互換性**: 任意フィールド。`align` のない図は strut が空で、配置は今と同じ（改変コピーで確認した性質をそのまま製品のテストにする）。

**検証**: 図 4・図 1 の別案で残差 0（テストで固定）、矛盾する制約・動かせない制約が位置付きの診断（`layout/unsatisfied-align`、案。残差と、動かせなかった要素を示す）になること、`gap: 0` の箱に strut を入れないこと、決定性、1,000 個の乱数の制約で反復の上限と時間を記録。

**大きさ・リスク**: M（反復 約 150 行、engine の strut 約 20 行、検査・診断）。リスクは、制約が多い図で反復が収束しない（各回で残差は減るが 50 回で止まる）こと。上限と診断で扱う。

**判断**: 採る（strut の固定点反復）。kiwi は、等幅の強制や不等式の制約（「a は b より左」）が要るようになったら再評価する（§6）。

### 3.6 数式のアクセント

**必要**: 図 2・4。`\hat` `\tilde` が `component/invalid-math` になり、`x'` と直接入力の `ŷ` で代用した（B5。v0.4.1 で Skill に代替を書いた）。

**理想の YAML**: `label: '$\hat{y}$'`、`'augmented $\tilde{x}$'`、`'$\bar{x}_t$'`、`'$\vec{v}$'`。引数は 1 文字か 1 コマンド（`\hat\theta`、`\hat{\theta}`）。複数文字の引数（`\hat{xy}`、`\widehat`）は `component/invalid-math` のまま（幅のあるアクセントは段階 C の MathJax の再評価で扱う。§6）。

**フォントの事実（実測、`measure/accents.ts`、`results/accents.json`）**:

| フォント | 結合アクセント（U+0302 0303 0304 0307 0308 20D7） | 幅 | GPOS の feature | MATH 表 | 合成済み文字 ŷ ỹ ȳ ẏ ÿ |
| --- | --- | --- | --- | --- | --- |
| STIX Two Text Italic | すべてあり | すべて 0 | `kern` `mark` `mkmk` | なし | ȳ 以外あり |
| STIX Two Math | すべてあり | すべて 0 | `kern` のみ | あり | ȳ 以外あり |
| BIZ UDPGothic | U+0307・20D7 なし | 0.5em | なし | なし | — |

Sumi の出力は、SVG に埋め込むサブセットが `GSUB` / `GPOS` を持たず（設計 §6.23）、PDF / 画像方式 PPTX は数式フォントから `GSUB` / `GPOS` を外して渡す（§6.24）。つまり**どの出力でも GPOS の mark の位置合わせは効かない**。

**描画の比較（実測）**: y・x・θ・W に 6 種のアクセントを、4 方式で、製品の PDF エンジン（画像方式 PPTX と同じ resvg）と Chrome で描いた（`previews/accents-engine-ABCD.png`、`accents-chrome-ABCD.png`）。

| 方式 | 内容 | 結果 |
| --- | --- | --- |
| A | 基底の後に結合文字（GPOS なし。Sumi の今の出力の条件） | 小文字（y・x）は両方の描画系で基底の上に乗る。**背の高い基底（θ・W）ではアクセントが字形の上端に接する・重なる**（結合文字の既定の位置が x-height 用のため。目視） |
| B | A と同じで GPOS あり（参照） | θ・W でもアクセントが上に上がる（目視）。Sumi の出力ではこの条件にならない |
| C | **Sumi が位置を決める**: 基底の字形の箱（`glyf`）の中央に、斜体の傾き（`post.italicAngle` −12°）の分を足し、アクセントの字形の下端を基底の上端の 0.04em 上に置く。アクセントは別の位置の文字 | 両方の描画系で同じ見た目。θ・W でも重ならず、B とほぼ同じ（目視） |
| D | A の結合文字だけを `<tspan dy>` で上げる（今の run の仕組みの範囲） | PDF エンジンでは良いが、**Chrome ではアクセントが基底から外れて右に出る**（別の tspan に分かれた結合文字を基底に付けない。目視）。描画系で結果が違うので不可 |

**実装の方式（判断）**: C を採る。今の run の仕組み（§6.24: 行ごとに絶対位置の `<tspan x y>`、run は `dy` だけ、`dx` は使わない）では、アクセントを基底の上に戻す水平の移動が書けない。そこで、アクセントのある行は、アクセントと、その後の残りの run を**それぞれ絶対位置の chunk**（`<tspan x y>`）にする。`text-anchor: middle` は chunk ごとに効くので、各 chunk の x を「その chunk の中央」にすれば、ブラウザと usvg で同じ位置になる（Sumi は run の幅を計測しているので中央が分かる）。

- **計測**: アクセントの幅は 0 のまま（結合文字の advance が 0）。行の箱の上端はアクセントの字形の上端まで広げる（背の高い基底では ascender を超えうる）。
- **PDF の抽出**: 内容ストリームの順は基底 → アクセントなので、`y` U+0302（分解形）として抽出される。NFC の `ŷ`（U+0177）では検索に当たらない場合がある（閲覧アプリ依存）。
- **#112 の run の書体**: アクセントは Text Italic と Math の両方が持つので、基底と同じフォントの run にする（`withCodePoints()` の空白の割り当ての対象にならない）。#112 の `label-math-fonts.test.ts` の行列にアクセントを加える。
- **編集可能 PPTX**: 基底と結合文字を同じ `<a:r>` に入れる（PowerPoint は自分で shaping する）。確認は実装 Issue（今回は未確認）。

**提案の表現そのものの試作（方式 E、実測）**: C の比較は別々の `<text>` で描いたので、提案の表現（1 つの中央揃えの `<text>` の中に、絶対位置の chunk を並べ、run は `dy` だけ）でも描いた。ラベルは 3 つで、BIZ UDPGothic・Text Italic・Math の混在、Math の基底（`\hat\nabla`）、アクセントの後の下付き（`\hat\theta_t`）、日本語を含む。PDF 側は #112 と同じく、各フォントの後に「ほかの run の文字を空白の字形に割り当てて改名したコピー」を渡した（`previews/accents-E-engine-vs-chrome.png`）。

- 3 つのうち 2 つは、製品の PDF エンジンと Chrome で同じ位置に描けた（目視）。
- `予測 ŷ と x̄` は、PDF エンジンだけで ` と ` の先頭の空白が消え、後ろの `x` が左に詰まって、`x` の上のバーが右にずれた。**usvg は chunk の先頭の空白を畳み、Chrome は畳まない**ため。実装では chunk を空白で始めない（空白は前の chunk の末尾に付ける）ことを受け入れ条件にする。
- PDF の抽出（`pdftotext -raw`）は `loss θ̂t = ỹ` / `∇̂f ≤ W ⃗` / `予測 ŷ と x̄` で、基底 → 結合文字の順。`W` と U+20D7 の間にだけ空白が入った（Poppler の抽出の判断）。

**層**: label の構文（`src/core/label/math.ts`・`symbols.ts`）・run と計測（`runs.ts`、`text.ts`）・writer（アクセントの chunk）・inspect（行の中の絶対位置の chunk を読む。今は行の `<tspan>` の中に `class`・`style`・`dy` だけの run を想定）・幾何 lint（アクセントの箱）・PDF の検査（run ごとの書体と位置）・PPTX・Skill。

**互換性**: 今エラーになる記法が通るようになるだけ。既存の図の出力は不変。

**検証**: 6 種 × 基底（小文字・大文字・ギリシャ・添字付き）で、SVG の chunk の位置が計測と一致、ヘッドレス Chrome と製品の PDF エンジンで字形の位置が一致（C の試作と同じ比較を CI 外の検証記録に）、PDF の抽出、`label-math-fonts.test.ts` の拡張、`lint/missing-glyph` が出ないこと。

**大きさ・リスク**: M（構文 約 40 行、writer と inspect の chunk 約 120 行、テスト）。リスクは inspect の契約の拡張（§6.3）と、アクセントのない図の出力を変えないこと（chunk はアクセントのある行だけ）。

**判断**: 採る（方式 C）。合成済み文字（`ŷ`）への置き換えは ȳ がない・θ̂ がないので採らない。

### 3.7 密な図での交差・遠回りの削減

**必要**: 図 3（目視）。v0.4.1 で交差 9（`checkRoutes().crossings` の件数。交差する点ごとの、別のネットの辺の組。同じ組が 2 点で交われば 2 件で、図 3 の 9 件は 8 組・4 点）。Auth → Metadata DB の遠回り。同じ口に入る辺が束ねられて、どのワーカーがどのストアへ行くか読めず、#109 では 6 本の辺に anchor を手で付けた（計 11 個）。

**方法（実測）**: ルータの改変コピー（`route/variant.ts`。費用の上書き、辺の順序、格子点ごとの履歴の費用、端点の辺の選択、の 4 つのフック）で各案を試し、製品の `checkRoutes` で数えた（`route/bench.ts`、`results/route.json`）。

- 交差（組）: `checkRoutes().crossings` の件数（交差する点ごとの辺の組。3 本のバスと 1 本の交差は 3、同じ 2 本が 2 点で交われば 2 と数える。#109 の「9」と同じ数え方）。交差（点）: 読む人に見える交差の場所の数。
- excess: 各辺の「経路長 − 両端のマンハッタン距離」の和（mm）。遠回り: excess が 10mm を超える辺の数。
- 時間: 戦略全体（反復する案は間の検査も含む）の中央値（9 回、合成図は 3 回、反復する案の合成図は 1 回）。

| 案 | 図 3（#109 最終、anchor 11 個） 交差 組/点・excess・遠回り・時間 | 図 3（anchor なし） | 合成 columns（100 node・129 辺） 点・経路長・時間 | 合成 grid（100・146） 点・経路長・時間 |
| --- | --- | --- | --- | --- |
| v0.4.1（製品） | 9/4・18.4mm・1・11.7ms | 9/4・16.2・1 | 23・2700mm・41ms | 1233・17547mm・351ms |
| 交差の費用 300 → 600（〜3000 も同じ） | 8/3・62.5・2 | 8/3・60.3・2 | 22・2727・48ms | 1211・17859・390ms |
| 折れの費用 40 → 20 | 9/4・18.4・1 | 9/4・18.6・1 | 23・2702 | 1228・17567 |
| 順序: 長い辺から | 11/6・36.3・2 | 9/4・58.7・3 | 22・2698 | 1333・17643 |
| 順序: 短い辺から | 9/4・31.1・1 | 11/5・52.7・2 | 23・2705 | 1187・17965 |
| 順序: 大きいネットから | 8/5・50.2・2 | 8/5・48.0・2 | 23・2687 | 1239・17461 |
| rip-up（衝突した辺を先に、最大 6 回） | 9/4・18.4・1・35.7ms | 9/4・16.2・1 | 23・2700・123ms | 1233・17547・1009ms |
| 交渉（PathFinder 型、交差点に +150 を蓄積、最大 8 回） | 7/4・27.6・1・99.9ms | 7/4・29.3・1 | 23・2696・591ms | 1233・17547・4079ms |
| 口の分散（fan-in） | 10/6・3.3・0 | 10/6・1.1・0 | 25・2679 | 1524・17628 |
| 口の分散（fan-in と fan-out） | 7/7・32.3・1 | 7/7・31.0・1 | 29・2676 | 1705・16573（**経路なし 6**） |
| 配置の木で辺を選ぶ | 9/4・18.4・1（**製品と同一**） | 8/3・51.7・3 | 24・**2536**（折れ 110 → 86） | 1169・**17016** |
| 配置の木 ＋ 口の分散（fan-in） | 10/6・3.3・0 | 10/6・**1.1・0**（折れ 48 → 40） | 24・2536 | 1513・16894 |
| 配置の木 ＋ 交差の費用 600 | 8/3・62.5・2 | **7/2**・95.8・**4** | 23・2563 | 1155・17519 |

各案の内容:

- **費用**: `ROUTE.cross`（交差・接触）を上げる、`ROUTE.bend` を下げる。
- **順序**: ルータは YAML の順に貪欲に引く（§6.22）。順序だけを変える。
- **rip-up**: 引いた後、交差・接触・重なりに関わった辺を先頭（または末尾）に移して全体を引き直し、最良を残す。
- **交渉**: 全体を引き直すたびに、交差が起きた格子点に履歴の費用を足す（自分のネットの費用 0 の辺以外のすべての一歩に加算。非負なので A\* の下界はそのまま）。
- **口の分散**: anchor のない端で、同じ口（要素・辺・点・向き）に別の要素から入る辺（fan-in）を、相手の位置の順に辺に沿って 1/(n+1) … n/(n+1) に並べる（anchor を付けたのと同じ）。今は 1 本の線に合流する。
- **配置の木で辺を選ぶ**: anchor のない端の辺を、2 つの要素を分ける配置の木の箱（共通の祖先の箱）の向きで決める（stack なら北 / 南、row なら東 / 西）。今は中心の差の大きい軸（`facingSide`）。

**読み取り**（数値は実測。「配置で決まる」「読みやすさ」は目視・推論による判断）:

- 図 3 の交差は**配置で決まる部分が大きい**。4 点のうち、`infer-api → infer-worker` が gateway の分岐を横切る 2 点と、Training API・Auth から Metadata DB への線が queue の下りを横切る 1 点、infer / train → registry / features の入れ替わり 1 点（#109 の anchor の選び方による）。単独の案は点を 3 未満にしなかった。組み合わせ（配置の木 ＋ 交差の費用 600）は anchor なしの図 3 で 2 点にしたが、excess が 16.2 → 95.8mm、遠回りが 1 → 4 に増えた。「交差の多くは配置で決まる」は、この結果と経路の目視からの推論（判断）で、下限を証明したものではない。
- 費用を上げると点は 1 減るが、経路が 44mm 延び（遠回り 1 → 2）、**図 2 では交差が 2 → 4、ラベルの衝突が 0 → 3 に悪化**した。
- 順序・rip-up は図によって良くも悪くもなり、一貫しない。交渉は組を 9 → 7 にするが点は 4 のまま、8 回引き直すので時間は約 8 倍（図 3 で 99.9ms、合成 grid で 4.1 秒）。
- 口の分散は、Auth → Metadata DB の遠回りの原因（合流した幹線は費用 0 なので、Auth からの線が Training API の線に合流しに回り込む）を消し、excess が 16.2 → 1.1mm、遠回り 1 → 0。各ワーカーの線が別々にストアへ入る。#109 で手で付けた anchor と同等に読める、というのは目視の判断（`previews/route-serving-draft-v041-vs-proposed.png`）。その代わり、合流していた線が別々に交差するので点は 4 → 6 に増える。fan-out まで分散すると合成 grid で経路のない辺が 6 本出た。
- 配置の木で辺を選ぶ案は、**作例 2・fixture 2・#109 の 4 図の計 8 図で経路がバイト単位で製品と同じ**（`route/same.ts`）。合成図では経路長が 6.1%（columns）・3.0%（grid）短くなった。anchor なしの図 3 単独では excess が増え（16.2 → 51.7）、口の分散と組み合わせると最良（1.1mm、折れ 40）になる。
- 交差は描いた図からは数えにくい（hidden junction との区別、§6.26）が、今は幾何 lint にも診断にも出ない（`checkRoutes` はテストだけ。§6.22 の判断）。

**判断**:

- **採らない**: 費用の調整、順序の変更、rip-up、交渉。単独では効果が 1 点以下で、遠回りが増えるか（図 2 の悪化）、時間が数倍になる。組み合わせ（配置の木 ＋ 費用）の 2 点減は、遠回り 4 本と引き換えなので採らない。§6.22 の「交差の最小化は貪欲」のままにする。
- **採る（Issue 7）**: 交差の報告。structured の描画で、別のネットの交差を `layout/edge-crossing`（**info**、辺の位置付き、相手の辺を related に。1 図あたりの件数に上限）として出す。hint は「辺の順序（先に書いた辺がまっすぐ）、anchor、配置（`gap`・箱の順序・`align`）」。交差の多くは配置で決まるので、作者（LLM）が直せる情報を出す方が、ルータで点を 1 つ減らすより効く。info にするのは、構造上避けられない交差（入れ替わり）もあるため。
- **利用者の判断（Issue 8、§8 Q1）**: fan-in の口の分散を既定にするか（Skill に書いた「同じ口に入る辺は合流する」を変える）。配置の木による辺の選択は、作例を変えず合成図で短くなるが、単独では図 3 を悪くするので、口の分散と一緒に入れる場合だけ採る。

**層**: 交差の報告は router（`checkRoutes` の交差の判定を製品の段に移す、または router が記録）と診断の stage `layout`、Skill。口の分散と辺の選択は `ports.ts`（`facingSide` の代わり、fan-in の振り分け）と Skill・設計 §6.22。

**互換性**: 交差の報告は info の診断の追加だけ（作例・fixture は交差 0 なので出ない）。口の分散を既定にすると、fan-in の合流を使う利用者の structured の図の経路が変わる（作例・fixture・#109 の 4 図のうち変わるのは図 3 だけ。v0.4.1 の #113 と同じ種類の変更として release note に書く）。

**検証**: 交差の報告は図 3 で 4 点・組の数がメッセージに出ること、作例で 0 件。口の分散は図 3 の anchor なし版で excess と遠回り、合成 2 図の時間と経路のない辺 0、作例のバイト一致。

**大きさ・リスク**: 交差の報告 S（約 80 行）。口の分散と辺の選択 S〜M（`ports.ts` 約 100 行）。合成 grid での口の分散（fan-in のみ）の時間は 351 → 440ms（+25%）。

## 4. 4 図の書き直しと効果

草案は `research/124-stage-b/figures/`。下ろした図（`lower.ts`: キャプション・凡例を展開、整列を解き、上端左右の見出しと辺の `labelAt` を適用。`labelSide`・下端の見出し・アクセントは描画に出ない）を、製品のルータで描いた値（`results/drafts.json`）。

「下ろした図の診断」は `checkFigure` と、**試作が描いた図そのもの**（整列・見出しと辺のラベルの位置を適用後、製品のルータ）の SVG を製品の finalize・inspect に通した幾何 lint（`geometryLint`）。

| 図 | 草案で使った新しい構文 | v0.4.1 の反応（`requires` なし） | 下ろした図の診断 | 大きさ（#109 → 草案） | 経路（#109 → 草案） |
| --- | --- | --- | --- | --- | --- |
| 1 エンコーダ・デコーダ | 見出し `top-left` ×2、`K,V` に `labelAt: start` | unknown-field `labelAt` 3 | 0 | 83.4 × 117.3 → 83.4 × 122.2mm（見出しを戻した分） | 遠回り 0 → 0、交差 0 → 0。見出しを上端中央で戻すと遠回り 1 になる |
| 1 の別案 | 上記＋`align: { y: [enc-norm2, dec-cross] }`、K,V を横から | unknown-field `labelAt` `align` 4（＋上記の engine の連鎖 5） | 幾何 lint の `label-collision` 2: `K,V`（`labelAt: middle`）が 4mm の列の間で encoder と decoder の両方の枠に掛かる（`checkRoutes` は数えない）。列の `gap` を広げる必要がある | → 83.4 × 126.5mm | 経路長 298.0 → 291.2mm、折れ 23 → 20、K,V は水平の 1 本 |
| 2 学習パイプライン | 見出し `top-left` / `top-right`、`caption` ×2、`legend`、`labelSide`、`\tilde{x}` `\hat{y}` | unknown-field `caption` `labelAt` `labelSide` 5、unknown 部品 `legend` 1 | 0 | 109.4 × 77.8 → 156.6 × 87.0mm（凡例を右下に置いた分。paper-double に収まる） | 交差 2 → 2、ラベルの衝突 0 |
| 3 システム構成図 | 見出し `top-left` ×5・`bottom`（GPU pool）、**anchor 0 個**（#109 は 6 本の辺に 11 個） | unknown-field `labelAt` 6 | 幾何 lint 2: GPU pool の見出し（`bottom` は試作していないので上端中央のまま）と `gRPC` の `label-collision`、Storage の見出し（`top-left`）を Inference workers → Model registry が横切る `edge-crosses-label`。後者は Storage に `top-right` か `bottom` を選ぶ必要がある（§3.1 の「角は図による」） | 159.6 × 119.4 → 159.6 × 125.8mm（見出しを group に戻した分） | 製品のルータ: 交差 7 組 / 4 点・遠回り 1。§3.7 の口の分散＋配置の木: 8 組 / 6 点・**遠回り 0・excess 1.1mm**・折れ 38 |
| 4 U-Net | `align` ×3、`legend`、`labelSide`、concat を木の中に | unknown-field `align` `labelSide` 3、unknown 部品 1 | 0 | 79.6 × 88.2 → 57.7 × 110.6mm（縦長になり、幅は 22mm 減） | 経路長 248.1 → 142.3mm、折れ 8 → 2、skip 3 本が水平 |

読み取り（判断）:

- **#109 の手直しの多くが不要になる**。図 1 の 2〜5 回目（見出しを消して側面の label にし、幅を詰めた）、図 3 の 5・8 回目（Storage への anchor、見出しの label 化と worker の anchor）、図 4 の 2〜5 回目（operator の attach、間隔、隠れ junction の角）が、それぞれ構文 1〜3 行で書ける（#109 の表との対応。判断）。
- 図 2 は、見出しの位置を誤ると（`top-left`）、今度は別の辺のラベルとぶつかる（§3.1）。位置の指定は万能ではなく、既存の lint が報告し、作者が角を選ぶ前提の機能である。
- 図 4 の草案は、operator を attach でなく配置の木の項目にしたことで、#109 の A4（attach が場所を取らない）を避けている。段階 B の整列は「木の中に置く」ことと組み合わせて使う、と Skill に書く。

## 5. Issue 分解（milestone「v0.5.0 — Paper figures stage B」）

**目標**: #109 の 4 図の草案（`requires: ">=0.5.0"`）が、そのまま error・warning ゼロで描け、SVG / PDF / 画像方式 PPTX が出ること。info は Issue 7 の交差の報告だけを許し、図ごとの期待件数を受け入れテストで固定する（図 3 の anchor なしの経路は Issue 8 の判断による）。**診断の互換性**: 既存の structured の図に交差があれば、Issue 7 で info が増える（出力のバイトは変わらない）。**互換性**: すべて Figure v1 への任意フィールド・部品の追加。新しいフィールドを使わない図の診断・D2・SVG・PDF・PPTX はバイト単位で変わらない（Issue 8 を既定で採る場合を除く）。新しい部品と作例は CONTRIBUTING の手順で gallery・examples に**追加**する。各 Issue の受け入れ条件には「既存の生成物は不変、意図した追加をコミットしたうえで `bun run gallery:check` が通る」を含める。

並びは優先順（#109 の頻度 → 費用の小ささ → 依存）。

1. **Position group labels with groups[].labelAt**
   - グループの見出しを、上端・下端の左・中・右の 6 か所から選べるようにする。structured は配置エンジンが見出しの帯を上端か下端に取り、auto は D2 の `label.near` に写す。幾何 lint の hint を `labelAt` に合わせる。
   - 依存: なし。
   - 受け入れ条件: 6 値 × 両エンジンの fixture で、inspect した見出しの箱が group の枠の内側の指定の位置にあり、幾何 lint 0 件／図 1 の草案（見出しあり）が診断ゼロ／Layout IR と D2 ソースの golden を追加。
   - 互換性: 省略時は今の位置（structured は上端中央、auto は左上）。既存の golden 不変。
   - 非対象: 枠の外・側面の見出し、見出しの回転、見出しの自動の位置選び。

2. **Position edge labels with labelAt and labelSide**
   - 辺のラベルを、始点寄り・中央・終点寄り（`labelAt`）と、進む向きに対して左右（`labelSide`）で指定できるようにする。指定の範囲の中だけで #116 の回避（線・枠・node を避ける候補）を行い、`middle` も回避を通す。auto では `layout/structured-only`。
   - 依存: なし。
   - 受け入れ条件: 3 × 2 の組み合わせを水平・垂直・L 字・短い最後の線分で検査（Layout IR でラベルの中心が指定の線分・側にある）／`checkRoutes` のラベル衝突 0／#116 の回帰テストが通る／図 2 の `update θ` に `labelAt: middle` を付けても loss の箱に重ならない。
   - 互換性: 省略時は今の配置。既存の golden 不変。
   - 非対象: auto でのラベル位置（矢じりのラベルの利用は後回し）、ラベルの回転、線の上に重ねるラベル。

3. **Support accents in label math**
   - `\hat` `\tilde` `\bar` `\dot` `\ddot` `\vec`（引数は 1 文字か 1 コマンド）。アクセントは Sumi が基底の字形の箱と斜体の傾きから位置を決め、アクセントのある行だけ絶対位置の chunk で書く。inspect・幾何 lint・PDF の run の検査・編集可能 PPTX を合わせる。
   - 依存: なし。
   - 受け入れ条件: 6 種 × 基底（小文字・大文字・ギリシャ・添字付き）で、SVG のアクセントの位置が計測と一致し、製品の PDF エンジンとヘッドレス Chrome で同じ位置（検証記録）／`label-math-fonts.test.ts` にアクセントを追加して PDF の run ごとの書体と位置が一致／PDF から基底と結合文字が抽出できる／複数文字の引数・`\widehat` は位置付きの `component/invalid-math`。
   - 互換性: 今エラーの記法が通るだけ。アクセントのない図の出力は不変。
   - 非対象: 幅のあるアクセント（`\widehat` `\overline`）、`\frac` などの組版（MathJax の再評価は段階 C）。

4. **Add group captions**
   - `groups[].caption` を、group の枠の下に中央揃えで描く。structured は配置の木の展開（group と label の stack）、auto は透明な外側の container の `label.near: outside-bottom-center`。
   - 依存: 1（見出しを下端に置く場合との間隔の規則を共有する）。
   - 受け入れ条件: 両エンジンでキャプションが枠の下の中央にあり、幾何 lint 0 件／展開で生まれた要素の診断が元の `caption` の位置を指す／図 2 の草案のキャプション。
   - 互換性: 任意フィールド。既存の golden 不変。
   - 非対象: 図全体のキャプション（LaTeX の責務）、`(a)` の自動採番、`component: panel`。

5. **Add a legend component**
   - 部品 `legend`（`props.entries` の各項目が `edge` か `node` のフィールドと `label` を持つ）。structured で、見本の線（hidden junction 2 点と辺）・見本の箱と label の stack に展開する。使われていない項目を lint で警告する。auto では `layout/structured-only`。
   - 依存: なし。
   - 受け入れ条件: 図 2・4 の草案の凡例が描け、見本の線が本物の辺と同じ破線・矢じり・線幅／全 Theme × variant の gallery を追加／`lint/unused-legend-entry`（案）の検査／ID の衝突が位置付きの診断。
   - 試験基盤の変更（範囲に含める）: 今の gallery の見本（`scripts/gallery/samples.ts`）と全部品の描画テスト（`src/compiler/testing.ts` の全 node 部品を auto の図に並べる fixture、`builtins-render.test.ts` は診断ゼロを要求）は、すべての部品を auto の普通の node として描く。structured 専用で `props.entries` が必須、しかも展開される `legend` をそのまま登録すると、これらが失敗する。engine を見て structured の図で見本を作る生成と、展開後の要素から元の部品・variant を見つける検査を足す（黙って除外しない）。大きさの見積もりはこの分を含めて M〜L。
   - 互換性: 新しい部品。gallery に追加。既存は不変。
   - 非対象: auto の凡例（D2 の `near` と grid で可能と確認済み。後回し）、行列の class の凡例（段階 C の `matrix`）。

6. **Align elements across arrange trees**
   - `figure.layout.align`（`{ y: [...] }` / `{ x: [...] }`、`at: center | start | end`）。配置エンジンに項目の前後の strut を足し、固定点の反復で解く。`gap: 0` の箱には strut を入れない。解けない制約は `layout/unsatisfied-align`（案）。
   - 依存: なし（9 と独立）。
   - 受け入れ条件: 図 4 と図 1 の別案で残差 0（golden）／`gap: 0` の箱の項目が整列の後も接したまま（strut を祖先の箱に置く必要がある図 1 の別案で検査。試作のテストと同じ）／停止の判定は制約ごとの最大の残差（和ではない）／矛盾する制約と動かせない制約が、残差と要素名付きの診断／`align` のない図の配置がバイト単位で不変／反復の上限と、乱数の制約での時間を記録。
   - 互換性: 任意フィールド。既存の golden 不変。
   - 非対象: 不等式の制約・等幅の強制・制約ソルバ（kiwi）、auto での整列。

7. **Report edge crossings in structured figures**
   - structured の描画で、別のネットの交差を `layout/edge-crossing`（info、辺の位置と相手の辺）として出す。hint は辺の順序・anchor・配置。Skill に読み方を書く。
   - 依存: なし。
   - 受け入れ条件: 図 3 で交差の点と組がメッセージから分かる／作例・fixture で 0 件／件数の上限（多い図で診断が溢れない）。
   - 互換性: info の診断の追加だけ。出力は不変。
   - 非対象: 交差の自動の削減（§3.7 で採らなかった案）。

8. **Spread fan-in ports and choose default sides from the arrange tree**（§8 Q1 の判断が要る）
   - anchor のない端で、別の要素から同じ口に入る辺を相手の順に辺に沿って並べる（合流しない）。anchor のない端の辺を配置の木の箱の向きで選ぶ。
   - 依存: 7（効果を交差の報告で確かめる）。
   - 受け入れ条件: 図 3 の anchor なし版で遠回り 0・excess 2mm 以下／作例・fixture・#109 の図 1・2・4 の経路がバイト単位で不変／合成 2 図で経路のない辺 0・時間を記録。
   - 互換性: fan-in の合流を使う structured の図の経路が変わる（release note に書く）。Skill の「同じ口に入る辺は合流する」を改める（合流させたい場合は junction）。
   - 非対象: fan-out の分散（合成 grid で経路のない辺が出た）、交差の最小化。

9. **Add a grid arrange box**
   - `grid: { columns, rowGap, columnGap, align, items }`、項目の `{ item, span }`。列幅・行高を揃える 1 パスの配置。
   - 依存: なし。
   - 受け入れ条件: span・方向・空のセルの規則を schema と診断で固定／列の x が揃う（Layout IR）／図 2 を grid で書いた fixture。
   - 互換性: 任意の新しい箱。既存の golden 不変。
   - 非対象: auto の折り返し、行方向の span、`free`（局所座標）の箱。

10. **Teach the Skill the stage-B syntax**
    - `references/structured.md`・`figure-format.md`・`layout-tips.md` に 1〜9 を追加し、#109 の回避策（見出しを消して attach、anchor で口を分ける、間隔の調整）を新しい書き方に置き換える。`src/cli/skill.test.ts` で作例を CLI に通す。
    - 依存: 1〜9。
    - 受け入れ条件: Skill の作例が CLI の検査を通る／#109 の 4 図の草案を Skill だけを読んで再現できる（短い dogfooding、記録を残す）。

リリースの準備（release note・版・tarball）は、v0.4.x と同じく別の Issue で行う。

## 6. 後回しにする項目

| 項目 | 理由（判断） |
| --- | --- |
| 拡大の引き出し線（`zoom`）、薄い表示（`variant: dim` の継承） | #109 の 4 図のどれでも必要にならなかった（Issue 本文の利用者判断 2026-10-27: 頻度順） |
| `component: panel` / `frame` | `labelAt: top-left` と `caption`、見出しのない group で代替できる |
| auto の凡例・辺のラベル位置 | D2 で作れること（`near` と grid、矢じりのラベル）は確かめたが、inspect と塗りの class の確認が要る。凡例とラベル位置が要った図は 4 図とも structured |
| auto の折り返し | D2 の grid の辺が中心を結ぶ直線で、ブロックを貫通する（#86 §3.1） |
| 見出しの外側・側面の位置、回転 | #109 で必要にならず、`attach` の label で代用できる |
| アイコンの大きさ（B6）、文字とアイコンを 1 つのノードに（B8）、`sublabel` | 4 図中 1 図。段階 C の `badge` と合わせて検討 |
| `free` ボックス、色つきの文字範囲、`textAlign`、`labelRotation` | 4 図で不要（#86 の図 C 向け） |
| 編集可能 PPTX の structured の改善（`p:pic`、角の丸め） | dogfooding で編集可能 PPTX を使っていない |
| 制約ソルバ（kiwi） | strut の反復で 4 図の整列が解けた。不等式・等幅の強制が要るときに再評価 |
| ルータの交渉・rip-up・費用の調整 | 効果が交差 1 点以下で、遠回りか時間が増える（§3.7） |
| 幅のあるアクセント・分数・根号 | 段階 C の MathJax の再評価 |

## 7. リスク

| リスク | 影響 | 対策 |
| --- | --- | --- |
| 位置の指定が別の衝突を生む（§3.1 の図 2） | 指定どおりに置くと別の辺・ラベルに重なる | 既存の幾何 lint で報告し、hint で別の値を示す。自動で動かさない |
| アクセントの chunk が inspect の契約を広げる | inspect・幾何 lint・編集可能 PPTX の読み取り | chunk はアクセントのある行だけ。CI 外でブラウザとの一致を検証記録に残す |
| 整列の反復が収束しない・遅い | 大きな図での時間 | 上限 50 回と診断。乱数の制約で時間を記録 |
| 展開（caption・legend）の要素が利用者に見える | 診断のパスや `--emit-d2` に知らない ID が出る | 予約した ID の形、診断は元のフィールドを指す |
| 口の分散を既定にすると経路が変わる | 利用者の structured の図の見た目 | 利用者の判断（§8 Q1）。release note |

## 8. 利用者の判断が必要な点

1. **fan-in の合流（Issue 8）**: 別の要素から同じ口に入る辺を、今の「1 本に合流」から「並べて入る」に既定で変えるか、opt-in（例 `figure.layout.ports: spread`）にするか、変えないか。変えると図 3 の遠回りと読みにくさが anchor なしで解消する（excess 16.2 → 1.1mm）が、交差の点は 4 → 6 に増え、合流を前提にした図の経路が変わる。
2. **structured の見出しの既定**: 今の上端中央のままにするか（提案）、auto に合わせて左上にするか（`examples/dit-block` の golden が変わる）。
3. **grid（Issue 9）を v0.5.0 に入れるか**: 4 図では grid でなければ描けない図はなかった。後回しにしてもよい。

## 付録: 再現

```sh
bun install --frozen-lockfile
bun run d2:install
bun research/124-stage-b/route/bench.ts --record
bun research/124-stage-b/route/same.ts sides-tree ports-fan-in cost-cross-600
bun research/124-stage-b/align/run.ts --record
bun research/124-stage-b/measure/accents.ts --record
bun research/124-stage-b/measure/d2-probes.ts --record
bun research/124-stage-b/drafts.ts --record
bun test research/124-stage-b
```

詳細は [研究ディレクトリの README](../../research/124-stage-b/README.md)。
