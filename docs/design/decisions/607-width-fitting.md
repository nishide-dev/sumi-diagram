# #607 幅合わせを予測できるようにする

## 背景

#603 の dogfood（v0.19.1、10 本）では、10 本中 9 本で描画しては幅を合わせる試行がレンダーの大半を占めた（初稿 197〜467mm、5〜10 回の描画）。ログとレビュー（`research/603-dogfood-v0.19/review.md` の横断的な問題 1）から、原因は次の 4 つ。

1. **何が幅を決めているか見えない。** `geometry/exceeds-page-width` の内訳（#307 / #368）は描いた SVG の座標から測る。`align: stretch` の stack では全員が同じ幅に描かれるので、「右の stack は 125.41mm: attn 125.41、moe 125.41、legend 125.41」となり、凡例が原因だと分かるまでに 3 回描いた（run 6）。
2. **グループの余白が見えない。** 何も書かないグループは片側 8pt（約 2.8mm、`screen-doc` は 12pt）の余白を持つ。配置のためだけに入れ子にした素のグループが 30mm を使っていた（run 4）。`props.padding` で減らせると気づくまで試行が続いた（run 2）。
3. **検証済みの修正が使えない。** 既存のヒントは「gap を 0mm にすると何 mm 減る」だけで、それで収まるとは限らず、0mm は線やラベルを置けない（run 2、run 4「row gap 0 しか出ない」）。収まる値を自分で探すことになった（run 5「6.5mm → 1.2mm 超過、余白 → 3.4mm 超過、5.5mm で収まる」）。
4. **描く前に寸法を見積もれない。** Skill に部品の既定寸法と余白・間隔の表がなく、モックアップの `place` 座標が Sumi の実寸と合わなかった（run 2 の演算子 5.6〜8.5mm、run 4）。

## 決定

### 1. 幅の内訳: 自然な幅の木（`src/layout/structured/width-tree.ts`）

構造化レイアウトのエンジンに、最後の配置で使った寸法をそのまま読む `widthTree()` を足した（`engine.ts`）。容器・arrange の箱・グループ・ノードごとに次を持つ。

- **自然な幅**: 親に伸ばされる前に、その項目が必要とする幅（`#itemSize` / `#boxSize` / `#containerSize` のキャッシュ）。ページ幅は、ルートの自然な幅 + 余白 2 つ（+ 配置の外にはみ出す辺・セット・ラベル）になる（テストで確かめる）。だから stretch で同じ幅に描かれていても、どの子が幅を決めたかが分かる。
- 伸ばされた後の幅（`placedPt`、自然な幅より 0.5pt を超えて広いときだけ）。
- グループ: 左右の余白（`props.padding` か、プロファイルの既定か）、中身の幅、中身より広いタイトルの幅、付属ノード（`attach`）のはみ出し。
- row / grid: gap（書いた値か既定か、何か所か）、grid の列幅、各セルの列と span。
- ノード: 明示の `props.width`、ラベルの幅。
- 凡例・tokens・matrix・傾いた平面は、自分の props（`perRow`、`cellWidth`）で決まるひとかたまりとして扱い、中には入らない。

`structuredWidthTree(ir, options)` は `placeStructured` と同じ手順（align の struts、矢じり前の余白 #171）で配置し、最後の struts でもう 1 回配置して、そのキャッシュを読む。配置 1 回分の費用が増えるだけで、描画結果には触れない。

**幅を決める道筋**（`widthPath`）: ルートから、各段で最も広い子をたどる（row ではすべての子が足し合わされるが、道筋は最も広い子を進む）。タイトルが中身より広いグループ、place の箱（書いた座標が幅を決める）、chat で止まる。

### 2. 出す場所

- **`geometry/exceeds-page-width` のヒント**（`geometry/heavy-scaling` の「縮小前の内訳」も同じ）。構造化の図で、描画の配置（`GeometryContext.placed`）があるときは、ヒントの 2 番目を「Sets the width」（描いた座標）から **`Width path`**（自然な幅の道筋）に替えた。例（stretch の stack、凡例が幅を決める）:

  `Width path (natural widths, before stretch): page 92.96mm = margins 2 × 1.94mm + arranged content 89.02mm → figure.layout.arrange.row 89.02mm = 2 items (…) + 1 × 4mm gap (profile default) → figure.layout.arrange.row.items[1].stack 64.56mm, as wide as its widest item (next: group "moe" 41.22mm); its items are stretched to one width when drawn, natural widths: legend "key" 64.56mm, group "moe" 41.22mm, group "attn" 34.81mm → legend "key" 64.56mm (a legend sized by its own props, e.g. perRow). Widest contributor: legend "key" (64.56mm).`

  項目が 1 つだけの箱は幅を素通しするので道筋から省く。描いた座標の細かな内訳（#368 の `related`）はそのまま残す。
- **`sumi render --explain-width`**（opt-in）: 木全体を 1 行 1 項目で stderr に出す（幅を決める項目に `*`、grid は列ごとに最も広い項目）。先頭行はページ（余白・配置した中身・はみ出し）。`--json` では `widthTree`（pt、IR の参照なし、`setsWidth`）を足す。収まっている図でも使えるので、上限ぎりぎりの調整（run 5）にも使える。出力の SVG / PDF / PPTX は変わらない（テストでバイト一致を確かめる）。

**info の lint を新しく足す案は採らなかった。** 幅が上限を超えたときは既に error の `geometry/exceeds-page-width` が出て、エージェントはそのヒントを読む（Skill の手順もそう書いている）。同じ内容の info を別に出すと重複になり、収まっている図にも毎回出すとノイズになる。収まっている図の内訳は、必要なときに頼む opt-in のフラグがふさわしい。`sumi measure` のような新しいコマンドも、`render` と同じ描画を繰り返すだけなので、`render` のフラグにした。

### 3. 収まる値のヒント（`src/lint/geometry/width-fit.ts`）

道筋の上で変えられる値を集める。

- 道筋の上の row / grid の gap（0.5mm 刻み、0mm まで）
- 道筋の上のグループの `props.padding`（0.5pt 刻み、0.5pt まで。上下左右すべてに効くことを書く）
- 道筋の上（または道筋の上の row の項目）の、明示の `props.width` を持つノード（0.5mm 刻み、ラベル + ノードの左右の余白まで。画像は縦横比があるので除く）

超過分 O を、1 つの値だけで消せる値を計算する（gap は O / gap の数、余白は O / 2）。どれも 1 つでは足りないときは、**全部を同時に**、それぞれが減らせる量に比例して分担させる（まず gap と余白だけ、それでも足りなければ幅も含めて）。これが #603 の提案 (c)「縮小の前に間隔を詰める」をヒントとして実現したもの。

**どの値も実際にやってみて確かめる**（#621 の `relocatable.ts` と同じ道具を `trial.ts` に切り出して共有する）。値を書き込んだ IR の写しを、描画と同じ手順（`placeStructured` → `routeStructured`）で配置・配線し、SVG を書いて、ほかの geometry 規則（幅の 2 規則と `relocatable-node` を除く）を利用者の lint 設定どおりにかける。

- ページが上限に収まり、
- 配置・配線の error がなく、
- error / warning の数（コードと対象ごと）が元の図より増えない

ものだけを `Fits 88mm (verified: …): set … to 2.5mm (now 4mm, the profile default) → 87.49mm` の形で出す（1 つずつの値は変化の割合が小さい順に最大 3 つ、同じ種類は 2 つまで）。収まるが問題が増える値は `… would fit but adds geometry/label-collision` と名指しする（run 8: gap を詰めるとラベルの衝突が戻った）。試しで少し足りなかったら、残りの超過分だけもう一度下げて 1 回だけ試し直す。元の図の写しが描画済みの図と同じ幅にならなければ、試しを信用できないので何も出さない。

収まる値が 1 つも見つからないときは、道筋の値を全部最小にしても何 mm しか減らないかを書き（「shorten labels, rearrange (fold a row into rows) or shrink」）、従来の「部分的に減らせる検証済みの修正」（#307 の `verifyHints`）を出す。収まる値が見つかったときは従来の修正を出さない（収まらない「gap 0」が収まる値と並ぶと迷う）。

幾何学的に計算しただけの値は出さない。#617 / #621 のレビューで、計算だけのヒントは実際に適用すると外れることが繰り返し指摘された。テストでは、ヒントの値を YAML に書き込んで描画し直し、上限に収まり、示した幅と一致し、新しい error / warning がないことを確かめる。

### 4. 縮小（`fit: scale`）の前に詰める段階: 実装しない

`figure.fit: tighten` のように、描画のときに gap と余白を自動で詰める opt-in は**実装しないことにした**。

- **安全に詰められるかは lint でしか分からない。** 上の検証は、写しを描いて geometry lint にかけて初めて「問題が増えない」と言える。描画の中で同じことをすると、描画結果が lint の規則に依存する（規則を直すと出力が変わる）。パイプライン（… → SVG → Lint）の向きが逆になる。
- **YAML が一次ソース。** 自動で詰めると、書いた gap と描かれた gap が食い違い、次の編集（ノードを 1 つ足す）でまた別の値に変わる。ヒントで値を示し、作者が書けば、YAML と出力が一致したままになる。
- **費用が描画のたびにかかる。** 試しは 1 回あたり配置・配線・SVG・lint の全部で、超過する図の描画が毎回数倍遅くなる。ヒントなら超過したときに 1 度だけ。
- `fit: scale` は「全体を縮める」だけで配置を変えないので、決定的で説明しやすい。詰める段階を混ぜると、どちらが効いたのか分かりにくい。

代わりに、ヒントの「together」（gap と余白を同時に分担して詰める値）が、同じ効果を検証済みの値として示す。

### 5. Skill: 既定寸法の表（`skills/sumi/references/sizes.md`）

- 表はコードから生成する（`src/layout/structured/default-sizes.ts`）。
  - プロファイル × 密度（normal / compact）ごとの gap、グループの余白（片側と、グループが幅に足す量）、ノードの余白、余白（margin）、最大幅。値はプロファイル（`spacedProfile`）から読む。
  - ノードの部品ごとの自然な大きさ。テーマ `sumi` で、1 語のラベル「Encoder」の 1 ノードの図を実際のエンジンとフォントで配置して測る。紙（`paper-double`）、`screen-doc`（textScale 1.5）、`presentation-16x9`（textScale 2）の 3 列。ラベルを持たない部品はラベルなしで測り、演算子は `size` ごとに 1 行。props がないと作れない部品（画像・凡例・tokens など）は名前だけ挙げる。
- `src/cli/skill-sizes.test.ts` が、ファイルの印の間を生成し直した結果と比べる（`SUMI_UPDATE_GOLDEN=1` で書き直す）。テーマ・プロファイル・フォント・寸法の計算が変わると、このテストが表の更新を求める。
- SKILL.md・`diagnostics.md`（幅の内訳）・`layout-tips.md`（幅が足りないとき）・`mockup.md`（モックアップは既定寸法で描く）からリンクする。

## 採らなかった案

- **描いた SVG から自然な幅を推定する。** 伸ばされた箱の中身の外接矩形は、中身が中央に寄るので自然な幅に近いが、余白・付属ノード・タイトルの扱いをすべて描画から逆算することになり、エンジンの計算とずれる。エンジンのキャッシュを読めば一致する。
- **凡例の `perRow` を検証して勧める。** 凡例は YAML からコンパイルするときに展開されるので、写しを作るには YAML を書き換えてコンパイルし直す必要がある（テーマ・プロファイルの上書き、レジストリ、画像の場所も再現する）。今回は道筋で凡例を名指しし、`perRow` を案内するまでにとどめた。
- **道筋の外の値（幅を決めていない列の gap など）も候補にする。** 幅を決めない値を変えてもページは狭くならない（#307 で確かめた）。試しの予算を無駄にする。

## 費用の上限

- 超過していない図（`fit: scale` なしで収まる図）: 何も増えない。
- 構造化の図が超過したとき（`exceeds-page-width`、または `heavy-scaling` が出たとき）:
  - 木のための配置 1 回（`structuredWidthTree`）。
  - 収まる値の試しは **1 診断につき最大 8 回**（`MAX_FIT_TRIALS`、元の図の 1 回を含む）。1 回は配置・配線 1 度ずつと、ページに収まったものだけ SVG と geometry lint 1 度。テストで `placeStructured` の呼び出し回数が試しの回数と一致し、8 以下であることを確かめる。
  - 収まる値が見つからないときだけ、従来の `verifyHints`（最大 6 回、#307）。
  - 全体を `asHintTrial` の中で走らせるので、写しにかけた規則の中のヒントは試しを始めない。ほかの規則の試しの中（`inHintTrial`）では木も試しも作らない。
- 試しを走らせない図: 要素が 240 を超える図（`MAX_FIT_ELEMENTS`。木と道筋は出す）、HTML・外部ファイルの画像を含む図、auto の図（描いた座標の内訳だけ）。
- 計測（Apple M 系、examples・Skill の例・`docs/assets`・`tests/fixtures` の 156 図のうち描画できた 124 図）: 幅を超える図は 20 図で、木と収まる値の探索に足した時間は合計 0.2 秒。試しを走らせたのは `tests/fixtures/figures/layout/a-transformer.sumi.yaml` の 1 図（3 回、36ms）だけで、ほかは道筋の値を全部最小にしても足りない（試しなし、各 3〜10ms）、外部の画像を含む（`llada`・`clip`）、要素が 240 を超える（`fit/c-h3world`、木だけで 104ms）。#603 の run 6 の図（160 要素）を 2.2mm 超えるようにした写しでは、lint 全体が 0.38 秒から 0.62 秒になった（試し 2 回と lint 1 回）。

## 互換性

- 描画結果（ギャラリー・examples・ゴールデン・再現図）は変わらない。エンジンの変更は読み取り専用のメソッドと、配置の最後に呼ぶ任意のコールバックだけ。`bun run gallery:check` がバイト一致を確かめる。
- 新しい診断コードはない。変わるのは `geometry/exceeds-page-width` と `geometry/heavy-scaling` のヒントの文面だけ（ギャラリーはメッセージだけを載せるので変わらない）。ギャラリーの図で両規則が出るのは `dit-block` と `clip` の `heavy-scaling`。どちらもヒントに道筋が増えるだけで、収まる値は出ない（`dit-block` は道筋の値を全部最小にしても 13.88mm しか減らず、`clip` は外部の画像を含むので試しを走らせない）。どちらも妥当（`fit: scale` で縮める図で、詰めても収まらない）。
- `geometry/relocatable-node` の試しの道具（`layoutTrial`、`problemsOf`）を `trial.ts` に移した。振る舞いは同じ（除く規則を引数にしただけ）。
- 既存のテストのうち、ヒントに「gap を 0mm に」が出ることを確かめていたもの（`verified.test.ts`、`width.test.ts`）は、収まる値が見つかる図では `verifyHints` を直接呼んで確かめ、診断のヒントには収まる値が出ることを確かめるように変えた。
