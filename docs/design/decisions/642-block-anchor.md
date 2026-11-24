# #642 線の出どころとラベルの帰属をはっきりさせる

## 背景

#639 の 10 本のうち 5 本（1・4・5・9・10）で、線がどこから出るか、ラベルがどの線のものかが曖昧だった（横断の 3・8）。

- run 1（d4rt）: `from: query` は tokens 全体（#281 の枠のグループ）を指すが、枠には線も余白もないので、辺の中央から出る線は真ん中のセル（t_tgt）に触れて「t_tgt だけがデコーダに入る」と読めた。列 F → デコーダも同じで、真ん中のセルから出ているように見えた。
- run 9（a2a-task）: Terminal のグループから New task への線を `fromAnchor: straight` にすると、New task の中心の真上、つまり completed の真下から出た。書かないとき（既定）は、キャプションが下辺の中央をふさぐので横の辺（west）の中央から出て、1 行のグループでは completed の横から出たように見える。
- run 4・9: 平行に近い 2 本の線の間にラベルがあり、どちらの線のものか分かりにくかった（run 9 の「credential」は自分の線から 2.2mm、隣の CancelTask の線から 2.1mm）。lint は何も言わなかった。
- run 5: 下向きの線の `labelSide: left` は東（進行方向の左）に出る。仕様どおりだが、Skill の例は右向きの線しかなかった。
- run 5・9: 短い区間でラベルが浮き、`edge-label-detached` の info は「どの編集も確かめられなかった」と言うだけで、どう置けばよいかを言わなかった。

## 決定

### 1. `fromAnchor` / `toAnchor` に `block` と `block:<side>`

既存のアンカーの書き方（`<side>`、`<side>:<0..1>`、`straight`、`straight:span`）に並べて、`block`（辺は既定の選び方）と `block:north` などを足す。

- 意味: その端は要素**全体**に、辺の**中央**で接する。ほかの端と分け合わない（`spread`・多重辺の振り分け・`straighten` の滑り・自動の `straight` の対象外）。`block:<side>` は IR では `{side, offset: 0.5}` のアンカー、`block` はアンカーなし（ルーターが辺を選ぶ）。どちらも EdgeIR に `fromBlock` / `toBlock` を立て、`ports.ts` の `chooseWith` が選んだ辺の中央に固定する。
- 括弧（ブラケット）: 端の要素が**枠を描かない**グループ（tokens の枠、matrix の枠、`plain` のグループ。`GroupIR.variant === "plain"`）なら、その辺に沿って中身の幅（tokens はセルの外接矩形 = `endpointRects`）の棒を引き、両端に中身へ向かう短い爪（最大 2pt、中身まで 1pt 残す）を付ける。線はこの棒の中央から出る。棒は中身から 3pt（`BRACKET_ROOM`）離す。枠の余白が 3pt 以上ならその辺の上、足りなければ枠の外に出し、経路の端を棒まで縮める。
  - 配置は変えない。ルーターはその端の「曲がる前の直線」（`fromLane` / `toLane`）に 3pt を足すだけで、括弧は配線のあとで `withBlockBrackets`（`src/layout/block-bracket.ts`）が `EdgeRoute.brackets` に入れる。直線の区間が短い（共有の幹線までの短い突き出しなど）ときは、1 単位と矢じりを残せる分だけ縮める。1pt 未満なら枠の辺の上に棒だけを引く。
  - SVG ではエッジの `<g>` の中の `<path class="sumi-edge-bracket">`（線の色と太さ、破線の辺でも実線、角は直角）。編集可能 PPTX は開いた freeform として描く。
- 枠のあるグループ（`default` など）には括弧を描かない。枠が全体を示しているので、辺の中央から出せば足りる。
- `block` をノード（tokens のセル、cuboid のブロックを含む）の端に書くと `layout/block-anchor`（error）。tokens と matrix を展開したあと（`checkFigure` の `expandTokens` の直後）に調べる。セルなら hint で「`from: query` のように tokens 全体を書く」と言う。

### 2. グループから出る線

既定の位置は**変えない**。既定でも、その辺の端が 1 本だけなら中央から出る。run 9 のずれは、キャプションが下辺の中央をふさぐときに横の辺へ逃がす既定（#491）と、1 行のグループの横の辺の中央が子の行と同じ高さにあることの組み合わせによる。下辺の中央に変えると、キャプションをまたぐ線が増え、既存の図の出力が変わる。はっきり良いとは言えないので、Skill に次を明記した。

- グループの端にも `fromAnchor: "south:0.5"` がそのまま効く（確かめた。テストあり）。`block:south` も同じ点で、ほかの端と分け合わない。
- キャプションが下にあると、線はキャプションのわきを通る。気になるならキャプションを外側のグループに移すか、見出し（`label`）にする。

### 3. lint `geometry/edge-label-ambiguous`（warning）

structured のエッジのラベルについて、字（行ごとのグリフの輪郭）から自分の描かれた線までの距離 `own` と、ほかのエッジの線までの最短の距離 `other` を測る。`0 < other ≤ 1.75 × own` かつ `other ≤ ラベルの間隔 + 文字サイズの 3/4`（`edge-label-detached` の「線のラベルに読める」範囲）なら報告する。

- 対象外: 札（`labelStyle: tag`。自分の線の上にある）、自分の線に触れるラベル（`edge-label-touches-line`）、ほかの線が字に触れる・横切るもの（`edge-touches-label` / `edge-crosses-label`）、同じネット（共有の幹線は意図したもの）、ズーム線、シーケンス図のライフライン。
- hint: いまのラベルが進行方向のどちら側にあるか（最も近い線分で外積を取る）を求め、反対の `labelSide` を名指しする。ほかに `labelStyle: tag`、`labelAt`、端を離す。
- warning にした理由: ラベルを別の線のものと読むと図の意味が変わる（遷移の条件が別の遷移に付く）。`edge-label-touches-line` と同じく読み違いの問題で、直し方も安い。出荷している図（examples・gallery・Skill の基本レイアウト、64 枚）で比を測ると、1.75 以下は 0 件（最も近いものはシーケンス図の 1.92）で、誤検知はなかった。
- 1.75 にした理由: run 9 の「credential」は 0.95、run 4 の最終版の (5) は 1.68 で、レビューはどちらも「どちらの線か分かりにくい」とした。1.5 では run 4 を拾わない。

### 4. `edge-label-detached` の hint

確かめた編集がないときの文を「`labelStyle: tag` で線の上に載せる」から始め、次の具体的な置き場所を足した。

- 線の最も長い直線の区間の長さと、ラベルを脇に置くのに要る長さ（その向きの字の長さ＋両端のラベルの間隔＋矢じり）。
- 区間をどれだけ延ばせばよいか。札（字の長さ＋矢じり）がその区間に収まるなら「`labelStyle: tag` が収まる」、収まらなければ「札もこれだけ要る、ラベルを短くする」。
- 区間が十分に長い（別の理由で浮いた）ときは何も足さない。

### 5. Skill

`structured.md` に、`block` の項（例つき）、tokens の「全体の名前」の項からの案内、グループから出る線の段落、`labelSide` の下向き・上向きの例（下向きでは `left` が東、`right` が西）、新しい lint を足した。`diagnostics.md` に `layout/block-anchor` と `edge-label-ambiguous` を足した。

## 採らなかった案

- **tokens の枠に余白を足して棒を枠の辺に置く**: 最初に試した。配線は普通の端のままでよいが、余白は 4 辺すべてに付くので、run 1 の図が 5.3mm 広がって紙幅を超えた。辺ごとの余白は、配置の前に辺が決まらない（`block` は辺を書かない）ので使えない。
- **グループの既定を常に辺の中央にする**: 上記 2。キャプションをまたぐ線が増え、既存の出力が変わる。
- **`edge-label-ambiguous` を info にする**: 出荷図で誤検知がなく、読み違いは意味の誤りになるので warning にした。

## 互換性

- `block` を書かない図は、配置・経路・SVG とも変わらない。ギャラリー・examples・ゴールデン・ピン留めした再現のハッシュは変わらない（`bun run gallery:check`、`reproduction-hashes.test.ts`）。
- 新しい lint は出荷図では出ない。lint の出力のゴールデンは変わらない。
- スキーマ: `ANCHOR_PATTERN` が `block`、`block:<side>` を受け付ける（`schema/figure.v1.schema.json` を再生成）。`layout/invalid-anchor` の文と hint に `block` が加わる。
