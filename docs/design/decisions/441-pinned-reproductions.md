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

## 採らなかった案

- tone 名を意味に合わせて新設する案（「パネルの灰色」など）: スキーマの変更が要る。今回は既存の機構だけで固定し、使っていない tone を借りる箇所は YAML のコメントに残した。
- テキストの色や辺の色もテストで差し替える案: これらは tone でもグループの色でもなく、`color.*` トークンで、#434・#440 の変更対象ではない。
- llama4-moe の FFN の淡い塗り（`color.surface`）や辺の色をテーマから切り離す案: 上書きのキーがなく、`llama` テーマが原図から標本にした値なので、そのままにした。

## 互換性

再現図の出力が変わる。変更前後で全 `*.sumi.yaml`（`research/` と非公開の図を除く）を図自身のテーマと組み込み 6 テーマで描き、SVG / D2 の sha256 と、図自身のテーマの PDF / picture PPTX の sha256 を比べた。変わるのは次の再現図だけで、その他の図は 1 バイトも変わらない。変わる理由はすべて「元の図に固定」（transformer と dit-block は `paper` の tone が #434 で変わった後の色から元の図の色へ、clip、embedding-gemma、gcn、llama4-moe は明示した色が既定と同じか近い）である。
