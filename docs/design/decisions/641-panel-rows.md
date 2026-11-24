# #641 横に並んだパネルを揃える 1 語の指定（`row.panels`）と、揃いの lint（`geometry/panel-misaligned`）

## 背景

#639 の dogfooding（v0.20.0）で、10 本中 7 本（run 1・3・5・6・7・9・10）にパネルの空き帯や、高さ・見出しの不揃いが残った（review.md 横断の 2）。#613 で `contentAlign` / `matchLabelHeight` と `geometry/content-band` の info を入れたが、使われなかった。

- run 1: 根の row が `align: stretch`。(a) と (c) は中身が中央に置かれ、上下に 4〜5mm の帯が残った（content-band の info を「意図どおり」として残した）。
- run 5・7: 根の row が `align: center`（既定）。高さの違うパネルが縦に中央へ置かれ、見出し（7）やキャプション（5）が 2 段にずれた。
- run 6: (b) の中の row（Base・Agentic CPT・Post-training）で、2 つの group の枠と見出しがずれた。
- run 10: 根の row が `align: start`。上端は揃うが、下端が 8mm ずれた。
- run 3（(c) の中の row がノードを縦に中央へ置く）、run 9（`place`）は、パネルの並びではない。今回の対象外（下記）。

揃えるには `align: stretch` + 各パネルの `contentAlign: top` + `matchLabelHeight` の 3 つを書く必要があった。さらに `align: stretch` は row の中のノード（run 7 の Base）まで伸ばし、見出しを枠の外に置く group（`labelAt: above-*`）では図が伸びる（下記「既存の不具合」）。

## 決定

### 1. `row.panels: true`（structured のみ、row だけ）

row に `panels: true` を書くと、その row に直接書いた group（キャプション付きの group の展開した stack も含む）を「パネル」として扱う。

- パネルは row の高さを取る（交差軸に伸ばす。`align` に関係なく）。枠の上端と下端、キャプションの行が揃う。
- パネルの中身は見出しの直下に置く（group が `contentAlign` を書いていなければ `top`）。
- パネルの見出しの帯を 1 つの高さに揃える（group が `matchLabelHeight` を書いていなければ、row ごとの内部の名前で揃える）。1 行と 2 行の見出しが並んでも、最初の行が揃う。**ただし揃えると row が高くなるときは揃えない**（レビューの指摘）: 最も高い見出しと最も高い中身が別のパネルにあると、揃えた帯が中身の高いパネルにも加わり、row が「最大の見出し + 最大の中身」まで伸びる（指摘の例で 346 → 458 unit）。そこで pass ごとに、各パネルの「見出しの帯 + 枠の中身と padding + キャプション」の最大を、自分の帯のときと揃えた帯のときで比べ、揃えた方が高くなるなら各パネルは自分の帯のまま（見出しは枠の上端に揃い、最初の行だけがずれうる）。計算中は自分の帯を使い、再帰しない（`#panelBand`）。group が自分で `matchLabelHeight` を書けば、高くなっても揃える（書いた方が優先）。
- ノード、入れ子の箱（`{stack: ...}` など）は今までどおり row の `align` に従う（run 7 の Base は中央のまま）。tilted plane・tokens・matrix・legend の group はパネルにしない（中身が固定の描画で、伸ばす意味がない）。
- 実装はエンジン（`engine.ts`）だけで、IR の `contentAlign` / `matchLabelHeight` は書いたまま（as written）にした。パネルの判定は `src/layout/structured/panels.ts` の `panelGroupOf` 1 か所で、エンジンと lint が共有する。
  - `#placeLine`: パネルは `stretched` として扱い、オフセット 0、straighten（#618）で交差軸に動かさない。
  - `#boxSize`: パネルは中央寄せしないので、交差軸の大きさは item の高さそのもの（下記の既存の不具合を避ける）。
  - `#alignedContent`: `contentAlign ?? (パネルなら top)`。
  - `#labelHeight` と、`matchLabelHeight` の名前ごとの最大: `matchLabelHeight ?? row の名前`。名前は `\u0000panels:<n>` で、図が書ける ID（`^[a-z]…`）とぶつからない。
  - `#fillsHeight`: パネルのある panels row は高さを自分で埋める。その row を根に持つ group に `contentAlign` を書いても、パネルが伸びる方が優先する（#613 と同じ規則）。
- 図は大きくならない: row の高さは、各パネルが自分の見出しの帯を取ったときの最も高いパネルのまま。テスト（最大の見出しと最大の中身が別のパネル、`align: center` と同じキャンバス）と dogfood の 5 本で確かめた。

### 2. 既定を変える案との比較

| 案 | 内容 | 評価 |
|---|---|---|
| (A) row の 1 語の指定（採用） | `panels: true` | 書いた図だけが変わる。既存の出力（ギャラリー・ゴールデン・再現図）は変わらない。ノードを伸ばさない、図が伸びない、見出しの帯も揃う、の 3 つは `align: stretch` + `contentAlign` の既定化ではできない |
| (B) `align: stretch` のときの `contentAlign` の既定を `top` にする | 伸ばされた group の中身を既定で上に寄せる | 試しにエンジンの既定を `top` にして `bun run gallery` を回すと、15 ファイルが変わった: `examples/dit-block`（DiT の再現図、SVG・PDF）、`docs/gallery/strokes`（8 テーマ）、Skill の基本レイアウト `encoder-block`・`three-panel-flow`・`two-panel-compare`、ギャラリーの診断の一覧。再現図は原図の配置を保つ必要があり（#462）、変えるなら再現図に `contentAlign: center` を足すことになる。加えて (B) だけではノードも伸び、見出しの帯も揃わず、`align: center` / `start` の row（run 5・7・10）は直らない |

(B) は既存の出力を変え、利用者の承認が要る上に、dogfood の 7 本のうち run 1 しか直さない。(A) を採り、既定は変えない。

### 3. lint: `geometry/panel-misaligned`（info）

- **対象**: structured の図で、`panels` を書いていない row のうち、パネル（上と同じ判定）が 2 つ以上あるもの。tilted plane（`quad`）は除く。
- **測るもの**（描画の配置 `GeometryContext.placed` の Layout IR）: 枠の上端と下端（枠か塗りが見え、`opacity` が 0 でない group のみ。`plain` は枠が見えない）、見出しの y（下に置いた見出しは除く）、キャプションの y。どれかの差が **1mm（印刷時）以上**なら、row ごとに 1 件。
- **hint**: その row のパスに足す `panels: true`（`Add panels: true to the row at figure.layout.arrange.row (its other fields stay)`）と、それで何が起きるか。最初は row の項目も書き出したが、入れ子の箱を `{row: ...}` と略すと YAML として正しくないので、パスと足す欄だけにした（レビューの指摘）。パネルの group を `related` に並べる。
- **trial で確かめない**: content-band と違い、`panels: true` で起きることはエンジンが決めている（伸ばす、上に寄せる、帯を揃える。図は大きくならない）。配置し直す費用（1 図につき最大 5 回の配置・配線・lint）に見合わない。
- **path の制約**: arrange の IR は書いた場所を持たない。row のパスは IR を歩いて組み立てる。grid のセルを `{item: ...}` で書き、`span` も `align` もないときだけ、パスに `item` が抜ける（まれなので受け入れる）。
- `maxWarnings` には数えない。自動では直さない（ずれが意図のこともある）。

### 4. content-band / group-empty-area の hint を具体的にする

- `geometry/content-band`: 「setting groups[0].contentAlign to top」を、`writing contentAlign: top in group "pa" (groups[0].contentAlign; in YAML, the line "contentAlign: top" under "- id: pa")` に変えた。その group が `panels` のない row のパネル（2 つ以上）なら、`To line up all the panels of <row> at once …, write panels: true in that row instead.` を添える。
- `geometry/group-empty-area`: その group を `geometry/content-band` も報告するとき（`contentAlign` を書いておらず、中身の上と下の両方に 4mm 以上の帯がある。同じ関数 `contentBands` で判定）だけ、帯の寸法と content-band の hint（`contentAlign: top` の書き方、パネルの row なら `panels: true`）を指す。「中央に置かれている」「直る」とは言い切らず、確かめは content-band の trial に任せると書く（レビューの指摘: 上の帯だけで判断していた。中身を埋める根の箱では `contentAlign` は何も動かさない）。`contentAlign` は空きを減らさず動かすだけなので、そう書く。

### 5. Skill

- SKILL.md 手順 7 の 3（Consistency）に「横に並んだパネルの見出しと枠の上端が揃い、見出しの下に空き帯がない（なければ row に `panels: true`）」を足した。PR #651 が 7.4 に足す「info を残すなら hint を 1 度試す」は重ねない。
- `layout-tips.md` の批評のチェックリストに 8. Panel alignment、レシピの表と「Panels with one message each」を `panels: true` に。
- `structured.md` の「Group titles and captions」: `panels: true` を先に説明し、`contentAlign` / `matchLabelHeight` は「単独で使う細かい指定」とした。`aligned-panels` の例を `panels: true` に書き換えた。
- `structured.md` の「Flow arrows」の例（`stage-flow`）は、高さの違う枠付きパネルを `align: center` で並べていて新しい info が出た。`panels: true` にし、中央のパネルに 1 つ箱を足して高さを揃えた（パネルの中の空きで `group-empty-area` が出ないように）。
- `figure-format.md`（脚注と 0.20.1 の行）、`diagnostics.md`（新しい規則と 2 つの hint）。
- 基本レイアウト `three-panel-flow` を `align: stretch` から `panels: true` に変えた（エージェントが写す元なので、書き方を広める）。出力は数 unit だけ変わる（比較は PR に添付）。`two-panel-compare` は `figure.layout.align` で段を揃えた plain パネルで、変える利点がないので残した。

## 既存の不具合（今回は直さない）

`align: stretch` の row で、見出しを枠の外に置く group（`labelAt: above-*`、#517）があると、`#boxSize` が「枠の中心で中央寄せする」前提で交差軸の大きさを `2 × max(中心, 長さ − 中心)` と見積もり、見出しの高さの分だけ row が高くなる。伸ばされた item はその高さを全部受け取るので、枠が見出しの分だけ伸び、図も伸びる（run 7 で 44.1mm → 49.0mm、run 10 のレビューの「`row.align: stretch` にすると図が 10mm 伸びた」もこれと思われる）。`panels` ではパネルを中央寄せしないので、この見積もりを使わない。`align: stretch` 自体を直すと既存の出力が変わるため、別 issue にする。

## 採らなかった案

- **`align: panels`（`align` の新しい値）**: `align` は同じ軸の入れ子の箱に継承される。パネルの意味を継承させると入れ子の row のノードの扱いが曖昧になる。ノードの寄せ方（`align`）とパネルの扱い（`panels`）を別の欄にした。
- **stack・grid にも `panels`**: stack で伸ばすのは幅で、`contentAlign` は縦だけ（#613）。grid は行の高さが行ごとに共通で、`align: stretch` と `contentAlign` で書ける。必要になったら足す。
- **キャプションの行数の違いを揃える**: 2 行のキャプションのパネルは枠の下端が上がる。まれで、キャプションは短くするのが Skill の方針。Skill（`structured.md`）と schema の説明に、キャプションが 1 行に揃うのは行数が同じときだけと書いた。
- **hint を trial で確かめる**: 上記 3。

## 互換性

- 新しい欄の追加のみ。省略時の出力は変わらない（examples・ギャラリー・ゴールデン・再現図のハッシュ）。
- 変わる出力: Skill の基本レイアウト `three-panel-flow`（YAML を `panels: true` に変えたため。SVG と PNG を再生成）。
- lint の出力: `geometry/panel-misaligned`（info）が既存の図に増える。examples と docs/assets では `examples/gcn`（再現図。根の row のキャプションが 3.0mm、(a) の中の row の枠とキャプションが 1.4mm ずれる）の 2 件だけ。テストの fixture では `group-caption` の structured の fixture に 1 件。`content-band` と `group-empty-area` の hint の文面が変わる。いずれも info で、図は変えず期待する診断に記録した。

## dogfood（#639）の YAML で確かめた結果

各 run の `figure.sumi.yaml` を写し、1 行だけ変えて描いた（図の大きさはどれも不変）。

| run | 変更 | 結果 |
|---|---|---|
| 1 d4rt | 根の row の `align: stretch` → `panels: true` | (a)(c) の上下の帯が消え、中身が枠の上に揃う。content-band の info 2 件が消える |
| 5 qwen3-omni | 根の row の `align: center` → `panels: true` | 2 つのキャプションが 1 行に揃う。`panel-misaligned`（captions 8.2mm）が消える |
| 6 tongyi-dr | (b) の中の row に `panels: true` | Agentic CPT と Post-training の枠と見出しが揃う |
| 7 olmo3 | 根の row に `panels: true` | (a)(b) の枠の高さ・見出しの高さが揃い、中身は上に。Base は中央のまま。`panel-misaligned`（7.7mm）が消える |
| 10 kafka-queues | 根の row の `align: start` → `panels: true` | 2 つのパネルの下端が揃う |
| 3・9 | — | パネルの並びではない（3 は (c) の中の row がノードを中央に置く、9 は `place`）。対象外 |
