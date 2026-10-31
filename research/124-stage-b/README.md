# #124 段階 B の調査（試作と測定）

[調査メモ](../../docs/research/124-stage-b.md)、[Issue #124](https://github.com/nishide-dev/sumi-diagram/issues/124)。関連: #80（ロードマップ）、#86（[論文図の調査](../../docs/research/86-paper-figures.md)）、#109（[v0.4.0 の dogfooding](../109-dogfood-v0.4/README.md)）。

製品の `src/`・schema・examples・golden は変更しない。ここのコードは製品の `src/` を読むだけで（import と、実行時に読み込んで `out/` に書く改変コピー）、製品のコードはこのディレクトリを参照しない。

## 固定した基点

| 対象 | 版 |
| --- | --- |
| Sumi | `5cf29f6`（v0.4.1。改変コピーのパッチはこの `src/` に対して書いた） |
| Bun | 1.3.14 |
| D2 | v0.9.0（`bun run d2:install`。`measure/d2-probes.ts` だけが使う） |
| PDF/PNG エンジン | 製品の `assets/wasm/sumi-pdf.wasm`（krilla 0.8.2 / resvg 0.47.0、無変更） |
| フォント | 同梱の BIZ UDPGothic 1.051、STIX Two Math / Text Italic 2.13 |
| 外部ツール（画像の確認用） | Poppler 26.04.0（`pdftoppm`）、ImageMagick 7.1.2、Google Chrome 156.0.8078.48（`measure/accents.ts` のみ。無ければその描画を省く） |

測定の環境: macOS 26.2 / arm64（Apple M4 Pro）。時間はこの環境の中央値で、CI の golden にはしない。件数（交差・経路長など）は決定的。

## 構成

| パス | 内容 |
| --- | --- |
| `figures/*.sumi.yaml` | #109 の 4 図を**提案構文**（`requires: ">=0.5.0"`）で書き直した草案。`seq2seq-attention.side-kv` は図 1 の整列の別案。画像 3 点は #109 からの複製 |
| `lower.ts` | 草案を v0.4.1 が受け付ける形に下ろす。`caption`・`legend` は製品が行う予定の展開をここで行い、`align` は制約として取り出し、`labelAt`・`labelSide`・アクセントは外す（外したものを `dropped` に列挙） |
| `labels.ts` | 見出しの位置（`top-left` / `top-right`: 上端の帯の中で寄せる）と辺の `labelAt`（ルータの改変コピーの `HOOKS.labelEdge` でラベルの配置に代わりの辺を渡す）の試作 |
| `patch.ts` | 製品のモジュールの改変コピーを作る共通処理（パッチはそれぞれちょうど 1 回一致しなければ例外） |
| `route/variant.ts` | ルータ（`router.ts`）と端点（`ports.ts`）の改変コピー: 費用の上書き、辺の順序、交差の履歴の費用、辺（side）の選び方のフック。フックなしでは製品と同じ出力（テストで確認） |
| `route/strategies.ts` | 交差削減の各案（費用・順序・rip-up・交渉・口の割り当て・配置の木による辺の選択） |
| `route/bench.ts` | 各案 × 図（#109 の 4 図、anchor を外した図 3、図 3 の草案、作例 2、合成図 2）の交差・経路長・時間 |
| `route/same.ts` | 案ごとに、作例・fixture・#109 の図の経路がバイト単位で製品と同じかを調べる（golden の互換性） |
| `align/solve.ts` | 箱をまたぐ整列: 製品の配置エンジンの改変コピー（項目の前後の詰め物 strut）と、それを解く固定点の反復 |
| `align/run.ts` | 整列の草案（図 4、図 1 の別案）を解き、前後を比べる |
| `measure/accents.ts` | 数式アクセントのフォントの事実（cmap・advance・GPOS・MATH）と 4 方式の描画（製品の PDF エンジンと Chrome）、提案の表現（方式 E: 1 つの `<text>` の中の絶対位置の chunk、#112 と同じフォントのコピー）の描画と PDF の抽出 |
| `measure/d2-probes.ts` | 固定版 D2 の `label.near`（group・edge）、矢じりのラベル、凡例・キャプションの部品 |
| `drafts.ts` | 草案ごとに、v0.4.1 の反応、下ろした図の診断・大きさ・経路、試作が描いた図そのものの幾何 lint（製品の finalize・inspect を通す）、別の見出し・ラベル位置の衝突、#109 の原図との比較 |
| `stage-b.test.ts` | 試作の検査（ネットワーク・D2 不要）。改変コピーのパッチ先が製品の変更で見つからなくなった場合だけ、コピーを使う検査を理由を出して skip する（ほかの例外は失敗）。草案が `requires` で止まる検査は、製品の版が 0.5.0 未満の間だけ行う |
| `results/*.json` | 測定のスナップショット（`--record` で更新） |
| `previews/*.png` | 調査メモで参照する描画の縮小版（`out/` の PNG を ImageMagick で縮小・減色したもの。各 70KB 未満） |

## 再現

```sh
bun install --frozen-lockfile
bun run d2:install                                   # measure/d2-probes.ts のみ
bun research/124-stage-b/route/bench.ts --record     # 交差削減（約 2 分）。--svg で out/route/ に SVG/PDF/PNG
bun research/124-stage-b/route/same.ts sides-tree ports-fan-in cost-cross-600
bun research/124-stage-b/align/run.ts --record       # 整列。out/align/ に前後の SVG/PDF/PNG
bun research/124-stage-b/measure/accents.ts --record # アクセント。out/accents/ に PNG
bun research/124-stage-b/measure/d2-probes.ts --record
bun research/124-stage-b/drafts.ts --record          # 草案。out/drafts/ に PNG
bun run test research/124-stage-b
```

- `out/`（gitignore）に、改変コピー（`router-variant.ts` など。先頭に `@ts-nocheck`）と描画結果を書く。
- PNG は Poppler の `pdftoppm` で、製品の PDF エンジンが作った PDF から作る（`measure/accents.ts` は Chrome の screenshot も）。
- `--record` は `results/` を書き換える。時間は環境で変わるので、差分は件数の列で確かめる。

## 注意

- 改変コピーは調査用で、Diagnostic の位置・lint・PPTX とは接続していない。製品の `src/` が変わってパッチが当たらなくなったら、`patch target found 0 times` で止まる（テストは skip）。
- 草案は構文の方向を示すもので、`lower.ts` が扱わないフィールド（`labelAt`・`labelSide`・アクセント）の効果は描画に出ない。どこまで描けているかは `drafts.json` の `dropped` を見る。
