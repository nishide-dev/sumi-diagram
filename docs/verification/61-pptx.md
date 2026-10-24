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
bun test src/render/pptx
bun scripts/check-pptx.ts
# 独立した Open XML SDK 3.3.0（検証専用、.NET 8 SDK が必要）
dotnet build scripts/pptx-validator/Validator.csproj --configuration Release \
  --artifacts-path .sumi/pptx-validator -p:RestoreLockedMode=true
dotnet .sumi/pptx-validator/bin/Validator/release/Validator.dll .sumi/pptx/*.pptx
```

53 入力（examples 4、部品 48、日本語 mask 1）で、同じ入力の反復と固定 hash、ZIP の CRC・local/central 整合、全 XML・relationships、1 枚画像、PNG/SVG の media、live text/font が無いこと、物理寸法を検査する。PNG をマゼンタへ差し替えた対照版も作り、計 106 ファイルを Open XML SDK の Office 2019 スキーマで独立検証する。.NET/NuGet はこの検証のみで、CLI に同梱しない。

`check-pptx.ts` は `.sumi/pptx/` に通常版・`.control.pptx`・抽出 SVG/PNG・report を残す。通常版では図、対照版でマゼンタが出れば PNG、対照版でも図なら SVG を表示している。元 SVG は `report.json` の `source` にある。

## アプリ別確認（進行中）

| アプリ | 今回の確認状況 | SVG / PNG |
| --- | --- | --- |
| PowerPoint Mac 16.114.1 | 権限付与後、日本語/mask の通常版・対照版とも画像1枚で保持、PDF書き出し成功。144dpi画像が全画素一致 | SVG（対照PNGのマゼンタは現れない） |
| PowerPoint Windows | 実行環境未接続 | 未確認 |
| Keynote | 実アプリ確認待ち | 未確認 |
| Google Slides | ブラウザが Google ログイン画面へ遷移。サインイン済み環境の確認待ち | 未確認 |

#19 の旧 PoC の結果を今回の製品出力の結果として流用しない。各アプリで通常版と対照版を開き、日本語・mask・破線・台形/stack・矢印を確認し、版と使用画像を記録してから、この受け入れ条件を完了とする。PowerPoint の補助スクリプトは `scripts/pptx-validator/powerpoint.applescript`。生成した fixture 名を確認し、他の presentation の保存/終了やアプリ全体の終了はしない。

Mac PowerPoint は日本語・太字・透明マスクの穴が保持されていた。通常版と、PNGだけをマゼンタにした対照版のPDFを `pdftoppm -r 144 -singlefile -png` で画像化し、ImageMagick `compare -metric AE` の結果は **0**。PDF再出力は300ppiの画像となり、ベクターPDFにはならなかった（保証外としている挙動）。[PDF出力の144dpi画像](61-powerpoint-japanese.png)も記録する。残る実アプリでの確認待ちというユーザー指定に従い、マージと #61 クローズは保留する。

## ライセンスと配布

resvg 0.47.0 と推移依存は Cargo.lock 固定。既に krilla-svg 経由で同じ resvg が含まれており、新たなクレートは増えない。`bun run pdf:wasm` がライセンスを再生成し、配布物の `licenses/pdf-wasm/` へ同梱する。WASM 生サイズの macOS 比較は 3,515,287 → 約 3,565KB（約 50KB 増）。Linux 基準ビルドと tarball の増分は CI で確認する。
