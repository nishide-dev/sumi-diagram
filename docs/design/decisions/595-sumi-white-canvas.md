# #595 sumi テーマの白いキャンバス

## 背景と決定

`sumi` のキャンバスはクリーム色（#f8f8ee）で Web では映えるが、紙・PDF・スライドに貼ると色付きの箱になり図として扱いにくい。既定の背景を白にする。

- `sumi` のキャンバスを #ffffff にする。`sumi-dark` は明るい文字と線を前提とするため変えない。
- 透過は従来どおり `figure.background: transparent` で選ぶ（#479）。
- キャンバスを替える手段として `figure.themeOverrides.canvas`（`#RRGGBB`）を足す。クリーム色に戻すには `"#f8f8ee"` を書く。`transparent` や色名は `schema/invalid-value`。

## 上書きの実装

`figureTheme()` の最初の段で、テーマを上書きしたキャンバスで作り直す。パレットの変種・色調・cuboid の陰影・集合の重なり・dim・コントラスト計算はすべて `theme.canvas` から導くので、後続の段は上書き後の値を読む。

- `sumi` / `sumi-dark`: 定義（`sumiTheme(dark, canvas)`）をそのキャンバスで作り直す。ノードの塗り、凡例、emphasis の文字色などキャンバスに従う色が付いてくる一方、吹き出しの白のようにキャンバスと無関係な色は動かない。このため、クリーム色の上書きは #595 より前の `sumi` の SVG と（メタデータを除き）バイト単位で一致する。
- ほかのテーマ: キャンバスと同じ色を持つ値（トークン、base、components、tones、toneLines）だけを置き換える。
- テーマ ID だけを持つ箇所（lint の stroke-contrast / composite / color-harmony / color-use、SVG の finalize、editable PPTX）は `figureCanvas()` / `canvasTheme()` で上書きを読む。
- 画像 PPTX は SVG のメタデータだけを読むため、上書き時と `sumi` の図には `<sumi:render canvas="#rrggbb">` を記録する（省略可。ほかのテーマの既存 SVG のメタデータは変わらない）。`canvas` のない `sumi` の SVG は白くなる前（sumi-version < 0.19.1）の描画なので、画像 PPTX のマスターはクリーム色（#f8f8ee）を保つ。

## 影響

- `sumi` を使う図の既定が白になる。生成物（ギャラリー、Skill のベースレイアウトと PNG・previews.json、ゴールデン）を作り直した。`sumi` を使わない図、論文の再現図（examples/）の出力は変わらない。
- `sumi` の淡いトーン、パネル（#efeddd）、グループの色は変えない。白の上でも `lint --geometry` の診断は変わらなかった（Skill のベースレイアウト 30 件と README 図で、`color-on-panel` の件数を含め同じ。1 件は箇所の数え方が減っただけ）。
- Pages サイトは `sumi` のプレビューをクリーム色の台に載せる見た目を保つ。`sumi` の台の色とプレビューの描画だけがサイト側の値（`SITE_CANVASES`）で決まり、ほかのテーマは従来どおり `getTheme(t)?.canvas` を読む。サイトに表示する YAML には上書きを含めない。
- README の図（`docs/assets/architecture.sumi.yaml`、透過）は変えない。HTML カードの `--sumi-bg` がキャンバスに従うため、ギャラリーのスクリプトがライト版の描画だけ `themeOverrides.canvas: "#f8f8ee"` を足して描く。図の見た目は変わらないが、SVG のメタデータ（入力のハッシュと `canvas`）は変わる。

## 採らなかった案

- `sumi` の淡い色も白に合わせて作り直す: テーマの個性を変える変更が大きく、受け入れ条件（lint が悪化しない）を超えるため見送った。
- キャンバスと同じ色をすべて置き換える方式を `sumi` にも使う: 吹き出しの白までクリーム色になり、従来の見た目に戻せないため、定義からの作り直しにした。
