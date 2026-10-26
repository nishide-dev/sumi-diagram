# #109 v0.4.0 を典型的な論文図で使ってみた記録（dogfooding）

[Issue #109](https://github.com/nishide-dev/sumi-diagram/issues/109)。関連: #80（ロードマップ）、#86（論文図の調査、[調査メモ](../../docs/research/86-paper-figures.md)）、#107（v0.4.0）。製品の src・schema・examples・golden は変更しない。

## 方法

- **使ったもの**: 公開版 v0.4.0 の release tarball（`sumi-0.4.0-darwin-arm64`、`sumi --version` = `0.4.0`、`sumi doctor` は Ready）。描く間に読んだのは Skill（`skills/sumi/SKILL.md` と `references/*.md`）、`sumi --help`、`sumi catalog`、CLI の診断だけ。`src/`・`docs/design`・`docs/research` は描き終えてから、不具合か設計かを分けるためにだけ読んだ（その箇所は「src 確認」と書く）。
- **作業**: 作業用ディレクトリ（リポジトリの外）で `fmt → lint → render（SVG）→ render（PDF）→ pdftoppm で PNG` を回し、PNG を見て直した。PPTX（画像方式）は図 1 で 1 回だけ出し、中の PNG を見た。1 図あたり最大 8 回まで。
- **見た目の確認**: 主に PDF のラスタ（`pdftoppm -r 300`）。差が疑わしいところは Skill の `scripts/preview`（Quick Look で SVG を描く）と比べた。
- **所要時間**: 目安（作業者の体感）。

## 成果物

| パス | 内容 |
| --- | --- |
| `figures/seq2seq-attention.sumi.yaml` | 図 1: エンコーダ・デコーダ（cross-attention）。structured、`academic`、`paper-single` |
| `figures/training-pipeline.sumi.yaml` | 図 2: 学習パイプライン（画像 3 点・アイコン 2 点・戻りの辺）。structured、`color`、`paper-double` |
| `figures/sample.png`、`augmented.png`、`loss-curve.svg` | 図 2 用に自作した仮の画像（ImageMagick と手書きの SVG。3〜20KB） |
| `figures/serving-architecture.sumi.yaml` | 図 3: 入れ子のグループを持つシステム構成図。structured、`color`、`paper-double` |
| `figures/unet-small.sumi.yaml` | 図 4: 小さな U-Net（skip 接続・連結の operator）。structured、`academic`、`paper-single` |
| `repro/*.sumi.yaml` | 不具合の最小再現（下の (a)） |
| `previews/*.png` | 最終版の PDF を 200dpi でラスタ化したもの（各 100KB 未満）と再現の画像 |

再現: リポジトリのルートで `cd research/109-dogfood-v0.4 && sumi lint --geometry figures/*.sumi.yaml`（v0.4.0、4 図とも 0 errors / 0 warnings）。PDF は `sumi render <file> -o <file>.pdf`。

## 結果の概要

| 図 | 手直しの回数 | 最終の診断 | 大きさ | 判定 | 時間（目安） |
| --- | --- | --- | --- | --- | --- |
| 1 エンコーダ・デコーダ | 6 | 0 / 0 | 83.4 × 117.3mm | 可（PDF の数式の字体の不具合は残る） | 25 分 |
| 2 学習パイプライン | 7 | 0 / 0 | 109.4 × 77.8mm | ほぼ可（アイコンが小さすぎる、辺のラベルの位置） | 30 分 |
| 3 システム構成図 | 8（上限） | 0 / 0 | 159.6 × 119.4mm | ぎりぎり可（交差と遠回りが多い） | 35 分 |
| 4 U-Net | 5 | 0 / 0 | 79.6 × 88.2mm | 可 | 15 分 |

診断が 0 になっても見た目の問題は残った。4 図とも最後は structured で描いた。図 2・3 は Skill の勧め（フロー・構成図は auto）どおり auto で始めたが、`right` でも `down` でも `paper-double` に収まらなかった（後述 B3）。

## 図ごとの記録

### 図 1: エンコーダ・デコーダ（structured、6 回）

左に encoder（Self-Attention＋Add & Norm、FFN＋Add & Norm、`N×`）、右に decoder（Masked Self-Attention、Cross-Attention、FFN、`×N`）、上に Linear → Softmax → `$p(y_t \mid y_{<t},\,x)$`。encoder の出力から Cross-Attention へ `$K,V$` の辺。

| 回 | 変更 | 診断 | 見た目 |
| --- | --- | --- | --- |
| 1 | 初版（Skill の例 4 を 2 列にした） | 0 / 0、86.4mm | decoder の出力の辺がグループ見出し「Decoder」を避けて左へ回り込み、見出しの文字に接する。PDF で `p(y_t ∣ …)` の斜体が立体になる（A1） |
| 2 | decoder の見出しを消し、側面に `attach` した label にした | `geometry/exceeds-page-width` 95.8mm。hint は `layout.direction: down`（structured では無視される値。A3） | 出力の辺は真っすぐになった |
| 3 | encoder も側面の label に、行の `gap` を 6→4mm | 101.8mm で超過 | — |
| 4 | `Feed\nForward`、`Self-Attn.` に短縮 | 95.4mm で超過 | — |
| 5 | 側面は `N×` / `×N` だけにした | 0 / 0、77.1mm | — |
| 6 | 短縮を戻した | 0 / 0、83.4mm | 可 |

残った問題: グループの見出しが使えない（上端中央に固定で、出力の辺とぶつかる。B1）／`$K,V$` のラベルが矢じりの下で Add & Norm との間に入り、どの辺のラベルか少し分かりにくい（B4）／PDF と PPTX の PNG で `p(y_t ∣ y_{<t}, x)` が立体の別書体になる（A1）／`"Self-\nAttention"` のように手で改行する必要がある。

### 図 2: 学習パイプライン（auto 2 回 → structured 5 回）

データセット（cylinder）→ 入力画像 → RandAugment → 拡張後の画像 → ViT → 損失 → AdamW、AdamW → ViT の更新（破線の戻り）、損失 → 損失曲線（SVG 画像）、アイコン 2 点。

| 回 | 変更 | 診断 | 見た目 |
| --- | --- | --- | --- |
| 1 | auto、`direction: right` | `exceeds-page-width` 342mm。hint が「wider profile (e.g. paper-double)」を勧めるが、すでに `paper-double`（A3） | 1 行に 8 段。アイコンだけのノード（`tabler/cpu`）が辺なしで浮き、文字 1 字ほどの大きさ |
| 2 | `direction: down` | `exceeds-page-height` 244.8mm。hint の「taller profile」は存在しない（A3）。`edge-crosses-label` 1 件 | — |
| 3 | structured（データ段・学習段の 2 行） | `component/invalid-math`: `\tilde`、`\hat` 非対応（hint は分かりやすい。ただし Skill の非対応一覧に無い。A6・B5） | — |
| 4 | `x'` と `ŷ`（直接入力）に置換 | 0 errors、`label-collision` 4 件 | 行をまたぐ辺が矢じりの間の狭い隙間に集まり、ラベル「batch」と「ŷ」が重なる |
| 5 | 行をまたぐ 2 本に `fromAnchor: south` / `toAnchor: north` | `layout/no-route`（augmented → model）。原因は augmented の南に `attach` した説明ラベルだったが、診断は塞いでいる要素を言わない（A5） | — |
| 6 | 説明ラベルを北に移動 | `label-collision`・`edge-crosses-label`（グループ見出し「Training step」）。hint は「見出しは左上」と言うが structured では上端中央（A3） | — |
| 7 | 辺を `toAnchor: "north:0.85"` にずらした | 0 / 0 | ほぼ可 |

残った問題: アイコンが 1em 固定で、8pt の図では判読しにくい（B6）／`update θ` のラベルが最後の短い垂直区間の横に置かれ、手前の水平な破線を覆って破線の切れ端が点のように残る（B4）／PDF で `$\nabla_\theta L$` の `L` が立体になる（A1）／グループ見出しが大きく（9pt 太字）、上に余白ができる。

### 図 3: システム構成図（auto 3 回 → structured 5 回、上限）

Clients（3）→ API tier（gateway → Inference / Training / Auth）→ Job queue → Workers（GPU pool: Inference / Training、Preprocess）→ Storage（4 個の cylinder）。多対多の辺 18 本、入れ子 3 段。

| 回 | 変更 | 診断 | 見た目 |
| --- | --- | --- | --- |
| 1 | auto、`right`、入れ子 3 段 | `exceeds-page-width` 321.9mm | 配置自体は読めるが、余白が多い |
| 2 | `down` | `exceeds-page-height` 231.4mm、`edge-crosses-label` | — |
| 3 | 入れ子を 1 段に減らした（layout-tips の助言） | 286.6mm で超過 | — |
| 4 | structured（Clients / platform / Storage の 3 列） | 209.7mm で超過 | 同じ口に入る辺が束ねられ、どのワーカーがどのストアへ行くか読めない。gateway の分岐の丸い角に矢じりが重なる（A7） |
| 5 | `gap` を詰め、Storage への `toAnchor` を位置ごとに分けた | 199.7mm で超過 | — |
| 6 | Storage を platform の下の行に移した | 0 errors、`edge-crosses-label` 1 件、161.6mm | **Inference workers → Model registry の辺が、Inference API → Inference workers の辺と同じ線を共有し、Inference API から registry へ行くように読める**（A2） |
| 7 | platform を 2 段（API と queue / workers）に | `label-collision`（gRPC と「GPU pool」）、`edge-crosses-label` | — |
| 8 | 入れ子のグループの見出しを外して `attach` の label に、ワーカー → ストアに `fromAnchor` | 0 / 0 | ぎりぎり可。交差・遠回り（Auth → Metadata DB）が残る。gRPC のラベルがグループの枠線に乗る（検出されない。A9） |

### 図 4: U-Net（structured、5 回）

左列に encoder 3 段（pool で下へ）、底に bottleneck、右列に decoder 3 段（concat の operator → Conv）、skip を破線で、出力は 1×1 Conv → `mask y`。

| 回 | 変更 | 診断 | 見た目 |
| --- | --- | --- | --- |
| 1 | 初版 | `component/invalid-math` `\hat`（2 回目） | — |
| 2 | `mask $y$` に | `layout/no-route` 4 件。decoder の間（gap 5mm）に `attach` した operator が隙間を埋め、矢印の場所が無い。`attach` は親の木で場所を取らないが、Skill に書いていない（A4） | — |
| 3 | 縦の `gap` を 12mm | `exceeds-page-width` 109mm、`label-collision` 2 件（「up」が箱に重なる） | 角に置いた hidden junction の下に線が突き出す |
| 4 | 1×1 Conv を上に、角を junction でなく `fromAnchor`/`toAnchor` に、「up」を 1 か所に | 0 / 0 | bottleneck → concat の辺が concat の直前で S 字に曲がる |
| 5 | 最下段の `gap` だけ 16mm（入れ子の stack） | 0 / 0 | 可 |

残った問題: skip の破線が operator の高さに合わせて最後に曲がる（concat を encoder の箱と同じ高さに揃える手段が無い。B7）／破線＝skip の凡例が描けない（B2）／`$1{\times}1$` の数字が STIX、`Conv` がゴシックで書体が混ざる。junction を辺の無い「詰め物」として使ったが、診断は出ない（意図どおりかは不明）。

## 診断ごとの評価

| コード | 出た図 | 役に立ったか |
| --- | --- | --- |
| `geometry/exceeds-page-width` | 1, 2, 3, 4 | 大きさの数値は役に立つ。hint は structured でも `layout.direction: down` を勧め、`paper-double` 上でも「wider profile (e.g. paper-double)」を勧める（A3） |
| `geometry/exceeds-page-height` | 2, 3 | hint の「taller profile」は存在しない（paper の 2 つは 220mm で同じ）（A3） |
| `geometry/edge-crosses-label` | 2, 3 | 検出は正しい。hint の「見出しは左上」「layout.direction を変える」は structured では誤り（見出しは上端中央、direction は無視）（A3） |
| `geometry/label-collision` | 2, 3, 4 | 正確で役に立った |
| `geometry/node-overlap` | 再現のみ | `attach` が原因の重なりに「同じ group に入れる」と勧める（A3・A4）。operator の記号を「label」と呼ぶ |
| `layout/no-route` | 2, 4 | 辺は特定できるが、塞いでいる要素（attach した説明ラベル・operator）を言わない（A5） |
| `component/invalid-math` | 2, 4 | 位置と未対応のコマンドが分かり、良い。ただし `\hat`・`\tilde` は ML の図で頻出（B5） |
| `yaml/syntax` | 2 | 作業者の sed の誤り。位置は正確 |

## 分類

### (a) すぐ直す（v0.4.x）: 不具合・誤解を招く診断・Skill の誤り

| # | 内容 | 頻度 | 種類 | 根拠（src 確認） |
| --- | --- | --- | --- | --- |
| A1 | **PDF と画像方式 PPTX（の PNG）で、Latin-1 外の数学記号（`∇` `→` `≤` `∂` `∣`）を含むラベルの数式が、ラベル全体で別の書体になる**。`y`・`x` の斜体が失われ、`→` `≤` `∇` `∂` ではゴシック、`∣` では立体のセリフになる。`×` だけは正しい。SVG（Quick Look）では正しい。Skill が対応記号として挙げる `\to` `\leq` も該当 | 図 1・2（PDF・PPTX） | 不具合 | SVG の tspan は `text-math` / `text-math-italic` で正しい。PDF 側のクラスから実フォントへの書き換えは `src/render/pdf/fonts.ts`（`D2_FAMILY` の書き換え、88 行付近）。`src/render/label-math.test.ts` の PDF 検査は文字と位置だけを見て、記号を含むラベルの run ごとのフォントは見ていない。原因（変換エンジンのフォールバックが text 要素全体に及ぶ等）は未特定 |
| A2 | **同じ口（port）で入る辺と出る辺が 1 つのネットに束ねられる**。`api → worker`（worker の西に入る）と `worker → store`（西から出る）が線を共有し、`api → store` に読める | 図 3 | 不具合（誤読を招く） | `src/layout/route/router.ts` 342–353 行 `#joinNets`: 端点のキーが「要素・口の座標・向き」だけで、入りと出を区別しない。Skill（structured.md）が言うのは「同じ口から**出る**辺」「同じ口に**入る**辺」の束ねだけ |
| A3 | **幾何 lint の hint が engine と profile を見ない**: `exceeds-page-width` は structured でも `layout.direction: down`、`paper-double` でも「e.g. paper-double」を勧める／`exceeds-page-height` の「taller profile」は存在しない／`edge-crosses-label` の「見出しは左上」「`layout.direction`」は structured では誤り／`node-overlap` は `attach` の重なりに「同じ group に」と勧める | 4 図すべて | 誤解を招く診断 | `src/lint/geometry/rules.ts` 77・98・234・316 行（固定文字列） |
| A4 | **`attach` は親の木で場所を取らない**ので、stack の隙間に付けた operator や説明ラベルが隣の要素に重なる・辺の口を塞ぐ。Skill は「グループ（キャンバス）が広がって収める」とだけ書く | 図 2・4 | Skill の不足（挙動は設計の可能性） | `repro/attach-in-gap.sumi.yaml`（`node-overlap` 警告）。structured.md「Attach: side notes」 |
| A5 | `layout/no-route` が、経路を塞いでいる要素を言わない（`every path is blocked by nodes …`）。図 2 では attach した説明ラベルが原因で、見つけるのに 1 回使った | 図 2・4 | 診断の改善 | `src/layout/route/router.ts` 281 行 |
| A6 | Skill の記述: (1) `\hat` `\tilde` `\bar` が非対応一覧（figure-format.md「Label math」）に無い／(2) layout-tips はパイプライン・構成図に auto を勧めるが、auto が `right` でも `down` でも収まらないときの次の手（structured の 2 行配置）が無い／(3) SKILL.md 手順 6 の `exceeds-page-width` 対処（`direction: down`）が structured に当てはまらない／(4) structured のグループ見出しが上端中央で、上から入る辺とぶつかることが書いていない | 図 1〜4 | Skill の誤り・不足 | `skills/sumi/references/figure-format.md`、`layout-tips.md`、`SKILL.md` |
| A7 | 分岐（共有の幹線）の直後や曲がり角の直後に矢じりが来て、丸めた角に重なる（gateway → 3 つの API、cylinder の北）。structured.md は「矢じりの前に直線が要る」と書く | 図 3 | 見た目の不具合（要確認） | 未特定（経路のスタブの長さと分岐位置） |
| A8 | 最後の区間が短いと辺のラベルが手前の区間を覆い、破線の切れ端が点のように見える（`update θ·`） | 図 2 | 見た目の不具合（軽微） | structured.md「Edge labels」に「短い最後のスタブでは矢じりの横」とある挙動の副作用 |
| A9 | 辺のラベルがグループの枠線に乗っても幾何 lint が検出しない（gRPC と GPU pool の枠） | 図 3 | lint の穴（軽微） | — |

最小再現:

```yaml
# A2: repro/shared-segment.sumi.yaml（API → Store に見える）
figure:
  layout:
    arrange:
      stack:
        gap: 8mm
        items:
          - row: { gap: 10mm, align: center, items: [ api, worker ] }
          - row: { gap: 10mm, items: [ store, spacer ] }
edges:
  - { from: api, to: worker }
  - { from: worker, fromAnchor: west, to: store, toAnchor: north }
```

```yaml
# A1: repro/math-italic2.sumi.yaml を -o x.pdf で描き pdftoppm で見る（SVG は正しい）
- { id: a, component: label, label: '$y \nabla x$' }   # PDF: ゴシック
- { id: b, component: label, label: '$y \to x$' }      # PDF: ゴシック
- { id: c, component: label, label: '$y \mid x$' }     # PDF: 立体のセリフ
- { id: e, component: label, label: '$y \times x$' }   # PDF: 正しい（斜体）
```

```yaml
# A4: repro/attach-in-gap.sumi.yaml（op が Block B に重なる。geometry/node-overlap）
arrange: { stack: { gap: 3mm, items: [ a, b ] } }
- { id: op, component: operator, props: { symbol: plus }, attach: { to: a, side: south, gap: 1mm } }
```

```yaml
# A3: どの structured 図でも幅を超えると出る hint
#   hint: … Lay it out top to bottom (layout.direction: down), … or use a wider profile (e.g. paper-double).
```

### (b) 段階 B の候補（欲しかった機能）

| # | 機能 | 頻度（4 図中） | #86 §9.2 との対応 |
| --- | --- | --- | --- |
| B1 | グループ見出しの位置（左上・下・外側・なし＋側面）。structured では上端中央に固定で、上から入る辺とぶつかる。図 1・3 では見出しを消して `attach` の label で代用した | 3（図 1・2・3） | `panel` の見出し（左上）に近いが、§9.2 には container の見出し位置そのものは無い。新規 |
| B2 | 凡例・キャプション（破線＝skip、破線＝非同期の更新） | 2（図 2・4） | `panel`・`caption`（§9.2）。凡例は段階 C の `keys` |
| B3 | auto で収まらない長いフロー・構成図の折り返し（2 行のパイプライン）。auto は `right` も `down` も超過し、structured で手で 2 行にした | 2（図 2・3） | §9.2 の `grid`（span）に近い。auto の折り返しは無い |
| B4 | 辺のラベルの位置の指定（中央・始点寄り・線の片側） | 3（図 1・2・3） | 「矢じりの近くのエッジラベル」（§9.2、試作済み）の延長 |
| B5 | 数式のアクセント `\hat` `\tilde` `\bar`（`ŷ`、`x̃`） | 2（図 2・4） | §5 の数式の部分集合の拡張。§9.2 には無い |
| B6 | アイコンの大きさ（1em 固定で 8pt の図では読めない） | 1（図 2） | 無し（§6.4 の延長） |
| B7 | 別の木にある要素どうしの整列（concat の operator を encoder の箱と同じ高さに、skip を水平に） | 2（図 1・4） | 「箱をまたぐ整列制約（kiwi を評価）」（§9.2） |
| B8 | 文字とアイコンを 1 つのノードに（現在は attach で代用） | 1（図 2） | `sublabel`（§9.2）に近い |

### (c) 対象外

- 図を縮小して収める（`\resizebox` 相当）。Sumi の方針（"never shrinks"）どおり。図 1 では文字を短くして対応した
- 損失曲線などのグラフを描くこと（画像として埋め込めば足りた。§9.4）
- 自由座標での配置（§3.3 の判断どおり）
- 分野固有の部品（attention ブロック等。§9.4）

## 推奨する優先順位

1. **A1（PDF の数式の書体）**: 論文の最終成果物は PDF なので最優先。Skill が挙げる `\to` `\leq` でも起きる。PDF の run ごとのフォントを検査するテストを足す。
2. **A2（入りと出のネットの結合）**: 図の意味を変えてしまう。`#joinNets` の端点キーに向き（入る / 出る）を入れる。
3. **A3・A5・A6（診断の hint と Skill の文書）**: 安価で、4 図すべてで迷いの原因になった。hint を engine（auto / structured）と profile で出し分ける。
4. **A4・A7**: `attach` の場所の扱い（文書化するか、木の中で場所を取る選択肢）と、矢じりの前の直線の確保。
5. 段階 B は頻度順に **B1（グループ見出しの位置）・B4（辺のラベルの位置）**、次に **B3（折り返し）・B7（整列）・B5（アクセント）**。B2（凡例・キャプション）は §9.2 の `panel` / `caption` とまとめる。
