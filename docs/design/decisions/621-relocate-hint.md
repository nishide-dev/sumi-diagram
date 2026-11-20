# #621 ノードを grid の空きセルや stack の別の位置へ動かすと線が素直になるとき、lint のヒントで示す

## 背景

`tests/fixtures/figures/color-use/request-states-a.sumi.yaml` では、Retrying が grid `active` の最下段（5 行 6 列）にある。そのため c-error → Retrying と Retrying → c-backoff が、それぞれ 2 回曲がる Z 字になる。Retrying を 1 段上げて 4 行の 5〜7 列を `c-backoff, retrying, c-error` にすると、2 本とも一直線になり（ラベルの位置で 1 回曲がる素直な形）、空になった最下段がなくなって図も 9.9mm 低くなる。

既存の仕組みはどれもこの移動を出せない。

- `figure.layout.straighten`（#618、#620 で既定）は、箱の余裕の範囲でずらすだけで、行や列をまたがない。
- `geometry/avoidable-bend`（#604 / PR #617）は線の引き方（アンカー・小さな段・階段・ジャンクション直前の折れ）だけを見る。この図には何も出ない（Z 字はアンカーのせいでも、段が小さいわけでもない）。

## 決定

- **新しい規則 `geometry/relocatable-node`（info、`src/lint/geometry/relocatable.ts`、structured のみ）**。
  - `geometry/avoidable-bend` に入れない理由:
    - 対象が違う。avoidable-bend の 4 つの場合（アンカー・2mm 未満の段・4mm 未満の段の階段・ジャンクション直前の折れ）のどれにも当たらない Z 字が対象で、request-states-a にも avoidable-bend は出ない。
    - 直し方の種類が違う。avoidable-bend は線を直す（アンカーを書く・邪魔なものをどける）。この規則は配置（どのセル・どの順か）を変える提案で、作者の意図（異常系は下、など）に踏み込む。だから warning でなく info にし、規則ごと止められるようにする（`--rule geometry/relocatable-node=off`）。
    - 費用が違う。配置からやり直す（`straighten` を含む）ので、配線だけやり直す avoidable-bend の確認より重い。予算を別に持つ。
- **対象の線**（`excessEdges`）: 描かれる直交経路のエッジ（`route: straight` / `curve`・zoom・自己ループ・祖先と子孫の間は除く）で、両端の箱がどちらかの軸で重なるのに曲がる、または重ならないのに 2 回以上曲がるもの（必要な曲がり数は、重なれば 0、重ならなければ 1）。扇・扇形の合流・多重辺の枝（ジャンクションの端、または同じ辺をほかの線と共有する端。avoidable-bend の `inGroup`）は群の形なので除く。対象がない図では何もしない（配置もやり直さない）。
- **候補**: 対象の線の両端それぞれについて、端そのものを持つ arrange の item と、その 1 つ外の item（端を含むグループ、または入れ子の stack / row / grid）。相手の端も含む item は動かしても意味がないので除く。
  - grid: span 1 の item を、行・列ともに 2 以内の空きセル（`null`、span 1）と入れ替える。動かした item のいた行が最終行で、移動で空になったら、その行を `items` から除く（空の行も行の間隔を取るため。request-states-a が低くなるのはこのため）。
  - stack / row: 並び順を前後 2 つまで入れ替える。
  - place・chat・見出しを展開した stack（#130）の中は動かさない。
  - 並べ方: grid では、動かした先が同じ grid の相手の端と同じ行か列になる数が多い順、次に動かす距離が短い順、次に見つかった順。
- **確かめ方（本当にやってみる）**: 候補ごとに、コンパイル済みの IR の arrange を書き換えた写し（`mapBoxes`）を、描画と同じ手順で配置・配線し直す: `placeStructured`（`figure.layout.align` の解、`straighten` は図の設定どおり、矢じり前の余白の再配置）→ `routeStructured`（立方体の面の経路 #587、続いてルーター）。配置・配線の中ではヒントの試し（align / grid / 幅のヒント）を走らせない（`asHintTrial`、`hintTrials: false`）。次のすべてを満たすものだけを残す。
  1. その候補を生んだ線（同じ移動を生んだ線をまとめる）の曲がりの合計が減る。または、合計が同じで迂回（経路の長さとの差: 両端の間の Manhattan 距離を超える分）が 1pt 以上短くなる。
  2. どの線も曲がりが増えず、経路を失わない。対象の線以外は、迂回も 1pt を超えて長くならない（1pt までは許す。メッセージにもそう書く）（曲がり数が同じまま遠回りになる線を除く。レビューの指摘）。比べる元は描画済みの経路。
  3. キャンバスが幅・高さのどちらにも大きくならない。
  4. どの線も向きが逆にならない（両端の中心が x か y で 1 unit を超えて離れていて、その符号が反対になる）。並べ替えで読む向きが変わる提案（`group-caption` の enc と dec の入れ替え: 曲がりは 8 → 6 に減るが、Encoder → Decoder が右から左になる）を除く。
  5. 新しい error / warning が出ない。比べるのは、配置・配線の診断と、ほかの geometry 規則（この規則を除く）を写しにかけた指摘。写しの文脈は通常の lint と同じに作る: 写しの SVG（`writeStructuredSvg` → `inspectSvg`）に、写しの配置（`placed`）と経路（`layout`）を添える（`geometry/avoidable-bend` が写しでもアンカーのヒントを配線し直して確かめ、指摘を同じように出す）。規則の重さと options は利用者の lint 設定どおり（`runGeometryRules` が文脈に `lintConfig` を渡す。info を warning に上げていればそれも数える）。コードと対象ごとの数が元の図より増えたら外す。元の図の数は、最初の候補が 1〜4 を通ったときに 1 度だけ同じ手順で求める。そのとき、元の図の写しが描画済みの図と同じ経路の曲がり・同じキャンバスにならなければ、試しを信用できないので何も出さない。
  - 残った候補のうち、曲がりの減りが大きい → 迂回の減りが大きい → 図の面積の減りが大きい、の順で 1 つだけを出す。
- **ヒントの形**: 何をどこへ動かすか（grid とその持ち主、行と列は 1 始まり。stack / row は何番目から何番目へ）、効果（線ごとの曲がり数の合計の変化、図がどれだけ低く・狭くなるか）を述べ、ヒントに具体的な書き換えを示す: `items` の場所（`groups[1].arrange.grid.items` など）、添字での操作（「swap items[33] (retrying) with items[26]」「delete the last 7 items」、stack / row は「move items[i] to items[j]」）、動かした先の行の前後の列（「row 4, columns 5–7 become c-backoff, retrying, c-error」）、書き換えた後の `items` の 1 行。**場所と 1 行は元の YAML から取る**: 診断の位置に使う元の文書（`GeometryContext.source` を `parseYaml` で読んだもの）を、`figure.layout.arrange` と各グループの `arrange` から、入れ子の箱（stack / row / grid / place。chat の items は発言なので除く）と、それを包むもの（grid のセル・place の item の `item`）をたどって、すべての `items` の列を集める。動かす箱と同じ種類で、各項目（包みを外したもの）が IR の項目と一致する（ID・`null`・入れ子の箱は種類と中身を再帰的に）列がちょうど 1 つのときだけ、その列の本当のパス（`…items[0].item.grid.items` など）と位置でヒントを出す。見つからない・複数あるとき、ソースの文字列がないとき（`lintGeometry` に `source` を渡さない呼び出し）はヒントを出さない。1 行は、その列の書いたままの項目（包み・入れ子の箱・引用を含む）に IR と同じ移動を施したデータを YAML ライブラリ（`yaml` の flow 形式）で書き、読み戻した値がそのデータと完全に一致するときだけ添える（一致しなければ添字の操作だけ）。IR から包みや場所を推し量る方式は、span 1 の包みや place の `item` の下の箱でパスを誤った（レビューの指摘）。**自動では直さない**: どこに置くかは作者の意図なので、ヒントの最後で「意味のある位置なら今のまま」と添える。

## 費用の上限

- **候補の配置は 1 図につき 6 回まで**（`RELOCATE_TRIALS`）。並べた順に先頭から 6 つだけを試す。これに、候補が 1 つでも 1〜4 を通ったときだけ、元の図の配置を 1 回足す（最大 7 回の `placeStructured`）。1 回は `placeStructured`（`straighten` のずらしの試し（最大 400 配置・40 配線）と `figure.layout.align` の解を含む）と `routeStructured` を 1 度ずつ通す。1〜4 を通った候補と元の図だけ、SVG を書いてほかの geometry 規則をかける。**配置・配線だけでなく、写しにかける規則も含めて全体を `asHintTrial` の中で走らせる**ので、規則の中のヒントの試し（#306 / #307 の幅・空きのヒント `verifyHints`）は配置を始めない。写しの `geometry/avoidable-bend` はアンカーのヒントを配線だけやり直して確かめる（写し 1 つにつき最大 8 回の配線、配置はしない）。`placeStructured` の呼び出し回数を数えるテストで 7 回以下を確かめる（request-states-a でちょうど 7 回）。
- **走る場所**: geometry lint が走るところすべて（`sumi render`、`sumi lint --geometry`、ギャラリーの生成）。ただし structured の図で、描画の配置（`placed`）と経路（`layout`）を持つときだけ。`--geometry` だけに絞る案は採らなかった（下）。
- **走らない図**: 対象の線がない図（試しは 0 回）。`HintTrials` の大きさの上限（要素 80 以下、arrange の item 240 以下）を超える図。HTML・外部ファイルの画像を含む図（試しの描画で読み込めない。#306 / #307 の幅のヒントと同じ扱い）。
- **計測**: examples・Skill・`docs/assets`・`tests/fixtures` の 156 図で、この規則が足す時間は合計 0.15 秒。候補を試した図は 12 図で、最大は request-states-a の約 0.12 秒（6 候補 + 元の図 1 回 + 写しの lint 2 回）。

## 採らなかった案

- **`geometry/avoidable-bend` の一部にする**: 上の 3 つの理由。warning の規則に配置の提案を混ぜると、意図した配置を書いた作者に毎回 warning が出る。
- **幾何だけで候補を確かめる**: #604 で、ヒントを幾何で確かめる方式はルーターの振る舞い（ポートの割り当て、扇形の合流、平行区間の分離）とずれ続け、レビューで 6 回差し戻された。移動は配置も変える（`straighten`・`figure.layout.align`・グループの大きさ）ので、なおさら実際に配置・配線する。
- **自動で動かす**: どのセルに置くかは作者の意図（異常系は下、など）。`straighten` が余裕の範囲だけを動かすのと同じ理由で、行や列をまたぐ移動は人かエージェントに任せる。
- **`--geometry`（`sumi lint --geometry`）のときだけ試す**: Skill の手順は `sumi render` の診断を読むので、エージェントに届かない。対象の線がない図では試しが 0 回で、ある図でも上限 7 回なので、geometry lint が走るところすべてで走らせる。
- **曲がりの合計だけで比べる（ほかの線が悪くなっても採る）**: #618 / #620 と同じく、ほかの線の曲がりは 1 本も増やさない。迂回は、ほかの線で 1pt までの伸びだけを許す（ルーターの丸めの範囲。1pt を超えたら採らない。メッセージにも「1pt を超えて伸びない」と書く）。
- **候補の上限を大きくする / 遠くのセルまで試す**: 遠くへの移動は図の意味を変えやすく、ヒントとしても読みにくい。行・列 2 以内、6 候補で request-states-a の移動は最初の候補として見つかる。

## 互換性

- 出力（examples・ギャラリー・Pages の例・goldens・ピン留めした再現のハッシュ・Skill のプレビュー）は main とバイト一致。増えるのは診断だけ。
- 新しい info が出る既存の図は 2 つ。ギャラリーと examples には出ない（`bun run gallery` で 491 ファイル中 0 ファイル変化）。
  - `tests/fixtures/figures/color-use/request-states-a`: Retrying を 4 行 6 列へ（上の例）。`relocatable.test.ts` がヒントの `items` を書いて描き直し、2 本が一直線（4 → 0 回）、ほかの線の曲がりが増えない、図が低くなり広がらない、error / warning が増えない、もう提案がないことを確かめる。
  - `group-label-at.integration.test.ts` の見出しを避ける図（#127）: g2 の row の中で c を先頭へ（右上の見出しの下から外れ、top → c が 6 → 4 回）。期待に加えた。
  - examples・Skill のレイアウト・`docs/assets`・`tests/fixtures`・`research/603-dogfood-v0.19/` のほかの図では、対象の線があっても、ほかの線の曲がりが増える・読む向きが逆になる・効果がない候補しかなかった。
- `verifyHints`（#306 / #307 の幅・空きのヒント）は、この規則の試しの中から呼ばれたときは試しを走らせない（入れ子の試しを避ける。試しの中の指摘はコードと対象だけで比べるのでヒントの文は使わない）。
