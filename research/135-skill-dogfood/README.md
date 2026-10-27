# #135 段階 B の書き方を Skill だけで使う短い dogfooding

[Issue #135](https://github.com/nishide-dev/sumi-diagram/issues/135)。関連: #109（[v0.4.0 の dogfooding](../109-dogfood-v0.4/README.md)）、#124（[段階 B の調査](../../docs/research/124-stage-b.md)、[草案](../124-stage-b/figures/)）。製品の src・schema・examples・golden は変更しない。

## 方法

- **使ったもの**: このブランチのソース（`skills/sumi/scripts/sumi`、`sumi --version` = 0.4.1。段階 B の機能はすべて main に入っている）。描く間に読んだのは、この PR で更新した Skill（`SKILL.md` と `references/*.md`）と CLI の診断・hint だけ。
- **作業**: `lint → render（SVG）→ scripts/preview（Quick Look の PNG）` を回して直した。
- **注意（偏り）**: 作業者は Skill を書いた本人で、#124 の草案も読んでいる。「Skill だけで再現できるか」の確認としては甘い。草案の構文をそのまま写すのではなく、#109 の図の内容から Skill の書き方で組み、違いは下に記録した。
- **`requires`**: 各図は段階 B の構文を使うが、`requires: ">=0.5.0"` は書いていない。このチェックアウトの版は 0.4.1 のままで（版の更新はリリースの Issue）、書くと `schema/unsatisfied-requires` で止まるため。Skill（figure-format.md）にもそう書いた。v0.5.0 のリリース（#146）で版が 0.5.0 になったので、4 図に `requires: ">=0.5.0"` を付けた（それ以外は変えていない）。
- 画像 3 点（`sample.png`・`augmented.png`・`loss-curve.svg`）は #124 からの複製。

再現: `cd research/135-skill-dogfood/figures && <repo>/skills/sumi/scripts/sumi render <file>.sumi.yaml -o /tmp/<file>.svg`。

## 結果

| 図 | 回数 | lint | render の error / warning / info | 大きさ | 使った段階 B の構文 |
| --- | --- | --- | --- | --- | --- |
| 1 `seq2seq-attention` | 2 | 0 | 0 / 0 / 0 | 87.3 × 126.5mm | 見出し `labelAt: top-left` ×2、`align`（K,V を水平に）、辺の `labelAt: middle` |
| 2 `training-pipeline` | 4 | 0 | 0 / 0 / 1（`layout/edge-crossing`） | 157.3 × 87.7mm | 見出し `labelAt` ×2、`caption` ×2、`legend`、`labelSide`、`\tilde{x}`・`\hat{y}` |
| 3 `serving-architecture` | 3 | 0 | 0 / 0 / 2（`layout/edge-crossing`） | 159.6 × 125.8mm | `fanIn: spread`、見出し `labelAt` ×6（`bottom` ×2、`bottom-right`）、辺の `labelAt: start`、anchor 0 個 |
| 4 `unet-small` | 1 | 0 | 0 / 0 / 0 | 58.0 × 110.6mm | `align` ×3、`legend`、`labelSide`、`\hat{y}` |

4 図とも error・warning は 0。#109 では 5〜8 回かかり、見出しを消して `attach` の label にする、Storage への anchor を 11 個書く、間隔を調整する、といった回避が要った。今回はどれも要らなかった。

## 図ごとの記録

### 図 1（2 回）

1. #109 と同じ 2 列の構成に、見出しを `labelAt: top-left`、K,V を `labelAt: middle` にした。診断 0。ただし K,V の線は encoder の上端から出て列の間を下り、decoder の下から入る（#109 と同じ遠回り）。
2. structured.md「Aligning across trees」に従って `align: { y: [enc-norm2, dec-cross] }` にし、辺を `east` → `west` に、列の `gap` を 4 → 8mm にした。K,V は 1 本の水平線になり、診断 0、幅 87.3mm（88mm 以内）。

### 図 2（4 回）

1. 2 行（データ・学習）、キャプション、凡例、アクセント。診断 0、交差 2（dataset → loss と augmented → model、loss → curve と update θ）。
2. 学習の行を `direction: left` にした（layout-tips の折り返しの書き方）。行で右を向いていた `model-icon` の `attach: west` が loss との間に入り、`layout/no-route`（塞いでいる要素を hint が示した）。
3. icon を `east` に移した。今度は見出し `top-right` が `batch` に当たり、`geometry/label-collision` と `layout/edge-label-overlap`（hint は `labelAt` で見出しを移す案）。
4. 見出しを `top-left` に。診断 0、交差 1（loss → curve と update θ。curve の位置からは避けにくいので残した）。

### 図 3（3 回）

1. `fanIn: spread`、Storage の見出しを `bottom`（辺がすべて上から入るため）、GPU pool を `bottom`、Workers を `bottom-right`。warning 2（gRPC のラベルが GPU pool と Workers の枠に乗る `geometry/label-collision`）、交差 6。
2. gRPC に `labelAt: start`（始点の Inference API の側に置く）。warning 0、交差 6。
3. 交差の位置（mm）から、Inference API → Inference workers が gateway の分岐を横切っていると分かったので、hint の「箱の項目の順序を変える」に従い API の stack を `[auth, train-api, infer-api]` にした。交差 2（ワーカー 2 つが両方のストアへ行く入れ替わりと、Training API → Metadata DB が queue の線を横切るもの）。

### 図 4（1 回）

structured.md の作例を 3 段に広げ、入力の `x`・`1×1 Conv`・凡例を足した。1 回で診断 0。skip の破線 3 本は水平。

## 易しかったこと・難しかったこと

- **易しい**: 見出しの位置・キャプション・凡例・アクセントは、フィールドを 1 行書けば済んだ。診断の hint が `labelAt`・`labelSide`・項目の順序など新しい手段を挙げるので、次の手が分かる。交差の info は位置（mm）が出るので、プレビューで場所を探しやすい。
- **難しい**: 見出しの角（`top-left` など）は、見出しが group の幅の半分を超えると上から入る辺を避けられず、診断なしで遠回りする（下の Skill の不足 1）。どの角が空いているかは図によるので、プレビューを見て選ぶしかない。交差は info なので、いくつ残すかは作者が決める。

## 見つけて直した Skill の不足

1. 見出しの角が助けになるのは見出しが細いときだけで、幅が広いと上端中央の辺は**診断なしで**遠回りする（作例を作る段階で発見）。structured.md に書き、作例は `labelAt: bottom` にした。
2. 同じ row に直接並ぶ 2 項目は `y` で揃えられない（`at: start` など。row が中央に揃えるため）。片方を 1 項目の `stack` で包めば揃う（試して確認）。structured.md に書いた。
3. `render` は `lint/*` を実行しないので、`lint/unused-legend-entry` は `lint` でしか出ない。逆に `layout/unsatisfied-align` などは `lint` では出ない（render と `lint --geometry` だけ）。Skill の表にどちらで出るかを書いた。

## 製品の不具合

見つからなかった。
