# #550 凡例の見本は sumi/legend の部品の見本にまとめ、サイトの Legends とギャラリーの legend-samples を外す

- **背景**: サイトの Options の「Legends」とギャラリーの `legend-samples` は、ハイパーグラフの対照学習の図で凡例の見本の種類を示していたが、凡例の説明には込み入っており、`sumi/legend` の部品の見本とも重複していた。
- **決定**:
  - `structuredSample` の `sumi/legend` を、入力 → 処理 → 出力の小さな図（tone のある箱、実線と破線、集合、特徴ベクトルのグリフ）と、その下に variant ごとの凡例（Boxes / Lines / Marks の 3 見出し、`flow: row`、`headings: inline`、`perRow: 2`）を並べる形にした。各 variant が全部の見本の種類を示す。
  - サイトの Options から Legends を外し、`legendSample()` と、ギャラリーの `legend-samples` ページ（`docs/gallery/legend-samples*`）を削除した。描き直さずにまとめたのは、同じ内容を 2 か所で保守しないため。
  - `slides` は文字が 2 倍になり、2 つの凡例が `paper-double` に収まらないため、`sumi/legend` の見本だけ `presentation-16x9` で描く。
- **採らなかった案**: ギャラリーの `legend-samples` を同じ汎用の図で描き直して残す（部品ページと同じ図が 2 つになる）。
