# #546 配置の見落としを見つける lint

## 背景

#538 の再計測（v0.18.0 の Skill で描いた図）で、lint が通っても目で見ると直す点が残った。記録されたのは、トークン列が列からずれる、線のラベルが線から約 0.5mm、線のラベルが箱の角に重なる、窮屈な矢じり、の 4 つ。報告書には座標がないので、最小の図を作って既存の規則との差を調べた。

- **線のラベル**: ルータの既定の間隔 `EDGE_LABEL_GAP` は 3 unit（1.5pt）で、`fit: scale` の縮小と字の左右の余白を足すと、線から字までは 0.4〜0.5mm になる。既存の規則は重なり（`label-collision`）と交差（`edge-crosses-label`）しか見ず、近接は見ていなかった。
- **箱の角**: `label-collision` は図形との重なりだけを見る。角丸の箱の角や、ひし形の頂点のそばは図形に触れないので通る。
- **トークン列**: セルの幅が列ごとに違う（ラベルの長さで決まる）と、2 行のセルの中心が少しずつずれる。列を縦に読むのに、2〜3pt ずれて見える。lint はトークン列どうしの関係を見ていなかった。
- **窮屈な矢じり**: `arrowhead-cramped` は曲がりの手前だけを見て、曲がりのない短い辺を除いていた（`run >= total`）。`fit: scale` で縮めると、辺の全長が矢じり + 1pt に満たない直線が出る（`tests/fixtures/figures/fit/b-dit` で 0.74〜0.94pt）。

## 決定

新しい規則 3 つと、既存の規則の拡張 1 つ。いずれも info（誤検出の多さによる）。

| 規則 | 条件 |
| --- | --- |
| `geometry/edge-label-hugging` | structured。ラベルの字の輪郭から自分の線（描かれる線）まで、線幅の半分を除いて印刷時 1pt 未満（触れる・重なるものは除く）。 |
| `geometry/edge-label-on-corner` | 行の外接矩形から、ノードの輪郭の頂点（多角形の図形）まで印刷時 1.5pt 未満。図形に重なるものは `label-collision` に任せる。円・楕円は頂点がないので対象外。 |
| `geometry/token-column-drift` | 横並びのトークン列（縦積みは除く）と、すぐ下の最も近い列（行の高さの 3 倍以内）の 1 組だけを比べる。列ごとに最大 1 件で、全組の比較はしない。同じ個数（2 以上）で、対応するセルが幅の 75% 以上重なり、中心のずれが 0.5pt 超かつ幅の 25% 以下。 |
| `geometry/arrowhead-cramped`（拡張） | 曲がりのない辺で、全長から矢じり（両端なら 2 本）を引いた見える直線が印刷時 1pt 未満。辺ごとに 1 件。 |

共通の補助（印刷時の大きさへの換算、`isDrawnEdge` など）は `common.ts` に移した。新しい規則は `placement.ts` にあり、`rules.ts` を読み込まない（循環を避ける）。

## 約 0.5mm の例の証拠

`research/538-dogfood-v0.18/runs/3-data-pipeline/S/log.md` に「Edge labels sit very close (~0.5mm) to their dashed lines; not reported by lint」とある。ルータの既定の間隔（0.4〜0.5mm）そのもので、点線の脇の 10.5pt ラベルの図だった。この証拠でも、既定を誤りとする代償（上の表のとおり 10 以上の出荷図とテストが影響を受ける）は変わらないので、1pt を保つ。

## 採らなかった案

- **しきい値を 0.5mm にする（報告の「約 0.5mm」をそのまま使う）**: 約 0.5mm はルータの既定の間隔の結果で、Skill のレイアウト 8 つ・`examples/` の 2 つ・ギャラリーの 3 図のほか、「診断なし」を固定している十数件のテストの図でも出た（試した）。既定の置き場所を「誤り」と呼ぶことになるので、既定より詰まったものだけを拾う 1pt にした。報告された約 0.5mm の例は、置き場所の間隔そのものを広げる変更（全図の出力と再現図のハッシュが動くので別の issue）で直す。
- **severity を warning にする**: 再現図の既存の件数や `--max-warnings 0` の利用者に影響するので info にした。
- **トークンの列を 1 つの規則で「ずれ」全般に広げる**: 幅や個数の違う列は意図した段違いが多く、誤検出になる。個数が同じで、ほぼ重なるものに限った。
- **auto（D2）の線のラベル**: D2 はラベルを線の上に置いて線を隠すので、近接は設計どおり。対象外。

## 互換性

出力（SVG・PDF・PPTX）は変わらない。変わるのは診断（すべて info）と、それを載せる文書・テストの期待値。

- `edge-label-hugging` が出る図: `skills/sumi/examples/dit-block`（edges[28] が線から 0.25mm）。ほかは `tests/fixtures/figures/` の再現図（`fit/b-dit`・`variants/b-dit-plain`・`dim/b-dit`・`sublabel/b-dit` の edges[29]、`color-use/agent-loop-b`、`layout/grid-training`）。Skill のレイアウト・ギャラリー・`docs/assets` では出ない。しきい値は `LABEL_HUG_UNITS`（`placement.ts`）の 1 か所。
- `token-column-drift`: `examples/`・Skill の例・レイアウト・ギャラリーでは出ない（当初 `sumi/bracket` で出ていたのは、`direction: down` の別々の見本を比べた誤検出で、横並びの列だけを近い列と比べるよう直した）。出るのは `tests/fixtures/` の図だけ。
- `edge-label-on-corner`: `examples/`・Skill の例・レイアウト・ギャラリーでは出ない。出るのは `tests/fixtures/figures/` と `research/` の再現図（`fit/c-h3world` の edges[19]、`density/text-heavy-boxes`、stage-B の図 2）。
- 直線の `arrowhead-cramped`: `fit/b-dit`（edges[6]・[7]・[24]・[46]・[59]）と `fit/c-h3world`（edges[11]〜[16]）の再現図で出る。`examples/` では出ない。
- 再現図は編集しない。診断の件数を固定していたテスト（`fit.integration`、`structured`、`dim.integration`、`edge-label-at.integration`）の期待値に、新しい info を記録した。`bun run gallery` でギャラリーの診断の表示を更新した。
