# #176 拡大の引き出し線（`component: zoom`）の確認

[Issue #176](https://github.com/nishide-dev/sumi-diagram/issues/176)、設計 [§6.45](../../docs/design/phase1.md)、調査 [#167 §4.3](../../docs/research/167-stage-c.md)。

#167 の図 B（DiT）と図 C（H3-World）の写しで、代用の破線 2 本（`fromAnchor: "east:0"` → `toAnchor: "west:0"` の `line`）を `component: zoom` の 1 本に書き換えた。他は変えていない。#167 の記録（`research/167-stage-c/`）は変更しない。

| パス | 内容 |
| --- | --- |
| `figures/b-dit.sumi.yaml` | 図 B の写し。DiT Block → adaLN のパネル（右） |
| `figures/c-h3world.sumi.yaml` | 図 C の写し。(b) の Self-Attention → (c) のパネル（右）。`gen-c.ts` ではなく手で書き換えた |
| `figures/assets/` | 図 C のフレーム画像（`research/167-stage-c/figures/assets/` の写し。画像の `src` は図のディレクトリの外を指せないため） |
| `previews/*.png` | 2 図の PDF を 200dpi で PNG にし、64 色に減色したもの |

## 結果

`sumi lint --geometry` の結果は元の図と同じで、zoom の辺についての診断は 0 件（`src/render/zoom.integration.test.ts` が検査する）。

| 図 | 診断 |
| --- | --- |
| B | `geometry/exceeds-page-width` 1（257mm。元の図と同じ） |
| C | `geometry/exceeds-page-width` 1（232.48mm）、`lint/empty-label` 90（元の図と同じ） |

どちらも線は角どうしを結ぶ斜めの破線になり、パネルの枠に重ならない（#167 の B-4・C-10）。

## 再現

```sh
bun src/cli/index.ts lint --geometry research/176-zoom-edge/figures/*.sumi.yaml
bun src/cli/index.ts render research/176-zoom-edge/figures/b-dit.sumi.yaml -o /tmp/b-dit.pdf
pdftoppm -r 200 -png -singlefile /tmp/b-dit.pdf /tmp/b-dit
magick /tmp/b-dit.png -colors 64 research/176-zoom-edge/previews/b-dit.png
```
