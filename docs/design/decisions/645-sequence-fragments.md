# #645 シーケンス図: 淡いフラグメントの枠、参加者の高さ、複数の宛先

## 背景

#639 の run 8（AP2、6 者・19 メッセージ、`sumi`・screen-doc）で、`arrange: sequence`（#630）の残りの不足が 3 つ見えた。

- フラグメントの枠が `rect` の set の既定（`outlined`、gray の tone の線、`base.group` の 1pt）で描かれ、#634 で淡い 0.5pt の細線にした `sumi` のグループの枠と重さが違う。Phase 1 の枠の右端が Credential Provider の lifeline のすぐ横（配置上 11 単位 = 5.5pt。`fit: scale` の 79% と 1pt の濃い線で約 1mm に見えた）を通り、線が重なって見えた。
- 参加者の箱が 1 行と 2 行で高さが違い、上端が揃わない（下端揃え）。
- 1 つのメッセージを 2 者に送る書き方がなく、Payment Receipt を 2 本の辺で描いた。

## 決定

### 1. フラグメントの枠をテーマのグループの枠で描く

- `variant` も `tone` も書かないフラグメントは、テーマのグループの枠（`sumi/container` の既定の variant の線の色と幅）で、塗りなしの輪郭として描く。`sumi` は #a9aebc の 0.5pt、`sumi-dark` は #6f7791 の 0.5pt で、#634 のパネルの枠と同じになる。`themeOverrides.groupStroke` / `frameWidth` もグループと同じく効く。
- 実装: 展開（`sequence.ts`）がそのようなフラグメントの set の番号を `doc.sequencePanels` に記録し、IR が `resolveSetStyle(…, {panel: true})` を渡す。`panel` は tone のない `outlined` の set にだけ効く。作者の set（`sets[]`）には書けない内部の指定で、set の意味（分類の輪郭は 1pt の tone の線、#634）は変えない。
- 見出しは今までどおり太字の `label` ノード（文字の色は濃いまま）で、枠が淡くなっても読みやすさは変わらない。
- `variant: outlined` を書けば従来の濃い 1pt の線、`tone` や `dashed` / `filled` は従来どおり set の塗り方になる（逃げ道として明記）。
- **ほかのテーマもそろえた**。理由:
  - フラグメントは「行のまとまりを囲む枠」で、パネル（グループ）と同じ役割を持つ。テーマごとに例外を作るより「フラグメントの既定 = そのテーマのグループの枠」の 1 つの規則のほうが説明しやすい（#634 の減光の規則と同じ考え方）。
  - `paper`（#656970 → #b4b8c0）も淡い枠のテーマで、`sumi` と同じずれがあった。`minimal`・`color`・`academic`・`slides` は同じ幅でわずかに明るい灰色になるだけ。
  - `llama` はグループの枠の幅が 0（パネルは塗りで区切る）で、従来のフラグメントは `base.group` の幅 0 を受けて**枠が見えていなかった**（既存の不具合）。グループの枠がないテーマでは、枠の色（`llama` は #8a96a1）をテーマの細線（`line.frame`、なければ `line.thin`、なければ 0.5pt）で描く。`themeOverrides.frameWidth`・set の `lineWidth` はこの代わりの線にも効く（テーマの幅 0 に戻って枠が消えないよう、レビューで指摘されて直した）。塗りのパネルにすると lifeline とメッセージの下に色が敷かれ、`fillOpacity` を書いた帯と区別できなくなるので採らなかった。

### 2. 枠の横の余白（幾何の修正）

- 枠の左右の辺は lifeline と平行に走る。従来は内側の lifeline・外側の lifeline とも `framePad`（arrange gap の 1/3、最小 6 単位）だけ離していた。これを `sidePad = max(framePad, 2 × clear)`（`clear` は lifeline とラベルの間隔 = arrange gap の 1/4）にした。screen-doc（arrange gap 34 単位）では 11 → 18 単位（5.5pt → 9pt、3.2mm）、既定の profile では 8 → 12 単位。
- 内側（囲む最後の lifeline と右辺、最初の lifeline の左の内容と左辺）と外側（右辺と次の lifeline）の両方に同じ値を使う。片側だけ広げると、枠の外の lifeline が辺に寄って同じ問題が出る。
- 上下の辺は変えない（lifeline は枠の上下の辺を横切るのが普通で、行の間隔は `rowGap` が決める）。
- 代償として枠のある図は少し広くなる（OAuth 風の図で screen-doc・textScale 1.5 のとき 176.6mm → 179.2mm、Skill の sequence-diagram は 83.8mm → 84.5mm）。

### 3. 参加者の箱の高さをそろえる

- 参加者は最も高いものと同じ高さにし、上端と下端をそろえる（ラベルは今までどおり箱の中央）。伸ばせるのは、grid / row の `align: stretch` で縦に伸ばせるノード（`height` を書いていない、輪郭部品・バッジ・グリフのない、伸びる形）だけ。円など伸ばせない形は従来どおり lifeline の上に下端揃えで置く。
- グループの参加者は伸ばさない（枠だけが伸び、中身が追従しない）。
- 箱の大きさ（高さ）は変わらない（最も高い参加者で決まっていた）。

### 4. 複数の宛先: `to: [b, c]`

- 辺の `to` にリスト（2 つ以上）を書ける。意味は「同じメッセージを各宛先に」で、sequence の行に置いたメッセージだけが使える。
- **描き方: 宛先ごとに 1 本の矢印を、書いた順に続く行に描き、ラベルは最初の 1 本にだけ付ける**。2 本目以降は辺の写し（ID `seq-<n>-m<k>`、予約）で、variant・dash・tone・矢じりなどの見た目は同じ、ラベルは空。ラベルのない行はラベルの行の高さを取らないので、矢印は `rowGap` と矢じりの分だけの間隔で並び、ひとかたまりに読める。
- 採らなかった描き方:
  - **1 本の線を伸ばし、途中の宛先にも矢じりを付ける**: 高さは 1 行で済むが、途中の矢じりから先が「受け取った者がさらに送る」（中継）にも読める。UML にもない表記。
  - **1 本から扇形に分ける**: シーケンス図の横向きの線（時刻が同じ）という約束を崩し、斜めの線が lifeline を横切る。
  - **同じ行に並べる（帯）**: 送り手から同じ向きの宛先へは線が重なる。向きが逆の 2 者なら並べられるが、一般の規則にならない。
  - **ラベルを全部に付ける**: run 8 の 2 本の辺と同じで、同じ文字が 2 回出る。
- 内部表現: 検証の段階でリストを `doc.recipients`（辺の番号 → 書いた宛先）に移し、辺の `to` は最初の宛先にする。以降の段階（link・theme・IR・lint・D2）は今までどおり 1 つの `to` だけを見る（`FigureEdge` の型も `to: string` のまま）。
- 誤り:
  - sequence の行でない辺にリスト（auto エンジンを含む）: `layout/multiple-targets`（error、辺を invalid にする）。
  - 宛先に送り手（自分へのメッセージは 1 つの宛先で書く）・同じ宛先を 2 回・帯の中: `layout/sequence-invalid-row`。
  - 参加者でない宛先: `layout/sequence-unknown-participant`。
  - 1 つだけのリスト: スキーマの誤り（`to: b` と書く）。
- run 8 の AP2 を `to: [sa, cp]` で書き直すと、Payment Receipt のラベルが 1 つになる。ただし元の図は Checkout Receipt を CP の Payment Receipt の横に帯で並べて高さを稼いでおり、複数の宛先の行は帯に入れられないので、行が 1 つ増えて screen-doc の高さを 1.8mm 超える（作者は `rowGap` などで調整する）。

## 互換性・影響

- 変わる出力: `sequence` を使い、`variant` も `tone` も書かないフラグメントがある図（枠の色・幅、横の余白）と、参加者の高さが違う図。examples・ギャラリー・論文の再現図・PDF / PPTX のゴールデン・lint 出力のゴールデンには `sequence` の図がなく、変わらない（`gallery:check`・再現図のハッシュで確認）。
- 変わる Skill の生成物: ベースレイアウト `sequence-diagram` の SVG・PNG と `previews.json`（lint は 0 errors / 0 warnings / 0 infos のまま）。
- テストの fixture（`tests/fixtures/sequence/`）のうち、`variant` も `tone` もない枠を持つ oauth は枠の見た目が変わる。`agent-loop`（`tone: blue`・`variant: dashed`）と mcp-mrtr（`variant: filled`）は塗り方が変わらず、横の余白だけが変わる。
- JSON Schema を再生成した（`to` のリスト、フラグメントの `variant` の説明）。

## 比較画像

before / after の PNG（rsvg-convert -z 2）を PR に添えた。run 8 の AP2（`sumi`・`sumi-dark`）、`to: [sa, cp]` で書き直した AP2、Skill の sequence-diagram、OAuth 風の図の各テーマ（sumi・sumi-dark・paper・academic・minimal・color・llama）、agent-loop、mcp-mrtr。
