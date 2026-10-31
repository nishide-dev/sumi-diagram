# #86 論文図への対応の調査

[調査メモ](../../docs/research/86-paper-figures.md)、[Issue #86](https://github.com/nishide-dev/sumi-diagram/issues/86)。製品コードはこの研究ディレクトリを参照しない。製品の src・schema・examples・golden は変更しない。

元の論文の図（Transformer / DiT / H3-World）は著作権のためリポジトリに入れない。ここにあるのは、構造だけを書き起こした自作の YAML と、それを描く試作である。

## 構成

| パス | 内容 |
| --- | --- |
| `figures/ideal/a-transformer.sumi.yaml` | 図 A の**提案構文**による理想の YAML。試作 `proto/` が実際に配置・描画する |
| `figures/ideal/b-adaln-panel.sumi.yaml` | 図 B の 1 パネル（共有の幹線・矢じり近くのラベル・数式ラベル・キャプション）。試作が描く |
| `figures/ideal/b-dit.sumi.yaml`、`c-h3world.sumi.yaml` | 図 B・C 全体の理想の YAML（提案構文の草案。試作は描かない） |
| `figures/v1/a-transformer.sumi.yaml` | 現行スキーマ v1（Sumi v0.3.1）で図 A をできるだけ近づけた版。製品の `renderFigure()` で描く |
| `proto/` | 構造的配置（stack / row / attach）・直交ルーティング・SVG 出力・幾何検査の試作 |
| `measure/` | D2 の挙動、製品の PDF/PNG エンジンでの画像、同梱フォントの字形、npm パッケージ、アイコン集、MathJax、配置ライブラリの測定 |
| `run.ts` | すべての測定を実行する |
| `locks/` | `.tools/` 内の研究用プロジェクト（MathJax、配置ライブラリ）の lockfile |
| `results/report.json` | 測定スナップショット（macOS arm64） |

提案構文の YAML は、現行の Sumi では `schema/unsatisfied-requires`（`requires: ">=0.5.0"` 等）で止まる。`run.ts` は `requires` を外した場合の未知フィールドも記録する。

## 再現

前提: Bun（`package.json` の版）、ネットワーク（`--offline` 以外）、ImageMagick 7（`magick`。合成画像の生成と PNG の検査）、Poppler（`pdfimages` / `pdffonts` / `pdftotext`）、`tar`。使った版は report の `environment.tools` に記録する。

```sh
bun install --frozen-lockfile
bun run d2:install                          # 固定 D2 v0.9.0（v1 版の描画と D2 プローブ）
bun research/86-paper-figures/run.ts        # 全測定。出力は out/（gitignore）
bun research/86-paper-figures/run.ts --offline     # npm / GitHub へのアクセスを省く
bun research/86-paper-figures/run.ts --only proto  # proto | schema | v1 | d2 | engine | glyphs | packages | icons | bundles | mathjax
bun run test research/86-paper-figures      # 試作の検査（ネットワーク・D2 不要）
```

- `out/` に、試作の SVG と、製品の WASM エンジン（krilla / resvg、無変更）で変換した PDF・PNG、v1 版の SVG/PDF/PNG、D2 プローブの `.d2` / `.svg` を書く。
- ネットワークを使う測定は、npm registry の tarball を **sha512 integrity で検査して** `.tools/`（gitignore）に置き、実行のたびに検査済みの tarball から展開し直す（既存の展開済みの木は信用しない）。MathJax と配置ライブラリは `.tools/` 内の独立した `package.json` に `bun install --ignore-scripts` で入れ、推移的な依存の版は `locks/*.bun.lock`（コミット済み）で `--frozen-lockfile` に固定する。root の `package.json` / `bun.lock` / `node_modules` は変更しない。
- 外部ツールが失敗した・想定外の出力だった場合は、0 件として記録せずに実行を止める（`measure/tools.ts`）。
- MathJax の測定は `bun build --compile` で 2 つの実行ファイル（MathJax あり / 最小の対照）を作り、サイズ差を測る。数十秒かかる。
- 試作は `@tabler/icons` を取得済みなら `tabler/wave-sine` を `.tools/` の SVG から読み込み、未取得なら同じ形の組み込みの代替を使う（テストはこちら）。`run.ts` は試作より先に tabler を取得するので、初回でも再実行でも同じ SVG になる。`--offline` では代替のアイコンになり、試作 SVG の sha256 は report と変わる（report の `environment.icon` に記録）。
- 測定スナップショットを意図して更新する場合だけ `--record` を付ける。時間・サイズ・OS 依存の値を CI の golden にはしない。

## 注意

- 試作は調査用で、Diagnostic・位置情報・Theme・Profile・lint とは接続していない。エラーは例外の文字列で返す。
- 試作の SVG は、フォントを D2 の埋め込み `@font-face` ではなく実 family 名（`BIZ UDPGothic`）で指定する。製品の PDF/PPTX エンジンはこれを同梱 TTF に解決するが、ブラウザで SVG を開くと閲覧環境のフォントになる。製品化ではフォントのサブセット埋め込みが必要（調査メモ §5.4）。
- `figures/` の画像パス（`assets/frame-00.png` など）は構文例のための仮の値で、ファイルは置かない。
