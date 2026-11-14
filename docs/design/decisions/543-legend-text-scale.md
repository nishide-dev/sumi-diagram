# 543: 凡例の見本を textScale に従わせる

## 背景

凡例の見本（線・箱・集合）の大きさと間隔は、テーマの `sumi/label` の文字サイズと見本の線のスタイルから決まる。展開処理（`expandLegends`）は組み込みテーマをそのまま引いており、`themeOverrides.textScale`（#514）を掛けた後のテーマを見ていなかった。そのため `textScale: 2` では文字と線だけが 2 倍になり、見本の長さ・箱・間隔は元の大きさのままだった（#538）。

## 決定

`expandLegends` が使うテーマを `figureTheme(テーマ, figure.themeOverrides)` に通す。`textScale` 以外の `themeOverrides`（パレット・色調）も同じ経路で効くが、寸法には影響しない。

- 見本の寸法（`LEGEND_EM` を文字サイズに掛けたもの）は、倍率を掛けた文字サイズから出る。見本・箱・見本と文字の間・行間は、ほぼ倍率に比例する。文字サイズも寸法も 0.5pt（D2 の 1 unit）に丸めるので、厳密な比例ではない（グリフの見本は丸めで 1.8 倍以上になる程度の差が出る）。
- 破線の見本の線の長さは、倍率を掛けた線の太さと矢じりから出す。破線の周期は線の太さに依存する（太さに応じた対数的な係数を持つ）ため、周期は厳密に倍率倍にならず、見本の線に入る周期の数も倍率 1 と完全には一致しない。受け入れ条件は「破線に見える」ことで、周期が 1 つ以上入る長さを保証する。

倍率が省略または 1 で、`textScale` 以外の `themeOverrides` もない図は、`figureTheme` がテーマ自身を返すので出力は変わらない。この点は、変更前（origin/main）で生成した SVG の sha256 を `tests/fixtures/legend-scale/svg-sha256.json` に固定して確かめる（node・実線/破線の edge・set・glyph・icon の見本を含む `all-samples.sumi.yaml`）。`LEGEND_EM` の値は変えない。
