# #215: paper の operator を小さくする

設計判断: [§6.64](../../docs/design/phase1.md#664-215-の-paper-operator-の縮小)。`paper` だけを変更し、既存のサイズ計算（直径 = fontSize × 2）を使う。新しい構文・props は不要。

```yaml
- { id: add, component: operator, props: { symbol: plus } }
```

## 選択と見た目

- 8pt の記号・16pt の円 → **7pt の記号・14pt の円**。6pt は profile の下限 7pt を下回るため不採用。
- 通常の枠 1 → **0.5pt**（paper の辺と同じ）。emphasis の太字・1.5pt、filled の枠なし、muted / outlined の色は維持。
- 3 図の変更前後の 200dpi PNG、全変更 45 ファイルの PNG 一覧 4 枚、operator / tones / dim のギャラリー PNG を目視した。縮んだ円でも記号と枠の間に余白があり、DiT の薄表示でも ＋ を読める。過去の再現図の既存の重なりも確認した。
- 原図との比較根拠は #185 / #215 に記載された差（3 図とも operator が大きい）と #185 の寸法。未公開の H3-World 原図は参照していない。

## 寸法（変更前 → 後）

| 図（#185 の YAML） | 出力 mm | scale | error / warning / info |
| --- | --- | --- | --- |
| Transformer | 76.02 × 114.83 → 75.32 × 114.12 | 1 → 1 | 0 / 0 / 0 |
| DiT | 180 × 85.98 → 180 × 84.69 | 0.8138 → 0.8138 | 0 / 0 / 1 |
| H3-World | 180 × 122.24 → 180 × 123.04 | 0.829 → 0.8344 | 0 / 0 / 1 |

DiT を **170mm 幅に揃えると高さ 81.2041 → 79.9841mm（−1.2200mm、−1.50%）**。原図約 68mm に対し ×1.194 → ×1.176。§6.55 の compact の残る差を一部縮める。§6.55 の旧 fixture は 180mm 幅で 87.66 → 86.34mm（170mm 幅で 82.79 → 81.54mm）。H3-World の高さ増加は自然幅が減り、fit の縮小率が上がるため。info は既存の `geometry/script-too-small` のみ。

## 再現

環境: Bun 1.3.14、D2 0.9.0、同梱フォント、Poppler / ImageMagick。すべてリポジトリ内で実行する。

1. Theme の変更前に `bun research/215-paper-operator/verify.ts before`。
2. 変更後に `bun research/215-paper-operator/verify.ts after`。
3. `bun research/215-paper-operator/inspect.ts` で PNG にして見る。
4. `bun research/185-acceptance/render.ts` で受け入れの lint・寸法・preview を更新。

`verify.ts` は追跡済み全 YAML の own + 全組み込み Theme を描き、SVG / PDF / 画像方式 PPTX / D2 の SHA-256 と失敗診断を `out/{before,after}.json` に保存する。840 通り中 574 成功・266 失敗は不変。D2 234 件は同一、変更は **paper 45 ファイル・59 通り・177 出力**だけ。[全変更一覧と golden の対応](changed-outputs.md)。その他の Theme と operator のない paper はバイト一致。

`out/figures/` は `research/185-acceptance/figures/` の完全な写し（H3-World と相対参照する代用フレーム画像を含む）。`inspect.ts` は受け入れ図に対してこの写しを描画する。生成 YAML・SVG・PDF・PNG 一覧はすべて `out/` に置いて無視する。コミットする PNG は **`previews/c-h3world.png` だけ（74,384 bytes）**。

## golden / 検査

```sh
bun run gallery
SUMI_UPDATE_GOLDEN=1 CI=1 bun run test src/render/pdf src/render/pptx src/render/assets.integration.test.ts
bun run check
bun run typecheck
CI=1 bun run test
bun run gallery:check
bun run schema:check
```

golden 更新 562 pass、全体 2811 pass / 13 skip / 0 fail。13 skip は既存の #124 の試作コードの適用対象が一致しないため。schema に変更はない。新部品・variant・診断もない。
