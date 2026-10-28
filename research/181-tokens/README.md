# #181 セルの並び（`component: tokens`）の確認

[Issue #181](https://github.com/nishide-dev/sumi-diagram/issues/181)、設計 [§6.50](../../docs/design/phase1.md)、調査 [#167 §4.5](../../docs/research/167-stage-c.md)。

1 セルずつのノードで書いていたトークン列・キーの並びを `component: tokens` に書き換え、書き下した版と同じ Layout IR になることを確かめる。元の図（`research/167-stage-c/`・`research/151-dogfood-v0.5/`）は変更しない。

| パス | 内容 |
| --- | --- |
| `rewrite.ts` | 元の図からセルのノードを tokens に置き換えた写しを `figures/` に書く（他は変えない） |
| `figures/c-h3world.sumi.yaml` | #167 の図 C（H3-World）の写し。`seq`（14 セル）・`bt`（9 セル）・`ct`（9 セルの縦の列、`id` なしで位置の鍵）と、キーの並び 10 個（`k<n>-move: lines [[W], [A, S, D]]`・`k<n>-look: lines [[I, F], [J, K, L]]`。押したキーはセルの `tone`） |
| `figures/vit-input.sumi.yaml` | #151 の ViT の写し。位置とパッチのトークンの組 5 つ（`tok<i>`: `cells: [{ id: pos }, { id: x }]`、`gap: 0`） |
| `figures/assets/`、`figures/*.png` | 元の図の画像の写し（画像の `src` は図のディレクトリの外を指せないため） |

## 結果

`src/render/tokens.integration.test.ts` が検査する。

- Layout IR: セルの予約 ID を書き下した ID に写すと（`k0-move-3` → `k0-s`、`ct-5` → `ct-4`、`tok1-x` → `t1`。`seq-*`・`bt-*` は同じ ID）、2 図とも元の図と一致する。要素ごとの SVG の markup も一致する。
- 診断: C は `geometry/exceeds-page-width` 1 件が同じで、`lint/empty-label` が 90 → 81 件（`ct` の空のセル 9 件が消える。残りは行列のセル）。ViT は元と同じ（0 件）。
- 書く量: C のセルのノード 77 個（キー 45・トークン 32）が tokens ノード 13 個に、ViT の 10 個が 5 個になった。

## 再現

```sh
bun research/181-tokens/rewrite.ts
bun src/cli/index.ts lint --geometry research/181-tokens/figures/*.sumi.yaml
bun test src/render/tokens.integration.test.ts
```
