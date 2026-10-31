# #61 画像方式 PPTX 出力

## 形式と境界

`sumi render … --format pptx` または `-o …pptx` で、1 スライド・1 枚の `p:pic` を生成する。PNG を `a:blip`、文字をアウトライン化した SVG を Microsoft の `asvg:svgBlip` 拡張へ格納する。図形・ラベル・矢印は個別編集できない。PowerPoint の「図形に変換」や、各アプリからの PDF 再出力のベクター性は保証外。

- OOXML は自前生成。ZIP は順序・CRC・UTF-8・DOS 日時（1980-01-01）を固定し、作成日時やパスを含めない。
- 同梱 TTF のみを fontdb に渡して usvg で文字を path 化する。PPTX は閲覧側の `@font-face` やフォント埋め込みの実装に依存しない。
- 既存 `native/pdf-wasm` に resvg 0.47.0 を直接依存として追加。同じ import-free WASM の `picture` ABI が PNG と outlined SVG を返す。既存 PDF golden は変わらない。
- PNG は 192dpi を目標にし、8192px/辺・約 1600 万画素（RGBA 約 64MB）に制限する。大きな図は同じ縦横比のまま低解像度になる。
- `ST_SlideSizeCoordinate` は 1〜56 inch。図の物理サイズを保ち、1 inch 未満の辺はスライドに余白を加える。56 inch 超の入力は診断で拒否する。図を勝手に拡大・縮小しない。`--json` の `size` は図の寸法を維持する。
- provenance は `docProps/core.xml` と `custom.xml` へ入れ、Sumi の版・backend・theme・profile・font set・入力/D2 hash と rasterizer の版を保持する。

## 自動検証

```sh
bun run test src/render/pptx
bun scripts/check-pptx.ts
# 独立した Open XML SDK 3.3.0（検証専用、.NET 8 SDK が必要）
dotnet build scripts/pptx-validator/Validator.csproj --configuration Release \
  --artifacts-path .sumi/pptx-validator -p:RestoreLockedMode=true
dotnet .sumi/pptx-validator/bin/Validator/release/Validator.dll .sumi/pptx/*.pptx
```

53 入力（examples 4、部品 48、日本語 mask 1）で、同じ入力の反復と固定 hash、ZIP の CRC・local/central 整合、全 XML・relationships、1 枚画像、PNG/SVG の media、live text/font が無いこと、物理寸法を検査する。PNG をマゼンタへ差し替えた対照版も作り、計 106 ファイルを Open XML SDK の Office 2019 スキーマで独立検証する。.NET/NuGet はこの検証のみで、CLI に同梱しない。

`check-pptx.ts` は `.sumi/pptx/` に通常版・`.control.pptx`・抽出 SVG/PNG・report を残す。通常版では図、対照版でマゼンタが出れば PNG、対照版でも図なら SVG を表示している。元 SVG は `report.json` の `source` にある。

## 保証範囲とアプリ確認

生成のサポート対象は macOS / Linux（それぞれ x64 / arm64）。実アプリの表示確認対象は PowerPoint for Mac（確認版 16.114.1）とする。生成環境と閲覧アプリの対応範囲は別に定義し、今回は Windows PowerPoint・Keynote・Google Slides を保証対象に含めない。これらの確認は #61 の完了・マージ条件にしない（ユーザーと合意した範囲）。SVG＋PNG フォールバックは維持する。

| アプリ | 今回の確認状況 | SVG / PNG |
| --- | --- | --- |
| PowerPoint Mac 16.114.1 | 権限付与後、日本語/mask の通常版・対照版とも画像1枚で保持、PDF書き出し成功。144dpi画像が全画素一致 | SVG（対照PNGのマゼンタは現れない） |
| PowerPoint Windows | 今回の保証対象外（未検証） | 未確認 |
| Keynote | 今回の保証対象外（未検証） | 未確認 |
| Google Slides | 今回の保証対象外（未検証） | 未確認 |

#19 の旧 PoC の結果を今回の製品出力の結果として流用しない。Mac PowerPoint の実確認は下記の日本語/mask fixture に対する結果であり、53ケースの構造・hash・スキーマ検証とは区別する。PowerPoint の補助スクリプトは `scripts/pptx-validator/powerpoint.applescript`。生成した fixture 名を確認し、他の presentation の保存/終了やアプリ全体の終了はしない。

Mac PowerPoint は日本語・太字・透明マスクの穴が保持されていた。通常版と、PNGだけをマゼンタにした対照版のPDFを `pdftoppm -r 144 -singlefile -png` で画像化し、ImageMagick `compare -metric AE` の結果は **0**。PDF再出力は300ppiの画像となり、ベクターPDFにはならなかった（保証外としている挙動）。[PDF出力の144dpi画像](61-powerpoint-japanese.png)も記録する。この確認と自動検証により、今回の保証範囲の受け入れ条件を満たす。

## ライセンスと配布

resvg 0.47.0 と推移依存は Cargo.lock 固定。既に krilla-svg 経由で同じ resvg が含まれており、新たなクレートは増えない。`bun run pdf:wasm` がライセンスを再生成し、配布物の `licenses/pdf-wasm/` へ同梱する。

Linux 基準 WASM は [初回 CI](https://github.com/nishide-dev/sumi-diagram/actions/runs/40062059837) の artifact を採用した。3,565,005 bytes、SHA-256 `cf6ec1982be2a2b7186eb4bb4a15434d3d98129f1bdc5bc6fc964928b54cff3c`。初回の不一致は macOS ビルドとの差327 bytesと固定hashだけで、ライセンスの再生成は一致した。採用後も PDF/PPTX の全 golden/hash は変更なく一致した。

Bun 1.3.14 / darwin-arm64 で、基点 `69336ae` と今回の Linux WASM 採用版を同じホストで再ビルドして計測した（D2・フォント・package version は同じ）。

| 対象 | 前 | 後 | 増分 |
| --- | --- | --- | --- |
| Linux 基準 WASM | 3,515,484 bytes | 3,565,005 bytes | 49,521 bytes |
| WASM gzip（Bun.gzipSync） | 1,264,745 bytes | 1,282,781 bytes | 18,036 bytes |
| darwin-arm64 `bin/sumi` | 68,399,714 bytes | 68,465,762 bytes | 66,048 bytes |
| darwin-arm64 tarball | 51,332,484 bytes | 51,356,803 bytes | 24,319 bytes |
