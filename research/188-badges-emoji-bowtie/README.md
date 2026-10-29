# #188 H3-World 受け入れ確認

`research/185-acceptance/figures/c-h3world.sumi.yaml` のコピー。内容・接続は維持し、
LoRA 2 個を bowtie + fire badge、QKV / Out Proj を snowflake badge に置き換えた。
原図（非公開）は参照していない。preview は PPTX の PNG fallback と同じ resvg 経路で
縮小したもの（136,568 bytes）。PDF の Poppler raster も比較し、多色・輪郭・位置を目視した。

再現時は `research/185-acceptance/figures/assets/` をこのディレクトリの `assets/` に
コピーしてから、次を実行する（assets と生成物は gitignore）。

```sh
bun src/cli/index.ts fmt research/188-badges-emoji-bowtie/c-h3world.sumi.yaml
bun src/cli/index.ts lint research/188-badges-emoji-bowtie/c-h3world.sumi.yaml
bun src/cli/index.ts render research/188-badges-emoji-bowtie/c-h3world.sumi.yaml
bun src/cli/index.ts render research/188-badges-emoji-bowtie/c-h3world.sumi.yaml -o research/188-badges-emoji-bowtie/c-h3world.pdf
bun src/cli/index.ts render research/188-badges-emoji-bowtie/c-h3world.sumi.yaml -o research/188-badges-emoji-bowtie/c-h3world.pptx
```

結果: paper / paper-double、180 × 124.88 mm、84.7% scale。
0 errors / 0 warnings / 1 info（縮小した添字の `geometry/script-too-small`）。
設計と全テーマの互換性検証は `docs/design/phase1.md` §6.62。
