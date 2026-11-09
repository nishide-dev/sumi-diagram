# #441 再現図の色を元の図に固定する

## 背景

transformer、dit-block、clip などの再現図は、tone の色とパネルの塗りを `paper` テーマの既定に任せていた。#434 で `paper` の tone を変えると再現図の色まで変わり、ユーザーから「既存の examples はあくまで論文の再現図のはず」という指摘があった（2026-11-09）。#440 は `paper` の既定のパネルを白にする予定で、同じ問題が起きる。ユーザーは、再現図の色は元の図に合わせると決めた。

## 決定

- 再現図（transformer、dit-block、clip、embedding-gemma、gcn、llama4-moe、tricl、llada）の塗り・枠・パネルの塗りと枠・tone の色を、元の図から標本にして YAML の `themeOverrides`（`tones`、`groupFill`、`groupStroke`、`solidFills`）とノードの `tone` に明示する。テーマの tone とグループの色の既定には依存しない。新しい機能やスキーマは足さない。
- 元の図は arXiv の PDF（200 dpi）と Meta のブログ画像から取り、各図の標本は次のとおり。
  - transformer: 各ブロックの淡い色（ピンク `#fce0e1`、オレンジ `#ffe2bb`、黄 `#f1f3c0`、青 `#c2e8f7`、紫 `#dadeee`、緑 `#cbe6ce`）、パネルは `#f2f2f2` に黒い枠。
  - dit-block: 灰 `#d4d7e3`、青 `#c6dbfe`、緑 `#c3e3bd`、オレンジ `#f9cc8b`、赤 `#fbbcb9`（薄く描かれた原図の赤から逆算）、パネルは `#f3f3f6` に黒い枠。DiT Block のノードもパネルと同じ灰色で、使っていない tone（purple）を借りて `#f3f3f6` にした。薄い 2 つのパネルは theme の `dim` が同じ色を作る。
  - clip: draw.io の紫（`#e1d5e7` / `#9673a6`）、緑（`#d5e8d4` / `#82b366`）、青（`#dae8fc` / `#6c8ebf`）。行列の白いセルとラベルの枠は gray tone（白 / `#666666`）、プレースホルダの文字はピンク。
  - embedding-gemma: モジュラーエンコーダーのパネルの灰色 `#dadada`（gray の塗り）、波形の赤（red の線）、トークン列の枠 `#545454`（`groupStroke`）、白いグループ（`groupFill`）を明示した。ブロックの色は既存の `solidFills`。
  - gcn: 既存の tone に加えて、カードの黒い枠（`groupStroke`）を明示した。
  - llama4-moe: `llama` の色は原図から標本にしたものだった（Attention の濃いスレート `#465a69`、Router の灰色 `#cbd2d9`、パネル `#f1f4f7`）。これらを gray の塗りと線、`groupFill` で明示した。内側の白い Routed Experts のパネルは、`groupFill` が淡い色なので、使っていない tone（blue）の塗りを白にして `tone: blue` で指定する。
  - tricl と llada: すでに全色を明示していて、テーマの既定に依存しないことを確かめた（変更なし）。
- 元の図と並べた比較画像を、各例について `.sumi/preview/<name>-vs-original.png` に作って目で確かめた（git 管理外）。
- 回帰テスト `src/compiler/pinned-reproductions.test.ts`: `REPRODUCTIONS` の各例を、実際のテーマと、tone の塗り・線・文字、グループとコンテナの塗り・枠を目立つ別の値に差し替えた写しで描き、描かれる色（幅 0 の枠は塗らないので除く）が同じであることを確かめる。差し替えが効くことの対照（既定に頼る図は変わる）も検査する。変更前の YAML では 6 例が失敗する。
- examples/README.md と skills/sumi/examples/README.md に、再現図は元の図の色を固定していて、テーマの既定は新しい図向けであること、新しい再現図は `REPRODUCTIONS` に足すことを書いた。

## 線の太さの固定（追補）

色に加えて、線の太さも元の図に合わせて固定した。元の図を 200 dpi で画像化し、枠と辺の線の太さを黒の濃さの合計（アンチエイリアスを含む実効の幅）で測り、同じ縮尺にした Sumi の描画と比べた。`themeOverrides` の `lineWidth` / `frameWidth` / `arrowheadScale`（#427）と、辺ごとの `lineWidth` で書く。

- transformer: 元の枠は約 1.26pt、辺は約 1.15pt で、Sumi（枠 1pt、辺 0.5pt）より辺がかなり太かった。`lineWidth: 1.25pt`、`frameWidth: 1.25pt`、`arrowheadScale: 0.75`。Softmax・Linear・埋め込み・各スタックの列の幅を `props.width: 68pt` に揃え、元の図の横長の箱に近づけた（図の幅は 88mm 以内）。文字の大きさは `themeOverrides` では変えられず、箱を広げる以外の手段がないので、文字は元の図よりわずかに大きいまま。
- dit-block: 元の辺は約 1.2pt でやはり太い。`lineWidth: 1.25pt`、`frameWidth: 1pt`、`arrowheadScale: 0.75`。DiT Block の箱は `#f3f3f6`（purple tone を借用）に黒い枠で、元の図と同じ灰色。
- clip: 元は約 1px（印刷の縮尺で約 0.36pt）の細線で、Sumi は約 2px だった。`lineWidth: 0.5pt`、`frameWidth: 0.5pt`、`arrowheadScale: 1.2`。
- embedding-gemma: 元の辺は 3px 前後、Sumi は 1.5px だった。`lineWidth: 0.75pt`、`frameWidth: 1pt`。
- gcn: 元のカードの枠は細い。`frameWidth: 0.5pt`、`lineWidth: 1pt`、頂点をつなぐ黒い辺は `lineWidth: 1pt`、色つきの曲線と破線は辺ごとに `0.5pt`。
- llama4-moe: `llama` の線（1pt）が元の図に合っていたので、`lineWidth: 1pt` として明示するだけで見た目は同じ。
- tricl・llada: すでに `lineWidth` / `frameWidth` / `arrowheadScale` を明示済み。

回帰テストは線の太さも差し替える。テーマの枠・辺・グループの線の太さを 3 倍にした写し（variant どうしの比は保つ）で描き、描かれる色に加えて `stroke-width` の並びも同じことを確かめる。

## 採らなかった案

- tone 名を意味に合わせて新設する案（「パネルの灰色」など）: スキーマの変更が要る。今回は既存の機構だけで固定し、使っていない tone を借りる箇所は YAML のコメントに残した。
- テキストの色や辺の色もテストで差し替える案: これらは tone でもグループの色でもなく、`color.*` トークンで、#434・#440 の変更対象ではない。
- llama4-moe の FFN の淡い塗り（`color.surface`）や辺の色をテーマから切り離す案: 上書きのキーがなく、`llama` テーマが原図から標本にした値なので、そのままにした。

## 互換性

再現図の出力が変わる。変更前後で全 `*.sumi.yaml`（`research/` と非公開の図を除く）を図自身のテーマと組み込み 6 テーマで描き、SVG / D2 の sha256 と、図自身のテーマの PDF / picture PPTX の sha256 を比べた。変わるのは次の再現図だけで、その他の図は 1 バイトも変わらない。変わる理由はすべて「元の図に固定」（色と線の太さ。transformer と dit-block は `paper` の tone が #434 で変わった後の色から元の図の色へ、clip、embedding-gemma、gcn、llama4-moe は明示した色が既定と同じか近い）である。
