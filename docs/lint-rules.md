# Lint ルール

`sumi lint`（API: `lintFigure()`、`src/lint`）は、診断を集める段（`yaml` → `schema` → `ref` → `component` → `theme` → `profile`）と、**構造 lint**（stage `lint`）を実行する。構造 lint は描画前の文書だけを検査し、D2 を必要としない。描画後の SVG を検査する幾何 lint（stage `geometry`、#13）は別の段で、`lintRenderedFigure()` / `lintGeometry()` が実行する（下記の「幾何 lint」）。

構造 lint の規則は、前段で error になった要素（`CheckState.invalid` に含まれる要素と、その要素に依存する要素）を検査しない。そのため、1 つの誤りから lint の警告が連鎖して出ることはない。

## 規則の一覧

いずれも自動修正には対応していない（`fixable: false`）。

| code | 既定 | 内容 | 直し方 |
|---|---|---|---|
| `lint/empty-figure` | warning | ノードが 1 つもない。 | ノードを追加する。空の図を意図している場合は無効にする。 |
| `lint/no-edges` | warning | error のないノードが 2 つ以上あるのに、エッジが 1 つもない（error のあるエッジも 1 本と数える）。 | エッジでつなぐ。つながりのない図を意図している場合は無効にする。 |
| `lint/ancestor-edge` | warning | グループと、その（間接的な）子孫をつなぐエッジ（§2.2）。D2 ではエッジがグループの枠とラベルを横切る。 | 両端をともにグループの内側、またはともに外側の要素にする。 |
| `lint/self-loop` | info | 始点と終点が同じエッジ。スキーマ上は有効なので info とする。 | 意図していなければ削除する。 |
| `lint/duplicate-edge` | warning | 端点・部品・ラベルがすべて同じエッジが 2 本以上ある（2 本目以降に出す）。variant は比較しない。方向のない部品（`line`）と両方向の部品（`double-arrow`）は端点の順序を区別しない。 | 一方を削除するか、ラベルを変える。 |
| `lint/empty-label` | warning | ラベルが空（または空白のみ）のノード。文字だけを描く部品（`label`、shape `text`）は `component/missing-label`（error）で検査済みなので対象外。 | ラベルを付ける。ラベルなしの図形を意図している場合は無効にする。 |
| `lint/long-label` | warning | ラベルのいずれかの行の表示幅が `maxLineWidth`（既定 40）桁を超える、または行数が `maxLines`（既定 4）を超える。node・group・edge のラベルが対象。 | ラベルを短くする、または `\n` で改行する。 |
| `lint/missing-glyph` | warning | ラベルに、Theme のフォントセットが字形を持たない文字がある。メッセージに文字と `U+XXXX` を列挙する（最大 10 文字）。 | 文字を置き換えるか、その文字を含むフォントセットの Theme を使う。 |

部品の非推奨は、名前解決と同じ場所で `component/deprecated`（warning、stage `component`）として報告する。重複を避けるため、lint には同じ規則を置かない。

### 表示幅の数え方（`lint/long-label`）

- 行は `\r\n`・`\r`・`\n` で分ける（コンパイラと同じ）。
- 1 行の幅は、書記素クラスタ（`Intl.Segmenter`）ごとに数える。East Asian Width が Wide / Fullwidth の文字（漢字・かな・ハングル・全角英数など。UAX #11 の主要なブロックで近似）と、絵文字として表示される文字（`Emoji_Presentation`、VS16 付き、`1️⃣` などの keycap 列）は **2 桁**、それ以外は 1 桁とする。結合文字や ZWJ は基底文字のクラスタに含まれるので幅を増やさない。
- 例: `API` は 3 桁、`認証サーバ` は 10 桁。既定の 40 桁は、全角文字なら 20 文字に当たる。

### 字形の判定（`lint/missing-glyph`）

- フォントは要素の実効スタイルで選ぶ: `mono` なら mono slot、そうでなく `bold` なら bold、`italic` なら italic、それ以外は regular（mono・italic の slot がないフォントセットでは regular。§4.2）。
- 各 TTF の `cmap`（format 12 を優先し、なければ format 4）を読んで判定する。読み取りは cmap テーブルとサブテーブルが宣言する範囲の中に限り、segment / group は昇順で重なりがないことを検査する（壊れたフォントは例外）。カバー範囲はソート済みの区間として持ち、ファイルごとにキャッシュする。
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

| code | 既定 | 内容 | 直し方 |
|---|---|---|---|
| `geometry/exceeds-page-width` | error | 出力幅（余白込み）が Profile の `maxWidth` を超える。pt のまま量子化せずに比較し、両方の大きさを mm で示す。 | `layout.direction: down` にする、ラベルを短くする、幅の広い Profile（`paper-double` など）を使う。 |
| `geometry/exceeds-page-height` | error | 出力の高さが Profile の `maxHeight` を超える（`maxHeight` がある Profile だけ）。 | `layout.direction: right` にする、図を分ける、高さに余裕のある Profile を使う。 |
| `geometry/text-too-small` | error | 描画されたラベルの文字サイズが Profile の `minFontSize` 未満。通常は `profile/font-too-small` が描画前に防ぐので、描画後の安全網。 | 文字サイズの大きい Theme / variant を使う。 |
| `geometry/label-overflow` | error | ノード・グループのラベル（再計測）が、図形の中の文字を置ける範囲（下表）に収まらない。明示サイズ（`props.width` / `height`）が小さい場合は `props` を指す（D2 は明示サイズを保ち、ラベルを図形の外に出す）。 | 明示サイズを大きくするか外す。ラベルを短くするか改行する。文字の入る範囲が広い図形にする。 |
| `geometry/out-of-canvas` | error | 図形・ラベル（再計測）・エッジの経路がキャンバスの外にはみ出す（切れて表示される）。 | ラベルを短くする。解消しなければ不具合として報告する。 |
| `geometry/node-overlap` | warning | 2 つのノード・グループの図形（外接矩形）が重なり、グループの木でどちらも他方を含まない。子と祖先グループの重なり（意図した包含）は対象外。 | 明示サイズを見直す。同じグループに入れる。 |
| `geometry/label-collision` | warning | ラベル（再計測）が、別の要素のラベル、または別のノードの図形と重なる（エッジのラベルとノードの図形を含む）。自分の図形との重なり、グループの図形との重なり（中の要素は意図して重ねて描く）は対象外。グループのラベルと子ノードの図形の重なりは対象。要素の組ごとに 1 件。 | ラベルを短くする。レイアウト（方向・グループ）を変える。 |
| `geometry/edge-crosses-label` | warning | エッジの経路が、別の要素のラベル（再計測）を横切る。例: `direction: down` で上からコンテナに入るエッジが、中央上部のコンテナのラベルを横切る（#31）。自分のラベルは対象外（D2 はラベルの下の線をマスクする）。 | コンテナではなく中の要素どうしをつなぐ、`layout.direction` を変える、ラベルを短くする。 |
| `geometry/aspect-distorted` | warning | 縦横比が固定の部品（`circle`、`square`）が、縦横の異なる大きさで描かれている。ELK は次数の多いノードや自己ループのあるノードを一方向に拡大する。 | ノードのエッジを減らす。縦横比が重要でなければ `ellipse` / `box` を使う。 |

### 文字を置ける範囲（`geometry/label-overflow`）

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

ラベルは枠線の内側半分（stroke 幅の半分）にかかってはいけない。許容誤差 1 unit（0.5pt）を差し引く。

### 許容誤差と限界

- 座標はすべて SVG の user unit（= D2 unit、0.5pt）。許容誤差は **1 unit（0.5pt）**: D2 は座標を整数または 0.5 単位で出力するため、接しているだけの図形・ラベルは問題にしない（重なりは 1 unit を超える深さが必要。はみ出しは 1 unit を超えたものだけ）。
- ページの上限と最小文字サイズは、量子化せず pt の実数で比較する（浮動小数点の誤差 1e-6pt のみ許容）。
- ラベルの矩形は、各行の advance 幅の合計 × 文字サイズ、高さは ascender から descender まで（`hhea`。同梱フォントでは合計がちょうど 1em）。実際のインク（字形の輪郭）ではなく、文字送りの箱で判定する。
- カーニング・合字・shaping は扱わない。同梱の BIZ UD Gothic は `kern` / `GPOS` を持たないので、advance の合計がブラウザの描画幅と一致する。ほかのフォントセットを追加する場合は、カーニングの分（通常は数 % 以内）だけ幅を過大に見積もりうる。
- 角丸（`radius`）は範囲に反映しない（ラベルは中央に置かれるため、角に届くことはない）。cylinder と document の衝突判定は外接矩形を使う。
- `geometry/node-overlap` は外接矩形で判定する（円や菱形の角の空白でも重なりとみなす）。ELK は通常ノードを重ねないので、明示サイズや D2 の不具合の検出が目的。
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

**テキスト**（`formatLintText()`）: 1 診断 1 行の `file:line:col severity code message`。続く行に `hint:` と `related:` を字下げして出し、最後に件数をまとめる。`sumi lint` は複数ファイルの診断を続けて出し、件数は最後に全体で 1 行だけ出す。端末に出力するときは severity に色を付ける（`--no-color` / `NO_COLOR` で無効）。

```text
figure.sumi.yaml:21:5 warning lint/ancestor-edge Edge edges[1] connects group "outer" with "api", which is inside it.
  hint: D2 draws such an edge across the group's border and label; connect elements that are both inside or both outside the group instead.
  related: figure.sumi.yaml:5:5 Group "outer" is defined here.

0 errors, 1 warning, 0 infos
```

## 規則の追加

規則は `defineRule()`（`src/lint/rule.ts`）で定義し、`BUILTIN_LINT_RULES`（`src/lint/rules/index.ts`）に加える。幾何の規則は `defineGeometryRule()` で定義し、`BUILTIN_GEOMETRY_RULES`（`src/lint/geometry/rules.ts`）に加える（`GeometryContext` を受け取る）。規則は `LintContext`（有効な要素、解決済みの部品とスタイル、Theme）を受け取り、`{ message, path, subject?, hint?, related? }` を返す。code・severity・位置情報は枠組みが付ける。options を取る規則は、既定値付きの Zod スキーマを `options` に指定する。規則は汎用的に保ち、特定分野に固有の検査は加えない。
