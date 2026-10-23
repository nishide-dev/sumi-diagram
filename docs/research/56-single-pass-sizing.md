# #56 カスタム部品のサイズ決定を1パス化できるか

対象: [#56](https://github.com/nishide-dev/sumi-diagram/issues/56)。前提は #18 の[輪郭調査](18-custom-svg-components.md)と #52〜#55 の実装。

## 0. 判断

**1パスで安全なサイズを作る見込みはある。ただし、今回は現行の2パスを維持する。**

- 固定 D2 の文字計測を近似しただけでは、現在の出力とのバイト一致を維持できなかった。100件中24件だけが一致し、空ラベル12件もこの中に含まれる。
- 実際に描くフォントでサイズを作り、次数の制約を renderer に渡す前に適用した候補は、測定した100件で診断ゼロだった。1ノードのベンチマークでは D2 呼び出しが2回から1回になり、時間はおおむね半分になった。
- しかし、その候補でも100件中88件の出力が変わり、辺の経路・コンテナ・ページサイズも変わる。空行のあるケースでは面積が増える。現在の計測・安全領域の契約に対する、単なる高速化としては採用しない。
- この調査は、完全な D2 文字計測の移植が不可能だと示すものではない。将来、出力変更を許容する小型化モードを設計する場合の根拠とする。別の採用判断では、より広い文字・グラフの検証と新しい出力のレビューが必要。

## 1. 固定版 D2 の確認

測定環境: 2026-10-23、macOS 26.2 / arm64、Bun 1.3.14、Sumi の製品実装は `da1b124`、D2 v0.9.0、同梱 BIZ UD Gothic v1.051（report に3ファイルの sha256 を記録）。追加のランタイム・外部フォントは使わない。

上流タグ v0.9.0 の参照先を GitHub API で解決し、ソースは commit [`d5a51743b6d5c00f1ec6f8340003f5d5a6ba4eda`](https://github.com/d2lang/d2/tree/d5a51743b6d5c00f1ec6f8340003f5d5a6ba4eda) を確認した。ソースを実行時にダウンロードすることはない。

| 段階 | 固定版の根拠 | 意味 |
| --- | --- | --- |
| node の label 計測 | [d2graph.Object.Text / GetTextDimensions](https://github.com/d2lang/d2/blob/d5a51743b6d5c00f1ec6f8340003f5d5a6ba4eda/d2graph/d2graph.go) | 通常の非コンテナ・非 text ノードは既定で bold として計測される。Sumi が style.bold=false を出しても、この計測の isBold は false に戻らない |
| 矩形の余白 | 同ファイルの INNER_LABEL_PADDING / SetDimensions と [shape の defaultPadding / GetDimensionsToFit](https://github.com/d2lang/d2/blob/d5a51743b6d5c00f1ec6f8340003f5d5a6ba4eda/lib/shape/shape.go) | 自動サイズは inner label 5 + shape padding 40、合計45 user unitを各寸法に加える（片側45ではない）。空ラベルは既定100×100 |
| 文字の箱 | [textmeasure.MeasurePrecise / scaleUnicode / controlRune](https://github.com/d2lang/d2/blob/d5a51743b6d5c00f1ec6f8340003f5d5a6ba4eda/lib/textmeasure/textmeasure.go) | hinted な字形の bounds・文字送り・行送り・tab・Unicodeの近似を含む。Sumi の advance 合計の再計測とは目的が違う |
| エッジ数による拡大 | [d2elklayout の degree / port_spacing](https://github.com/d2lang/d2/blob/d5a51743b6d5c00f1ec6f8340003f5d5a6ba4eda/d2layouts/d2elklayout/layout.go) | incoming / outgoing の最大が2以上なら、左右向きは高さ、上下向きは幅を最大次数×40まで拡大する（その軸が明示済みならこの拡大はしない） |

座標は D2 / SVG user unit、1 unit = 0.5pt。D2 の45 unitの余白と Profile のノード間隔・コンテナ余白は別の値である。

## 2. 比較した方式

実装と再現方法は [`research/56-single-pass/`](../../research/56-single-pass/README.md)。測定スナップショットは [`results/report.json`](../../research/56-single-pass/results/report.json)。研究用の候補を製品から呼ばない。

| 名前 | 測定・サイズ計算 | D2呼び出し |
| --- | --- | --- |
| `two-pass` | 現行 renderFigure。1回目の自動矩形（余白・次数による拡大を含む）を renderer.footprint() へ渡す | 2 |
| `d2-approx` | bold の advance 合計、East Asian wide な書記素はおよそ1.25em、tabはspace4個のstop、行頭末尾の空白・空行をtrimした行数×font-size、45 unitの余白。次数の制約を先に適用し footprint() | 1 |
| `compact` | 描画する regular / bold の advance と SVGと同じ空白畳み。高さは行数×font-size。各軸合計16 unit（片側8）の余白から footprint() を作り、最後に次数の寸法制約を適用 | 1 |
| `compact-aware` | compact と同じ文字の箱だが、**次数の制約を先に文字の箱へ適用してから footprint()** | 1 |

`d2-approx` は ink bounds / hinting / 26.6固定小数点・全Unicodeや行高の完全な再現ではない。`compact` の16 unitも製品の最適値として決めたものではなく、今回の候補の条件である。空ラベルは全候補で D2 の100×100の既定を尊重する。

候補も生成した IR / D2 を backend へ渡し、finalize → inspect → compose → inspect → 幾何 lint を通す。Sumi の renderer・stroke・フォント・ラベル移動・端点延長は変えない。文字を縮小してはみ出しを回避する方式ではない。

本メモの診断件数は描画パイプラインと幾何 lint のもの。構造 lint は比較に含めず、例えば空ラベルに対する `lint/empty-label` はこの集計の対象外とする。

## 3. コーパス

計100件、各4方式の400出力。

- **84件**: 3テーマ × default / emphasis × 台形 / stack × 7ラベル。ラベルは `Filter`、`入力データ`、`Filter\n日本語`、`\nmiddle\n`、`A     B`、`A\tB`、空文字。
- **16件**: academic / default の台形 / stack × 4方向 × 入力エッジ2本 / 6本。対象ノードはコンテナの中。ラベルは `Filter`。
- 描画した文字サイズは16 / 32 unit。muted、italic / mono、未同梱フォント・欠落glyph、任意のfont-size、出力先Profileの全組合せ、逆向きエッジ、出力側の多入力相当、自己ループや閉路を含む全グラフは今回の比較対象にしていない。
- この調査の測定は macOS arm64 のみ。Linux の実測や、全OSでの候補のバイト一致を主張しない。

## 4. 実測結果

### 4.1 集計

面積比は各ケースの最終 footprint 面積を、同じ入力の two-pass で割った値。表の一致数は SVG 全体の sha256 の一致（footprint 一致数も同じ）。

| 方式 | 同じ SVG / 100件 | 描画・幾何診断のある件数 | footprint 面積比の中央値 | キャンバス面積比の中央値 |
| --- | --- | --- | --- | --- |
| two-pass | 100 | 0 | 1.0000 | 1.0000 |
| d2-approx | 24 | 0 | 1.0054 | 1.0036 |
| compact | 12 | 4（label-overflow） | 0.4575 | 0.6135 |
| compact-aware | 12 | 0 | 0.4639 | 0.6135 |

compact-aware の footprint 面積比は最小0.2587、最大1.4610。中央値では約54%小さくなるが、常に小さくなる方式ではない。診断ゼロはこのコーパスに限る。

### 4.2 文字の計測と余白

| 条件 | 描画 regular の advance 幅 | bold の advance 幅 | D2の1回目の矩形 | two-pass の台形 | d2-approx の台形 | compact-aware の台形 |
| --- | --- | --- | --- | --- | --- | --- |
| minimal/default、Filter、16 unit | 46.727 | 48.320 | 93×61 | 142×61 | 143×61 | 89×32 |
| minimal/default、入力データ、16 unit | 77.281 | 77.602 | 144×61 | 193×61 | 194×61 | 119×32 |
| slides/default、入力データ、32 unit | 154.563 | 155.203 | 247×77 | 309×77 | 307×77 | 209×48 |

`Filter` は D2 の矩形から45を引いた幅48に対し、bold advance は48.320。ceilして余白を足すだけでは1 unit違う。日本語5文字は16 unitでおよそ99、32 unitでおよそ202として計測され、実際に描くフォントの77.281 / 154.563より大きい。単純な1.25emは近いが、hinting・bounds・文字ごとの近似を含む完全なモデルではない。

default と emphasis で描画フォントが変わるテーマでも、D2 の自動矩形が同じになることがある。一方、compact は実際のフォントを選ぶため、その違いがサイズに現れる。

### 4.3 次数の拡大と台形の失敗

| academic/default、Filter、コンテナ内 | two-pass | compact | compact-aware |
| --- | --- | --- | --- |
| 台形、right、入力2本 | 157×80 | 89×80、overflow | 127×80 |
| 台形、right、入力6本 | 285×240 | 89×240、overflow | 255×240 |
| 台形、down、入力6本 | 289×61 | 240×32 | 266×32 |
| stack、right、入力6本 | 109×256 | 79×240 | 79×256 |

left の台形も compact で同じ overflow になり、合計4件。footprint の高さを最後に増やすと、台形の斜辺の inset も増え、幅が89のままでは safeArea 幅が44.5になる。描画ラベルの約46.7 unitより小さくなるためである。次数の条件は最終寸法を後から clamp するだけでは不十分で、**renderer の幾何の依存関係に入れる必要がある**。

### 4.4 空白・空行の反例

`A     B` と `A\tB` は描画時には同じ畳まれた幅になるが、D2 の自動箱は異なる。`\nmiddle\n` の D2 の高さは空行の数×font-sizeではなく、今回のcompactモデルは高さを多めに見積もる。

slides/emphasis の空行付き台形は、two-pass の226×77に対して compact-aware が227×112となり、面積比が約1.461。単純な「1パス化＝すべて小さくなる」ではない。

## 5. 安全領域とサイズ削減の意味

- 現行は **D2の目に見えない45 unitの余白を含む箱**を、丸ごと renderer の safeArea に収める。安全だが、台形の斜辺分と stack の段差分を加えるため、大きくなる。
- 今回のcompact候補では、この余白の一部を「safeArea に入れる必要のない D2 の計測上の余裕」として扱い、実際の文字の箱＋16 unitだけを safeArea に要求した。`label.near: center-center` により D2 の外部ラベルへの移動を抑えていることが前提。
- 台形は上辺近くなどに実際の空きがあっても、safeArea は斜辺を避けた全高の矩形を使う。stack は前面1枚だけを safeArea とする。これらの定義自体は変更していない。
- 度数の拡大と台形の斜辺は連動する。コンテナ・ルーティングが変わるため、文字が収まるだけで全グラフの品質を保証したことにはならない。
- 安全矩形を広げたり、行ごとに台形の許容幅を変える方式は、renderer の safeArea と geometry lint の契約を変更する別案。今回の測定から黙って適用することはしない。

## 6. 性能と D2 更新リスク

最初の1ノード（minimal/default/trapezoid/Filter）を、ウォームアップ後、方式の順番を回しながら各5回測定した。compile・候補の寸法計算・backend・finalize・inspect・composeを含み、幾何 lint と出力ファイルの書き込みは時間に含めない。

| 方式 | 中央値 |
| --- | --- |
| two-pass | 887.91ms |
| d2-approx | 442.27ms |
| compact | 442.38ms |
| compact-aware | 446.84ms |

これは今回の1ノード・環境での値で、大規模グラフやCI上の性能保証ではない。D2 を1回減らすメリットは確認できた。

| 方式 | D2 更新時の主な依存 |
| --- | --- |
| 現行2パス | 実際の D2 の自動サイズと既存の SVG 契約。計測アルゴリズムは D2 自身に任せる |
| D2完全再現の1パス | 太字選択・hinted glyph/ink bounds・26.6丸め・Unicode grapheme / tab / 行高・45 unitの余白・空ラベル100・次数40・ELKの拡大条件を追従する必要がある |
| 実フォントによる小型化 | 文字送りは既存TTF計測を再利用できるが、D2の中央配置・行送り・次数・SVG合成への依存は残る。新しい出力のレビューと幾何 lint の検査が必要 |

採用するなら、診断ゼロだけでなく、追加のコーパス、全テーマ・variant・文字サイズ・mono/italic・複雑なグラフ、移行時の出力変更、Profileとの整合を検討する。通常の描画パスの既定は今回は変更しない。

## 7. 再現・成果物

```sh
bun run d2:install
bun research/56-single-pass/run.ts
```

詳細は [研究ディレクトリの README](../../research/56-single-pass/README.md)。`out/` の各 YAML を元に、同じbasenameの各方式のSVGと `report.json` を確認できる。保存した `results/report.json` は測定のスナップショットで、時間やOS依存値をCIのgoldenにはしない。

製品の source / renderer / safeArea / Profile は変更しない。今回の成果物は、再現スクリプト・測定結果・本メモと、関連 Issue に残す採否判断である。
