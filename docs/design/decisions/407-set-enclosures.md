# #407 集合の囲み（sets）

## 背景

論文の hypergraph の図（hyperedge を、メンバーのアイコンを囲む重なる半透明の円で描く）を Sumi で
再現させると、hyperedge を小さな四角のノードと線で代用した別物になった。グループは木構造で、
1 つのノードは 1 つのグループにしか入れず、重なる囲みも半透明の塗りもない。集合の囲みは
ハイパーグラフに限らず、ベン図・クラスタ・包含関係・データの分割に使う汎用の部品である。

## 決定

### スキーマ: 最上位の `sets` リスト

```yaml
sets:
  - id: entities
    label: Entities
    members: [p1, p2, shared]   # ノード／グループの ID。1 つのノードが複数の集合に入れる
    shape: circle               # circle（既定）| ellipse | hull | rect
    labelAt: top-left           # 8 方向（既定 top）
    padding: 4mm                # 省略: Profile の groupPadding
    variant: default            # default | filled | outlined | dashed
    tone: blue                  # 省略: gray
    fillOpacity: 0.2            # 省略: variant の値
```

- **図のレベルの要素**にする。`groups` に足さないのは、グループは木構造で、子を所有し、arrange の木に
  必ず置かれるため。部品（`members` を持つノード）にしないのは、ノードは arrange に置かれて経路の
  障害物になり、集合は逆に「配置後にメンバーから決まる」ものだから。`layout.align` と同じく、
  ElementKey を持たない図の属性にした。メンバーの所属はグループの木と無関係（多対多）。
- `sets` は任意で、書かない図の正規化後の文書（`FigureDocument`）に `sets` は現れない。
- ID は集合だけの空間（エッジの ID と同様、ノードやグループと同じ ID を使ってよい）。
  `members` は `Id` のみ。tokens のセル参照（`node.cell`）は非対応。
- 診断（段 `ref` / `layout`）: `ref/unknown-set-member`（候補つき）、`ref/duplicate-set-member`
  （最初の出現を related に示す）、`ref/duplicate-id`（集合どうし）、auto で
  `layout/structured-only`。診断の `subject.kind` に `set` を足した。エラーのある集合は文書から外し、
  後段が見ない。

### 形（`src/layout/set-shape.ts`）

メンバーの箱を点にして囲む。矩形のメンバーは 4 隅、`circle` / `oval` のノードは境界の 32 点
（角を使うと丸いアイコンに対して大きすぎる）。バッジの箱も含める。グループは枠全体。

- `circle`: 点の最小包含円（Welzl の反復版）に padding を足す。2〜3 集合のベン図で古典的な円になる。
  既定にした（メンバーの配置が自然なベン図なら一番見慣れた形）。
- `ellipse`: 点の外接矩形の縦横比（1:3〜3:1 に制限）で x を伸縮してから最小包含円を求める軸平行の楕円。
  横一列のメンバーを円より小さく囲む。
- `hull`: 凸包を padding だけ丸く膨らませた形（円盤とのミンコフスキー和: 直線の辺と円弧の隅）。
  3 次ベジェで書き、凸。1 点は円、2 点はスタジアム形。
- `rect`: 外接矩形に padding。角の丸めはテーマのグループの `radius`（`nodeCorners: square` では 0）。
- padding は集合ごとに変えられる。入れ子（部分集合）は、外側の padding を大きくして描く。

### ラベル

囲みの外。`top` / `bottom` / `left` / `right` は外接矩形の辺に中央で、`top-left` など 4 隅は
その方向の**支持点**（輪郭の最も遠い点）に、ラベルの箱の角を 0.4em 離して置く（円・楕円・凸包で
いずれも輪郭に重ならない）。内側のラベルは持たない。メンバーが内側を占めるので、内側に文字が
要るときは `label` ノードをメンバーにする（円周に文字がかかる問題も避けられる）。

### 配置と空間の予約

- メンバーは既存の arrange（stack / row / grid / `place` / attach）が置く。集合は**配置後に**
  `#result()` で、確定したメンバーの箱から輪郭を決める。arrange の寸法・位置・経路・既存の図の出力
  には影響しない（`place` の剛体の契約を壊さないため、集合は arrange に空間を予約しない）。
- 代わりに、**キャンバスと内容の外接矩形が輪郭とラベルを含む**（切れない）。近隣の要素との衝突は
  作者が `place` の座標や gap で空け、lint が検出する（下記）。「予約する」案は、集合が arrange の
  項目になって、メンバーの相対位置が集合の大きさで変わるため採らなかった。
- 輪郭は 1/1000 unit に丸める。align の再レイアウトごとに同じ決定論的な結果になる。
- auto（D2）は非対応。`layout/structured-only` で止める。ELK のコンテナは木構造で、
  重なりを表せないため。暗黙にエンジンを変えない。

### 描画

- 構造化 SVG の順序は グループ → **集合** → ノード → 配線 → エッジ。`g.sumi-set.sumi-set-<id>` に
  `.sumi-set-shape`（`circle` / `ellipse` / `rect` / `path`）とラベルの `<text>`。`sumi-k-` を持たない
  ので `inspectSvg()` の要素としては数えない。
- 塗りは `fill` と `fill-opacity`（重なりが透ける）。線は `stroke`。SVG・PDF（`/ca`）・picture PPTX
  は同じ SVG から出る。editable PPTX は集合ごとに自由図形（`a:custGeom` + `a:alpha`）と
  ラベルのテキストボックスを、グループとノードの間に書く。
- エッジラベルの背景色（`backgroundAt()`）は集合のぼかした色を含める。輪郭の内側のラベルが白く
  抜けない。
- スタイル（`src/core/theme/set-style.ts`）: レジストリの部品にはしない。テーマのグループ枠
  （線幅・文字・角丸）と、tone の `toneLines`（なければ gray）の線色を使う。**塗りは線色の低い不透明度**
  （default / dashed は 0.2、filled は 0.28）にした。tone の淡い塗り色（`tones`）を使うと、モノクロの
  テーマでほぼ白になって重なりが見えない。`variant`: default（塗り+線）、filled（塗りのみ）、
  outlined（線のみ）、dashed（塗り+破線）。`themeOverrides.tones` が効く。

### lint（`src/lint/geometry/sets.ts`）

inspector が SVG から集合の形（楕円または凸多角形）とラベルを読み、幾何 lint の文脈に `sets` を足す。

- `geometry/set-contains-non-member`（warning）: 輪郭がメンバーでないノードを覆う（中心が内側、または
  箱の 25% 以上が内側）。メンバーのグループの子孫・キャプション・junction は除く。集合ごとに 1 件で
  覆われたノードを related に示す。
- `geometry/set-label-collision`（warning）: ラベルが他のラベル・ノードの図形・エッジの経路・ほかの
  集合のラベルと重なる、またはほかの集合の**境界**がラベルを横切る。上位集合の内側に収まる部分集合の
  ラベルは対象外。
- エッジが集合の境界を横切るのは正常（診断なし）。ページ幅・高さは既存の規則がキャンバスで判定する。
  幅の超過には、集合が配置項目の外に出ている旨を details / hint に足した。`geometry/text-too-small` は
  集合のラベルも検査する。
- `lint/no-edges` は、集合のある図では出さない（メンバーシップが関係を表すため）。

### カタログ・文書

- `sumi catalog --section sets`（JSON は `sets` セクション: shapes / variants / labelAt / スキーマ）。
  既存のセクションは変えない。
- JSON Schema（`sets`）、`sumi fmt --canonical-order` の鍵順。
- skills/sumi: figure-format.md（構造・要素表・版の表）、structured.md の「Set enclosures」節
  （`expect-render: fits` の例つき）、diagnostics.md。docs/lint-rules.md。
- ギャラリー: 全 theme の `docs/gallery/sets/`（ベン図、凸包と部分集合、4 つの variant）と `sets.md`。

## 採らなかった案

- 囲みを `groups` の拡張にする: 木構造・所有・arrange への配置と衝突し、重なる囲みにならない。
- メンバーを持つ部品（ノード）にする: 経路の障害物になり、配置後にメンバーから寸法が決まる性質と合わない。
- arrange に空間を予約する: `place` の剛体の契約と、メンバーの位置が集合の寸法で動く問題。
- tone の淡い塗り色をそのまま半透明にする: モノクロのテーマで重なりが見えない。
- 内側のラベル: 円周と文字、メンバーとの衝突を避ける手段がなく、`label` ノードをメンバーにすれば足りる。
- 輪郭の円弧を SVG の `A` で書く: 検査（`parsePath`）が円弧を受けない。3 次ベジェにして共通の経路を使う。

## 制限

- structured のみ（auto は `layout/structured-only`）。
- 集合は arrange に空間を持たない。キャンバスは広がるが、近くの要素を自動では避けない
  （`set-contains-non-member` / `set-label-collision` と `place` の座標で作者が調整する）。
- メンバーは ID のみ。tokens のセル（`node.cell`）は指定できない。
- 集合のラベルは構造 lint（`lint/empty-label` など）と描画前の文字下限（`profile/font-too-small`）の
  対象外。後者は描画後の `geometry/text-too-small` が検査する。
- `dim` の対象外（集合は group の子ではない）。

## 互換性と検証

`sets` のない図は、IR・配置・SVG・PDF・PPTX・D2 のいずれも変わらない（`sets` は任意で、書かなければ
`FigureDocument` にもレイアウトにも現れない）。既存の `*.sumi.yaml`（research/ と非公開の図は除く）を、
自身の theme と全組み込み theme で変更前後に描画し、SVG / PDF / picture PPTX / editable PPTX / D2 の
SHA-256 を比較する（728 通り、うち 492 通りが描画に成功、236 通りは既存の不正 fixture などで
error を返す）。結果: 出力が変わった図は 0、error の code も一致。
ギャラリー（`bun run gallery`）は追加（sets と目次）以外の変更なし。

回帰テスト: 形の幾何（最小包含円・楕円の縦横比・凸包の丸め・ラベルの支持点）、スキーマと参照の診断、
オーバーラップの描画（共有メンバーが両方の輪郭内、キャンバスに輪郭とラベルが入る、SVG の順序・
`fill-opacity`・検査）、全 theme と 4 形状・4 variant、PDF の `/ca`、PPTX（picture / editable の
`a:alpha` と順序）、lint（非メンバー・ラベルの衝突・部分集合・エッジの横断）、`fmt`、`catalog`、
`no-edges`。視覚確認用の生成物は `.sumi/preview/` に置き、CLI の PDF を pdftoppm で PNG にして見た。
