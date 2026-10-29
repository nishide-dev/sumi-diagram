# #233 LoRA の 2 台形の受け入れ確認

`research/188-badges-emoji-bowtie/c-h3world.sumi.yaml` のコピー。
2 個の LoRA に `props: { gap: 8 }`（4pt）を追加し、左が中央へ細くなり、
右が外へ広がる 2 枚の台形にした。ラベル・バッジ・内容と接続は維持する。
非公開の原図そのものは参照せず、Issue とユーザーの説明に従った。

## 再現

画像は #185 と同じ合成の仮画像を `assets/` にコミットしてある（#235）。
SVG/PDF/PPTX は gitignore。PNG の縮小には ImageMagick が必要。

```sh
bun src/cli/index.ts fmt research/233-lora/c-h3world.sumi.yaml
bun src/cli/index.ts lint research/233-lora/c-h3world.sumi.yaml
bun src/cli/index.ts render research/233-lora/c-h3world.sumi.yaml
bun research/233-lora/preview.ts
```

- paper / paper-double、180 × 125.71mm、85.3% scale。
- lint: 0 errors / 0 warnings / 0 infos。
- render: 0 errors / 0 warnings / 1 info（既存の縮小した添字の `geometry/script-too-small`）。
- `previews/c-h3world.png`: resvg（picture PPTX の PNG fallback）→ 幅 1200px、
  128 色に縮小し、100,542 bytes（150,000 bytes 未満）をスクリプトで確認した。
  左右の LoRA の gap、1 個ずつのラベル、角バッジ、辺端、周辺の文字を目視確認。
- gallery の paper の bowtie と trapezoid も rasterize し、全 variant の接合・
  分離した形と north/east/west の向きを目視確認した。

## 互換性・自動検証

変更前の追跡済み `*.sumi.yaml` 149 個を各図の指定 Theme と全 5 組み込み Theme
で実行し、同じファイル一覧で変更後に比較した（894 組）。613 組が描画成功し、
SVG・PDF・picture PPTX・editable PPTX（freeform）・D2（auto のみ）の sha256
はすべて一致した。残る 281 組は不正 fixture、追加 registry が必要な fixture、
旧研究図の route 制約・未配置 assets・Theme/Profile 不一致などで生成できず、
変更前後の診断コードがすべて一致した。比較データは作業ディレクトリ内の
`.sumi/compat-233-{before,after}.json` に保存した。

新しい図と意図的に拡張した gallery はこの比較から除外。
golden は `bun run gallery` と
`SUMI_UPDATE_GOLDEN=1 CI=1 bun test src/render/pdf src/render/pptx src/render/assets.integration.test.ts`
で再生成し、変更対象が bowtie / trapezoid の gallery に限られることを確認した。

設計判断・API・ports・editable PPTX の説明は `docs/design/phase1.md` §6.66。
辺の anchor は gap 内なら最寄りの口へ移し、gap 自体は他の辺に対する障害物とする。
バッジ付き図の editable PPTX は #188 の既存制約どおり対象外で、picture PPTX を使う。

最終結果: `bun run check`、`bun run typecheck`、`CI=1 bun test`
（3145 pass / 13 skip / 0 fail）、`bun run gallery:check`、
`bun run schema:check`、`bun run emoji:check` がすべて通過した。
