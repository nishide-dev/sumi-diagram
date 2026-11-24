# #611 下絵に Sumi の実寸を渡す（`sumi catalog --sizes`）

## 背景

#603 の dogfood（v0.19.1、10 本）では、5 本で下絵（HTML/CSS のモックアップ）の寸法が Sumi に移らなかった（`research/603-dogfood-v0.19/review.md` の横断的な問題 5）。

- 下絵の `place` 座標が演算子の実寸（5.6〜8.5mm）に合わず、`no-route` が 8 件出た（run 2）。
- テンプレートが Sumi の部品の既定寸法・フォント・線の太さを知らず、文字の大きさと線の太さは probe の SVG から手で拾っていた。
- 箱の幅を見積もれず、`geometry/label-overflow` を描画してから知った。

#607 で Skill に寸法の表（`skills/sumi/references/sizes.md`、`src/layout/structured/default-sizes.ts` が生成）を足したが、表は `sumi` テーマ・既定の density・既定の文字倍率・1 語のラベル「Encoder」に限られる。別のテーマや実際のラベルでの寸法は CLI から取れなかった。

## 決定

### 1. 1 つの生成元（`src/layout/structured/default-sizes.ts`）

#607 の生成コードを、表の文字列ではなく構造化したデータを返す関数に分けた。表もCLIも同じ関数から作るので、ずれようがない。

- `defaultSizes({ profile, theme?, density?, textScale?, labels?, components? })` → 1 つの設定（profile・density・theme・textScale）について
  - `text`: フォントセット、ノード・グループの見出し・線のラベルの文字の大きさ（pt）、Profile の最小文字サイズ
  - `lines`: ノードの枠・グループの枠・線の太さ（pt）、`radiusPt`: ノードの角の半径
  - `spacing`: `gap`、グループの余白、ノードの左右・上下の余白、外側の余白、ページ幅（pt と mm）
  - `components`: 各ノード部品の自然な幅 × 高さ（ラベルごと。operator は `size` ごと、ラベルを取らない部品は「ラベルなし」で 1 行）
  - `sizedByProps`: props で大きさが決まる部品（`tokens`、`matrix` など）
- 文字の大きさと線の太さは、ノード 2 つ・グループ・線 1 本の probe の図をコンパイルして IR のスタイルから読む。テーマの定義を別に解釈し直さないので、textScale の丸め（0.5pt）もテーマの上書きも描画と同じになる。
- 部品の寸法は #607 と同じく、1 ノードの structured の図を本物のエンジンとフォントで配置して測る。probe の図は JSON（YAML として読める）で組むので、任意のラベル（引用符・改行を含む）をそのまま渡せる。
- 文字倍率の既定は、テーマのカタログの `textScaleFor[profile]`（なければ 1）。sizes.md の 3 設定（paper 1、screen-doc 1.5、presentation 2）と一致することをテストで確かめる。
- `defaultSizesMarkdown()` は `defaultSizes()` の結果から表を組む。生成される sizes.md の表はバイト単位で変わらない（`src/cli/skill-sizes.test.ts`）。

### 2. CLI: `sumi catalog --sizes`

新しいコマンドではなく `catalog` のフラグにした。catalog は「描く前に Sumi に聞く」入口で、Skill も既に最初に呼ぶ。

| オプション | 意味 |
| --- | --- |
| `--sizes` | カタログの代わりに既定の寸法を出す |
| `--profile <id>` | 省くと paper-double・screen-doc・presentation-16x9（sizes.md と同じ 3 設定） |
| `--theme <id>` | 既定 `sumi`（sizes.md と同じ） |
| `--density normal\|compact` | 既定 `normal` |
| `--text-scale <n>` | 既定はテーマが Profile に必要とする倍率 |
| `--label <text>`（繰り返し可） | このラベルで測る。既定「Encoder」 |
| `--component <id>`（繰り返し可） | この部品だけ（短い名前も可） |
| `--json` | `{ version: 1, settings: [...] }` |
| `--css` | 下絵テンプレートの寸法の変数（`--profile` 1 つが必要） |

- 表の出力は設定ごとに、見出し（profile・density・theme・textScale）、文字・線・間隔の 3 行、部品の表（COMPONENT・WIDTH・HEIGHT・MIN WIDTH・PROPS・LABEL）と、2 つの幅の意味の 1 行。
- ラベルのある行は幅を 2 つ出す。
  - **自然な幅**（WIDTH）: ラベル + 左右のノードの余白。`width` を書かないときに Sumi が描く幅。
  - **最小の幅**（MIN WIDTH、`minWidth`）: `geometry/label-overflow` にならない最も狭い `props.width`（0.5pt の倍数）。この規則は文字が枠の線に掛からないことだけを見るので、余白の分だけ自然な幅より狭い（paper の「Encoder」の箱は自然な幅 16.05mm、最小 11.11mm）。値は推定ではなく、その幅でノードを描いて SVG を書き、規則そのもの（`allLintRules()` の `geometry/label-overflow`）をかけて二分探索で求める。最後に試した 2 つの幅（収まる m と、m − 0.5pt で溢れる）は実際に評価したもの。自然な幅で溢れる、またはどんな幅でも溢れない（枠のない `label`）、`width` を取らない部品は `null`。1 回の試しは数 ms で、既定の 3 設定でも 1 秒程度。sizes.md の表には足さない（生成を軽く保ち、表の列を増やさない）。
- `--label` と `--component` で、実際のラベルの 2 つの幅を聞ける。MIN WIDTH より狭い箱は、描画すると `geometry/label-overflow` になる。
- 不正な組み合わせ（`--sizes` なしの `--profile` など、`--sizes` と `--section` / `--kind` / `--icons`、`--css` と `--json`、`--css` と `--component` / `--label`（`--css` の `--box-h` は 1 語の箱の高さなので、ラベルで変えない）、`--profile` なしの `--css`）と未知の profile・theme・部品、範囲外の textScale は終了コード 2 で、何も出力しない。textScale の範囲は Figure の schema の検査（`schema/invalid-value`）をそのまま返す。
- `--profile`・`--theme` は `render` の同名のフラグと同じ意味（その図の Profile・テーマ）なので、名前を揃えた。

### 3. 下絵のテンプレート（`skills/sumi/references/mockup-template.html`）

- 寸法の変数を `BEGIN SUMI SIZES` / `END SUMI SIZES` の間の 1 ブロックにまとめた。中身は `sumi catalog --sizes --css --profile paper-double --theme sumi` の出力そのもので、テストがバイト一致を確かめる。テンプレートが使う寸法の変数（`var(--…)`）はすべて CLI が出す変数であることも確かめる。色の変数（`--canvas`、トーンの塗りと線）は従来どおり probe の SVG から取る別のブロックに残した。
- `--css` は `@font-face`（同梱フォントの `file:` URL。Latin は Inter、その他は BIZ UDPGothic）も出す。描画と同じフォントで下絵の幅が出る。テンプレートに貼るブロックには機械ごとのパスを入れないので、`@font-face` はテンプレートに含めず、貼るときに一緒に入る。
- `.box` は幅を書かなければ「ラベル + `--node-pad-x`」、高さは `--box-h` 以上になり、Sumi の自然な大きさに近づく。`.op` は `--op` / `--op-large` / `--op-xlarge`。グループの余白は `--group-pad`。
- 位置は `left` / `top` を中心にした（`translate: -50% -50%`）。`place` の `at`（ノードの中心）と 1 対 1 に対応する。
- 小さなスクリプトが、文字が枠に掛かる箱に赤い破線を付ける。規則と同じく余白は使ってよく、枠を越えたら印を付ける（文字の範囲の幅・高さ > 枠の内側）。`@font-face` のフォントが読み込まれた後（`document.fonts.ready`）に調べ、箱の大きさ・中身・`style`・`class` が変わるたびに調べ直す（`ResizeObserver`、`MutationObserver`）。class が変われば箱の大きさが同じでも字の大きさや太さが変わりうるので、class も見る。スクリプト自身が付け外しする `overflow` だけが違う変更は無視し（古い値と新しい値の class を `overflow` を除いて比べる）、印の付け外しで調べ直しが繰り返されないようにする。ブラウザの字幅による近似で、正確な値は `--label` の MIN WIDTH で聞く。

`skills/sumi/references/mockup.md` の手順 1 は、寸法を手で書かずに `--css` の出力を貼る、実際のラベルの幅は `--label` で聞く、に書き換えた。sizes.md にも CLI への案内を足した。

## 採らなかった案

- **`sumi mockup`（Sumi が下絵を直接描く）**: review.md の長期案。今回の問題（寸法が合わない）は値を渡せば解け、下絵の自由さ（Sumi がまだ描けない配置を試す）も残せる。別の issue で扱う。
- **テンプレートが JSON を読む**: `file://` のページから別ファイルを `fetch` できない（Chrome の既定）。CSS を貼る方式なら、ブラウザの設定もサーバーも要らない。
- **文字幅の係数（1 文字あたり何 mm）を出す**: 字ごとに幅が違い、和欧混在では誤差が大きい。実際のラベルを測る `--label` の方が正確で、エージェントの手間も同じ。
- **全 profile × density × テーマの表を sizes.md に足す**: 表が大きくなりすぎる。sizes.md は代表の 3 設定に留め、残りは CLI で聞く。

## 検証

- `src/cli/catalog-sizes.test.ts`: 既定の出力が sizes.md の 3 設定と同じ数値であること（部品の表を読み比べる）、全 profile × density の間隔が sizes.md の表と一致すること、文字の大きさ・operator の寸法・textScale、`--label` と `--component`、MIN WIDTH（下の 2 つの幅で、独立した経路 `lintRenderedFigure` で描いて lint し、m では label-overflow なし、m − 0.5pt ではあり。box・diamond・ellipse・cylinder と和文のラベルで確かめる）、compact で箱が低くなること、表の形式、`--css` とテンプレートのブロックの一致、不正な使い方が終了コード 2 で何も出さないこと。
- `src/cli/skill-sizes.test.ts`: sizes.md の生成部分が変わらないこと。
- 描画には触れない（新しいコードは読むだけ）。`bun run gallery:check` で examples とギャラリーがバイト一致することを確かめる。
