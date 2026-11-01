# #283: HTML leaf の検証

## 契約

専用 `html` component。HTML/CSS の許可リスト・テーマ変数・同梱フォント・予算の
判断は [設計 §6.81](../design/phase1.md) を参照する。
gallery は全5テーマ×default/framed。独立 leaf と container 内 leaf は
`src/assets/html.test.ts` とローカルの compiled CLI smoke で確認した。
新しい独立した examples は追加せず、汎用のカードとコード行を gallery に集約した。

## 既存入力の互換性

変更前に `bun scripts/compat-283.ts before`、変更後に `bun scripts/compat-283.ts after`。
最初の走査で repository 内の154個の `*.sumi.yaml` を固定した（examples / tests /
research。node_modules、.git、ローカル .sumi は除く）。自身のテーマと組み込み5テーマ
（minimal / academic / slides / color / paper）の計924ケースについて、同じ asset base
と同じ renderFigure / export API を使って比較した。

| 対象 | 成功ケース数 | 変更数 |
|---|---:|---:|
| SVG | 644 | 0 |
| PDF | 644 | 0 |
| picture PPTX | 644 | 0 |
| D2 source（autoのみ） | 222 | 0 |
| 描画できない既存fixture・旧研究構文など | 280 | 0（診断code列） |

前後の JSON manifest は同じ SHA-256:
`8af17b35035648d9b5a604584811475499bb84f180750e1d56b1a9d8c374d0db`。
ローカル成果物は `.sumi/compat-283-{before,after}.json`。
エラーメッセージ全文は比較対象にせず、未知 component の hint に html が増える変更は
別途 lint golden で確認する。

## Golden と生成物

以下の正規コマンドだけで更新した。既存の出力hashは維持し、PDF/PPTX corpus に
HTML gallery 各5件を追加した。HTMLだけのPDFは全字がpathなので font/glyph/image が0。
lintの未知component一覧のsnapshotもcatalogと連動するため gallery の生成対象に含めた。
Figure JSON Schema は汎用 props record の構造を維持し、部品固有の strict props schema
とcatalogに html / viewport / width / height / fit を定義した。schema:gen は変更なし。

```sh
bun run gallery
SUMI_UPDATE_GOLDEN=1 CI=1 bun test src/render/pdf src/render/pptx src/render/assets.integration.test.ts
```

## バイナリと見た目

`bun run release:build --target darwin-arm64` で単一実行ファイルを含むtarballを作成し、
worktree内へ展開した実行ファイルで、架空の code-window と text-card の図を
SVG / PDF / picture PPTX に描画した。フォントはrelease内の実ファイル、Takumi WASM
とusvg WASMは実行ファイルに同梱される。release build は Takumi / helpers のnpm license
と `licenses/takumi/` のupstream notice一式も収集する。

academic / paper のgalleryとcompiled図のpicture-PPTX fallback PNGを開いて確認した。
academic はグレー、paper は青のテーマaccent。日本語、等幅コードのインデント、
角丸、framedの外枠、container 内のHTML leafを確認した。
実Officeアプリの確認と他OSのバイト一致は今回の検証対象に含めない（#294）。

## 自動検査

- `src/assets/html.test.ts`: 許可/拒否、literal/quoted YAML位置、viewport・長さ・要素数・深さ、
  imageとの入口分離、固定テーマ変数、両engine、寸法比と自然寸法、container子、
  SVG/PDF/PPTXの2回一致、editable PPTXの既存診断。
- 既存の全部品×全variant×全themeのcompile / D2 render テストにもHTMLを含めた。
- `bun run check` / `bun run typecheck` / `CI=1 bun test` /
  `bun run gallery:check` / `bun run schema:check` で検証する。
- emoji の内容・importer・archiveは変更していない。

最終結果: `bun run check` / `bun run typecheck` / `bun run gallery:check`（227 files） /
`bun run schema:check` が成功。`CI=1 bun test` は **4,052 pass / 13 skip / 0 fail**
（140 files、427.66秒）。skipは既存prototype・任意環境のテスト。
PDF/PPTX/assets の正規 golden 更新コマンドも **646 pass / 0 fail**。
`check` の13 warningは未変更の `research/277-html-subset/` に由来する既存のもの。
