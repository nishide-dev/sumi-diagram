# #19 PoC: ベクター PDF / PPTX 出力の評価

調査メモは [docs/research/19-pdf-pptx-export.md](../../docs/research/19-pdf-pptx-export.md)。ここには再現用のスクリプトと、小さく選んだ結果（`results/`）だけを置く。製品のコード（`src/`）と依存関係（`package.json`）は変更しない。

## 構成

| パス | 内容 |
| --- | --- |
| `figures/ja-review.sumi.yaml` | 日本語ラベル・複数行・エッジラベル・破線・両矢印を含む検証用の図 |
| `scripts/render-inputs.ts` | 入力 3 図を通常のパイプライン（`renderFigure()`）で描画し、SVG・`inspectSvg()` の結果・フォント名を解決した SVG を `out/svg/` に書く |
| `scripts/lib/svg-fonts.ts` | D2 の `d2-<hash>-font-*` を同梱フォントの実名・太さに書き換え、`@font-face` を除く（ブラウザ以外の変換器向け） |
| `svg2pdf-poc/` | svg2pdf 0.13 を使う Rust の PoC。同梱 TTF だけを入れたフォント DB で変換する。ネイティブ（`sumi-svg2pdf`）と `wasm32-unknown-unknown`（WASI なし、C ABI）の両方をビルドする。`svg2pdf-deterministic.patch` は HashMap 順の出力を固定する修正 |
| `scripts/build-tools.sh` | 上記と、比較用の公式 `svg2pdf-cli` 0.13 を `.tools/` にビルドする |
| `scripts/pdf.ts` | 各ツールで PDF を 2 回ずつ（1 秒以上空けて）作り、決定性・`SOURCE_DATE_EPOCH`・ページサイズ・フォント・ラベル位置・画素差を `out/pdf/report.json` に記録する |
| `scripts/pptx.ts` | PPTX の PoC を 3 種類書く（依存なし。OOXML と決定的な zip を自前で生成）: (a) `image` SVG 画像＋PNG フォールバック、(b1) `native` ネイティブ図形・エッジは厳密な経路のフリーフォーム、(b2) `native-glued` ネイティブ図形・エッジは図形に接着した直線コネクタ |
| `scripts/validate-pptx.ts` | macOS の Microsoft PowerPoint で PPTX を開き、残った図形数を数え、PDF に書き出して `pdf.ts` と同じ検査をする（`*.applescript` を使う） |
| `scripts/embed-check.ts` | WASM を `bun build --compile` の単一バイナリに埋め込んで動くかの確認 |
| `scripts/collect-results.sh` | `out/` から `results/` へ小さな成果物と比較画像をまとめる |
| `results/` | 各レポート（JSON）、svg2pdf PoC の PDF、PPTX の PoC、比較画像（コミット対象） |

`.tools/` と `out/` は `.gitignore` 済み（再生成できる）。

## 再現手順

```sh
bun install --frozen-lockfile && bun run d2:install

# 1. 変換ツール（rustup の stable が必要。WASM は `rustup target add wasm32-unknown-unknown`）
bash research/19-pdf-pptx/scripts/build-tools.sh

# 2. 入力の SVG
bun research/19-pdf-pptx/scripts/render-inputs.ts

# 3. PDF の比較（無いツールは飛ばす）
bun research/19-pdf-pptx/scripts/pdf.ts

# 4. PPTX の PoC と、PowerPoint での検証（macOS + PowerPoint のみ）
bun research/19-pdf-pptx/scripts/pptx.ts
bun research/19-pdf-pptx/scripts/validate-pptx.ts
osascript research/19-pdf-pptx/scripts/powerpoint-move-shape.applescript \
  ~/Library/Containers/com.microsoft.Powerpoint/Data/Documents/sumi19/system-architecture.native-glued.pptx \
  ~/Library/Containers/com.microsoft.Powerpoint/Data/Documents/sumi19/sa-glued-moved.pdf "n:gateway" 60
# （native.pptx → sa-free-moved.pdf も同様。両 PDF を out/pptx/moved/ にコピー）

# 5. results/ の更新
bash research/19-pdf-pptx/scripts/collect-results.sh
```

## 調査時の環境とツール

macOS 26.2（arm64）。導入したものと場所:

| ツール | 版 | 導入先 | 用途 |
| --- | --- | --- | --- |
| svg2pdf（crate、パッチ適用）＋ PoC | 0.13.0 | `research/19-pdf-pptx/.tools/`（cargo、gitignore） | 本命の候補 |
| svg2pdf-cli | 0.13.0 | 同上（`cargo install --root`） | 比較 |
| wasm32-unknown-unknown target | Rust 1.98.1 stable | `~/.rustup`（ユーザー単位） | WASM ビルド |
| librsvg（rsvg-convert） | 2.63.3 | Homebrew | 比較 |
| Inkscape | 1.4.4 | Homebrew cask | 比較 |
| 既存: Google Chrome 155、poppler（pdfinfo / pdffonts / pdftotext / pdftoppm / pdfimages）、ImageMagick 7、Microsoft PowerPoint for Mac、Keynote | — | — | 比較・検証 |

注意:

- rustup の一部の環境では `rust-lld` / `rust-objcopy` が `libLLVM.dylib` を見つけられない。`build-tools.sh` は `DYLD_FALLBACK_LIBRARY_PATH` で回避する（ネイティブの strip は Apple の `strip` を使う）。
- PowerPoint はサンドボックス化されているため、ファイルは `~/Library/Containers/com.microsoft.Powerpoint/Data/` 以下に置く。PowerPoint が修復ダイアログを出すファイルでは AppleScript がタイムアウトする（`validate-pptx.ts` は PowerPoint を終了して次へ進む）。
- Keynote は PPTX の読み込み時にダイアログを出して自動化が止まったため、検証できていない。
