# #173 paper Theme と基準の 3 図の比較

[Issue #173](https://github.com/nishide-dev/sumi-diagram/issues/173)、設計は [design doc §6.52](../../docs/design/phase1.md#652-173-の論文向けの-theme-paper)。関連: #167（[段階 C の調査](../../docs/research/167-stage-c.md) §1.1・§4.1、[3 図の再現](../167-stage-c/README.md)）、#172（Inter、§6.44）、#183（`figure.fit: scale`、§6.48）。

新しい組み込みの Theme `paper` で #167 の 3 図を描き直し、原図（基準の図）と並べて比べた記録。原図そのもの・切り出し・文言はリポジトリに入れていない（Transformer: arXiv 1706.03762v7 Fig. 1、DiT: arXiv 2212.09748v2 Fig. 3 は公開の PDF、H3-World は利用者自身の未公開の図で、見た目の特徴だけを書く）。

## 構成

| パス | 内容 |
| --- | --- |
| `figures/a-transformer.sumi.yaml` | `research/167-stage-c/figures/a-transformer.sumi.yaml` の複製。`theme: paper` だけを変えた（`paper-single`） |
| `figures/b-dit.sumi.yaml` | 同 `b-dit` の複製。`theme: paper` と `figure.fit: scale`（#183 の fixture と同じ）を足した（`paper-double`） |
| `figures/c-h3world.sumi.yaml` | 同 `c-h3world` の複製。`theme: paper`、`figure.fit: scale`、**キー 45 個の大きさを 8.5pt → 11pt**（下の「C のキー」） |
| `figures/assets/` | #167 の仮のフレーム画像 5 点の複製（原図の画素ではない） |
| `render.ts` | 3 図を `paper` と `--theme color` で描き、PDF → PNG（200dpi）→ 64 色のプレビューを書く |
| `previews/<図>.png` | `paper` で描いた図（各 150KB 未満） |
| `previews/<図>.color.png` | 同じ YAML を `--theme color` で描いた図（同じ main での比較用） |

## 再現

```sh
bun install --frozen-lockfile
bun research/173-paper-theme/render.ts
bun src/cli/index.ts lint --geometry research/173-paper-theme/figures/b-dit.sumi.yaml
```

環境: macOS 26.2 / arm64、Bun 1.3.14、基点 `397c120`（main、#172・#176・#178・#179・#183 を含む）、Poppler 26.04.0、ImageMagick 7.1.2。`out/` は無視される。

## paper Theme の値（要約。理由は §6.52）

| 項目 | 値 |
| --- | --- |
| フォントセット | `sumi/inter-biz-ud-gothic`（structured の図の欧文は Inter、日本語は BIZ UDPGothic、数式は STIX Two） |
| 文字 | node 8pt、group の見出し 9pt（太字）、辺のラベル 7pt |
| 枠と線 | node・group の枠 1pt の黒、辺 0.5pt の黒（矢じりの長さ 4pt）、emphasis は枠 1.5pt＋太字・辺 1pt |
| 角丸 | box・square 2pt、group 6pt、legend 3pt。円・ひし形などの形と、輪郭を自分で描く部品（stack・document など）は 0 |
| group | 塗り `#f3f3f5`（原図 A・B のパネルの薄灰）、黒い 1pt の枠。`muted` は白地・灰色の枠と細字の見出し |
| 文字と muted | 文字 `#000000`、muted `#737373`（白地で 4.7:1） |
| tone | gray `#dcdee6`、red `#f6dcdb`、orange `#f9e0bc`、yellow `#f1f4c6`、green `#d0e6cd`、blue `#cddff6`、purple `#dfdcef`、pink `#f6d8e5`（黒い文字とのコントラスト 15:1 以上） |

tone の色は原図の画素を測った値（A: Input Embedding `#f7e1e1`、Multi-Head Attention `#fae3c0`、Add & Norm `#f2f4c6`、Feed Forward `#c9e7f5`、Linear `#dcdfee`、Softmax `#d1e6d1`、パネル `#f3f3f4`。B: Layer Norm `#cadafb`、Pointwise Feedforward `#c9e2c0`、Self-Attention `#f2ce94`、灰色の箱 `#d5d7e2`、パネル `#f3f3f6`）に寄せ、A と B で違う色相（blue: A は水色、B は青紫）は中間にした。

## 測定（同じ YAML を `paper` と `color` で）

| 図 | Theme | 自然な幅 | 印刷される大きさ | 縮小率 | 縮小後の文字（node / 辺 / 添字） | 診断（error / warning / info） |
| --- | --- | --- | --- | --- | --- | --- |
| A | paper | 79.2mm | 79.2 × 140.58mm | 1 | 8 / 7 / 4.9pt | 0 / 0 / 0 |
| A | color | 87.14mm | 87.14 × 140.58mm | 1 | 8 / 7 / 4.9pt | 0 / 0 / 0 |
| B | paper | 228.1mm | 180 × 94.66mm | 0.7892 | 6.31 / **5.52** / 3.87pt | 0 / 0 / 1（`script-too-small`） |
| B | color | 257.0mm | 180 × 84.01mm | 0.7004 | 5.60 / **4.90** / 3.43pt | **4** / 0 / 3（`text-too-small` 4、`script-too-small`、`edge-near-border` 2） |
| C | paper | 230.4mm | 180 × 129.14mm | 0.7814 | 6.25 / 5.47 / 4.38pt | 0 / 0 / 1（`script-too-small`） |
| C | color | 232.5mm | 180 × 127.97mm | 0.7743 | 6.19 / 5.42 / 4.34pt | 0 / 0 / 1（`script-too-small`） |

（C の `lint/empty-label` 90 件は `lint` でだけ出る書き下しの印で、両 Theme で同じ。）

- **辺のラベル 7pt のまま B が 5pt の下限を満たした**。Inter は BIZ UDPGothic より約 14% 狭く（§6.44）、B の自然な幅が 257 → 228mm になって縮小率が 0.70 → 0.79 に上がった。#183 で 4.90pt（error 4）だった γ₁,β₁ などは 5.52pt。辺の文字を 7.5pt に上げる案は、幅が広がって縮小率が下がるので採らなかった（7pt で足りる）。
- A は幅が 9% 狭く（87.14 → 79.2mm）、paper-single（88mm）に余裕ができた。高さは同じ（行の高さは文字の大きさ × 1.25 で決まり、書体によらない）。

### C のキー（Inter の行の箱）

C をそのまま `paper` にすると、8.5pt 四方のキー 45 個がすべて `geometry/label-overflow`（error）になった。幾何 lint は文字の行の箱を hhea の ascender＋descender で測り、Inter は 1.21em（0.969＋0.241）、BIZ UDPGothic は 1.00em（0.880＋0.120）。8pt の 1 文字が Inter では高さ 9.69pt になり、枠 1pt の 8.5pt 四方に収まらない。複製ではキーを 11pt 四方にした（8pt の文字には 9.69＋1 = 10.69pt 以上が要る）。キーの行は列の幅より狭いので図の幅は変わらない（`color` での縮小率は 8.5pt でも 11pt でも 0.7743）。幅・高さを明示した小さな node では paper で同じことが起きるので、Skill に「明示する大きさは文字の約 1.4 倍」と書いた。

## 原図との比較（判断）

各図の左が原図（手元で見たもの）、右が `previews/<図>.png`。`color` との差は `previews/<図>.color.png`。

### A Transformer（`previews/a-transformer.png`）

| 見た目 | 原図 | paper | 判定 |
| --- | --- | --- | --- |
| ブロックの角 | 角丸（小） | 2pt の角丸 | 近い |
| ブロックの塗り | パステル 6 色 | 測った色に寄せた tone（ピンク・橙・黄緑・水色寄りの青・薄紫・薄緑） | 近い。Feed Forward は原図より少し青紫（B との中間） |
| ブロックの枠 | 黒・太い（約 1pt） | 黒 1pt | 同じ |
| エンコーダ・デコーダの枠 | 角丸・黒い太い枠・薄灰の塗り | 6pt の角丸・黒 1pt・`#f3f3f5` | 近い（`color` は灰色の細い角の鋭い枠） |
| 線 | 黒・太い（約 1pt） | 黒 0.5pt | **細い**。矢じりの大きさが線幅で決まるため（下） |
| 矢じり | 小さい（長さ約 1.2mm、推定） | 長さ 4pt（1.41mm） | 近い（`color` は 6pt = 2.12mm） |
| 字形 | 細いサンセリフ（Helvetica 系） | Inter | 近い（`color` は BIZ UDPGothic） |
| 残差の線 | 余白の中央 | 余白の中ほど（`edge-near-border` なし） | 近い |
| 縦の長さ | 77.2 × 113.7mm | 79.2 × 140.6mm | 縦に長いまま（compact、#167 §4.6 の別項目） |

### B DiT（`previews/b-dit.png`）

| 見た目 | 原図 | paper | 判定 |
| --- | --- | --- | --- |
| 箱 | **枠線のない**角丸の塗り | 黒 1pt の枠の角丸の塗り | 枠線が残る（枠のない variant は #174） |
| 塗り | 青紫・緑・橙・灰の淡い色 | blue・green・orange・gray の tone | 近い |
| DiT Block | 白地・黒枠の角丸 | 同じ（2pt の角丸） | 近い |
| 2 番目のパネル | 角丸・黒い枠・ごく薄い灰 | 6pt の角丸・黒 1pt・tone gray（`#dcdee6`） | 塗りが原図より濃い。複製の YAML がパネルに `tone: gray` を付けているため（tone なしの group なら `#f3f3f5` で原図どおり） |
| 3・4 番目のパネル（薄表示） | 角丸・灰色の枠と文字・淡い塗り | `muted`: 白地・灰色の枠・灰色の細字の見出し、角丸 | 枠と文字は近い。箱の塗りは淡くならない（`variant: dim` の継承、#167 §4.2） |
| 線と矢じり | 細い線・小さい矢じり | 0.5pt・縮小後 3.2pt の矢じり | 近い |
| 字形 | Helvetica / Arial | Inter | 近い |
| 数式（γ₁,β₁・α₁・*t*・*y*） | Cambria Math | STIX Two。Inter の横では小さく見える（下の「数式の大きさ」） | 差あり |
| 寸法の 2 行目（32 × 32 × 4） | 小さい | 同じ大きさ | sublabel（#184） |
| 拡大線 | 角どうしの斜めの破線 | 複製は #167 の代用（直交の折れ線） | `zoom`（#176）を使えば近づく。複製は変えていない |
| 印刷時の文字 | 5.4〜8.4pt | 縮小後 5.5〜7.1pt | 近い。5pt の下限を満たす |

### C H3-World（`previews/c-h3world.png`。利用者の図。特徴だけを書く）

| 見た目 | 原図 | paper | 判定 |
| --- | --- | --- | --- |
| (a)(b) のパネル | 枠線のない角丸の淡い塗り | 黒 1pt の枠の 6pt の角丸、`#f3f3f5` | 角丸は近い。枠線が残る（#174） |
| (c) のパネル | 角丸の破線の枠、塗りなし | `muted`: 灰色の実線の角丸、白地、灰色の見出し | 破線は #174 の variant |
| 箱 | 角丸の淡い塗り（枠なし）と、色の枠線で白地の箱 | 黒枠の角丸の tone の塗り | 色の枠線は tone の枠線（#167 §4.5） |
| トークン・キー | 間隔を空けた小さな角丸 | 2pt の角丸。キーは 11pt 四方（上） | 角丸は近い。キーは原図より大きい |
| 線と矢じり | 細い線・小さい矢じり | 0.5pt・縮小後 3.1pt | 近い |
| 字形 | サンセリフ | Inter | 近い |
| 添字のある記号（A₁・I₀・V₁） | サンセリフ | STIX Two の斜体。Inter の横で小さく、書体も違う | 差あり（下） |
| 回転した文字・絵文字・bowtie・斜線 | あり | #167 の代用のまま | 各 Issue（#178 ほか）。複製は変えていない |

### まとめ（判断）

- **角丸・パステルの塗り・小さい矢じり・サンセリフの 4 点は 3 図とも原図に近づいた**。`color` と並べると、角の鋭い箱・BIZ UDPGothic の欧文・大きい矢じりが最も目立つ差だったのが消えた。
- 残る最大の差は **枠線のない箱とパネル（B・C）と破線のパネル（C）** で、これは variant（#174）が担う。paper Theme はその variant の値を後から足す（#174 または後続）。
- 線の太さは A（太い線）と B・C（細い線）で原図が分かれる。矢じりの大きさが線幅で決まる（D2 の三角形: 長さ 4 + 4 × 線幅 unit）ので、小さい矢じりを優先して辺を 0.5pt にし、A の太い線は再現しない。node の枠は 1pt（A の黒い枠）。

### 数式の大きさ

Inter の x-height（0.546em）は STIX Two Text Italic（0.467em）より 17% 大きく、同じ大きさで並べると数式の変数（γ・β・α・*t*・*y*、添字の A₁ など）が小さく見える（#172 §6.44 で予想したとおり）。x-height を揃えるには数式を約 1.17 倍にする必要があるが、今の Theme の形式には数式の大きさを変えるプロパティがなく（数式の run はラベルの文字の大きさで描く）、計測・行の高さ・PDF・PPTX にまたがる変更になるので、この Issue では変えない。必要なら別 Issue で「Theme の数式の倍率」を検討する（§6.52）。
