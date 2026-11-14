# 495: html の太字等幅テキスト

## 症状

`html` コンポーネントで `font-family:var(--sumi-mono)` と `font-weight:bold` を併用すると、PDF などをラスタ化したとき i / j の点が軸に潰れ、`figure.sumi.yaml` が `f|gure.sum|.yaml` のように見える。

## 原因

同梱の等幅フォント (BIZ UDGothic) には Regular しかない。Takumi は太字を合成するとき、字形の輪郭に `fill` と同色の `stroke` (幅 = font-size / 25) を付けて太らせる。stroke は全方向に広がるため、点と軸の間の細い隙間 (14px で約 1.0px) が埋まる。Regular を weight 700 として登録しても Takumi は字形本来の weight で合成を判断するため、合成は止まらなかった。

## 決定

Takumi の SVG 出力のうち合成太字の `<path>` を、輪郭を左右に stroke 幅の半分ずつずらして 2 回描く形に置き換える (`src/assets/html-bold.ts`)。軸は stroke と同じ太さになり、縦方向には広がらないので点の隙間が残る。SVG / PDF / PPTX は同じ正規化済み SVG を使うため同じ効果になる。

### 合成太字の判定規則

属性は順不同で読み取り、次をすべて満たす `<path>` だけを対象にする。

- `fill` が `none` でなく、`stroke` が同じ値 (色)
- `fill-opacity` と `stroke-opacity` が等しい (半透明色 `rgba()` でも対象)
- `stroke-width` が正で、`stroke-dasharray` / `-dashoffset` / `-linecap` / `-linejoin` / `-miterlimit` を持たない

背景と枠線は fill のみ、または `fill="none"` の (破線・点線は dasharray 付きの) パスなので該当しない。stroke 幅が font-size/25 であることまでは検査していない (font-size が SVG に残らないため)。置き換え後は path 側の `transform` を保ち、半透明は二重に重ならないよう `<g opacity>` にまとめる。

## 却下した案

- 太字を無効にする (Regular で描く): 強調が失われる。
- BIZ UDPGothic Bold を等幅の太字に使う: プロポーショナルなので桁揃えが崩れる。
- 等幅 Bold フォントの追加: 配布サイズとライセンスの負担が増える。
