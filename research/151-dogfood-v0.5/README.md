# #151 v0.5.1 を典型的な論文図で使ってみた記録（dogfooding）

[Issue #151](https://github.com/nishide-dev/sumi-diagram/issues/151)。関連: #80（ロードマップ）、#86（論文図の調査）、#109（v0.4.0 の dogfooding、[記録](../109-dogfood-v0.4/README.md)）、#124（段階 B）、#146（v0.5.0）、#149（v0.5.1）。製品の src・schema・examples・golden・テストは変更しない。

## 方法

- **使ったもの**: 公開版 v0.5.1 の release tarball（`sumi-0.5.1-darwin-arm64.tar.gz`）。リポジトリの外の空のディレクトリに `gh release download` で取得し、`SHA256SUMS` と照合（`77d1c328…a74363`、一致）してから展開した。`sumi --version` = `0.5.1`、`sumi doctor` は Ready（D2 v0.9.0 同梱、フォント 5 点 sha256 一致）。このバイナリだけを使った。
- **描く間に読んだもの**: Skill（`skills/sumi/SKILL.md` と `references/*.md`）、`sumi --help`、`sumi catalog`、CLI の診断だけ。#109 の図 3 の YAML は「内容の仕様」としてだけ見た。`src/` は 4 図を描き終えてから、不具合か設計かを分けるためにだけ読んだ（その箇所は「src 確認」と書く）。`docs/design`・`docs/research` は読んでいない。
- **作業**: 作業用ディレクトリ（リポジトリの外）で、1 回ごとに `fmt → lint --geometry → render（SVG）→ render（PDF）→ pdftoppm -r 300 -png` を回し、PNG を Read で見て直した。1 図あたり最大 8 回まで。気になる所は ImageMagick で切り出して拡大し、座標は SVG を見て確かめた。
- **所要時間**: エージェントの実時間（壁時計）。#109 の「体感」とは単位が違うので比べない。

## 成果物

| パス | 内容 |
| --- | --- |
| `figures/vit-input.sumi.yaml` | 図 1: ViT の入力部（画像 → patch → 線形射影 → トークン列＋位置埋め込み → エンコーダ → MLP Head）。structured、`color`、`paper-single` |
| `figures/image.png`、`patch-0.png`〜`patch-3.png` | 図 1 用に自作した仮の画像（ImageMagick の plasma を 2×2 に切ったもの。5〜20KB） |
| `figures/dit-block.sumi.yaml` | 図 2: DiT ブロック（adaLN-Zero、`\hat{\epsilon}_\theta`、凡例、キャプション）。structured、`color`、`paper-single` |
| `figures/se-comparison.sumi.yaml` | 図 3: 2 panel の比較（(a) Residual block /(b) SE-Residual block）。structured、`academic`、`paper-single` |
| `figures/serving-architecture.sumi.yaml` | 図 4: #109 の図 3 を v0.5.1 の段階 B の機能で描き直したもの。structured、`color`、`paper-double` |
| `repro/*.sumi.yaml` | 不具合・分かりにくい挙動の最小再現（下の (a)） |
| `previews/*.png` | 最終版の PDF を 200dpi でラスタ化したもの（各 100KB 未満）と再現の画像 |

4 図とも `requires: ">=0.5.1"` を付けた（Skill の figure-format.md が `requires` を説明している。fan-in の修正 #148 が 0.5.1 なので 0.5.1 とした）。

再現: リポジトリのルートで `cd research/151-dogfood-v0.5 && sumi lint --geometry figures/*.sumi.yaml`（v0.5.1。4 図とも 0 errors / 0 warnings。図 4 だけ `layout/edge-crossing` の info が 4 件）。PDF は `sumi render <file> -o <file>.pdf`。

## 結果の概要

| 図 | 手直しの回数 | 最終の診断 | 大きさ | 判定 | 時間（実時間） |
| --- | --- | --- | --- | --- | --- |
| 1 ViT の入力部 | 5 | 0 / 0 / 0 | 84.5 × 70.7mm | 可（まっすぐな線のために SVG から座標を読んで anchor を手計算した） | 4 分 |
| 2 DiT ブロック | 8（上限） | 0 / 0 / 0 | 82.9 × 153.3mm | ほぼ可（ブロックの見出しを諦めた、panel の枠、右下の空き） | 5 分 |
| 3 2 panel の比較 | 5 | 0 / 0 / 0 | 80.3 × 108.7mm | 可（panel の枠は消せない） | 2 分 |
| 4 システム構成図（描き直し） | 6 | 0 / 0 / 4 info | 159.6 × 125.8mm | 可（v0.4 より手間が減り、見た目は同程度〜やや良い） | 3 分 |

（診断は errors / warnings / infos。）4 図とも structured。#109 の A1（PDF の数式の字体）・A3（hint が engine を見ない）・B5（アクセント）は直っていた: PDF でも `x_{\mathrm{cls}}`・`\hat{\epsilon}_\theta`・`\tilde{y}`・`L\times` の斜体・立体が SVG と同じで、`exceeds-page-width` の hint は structured 向け（「一番広い `row` を `stack` に」）になった。

診断が 0 になっても見た目の問題は残った。今回の主な問題は、**診断の出ない見た目の崩れ**（S 字の迂回、キャプションを避ける迂回、図が黙って大きくなる、線がグループの枠に重なる）と、**まっすぐな線を引く手段の不足**（図 1・4）だった。

## 図ごとの記録

### 図 1: ViT の入力部（structured、5 回）

下から: 画像 →（split）→ 4 つの patch → Linear Projection of Flattened Patches → トークン列（位置埋め込み `0`〜`4` と `$x_{\mathrm{cls}}$`、`$x_p^i E$` の組）→ Transformer Encoder（`$L\times$`）→ MLP Head → Class。

| 回 | 変更 | 診断 | 見た目 |
| --- | --- | --- | --- |
| 1 | 初版（`fanIn: spread`、トークンは 1 つの `row`） | `label-collision` 1 件（「split」が画像に重なる） | spread の入口が送り元の真上にならず、トークン → Encoder の 5 本、patch → Projection の 4 本すべてに段差ができる（C1）。Encoder がトークン列より狭い |
| 2 | 根の stack を `align: stretch`、位置埋め込みを `gap: 0` の組で追加、画像の `gap` 12mm | `exceeds-page-width` 96.5mm（hint は structured 向けで的確） | 幅を揃えても spread の入口は辺の上に**等間隔**に並ぶだけで、段差は消えない。MLP Head まで横に伸びる |
| 3 | 位置埋め込みに `width: 12pt`、行の `gap` 1.5mm、Head を `align: center` の stack に | 0 / 0 | 段差はそのまま |
| 4 | SVG から各ノードの x を読み、`toAnchor: "south:0.1116"` などの比を手計算して 13 本に付けた | 0 / 0 | すべてまっすぐ（C1 の回避） |
| 5 | `fanIn` を外し、`$L\times$` を Encoder の東に `attach` | 0 / 0 | 可 |

残った問題: まっすぐな縦線のために SVG の座標から anchor の比を手で計算した（ラベルや `gap` を変えるとやり直し。C1）／トークン列（位置埋め込みと埋め込みの組 ×5）に 10 ノード・5 つの `row`・`width` の指定が要る（C2）／`$x_p^1$` の添字が縦に重ならず横に並ぶ（Skill に書いてあるとおり。C6）。

### 図 2: DiT ブロック（structured、8 回・上限）

左に DiT Block（Layer Norm → Scale, Shift `$\gamma_1,\,\beta_1$` → Multi-Head Self-Attention → Scale `$\alpha_1$` → ⊕、同じものをもう 1 段、残差 2 本）、右に timestep / label → Embed → MLP、MLP から 4 つの Scale / Shift へ破線の共有幹線。出力は `$\hat{\epsilon}_\theta,\ \Sigma_\theta$`、凡例とキャプション。

| 回 | 変更 | 診断 | 見た目 |
| --- | --- | --- | --- |
| 1 | 初版（ブロックの group に `label` と `caption`、凡例は下） | `exceeds-page-width` 111.5mm、`long-label`（caption 47 桁）、`edge-crosses-label`（出力の辺がブロックの見出しを横切る）、`label-collision`（`$c$` が Embed に重なる） | **下から入る `z_t` の辺が、ブロックの下にあるキャプションを避けて左へ大きく回り込み、枠の外から入る**。診断なし（A3） |
| 2 | 見出しを `DiT Block` + `labelAt: top-left`、キャプションは全体を包む group `panel` に移動、長いラベルを 2 行に、`$c$` に `labelSide: right` | `edge-label-overlap` + `label-collision`（`$c$` と Embed。`gap` 4mm では足りない） | **`'Scale, Shift\n$\gamma_1,\,\beta_1$'` の `\n` がそのまま「\n」と描かれた**。単一引用符では `\n` は改行にならない。診断なし（A4）。出力の辺が見出し「DiT Block」を避けて左に曲がる |
| 3 | ラベルを二重引用符（`\\gamma`）に、`labelAt: top-right`、Embed–MLP の `gap` 6mm、panel を `variant: muted` | 0 / 0 | 見出しは右上でも幅がブロックの半分ほどあり、出力の辺がまだ迂回して「D」に接する。診断なし（Skill には書いてある。A6）。破線の共有幹線の分岐が「›」の印のように見える（A8） |
| 4 | ブロックの見出しを削除（キャプションが名前を言う） | 0 / 0 | 出力の辺はまっすぐ |
| 5 | 凡例を右の列（MLP の下）へ、凡例の文を短く | 0 / 0、135.5mm | **⊕ → hidden junction の 1 本が、まっすぐのはずなのに S 字に迂回する**（A1） |
| 6 | その辺に `toAnchor: south` | 0 / 0 | 変わらない。junction の anchor は黙って無視される（A5） |
| 7 | 凡例を右の列の上へ | 0 / 0 | S 字は残る |
| 8 | 凡例を 4 回目と同じ位置（行の下）に戻す | 0 / 0、153.3mm | S 字が消える。可 |

残った問題: ブロックの見出しを付けられなかった（A6・C5）／論文の panel は枠なしが普通だが、group は必ず枠が付く（`muted` でも枠。C3）／右下に空き。凡例 `entries` の `edge` サンプル・`\hat{\epsilon}_\theta` のアクセント・`labelSide` は期待どおり動いた。

### 図 3: 2 panel の比較（structured、5 回）

(a) Residual block（3×3 Conv, BN, ReLU → 3×3 Conv, BN → ⊕ → ReLU、identity の残差）と (b) SE-Residual block（(a) に Global Pool → FC + ReLU → FC + Sigmoid → ⊗ を追加）を横に並べ、入力 `$x$` と ⊕ の高さを `align` で揃えた。SE の部分は `emphasis`、凡例に `node` の見本。

| 回 | 変更 | 診断 | 見た目 |
| --- | --- | --- | --- |
| 1 | 初版（2 つの group に `caption`、`align` 2 本、凡例 `variant: plain`） | `exceeds-page-width` 94.7mm | `align` で両 panel の `x` と ⊕ が揃った。良い |
| 2 | Conv のラベルを 2 行に、panel 間の `gap` 4mm | `edge-label-overlap`（identity のラベルが自分の線に重なる） | — |
| 3 | identity に `labelAt: middle, labelSide: right`、(a) を `variant: muted` | 0 / 0 | ラベルは良い位置に。**`academic` の `muted` の container は破線の枠**になった（意味のある破線と紛らわしい。A7） |
| 4 | `muted` を戻し、(b) の identity にも同じ指定 | 0 / 0 | (b) では identity が Global Pool の矢じりのすぐ上に置かれ、SE の分岐のラベルに読める。診断なし（A9） |
| 5 | (b) のラベルを削除 | 0 / 0 | 可 |

残った問題: panel の枠を消せない（C3）。それ以外は段階 B の機能（`caption`・`align`・`labelAt` / `labelSide`・凡例の `node` 見本）で素直に描けた。

### 図 4: システム構成図の描き直し（structured、6 回）

内容は #109 の図 3 と同じ（Clients 3 → API gateway → Inference / Training / Auth、Job queue、Workers（GPU pool: Inference / Training、Preprocess）、Storage 4 つ、辺 18 本）。#109 の最終版は、見出しを `attach` の label で代用し、ワーカー → ストアの 10 端に `fromAnchor` / `toAnchor` を手で付けていた。今回は段階 B の機能で置き換えた。

| 回 | 変更 | 診断 | 見た目 |
| --- | --- | --- | --- |
| 1 | 初版: 見出しは全部 `label` + `labelAt`、`fanIn: spread`、anchor なし、gRPC に `labelAt: start, labelSide: left` | 0 / 0 / 6 info | gRPC の辺が gateway の分岐と交差し遠回り。ワーカー → ストアが絡む。「GPU pool」（`bottom`）の見出しの脇を辺がかすめる（診断なし） |
| 2 | API の stack を Training / Auth / Inference の順に、`align: { x: [infer-api, infer-worker] }` | 0 / 0 / 4 info | gRPC がまっすぐ（`align` の効果）。ただし GPU pool の左に空き。**Python SDK → gateway の線が API tier と Workers の枠線の上を走る**（拡大で確認、診断なし。A6）。spread で 3 本が 1〜2px 間隔で平行に並ぶ |
| 3 | Clients をまとめる hidden junction を根の row に置く、GPU pool を `top-left` | 0 / 0 / 5 info | junction が row の中央にあり、線が junction の下まで垂れて折り返す |
| 4 | junction を stack に包み、`align: { y: [client-join, gateway] }` | 0 / 0 / 5 info、**188.4mm**（前回 125.8mm） | **ML platform の上に約 60mm の空白**ができた。junction を動かす代わりに gateway 側を押し下げた。診断なし（A2） |
| 5 | junction と y の `align` をやめ、Clients の 3 本を同じ `toAnchor: west` に | 0 / 0 / 4 info、125.8mm | 3 本が 1 本の幹線で gateway に入る。可 |
| 6 | 比較のため `fanIn` を既定（`merge`）に | 0 / 0 / 1 info | 交差の数は減るが、Feature store へ 3 本がほぼ重なって並び、Auth → Metadata DB が Auth の周りを回る。**5 回目に戻して最終版とした** |

#### v0.4（#109）との比較

| 観点 | #109（v0.4.0、8 回） | 今回（v0.5.1、6 回） |
| --- | --- | --- |
| グループの見出し | 入れ子の見出しを外して `attach` の label で代用（2 つ） | 6 つとも `label` + `labelAt`。代用なし |
| ワーカー → ストアの anchor | 10 端を手で指定 | なし（`fanIn: spread`）。手で付けた anchor は Clients の `west` 3 つだけ |
| gRPC | 遠回りし、ラベルがグループの枠線に乗る（#109 A9） | `align` でまっすぐ、ラベルは送り元の脇 |
| 交差（info） | 4（v0.5.1 で #109 の YAML を描くと 4） | 4 |
| 大きさ | 159.6 × 119.4mm | 159.6 × 125.8mm |
| 残る問題 | 交差・遠回り | Storage の上に矢じり 8 本が密集、GPU pool の左の空き（`align` の副作用）、Clients の線と枠線の近さ |

判定: **書く手間ははっきり減り、見た目は同程度〜やや良い**。見出しの代用と anchor の手計算がなくなったのが大きい。一方で `fanIn` が図全体で 1 つしか選べず（Clients は merge、ワーカー → ストアは spread にしたかった。C4）、`align` が図を黙って大きくすることがある（A2）。

## 診断ごとの評価

| コード | 出た図 | 役に立ったか |
| --- | --- | --- |
| `geometry/exceeds-page-width` | 1, 2, 3 | 良い。hint が structured 向けになった（#109 A3 の解消）。`paper-single` の図に「wider profile (paper-double)」とも言うが、条件付きの選択肢として妥当 |
| `geometry/edge-crosses-label` | 2 | 良い。hint が `labelAt` を勧め、そのとおり直せた（ただし見出しが広いと直らない。A6） |
| `geometry/label-collision` | 1, 2 | 正確 |
| `layout/edge-label-overlap` | 2, 3 | 良い。どの指定（`labelSide: right`）が原因か、次に何を試すかが分かる |
| `lint/long-label` | 2 | 「the caption of group "block"」と場所を言い、分かりやすい |
| `layout/edge-crossing`（info） | 4 | 位置と相手の辺が分かり、gRPC を直すきっかけになった。ただし 1 件ごとに 400 字ほどの同じ hint が繰り返され、6 件で画面が埋まる（A10） |
| （出なかったもの） | 1〜4 | S 字の迂回（A1）、`align` による拡大（A2）、キャプションを避ける迂回（A3）、文字どおりの `\n`（A4）、junction の anchor の無視（A5）、枠線の上の線・見出しをかすめる線（A6） |

## 分類

### (a) すぐ直す（v0.5.x）: 不具合・分かりにくい診断・Skill の不足

| # | 内容 | 頻度 | 種類 | 根拠（src 確認） |
| --- | --- | --- | --- | --- |
| A1 | **⊕ からすぐ上の hidden junction へのまっすぐな線が、S 字に迂回して junction に西から入る**。v0.5.1 で要素を 1 つずつ消して確かめた（下の「A1 の切り分け」）。隣の列に `legend` があり、その上に別のノード（`MLP`）が並ぶときに起きる。凡例・`MLP`・`Feedforward` のどれかを消す、または凡例を `MLP` の上に置くとまっすぐになる。凡例と `MLP` に辺がなくても起き、MLP からの破線の辺（初版の記述）や残差の辺は条件ではない | 図 2（5〜7 回目） | 不具合 | `repro/junction-detour.sumi.yaml`（最小化した再現）、`previews/repro-junction-detour.png`。SVG の経路は `M 82 168.7 L 82 159.3 L 74 159.3 L 74 154.0 L 82 154.0`（同じ x への寄り道）。原因は未特定。凡例の見本の線は hidden junction 2 つ（`key-1-start` / `-end`）を結ぶ辺として描かれ、junction の端は向きを持たない（`src/layout/route/ports.ts` 927 行 `junction: true, dir: -1`）ので、凡例の junction と本文の junction の扱い（ネットの結合・経路探索の順序）が疑わしい |
| A2 | **`figure.layout.align` が図を黙って大きくする**。単独の stack に入れた junction と、入れ子の group の中の gateway を `y` で揃えると、gateway の枝の上に空きを足して押し下げ、図 4 では 125.8 → 188.4mm、再現では 89.96 → 126.82mm になった（再現の SVG で、junction の中心 y は 254.854 → 359.363、gateway の上端 y は 133.339 → 342.357 units。junction も図の中央寄せで下がる）。制約は満たされるので診断は出ない | 図 4（4 回目） | 分かりにくい（挙動は設計どおり） | `repro/align-grows-figure.sumi.yaml`、`previews/repro-align-grows-figure.png`。src 確認: junction を上げる手段はある。`trail` の strut は入れ子の stack の自然な大きさに含まれる（`src/layout/structured/engine.ts` 304〜333 行付近）ので、中央寄せでも単独の項目は上がり、`align.ts` も `trail` の候補を評価している（174〜177 行）。ただし候補は残差の合計だけで比べ、同じ残差なら先の候補（上の項目の前の `lead`）を残す（209〜212 行）。中央寄せではどちらの候補も 1 回で差の半分しか縮まず残差が並ぶため、毎回 `lead` が選ばれて図が伸びる。原因は「残差だけの選択と同点の扱い」で、図の大きさを見ないこと。少なくとも「align で高さが X mm 増えた」という info と、Skill への注意書きが要る |
| A3 | **下から入る辺が group の `caption` を避けて大きく回り込む**。キャプションは group の下に固定で、ルータはそれを障害物として扱う。診断なし | 図 2（1 回目） | 分かりにくい（挙動は設計どおり）・Skill の不足 | `repro/caption-blocks-input.sumi.yaml`、`previews/repro-caption-blocks-input.png`。src 確認: キャプションは `captionOf` を持つ label ノードに展開され（`src/compiler/ir.ts` 414 行）、ルータは配置済みのノードをすべて障害物にする（`src/layout/route/router.ts` 744 行 `#obstacles = layout.nodes…`）ので、キャプションも避ける対象になる。Skill（structured.md）は「位置は固定」と書くが、下から入る辺がある group には付けるな、とは書いていない |
| A4 | **単一引用符のラベルで `\n` が改行にならず「\n」と描かれる**。Skill は「数式は単一引用符で」「`\n` は二重引用符の中で」と別々に書いており、両方を使う（`Scale, Shift` の 2 行目に数式）と気付きにくい。診断なし | 図 2（2 回目） | 分かりにくい診断・Skill の不足 | `repro/single-quote-newline.sumi.yaml`、`previews/repro-single-quote-newline.png`。数式の外（平文の部分）に文字どおりの `\n`（バックスラッシュ + n）があれば lint で警告し、hint で `"…\n$\\gamma$"` の書き方を示す。`$...$` の中の `\nu` `\neq` `\nabla` などのコマンドは対象外にする必要があり、数式の区切り（`\$` を含む）を正しく見分ける実装とテストが要る |
| A5 | **junction への `toAnchor` / `fromAnchor` が黙って無視される** | 図 2（6 回目） | 分かりにくい診断 | `src/layout/route/ports.ts` 927 行: junction の端は anchor を見ずに中心を返す。警告（`layout/anchor-on-junction` など）が要る |
| A6 | **線と枠・見出しの近接を幾何 lint が見ない**: (1) 線が group の枠線の上を走る（図 4 の Python SDK → gateway が API tier / Workers の左の枠に重なる）、(2) spread の 3 本が 1〜2px 間隔で並ぶ、(3) 見出しを避けた線が見出しの文字に接する（図 2 の「DiT」、図 4 の「GPU pool」）。(3) は Skill に「診断なしで迂回する」と書いてあるが、接触までは書いていない | 図 2・4 | lint の穴 | src 確認: ラベルと枠線の重なり（#109 A9）はすでに `geometry/label-collision` が見ている（`src/lint/geometry/rules.ts` 440〜469 行付近）。足りないのは**辺（線）と枠線**の重なり・近接、線どうしの近接、線と見出しの接触で、`edge-crosses-label` は交差しか見ない。既存の検査を線にも広げる形になる |
| A7 | **`container` の `muted` が `academic` では破線の枠**になる（`color` では薄い枠）。Skill も catalog も見た目を書いていない。panel を目立たなくするつもりで使うと、破線の辺（skip など）と紛らわしい | 図 2・3 | Skill の不足 | catalog の説明は `default,muted` のみ |
| A8 | 破線の共有幹線の T 字分岐が、角の丸めで「›」の印のように見える | 図 2 | 見た目（軽微） | `previews/dit-block.png` の MLP からの破線の分岐点 |
| A9 | `labelAt: middle, labelSide: right` のラベルが、別の辺の矢じりの真上に置かれ、その辺のラベルに読める。重なってはいないので診断なし | 図 3（4 回目） | 見た目（軽微） | — |
| A10 | `layout/edge-crossing`（info）が 1 件ごとに同じ長い hint を繰り返す（図 4 の初版で 6 件 × 約 400 字） | 図 4 | 診断の読みやすさ（軽微） | 2 件目以降は hint を省くか、要約に 1 回だけ |

#### A1 の切り分け

最初の再現（図 2 を縮めたもの: 上の列に MLP からの破線の辺と残差の辺あり）から、v0.5.1 で 1 つずつ消して ⊕ → junction の経路を見た。

| 変更 | 経路 |
| --- | --- |
| そのまま | S 字 |
| MLP からの破線の辺を消す | S 字 |
| その辺の `dashed` / anchor を外す | S 字 |
| 残差の辺（`split2 → add2`）を消す | S 字 |
| 凡例を消す | まっすぐ |
| `MLP` ノードを消す | まっすぐ |
| `Feedforward` を消す | まっすぐ |
| 上の 2 つの辺を両方消す（= `repro/junction-detour.sumi.yaml`） | S 字 |
| その再現で凡例を `MLP` の上に置く（`[ mlp, key ]`） | まっすぐ |
| その再現で凡例の見本を `node` にする | S 字 |

初版の記録（「凡例と、別のノードへの破線の辺の両方があるとき」）は誤りだった。図 2 の 7 回目では凡例を上に置いても S 字が残ったので、位置の条件は図によって違う。

### (b) 段階 C の候補（欲しかった機能）

| # | 機能 | 頻度（4 図中） | 根拠 |
| --- | --- | --- | --- |
| C1 | **送り元の真上（真横）で入る端**。広いブロックへ並んだ送り元から縦線を引くと、既定の口も `fanIn: spread` も送り元の位置を見ないので、全部の線に段差ができる。図 1 では SVG の座標から 13 端の比を手計算した | 2（図 1・4） | src 確認: `src/layout/route/ports.ts` の `spreadFanIn` は辺の上に `k/(N+1)` の等間隔の枠を作り、送り元の順に割り当てるだけ（設計どおり）。「送り元の射影が辺の上にあればそこへ」（`toAnchor: straight` のような指定）が欲しい |
| C2 | **トークン列・行列の部品**（位置埋め込み + 埋め込みの組の並び、`⋯` の省略）。図 1 では 10 ノード・5 つの `row`・`width` の指定が要った | 1（図 1） | #86 の段階 C の候補（トークン列・行列）に当たる |
| C3 | **枠のない panel**（sub-figure）。`caption` は group にしか付かず、group は必ず枠を描く | 2（図 2・3） | #86 §9.2 の `panel` |
| C4 | **`fanIn` を要素ごと・辺ごとに**。図全体で 1 つなので、Clients は merge、ワーカー → ストアは spread にできない（同じ `toAnchor` で merge を代用） | 1（図 4） | Skill の structured.md「Fan-in」 |
| C5 | **見出しを枠の外・辺の来ない側に自動で**。広い見出しは角に寄せても中央を覆い、辺が迂回する。図 2 では見出しを諦めた | 2（図 2・4） | #109 B1 の残り |
| C6 | 上付きと下付きの縦の重ね（`$x_p^1$`） | 1（図 1） | Skill に「重ねない」と明記（設計どおり） |
| C7 | `align` の解き方の改善（図の大きさも目的に入れる、単独の項目の側を動かす） | 1（図 4） | A2 の根本対策 |

今回の 4 図では、拡大の引き出し線（zoom-in）は試していない。

### (c) 対象外

- 図番号付きの図全体のキャプション（「Figure 2.」）。LaTeX 側の役目。図 2 では group の `caption` で代用した
- patch の立体表現（テンソルの直方体）。画像として埋め込めば足りる
- 自由座標での配置（#86 §3.3 の判断どおり）。図 1 の anchor の手計算は C1 で解くべきで、座標指定ではない

## 推奨する優先順位

1. **A1（junction への S 字の迂回）**: 線の意味は変わらないが、論文図ではよく目に付く。再現があるので原因を特定して直す。
2. **A5・A4（junction の anchor の無視、文字どおりの `\n`）**: どちらも警告を足す。A5 は小さい。A4 は数式の中のコマンド（`\nu` `\neq` `\nabla`）を誤検出しないよう、平文の部分だけを見る実装とテストが要る。
3. **A2・A3（`align` による拡大、キャプションを避ける迂回）**: まず info / 警告と Skill の注意書き（v0.5.x）。根本の解き方の変更は段階 C（C7）。
4. **A6（線と枠線・見出しの近接の lint）**: ラベルと枠線は `geometry/label-collision` が見ているので、その検査を辺（線）と枠線・見出し、線どうしの近接に広げる。
5. **A7〜A10**: Skill の追記と軽微な見た目・出力の調整。
6. 段階 C は頻度と効果から **C1（真上で入る端）・C3（枠のない panel）**、次に **C5（見出しの自動配置）・C4（要素ごとの fanIn）・C2（トークン列・行列）**。

## 提案する後続 Issue

ここでは作らない。#151 の結論とあわせて決める。

| # | タイトル（案） | 分類 | 根拠 | マイルストーン（案） |
| --- | --- | --- | --- | --- |
| 1 | fix(route): straight edge into a hidden junction detours when a legend sits below another node in the next column | すぐ直す（不具合） | A1、`repro/junction-detour.sumi.yaml`（辺のない凡例と MLP ノードだけで起きる） | v0.5.2 |
| 2 | feat(lint): warn about a literal `\n` in the plain-text part of a label | すぐ直す（診断） | A4、`repro/single-quote-newline.sumi.yaml`（`$...$` 内の `\nu` などは対象外） | v0.5.2 |
| 3 | feat(layout): warn when fromAnchor / toAnchor is set on a junction end | すぐ直す（診断） | A5、図 2 の 6 回目 | v0.5.2 |
| 4 | feat(layout): report how much `align` grew the figure | すぐ直す（診断） | A2、`repro/align-grows-figure.sumi.yaml` | v0.5.2 |
| 5 | docs(skill): captions block edges from below; `muted` containers are dashed in academic; quoting math with line breaks | すぐ直す（Skill） | A3・A4・A7 | v0.5.2 |
| 6 | feat(lint): extend border and title checks from labels to edges (edge on or near a group border, edges nearly overlapping, edge touching a title) | すぐ直す（lint の穴） | A6（ラベルと枠線は `label-collision` が検査済み） | v0.5.2 または段階 C |
| 7 | feat(route): enter a wide block straight above the source | 段階 C | C1、図 1・4 | 段階 C |
| 8 | feat: frameless panels for sub-figures | 段階 C | C3、図 2・3 | 段階 C |
| 9 | feat(route): per-element fan-in mode | 段階 C | C4、図 4 | 段階 C |
| 10 | feat(layout): place group titles away from entering edges automatically | 段階 C | C5、図 2・4 | 段階 C |
| 11 | feat: token-sequence / matrix component | 段階 C | C2、図 1 | 段階 C |
| 12 | feat(layout): align solver that keeps the figure small | 段階 C | C7・A2 | 段階 C |

A8〜A10 は個別の Issue にせず、関係する Issue（1・6 など）を直すときに一緒に見るのでよい。
