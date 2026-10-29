# #216: tokens の点線の区切り

`c-h3world.sumi.yaml` は #185 の受け入れ図の写し。`seq` の `adots` と
`i0`、`bt` の `a3` と `i0` の間に次のセルを加えた。

```yaml
- { id: av, separator: dotted, tone: gray }
```

原図は非公開で参照できないため、Issue の説明と既存の写しに従った。
`assets/` は #185 の既存のプレースホルダー画像を複製したもの。

リポジトリのルートで `bun research/216-token-separator/render.ts` を実行すると、
fmt → lint（幾何を含む）→ SVG / PDF / PPTX → PDF から PNG の順に再生成する。
`pdftoppm` と `magick` が必要。生成物は gitignore した `out/` に置く。
`previews/c-h3world.png` だけは 150KB 未満にしてコミットする。

目視結果: 両方のトークン列で紫の A と灰色の I0 / 橙の V の間に点線があり、
トークンへの辺・パネル・文字を妨げない。180 × 120.87mm、scale 0.8197、
error / warning 0。元からある小さな数式の添字の info 1 件を保持する。
構文と出力の判断は `docs/design/phase1.md` §6.65（in the repository）。
