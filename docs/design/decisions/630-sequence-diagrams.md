# #630 シーケンス図: arrange の箱 `sequence`（lifeline・順序のあるメッセージ・注記・帯）

## 背景

#603 の run 9（MCP の Multi Round-Trip Requests）は、シーケンス図の部品がないため、`place` の座標・隠しジャンクション 18 個・lifeline の線分 18 本で組んだ。メッセージを 1 つ足すと y 座標を全部直すことになる。#614 でこれを独立の課題に分け（`614-missing-parts.md` の 4）、この issue で設計と実装を行った。

方針は #614 と同じで、汎用の部品にとどめる（プロトコルや API を前提にしない）、既存の出力を変えない、既存の配線・描画・lint・PPTX をそのまま使う。

## 決定

### 1. 書き方: arrange の箱 `sequence`（structured のみ）

```yaml
arrange:
  sequence:
    participants: [user, client, server]   # 実在のノード（またはグループ）
    rowGap: 2mm                            # 任意
    participantGap: 6mm                    # 任意
    lifeline: {variant: muted, dash: dashed, lineWidth: 0.5pt}   # 任意
    rows:
      - call1                                          # edges[].id: 1 行に 1 つのメッセージ
      - {note: keeps-state, over: [server]}            # 注記（lifeline の上）
      - {note: payload, over: [client], side: right}   # 注記（lifeline の横）
      - [prompt, {note: busy, over: [server]}]         # 帯: 同じ行に並べる
      - {fragment: "loop [until done]", rows: [call2, result2]}   # 枠と見出し
```

- `chat` と同じ位置づけの箱にした（ルート・グループの中・入れ子の箱のどれにも書ける）。参加者・注記はどれも普通のノード（アイコン・tone・sublabel・グループもそのまま使える）、メッセージは普通の `edges[]`（`label`・`variant`・`dash`・`tone`・矢じり）。y 座標・ジャンクション・lifeline の線は書かない。メッセージを 1 行足すのは、辺を 1 本と `rows` の 1 行で、他は書き直さない。
- 行の種類は 4 つ: 辺の ID（メッセージ）、`{note, over, side?}`、帯（リスト）、`{fragment, rows, …}`。
- `participants` と `rows` の名前は issue の案のまま。`fragment` の値はそのまま見出しの文字にした（`loop` / `alt` などの UML の種類は必須にしない。issue の案の `{fragment: round2, …}` の id は、見出しと別に名前を付ける用途がなかったので取らなかった）。
- 注記の `over` は 1 人、または両端の 2 人（その間の lifeline すべてにまたがる）。Mermaid の `over A,B` と同じ読み方で、間の参加者を全部書かせない。
- **帯**（`[a, {note: n, over: [p]}]`）は issue の案になく、run 9 の作り直しで足した。run 9 は「サーバーが状態を持たない」注記をユーザーとのやりとりの横に置いており、これを 1 行ずつに分けると screen-doc の高さ（150mm）を 15mm 超えた。同じ lifeline を使う行は並べられない（`layout/sequence-invalid-row`）。並べた行どうしが同じ列の間隔を分け合うときは、その間隔を両方の幅の和まで広げる。

### 2. 展開: 普通の要素に置き換える（`src/core/figure/sequence.ts`）

検査の段階（`expandChats` の直後、link・layout の前）で、箱を普通の要素に展開する。描画・PPTX・lint は新しい種類の図形を知らなくてよい。

- メッセージごとに、両端の lifeline の上に隠しジャンクション（`seq-<n>-m<k>-from` / `-to`）を作り、辺の `from` / `to` をそれに付け替え、`route: straight` にする。ラベルは行の向きに合わせて線の上（右向きは `labelSide: left`、左向きは `right`）。複数の lifeline をまたぐメッセージは、ラベルを始点側の列の間に置く（`labelAt: start`）。作者が書いた `route` / `labelAt` / `labelSide` / `lane` は残す。
- 自分自身へのメッセージは、同じ lifeline の 2 つのジャンクションを `lane: {side: east}`（#609）でつなぐ小さなループにする（ラベルはループの右、`labelAt: middle`・`labelSide: left`）。ループの幅はプロファイルの arrange gap の 3/4。
- lifeline は参加者から下端の隠しジャンクションまでの `line` 辺の鎖（`seq-<n>-life-<i>-<k>`、既定は `muted`・`dashed`）。注記が lifeline の上にあるときは、注記の上下の枠のすぐ外にジャンクションを置き、その間は線を引かない。線の幅は既定でテーマの `line.thin`（なければ muted の線の半分、textScale × 0.5pt 以上）にし、メッセージより細く見せる。
- 帯（fragment）は、隠しジャンクション 2 つ（枠の左上・右下の角）・見出しの `label` ノード・中の注記を members にした `rect` の set（`padding: 0`）にする。描き方は sets の rect と同じで、`variant`（既定 `outlined`）・`tone`・`fillOpacity` を渡す。見出しは太字（`weight` / `text` で変えられる）。
- 生成した ID は `seq-<n>-` で始まり予約する（作者の要素と重なれば `ref/reserved-id`）。生成した要素は `doc.expanded`（`from: "sequence"`）に記録し、診断は箱の場所を指す。生成した set の診断の場所は帯の行（`doc.sequenceSets`）。
- 誤り: 辺のない行（`layout/sequence-unknown-message`）、参加者でない端・注記（`layout/sequence-unknown-participant`）、2 回置いたメッセージ・`side` の注記に複数の参加者・lifeline を共有する帯・重複した参加者（`layout/sequence-invalid-row`）。auto エンジンは `arrange` そのものが `layout/structured-only` なので、何も足していない。

ノードを置く箱として扱うため、`sequenceKeys()` が箱の置く ID（参加者・注記・ジャンクション・見出し）を返し、layout の段階の「1 回だけ置く」検査も、IR の `items` もそれを使う。

### 3. 配置（`src/layout/structured/sequence.ts`）

`chat` と同じく固い箱（親が引き伸ばしても中は動かず中央に置かれ、#618 の straighten も中を動かさない）。

- **列（x）**: 参加者を左から並べ、lifeline は参加者の中心。隣り合う lifeline の距離の下限を集め（参加者の箱の半分ずつ + `participantGap`、メッセージのラベル（両側の lifeline から `clear` 離す。ラベルの幅 + 矢じりの余裕）、自分へのメッセージのループとラベル、注記のはみ出し、帯の枠と見出し）、足りない距離を間隔に足すことを変化がなくなるまで繰り返す（複数の間隔にまたがる下限は均等に配る）。`clear` は arrange gap の 1/4。
- **行（y）**: 参加者は下端をそろえる。各行は前の行の下端から `rowGap`（既定は arrange gap の 1/3）下に始まる。メッセージはラベルの高さ + ラベルの間隔の下に線。自分へのメッセージは、ラベルの高さとループの幅で決まる高さのループ。注記はその高さ。帯は見出しの行・中の行・下の余白。最初の行が見出しと重ならない（lifeline の間のメッセージなど）ときは見出しの横から始め、高さを節約する。
- **帯の枠**: 中の行が届く範囲（lifeline・ラベル・注記・入れ子の枠）に余白（arrange gap の 1/3）を足した矩形。見出しは枠の中の左上で、囲む最初の lifeline の左に置く（どの lifeline も見出しを横切らない）。枠の外の lifeline とは余白の分だけ離す。
- 注記を複数の lifeline に広げるのは、引き伸ばせるノード（`stretch` と同じ条件）だけ。
- 箱の大きさは、参加者・注記・ジャンクション・見出しの矩形と、自分へのメッセージのラベルの右端を含む。

### 4. lint

既存の geometry の規則がそのまま効くかを、デモの図（OAuth 風、エージェントの tool-call ループ、run 9 の作り直し）と Skill の見本で確かめ、足りないものだけ足した。

- lifeline は普通の辺なので、注記・ラベル・枠との重なりは今までの規則（`edge-through-node`・`edge-crosses-label`・`label-collision` など）がそのまま見る。lifeline が注記の枠に触れて `edge-through-node`（直線が輪郭をかすめる）にならないよう、ジャンクションを枠の外に置いた（規則を緩めていない）。
- **`geometry/dash-hidden` だけ、lifeline の線分を除いた**（`EdgeIR.lifeline`）。lifeline は行ごとの短い線分の鎖で、注記やメッセージの間の短い片は破線が 2 周期入らないが、1 本の長い破線として読める。
- **`geometry/exceeds-page-width` の hint**: 幅の道（#607）は sequence の箱で止まり、lifeline の間隔と、いちばん広い間隔を決めているもの（`participantGap`・メッセージのラベル・注記・枠）を書く。試す編集に `participantGap`（その値で決まっている間隔の数だけ効く）と、間隔を決めているメッセージのラベルを真ん中に近い空白で 2 行に折る編集（いちばん広いもの、次に全部）を足した。どちらも他の編集と同じく試しの配置・配線・lint で確かめたものだけを示す。
- `geometry/relocatable-node` は sequence の中のノードを動かす候補にしない（chat と同じ）。

### 5. 配線の修正（既存の不具合）

ルーターは、経路やラベルが内容の上・左にはみ出すと全体を平行移動するが、set の輪郭を動かしていなかった（`diagonal.ts` の同じ処理は動かしていた）。帯の枠がずれて見つかったので、ルーターでも set を動かすようにした。今の examples・ギャラリーにこの条件の図はなく、出力は変わらない（`gallery:check` で確認）。

### 6. PPTX・Skill

- 編集可能 PPTX: 展開した要素はすべて既存の図形（コネクタ・set の輪郭・ラベル）で書き出され、新しい処理は要らない（テストで確認）。
- Skill: `structured.md` に「Sequence diagrams」の節（`expect-render: fits` の例）、`layout-tips.md` の表の #614 の代わりの書き方を `sequence` に置き換え、`figure-format.md`（機能の版、構造の説明）、`diagnostics.md`（新しいコード、dash-hidden、幅の hint）、`SKILL.md` と layouts の「合うものがないとき」の案内にシーケンス図を入れ、基本レイアウト `sequence-diagram` を足した（lint 0 errors / 0 warnings）。

## 採らなかった案・後回し

- **lifeline を辺でない新しい図形にする**: 描画（SVG・PPTX）と lint（描いた線・重なり）をすべてに足す必要がある。辺の鎖なら既存の処理がそのまま効く。
- **注記の上下で lifeline を止めず、注記の後ろを通す**: `edge-through-node` に当たり、塗りのない注記では線が見える。
- **帯の見出しを set のラベル（輪郭の外）にする**: 外に置くと lifeline が見出しを横切る。枠の中の左上で、最初の lifeline の左に置いた。
- **activation（実行中の細い箱）、参加者を下にも繰り返す `mirror`、`alt` の else の区切り線**: 第 2 段階。`alt` は帯を 2 つ続けて書ける。
- **既定の `rowGap` を arrange gap の 1/2**: run 9 相当の図が screen-doc の高さに収まらず、1/3 にした。

## 互換性

- 追加したフィールド・コードはすべて新しく、`sequence` を書かない図の出力（examples・ギャラリー・ゴールデン・再現図のハッシュ）はバイト単位で変わらない（`gallery:check` と全テストで確認）。
- JSON Schema（`schema/figure.v1.schema.json`）を再生成した。
