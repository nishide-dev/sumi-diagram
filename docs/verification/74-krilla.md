# #74 krilla への PDF エンジン移行

## 変更と互換性

保守終了した svg2pdf 0.13.0 と決定性パッチを削除し、krilla 0.8.2 + krilla-svg 0.8.1（Rust 1.98.1、Cargo.lock 固定、upstream パッチなし）へ移行する。選定根拠は [#60 の評価](../research/60-krilla.md)。

CLI、YAML、SVG、PDF の寸法・日本語・検索可能なフォントサブセット・ベクターマスク・provenance 項目・Diagnostic は維持する。PDF の内部表現・subset tag・Producer・hash は変わり、golden を更新する。Producer は `Sumi <版> (krilla 0.8.2, krilla-svg 0.8.1)`。WASM 生サイズは旧 1,922,851 bytes から約 3.52MB へ増える。

krilla が書く Info は Catalog の前にある。独自 Sumi 項目のために marker を厳密に検査して辞書を置換し、後続オブジェクトの xref offset と startxref を更新する。日時・XMP・incremental update は追加しない。reader は実出力を検査した結果、classic xref / compact 辞書 / indirect resources を既に処理できており、非対応の object/xref stream を新たに許容する必要はなかった。

## 元 SVG との表示比較

```sh
# agent-browser / Poppler / ImageMagick 7 が必要。通常の利用・テストには不要。
# 旧 WASM は git show 2073ccc:assets/wasm/sumi-svg2pdf.wasm から読み、hash を検証する。
bun scripts/check-pdf-svg.ts
```

全 53 入力（examples 4、部品ギャラリー 48、日本語通常/太字＋mask 1）を、**元 SVG の Chromium 描画**と比較する。D2 の WOFF を使う inline SVG を 2 CSS px/pt で screenshot し、PDF は Poppler で 144dpi にする。日本語 fixture は同じ同梱 TTF をブラウザに明示的に読み込ませる。`document.fonts.ready` を待つ。検査環境は macOS arm64、Bun 1.3.14、HeadlessChrome 148、Poppler 26.04.0、ImageMagick 7.1.2-32。詳細は [測定値](74-pdf-svg.json)。

画素差は RGB のいずれかで差が 64/255 超の画素の割合。サブピクセル線の AA 差を区別するため raw と 3×3 box filter の両方を記録する（#63 と同じ考え方）。gate は filtered 差 3% 以下、かつ旧エンジンより 0.5 percentage points を超えて悪化しないこと。小さな文字だけの label/slides は両エンジンとも 2.0051% であり、1% の一律上限では既存出力まで拒否するため、全件の旧出力を対照にし、表示差を目視でも確認した。

- 全 53 件で filtered 差は旧エンジンと同じか改善。最大は label/slides の 2.0051%。
- #60 の高差分だった container/academic は旧 0.4276% → 新 0.2582%、container/slides は 1.0065% → 0.6095%。
- 合成日本語/mask は旧 0.4340% → 新 0%。台形・stack・矢印の全テーマを含む。
- 文字位置・寸法・画像数・フォントは別の構造検査で検証するため、画像の一致だけを契約の根拠にはしない。

生成した screenshot・PDF・PNG・完全な report は `.sumi/pdf-svg/` に残る。記録を意図して更新するときは `--record` を付ける。

## 再現ビルド・配布・全 OS/CPU

- `bun run pdf:wasm` は Linux x64 を基準に生成物・固定 hash・`THIRD_PARTY.md`・ライセンス原文を再現ビルドする。macOS 等では CI の artifact を `--adopt` する（CONTRIBUTING.md）。
- 通常の CI は Linux/macOS で examples 4 図の golden と部品 48 図＋日本語 mask の hash、文字・寸法・ベクター等を検査する。
- Release workflow は darwin-arm64 / darwin-x64 / linux-x64 / linux-arm64 の native runner で **同じコミット済み WASM と PDF golden** を検査し、単一バイナリを作って実際の配布 tarball を smoke-test する。`workflow_dispatch` では公開リリースを作らない。
- `bun run pdf:latex` は新エンジンの PDF を pdfLaTeX / LuaLaTeX に実際に取り込み、日本語・フォント・寸法・位置・画像 0・表示を独立検査する。

Linux 基準 WASM の採用、最終 CI と全ターゲット dry run の結果は、この移行の PR / #74 に記録する。

## ライセンス原文

`native/pdf-wasm/THIRD_PARTY.md` は wasm target の依存を埋め込み 78 / build-only 10 に分類する。krilla と krilla-svg の `.crate` には workspace root の原文が入っていないため、`.cargo_vcs_info.json` の commit `3ffdf0588cf98050aad6edba51ca70162e1fb5b5` にある LICENSE_APACHE / LICENSE_MIT / NOTICE.md を、スクリプト内に固定した SHA-256 で検証して取得する。

NOTICE は `content_draw_path` の一部を MPL-2.0 としているため、MPL 原文（SPDX license-list-data v3.27.0、checksum 固定）と無改変 upstream 対応ソースの入手先も同梱する。配布先は `licenses/pdf-wasm/`。ビルド・release smoke はこれらの存在を検査する。
