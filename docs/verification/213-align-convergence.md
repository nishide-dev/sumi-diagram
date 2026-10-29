# #213: 中央寄せの align の 2 手先探索の検証

## 対象と手順

- 修正前: `5d5f2c8`。修正後: この変更の `src/layout/structured/align.ts`。
- macOS arm64、Bun 1.3.14、同梱フォント、固定版 D2。図の YAML・Theme・Profile は変更しない。
- `bun research/213-align-convergence/verify.ts before` / `after` を、それぞれの実装で実行した。結果は `.sumi/review/{before,after}-{hashes,timings}.json`（ローカル検証用、git 管理外）。スクリプトは全入力を並べ替え、書かれた Theme（own）と `minimal` / `academic` / `slides` / `color` / `paper` で `renderFigure()` を実行する。画像の基準ディレクトリは YAML の親。SVG の UTF-8 バイトの sha256 と診断の code・severity・path を記録する。
- 入力はリポジトリの全 `*.sumi.yaml` 138 個（依存・git・作業用ディレクトリを除く）。各版 828 ケース、描画成功 562、入力の検証などで失敗 266。失敗を成功した描画として数えない。

## 互換性

成功した **556 / 562 件は SVG の sha256 が完全一致**。失敗 266 件の診断も一致。変更は下記 **1 ファイル × 6 設定**だけで、すべて修正前に `layout/unsatisfied-align` があった。

`research/185-acceptance/repro/align-residual.sumi.yaml`:

| Theme | 修正前 sha256 | 修正後 sha256 |
| --- | --- | --- |
| own（paper）/ paper | `9dd84e2bb485f32ad0648f46a19c138adf950e3012340bc7d17068049decfbde` | `b43c01b74106f07fd583e7773d205333f19fa42136341a039b5b140aca40fe2d` |
| minimal | `e8222ff980ac3f3bbd546852361b92e5f8409f396e8cb30b09d954c548c02dab` | `c188071b9b3bd5273d8239da65d9640906898f45d440692aad19476957807c16` |
| academic | `b5fcede17948bd5aba3a6dd27b092ffc5aeab2abca4caa793612342f1c1353fd` | `dfc03d2b0872dab6cca1792c731a88ef04eb89d82bb7a4f50d4f5ceadbdfdef0` |
| slides | `69b345a953eb851f3146010c2e9eff224077c3a2974ac8e743c136f66f623e98` | `0a21454b3b3050beb3d16ddb86159702ddf71c1ed42ef76b296368f5811ccf18` |
| color | `6079704ef3daa799e0d65dcd4eaf281dfbdfbd5ff9bed047d4c8f2462bea27c6` | `d9cc0fc26106dd124605c4e91d5f96198f807bd5d6d5970934457746ccbeac48` |

変更理由は、貪欲探索の停止時に補助探索が完成した改善組を見つけ、許容値内に収束したため。全設定で警告が消える。slides は従来の `layout/align-grew-figure`（info）を引き続き出す。own / paper は診断なし。正常に収束していた既存の図・ギャラリー・golden に変更はない。

## 配置・solver の時間

IR は計測前にコンパイル。`placeStructured()`（葉の計測と整列を含む。YAML 検証・ルーティング・SVG 出力を含まない）を 5 回ウォームアップ後、21 回の中央値を取った。ファイルの fixture は同梱フォント、合成ケースは `align.test.ts` と同じ決定的な文字幅で測る。時間は観測値であり、テストの閾値にはしない。

| ケース | 修正前 ms | 修正後 ms | 反復 / 配置（前 → 後） |
| --- | ---: | ---: | --- |
| align-unet | 0.533 | 0.559 | 1 / 7 → 1 / 7 |
| align-side-kv | 0.545 | 0.521 | 1 / 3 → 1 / 3 |
| #151 align-grows-figure | 1.265 | 1.237 | 14 / 29 → 14 / 29 |
| #213 align-residual | 4.201 | 5.524 | 10 / 56 → 12 / 73 |
| 不可能な制約 250 個（2 node） | 48.859 | 69.732 | 1 / 1000 → 1 / 1000 |
| 揃った 100 制約 + 1 制約（5 node） | 0.171 | 0.177 | 1 / 3 → 1 / 3 |
| seed 132 のランダム 40 ケース（各 18 node、1–4 制約）: 各中央値の合計 | 25.190 | 68.342 | 配置数の範囲 3–21 → 3–93 |

再現の残差は `[0.007, 0.006, 0.077]` → `[0.008, 0.006, 0]`。`align: start` の回避策は引き続き `[0, 0, 0]`。

ランダムの 40 ケースは `align.test.ts` と同じ LCG・候補順・gap: 0 の列を使う。35 ケースで配置数が増え、うち 8 ケース（0 始まりの 6, 7, 21, 26, 27, 34, 37, 39）で残差が変わる（すべて和は減少）。21 は全制約が収束し、それ以外はまだ満たせない制約の警告を維持する。補助探索でも解けない制約では試行の費用がかかるが、既存の 1,000 配置の上限を越えない。250 制約では以前の診断用の調べの代わりに補助探索が予算を使うため、配置数が同じでも全制約の残差を評価する分の時間が増える。

## 回帰検査

`align.test.ts` は収束と実座標、fallback の決定性、fallback の両手の途中での予算切れ、完成した改善組だけの採用、不可能な制約での warning の維持を検査する。独立した callback の呼び出し数と solver の統計を比較し、診断の調べを含めたすべての配置が予算に入ることも確認する。

最終チェックはすべて成功:

- `bun run check` — 381 ファイル、変更不要。
- `bun run typecheck`
- `CI=1 bun test` — 2,794 pass / 13 skip / 0 fail、117 ファイル。既存の研究用 prototype の固定パッチが現行ソースに適用できないケースなどは従来どおり skip。
- `bun run gallery:check` — 155 ファイルが最新。
- `bun run schema:check` — schema が最新。
