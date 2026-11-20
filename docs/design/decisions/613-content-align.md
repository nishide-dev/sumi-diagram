# #613 伸ばしたパネルの中身の寄せ方（`contentAlign`）と、列の見出しを揃える手段（`matchLabelHeight`）

## 背景

#603 の dogfooding で 4 枚（2 gated-attention、4 lost-multiturn、5 trellis2、8 kimi-k2）に同じ問題が出た。

- パネルを `align: stretch` で同じ高さにすると、背の低いパネルの中身が縦に中央へ置かれ、見出しと最初の行の間と、中身の下に空き帯ができる（5 の (b)、2 の (b) の表、4 の (c) のチャット）。
- 並んだパネルの見出し（パネルのタイトル、または列ごとの見出し）の高さが揃わない（8 の Tool specs / Agents & tasks / Rollouts / Filtering、4 の (a) と (c)）。8 では stretch すると見出しが中身から離れ、stretch しないと見出しの高さがばらばらになるので、どちらも選べなかった。

原因はエンジンの 1 か所にある。group の中身の領域（枠から padding と見出しの帯を除いたもの）は、伸ばされると自然な高さより高くなる。arrange の根の箱はその領域全体を受け取り、stack なら主軸の余り（`extra / 2`）、grid・chat・place なら枠の中央に中身を置く。根が row なら交差軸は row の `align` で上下に寄せられるが、根が stack（見出しの node のあとに中身、という最も多い形）・grid・chat では上に寄せる書き方がなかった。

## 決定

### 1. `groups[].contentAlign: top | center | bottom`（structured のみ）

- group が中身より高いとき、中身（arrange の木と attach したノード、自然な高さの 1 つのまとまり）を領域のどこに置くか。`top` は見出しの直下に置き空きを下に 1 本にまとめる、`bottom` は空きを上にまとめる、`center`（既定）は今までどおり上下に分ける。
- 実装は `#placeElement` の 1 か所（`#alignedContent`）: `top` / `bottom` のとき、`#placeContainer` に渡す領域を中身の自然な高さ（`#containerSize`、attach の張り出しを含む）に縮め、上端か下端に置く。Layout IR の `GroupLayout.content`（group の内側）は縮めない。
- 縦だけにした。横に伸ばされた group（stack の `align: stretch`）では、根の stack の `align: start` で左に寄せられ、根の row なら `justify` で埋められる。また横は中身を `stretch` で領域いっぱいに広げたい場合が多く、領域を縮めるとそれを壊す。軸の名前を値に入れた（`top` / `bottom`）のも、`start` / `end` だと横にも効くように読めるため。
- `spread`（中身を領域いっぱいに散らす）は足さない。根の stack の `justify: space-between`（間を広げる）と `justify: stretch`（item を伸ばす）が既にあり、`contentAlign` はそれらと組み合わせて使える（伸ばした group の根に `justify` を書けば余りは item 側に行き、`contentAlign` には余りが残らない）。
- 自然な高さの group、tilted plane（`#placePlane` は自然な大きさで置く）には効かない。tokens / matrix は根が固定の描画なので実質効かない。
- **根の箱が自分で高さを埋めるときはそちらが優先する**: 根が `justify: stretch` / `space-between` の stack、または `align: stretch` の row なら、領域を縮めずにそのまま渡す（item が伸びる・両端まで広がる）。このとき空き帯は残らないので `contentAlign` は何も動かさない。縮めると、作者が明示した埋め方を `contentAlign` が黙って打ち消し、伸びるはずの item が自然な高さに戻って空き帯ができる（レビューの指摘: 2 つの item の高さが 119 → 34 unit になった）。テストで、3 つの書き方それぞれで `top` / `bottom` を書いても Layout IR が変わらないことを確かめる。
- 既定（省略）と `center` は今までとバイト単位で同じ（`#alignedContent` が領域をそのまま返す。テストで省略と `center` の Layout IR が一致することを確かめる）。

### 2. 列の見出しを揃える: `contentAlign: top` と `groups[].matchLabelHeight: <name>`

検討した案:

- **(A) `contentAlign: top` だけ**: stretch した row の中で、兄弟のパネルは枠の上端が揃い、padding と見出しの帯が同じなら、見出しも最初の行も 1 本の線に乗る。8 の 4 つの見出し・4 の (a) と (c) はこれで揃う。ただし見出しが 1 行と 2 行のパネルが並ぶと、2 行の方だけ最初の行が下がる。
- **(B) row（箱）の側に「見出しの行」の指定を足す**（#603 のレビューの `headings` 行）: 箱に見出し専用の行を持たせると、見出しが group のタイトルでなくなり、枠の上に出すか中に入れるか（`labelAt`）・キャプションとの関係・入れ子の箱に効くかを全部決め直す必要がある。見出しを独立した行に持つ形は既に `grid`（1 行目に見出しの node、行の高さは行ごとに共通）で書ける。
- **(C) `matchLabelHeight: <name>`（`matchWidth` と同じ名前付きの揃え）**: 同じ名前を書いた group は、見出しの帯の高さを、その名前の中で最も高い見出しに揃える。(A) の残り（見出しの行数の違い）だけを埋める。木をまたいで効き（入れ子の row の中のパネルも同じ名前で揃う）、`matchWidth` と同じ書き方で覚えやすい。

**(A) + (C) を採る。** 見出しは group のタイトルのまま、行の位置は `contentAlign: top` で揃え、行数の違いは `matchLabelHeight` で揃える。見出しを node で書く形（各パネルの根の stack の先頭に見出しの node）も `contentAlign: top` で上端が揃う。見出しの node の高さまで揃えたいときは `grid` を案内する（Skill に書く）。

- 帯の高さ = その名前を書いた group のラベルの高さ（`ceil(label.height)`）の最大。ラベルのない group も同じ名前なら帯を取る（見出しのないパネルの最初の行も揃うように）。どれにもラベルがなければ帯は 0。
- ラベルは帯の上端に置く（今までどおり `rect.y + padding`）ので、1 行の見出しは 2 行の見出しの 1 行目と同じ高さに来る。`labelAt: above*` の見出し（枠の外）にも同じ帯を使い、枠の上端を揃える。`labelAt: bottom*` では下の帯が揃う。
- 1 つの group だけが書いた名前は何も変えない（テストで確かめる）。

### 3. lint: `geometry/content-band`（info）

- **対象**: structured の図で、描画の配置（`GeometryContext.placed`）がある group のうち、`contentAlign` を書いておらず、tilted plane・tokens・matrix・legend でないもの。直接の子（ノードの本体・ラベル・sublabel、子 group の枠と見出し）の外接矩形と、Layout IR の `content` を比べ、**上と下の両方に 4mm（印刷時の寸法）以上**の空きがあるとき報告する。片側だけの空きは中央寄せが原因ではないので出さない。
- **hint は実際にやって確かめる**（`relocatable.ts`・`width-fit.ts` と同じ `trial.ts` を使う）: その group に `contentAlign: top` を書いた IR の写しを、描画と同じ手順（`placeStructured`（`straighten` を含む）→ `routeStructured`）で配置・配線し、SVG に描いて、この規則以外の geometry 規則を同じ設定でかける。次をすべて満たすときだけ「Verified」と書く: 配置に error がない、キャンバスの幅・高さが変わらない、中身の上の空きが 1 unit 以下になる、新しい error / warning が出ない（元の図の写しを 1 度だけ同じ手順で配置し、それが描画済みの図と同じ大きさになるときだけ比べる）。確かめられなかったときは理由（予算・図が大きすぎる・新しい問題のコード）を添えて「would put …」と書く。
- **費用の上限**: 帯のある group がなければ何もしない（配置もしない）。あれば 1 図につき最大 4 group（`MAX_BAND_TRIALS`、文書順）と元の図 1 回の、計 5 回の配置・配線と lint。すべて `asHintTrial` の中で走らせ、写しの中でほかの規則がヒントの試しを始めないようにする。`HintTrials` の大きさの上限を超える図、HTML・外部ファイルの画像を含む図では試さない。
- **既存の図への影響**: examples と `docs/assets` では `examples/dit-block`（左の LDT パネル、上下 13.8mm）だけに出る。テストの fixture では `tests/fixtures/fit/c-h3world`（LoRA パネル）、DiT の fixture、`group-caption` の stretch のテストに出る。いずれも info で、図は変えず期待する診断に記録した（再現図は原図に忠実なまま）。`maxWarnings` には数えない。
- 自動では直さない。中央寄せが意図のこともある（hint の最後にそう書く）。

### `figure.layout.straighten`（既定、#618 / #620）との関係

- straighten は item を「自分の箱の枠の中」の余裕の範囲でずらす。`contentAlign: top` / `bottom` では根の箱の枠が中身の自然な高さに縮むので、根の stack の item は縦に動く余地がなく、根の row の item は row 自身の高さの中（並んだ item の高さの差）だけで縦に動ける。**空き帯の中へは戻らない**: 作者が書いた位置（上または下）が優先し、straighten はその中で線を真っ直ぐにする。
- 横方向の余裕は今までどおり（`contentAlign` は横を変えない）。
- `contentAlign: center`（既定）では、今までどおり根の item は帯の分だけ縦に動ける（帯は straighten の余裕として残る）。
- `figure.layout.align`（#132）の strut は箱の自然な大きさに入るので、`contentAlign` の「自然な高さ」は strut を含んだ高さになる。両方を書いても矛盾しない。

## 採らなかった案

- **stretch したら既定で上寄せにする**: 既存の図（DiT、LoRA、examples の dit-block など）の出力が変わる。再現図は原図の配置を保つ必要があり（#462）、既定は変えない。
- **箱（row / stack）側に `contentAlign` を持たせる**: 伸ばされるのは group で、中身の置き方は group ごとに違ってよい（4 では (c) を上、(b) は伸ばして上）。箱に書くと、入れ子の箱や group でない item への意味を決める必要がある。
- **`spread`**: 上記のとおり `justify` と重複する。
- **見出しの行を作る新しい部品**: (B) の理由。grid で書ける。
- **lint を `geometry/group-empty-area` の hint に入れる**: 対象が違う（空き面積の割合ではなく、中央寄せによる上下の帯）。`contentAlign` は空き面積を減らさず位置を変えるだけなので、group-empty-area の「診断が消える」確かめ方に合わない。

## 互換性

- 新しいフィールドの追加のみ。省略時の出力（examples・ギャラリー・ゴールデン・再現図のハッシュ）は変わらない。auto エンジンでは `layout/structured-only` の error。
- lint の出力には、上の図で `geometry/content-band`（info）が 1 件ずつ増える。
