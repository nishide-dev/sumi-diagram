# #18 カスタム SVG コンポーネントの合成 — 調査メモ

- 対象 Issue: [#18](https://github.com/nishide-dev/sumi-diagram/issues/18)（親: #1。関連: #5、#9、#11、#13）
- 前提: D2 CLI v0.9.0（`.sumi/bin/d2`、ELK）、Sumi `main`（v0.1.0 + #49）、同梱フォント BIZ UD Gothic
- PoC: [`research/18-custom-svg/`](../../research/18-custom-svg/README.md)（製品のコードからは参照しない）
- 座標の単位は SVG の user unit（= D2 unit、1 unit = 0.5pt。§5.1）

## 0. 結論

**推奨: 「プレースホルダ矩形 + Sumi 側での輪郭の合成」（方式 (a)）を、v1 互換の追加として正式実装する。** 具体的には次のとおり。

1. カスタム部品は D2 に `shape: rectangle` のプレースホルダとして出力する。この矩形が **footprint**（レイアウト用の占有矩形）で、ELK の配置・エッジの経路・コンテナの包含はすべて footprint について決まる。
2. 輪郭は **純関数の outline renderer**（footprint の矩形 → レイヤー・輪郭・安全領域）が作る。renderer は幾何だけを返し、塗りや線は Sumi が Theme の解決結果（プレースホルダに D2 が書いた属性）から付ける。renderer は SVG の文字列を返さない。
3. 描画後に `g.shape` の中身だけを差し替え、ラベルを安全領域の中心へ移し、そのカスタム部品に接するエッジの端点を **最後の線分の向きに沿って輪郭まで延ばす**。
4. ラベルが安全領域に収まる footprint を得るため、カスタム部品を含む図は **2 パスで描画**する（1 回目に D2 が決めたラベル込みの箱から footprint を求め、明示サイズとして 2 回目を描画する）。
5. 輪郭は常に footprint の内側に描く。これにより、`inspectSvg()` の bbox、コンテナの包含、幾何 lint の前提（§6.3・§6.5）がそのまま成り立つ。

PoC では、台形（`trapezoid`）と重なった矩形（`stack`）を 2 つの図で描き、次を確認した。

- 輪郭だけ差し替えた場合、台形の斜辺に入るエッジは **5.4pt / 10.7pt 手前で止まる**（理論上の最大は斜辺の水平オフセット = 16pt）。端点を延ばすと、12 端点すべてで「端点 → 輪郭」の距離が D2 の元の「端点 → footprint」の距離（1〜4 unit）と一致した。
- 合成後の SVG は `inspectSvg()` を通り、カスタム部品の bbox はプレースホルダと完全に一致した。幾何 lint は合成前後とも 0 件。出力はバイト単位で決定的。

固定位置のポート（カスタムポート座標）は、D2/ELK でエッジを特定の点に向けられない（#9）ため **v1 では提供しない**。端点は「ELK が選んだ辺上の位置から、線分の向きに輪郭まで延ばした点」とする。

## 1. 占有矩形と描画する輪郭の分離

### 1.1 候補と比較

| | (a) プレースホルダ矩形 + 後処理で合成 | (b) `shape: image` + data URI の SVG | (c) D2 の既存機能（`style.*`・`class`・既存 shape） | (d) D2 を使わない経路 |
| --- | --- | --- | --- | --- |
| 輪郭の自由度 | 任意（footprint 内の多角形・曲線、複数レイヤー） | 任意（画像として） | D2 の shape 一覧と `style.multiple` だけ。台形はない | 任意 |
| Theme のスタイル | プレースホルダの塗り・線をそのまま使える | 効かない（画像の中に色を焼き込む。D2 の CSS クラスも `stroke` / `fill` 属性も `<image>` の中には及ばない） | 効く（D2 の範囲で） | 自前で実装 |
| テキストの安全領域 | D2 が footprint の中央に置いたラベルを Sumi が移す。footprint の大きさは 2 パスで決める | 既定ではラベルが**図形の外（下）**に出る。`label.near: center-center` で中に入るが、画像の形は考慮されない | D2 の shape ごとの規則 | 自前 |
| 決定性 | 純関数 + 決定的な D2 出力 → 決定的（確認済み） | 決定的 | 決定的 | 自前 |
| 幾何 lint・inspect | `g.shape` に `<path>` を描くので inspect がそのまま読める。bbox は footprint と一致 | `<image>` は inspect が `svg/unsupported-geometry` で拒否する | そのまま | 作り直し |
| エッジの接続 | footprint の辺で止まる → Sumi が輪郭まで延ばす（§2） | 画像の外接矩形で止まる（輪郭は無視） | D2 が shape の実際の輪郭まで切る | 自前（ポートも可能） |
| D2 への依存 | §6 の SVG 契約の範囲（§4） | `<image>` の出力形式 | D2 の shape の定義そのもの | なし |
| 実装量 | 中（後処理 + 2 パス + lint の対応） | 小 | 小（ただし表現できない） | 非常に大（レイアウト・ルーティング・SVG 出力） |

### 1.2 根拠（D2 v0.9.0 の実測。`research/18-custom-svg/probe-d2.ts`）

- **(a)**: `shape: rectangle` に `width: 160; height: 70` を付けると、出力は `g.shape > rect x=162 y=53 width=160 height=70` で、明示サイズがそのまま使われる。ELK が同じ辺に入る 2 本のエッジを辺の高さ方向に散らす（y = 76.3 と 99.7）。Sumi の経路でも同じで、PoC の footprint（台形 157 × 80、stack 102 × 77 など）は inspect の bbox と一致した。
- **(b)**: `shape: image; icon: "data:image/svg+xml;base64,…"` は `g.shape > image x=140 y=12 width=160 height=70` になり、ラベルは `text y=103`（図形の下端 82 より下）に描かれる。`label.near: center-center` なら `y=65.5`（中）。`<image>` には `stroke` / `fill` / `class` が付くが画像の中には効かない。エッジは画像の外接矩形で止まる（`… → (136, 60)`、画像の左端 140）。
- **(c)**: D2 の組み込み shape は、エッジを**実際の輪郭まで切る**。`step`（左辺が内側にくぼむ）に入るエッジは、くぼみの頂点 x=175 の 4 unit 手前（x=171）で止まる。`style.multiple: true`（D2 自身の「重なった矩形」。ずれは 10 unit 固定）では、入るエッジは手前の矩形の左辺（x=328）の 4 unit 手前、出るエッジは奥の矩形の右辺（x=423）の 2 unit 先から出る。ただし D2 に任意の輪郭を定義する手段はない（v0.9.0 の shape は固定の一覧で、`class` は D2 内のマクロであり CSS ではない。`style` は §4.1 の範囲）。`multiple` は §4.1 で、形状ごとの制約と固定オフセットを理由に公開しないと決めている。
  - SVG の `clip-path`（CSS / `<clipPath>`）で矩形を台形に切る案は、線（stroke）も一緒に切られ、斜辺に線が描かれないため使えない。
- **(d)**: ELK を直接使う（elkjs）か独自レイアウトにすれば、ポートを含めて輪郭どおりに扱える。しかし #1 の方針（D2 は初期のレイアウトバックエンド、独自レイアウトエンジンは初期スコープ外）に反し、依存の追加と単一バイナリへの影響も大きい。将来バックエンドを増やす場合に備え、manifest の拡張は D2 に依存しない形で定義しておく（§5）。

**判断**: (a) を採る。(b) は Theme・ラベル・inspect・エッジのいずれも満たせない。(c) は表現できる形が D2 の一覧に限られる（今の組み込み部品がまさにこれ）。(d) は将来の選択肢として残す。

## 2. カスタムポート座標と D2 のエッジ経路

### 2.1 ELK のエッジはどこで止まるか

- プレースホルダでは、エッジは footprint の辺で止まる。端点と辺の距離は D2 の約束どおりで、矢尻のある端は線幅に応じた距離（PoC の academic で 2 unit、minimal で 4 unit）、矢尻のない端は 1〜2 unit。
- ELK の経路は直交で、**最後の線分は辺に垂直**（PoC の 2 図・10 本のエッジの 20 端点すべてで、左右の辺には水平、上下の辺には垂直に入った）。同じ辺に複数のエッジが入ると、ELK は辺の全長に散らす。
- ポートは指定できない（#9: D2 は ELK のポートを公開していない）。エッジがどの辺のどこに入るかは ELK が決める。

### 2.2 輪郭が矩形でない場合の影響（PoC の実測）

| 図 | 端点 | footprint までの距離 | 輪郭までの距離 | 隙間 |
| --- | --- | --- | --- | --- |
| flow-right | Upload → **Filter**（台形の左の斜辺、上寄り） | 2 | 12.8 | **10.8 unit（5.4pt）** |
| flow-right | Import → **Filter**（同、下寄り） | 2 | 23.4 | **21.4 unit（10.7pt）** |
| flow-right | **Filter** → Jobs（右の斜辺） | 1 | 11.8 | 10.8 unit |
| flow-right | **Filter** → Rejected（右の斜辺、下寄り） | 1 | 22.4 | 21.4 unit |
| flow-right | Filter → **Jobs**、**Jobs** → Worker（stack） | 2 / 1 | 2 / 1 | 0 |
| flow-down | 台形・stack に接する 6 端点（上辺・下辺） | 2〜4 | 2〜4 | 0 |

- 台形の隙間は `s · y / h`（y は上端からの高さ、s は下端での斜辺の水平オフセット = 0.4h）で、エッジが入る高さで変わる。最大は s（80 unit の高さで 32 unit = 16pt）。矢尻が宙に浮くので、**矩形の端点のまま受け入れることはできない**。
- 上下方向の図では、台形の水平な辺にエッジが入るので隙間は出なかった。stack も、ELK が置いた端点ではすべて隙間 0 だった。ただし stack の段差の部分（角の 2 × 8 unit）に入れば最大 16 unit の隙間が出うる。

### 2.3 選択肢

1. **矩形の端点のまま**: 斜辺のある形では使えない（上表）。
2. **端点を輪郭まで延ばす（推奨）**: 最後の線分の向き `u` に沿って、footprint までの距離 `t_rect` と輪郭までの距離 `t_outline` を射線と多角形の交点で求め、端点を `u · (t_outline − t_rect)` だけ動かす。D2 が矢尻のために空けた距離がそのまま保たれ、マーカーの向き（最後の線分の向き）も変わらない。曲線で終わる場合は最後の制御点も同じだけ動かす。
   - 輪郭が footprint の内側にあるので、移動は常に「延ばす」方向で、延びた部分は footprint の中（安全領域の外）に収まる。他の要素やラベルとは新たに交差しない。
   - 斜辺には斜めに当たる（矢尻は水平のまま）。D2 自身も組み込みのひし形・平行四辺形・`step` で同じ描き方をしている。
   - 必要な条件: **footprint の各辺から内向きの射線が必ず輪郭に当たる**こと（PoC の smoke test で検査）。当たらない場合は端点を動かさず、診断（warning）にする。
3. **形を制限する**: 輪郭が footprint の 4 辺すべてに全長で接する形（矩形に装飾を足しただけの形）だけを許す。安全だが、台形のような形が作れない。2 の前提として「各辺に接する」ことは要求するが、全長で接する必要はない。

**カスタムポート座標（決まった点にエッジを付ける）は v1 では提供しない。** 後処理で端点を任意の点へ動かすと、最後の線分以外の経路（ELK が他の要素を避けて引いた線）と整合しなくなり、重なりや交差を作る。§3 の「ports は v1 スキーマから除外」の判断を維持し、ポートを扱えるバックエンドが入った時点で検討する（後続 Issue 6）。

## 3. テキストの安全領域・複数レイヤー・ネスト

### 3.1 安全領域

- D2 はラベルを footprint の中央に置き、明示サイズに自分の見積もり（bold での計測と CJK の過大な見積もり。§4.2）が収まらないとラベルを図形の**外**に出す（§6.5）。そのため footprint は「D2 の見積もりが安全領域に収まる」大きさでなければならない。
- PoC は **2 パス**で解いた。1 回目はプレースホルダを自動サイズで描画し、D2 が決めた箱（ラベル + D2 の余白。例: "Filter" は 93 × 61）を得る。renderer の `footprintFor()` がこの箱を安全領域に含む footprint（台形は `w + 2·0.4h`、stack は `w + 16, h + 16`）を返し、`props.width` / `height` として 2 回目を描画する。
  - 1 回目の箱には ELK による次数での拡大も入る（flow-right の "Filter" は 3 本のエッジで高さ 80、flow-down では 61）。
  - D2 の余白込みの箱を安全領域にするので、カスタム部品は組み込み部品より大きくなる（台形の幅 93 → 157）。D2 の見積もりを Sumi 側で再現して 1 パスにすれば小さくできるが、D2 の計測規則に依存する（後続 Issue 5）。
- ラベルの位置: 安全領域の中心が footprint の中心と違う形（stack は手前の矩形）では、`<text>` の `x` / `y`（と `<tspan>` の `x`）を差分だけ動かす。D2 の行送り（`dy`）や font class は変えない。対称な形（台形）は動かさない。
- 幾何 lint は、合成後の SVG を inspect し直してラベルを読むので、移動後の位置で検査される。ただし今の lint は形を `manifest.shape`（= `rectangle`）として扱うため、**ラベルが斜辺の外にはみ出しても `label-overflow` にならない**。正式実装では renderer の安全領域を lint の `labelArea` にする（§5.4）。

### 3.2 複数レイヤー

- 1 つの部品の複数レイヤー（stack の 3 枚）は、`g.shape` の中に背面から順に `<path>` を並べる。各レイヤーを塗るので、手前が奥を隠す。inspect は `g.shape` の全図形の外接矩形を bbox にするので、footprint と一致する（確認済み）。
- 要素をまたぐ重なり順（z-order）は D2 のまま（group → node → edge の宣言順）。合成は `g.shape` の中だけを変えるので、エッジが部品の上に描かれる関係は変わらない。
- 装飾（区切り線など、塗らない線）は、レイヤーの役割（§5.2 の `role`）で区別する。

### 3.3 ネスト

- **コンテナの中のカスタム部品**: footprint はコンテナ（group）の中に ELK が置き、輪郭は footprint の内側なので包含は保たれる（PoC の `Jobs`。`inspectSvg()` と lint の包含検査が通る）。
- **カスタムの group（コンテナの輪郭を変える）**: 今回は対象外。group の shape は `rectangle` 固定（§3）で、コンテナのラベルの位置（§6.6）と子の配置が矩形を前提にしているため。
- **複数の primitive からなる composite**: 2 種類を区別する。
  - **描画の合成**（1 つの footprint の中に複数の図形を描く。stack、ヘッダ付きの箱など）: outline renderer の `layers` で表す。レイアウト上は 1 ノード。
  - **レイアウトの合成**（複数のノードを決まった形に並べる。#1 の Recipe）: group + 子ノード + エッジに compile 時に展開する。ELK が子を配置するので、子の相対位置は保証できない（同層の間隔 20 固定・コンテナ内の direction 無視。#9）。outline renderer とは別の仕組みとし、本メモの範囲外とする。

## 4. D2 の SVG 後処理への依存

### 4.1 PoC が使う SVG の性質

| 使う性質 | §6 の契約で保証済みか | 壊れたときの検出 |
| --- | --- | --- |
| `<g class="… sumi-k-<enc> sumi-kind-node">` で要素を引ける | 済み（§2.4・§6.3。Sumi が付ける class） | `svg/missing-element` |
| `shape: rectangle` の `g.shape` の子が 1 つの `<rect>` | inspect が `rect` を前提に bbox を読む（§6.3）。「1 つの `<rect>`」は新しい約束 | 合成が明示的に失敗する（PoC は例外。正式には `svg/unsupported-geometry`） |
| `<rect>` の幾何以外の属性（`stroke`・`fill`・`class`・`style`・`stroke-dasharray` 等）が Theme の解決結果を表す | 新しい約束（属性名は列挙せず、`x`/`y`/`width`/`height`/`rx`/`ry` 以外をすべて写す） | ギャラリーの SVG のバイト比較（`gallery:check`） |
| `<text>` の `x` / `y`、`<tspan>` の `x` | 済み（§6.3・§6.5 の label の読み取り） | inspect の `svg/unsupported-geometry` |
| `path.connection` の `d` が M/L/C に正規化できる | 済み（§6.3） | 同上 |
| エッジの端点は footprint の辺の手前（矢尻・線幅の分）にあり、最後の線分が辺に垂直 | **契約外**（観察）。統合テストは「端点が要素の 12 unit 以内」だけを固定している（§6.3） | 射線が当たらない端点の診断、ギャラリーの比較 |

- 依存しないもの: `d2-<hash>`、D2 の数値書式（`d` は parsePath で読み、Sumi が書き直す）、エッジの経路の細部（最後の線分の向きだけを使う）、マスクとエッジラベル。
- 編集は厳格な XML parser（`src/render/xml.ts`）の offset を使い、`g.shape` の中身と 3 種類の開始タグ（`text`・`tspan`・`path.connection`）だけを差し替える。それ以外は D2 のバイトのまま（§6.3 の「非破壊の後処理」の方針を保つ）。

### 4.2 D2 を更新したときのリスク

- 契約外の観察（端点の位置・最後の線分の向き）が変わると、隙間や食い込みが出る。ELK の直交ルーティングの性質なので変わる可能性は低いが、D2 の更新時は CONTRIBUTING.md の手順（固定版の更新 → `bun run gallery` → 差分の確認）でギャラリーにカスタム部品を含めておけば、バイト比較で必ず気付ける。
- プレースホルダの描き方（`rect` 以外になる等）が変わった場合は、合成が明示的なエラーで止まる。黙って崩れた図を出さない。
- 塗りの属性を D2 の `<rect>` から写す方式は、D2 の Theme の対応（`stroke-dash` → `stroke-dasharray` の換算など）を Sumi が再実装しなくてよい反面、D2 の出力に依存する。代わりに ResolvedStyle から Sumi が属性を作る方式も取れる（Sumi が線幅・破線の換算を持つ）。**まずは写す方式**とし、組み込み部品と見た目が完全に一致することを優先する。D2 以外のバックエンドを入れる時点で、ResolvedStyle からの生成に切り替える。

## 5. 拡張点の提案（v1 互換の追加）

### 5.1 manifest

§3 には `render` フィールドはない（#5 の Issue 本文に「`primitive` と `composite` の区別」があるだけ）。次の任意フィールドを追加する。省略時は現在と同じ（D2 の `shape` で描く）なので、既存の manifest・Figure・Theme に影響しない。

```ts
interface NodeManifest {
  // …既存のフィールド…
  shape: NodeShape;        // render があるときは "rectangle"（プレースホルダ）に限る
  sizing: NodeSizing;      // render があるときは "auto"（縦横比は renderer の footprint() が決める）
  render?: OutlineRender;  // 新規（任意）
}

interface OutlineRender {
  type: "outline";         // 将来: "composite"（レイアウトの合成。§3.3）など
  /** OutlineRenderer の正規 ID（`<namespace>/<name>`）。Registry に登録済みのものだけ */
  renderer: string;
  /** renderer 固有の固定パラメータ（台形の傾き、stack の枚数など）。renderer の Zod スキーマで検証 */
  params?: Record<string, number | boolean | string>;
}
```

- manifest の検証（`register`）: `render` があれば `shape: "rectangle"`・`sizing: "auto"` であること、renderer が登録済みで `params` が通ること。違反は manifest の error（既存の `register` と同じ扱い）。
- 利用者が props でパラメータを変える（`props.layers` など）のは後回しにする。必要になったら、renderer が props のスキーマを持ち、manifest の props に合成する。
- `type: "svg"` という名前は使わない。renderer が返すのは幾何で、SVG の断片ではないため（§5.5 の安全性とも関係する）。

### 5.2 renderer API

```ts
interface OutlineRenderer {
  id: string;              // 正規 ID（例 "sumi/trapezoid"）
  version: 1;
  params: z.ZodObject;     // strict
  /** D2 が決めたラベルの箱（余白込み）→ それを安全領域に含む footprint の大きさ（単調増加） */
  footprint(label: { width: number; height: number }, params: P): { width: number; height: number };
  /** footprint → 描画。純関数・決定的。すべての座標は footprint の内側 */
  draw(footprint: Rect, params: P): {
    /** 背面から順。path は M / L / C / Z だけ（inspect が読める範囲。A は使わない） */
    layers: { role: "body" | "line"; path: PathSegment[] }[];
    /** エッジが接する輪郭（単純多角形。凸でなくてよい）。footprint の各辺から内向きの射線が必ず当たること */
    outline: Point[];
    /** ラベルを置く矩形。その中心にラベルを描く */
    safeArea: Rect;
    /** 幾何 lint の衝突判定に使う凸領域。省略時は outline の凸包 */
    collision?: Region;
  };
}
```

- renderer は Theme を受け取らない。**塗り・線は Sumi が付ける**: `role: "body"` は塗り + 線、`role: "line"` は線だけ（`fill="none"`）。値はプレースホルダの属性（= ResolvedStyle）から写す（§4.2）。これで、Theme・variant（emphasis の太線、muted の色、dashed）がそのまま効き、Theme に新しいプロパティは要らない。
- ResolvedStyle の `radius` はカスタム輪郭には効かない。Theme で 0 以外を指定していたら、`theme/inapplicable-property` と同様の warning にするか、renderer が角丸を描くかを正式実装で決める（PoC では無視）。
- 将来、レイヤーごとに色を変えたくなったら（stack の奥を薄くするなど）、Theme の component 設定に `layers.<role>` のような部分スタイルを追加する。v1 の Theme 形式への互換な追加になる。
- 座標の数値は小数 3 桁に丸めて書き、決定性を保つ（PoC と同じ）。

### 5.3 パイプライン

```
compile → (カスタム部品があり明示サイズがなければ) D2 で 1 回目 → footprint を IR に反映
        → D2 → finalize → inspect（生）→ compose（輪郭・ラベル・エッジ）→ inspect（合成後）
```

- compose は `renderFigure()` の中に置き、`sumi render`・`sumi lint --geometry`・ギャラリーが同じ経路を通る（PoC の 2 パスを IR の明示サイズとして行う。YAML は書き換えない）。
- finalize の契約（§6.3「root の開始タグとメタデータ以外は D2 のバイトのまま」）を、「加えて、カスタム部品の `g.shape` の中身・そのラベルの `x`/`y`・接するエッジの `d` を変える」に改める。メタデータには合成の有無を表す属性を足すことを検討する（`format` を上げずに追加できる）。
- 利用者が明示サイズを付けた場合は 1 パスで、その footprint の安全領域にラベルが入らなければ `geometry/label-overflow`（renderer の安全領域で判定）とする。

### 5.4 catalog・gallery・幾何 lint

- **catalog**（`sumi catalog --json`）: 部品に `render: { type: "outline", renderer }` を出す。Skill と利用者が「D2 の shape ではなく Sumi が描く部品」だと分かるようにする。
- **gallery**: サンプルはカタログから自動生成されるので、compose が `renderFigure()` に入れば追加の作業はない。全 Theme × 全 variant の SVG がバイト比較の対象になり、D2 更新時の検出網になる（§4.2）。
- **幾何 lint**: `GeometryElement` の `outline` / `labelArea` を、`shapeOutline(shape, bbox)` / `labelArea(shape, bbox)` の代わりに renderer の `collision` / `safeArea` から作る。今の `Region` は凸領域なので、stack のような凹んだ輪郭は凸包（または footprint）で近似する。新しい規則候補: 射線が輪郭に当たらずエッジの端点を動かせなかった場合の warning（`svg/` か `geometry/` かは正式実装で決める）。

### 5.5 外部のコンポーネントを許す場合の安全性

外部の部品（パッケージ・ユーザー定義）を許すのは先の話だが、次の方針を残す。

- **SVG の断片は受け付けない。** 外部の renderer も「幾何（正規化座標の多角形・M/L/C/Z のパス）+ 安全領域」の宣言的な JSON で定義させる。スクリプト・外部参照・CSS が入り込む余地がない。
- それでも SVG を取り込む場合は、厳格な XML parser（DTD・entity・処理命令を拒否。§6.3）で読み、要素を `g`・`path`・`rect`・`circle`・`ellipse`・`polygon`・`polyline`・`line` に、属性を幾何の属性に限る許可リストで再構成する（元のテキストは出力しない）。`script`・`style`・`foreignObject`・`image`・`use`・`a`、`href` / `xlink:href`、`on*`、`style` 属性、`url(` を含む値、`transform`、円弧 `A` は拒否する。要素数・パスの長さに上限を設ける。塗りは Theme からだけ付ける。
- 実行可能なコード（TS の renderer）を外部から読み込むことはしない（単一バイナリ配布と、図の再現性のため）。

## 6. 推奨方式・リスク・採らなかった案

### 6.1 推奨

§0 のとおり (a) を採る。最初に入れる組み込み部品は、PoC と同じ汎用形状（台形、重なった矩形）に限り、分野固有の形は入れない。

### 6.2 リスク

| リスク | 影響 | 対策 |
| --- | --- | --- |
| D2 の更新で端点の位置や最後の線分の向きが変わる | 隙間・食い込み | ギャラリーのバイト比較、射線が当たらない端点の診断。§4.1 の観察を統合テストで固定する |
| 2 パスの描画 | D2 を 2 回呼ぶ（1 回 20ms 程度。#9） | カスタム部品があり明示サイズがない図だけ。後続 Issue 5 で 1 パス化を検討 |
| カスタム部品が組み込み部品より大きい | 図が広くなる | 安全領域の定義を詰める（D2 の余白の一部は斜辺の外にはみ出してよい等）。後続 Issue 5 |
| lint が形を矩形として扱う | 斜辺へのはみ出しを検出しない | 正式実装の最初の段階で lint に renderer の情報を渡す（後続 Issue 3） |
| 斜辺に矢尻が斜めに当たる | 見た目 | D2 の組み込み shape と同じ描き方で、許容する |
| エッジの端点を延ばす区間が他のエッジと重なる | 見た目 | footprint の内側・安全領域の外に限られ、ELK が辺上で端点を離しているので、PoC では起きなかった。発生しうる形（深い凹み）は「各辺から射線が当たる」条件で制限する |

### 6.3 採らなかった案

- **`shape: image` + data URI**（§1.2）: Theme が効かない、ラベルが外に出る、inspect が `<image>` を拒否する、エッジが画像の外接矩形で止まる。
- **D2 の `style.multiple` などで近似**: D2 の固定オフセットと shape ごとの制約に縛られ、台形など一般の形は作れない（§4.1 で非公開と決めた理由と同じ）。
- **`clip-path` で矩形を切る**: 輪郭の線が描かれない。
- **端点を任意のポート座標へ移す**: ELK の経路と整合しない（§2.3）。
- **renderer が SVG の文字列を返す API**: Theme の適用を renderer ごとに実装することになり、外部の部品を許すときにサニタイズが必要になる。幾何だけを返させる。
- **D2 を使わないレイアウト**（elkjs の直接利用・独自エンジン）: #1 の方針と依存・配布への影響。将来バックエンドを増やす時点で再検討する。

## 7. 後続 Issue の提案

番号は依存の順。1〜4 が正式実装、5〜7 は調査・任意。タイトルは英語、本文は日本語（Issue テンプレートの形）。

### 1. Define the outline renderer contract and the manifest `render` field

```markdown
## 目的
D2 の標準形状にない汎用形状を Sumi 側で描くための契約（manifest の `render` と OutlineRenderer API）を、v1 互換の追加として定義する。#18 の調査メモ（docs/research/18-custom-svg-components.md §5.1・§5.2）に基づく。

## 内容
- NodeManifest に任意フィールド `render: { type: "outline"; renderer; params? }` を追加する（省略時は従来どおり）
- `render` がある場合は `shape: "rectangle"`・`sizing: "auto"` であることを `register` で検証する
- OutlineRenderer（`footprint()`・`draw()` の純関数。幾何だけを返す）と、その Registry（組み込みのみ）を実装する
- `sumi catalog --json` に `render` を出力する
- 設計文書 §3 を更新する

## 受け入れ条件
- [ ] 既存の manifest・図・ギャラリーの出力が変わらない
- [ ] 不正な `render`（未知の renderer、shape の不一致、params の誤り）が manifest の error になる
- [ ] renderer の出力が footprint の内側にあり、各辺からの内向きの射線が輪郭に当たることをテストで検査する
- [ ] catalog の JSON と Skill の記述が一致する（`src/cli/skill.test.ts`）

## 関連
#18、#5
```

### 2. Compose custom outlines in the render pipeline

```markdown
## 目的
`render.type: "outline"` の部品を、プレースホルダ矩形のレイアウトと SVG の後処理で描く。#18 の PoC（research/18-custom-svg/）を製品の経路に入れる。

## 内容
- カスタム部品を含み明示サイズのない図は 2 パスで描画し、1 回目の D2 の箱から renderer の `footprint()` で明示サイズを決める（IR に反映。YAML は変えない）
- `renderFigure()` に compose 段を追加する: `g.shape` の中身をレイヤーに置き換え（塗りはプレースホルダの属性から写す）、ラベルを安全領域の中心へ移し、接するエッジの端点を最後の線分に沿って輪郭まで延ばす
- 合成後の SVG を inspect し直す
- プレースホルダが想定と違う形（`g.shape > rect` 1 つでない）なら明示的な error、射線が輪郭に当たらない端点は warning
- 設計文書 §6.3（finalize の契約）を更新し、D2 の端点の性質（§4.1 の観察）を統合テストで固定する

## 受け入れ条件
- [ ] 出力がバイト単位で決定的
- [ ] カスタム部品の bbox が footprint と一致し、コンテナの包含・既存の統合テストが通る
- [ ] エッジの端点と輪郭の距離が、D2 の端点と footprint の距離と一致する（許容誤差 0.01 unit）
- [ ] カスタム部品を使わない図の出力は変わらない（`bun run gallery:check`）

## 関連
#18、#11、後続 1
```

### 3. Teach the geometry lint about custom outlines

```markdown
## 目的
幾何 lint がカスタム部品を矩形としてではなく、renderer の輪郭と安全領域で検査するようにする。

## 内容
- `GeometryElement` の `outline` / `labelArea` を、カスタム部品では renderer の `collision`（省略時は輪郭の凸包）/ `safeArea` から作る
- `label-overflow`・`node-overlap`・`label-collision` などが新しい領域で正しく動くことを確かめる
- 必要なら、エッジの端点を輪郭へ延ばせなかった場合の規則を追加する（docs/lint-rules.md を更新）

## 受け入れ条件
- [ ] 台形の斜辺の外にはみ出すラベルが `geometry/label-overflow` になる
- [ ] 既存の fixture・examples に新しい診断が出ない

## 関連
#18、#13、後続 2
```

### 4. Add generic trapezoid and stack components

```markdown
## 目的
outline renderer を使う最初の組み込み部品として、汎用形状の台形と重なった矩形（書類・レイヤーの束）を追加する。

## 内容
- `sumi/trapezoid`、`sumi/stack`（名前は要検討）の manifest と renderer
- CONTRIBUTING.md「部品の追加・変更」のチェックリスト（全 Theme × 全 variant、ギャラリーの再生成、テスト、Skill の記述）

## 受け入れ条件
- [ ] 全組み込み Theme・全 variant で描画でき、ギャラリーのサンプルが幾何 lint を含めて診断ゼロ
- [ ] 左右・上下の向き、コンテナの中で、エッジが輪郭に接する

## 関連
#18、後続 1〜3
```

### 5. Investigate single-pass sizing for custom outlines

```markdown
## 目的
カスタム部品の footprint を、D2 を 2 回呼ばずに決められるか検証する。あわせて、カスタム部品が組み込み部品より大きくなる問題を小さくする。

## 内容
- D2 v0.9.0 のラベルの見積もり（bold での計測、CJK の約 1.25em、shape 内の余白）を Sumi 側で再現できるか、同梱フォントで実測する
- 安全領域の定義（D2 の余白のどこまでを輪郭の外に出してよいか）を形ごとに検討する
- 2 パスとの出力の違い、D2 更新時の壊れやすさを比較する

## 成果物
判断と実測を本 Issue のコメントに記録する。

## 関連
#18
```

### 6. Investigate fixed ports for custom components

```markdown
## 目的
部品の決まった位置（ポート）にエッジを付ける機能を提供できるか、バックエンドの観点から再検証する。

## 内容
- D2 の新しいバージョンで ELK のポート（`FIXED_POS` 等）が使えるようになったか
- ELK を直接使うバックエンド（elkjs 等）の依存・単一バイナリ・決定性への影響
- Figure / manifest にポートを互換的に追加する形（設計文書 §3「ports は v1 スキーマから除外」の見直し）

## 成果物
採否と方式を本 Issue のコメントに記録する。

## 関連
#18、#9
```

### 7. Define sanitization rules for external component outlines

```markdown
## 目的
外部（パッケージ・ユーザー定義）のコンポーネントを許す場合に、輪郭の定義を安全に取り込む規則を決める。外部コンポーネントの計画が具体化するまで着手しない。

## 内容
- 宣言的な幾何（正規化座標の多角形・M/L/C/Z のパス）の JSON 形式と、その検証（要素数・座標範囲・自己交差）
- SVG を取り込む場合の許可リスト（要素・属性）と、厳格な XML parser（src/render/xml.ts）の再利用
- 実行可能なコードを読み込まないことの明文化

## 関連
#18、#5
```

## 付録: 再現手順

```sh
bun run d2:install
bun research/18-custom-svg/run.ts --png   # out/ に 3 段階の SVG・PNG・レポート
bun research/18-custom-svg/probe-d2.ts    # §1.2 の D2 の観察
bun test research                         # 形状の幾何の smoke test
```
