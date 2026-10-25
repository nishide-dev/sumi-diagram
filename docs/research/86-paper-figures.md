# #86 論文図に対応するための配置・文字・画像の調査

- 対象: [#86](https://github.com/nishide-dev/sumi-diagram/issues/86)。関連: #80（ロードマップ）、#18（[カスタム輪郭](18-custom-svg-components.md)）、#19（[PDF/PPTX](19-pdf-pptx-export.md)）、#56（[1パス化](56-single-pass-sizing.md)）、#57（[固定ポート](57-fixed-ports.md)）、#60（[krilla](60-krilla.md)）
- 調査日: 2026-10-26。環境: macOS 26.2 / arm64、Bun 1.3.14、Sumi の基点 `e10b65b`（v0.3.1）、固定 D2 v0.9.0（[`d5a5174`](https://github.com/d2lang/d2/tree/d5a51743b6d5c00f1ec6f8340003f5d5a6ba4eda)）、同梱 BIZ UD Gothic v1.051、製品の WASM エンジン `assets/wasm/sumi-pdf.wasm`（sha256 `cf6ec198…`、krilla 0.8.2 / krilla-svg 0.8.1 / resvg 0.47.0）
- 試作・再現手順: [`research/86-paper-figures/`](../../research/86-paper-figures/README.md)。測定値は [`results/report.json`](../../research/86-paper-figures/results/report.json)
- 基準の図（リポジトリには入れない）: **A** Transformer（Vaswani et al. 2017, Fig. 1）、**B** DiT（Peebles & Xie 2023, Fig. 3）、**C** H3-World 系の概要図。以下では構造だけを書き起こした自作の YAML を使う。

本文では、**実測**（スクリプトで測った値・確認した挙動）と**判断**（それに基づく採否・設計）を分けて書く。判断の段落・表の列には「判断」と明記する。

## 0. 結論

1. **配置モデル: 案 B（Sumi 独自の構造的配置）を、新しい選択式のエンジンとして追加する。** `figure.layout.engine: structured` の図だけが、Sumi の stack / row（段階 B で grid）・`attach`・整列で配置し、Sumi 自身が直交ルーティングと SVG 出力を行う。既定は今の `auto`（D2/ELK）のままで、既存の図・golden は変えない。
   - 実測: 試作（依存なし、配置と経路の中核は約 960 行）で図 A を配置・描画できた。30 ノード・30 エッジで、エッジのノード貫通・異なるネット間の交差・重なり・端点のずれがすべて 0、87.7 × 137.6mm（paper-single に収まる）、出力はバイト一致で決定的、中央値 20ms。同じ図を現行 v1 の範囲で書くと、D2/ELK の出力は 96.7 × 327.4mm で、幅と高さの超過を含む幾何 lint の診断が 4 件、スタックの中心は最大 55.5 unit ずれ、ブロック間の隙間は 0 ではなく 46 unit（23pt）になった（§3.2）。
   - 案 A（D2/ELK にヒントを足す）は、D2 の grid コンテナで「隙間 0 の積み重ね」は作れるが、grid 内のエッジは中心を結ぶ直線で、残差の線が間のブロックを貫通した（§3.1）。固定ポートも #57 のとおり D2 では公開されない。論文図の主用途には使えないと判断する。
   - 案 C（座標の直接指定）は、段階 B で `free` ボックス内の局所座標として、検査付きの逃げ道にとどめる。図全体の主な書き方にはしない。
   - 制約ソルバ（kiwi 系）・WebCola・dagre・elkjs の直接利用は段階 A では採らない。段階 A の箱モデルは 1 パスの決定的な計算で足りた。ELK の直接利用（#57）は、構造的な図の一部に自由グラフを置く段階 C の候補として残す。
2. **線: 構造的エンジンでは、Sumi が直交ルーティングを持つ。** 端点は `fromAnchor` / `toAnchor`（辺と 0〜1 の位置）、分岐点は汎用部品 `junction`、**同じ出口から出るエッジは 1 つのネットとして幹線を共有**する。この 3 つで、図 A の Q/K/V への分岐・残差の迂回線・エンコーダ出力の共有幹線と、図 B の 4 本に分かれるバスを、交差 0 で描けた（§4）。`auto` エンジンでは anchor を受け付けず、黙って無視せずにエラーにする（#57 の方針を維持）。
3. **文字: 段階 A は「ラベル内の数式の小さな部分集合」を、本物の文字の `<tspan>` で描く。** `$...$` の中のギリシャ文字のマクロ・`_`・`^` に限る。MathJax は段階 A では同梱しない（グリフが輪郭になり PDF で検索できない、+1.39〜1.65MB、v4 は一部の記法で非同期のフォント読み込みが必要。§5.2）。ただし**同梱の BIZ UDPGothic は Unicode の下付き数字を持たず、ギリシャ文字が全角幅（1em）**なので、数式用の欧文フォント（OFL）を font set に足す必要がある（§5.3）。
4. **画像: ユーザー画像（PNG / JPEG / SVG、WebP / GIF も可）は、YAML からの相対パスで参照し、sha256 で固定でき、SVG には data URI で埋め込む。** 製品の PDF/PNG エンジンは、今のまま data URI の 4 形式を決定的に PDF の画像へ、SVG を図形のまま変換した。一方で**外部のファイル・URL への参照と foreignObject はエラーにならず黙って消えた**ため、Sumi 側で事前に検査して埋め込む（§6.1〜6.2）。SVG は #18 §5.5 の許可リストで読み直して出力する。
5. **アイコン: Tabler Icons（MIT）を既定の同梱セットの第一候補とする。** outline 5,184 個で 2.90MB（gzip 0.36MB）、全ファイルが幾何だけの許可リストを通った。Simple Icons は**同梱しない**（パッケージは CC0 だが、224 個に個別のライセンス情報があり、CC BY-NC・GPL・AGPL 等を含む。商標の免責も別にある）。絵文字は Fluent Emoji の Flat（MIT）か Noto Emoji の画像（Apache-2.0）を候補とし、Twemoji（画像は CC BY 4.0。npm の `@twemoji/svg` の表示は MIT だが誤解を招く）と OpenMoji（CC BY-SA 4.0）は採らない（§6.4）。
6. **データから描く部品（トークン列・キー・行列・凡例）は部品にする**が、段階 C とする。複数パネル・キャプション・薄表示・拡大の引き出し線は段階 B（§7・§8）。
7. **段階 A（最初の実装）は 8 件の Issue に分け、図 A を描けることを完了条件にする**（§9.1）。すべて Figure v1 への任意フィールドの追加（`requires` で最小版を示す）で、v2 にはしない。`auto` の図の出力と既存の golden は変わらない。

## 1. 参照した版・固定した入力

外部の情報は、次の版・commit に対する確認である。最新の状態は変わりうる。

| 対象 | 版 / commit | 確認方法 |
| --- | --- | --- |
| D2 | v0.9.0（`d5a5174`） | 固定バイナリでプローブ（#57 で最新安定版と確認済み） |
| npm パッケージ | `measure/packages.ts` の `PINNED`（調査日の `latest`） | registry の version manifest。tarball は sha512 integrity を検査して展開 |
| noto-emoji | [`e20cbc2`](https://github.com/googlefonts/noto-emoji/tree/e20cbc2bbec1926686be9f9bee7d1d2cfa1fea0e) | README の License 節、`2D/svg/` の 2 ファイル |
| fluentui-emoji | [`1ffb34c`](https://github.com/microsoft/fluentui-emoji/tree/1ffb34c752ecf5d402f04cfb4b392c77f57c54bc) | LICENSE（MIT）、`assets/*/Flat/` の 2 ファイル |
| twemoji（jdecked） | [`b6b55fe`](https://github.com/jdecked/twemoji/tree/b6b55fef1e8636b540a6d016a4729ca8cdf2e60b) | README の License 節 |

npm の版: elkjs 0.12.0、@dagrejs/dagre 3.1.3、webcola 3.4.0、@lume/kiwi 0.4.4、mathjax-full 3.2.2、@mathjax/src 4.1.3、katex 0.19.1、lucide-static 1.61.0、@tabler/icons 3.49.0、@material-symbols/svg-400 0.48.1、@phosphor-icons/core 2.1.1、simple-icons 16.35.0、@twemoji/svg 15.0.0、openmoji 17.0.0、@iconify/json 2.2.547。integrity は report に記録した。

ダウンロードしたパッケージ・生成物は研究用の `.tools/` / `out/`（gitignore）にだけ置き、root の依存・lockfile・製品のバイナリには入れていない。

## 2. 理想の YAML と、現行スキーマとの差

### 2.1 構文の方針（判断）

先に理想の YAML を書いた（[`figures/ideal/`](../../research/86-paper-figures/figures/ideal/)）。書きやすさ・扱いやすさを、人と LLM（Skill）の両方の観点で優先した。

- **要素の定義と配置を分ける。** node / group / edge は今の平らな一覧のまま書き、並べ方は `arrange`（`stack` / `row`、段階 B で `grid`）の木で ID を参照する。配置を消せば `auto` に戻せ、差分も読みやすい。group の `arrange.items` に入れた要素は、その group の子になる（子の `group:` を重ねて書かなくてよい。両方書いて食い違えばエラー）。
- **各要素は配置の木か `attach` のどちらかにちょうど 1 回現れる。** 漏れ・重複は ID と位置付きのエラーにする。LLM が要素を足したのに配置し忘れる、という典型的な誤りを機械的に検出できる（試作でも検査した）。
- **向きと揃えは箱ごとに書く。** `stack: { direction: up, gap: 0, align: stretch }`。単位付きの長さ（`3mm`）、揃えは start / center / end / stretch。揃えの継承は同じ軸の箱（stack の中の stack）だけにする（試作で、row の `align: end` を stack が継承して横に寄る誤りを実際に起こしたため）。
- **見た目は Theme の範囲で選ぶ。** ブロック種別の色は `tone: orange` のように Theme のパレットの名前を指す（設計 §4.3「Figure からのスタイル直接指定は v1 では提供しない」を守る。色の値は Theme にだけある）。
- **汎用の部品だけを使う。** `junction`（点）、`operator`（⊕ などの記号の円）、`image`、`tokens`、`matrix`、`bowtie`（2 つの台形の形）等。Transformer・LoRA など分野の名前を持つ部品は作らない。
- 文字の中の小さな記法: `$...$`（数式の部分集合）、`[text]{tone=orange}`（色つきの範囲）。どちらも LLM がよく知る書き方（TeX、Pandoc の bracketed span）に合わせた。

### 2.2 図 A（易）

[`a-transformer.sumi.yaml`](../../research/86-paper-figures/figures/ideal/a-transformer.sumi.yaml)。試作がこのファイルをそのまま読んで描く。要点:

```yaml
figure:
  layout:
    engine: structured
    arrange:
      row:
        gap: 3mm
        align: end
        items:
          - stack: { direction: up, gap: 4mm, items: [inputs, input-embedding, enc-add, encoder] }
          - stack: { direction: up, gap: 4mm, items: [outputs, output-embedding, dec-add, decoder, linear, softmax, probabilities] }
groups:
  - id: encoder
    arrange:
      stack:
        direction: up
        gap: 3mm
        align: stretch
        items:
          - enc-split1
          - stack: { direction: up, gap: 0, items: [enc-mha, enc-norm1] }
          - enc-split2
          - stack: { direction: up, gap: 0, items: [enc-ff, enc-norm2] }
nodes:
  - { id: enc-add, component: operator, props: { symbol: plus } }
  - { id: enc-pe, component: circle, icon: tabler/wave-sine, attach: { to: enc-add, side: west, gap: 1.5mm } }
  - { id: enc-split1, component: junction }
  - { id: enc-mha, component: box, label: "Multi-Head\nAttention", tone: orange }
  - { id: enc-n, component: label, label: "N×", attach: { to: encoder, side: west, gap: 2mm } }
edges:
  - { from: enc-split1, to: enc-mha, toAnchor: "south:0.15" }
  - { from: enc-split1, to: enc-mha, toAnchor: "south:0.5" }
  - { from: enc-split1, to: enc-mha, toAnchor: "south:0.85" }
  - { from: enc-split1, to: enc-norm1, toAnchor: west } # 残差
  - { from: enc-norm2, fromAnchor: north, to: dec-mha, toAnchor: "south:0.15" } # 共有幹線
  - { from: enc-norm2, fromAnchor: north, to: dec-mha, toAnchor: "south:0.5" }
```

### 2.3 図 B（中）

[`b-dit.sumi.yaml`](../../research/86-paper-figures/figures/ideal/b-dit.sumi.yaml)（全体、試作は描かない）と、そのうち 1 パネルの [`b-adaln-panel.sumi.yaml`](../../research/86-paper-figures/figures/ideal/b-adaln-panel.sumi.yaml)（試作が描く）。A に加えて、パネル（`component: panel`）とキャプション（`caption`）、パネル全体の薄表示（`variant: dim`）、拡大の引き出し線（edge の `component: zoom`）、補足ラベル（`sublabel: "32 × 32 × 4"`）、数式ラベル（`'$\gamma_1,\beta_1$'`）、矢じりの近くのエッジラベル、1 つの出口から 4 本に分かれるバス。

### 2.4 図 C（難）

[`c-h3world.sumi.yaml`](../../research/86-paper-figures/figures/ideal/c-h3world.sumi.yaml)（草案。試作は描かない）。B に加えて、ユーザー画像（`component: image`、`props.src` / `sha256` / `fit` / `layers`）、表のように行と列を揃える `grid`（`span` 付き）、トークン列（`tokens`、セルをエッジの端点 `sequence.a5` にできる）、キーの集合（`keys`）、色つきの文字範囲、回転した文字（`labelRotation: -90`）、角のバッジ（`badge: { icon: emoji/fire }`）、斜線と凡例つきの行列（`matrix`）、`bowtie`、破線のパネルと「(a) …」の見出し。

画像のパスは構文の例のための仮の値で、ファイルは置いていない。

### 2.5 現行 v1 の反応（実測）

`checkFigure()` に草案を渡した。`requires` があると最初に `schema/unsatisfied-requires` だけで止まる（古い Sumi が新しい図を誤解せず、明確に拒否する。設計 §2.3 の意図どおり）。`requires` を外すと次のとおり。

| 図 | schema/unknown-field | その他 | 未知のフィールド名 |
| --- | --- | --- | --- |
| A | 42 | component/unknown 7 | arrange, attach, engine, fromAnchor, icon, toAnchor, tone |
| B | 68 | component/unknown 17 | 上記（icon を除く）＋ caption, sublabel |
| C | 66 | component/unknown 9、component/unknown-variant 3、schema/invalid-id 2（`sequence.a5` 形式の端点） | 上記＋ badge, labelAt, labelRotation, textAlign |

### 2.6 機能差の一覧

列は、その機能に必要な変更の場所（✓ = 変更が要る、— = 不要）。PDF・画像方式 PPTX は SVG を変換するだけなので、SVG に正しく出れば多くは追加の変更がない。

| 機能 | 図 | schema | IR | 配置 | 経路 | 描画 | lint | PDF | PPTX（編集可能） | Skill | 段階 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `engine: structured` と `arrange`（stack / row）、`align`、`gap` | A,B,C | ✓ | ✓ | ✓（新規） | — | ✓（Sumi の SVG 出力） | ✓（配置漏れ等） | — | ✓（inspect 契約を守れば流用） | ✓ | A |
| `attach`（横に添える） | A,B | ✓ | ✓ | ✓ | — | — | ✓ | — | — | ✓ | A |
| anchor（辺＋位置） | A,B,C | ✓ | ✓ | — | ✓ | — | ✓（端点の検査） | — | — | ✓ | A |
| `junction`、同じ出口のネット共有 | A,B | 部品 | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓（分岐の表現） | ✓ | A |
| `operator`（⊕ 等） | A,B,C | 部品 | — | ✓ | — | ✓ | — | — | ✓ | ✓ | A |
| `tone`（Theme のパレット） | A,B,C | ✓ | ✓ | — | — | ✓ | — | — | ✓ | ✓ | A |
| 同梱アイコン `icon:` | A,C | ✓ | ✓ | — | — | ✓ | ✓（取り込み検査） | — | ✓（画像として） | ✓ | A |
| ユーザー画像 `image` | C | 部品 | ✓（asset の解決・hash） | ✓ | — | ✓ | ✓ | 実測で可 | ✓ | ✓ | A |
| 数式の部分集合、`sublabel` | B,C | ✓ | ✓ | ✓（計測） | — | ✓ | ✓（計測・字形） | フォント追加 | ✓ | ✓ | A（数式）/ B（sublabel） |
| エッジラベルを矢じりの近くに | B | ✓ | ✓ | — | ✓ | ✓ | ✓ | — | ✓ | ✓ | B |
| `panel`・`caption`・`variant: dim`（継承） | B,C | ✓ | ✓ | ✓ | — | ✓ | ✓ | — | ✓ | ✓ | B |
| `zoom`（引き出し線） | B,C | 部品 | ✓ | — | ✓（直線） | ✓ | ✓ | — | ✓ | ✓ | B |
| `grid`（span）、`free`（局所座標） | C | ✓ | ✓ | ✓ | — | — | ✓ | — | — | ✓ | B |
| 色つき範囲、`textAlign`、`labelRotation` | C | ✓ | ✓ | ✓ | — | ✓ | ✓ | — | ✓ | ✓ | B |
| `tokens` / `keys` / `matrix`（凡例・斜線） | C | 部品 | ✓ | ✓ | ✓（セル端点） | ✓ | ✓ | — | ✓ | ✓ | C |
| `badge`、絵文字アイコン | C | ✓ | ✓ | ✓ | — | ✓ | ✓ | — | ✓ | ✓ | C |
| `bowtie` | C | 部品（#52 の outline） | — | — | — | — | — | — | — | ✓ | C |
| 構造の中の自由グラフ（ELK 直接） | — | ✓ | ✓ | ✓ | ✓ | — | — | — | — | ✓ | C |

## 3. 配置モデル

### 3.1 案 A: D2/ELK のまま（実測）

D2 v0.9.0 の機能で近づけられるかを確かめた（`measure/d2-probes.ts`）。

| プローブ | 結果 |
| --- | --- |
| `grid-columns: 1; vertical-gap: 0` に 4 ブロック | 隙間 0 で積まれ（y = 51 / 112 / 173 / 234、高さ 61）、幅は全セルで 236 に揃う。並びは宣言順で上から下。「下から上」の指定はない |
| 同じ grid 内で 1 つ飛ばしの残差エッジ（an1 → an2） | `M 190 171.5 L 190 115.5`。**中心を結ぶ直線で、間の Feed Forward（y 112〜173）を貫通する** |
| 隣り合うセルのエッジ | 長さ 5 unit（`M 190 232.5 L 190 237.5`）。箱の境界の中に収まり、矢印として読めない |
| grid の外から中へのエッジ | `M 404.1 184.2 L 274.7 233.1`。**斜めの直線**（直交でない） |
| `grid-columns: 2` に 2 列（2 個と 3 個） | 両列とも高さ 218 に引き伸ばされる（行の高さが揃う）。列の間のエッジは斜めの直線 |

grid で「積み重ね」自体はできるが、grid の中のエッジは ELK の経路ではなく直線になり、残差・分岐・幹線を表せない。D2 には一般ノードのポート指定もない（#57）。**判断: 案 A は論文図の主用途には使えない。** `auto` は今のまま、フロー図・構成図の自動配置として残す。

参考に、図 A を現行 v1 で最大限近づけた版（[`figures/v1/`](../../research/86-paper-figures/figures/v1/a-transformer.sumi.yaml)、`direction: up`、group 2 つ、残差・Q/K/V を普通のエッジにした）を製品の `renderFigure()` で描いた。

| 項目 | v1（D2/ELK） | 試作（structured） |
| --- | --- | --- |
| 大きさ | 96.7 × 327.4mm | 87.7 × 137.6mm |
| 幾何 lint | `exceeds-page-height`、`exceeds-page-width`、`aspect-distorted` × 2 | （試作の検査で違反 0。製品の lint には未接続） |
| エンコーダのブロックの中心 x | 107.5 / 163 / 114 / 163（最大 55.5 unit ずれる） | すべて一致 |
| Multi-Head Attention と Add & Norm の隙間 | 46 unit（Profile の層間隔） | 0（指定どおり） |
| デコーダの位置 | エンコーダの**上**に積まれる（ELK の層） | 横に並び、下端が揃う |

### 3.2 案 B: Sumi の構造的配置（試作で実測）

試作（[`proto/`](../../research/86-paper-figures/proto/)）は次の 3 段からなる。製品のコードを読み取り専用で使い（TTF の計測・XML parser・WASM エンジン）、依存は追加していない。

1. **配置**（`layout.ts`）: 葉の大きさを同梱 TTF で文字を計測して決め（#56 の compact 候補と同じく実際に描くフォントの advance を使う）、箱を下から上へ計測し、上から下へ置く 1 パスの計算。`stretch`、同じ軸だけの揃えの継承、group の余白、`attach`、最後に余白込みの原点合わせと 1/1000 unit への丸め。
2. **経路**（`route.ts`）: §4。
3. **SVG**（`svg.ts`）: 製品が inspect する語彙（`g.sumi-k-*`、`g.shape`、中央揃えの `<text>`、`path.connection` の M/L）で出力する。フォントは実 family 名で指定した（§5.4）。

| 図 | ノード / エッジ | 大きさ | 折れ | 違反（貫通・端点・交差・重なり・包含・ラベル衝突） | 決定性 | 中央値 | PDF |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A | 30 / 30 | 87.67 × 137.58mm | 23 | すべて 0 | SVG 2 回でバイト一致 | 20.4ms | 14,988 bytes、画像 0、文字は抽出可、BIZ UDPGothic のサブセット埋め込み |
| B の 1 パネル | 16 / 20 | 68.26 × 107.95mm | 14 | すべて 0 | 一致 | 4.5ms | 画像 0、`γ1,β1`・`α2` 等も文字として抽出可 |

時間は parse・配置・経路・SVG の合計で、PDF 変換は含まない。macOS arm64 の 1 環境の値で、大きな図の性能保証ではない。

- 図 A は最初 95.6mm 幅で paper-single（88mm）を超えた。列の間隔 8mm → 3mm、位置エンコーディングの添え 3mm → 1.5mm の 2 か所を変えて 87.67mm に収まった。**判断:** 構造的配置では大きさが入力から予測でき、寸法の調整が局所的な値の変更で済む。ELK では層の数と間隔で高さが決まり（§3.1 の 327mm）、作者が直接は調整できない。
- 生成物の目視（`out/a-transformer.png`、`out/b-adaln-panel.png`）では、ブロックの積み重ね・Q/K/V の分岐・左右の残差・エンコーダ出力の幹線・N× の注記・位置エンコーディングの記号が、元の図と同じ構造に並んだ。

### 3.3 案 C: 座標の直接指定（判断）

- 図全体を座標で書く方式は、書く量が多く、文字の大きさやフォントが変わると壊れ、LLM には座標の推測を強いる。主な書き方にはしない。
- ただし、図 C の「ずらして重ねた画像」や、手で置きたい注記のために、段階 B で `free` ボックス（`free: { items: [{ item: x, at: [4mm, 2mm] }] }`、箱の中の局所座標）を用意する。重なり・はみ出し・エッジの貫通は通常どおり幾何 lint で検査する。座標を使っても検査は外さない。

### 3.4 既存の配置ライブラリ（実測と判断）

| 候補 | ライセンス | 大きさ（実測） | 決定性（実測） | Bun / 単一バイナリ | 判断 |
| --- | --- | --- | --- | --- | --- |
| 試作の自前実装 | （Sumi） | 中核約 960 行、依存 0 | A・B で SVG がバイト一致 | 問題なし | **段階 A で採用**（box モデル＋格子の経路探索） |
| elkjs 0.12.0（#57） | EPL-2.0 OR GPL-3.0-or-later | compile の差 1,618,176 bytes（#57） | 正規化した幾何のみ一致（生 JSON は `$H` で不一致） | 互換 adapter が必要（#57） | 段階 C の候補（構造の中の自由グラフ、FIXED_POS のポート） |
| @dagrejs/dagre 3.1.3 | MIT | minify 48,750 bytes（gzip 17,386） | 2 回同じ出力 | 動作 | 不採用。層状配置のみで、ポート・直交経路・箱の入れ子を持たない |
| webcola 3.4.0 | MIT | minify 79,994 bytes（gzip 24,004）、d3 系の依存 4 | 2 回同じ出力（小さな入力） | 動作 | 不採用。力学モデルの反復で、入力の小さな変更で位置が大きく動きうる。直交ルーティングは別途必要 |
| @lume/kiwi 0.4.4（Cassowary） | BSD-3-Clause | minify 12,641 bytes（gzip 3,992） | 2 回同じ出力 | 動作 | 段階 A は不要。段階 B で「別の箱にある要素どうしを揃える」制約が要れば候補 |
| KaTeX / Typst 等の組版系 | — | — | — | — | 配置エンジンとしては対象外（§5.2） |

大きさは `bun build --minify` の bundle（`measure/bundles.ts`）で、単一バイナリへの増分の目安。#57 の elkjs では、compile の差が bundle の大きさとほぼ同じだった。

**判断の理由（段階 A で外部ライブラリを使わない）**: 論文図の配置は「並べる順と揃えを作者が決める」ことが本質で、求めるべき未知数が少ない。stack / row / grid の箱モデルは 1 パスで解け、結果が入力から説明できる（LLM が次の修正を推測しやすい）。制約ソルバは「箱をまたぐ整列」「等幅の強制」を宣言的に書きたくなった時点で導入を検討する。

### 3.5 構造的エンジンと既存パイプラインの関係（判断）

```
*.sumi.yaml → validate → link → resolve → style → constrain → Figure IR
   ├─ engine: auto        → D2 source → D2 CLI → finalize → (compose) → inspect → lint → PDF / PPTX
   └─ engine: structured  → Layout IR（矩形・経路・ラベルの箱） → Sumi SVG writer → finalize → inspect → lint → PDF / PPTX
```

- Layout IR は #57 §5 が必要とした「Figure IR / Profile / 文字寸法を受け取り、node・port・route・label の座標を返す」中間表現そのものである。今回これを ELK ではなく Sumi の箱モデルで作る。将来 ELK を直接使う場合も同じ Layout IR を返せばよい。
- SVG writer は §6.3 の inspect 契約（`g.sumi-k-*`、`g.shape`、中央揃えの text、M/L/C の path.connection、transform なし）を守る。そうすれば inspect・幾何 lint・PDF・画像方式 PPTX・編集可能 PPTX をそのまま、または小さな変更で使える。試作の SVG は製品の WASM で PDF・PNG にでき、PDF の文字は検索可能・画像 0 だった（§3.2）。
- metadata は形式 1 のまま、`backend` に新しい値（例 `sumi-structured`）と Sumi の版を書く。D2 の hash は structured では書かない。
- Profile の `layerGap` などは `auto` 専用の値として残し、structured の既定の `gap` は Theme / Profile の新しい値（例 `layout.stackGap`）から取る。#56 の結論（`auto` の既定の寸法を変えない）とは独立で、`auto` の出力は変わらない。

## 4. 線の経路決定

### 4.1 試作の方式（実測）

- 障害物は各ノードの矩形を 6 unit（3pt）膨らませたもの。格子の座標は、障害物の辺・group の辺・端点とその突き出し（stub）の座標と、それらの中点（溝の中央を通すため）。
- 状態（格子点, 進行方向）の Dijkstra。費用は長さ＋折れ 40＋group の境界の通過 150＋他のネットとの交差 80＋他のネットとの重なり 4000。**同じネットが既に使った格子の辺は費用 0** にする。
- 端点は anchor の点から外向きに 6 unit 進んだ stub から探索し、最後は内向きの stub で入る（矢じりが常に辺に垂直）。junction は向きが自由な点。
- 向かい合って一直線に並ぶ隣のブロック（隙間が 2 × 6 unit より狭いことがある）は、間に障害物がなければ直線でつなぐ。図 B の 2mm 間隔のスタックでは、この特別扱いがないと経路が見つからなかった（実測）。
- エッジの順番は YAML の順で固定、同点は挿入順。格子は整数の添字で、浮動小数の座標は 1/1000 unit に丸める。

| 表現 | 書き方 | 結果（実測） |
| --- | --- | --- |
| Q/K/V への分岐 | junction から 3 本、`toAnchor: "south:0.15"` 等 | 3 本の矢じりが下辺の指定位置に垂直に入る |
| 残差の迂回線 | junction から `toAnchor: west`（デコーダは `east`） | group の溝を通り、ブロックを貫通しない。分岐と同じネットなので水平部分を共有 |
| 共有の幹線（A のエンコーダ出力 → K, V） | 同じ `from` と `fromAnchor` の 2 本 | 先頭 3 点が一致し、途中で 2 本に分かれる |
| バス（B の MLP → 4 か所） | 同じ出口から 4 本、`toAnchor: east` | 右側の 1 本の縦線から 4 本が分岐。交差 0 |
| 矢じりの近くのラベル | `label: '$\alpha_1$'` | 最後の線分の矢じりの手前・上側に置き、ノード・線・他のラベルとの衝突 0 |

### 4.2 ELK と Sumi の経路の関係（判断）

- `auto`（D2/ELK）では anchor・junction のネット共有・矢じりの近くのラベルを提供しない。指定されたら `layout/unsupported-in-auto`（error）にする。後処理で端点だけを動かす方式は #18 §2.3・#57 のとおり採らない。
- `structured` では Sumi が全経路を持つ。段階 C で構造の中に自由グラフ（`arrange: auto`）を入れる場合も、ELK には箱の中の配置だけを任せ、経路は Sumi の router で引き直すか、ELK の経路を Layout IR に正規化して使う（#57 の幾何の正規化と同じ）。どちらにするかは段階 C で測る。
- **拡大の引き出し線（zoom）** は経路探索をせず、元のノードと拡大先のパネルの対応する 2 つの角を結ぶ破線にする。角の組は相対位置から決める（右にあれば右上 → 左上、右下 → 左下）。ノードを横切る場合は幾何 lint の warning にする（避けて曲げると引き出し線として読めないため）。
- 同じ出口からのエッジを自動でネットにするのは、論文図ではほぼ常に望ましい（分岐を描くため）からである。別の線として描きたい場合は anchor の位置を変える。明示の `bundle` フィールドは需要が出るまで作らない。
- 幾何 lint には「エッジがノードを貫通する」規則を加える（今の MVP は検出しない。設計 §6.5 の観察）。structured の router はこれを保証し、lint は独立に再検査する。

### 4.3 限界（実測・判断）

- 試作の格子は O(格子点数 × 4) の Dijkstra をエッジごとに行う。図 A で経路は約 20ms だったが、数百ノードの図は未測定。製品では、ネットごとの探索範囲の制限か、可視グラフの縮約が要るかもしれない。
- 交差の最小化は貪欲（YAML の順に引く）で、全体最適ではない。交差が残った場合は lint で報告し、エッジの順番か anchor で直してもらう。
- エッジラベルの位置は経路の後に決めるので、衝突は検出のみ（自動で避けない）。

## 5. 文字の表現

### 5.1 必要な表現

| 表現 | 例 | 段階 A の扱い（判断） |
| --- | --- | --- |
| ギリシャ文字・添字 | α₂、γ₁,β₁、I₁₃₋₁₆、Timestep *t* | `$...$` の部分集合で、本物の文字の `<tspan>` に |
| 補足ラベル | 32 × 32 × 4 | `sublabel`（段階 B） |
| 色つきの範囲 | The character {walks backward} | `[...]{tone=...}`（段階 B） |
| 回転した文字 | Visual VAE Encoder（縦） | `labelRotation: ±90`（段階 B）。日本語の縦書き（縦組み）は対象外 |
| 太字の見出し | (a) Build the packed … | panel の label（段階 B）と既存の bold |

### 5.2 数式の方式の比較（実測）

| 方式 | 結果 |
| --- | --- |
| **部分集合を tspan で**（試作） | `$\gamma_1,\beta_1$` → γ・下付きの 1（0.7 倍、0.25em 下）・,β・1。PDF から `γ1,β1` として抽出できる。未対応の記法（`\frac` 等）・閉じていない `$` はエラー（推測しない）。BIZ UDPGothic で描くとギリシャ文字が全角幅になり、字間が空いて見えた（§5.3） |
| mathjax-full 3.2.2（Apache-2.0） | Bun で動作。5 式とも 1,623〜4,832 bytes の SVG、**`<text>` 0、グリフはすべて path**、幅は ex 単位。2 回の実行でバイト一致。依存 8 パッケージ。`bun build --compile` の差 **+1,651,200 bytes**、compile 後も同じ出力 |
| @mathjax/src 4.1.3（Apache-2.0） | 4 式は同様（1,733〜3,645 bytes）。`\mathcal{L}` は **"MathJax retry -- an asynchronous action is required"** で同期変換に失敗（フォントの追加データを動的に読み込む）。依存 17 パッケージ、compile の差 +1,387,008 bytes |
| KaTeX 0.19.1（MIT） | 出力は HTML（span と CSS）と MathML で SVG を出さない。配置にブラウザの組版が要る |
| D2 v0.9.0 の `\|latex` | D2 が MathJax の `<svg>`（ex 単位、path）を入れ子で埋め込む。§6.3 の inspect 契約の外 |
| D2 v0.9.0 の `\|md` | 太字・斜体ごとに別の `<text>`（`text-anchor` は start、`xml:space="preserve"`）。inspect 契約（中央揃え）の外 |

**判断**: 論文図のラベルに必要な数式は、ほぼ「記号＋添字」で、分数・行列・根号は少ない。段階 A は部分集合で十分で、文字が文字のまま残り（PDF で検索・コピーでき、PPTX の編集可能方式でも文字として編集できる）、幾何 lint が同じ TTF で計測できる。MathJax は、TeX の完全な記法が必要という需要が出た時点で、段階 C 以降の任意機能として再評価する。その場合は v3 系（同期で完結）を候補とし、グリフが path になること・PDF で検索できないこと・+1.4〜1.7MB を受け入れる判断が要る。依存の推移的なライセンスは今回は未監査。

### 5.3 同梱フォントの字形（実測）

製品の cmap reader で、BIZ UDPGothic Regular（Bold・BIZ UDGothic も同じ）を調べた。

| 文字の種類 | 収録 |
| --- | --- |
| ギリシャ小文字 12 / 大文字 4 | すべて収録。ただし**advance は 1em（全角）**。比較: `a` 0.650em、`x` 0.600em |
| 下付き数字 ₀〜₉ | **0 / 10** |
| 上付き数字 ⁰〜⁹ | 4 / 10（¹²³⁴ のみ） |
| 下付き文字 ₐₑₒₓₜ | 0 / 5 |
| 演算子 ⊕⊗×·∼≈≤≥∑∏∈→↔⋯… | 13 / 15（∼ と ⋯ がない） |
| 数学用イタリック 𝑥𝑦𝑡𝛼𝛽𝛾 | 0 / 6 |
| 絵文字 🔥❄ | 0 / 2 |

- 「Unicode の上付き・下付き文字だけで済ませる」案は、同梱フォントでは成立しない（豆腐になる）。下付きは tspan の縮小と baseline のずれで描く必要がある。
- イタリックの slot がない（設計 §4.2）ので、変数のイタリックは今のフォントセットでは描けない。
- **判断**: 欧文・ギリシャ・数学記号用の OFL フォント（候補: STIX Two Text、Noto Sans / Noto Sans Math 等）を、フォントセットの追加の slot（例 `latin` / `math`）として同梱し、`$...$` の中と欧文の範囲をそのフォントで描く。サイズ・ライセンス・D2 の 8 つの `--font-*` との関係（`auto` では D2 がこのフォントを使えない）は実装 Issue で測る。

### 5.4 PDF・PPTX・lint への影響（実測・判断）

- 試作の SVG（実 family 名、`@font-face` なし）は、製品の WASM の `convert` で PDF にでき、PDF のフォントは BIZ UDPGothic の CID TrueType サブセット埋め込み・ToUnicode あり、画像 0、2 回の変換でバイト一致だった。
- ただし、SVG 単体で開いたときに同梱フォントで描かれるには、`@font-face` へのサブセット埋め込みが要る（今の契約は `svg/missing-font-face` が error）。D2 は自分でサブセットを作るが、structured では Sumi が作る必要がある。**判断**: 製品の WASM は既に krilla 経由で `subsetter` 0.2.6 を含む（`native/pdf-wasm/Cargo.lock`）ので、サブセットを返す export を足すのが最も依存を増やさない。WASM の再ビルド（基準は linux-x64）が要る。
- 画像方式 PPTX は SVG を resvg で文字を輪郭にして入れるので、数式の部分集合もそのまま出る。編集可能 PPTX では、添字を DrawingML の `baseline` 付きの run にする（PowerPoint の下付き）。閲覧環境のフォント置換は従来どおり保証外。
- 幾何 lint の文字計測は、tspan ごとの大きさ・フォントで測るように拡張する（今は `<text>` 単位で 1 つの font class）。

## 6. 画像・アイコン・ロゴ

### 6.1 製品の PDF/PNG エンジンでの画像（実測）

自作の画像（64 × 48 のグラデーション。著作物を含まない）を SVG の `<image>` に入れ、製品の WASM をそのまま使って変換した（`measure/engine-images.ts`）。

| 入力 | PDF（krilla） | PNG（resvg、画像方式 PPTX の経路） |
| --- | --- | --- |
| data URI の PNG / JPEG / WebP / GIF | 各 1 画像（`pdfimages -list`）、2 回でバイト一致 | 描画される。resvg が返す文字を輪郭にした SVG にも `<image>` が残る |
| `xlink:href` の PNG | 同上 | 同上 |
| data URI の SVG | **画像 0（ベクターのまま）** | 描画される |
| `<script>`・`onclick`・`<foreignObject>`・外部 URL を含む SVG（data URI） | 矩形だけが描かれ、スクリプト等は無視される | 同上 |
| 外部ファイル `href="sample.png"` / 外部 URL | **エラーにならず、何も描かれない**（712 bytes の空ページ） | 何も描かれない |
| SVG 本体の `<foreignObject>` | **黙って消える** | 消える |

- エンジン（WASM、host import 0）はファイルシステムもネットワークも使えないので、外部参照は解決されない。安全側ではあるが、**利用者には画像が消えたことが分からない**。
- 画像方式 PPTX の `svgBlip` には `<image>` を含む SVG が入る。PowerPoint がその埋め込み画像をどう表示するかは未確認（#61 の実機確認の範囲外）。

### 6.2 ユーザー画像の契約（判断）

| 項目 | 方針 |
| --- | --- |
| 参照 | `component: image` の `props.src`。**YAML ファイルのあるディレクトリからの相対パス**。絶対パス・URL・`..` で YAML のディレクトリ（またはプロジェクトの設定で指定した asset ルート）の外へ出るパスはエラー。シンボリックリンクは実パスで同じ規則を検査する |
| 形式 | PNG・JPEG・SVG を保証する。WebP・GIF（最初のフレーム）はエンジンが読めたので受け付けるが、閲覧アプリでの表示（SVG を直接開く場合）は保証しない。中身はマジックナンバーで判定し、拡張子と食い違えばエラー |
| 再現性 | `props.sha256` を任意で書け、違えばエラー。`sumi fmt --pin-assets`（仮）が現在の値を書き込む。metadata には、YAML の hash に加えて全 asset の hash を順に連結した `assets-sha256` を記録する |
| 大きさ | 1 ファイル 16MiB、図全体 32MiB（PDF 入力の上限 32MiB、#59 と合わせる）。ピクセル数は 8192px/辺・約 1600 万画素（#61 の PNG と同じ）。超えたら縮小せずエラー |
| SVG 出力 | data URI で埋め込む（単一ファイルで完結し、PDF/PPTX エンジンが読める）。`href` で外部を指す出力は作らない |
| PDF | 画像のバイトをそのまま埋め込む（JPEG は再圧縮しない）。krilla の出力はバイト一致で決定的（実測） |
| PPTX | 画像方式は SVG ごと（実測で描画可）。編集可能方式は `p:pic` として別の画像にする（段階 B） |
| SVG の取り込み | #18 §5.5 の規則を実装する: 厳格な XML parser（DTD・entity・処理命令を拒否）、要素・属性の許可リスト、**元のテキストは出力せず再直列化**、`script`・`foreignObject`・`image`・`use`・`a`・`href`・`on*`・`url(`・`transform`・円弧は拒否。試作の `importSvg()` で負例を検査した |
| 幾何 lint | 画像は footprint の矩形として扱う（中身は解析しない）。`fit: contain` の余白はラベルの安全領域に含めない |
| `auto` エンジン | #18 の方式 (a)（プレースホルダ矩形＋合成）で `auto` でも使える。D2 の `shape: image` は使わない（#18 §1.2: inspect が `<image>` を拒否、ラベルが外に出る） |

Sumi は画像を生成・加工しない（切り抜き・色調整・ラスタ化をしない）。`fit: cover` の切り抜きも SVG の `preserveAspectRatio="xMidYMid slice"` で表すだけで、画素は変えない。

### 6.3 SVG の許可リストと実在のアイコン（実測）

各アイコン集の全 SVG を製品の XML parser で読み、許可リスト（`svg`・`g`・`path`・`rect`・`circle`・`ellipse`・`line`・`polyline`・`polygon`・`title`）の外の要素を数えた。

| セット | 許可リスト外の要素 | 注意する属性 |
| --- | --- | --- |
| Tabler outline / filled | なし | `class`（全ファイル）、`stroke="currentColor"` |
| Material Symbols | なし | なし（単色の path） |
| Phosphor | なし | `fill="currentColor"` |
| Simple Icons | なし | なし |
| Lucide | `symbol` 2・`defs` 1（スプライトとフォント用の 3 ファイルのみ。アイコン本体は許可リスト内）。1 ファイル（SVG フォント）が DTD で parse 不可 | `class`、`stroke="currentColor"` |
| Twemoji | `defs`・`clipPath`（3 ファイル） | `transform` 56 ファイル、`clip-path` 3 |
| Noto Emoji（2 ファイル） | `radialGradient`・`stop`（🔥） | — |
| Fluent Emoji Flat（2 ファイル） | なし（`path` のみ） | — |

**判断**: 単色アイコンは `currentColor` を Theme の線の色に置き換える。多色の絵文字はグラデーションを許すかどうかで選択肢が変わり、Fluent Flat は許可リストのまま取り込める。

### 6.4 同梱アイコン・ロゴ・絵文字の候補（実測・判断）

ライセンスはパッケージの LICENSE ファイルと上流の README で確認した（npm の `license` 欄だけでは判断しない）。

| 候補 | ライセンス（確認した原文） | 個数・大きさ（主なディレクトリ） | 判断 |
| --- | --- | --- | --- |
| **Tabler Icons** 3.49.0 | MIT | outline 5,184 個、2,899,771 bytes（gzip 360,805）。filled 1,054 個 | **既定の第一候補**。`wave-sine`・`flame`・`snowflake`・`keyboard` あり。許可リストをすべて通る |
| Lucide（lucide-static 1.61.0） | ISC。Feather 由来の 115 個は MIT（同じ LICENSE に列挙） | 2,171 個、1,053,672 bytes（gzip 131,092） | 第二候補。小さい。`flame`・`snowflake`・`audio-waveform` あり、`wave-sine` 相当は `audio-waveform` |
| Material Symbols（svg-400 0.48.1） | Apache-2.0 | 各スタイル 7,864 個、outlined 3,846,532 bytes（gzip 1,194,030） | 大きい。採るならスタイル 1 つに限る |
| Phosphor（core 2.1.1） | MIT | 6 ウェイト × 1,512 個、各約 0.7〜0.9MB | 候補（ウェイトを選べる） |
| Simple Icons 16.35.0 | パッケージは CC0-1.0。ただし DISCLAIMER で「全アイコンが CC0 ではない」と明記し、`data/simple-icons.json` の 3,466 個中 224 個に個別のライセンス（Apache-2.0 49、MIT 29、CC BY-SA 4.0 29、custom 23、CC BY 4.0 19、CC0 12、CC BY-SA 3.0 11、GPL 系 15、MPL-2.0 7、CC BY-NC 系（NC-ND・NC-SA を含む）11、CC BY-ND-4.0 2、AGPL 2 ほか） | 3,466 個、4,992,988 bytes | **同梱しない**。ロゴは商標で、ブランドのガイドラインにも従う必要がある。ロゴはユーザー画像として、利用者の責任で指定してもらう |
| Iconify（@iconify/json 2.2.547） | 集合体。npm の表示は MIT だが、各コレクションのライセンスは別 | 506MB | 同梱しない |
| Fluent Emoji（`1ffb34c`） | MIT（LICENSE） | Flat の 🔥 660 bytes、❄ 2,615 bytes（path のみ） | **絵文字の第一候補** |
| Noto Emoji（`e20cbc2`） | フォントは OFL-1.1、ツールと大半の画像は Apache-2.0、旗は public domain 等（README） | 🔥 2,502 bytes（radialGradient）、❄ 7,426 bytes | 第二候補（グラデーションの許可が要る） |
| Twemoji（jdecked `b6b55fe`、npm `@twemoji/svg` 15.0.0） | 上流 README: **コードは MIT、画像は CC BY 4.0**。npm の再配布パッケージは MIT の LICENSE だけを含む | 3,720 個、8,147,297 bytes | 採らない（論文図で帰属表示を求められる。npm の表示を根拠にしない） |
| OpenMoji 17.0.0 | CC BY-SA 4.0 | 43MB | 採らない（継承条件） |

- 単一バイナリへの影響（判断）: `bun build --compile` で埋め込むファイルは圧縮されないと見込み、セットを 1 つの gzip のアーカイブにまとめ、実行時に必要なアイコンだけを展開する。Tabler outline なら約 0.36MB の増加。全セットの同梱ではなく、1 セット＋絵文字の小さな部分集合から始める。
- 参照の形: `icon: tabler/wave-sine`、絵文字は `icon: emoji/fire`（CLDR の短い英語名）。名前の誤りは編集距離の候補付きのエラー（既存の未知 ID と同じ）。`sumi catalog --json` にセット名・版・ライセンスと、検索用の名前一覧（JSON は大きいので `--icons <query>` の検索を用意）を出す。
- ライセンスの同梱: release の `licenses/` に各セットの LICENSE を入れ、NOTICE に版と出典を書く（既存の PDF エンジンの方式）。図の中に帰属表示を描く義務がないもの（MIT / ISC / Apache-2.0 / OFL）に限る。

## 7. データから描く部品（判断）

| 対象 | 方式 | 理由 |
| --- | --- | --- |
| トークン列（Static / A₁ … / V…） | **部品** `tokens`（`cells` の配列。セルに ID を付けるとエッジの端点 `node.cell` になる） | 1 つの footprint の中の描画で、セル単位の配置を ELK・router に渡す必要がない。セルへのエッジだけを Layout IR のサブ anchor として公開する |
| キー（W / A S D / I F / J K L） | 部品 `keys`（行ごとの配列、押下中のキーに tone） | 同上。配置のための node を数十個書かせない（LLM の誤り・ID の衝突を減らす） |
| 行列・ヒートマップ（attention mask） | 部品 `matrix`（行・列のラベル、1 行 1 文字列のセル、文字ごとの class で tone か `pattern: hatch`） | セルの数が多く（9 × 9 = 81）、node にすると YAML が読めない。斜線は SVG の `<pattern>` ではなく線分として出力し、PDF/PPTX の差をなくす |
| 凡例 | `matrix.legend`、または独立した部品 `legend`（class の一覧から作る） | 凡例は行列の class 定義と一致させたいので、同じデータから作る |
| 繰り返すパネル（B の 3 つのブロック） | 段階 C で recipe（テンプレートの展開）を検討 | 今は明示的に書く。展開の規則（ID の接頭辞・差し替え）を固める前に構文を増やさない |

いずれも汎用の名前で、特定分野の意味（attention、LoRA）を持たない。描画は #52 の outline renderer と同じく、純関数で幾何を返し、色は Theme から付ける。

## 8. 複数パネル・サブキャプション・強調と薄表示（判断）

- `component: panel`（group）: 見出し `label`（「(a) …」。太字、左上）、`caption`（下に中央揃え）、`variant: default / emphasis / dim / dashed`。試作の B パネルでキャプションを下に置けた（PDF で文字として抽出可）。
- `variant: dim` は**子孫へ継承**する（パネル全体を薄くする）。今の Theme の解決は要素ごとなので、「祖先の variant を合成する」規則を Theme に足す。透明度（`opacity`）ではなく、Theme が dim 用の色を持つ方式にする（PDF/X での透明の扱いと、PPTX の編集可能方式での再現を簡単にするため）。
- `component: frame`: 枠も背景もない、配置とキャプションだけの group（B の左端のパネル）。
- 図番号と図全体のキャプション（"Figure 3. …"）は LaTeX 側の責務で、Sumi は描かない。
- パネルの見出しの番号付け（(a)(b)(c) の自動採番）は需要が出るまで作らない。

## 9. 段階的な計画

### 9.1 段階 A（最初の実装）: 図 A を描けること

目標: 図 A の理想の YAML（`requires: ">=0.4.0"`）が、そのまま（試作の構文で）診断ゼロで描け、SVG / PDF / 画像方式 PPTX が出ること。互換性: **すべて Figure v1 への任意フィールド・部品の追加**。`engine` の既定は `auto` で、既存の図・examples・gallery・PDF/PPTX の golden は変わらない（`bun run gallery:check` が差分なしで通ることを各 Issue の受け入れ条件にする）。structured 用の新しい golden（examples に 1 図）を追加する。

1. **Add the structured layout tree to the figure schema**
   - figure.layout.engine / arrange、group.arrange、node.attach を Zod に追加し、JSON Schema を再生成する。配置の木の検査（未知の ID、配置漏れ・重複、attach の循環、`auto` での structured 専用フィールド）を新しい stage `layout` の診断にする。`sumi fmt --canonical-order` の順序も更新。
   - 依存: なし。受け入れ条件: 試作の model のエラー（未知・漏れ・重複・不正な anchor）がすべて位置付き Diagnostic になる／既存の fixture の診断が変わらない／`schema:check` が通る。
2. **Implement the structured layout engine (stack, row, attach)**
   - Figure IR → Layout IR（node / group の矩形、ラベルの箱）。同梱 TTF で文字を計測、`stretch`・同軸の揃えの継承、group の余白、Profile / Theme の新しい間隔の値。決定的な丸め。
   - 依存: 1。受け入れ条件: 試作と同じ図で、矩形が試作と一致（許容 0.01 unit）／2 回でバイト一致／`exceeds-page-*` 等の既存の幾何 lint が Layout IR から得た SVG でも働く。
3. **Route orthogonal edges with anchors, junctions and shared trunks**
   - `fromAnchor` / `toAnchor`、`junction` 部品、同じ出口のネット共有、隣接ブロックの直線、経路が見つからないときの `layout/no-route`（error、エッジの位置付き）。
   - 依存: 2。受け入れ条件: 図 A・B パネルで、貫通・端点のずれ・異なるネットの交差・重なりが 0／ノード 100 程度の合成図で時間を測り記録する／幾何 lint に「エッジのノード貫通」規則を追加。
4. **Write SVG from the layout IR and embed font subsets**
   - §6.3 の inspect 契約に沿った SVG writer、`@font-face` のサブセット埋め込み（WASM に `subsetter` の export を追加し `pdf:wasm` で再ビルド）、metadata の `backend`、finalize / inspect / 幾何 lint / PDF / 画像方式 PPTX の接続。編集可能 PPTX は対応するか、明示的な診断で拒否する。
   - 依存: 2・3。受け入れ条件: structured の図で `svg/missing-font-face` が出ない／PDF の文字の位置が幾何 lint の再計測と 0.01pt 以内（既存の PDF 構造検査を流用）／全 4 ターゲットでバイト一致。
5. **Add generic operator and junction components and theme tones**
   - `sumi/operator`（symbol: plus / times / concat 等）、`sumi/junction`、node の `tone` と 3 つの組み込み Theme のパレット（CONTRIBUTING の部品のチェックリスト: catalog・全 Theme × variant・gallery・テスト）。
   - 依存: 1（描画は 4）。受け入れ条件: gallery に追加され `gallery:check` が通る／既存の部品の出力は不変。
6. **Support a label math subset with a math-capable font**
   - `$...$`（Greek マクロ・`_`・`^`・`\times` 等の記号）。未対応の記法はエラー。欧文・数学用の OFL フォントを font set の slot に追加し、`$...$` 内で使う。`auto` では `component/unsupported-in-auto`（D2 に tspan を渡せないため）。幾何 lint の tspan 単位の計測。
   - 依存: 4。受け入れ条件: §5.3 の文字が豆腐にならない（`lint/missing-glyph` で検査）／PDF から `γ1,β1` が抽出できる／フォント追加後のバイナリ・tarball の増分を記録する。
7. **Embed user images and a bundled icon set**
   - `component: image`（相対パス・sha256・形式・上限・data URI）、`icon: <set>/<name>`（Tabler を 1 セット、gzip アーカイブで同梱）、SVG の許可リスト取り込み、metadata の `assets-sha256`、`auto` でもプレースホルダ＋合成で使える。外部参照は事前にエラー（§6.1 の黙って消える挙動に頼らない）。
   - 依存: 4（`auto` 側は #53 の合成の流用）。受け入れ条件: PNG / JPEG / SVG の各 fixture で SVG / PDF / 画像方式 PPTX が決定的／`script`・外部参照・DTD を含む SVG が位置付きエラー／ライセンスが release の `licenses/` に入る／絵文字は段階 C。
8. **Teach the Skill structured layout, anchors and assets**
   - `skills/sumi/references/` に structured の書き方・anchor・junction・アイコンの探し方・画像の置き場所を追加し、`src/cli/skill.test.ts` の照合に含める。`layout-tips.md` に「論文のブロック図は structured、フロー図は auto」という選び方を書く。
   - 依存: 1〜7。受け入れ条件: Skill の作例 YAML が CLI の検査を通る。

マイルストーン案: `v0.4.0 — Structured layout (paper figures, stage A)`。1〜5 で図 A の形と線、6・7 で文字と画像、8 で Skill。

### 9.2 段階 B（図 B）

`panel` / `frame` / `caption` / `variant: dim` の継承、`zoom` の引き出し線、矢じりの近くのエッジラベル（試作済み）、`sublabel`、`grid`（span）、`free` ボックス（局所座標）、色つきの文字範囲・`textAlign`・`labelRotation`、編集可能 PPTX の structured 対応、必要なら箱をまたぐ整列制約（kiwi を評価）。`requires: ">=0.5.0"`。

### 9.3 段階 C（図 C）

`tokens` / `keys` / `matrix`＋凡例（斜線）、`badge` と絵文字セット、`bowtie`（#52 の outline renderer）、画像の `layers`（ずらした重ね）、構造の中の自由グラフ（ELK 直接利用、#57 の adapter とライセンス）、繰り返しパネルの recipe、MathJax の再評価。`requires: ">=0.6.0"`。

### 9.4 対象外

- Sumi が画像を生成・加工すること（ラスタ化・切り抜きの画素処理・色調整）
- 日本語の縦組み（縦書き）。回転した欧文の見出しのみ扱う
- 完全な TeX・数式組版（段階 C 以降に MathJax を任意機能として再評価するまで）
- 図番号・図全体のキャプション（LaTeX 側）
- 分野固有の部品（Transformer ブロック、LoRA、attention 等の名前の部品）
- 外部 URL の画像・実行時のダウンロード、ユーザーのコードの実行
- PPTX / SVG で編集した内容の YAML への逆変換
- ロゴ（商標）の同梱

## 10. リスク

| リスク | 影響 | 対策 |
| --- | --- | --- |
| 新しい配置・経路・SVG 出力の保守 | D2 に任せていた範囲を Sumi が持つ | 段階 A は stack / row と格子の経路だけに絞る。Layout IR と inspect 契約で、出力の検査は既存の lint・PDF 検査を共有する |
| 経路の品質（貪欲な順番、局所最適） | 大きな図で交差・遠回り | 交差・貫通は lint で必ず報告し、順番と anchor で直せるようにする。`auto` を残す |
| 2 つのエンジンの機能差 | 利用者・LLM が混乱する | structured 専用の機能を `auto` で使うと明示的なエラー。Skill に選び方を書く |
| フォントの追加 | 配布サイズ、`auto`（D2）とのフォントの不一致 | `$...$` を structured 専用にし、D2 には渡さない。サイズは Issue 6 で測る |
| アイコン・絵文字のライセンスの変化 | 再配布条件 | 版を固定し、更新時に LICENSE と個別のライセンス情報を再確認する（Simple Icons のような個別ライセンスの集合は採らない） |
| 画像の外部参照が黙って消える | 利用者が気付かない | 埋め込み前に Sumi が検査し、エンジンには data URI だけを渡す |

## 11. 利用者の判断が必要な点

1. **`tone` の色**: academic Theme は「グレースケールで印刷できる」方針（§4.3）。論文図の色分け（A の pink / yellow / blue / orange）を academic に入れるか、色を使う別の Theme（例 `academic-color`）にするか。
2. **既定のアイコンセット**: Tabler（大きいが種類が多い）か Lucide（小さい）。全体を同梱するか、よく使う部分集合だけにするか。
3. **絵文字**: Fluent Emoji Flat（MIT、path のみ）か Noto Emoji（Apache-2.0、グラデーションあり）。
4. **数式用フォント**: 追加する欧文・数学フォントの候補と、配布サイズの上限。
5. **将来の既定**: 論文向けの Profile（paper-*）では structured を既定にするか。段階 A では既定を変えない提案にしている。

## 付録: 再現

```sh
bun install --frozen-lockfile
bun run d2:install
bun research/86-paper-figures/run.ts          # 全測定（out/ に SVG・PDF・PNG）
bun test research/86-paper-figures            # 試作の検査（ネットワーク・D2 不要）
```

詳細は [研究ディレクトリの README](../../research/86-paper-figures/README.md)。
