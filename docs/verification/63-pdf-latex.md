# #63 PDF の LaTeX 取り込み検証

対象: [#63](https://github.com/nishide-dev/sumi-diagram/issues/63)。PDF 出力の実装は [#65](https://github.com/nishide-dev/sumi-diagram/pull/65)、設計は [§6.12](../design/phase1.md#612-59-の-pdf-出力)。

## 結論

2026-10-23、Sumi v0.2.0 の PDF を **pdfLaTeX / LuaLaTeX の `\includegraphics` で取り込めることを確認した**。英語・日本語の文字、太字、複数行、図形、矢印、破線、エッジラベルの下の線を消す mask を含む。

- 取り込み後も文字を抽出でき、元と同じ BIZ UDPGothic Regular / Bold の CID TrueType サブセットが埋め込まれる（ToUnicode 付き）。本文が英語の pdfLaTeX でも、図の日本語用に CJK パッケージやシステムフォントを追加する必要はない。
- ラスタ画像は追加されない。文字位置と大きさは、余白の分を除いて元の PDF と一致する（単語の bbox の最大差は約 0.001bp、検査の許容差は 0.02bp）。
- この TeX Live 2026 では、既定の設定・PDF 1.7 の明示の両方で成功し、警告はなかった。取り込み後の文書も PDF 1.7 だった。
- LaTeX が作る PDF 自体のバイト一致は検査しない（TeX の版・作成日時などで変わる）。Sumi の PDF の4ターゲット同一性は、下記の既存検証で別に確認済み。

## 実行環境と結果

| 項目 | 確認した値 |
| --- | --- |
| 日付 | 2026-10-23 |
| Sumi | v0.2.0、基点 `c27f5b2`、検証ブランチ `test/63-pdf-latex` |
| OS / CPU | macOS 26.2（25C56）/ arm64 |
| Bun / D2 | 1.3.14 / 0.9.0 |
| TeX ディストリビューション | TinyTeX-1 v2026.10（TeX Live 2026）、`TinyTeX-1-darwin-v2026.10.tar.xz` |
| pdfLaTeX | pdfTeX 3.141592653-2.6-1.40.29、kpathsea 6.4.2 |
| LuaLaTeX | LuaHBTeX 1.24.0、development id 7724 |
| Poppler | 26.04.0 |

各図を、2 エンジン × 2 設定（既定 / PDF 1.7 明示）で検証した。**5 図 × 4 = 20 通りすべて成功**。

| 図 | 文字・フォント・サイズ・画像なしの検査 | 文字 bbox の最大差（bp、概数） | 描画差（下記の指標、全設定共通） |
| --- | --- | --- | --- |
| `examples/decision-flow` | 4/4 成功 | 0.001 | 0% |
| `examples/grouped` | 4/4 成功 | 0 | 0% |
| `examples/pipeline` | 4/4 成功 | 0.001 | 0% |
| `examples/system-architecture` | 4/4 成功 | 0.001 | 0.0712% |
| `tests/fixtures/pdf-latex/japanese.sumi.yaml` | 4/4 成功 | 0 | 0% |

日本語 fixture と system-architecture の描画は、元の PDF と取り込み後の PDF を PNG 化して目視でも確認した。日本語・太字・破線・円柱・文書形状・矢印・ラベルに欠落はなかった。取り込みによる微小な座標丸めで、細線のアンチエイリアスは変わる。

### Linux CI の結果

[PR #67](https://github.com/nishide-dev/sumi-diagram/pull/67) の [CI run 39808286103](https://github.com/nishide-dev/sumi-diagram/actions/runs/39808286103)（コミット `810e266`）で、専用ジョブ [PDF LaTeX inclusion](https://github.com/nishide-dev/sumi-diagram/actions/runs/39808286103/job/119927298008) が55秒で成功した。環境と20通りの結果は artifact `pdf-latex` の `report.json` でも確認した。

| 項目 | 確認した値 |
| --- | --- |
| OS / CPU | Ubuntu 24.04 / x64 |
| TeX ディストリビューション | TeX Live 2023/Debian（Ubuntu のパッケージ） |
| pdfLaTeX | pdfTeX 3.141592653-2.6-1.40.25、kpathsea 6.3.5 |
| LuaLaTeX | LuaHBTeX 1.17.0、development id 7581 |
| Poppler | 24.02.0 |

- **20通りすべて成功**。文字・埋め込みサブセット・ToUnicode・物理サイズ・ラスタ画像0を確認し、文字 bbox の最大差は約0.001bpだった。描画差は上の macOS の表と同じだった。
- 両エンジンとも、既定の出力 PDF は **1.5**。入力が PDF 1.7 であるため取り込み時にバージョン差の警告が出るが、コンパイルと内容の検査は成功した。
- PDF 1.7 を明示した10通りでは、出力も **1.7** になり、警告は0だった。下記の利用例のバージョン指定で解消できることを実測できた。
- 5つの元 PDF の SHA-256 は、macOS の検証で生成した同じ図とすべて一致した。これは上記の各環境での取り込み結果の検査に加えて確認したもの。
- 同じ run の Static checks・Linux/macOS の Test・PDF engine reproducible build・Release smoke、および PR タイトル検査もすべて成功した。

### 既存の4ターゲット同一性検証

2026-10-20 の [Release dry run 39383474251](https://github.com/nishide-dev/sumi-diagram/actions/runs/39383474251)（#65）で、darwin-arm64 / darwin-x64 / linux-x64 / linux-arm64 の日本語 smoke test の PDF はすべて次の SHA-256 だった。直接実行・シンボリックリンク経由・ソースからの変換も一致している。今回の LaTeX fixture とは別の図である。

```text
d82e64eca1945f87c51cd675fa2ce04aec3a75aebf97776bed66e13c89793621
```

## 再現方法

必要なものは Bun、固定版 D2、TeX Live（pdfLaTeX / LuaLaTeX、`graphicx`・`geometry` と標準の本文フォント）、Poppler の `pdfinfo`・`pdffonts`・`pdftotext`・`pdfimages`・`pdftoppm`。TeX / Poppler は検証用で、Sumi 本体の実行には不要。

Ubuntu 24.04 では次のパッケージを使う。

```sh
sudo apt-get update
sudo apt-get install -y --no-install-recommends texlive-latex-base texlive-latex-recommended texlive-luatex lmodern poppler-utils
bun install --frozen-lockfile
bun run d2:install
bun run pdf:latex
```

macOS では TinyTeX / MacTeX と Poppler を導入して、`pdflatex` / `lualatex` と Poppler のコマンドを PATH に通す。今回の検証では TinyTeX の上記 tarball を一時ディレクトリへ展開し、その `bin/universal-darwin` を検証コマンドの PATH にだけ追加した。

```sh
PATH="<TinyTeX の展開先>/bin/universal-darwin:$PATH" bun run pdf:latex
```

出力先は `.sumi/pdf-latex/`（gitignore）。`--out <directory>` で変更できる。`report.json` にエンジン・Poppler の版、各元 PDF の SHA-256、埋め込みフォント、出力 PDF の版、警告、文字位置と描画の比較結果を残す。各図のディレクトリに元 PDF・TeX ソース・取り込み後 PDF・ログ・Poppler の検査結果・PPM 画像を残す。例えば日本語の結果を目視するなら、次を実行する（ImageMagick は任意）。

```sh
magick .sumi/pdf-latex/japanese/source.ppm .sumi/pdf-latex/japanese/source.png
magick .sumi/pdf-latex/japanese/lualatex-pdf17.ppm .sumi/pdf-latex/japanese/lualatex-pdf17.png
```

### 自動検査の内容

1. `sumi render` をソースから実行し、各図の PDF を新しく作る。
2. 元の図より幅・高さが 24bp 大きい、余白 12bp のページへ、縮尺指定なしの `\includegraphics{input.pdf}` で取り込む。**LaTeX の `pt` は PDF の pt と異なるため、ページ寸法には `bp` を使う**。
3. 両エンジンを既定の設定と PDF 1.7 の明示で実行する。コンパイル失敗・文字欠落は失敗扱い。警告はログと report に記録する。
4. 1 ページ・期待したページサイズ、元と同じ埋め込みサブセットと ToUnicode、同じ抽出文字、ラスタ画像 0 を検査する。単語の bbox は余白の 12bp を除いて、4 座標すべてを 0.02bp 未満の差で検査する。
5. 同じ Poppler で元と取り込み後を 144dpi で描画し、余白を切り取って比較する。細線のサブピクセル丸めを許容するため両方に 3×3 の box filter を適用し、RGB のいずれかが 64/255 を超えて異なる画素が全体の 1% 未満かを調べる。これは重大な描画崩れを検出するスモークテストで、文字位置の検査・目視確認と併用する。

PPM の比較は、同じ環境で作った2つの PDF の間だけで行う。OS ごとのラスタ画像を golden として管理する方式ではなく、既存の SVG / PDF のバイト一致 golden（設計 §6.7）も継続する。

## CI の判断

TeX は配布物・通常の単体テストから分離し、CI に専用の **PDF LaTeX inclusion** ジョブ（Ubuntu 24.04）を追加する。TeX Live の必要なパッケージと Poppler のみを `--no-install-recommends` で導入し、`bun run pdf:latex` を実行する。実行環境・PDF・ログ・画像・report は artifact `pdf-latex` として7日間残す。

今回の macOS 環境での検査時間は約 8.6 秒（TeX の導入時間を除く）だった。Linux の初回 CI は TeX / Poppler の導入・検査・artifact 保存を含むジョブ全体で55秒で成功した。すべての OS の単体テストへ TeX の導入を広げず、1 ジョブで実際の利用経路を継続検査する方針とした。

## 利用者向けの最小例

```tex
\documentclass{article}
\usepackage{graphicx}
\begin{document}
\includegraphics{figure.pdf}
\end{document}
```

Sumi の PDF は 1.7。古い TeX 環境などで出力 PDF の版がそれより低く、取り込み時にバージョンの警告が出る場合は、文書の先頭（`\documentclass` より前）で次のように PDF 1.7 を指定する。PDF/A・PDF/X 等への変換を行う設定ではない。

```tex
% pdfLaTeX
\pdfminorversion=7
```

```tex
% LuaLaTeX
\pdfvariable minorversion=7
```
