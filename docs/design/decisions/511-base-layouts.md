# #511 ベースレイアウト集の置き場所と形式

## 背景

#509 の調査では、エージェントの初稿 16 枚のうちそのまま使えるものは 0 枚で、失敗の多くは構成（配置・まとまり）にあった。よくある構成を、見て確かめた YAML として先に持たせれば、最初から良い構成で始められる。

## 決定

- 置き場所は `skills/sumi/layouts/<name>/`。Skill の一部として配布され、`examples/` とは別にする。examples は公開された図の再現（色を固定、ハッシュで保護）や完成例であり、layouts は内容の薄い汎用の骨組みで、エージェントが直して使う。
- 1 ディレクトリに `<name>.sumi.yaml`（一次ソース）、`<name>.svg`（`bun run gallery` が生成、`gallery:check` が検出）、`<name>.png`（Skill が画像として見るためのサムネイル。`bun run skill:previews`）。
- YAML の先頭コメントに Layout / Use when / Structure / Change / Lint の 5 項目。テストが存在を検査する。lint は error 0 / warning 0、info は理由を Lint 欄に書く。
- 索引は `layouts/README.md` の表（名前・構造・使いどころ・サムネイル）。テストが表とディレクトリの一致を検査する。
- Skill の手順 4（下絵と同じ段）に「最も近いレイアウトを選び、コピーして直し、どれを使ったか報告する」を置く。該当がなければ examples か白紙から。
- ラベルは「Stage A」「Item B1」のようなプレースホルダーにし、論文名・製品名・著者・所属を含めない。テーマは既定の `sumi`。
- 再現ハッシュ（`reproduction-hashes.json`）には載せない。layouts は固定された再現ではなく、Sumi の変更で出力が変わってよい（SVG は `gallery` で更新）。壊れたら lint・描画のテストで分かる。

## 採らなかった案

- `sumi catalog` から引く: コンポーネントの目録と性質が異なる（図の構成であり部品ではない）。まず Skill の索引で足りる。数が増えたら検索を検討する。
- examples に混ぜる: 再現（固定）と骨組み（直して使う）で保守の方針が違う。
- 1 枚の YAML に複数の骨組み: 直して使うとき、不要部分の削除が増える。

## 互換性

既存の図は変わらない。`gallery` が layouts の SVG を新たに生成し、biome の対象から layouts の SVG を除外する（examples と同じ）。種の 4 枚は #509 の 1B・4B・6A・8B から。8B は set の `minWidth` / `minHeight`（#518）で隠し junction を置き換えた。
