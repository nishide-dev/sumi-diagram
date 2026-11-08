# #421 LLaDA 概観図の再現と、集合の構成要素としての tokens

## 背景

LLaDA（arXiv:2502.09992）の Figure 2 を、密度と配色の基準となる例として再現した（`examples/llada`）。3 つのパネルにトークンのセル列、マスクのセル（×）、灰色の Mask predictor、短い矢印、括弧、破線の囲み、時間の矢印を密に並べ、文字は最小限である。以前の図は余白が多く、要素が小さく、文字が多すぎると評価されたため、構成・密度・比率・間隔を元の図に合わせることを目的にした。

## 決定

- 配置は 1 つの `place` で行い、`unit` を元画像の 1 px（0.3113pt。53 px のセルが 16.5pt の tokens セルになる）にした。要素の中心を元画像で測り、そのまま `at` に書く。セルの幅、間隔、キャンバスに占める割合が元の図に従う。`fit: scale` で 180mm に縮める（倍率 85.8%）。
- セルの色は元画像から取った 12 色。tone は 8 つで、1 つの tone は淡い色（`fill`）と濃い色（`line`、`solid` セルの色）の 2 色を持つので、`themeOverrides.tones` を元の色に置き換えて割り当てた。`green` の solid が濃い灰色、`pink` の solid が薄い灰色になるなど、tone の意味は図の中で付け替えている。
- マスクのセルは SVG の素材（`assets/mask.svg`、`figure.assets`）にした。短い矢印は、両端に置いた不可視の junction 同士の `route: straight` の辺にした（辺は両端の要素の間隔より短くできないため）。点線の矢印は `dashed`、破線の囲みと凡例の枠は `sets`（`shape: rect`）にした。
- 小さな修正: 集合の構成要素に tokens ノードの ID を書くと、枠を持つ「全体」として扱われず、レイアウトで `internal error: n:<id> was not placed` になった。`wholeReferences` に集合の `members` を加え、枠を持たせた（`src/core/figure/tokens.ts`、回帰テストは `tokens.test.ts`）。

## 採らなかった案

- 「Sumi に足りない機能を先に実装する」: 本 issue では実装せず、不足は PR の「不足している機能」に記録する。
- 凡例を `legend` で作る: 見本の線が横向きで、元の縦の点線矢印にならない。

## 互換性

集合の構成要素に tokens ノードを書いた図だけが変わる（それまでは内部エラーで描けなかった）。ほかの図の SVG・PDF・PPTX・D2 の出力は変わらない。
