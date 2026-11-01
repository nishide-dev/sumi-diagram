# #283: HTML leaf の検証

## 契約

専用 `html` component。HTML/CSS の許可リスト・テーマ変数・同梱フォント・予算の
判断は [設計 §6.81](../design/phase1.md) を参照する。
gallery は全5テーマ×default/framed。独立 leaf と container 内 leaf は
`src/assets/html.test.ts` とローカルの compiled CLI smoke で確認した。
新しい独立した examples は追加せず、汎用のカードとコード行を gallery に集約した。

## 既存入力の互換性

初回実装時にローカルの前後比較probeで以下を測定した。issue固有の
`scripts/compat-283.ts` は参照元がないためレビュー修正で削除し、方法をここに残す。
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

再現方法: baseline側で Bun.Glob により上記除外規則のパスをsortして固定し、両側で
各YAMLを `renderFigure(source, { assetBase: dirname(absolutePath), overrides: { theme } })`
へ渡す（自身のthemeではoverrides省略）。成功時はSVGと `svgToPdf` / `svgToPptx` の
bytes、auto時の `compiled.d2Source` をSHA-256化し、path/themeをkeyにJSONへ記録する。
失敗時はdiagnostics.map(d => d.code)を順序付きで保存する。baselineと修正側の
同じkeyの値を比較する。**「変更なし」は出力bytesと診断code列についての結果であり、
診断message全文の一致を意味しない。** レビュー修正はHTML専用経路のみで、既存の
非HTML galleryおよびPDF/PPTX/assetsのgoldenを変更しない。

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

レビュー修正後は `scripts/smoke-release.ts` にHTMLを恒久追加した。
`bun run release:smoke dist/release/sumi-0.10.0-darwin-arm64.tar.gz` が成功。
空の作業ディレクトリ・一時HOME・Bun/NodeなしのPATHで、日本語・theme色・monoを含む
HTMLをSVG/PDF/picture PPTXに各2回描き、bytes一致、埋め込みSVGの複数glyph path、
1ページのvector PDF、picture PPTXを検査する。

### full CLIサイズの実測（レビュー修正後）

同一ホスト darwin-arm64、Bun 1.3.14、同じ `bun run release:build --target darwin-arm64`
でmain `136344848364e0faf301c22a2001e18fa8a199de` と修正worktreeをビルドした。
tarball内 `sumi-0.10.0-darwin-arm64/bin/sumi` の非圧縮サイズを `tar -tvzf` で取得。

| 対象 | bytes |
|---|---:|
| main（HTML追加前） | 70,463,714 |
| 本branch（レビュー修正後） | 74,773,346 |
| full CLI差分 | **+4,309,632（約4.11 MiB、4.31 MB）** |
| Takumi WASM単体（参考） | 4,213,356 |

研究の **+4.28 MBはprototype** のbefore/afterであり、full CLI差分ではない。
初回実装の74,756,834 bytesも今回の修正前の値で、上表は再ビルドの結果である。

### フォント選択

Takumiはbundled Geist fallbackを保持し、`clearFonts()`でも削除されない。
fresh rendererで意味のないclear呼び出しを削除した。明示familyがsupplied fontsを
選択することを、Latin/日本語の輪郭の比較で確認する（mono変数＝BIZ UDGothic、
BIZ UDPGothicとは異なる、LatinのInterとも異なる）。欠字lintは #293。

academic / paper のgalleryとcompiled図のpicture-PPTX fallback PNGを開いて確認した。
academic はグレー、paper は青のテーマaccent。日本語、等幅コードのインデント、
角丸、framedの外枠、container 内のHTML leafを確認した。
実Officeアプリの確認と他OSのバイト一致は今回の検証対象に含めない（#294）。

## 自動検査

- `src/assets/html.test.ts`: 許可/拒否、literal/quoted YAML位置、viewport・長さ・要素数・深さ、
  imageとの入口分離、固定テーマ変数、両engine、寸法比と自然寸法、container子、
  SVG/PDF/PPTXの2回一致、editable PPTXの既存診断。
- レビュー例すべてを回帰化: width:potato / font-size:12bananas / flex-direction:banana /
  color:potato / width:var(--sumi-font) / 引用符内semicolon、30個のdiv自己終了、
  tag/attribute名境界のNBSPを位置付きで拒否。ASCII whitespaceの許可と他Unicode区切りの
  拒否、値の単位・値域・変数の型、実フォント選択も検査する。
- 既存の全部品×全variant×全themeのcompile / D2 render テストにもHTMLを含めた。
- `bun run check` / `bun run typecheck` / `CI=1 bun run test` /
  `bun run gallery:check` / `bun run schema:check` で検証する。
- emoji の内容・importer・archiveは変更していない。

レビュー修正後の最終結果: `bun run check` / `bun run typecheck` /
`bun run gallery:check`（227 files、bytes一致） / `bun run schema:check` が成功。
`CI=1 bun run test` は **4,054 pass / 13 skip / 0 fail**
（140 files、418.23秒）。skipは既存prototype・任意環境のテスト。
初回実装時のPDF/PPTX/assets の正規 golden 更新コマンドも **646 pass / 0 fail**。
`check` の13 warningは未変更の `research/277-html-subset/` に由来する既存のもの。
