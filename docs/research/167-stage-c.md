# #167 論文図の段階 C の範囲（Transformer・DiT・H3-World 系の 3 図から）

- 対象: [#167](https://github.com/nishide-dev/sumi-diagram/issues/167)。関連: #80（ロードマップ）、#86（[論文図の調査](86-paper-figures.md)）、#124（[段階 B](124-stage-b.md)）、#151（[v0.5 の dogfooding](../../research/151-dogfood-v0.5/README.md)）
- 調査日: 2026-10-28。環境: macOS 26.2 / arm64、Bun 1.3.14、Sumi の基点 `67a4816`（main、v0.5.2）、製品の WASM エンジン（無変更）、同梱の BIZ UDPGothic 1.051・STIX Two Math / Text Italic 2.13。画像の確認に Poppler 26.04.0、ImageMagick 7.1.2
- 描いた図・試作・再現手順: [`research/167-stage-c/`](../../research/167-stage-c/README.md)。測定値は `results/*.json`、描画の縮小版は `previews/`

本文では、**実測**（CLI・スクリプトで確かめた値と挙動）と**判断**（それに基づく採否・設計）を分けて書く。判断の段落・表の列には「判断」と明記する。段階 B（#124）は dogfooding の頻度で範囲を決めたが、段階 C は **基準の 3 図をどこまで論文にそのまま載せられる品質で再現できるか** を尺度にする。

## 0. 結論

| 図 | 今の構文での到達度（判断） | 残る主な差（上位） |
| --- | --- | --- |
| A Transformer | **構造は原図どおり描ける**。診断は info 5 件だけ（error・warning 0） | 角丸・細い線・濃い枠の塗りがない（Theme）、残差の線が枠に 0.35mm まで寄る（不具合 R3）、欧文の字形 |
| B DiT（4 パネル） | **構造は描ける**が、`paper-double` の幅を超える（224mm、error 1） | 幅、拡大の引き出し線（`zoom`）、入力の段差（#151 C1）、辺のラベルの白い背景（R2）、位置で変わる ⊕ の周りの迂回（R1）、パネルの枠 |
| C H3-World 系 | **驚くほど描ける**（224 ノード・30 辺）が、幅 230mm（error 1）・`lint/empty-label` 90 件。224 ノードのうち 177 がキー・トークン・行列のセルと見出し | 幅、データ部品（`tokens` / `matrix` / `keys`）、回転文字、色つき範囲、画像の重ね、バッジ、bowtie、辺の色、真下の線（C1・R1） |

1. **段階 C の前に直す不具合が 3 つある**（§3）。R1: 端がほぼ揃っている（ずれが 1 unit 未満）と、ルータが短い段差を作れずに送り元の周りを一周する（最小再現は 50mm ずらすと起き、49mm・51mm では起きない）。R2: 辺のラベルの背景が常に辺の `fill`（白）で、色つきのグループの上では白い四角になる。R3: color テーマでは、横から入る残差の線がグループの枠に 0.35mm まで寄る（矢じりと角の丸めの分の余白がない）。どれも図 B・C の見た目に直接効く。
2. **最も効く新機能は「幅に合わせた縮小」と「送り元の真上で入る端」**（§4.1・§4.2）。B・C は今の 8pt の文字のままでは 180mm に収まらない。文字だけを 6pt にしても C は 215.9mm（固定の寸法が支配的）で、**LaTeX で縮小して載せる前提の `fit: scale`（実効の文字の大きさを検査）** が現実的。ただし実効の文字は 6.3〜6.4pt、辺のラベルは 5.5pt、添字は 3.8pt になり、`paper-*` の最小 7pt を下回る（**利用者の判断**、§10 Q1）。真上の端は、試作で 3 図の 22 本中、射影が辺の上にある 19 本すべてをまっすぐにした（§5.1）。
3. **見た目の質は Theme で決まる部分が大きい**。3 図とも原図は「パステルの塗り・細い線・角丸」で、今は color（太い線・角が鋭い）か academic（細い線・単色）の二択（§4.3、§10 Q2）。
4. **図 C のデータ部品（`tokens`・`matrix`・`keys`）は、legend と同じ「既存の要素への展開」で実装できる**（§4.6）。C で書き下した 177 ノードが部品 9 個（キー 5・トークン列 3・行列 1）になり、`lint/empty-label` の 90 件も消える。セルへの辺（`sequence.a5`）は展開した要素の予約 ID に解決する。
5. **回転した文字は PDF では問題なく、inspect の契約が拒否する**（試作 P2、§5.2）。`<text transform="rotate(-90 …)">` は PDF で文字のまま抽出でき（Type 3 なし）、`inspectSvg()` は `svg/unsupported-geometry` で拒否する。契約の拡張（±90° のみ）が実装の中心になる。
6. **milestone 案**: 不具合 3 件を v0.5.3、段階 C を「v0.6.0 — Paper figures stage C」（9 件＋Skill）と「v0.7.0 — Paper figures stage C, part 2」（5 件）に分ける（§7）。#151 の C4〜C7、構造の中の自由グラフ（ELK）、MathJax、recipe、編集可能 PPTX の structured 対応は、3 図のどれにも必要なかったので後回し（§8）。

## 1. 参照した版・基準の図

### 1.1 基準の図（判断: 記憶からの記述）

元の論文の図はリポジトリに入れず、画素も文章も使っていない。以下は**論文の図の記憶**による記述で、確度を付ける（高: 図の構造として確かな点、中: 細部、低: 確信がない点）。#86 の理想の YAML（[`ideal/`](../../research/86-paper-figures/figures/ideal/)）も参照した。

| 図 | 頼った視覚的な特徴 | 確度 |
| --- | --- | --- |
| A Transformer（Vaswani et al. 2017, Fig. 1） | 左にエンコーダ、右にデコーダ。下から Inputs → Input Embedding（ピンク）→ ⊕（左に正弦波の円と「Positional Encoding」）→ 灰色の角丸の枠の中に Multi-Head Attention（橙）と Add & Norm（黄、接して上）、Feed Forward（青）と Add & Norm。枠の左に「N×」。分岐から 3 本の矢印（Q・K・V）と枠の内側を通る残差。デコーダは Masked Multi-Head Attention・Multi-Head Attention（エンコーダの出力から 2 本）・Feed Forward、残差は右、「N×」は右。上に Linear（薄紫）→ Softmax（緑）→ Output Probabilities。細い黒い線と塗りの三角の矢じり、ブロックはすべて角丸 | 構造: 高。色の系統: 中（正確な色値は不明）。線の太さ・角丸: 中 |
| B DiT（Peebles & Xie 2023, Fig. 3） | 4 パネルが横に並ぶ。左: 「Latent Diffusion Transformer」（Noised Latent 32 × 32 × 4 → Patchify、Timestep *t*・Label *y* → Embed、N × DiT Block、Layer Norm、Linear and Reshape、出力 Noise と Σ（各 32 × 32 × 4）、latent は小さな画像）。2 番目: 「DiT Block with adaLN-Zero」（Layer Norm・Scale, Shift・Multi-Head Self-Attention・Scale・⊕ を 2 段、Conditioning → MLP から 4 か所へのバスと γ₁,β₁・α₁・γ₂,β₂・α₂ のラベル）。3・4 番目: Cross-Attention と In-Context Conditioning の変種。左のパネルの DiT Block から adaLN-Zero のパネルへ拡大の引き出し線。各パネルの下にキャプション | 構造・文言: 高。拡大の引き出し線が 2 本の破線であること: 中。ブロックのパネルが角丸の灰色の面であること: 中。**3・4 番目のパネルが薄表示であること（#86 の記述）: 低**（記憶では確証がない）。左のパネルの線に矢じりがないこと（#86 の記述）: 低。色の割り当て: 低 |
| C H3-World 系の概要図 | 特定の論文の図としては記憶にない。**#86 の草案 `ideal/c-h3world.sumi.yaml` が記述する構造を基準にした**: (a) フレーム画像の列（I₀、I₁₋₄ …、複数フレームは重ねた画像）、キー（W A S D / I F J K L、押下中を橙）、色つきの範囲を含むプロンプト（左揃え）、H3 Encoder ×6、2-Layer Token Refiner、詰めたトークン列（Static・A₁…・I₀・V₁…）、縦書き（回転）の Visual VAE Encoder。(b) トークン列と H3 Omni Transformer Block の積み重ね。(c) 破線のパネルに LoRA（bowtie、🔥）・QKV Proj.（❄）・⊕・マスク付き Attention の 9 × 9 行列（Allowed / A↔V Link / 斜線の Masked、凡例）・Out Proj.、橙の辺 | 草案の構造: 高（ファイルどおり）。実在の図との一致: 不明 |

以下の差の比較は、この記述と、描いた図の PNG（`research/167-stage-c/previews/`）を並べて行った。

### 1.2 固定した入力

| 対象 | 版 | 確認方法 |
| --- | --- | --- |
| Sumi | `67a4816`（main、v0.5.2） | `bun src/cli/index.ts`（`--version` は 0.5.2）。試作は製品の `src/` を読み取り専用で import |
| D2 | 使わない | 3 図とも structured（`figure.layout.arrange`） |
| PDF/PNG エンジン | `assets/wasm/sumi-pdf.wasm` | 製品の `svgToPdf` |
| フォント | BIZ UDPGothic 1.051、STIX Two Math / Text Italic 2.13 | 同梱ファイル |
| 画像 | 自作の仮の画像 8 点（ImageMagick の plasma / noise、1.8〜3.3KB） | `research/167-stage-c/figures/assets/` |

## 2. 3 図の再現（実測）

### 2.1 方法

- 現行 main の CLI だけを使い、1 回ごとに `fmt → lint --geometry → render（SVG・PDF）→ pdftoppm（200dpi）→ PNG を Read で見る` を回した（`render.sh`）。細部は 400〜600dpi で切り出して見た。
- テーマは原図に近い **`color`**（パステルの塗り）。A は `paper-single`、B・C は `paper-double`。
- C は、キー・トークン列・行列をノードで書き下す必要があり、手で書くと誤りやすいので**生成スクリプト**（`gen-c.ts`）で書いた。生成したファイルはそのまま CLI に通る普通の YAML である。

| 図 | 手直しの回数 | 最終の診断（error / warning / info） | 大きさ | YAML | 描画の時間（中央値） |
| --- | --- | --- | --- | --- | --- |
| A | 2 | 0 / 0 / 5（`geometry/edge-near-border` ×5） | 86.8 × 140.6mm | 112 行、ノード 30・group 2、辺 30 | 0.15 秒 |
| B | 6 | 1 / 0 / 0（`geometry/exceeds-page-width`） | 224.0 × 121.0mm | 223 行、ノード 58・group 3、辺 61 | 0.18 秒 |
| C | 6 | 1 / 90 / 0（幅 1、`lint/empty-label` 90） | 229.7 × 160.3mm | 362 行、ノード 224・group 5、辺 30 | 0.35 秒 |

（時間は CLI の起動を含む 3 回の中央値。この環境での目安。）

### 2.2 図 A: Transformer

[`figures/a-transformer.sumi.yaml`](../../research/167-stage-c/figures/a-transformer.sumi.yaml)、[`previews/a-transformer.png`](../../research/167-stage-c/previews/a-transformer.png)。`examples/transformer` を `color` にして始めた。

| 回 | 変更 | 診断 | 見た目 |
| --- | --- | --- | --- |
| 1 | 作例を `color` に | 0 / 0 / 5 | エンコーダの出力（K・V）の幹線の終わり（`south:0.5`）とデコーダの分岐点（中心の hidden junction）が線の太さほどまで近づき、「ʃ」字形に絡んで見える（交差ではないので診断なし）。残差が枠に寄る |
| 2 | K・V を `south:0.2` / `south:0.4`、Q を `south:0.8` に（K・V は中心線の左、Q は右） | 0 / 0 / 5 | 絡みが消えた。残る差は下表 |

| # | 原図との差 | 分類 | 根拠 |
| --- | --- | --- | --- |
| A-1 | ブロックとグループの角が丸くない | 新機能（Theme） | Theme のスタイルに `radius` はある（`src/core/theme/style.ts`）が、組み込みの 4 Theme はすべて 0。YAML からは選べない（§4.3） |
| A-2 | 線が太く矢じりが大きい（`color` は 1pt）。細い `academic` には色がない | 新機能（Theme） | §4.3 |
| A-3 | 残差の線がグループの枠に 0.35mm まで寄り、矢じりの直前で角が鋭くなる（線の端が角から少しはみ出す） | **不具合 R3** | `geometry/edge-near-border` info ×5。同じ YAML を `academic` で描くと 0 件で、残差は余白の中央（ブロックと枠からそれぞれ 8 unit）を通る。`color` では枠から 4 unit。[`previews/detail-residual-lane.png`](../../research/167-stage-c/previews/detail-residual-lane.png)（§3.3） |
| A-4 | グループの塗りが原図より薄い（`#f6f8fa`） | Theme（A-1 と同じ Issue） | — |
| A-5 | 欧文の字形（BIZ UDPGothic。原図は Helvetica 系） | 判断（フォント。§10 Q6） | — |
| A-6 | 作例の anchor（0.15 / 0.5 / 0.85）だと K・V の幹線がデコーダの分岐点に接するほど近づき、絡んで見える。近接の lint（#156）も交差の報告も出ない | Skill の不足（既存の書き方で直る）。lint の穴（軽微） | 1 回目と 2 回目の比較 |
| A-7 | K・V の幹線と Q の分岐が同じ高さに来て、約 1mm まで近づく | 見た目（軽微）。高さは `gap` でしか動かせない | 2 回目の PNG |

判断: A は**構造上の不足はなく**、差は Theme（A-1・A-2・A-4）と不具合 R3 に集まる。

### 2.3 図 B: DiT

[`figures/b-dit.sumi.yaml`](../../research/167-stage-c/figures/b-dit.sumi.yaml)、[`previews/b-dit.png`](../../research/167-stage-c/previews/b-dit.png)。左のパネルは枠がないので group にせず、`stack` と label（キャプション役）で組んだ。残り 3 パネルは `tone: gray` の group と `caption`。

| 回 | 変更 | 診断 | 見た目 |
| --- | --- | --- | --- |
| 1 | 初版 | `layout/no-route` 3（画像の上の label から辺を出した） | — |
| 2 | 辺を画像から出す | 幅 249.6mm（error）、`layout/edge-crossing` 4 | 4 番目のパネルで、⊕ に入る線と出る線が ⊕ の周りを一周し、残差と交差する。辺のラベル γ・α の背景が白い四角。拡大の線は直交の折れ線で、下の 1 本は adaLN のパネルの左の枠の上を走る |
| 3 | 間隔を詰め、キャプションと入力の label を 2 行に | 幅 223.1mm、交差 4 | 一周は残る |
| 4 | 4 番目のパネルの入力を入れ子の `stack`（gap 4mm）に、`align: { x: [noised-img, patchify] }` | 幅 223.1mm、交差 0 | 一周が消えた。代わりに Noised Latent の画像から Patchify への線が画像の周りを一周（`align` の残差 0.006 unit。R1） |
| 5 | 左のパネルを 2 列の `stack` に組み直し、`align` をやめる | 幅 223.1mm、**交差 4（一周が再発）** | 図の位置が変わっただけで再発 |
| 6 | 根の `row` の `gap` を 3.3mm に（3mm・3.5mm・4mm では一周し、3.2・3.3・3.4・3.6・3.7mm では起きない） | 幅 224.0mm、交差 0 | 最終版 |

| # | 原図との差 | 分類 | 根拠 |
| --- | --- | --- | --- |
| B-1 | 幅 224mm で `paper-double`（180mm）を超える（error） | 新機能（判断: 縮小、§4.1・§10 Q1） | `geometry/exceeds-page-width`、試作 P3 |
| B-2 | 拡大の引き出し線が、角どうしを結ぶ 2 本の斜めの破線にならない（直交の折れ線。下の 1 本はパネルの枠に重なる） | 新機能 `zoom`（§4.5） | 今の代用: `fromAnchor: "east:0"` → `toAnchor: "west:0"` の `line` 2 本 |
| B-3 | Patchify・Embed → DiT Block、Timestep・Label → Embed、4 番目のパネルの入力 → Concatenate に段差 | 新機能（#151 C1、§4.2）。Patchify・Embed は DiT Block より外にあるので、DiT Block を広げる（`props.width`）のは Skill | 試作 P1 |
| B-4 | 辺のラベル（γ₁,β₁・α₁ …）の背景が白く、灰色のパネルの上で白い四角に見える | **不具合 R2** | [`previews/detail-label-halo.png`](../../research/167-stage-c/previews/detail-label-halo.png)（§3.2） |
| B-5 | ⊕ の周りを線が一周する（根の `gap` で出たり消えたりする） | **不具合 R1** | [`repro/operator-loop.sumi.yaml`](../../research/167-stage-c/repro/operator-loop.sumi.yaml)（§3.1） |
| B-6 | パネルが「枠線のない角丸の灰色の面」にならない（group は必ず枠線を描く） | 新機能（panel の variant ＋ Theme の角丸、§4.4・§4.3） | — |
| B-7 | 左のパネル（枠なし）は group を使わず `stack` と label で代用した | Skill の不足（文書化） | キャプションの位置を他のパネルと揃えるには `row` の `align: end` が要る |
| B-8 | 「32 × 32 × 4」を小さな 2 行目にできない（同じ大きさの 3 行目） | 新機能 `sublabel`（低、§6） | — |
| B-9 | 3・4 番目のパネルの薄表示（#86 の記述） | 不明（確度 低。利用者が原図で確認、§10 Q8） | — |
| B-10 | latent の画像 | 対象外（#86 §9.4: Sumi は画像を描かない）。仮の画像で代用 | — |
| B-11 | キャプションを 2 行にした（幅を詰めるため） | B-1 の副作用 | — |

### 2.4 図 C: H3-World 系

[`figures/c-h3world.sumi.yaml`](../../research/167-stage-c/figures/c-h3world.sumi.yaml)（`gen-c.ts` が生成）、[`previews/c-h3world.png`](../../research/167-stage-c/previews/c-h3world.png)。

**表のような整列（#86 の `grid`）は今の構文で代用できた**: (a) の本体を「列ごとの `stack`（画像・キー・プロンプト・Encoder）を並べた `row`」と、それに `align: stretch` で揃う Refiner とトークン列の `stack` にし、左の見出しの列（Visual Stream・Action Stream・I₀・H3 Encoder・Sequence）は `figure.layout.align` の `y` 制約 5 本で各行に揃えた。

| 回 | 変更 | 診断（`empty-label` を除く） | 見た目 |
| --- | --- | --- | --- |
| 1 | 初版 | `layout/no-route` 8（プロンプトと Encoder の間 1.5mm、attach の位置、トークン列の下 2mm） | — |
| 2 | 間隔を 3mm、I₀ の label を西に、VAE との間を 6mm | 幅 213.4mm、`label-overflow` 4（プロンプトの幅 64pt） | — |
| 3 | プロンプトを 4 行に縮め、幅を自動に | 幅 213.4mm、交差 1 | Encoder 2 → Refiner の線が Encoder の周りを一周（`north:0.3` が中心から 0.8 unit ずれる。R1）。行列の列見出しが詰まる |
| 4 | 強調をやめ、⊕ に tone、行列のセルを 12pt に | 幅 225.8mm、交差 1、`unused-legend-entry` 1 | 凡例の見本を box に直した |
| 5 | Encoder → Refiner の anchor を SVG の座標から 4 桁で計算（#151 の回避策） | 交差 5 | **5 本すべてが Encoder の周りを一周**（ずれが 0.001〜0.035 unit） |
| 6 | 5 列の幅を 72pt・間隔 10pt に固定（中心が 36・118・200・282・364pt で、比が有限小数 0.09 … 0.91 になる） | 幅 229.7mm、交差 0 | Encoder → Refiner がまっすぐになった。最終版 |

| # | 原図（草案）との差 | 分類 | 根拠 |
| --- | --- | --- | --- |
| C-1 | 幅 230mm で `paper-double` を超える | 新機能（判断: 縮小。B-1 と同じ） | P3 |
| C-2 | キー 45 個を `square` で書き下し、文字が枠に接する | 新機能 `keys`（§4.6、§10 Q4） | 5 ステップ × 9 キー |
| C-3 | トークン列 3 本の 32 セルを box で書き下した。セルへの辺は書ける（各セルがノードなので） | 新機能 `tokens`（§4.6） | — |
| C-4 | 9 × 9 の行列が 81 セル＋見出し 19 の label。`lint/empty-label` 90 件（行列 81 と (c) のトークン 9）。列見出しの数式が詰まり、回転できない。斜線の「Masked」がない | 新機能 `matrix`（＋斜線、凡例を classes から）、§4.6 | 診断の件数 |
| C-5 | 「Visual VAE Encoder」を縦に回転できない（3 行の横書き） | 新機能 `labelRotation`（§4.7、試作 P2） | — |
| C-6 | プロンプトの色つきの範囲 | 新機能（色つきの文字範囲、§4.9） | — |
| C-7 | プロンプトの左揃え | 新機能 `textAlign`（§4.9） | — |
| C-8 | 複数フレームの重ねた画像（`layers`） | 新機能（画像の重ね、§4.10） | — |
| C-9 | 🔥・❄ のバッジを角に・色つきで置けない。Tabler の `flame` / `snowflake` を北に `attach`（文字色の黒） | 新機能 `badge`（§4.11、§10 Q5） | — |
| C-10 | LoRA の bowtie。`trapezoid` で代用 | 新機能 `bowtie`（§4.11） | — |
| C-11 | (c) の破線のパネル。`color` の `muted` は破線にならない（白地・灰色の題） | 新機能（container の `dashed`、§4.4） | catalog の説明どおり |
| C-12 | (b) の Attention から (c) への拡大線 | `zoom`（§4.5） | 描いていない |
| C-13 | 橙の辺 | 新機能（辺の `tone`、§4.8） | 辺に `tone` のフィールドはない |
| C-14 | 表の整列（`grid` / `span`） | Skill の不足（列の `stack` と `align` で代用できた）。`grid` は利便（§6） | 上記 |
| C-15 | Encoder → Refiner の真下の線のために、列の幅と間隔を「比が有限小数になる値」に固定した | 新機能 C1（§4.2）＋不具合 R1 | 3〜6 回目 |
| C-16 | 行列を囲む group に枠と塗りが付く | panel の `plain`（§4.4） | — |
| C-17 | 「scheduled prompt」のラベルの背景が白い | 不具合 R2 | — |
| C-18 | Refiner → A₅、A₃ → Block に段差 | C1 の `fromAnchor` 側（§4.2） | P1 |
| C-19 | (c) の上に空き（根の `row` の stretch と、中の `align: center`） | Skill（軽微） | — |
| C-20 | 「…」→ VAE の辺に小さな鉤 | 見た目（軽微） | — |

### 2.5 分類の集計

| 分類 | A | B | C | 主な Issue（§7） |
| --- | --- | --- | --- | --- |
| Skill の不足（今の書き方で埋まる） | 1 | 1 | 2 | 15 |
| 不具合 | 1 | 2 | 2 | 0-1・0-2・0-3 |
| 新しい機能 | 3 | 5 | 15 | 1〜14 |
| 対象外・判断・不明 | 1 | 2 | 0 | §10 |
| 軽微（見た目） | 1 | 1 | 1 | — |

判断: 「描けない」図はなかった。**論文に載せる品質**を妨げているのは、(1) 幅（B・C の唯一の error）、(2) 不具合 R1〜R3、(3) 真下・真横の線、(4) Theme（角丸・細線）、(5) C のデータ部品と文字の表現、の順である。

## 3. 不具合（段階 C の前に直す）

### 3.1 R1: ほぼ揃った端で、短い段差の代わりに送り元の周りを一周する

**実測**: [`repro/operator-loop.sumi.yaml`](../../research/167-stage-c/repro/operator-loop.sumi.yaml)（B の 4 番目のパネルを 50mm 右にずらしたもの）で、⊕ に入る線と出る線がそれぞれ ⊕ の周りを一周し、`layout/edge-crossing` が 4 件出る（[`previews/repro-operator-loop.png`](../../research/167-stage-c/previews/repro-operator-loop.png)）。ずらす量で結果が変わる。

| 根の `gap` | 40 | 45 | 49 | **50** | 50.5 | 51 | 55〜80 | **170** |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| info（交差） | 0 | 0 | 0 | **4** | 0 | 0 | 0 | **4** |

SVG の経路を見ると、Attention の中心 x が 444.968、⊕ の中心 x が 444.969 で、**0.001 unit** ずれている（stretch した箱の中心と、中央揃えの ⊕ の中心の丸めの違い）。隣り合う 2 つを直線で結ぶ特別扱い（#86 §4.1）は完全に一致したときだけ働き、狭い隙間（2.5mm）には stub 2 本と段差が入らないので、送り元の周りを一周する経路（`M 444.968 266.039 L 444.968 257.866 L 422.969 257.866 L 422.969 213.866 L 466.969 213.866 …`）になる。

同じ原因は図 C でも出た: `toAnchor: "north:0.3"` が中心から 0.8 unit ずれて一周（3 回目）、SVG から 4 桁で計算した anchor は 0.001〜0.035 unit ずれて 5 本すべてが一周（5 回目）。試作 P1（§5.1）の「4 桁に丸めた anchor」でも、B の Timestep → Embed が一周（余分な経路長 285 unit）した。

**判断（修正案）**: ルータで、端どうしの横のずれが ε（案: 1 unit = 0.5pt）以下なら、まっすぐに揃える（anchor を辺の上で ε 以内だけ動かす。辺の外には出さない）。ε を超え、隙間に段差が入らない場合は、一周より短い「stub を縮めた段差」を候補に入れるか、`layout/no-route` 相当の警告で知らせる（黙って一周しない）。

- 層: router（`src/layout/route/router.ts`・`ports.ts`）。互換性: 今まっすぐな経路・段差のある経路は変わらない見込み。変わるのは一周していた経路だけ（作例・fixture・ギャラリーで確かめる。変われば release note）。
- 検証: 再現の `gap` を 40〜200mm で 0.5mm 刻みに描いて交差 0／P1 の 4 桁の anchor ですべてまっすぐ／既存の structured の golden がバイト一致（または差分の説明）。
- 大きさ・リスク: S〜M。リスクは ε の範囲で anchor を動かすことで、別の端と同じ点に重なる場合（`#143` の入りと出の分割と同じ扱いが要る）。

### 3.2 R2: 辺のラベルの背景が常に白い

**実測**: 辺のラベルの背景は辺のスタイルの `fill`（#31 の判断、`src/render/structured.ts` の 634 行付近）で、組み込みの Theme では白。灰色の group（`tone: gray`、`color` の既定の `surface` も）の上では白い四角になる（B の γ・α、C の「scheduled prompt」、[`previews/detail-label-halo.png`](../../research/167-stage-c/previews/detail-label-halo.png)）。

**判断（修正案）**: 背景を「ラベルの箱の下にある最も内側の group の塗り（なければ図の背景）」にする。線を覆い隠すという #31 の目的は保たれる。auto（D2）でも同じ問題が起きうるが、D2 の塗りの扱いを確かめる必要があり、まず structured。

- 層: writer（ラベルの背景の色）、PPTX（編集可能方式の背景）。互換性: group の中に辺のラベルがある structured の図の SVG が変わる（`examples/dit-block` は `color` の `surface` の上に α・γ があるので変わる。意図した変更として golden を更新）。
- 検証: group の塗り（tone あり・なし・入れ子）ごとの背景色の単体テスト、作例の PNG。大きさ: S。

### 3.3 R3: 横から入る残差の線が枠に寄る（color）

**実測**: 図 A の残差（`toAnchor: west`）は、`academic` では group の余白（16 unit）の中央（ブロックと枠からそれぞれ 8 unit）を通るが、`color` では枠から 4 unit（`edge-near-border` info、線の間 0.35mm）。`color` は矢じりが大きく、ルータは矢じりの前に「矢じり＋角の丸め」の直線を空けようとする（#116・設計 §6.26）ので、縦の線が枠側へ押される（原因は推測。ルータのコードでは確かめていない）。余白は Profile の `groupPadding` で固定（YAML では変えられない）。

**判断（修正案）**: 配置エンジンが、横から（余白を通って）入る辺のある側の余白を、Theme の矢じりの長さ＋角の丸め＋間隔の分だけ広げる。または、ルータが溝の中央を優先し、矢じりの直線が足りないときは角を鋭いままにする。前者は図の大きさが変わり、後者は見た目の規則が変わる。方式によっては `color` の structured の golden が変わる（`examples/dit-block` は今 `edge-near-border` 0 件。余白を必要な側だけ広げる方式なら変わらない見込みで、溝の中央を優先する方式なら経路が変わりうる。実装 Issue で確かめる）。

- 層: engine（余白）または router（溝の位置の費用）。検証: A を両テーマで `edge-near-border` 0、作例。大きさ: S〜M。

## 4. 新機能ごとの調査

各項目は「必要（3 図の根拠）」「理想の YAML」「エンジン」「層」「互換性」「検証」「大きさ・リスク」「判断」の順に書く。層の略号は #124 と同じ（schema・IR・engine・router・writer・D2・inspect / lint・PPTX・Skill）。

### 4.1 幅に合わせた縮小（fit to width）

**必要**: B（224mm）・C（230mm）。どちらも唯一の error。原図は文字が小さい（判断: 論文の図の文字は 5〜7pt 程度が多い）。

**試作 P3（実測、`proto/compact.ts`、`results/compact.json`）**: `color` の複製で文字だけを小さくし、`paper-double` の複製で最小の文字を 5pt に下げて描いた（余白・間隔・矢じり・線幅・明示の寸法は同じ）。

| 図 | 文字（ノード / 辺） | 幅 | 180mm に収まるか | 縮小率（180 / 幅） | 縮小後の実効（ノード / 辺 / 添字） |
| --- | --- | --- | --- | --- | --- |
| B | 8 / 7pt（今） | 224.0mm | × | 0.804 | 6.4 / 5.6 / 3.9pt |
| B | 7 / 6.5pt | 202.3mm | × | 0.890 | 6.2 / 5.8 / 4.0pt |
| B | 6 / 5.5pt | 181.5mm | × | 0.992 | 6.0 / 5.5 / 3.8pt |
| C | 8 / 7pt（今） | 229.7mm | × | 0.784 | 6.3 / 5.5 / 3.8pt |
| C | 6 / 5.5pt | 215.9mm | × | 0.834 | 5.0 / 4.6 / 3.2pt |

- **文字を小さくするだけでは収まらない**（C は 6pt でも 215.9mm。画像・セル・キーの明示の寸法、間隔、余白が支配的）。小さい文字の Theme を足す案は、余白・矢じりも縮める設計が要り、効果が読みにくい。
- **縮小（LaTeX の `\includegraphics[width=\textwidth]` と同じ）なら、今の図のまま実効 6.3〜6.4pt**。論文の実務と一致し、作者は配置を変えずに済む。

**理想の YAML（案）**:

```yaml
figure:
  profile: paper-double
  fit: scale          # 幅が上限を超えたら、上限の幅に縮小して出力する（縦横比は保つ）
```

- 出力（SVG の `width` / `height`、PDF のページ、PPTX の画像の大きさ）を上限の幅に縮め、`viewBox` と中身は変えない。`render --json` の `size` に `scale` を足す。
- 文字の大きさの検査（`profile/font-too-small` と幾何 lint）は**縮小後の実効の大きさ**で行う。下限は Profile に `typography.minScaledFontSize`（案）として持つ（値は §10 Q1）。添字（0.7 倍）も検査の対象にする（今は数式の添字の大きさを最小の文字で検査していない、判断）。

**エンジン**: 両方（出力の大きさの問題で、配置とは独立）。**層**: schema（`figure.fit`）、profile（実効の下限）、finalize（`width` / `height`）、PDF（ページの大きさ）、PPTX（画像の物理サイズ）、幾何 lint（`exceeds-page-width` を縮小後で判定、文字の実効サイズ）、`render --json`、Skill。

**互換性**: 任意フィールド。書かない図はバイト単位で同じ。

**検証**: B・C が縮小後に `fits: true`／PDF のページ幅が 180mm／PDF の文字の大きさが実効の値（既存の PDF 構造検査）／`minScaledFontSize` を下回る文字が位置付きの診断／auto の図でも同じ。

**大きさ・リスク**: S〜M。リスクは方針（何 pt まで許すか）で、実装は小さい。

**判断**: 採る（最優先）。下限の値は利用者の判断（§10 Q1）。小さい文字の Theme は採らない（効果が小さい）。

### 4.2 送り元の真上（真横）で入る端（#151 C1）

**必要**: B（B-3）、C（C-15・C-18）、#151 の ViT（13 端を手計算）。今の回避策（SVG の座標から比を計算）は、配置が少し変わると無効になり、丸めると R1 で一周する（§3.1）。

**理想の YAML**:

```yaml
edges:
  - { from: enc0, to: refiner, toAnchor: straight }     # 送り元の中心の真上で入る
  - { from: refiner, to: seq-a5, fromAnchor: straight } # 受け手の中心の真下から出る
```

- 配置の後、経路の前に、送り元の中心を受け手の向かい合う辺に射影し、辺の角から一定（案: 矢じりの半幅）以上内側なら、その位置を anchor にする。外なら中心（`0.5`）にして `layout/straight-off-side`（warning、案。hint: 受け手を広げる・送り元を動かす）。
- `straight` は値の 1 つ（`"south"`・`"south:0.3"` と並ぶ）。辺は書かない（向かい合う辺は配置から決まる）。

**試作 P1（実測、`proto/straight.ts`、`results/straight.json`）**: 製品の配置の後、選んだ辺の anchor を射影の値に置き換えて（IR に直接、小数の丸めなし）、製品のルータで引いた。

| 図（辺の数） | anchor なし（merge） | `fanIn: spread` | 書いたとおり | **straight（正確）** | straight を 4 桁に丸めて YAML に書いた場合 |
| --- | --- | --- | --- | --- | --- |
| C（7） | 1/7 まっすぐ、折れ 23 | 1/7、折れ 20 | 5/7、折れ 7（列幅を固定した版） | **7/7、折れ 0** | 7/7（列幅を固定したので有限小数） |
| B（6） | 0/6、折れ 19 | 0/6、折れ 18 | 0/6、折れ 20 | **3/6、折れ 12**（残り 3 本は射影が辺の外: Patchify・Label が DiT Block・Embed より外側にある） | 0/6、**一周 1**（余分 285 unit） |
| #151 ViT（9） | 0/9、折れ 28 | 0/9、折れ 20 | 1/9（手計算の anchor。0.006〜0.13 unit ずれて小さな段差） | **9/9、折れ 0** | 1/9（ずれ 0.001〜0.02 unit で段差） |

（「まっすぐ」は 0.5 unit 未満の段差を数えない折れの数が 0。[`previews/proto-straight-vit.png`](../../research/167-stage-c/previews/proto-straight-vit.png) は左から spread・手計算・straight。[`proto-straight-dit-4dp-loop.png`](../../research/167-stage-c/previews/proto-straight-dit-4dp-loop.png) は 4 桁で一周した例。）

- 射影が辺の上にある 19 本はすべてまっすぐになり、交差は増えなかった（3 図とも 0）。
- **#151 で手計算した anchor も、v0.5.2 の main で 0.006〜0.13 unit ずれていて、目に見えない大きさの段差（折れ）が残る**（v0.5.1 の時点で同じだったかは未確認）。YAML に書いた比は丸めと配置の変更の影響を受ける。`straight` は配置の後に計算するので古くならない。
- 4 桁の丸めでは R1 が起きる。**`straight` は R1 の修正（§3.1）と一緒に入れる**のが安全（射影の計算でも浮動小数の誤差は 1/1000 unit の丸めの境界に乗りうる）。

**エンジン**: structured のみ（auto は `layout/structured-only`）。**層**: schema（anchor の文法）、IR（`Anchor` に `straight` の種類）、router の端点（`ports.ts`。配置の後・経路の前に解決）、診断、Skill。**互換性**: 新しい値。既存の図は不変。

**検証**: P1 の 3 図（22 本）をテストに（射影が辺の上にある端は折れ 0、外は警告）／同じ受け手に `straight` で入る端が同じ点に重なる場合（2 つの送り元の中心 x が同じ）の扱い（#143 の分割と同じく位置をずらすか、合流）／`fanIn: spread` との併用（`straight` の端は spread の対象外）。

**大きさ・リスク**: S〜M（`ports.ts` 約 60 行、schema、テスト）。リスクは、`straight` を既定（anchor のない端）にするかどうか。既定にすると多くの structured の図の経路が変わる（§10 Q3）。

**判断**: 採る（opt-in の値として）。既定にするかは利用者の判断。

### 4.3 論文向けの色つき Theme（角丸・細い線）

**必要**: A（A-1・A-2・A-4）、B（パネルの面）、C（全体）。3 図の原図はいずれも「パステルの塗り・細い線・角丸のブロック・濃いめの灰色のパネル」。今は `color`（線 1pt・角が鋭い・パネル `#f6f8fa`）か `academic`（細線・単色）。#86 の利用者判断（2026-10-26）で academic は単色のまま。

**理想の YAML**: `theme: paper`（名前は案。§10 Q2）。Theme の値の案: tone は `color` と同じ 8 色、線 0.5〜0.75pt、矢じりは academic と同程度、ノードの `radius` 2pt・group 3pt、group の塗りは `#ececec` 程度で枠線は細い灰色、`muted` の container は破線（academic と同じ）。

**エンジン**: 両方（D2 の `border-radius` は既存の Theme の値から渡せる見込み。auto 側は D2 ソースの golden で確認）。**層**: Theme の定義（`src/core/theme/builtin.ts`）、catalog、gallery（全部品 × variant の見本を追加）、writer（`radius` は既に描ける。`src/render/structured.ts` 234 行）、D2（radius の写像の確認）、幾何 lint（角丸の矩形のラベルの安全領域）、Skill。

**互換性**: 新しい Theme の追加なら既存の golden は不変（gallery に追加）。`color` を変えると `examples/dit-block` などが変わる。

**検証**: gallery、3 図を `paper` で描いた PNG の目視（原図と並べる）、`compatibleProfiles`。

**大きさ・リスク**: S〜M（Theme の値と gallery）。リスクは見た目の合意で、§10 Q2。

**判断**: 採る。新しい Theme にする（既存の Theme を変えない）。

### 4.4 枠のないパネルと破線のパネル（#151 C3、#86 §8 の panel / frame）

**必要**: B（B-6・B-7）、C（C-11・C-16）、#151 の図 2・3。group は必ず枠線を描き、`muted` は Theme によって意味が違う（academic は破線、他は白地）。

**理想の YAML**:

```yaml
groups:
  - { id: ldt, variant: plain, caption: Latent Diffusion Transformer, arrange: { … } } # 枠も塗りもない
  - { id: adaln, variant: filled, tone: gray, caption: DiT Block with adaLN-Zero }      # 塗りだけ（枠線なし）
  - { id: lora, variant: dashed, label: "(c) LoRA inside H3 self-attention", labelAt: top-left }
```

- `plain`: 配置・見出し・キャプションだけ（#86 の `frame`）。`filled`: 塗りだけ。`dashed`: 全 Theme で破線の枠。部品を増やさず container の variant にする（#124 §3.3 で `component: panel` を作らないと判断した延長）。
- 枠のない group でも、ルータは group の境界を今と同じく扱う（境界の通過の費用。経路は変えない）。

**エンジン**: 両方（D2 は `stroke-width: 0`・`fill: transparent`・`stroke-dash` で表せる。確認が要る）。**層**: container の manifest の variant、4 Theme（＋ §4.3）のスタイル、writer（線幅 0 の矩形を描かないか、透明で描く）、inspect（group の矩形を読む。透明の矩形を出せば今の契約のまま）、幾何 lint（`edge-near-border`・`label-collision` の枠の規則を、見えない枠では外す）、PPTX、gallery、Skill。

**互換性**: 新しい variant の追加。既存の golden 不変、gallery に追加。

**検証**: 3 variant × 4 Theme の gallery／見えない枠に辺が沿っても `edge-near-border` が出ない／inspect が group の矩形を読める。

**大きさ・リスク**: M（Theme 4 つ × variant、lint の除外）。リスクは低い。

**判断**: 採る。

### 4.5 拡大の引き出し線（`zoom`）

**必要**: B（B-2、原図の中心的な表現）、C（C-12）。今の代用は角の anchor を使った 2 本の `line` で、直交の折れ線になり、パネルの枠の上を走る。

**理想の YAML**:

```yaml
edges:
  - { from: dit-block, to: adaln, component: zoom }   # 2 本の破線: 対応する角どうしを直線で
```

- 角の組は相対位置から決める（右にあれば 右上 → 左上、右下 → 左下。#86 §4.2 の判断）。経路探索をせず、斜めの直線 2 本。線種は Theme の `zoom` 部品のスタイル（既定は細い破線）。
- ノードを横切る場合は幾何 lint の warning（`geometry/zoom-crosses-node`、案）。避けて曲げると引き出し線として読めない（#86 §4.2）。

**エンジン**: structured のみ（auto は `layout/structured-only`）。**層**: edge の部品（manifest）、router（`zoom` は経路探索の対象外で、ネットにも入れない）、`checkRoutes` と幾何 lint（直交を前提にした規則 `nonOrthogonal`・`edge-through-node` から外し、専用の規則で検査）、writer（斜めの `M/L` は inspect の契約内）、PPTX（編集可能方式は直線 2 本）、legend（見本の線）、Skill。

**互換性**: 新しい部品。gallery に追加。既存は不変。

**検証**: 4 方向の相対位置で角の組が正しい／交差の数え方（`layout/edge-crossing`）から `zoom` を除く／B が引き出し線付きで lint 0。

**大きさ・リスク**: M。リスクは、直交を前提にしたコード（ルータの検査・lint・PPTX のコネクタ）の例外の入れ方。

**判断**: 採る。

### 4.6 データ部品: `tokens`・`matrix`・`keys`（#86 §7・§9.3、#151 C2）

**必要**: C（C-2・C-3・C-4・C-16）、#151 の ViT（位置埋め込みの組 ×5 に 10 ノード）。C の 224 ノードのうち 177（キー 45、行列 81 ＋見出し 19、トークンのセル 32）がこの 3 種で、`lint/empty-label` 90 件は行列とトークンの空のセル。

**理想の YAML**:

```yaml
nodes:
  - id: sequence
    component: tokens                  # 1 行（または 1 列）の小さなセルの並び
    props:
      cellWidth: 20pt
      cells:
        - { id: static, label: Static, width: 36pt }
        - { id: a1, label: '$A_1$', tone: purple }
        - { gap: dotted }              # 区切り（点線）
        - { id: v1, label: '$V_1$', tone: orange }
  - id: mask
    component: matrix                  # 行と列のあるセルの格子
    props:
      rows: [S, '$A_1$', '$A_2$', …]
      columns: [S, '$A_1$', '$A_2$', …]
      cells: ["o...oooo.", "oo..oL...", …]     # 1 行 1 文字列、1 文字 1 セル
      classes:
        o: { tone: green, label: Allowed }
        L: { tone: orange, label: "A↔V Link" }
        ".": { pattern: hatch, label: Masked }
  - id: keys2
    component: keys                    # キーの塊。null は空き。押下中は tone
    props: { rows: [[W, null, null, I, F], [A, S, D, J, K, L]], pressed: [A, S, L], tone: orange }
edges:
  - { from: refiner, to: sequence.a5 }  # セルへの辺: <node>.<cell>
```

**実装の方式（判断）**: legend（#131）と同じく、**検査の後・IR の前に既存の要素へ展開する**。`tokens` は `row`（gap 0）のセルの box、`matrix` は行の `row` の `stack`（見出しは label、セルは box、斜線は §下記）、`keys` は 2 段の `row`。展開した要素の ID は `<node>-<cell>` などの予約した形（`ref/reserved-id`）、端点 `sequence.a5` は展開後の `sequence-a5` に解決する。配置・経路・inspect・幾何 lint・PDF・PPTX の契約は変わらない（C を今の構文で描けたことが、その展開の結果が描けることの実測になっている）。

- 空のセルは展開した要素の印で `lint/empty-label` の対象外にする。
- 斜線（`pattern: hatch`）: SVG の `<pattern>` ではなく、セルの矩形に切った線分として出す（#86 §7、PDF と PPTX の差をなくす）。node の塗りの新しい種類で、Theme の色（斜線の色・間隔）を使う。
- 凡例: `matrix` の `classes` から legend の項目を作る（`legend: true`、案）。今の legend の `node` 見本では斜線を表せないので、legend の見本も `pattern` を受け付ける。
- 見出しの回転（列見出しが長い場合）は §4.7 に依存する。それまでは短い見出しを使う（Skill）。

**エンジン**: structured のみ（展開は木の箱を使う。auto では `layout/structured-only`。legend と同じ）。**層**: 部品の manifest（`props` の JSON Schema）、展開（`src/compiler/` の legend の隣）、端点の文法（schema の端点 ID に `.`）、writer（斜線）、legend、catalog / gallery（legend と同じく structured の見本の生成）、Skill。

**互換性**: 新しい部品と、端点の文法の拡張（今は `.` を含む端点が `schema/invalid-id` なので、通るようになるだけ）。既存は不変。

**検証**: C の 3 種を部品で書き直した図が、今の C と同じ配置（展開の結果が同じなら Layout IR が一致）で `empty-label` 0／セルへの辺／斜線の PDF・PNG・PPTX／`classes` の未使用の項目は `lint/unused-legend-entry` と同じ警告。

**大きさ・リスク**: `tokens` S〜M、`matrix` M（斜線を含む）、`keys` S。リスクは部品の名前と範囲（`keys` は汎用か。§10 Q4）。

**判断**: `tokens` と `matrix` を採る。`keys` は、`matrix` の空きと段のずれでは表せない（W が A と S の間に来る）ので別にする案を推すが、名前と範囲は利用者の判断。

### 4.7 回転した文字（`labelRotation`）

**必要**: C（Visual VAE Encoder、行列の Query）。#86 §5.1 で ±90 に限ると判断済み。

**理想の YAML**: `{ id: vae, component: box, label: Visual VAE Encoder, labelRotation: -90 }`（値は `90` / `-90`）。

**試作 P2（実測、`proto/rotate.ts`、`results/rotate.json`）**: 製品が描いた C の SVG の VAE の文字を、1 行・`transform="rotate(-90 cx cy)"` に置き換えた。

| 検査 | 結果 |
| --- | --- |
| `inspectSvg()` | **拒否**: `svg/unsupported-geometry`（`<text> has a transform`）。置き換える前の SVG は通る |
| `svgToPdf()`（krilla / usvg） | 変換できる（59,409 bytes） |
| `pdftotext -raw` | 「Visual VAE Encoder」が文字として抽出できる |
| `pdffonts` | Type 3 なし（埋め込みの TrueType のまま） |
| 見た目（[`previews/proto-rotate.png`](../../research/167-stage-c/previews/proto-rotate.png)） | 箱の中央に縦に描かれる |

**層**: schema、計測（回転した箱は幅と高さを入れ替える）、engine（大きさ）、writer（`<text>` に `rotate(±90 cx cy)` だけを付ける）、**inspect の契約**（§6.3: `<text>` の transform を拒否している。±90° の回転だけを読み、回転した箱を返す）、幾何 lint（回転した箱で `label-overflow`）、PPTX（編集可能方式は `bodyPr vert="vert270"`、確認が要る）、D2（auto では回転できないので `layout/structured-only`）。

**互換性**: 任意フィールド。既存は不変。

**検証**: ±90 × 1〜3 行で inspect の箱が計測と一致／PDF の抽出／ヘッドレスのブラウザと製品の PDF エンジンで同じ位置（#129 と同じ検証記録）。

**大きさ・リスク**: M。リスクは inspect の契約の拡張（auto の D2 の SVG にも同じ inspect を使う）。

**判断**: 採る（C の表現の中で、他に代用がない）。

### 4.8 辺の色（`edges[].tone`）

**必要**: C（C-13、(c) の橙の辺）。#92 で「edge の tone は段階 C」と後回しにした。

**理想の YAML**: `{ from: lora-in, to: c-add-in, tone: orange }`。線と矢じりを tone の濃い色（Theme に `tones.<tone>.stroke` の辺用の値、案）で描く。単色の Theme では灰色の段（#92 の写像と同じ考え方）。

**エンジン**: 両方（D2 の `stroke`）。**層**: schema、Theme（辺の tone の色。塗りの淡い色は線には薄すぎるので別の値）、writer、D2、legend（見本の `edge.tone`）、Skill。**互換性**: 任意フィールド。既存は不変。**検証**: 4 Theme × 8 tone の gallery、legend の見本。**大きさ**: S〜M。**判断**: 採る（v0.7.0）。

### 4.9 色つきの文字範囲と左揃え（`[text]{tone=…}`、`textAlign`）

**必要**: C（C-6・C-7、プロンプト）。3 図の中では C の 5 つの箱だけ。

**理想の YAML**: `label: "The character [strafes left]{tone=orange},\ncamera [follows him]{tone=blue}"`、`textAlign: left`。

**層**: ラベルの構文（数式の run と同じ仕組みに色の run を足す）、Theme（tone の文字色。塗りの色では読めないので濃い色が要る。§4.8 と共有）、writer（`<tspan fill>`）、inspect（run の `fill`。左揃えは今の契約「中央揃えの `<text>`」を広げる）、幾何 lint（左揃えの箱）、PPTX、Skill。

**互換性**: 今 `[`・`]{` を含むラベルの意味が変わる（例: `[1]{x}`）。`\[` のような逃がしと、`lint` での警告が要る。

**大きさ・リスク**: 色 M、左揃え M（inspect の契約）。**判断**: 採る（v0.7.0）。3 図への効果は C の一部に限られる。

### 4.10 画像の重ね（`layers`）

**必要**: C（C-8、複数フレームの区間 I₁₋₄ など）。

**理想の YAML**: `props: { src: assets/frame-01.jpg, width: 72pt, layers: 4 }`。同じ画像を右上に一定のずらし（Theme の値）で 4 枚重ね、手前ほど上に描く。Sumi は画素を加工しない（#86 §9.4 の範囲内: 同じ画像を複数回置くだけ）。

**層**: image 部品の props、sizing（足跡がずらしの分だけ大きくなる）、writer（同じ data URI を n 回。SVG の大きさが n 倍になるので、PDF 側は krilla が同じ画像を 1 回だけ埋め込むかを確認）、inspect（足跡）、PPTX、Skill。**互換性**: 任意の props。**大きさ**: S〜M。**判断**: 採る（v0.7.0）。

### 4.11 角のバッジと bowtie（#86 §9.3）

**必要**: C（C-9・C-10）。

**理想の YAML**:

```yaml
- { id: lora-in, component: bowtie, label: LoRA, tone: pink, badge: { icon: tabler/flame, corner: north-east, tone: orange } }
```

- `badge`: 角に重ねる小さなアイコン（ノードの外に半分はみ出す）。アイコンの色は `tone`（Tabler は単色なので、tone の濃い色で塗れる）。絵文字（多色）は #86 §6.4 の Fluent Emoji Flat が候補だが、今回の 3 図では単色の flame / snowflake を橙・青で塗れば足りる（§10 Q5）。
- `bowtie`: #52 の outline renderer で、2 つの台形を向かい合わせた形（汎用の名前）。

**層**: `badge` は schema・engine（はみ出しを attach と同じく足跡に）・writer・幾何 lint（バッジと本体の重なりは許す）・D2（auto は #94 のアイコンの合成を流用）。`bowtie` は manifest・outline・gallery。**互換性**: 追加のみ。**大きさ**: badge M、bowtie S。**判断**: 採る（v0.7.0）。

## 5. 試作のまとめ

| 試作 | 目的 | 結論（実測） |
| --- | --- | --- |
| P1 `proto/straight.ts` | 真上で入る端の効果と、丸めの影響 | 射影が辺の上にある 19 本はすべてまっすぐ、交差 0。4 桁の丸めで一周 1・小さな段差多数（R1）。#151 の手計算の anchor にも 0.13 unit までのずれ |
| P2 `proto/rotate.ts` | 回転した文字の出力経路 | PDF で文字のまま（抽出可、Type 3 なし）。inspect が拒否（契約の拡張が要る） |
| P3 `proto/compact.ts` | 幅に収める方法 | 文字を 6pt にしても C は 215.9mm。縮小なら今のまま実効 6.3〜6.4pt |

## 6. #86 §9.2・§9.3、#151 C1〜C7 の評価

効果は「3 図のどれに、どれだけ効くか」（判断）。◎: 図の error か主要な差を消す、○: 目に付く差を消す、△: 細部、—: 3 図では不要。

| 項目 | 出典 | A | B | C | 判断 | Issue（§7） |
| --- | --- | --- | --- | --- | --- | --- |
| 幅に合わせた縮小 | 新規 | — | ◎ | ◎ | 採る | 1 |
| 真上で入る端 | #151 C1 | — | ○ | ○ | 採る | 2 |
| 論文向けの色つき Theme（角丸） | 新規（#86 §11 Q1 の再検討） | ○ | ○ | ○ | 採る | 3 |
| `panel` / `frame`（枠のない・破線の group） | #86 §9.2、#151 C3 | — | ○ | ○ | 採る（variant） | 4 |
| `zoom` | #86 §9.2 | — | ◎ | ○ | 採る | 5 |
| `tokens` | #86 §9.3、#151 C2 | — | — | ◎ | 採る | 6 |
| `matrix`＋斜線の凡例 | #86 §9.3 | — | — | ◎ | 採る | 7 |
| `keys` | #86 §9.3 | — | — | ○ | 判断（§10 Q4） | 8 |
| `labelRotation` | #86 §9.2 | — | — | ○ | 採る | 9 |
| 辺の `tone` | #92 の後回し | — | — | △ | 採る（v0.7.0） | 10 |
| 色つきの文字範囲、`textAlign` | #86 §9.2 | — | — | △ | 採る（v0.7.0） | 11 |
| 画像の `layers` | #86 §9.3 | — | — | △ | 採る（v0.7.0） | 12 |
| `badge`・絵文字、`bowtie` | #86 §9.3 | — | — | △ | 採る（v0.7.0）。絵文字は判断 | 13 |
| `grid`（span） | #86 §9.2、#124 §3.4 | — | — | △（代用できた） | 採る（v0.7.0、利便） | 14 |
| `sublabel` | #86 §9.2 | — | △ | △ | 後回し（2 行目で代用） | — |
| `variant: dim` の継承 | #86 §9.2 | — | △（確度 低） | — | 後回し（原図の確認待ち、§10 Q8） | — |
| 編集可能 PPTX の structured 対応 | #86 §9.2 | — | — | — | 後回し（論文は PDF） | — |
| 構造の中の自由グラフ（ELK） | #86 §9.3 | — | — | — | 後回し | — |
| 繰り返しパネルの recipe | #86 §9.3 | — | △ | △ | 後回し（C の繰り返しは部品で大半が消える） | — |
| MathJax の再評価 | #86 §9.3 | — | — | — | 後回し（3 図の数式は今の部分集合で足りた） | — |
| 要素ごとの `fanIn` | #151 C4 | — | — | — | 後回し | — |
| 見出しの自動配置 | #151 C5 | — | — | — | 後回し（3 図は `top-left` で足りた） | — |
| 上付きと下付きの重ね | #151 C6 | — | — | — | 後回し | — |
| 図を小さく保つ `align` | #151 C7 | — | — | — | 後回し（3 図では拡大が起きなかった） | — |

## 7. Issue 分解

### 7.1 v0.5.3（不具合）

目標: 3 図（`research/167-stage-c/figures/`）で、R1〜R3 の回避策（B の `gap: 3.3mm`、C の列幅の固定）を外しても一周・白い四角・枠への寄りが出ないこと。

- **0-1. fix(route): straighten near-aligned ends instead of looping around the source**（§3.1）
  - 依存: なし。
  - 受け入れ条件: `repro/operator-loop.sumi.yaml` を根の `gap` 40〜200mm（0.5mm 刻み）で描いて交差 0／C の 3・5 回目の anchor（0.1 刻み、4 桁）で一周しない／ずれが ε を超えて隙間に段差が入らない場合は、一周より短い経路か診断／既存の structured の golden がバイト一致（変わる場合は差分を説明）。
  - 非対象: 交差の最小化、`straight`（Issue 2）。
- **0-2. fix(render): give edge labels the background of the group they sit on**（§3.2）
  - 依存: なし。
  - 受け入れ条件: tone あり・なし・入れ子の group の上のラベルの背景がその塗り／`examples/dit-block` の golden を意図した変更として更新／編集可能 PPTX の背景も同じ。
  - 非対象: auto（D2）のラベルの背景（確認のうえ別 Issue）。
- **0-3. fix(layout): leave room for arrowheads entering a member from the group padding**（§3.3）
  - 依存: なし。
  - 受け入れ条件: 図 A を `color` と `academic` で描いて `edge-near-border` 0、残差が余白の中にある／方式（余白を広げる・溝の中央を優先）の選択と golden の差分を Issue に記録。
  - 非対象: 余白を YAML で指定するフィールド。

### 7.2 v0.6.0 — Paper figures stage C

**目標**: 3 図を提案構文で書き直した版（`requires: ">=0.6.0"`）が、error・warning ゼロで描け（info は交差の報告だけ）、SVG / PDF / 画像方式 PPTX が出ること。B・C は `fit: scale` で 180mm に収まり、実効の文字が Q1 で決めた下限以上。**互換性**: すべて Figure v1 への任意フィールド・値・部品・Theme の追加。新しいものを使わない図の D2・SVG・PDF・PPTX はバイト単位で変わらない（v0.5.3 の不具合修正を除く）。各 Issue の受け入れ条件に「既存の生成物は不変、意図した追加をコミットしたうえで `bun run gallery:check` が通る」を含める。

並びは 3 図への効果の大きい順（§6）。

1. **Scale wide figures to the profile width (`figure.fit: scale`)**（§4.1、§10 Q1）
   - 出力を上限の幅に縮め、文字の大きさの検査を縮小後の実効値で行う。`render --json` の `size` に `scale`。
   - 依存: なし。
   - 受け入れ条件: B・C が `fits: true`、PDF のページ幅 180mm、PDF の文字の大きさが実効値／下限未満の文字（数式の添字を含む）が位置付きの診断／auto の図でも同じ／`fit` のない図は不変。
   - 非対象: 配置の自動の詰め・折り返し、小さい文字の Theme。
2. **Enter straight above the source (`toAnchor: straight` / `fromAnchor: straight`)**（§4.2、§10 Q3）
   - 依存: 0-1（丸めの境界で一周しないこと）。
   - 受け入れ条件: P1 の 3 図の 22 本で、射影が辺の上にある端は折れ 0、外は `layout/straight-off-side`（warning）／同じ点に重なる 2 端の扱い／`fanIn: spread` と併用できる。
   - 非対象: 既定の端の規則の変更（Q3 の判断次第で別 Issue）。
3. **Add a paper theme with tone fills, thin lines and rounded corners**（§4.3、§10 Q2）
   - 依存: なし（Issue 4 の variant を全 Theme に入れる際に合わせる）。
   - 受け入れ条件: gallery の全部品 × variant、3 図をこの Theme で描いた PNG を原図の記述と並べた記録、`compatibleProfiles` に paper-*。
   - 非対象: 既存 Theme の変更、利用者定義の Theme。
4. **Add plain, filled and dashed container variants**（§4.4）
   - 依存: なし。
   - 受け入れ条件: 3 variant × 全 Theme の gallery／見えない枠では `edge-near-border`・枠の `label-collision` が出ない／inspect が group の矩形を読む／B の左のパネルを `plain` の group で書け、キャプションが他のパネルと揃う。
   - 非対象: `component: panel`、(a)(b) の自動採番。
5. **Add a zoom edge component for callouts**（§4.5）
   - 依存: なし。
   - 受け入れ条件: 4 方向の相対位置で角の組が正しい／交差の報告・直交の検査の対象外／ノードを横切ると warning／B の引き出し線が lint 0。
   - 非対象: 曲線の引き出し線、auto。
6. **Add a tokens component with cell endpoints (`<node>.<cell>`)**（§4.6）
   - 依存: なし（展開は legend の仕組みを流用）。
   - 受け入れ条件: C・#151 の ViT のトークン列を部品で書き、Layout IR が書き下した版と一致（予約 ID を除く）／セルへの辺／空のセルで `empty-label` が出ない／予約 ID の衝突が位置付きの診断。
   - 非対象: auto、セルの中の改行・画像。
7. **Add a matrix component with classes, hatching and a derived legend**（§4.6）
   - 依存: 6（展開とセルの端点を共有）。
   - 受け入れ条件: C の 9 × 9 行列を部品で書き、`empty-label` 0／斜線が SVG・PDF・画像方式 PPTX で同じ線分／`classes` から作る凡例の見本に斜線／使われない class の警告。
   - 非対象: ヒートマップ（連続値の色）、見出しの回転（Issue 9 の後に追加）。
8. **Add a keycap cluster component**（§4.6、§10 Q4 で名前と範囲を決めてから）
   - 依存: 6。
   - 受け入れ条件: C の 5 つのキーの塊を部品で書け、押下中が tone／文字が枠に接しない（今の手書きでは接する）。
   - 非対象: キーボード全体の配列、記号の刻印。
9. **Rotate labels by ±90° (`labelRotation`)**（§4.7）
   - 依存: なし。
   - 受け入れ条件: inspect が回転した `<text>` の箱を読み、計測と一致／PDF で抽出可（P2 と同じ検査）／`label-overflow` が回転した箱で働く／auto では `layout/structured-only`。
   - 非対象: ±90° 以外、日本語の縦組み（#86 §9.4）。
15. **Teach the Skill the stage-C syntax and redraw the three figures**
   - `references/structured.md`・`figure-format.md`・`layout-tips.md` に 1〜9 と、今回見つかった今の書き方（枠のないパネルの代用、列の `stack` と `align` による表、K・V の anchor、`fit`）を追加。3 図の書き直し版を `research/167-stage-c/` に置き、受け入れの目視の記録を残す。
   - 依存: 1〜9。
   - 受け入れ条件: Skill の作例が CLI の検査を通る／3 図を Skill だけを読んで再現する短い dogfooding（記録を残す）。

### 7.3 v0.7.0 — Paper figures stage C, part 2

10. **Color edges with `tone`**（§4.8）。依存: なし。受け入れ条件: 4 Theme × 8 tone の gallery、legend の見本。非対象: 任意の色の値。
11. **Support tone spans and left-aligned text in labels**（§4.9）。依存: 10（tone の濃い色の値を共有）。受け入れ条件: 色の run が SVG・PDF・PPTX で同じ、`[`・`]{` の逃がしと既存のラベルの警告、inspect が左揃えを読む。非対象: 太字・斜体の範囲、Markdown。
12. **Stack copies of an image (`layers`)**（§4.10）。依存: なし。受け入れ条件: 足跡、PDF の画像の埋め込み回数を記録、PNG。非対象: 画素の加工、別々の画像の重ね（`free` の箱の範囲）。
13. **Add corner badges and a bowtie outline**（§4.11、§10 Q5）。依存: 10（バッジの tone の色）。受け入れ条件: バッジの足跡と lint、bowtie の gallery。非対象: 多色の絵文字（Q5 の判断次第）。
14. **Add a grid arrange box**（#124 §3.4 のまま）。依存: なし。受け入れ条件: #124 の Issue 9 と同じ。C の (a) を `grid` で書き、列の stack と `align` の版と配置が一致。非対象: 行方向の span。

リリースの準備（release note・版・tarball）は、これまでと同じく別の Issue で行う。

## 8. 後回しにする項目

| 項目 | 理由（判断） |
| --- | --- |
| `sublabel` | B・C とも 2 行目で代用でき、`fit: scale` の後は大きさの差も小さい |
| `variant: dim` の継承 | 原図の確度が低い（§1.1）。利用者の確認（Q8）の後 |
| 編集可能 PPTX の structured 対応 | 論文の成果物は PDF。今回の 3 図では使わない |
| 構造の中の自由グラフ（ELK 直接、#57） | 3 図のどれにも不要 |
| 繰り返しパネルの recipe | C の繰り返しの大半（キー・トークン・行列）は部品で消える。残りは列 5 本 × 4 要素 |
| MathJax | 3 図の数式（γ₁,β₁・α₁・Σ・I₁₋₄・A₁ など）は今の部分集合で描けた |
| #151 C4〜C7（要素ごとの `fanIn`、見出しの自動配置、上下付きの重ね、図を小さく保つ `align`） | 3 図では必要にならなかった。#151 の他の図の需要で再評価 |
| 小さい文字の Theme | P3 で効果が小さかった（§4.1） |
| auto（D2）への新機能の展開 | 3 図はすべて structured。`fit` と Theme・variant・辺の tone は両エンジンで効かせる（D2 で表せることの確認を各 Issue で行う） |

## 9. リスク

| リスク | 影響 | 対策 |
| --- | --- | --- |
| `fit: scale` で文字が小さくなりすぎる | 読めない図が「診断ゼロ」で出る | 実効の下限を Profile に持ち、添字も検査する。下限は利用者の判断（Q1） |
| R1 の ε で anchor を動かす | 別の端と重なる・作者の指定とずれる | ε を 0.5pt 程度に限る。#143 と同じ重なりの検査 |
| 新しい Theme の見た目の合意 | 何度も直す | 3 図を描いた PNG を比較の材料にして先に合意する（Q2） |
| データ部品の展開した要素が利用者に見える | 診断のパスに知らない ID | legend と同じく予約 ID と、診断は元の props を指す |
| 回転・左揃え・色の run が inspect の契約を広げる | auto の D2 の SVG の読み取りにも影響 | ±90° の回転と、決まった形の run だけを許す。CI 外でブラウザとの一致を検証記録に |
| 直交を前提にしたコードへの `zoom` の例外 | ルータの検査・lint・PPTX に漏れ | `zoom` をネット・交差・直交の検査から明示的に外すテスト |
| 段階 C が大きい | milestone が長引く | v0.6.0（効果 ◎・○）と v0.7.0（△）に分ける |

## 10. 利用者の判断が必要な点

1. **幅に合わせた縮小と文字の下限（Issue 1）**: `fit: scale` を入れるか。入れる場合、縮小後の実効の文字の下限を何 pt にするか。B・C の今の図は縮小後にノード 6.3〜6.4pt、辺 5.5〜5.6pt、数式の添字 3.8〜3.9pt になる（P3）。案: ノード・辺 5pt、添字は警告（info）にとどめる。入れない場合、B・C は図を分けるか、内容を減らす必要がある。
2. **論文向けの色つき Theme（Issue 3）**: 新しい Theme（名前の案 `paper`）を足すか、`color` を変えるか（golden が変わる）、academic に色を入れるか（2026-10-26 の判断の変更）。角丸を既定にするか。
3. **真上で入る端（Issue 2）**: `straight` を opt-in の値にとどめるか、anchor のない端の既定にするか（既定にすると、射影が辺の上に来る structured の図の経路が変わり、`examples/` の golden も変わりうる）。提案は opt-in。
4. **データ部品の範囲と名前（Issue 6〜8）**: `tokens`・`matrix`・`keys` の 3 部品にするか、`keys` を作らず `matrix` の拡張にするか。`keys` はキーボードの形を前提にするので、汎用の部品の方針（#86 §2.1）に合うか。
5. **バッジの絵文字（Issue 13）**: 単色のアイコン（Tabler）を tone で塗るだけにするか、多色の絵文字のセット（#86 §6.4 の候補 Fluent Emoji Flat、MIT）を同梱するか。
6. **欧文の字形（A-5）**: 論文向けの Theme で、欧文を BIZ UDPGothic のままにするか、欧文用の OFL のサンセリフを font set に足すか（配布サイズが増える）。今回の milestone には入れていない。
7. **milestone の分け方**: v0.5.3（不具合 3）・v0.6.0（9＋Skill）・v0.7.0（5）の 3 つでよいか。v0.6.0 に `keys` を入れるか（Q4 次第）。
8. **原図の確認**: DiT の 3・4 番目のパネルが薄表示か、左のパネルの線に矢じりがないか（§1.1 で確度 低）。原図で確かめてもらえれば、`variant: dim` の要否を決められる。

## 付録: 再現

```sh
bun install --frozen-lockfile
bun research/167-stage-c/gen-c.ts
sh research/167-stage-c/render.sh research/167-stage-c/figures/a-transformer.sumi.yaml
sh research/167-stage-c/render.sh research/167-stage-c/figures/b-dit.sumi.yaml
sh research/167-stage-c/render.sh research/167-stage-c/figures/c-h3world.sumi.yaml
bun src/cli/index.ts lint --geometry research/167-stage-c/repro/operator-loop.sumi.yaml
bun research/167-stage-c/proto/straight.ts --png
bun research/167-stage-c/proto/rotate.ts
bun research/167-stage-c/proto/compact.ts
```

詳細は [研究ディレクトリの README](../../research/167-stage-c/README.md)。
