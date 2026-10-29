# #126: grid の受け入れ検証

## 配置

- `c-h3world.sumi.yaml`: #185 の H3-World の (a) の 5 本の列の stack を、5 列×4 行の grid に転置。画像＋画像のラベル、キーの局所配置、refiner と sequence の外側の stack、左の見出しの align は保持する。`assets/` は元と同じ placeholder の画像。
- `tests/fixtures/figures/layout/grid-training.sumi.yaml`: #109 図 2 のノード・辺を、4 列×2 行の grid（optimizer は span 2）で配置。2 つのグループの枠は取り除き、画像は fixture の `grid-assets/` に複製する。
- 再生成: `bun research/126-grid/rewrite.ts`。
- 検証: `bun test src/layout/structured/grid.test.ts src/render/grid.integration.test.ts`。

H3-World は元と書き換えの両方を実際に描き、**全 node・group の rect が完全一致**した（小差なし）。column-stack の各列で各段の自然な高さが同じなので、grid の行高も同じになる。SVG の辺は grid 内では箱の主軸による側選択ではなく矩形から側を選ぶが、矩形の一致は経路を付けた後の Layout IR で検証する。図 2 は SVG・PDF・画像方式 PPTX の変換も通る。

## 既存出力のバイト互換性

変更前のリポジトリ内の `*.sumi.yaml` **138 本すべて**を、各図の Theme と全組み込み Theme（minimal / academic / slides / color / paper）で描画した。変更前後それぞれ **828 回**を試し、562 回が SVG まで通った。描画・変換できた出力の sha256 はすべて一致した。

| 出力 | 比較件数 | 変更 |
| --- | ---: | ---: |
| D2（compile が通った auto のソース） | 234 | 0 |
| SVG | 562 | 0 |
| PDF | 562 | 0 |
| 画像方式 PPTX | 562 | 0 |
| 編集可能 PPTX（freeform） | 416 | 0 |
| 編集可能 PPTX（glued） | 404 | 0 |

描画不能だった組み合わせ・対応しない export は前後とも出力なし。診断のコード列が変わったのは `research/86-paper-figures/figures/ideal/c-h3world.sumi.yaml` だけ（元々 grid を含む未対応フィールドの多い草案で、前後とも schema error により描画しない）。既存の作例・ギャラリー・golden の更新は不要で、`gallery:check` は 155 ファイルの一致を確認した。

再現用の `compat.ts` は、変更前に `before`、変更後に `after` を指定して実行する。比較対象のリストと各形式の hash を `.sumi/compat-before.json` / `compat-after.json` に保存する。後の実行は baseline のリストを使うので、新しい受け入れ例は既存図の互換性比較に混ぜない。`compare` で保存済みの manifest だけを比較できる。今回の最終 sweep は、元の HEAD の `src`・`assets`・`package.json` を同じ worktree の `.sumi/baseline/` に git archive で展開し、`before --baseline` で変更前のコードを呼んだ（比較リストは変更前から存在する 138 本）。

## 設計

構文・空のセル・span の診断・sizing・align の規則は `docs/design/phase1.md` §6.59。grid は structured 専用で、auto では `layout/structured-only`。新しい間隔の既定値は足さず、Profile の arrangeGap（compact を含む）を使う。

レビュー後、空セルは明示的な `null` / `~`（複数列なら `{ item: null, span: N }`）にした。ノード・障害物・net 端点を作らず、辺が直進できることを検証。上記 2 図に junction の空セルはない（H3-World の `b-out` は辺が接続する実際の端点なので保持）。縦位置は常に中央で、直接のセルを `figure.layout.align` で上辺・下辺に揃えることはできない。必要な場合は入れ子の線形の箱を使う。直接のセルの位置付き診断・祖先の strut による grid 全体の移動・反復で子のサイズが変わったときの track 再計測も回帰テストに追加した。
