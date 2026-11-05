# #386 組み込みテーマ `llama` と、テーマの矢じりの形

## 背景

Meta の Llama 4 の発表記事の Mixture-of-Experts の図は、濃い青灰色のブロック、枠のない淡いパネル、白い内側のパネル、灰色の枠の白いブロック、青い強調のブロック、白地に淡い枠の ⊕、細い灰色の破線の拡大線、そして**開いた（塗らない）山形の矢じり**で描かれている。原図から取った色は次のとおり。

| 要素 | 色 |
| --- | --- |
| Attention（濃いブロック） | 塗り `#465a69`、白い文字 |
| FFN・Mixture of Experts（淡いパネル） | `#f1f4f7`、枠なし |
| Routed Experts（内側のパネル） | `#ffffff`、枠なし |
| Router | `#cbd2d8`、濃い文字 |
| Shared Expert | `#3880f3`、白い文字 |
| Expert 0〜15 | 白、枠 `#8a96a1` 前後、濃い文字 |
| 線と矢じり | `#344854` |
| 文字 | `#1c2b33` |
| ⊕ | 白、枠 `#cbd2d9`、濃い記号 |
| 拡大の破線 | `#96a0a7` 前後、細い |

これまでの矢じりは、部品の manifest が選ぶ形（既定は `triangle`）を塗るか（`filled: true`）、中を下地の色で塗る（`filled: false`）かだけで、線が先端まで届く開いた山形は描けなかった。

## 決定

### テーマの矢じりの形 `arrowhead`

- テーマ定義に最上位の欄 `arrowhead: triangle | open` を加える（省略は `triangle`）。検証済みの `Theme` には書いたときだけ `arrowhead` が入るので、既存の組み込みテーマの値と出力は変わらない。
- 矢じりの形の語彙（`ARROWHEADS`）に `open` を加える。カスタム部品も `head: open` / `tail: open` を書ける。
- IR を作るとき、`triangle` の端（明示したものと既定のもの。組み込みの `arrow` / `double-arrow` を含む）をテーマの `arrowhead` で置き換える。`diamond`・`circle`・`box`・`cross`・`arrow` など、部品が明示した他の形は置き換えない。テーマの見た目の選択であって、部品の意味（どの端に矢じりがあるか）は変えない。
- `sumi catalog --json` のテーマの項目に `arrowhead`（`triangle` / `open`）を加える。

### 描き方（出力形式ごと）

- **structured SVG**: 直角の山形を、線と同じ色・幅の `<path class="sumi-arrowhead" fill="none">`（丸い端と丸い角）で描く。形は `openArrowhead()` の 1 か所で決め、ルーターと lint がすべての矢じりに確保している矩形（長さ `L = 4 + 4 × 線幅` 単位、幅も `L`、`arrowheadRects()`）の中に、丸い端を含めて収める。
  - 腕は頂点から後ろへ・左右へそれぞれ `L/2 − 線幅/2`。インクの幅はちょうど `L`。
  - 描いた先端は経路の端から線幅 1 本ぶん手前に置く（`openArrowheadGap()`）。原図の矢じりは箱に触れず、少し離れている。頂点はさらに線幅の半分後ろ（丸い角の外側が描いた先端）。インクの長さは `線幅 + L/2 + 線幅/2` で、常に `L` 以下。
  - 線は三角形の底ではなく頂点まで描く（`arrowheadInset` が `1.5 × 線幅`）。
  - このすき間は開いた矢じりだけのもので、三角形を使う既存のテーマは 0（出力は変わらない）。
- **角の丸め（`wire.ts`）**: 開いた矢じりの線は三角形より `L − 線幅/2` 長いので、末端の区間の「半分まで」の規則がそのまま効くと、曲がりの半径が大きくなり矢じりの前の直線が短くなる（`geometry/arrowhead-cramped`）。`WirePolyline` に `headStart` / `headEnd`（開いた矢じりの下を線が走る長さ）を加え、半分の規則と隠れた分岐点の規則ではその長さを除いて測る。三角形と同じ半径になる。開いた矢じりのない線では 0 なので結果は変わらない。
- **D2 SVG（auto）**（先端のすき間は付けない。D2 は線を先端の手前で止めるので、頂点を後ろへずらすと線が山形の先に突き出る）: D2 に開いた矢じりはないので、D2 には `shape: triangle`・`style.filled: true` として書き、描かれた SVG で、その端の marker を同じ箱（`markerWidth` / `markerHeight` / `refX` / `refY` / `viewBox`）の写しに置き換える（`composeOpenArrowheads`）。写しは三角形の色で直角の山形を線幅で描き、id は元の id に `-open` を付けたもの。D2 は同じ見た目の marker を共有するので、元の marker を書き換えず新しい id にすることで、同じ marker を使う三角形の端（例: 別の部品の `triangle`）は変わらない。D2 は線を先端から `1.5 × 線幅` 手前で止めるので、山形の内側の角（頂点から `0.7 × 線幅`）が線の端に重なるように頂点を置き、すき間を作らない。検査（inspection）は marker を読まないので、置き換えの後に検査し直す必要はない。
- **PDF / picture PPTX**: SVG をそのまま変換するので、上の形のまま。
- **editable PPTX**: OOXML の線端 `arrow` は開いた矢じりそのものなので、`open` を `arrow` に写す（大きさは従来どおり marker の箱から選ぶ）。

### lint

- `geometry/arrowhead-on-bend`: structured は従来どおり `L` と描かれた線の直線部分で測る。開いた矢じりは線が頂点まで届くが、矢じりが占める長さは三角形と同じ `L` として扱う（ルーターが確保する長さと揃える）。auto は D2 の triangle の marker（長さ `4 + 3 × 線幅`、先端の offset `1.5 × 線幅`）だけを対象にしていたが、`open` も同じ marker の箱に描くので対象に加える。
- `geometry/arrowhead-cramped`: 変更なし。上の丸めの調整で、開いた矢じりでも三角形と同じ直線が残る。

### テーマ `llama`

原図の要素を、図を素直に書いたときにその見た目になるよう variant と tone に割り当てる。

| 原図の要素 | 書き方 | 見た目 |
| --- | --- | --- |
| Expert | `box`（default） | 白、1pt の灰色の枠 `#8a96a1`、文字 `#1c2b33` |
| Attention | `variant: solid` | `#465a69`（tone gray の線の色）、白い文字 |
| Shared Expert | `variant: emphasis` | `#3880f3`、白い文字 |
| Router | `variant: filled` | `#cbd2d8`（tone gray の塗り）、枠なし |
| FFN | `variant: muted` | `#f1f4f7`、枠なし、文字 `#1c2b33` |
| ⊕ | `operator` | 白、枠 `#cbd2d9`、記号 `#1c2b33` |
| Mixture of Experts | `container`（default） | `#f1f4f7`、枠なし、見出しは細字の `#1c2b33` |
| Routed Experts | `container` の `variant: muted` | 白、枠なし、同じ見出し |
| 線と矢じり | `arrow` | `#344854`、1pt、開いた矢じり |
| 拡大の破線 | `zoom` | `#96a0a7`、0.5pt（`line.thin`）、短い破線（dash 2） |
| 分岐 | `junction` の `hidden` | 丸めた分岐（既存の描き方） |

- **default を白いブロックにした理由**: 原図で数が多いのは濃い Attention だが、default を濃いブロックにすると次の契約が崩れる。`filled` は default の文字色を保つ（白い文字が灰色の塗りに載る）。tone の層は塗りだけを変えるので、tone 付きの default が淡い塗りに白い文字になる。dim は `solid` の塗りだけを文字の読める色にする（default の濃い塗りは淡くなり、灰色の文字が読めない）。濃いブロックは「濃い塗りに白い文字」という `solid` の意味そのものなので、`solid` に割り当てた。tone のない `solid` は tone gray の線の色を使うので、tone gray の線の色を `#465a69` にした。
- **emphasis を原図の青にした**: 強調のブロックが 1 つだけ青い、という原図の使い方がそのまま `emphasis` の意味に合う。白い文字のコントラストは原図と同じ 3.8:1 で、4.5:1 に届かない（`solid` と tinted の 4.5:1 の保証は tone の色に対するもので、emphasis には課していない）。`solid` の青（tone blue の線の色）は 4.5:1 になるよう `#3273db` に暗くした。
- **muted を FFN にした**: 原図の FFN は枠のない淡いブロックで、図の中で最も控えめな要素なので「静かにする」の意味に合う。ただし線だけの部品（`bracket`・`waveform`）は塗りを持たないので、muted は灰色の線（`#657585`、白地で 4.7:1）にした。
- **container**: default を枠のない淡いパネル、`muted` を白いパネル（他のテーマの muted も「影の塗りの代わりに白」）にした。`filled` は default と区別できるよう一段濃い `#e6eaee`、`plain` は塗りも枠もなし。グループに枠がないので、`dashed` は灰色の 1pt の破線の枠を自分で持つ（他のテーマは default の枠を破線にする）。凡例は枠のない default のグループに倣わず、灰色の 1pt の枠を残す。見出しは原図どおり太字にしない。位置は図の `labelAt` で決める（外側は `top-left`、内側は既定の上中央）。
- **tone**: 他の図にも使えるよう 8 色を残す。塗りは淡い色（文字 `#1c2b33` に対して 9:1 以上）、線の色は白地で 4.5:1 以上（`solid` の白い文字も読める）。gray の塗りは Router の色、gray の線の色は Attention の色。
- **フォント**: 原図は Meta の独自の sans。同梱の中では幾何的で字面の近い Inter（`sumi/inter-biz-ud-gothic`、paper と同じ）を選んだ。auto の図は従来どおり BIZ UDPGothic。
- **大きさと線**: 本文 8pt、辺のラベル 7pt、グループの見出し 9pt（paper と同じ）。線の太さは文字の大きさとの比で合わせた。原図（1830px 幅）では、文字の大文字の高さ 20px に対して線が約 3.6px（0.18）、Expert の枠が約 2.6px（0.13）。8pt の文字では 1pt が 0.17、0.5pt が 0.09 になる（300dpi の再現で大文字 24.5px、1pt の線 4.2px、枠 3.8px）。線は 1pt がほぼ一致し、枠も 0.5pt 刻みの中では 1pt が近い（0.155 対 0.13、0.5pt なら 0.086）。強調の辺は 1.5pt、拡大の破線は原図どおり細く 0.5pt。角の丸みはブロック 3pt、パネル 5pt、凡例 3pt。dim は灰色 `#9aa5ae` と塗りを半分白へ。
- **矢じりの大きさ**: 1pt の線では `L` = 6pt で、山形の幅も 6pt。原図の山形の幅は線幅の約 7.8 倍、再現は約 6 倍で、少し小さい。確保された矩形の外へ広げると、隣の箱や線に重なっても診断されない（下の「採らなかった案」）ので、矩形に収めるほうを選んだ。
- **許すプロファイル**: 最小の文字が 7pt なので `paper-single` / `paper-double`（`sumi catalog` の `compatibleProfiles`）。`presentation-16x9` には `slides` を使う。
- 余白（padding）はテーマではなくプロファイルとレイアウトが決めるので、原図の広い余白は図の側（ノードの `width` / `height`、`gap`）で合わせる。

## 採らなかった案

- 矢じりの形をエッジの style（`filled` と同じ層）に置く案: variant や tone ごとに矢じりの形が変わり得るが、原図のような図全体の統一には過剰で、D2 への書き出しと marker の置き換えも端ごとに複雑になる。テーマ全体で 1 つにした。
- `filled: false` の三角形（中を下地で塗る形）を「開いた矢じり」とみなす案: 三角形の底の線が残り、原図の山形にならない。
- D2 の marker の polygon をその場で書き換える案: D2 は同じ見た目の marker を複数の辺で共有するので、同じ marker を使う三角形の端まで変わる。
- 山形を確保された矩形より広く描く案（最初の版では左右へ `0.75 L`）: レビューで、隣の箱に入り込んでも lint が経路だけを見るため診断されないことが分かった（高さの違う 2 つの箱を 1pt 離して並べ、低いほうへ `south:0.95` で入る矢印）。山形の形をルーター・ラベルの回避・衝突の lint の全部に渡す（`arrowheadLength()` の呼び出しは 20 か所以上）より、矩形に収めるほうが単純で、原図との差も小さい。
- 線を 0.5pt のままにする案: 原図より線が文字に対して半分以下の太さに見える（レビューの指摘、上の測定）。
- default を濃いブロックにする案: 上の「default を白いブロックにした理由」のとおり。

## 互換性

既存のテーマは `arrowhead` を持たず、`triangle` の端は従来どおり `triangle` のまま描かれる。`WirePolyline` の新しい欄は開いた矢じりのときだけ 0 でない。対象 YAML 105 本（research と非公開の図を除く）を自身のテーマと既存の組み込みテーマ 5 つで変更前後に描画し、SVG・D2・PDF・picture PPTX・editable PPTX・geometry lint の結果の SHA-256 がすべて一致することを確かめた。ギャラリーには `llama` の見本が加わり、PDF / PPTX のゴールデンには `llama` の項目だけが追加された。

回帰テスト: `src/render/open-arrowhead.integration.test.ts`（テーマの欄の検証、catalog、IR での置き換えと他の形の保持、structured の山形と先端のすき間と線の終点、隣の箱・隣の線に山形が重ならないこと、丸めの半径、PDF・editable PPTX、D2 の書き出しと marker の置き換え・共有された三角形の保持）、`src/core/theme/theme.test.ts`（`llama` の variant と色の割り当て）。
