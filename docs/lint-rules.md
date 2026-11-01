# Lint ルール

## グループの空き面積（#248）

`geometry/group-empty-area` は **info**（render / `lint --geometry` のみ）。
group の外接矩形に対して、見出しと直接の子の外接矩形（ラベル・badge を含む）の
union を引いた空き面積が **75%以上**なら報告する。重なりは一度だけ数え、
枠外を clip する。辺は面積を埋めず、入れ子の group はその footprint 全体を
占有と見なす。空の group と展開された tokens / matrix / legend の内部枠は対象外。
ピクセルの白さや最大空き矩形ではないので、余白の良否は作者が判断する。
hint は structured の `align: stretch` と内側の `justify: stretch` /
`justify: space-between`、gap、パネル自体を伸ばさない方法を示す。
しきい値は既存150図・描画成功114図の225 group の p90 = 75.25% を丸めたもの
（中央値56.81%、p75 69.28%、p95 76.56%、最大93.19%。設計 §6.71）。
`maxWarnings` の件数を増やさず、通常の lint と出力バイトは変えない。

`sumi lint`（API: `lintFigure()`、`src/lint`）は、診断を集める段（`yaml` → `schema` → `ref` → `layout` → `component` → `theme` → `profile`）と、**構造 lint**（stage `lint`）を実行する。構造 lint は描画前の文書だけを検査し、D2 を必要としない。描画後の SVG を検査する幾何 lint（stage `geometry`、#13）は別の段で、`lintRenderedFigure()` / `lintGeometry()` が実行する（下記の「幾何 lint」）。

HTML を含む図では通常の CLI lint も非同期 `lintFigureWithHtml()` で内部を実測する（下記参照）。同期 `lintFigure()` 自体は描画しない。

構造 lint の規則は、前段で error になった要素（`CheckState.invalid` に含まれる要素と、その要素に依存する要素）を検査しない。そのため、1 つの誤りから lint の警告が連鎖して出ることはない。

## 規則の一覧

### HTML 部品の事前検査（#283）

`html` の `props.html` は Takumi の実行前に検査する。以下は抑制できない error。

| code | 内容 | 直し方 |
|---|---|---|
| `asset/unsafe-html` | 許可外タグ、style 以外の属性、重複属性、壊れた入れ子・宣言など。 | div/span/p/b/i/br と quoted style だけにする。 |
| `asset/unsupported-css` | 未知 property、許可外関数・var/font、escape/entity/comment、overflow/transform/gradient/shadow/filter など。 | 公開 subset と固定 --sumi-* 変数・同梱フォントだけを使う。 |

診断は HTML の offset を YAML scalar の行・列へ戻す。入力128KiB・512要素・深さ24は既存 `asset/too-large`、viewport の形式と各辺2048/総2,097,152pxの違反は `asset/invalid-image`。変換失敗・usvg失敗も同コード、変換後は既存 SVG importer の `asset/unsafe-svg` / `asset/unsupported-svg` 等。

### HTML 内部の実測（#293）

通常の `sumi lint` も HTML を含む図では描画・Takumi `measure()` を実行し、内部を検査する（auto の図は D2 が必要）。Skill の lint も同じ経路。HTML のない図は従来どおり構造 lint だけ。`lint --geometry` / `render` では他の幾何規則と一緒に実行する。同期 API `lintFigure()` は構造検査だけを維持し、CLI 相当には非同期 `lintFigureWithHtml()` を使う。

| code | 既定 | 内容 | 直し方 |
|---|---|---|---|
| `asset/html-overflow` | warning | 測定した node box または text run が viewport の左右上下を **0.5 CSS px を超えて**はみ出す。行ボックスを含む実測なのでサブピクセルの丸めだけを許容する。抑制不可の asset 診断。 | viewport を広げる、CSS の寸法・余白を減らす、文字を折り返す、位置を直す。配置 width/height だけを増やしても clipping は直らない。 |
| `geometry/text-too-small` | error | 検査済み CSS の最終 font-size（継承・em/%/pt・後勝ちを解決）× viewport→配置の縮尺 × 図の印刷縮尺を、通常ラベルと**同じ Profile の下限**と比較する。run の高さは font-size の代用にしない。 | CSS font-size を増やす、viewport に対する配置寸法を大きくする、内容を収めながら viewport を小さくする。fit:scale なら図の縮小も減らす。 |
| `lint/missing-glyph` | warning | 実際に測定された run の文字を、選択した同梱 family list と weight の TTF cmap で検査する。Geist fallback はカバーと見なさない。空白・制御・default-ignorable の除外と最大10文字の表示はラベルと同じ。 | 文字を置換するか、カバーする同梱 font-family / family list（例: `Inter,'BIZ UDPGothic'`）を選ぶ。 |

いずれも `props.html` 内の該当要素の開始タグを指す（同じ要素・同じ診断は1件）。literal block は実際の行・列、single-line plain/quoted は escape を考慮した位置、folded/multiline quoted は既存 locator と同じ scalar fallback。display:none の部分は測定されず対象外。文字サイズは contain なら小さい軸、cover なら大きい軸の縮尺、非等方 fill なら保守的に小さい軸を使う。`figure.fit: scale` は既存の `minScaledFontSize`、それ以外は `minFontSize`。2つの既存 lint code は通常の `--rule` で severity 変更・無効化できる。測定値は SVG の外のメモリに保持し、描画バイトを変えない。

Sumiの検査済みparseからinline root内のblock/absolute、混在flow、空白、brの匿名boxを対応付ける。位置順だけで不一致を補わない。一意に対応できない場合は直近の一意な祖先へ定位し、候補要素の解決font-size/familyを保持する。複数候補は各styleを保守的に検査するため、曖昧時は過検出の可能性があるが、小文字・欠字の検査は省略しない。HTML entityは専用decoderで復号し、第2 HTML parserは使わない。

配置の `grid` は構造 lint より前の layout 段で検査する。行の残りより大きい span は `layout/grid-span-overflow`（error、`span` の位置）、未完の最終行は `layout/grid-item-count`（error、`items` のキー）。全行を埋める。空けたいセルは `null`（`~`）、複数列は `{ item: null, span: N }` で書く（ノードも経路の障害物も作らない）。空文字・空の items・不正な columns / span・direction は位置付きの `schema/*`。これらは `lint/*` の抑制設定では無効にできない（設計 §6.59）。

`geometry/badge-collision`（既定 warning、#188）は、1 em の角バッジの
足跡がキャンバス外に出る場合、他ノード・ラベル・バッジ・辺、または自身の
ラベルに重なる場合を `nodes[].badge` に報告する。本体との意図した重なりと
祖先グループの本体は除外する（祖先グループの見出しは検査する）。`corner` を変えるか、間隔・余白を広げる。
structured は足跡の張り出しを配置に含め、auto は D2 配置後に合成する。

いずれも自動修正には対応していない（`fixable: false`）。

| code | 既定 | 内容 | 直し方 |
|---|---|---|---|
| `lint/empty-figure` | warning | ノードが 1 つもない。 | ノードを追加する。空の図を意図している場合は無効にする。 |
| `lint/no-edges` | warning | error のないノードが 2 つ以上あるのに、エッジが 1 つもない（error のあるエッジも 1 本と数える）。 | エッジでつなぐ。つながりのない図を意図している場合は無効にする。 |
| `lint/ancestor-edge` | warning | グループと、その（間接的な）子孫をつなぐエッジ（§2.2）。D2 ではエッジがグループの枠とラベルを横切る。 | 両端をともにグループの内側、またはともに外側の要素にする。 |
| `lint/self-loop` | info | 始点と終点が同じエッジ。スキーマ上は有効なので info とする。 | 意図していなければ削除する。 |
| `lint/duplicate-edge` | warning | 端点・部品・ラベルがすべて同じエッジが 2 本以上ある（2 本目以降に出す）。variant は比較しない。structured の図では端点の anchor（`fromAnchor` / `toAnchor`）も比較し、anchor が違うエッジは重複としない。方向のない部品（`line`）と両方向の部品（`double-arrow`）は端点の順序を区別しない。 | 一方を削除するか、ラベルを変える。 |
| `lint/empty-label` | warning | ラベルが空（または空白のみ）のノード。文字だけを描く部品（`label`、shape `text`）は `component/missing-label`（error）で検査済みなので対象外。ラベルを取らない印の部品（manifest の `mark`。`operator`・`junction`）も対象外。 | ラベルを付ける。ラベルなしの図形を意図している場合は無効にする。 |
| `lint/long-label` | warning | ラベルのいずれかの行の表示幅が `maxLineWidth`（既定 40）桁を超える、または行数が `maxLines`（既定 4）を超える。node・group・edge のラベルと node の `sublabel`（#184）が対象。 | ラベルを短くする、または `\n` で改行する。 |
| `lint/missing-glyph` | warning | ラベルに、Theme のフォントセットが字形を持たない文字がある。メッセージに文字と `U+XXXX` を列挙する（最大 10 文字）。node の `sublabel`（#184）も同じ規則で検査する。 | 文字を置き換えるか、その文字を含むフォントセットの Theme を使う。 |
| `lint/literal-newline` | warning | ラベルの平文の部分（`$...$` の数式の外。`\$` は数式を開かない）に、改行ではない文字どおりの `\n`（バックスラッシュ + n）がある（#154）。単一引用符・引用符なしの YAML では `\n` が改行にならず、そのまま描かれる。数式の中の `\nu` `\neq` などは対象外。node・group・edge・キャプション・凡例の項目のラベルと node の `sublabel`（#184）が対象で、structured と auto の両方で検査する。位置は最初の `\n`。 | 二重引用符で書き、数式などのバックスラッシュを 2 つにする（hint にそのラベルを二重引用符で書いた形を示す。例: `"Scale, Shift\n$\\gamma_1$"`）。ブロックスカラー（`|`）でもよい。バックスラッシュを描くつもりなら無効にする。 |

`grow`（#270、`justify: stretch` の余りの重み）は、展開される部品（`tokens`・`matrix`・`legend`）に書くと `component/grow-unsupported`（error、stage `component`、`grow` の位置）になる。展開後の個々の要素に重みを配れないため。`grow` を外すか、通常の node に書く。

部品の非推奨は、名前解決と同じ場所で `component/deprecated`（warning、stage `component`）として報告する。重複を避けるため、lint には同じ規則を置かない。

### 表示幅の数え方（`lint/long-label`）

- 行は `\r\n`・`\r`・`\n` で分ける（コンパイラと同じ）。
- 1 行の幅は、書記素クラスタ（`Intl.Segmenter`）ごとに数える。East Asian Width が Wide / Fullwidth の文字（漢字・かな・ハングル・全角英数など。UAX #11 の主要なブロックで近似）と、絵文字として表示される文字（`Emoji_Presentation`、VS16 付き、`1️⃣` などの keycap 列）は **2 桁**、それ以外は 1 桁とする。結合文字や ZWJ は基底文字のクラスタに含まれるので幅を増やさない。
- 例: `API` は 3 桁、`認証サーバ` は 10 桁。既定の 40 桁は、全角文字なら 20 文字に当たる。

### 字形の判定（`lint/missing-glyph`）

- フォントは要素の実効スタイルで選ぶ: `mono` なら mono slot、そうでなく `bold` なら bold、`italic` なら italic、それ以外は regular（mono・italic の slot がないフォントセットでは regular。§4.2）。
- 各 TTF の `cmap`（format 12 を優先し、なければ format 4）を読んで判定する。読み取りは cmap テーブルとサブテーブルが宣言する範囲の中に限り、segment / group は昇順で重なりがないことを検査する（壊れたフォントは例外）。カバー範囲はソート済みの区間として持ち、ファイルごとにキャッシュする。
- structured の図（#93）は、ラベルを描くときと同じ run（`$...$` の数式は math / mathItalic slot、ラベルのフォントにない文字は math slot へ代替）に分け、run ごとにそのフォントで判定する。メッセージは「regular and math fonts」のように両方を挙げる。フォントセットに Latin の slot（#172。`sumi/inter-biz-ud-gothic`）があれば、regular / bold の文字のうちそのフォントが持つものは Latin のフォントで判定し、メッセージは「regular, Latin and math fonts」になる。`auto` の図は従来どおりラベル全体を 1 つのフォントで判定する。`lint/long-label` も structured では描く文字（数式を展開した後）で数える。
- 空白（改行・タブ・全角スペースを含む）、制御文字、既定で無視される文字（異体字セレクタ、ZWJ など）は検査しない。
- 同梱の `sumi/biz-ud-gothic` に含まれない文字の例: 絵文字（😀 U+1F600、✅ U+2705）、𠮷（U+20BB7）、龘（U+9F98）、タイ文字（ก U+0E01）。JIS X 0213 の拡張 B の文字（𠀋 U+2000B など）は含まれる。

## 設定

設定は JSON 互換のオブジェクトで渡す。CLI では、`--config <file>`（同じ形の JSON ファイル）→ `--rule <id>=<level>`（繰り返し可。level だけを置き換え、options は保つ）→ `--max-warnings <n>` の順に上書きして組み立てる。

```sh
sumi lint figure.sumi.yaml --config lint.json --rule lint/no-edges=off --max-warnings 0
```

```ts
lintFigure(text, {
  file: "figure.sumi.yaml",
  config: {
    rules: {
      "lint/no-edges": "off",                       // 無効にする
      "lint/self-loop": "warning",                  // severity を変える
      "lint/long-label": { level: "error", options: { maxLineWidth: 30, maxLines: 3 } },
    },
    maxWarnings: 0,                                 // warning がこの数を超えたら失敗（exit 1）
  },
});
```

- CLI の `--max-warnings`（と設定ファイルの `maxWarnings`）は、指定した**全ファイルの warning の合計**で判定する。
- `rules` の値は `"off" | "error" | "warning" | "info"`、または `{ level?, options? }`。書かなかった規則は既定の severity で有効になる。
- 対象は `lint/*` と `geometry/*` の規則だけで、他の段の診断の severity は変えられない。1 つの設定で両方の段を設定する（`lintFigure()` は `geometry/*` の設定を検証するだけで、実行しない）。
- 未知の規則 ID（近い候補を示す）、不正な level、不正な options、options を取らない規則への options は、`LintConfigError` になる（図の診断ではなく使い方の誤り。exit code 2）。
- 図ごとに規則を抑制するフィールドは、Figure Schema にはまだない。

## 幾何 lint（stage `geometry`、#13）

描画した SVG（`renderFigure()` → `inspectSvg()`）の幾何情報を検査する。ラベルの外接矩形は、D2 が SVG に埋め込んだのと同じ TTF（Theme のフォントセット）で**再計測**する（ブラウザは使わない。方法と許容誤差は [設計 §6.5](design/phase1.md)）。どの規則も図を変更しない。文字や図を黙って縮小することはなく、自動修正もない。

CLI:

- `sumi lint --geometry <files...>`: `lintFigure()` の検査に加えて、各ファイルを D2 で描画し（ファイルは書かない）、幾何 lint を実行する（`lintRenderedFigure()`）。check 段に error があるファイルは描画しない。D2 がない場合は `backend/*` の error になる（exit 1）。`--config` / `--rule` で `geometry/*` も設定できる。
- `sumi render <file>`: 描画結果に幾何 lint を既定の設定で実行し（`lintGeometry()`）、ほかの診断と一緒に stderr に出す。**error があっても SVG は書き出す**（はみ出しや超過を目で確認できるように）が、終了コードは 1 になる。`--no-geometry` で省ける。
- `sumi doctor`: 同梱フォントの metrics（`hmtx` など）を読めるかを `geometry-lint` として報告する（必須ではない）。

API（`src/lint/geometry`）:

```ts
// lintFigure() の全診断 + 描画 + 幾何 lint。`sumi lint --geometry` 用
const report = await lintRenderedFigure(text, { file, config });  // LintReport & { rendered? }
// 描画済みの図だけを検査する。`sumi render` が描画結果に対して呼ぶ
const diagnostics = lintGeometry(rendered, { config, source: text, file });
```

- `lintRenderedFigure()` は、`checkFigure()` の段に error があれば描画しない（`rendered` なし、幾何の診断なし）。描画に失敗した場合は `compile` / `backend` / `svg` の診断を加える（check 段の診断は重複させない）。終了コードの規則は `lintFigure()` と同じ。
- `lintGeometry()` に `source`（YAML の本文）を渡すと、診断は `props` や `label` の位置を指す。渡さない場合は、IR の source map から要素の位置を使う（図全体の診断には位置が付かない）。
- 不正な設定は `LintConfigError`。
- `figure.fit: scale`（#183、設計 §6.48）で縮めた図では、物理的なしきい値（1.5pt の間隔、3mm の長さ、最小の文字）とメッセージの長さは**印刷される大きさ**で扱う。重なり・包含・交差と D2 の丸めの許容（1 unit）は描画の座標のまま判定する。

| code | 既定 | 内容 | 直し方 |
|---|---|---|---|
| `geometry/exceeds-page-width` | error | 出力幅（余白込み）が Profile の `maxWidth` を超える。pt のまま量子化せずに比較し、両方の大きさを mm で示す。`figure.fit: scale` の図は縮小後の幅で比べる（`maxWidth` に縮むので出ない）。 | auto: 横向き（`right` / `left`）なら `layout.direction: down`、縦向きなら横に並ぶノードを減らす。structured: 最も幅の広い `row` を `stack` にする（または複数行に分ける）、`gap` を詰める。ラベルを短くする。hint は、現在より幅が広く、図が収まり、最小文字サイズが大きくない組み込み Profile があるときだけそれを示す（paper-single の図に paper-double。paper-double や presentation-16x9 では示さない。#114）。 |
| `geometry/exceeds-page-height` | error | 出力の高さが Profile の `maxHeight` を超える（`maxHeight` がある Profile だけ。組み込みでは paper 系 220mm、presentation-16x9 190.5mm）。`figure.fit: scale` の図は縮小後の高さで比べる（幅に合わせて縮めた後もはみ出せば報告する）。 | auto: 縦向きなら `layout.direction: right`、横向きなら縦に並ぶノードを減らす。structured: 最も高い `stack` を `row` にする、`gap` を詰める。図を分ける。高さに余裕のある組み込み Profile は、上と同じ条件で存在するときだけ示す（組み込みの paper 系どうしは同じ 220mm なので、通常は示さない。#114）。 |
| `geometry/text-too-small` | error | 描画されたラベルの文字サイズが Profile の `minFontSize` 未満。通常は `profile/font-too-small` が描画前に防ぐので、描画後の安全網。`figure.fit: scale`（#183、設計 §6.48）で縮めた図では、縮小後の**印刷される大きさ**（文字サイズ × 縮小率）を Profile の `minScaledFontSize`（paper 系 5pt。ない Profile は `minFontSize`）と比べる。添字（ラベルの数式の 0.7 倍）は対象外（§6.24）。node の `sublabel`（#184、設計 §6.51）は別の `<text>` として自分の大きさ（ラベルの 7/8）で判定し、それだけが下回るときはメッセージと位置が `sublabel` を指す。 | 文字サイズの大きい Theme / variant を使う（`presentation-16x9` なら `slides`）。縮めた図: 図の幅を詰めて縮小率を小さくする（`fit` を外したときの `exceeds-page-width` の hint）、幅の広い Profile にする。 |
| `geometry/script-too-small` | info | `figure.fit: scale` で縮めた図で、ラベルの数式の添字（下付き・上付き）が縮小後に `minScaledFontSize` 未満になる。添字は縮めない図では最小の対象外なので情報にとどめ、図全体で 1 件（`figure.fit` を指し、最小の大きさと該当するラベルを最大 3 つ挙げる）。縮めない図では報告しない。 | 読めないなら `text-too-small` と同じく縮小率を小さくする。 |
| `geometry/label-overflow` | error | ノード・グループのラベル（再計測）が、図形の中の文字を置ける範囲（下表）に収まらない。明示サイズ（`props.width` / `height`）が小さい場合は `props` を指す（D2 は明示サイズを保ち、ラベルを図形の外に出す）。 | 明示サイズを大きくするか外す。ラベルを短くするか改行する。文字の入る範囲が広い図形にする。 |
| `geometry/out-of-canvas` | error | 図形・ラベル（再計測）・エッジの経路がキャンバスの外にはみ出す（切れて表示される）。 | ラベルを短くする。解消しなければ不具合として報告する。 |
| `geometry/node-overlap` | warning | 2 つのノード・グループの図形が重なり、グループの木でどちらも他方を含まない。通常部品同士は従来の外接矩形、カスタム輪郭が関わる組は下記の凸衝突領域で判定する。子と祖先グループの重なり（意図した包含）は対象外。 | 明示サイズを見直す。auto: 同じグループに入れる。一方が `attach` したノードなら、hint はそれを示す: `attach` は配置の木で場所を取らないので、木に入れる、空いた側に付ける、付け先の隣の `gap` を広げる（#114）。 |
| `geometry/label-collision` | warning | ラベル（再計測）が、別の要素のラベル、別のノードの図形、または**グループの枠線**と重なる（エッジのラベルとノードの図形を含む）。自分の図形との重なり、グループの図形の内側との重なり（中の要素は意図して重ねて描く）は対象外。グループのラベルと子ノードの図形の重なりは対象。枠線（#116）は、行の箱を「枠線の太さの半分 + 許容 1 unit」広げた範囲を枠線（の中心線。角の丸め `radius` を描くとおりに含む）が通るときに数える（文字に触れる・エッジのラベルの背景が枠線を隠す）。自分のグループの見出し、線のない（線幅 0・`transparent`）グループは対象外。要素の組ごとに 1 件。 | ラベルを短くする。レイアウト（方向・グループ）を変える。枠線: structured ではエッジのラベルは矢じりの手前に置くので、グループの手前の `gap` を広げてラベルが枠の外に収まるようにする（ラベルは枠線を避けて置かれる。§6.22）、端を `fromAnchor` / `toAnchor` で動かす。auto では D2 がエッジの中央に置くので、方向・グループを変える。 |
| `geometry/edge-crosses-label` | warning | エッジの経路が、別の要素のラベル（再計測）を横切る。例: `direction: down` で上からコンテナに入るエッジが、コンテナのラベルを横切る（#31）。auto では Sumi はコンテナのラベルを左上に置くので、多くの図では起きないが、ラベルがコンテナの幅の半分を超えると起きる。structured ではグループの見出しが上端中央にあるので、上から入るエッジは横切りやすい。自分のラベルは対象外（D2 はラベルの下の線をマスクする）。 | ラベルを短くする、コンテナではなく中の要素どうしをつなぐ。auto: `layout.direction` を変える。structured: グループの見出しは上端中央にあるので、`fromAnchor` / `toAnchor` で端をずらす、配置の木の順序を変えて別の側から入れる、ラベルなら `attach` の側を変える（`layout.direction` は使わない。#114）。 |
| `geometry/edge-through-node` | warning | エッジの経路が、端でないノードの図形（凸の衝突領域。円・ひし形は外接矩形ではなく図形）を許容 1 unit より深く通る。図形のない `text`（`label` 部品）は `edge-crosses-label` の対象。structured の図ではルータが貫通を避けるので、その独立の再検査になる（設計 §6.22）。auto（D2/ELK）の図にも掛かる。拡大の引き出し線（`zoom`）は対象外（`zoom-crosses-node`）。 | structured: `fromAnchor` / `toAnchor` を変える、ノードの間に通り道を空ける。auto: `layout.direction` やグループを変える。 |
| `geometry/zoom-crosses-node` | warning | 拡大の引き出し線（`zoom` の部品、#176）の直線が、端でないノードの図形（`edge-through-node` と同じ凸の衝突領域・許容 1 unit）を通る。`zoom` は経路探索をせず角どうしを直線で結ぶので（曲げると引き出し線として読めない。設計 §6.45）、ルータが避けない。`zoom` の辺は `edge-through-node` の対象外で、この規則だけが見る。structured の図のみ（`zoom` は structured 専用）。 | 間にあるノードを動かす。拡大元か拡大先の位置（配置の木の順序・`gap`・別の row / stack）を変えて、線がノードの脇を通るようにする。 |
| `geometry/edge-on-border` | warning | エッジの直線の部分が、線のあるグループの枠線（角の丸めを除く直線の辺）と平行に 3mm 以上並び、2 本の線の間が 0.5pt 以下（線どうしが接する・重なる）。枠線の一部に見える。描かれた線で測る（structured では角を丸め矢じりの手前で止まる wire をエッジごとに。破線は間も線として測る）。不透明度 0 の要素は対象外。共有の幹線は 1 件にまとめる（設計 §6.39）。 | structured: `fromAnchor` / `toAnchor` で端を動かす、配置の木の順序や `gap` を変えてグループに沿って通らないようにする。auto: `layout.direction` やグループを変える。 |
| `geometry/edge-near-border` | info | `edge-on-border` と同じで、線の間が 0.5pt を超え 1.5pt 未満。structured では、グループの中のノードに入る辺が枠のすぐ外で曲がる形でよく出る（ルータの格子の制約。§6.39）。 | `edge-on-border` と同じ。図を見て読めれば残してよい。 |
| `geometry/edge-near-edge` | warning | 2 本のエッジ（または共有の幹線）が、平行に 3mm 以上、線の間 1.5pt 未満で並ぶが、同じ線には重ならない（中心の差 0.25pt を超える）。1 本の太い線か二重線に見え、どちらの線か分からない。同じ線に重なる共有の幹線は対象外。 | 一方の端を `fromAnchor` / `toAnchor` で動かす、同じ口にまとめて 1 本の幹線にする（`figure.layout.fanIn: merge` など）、配置を変える。auto: 方向・グループを変える。 |
| `geometry/edge-touches-label` | info | エッジが、端でないグループの見出し・キャプション・`label` 部品の文字（グリフの輪郭で再計測）から 1.5pt 未満を通る（線の太さの半分を除く）。横切る場合は `edge-crosses-label`。破線は間も線として測るので、文字の脇が破線の間に当たる場合も報告する（誤検出側。設計 §6.39）。 | `edge-crosses-label` と同じ（見出しを `labelAt` で動かす、端を動かす）。 |
| `geometry/aspect-distorted` | warning | 縦横比が固定の部品（`circle`、`square`）が、縦横の異なる大きさで描かれている。ELK は次数の多いノードや自己ループのあるノードを一方向に拡大する。 | ノードのエッジを減らす。縦横比が重要でなければ `ellipse` / `box` を使う。 |
| `geometry/reversed-edge` | warning | structured の図（§6.23）には掛けない（配置は利用者が書いた配置の木のとおりで、`layout.direction` も ELK の閉路の処理もない）。矢印（方向が `forward` の部品。`arrow` など）が `layout.direction` に逆らって描かれている（終点の図形が始点より手前側に完全にある）のに、宣言順に読むと閉路を閉じる辺ではない。ELK は閉路ごとに 1 本の辺を逆向きにするが、コンテナの中では意図と違う辺を選ぶことがある（例: コンテナの中の `process → done → process` で `done` が上に描かれる。#31）。宣言順で閉路を閉じる辺（下記）が逆向きなのは意図どおりなので対象外。線・両矢印・自己ループ・グループとその子孫を結ぶエッジも対象外。 | ループのノードの宣言順を入れ替える（`nodes` の中で順序を変える）、またはループをコンテナの外に出す。 |
| `geometry/arrowhead-on-bend` | warning | 矢じりの先端から直前の曲がりまでの直線が矢じりより短い（不足が許容 1 unit = 0.5pt を超える）。structured は矢じりの長さ `4 + 4 × 線幅` unit と、エッジ自身の描かれた wire の角（丸めた後）で測る。矢じりの下の区間も直線長に含む。auto は D2 の triangle の長さ `4 + 3 × 線幅` と先端の offset `1.5 × 線幅` を考慮し、他の marker は対象外。透明・線幅 0・不透明度 0・凡例の見本は対象外。始点・終点を独立に検査（設計 §6.57）。 | `fromAnchor` / `toAnchor` で入る側を変える、`gap` を広げる、配置を変えて矢じりの長さ以上の直線を確保する。 |
| `geometry/arrowhead-cramped` | info | structured の矢じりの背後から直前の曲がりまでの**見える直線が印刷時 2pt 未満**。自身の painted wire の丸めと `fit: scale` を反映し、始点・終点を独立に検査する（許容 0.002 unit）。曲がりのない辺・不可視の辺・凡例の見本・`arrowhead-on-bend` の warning 対象は除く。auto（D2）は初期対象外。全図調査で残る小さい接近が多く、既存の `--max-warnings 0` を維持するため info（設計 §6.70）。 | グループの内側の狭い接近はその側の余白を自動拡張する。それ以外は `gap`・anchor・配置・縮小率を見直し、「矢じり長 + 2pt」の直線を丸めた後にも残す。`{"rules":{"geometry/arrowhead-cramped":"warning"}}` で昇格できる。 |
| `geometry/edge-jog` | info | エッジ自身の描かれた線に、2 つの直角の間の **印刷時 1pt 未満**の短い線分（微小な S 字・段差）がある。連続する subpath と同一直線の中間点をまとめ、丸めた曲線の短い chord・端の stub・線の切れ目・分岐は段差と数えない。SVG の量子化に 0.002 unit の許容。透明・線幅 0・不透明度 0・凡例の見本は対象外。`fit: scale` の縮小を反映する（設計 §6.57）。固定された口・共有幹線による既存の段差で `--max-warnings 0` を壊さないため、patch release の既定は info。 | `fromAnchor` / `toAnchor` で口を揃える、`gap` を広げる、配置を変えて短い段差を除く。厳しく検査する場合は rule 設定 `{"rules":{"geometry/edge-jog":"warning"}}` で昇格できる。 |

### 文字を置ける範囲（`geometry/label-overflow`）

outline 部品では safeArea への包含に加え、輪郭線を実際に描く場合（stroke が transparent でなく幅が正）だけ、各行の箱と描画境界（`boundaries`、なければ `outline`）の閉じた線分との重なりも検査する。衝突用凸包には現れない split bowtie の内側の辺も対象。同じ stroke inset と 0.5pt の許容差を適用し、既存の error を 1 要素につき 1 件返す。`bowtie.props.gap > 0` のラベルは左右の台形と gap 全体の中央に置き、自動サイズは全幅に文字と padding を収める。塗りだけの variant は body 上の文字を許容する。輪郭線と交差する場合は `filled` を選ぶか文字が入る gap を取る。小さすぎる明示サイズには `props.width` / `height` を大きくするか外す。

図形の外接矩形（stroke を含まない）から、D2 v0.9.0 の固定の比率で図形を復元する。ラベルは**行ごと**の矩形の 4 隅が範囲内にあれば収まっている（範囲は凸なので 4 隅で判定できる）。行ごとに判定するため、短い行と長い行がある複数行のラベルも菱形・楕円で正しく扱える。

| 図形 | 範囲 |
|---|---|
| `box`（rectangle）、`square`、page、コンテナ | 外接矩形 |
| `circle`、`ellipse`（oval） | 内接する楕円（ELK が円を引き伸ばした場合も、描かれた楕円） |
| `diamond` | 4 辺の中点を結ぶ菱形 |
| `hexagon` | 幅の 1/4 で折れる六角形 |
| `parallelogram` | 斜辺の水平方向のずれ 26 unit（D2 の固定値。幅の半分まで） |
| `cylinder` | 上の蓋の手前の縁（上端から 2 × 24 unit）から、下の蓋の上端（下端から 24 unit）までの胴体。24 unit は D2 の固定値（高さの 1/3 まで） |
| `document` | 波形の下端より上（高さの 14 / 18.925） |
| `label`（shape `text`） | 図形がないので検査しない |
| カスタム輪郭（manifest の `render.type: outline`） | renderer が実際の footprint に返す `safeArea` の矩形。台形の斜辺・stack の前面レイヤーなどを考慮する |

ラベルは枠線の内側半分（stroke 幅の半分）にかかってはいけない。許容誤差 1 unit（0.5pt）を差し引く。

### カスタム輪郭（#54）

- `GeometryContext` は合成後の SVG の bbox と IR の renderer / params から幾何を再現する。衝突用の `outline` は renderer の `collision`、省略時は `outline` の凸包。文字の `labelArea` は `safeArea`。レイアウト用の占有矩形をそのまま文字範囲・衝突領域にはしない。
- `geometry/label-overflow` は行ごとに safeArea と stroke inset を検査する。カスタム輪郭の ID を診断に示す。利用者が片軸以上を指定した場合は `props`、2パス描画で両軸とも自動補完した場合は `label` を指す（自動補完した寸法を明示 props と誤認しない）。狭い明示サイズでも、ラベルの中央配置と寸法の保持は #53 の描画経路で行う。
- `geometry/label-collision` は文字矩形とカスタム部品の凸衝突領域で判定する。`geometry/node-overlap` でも片方以上がカスタム部品なら両者の凸衝突領域を使い、台形や stack の角の空白での誤検出を減らす。通常部品同士の既存判定と、祖先グループの包含除外は維持する。
- 衝突は両方の領域を許容誤差の半分（0.5 unit）ずつ内側へ縮めて判定する。凸多角形は辺の半平面を移動し、楕円は半径を縮める近似を使う。多角形同士は分離軸、多角形と楕円は楕円を単位円へ変換した線分距離、楕円同士は support mapping（GJK、最大64反復）で検査する。境界で触れるだけは報告しない。
- 凹んだ輪郭を凸包で近似するため、stack の細かい段差の空白などで保守的な衝突警告が出る場合がある。safeArea も実際の輪郭より保守的な矩形であり、「斜辺の一部にはまだ空きがある」場合でも安全領域からのはみ出しは error とする。
- エッジの輪郭への延長失敗は、#53 の `svg/outline-edge-miss` で描画時にすでに報告する。同じ内容の geometry 規則は追加しない。延長区間同士の交差は `svg/outline-edge-crossing`。両方とも `lint --geometry` の報告に含まれるが `--rule` で severity は変更できない。
- `svg/outline-edge-miss` は、auto の離れた bowtie の補正経路に退化・逆行・自己交差/重複がある、または新しい区間が他の shape footprint の内部を横切るなど、安全性を確認できない場合も warning で報告する。その場合は両端とも D2 の元経路を維持するため、layout を調整する。曲線の制御点 bounds を使う保守的検査で安全を証明できない場合も同様（設計 §6.66）。画像への延長失敗の既存 error severity は従来どおり。

### 閉路を閉じる辺（`geometry/reversed-edge`）

図を宣言順に読んだとき、読み手が逆向きになると予想する辺を、深さ優先探索で決める。

- 探索の開始点は、入ってくるエッジのない要素（グループ → ノードの順、それぞれ文書順）、続いて残りの要素（同じ順）。各要素からはエッジを文書順にたどる。
- 探索中の経路上にある要素へ戻る辺が「閉路を閉じる辺」。例: `start → process → done → process`（retry）では `done → process`。
- group の境界をまたぐエッジは、両端どうしの辺に加えて、両端の祖先のうち最小共通祖先の直下にあるものどうしの辺としてもたどる（ELK は group を 1 つの塊として配置するため）。例: group `g` の中の `a` と外の `b` で `g → b`、`b → a` と書くと、`g → b → g` が閉路になり、`b → a` が閉じる辺になる。
- 自己ループと、グループとその子孫を結ぶエッジは探索に含めない。線（`line`）は向きが見えないので報告しないが、ELK のレイアウトには影響するので探索には含める。
- 「逆らって描かれている」は、終点の図形（`label` 部品はラベルの矩形）が始点の図形より方向の手前側に完全にあること（`down` なら終点の下端 ≤ 始点の上端。許容誤差 1 unit）。
- ELK の閉路の切り方と一致する保証はない（宣言順の意図を基準にした近似）。入ってくるエッジのない要素を含まない閉路は、最初に宣言された要素から読む。

### 許容誤差と限界

- 座標はすべて SVG の user unit（= D2 unit、0.5pt）。許容誤差は **1 unit（0.5pt）**: D2 は座標を整数または 0.5 単位で出力するため、接しているだけの図形・ラベルは問題にしない（重なりは 1 unit を超える深さが必要。はみ出しは 1 unit を超えたものだけ）。
- ページの上限と最小文字サイズは、量子化せず pt の実数で比較する（浮動小数点の誤差 1e-6pt のみ許容）。
- **空白の扱い**: D2 の `<text>` は `xml:space="preserve"` も `white-space: pre` も持たないため、描画側は空白を畳む（CSS `white-space: normal`）。再計測も同じ規則に従う: タブは空白にし、連続する空白は最初の 1 つに畳み（`<tspan>` の行をまたいでも同じ。行は 1 つの text の inline box のため）、text 全体の先頭と末尾の空白は除く。ノーブレークスペース（U+00A0）と全角スペース（U+3000）は畳まない。空白だけの行（ノーブレークスペースだけの行を含む）は何も描かないので、はみ出し・衝突・横切りの判定から除く。Chrome の描画幅と一致することを確認済み（例: `"x     y"` → `"x y"`、空白 50 個のラベルは幅 0）。
- ラベルの矩形は、各行の advance 幅の合計 × 文字サイズ、高さは ascender から descender まで（`hhea`。同梱フォントでは合計がちょうど 1em）。実際のインク（字形の輪郭）ではなく、文字送りの箱で判定する。
- カーニング・合字・shaping は扱わない。同梱の BIZ UD Gothic は `kern` / `GPOS` を持たないので、advance の合計がブラウザの描画幅と一致する。ほかのフォントセットを追加する場合は、カーニングの分（通常は数 % 以内）だけ幅を過大に見積もりうる。
- 角丸（`radius`）は範囲に反映しない（ノードのラベルは中央に置かれるため、角に届くことはない。コンテナのラベルは左上に置かれるので、大きな `radius` のコンテナでは角の曲線にかかっても検出しない）。cylinder と document の衝突判定は外接矩形を使う。
- `geometry/node-overlap` は通常部品同士では外接矩形で判定する（円や菱形の角の空白でも重なりとみなす）。カスタム輪郭が関わる場合は上記の凸領域を使う。ELK は通常ノードを重ねないので、明示サイズや D2 の不具合の検出が目的。
- エッジの経路は、3 次ベジェを 16 本の弦に分割して判定する（D2 の曲線は角の丸めだけなので誤差は許容誤差より十分小さい）。矢尻は判定しない。
- 図ごとに規則を抑制するフィールドはまだない。誤検出は設定で規則を無効にするか severity を下げて扱う。

## 終了コード

| code | 意味 |
|---|---|
| 0 | error がない（`maxWarnings` を指定した場合は、warning がその数以下） |
| 1 | error がある、または warning が `maxWarnings` を超えた |
| 2 | 使い方の誤り・内部エラー（不正な設定、ファイルを読めない、例外など）。`lintFigure()` は返さず、呼び出し側（CLI）が例外を変換する |

info は終了コードに影響しない。

## 出力形式

診断は「ファイル → 行 → 列（位置のない診断が先頭）→ code → 文書パス → メッセージ」の順に並べる。同じ入力からは常に同じ出力になる。

**JSON**（`formatLintJson()`）: バージョン付きの封筒に、共通 Diagnostic 型（§1）をそのまま入れる。`file` は名前のない入力では `null`。

```json
{
  "version": 1,
  "file": "figure.sumi.yaml",
  "diagnostics": [
    {
      "code": "lint/self-loop",
      "severity": "info",
      "message": "Edge edges[0] connects \"worker\" to itself.",
      "path": ["edges", 0],
      "location": { "file": "figure.sumi.yaml", "line": 9, "column": 5, "endLine": 12, "endColumn": 1 },
      "subject": { "kind": "edge", "id": "edges[0]" },
      "hint": "Self-loops are allowed; remove the edge if it is unintended."
    }
  ],
  "summary": { "errors": 0, "warnings": 0, "infos": 1 }
}
```

`sumi lint --json` は、ファイルごとの上記の封筒を `results` に並べ、全体の件数を添えて出力する。ファイルが 1 つでも同じ形にする。読めなかったファイルは `results` に含めない（stderr にエラーを出し、終了コードは 2）。

```json
{ "version": 1, "results": [{ "version": 1, "file": "figure.sumi.yaml", "diagnostics": [], "summary": { "errors": 0, "warnings": 0, "infos": 0 } }], "summary": { "errors": 0, "warnings": 0, "infos": 0 } }
```

`--geometry` を付けると、ファイルごとの封筒に描画結果の出力サイズ `size` が加わる（#37。`sumi render --json` の `size` と同じ形で、描画しなかった・できなかったファイルは `null`）。`--geometry` なしでは `size` キーを出さない。同じ版のうちはフィールドの追加だけを行う（design doc §6.10）。

```json
{ "size": { "widthPt": 138.5, "heightPt": 439, "widthMm": 48.86, "heightMm": 154.87, "profile": { "id": "paper-single", "maxWidthMm": 88, "maxHeightMm": 220, "minFontSizePt": 7 }, "fits": true } }
```

**テキスト**（`formatLintText()`）: 1 診断 1 行の `file:line:col severity code message`。続く行に `hint:` と `related:` を字下げして出し、最後に件数をまとめる。`sumi lint` は複数ファイルの診断を続けて出し、件数は最後に全体で 1 行だけ出す。端末に出力するときは severity に色を付ける（`--no-color` / `NO_COLOR` で無効）。

```text
figure.sumi.yaml:21:5 warning lint/ancestor-edge Edge edges[1] connects group "outer" with "api", which is inside it.
  hint: D2 draws such an edge across the group's border and label; connect elements that are both inside or both outside the group instead.
  related: figure.sumi.yaml:5:5 Group "outer" is defined here.

0 errors, 1 warning, 0 infos
```

## 規則の追加

規則は `defineRule()`（`src/lint/rule.ts`）で定義し、`BUILTIN_LINT_RULES`（`src/lint/rules/index.ts`）に加える。幾何の規則は `defineGeometryRule()` で定義し、`BUILTIN_GEOMETRY_RULES`（`src/lint/geometry/rules.ts`）に加える（`GeometryContext` を受け取る）。規則は `LintContext`（有効な要素、解決済みの部品とスタイル、Theme）を受け取り、`{ message, path, subject?, hint?, related? }` を返す。code・severity・位置情報は枠組みが付ける。options を取る規則は、既定値付きの Zod スキーマを `options` に指定する。規則は汎用的に保ち、特定分野に固有の検査は加えない。
