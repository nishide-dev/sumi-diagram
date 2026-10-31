# #278 waveform の検証

## 契約

明示サンプル2〜2,048個（有限、-1〜1）を等間隔で描画する。bars / line、全5テーマ、auto / structured、SVG / PDF / picture PPTX / native editable PPTX を対象とする。seed・音声解析・HTML は導入しない。詳細は[設計 §6.80](../design/phase1.md#680-278-のサンプル駆動-waveform)。

`src/render/waveform.test.ts` が位置付き負例、上限、符号と振幅、全テーマ×両layout×両modeの再描画一致・幾何lint・各出力形式を検査する。editable PPTX は両connector modeで `a:custGeom` と信号の線分を保持し、`p:pic` / media がないことを確認する。全variantのD2描画は既存の `builtins-render.test.ts`、outline寸法契約は `core/outline/builtin.test.ts` に含む。

## 既存出力の互換性

2026-11-01、Bun 1.3.14 / darwin-arm64、同梱D2 0.9.0・フォント・WASMで、実装前後に同じ入力を描画した。worktree内の既存 `**/*.sumi.yaml`（node_modules / .git を除く）153ファイルを列挙し、各ソースそのまま＋組み込み5テーマをoverrideした **918ケース** を実行。資産のbaseは各YAMLの親ディレクトリとした。

- **638ケースが成功**。`renderFigure()` のSVG、`svgToPdf()`、`svgToPptx()`、auto時の `compiled.d2Source` をSHA-256で比較し、**出力差分0**。structuredにはD2ソースがない。
- 成功ケースの順序付き `[ファイル|テーマ, 出力hash]` JSONの集約SHA-256は前後とも `faffaadbef692eac677868fb5e3106b227daceecd839cb4c0d7afacf37794046`。
- **280ケースは前後とも描画不可**。不正fixtureや現行schemaに対応しない研究用YAML等を成功に数えていない。そのうち42件（7ファイル×6テーマ指定）は既知component一覧にwaveformが加わる診断文だけ変化した。
- galleryは通常の `bun run gallery`、PDF/PPTX/assetのgoldenは指定の `SUMI_UPDATE_GOLDEN=1 CI=1 bun test src/render/pdf src/render/pptx src/render/assets.integration.test.ts` で更新する。既存出力のhashを手で変更しない。

## 実行結果

- `bun run check` / `bun run typecheck` / `bun run schema:check`: 成功。
- `CI=1 bun test`: **3,727 pass / 13 skip / 0 fail**（135ファイル、3,740 tests）。skipは既存の研究用prototype等。
- `bun run gallery:check`: 209ファイルが最新。
- galleryのSVGをpicture PPTX経由のPNGで確認し、paperテーマのPDFを独立したPoppler `pdftoppm` でPNGにして確認。縦線・折れ線・枠・ラベルが欠落せず、安全領域に収まる。
- 新規emojiを追加していないため `emoji:check` は対象外。

PowerPoint / Keynoteの新しい実機確認、他OSでの新しいwaveformのバイト比較は今回実施していない。通常のCIと既存PPTXの検証基盤を利用する。

## PR #287 レビュー対応

- 信号の端と結合を全出力でroundに統一し、鋭角のmiterが枠の描画boundsを越える問題を修正。半線幅以上に突出しないため、中心線の比例insetを維持したまま最小寸法にも対応する。barsの振幅0はパスを省略し、編集可能PPTXだけ点になる差を解消する。lineの0は中心線上に保持する。
- 両layout×両modeで `[-1, 1, -1]`・0.5pt角を実描画し、round指定と半線幅込みのpainted boundsを検査する。
- ゼロ・定数・交互振幅2,048点を両layout×両modeでSVG描画、PDF / picture / editable PPTXへ変換。信号数・全線分の保持、ゼロと定数のSVG座標、native XMLの厳密座標・色・線幅・cap / join・ゼロbar省略を検査する。autoで入力→波形→出力を接続し、配置順・辺・幾何lint・両connector modeのeditable出力を確認する。
- `bun run gallery` と `SUMI_UPDATE_GOLDEN=1 CI=1 bun test src/render/pdf src/render/pptx` で生成物を再生成。差分はwaveformのSVG5件、editable XML10件とPDF / picture / editable PPTXのwaveform hashのみ。
- レビュー対応後の `bun run check` / `bun run typecheck` / `CI=1 bun test` / `bun run gallery:check` / `bun run schema:check` はすべて成功。全テストは **3,746 pass / 13 skip / 0 fail**（135ファイル、3,759 tests）。上記918ケースの互換性比較・目視確認は初回実装時の記録で、今回のレビュー対応では再実行していない。
