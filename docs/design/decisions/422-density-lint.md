# #422 論文図の密度診断

## 背景

エージェントは lint の error と warning が 0 なら図を完成とみなす。しかし Sumi の既定の余白は
読みやすさ優先で広く、普通に書くと TriCL（#420）や LLaDA（#421）の再現図のように詰まらない。
既存の `geometry/dead-space`（最大の空き矩形が canvas の 27% 以上）は group の枠を障害物に数えるため
枠の内側の空白を見ず、`geometry/group-empty-area` は group ごとの空きで、図全体の密度ではない。
前回の試行（#412）の 3 図は、ユーザーが「疎らすぎて論文に出せない」と判断したが、
既存の診断では info の `group-empty-area` と `placement-usage` しか出なかった。

ユーザーの方針（2026-11-09）は、密度の問題は lint で検知し、lint を通せば密度の良い図になること。

## 校正に使った図

- 良い（指摘しない）: `examples/tricl`、`examples/llada`。参考として gcn、llama4-moe、transformer、
  既存の clip、dit-block も測る。
- 弱い（指摘する）: 前回の試行 3 図。`tests/fixtures/figures/density/` にコピーした。
  `text-heavy-boxes`（文章の入った箱、散らばった凡例）、`sparse-small-elements`（小さい要素と
  大きな空き）、`sparse-empty-corner`（左下に空き）。

## 測った指標と値

fill は、ノード本体・文字・badge・glyph・set の外接矩形の union を canvas で割った値
（group の枠と辺は含めない）。面積/ノードは印刷時の canvas 面積（mm²）を描画ノード数で割った値。
穴は、内容と辺の footprint（group の枠は障害物にしない）を避けた最大の空き矩形の canvas 比。

| 図 | ノード | fill | mm²/ノード | 最大の穴 | 36文字以上のノード | 結果 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| tricl（良） | 60 | 40.7% | 193 | 6.8% | 0 | 指摘なし |
| llada（良） | 122 | 36.2% | 79 | 13.0% | 0 | 指摘なし |
| gcn | 13 | 26.8% | 900 | 11.8% | 0 | 指摘なし（ノード数が少ない） |
| llama4-moe | 16 | 13.4% | 1053 | 11.2% | 0 | 指摘なし（同上） |
| transformer | 23 | 26.6% | 389 | 25.3% | 0 | 指摘なし（同上） |
| clip（既存） | 62 | 29.1% | 196 | 10.7% | 0 | 指摘なし |
| dit-block（既存） | 53 | 26.2% | 288 | 10.2% | 0 | 指摘なし |
| text-heavy-boxes（弱） | 36 | 27.4% | 378 | 9.6% | 4（最大80文字） | sparse + text-heavy |
| sparse-small-elements（弱） | 32 | 32.0% | 433 | 7.1% | 2（最大52文字） | sparse + text-heavy |
| sparse-empty-corner（弱） | 40 | 30.4% | 383 | 15.6% | 2（最大43文字） | sparse + text-heavy |

## 決定

次の 2 つの規則を足す。どちらも既定は info で、paper 系 Profile または `figure.target` のある図だけが対象。

1. `geometry/sparse-figure`: ノード数 ≥ 30 かつ fill < 34% かつ 面積/ノード > 330mm²。
   fill 単独では良い図と弱い図が分かれない（clip 29%、dit-block 26% は既存の良い図で、弱い図の
   27〜32% と重なる）。面積/ノードは、同じ内容を詰めて小さく描いた図（良い図は 79〜288）と、
   大きな canvas に少なく置いた図（弱い図は 378〜433）を分ける。ノード数の下限は、gcn・llama4-moe・
   transformer のように元々要素の少ない図を除く。3 つの条件は校正図の間に境界を置いたもので、
   fill は 32.0% と 36.2% の間（34%）、面積/ノードは 288 と 378 の間（330）に置いた。
2. `geometry/text-heavy-nodes`: ノード数 ≥ 12 で、ラベルが 36 文字以上のノードが 2 つ以上。
   良い図の最大は 33 文字（dit-block）、弱い図は 43〜80 文字。会話の `bubble` は文章が本質なので除く。

メッセージは「何をするか」を含む。sparse は最大の空き矩形の位置と大きさを示して凡例や散らばった
ラベルを寄せることを、canvas を縮める手段（gap・padding・`density: compact`・`target.height`）や
要素を大きくすることを勧める。text-heavy は数式と説明をキャプションへ移すことを勧める。

Skill の論文図の点検（手順 7 の 3）に「この 2 つを解消する。抑止しない」を足した。

## severity と対象範囲

- 両方とも info にした。しきい値は 10 図の校正で、普通のフローチャートでの誤検出の余地がある。
  info なら `maxWarnings` を巻き込まず、Skill が解消を求める形で運用できる。誤検出が
  実運用で少ないと分かれば warning へ上げる（`{"rules":{"geometry/sparse-figure":"warning"}}` で
  利用者側でも昇格できる）。
- 範囲は paper 系 Profile または `figure.target`。例の図はほぼ paper 系 Profile で `target` を持たないので、
  実質の絞り込みはノード数の下限が担う。`presentation-16x9` の図は対象外にした。

## 採らなかった指標

- 最大の空き矩形の比率: llada 13.0%、transformer 25.3% が弱い図（7.1〜15.6%）より大きく、分けられない。
  大きな穴は既存の `geometry/dead-space` が担当する。
- 四分割・6×4 格子の偏り: transformer（左上 4%）や gcn（左上 6%）のような良い図も偏る。
- 文字面積/図面積: 弱い 13〜18% に対し良い図は 4〜15%（transformer 15%）で重なる。
- 中央値の要素サイズ: gcn の小さな円ノードと弱い図のアイコンが重なる。
- group 内の空き面積: tricl（82%）の enclosure も group-empty-area に出て、弱い図と区別できない。

## 互換性

SVG・PDF・PPTX・D2 の出力は変わらない（診断の追加だけ）。レンダー前後で、全 `*.sumi.yaml` を
自身のテーマと組み込み 6 テーマで描き、sha256 が一致することを確かめた。
新しい info が出る既存の図は、`tests/fixtures/figures/dim/b-dit.sumi.yaml` と
`tests/fixtures/figures/sublabel/b-dit.sumi.yaml`（通常の余白の比較用 fixture）、ギャラリーの
`sumi-bracket` 部品シートの slides テーマ（45 ノード、fill 22.5%、523mm²/ノード）で、
examples と Skill の例には出ない。部品シートの疎らさは見本の性質なので、しきい値は変えず受け入れた
（gallery には既に dead-space の info も載っている）。
