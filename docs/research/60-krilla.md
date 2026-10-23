# #60 保守される PDF エンジンへの移行評価

- 調査日: 2026-10-24、基点 `c1611c9`、macOS arm64 / Bun 1.3.14 / Rust 1.98.1 / Poppler 26.04.0 / ImageMagick 7.1.2-32。
- 関連: [#60](https://github.com/nishide-dev/sumi-diagram/issues/60)、#19、#59、#63。正式移行: [#74](https://github.com/nishide-dev/sumi-diagram/issues/74)。
- [PoC・再現手順](../../research/60-krilla/README.md)、[全ケースの測定値](../../research/60-krilla/results.json)、[固定依存のライセンス表現](../../research/60-krilla/dependencies.json)。

## 結論

**krilla + krilla-svg を後継エンジンとして採用する方向で正式移行を進める。** WASM・日本語の検索可能なサブセット埋め込み・ベクターマスク・物理寸法・同一実行環境での決定性・単一バイナリ埋め込みは PoC で成立した。製品の差し替えは、下記の表示差確認・OS 間決定性・LaTeX・配布検証を含む後続実装で行う。

旧 #19 の選定は出力品質と配布形態を中心に比較し、保守状況と krilla を比較対象に入れていなかった。この不足を訂正する。`typst/svg2pdf` は確認時点で GitHub API の `archived: true`、[README](https://github.com/typst/svg2pdf) で “This project is not maintained anymore. Use krilla with krilla-svg instead.” と案内している。したがって旧 #60 の「決定性パッチを svg2pdf 上流へ提案し、取り込まれたらパッチを外す」という計画は置き換える。

## 固定版・実装条件

| | 現行 | 候補 |
| --- | --- | --- |
| SVG → PDF | svg2pdf 0.13.0 + Sumi 決定性パッチ | krilla 0.8.2 + krilla-svg 0.8.1、パッチなし |
| SVG parser | usvg 0.45.0 | usvg 0.47.0 |
| fontdb | 0.23.0 | 0.23.0 |
| 形式 | wasm32-unknown-unknown、raw ABI | 同じ ABI、host imports 0（WASI / wasm-bindgen 不要） |
| フォント | 同梱 TTF だけ | 同じ TTF と `resolveSvgFonts()`、system fonts は読み込まない |
| ページ | dpi 96 | usvg の CSS px × 72/96 を PDF pt に変換して描画 |
| PDF | 1.7 | 明示的に 1.7、XMP 無効、日時なし、固定 Producer |

krilla の default features は無効。ただし krilla-svg が krilla の `raster-images` と resvg の機能を要求するため、画像・フィルタ処理のコードも推移的に含む。「default-features=false だからラスタ機能が無い」という意味ではない。Sumi の現在のコーパスではラスタ出力は発生しなかった。フィルタ・任意画像を含む SVG 全般の純ベクター保証はしない。

`dependencies.json` に、WASM target 向け Cargo metadata の全 package（build/proc-macro を含む）のライセンス表現を保存した。krilla / krilla-svg 自体は `MIT OR Apache-2.0`。一覧には BSD・Zlib・Unicode-3.0 等も含む。実配布への移行時には、従来の `THIRD_PARTY.md` / ライセンス原文生成と tarball 同梱をこの lockfile に合わせて更新する必要がある。

## 測定

入力は examples 4 図、部品ギャラリー 48 図（16 部品 × 3 テーマ、台形・stack を含む）、日本語通常/太字＋ベクターマスクの合成 SVG 1 図、計 53。現行と候補に同じ解決済み SVG・フォントを渡した。Poppler で PDF を独立検査した。

| 項目 | 結果 |
| --- | --- |
| PDF 生成 | 両エンジンとも 53/53 成功、1 ページ |
| 寸法 | `pdfinfo` のページ寸法が全件一致（合成入力 240 × 120 pt） |
| 検索可能文字 | 空白を除く `pdftotext -layout` 結果が全件一致、日本語を含む |
| フォント | 全件 embedded / subset / Unicode = yes |
| ラスタ画像 | 両エンジン全件 0（`pdfimages -list`） |
| word bbox | word 順・文字が一致、4 座標の最大差 0.000041 pt（許容 0.01 pt） |
| 決定性 | 候補は各図 5 回、新規 instance で SHA-256 一致、日時なし |
| 生 WASM | 現行 1,922,851 bytes → 候補 3,515,317 bytes（+1,592,466 bytes、約 83% 増） |
| 候補 gzip | 1,265,118 bytes（Bun.gzipSync） |
| 全 PDF 合計 | 755,399 → 659,153 bytes（約 12.7% 減、metadata 後処理前） |
| コンパイル済み実行ファイル | 合成入力の出力がソース実行と SHA-256 一致 |

候補 WASM の macOS ビルド hash は `89ef776e7ac0ab783441fc1093052641b33c894e75d2d45303ad4864f68a7e47`。この研究では WASM 自体はコミットせず、固定ソース・lockfile と結果を保存する。製品配布サイズの差を測ったものではなく、WASM の生サイズと gzip の測定である。

### 表示差

PDF はバイト一致せず、144dpi の画素も一致しない。各 RGB チャンネルの差が 255 の 25% を超える画素の割合は、最大 **2.7975%**（container / academic）、合成 SVG は **1.0069%**。RMSE の最大は約 0.1205（0〜1）。`results.json` に全件の値を残した。

box / slides と stack / minimal の画像を目視すると輪郭・文字・重なりは保たれていたが、これをもって全差分がアンチエイリアス由来とは断定しない。現行 PDF を比較基準としたもので、元 SVG のブラウザ描画を基準とする厳密な表示検証は未実施。正式差し替え前に、高差分ケース・ラベルの mask・marker・破線・カスタム輪郭を元 SVG と比較して許容差を決める。

## 正式移行の受け入れ条件

1. 表示差を元 SVG 基準で調査し、欠損や配置・色の退行が無いことを確認する。
2. Linux 基準 WASM を同じ固定ツールチェーンで再現ビルドし、同じ WASM を Linux/macOS・x64/arm64 で実行して PDF hash を比較する。ここで検査済みなのは macOS arm64 と同一環境内の反復のみ。
3. 製品の metadata（入力 hash 等）、失敗時 Diagnostic、ファイル埋め込み・hash 検証・ライセンス生成を移行する。旧 svg2pdf のパッチと依存を削除する。
4. `src/render/pdf/testing.ts` の classic xref 前提を見直す。候補は PDF の内部オブジェクト構造が変わるため、内部 reader の対応と Poppler による独立検証を維持する。
5. 新 PDF golden を意図した互換性変更として更新し、#63 の実 pdfLaTeX / LuaLaTeX 取り込み検証と全ターゲット release smoke を通す。研究 PoC の単一バイナリ smoke はこれらを代替しない。

保守継続という理由に加え、出力契約を維持できる PoC の根拠が得られたため、サイズ増は受け入れて移行を進める。ただし上記は正式移行の gate とする。旧エンジンへパッチを上流提案する作業は継続しない。
