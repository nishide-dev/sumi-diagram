# #348 置き場所から形を選ぶ Skill の手順と内容の点検

## 背景

[#345 の報告](../../../research/345-figure-placement/README.md) の §5.5 は、Skill の
出典のない「置き場所 ⇒ 形」の規則を挙げ、§4.3 の手順（制約 → 候補 → 描いて測る →
硬い制約で除く → 比べる → 理由を報告）と §4.4 の選択肢の表に置き換えることを提案した。
#347 は、`figure.target` を入れる際に該当の文を個別に言い換えたが、手順は
`layout-tips.md` の Design principles・Plan the layout・Shrinking・SKILL.md に分かれて
重なり、内容の点検も Plan the layout の手順 6 の 1 文だけだった。

## 決定

報告に書かれた方針はそのまま採る。報告にない、実装上の判断は次のとおり。

- **手順の置き場所を 1 か所にする。** `layout-tips.md` に「Fit the placement」の節を
  新しく作り、§4.3 の 6 段と §4.4 の表（「When width runs short」）をそこだけに書く。
  Design principles・Plan the layout・Shrinking・diagnostics.md・SKILL.md はこの節へ
  リンクし、同じ手順を繰り返さない。auto の図にも当てはまるため、paper の図の節には
  置かない。
- **内容の点検は SKILL.md の手順 7 に 1 つだけ置く。** 手順 1 で作る点検表（要素・
  向きとラベルのある辺・入出力）を、手順 7 で YAML と PNG の両方に照らす。
  Plan the layout の手順 1・6 は、この段を参照するだけにする。
- **「印刷時の大きさ」の PNG は、印刷時の長い辺 1mm あたり約 6px（約 150dpi）とする。**
  `scripts/preview` は正方形の一辺の px を受けるので、長い辺の mm × 6 を渡す。
  既定の 1600px は、88mm の図を約 18px/mm に拡大し、小さな文字や短い矢印の見落としを
  隠すため。
- **Profile の間の幅（1 段組みの論文の約 140mm など）** は、広い方の Profile を使い、
  `size.widthMm` が置き場所の幅以下になるよう比べる、と書く。`fit: scale` は Profile の
  幅に合わせるので、この場合の縮小の基準にはならないことも書く。組み込みの Profile は
  増やさない（報告 §7 の 3 は未決のまま）。
- 実測の表（「Direction vs. target width」の連鎖の大きさ）は残し、候補の大きさの
  見積もりに使う値として書き直す。2 段の折り返しの例も、候補の作り方として残す。

## 採らなかった案

- 置き場所ごとの推奨の形を表にする: 固定の規則を別の固定の規則に置き換えるだけになる。
- 内容の点検を別の参照文書に置く: エージェントが必ず通る SKILL.md の手順から外れる。

## 互換性

Skill の文書だけを変える。CLI・スキーマ・出力は変わらない。`src/cli/skill.test.ts`
（リンク・診断コード・図の lint と描画・SKILL.md の行数の上限）で確かめる。
