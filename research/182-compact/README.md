# #182 論文の図の詰めた間隔（`figure.layout.density: compact`）

[Issue #182](https://github.com/nishide-dev/sumi-diagram/issues/182)、設計は [design doc §6.55](../../docs/design/phase1.md#655-182-の詰めた間隔figurelayoutdensity-compact)。関連: #167（[段階 C の調査](../../docs/research/167-stage-c.md) §4.6・§10 Q1）、#173（[paper Theme の比較](../173-paper-theme/README.md)、§6.52）、#183（`figure.fit: scale`、§6.48）。

#173 の 3 図（`paper`）を `figure.layout.density: compact` で描き直し、縮小後の大きさを原図と比べた記録。原図そのもの・切り出しはリポジトリに入れていない（Transformer: arXiv 1706.03762v7 Fig. 1、DiT: arXiv 2212.09748v2 Fig. 3、H3-World は利用者の未公開の図）。

## 構成

| パス | 内容 |
| --- | --- |
| `figures/a-transformer.sumi.yaml` | #173 の複製に `density: compact` を足し、通常の間隔のために書いた 4mm・3mm の `gap` を外した（2 列の間の 2mm、`gap: 0`、attach の gap は残す）。`paper-single`、縮小なし |
| `figures/b-dit.sumi.yaml` | #173 の複製に `density: compact` を足し、書いた `gap`（2〜4mm・根の 3.3mm）を外した（Timestep と Label の 1mm は残す）。拡大の引き出し線を #176 の `component: zoom` にした（#167 の代用の直交の 2 本は、詰めた間隔ではパネルの枠に沿って走り `edge-near-border` になる）。`paper-double`、`fit: scale` |
| `figures/b-dit-tight.sumi.yaml` | 上の B に、長い縦の `stack` 4 つだけ `gap: 1.5mm` を書いた版（`paper` の 0.5pt の辺の矢じりは 4pt なので通る） |
| `figures/c-h3world.sumi.yaml` | #173 の複製に `density: compact` を足し、2〜6mm の `gap` を外した。ただし詰めた既定値では足りなかった 3 か所は書き戻した（下の「C で書き戻した間隔」）。小さい間隔（0.5mm・1.5mm・1〜1.5pt・10pt・0）は残す。`paper-double`、`fit: scale` |
| `figures/assets/` | #167 の仮のフレーム画像 5 点の複製 |
| `render.ts` | 4 図（compact）と、比較の #173 の 3 図（通常の間隔）を描き、大きさ・原図の幅での高さ・診断を出し、compact の PDF → PNG（200dpi）→ 64 色のプレビューを書く。error・warning があれば止まる |
| `previews/<図>.png` | compact で描いた図（各 150KB 未満） |

## 再現

```sh
bun install --frozen-lockfile
bun research/182-compact/render.ts
```

環境: macOS 26.2 / arm64、Bun 1.3.14、基点 main `c596da4`（#173・#174・#181・#183・#184 を含む）、Poppler 26.04.0、ImageMagick 7.1.2。`out/` は無視される。

## compact の値（paper-single・paper-double。理由は §6.55）

| 項目 | 通常 | compact |
| --- | --- | --- |
| `gap` を省略した stack / row の間隔（`arrangeGap`） | 4mm | **2.5mm** |
| group の内側の余白（`groupPadding`。キャプションとの間はその半分） | 8pt | **6pt** |
| ラベルの左右の余白（`nodePaddingX`） | 7pt | 7pt（変えない） |
| ラベルの上下の余白（`nodePaddingY`） | 3.5pt | **1.5pt** |
| 1 行の箱の高さ（8pt の文字。行送り 10pt＋上下の余白） | 17pt | **13pt** |

presentation-16x9 はどちらも 2 倍。文字の大きさ・最小の文字・ページの上限・余白（margin）・auto（D2）の値は変えない。

## 測定

原図の印刷時の大きさ（#167 §1.1）: A 77.2 × 113.7mm、B 約 170 × 68mm（キャプションを含む）。C はラスタ（1724 × 1428px）で印刷時の大きさが分からないので、縦横比だけを比べる。「原図の幅での高さ」は、Sumi の図を原図と同じ幅にそろえたときの高さ。

| 図 | 間隔 | 印刷される大きさ | 縮小率 | 原図の幅での高さ（原図との比） | 縮小後の文字（node / 辺・sublabel / 添字） | 診断（error / warning / info） |
| --- | --- | --- | --- | --- | --- | --- |
| A | 通常（#173） | 79.2 × 140.58mm | 1 | 137.0mm（×1.205） | 8 / 7 / 4.9pt | 0 / 0 / 0 |
| A | **compact** | 76.02 × 114.83mm | 1 | **116.6mm（×1.026）** | 8 / 7 / 4.9pt | 0 / 0 / 0 |
| B | 通常（#173） | 180 × 96.15mm | 0.8016 | 90.8mm（×1.335） | 6.41 / 5.61 / 3.93pt | 0 / 0 / 1 |
| B | **compact** | 180 × 87.66mm | 0.8297 | **82.8mm（×1.217）** | 6.64 / 5.81 / 4.07pt | 0 / 0 / 1 |
| B | compact＋縦の `gap: 1.5mm` | 180 × 76.83mm | 0.8297 | **72.6mm（×1.067）** | 6.64 / 5.81 / 4.07pt | 0 / 0 / 1 |
| C | 通常（#173） | 180 × 129.14mm | 0.7814 | 縦横比 0.717（原図 0.828） | 6.25 / 5.47 / 4.38pt | 0 / 0 / 1 |
| C | **compact** | 180 × 124.78mm | 0.8462 | 縦横比 0.693（原図 0.828） | 6.77 / 5.92 / 4.74pt | 0 / 0 / 1 |

info は B・C とも `geometry/script-too-small`（添字。#183 で縮めた図には必ず出る情報）だけ。`lint --geometry` の warning・error は 0。**縮小後の node・辺のラベル・sublabel の文字は 5pt 以上**（利用者の判断の下限。数式の添字は対象外で、B で 4.07pt・C で 4.74pt の info）で、compact の方が図が狭くなり縮小率が上がるので、文字は通常の間隔より大きく印刷される（B の辺のラベル 5.61 → 5.81pt）。

## 読み取り（判断）

- **A はほぼ原図の密度になった**（原図の幅で 116.6mm、原図 113.7mm、+2.6%。通常は +20.5%）。A の高さはブロックの上下の余白・ブロックの間・group の余白の積み重ねで、compact の 3 つの値がそのまま効く。
- **B は既定の compact だけで 33.5% → 21.7% 高い**まで近づいた。残りは長い縦の stack（パネル 2〜4 に 11〜14 項目、うち junction 3 つは前後に間隔を 2 つ取る）の間隔で、`gap: 1.5mm` を書くと +6.7% になる。既定値を 1.5mm にしないのは、1pt の辺の Theme（`minimal`・`color`。矢じり 6pt = 2.12mm）では 2mm 以下で `layout/no-route`（矢じりより端が近い）になるため（§6.55）。`paper` の図で詰めたいときは、その図に `gap` を書けばよい（Skill に書いた）。
- **#167 §4.6 の予想どおり、効いたのは間隔と 1 行の箱の高さ**だった。左右の余白（`nodePaddingX`）を 7 → 4pt に詰めると図が狭くなり、`fit: scale` の縮小率が上がって、原図の幅での高さはかえって増えた（B: 4pt で 85.6mm、7pt で 82.8mm。下の「値を決めた試行」）。原図の箱も文字に対して横に広い。
- **C は通常でも原図より縦横比が小さい**（0.717、原図 0.828。原図の画像がキャプションの余白などを含むかは分からない）。compact では幅も高さも少し小さくなり、縮小率が 0.78 → 0.85 に上がって文字が大きく印刷される（node 6.25 → 6.77pt）。C は大きさを書いた node（画像 72pt 幅・キー 11pt 四方・行列のセル）が多く、間隔の効く部分が少ない。
- 見た目（プレビュー）: 3 図とも箱の上下の空きが文字の高さの 1/5 程度になり、原図の「箱どうしが短い線でつながる」詰まった印象に近づいた。Inter の行の箱（1.21em）は行送り（1.25em）に収まるので、上下 1.5pt でも文字は枠に触れない（8pt の Inter の字形の箱から箱の端まで 1.66pt、1pt の枠の内側の線まで 1.16pt）。

### 値を決めた試行（B、`paper`。原図の幅での高さ）

| `arrangeGap` | `groupPadding` | `nodePaddingX` / `Y` | 原図の幅での高さ | 診断 |
| --- | --- | --- | --- | --- |
| 2mm | 5pt | 4 / 2pt | 85.6mm | `edge-near-border` info 7（#167 の代用の引き出し線） |
| 1.5mm | 5pt | 4 / 2pt | 81.2mm | 同 8 |
| 1mm | 4pt | 4 / 2pt | — | `layout/no-route` 4 |
| 2mm | 6pt | 5 / 2.5pt | 86.9mm | なし |
| 2.5mm | 8pt | 7 / 3.5pt（通常と同じ余白） | 92.2mm | なし |
| 1.5mm | 6pt | 7 / 1.5pt | 74.8mm | `edge-near-border` 2（代用の線。`zoom` で 0） |
| 1.5mm | 6pt | 7 / 1pt | 72.8mm | 同上 |
| 2.5mm | 6pt | 7 / 1.5pt（採用） | 82.8mm（`zoom`） | なし |

- 余白 5pt では、#167 の代用の引き出し線（直交の 2 本）が adaLN のパネルの枠に沿って走った（`edge-near-border`）。6pt で消え、`zoom` にするとどの値でも出ない。§6.42 の矢じりの前の余地（`paper` で 7pt、1pt の辺の Theme で 9pt）が足りない group の辺は、配置エンジンがその側の余白だけを広げるので、6pt でも矢じりは枠に寄らない。
- 上下の余白 1pt は文字が枠に近すぎる（8pt の Inter の字形の箱から箱の端まで 1.16pt、1pt の枠の内側の線まで 0.66pt）ので採らない。
- 同じ YAML を `color`・`minimal` で描くと、2mm 以下の既定の間隔では Linear → Noise・Σ（1 つの箱から横に並んだ 2 つへ曲がって入る辺）が `layout/no-route`、単純な縦の矢印も 2mm で「端が矢じりより近い」になった。2.5mm なら試した 4 つの Theme（`paper`・`academic`・`minimal`・`color`）で通った。これはまっすぐな矢印に対する控えめな既定値で、どの図でも通る下限ではない（曲がる辺・障害物・辺のラベルにはもっと要ることがあり、C では 3 か所に書き戻した）。`slides` は paper 系の Profile では通常の間隔でも通らない図が多く（§6.42）、compact では A で `layout/no-route` 10 件・B で 2 件。

### C で書き戻した間隔

既定の 2.5mm では次の 3 か所が足りず、元の値を書き戻した（図の作者が書く範囲。Skill に「詰めた後に衝突したら、その箱にだけ大きい `gap` を書く」と書いた）。

| 箇所 | 既定の 2.5mm での診断 | 書き戻した値 |
| --- | --- | --- |
| (a) の本体と VAE の間（「…」から VAE への辺） | `layout/no-route` | 6mm |
| フレームの列の stack（「scheduled prompt」の 2 行の辺のラベル） | `layout/edge-label-overlap`、`geometry/label-collision` | 3mm |
| LoRA と QKV / Out Proj. の間（🔥❄ の代わりのバッジ） | `geometry/label-collision` 2 | 6mm |

## 原図との比較（判断）

| 図 | 原図 | compact | 判定 |
| --- | --- | --- | --- |
| A | 77.2 × 113.7mm、ブロックの間は短い矢印 | 76.02 × 114.83mm | **密度は原図並み**。幅も paper-single（88mm）に余裕がある |
| B | 170 × 68mm、パネル 4 枚が同じ高さ | 170mm 幅で 82.8mm（書いた 1.5mm で 72.6mm） | 近づいた。既定値だけでは 2 割高い。残りは図ごとの `gap` |
| C | 縦横比 0.828（推定） | 0.693 | 通常から変わらず原図より横長。文字は大きく印刷される |

残る差（判断）: ⊕ の円（`paper` で 16pt、原図は小さい）と junction が縦の stack で間隔を 2 つ取ること（B）、大きさを書いた node（C）。いずれも間隔の値の範囲外で、#182 では変えない（自動の詰めは非対象）。
