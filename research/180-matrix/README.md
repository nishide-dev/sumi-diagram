# #180 行列（`component: matrix`）の確認

[Issue #180](https://github.com/nishide-dev/sumi-diagram/issues/180)、設計 [§6.56](../../docs/design/phase1.md)、調査 [#167 §4.5](../../docs/research/167-stage-c.md)・[#86](../../docs/research/86-paper-figures.md)。

H3-World（利用者の図。コミットしない）の (c) の注意のマスクを、#177 の図（`research/177-outlined-tones/figures/c-h3world.sumi.yaml`。変更しない）では 81 個のセルの box・19 個の見出しの label・行ごとの row の group で書いていた。これを 1 つの `matrix` ノードで書き、凡例を行列の class から作る。

| パス | 内容 |
| --- | --- |
| `render.ts` | #177 の図から写しを `figures/` に書き、`paper` と `color` で描いてプレビューを作る |
| `figures/c-h3world.sumi.yaml` | 生成物（直接編集しない）。行列 `mask`（9 行の class の文字列、A は紫・V は橙の見出し、セルの間 1.5pt、`variant: filled`、Masked は `pattern: hatch`）、凡例 `mask-key` の項目は `{ class: mask.o }` など。(c) の左のトークンの列も #181 の `tokens` に書き換えた（`research/181-tokens` と同じ） |
| `figures/assets/` | #177 の画像の写し（画像の `src` は図のディレクトリの外を指せないため） |
| `previews/c-h3world.png`、`previews/c-h3world.color.png` | PDF → 200dpi → 64 色の PNG |

## 結果

`src/render/matrix.integration.test.ts` が検査する。

- セルの class は `render.ts` が #177 の box の tone から読む（green → `o`、orange → `L`、tone なし → `.`）。描いた SVG で、`o`・`L` のセルの塗りは #177 の同じ位置の box と同じ色で、`.` のセルだけが斜線を持つ（#177 では白い box だった）。凡例の Masked の見本も斜線。
- 診断: #177 の図の `lint/empty-label` 90 件（行列のセル 81・トークンの列 9）が 0 件になり、ほかは同じ（`paper` で `geometry/script-too-small` の info 1 件）。
- 書く量: 行列の 100 ノード（セル 81・見出し 18・角 1）と 10 行の row の group が、24 行の `matrix` ノード 1 つになった。図は 404 行 → 310 行。
- 見た目: 原図の Masked は枠のない淡い斜線のセル。`variant: filled`（灰色の塗り・枠なし）に斜線を重ねると原図に近い（`variant: outlined` に斜線では、枠が重く見えた）。原図のセルの間隔は `gap: 1.5pt`、見出しの色は `{ label, tone }` で書ける。原図の「Query」「Key」の回転した軸の見出しは書いていない（角の `Q / K` で代用）。

## 再現

```sh
bun research/180-matrix/render.ts
bun src/cli/index.ts lint --geometry research/180-matrix/figures/c-h3world.sumi.yaml
bun test src/render/matrix.integration.test.ts
```
