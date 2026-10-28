# #167 論文図の段階 C の範囲（Transformer・DiT・H3-World の 3 図から）

- 対象: [#167](https://github.com/nishide-dev/sumi-diagram/issues/167)。関連: #80（ロードマップ）、#86（[論文図の調査](86-paper-figures.md)）、#124（[段階 B](124-stage-b.md)）、#151（[v0.5 の dogfooding](../../research/151-dogfood-v0.5/README.md)）
- 調査日: 2026-10-28。環境: macOS 26.2 / arm64、Bun 1.3.14、Sumi の基点 `67a4816`（main、v0.5.2）、製品の WASM エンジン（無変更）、同梱の BIZ UDPGothic 1.051・STIX Two Math / Text Italic 2.13。画像の確認に Poppler 26.04.0、ImageMagick 7.1.2
- 描いた図・試作・再現手順: [`research/167-stage-c/`](../../research/167-stage-c/README.md)。測定値は `results/*.json`、描画の縮小版は `previews/`
- 基準の図（リポジトリには入れない。比較は手元の原図と描いた PNG を並べて行った）: **A** Vaswani et al., arXiv 1706.03762v7, Fig. 1（3 ページ）、**B** Peebles & Xie, arXiv 2212.09748v2, Fig. 3（PDF の 3 ページ）、**C** 利用者自身の図「Figure 3. Overview of H3-World」（未公開。題名以外の文言は引用しない）

本文では、**実測**（CLI・スクリプト・原図の PDF で確かめた値と挙動）と**判断**（それに基づく採否・設計）を分けて書く。判断の段落・表の列には「判断」と明記する。段階 C は **基準の 3 図を論文にそのまま載せられる品質でどこまで再現できるか** を尺度にする。

## 0. 結論

| 図 | 今の構文での到達度（判断） | 原図との主な差（上位） |
| --- | --- | --- |
| A Transformer | **構造・線の取り回し・色の系統は原図とほぼ同じ**。診断は info 5 件だけ | 角丸がない、グループの枠が黒く太くない、残差の線が枠に寄る（不具合 R3）、図が縦に 24% 長い（余白）、字形 |
| B DiT（4 パネル） | **構造は描ける**が、原図の見た目の要素の多くが表せない。幅 257mm（error） | 枠線のない角丸の塗りの箱、3・4 番目のパネルの**薄表示**（今は 53 か所に `variant: muted` を手で付けて近似）、斜めの破線の拡大線、寸法の小さな 2 行目、入力の段差、ラベルの白い背景（R2）、幅と密度 |
| C H3-World | **配置は描ける**（225 ノード・33 辺）が、見た目の要素の大半が表せない。幅 232mm（error）・`lint/empty-label` 90 件 | 枠線のない角丸の塗りのパネルと破線のパネル、**色の枠線で白地の箱**（Encoder・トークン・キー・VAE）、回転した文字、プロンプトの色つき範囲・左揃え、重ねた画像、絵文字のバッジ、bowtie、斜線のセル、色つきの辺、拡大線。加えて書く手間（キー・トークン・行列のセルが 177 ノード） |

1. **原図と並べると、3 図に共通する最大の差は「箱とパネルの描き方」**（§2.5）。A は黒い太い枠の角丸、B・C は**枠線のない角丸の塗り**の箱が基本で、パネルも角丸（B は枠あり、C は枠なしの塗りと破線）。今の Sumi は角が鋭く、box と group は必ず枠線を描く。Theme に `radius` はある（`src/core/theme/style.ts`）が組み込みはすべて 0 で、枠線を消す variant もない。**論文向けの Theme（角丸）と、枠のない塗りの node / group の variant を最上位にする**（§4.1）。
2. **B の薄表示（`variant: dim` の継承）は必要と確定した**（原図の 3・4 番目のパネルは文字・線・枠が灰色で塗りも淡い）。今は 53 か所の `variant: muted` で近似でき、それでも塗りは淡くならず、キャプションは灰色にできない（§4.2）。
3. **段階 C の前に直す不具合が 3 つある**（§3）。R1: 端がほぼ揃っている（ずれが 1 unit 未満）と、短い段差の代わりに送り元の周りを一周する（最小再現は 50mm ずらすと起き、49mm・51mm では起きない）。R2: 辺のラベルの背景が常に辺の `fill`（白）。R3: `color` では横から入る残差の線がグループの枠に 0.35mm まで寄る。
4. **幅の問題は「書き出しの便宜」と「見た目の質（密度）」に分けて扱う**（§4.6）。原図の印刷時の文字は A 約 7.7pt、B 5.4〜8.4pt（ブロック内 6.0pt）、C 約 4.8〜10pt（推定）。Sumi の B・C を幅 180mm に縮めると実効 5.4〜6.2pt で、**文字の読みやすさは原図と同程度**。差は密度で、余白を半分・文字 6pt にしても B は縮めた後に 86mm の高さ（原図は約 68mm）。`fit: scale` は今でも LaTeX の `\includegraphics` でできる縮小を Sumi の検査に乗せる**便宜**で、見た目の質を上げるのは余白・間隔の詰め（compact）の方。**どちらの優先度も、利用者が「縮小後の実効の文字の下限」をどう決めるか次第**（§10 Q1）。
5. **送り元の真上（真横）で入る端（#151 C1）は試作で 3 図の 21 本すべてをまっすぐにした**（§5.1）。ただし YAML に小数で書くと R1 で一周するので、R1 の修正と一緒に入れる。
6. **書く手間と見た目の能力を分けて評価した**（§6）。`tokens` は今でも描ける箱を短く書くための部品（見た目は変わらない）で、`matrix` の斜線、`labelRotation`、色の枠線、色つきの範囲は**今は描けない見た目**。C の原図では色つきの辺・プロンプトの色つき範囲・色の枠線が図全体に効いているので、#86 の当初案より優先度を上げた。
7. **milestone 案**: 不具合 3 件を v0.5.3、段階 C を「v0.6.0 — Paper figures stage C」（見た目の能力 9 件＋Skill）と「v0.7.0 — Paper figures stage C, part 2」（残り 6 件）に分ける（§7）。

## 1. 基準の図と固定した入力

### 1.1 基準の図（実測: 原図を見て確かめた特徴）

| 図 | 印刷時の大きさと文字（実測） | 確かめた見た目の特徴 |
| --- | --- | --- |
| A（arXiv 1706.03762v7, p.3） | 図は 500ppi のラスタ（1520 × 2239px）で、**77.2 × 113.7mm**。文字は 2 行のラベルの行送りから約 7.7pt（推定） | ブロックは**角丸・黒い太い枠**・パステルの塗り（Input/Output Embedding 淡いピンク、Multi-Head Attention 橙、Add & Norm 黄緑、Feed Forward 水色、Linear 薄紫、Softmax 薄緑）。エンコーダとデコーダの枠は**角丸・黒い太い枠・薄灰の塗り**。線は黒く太く、矢じりは小さい。Q・K・V の分岐と残差は角丸の曲がりで、残差は枠の余白の中央を通る。エンコーダの出力は枠の上辺を越えて出て、デコーダの左から入り、中央の Multi-Head Attention の左 2 つの入口へ。Q はデコーダの本線から右へ曲がって右の入口へ。位置エンコーディングは ⊕ より大きい円に正弦波。字形は細いサンセリフ（Helvetica Neue 系） |
| B（arXiv 2212.09748v2, PDF p.3） | ベクター。`pdftotext -tsv` の高さで、左のパネルの文字 **8.4pt**、ブロック内 **6.0pt**、Scale・Input Tokens・Timestep **5.4pt**、寸法「32 x 32 x 4」**7.35pt**、パネルのキャプション **7.2pt**、Σ 14pt。図は幅約 170mm × 高さ約 68mm（キャプションを含む）。字形は Helvetica / Avenir / Arial、数式は Cambria Math | **箱は枠線のない角丸の塗り**（DiT Block だけ白地に黒枠）。左のパネルは枠なしで、線に**矢じりがない**（出力の Noise・Σ への 2 本だけ矢じり）。Noise・Σ・Noised Latent は灰色の箱で、寸法が**小さい 2 行目**（画像ではない）。Timestep *t* と Label *y* は Embed の下に縦に並ぶ小さな青い箱。「N x」は大きい文字。DiT Block の右の 2 つの角から adaLN のパネルの左の 2 つの角へ**斜めの破線**。2〜4 番目のパネルは**角丸の枠**（2 番目は黒い枠と薄灰の塗り）。Input Tokens・Conditioning も箱。3・4 番目のパネルは**薄表示**（文字・線・枠・キャプションが灰色、塗りが淡い）。4 番目の Conditioning は Concatenate に**右から**入る。4 枚のパネルは同じ高さ、キャプションは 1 行 |
| C（利用者の図） | ラスタ（1724 × 1428px）。キャプションの文字を 10pt と仮定した推定で、プロンプト約 4.8pt、Encoder・トークン約 5.5pt、見出し・行列の見出し約 6〜7pt、パネルの題約 10pt（判断: 仮定に依存） | (a)(b) は**枠線のない角丸の淡い塗りのパネル**、(c) は**角丸の破線の枠**で塗りなし。題は太字。(a): フレーム画像は**右上にずらして重ねた複数枚**（I₀ だけ 1 枚）、添字のラベルは画像の右下の角。キー（W・A S D、I F・J K L）は**色の枠線で白地**の小さな角丸（左は橙、右は青）、押下中は塗り＋白文字。プロンプトは淡い灰の角丸で、**左揃え**・**色つきの範囲**（行動は橙、カメラは青）。H3 Encoder は**紫の枠線・白地・紫の太字**。2-Layer Token Refiner は淡い灰の塗りに灰色の文字。Sequence のトークンは**間隔を空けた角丸の白地に色の枠線**（Static 灰、A 紫、V 橙）で、A… と I₀ の間に縦の点線。Visual VAE Encoder は**橙の枠線・白地・回転した橙の太字**。「…」から VAE、VAE から V… への**橙の矢印**。(b): トークンの小さな行、青い淡い塗りのブロック、内側の淡い青の塊に Single Stream Self-Attention（淡い橙）と FFN（灰）、下へ出る矢印。Attention の右の角から (c) へ**斜めの破線**。(c): 間隔を空けた角丸の塗りのトークンの列、**bowtie** の LoRA（淡いピンク）に**🔥の絵文字**、QKV Proj.・Out Proj.（淡い青、**❄の絵文字**）、**橙の塗りに白い＋**の ⊕、**ピンクと青の辺**、9 × 9 の行列（間隔を空けた角丸のセル、緑・橙の塗り、**斜線**の Masked、列見出しが A は紫・V は橙の文字）、**回転した「Query」**と矢印、「Key」と矢印、**破線の角丸の凡例** |

#86 の当初の記述との違い: B の薄表示と矢じりなしは原図どおりで、#86 は正しかった。B の latent は画像ではなく灰色の箱だった（前の版の仮の画像は削除した）。C の基準は #86 の草案ではなく利用者の図であり、配置の構造は草案とほぼ同じだが、見た目の要素（色の枠線・回転・絵文字・重ね・斜線）が草案より多い。

### 1.2 固定した入力

| 対象 | 版 | 確認方法 |
| --- | --- | --- |
| Sumi | `67a4816`（main、v0.5.2） | `bun src/cli/index.ts`（`--version` は 0.5.2）。試作は製品の `src/` を読み取り専用で import |
| D2 | 使わない | 3 図とも structured |
| PDF/PNG エンジン | `assets/wasm/sumi-pdf.wasm` | 製品の `svgToPdf` |
| 原図 | 上記の arXiv 版の PDF、利用者の PNG | `pdfimages -list`（A がラスタであること）、`pdftotext -tsv`（B の文字の高さ）、`pdffonts` |
| 画像 | 自作の仮のフレーム画像 5 点（ImageMagick の plasma、各 2KB 未満） | `research/167-stage-c/figures/assets/` |

## 2. 3 図の再現（実測）

### 2.1 方法

- 現行 main の CLI だけを使い、1 回ごとに `fmt → lint --geometry → render（SVG・PDF）→ pdftoppm（200dpi）→ PNG を Read で見る` を回した（`render.sh`）。細部は 400〜600dpi で切り出した。最後に原図と並べて差を数えた。
- テーマは原図に近い **`color`**。A は `paper-single`、B・C は `paper-double`。
- C はキー・トークン・行列をノードで書き下す必要があり、生成スクリプト（`gen-c.ts`）で書いた。生成物はそのまま CLI に通る普通の YAML である。

| 図 | 手直しの回数 | 最終の診断（error / warning / info） | 大きさ（原図） | YAML | 描画の時間 |
| --- | --- | --- | --- | --- | --- |
| A | 2 | 0 / 0 / 5（`geometry/edge-near-border` ×5） | 86.8 × 140.6mm（77.2 × 113.7mm） | 113 行、ノード 30・group 2、辺 30 | 0.15 秒 |
| B | 7 | 1 / 0 / 0（`geometry/exceeds-page-width`） | 257.0 × 119.9mm（約 170 × 68mm） | 212 行、ノード 55・group 3、辺 60 | 0.18 秒 |
| C | 7 | 1 / 90 / 0（幅 1、`lint/empty-label` 90） | 232.5 × 163.5mm（— ） | 369 行、ノード 225・group 5、辺 33 | 0.35 秒 |

（時間は CLI の起動を含む 3 回の中央値。この環境での目安。）

### 2.2 図 A: Transformer

[`figures/a-transformer.sumi.yaml`](../../research/167-stage-c/figures/a-transformer.sumi.yaml)、[`previews/a-transformer.png`](../../research/167-stage-c/previews/a-transformer.png)。`examples/transformer` を `color` にして始めた。

| 回 | 変更 | 診断 | 見た目 |
| --- | --- | --- | --- |
| 1 | 作例を `color` に | 0 / 0 / 5 | エンコーダの出力（K・V）の幹線の終わり（`south:0.5`）とデコーダの分岐点（中心の hidden junction）が線の太さほどまで近づき、「ʃ」字形に絡む（交差ではないので診断なし）。残差が枠に寄る |
| 2 | K・V を `south:0.2` / `south:0.4`、Q を `south:0.8` に | 0 / 0 / 5 | 絡みが消え、原図と同じ「K・V は左から、Q は本線から右へ」の形になった |

| # | 原図との差 | 分類 | 根拠 |
| --- | --- | --- | --- |
| A-1 | ブロックと枠の角が丸くない | 新機能（Theme、§4.1） | 組み込み Theme の `radius` はすべて 0 |
| A-2 | エンコーダ・デコーダの枠が黒く太くない（`color` は灰色の細い枠） | 新機能（Theme、§4.1） | — |
| A-3 | 残差の線が枠に 0.35mm まで寄り、矢じりの直前で角が鋭くなる。原図は余白の中央 | **不具合 R3**（§3.3） | `edge-near-border` info ×5（`academic` では 0）、[`previews/detail-residual-lane.png`](../../research/167-stage-c/previews/detail-residual-lane.png) |
| A-4 | 図が縦に長い（幅を揃えると高さが原図の約 1.1 倍。絶対値では 140.6 / 113.7mm）。ブロックの上下の余白と間隔が大きい | 新機能（compact、§4.6） | — |
| A-5 | 矢じりが原図より大きい | Theme（§4.1） | — |
| A-6 | 欧文の字形（BIZ UDPGothic。原図は細いサンセリフ） | 判断（§10 Q6） | — |
| A-7 | 作例の anchor だと K・V の幹線が分岐点に接して絡む。近接の lint（#156）も交差の報告も出ない | Skill の不足（今の書き方で直る）。lint の穴（軽微） | 1 回目と 2 回目 |

判断: A は**構造・線の取り回しの不足はない**。差は Theme（A-1・A-2・A-5）、密度（A-4）、不具合 R3 に集まる。

### 2.3 図 B: DiT

[`figures/b-dit.sumi.yaml`](../../research/167-stage-c/figures/b-dit.sumi.yaml)、[`previews/b-dit.png`](../../research/167-stage-c/previews/b-dit.png)。左のパネルは枠がないので group にせず、`stack` と label（キャプション役）で組んだ。

| 回 | 変更 | 診断 | 見た目 |
| --- | --- | --- | --- |
| 1 | 初版（latent を画像にした） | `layout/no-route` 3 | — |
| 2 | 辺を画像から出す | 幅 249.6mm、`layout/edge-crossing` 4 | 4 番目のパネルで ⊕ に入る線と出る線が ⊕ の周りを一周（R1）。辺のラベル γ・α の背景が白い四角（R2）。拡大線は直交の折れ線で、パネルの枠の上を走る |
| 3 | 間隔を詰め、キャプションを 2 行に | 幅 223.1mm、交差 4 | 一周は残る |
| 4 | 4 番目のパネルの入力を入れ子の `stack` に、`align: { x: [noised-img, patchify] }` | 幅 223.1mm、交差 0 | 代わりに画像から Patchify への線が画像の周りを一周（`align` の残差 0.006 unit。R1） |
| 5 | 左のパネルを 2 列の `stack` に組み直す | 幅 223.1mm、**交差 4（一周が再発）** | 図の位置が変わっただけで再発 |
| 6 | 根の `row` の `gap` を 3.3mm に（3mm・3.5mm・4mm では一周し、3.2・3.3・3.4・3.6・3.7mm では起きない） | 幅 224.0mm、交差 0 | — |
| 7 | **原図に合わせた**: latent を灰色の箱に、Timestep・Label を Embed の下に縦に並べた箱に、Input Tokens・Conditioning を箱に、左のパネルの線を `line` に、4 番目の Conditioning を Concatenate の右から、キャプションを 1 行に、3・4 番目のパネルを `variant: muted`（group・node・辺の計 53 か所） | 幅 257.0mm、交差 0 | 最終版 |

| # | 原図との差 | 分類 | 根拠 |
| --- | --- | --- | --- |
| B-1 | 箱に枠線があり角が鋭い（原図は枠線のない角丸の塗り。DiT Block だけ黒枠） | 新機能（node の variant ＋ Theme の角丸、§4.1） | — |
| B-2 | パネルの枠が角丸でない。2 番目の黒い枠、3・4 番目の灰色の枠を選べない | 新機能（§4.1） | — |
| B-3 | 3・4 番目の薄表示: `muted` を 53 か所に書いて、文字・線・枠は灰色になったが、**塗りは淡くならず**（tone の塗りが後勝ち）、キャプションは灰色にできない | 新機能 `variant: dim` の継承（§4.2） | 7 回目 |
| B-4 | 拡大線が角どうしの斜めの破線にならない（直交の折れ線で、下の 1 本はパネルの枠に重なる） | 新機能 `zoom`（§4.3） | 今の代用: `fromAnchor: "east:0"` → `toAnchor: "west:0"` の `line` 2 本 |
| B-5 | 寸法「32 × 32 × 4」が小さい 2 行目にならない（同じ大きさ） | 新機能 `sublabel`（§4.8） | 原図は 8.4pt と 7.35pt |
| B-6 | Patchify・Embed → DiT Block、Linear → Noise・Σ が中央の 1 点で合流して段差になる（原図は各箱の真上・真下へまっすぐ） | 新機能 C1（§4.4） | 試作 P1 |
| B-7 | 辺のラベル（γ₁,β₁・α₁ …）の背景が白く、灰色のパネルの上で白い四角 | **不具合 R2**（§3.2） | [`previews/detail-label-halo.png`](../../research/167-stage-c/previews/detail-label-halo.png) |
| B-8 | ⊕ の周りを線が一周する（根の `gap` で出たり消えたりする） | **不具合 R1**（§3.1） | [`repro/operator-loop.sumi.yaml`](../../research/167-stage-c/repro/operator-loop.sumi.yaml) |
| B-9 | 幅 257mm（原図は約 170mm）。原図の文字は 5.4〜8.4pt、Sumi は 7〜9pt で余白も大きい | 新機能（compact / fit、§4.6）、判断（§10 Q1） | P3 |
| B-10 | 「N x」を大きくできない | 新機能（文字の大きさ。後回し、§8） | — |
| B-11 | パネルの高さを揃える（原図は 4 枚とも同じ高さ） | Skill の不足: 根の `row` を `align: stretch` にすれば、キャプション付きの group も同じ高さに伸びる（7 回目の後で確かめて最終版に反映。group の高さ 629.252 unit で一致） | 最終版 |
| B-12 | 左のパネル（枠なし）は group を使わず `stack` と label で代用した。`stretch` では伸びないので、そのキャプションが他の 3 枚のキャプションと同じ高さに来ない | 新機能（`plain` の group、§4.1）で解消。それまでは Skill に代用と限界を書く | 最終版 |

### 2.4 図 C: H3-World

[`figures/c-h3world.sumi.yaml`](../../research/167-stage-c/figures/c-h3world.sumi.yaml)（`gen-c.ts` が生成）、[`previews/c-h3world.png`](../../research/167-stage-c/previews/c-h3world.png)。

**表のような整列（`grid`）は今の構文で代用できた**: (a) の本体を「列ごとの `stack`（画像・キー・プロンプト・Encoder）を並べた `row`」と、それに `align: stretch` で揃う Refiner とトークン列の `stack` にし、左の見出しの列は `figure.layout.align` の `y` 制約 5 本で各行に揃えた。

| 回 | 変更 | 診断（`empty-label` を除く） | 見た目 |
| --- | --- | --- | --- |
| 1 | 初版（#86 の草案の構造） | `layout/no-route` 8 | — |
| 2 | 間隔を 3mm、I₀ の label を西に、VAE との間を 6mm | 幅 213.4mm、`label-overflow` 4 | — |
| 3 | プロンプトを 4 行に縮め、幅を自動に | 幅 213.4mm、交差 1 | Encoder 2 → Refiner の線が Encoder の周りを一周（`north:0.3` が中心から 0.8 unit ずれる。R1） |
| 4 | 強調をやめ、⊕ に tone、行列のセルを 12pt に | 幅 225.8mm、交差 1、`unused-legend-entry` 1 | 凡例の見本を box に直した |
| 5 | Encoder → Refiner の anchor を SVG の座標から 4 桁で計算（#151 の回避策） | 交差 5 | **5 本すべてが Encoder の周りを一周**（ずれ 0.001〜0.035 unit） |
| 6 | 5 列の幅を 72pt・間隔 10pt に固定（比が有限小数 0.09 … 0.91 になる） | 幅 229.7mm、交差 0 | Encoder → Refiner がまっすぐ |
| 7 | **原図に合わせた**: 右のキーの押下を青、トークンの間隔、(b) の下の出力の矢印、(b) の Attention から (c) への拡大線の代用 | 幅 232.5mm、交差 0 | 最終版。拡大線の代用は (c) の枠の上を縦に走る |

| # | 原図との差 | 分類 | 根拠 |
| --- | --- | --- | --- |
| C-1 | (a)(b) のパネルが枠線のない角丸の塗りにならない。(c) の破線の角丸の枠が `color` では作れない（`muted` は白地・灰色の題） | 新機能（container の variant、§4.1） | catalog の説明 |
| C-2 | **色の枠線で白地の箱**（Encoder 紫、トークン紫・橙・灰、キー橙・青、VAE 橙）が作れない。tone は塗りだけを変える | 新機能（tone の枠線の variant、§4.5） | 7 回目 |
| C-3 | 「Visual VAE Encoder」「Query」を回転できない | 新機能 `labelRotation`（§4.7、試作 P2） | — |
| C-4 | プロンプトの色つきの範囲と左揃え | 新機能（§4.9） | 5 つのプロンプトすべて |
| C-5 | 複数フレームの重ねた画像 | 新機能 `layers`（§4.10） | 4 か所 |
| C-6 | 🔥・❄ の絵文字のバッジ（角に重なる、多色）。今は Tabler の `flame` / `snowflake` を北に `attach`（黒） | 新機能 `badge`（§4.11、§10 Q5） | — |
| C-7 | bowtie の LoRA。`trapezoid` で代用 | 新機能 `bowtie`（§4.11） | — |
| C-8 | 行列: 斜線の Masked、角丸で間隔のあるセル、色つきの列見出し、破線の凡例がない | 新機能 `matrix`（§4.5、§4.9） | — |
| C-9 | 色つきの辺（橙・ピンク・青）、橙の塗りに白い＋の ⊕（今は橙の塗りに黒い＋） | 新機能 辺の `tone`（§4.5） | — |
| C-10 | 拡大線（(b) → (c)）が斜めの破線にならない | `zoom`（§4.3） | 7 回目 |
| C-11 | 画像の添字（I₀ …）を画像の右下の角に置けない（今は下の中央） | 新機能（角への `attach`、§4.11） | — |
| C-12 | Encoder → Refiner、Refiner → A₅、A₃ → Block の真下の線のために、列の幅と間隔を固定する必要 | 新機能 C1（§4.4）＋不具合 R1 | 3〜6 回目 |
| C-13 | キー 45・行列 81 ＋見出し 19・トークン 32 の計 177 ノードを書き下した。`lint/empty-label` 90 件 | 書く手間（`tokens` / `matrix` / `keys`、§4.5） | 生成スクリプト |
| C-14 | 「scheduled prompt」のラベルの背景が白い | 不具合 R2 | — |
| C-15 | A… と I₀ の間の縦の点線、「…」の続き | 軽微（label で近似） | — |
| C-16 | 幅 232mm、文字が原図（約 4.8〜7pt）より大きく余白も大きい | §4.6、§10 Q1 | P3 |
| C-17 | 表の整列（`grid`）| Skill の不足（列の `stack` と `align` で代用できた）。`grid` は利便 | — |

### 2.5 原図と並べて分かったこと（判断）

| 見た目の要素 | A | B | C | 今の Sumi |
| --- | --- | --- | --- | --- |
| 角丸の箱 | ○ | ○ | ○ | なし（radius 0） |
| 枠線のない塗りの箱 | — | ○（ほぼ全部） | ○（多数） | なし |
| 色の枠線で白地の箱 | — | — | ○（Encoder・トークン・キー・VAE） | なし |
| 枠線のない塗りのパネル／角丸の枠のパネル／破線のパネル | 角丸の黒枠 | 角丸の枠 | 塗り・破線 | 角の鋭い枠だけ（academic の `muted` だけ破線） |
| パネル全体の薄表示 | — | ○ | — | 要素ごとの `muted`（塗りは淡くならない） |
| 斜めの破線の拡大線 | — | ○ | ○ | なし |
| 回転した文字 | — | — | ○ | なし |
| 色つきの文字（範囲・見出し） | — | — | ○ | なし |
| 色つきの辺 | — | — | ○ | なし |
| 矢じりのない線 | — | ○ | — | あり（`line`） |
| 小さい 2 行目 | — | ○ | — | なし |
| 重ねた画像・絵文字・bowtie・斜線 | — | — | ○ | なし |

前の版（記憶による比較）は「線の太さ」「データ部品」を重く見ていたが、原図と並べると、**箱とパネルの描き方（角丸・枠の有無・色の枠線）が 3 図すべての見た目を決めている**。A の線は細くなく、`color` の 1pt に近い。

## 3. 不具合（段階 C の前に直す）

### 3.1 R1: ほぼ揃った端で、短い段差の代わりに送り元の周りを一周する

**実測**: [`repro/operator-loop.sumi.yaml`](../../research/167-stage-c/repro/operator-loop.sumi.yaml)（B の 4 番目のパネルを根の `gap` 50mm で右にずらしたもの）で、⊕ に入る線と出る線がそれぞれ ⊕ の周りを一周し、`layout/edge-crossing` が 4 件出る（[`previews/repro-operator-loop.png`](../../research/167-stage-c/previews/repro-operator-loop.png)）。

| 根の `gap` | 40 | 45 | 49 | **50** | 50.5 | 51 | 55〜80 | **170** |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| info（交差） | 0 | 0 | 0 | **4** | 0 | 0 | 0 | **4** |

SVG の経路では、Attention の中心 x が 444.968、⊕ の中心 x が 444.969 で、**0.001 unit** ずれている（stretch した箱の中心と、中央揃えの ⊕ の中心の丸めの違い）。一周した経路は `M 444.968 266.039 L 444.968 257.866 L 422.969 257.866 L 422.969 213.866 L 466.969 213.866 …`。隙間は 2.5mm（約 14 unit）。

同じ形は図 C でも出た: `toAnchor: "north:0.3"` が中心から 0.8 unit ずれて一周（3 回目）、SVG から 4 桁で計算した anchor（ずれ 0.001〜0.035 unit）で 5 本すべてが一周（5 回目）。試作 P1（§5.1）の「4 桁に丸めた anchor」でも C の 2 本が一周した（余分な経路長 175・488 unit）。

**原因（未特定）**: ルータには直線の特別扱いはない（`src/layout/route/router.ts` の冒頭: 向かい合う口の直線は最も安い経路として普通の探索で選ばれる）。端が完全に揃えば直線が選ばれ、わずかにずれると直線がなくなり、狭い隙間では段差（折れ 2 つ）が置けずに一周の方が選ばれている、という観察まで。段差が置けない理由は、端の stub（6 unit）と、矢じりの前に「矢じり＋角の丸め」の直線を空ける規則（#116・#153）が隙間を使い切ることだと推測するが、コードでは確かめていない。

**判断（修正案）**: 原因を特定したうえで、次の 2 つを検討する。(1) 端どうしの横のずれが ε（案: 1 unit = 0.5pt）以下なら、まっすぐに揃える（anchor を辺の上で ε 以内だけ動かす）。(2) 段差が隙間に入らない場合、一周より短い候補（stub や矢じりの前の直線を縮めた段差）を探すか、黙って一周せずに診断を出す。

- 層: router（`router.ts`・`ports.ts`）。互換性: 一周していた経路だけが変わる見込み（作例・fixture・ギャラリーで確かめる）。
- 検証: 再現の `gap` を 40〜200mm で 0.5mm 刻みに描いて交差 0／P1 の 4 桁の anchor で一周しない／既存の structured の golden がバイト一致（または差分の説明）。
- 大きさ・リスク: S〜M。リスクは ε の範囲で anchor を動かすと別の端と同じ点に重なる場合（#143 の入りと出の分割と同じ扱いが要る）。

### 3.2 R2: 辺のラベルの背景が常に白い

**実測**: 辺のラベルの背景は辺のスタイルの `fill`（#31 の判断、`src/render/structured.ts` の 634〜640 行）で、組み込みの Theme では白。灰色の group の上では白い四角になる（B の γ・α、C の「scheduled prompt」）。

**判断（修正案）**: 背景を「ラベルの箱の下に**実際に塗られている**最も内側の色」にする。group の塗りが `transparent` なら（`academic` の group の既定は `transparent`、`src/core/theme/builtin.ts` の 201〜203 行）、その外側の group へ、最後は図の背景（白）までたどる。`transparent` を背景にすると線を隠せなくなる（#31 の目的が失われる）ので、透明は返さない。ラベルの箱が group の境界をまたぐ場合は、箱の中心の位置で決める（またぐこと自体は既存の `label-collision` が報告する）。

- 層: writer（ラベルの背景の色）、PPTX（編集可能方式の背景）。auto（D2）でも同じ問題が起きうるが、D2 の塗りの扱いを確かめてから別 Issue。
- 互換性: group の中に辺のラベルがある structured の図の SVG が変わる（`examples/dit-block` は `color` の group の `surface` の上に α・γ があるので変わる。意図した変更として golden を更新）。
- 検証（受け入れのテスト）: 塗りのある group、tone のある group、**透明な内側の group と色のある外側の group**、透明な group だけの入れ子（図の背景になる）、`academic` の既定の group、境界をまたぐ箱。大きさ: S。

### 3.3 R3: 横から入る残差の線が枠に寄る（color）

**実測**: 図 A の残差（`toAnchor: west`）は、`academic` では group の余白（16 unit）の中央を通るが、`color` では枠から 4 unit（`edge-near-border` info、線の間 0.35mm）。原図の残差は余白の中央。`color` は矢じりが大きく、矢じりの前の直線を空けるために縦の線が枠側へ押されていると推測する（コードでは未確認）。余白は Profile の `groupPadding` で固定。

**判断（修正案）**: 配置エンジンが、横から（余白を通って）入る辺のある側の余白を、Theme の矢じりの長さ＋角の丸め＋間隔の分だけ広げる。または、ルータが溝の中央を優先する。方式によっては `color` の structured の golden が変わる（`examples/dit-block` は今 `edge-near-border` 0 件）。§4.1 の論文向け Theme で矢じりを小さくすると、この問題は Theme 側でも軽くなる。

- 層: engine（余白）または router。検証: A を両テーマで `edge-near-border` 0。大きさ: S〜M。

## 4. 新機能ごとの調査

各項目は「必要（原図の根拠）」「理想の YAML」「エンジン」「層」「互換性」「検証」「大きさ・リスク」「判断」の順に書く。層の略号は #124 と同じ。

### 4.1 論文向けの Theme（角丸）と、枠のない・破線の node / group の variant

**必要**: A（A-1・A-2・A-5）、B（B-1・B-2・B-12）、C（C-1）。§2.5 のとおり 3 図すべての見た目を決める。#151 C3（枠のない panel）も同じ。

**理想の YAML**:

```yaml
figure:
  theme: paper                # 名前は案（§10 Q2）: 角丸、パステルの tone、黒い枠、小さい矢じり
nodes:
  - { id: ln1, component: box, label: Layer Norm, tone: blue, variant: filled }   # 枠線なしの塗り
  - { id: dit-block, component: box, label: DiT Block }                           # 既定は枠あり
groups:
  - { id: ldt, variant: plain, caption: Latent Diffusion Transformer }   # 枠も塗りもない（#86 の frame）
  - { id: build, variant: filled, tone: gray, label: "(a) …", labelAt: top-left }  # 塗りだけ
  - { id: lora, variant: dashed, label: "(c) …", labelAt: top-left }              # 破線の枠、全 Theme で
```

- Theme: `radius`（node 2〜3pt、group 4〜6pt）、tone は `color` と同じ 8 色、枠と線は黒、矢じりは `academic` 程度、group の塗りは淡い灰。
- variant: node の `filled`（枠線なし）、container の `plain` / `filled` / `dashed`。部品を増やさず variant にする（#124 §3.3 で `component: panel` を作らないと判断した延長）。

**エンジン**: 両方（D2 の `border-radius`・`stroke-width: 0`・`stroke-dash` で表せる見込み。各 Issue で確かめる）。**層**: Theme の定義、部品の manifest の variant、catalog / gallery、writer（`radius` は既に描ける。線幅 0 の矩形）、inspect（透明の矩形を出せば今の契約のまま）、幾何 lint（見えない枠では `edge-near-border`・枠の `label-collision` を外す。角丸の矩形のラベルの安全領域）、PPTX、Skill。

**互換性**: 新しい Theme と variant の追加なので既存の golden は不変（gallery に追加）。

**検証**: 全部品 × variant × Theme の gallery／3 図をこの Theme と variant で描いた PNG を原図と並べた記録／見えない枠で lint が出ない。

**大きさ・リスク**: M（Theme・variant・lint の除外）。リスクは見た目の合意（§10 Q2）。

**判断**: 採る（最優先）。Theme と variant は別 Issue にする（variant は既存の Theme にも効く）。

### 4.2 薄表示の継承（`variant: dim`）

**必要**: B（B-3）。原図の 3・4 番目のパネルは文字・線・枠・キャプションが灰色で、塗りも淡い。今は `muted` を group・node・辺の 53 か所に書いて近似し、それでも塗りは tone のまま濃く、キャプションは灰色にならない。

**理想の YAML**: `groups: [ { id: cross, variant: dim, caption: DiT Block with Cross-Attention } ]`。子孫の node・辺・キャプション・ラベルの色を Theme の dim 用の色に置き換える（#86 §8: 透明度ではなく Theme が色を持つ）。tone の塗りは淡い版にする。

**エンジン**: 両方。**層**: Theme の解決（祖先の variant を合成する規則。今は要素ごと）、Theme の値（dim 用の文字・線・枠と、tone の淡い塗り）、展開した要素（キャプション・凡例）への伝播、PPTX、Skill。**互換性**: 新しい variant。既存は不変。**検証**: B を `dim` 1 か所で書いて、今の 53 か所の版より原図に近い（塗りが淡い、キャプションが灰色）／入れ子の dim／tone ごとの淡い塗りのコントラスト。**大きさ・リスク**: M（Theme の解決の順序に「祖先から」を足す）。

**判断**: 採る（前の版の「後回し」を改める）。

### 4.3 拡大の引き出し線（`zoom`）

**必要**: B（B-4）、C（C-10）。どちらの原図も、対応する角どうしを結ぶ斜めの破線 2 本。

**理想の YAML**: `{ from: dit-block, to: adaln, component: zoom }`。角の組は相対位置から決める（#86 §4.2）。経路探索をせず斜めの直線 2 本、線種は Theme の `zoom` のスタイル（既定は破線）。ノードを横切ると幾何 lint の warning（案 `geometry/zoom-crosses-node`）。

**エンジン**: structured のみ。**層**: edge の部品、router（`zoom` は探索・ネット・交差の報告の対象外）、`checkRoutes` と幾何 lint（直交を前提にした規則から外し、専用の規則）、writer、PPTX、legend、Skill。**互換性**: 新しい部品。**検証**: 4 方向の相対位置で角の組が正しい／B・C の拡大線が lint 0。**大きさ・リスク**: M。直交を前提にしたコードへの例外の入れ方。

**判断**: 採る。

### 4.4 送り元の真上（真横）で入る端（#151 C1）

**必要**: B（B-6）、C（C-12）、#151 の ViT（13 端を手計算）。原図の B では Patchify・Embed が DiT Block に、Linear が Noise・Σ に、それぞれ真上・真下でつながる。

**理想の YAML**:

```yaml
edges:
  - { from: enc0, to: refiner, toAnchor: straight }     # 送り元の中心の真上で入る
  - { from: refiner, to: seq-a5, fromAnchor: straight } # 受け手の中心の真下から出る
```

配置の後・経路の前に、送り元の中心を受け手の向かい合う辺に射影し、辺の角から一定以上内側ならその位置を anchor にする。外なら中心にして `layout/straight-off-side`（warning、案）。

**試作 P1**: §5.1。射影が辺の上にある **21 本すべてがまっすぐ**、交差 0。4 桁に丸めて YAML に書くと C の 2 本が一周（R1）。

**エンジン**: structured のみ。**層**: schema（anchor の文法）、IR、router の端点（`ports.ts`）、診断、Skill。**互換性**: 新しい値。**検証**: P1 の 3 図の 21 本／同じ点に重なる 2 端／`fanIn: spread` との併用。**大きさ・リスク**: S〜M。既定にするかは §10 Q3。

**判断**: 採る（opt-in の値として、R1 の修正の後に）。

### 4.5 tone の枠線・辺の色（見た目）と、データ部品（書く手間）

ここは**見た目の能力**と**書く手間**を分けて評価する（レビューの指摘）。

**見た目の能力（今は描けない）**:

- **tone の枠線の variant**（例 `variant: outlined`: 白地に tone の濃い色の枠線と文字）。C の Encoder・トークン・キー・VAE、行列の列見出しの色。tone は今は塗りだけを変える（#92）。
- **辺の `tone`**: C の橙・ピンク・青の辺。#92 で段階 C に後回しにした項目。
- **斜線の塗り（`pattern: hatch`）**: C の行列の Masked と凡例。SVG の `<pattern>` ではなく線分で出す（#86 §7）。

```yaml
- { id: enc0, component: box, label: H3 Encoder, tone: purple, variant: outlined }
- { from: lora-in, to: c-add-in, tone: pink }
```

層: Theme（tone ごとの濃い色。塗りの淡い色は線・文字には薄すぎるので別の値）、schema（辺の `tone`）、writer、D2（auto は `stroke` で表せる）、legend の見本、Skill。互換性: 追加のみ。大きさ: M。判断: 採る（v0.6.0）。C の原図では図全体に効く（§2.5）。

**書く手間（今でも描けるが冗長）**: `tokens`（1 行のセル）、`matrix`（行列、上の斜線と凡例を含む）、`keys`（キーの塊）。

```yaml
- id: sequence
  component: tokens
  props:
    gap: 1.5pt
    cells:
      - { id: static, label: Static, width: 36pt, tone: gray }
      - { id: a1, label: '$A_1$', tone: purple }
      - { separator: dotted }
- id: mask
  component: matrix
  props:
    rows: [Static, '$A_1$', …]
    columns: [Static, '$A_1$', …]
    cells: ["o...oooo.", …]
    classes:
      o: { tone: green, label: Allowed }
      L: { tone: orange, label: "A↔V Link" }
      ".": { pattern: hatch, label: Masked }
edges:
  - { from: refiner, to: sequence.a5 }   # セルへの辺: <node>.<cell>
```

実装（判断）: legend（#131）と同じく、検査の後・IR の前に既存の要素へ展開する。セルは予約 ID（`<node>-<cell>`）の box になり、端点 `sequence.a5` はそれに解決する。配置・経路・inspect・幾何 lint・PDF・PPTX の契約は変わらない（今回 C を書き下して描けたことが、展開の結果が描けることの実測）。空のセルは展開した要素の印で `lint/empty-label` の対象外にする。

**評価（判断）**: `tokens` と `keys` は C の 177 ノードの大半を数個の部品にし、`empty-label` の 90 件を消すが、**それだけでは見た目は変わらない**（受け入れ条件も「書き下した版と同じ Layout IR」）。見た目が原図に近づくのは、上の tone の枠線（トークン・キー）と斜線（行列）による。したがって優先度は「tone の枠線・辺の色・斜線」を v0.6.0、`tokens` / `matrix` を v0.6.0 の後半（書く手間。LLM が 177 ノードを誤りなく書くのは現実的でない）、`keys` は利用者の判断（§10 Q4）とする。

### 4.6 幅・密度・縮小（`fit: scale` と compact）

**必要**: B（幅 257mm）、C（232mm）、A（縦に長い）。

**原図の印刷時の文字（§1.1）**: A 約 7.7pt、B 5.4〜8.4pt（ブロック内 6.0pt、Scale・入力 5.4pt）、C 約 4.8〜10pt（推定）。3 図とも Profile の最小 7pt を下回る文字を使っている。

**試作 P3（実測、`proto/compact.ts`、`results/compact.json`）**: `color` の複製で文字を小さくし、Profile の複製で最小を 5pt に下げ、さらに node と group の余白を半分にした複製（compact）でも描いた。

| 図 | 文字（ノード / 辺）・余白 | 幅 × 高さ | 180mm に縮めた後の高さ | 縮小後の実効（ノード / 辺 / 添字） |
| --- | --- | --- | --- | --- |
| B | 8 / 7pt（今） | 257.0 × 119.9mm | 84.0mm | 5.6 / 4.9 / 3.4pt |
| B | 6 / 5.5pt | 213.3 × 106.5mm | 89.9mm | 5.1 / 4.6 / 3.2pt |
| B | 6 / 5.5pt・余白半分 | 188.4 × 90.3mm | 86.3mm | 5.7 / 5.3 / 3.7pt |
| C | 8 / 7pt（今） | 232.5 × 163.5mm | 126.6mm | 6.2 / 5.4 / 3.8pt |
| C | 6 / 5.5pt・余白半分 | 200.0 × 130.2mm | 117.1mm | 5.4 / 4.9 / 3.5pt |

（原図 B は約 170 × 68mm。）

**読み取り（判断）**:

- **読みやすさ（文字の大きさ）**: 今の B・C を 180mm に縮めると実効 5.4〜6.2pt で、原図のブロック内の文字（B 5.4〜6.0pt、C 約 4.8〜5.5pt）と同程度。文字の大きさだけを見れば、縮小で原図並みになる。辺のラベル（4.9〜5.4pt）と添字（3.4〜3.8pt）は原図より小さいかもしれない（B の数式の大きさは測れていない）。
- **見た目の質（密度）**: 縮めても B の高さは 84〜90mm で、原図（約 68mm）より 25〜30% 高い。余白を半分にしても変わらない（間隔 `gap` と、1 行の箱の高さが効いている）。原図並みの密度には、余白・間隔・箱の高さを Theme / Profile の単位で詰める必要がある。
- **今できること**: Sumi の SVG / PDF は幅超過の error（exit 1）でも書き出されるので、LaTeX の `\includegraphics[width=\textwidth]` で縮めて載せることは**今でもできる**。足りないのは、(1) その使い方を error にしない（意図した縮小を宣言できない）、(2) 縮小後の実効の文字を検査しない、の 2 点。

**選択肢**:

| 案 | 内容 | 効くもの |
| --- | --- | --- |
| (a) 今のまま＋LaTeX で縮小 | 利用者が error を無視して縮める | 何も変えない。検査が実態と合わない |
| (b) `fit: scale` | `figure.fit: scale` で出力を上限の幅に縮め、文字の検査を縮小後の実効値で行う（下限は Profile に持つ） | 書き出しの便宜と検査の正しさ。見た目は (a) と同じ |
| (c) compact な余白・間隔 | 論文向けの Theme / Profile に、小さい文字・余白・間隔・箱の高さの組を持つ | 密度（見た目の質）。原図に近い |
| (d) 7pt を守って組み直す | パネルを 2 段に、内容を分ける | 文字は大きいが、原図の 1 段 4 パネルは再現できない |

**判断**: (b) と (c) は独立で、優先度は**利用者が「縮小後の実効の文字の下限」をどう決めるか（§10 Q1）次第**。下限を原図並み（5pt 前後）にするなら、(b) は小さく（S〜M）すぐ効き、(c) は見た目の質のための本命（M）。7pt を守るなら (b) は意味が小さく、(c) も 7pt の範囲での詰めになり、B・C は (d) になる。

### 4.7 回転した文字（`labelRotation`）

**必要**: C（C-3、Visual VAE Encoder、Query）。#86 §5.1 で ±90 に限ると判断済み。

**理想の YAML**: `{ id: vae, component: box, label: Visual VAE Encoder, labelRotation: -90 }`。

**試作 P2（実測、`proto/rotate.ts`、`results/rotate.json`）**: 製品が描いた C の SVG の VAE の文字を 1 行・`transform="rotate(-90 cx cy)"` に置き換えた。`inspectSvg()` は拒否（`svg/unsupported-geometry`: `<text> has a transform`）、`svgToPdf()` は変換でき（59,588 bytes）、`pdftotext` で文字のまま抽出でき、Type 3 なし。見た目は [`previews/proto-rotate.png`](../../research/167-stage-c/previews/proto-rotate.png)。

**層**: schema、計測（幅と高さの入れ替え）、engine、writer、**inspect の契約**（±90° の回転だけを読む）、幾何 lint、PPTX（`bodyPr vert="vert270"`、要確認）、auto は `layout/structured-only`。**互換性**: 任意フィールド。**大きさ・リスク**: M（inspect の契約の拡張は auto の D2 の SVG の読み取りにも関わる）。**判断**: 採る。

### 4.8 小さい 2 行目（`sublabel`）

**必要**: B（B-5）。原図の Noise・Σ・Noised Latent は、名前（8.4pt）の下に寸法（7.35pt）。

**理想の YAML**: `{ id: noise, component: box, label: Noise, sublabel: "32 × 32 × 4", tone: gray }`。Theme の小さい文字の大きさ（`size.small`）で、ラベルの下の行に描く。

**層**: schema、計測（2 つの大きさの行）、writer（行ごとの font-size）、inspect（行ごとの大きさ。今は `<text>` 単位で 1 つの大きさ）、幾何 lint、PPTX、D2（auto は `|md|` を使わないなら structured のみ）。**大きさ・リスク**: S〜M（inspect の行ごとの大きさ）。**判断**: 採る（v0.6.0 の後半）。前の版の「後回し」を改める（原図で寸法が小さい 2 行目だと確かめたため）。

### 4.9 色つきの文字範囲と左揃え

**必要**: C（C-4、5 つのプロンプトすべて、行列の列見出しの色）。

**文法（判断: 既存の図の意味を変えない）**: 前の版の Pandoc 風の `[text]{tone=orange}` は、今有効なラベル（`[1]{x}` など）の意味を変えるので採らない。代わりに**今は error になる文法だけを使う**: 数式の部分集合（structured のみ）に TeX の `\textcolor{<tone>}{…}` を足し、平文は `\text{…}` で包む。

```yaml
label: 'The character $\textcolor{orange}{\text{walks backward}}$, camera $\textcolor{blue}{\text{pans right}}$'
textAlign: left
```

- `\textcolor` は今 `component/invalid-math`（未知のコマンド）なので、**今描ける図の出力も診断も変わらない**。色の名前は tone に限る（色の値は書かない）。
- 書きにくさ（`$…\text{…}$` の入れ子）は Skill で例を示す。平文の簡略記法は、需要が出たら opt-in のフィールド（例 `labelFormat: rich`）として別に検討する。
- `textAlign: left` は新しいフィールドで互換性の問題はない。ただし inspect の契約（中央揃えの `<text>`）を広げる。

**層**: ラベルの構文（数式の run に色）、Theme（tone の文字色、§4.5 と共有）、writer（`<tspan fill>`）、inspect（run の `fill`、左揃え）、PPTX、Skill。**大きさ・リスク**: 色 M、左揃え M。**判断**: 採る（v0.7.0。§4.5 の濃い色の値に依存）。

### 4.10 画像の重ね（`layers`）

**必要**: C（C-5、4 か所）。原図は同じ大きさのフレームを右上にずらして 3〜4 枚重ねる。

**理想の YAML**: `props: { src: assets/frame-01.jpg, width: 72pt, layers: 4 }`。同じ画像を Theme のずらしで重ねる（画素は加工しない。#86 §9.4 の範囲内）。原図のように別々のフレームを重ねる場合は `srcs: [...]`（案）。

**層**: image の props、sizing、writer（同じ data URI を n 回。PDF の埋め込みの回数を確認）、inspect、PPTX。**大きさ**: S〜M。**判断**: 採る（v0.7.0）。

### 4.11 角のバッジ、角への `attach`、bowtie

**必要**: C（C-6・C-7・C-11）。

```yaml
- { id: lora-in, component: bowtie, label: LoRA, tone: pink, badge: { icon: emoji/fire, corner: north-east } }
- { id: frame0-label, component: label, label: '$I_0$', attach: { to: frame0, side: south-east } }
```

- `badge`: 角に重ねる小さなアイコン。原図は**多色の絵文字**（🔥・❄）。単色の Tabler を tone で塗る案と、絵文字のセット（#86 §6.4 の Fluent Emoji Flat、MIT）を同梱する案がある（§10 Q5）。
- 角への `attach`: `side` に角（`north-east` など）を許す。
- `bowtie`: #52 の outline renderer で、2 つの台形を向かい合わせた汎用の形。

**層**: schema・engine（足跡）・writer・幾何 lint（バッジと本体の重なりは許す）・D2（#94 のアイコンの合成）・アセット（絵文字）。**大きさ**: badge M、角の attach S、bowtie S。**判断**: 採る（v0.7.0）。

## 5. 試作のまとめ

| 試作 | 目的 | 結論（実測） |
| --- | --- | --- |
| P1 `proto/straight.ts` | 真上で入る端の効果と、丸めの影響 | 3 図の 21 本（C 7、B 5、ViT 9）すべてがまっすぐ、交差 0。4 桁の丸めで C の 2 本が一周（[`previews/proto-straight-4dp-loop.png`](../../research/167-stage-c/previews/proto-straight-4dp-loop.png)）、B・ViT は小さな段差。#151 の手計算の anchor にも 0.13 unit までのずれ |
| P2 `proto/rotate.ts` | 回転した文字の出力経路 | PDF で文字のまま（抽出可、Type 3 なし）。inspect が拒否 |
| P3 `proto/compact.ts` | 幅と密度 | 縮小で実効 5.4〜6.2pt（原図と同程度）。密度は余白を半分にしても原図より 25〜30% 低い |

### 5.1 P1 の詳細

製品の配置の後、選んだ辺の anchor を射影の値に置き換えて（IR に直接、小数の丸めなし）、製品のルータで引いた。

| 図（辺の数） | anchor なし | `fanIn: spread` | 書いたとおり | **straight（正確）** | 4 桁に丸めて YAML に書いた場合 |
| --- | --- | --- | --- | --- | --- |
| C（7） | 1/7 まっすぐ、折れ 24 | 1/7、折れ 22 | 5/7、折れ 8（列幅を固定した版） | **7/7、折れ 0** | 5/7、**一周 2** |
| B（5） | 3/5、折れ 4 | 3/5、折れ 4 | 3/5、折れ 4 | **5/5、折れ 0** | 3/5、折れ 2（0.01 unit の段差） |
| #151 ViT（9） | 0/9、折れ 28 | 0/9、折れ 20 | 1/9（手計算。0.006〜0.13 unit ずれ） | **9/9、折れ 0** | 1/9（0.001〜0.02 unit の段差） |

（「まっすぐ」は 0.5 unit 未満の線分を除いた折れの数が 0。[`previews/proto-straight-vit.png`](../../research/167-stage-c/previews/proto-straight-vit.png) は左から spread・手計算・straight。）

## 6. 評価の一覧（#86 §9.2・§9.3、#151 C1〜C7、新規）

「見た目」は原図にある要素で今の Sumi が描けないものを埋めるか（◎: 3 図の複数で目立つ、○: 1 図で目立つ、△: 細部、—: 効かない）。「手間」は今でも描けるが書く量・誤りを減らすか。判断は両方と、依存・大きさから。

| 項目 | 出典 | 見た目（A / B / C） | 手間 | 判断 | Issue（§7） |
| --- | --- | --- | --- | --- | --- |
| 論文向け Theme（角丸・黒い枠・小さい矢じり） | 新規 | ◎（○ / ○ / ○） | — | 採る | 1 |
| 枠のない塗りの node、`plain` / `filled` / `dashed` の group | #86 §9.2、#151 C3 | ◎（— / ○ / ○） | — | 採る | 2 |
| `variant: dim` の継承 | #86 §9.2 | ○（B） | ○（53 か所 → 2） | 採る | 3 |
| `zoom` | #86 §9.2 | ◎（B・C） | — | 採る | 4 |
| tone の枠線・辺の `tone` | #92 の後回し、新規 | ○（C 全体） | — | 採る | 5 |
| `labelRotation` | #86 §9.2 | ○（C） | — | 採る | 6 |
| 真上で入る端 | #151 C1 | ○（B・C の段差） | ○（anchor の手計算をなくす） | 採る | 7 |
| `matrix`（斜線・凡例） | #86 §9.3 | ○（C の斜線） | ◎（100 ノード） | 採る | 8 |
| `tokens` | #86 §9.3、#151 C2 | —（見た目は同じ） | ◎（32 ノード、`empty-label`） | 採る | 9 |
| compact な余白・間隔 / `fit: scale` | 新規 | 密度 ○ / 書き出し — | — | Q1 次第 | 10 / 11 |
| `sublabel` | #86 §9.2 | △（B） | — | 採る | 12 |
| 色つきの文字範囲・`textAlign` | #86 §9.2 | ○（C の全プロンプト） | — | 採る（v0.7.0） | 13 |
| 画像の `layers` | #86 §9.3 | ○（C） | — | 採る（v0.7.0） | 14 |
| `badge`・角への attach・`bowtie` | #86 §9.3 | △〜○（C） | — | 採る（v0.7.0）。絵文字は Q5 | 15 |
| `keys` | #86 §9.3 | —（tone の枠線で足りる） | ○（45 ノード） | Q4 | 16 |
| `grid`（span） | #86 §9.2、#124 §3.4 | — | △（代用できた） | 採る（v0.7.0、利便） | 17 |
| 編集可能 PPTX の structured 対応 | #86 §9.2 | — | — | 後回し | — |
| 構造の中の自由グラフ（ELK）、recipe、MathJax | #86 §9.3 | — | △ | 後回し | — |
| #151 C4〜C7 | #151 | — | — | 後回し（3 図で不要） | — |

前の版からの主な変更（判断）: 原図で確かめた結果、**Theme・variant・dim・tone の枠線・回転が上がり**、`tokens` は「手間」の項目として見た目の項目の後に、`sublabel` と `dim` は後回しから採るへ、`fit: scale` は Q1 に条件付けた。

## 7. Issue 分解

### 7.1 v0.5.3（不具合）

目標: 3 図で、R1〜R3 の回避策（B の `gap: 3.3mm`、C の列幅の固定）を外しても一周・白い四角・枠への寄りが出ないこと。

- **0-1. fix(route): stop looping around the source when ends are almost aligned**（§3.1）
  - 依存: なし。
  - 受け入れ条件: 原因を特定して Issue に記録／`repro/operator-loop.sumi.yaml` を根の `gap` 40〜200mm（0.5mm 刻み）で描いて交差 0／C の 3・5 回目の anchor と P1 の 4 桁の anchor で一周しない／段差が隙間に入らない場合は一周より短い経路か診断／既存の structured の golden がバイト一致（変わる場合は差分を説明）。
  - 非対象: 交差の最小化、`straight`。
- **0-2. fix(render): give edge labels the painted background beneath them**（§3.2）
  - 依存: なし。
  - 受け入れ条件: 塗りのある group・tone のある group・透明な内側と色のある外側・透明だけの入れ子・`academic` の既定の group・境界をまたぐ箱の各テスト／透明を背景に使わない／`examples/dit-block` の golden を意図した変更として更新／編集可能 PPTX も同じ。
  - 非対象: auto（D2）のラベルの背景（確認のうえ別 Issue）。
- **0-3. fix(layout): leave room for arrowheads entering a member from the group padding**（§3.3）
  - 依存: なし。
  - 受け入れ条件: 図 A を `color` と `academic` で描いて `edge-near-border` 0、残差が余白の中にある／方式と golden の差分を Issue に記録。
  - 非対象: 余白を YAML で指定するフィールド。

### 7.2 v0.6.0 — Paper figures stage C

**目標**: 3 図を提案構文で書き直した版（`requires: ">=0.6.0"`）が、error・warning ゼロで描け、原図と並べた記録で §2.5 の表の要素（重ね・絵文字・色つきの範囲・bowtie を除く）が再現できていること。B・C の幅は Q1 の決定に従う。**互換性**: すべて Figure v1 への任意フィールド・値・部品・Theme の追加。新しいものを使わない図の D2・SVG・PDF・PPTX はバイト単位で変わらない（v0.5.3 の修正を除く）。各 Issue の受け入れ条件に「既存の生成物は不変、意図した追加をコミットしたうえで `bun run gallery:check` が通る」を含める。

並びは見た目への効果の大きい順（§6）。10・11 は Q1 次第で順位が動く。

1. **Add a paper theme with rounded corners, tone fills and small arrowheads**（§4.1、§10 Q2）
   - 依存: なし。受け入れ条件: gallery の全部品 × variant／3 図を描いた PNG を原図と並べた記録／`compatibleProfiles` に paper-*。非対象: 既存 Theme の変更、利用者定義の Theme。
2. **Add borderless node variants and plain, filled and dashed container variants**（§4.1）
   - 依存: なし（1 の値を Theme ごとに定義）。受け入れ条件: 全 Theme × variant の gallery／見えない枠で `edge-near-border`・枠の `label-collision` が出ない／inspect が group の矩形を読む／B の左のパネルを `plain` の group で書け、キャプションが他と揃う。非対象: `component: panel`、(a)(b) の自動採番。
3. **Dim a group and everything inside it (`variant: dim`)**（§4.2）
   - 依存: 2（container の variant の追加と同じ場所）。受け入れ条件: B の 3・4 番目のパネルを `dim` 2 か所で書き、文字・線・枠・キャプションが灰色、塗りが淡い／入れ子／展開した要素（キャプション・凡例）にも効く。非対象: 透明度による薄表示。
4. **Add a zoom edge component for callouts**（§4.3）
   - 依存: なし。受け入れ条件: 4 方向で角の組が正しい／交差の報告・直交の検査の対象外／ノードを横切ると warning／B・C の拡大線が lint 0。非対象: 曲線、auto。
5. **Add outlined tone variants and tone on edges**（§4.5）
   - 依存: 1（tone の濃い色の値）。受け入れ条件: 全 Theme × 8 tone の gallery（枠線の node と辺）／legend の見本／C の Encoder・トークン・キー・VAE・辺が原図の色の配置で描ける。非対象: 任意の色の値。
6. **Rotate labels by ±90° (`labelRotation`)**（§4.7）
   - 依存: なし。受け入れ条件: inspect が回転した `<text>` の箱を読み計測と一致／PDF で抽出可／`label-overflow` が回転した箱で働く／auto は `layout/structured-only`。非対象: ±90° 以外、縦組み。
7. **Enter straight above the source (`toAnchor: straight` / `fromAnchor: straight`)**（§4.4、§10 Q3）
   - 依存: 0-1。受け入れ条件: P1 の 21 本で折れ 0、射影が辺の外なら `layout/straight-off-side`／同じ点に重なる 2 端の扱い／`fanIn: spread` と併用。非対象: 既定の端の規則の変更（Q3 次第で別 Issue）。
8. **Add a matrix component with classes, hatching and a derived legend**（§4.5）
   - 依存: 5（列見出しの色）、9 と展開を共有。受け入れ条件: C の行列を部品で書き `empty-label` 0／斜線が SVG・PDF・画像方式 PPTX で同じ線分／`classes` から作る凡例に斜線／使われない class の警告。非対象: 連続値のヒートマップ。
9. **Add a tokens component with cell endpoints (`<node>.<cell>`)**（§4.5）
   - 依存: なし（legend の展開を流用）。受け入れ条件: C・ViT のトークン列を部品で書き、Layout IR が書き下した版と一致（予約 ID を除く）／セルへの辺／`empty-label` が出ない。非対象: auto、セルの中の画像。
10. **Add compact spacing for paper themes**（§4.6、Q1 次第）
    - 依存: 1。受け入れ条件: B を compact で描いて、縮小後の高さと原図の比を記録（目標は Q1 で決める）／既存 Theme・Profile は不変。非対象: 自動の詰め・折り返し。
11. **Scale wide figures to the profile width (`figure.fit: scale`)**（§4.6、Q1 次第）
    - 依存: なし。受け入れ条件: B・C が `fits: true`、PDF のページ幅が上限、文字の検査が実効値（添字を含む）／auto でも同じ／`fit` のない図は不変。非対象: 配置の変更。
12. **Draw a smaller second line (`sublabel`)**（§4.8）
    - 依存: なし。受け入れ条件: B の Noise・Σ・Noised Latent が 2 つの大きさで描け、inspect と幾何 lint が行ごとの大きさを読む。非対象: 3 段以上の大きさ。
18. **Teach the Skill the stage-C syntax and redraw the three figures**
    - 依存: 1〜12。受け入れ条件: Skill の作例が CLI の検査を通る／3 図の書き直し版と原図を並べた記録（`research/167-stage-c/`）／今回見つけた今の書き方（K・V の anchor、列の `stack` と `align` による表、キャプション付きの group の高さ）を追記。

### 7.3 v0.7.0 — Paper figures stage C, part 2

13. **Color spans with `\textcolor` and left-aligned labels**（§4.9）。依存: 5。受け入れ条件: 色の run が SVG・PDF・PPTX で同じ／今描ける図の出力・診断が不変（`\textcolor` は今 error）／inspect が左揃えを読む。非対象: 平文の簡略記法、太字・斜体の範囲。
14. **Stack copies of an image (`layers`)**（§4.10）。依存: なし。受け入れ条件: 足跡、PDF の画像の埋め込み回数を記録。非対象: 画素の加工。
15. **Add corner badges, corner attachments and a bowtie outline**（§4.11、§10 Q5）。依存: 5。受け入れ条件: バッジの足跡と lint、角への attach、bowtie の gallery。非対象: Q5 で採らない側。
16. **Add a keycap cluster component**（Q4 次第）。依存: 5・9。
17. **Add a grid arrange box**（#124 §3.4 のまま）。依存: なし。受け入れ条件: C の (a) を `grid` で書き、今の版と配置が一致。

リリースの準備は、これまでと同じく別の Issue で行う。

## 8. 後回しにする項目

| 項目 | 理由（判断） |
| --- | --- |
| 文字の大きさの指定（B の大きい「N x」） | 1 か所。Theme の範囲（設計 §4.3）を外れる |
| 編集可能 PPTX の structured 対応 | 論文の成果物は PDF |
| 構造の中の自由グラフ（ELK、#57） | 3 図のどれにも不要 |
| 繰り返しパネルの recipe | C の繰り返しの大半は部品で消える |
| MathJax | 3 図の数式は今の部分集合で描けた |
| #151 C4〜C7 | 3 図では必要にならなかった |
| 欧文の字形 | Q6 の判断次第（配布サイズ） |
| auto（D2）への新機能の展開 | 3 図はすべて structured。Theme・variant・辺の tone・`fit` は両エンジンで効かせる（各 Issue で D2 を確認） |

## 9. リスク

| リスク | 影響 | 対策 |
| --- | --- | --- |
| 縮小で文字が小さくなりすぎる | 読めない図が診断ゼロで出る | 実効の下限を Profile に持ち、添字も検査する（Q1） |
| 新しい Theme と variant の見た目の合意 | 何度も直す | 3 図を描いた PNG と原図の比較を材料に先に合意する（Q2） |
| `dim` の継承が Theme の解決順を変える | 既存の図の色 | `dim` を書いた group の子孫だけに効かせ、既存の解決は変えない |
| R1 の ε で anchor を動かす | 別の端と重なる | ε を 0.5pt 程度に限り、#143 と同じ検査 |
| 回転・左揃え・行ごとの大きさ・色の run が inspect の契約を広げる | auto の SVG の読み取りにも影響 | 決まった形だけを許し、CI 外でブラウザとの一致を記録 |
| `zoom` の例外 | 直交を前提にしたコードに漏れ | ネット・交差・直交の検査から明示的に外すテスト |
| 段階 C が大きい | milestone が長引く | v0.6.0（見た目の上位）と v0.7.0 に分ける |

## 10. 利用者の判断が必要な点

1. **縮小後の実効の文字の下限（Issue 10・11 の順位）**: 原図の文字は A 約 7.7pt、B 5.4〜8.4pt（ブロック内 6.0pt）、C 約 4.8〜10pt（推定）で、3 図とも Profile の最小 7pt を下回る文字を使っている。Sumi の B・C を 180mm に縮めると実効はノード 5.4〜6.2pt、辺 4.9〜5.4pt、添字 3.4〜3.8pt。選択肢は、(i) 下限を原図並み（例 5pt）にして縮小を認める（`fit: scale` は S〜M ですぐ効き、密度は compact で詰める）、(ii) 7pt を守る（B・C は 2 段などに組み直す。`fit` の意味は小さい）、(iii) 今のまま（LaTeX で縮めるときは error を無視する）。どれを選ぶかで Issue 10・11 の要否と順位が決まる。
2. **論文向けの Theme（Issue 1）**: 新しい Theme（名前の案 `paper`）を足すか、`color` を変えるか（golden が変わる）、`academic` に色と角丸を入れるか（2026-10-26 の判断の変更）。
3. **真上で入る端（Issue 7）**: `straight` を opt-in の値にとどめるか（提案）、anchor のない端の既定にするか（射影が辺の上に来る structured の図の経路と golden が変わりうる）。
4. **キーの部品（Issue 16）**: `keys` を作るか。tone の枠線（Issue 5）があれば今の書き下しでも見た目は原図に近づき、残るのは書く手間（45 ノード）。キーボードの形を前提にした部品が汎用の部品の方針（#86 §2.1）に合うか。
5. **絵文字（Issue 15）**: 原図は多色の絵文字。単色の Tabler を tone で塗るだけにするか、絵文字のセット（#86 §6.4 の候補 Fluent Emoji Flat、MIT）を同梱するか。
6. **欧文の字形**: 原図は 3 図ともサンセリフ（Helvetica 系・Arial・Avenir）。論文向けの Theme で BIZ UDPGothic のままにするか、欧文用の OFL のサンセリフを font set に足すか（配布サイズが増える）。
7. **milestone の分け方**: v0.5.3（不具合 3）・v0.6.0（12＋Skill）・v0.7.0（5）でよいか。v0.6.0 が大きい場合、10〜12 を v0.7.0 へ移すか。

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

原図との比較には、上記の arXiv 版の PDF と利用者の図を手元に用意する（リポジトリには入れない）。詳細は [研究ディレクトリの README](../../research/167-stage-c/README.md)。
