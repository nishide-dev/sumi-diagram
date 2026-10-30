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

## #245 の再確認（§6.68）

split bowtie のラベルを左台形内へ移し、片側に padding 済み文字幅を確保する
自動サイズで再描画した。YAML の変更は不要。上記の #233 時点の寸法に対して、
現在は 180 × 111.55mm、75.6% scale、0 errors / 0 warnings / 1 info
（既存の縮小された添字）。PNG は同じスクリプトで再生成し 89,732 bytes。
実際に画像を開き、左右の LoRA が各 1 ラベルを左台形内に持ち、gap・輪郭と
重ならず、火のバッジ・辺端・行列・凡例・周辺ラベルも保たれることを確認した。
全 5 Theme × 全 variant の bowtie gallery も PNG 化して確認した。

互換性検査は既存 150 YAML ×（自テーマ＋全 5 Theme）= 900 組を変更前後で実行。
628 組で SVG / PDF / picture PPTX、428 組で editable freeform、416 組で
editable glued、234 組で D2 を sha256 比較した。変更はこの
`research/233-lora/c-h3world.sumi.yaml` のみ（自テーマ・minimal・academic・color・paper の
SVG / PDF / picture PPTX）。この図の slides は以前から描画不可。
残りの 149 YAML の出力と、描画できない入力の診断コードは一致した。
比較データは `.sumi/compat-{before,after}.json`。golden は指定コマンドのみで更新し、
bowtie gallery とその一覧・対応する PDF/PPTX golden 以外は変わらなかった。
