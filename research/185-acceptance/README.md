# #185 v0.6.0 の受け入れ: 段階 C の構文で 3 図を描き直す

[Issue #185](https://github.com/nishide-dev/sumi-diagram/issues/185)。調査 [#167](../../docs/research/167-stage-c.md)（§7.2 の 18）、関連: #80（ロードマップ）、#172〜#184（v0.6.0 の各機能）。

#167 の基準の 3 図を、v0.6.0 の構文（`requires: ">=0.6.0"`、`theme: paper`）で描き直し、原図と並べて比べた記録。原図そのもの・切り出し・文言はリポジトリに入れていない（Transformer: arXiv 1706.03762v7 Fig. 1、DiT: arXiv 2212.09748v2 Fig. 3、H3-World: 利用者自身の未公開の図。H3-World は見た目の特徴だけを書き、文言は引用しない）。比較は手元の原図と `previews/*.png` を並べて目で行った。

製品の `src/`・schema・examples・golden は変更しない。

## 構成

| パス | 内容 |
| --- | --- |
| `figures/a-transformer.sumi.yaml` | 図 A。#182 の版と同じ（`paper`・`density: compact`）。ほかの段階 C のフィールドは要らなかった。`paper-single` |
| `figures/b-dit.sumi.yaml` | 図 B（4 パネル）。#182 の版から: 左のパネルを `variant: plain` の group＋`caption` に、3・4 番目のパネルを `dim: true`（52 か所の `variant: muted` を削除）、Patchify・Embed → DiT Block と Linear → Noise・Σ を `straight`、3・4 番目の箱も `filled`。`sublabel`・`zoom`・`density: compact`・`fit: scale` は継続。`paper-double` |
| `figures/c-h3world.sumi.yaml` | 図 C。#180 の版（`outlined`・辺の `tone`・`tokens`・`matrix`）から手で編集（生成をやめた）: `density: compact`、キーの塊 10 個を `tokens` の `lines`（45 ノード → 10）、Encoder → Refiner・Refiner → A5・(b) のトークン → ブロックを `straight`（手計算の `"north:0.295"` をやめた）、VAE と「Query」を `labelRotation`、(b) → (c) を `zoom`、最初の Encoder を Refiner と同じ高さに、行列に「Key」「Query」の軸の見出し。`paper-double` |
| `figures/assets/` | #167 の仮のフレーム画像 5 点の複製（原図の画素ではない） |
| `render.ts` | 3 図を lint・描画し、大きさ・縮小率・診断を出し、PDF → PNG（200dpi）→ 64 色のプレビューを書く。error・warning・150KB 以上のプレビューで失敗する |
| `previews/*.png` | 3 図の描画（各 150KB 未満） |
| `repro/align-residual.sumi.yaml` | 見つけた不具合 R-A の再現（下記） |

## 再現

```sh
bun install --frozen-lockfile
bun research/185-acceptance/render.ts
bun src/cli/index.ts lint --geometry research/185-acceptance/repro/align-residual.sumi.yaml   # R-A: warning 1
```

環境: macOS 26.2 / arm64、Bun 1.3.14、基点 main `5dbd65f`（#172〜#184 をすべて含む）、Poppler 26.04.0、ImageMagick 7.1.2。`out/` は無視される。

**`requires` について**: main の `package.json` はまだ 0.5.3（v0.6.0 のリリースの版上げは別の作業）なので、`requires: ">=0.6.0"` の図は今の CLI では `schema/unsatisfied-requires` の error 1 件で止まる。`render.ts` は、`sumi lint` の診断が**その 1 件だけ**であることを確かめたうえで、`requires` の行だけを除いた写しを `out/figures/` に作って描く。版が 0.6.0 になれば図をそのまま描く（写しは作らない）。

## 結果

| 図 | 印刷される大きさ | 縮小率 | 診断（error / warning / info） | YAML |
| --- | --- | --- | --- | --- |
| A | 76.02 × 114.83mm（原図 77.2 × 113.7mm） | 1 | 0 / 0 / 0 | 117 行、ノード 30・group 2・辺 30 |
| B | 180 × 85.98mm（170mm 幅で 81.2mm。原図 約 170 × 68mm、×1.19） | 0.8138 | 0 / 0 / 1 | 207 行、ノード 54・group 4・辺 59（`variant: muted` 52 → 0、`dim` 2） |
| C | 180 × 122.24mm（縦横比 0.679。原図 0.828） | 0.829 | 0 / 0 / 1 | 261 行、ノード 64・group 4・辺 32（#180 の版は 311 行・ノード 97） |

info は B・C とも `geometry/script-too-small`（数式の添字が縮小後に 5pt を下回る。`fit: scale` の図には必ず出る情報、#183）だけ:

- B: 辺のラベル γ₁,β₁・α₁・γ₂,β₂・α₂ の添字が 3.99pt（4.9pt を 81.4% に縮小）。
- C: フレームの添字（I₀ …）、トークン・行列の見出しの添字など 40 か所が 4.64pt（5.6pt を 82.9% に縮小）。

`lint --geometry`（`lint/*` を含む）の warning・error は 3 図とも 0。node・辺のラベル・sublabel の文字は縮小後も 5pt 以上（B の node 6.5pt、C の node 6.6pt）。

## 原図との比較（判断）

### A: Transformer（[`previews/a-transformer.png`](previews/a-transformer.png)）

構造・線の取り回し・色の系統・密度は原図とほぼ同じ。原図の高さとの差は +1%（幅を揃えると）。

| 原図 | Sumi | 差 |
| --- | --- | --- |
| 角丸・黒い太い枠のパステルの箱、角丸の薄灰のエンコーダ・デコーダの枠 | 同じ（`paper`）。枠は 1pt で原図より細い | 線の太さ（下の残る差 A-1） |
| 太い黒い線、小さい矢じり、角の丸い分岐 | 0.5pt の線、小さい矢じり、角の丸い分岐 | 線が細い（A-1） |
| K・V は左から、Q は本線から右へ | 同じ（`"south:0.2"`・`"south:0.4"`・`"south:0.8"`） | なし |
| ⊕ は小さい円 | ⊕ が原図より大きい（`paper` で 16pt） | A-2 |
| 残差の線は枠の余白の中央 | デコーダ側の残差は枠に近い（診断なし） | 軽微 |
| Helvetica 系 | Inter | ほぼ同じ |

### B: DiT（[`previews/b-dit.png`](previews/b-dit.png)）

4 パネルの構造と見た目の要素（枠のない塗りの箱、角丸の枠のパネル、薄表示、斜めの破線の拡大線、小さい 2 行目、まっすぐな入出力）はすべて描けた。3・4 番目のパネルは `dim: true` の 2 行で、文字・線・枠・キャプションが灰色、塗りが淡くなり、原図と同じ見え方。4 枚のパネルは同じ高さでキャプションが 1 行に揃う（左のパネルも `plain` の group にしたので揃う）。Patchify・Embed から DiT Block、Linear から Noise・Σ の線は原図どおり各箱の真上・真下でまっすぐ。

| 原図 | Sumi | 差 |
| --- | --- | --- |
| 左のパネルの文字が大きい（8.4pt）、「N x」がさらに大きい | すべて同じ大きさ（縮小後 6.5pt） | B-1 |
| 高さ 約 68mm（170mm 幅） | 81.2mm（×1.19） | B-2 |
| 辺のラベル（α・γ,β）は線の上 | 縦の線の右 | 軽微（読みは同じ） |
| Noise・Σ・Noised Latent の箱が大きい | 文字に合わせた大きさ | 軽微 |

### C: H3-World（[`previews/c-h3world.png`](previews/c-h3world.png)）

(a)(b)(c) の 3 パネル（塗りのパネル 2 つと破線のパネル）、紫の枠の Encoder、橙の枠の回転した VAE、橙・青の枠のキーと押したキー、紫・橙・灰の枠のトークン列、橙・ピンク・青の辺、斜線の Masked のある 9 × 9 の行列と class から作った凡例、回転した「Query」、(b) から (c) への斜めの破線の拡大線が、原図と同じ位置・同じ色の配置で描けた。Encoder → Refiner と Refiner → A5 は手計算の anchor なしでまっすぐ。最初の Encoder は原図どおり Refiner と同じ高さ。

| # | 原図 | Sumi | 対応 |
| --- | --- | --- | --- |
| C-1 | プロンプトは左揃えで、行動・カメラの語が橙・青の色つきの範囲 | 中央揃え・黒の言い換えの 4 行 | **#186**（`\textcolor`・`textAlign`） |
| C-2 | 行列の見出しの「Static」「pad」 | 「S」「P」（セルの幅に収めるため） | 軽微 |
| C-3 | フレーム画像は右上にずらして重ねた束（I₀ だけ 1 枚） | 1 枚 | **#187**（`layers`） |
| C-4 | 🔥・❄ の多色の絵文字が箱の角に重なる | Tabler の単色の `flame`・`snowflake` を箱の上に `attach` | **#188**（badge） |
| C-5 | LoRA は bowtie | `trapezoid` | **#188**（bowtie） |
| C-6 | 画像の添字（I₀ …）は画像の右下の角 | 画像の下の中央 | **#188**（角への attach） |
| C-7 | 表のような (a) の整列 | 列の `stack` と `align` で代用（Skill に書いた） | **#126**（grid、利便） |
| C-8 | 押したキーは濃い橙・青の塗りに白い文字、⊕ は橙の塗りに白い ＋ | パステルの塗りに黒い文字（`filled`）、⊕ はパステルの塗りに黒い ＋ | **未対応**（提案 P-1） |
| C-9 | Encoder と A のセルは淡い紫の塗り＋紫の枠、Encoder・VAE の文字は太字 | 白地に紫の枠と文字（`outlined` は塗りと色の枠を同時に選べない）、太字でない | **未対応**（提案 P-1） |
| C-10 | トークン列の A… と I₀ の間の縦の点線 | なし | **未対応**（提案 P-3、軽微） |
| C-11 | 「→ Key」「Query ↓」は短い矢印つきの軸の見出し | 文字の「→」を含むラベル。⊕ からの矢印は「Query」の見出しで止める | 軽微 |
| C-12 | パネルの題・Refiner の灰色の文字など、文字の大きさ・色が要素ごとに違う | 一律 | B-1 と同じ（文字の大きさは #167 §8 で後回し） |
| C-13 | 縦横比 0.828 | 0.679（横長） | #182 の記録と同じ。大きさを書いた node（画像・キー・セル）が多く、間隔の効く部分が少ない |

### 3 図に共通する残る差

| # | 差 | 対応 |
| --- | --- | --- |
| A-1 | Transformer の原図は太い黒い線・枠（DiT・H3-World は細い）。`paper` は 0.5pt の辺・1pt の枠で、太い線の版を選べない | 未対応（判断: Theme の範囲。太い線が要る図は `color`・`minimal` の 1pt の辺で近づく。提案はしない） |
| A-2 | ⊕ が原図（A・B・C）より大きい | 未対応（提案 P-2） |
| B-1 | 要素ごとの文字の大きさ（「N x」、左のパネル、パネルの題） | #167 §8 で後回し（Theme の範囲外）。新しい Issue は提案しない |
| B-2 | B の密度（170mm 幅で ×1.19）。長い縦の stack の間隔 | #182 の記録のとおり、図に `gap: 1.5mm` を書けば ×1.07（`b-dit-tight`）。この受け入れでは既定の compact のまま |

## 見つけた不具合

### R-A: `align` が 0.01mm 残して `layout/unsatisfied-align` を出す

[`repro/align-residual.sumi.yaml`](repro/align-residual.sumi.yaml)。Skill の「表」の作例を作る途中で見つけた。見出しの列（stack）が根の `row` の中央に置かれると、`align` は空きを足すことしかできないので、見出しではなく 1 列目の stack を押し下げる（これは仕様どおりで、表の行が崩れる。Skill には「根の row を `align: start` に」と書いた）。そのとき 3 本目の制約 `{ y: [ h-text, p0 ] }` だけが「0.01mm 離れたまま」と warning になる。他の 2 本は満たされ、`align: start` にした同じ図では 3 本とも正確に満たされるので、丸めの残差を許容誤差の外として報告していると考えられる（原因は未調査）。期待: 診断なし、または残差が許容誤差以下。製品のコードはこの PR では直さない。

## 提案する Issue（未作成）

| # | 題（案） | 根拠 |
| --- | --- | --- |
| R-A | fix(layout): do not report a 0.01mm residue as an unsatisfied align | 上の不具合 |
| P-1 | Add a strong tone fill with white text, and a tinted fill for outlined nodes | C-8・C-9（押したキー、⊕、Encoder・A のセル）。#177 の記録で「残る差」とした項目 |
| P-2 | Draw a smaller operator in the paper theme | A-2（3 図とも原図の ⊕ が小さい）。#182 の記録の「残る差」 |
| P-3 | Add a separator cell (dotted line) to tokens | C-10。#167 §4.5 の案の `{ separator: dotted }`（軽微） |

## Skill に書いたこと（同じ PR）

- `SKILL.md`: テーマの選び方で、論文の図には `paper` を勧める。構造的な図の項目から「論文図のレシピ」へ。
- `references/layout-tips.md`: 「Paper figure recipe」（原図の見た目 → 書くフィールドの表、作業の順序、まだ描けないもの）、0.5 → 0.6 の代用 → フィールドの表。
- `references/structured.md`: 0.6.0 のフィールドの版の説明を 1 か所にまとめた、同じ高さのパネルとキャプション付きの group（伸びた group の中身は上に残るので `row` の `align: end` で下へ）、表（列の `stack` と `align`、根の row を `align: start`、作例）、K・V の anchor、`paper` の矢印に要る間隔。
- `references/figure-format.md`: 版の説明（0.5.0 と 0.6.0）、よくある誤り 2 件。
- `references/examples.md`: 「6. Success: a paper figure」（paper・plain / dim のパネル・filled / outlined・tokens・straight・zoom・sublabel・compact・fit を 1 図で）。
