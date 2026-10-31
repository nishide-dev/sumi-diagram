# #277 inline SVG の検証

2026-11-01、Bun 1.3.14 / darwin-arm64 / 固定 D2 v0.9.0 / 同梱フォント・WASM で確認した。
契約と判断は [設計 §6.79](../design/phase1.md#679-277-の安全な-inline-svg-入力)。

## 既存入力の互換性

変更前の `git ls-files '*.sumi.yaml'` にある **153 入力**を対象に、元の theme と
`minimal` / `academic` / `slides` / `color` / `paper` の **918 通り**を変更前後で描画した。
各 YAML の親を `assetBase` にし、同じ file 名・原文を `renderFigure()` に渡した。
成功時は SVG、`svgToPdf()` の PDF、`svgToPptx()` の picture PPTX、auto の D2 ソースを SHA-256 で比較した。
描画できない既存の負例等は error の診断コード配列を比較した。

- 描画成功 **696 通り**: SVG / PDF / picture PPTX は全件 byte 一致。
- そのうち auto **216 通り**: D2 ソースも全件 byte 一致。
- 既存の負例等 **222 通り**: error コード配列は一致。例外は 0 件。
- 変更は **0 件**。新しい inline SVG fixture は比較対象に含めていない。
- 比較用スクリプトと結果は作業用 `.sumi/review/compat.ts` と
  `compat-{before,after}.json` に保存した（git 管理外）。

## 新機能

- `src/assets/inline-svg.test.ts`: `src` / `svg` の排他、原文保持、寸法導出、原文 hash、
  optional sha256、YAML literal / escaped quoted scalar の位置、script / event / href /
  foreignObject / text / defs の拒否、byte / element / depth 予算、ファイルと inline の共有総量。
- `src/render/assets.integration.test.ts`: 両 engine の全 fit + layers + framed で、
  同じ SVG を file / inline で与えたとき provenance 以外の SVG が一致することを検査。
  新 fixture は PDF でラスタ画像 0、PPTX で SVG + PNG fallback、metadata の引き継ぎ、
  反復決定性、editable の `pptx/unsupported-asset` を検査する。
- `bun run gallery` で image の全テーマ × 全 variant に inline の波形と図形のコード窓を追加。
  色は原文どおりで、内部をテーマで再配色する契約ではない。
- fixture を SVG / PDF / picture PPTX に出し、PPTX の PNG fallback と独立した Poppler
  `pdftoppm` の PDF プレビューを開いて、波形の線・窓・3 つの丸・色付きバーが残ることを目視確認した。
  これは文字の検索性や実 Office での操作確認を追加するものではない。

## コマンド

- `bun run check` / `bun run typecheck`: 成功。
- `CI=1 bun test`: **3664 pass / 13 skip / 0 fail**（3677 tests、135 files）。
  skip は既存研究 #124 の prototype 等で、D2 統合テストは実行した。
- `bun run gallery:check`: 203 ファイル一致。
- `bun run schema:check`: 一致（component props は catalog の schema へ反映され、Figure schema 自体は不変）。
- golden 更新は `bun run gallery` と
  `SUMI_UPDATE_GOLDEN=1 CI=1 bun test src/render/pdf src/render/pptx src/render/assets.integration.test.ts`
  のみ。変更は新 fixture の 3 hash と、追加した image gallery 5 テーマの PDF / PPTX hash。
- `bun run release:build --target darwin-arm64`: 成功。tarball を本 worktree 内へ展開して、
  付属フォントを使う単一実行ファイルで新 fixture の SVG / PDF / PPTX を生成し、
  ソース実行の出力と 3 形式とも SHA-256 一致を確認した。追加依存・WASM 変更はない。
