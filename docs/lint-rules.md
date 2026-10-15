# Lint ルール

`sumi lint`（API: `lintFigure()`、`src/lint`）は、診断を集める段（`yaml` → `schema` → `ref` → `component` → `theme` → `profile`）と、**構造 lint**（stage `lint`）を実行する。構造 lint は描画前の文書だけを検査し、D2 を必要としない。描画後の SVG を検査する幾何 lint（stage `geometry`）は別の段である（#13）。

構造 lint の規則は、前段で error になった要素（`CheckState.invalid` に含まれる要素と、その要素に依存する要素）を検査しない。そのため、1 つの誤りから lint の警告が連鎖して出ることはない。

## 規則の一覧

いずれも自動修正には対応していない（`fixable: false`）。

| code | 既定 | 内容 | 直し方 |
|---|---|---|---|
| `lint/empty-figure` | warning | ノードが 1 つもない。 | ノードを追加する。空の図を意図している場合は無効にする。 |
| `lint/no-edges` | warning | ノードが 2 つ以上あるのに、エッジが 1 つもない。 | エッジでつなぐ。つながりのない図を意図している場合は無効にする。 |
| `lint/ancestor-edge` | warning | グループと、その（間接的な）子孫をつなぐエッジ（§2.2）。D2 ではエッジがグループの枠とラベルを横切る。 | 両端をともにグループの内側、またはともに外側の要素にする。 |
| `lint/self-loop` | info | 始点と終点が同じエッジ。スキーマ上は有効なので info とする。 | 意図していなければ削除する。 |
| `lint/duplicate-edge` | warning | 端点・部品・ラベルがすべて同じエッジが 2 本以上ある（2 本目以降に出す）。variant は比較しない。方向のない部品（`line`）と両方向の部品（`double-arrow`）は端点の順序を区別しない。 | 一方を削除するか、ラベルを変える。 |
| `lint/empty-label` | warning | ラベルが空（または空白のみ）のノード。文字だけを描く部品（`label`、shape `text`）は `component/missing-label`（error）で検査済みなので対象外。 | ラベルを付ける。ラベルなしの図形を意図している場合は無効にする。 |
| `lint/long-label` | warning | ラベルのいずれかの行の表示幅が `maxLineWidth`（既定 40）桁を超える、または行数が `maxLines`（既定 4）を超える。node・group・edge のラベルが対象。 | ラベルを短くする、または `\n` で改行する。 |
| `lint/missing-glyph` | warning | ラベルに、Theme のフォントセットが字形を持たない文字がある。メッセージに文字と `U+XXXX` を列挙する（最大 10 文字）。 | 文字を置き換えるか、その文字を含むフォントセットの Theme を使う。 |

部品の非推奨は、名前解決と同じ場所で `component/deprecated`（warning、stage `component`）として報告する。重複を避けるため、lint には同じ規則を置かない。

### 表示幅の数え方（`lint/long-label`）

- 行は `\r\n`・`\r`・`\n` で分ける（コンパイラと同じ）。
- 1 行の幅は、書記素クラスタ（`Intl.Segmenter`）ごとに数える。East Asian Width が Wide / Fullwidth の文字（漢字・かな・ハングル・全角英数など。UAX #11 の主要なブロックで近似）と、絵文字として表示される文字（`Emoji_Presentation`、または VS16 付き）は **2 桁**、それ以外は 1 桁とする。結合文字や ZWJ は基底文字のクラスタに含まれるので幅を増やさない。
- 例: `API` は 3 桁、`認証サーバ` は 10 桁。既定の 40 桁は、全角文字なら 20 文字に当たる。

### 字形の判定（`lint/missing-glyph`）

- フォントは要素の実効スタイルで選ぶ: `mono` なら mono slot、そうでなく `bold` なら bold、`italic` なら italic、それ以外は regular（mono・italic の slot がないフォントセットでは regular。§4.2）。
- 各 TTF の `cmap`（format 12 を優先し、なければ format 4）を読んで判定する。読み込み結果はファイルごとにキャッシュする。
- 空白（改行・タブ・全角スペースを含む）、制御文字、既定で無視される文字（異体字セレクタ、ZWJ など）は検査しない。
- 同梱の `sumi/biz-ud-gothic` に含まれない文字の例: 絵文字（😀 U+1F600、✅ U+2705）、𠮷（U+20BB7）、龘（U+9F98）、タイ文字（ก U+0E01）。JIS X 0213 の拡張 B の文字（𠀋 U+2000B など）は含まれる。

## 設定

設定は JSON 互換のオブジェクトで渡す（CLI のフラグや設定ファイルからの組み立ては #14）。

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

- `rules` の値は `"off" | "error" | "warning" | "info"`、または `{ level?, options? }`。書かなかった規則は既定の severity で有効になる。
- 対象は `lint/*` の規則だけで、他の段の診断の severity は変えられない。
- 未知の規則 ID（近い候補を示す）、不正な level、不正な options、options を取らない規則への options は、`LintConfigError` になる（図の診断ではなく使い方の誤り。exit code 2）。
- 図ごとに規則を抑制するフィールドは、Figure Schema にはまだない。

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

**テキスト**（`formatLintText()`）: 1 診断 1 行の `file:line:col severity code message`。続く行に `hint:` と `related:` を字下げして出し、最後に件数をまとめる。

```text
figure.sumi.yaml:21:5 warning lint/ancestor-edge Edge edges[1] connects group "outer" with "api", which is inside it.
  hint: D2 draws such an edge across the group's border and label; connect elements that are both inside or both outside the group instead.
  related: figure.sumi.yaml:5:5 Group "outer" is defined here.

0 errors, 1 warning, 0 infos
```

## 規則の追加

規則は `defineRule()`（`src/lint/rule.ts`）で定義し、`BUILTIN_LINT_RULES`（`src/lint/rules/index.ts`）に加える。規則は `LintContext`（有効な要素、解決済みの部品とスタイル、Theme）を受け取り、`{ message, path, subject?, hint?, related? }` を返す。code・severity・位置情報は枠組みが付ける。options を取る規則は、既定値付きの Zod スキーマを `options` に指定する。規則は汎用的に保ち、特定分野に固有の検査は加えない。
