# #60 krilla WASM evaluation

判断と未検証条件: [`docs/research/60-krilla.md`](../../docs/research/60-krilla.md)。製品とは独立した PoC。

## 再現

リポジトリの root から実行する。Bun（`.bun-version`）、rustup と Rust 1.98.1 の `wasm32-unknown-unknown` target、Poppler、ImageMagick 7（`magick`）が必要。通常の Sumi の実行には不要。

```sh
rustup toolchain install 1.98.1 --profile minimal --target wasm32-unknown-unknown
bun install --frozen-lockfile
bun research/60-krilla/build.ts
bun research/60-krilla/compare.ts
```

- `wasm/Cargo.lock` 固定、upstream パッチなし。ビルド時のローカルパスを remap する。
- `out/build.json`: WASM の hash・サイズ・gzip と Cargo metadata のライセンス表現（WASM target、build/proc-macro 依存を含む。ライセンス原文の配布用コピーではない）。
- `out/report.json`: 全 53 ケースの PDF hash・サイズ・文字・word bbox・変換時間・画素差。PDF と 144dpi PNG も `out/` に残す。
- 記録時の検査ツールは Poppler 26.04.0 / ImageMagick 7.1.2-32。版は report の environment に残す。異なる版では、同じ PDF でも画素差などの測定値が変わる場合がある。
- 現行エンジンは同じ `resolveSvgFonts()` 後の SVG を変換する。製品の PDF metadata 後処理前で比較するため、コミット済み examples の PDF hash とは一致しない。
- #74 移行後も旧エンジンとの比較を再現できるよう、baseline WASM は `git show 2073ccc:assets/wasm/sumi-svg2pdf.wasm` から取得して固定 hash を検証する。その commit を含む Git 履歴が必要。
- 各入力の krilla 出力を新規 WASM instance で 5 回生成し、hash 一致を検査。ページ・文字・フォント・画像数・日時・word bbox の不一致は失敗する。画素差は測定値であり、自動の合否閾値を置いていない。
- `results.json` と `dependencies.json` は macOS arm64 の記録。意図して更新するときだけ `bun research/60-krilla/compare.ts --record`。これは比較と記録用であり、記録値との回帰検査ではない。

## 単一バイナリ smoke

```sh
bun build research/60-krilla/compare.ts --compile --outfile research/60-krilla/out/compare
research/60-krilla/out/compare --smoke research/60-krilla/out/synthetic.svg \
  assets/fonts/biz-ud-gothic/BIZUDPGothic-Regular.ttf \
  assets/fonts/biz-ud-gothic/BIZUDPGothic-Bold.ttf \
  assets/fonts/biz-ud-gothic/BIZUDGothic-Regular.ttf
```

合成入力は通常の比較実行で生成する。出力は `results.json` の `synthetic.svg` / krilla の SHA-256 と一致する。WASM は `with { type: "file" }` でバイナリに埋め込む。SVG とフォントは明示した入力ファイル。これは変換 ABI と WASM 埋め込みの smoke であり、製品リリースの全プラットフォーム検証の代わりにはしない。
