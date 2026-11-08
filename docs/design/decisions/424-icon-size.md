# #424 アイコンの大きさを指定する（`iconSize`）

## 背景

アイコンは文字 1 つ分（1 em。ノードの文字の大きさ）の正方形に固定されていた（#94）。論文の図の試行（#412）では、
小さすぎるため、エージェントがアイコンを丸（`circle`）で囲んで大きさを稼ぎ、見た目が悪くなった
（「アイコンを丸で囲んでいるのがダサさが際立つ」）。囲みなしで、任意の大きさのアイコンを描けるようにする。

## 決定

### ノードに `iconSize` を足す

```yaml
- { id: db, component: label, icon: tabler/database, iconSize: 2.5 }     # 文字の 2.5 倍
- { id: chip, component: label, icon: tabler/cpu, iconSize: "12mm" }     # 長さ
```

- 数値: ノードの文字の大きさ（em）の倍数。`0.25` 以上 `24` 以下。
- 文字列: 単位つきの正の長さ（mm・cm・in・pt。`LayoutLength`）。単位なしの数字の文字列（`"12"`）や `px` は
  既存の長さと同じ診断で断る。数値を長さにも使える形（`12` を pt とみなす）にはしない。数値は em、文字列は長さと
  型で分かれるので曖昧にならず、添え物の `dx` / `dy`（em の数値）と同じ読み方になる。
- 省略すると 1 em。IR の `iconSize`（単位 = 0.5pt の整数、最小 1）は、指定があるときだけ付く。em の倍数は
  `倍数 × 文字の大きさ`、長さは `pt × 2` を、四捨五入して **0.5pt の整数** にする。整数にするのは、ラベルなしの
  `label` ノードの箱が `⌈幅⌉ × ⌈高さ⌉`（余白なし）だから、アイコンの正方形と箱が **ぴったり一致する** ためである。
- `icon` がないノードの `iconSize` は `asset/icon-size-without-icon`（`iconSize` の位置）。バッジは 1 em のままで、
  `iconSize` の影響を受けない（`badgeRect()` は `badgeSize()`、つまり文字の大きさを使う）。
- 1 つの関数 `iconSize()`（`src/assets/draw.ts`）がアイコンの一辺を決める。`iconBox()`（寸法の計算）、`iconRect()`
  （描く位置）、構造化エンジン、D2 の自動配置（`compiler/d2.ts`）、台形などの輪郭の寸法（`stretch-outlines.ts`）、
  幾何 lint の文脈（`iconAsLabel()`）がこれを使う。経路が 1 つなので、構造化・自動配置・各出力形式で食い違わない。

### 各部との関係

- **自然な大きさと配置**: アイコンはラベルの代わりなので、ノードの内容の箱は `iconSize` 角になる。`label` ノード
  （形 `text`）は余白がなく、箱 = アイコンの正方形。`box` / `circle` などは今までどおり余白を足し、アイコンを中央に置く
  （`labelCenter()`）。アイコンと文字を 1 つのノードに置く機能は今までどおりない（`asset/icon-with-label`）。
  文字を添えるには隣に `label` ノードを置く。
- **構造化・自動配置のどちらでも**、ノードの大きさはアイコンに合わせて大きくなり、隣のノードの大きさは変わらない。
  足場（footprint）は、バッジや添え物の張り出しを今までどおり本体の外へ足したもの。バッジは 1 em のまま。
- **辺の接続（ポート）**: アイコンだけの `label` ノードの箱はアイコンの正方形そのものなので、辺は正方形の縁に付く
  （余白の分だけ離れる、ということがない）。ただし Tabler のアートワークは viewBox の中に一辺の約 1/12 の余白を持つため、
  大きなアイコンでは、線の端がストロークの手前（余白の分）で止まって見える。**描かれた線の外接矩形には付けない**
  （採らなかった案を参照）。
- **lint**: アイコンは文字ではない（フォントを持たない）ので `geometry/text-too-small` の対象外のまま。
  `geometry/label-overflow`（固定の大きさの図形にアイコンが収まらない）、重なり、近接は、`iconSize` の大きさの正方形で
  検査する（`iconAsLabel()` がそのアイコンの高さを使う）。メッセージの「1 em」は、`iconSize` があるときは出さない。
- **線の太さ**: Tabler のアイコンは線（`stroke-width`）で描かれ、拡大すると線も太くなり重く見える。`iconSize` が
  あり、アイコンが同梱の Tabler のとき、描画時に各 `stroke-width` を「1 em のときの拡大率 ÷ 実際の拡大率」倍して、
  印刷される線の太さを 1 em のアイコンと同じにする（`compensateStrokes()`、`src/assets/draw.ts`）。塗りで描く
  emoji、`iconSize` のない図（拡大率が同じなので何も変えない）、バッジは変えない。マークアップだけを書き換えるので、
  SVG・PDF・picture PPTX は同じ結果になる。`iconSize: 1` は指定なしとバイト単位で一致する。
- **出力形式**: SVG は `g.sumi-icon` の `transform` の拡大率が変わるだけ。PDF と picture PPTX は SVG から作るので、
  アイコンの経路も同じ大きさに出る。編集可能 PPTX は今までどおりアイコンを断る（`pptx/unsupported-asset`）。
- **凡例の見本**: `legend` の `icon` の項目が `iconSize` を取る（ノードと同じ型・同じ範囲）。展開される `label` ノード
  `<legend>-<n>-box` にそのまま渡すので、配置・lint・出力形式はノードと同じ経路になる。`iconSize` は `icon` と
  同じ項目に書く（それ以外では `component/invalid-prop`）。

### lint `lint/icon-enclosure`（info）

アイコンを大きく見せるためだけに円や箱で囲むパターン（ユーザー指摘 2026-11-09）を検出し、囲みなしの `label` と
`iconSize` を勧める。誤検出を避けるため狭くする。

- 対象: 作者が書いた、組み込みの `circle` / `box` で、`icon` を持つノード。
- 対象外（図形に意味があるとみなす）: `tone`、`variant`（既定以外）、`props.width` / `height`、`iconSize`、`badge`、
  `glyphs` のいずれかがあるもの。色や見た目を選んだ図形はカテゴリの印であり、大きさの代用ではない。
  大きさの明示は、作者が枠の寸法を決めている印とみなす。凡例の見本など、展開された部品は対象外。
- 重大度は info（図は壊れておらず、好みの問題を含むため）。診断はノードの `component` の位置を指す。
- 既存の図で info が出るもの（出力は変わらない）: Transformer の位置符号化の円（`sine` の円。
  `examples/transformer`、`skills/sumi/examples/transformer`、`tests/fixtures/figures/compact/a-transformer`、
  `tests/fixtures/figures/layout/align-side-kv`）と、`tests/fixtures/assets/images*.sumi.yaml` の `sine`。
  これらは慣習的な「円の中のアイコン」の記法で、意図した囲みなので、info のまま残し、書き換えない。
  ギャラリーの見本には出ない。

### Skill と文書

`skills/sumi/references/assets.md` ほかに、アイコンは丸で囲まず `iconSize` で大きくすること、凡例の見本も同じ
指定に従うこと、余白の注意を書いた。ギャラリーは `legend-samples` に、大きさ違いのアイコンのノードと、凡例の
大きさ違いの見本を足した。

## 採らなかった案

- **アイコンの描かれた線の外接矩形に辺を付ける**: 同梱アイコンごとに経路の外接矩形を測る必要があり（取り込みは
  座標を保持するだけで、測る処理がない）、`currentColor` を持つ線の太さまで含めて決める必要がある。さらに、
  1 em の既存の図は出力を変えてはならないので、`iconSize` があるときだけ別の規則になり、契約が割れる。
  代わりに箱 = アイコンの正方形を保証し、余白は文書に書く。必要なら辺の `gap` や `fromAnchor` で調整できる。
- **`size` という名前を `props` に置く**: `props` は部品ごとの値で、`icon` は `label` 以外にも `box` / `circle` に付く。
  `icon` と並ぶノードのフィールドのほうが、`icon` の有無の検査（`asset/icon-size-without-icon`）と、
  凡例の項目（`icon` と `iconSize` の組）に揃えられる。
- **数値を pt の長さとして読む**: 既存の長さは単位が必須（`parseLength`）で、単位なしの数字は誤りとして断っている。
  数値だけ例外にすると、`glyphs[].size`（単位つき）と `dx`（em）の両方と食い違う。
- **アイコンの縁取り用の図形（円）を標準にする**: 見た目が悪かったことが問題の発端であり、囲みは不要。
- **バッジにも `size` を付ける**: この issue の範囲外（バッジは角の目印で、1 em が前提の張り出しの計算がある）。
  必要になったら別の issue で足す。

## 互換性

- `iconSize` がない図は、IR にも出力にも変化がない。`iconSize: 1` と書いた図は、`input-sha256`（入力の文字列の
  ハッシュ）を除いて、書かない図と SVG が一致する（テストで確かめる）。
- リポジトリ内のすべての `*.sumi.yaml` を、図自身のテーマと組み込みの 6 テーマで、SVG・PDF・PPTX・D2 に描いて
  変更前後の sha256 を比べた（`research/` と非公開の図は除く）。`iconSize` を使わない図はすべて一致する。
  変わる出力は、`bun run gallery` が再生成する `docs/gallery/legend-samples/*` と
  `docs/gallery/*.md` / `index.html` のみ（見本に大きさ違いのアイコンを足したため）。
- 線の太さの補正は、`iconSize` を書いた Tabler のアイコンの出力だけを変える（既存の図には影響しない）。
- 公開した型の追加: IR の `NodeIR.iconSize`（任意）、図の JSON Schema の `nodes[].iconSize` と
  `legend` の項目の `iconSize`（`schema/figure.v1.schema.json`）。診断 `asset/icon-size-without-icon` の追加。
