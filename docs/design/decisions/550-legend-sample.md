# #550 凡例の見本は sumi/legend の部品の見本にまとめ、サイトの Legends とギャラリーの legend-samples を外す

- **背景**: サイトの Options の「Legends」とギャラリーの `legend-samples` は、ハイパーグラフの対照学習の図で凡例の見本の種類を示していたが、凡例の説明には込み入っており、`sumi/legend` の部品の見本とも重複していた。
- **決定**:
  - `structuredSample` の `sumi/legend` の見本（内部では専用の関数 `legendSample(entry, theme)` が組み立てる。ギャラリーとサイトの別見本だった旧 `legendSample()` とは別物）を、入力 → [処理 ↔ 記憶] ⇢ 出力の小さな図（処理と記憶を集合で囲み、tone のある箱、実線・双方向・破線の線、特徴ベクトルのグリフを使う。矢じりが枠に載らないよう集合の padding は 5mm）と、その下に縦に並べた variant ごとの凡例（Boxes: 箱、Lines: 3 種の線、Marks: 集合とグリフ の 3 見出し、`flow: row`、`headings: inline`、`perRow: 3`）にした。各 variant が全部の見本の種類を示し、各項目は図が実際に使うものに対応する（`lint/unused-legend-entry` は静か）。
  - サイトの Options から Legends を外し、旧 `legendSample()` と、ギャラリーの `legend-samples` ページ（`docs/gallery/legend-samples*`）を削除した。描き直さずにまとめたのは、同じ内容を 2 か所で保守しないため。
  - `slides` は文字が 2 倍になり、2 つの凡例が `paper-double` に収まらないため、`sumi/legend` の見本だけ `presentation-16x9` で描く。
- **採らなかった案**: ギャラリーの `legend-samples` を同じ汎用の図で描き直して残す（部品ページと同じ図が 2 つになる）。
