# 495: html の太字等幅テキスト

## 症状

`html` コンポーネントで `font-family:var(--sumi-mono)` と `font-weight:bold` を併用すると、PDF などをラスタ化したとき i / j の点が軸に潰れ、`figure.sumi.yaml` が `f|gure.sum|.yaml` のように見える。

## 原因

同梱の等幅フォント (BIZ UDGothic) には Regular しかない。Takumi は太字を合成するとき、字形の輪郭に `fill` と同色の `stroke` (幅 = font-size / 25) を付けて太らせる。stroke は全方向に広がるため、点と軸の間の細い隙間 (14px で約 1.0px) が埋まる。Regular を weight 700 として登録しても Takumi は字形本来の weight で合成を判断するため、合成は止まらなかった。

## 決定

Takumi の SVG 出力のうち、`fill` と `stroke` が同色の text パス (合成太字はこの形のみ) を、輪郭を左右に stroke 幅の半分ずつずらして 2 回描く形に置き換える (`src/assets/html-bold.ts`)。軸は stroke と同じ太さになり、縦方向には広がらないので点の隙間が残る。SVG / PDF / PPTX は同じ正規化済み SVG を使うため同じ効果になる。

## 却下した案

- 太字を無効にする (Regular で描く): 強調が失われる。
- BIZ UDPGothic Bold を等幅の太字に使う: プロポーショナルなので桁揃えが崩れる。
- 等幅 Bold フォントの追加: 配布サイズとライセンスの負担が増える。
