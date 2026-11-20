# #605 / #606 アイコンと文字を 1 つのノードに置く、アイコンの使いどころの案内

## 背景

アイコンを付けるとラベルが消えた（`asset/icon-with-label`）。名前付きのアイコンには別の `label` ノードを attach する必要があり、
エージェントは箱だけで済ませがちだった（#603 の試行でも 2 枚で引っかかった）。Skill のアイコンの案内も「物やデータは絵で」の
1 行だけで、アイコンを積極的に使わなかった。

## 決定

### 描画（#605）

- ノードに `iconAt: left | top` を足す。`icon` と（空白でない）`label` が両方あるときだけ意味を持つ。省略時は `left`
  （今まで両方書くとエラーだったので、既定を決めても既存の出力は変わらない）。IR の `NodeIR.iconAt` は両方があるときだけ入り、
  アイコンだけのノードには入らない。
- `left` は「アイコン、間隔、文字」を 1 行のブロックとして縦中央に、`top` は「アイコン、間隔、文字」を縦に積み横中央に置く。
  間隔はフォントサイズの 0.4（アイコンの絵の余白と合わせて、文字から離れすぎず詰まらない値）。既定のアイコンの大きさは `left` が 1.2 em、`top` が 1.8 em（カードのアイコンは 1 em では小さい。`iconSize` が優先）。ノードが内容より広いときも、アイコンと文字は 1 つの塊として中央に置く（テストで確認）。
  `sublabel` は文字ブロックに含まれる（アイコンは label と sublabel の外接矩形の横か上に付く）。
- 大きさ: structured のエンジンが、アイコン＋間隔＋文字ブロックの箱を「ラベルの箱」として `nodeSize()` に渡す。図形ごとの
  余白・安全領域の計算は、ふつうのラベルと同じ経路なので、box・circle・ellipse・diamond・label がそのまま収まる
  （`circle` と `diamond` は余白が大きく不利なので、Skill は `box` を勧める）。文字の中心は箱の中心から、アイコンと反対側へ
  `(iconSize + gap) / 2` ずらす。
- アイコンの位置は、描いた文字ブロックの箱から決める（`iconRectBesideText()`）。SVG の書き出しと幾何 lint が同じ関数を使うので、
  structured の配置と lint の測定がずれない。幾何 lint の文脈は、アイコンの正方形を「文字のない 1 行のラベル」として加える
  今までの扱い（#94）を保ち、`label-overflow`・`label-collision` などがアイコンも含めて掛かる。アイコンと文字がともにあるノードの
  メッセージは「label」と書く（`hasIcon` はアイコンだけのノードを指す）。`lint/icon-enclosure` は文字のあるノードを対象外にした。
- PDF・picture PPTX は SVG から作るので変わらない（アイコンは今までと同じ `g.sumi-icon`）。編集可能な PPTX は、アイコンだけの
  ノードと同じく `pptx/unsupported-asset` で断る。Tabler の tone による色づけ（#445）は `label` ノードに `tone` があれば
  アイコンと文字が同じ色になる。emoji は元の色のまま。
- auto（D2）は対象外にした。D2 は文字の大きさを自分で測り、ノードの大きさとラベルの位置を決めるので、structured と同じ
  箱にするには文字の測定を D2 の前に持ち込み、文字を移動する合成の段が要る。必要性が薄い（アイコン付きの図は structured が
  ふつう）ので、`asset/icon-with-label` を残し、ヒント（`figure.layout.arrange`）を付けた。
- `iconAt` だけを書いたとき（`icon` か `label` がない）は `asset/icon-at-without-label`。`labelRotation` と `icon` の併用は
  引き続き `component/label-rotation-unsupported`。

### lint（#606）

- `geometry/icon-family-mix`（info）: ノードのアイコンに `tabler/*` と `emoji/*` が両方ある。凡例の見本、tokens・matrix の部品、
  バッジは数えない。
- `geometry/icon-overuse`（info）: ラベルかアイコンのあるノード（凡例・tokens・matrix の部品とキャプションを除く）が 6 以上で、
  80% 以上がアイコンを描く。しきい値は「ほぼ全部」を指す値で、リポジトリ内の `*.sumi.yaml` 171 枚（`research/` を除く）を
  幾何 lint にかけ、どちらの規則にも該当する図がないことを確かめた（17 枚がアイコンを使う）。
- どちらも info で、`maxWarnings` には入らない。

### Skill（#606）

- `references/assets.md` に「アイコンを使うとき」（使う場面・使わない場面、1 つの図で 1 つのファミリー、大きさと置き場所、
  概念と Tabler の名前の対応表。名前はすべて `sumi catalog --icons` で同梱を確かめた）と icon + label の節を足した。
  `SKILL.md`（本文 250 行未満の制限内）、`layout-tips.md`、`figure-format.md`、`diagnostics.md` から参照する。
- ベースレイアウト `actors-and-tools`: 利用者・エージェント（`iconAt: top`）、ツール・データベース（`left`）をアイコン＋文字の
  ノードにし、演算（Rerank、Summarise）は文字だけの箱にして、アイコンが役者と物だけに付く例にした。幾何 lint は 0 / 0 / 0。

## 採らなかった案

- **`labelPosition: below | right` の付属ラベルを内部で作る**（#603 のレビューの案）: ノードが 2 つに分かれて辺の端・
  衝突・グループの扱いが複雑になる。1 ノード 1 箱の方が、箱の枠・tone・辺の接点が自然。
- **`iconAt: right | bottom`**: 利用者の要望は左と上。必要になれば足せる。
- **`icon` と `label` の既定を `top`**: 行（左から右）に並べる使い方が多く、幅の増え方も小さいので `left`。

## 互換性

- 既存の図の出力は変わらない（`iconAt` は新しい任意の項目。アイコンだけのノードの IR に `iconAt` は入らない）。
  `gallery:check`、作例・再現図のハッシュ、Skill のベースレイアウトの SVG は一致した。追加は `actors-and-tools` のレイアウトと、
  JSON Schema の `iconAt`、catalog・Skill の記述。
- `asset/icon-with-label` は structured では出なくなった（以前はエラー）。auto では引き続き出る。
