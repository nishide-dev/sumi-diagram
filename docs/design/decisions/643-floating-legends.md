# #643 浮かせた凡例（`props.float`）と、説明のない色の lint

## 背景

#639 の 3 本（run 2・6・8）で、色に意味を持たせたのに凡例がなく、色の意味が図から読めなかった（`research/639-dogfood-v0.20/review.md` の横断 4）。凡例は配置の木の 1 項目なので、置けば必ず幅か高さが増える。とくに sequence には置く場所がなく、run 8 は screen-doc の 150mm に収めるために凡例を削り、橙（利用者が署名した Mandate）と緑（受領証）の意味が図から消えた。

この issue では、(1) 凡例を空いた所に浮かせて置く指定、(2) 色に意味があるのに凡例も説明もない図への lint、(3) Skill の案内を足す。(3) の「色に意味を持たせたら凡例か本文での説明を残す」の一文は PR #651（docs/648）が SKILL.md・layout-tips に入れるので、ここでは structured.md から新しい指定を案内するだけにした。

## 決定

### 1. 書き方: 凡例の `props.float`

```yaml
- id: key
  component: legend
  props:
    float: bottom-left                     # または {at: bottom-left, inset: 2mm}
    entries:
      - {edge: {tone: orange}, label: carries a user-signed Mandate}
      - {edge: {tone: green, variant: dashed}, label: signed receipt}
```

- 位置は `top-left` / `top` / `top-right` / `left` / `right` / `bottom-left` / `bottom` / `bottom-right` の 8 つ。issue の案の `bottom-left` の綴りで、グループの `labelAt`・集合の `labelAt` と同じ語彙にした（`attach.side` の方角の名前 `south-west` は、相手の外側に置く意味なので使わなかった）。
- `{at, inset}` で端から離す。`inset` は長さ（既定 0 で、内容の端にそろう）。sequence のフラグメントの枠の中に入れるときなどに使う。
- 浮かせた凡例は配置の木に書かない。layout 段では `props.float` を「置き場所」の 1 つ（`via: float`）として数え、木にも書けば `layout/duplicate-placement`、`attach` と同じく 1 回だけにした。所属は書いた `group:`（なければ root）。
- 凡例以外のノードに `float` を書くと、部品の props の検査で `component/unknown-prop` になる（layout 段は部品を知らないので、どのノードの `props.float` も置き場所として数え、`layout/unplaced` を重ねて出さない）。
- 書き方を `place` のような箱（`{float: key, at: …}`）にする案は採らなかった。凡例の外にこれを使う部品がなく、どの箱（stack・grid・sequence…）にも項目の種類を足す必要がある。凡例の props なら、凡例を書く所で完結する。

### 2. 配置（`src/layout/structured/engine.ts`）

- 容器（root か、`group:` のグループ）の中身を置いたあと（配置の木と `attach` のあと）、その中身の領域の指定の角・辺に凡例を置く。領域は容器が配置の木と `attach` のために割り当てた矩形（グループなら padding と題を除いた中身の領域）。
- 凡例は容器の大きさの計算に入らない（`#containerSize` は配置の木と `attach` だけを見る）。浮かせても図・グループの幅と高さは変わらない（テストで確かめた）。
- 凡例が領域より大きいときは、はみ出して図が大きくなる。黙って縮めず、`layout/float-too-large`（warning）で知らせる。
- 何も避けて動かない（`place` と同じく、配置を自動で動かさない方針）。重なりは lint が知らせる。
- 経路: ルーターは浮かせた凡例の枠と部品を格子に入れない。辺の経路は凡例がないときと同じになり、凡例が辺の端を覆っても `layout/no-route` にならない。凡例の見本の線は `route: straight`（下に何があっても 1 本の直線）。

### 3. sequence: lifeline を凡例の上で止める

sequence の lifeline は図の下端まで続くので、下の角に凡例を浮かせると lifeline が凡例を縦に貫く。そこで、凡例の幅（左右に arrange gap の 1/4 を足す）にかかる lifeline のうち、凡例の上端から gap の 1/4 上より下に自分の行（メッセージの端・注記）がないものは、下端の隠しジャンクションをそこまで上げる。lifeline はそこで終わり、凡例はその下の空いた所に入る。行がもっと下にある lifeline は止めない（凡例を貫くので `geometry/float-overlap` が出る）。

run 8 では User と Trusted Surface の lifeline が最後のメッセージ（auth + consent）のあと空いており、`{at: bottom-left, inset: 2mm}` で凡例がそこに入る。inset で「2 Payment」の枠の中に収まる。

### 4. lint `geometry/float-overlap`（warning）

浮かせた凡例は空きを確かめずに置くので、重なりを lint で知らせる。凡例の枠の矩形が次と重なれば、凡例ごとに 1 件（重なる要素を related に）。

- ノード（接続点を除く）の図形・ラベル、凡例を含まないグループの枠・題、辺の描かれた線（線分が枠の内側を通る）とラベル。
- 集合の輪郭: 枠を横切るときだけ。凡例が集合の内側に収まる（sequence のフラグメントの枠の中など）のは対象外。
- 0.5 unit 以下の接触は許す。

既存の規則（`label-collision`・`edge-crosses-label` など）も重なりの一部を報告するが、凡例全体の言い方で「別の角・inset・小さく」を案内する規則を別に置いた。一方、`set-contains-non-member`・`set-outline-crosses-node`・`set-outline-crosses-text` は、浮かせた凡例の部品を見ない。フラグメントの枠の中に置いた凡例を「メンバーでないのに囲まれている」と報告しないため（枠を横切るものは `float-overlap` が見る）。幅の hint の「凡例が図の幅を決めている」も、浮かせた凡例には出さない。

### 5. lint `lint/unexplained-colors`（info）

「3 色以上が意味を持ち、凡例も文字での説明もない」を、誤検出を避けるよう次のように決めた（構造の lint。描画しなくても出る）。

1. 数える色: 作者が書いたノードと辺の有彩色の `tone`（`gray` と、キャプション・凡例・tokens・matrix・sequence が展開した部品は除く。グループの tone はパネルの見出しが名指すので除く）。
2. 辺の tone が始点か終点のノードの tone と同じなら数えない（GCN のように頂点の色を辺がなぞるだけ）。
3. **種類の印**（code）: 次のどちらか。
   - (a) 2 本以上の辺の tone。辺には名前がないので、色が種類を表すと読む。
   - (b) 異なるグループにある 2 つ以上のラベル付きノードの tone で、ラベルに共通の語（3 文字以上、末尾の s を除く）がないもの。「Multi-Head Attention」「Masked Multi-Head Attention」のように、ラベルが種類を名指していれば色は説明済み。
   - ただし、ラベル付きノードの 2/3 超に tone（`gray` を含む）がある図は、ブロックの種類で塗り分けた論文図（DiT・Transformer）で、各ブロックのラベルが名指すので (b) を数えない。
4. 有彩色が 3 つ以上で、種類の印が 2 つ以上のとき報告する（run 8 は青の強調 1 つ + 橙・緑の辺。issue の「3 色以上」を、2 つの印と 1 つの強調で 3 色、と読んだ）。
5. 凡例が 1 つでもあれば報告しない。どれかのラベル・サブラベルに色の名前（red・orange・yellow・green・blue・purple・pink・gray/grey・colour、赤・橙・黄・緑・青・紫・色など）があれば、文字で説明しているとみなして報告しない。
6. 図の外（本文・キャプション）での説明は読めないので、info にとどめ、hint で「本文で説明しているなら無視するか、設定で無効に」と書く。

#### 同梱の図での件数

| 対象 | 図の数 | 報告 |
| --- | --- | --- |
| `examples/` | 16 | 0 |
| `skills/sumi/examples/` | 16 | 0 |
| `skills/sumi/layouts/` | 32 | 0 |
| `docs/assets/` | 1 | 0 |
| `tests/fixtures/` の `*.sumi.yaml` | 111 | 0 |
| #639 の runs（figure・draft1） | 20 | 3（run 6 の figure と draft1、run 8 の figure） |
| #603 の runs（figure・draft1） | 20 | 0 |

#639 で凡例がないと指摘された run 6・8 だけが報告され、凡例を持つ run 8 の draft1 は報告されない（run 2 は凡例がある）。同梱の再現図は、元の図に凡例がないものも含めて 0 件（DiT・Transformer は 3 の塗り分け、GCN は 2、CLIP・LLaDA などは印になる tone が 2 つに満たない）。検討の途中では、(b) で「グループをまたぐ」を条件にしないと DiT と GCN、塗り分けの条件がないと DiT が報告された。

### 6. Skill・ドキュメント

- `structured.md` の Legends に「Floating」の段落と例、Sequence diagrams に「凡例は浮かせれば高さを増やさない」を足した。色に意味があるときに凡例を残す一文は #651 が SKILL.md・layout-tips に入れるので、ここでは繰り返さず、浮かせる指定を案内するだけにした。
- `figure-format.md` の版の表に 0.20.1、`diagnostics.md` と `docs/lint-rules.md` に新しいコードを足した。JSON Schema を再生成した。

## 採らなかった案・後回し

- **空いた所を自動で探して置く**: 置き場所が内容の変化で飛ぶ。角を書かせ、重なりは lint で知らせる方が予測できる。
- **重なる辺を凡例を避けて回す**: 凡例が経路を変えると「大きさを足さない」以上に図を変える。凡例は内容の上に置くだけにした。
- **凡例以外（注記など）も浮かせる**: 需要が凡例だけだったので、凡例の props にとどめた。
- **lint で色の数え方に variant（破線など）も入れる**: issue は「色」なので tone だけにした。破線の区別は凡例の見本で説明できる。
- **matrix の連続した色の段階（ramp）とその凡例**（横断 4 の残り）: 別の課題。

## 互換性

- 新しい prop・コード・規則だけで、`float` を書かない図の配置・経路・SVG は変わらない（エンジン・ルーター・凡例の展開の変更は、浮かせた凡例があるときだけ働く）。examples・ギャラリー・再現図のハッシュはバイト単位で同じ（`gallery:check` と全テストで確認）。
- 新しい info `lint/unexplained-colors` は、同梱の図と fixture では出ない（上の表）。
- `layout/attached-legend` の hint に「`props.float` で浮かせる」を足した。

## run 8 の作り直し（scratch）

run 8 の YAML に凡例を戻し `float: {at: bottom-left, inset: 2mm}` で浮かせると、図は 200 × 149.3mm（凡例なしと同じ）で screen-doc に収まり、lint は 0 error / 0 warning（info は `heavy-scaling` のみ）。凡例なしの元の YAML には `lint/unexplained-colors` が出る。
