# #440 白地の配色: 不透明な set の塗り、白いパネル、色の濁りの lint

## 背景

論文の図の 3 回目の試行（2026-11-09）で、配置は良くなったが「色が汚い」と評価された。

- 灰色のパネルの上に半透明の set を重ねたため、塗りが灰色と混ざって濁り、重なりはさらに濁った。
- 灰色のパネルの背景自体が好まれない（TriCL の図も同じ）。エージェントが基準の図（TriCL）の灰色のパネルをまねた。
- `geometry/color-harmony`（[#423](423-tone-harmony.md)）は色相の数と明度・彩度のばらつきしか見ず、この濁りを検知できない。
- 良い手本は LLaDA（白地に少数の淡い調和した色）。

## 決定

### A. set の塗りは不透明にし、重なりは計算した色で描く

- 塗りは「tone の線の色を白に混ぜた色」を不透明で描く（`tintOver(ink, strength)`。`strength` は従来の不透明度の値: default・dashed は 0.2、filled は 0.28）。白の上では従来と同じ見た目で、灰色のパネルや別の set の上でも色が変わらない。`SetStyle.fill` が不透明な淡い色、`SetStyle.strength` が強さ（`fillOpacity` は取り除いた）。
- 重なる領域は、重なる set の淡い色の**乗算（白基準）**で描く（`multiplyTints`）。青と緑の乗算は両方の色相を残した暗い青緑になり、半透明の重ねが作る灰褐色にならない。
- 描く順は、すべての set の塗り → 重なり（2 つの重なり、3 つの重なりの順。深い重なりが上）→ 各 set の輪郭とラベル。後の set の不透明な塗りが前の set の輪郭を隠さず、メンバー（ノード）は set より上なので読める。
- 重なりの領域（`src/layout/set-overlap.ts`）は、set の外形（凸）の多角形を Sutherland–Hodgman で切って求める。面積 1 unit² 未満は接触とみなす。共通部分が 4 つの set を超える領域は 4 つ目までの色で描く。
- SVG（PDF・picture PPTX も同じ SVG から出る）: `g.sumi-set-fills` に set ごとの塗り（`.sumi-set-fill`）と、重なり（`.sumi-set-overlap`。他の set の形で入れ子の `clip-path` をかけたもの。`clipPath` の id は形の内容のハッシュ）を置き、`g.sumi-set` の `.sumi-set-shape` は `fill="none"` の輪郭だけにした。検査（`inspectSvg()`）は輪郭の形を読むので変わらない。辺ラベルの背景色（`backgroundAt()`）は塗りと重なりの色を数える。
- editable PPTX: 不透明な自由図形（塗りだけ）を set ごと、重なりの自由図形（多角形。曲線を標本化した折れ線で、頂点は set の外形と同じ標本）、塗りなしの輪郭の自由図形、ラベルのテキストボックスの順に書く。重なりの輪郭は多角形になる（曲線ではない）。`a:alpha` はもう使わない。
- `fillOpacity` は**意味を変えて残した**: 「塗りの強さ（tone の線の色を白に混ぜる割合）」で、透過ではない。`fillOpacity: 0.15` の図は、白の上で従来と同じ色になる。真の半透明は提供しない（灰色の上で濁る原因なので）。名前は変えず（スキーマの互換）、説明を直した。

### B. paper テーマのパネルは白

- `paper` の既定のグループは**白の塗りと 0.5pt の淡い灰色の枠**（`#b4b8c0`、角丸）にした。最初は従来の黒 1pt の枠にしたが、白地では硬く重く見えたため、ユーザーの選択（2026-11-09）で細い淡い灰色にした。塗りなし（transparent）にしなかったのは、`themeOverrides.groupFill`（TriCL・GCN が使う）が transparent の塗りには効かない契約で、白なら灰色などを明示したときに効くため。論文の再現図（transformer・dit-block など）は #441 で元の図の塗り・枠を明示して固定したので、この既定の変更では変わらない。clip はグループが `plain` なので変わらない。
- 灰色は明示したときだけ: `variant: filled`（薄い灰色、枠なし）、`themeOverrides.groupFill`、tone を付けたグループ。
- パレット（[#417](417-palettes.md)）: パレットの panel の色は、テーマが塗っているグループの塗りだけに効く。`paper` の既定のグループは白のままなので、パレットで全グループが灰色や薄い色になることはない。`filled` のグループと明示した `groupFill` がパレットの panel の色になる（オプトイン）。ほかのテーマ（`minimal`・`color` など）の既定のパネルはテーマの塗りのままで、この issue では変えない。

### C. lint（`src/lint/geometry/color-composition.ts`、`composite.ts`）

描かれる塗り（グループ・set・set の重なり・ノード）を描画順に背景へ重ね、最終の色を求める（`paintItems` / `analyze`）。塗りごとに、ほかの不透明な塗りに隠れない点を 4×4 の格子で標本にし、その下の色と最終の色を得る。

- `geometry/muddy-color`（**warning**）: 有彩色（own の OKLCH 彩度 0.03 以上）の塗りが、同じ塗りを白に置いたときと比べて、(1) 彩度の半分超を失う、(2) 明度が 0.06 以上下がって彩度 0.045 未満の灰色になる、(3) 色相が 30° 以上ずれて彩度 0.05 未満になる。set の重なりは、重なる set の最大の彩度の半分を下回るときだけ（乗算は暗くなるのが正常）。標本の半数以上で成り立つ塗りを、関わる要素の名前つきで報告し、直し方（白の上に置く・不透明な塗り・重なりを減らす）を hint に書く。
- `geometry/translucent-over-color`（**warning**）: 不透明度 1 未満の塗りが白以外の面（ΔE76 が白から 3 以上）の上にある。
- `geometry/color-on-panel`（**info**）: 白以外の塗りのグループが、有彩色（OKLCH 彩度 0.025 以上）のノードか set を 3 つ以上持つ。1〜2 個のアクセント（Llama 4 の shared expert、強調した 2 つの箱）は報告しない。
- 重大度: 最終の色を実際に合成して測る 2 つは信頼できるので warning。構成の傾向を見る `color-on-panel` は好みと意図に左右されるので info（`maxWarnings` に含めない）。
- 描画の仕組みが変わり set は不透明になったので、`muddy-color` と `translucent-over-color` が実際に出るのは、半透明の塗りが残るとき（テーマの `opacity` など）に限る。変更前の描き方は `paintItems(context, { translucentSets: true })` で再現でき、較正と試験に使う。

#### 較正

| 図 | `muddy-color` | `translucent-over-color` | `color-on-panel` |
| --- | --- | --- | --- |
| 試行 3（灰色のパネル＋半透明の set。変更前の描き方） | 6 | 9 | 2 |
| 試行 3 の同じ YAML（不透明な塗り） | 0 | 0 | 2（灰色の `groupFill`） |
| 試行 3 の `groupFill` を外したもの（paper の白いパネル） | 0 | 0 | 0 |
| `examples/llada`（変更前の描き方でも） | 0 | 0 | 0 |
| `examples/llama4-moe`（同上） | 0 | 0 | 0 |
| ほかの examples（自身のテーマ） | 0 | 0 | 0 |

リポジトリの全 `*.sumi.yaml`（research と非公開の図を除く）を自身のテーマと全組み込みテーマで検査し、`muddy-color` と `translucent-over-color` は 1 件も出ない。`color-on-panel` が出るのは、`llama` テーマで描いた paper 向けの図（薄いパネルに tone の箱）、`minimal`・`color`・`llama` で描いた `sparse-small-elements` の試験用図（`aacl` が 6 個）、灰色のパネルを持つ試験用図（`b-dit` 系。`adaln` が灰色）で、いずれも灰色や薄い色のパネルに色付きの箱が並ぶ図なので妥当と判断した。

### D. Skill

`skills/sumi/references/layout-tips.md`（視覚言語の「Colour and ground」、設計原則、批評のチェックリスト 4、paper の早見表）、`SKILL.md`（テーマの項に 3 行）、`examples/README.md`（LLaDA は配色の手本、TriCL は密度と構成の基準で配色の手本ではない）、`diagnostics.md`、`structured.md`、`figure-format.md`（パレットとパネル）、`docs/lint-rules.md`、`docs/themes*.md`、`docs/usage*.md`。

## 採らなかった案

- **`mix-blend-mode: multiply`**: PDF 変換（resvg）と PPTX が扱えず、出力ごとに結果が変わる。計算した色と clip で、全出力が同じになる。
- **グループを塗りなし（transparent）にする**: `groupFill` が効かなくなる。白の塗りは見た目が同じで、契約を変えない。
- **set の塗りに tone の塗り色（`tones`）を使う**: #407 で却下済み（モノクロのテーマでほぼ白になる）。
- **translucent のまま、下の面に合わせて色を補正する**: 下の面は配置後にしか決まらず、重なりでも変わる。不透明な淡い色なら下の面に依存しない。
- **`fillOpacity` の廃止・改名**: スキーマの互換を壊す。意味を「強さ」に寄せて名前は残した。
- **`color-on-panel` を 1〜2 要素から報告する**: Llama 4 のアクセント 1 つ、`llama` の強調した 2 つの箱（`outline-components` の試験）は正常で、誤検出になる。

## 互換性

白の上の set の見た目は変わらない（塗りの色は同じで、不透明になるだけ）。出力が変わる図は PR の本文に一覧した。

- set を使う図: `examples/llada`、`examples/tricl`（全テーマ）、set を使う試験用図。SVG の構造（`g.sumi-set-fills`、輪郭の `fill="none"`）が変わり、色は白の上で同じ。重なりは半透明の合成から乗算に変わり、わずかに色が変わる。
- paper テーマの既定のグループ: `examples/transformer`、`examples/dit-block`、paper で描いた自動レイアウトの図（`grouped`・`pipeline`・`system-architecture` を `--theme paper` で）、paper を使う試験用図。灰色のパネルが白になる。
- `geometry/muddy-color`・`geometry/translucent-over-color`・`geometry/color-on-panel` の追加で、診断が増える図がある（上記）。
- `paper` を使わない図、パレット・`groupFill` を書いた図のパネルは変わらない。

回帰テスト: `src/layout/set-overlap.test.ts`、`src/core/theme/set-style.test.ts`、`src/render/sets.integration.test.ts`（不透明な塗り・乗算の重なり・順序・PDF・editable PPTX・灰色のパネルの上でも同じ色）、`src/lint/geometry/color-composition.test.ts`（較正）。
