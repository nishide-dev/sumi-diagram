# #634 sumi テーマのグループ枠を細く淡くする

## 背景

#608 で `sumi` / `sumi-dark` の既定と `muted` のパネルをキャンバスと同じ塗りにした。塗りでパネルと中のノードを分けられなくなり、区切りは枠だけになった。その枠は muted の灰色（`sumi` #4e566b、`sumi-dark` #acbac4）の 1pt で、ノードの 1pt の紺（クリーム）の枠と太さが同じで色も近く、パネルが箱の一つのように見えた。#603 のレビューでは `paper` のような 0.5pt の淡い灰色の枠が提案されており、#608 でユーザーが枠を細くすることを了承した。

## 決定

- `sumi` / `sumi-dark` のコンテナが描く枠を 0.5pt の淡い灰色にする。
  - `sumi`: #a9aebc（白に対して 2.2:1）。`paper` の #b4b8c0（2.0:1）と同じ考え方で、紺の文字に合わせて少し青みのある灰色。
  - `sumi-dark`: #6f7791（紺のキャンバス #30364f に対して 2.7:1）。暗い地の細い線は沈みやすいため、明るい版より少しコントラストを上げた。
  - 実装はテーマのトークン `line.frame: 0.5pt` と `components.container.default`（全 variant の下に敷く層）。`base.group` は変えない。
- 対象は default・`muted`・`dashed`・`dotted`（`dashed` から作られる）と、`layers`・`plane` の枠、tone 付きのグループの枠。`muted` は見出しが灰色のまま、枠は default と同じ。
- 変えないもの:
  - ノードの枠（1pt の紺／クリーム）、`filled` の塗り（砂色）。
  - `filled-dashed` の枠: 砂色の塗りの唯一の境界で、淡い枠は砂色に対して 1.6:1 しかなく見えなくなる（`geometry/low-stroke-contrast` もこの variant だけは枠を検査する）。従来の灰色 1pt の破線のまま。
  - 集合（sets）の輪郭: これまでコンテナの既定の枠から線幅を取っていたが、テーマの `base.group` から取るようにした。集合は分類を表す輪郭でパネルではないため、1pt の tone の線を保つ。ほかのテーマはコンテナに既定の層を持たないので、結果は変わらない。
  - 凡例の枠: `legend` の部品の層（muted の灰色、`base.group` の 1pt）のまま。
- `themeOverrides.groupStroke` / `frameWidth` は従来どおり枠を置き換える（濃い・太い枠に戻したい図はこれで戻せる）。
- パレット: 淡い枠の色は明度でパレットの役割に写る（`sumi` は muted、`sumi-dark` は tint）。線幅は 0.5pt のまま。

## 減光（`dim: true`）

- 淡い枠にしたことで、減光したパネルの枠が通常のパネルより濃くなる逆転が起きた（減光は線をテーマの `dim.stroke` にするため。`sumi` では #4e566b、`sumi-dark` では #acbac4 で、どちらも新しい枠より強い）。
- 減光の規則を「枠を目立たせない」に改めた: 減光したグループ（凡例の枠を含む）の枠は `dim.stroke` にするが、元の枠のほうがキャンバスに対してコントラストが低ければ元の枠のままにする（`dimStyle`、`dim.ts`）。`sumi` 専用の分岐ではなく、すべてのテーマに効く一般の規則にした。
- ノードと辺の線は従来どおり `dim.stroke` にする。線全般に広げると、`sumi` の `solid` の青い輪郭（キャンバスに対して `dim.stroke` よりわずかに低いコントラスト）が tone の色のまま残り、減光で色を落とす意図に反した。`llama` の operator の淡い枠（#cbd2d9 → #9aa5ae）も同じ逆転だが、ノードの線なので今回は変えていない。
- 同じ逆転は `paper` にもあった: 既定のパネルの枠（#b4b8c0）が減光で #949494 に濃くなっていた。この規則で元の淡い枠のままになる。ギャラリーの dim の図（paper・sumi・sumi-dark）がこれで変わり、ほかのテーマ（minimal・academic・slides・color・llama）の出力は変わらない。論文の再現図・examples・PDF / PPTX のゴールデンは変わらない（減光した図を含まない）。
- テスト: `sumi` / `sumi-dark` で、減光したパネルの枠のコントラストが通常のパネルの枠以下であること、減光したノードは従来どおり `dim.stroke` になること。

## lint

- `geometry/low-stroke-contrast` はグループの枠を検査しない（#463。`filled-dashed` だけ例外で、その枠は変えていない）。新しい枠で誤って出ることはなく、閾値は変えていない。
- 枠の線幅を使う規則（`edge-on-border`・`edge-near-border` の距離、`label-on-border`、ラベルの内側余白）は線幅が細くなった分だけ判定が緩くなる方向にしか動かない。
- `lint --geometry` を Skill のベースレイアウト 32 件と README の図に、`sumi` と `sumi-dark` に置き換えた写しも含めてかけ、変更の前後で診断が一致した（新しい診断も消えた診断もない）。lint 出力のゴールデン（tests/fixtures/lint-output/）も変わらない。
- 色の数え上げ（`color-census`）は枠の色を線の色として数える。淡い灰色が 1 色増えるが、無彩色なのでアクセントには数えられない。

## 影響

- 見た目が変わるのは `sumi` / `sumi-dark` で枠を描くグループを持つ図だけ。ギャラリー 14 枚（compare の pipeline 4、container・zoom・dim・strokes・tones の各 2）と Skill のベースレイアウト 11 枚（actors-and-tools、agent-loop、encoder-block、layered-stack、nested-containers、pipeline-branch-merge、pipeline-linear、projected-planes、stacked-planes、three-panel-flow、train-infer-panels と、その PNG・previews.json）。
- 枠を描かない `plain` のグループ（matrix・tokens の外枠、README の図の agent のグループなど）は SVG の `stroke` 属性だけが変わり（線幅 0）、画素は変わらない（README の図、bracket・matrix・tokens のギャラリー、encoder-decoder・feature-table・moe-router・two-panel-compare）。
- 論文の再現図（examples/）は色を固定しているため変わらない（reproduction-hashes は更新なし）。
- 旧出力とのバイト一致を確かめるテスト（projected planes の #586 前、straighten の #620 前）は、`themeOverrides: { groupStroke: "#4e566b", frameWidth: 1pt }` で従来の枠に戻して比べる（#608 の `groupFill` と同じやり方）。
- Skill の下絵テンプレート（mockup-template.html）の `--group-frame-w` は `sumi catalog --sizes --css` の出力どおり 0.5 になり、枠の色 `--frame` を足した。

## 採らなかった案

- `base.group` を変える: 集合と凡例の枠まで細くなる。集合は意味のある輪郭なので、パネルの枠と分けた。
- もう少し濃い枠（`sumi` #9ea3b2、`sumi-dark` #7a8299）: 比較画像を別に用意した。パネルの境界ははっきりするが、ノードの枠との差が小さくなる。
- `dotted` だけ 1pt にする: 0.5pt の淡い点は細かく見えにくいが、`dotted` は `dashed` から作る仕組みで、テーマごとに分けるにはコードの変更が要る。`paper` も同じ 0.5pt の点線であり、まずはそろえる。
