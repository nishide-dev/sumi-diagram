# #610 辺のラベルの置き場を予測できるようにする

## 背景

#603 の 10 枚のうち 6 枚（2・3・4・6・7・9）で、辺のラベルの置き場が問題になった。

- 9-mcp-mrtr: `route: straight` のラベルの既定は「進行方向の左」なので、左向きのメッセージ（応答）だけラベルが線の下に来た。エージェントは左向きの全部に `labelSide: right` を書いて直した（log.md:「easy to get wrong」）。直交のルーターは向きによらず「横の線の上、縦の線の右」に置くので、2 つの規則が食い違っていた。
- 4-lost-multiturn: 戻りの線（U 字）の「if attempt」「otherwise: next turn」が、短い最後の線分から持ち上げられ（#332 の short span）、線から 3.5〜5.6mm 離れて浮いた。lint は何も言わなかった。
- 6-deepseek-v4（draft1）: 「window」が自分の線にかかった。
- 7-deepseek-r1: 列の間が約 7mm しかなく、辺のラベル（Dev1・Dev3）を線の横に置けなかった。線の上に載せる小さな名札がなかった。
- 線の途中の任意の点を指せなかった（`labelAt` は `start | middle | end` だけ）。

## 決定

### 1. `route: straight` / `curve` のラベルの既定の側

`labelSide` を書かないとき、線の向きによらず**線の上**に置く。垂直の線（x 成分が 0）では**右**。直交のルーターの既定（横の線分の上、縦の線分の右）と同じ言い方になる。

- 実装: `direct-label.ts` の `readingSide(ux, uy)`。左法線 `(uy, −ux)` の係数として、`ux > 0` なら左（= 上）、`ux < 0` なら右（= 上）。垂直から 5° 以内（`STEEP_DEGREES`、|ux| ≤ sin 5°）は垂直とみなし、下向きで左（= 右）、上向きで右（= 右）。曲線は中点の接線で同じ判定をする。
- `labelSide` を書いた辺は従来どおり「source → target に向かって左右」。自己ループの外側の既定（`loopLabelEdge`）も変えない（明示の `labelSide` として渡す）。
- 斜めの線は「上」を優先した。「上か右のうち近いほう」（法線の右成分＋上成分の符号）も試したが、急な右上がりの線でラベルが左上から右下へ移り、ピン留めした再現 tricl の T₁ が動いた。「上」の規則では左向きの成分を持つ線だけが変わる。垂直の付近では「上」の側が x 成分の符号で左右に入れ替わるので、5° 以内は垂直として右に置き、ほぼ垂直な線がわずかに傾いただけでラベルが反対側へ飛ばないようにした。

### 2. `labelAt` に割合

`labelAt: 0.3` のように 0〜1 の数を書ける（スキーマは `start | middle | end` との union）。

- 直交: 経路の長さ（各線分の長さの和）の割合の点を求め、その点のある線分の横に、ラベルの中心をその点に合わせて置く（`routeFraction`）。角ちょうどなら後の線分（終点なら最後の線分）。その線分の矢じりと gap からは離す（収まらなければ線分の中央）。そこから `middle` と同じく線分に沿って滑って障害物を避ける。側は `labelSide`、なければ上・右を先に両側。
- `straight` / `curve`: 線の長さ（曲線は弧長）の割合。`start` / `end` と同じく矢じりから離す。
- `labelAt` を書いた辺なので、置き場の衝突は従来どおり `layout/edge-label-overlap`。その hint に「0.3 のような割合」も挙げる。

### 3. `labelStyle: tag`

`labelStyle: beside | tag`（既定 `beside`）。`tag` は文字を線の上に載せた小さな札にする。

- 形: 文字の行の箱に、左右に文字サイズの 1/3、上下に 1/10 の余白を足した角丸の枠（`tagBox`）。塗りは下に塗られている色（`labelBackground`: キャンバスかグループの塗り）で、線を隠す。枠は線の色、線の太さ（最大 0.5pt）、破線の辺でも実線。SVG では `<text>` の直前の `<rect class="sumi-edge-tag">`。編集可能 PPTX はラベルの直前の `rect` を背景として読むので、塗りは残る（枠線は描かない）。
- 置き場: 直交では `labelAt` と同じ仕組み（`placeRequestedLabel`）で、側の代わりに線の上（オフセット 0）。既定の線分は**最長の線分の中央**（矢じりの横ではない。名札は線の途中を指すため）。自分の載る線分は障害物にしないが、ほかの線分・矢じり・枠・ノード・ラベルからは gap を保つ（ノードとは、横に置くラベルと違って線からの gap がないので、枠を gap だけ広げて判定する）。短い区間でも線から持ち上げない。`labelSide` は無視する。
- `straight` / `curve` では中心を線上の点に置く（法線方向のずれなし）。
- `layout/edge-label-overlap` は札について文字の箱ではなく**描く枠（`tagBox`）**で重なりを見る（ほかのラベルとして並ぶ札も枠）。自分の載る線分は「its own line」に数えない。hint の試行もこの診断を数えるので、枠で確かめる。`geometry/edge-label-hugging` は札を見ない（枠が線を隠すので、文字と線の距離は意味がない）。
- auto（D2）の図では `layout/structured-only`（error）。

### 4. lint: `geometry/edge-label-detached`（info）・`geometry/edge-label-touches-line`（warning）

ルーターが自分で置いたラベル（直交の辺で `labelAt`・`labelSide`・`labelStyle` なし、凡例の見本でない）だけを見る。書いて置かせたラベルは `layout/edge-label-overlap` の担当。`straight` / `curve` のラベルは作りから gap を保つので見ない。

- 距離: 文字の**グリフごと**の輪郭の外接矩形（`inkGlyphs`。フォントの `glyf` から。輪郭のわからない行は行の箱、runs のラベルは run ごとの箱）と、描かれた自分の線（`drawn`、線幅の半分を引く）の最短距離。行ごとの和集合（`inkLines`、hugging の測り方）では、語と語の間の空白を通る線まで「触れる」になり、warning が誤って出るため（レビューの指摘）。
- **detached**: 距離 > ラベルの gap（`labelGap`: テーマの `edgeLabelGap` × `textScale`）＋ 文字サイズの 3/4。ふつうに置いたラベルは gap ＋ 0.3em 程度（sumi で 8.5 units）で、持ち上げられたものは 18〜76 units だった（下記）。info とした: 文字は読めるが、どの線のラベルかが曖昧になる。
- **touches-line**: 距離 ≤ 0（文字が線に触れるか、線が文字を横切る）。warning とした（`layout/edge-label-overlap` と同じ重さ）。
- **hint は実際に配線し直して確かめる**（#607・#613・#621 と同じ `trial.ts` の型）:
  1. 候補の編集を順に試す: `labelAt: middle` → `labelAt: start` → `labelAt: end` → `labelStyle: tag`。
  2. 各候補は、コンパイル済みの IR の辺だけを変えた写しを、**同じ配置**（`context.placed.layout`）の上で `routeStructured` し直す（`routeTrial`。ラベルは配置に影響しないので配置はやり直さない）。描いて、図と同じ設定で幾何 lint をかける（`trialContext`）。
  3. 合格の条件: 試行にエラーがない、キャンバスが大きくならない、`labelAt` ならラベルが線から 0 より大きく上限以下（札なら線の上）、図全体で新しい error / warning がない、**その辺について新しい指摘がない**（info を含む: 角に寄った札、線に押し付けられたラベルなど）。
  4. 最初に合格した編集を `Verified: setting edges[6].labelAt to start puts the label 1.58mm from its line (...)` の形で hint にする。どれも合格しなければ、一般的な案と「試した編集はどれも通らなかった」ことを書く。
  - 基準: 図そのものも一度だけ配線し直し、キャンバスと全ラベルの位置が描いた図と一致するときだけ比べる（一致しなければ「確かめられなかった」）。
  - 費用: ラベルが流れていなければ何もしない。流れていれば、図あたり最大 8 回の配線（＋基準 1 回）。`HintTrials` の対象（要素 80 以下）で HTML・外部画像のない図に限る。試行の中では `relocatable-node`・`content-band`（自分で試行を始める規則）を動かさない。この 2 つの規則は試行の中でも動かし、そこでは試行を始めず検出だけする（`inHintTrial`）。基準にない「ほかのラベルの detached / touches-line」が試行に出たら、その編集は通さない（ある辺のラベルを動かして別の辺のラベルを線から押し出す・線に載せる編集を見逃さない。レビューの指摘）。

## 採らなかった案

- **既定の側を `labelSide: left` のまま、lint で左向きを指摘する**: 書き忘れを後から直させるより、規則を 1 つにしたほうが予測しやすい。直交のルーターと同じ言い方にそろう。
- **斜めの線は「上か右の近いほう」**: 上記 1。急な右上がりで側が変わり、tricl が動く。
- **札の文字を小さくする**: 線の横のラベルとの対比が崩れ、最小文字サイズの lint にもかかりやすい。文字サイズはそのままで、枠を詰めて小さく見せた。
- **札を `labelAt` の既定（矢じりの横）に置く**: 矢じりの直前に枠があると矢じりが窮屈になり、名札が線の途中を指すという用途にも合わない。
- **詰まったラベルを自動で直す**: 置き場は意味を持つことがある（どちらの線のラベルか）。#621 と同じく、確かめた編集を示すだけにした。
- **全テーマ・全図に detached を warning で出す**: 既存の Skill の基本レイアウト compare-rows（「accepted」、3.3mm）がこれにあたり、確かめた編集も見つからない（区間が短く札も入らない）。読めないわけではないので info にした。

## 互換性

- 出力が変わる図: `skills/sumi/layouts/loop-cycle`（下の弧の「scores」が線の下から上=輪の内側へ）だけ。examples（ピン留めした再現を含む）、`docs/gallery/`、`docs/assets` は変わらない（`bun run gallery` の差分が loop-cycle の SVG のみ。`SUMI_UPDATE_REPRODUCTIONS` なしで `reproduction-hashes.test.ts` が通る）。
- 直交のルーターで置くラベルの位置は変わらない（`labelStyle` を書かない限り、`placeEdgeLabel` の既定の経路は同じ）。
- 新しい lint の指摘: compare-rows（detached、info）。テストの fixture では `literal-newline`・`rag-compare-a` が detached（info）。touches-line はリポジトリの図に 0 件。
- スキーマ: `labelAt` は文字列か数、`labelStyle` は新しい項目。既存の YAML はそのまま有効。

### 測定（ルーターが置いたラベルの文字と線の距離、units）

examples・Skill の基本レイアウト・`docs/assets`・`tests/fixtures/figures`（invalid を除く）の 111 本のラベル:

| | 距離 | 距離 / gap |
| --- | --- | --- |
| ふつう（sumi、gap 6） | 6.1〜8.7 | 1.0〜1.45 |
| ふつう（そのほか、gap 3） | 1.7〜5.8 | 0.6〜1.9 |
| compare-rows「accepted」（sumi、14px） | 18.8 | 3.1（上限 16.5） |
| rag-compare-a「verified」 | 18.5 | 3.1 |
| literal-newline（3 行） | 38.2 | 12.8 |
| #603 4-lost-multiturn「if attempt」 | 5.6mm | — |
| #603 7-deepseek-r1 draft「Dev3」 | 8.8mm | — |
