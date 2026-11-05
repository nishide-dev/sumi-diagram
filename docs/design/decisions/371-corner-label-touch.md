# #371 attach したラベルの接触を label-collision で報告する

## 背景

ノードの角（`north-east` など）や横に `attach` したラベル同士が、重ならずに接しても診断が出なかった。
原因は `geometry/label-collision` が、行の箱の重なりが許容（1 unit = 0.5pt）を超えたときだけ報告するため。
許容は D2 の丸めで「ちょうど接する」幾何を問題にしないためのもので、手で置く attach ラベルでは
`se-a` の隣に `x`（gap 0）と置くと文字が続いて読めるのに、箱は接するだけで見逃していた。

## 決定

- 組の少なくとも一方が `attach` したノードのとき、重ならない場合でも行の箱の間隔が両軸とも
  `LABEL_TOUCH_UNITS`（2 unit = 1pt）未満なら、同じ rule `geometry/label-collision`（warning）で
  「The label of A touches the label of B.」と位置つきで報告する。重なりは従来どおり "overlaps"。
- attach していない要素どうしの判定は変えない（誤検出を避ける）。
- 新しい rule は足さない。要素の組ごとに 1 件の規則はそのまま。

## 互換性

リポジトリの全 `*.sumi.yaml`（research/ と c-h3world を除く）を各 built-in テーマで render し、
geometry 診断の出力が変更前と同一であることを確認した。出力ファイルは変わらない。
