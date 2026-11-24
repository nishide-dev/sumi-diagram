# #640 幅・高さのヒントに、dogfood で効いた手段を足す

## 背景

#639 の dogfood（v0.20.0、10 本）では、10 本中 7 本（run 1・2・3・4・5・7・8）で幅や高さを今も手で合わせた（`research/639-dogfood-v0.20/review.md` の横断的な問題 1）。#607 / #624 の幅のヒントが試すのは、幅の道筋にある gap・padding・明示の width と、sequence のラベルの折り返しだけだった。実際に効いた手段は試されなかった。

| run | 超過 | 実際に効いた手段 | v0.20.0 のヒント |
| --- | --- | --- | --- |
| 1 | 216.8mm / 180mm | matrix の `flush: true`、`cellWidth`、(b) の組み替え | 確かめた修正なし |
| 2 | 118.4mm / 88mm | legend の `perRow: 3` と、帯の row の `gap: 3mm` | 「No fitting edit verified」。`perRow` を試さない |
| 4 | 183.1mm / 180mm | ルートの `place` で外側の x を内へ（pool 158 → 154） | 「no gap, padding or explicit width to reduce」 |
| 5 | 193.0mm / 180mm | `place` の x を詰め、箱を細く、ラベルを 2 行に | 「gap 0mm」などの意図に合わない値 |
| 7 | 197.0mm / 180mm | ラベルを短く・2 行に、`density: compact` | 「row gap 0mm」だけ。`padding: 2mm` が黙って 13pt になる |
| 8 | 264mm / 150mm（高さ） | `rowGap: 0.5mm`、`participantGap`、band、icon を left | 「最も高い stack を row にする」 |

ほかに 2 つの問題があった。

- **gap 0mm を「確かめた修正」として出す。** 収まりはしても、線や矢じりを置く場所がなくなる（run 5・7）。
- **自動で増えた padding の理由が出ない。** run 7 のパネル (b) は `props.padding: 2mm` と書いたのに、幅の内訳は「padding 13pt + 13pt」とだけ言った。原因は `src/layout/route/padding.ts` で、外のジャンクションから中の 3 つの行へ入る線の扇形（#512）が矢じりの分の余白を要求し、軸の両側に同じだけ足す（#247）。`structured.md` には「tight group padding grows automatically」と 1 行あるだけだった。

## 決定

### 1. 幅のヒントが試す手段を足す（`src/lint/geometry/fit-candidates.ts`）

幅を決める項目（`--explain-width` が `*` を付ける項目。row ではすべての項目）にある次の部品に、編集の候補を作る。どれも #607 と同じく、写しを配置・配線・描画・lint して、収まって新しい error / warning がないときだけ出す。

- **legend の `perRow`**（`flow: row` のとき）: 凡例の自然な幅のうち、超過を除いた割合だけ 1 行に入れる数（`floor(perRow × (幅 − 超過) / 幅)`、少なくとも 1 つ減らす）。
- **matrix の `flush: true`**: 枠の中の padding をなくす。タイトルを枠の中に持つ matrix は `flush` にできない（`component/invalid-prop`）ので、代わりに `labelAt: above`（タイトルを枠の上へ出し、padding がなくなる）を試す。
- **matrix の `cellWidth`**: 列数で超過を割って細くする。ただし最も広いセルと列見出しの文字幅 + 2pt より細くしない（文字がはみ出す値は出さない）。足りないときもその下限まで細くし、「部分的な修正」として報告する。`cellHeight` を書いていなければセルの高さも変わることを添える。
- **`place` の x 座標**（幅の道筋が `place` の箱で終わるとき）: 次の 3 案を、変更の小さい順に試す。値は `place.unit` の単位で 0.5 刻み。
  1. 外側の項目を内へ動かす（左右から超過の半分ずつ）。run 4 の手の修正と同じ形。
  2. 列（同じ x に書いた項目）の間の空きを詰める。同じ x の項目は一緒に動くので、縦の並びは崩れない。列の間には矢印 1 本分（4mm）を残す。
  3. すべての x を中央へ寄せる（一様な縮小）。

legend と matrix の props はコンパイル時に展開されるので、IR では直せない。YAML（`GeometryContext.source`）に値を書き、図と同じテーマ・プロファイル（`--theme` / `--profile` の上書きも含む）でコンパイルし直す。書き直さない YAML が同じ図（メタデータと要素数）にコンパイルされないとき（独自の registry など）は試さない。`place` の座標は IR の `positionsPt` を直接書き換える（書いた座標 × unit なので、YAML の値と 1 対 1）。

### 2. 試す順番と、意図を残す下限

収まった修正は最大 3 つまで出し、次の順に試す。

1. 幅の道筋の終わり（Widest contributor）の legend / matrix / place の候補。
2. 道筋の値を 1 つずつ（gap・padding・width・sequence の `participantGap`）。変更の割合の小さい順。
3. 道筋の終わり以外で幅を決める legend / matrix の候補。
4. 値をまとめて（`(together)`）。sequence のラベルの折り返し。
5. 何も収まらないときだけ、下限より下の値（最後の手段）。

**下限**: gap と `participantGap` は 2mm、group の padding は 4pt（`INTENT_GAP_MM`、`INTENT_PADDING_PT`）。2mm は線と矢じりがまだ置ける幅で、4pt は枠と中身がまだ離れて見える幅。これで足りるうちは下限より下の値を出さない。下限より下の値で収まったときは `(last resort: below 2mm between items or 4pt of padding)` と書く。幅を狭めるだけの検証（`verified.ts` の `Verified layout edits`）も、gap と `attach.gap` を 0mm ではなく 2mm にする。もともと 2mm 以下の gap だけを 0mm にし、`as a last resort` と書いて最後に並べる。

**部分的な修正の組み合わせ**: 収まらないが幅を狭めた試し（`Narrower but not enough alone`、配置しただけで lint はしない）のうち最も狭いものについて、その写しの幅の道筋をもう一度読み（配置 1 回）、道筋の値を 1 つ足した組み合わせを試す。run 2 では `perRow: 3` で凡例が 89.6mm まで狭まり、次に幅を決める箱の row の gap を 3mm にして 87.67mm に収まる（dogfood の手の修正と同じ）。

**値の刻み**: 0.5mm 刻みや `perRow` の整数では、残りわずかな超過に対して同じ値が出ることがある。そのときは求める量を倍々に増やして（最大 6 回、試しの回数は増えない）、違う値を作る。

### 3. 自動で増えた padding の理由（`padding.ts`、`width-tree.ts`、`--explain-width`）

`arrowheadPaddingDeficits` が、増やす理由を任意の引数に記録する（`PaddingGrowth`: 辺、種類、線、不足量）。種類は `fan-out`（外の 1 つのポートから中の複数の項目へ広がる線の幹が padding で曲がる、#512）、`fan-in`（外の複数の所から中の 1 つのポートへ集まる）、`u-turn`、`inside`（グループの中の線の矢じりが枠に向く、#171）、`mirrored`（反対側が増えたので同じだけ増やした、#247）。結果の値は記録の有無で変わらない。構造化エンジンはこれを `growPadding` と一緒に受け取り、幅の木のグループの `padding.grown`（左右に足した pt と理由）に載せる。

幅の内訳（ヒントの `Width path` と `--explain-width`）は次のように書く。

`group "post" 62.8mm = content 53.63mm + padding 13pt + 13pt (props.padding 5.5pt, grown automatically by 7.5pt on both sides: the arrowheads of edges "to-think", "to-inst", which fan out from one port outside the group to its members, enter through the west side and turn in its padding (#512); the east side grows as much as the opposite one, so the content stays centred in the frame (#247))`

`--json` の `widthTree` では `padding.grown: {westPt, eastPt, reasons: [{side, kind, edges, pt}]}`。増えた padding は、書いた値を減らしても同じ幅に戻るので、幅のヒントの候補から外す（試しを無駄にしない）。`structured.md` の「Group padding」に、いつ増えるか（扇形・U ターン・中の矢じり）、反対側も増えること、狭く保つ方法（上下から入れる、扇形にしない）を書いた。

### 4. sequence の高さのヒント（`src/lint/geometry/height-fit.ts`）

`geometry/exceeds-page-height` のヒントは、図に `sequence` の箱があれば「最も高い stack を row にする」の代わりに次を勧める。

- `rowGap` を小さくする（今の値、既定ならプロファイルの gap の 3 分の 1 であること、行ごとに何回足されるか）。
- `iconAt: top` の参加者を名指しして `iconAt: left` にする（頭が低くなる）。
- 別のライフラインを使うメッセージとノートを 1 つの band（`[a, b]`）にまとめる。
- ラベルを 1 行に保ち、要らない行を削る。
- `figure.fit: scale` のときは、高さが幅に連動すること（狭い図ほど縮小が小さい）。
- 図を分ける（例: フェーズごと）。

そのうえで `rowGap` の値を試しで確かめる。行数から必要な値を見積もり（0.5mm 刻み）、届かなければ 1 回だけ残りの分を足して見積もり直す。下限は 1mm（`INTENT_ROW_GAP_MM`。行がまだ別の段に見える）で、それより下は何も収まらないときだけ `(last resort: rows nearly touch)` として試す。`fit: scale` の図は、試しの幅から縮小率を計算して印刷される高さで比べる。

### 5. 費用

- 幅: 1 診断につき最大 **10 回**の試し（`MAX_FIT_TRIALS`、8 から増やした。元の図の 1 回を含む）。候補の種類が増えたので 2 回足した。部分的な修正の組み合わせでは、さらに配置 1 回（幅の木）。YAML のコンパイルし直しは配置を伴わず、書き直さない YAML で 1 回確かめる。収まる修正が 3 つ見つかれば止める。同じ種類（legend、matrix、place、gap、…）の収まる修正は 2 つまで。
- 高さ: sequence の図が高すぎるときだけ、最大 **4 回**（`MAX_HEIGHT_TRIALS`、元の図を含む）。
- どちらも 240 要素以下、HTML と外部ファイルの画像を含まない図だけで、ほかの規則の試しの中では試さない（`inHintTrial`）。テストで `placeStructured` の呼び出しが上限以下であることを確かめる。
- dogfood の 6 本の初稿で、`sumi render` 全体が 0.3〜0.7 秒。

### 6. 回帰の fixture

dogfood の YAML を小さくした写しを `tests/fixtures/figures/fit-hints/` に置いた（テストは `research/` を読まない）。各テストは、ヒントの値を YAML に書いて描き直し、上限に収まり新しい error / warning がないことを確かめる。

| fixture | 元 | 確かめること |
| --- | --- | --- |
| `legend-per-row` | run 2 | `perRow: 3` と row の `gap: 3mm` の組み合わせ（`(together)`） |
| `matrix-flush` | run 1 | matrix の `flush: true` |
| `place-coordinates` | run 4 | 外側の項目を内へ（client と pool だけが動く）、それが最初の案 |
| `padding-growth` | run 7 | `--explain-width` / JSON に扇形と反対側の理由、幅のヒントが増えた padding を出さない |
| `sequence-row-gap` | run 8 | 高さのヒントが `rowGap`・band・icon を勧め、確かめた `rowGap` で収まる |

gap の下限は、画像だけの row（gap しか減らせない）で確かめる。2mm で足りれば 2mm 以上の値だけ、足りなければ 1mm を `last resort` として出す。

## 採らなかった案

- **legend・matrix の props を IR の上で直す。** legend の行や matrix のセルは、コンパイル時に groups・nodes・arrange に展開される。展開をもう一度実装すると、コンパイラとずれる。YAML を書き直してコンパイルするほうが、出す値とユーザーが書く値が同じになる。
- **stack と row の組み替え、`attach` した箱を試す。** dogfood では効いたが、組み替えは図の読み方を変える判断で、候補が爆発する。Skill の「幅が足りないとき」の選択肢に残す。
- **部分的な修正も lint する。** 収まらない試しまで lint すると、費用がほぼ倍になる。部分的な修正は「配置しただけ、lint していない」と明記し、組み合わせて収まったものだけ lint で確かめる。
- **gap 0mm を出さない。** ほかに何もないとき、0mm が唯一の修正のこともある（もともと 2mm の gap）。出すが、最後に並べ、最後の手段と書く。
- **増えた padding を避ける自動の修正（扇形をやめる、入る向きを変える）を試す。** 線の向きは図の意味に関わる。理由と、狭く保つ方法を説明するにとどめた。
- **sequence の band への組み替えを試しで確かめる。** どのメッセージを並べてよいかは、意味（同時に起きるか）による。勧めるだけにした。

## 互換性

- 描画結果は変わらない。`padding.ts` の理由の記録は任意の引数で、増やす量は同じ（既存の `padding.integration.test.ts` がそのまま通る）。`bun run gallery:check` で examples と `docs/gallery/` が main と同一であることを確かめる。
- 変わるのはヒントの文だけ: `geometry/exceeds-page-width` / `geometry/heavy-scaling` の `Fits …`（候補と順番、`last resort`、`Narrower but not enough alone`、「No single edit on the width path verified to fit」）、`Verified layout edits` の gap と `attach.gap`（0mm → 2mm）、`--explain-width` と `widthTree` の増えた padding、sequence の図の `geometry/exceeds-page-height`。
- `widthTree` の JSON は `padding.grown` を足しただけ（既存のフィールドは同じ）。
- 凡例が図の幅を決めるという注記（#446）は、幅の木があるときは、道筋がその凡例で終わるときだけ出す。sequence の参加者はそれぞれ最上位のノードで凡例より狭いため、凡例より広い sequence の図でも「凡例が幅を決める」と誤って出ていた（run 8）。
