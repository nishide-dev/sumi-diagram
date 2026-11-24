# #647 drift の hint に原因を出し、1 点に集まる線を edge-near-edge から除く

## 背景

#639 の dogfood（v0.20.0）で、lint の hint が原因を外したり、意図した描き方を誤検知したりした（横断 10）。

- **run 3（`token-column-drift`）**: hint は固定の文「両方の行のセル幅と gap を揃えて」だった。セルは両方の行で同じ（6mm、gap 1mm）で、ずれは行の手前のステップのラベル `t=1` と `t=2` の幅の違いから来ていた。行は `stack` の中で中央に揃うので、ラベルの幅の差の半分（1.5 unit、0.26mm）だけ行の始まりがずれる。
- **run 4（`edge-near-edge`）**: 3 本の `route: straight` の線を 1 つの口（`toAnchor: "east:0.6"`）に集めると、終点の近くで線どうしが 1.5pt 未満になり、`edge-near-edge` が 2 件出た。作者は終点を 0.45 / 0.6 / 0.75 に散らした。斜めの線どうしの比較（`directedRun`）は、同じ点を通る 2 本の線でも、その点の近くは必ず近いので報告していた。
- **run 9（`avoidable-bend`）**: success の線（working の `south:0.25` から completed へ）が曲がるのに、`avoidable-bend` が出なかった。

## 決定

### `token-column-drift`: hint にずれの原因を出す

最もずれたセルを持つ 2 行を比べ、次のどちらかを hint にする。

1. **セルの幅か gap が違う**（0.1 unit を超える差）: 「The cells differ (tokens "a" has 6.00mm cells with 1.00mm gaps, tokens "b" has 6.35mm cells with 1.00mm gaps)」と、それぞれの行の幅と gap を示し、従来どおり同じ `width`・`gap` か `sumi/matrix` を勧める。この場合は列ごとにずれが大きくなる。
2. **セルが同じ**: ずれは行全体の平行移動なので、「tokens "b" starts 0.26mm right of tokens "a"」と始まりの差を示す。続けて、各行の手前と後ろで最も近いノード（行と高さが重なり、行の高さの 3 倍以内。structured では layout の箱なので、`label` 部品のような文字だけのノードも含む）を比べ、幅が違えばその 2 つと幅を名指しし、同じ `props.width` を勧める。見つからなければ「行の始まりを揃える（隣の要素の幅か align を揃える）」とだけ言う。

run 3 の最小の図（`t=1` / `t=2` のラベル + 4 セルの行を 2 段）では、hint は `node "l1" (before tokens "t1") is 4.06mm wide and node "l2" (before tokens "t2") 4.59mm` を示し、ラベルに `props: {width: 5mm}` を足すと診断は消える（テストで確認）。dogfood のログの 4.51mm / 4.59mm は width path の計測で、layout の箱の幅とは異なる。hint は layout の箱を使う。

### `edge-near-edge`: 共有する端に集まる部分を除く

斜めの線を含む 2 本の区間を比べるとき、2 本のエッジの経路の端（矢じりで切る前の論理上の端）が同じ点（`COINCIDENT_UNITS` 以内）で、2 つの区間がどちらもその点を通る直線の上にある（点から区間の直線までの距離が `COINCIDENT_UNITS` 以内）なら比べない。同じ点を通る 2 本の直線は、その点で最も近く、離れるほど開く。範囲内に入るのは集まる部分そのもので、同じ線に重なる共有の幹線を報告しないのと同じ扱いにする。

真の検出は残す。

- 終点が少しでも違う（例: `east:0.45` / `0.5` / `0.55`）ほぼ平行な線は、これまでどおり報告する（統合テスト）。
- 同じ点で終わるエッジでも、その点を通らない手前の区間がもう一方の線の脇を走れば報告する（単体テスト）。

軸に沿った区間どうし（従来の sweep）は変えない。同じ点に入る直交の線は最後の区間が重なり、もともと共有の幹線として扱われている。

### run 9（`avoidable-bend`）: 見落としではない

最終版の図を layout で調べた。

- working（x 429〜562 unit）と completed（x 216〜379 unit）は x の範囲を共有しないので、まっすぐな線はない。south → north の線は Z（2 回の曲がり）が最少。
- 1 回で済む L は 2 つしかない。working の南（`south:0.25`、x 462）から completed の東に入る L は、working の真下にある failed（x 443〜548）を通る。working の西の辺から出て completed の北に入る L は、西の辺が input-required との 2 本の線に使われていて、その間を通る。
- 実際にアンカーを書いて描くと、`toAnchor: east` は failed を避けて 3 回曲がり、そのラベルが failed のラベルと重なる（`label-collision`）。`fromAnchor: west, toAnchor: north` は 1 回の曲がりで描けるが、client reply のラベルを横切る（`edge-crosses-label`、`layout/edge-label-overlap`）。

したがって今の配置では、新しい問題を作らずに Z より曲がりを減らす書き方はなく、規則が黙っているのは正しい（規則も、L は両端にアンカーがあり、移す辺がほかの線に使われていないときだけ考える）。レビューの「completed を working の真下に置く」は配置の変更で、`avoidable-bend` の範囲（アンカー・小さな段・ジャンクションの手前）ではない（設計 #604。ノードを動かすのは `straighten` #618 と `relocatable-node` #621。`place` の座標は後者の対象外）。この判断を、run 9 を縮めた図のテスト（`src/layout/route/avoidable-bends.integration.test.ts`）で固定した。

調べる途中で、completed と failed を同じ行に置き、グループの枠を外すと、ルータが completed の東に 3 回曲がって入り（北への Z が空いているのに）、`avoidable-bend` も出ない図が作れた。dogfood の図とは別の形で、ルータの辺の選び方の問題なので、この issue では扱わない。

## 採らなかった案

- **drift の hint で `figure.layout.align` を勧める**: run 3 で `align` が注記ではなくセルを動かし、`align-splits-tokens` になった。隣の要素の幅を揃える方が確実なので勧めない。
- **1 点に集まる線を、`edge-near-edge` の対象から丸ごと外す**: 同じ点で終わるだけで外すと、手前の区間が並ぶ真の検出を落とす。外すのは、その点を通る直線の上の区間どうしだけにした。
- **片側だけアンカーを書いた線にも L を考える（run 9 の調査）**: 設計 #604 は、アンカーのない端の口が辺の変更で動くため、L は両端にアンカーがあるときだけ考えると決めている。run 9 は L が塞がっていて対象にならないので、この決定は変えない。

## 互換性

描画は変わらない（lint だけの変更）。examples・skills・docs・tests/fixtures の 154 図を `sumi lint --geometry` で変更前後に比べ、診断（code・path・message・hint）は同じだった（どれにも `token-column-drift` と `edge-near-edge` は出ていない）。
