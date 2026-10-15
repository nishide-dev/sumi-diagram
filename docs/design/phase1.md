# Sumi Phase 1 設計（v3）— Figure Schema / Diagnostic / Registry / Theme / Profile

対象 Issue: #4 #5 #6 #7（#8〜#13 の前提となる契約を含む）
前提: D2 技術スパイク（D2 CLI v0.9.0、`@terrastruct/d2` 0.1.33 で実測。#9 にコメントで記録）
v2 からの変更: CheckState・全フィールドの既定値・YAML の制約・ElementKey と edge の lowering・組み込み部品の一覧・フォント slot・既定スタイル表・token の型規則・Profile の変換表・geometry の契約を追加した。
v1 からの変更: D2 の実際の値域・フォント・ID・SVG 構造に合わせて契約を修正した。ports は v1 スキーマから除外した。

---

## 0. パイプラインと結果型

```
*.sumi.yaml
  → parse        (yaml, 位置情報付き)              stage: yaml
  → validate     (Figure Schema, 構造のみ strict)   stage: schema
  → link         (ID 参照・グループ木)              stage: ref
  → resolve      (Registry: 部品・props・variant)   stage: component
  → style        (Theme: token → 実効スタイル)       stage: theme
  → constrain    (Profile: 単位・制約の事前検査)      stage: profile
  → Figure IR    (#8)
  → D2 source    (#8)                               stage: compile
  → render       (D2 CLI, #9)                       stage: backend
  → SVG artifact (#11)                              stage: svg
  → lint         (#12 構造 / #13 幾何)               stage: lint / geometry
```

```ts
type Result<T> =
  | { ok: true;  value: T; diagnostics: Diagnostic[] }   // warning/info を含みうる
  | { ok: false; diagnostics: Diagnostic[] };            // error を 1 件以上含む
```

- `Result<T>` は**公開 API**（`compileFigure()` 等）の戻り値である。検査段の内部では、別の型 `CheckState` を受け渡す。

```ts
type ElementKey = `n:${string}` | `g:${string}` | `e:${string}`;  // §2.4

interface CheckState {
  doc: PartialFigure;               // 構造的に読めた部分（未知フィールド等の error があっても、型が合う要素は残す）
  invalid: Set<ElementKey>;         // error が出た要素
  diagnostics: Diagnostic[];
  // 段ごとに解決済みの情報を追記する
  components?: Map<ElementKey, ResolvedComponent>;
  styles?: Map<ElementKey, ResolvedStyle>;
}
```

- **診断を集める段**（validate → link → resolve → style → constrain）は、前段で error があっても続行する。
  - 各段は、`invalid` に含まれる要素を検査しない。要素の**依存先**（親グループ、edge の両端点、部品）が `invalid` に含まれる場合、その依存先が原因となる診断は出さない（依存先とは独立した誤りは報告する）。依存先が無効な要素自身も invalid に加え、後段の検査対象から外す。
  - error を出した要素は `invalid` に追加する。
  - 例: 部品が未知の node は `style` 段でスタイル検査をしない。その node を端点とする edge は `ref` 段で検査済みのため、追加の診断を出さない。
- **生成する段**（IR → D2 → render）は、diagnostics に error が 1 件もないときだけ実行し、`CheckState` から完全な `FigureIR` を作る。
- `sumi lint` は診断を集める段と構造 lint を、`sumi render` は全段を実行する。

## 1. 共通 Diagnostic 型（#4 で実装し、全段で共有）

```ts
type Severity = "error" | "warning" | "info";
type DocPath = (string | number)[];          // 例: ["nodes", 2, "props", "width"]

interface SourceLocation {
  file?: string;
  line: number; column: number;              // 1-based
  endLine?: number; endColumn?: number;
}

interface Diagnostic {
  code: string;            // "<stage>/<rule>"。例: "schema/unknown-field", "ref/unknown-node"
  severity: Severity;
  message: string;         // 英語の一文
  path?: DocPath;          // 入力文書（または Theme/Profile 定義）内のパス
  location?: SourceLocation;
  subject?: { kind: "node" | "group" | "edge" | "figure"; id: string }; // 幾何 lint 等、要素に紐づく場合
  hint?: string;           // 修正案。未知 ID には近い候補（編集距離）を入れる
  related?: { path?: DocPath; location?: SourceLocation; message: string }[];
}
```

- stage 名は §0 の一覧で固定する。`code` は安定した公開識別子として扱い、変更は破壊的変更とみなす。
- JSON 直列化可能であること（`sumi lint --json` の出力そのもの）。

## 2. Figure Schema v1（#4）

### 2.1 完全な例（単体で検証・描画が通る）

```yaml
version: 1
figure:
  id: request-pipeline
  theme: minimal                 # 省略時 minimal
  profile: paper-single          # 省略時 paper-single
  layout:
    direction: right             # right | down | left | up。省略時 right

groups:
  - id: backend
    label: Backend               # 省略時はラベルなし（空文字と同じ扱い）

nodes:
  - id: client
    component: box
    label: Client
  - id: api
    component: box
    label: API Server
    group: backend
  - id: auth
    component: diamond
    label: "Authorized?"
    group: backend
  - id: db
    component: cylinder
    label: "Database\n(primary)" # \n は改行
    variant: muted
    group: backend

edges:
  - from: client
    to: api
    label: HTTPS
  - from: api
    to: auth
  - from: auth
    to: db
    label: "yes"
    variant: dashed
```

### 2.2 フィールド定義

全フィールドの一覧。「既定」は正規化後の値で、正規化は validate 段で行う（以降の段は常に既定値が埋まった文書を扱う）。

| 位置 | フィールド | 必須 | 型 | 既定 |
|---|---|---|---|---|
| root | `version` | ✓ | 整数 `1` | |
| root | `requires` | | semver range 文字列（例 `">=0.4.0"`） | なし |
| root | `figure` | ✓ | object | |
| root | `groups` / `nodes` / `edges` | | 配列 | `[]` |
| root | `metadata` | | JSON 互換値 | なし |
| figure | `id` | ✓ | ID | |
| figure | `title` | | string | なし |
| figure | `theme` | | 組み込み Theme 名 | `minimal` |
| figure | `profile` | | 組み込み Profile 名 | `paper-single` |
| figure | `layout` | | object（strict） | `{}` |
| figure.layout | `direction` | | `right`\|`down`\|`left`\|`up` | `right` |
| group | `id` | ✓ | ID | |
| group | `label` | | string | `""` |
| group | `component` | | 部品参照（kind=group） | `container` |
| group | `variant` | | string | `default` |
| group | `group` | | 親 group の ID | なし（root） |
| node | `id` | ✓ | ID | |
| node | `component` | ✓ | 部品参照（kind=node） | |
| node | `label` | | string | `""` |
| node | `variant` | | string | `default` |
| node | `props` | | object | `{}`（manifest の既定値で補完） |
| node | `group` | | group の ID | なし（root） |
| edge | `from` / `to` | ✓ | node または group の ID | |
| edge | `id` | | ID | なし |
| edge | `label` | | string | `""` |
| edge | `component` | | 部品参照（kind=edge） | `arrow` |
| edge | `variant` | | string | `default` |
| edge | `props` | | object | `{}` |

- `figure.layout` を含め、すべての object は strict（未知キーは error）。例外は `props`（manifest のスキーマで strict に検証する）と `metadata`。
- `layout.direction` は root にのみ適用する。ELK はコンテナ単位の direction を無視するため、グループ単位の方向指定は提供しない。
- **YAML の制約**:
  - 重複キーは `yaml/duplicate-key`（error）。
  - anchor / alias / merge key（`&`、`*`、`<<`）は v1 では使えない（`yaml/alias-not-allowed`）。位置情報の対応を単純に保つため。
  - 文書は 1 つだけ（`---` で複数文書にしない）。
  - 独自タグ（`!foo`）は使えない。
- **`metadata` の JSON 互換性**: キーは文字列、値は文字列・有限の数値・真偽値・null・配列・object のみとする。日付などの YAML 固有型は、`yaml` ライブラリを core schema で読み、文字列として扱う。

- **ID**: `^[a-z][a-z0-9_-]{0,63}$`。**小文字のみ**（D2 の key は大文字小文字を区別しないため、大小だけが違う ID を作らせない）。node と group は同じ ID 空間、edge は別の空間。
- **edge の識別**: `id` は任意。省略した edge は文書上 `edges[<index>]` で識別する（自動 ID は生成しない）。内部 key は §2.4 で別に作るので、ユーザー ID と衝突しない。
- **label**: プレーンテキスト。`\n`（YAML 上の改行）で改行する。Markdown・HTML は解釈しない。D2 向けのクォート・エスケープはコンパイラの責務。`""` と省略は同じ（ラベルなし）。node の label 省略時は**ラベルなし**とする（ID を表示しない。ID はデータで、表示文言ではないため）。
- **グループ**: 所属は子側の `group:` で表す（単一の親、ネスト可）。循環は `ref/group-cycle`。存在しない親は `ref/unknown-group`。
- **接続の許容表**:

| ケース | 扱い |
|---|---|
| node ↔ node | 可 |
| node ↔ group / group ↔ group | 可 |
| 自己ループ（from = to） | 可 |
| 同じ組の多重エッジ | 可 |
| 祖先 group ↔ その子孫 | 可。ただし lint warning `lint/ancestor-edge`（D2 ではコンテナのラベルを横切るため） |
| 未知の端点 | error `ref/unknown-endpoint` |

- **ノード 0 件・エッジ 0 件**は schema 上は有効で、lint の warning（抑制可）とする。

### 2.3 strict の境界とバージョン方針
- **構造部分**（root / figure / group / node / edge の既知キー）は strict。未知キーは `schema/unknown-field` の error。hint で近いキーを示し、「新しい Sumi で追加されたフィールドの可能性」にも触れる。
- **`props`** は resolve 段で、部品 manifest の props スキーマ（Zod の strict object）で検証する。未知キーは `component/unknown-prop`、型の誤りは `component/invalid-prop`（いずれも error）。既定値は manifest スキーマの `.default()` で補完する（適用するのは resolve 段だけ）。
- **`metadata`** は JSON 互換かどうかだけを検査し、内容は解釈しない。
- **互換性**: 「新しい Sumi は古い v1 文書を必ず読める」（後方互換）を保証する。「古い Sumi が新しい文書を読める」（前方互換）は保証しない。v1 のうちは任意フィールドや部品の追加だけを行う。破壊的変更は `version: 2` とし、移行手段（`sumi fmt --migrate` 等）を用意する。
- 任意で `requires: ">=0.4.0"`（Sumi の最小バージョン）を書けるようにし、満たさない場合は最初に明示的なエラーを出す（v1 で導入する）。
- Theme / Profile / manifest の定義形式にもそれぞれ `version: 1` を持たせる（MVP は組み込みのみだが、将来のユーザー定義に備える）。

### 2.4 内部 key への写像（#8 と共有する決定）
- **ElementKey**: 全要素に内部キーを付ける。node は `n:<id>`、group は `g:<id>`、edge は `e:<id>`（id がない edge は `e:#<index>`。`#` は ID の文字種に含まれないので衝突しない）。ElementKey が、診断・source map・geometry に共通する要素の識別子になる。ユーザー ID は別フィールド（`id?`）として持つ。
- **D2 の key**: Sumi が生成し、ユーザー ID を直接使わない。node は `n_<id>`、group は `g_<id>` とする。D2 上のパスは、group の木に従った完全パス（例: `g_backend.n_api`）。接頭辞によって、予約語（`label`、`style`、`shape` 等）や `.` との衝突を避ける。
- **edge の lowering**:
  - すべての edge を **root スコープ**で、両端点の完全パスを使って宣言する（例: `n_client -> g_backend.n_api`）。宣言スコープが常に root になり、D2 側の edge key が一意に定まる。
  - 方向は manifest の `direction` から演算子を決める: forward は `->`、backward は `<-`、both は `<->`、none は `--`。
  - D2 の出現番号（`[i]`）には依存しない。
- **SVG からの逆引き**: すべての要素に `class: "sumi-k-<enc>"` と `sumi-kind-<node|group|edge>` を付ける。`<enc>` は ElementKey を class 名として安全な形に符号化したもの（`:` → `--`、`#` → `_`。例: `n:api` → `sumi-k-n--api`、`e:#3` → `sumi-k-e--_3`）。逆引きはこの class を一次情報とし、D2 の base64 class は検証用の補助にとどめる。

### 2.5 機械可読定義
- Figure Schema は Zod 4 で定義し、`z.toJSONSchema()` で `schema/figure.v1.schema.json`（JSON Schema 2020-12）を生成して commit する。CI で再生成した結果との差分がないことを検査する。外部 `$ref` は使わない（1 ファイルで完結させる）。
- YAML は `yaml`（eemeli/yaml）で解析し、ノードの range から `DocPath` → 行・列を引けるようにする（`sumi fmt` のコメント保持にも使う）。

## 3. Component manifest と Registry（#5）

```ts
interface ManifestBase {
  version: 1;
  namespace: string;            // 組み込みは "sumi"
  name: string;                 // "box"。正規 ID は `${namespace}/${name}`
  description: string;
  variants: string[];           // "default" を必ず含む
  props: ZodType;               // 部品固有の props（label は含めない）。catalog では JSON Schema に変換する
  since: string;
  deprecated?: { since: string; replacement?: string };
}

interface NodeManifest extends ManifestBase {
  kind: "node";
  shape: NodeShape;             // 下記の許可リストのみ
  sizing: "auto" | "fixed-aspect-1"; // circle / square は fixed-aspect-1
}
interface GroupManifest extends ManifestBase {
  kind: "group";
  shape: "rectangle";
}
interface EdgeManifest extends ManifestBase {
  kind: "edge";
  direction: "forward" | "backward" | "both" | "none";
  head?: Arrowhead; tail?: Arrowhead;   // direction に応じて有効
}

type NodeShape = "rectangle" | "square" | "oval" | "circle" | "diamond" | "hexagon"
               | "parallelogram" | "cylinder" | "document" | "page" | "text";
type Arrowhead = "triangle" | "arrow" | "diamond" | "circle" | "box" | "cross" | "none";
```

- **kind ごとの判別共用体**。edge は形状（shape）ではなく、方向と矢尻で表す。
- MVP の node shape は汎用形状の許可リストに限定する。D2 固有の複合形状（`sql_table`、`class`、`sequence_diagram`、`person`、`cloud` 等）は対象外。
- **props の例**: node の `width` / `height`（pt、任意）。明示サイズがラベルより小さい場合は `component/size-too-small`（計測は #13 の範囲。MVP は警告に留める）。
- **MVP の組み込み部品**（実装は #10。#5〜#7 のテストと設計はこの一覧を前提にする）:

| 正規 ID | kind | D2 lowering | variants |
|---|---|---|---|
| `sumi/box` | node | `shape: rectangle` | default, emphasis, muted |
| `sumi/square` | node | `shape: square` | 同上 |
| `sumi/circle` | node | `shape: circle` | 同上 |
| `sumi/ellipse` | node | `shape: oval` | 同上 |
| `sumi/diamond` | node | `shape: diamond` | 同上 |
| `sumi/hexagon` | node | `shape: hexagon` | 同上 |
| `sumi/parallelogram` | node | `shape: parallelogram` | 同上 |
| `sumi/cylinder` | node | `shape: cylinder` | 同上 |
| `sumi/document` | node | `shape: document` | 同上 |
| `sumi/label` | node | `shape: text`（枠なしのテキスト）。label は必須（空または空白のみなら `component/missing-label`。D2 は Go の `unicode.IsSpace` で trim して空になるラベルの text shape を拒否する。#8） | default, muted |
| `sumi/container` | group | コンテナ（`shape: rectangle`） | default, muted |
| `sumi/arrow` | edge | `->`、target-arrowhead `triangle` | default, dashed, emphasis, muted |
| `sumi/line` | edge | `--`（矢尻なし） | 同上 |
| `sumi/double-arrow` | edge | `<->`、両端 `triangle` | 同上 |

- #10 で確認: 上表の lowering はすべて D2 の標準 shape（`rectangle` / `square` / `circle` / `oval` / `diamond` / `hexagon` / `parallelogram` / `cylinder` / `document` / `text`）と標準の接続演算子・矢尻だけで表せ、表との差異はない。全部品 × 全 variant × 組み込み Theme 2 種を D2 v0.9.0 で描画するテスト（`src/compiler/builtins-render.test.ts`）と、lowering 表・色の直書き禁止（`src/compiler` と `src/core/registry` には色を書かず、色はすべて Theme から来る）を検査するテスト（`src/compiler/builtins.test.ts`）で固定した。汎用の作例は `examples/` に置く。

- **名前解決**: 参照は短縮名（`box`）か正規 ID（`sumi/box`）。短縮名は MVP では `sumi` 名前空間にのみ解決する。外部名前空間が入った時点で、短縮名の衝突は error とする。**alias は MVP では提供しない**（Theme の適用先が曖昧になるため）。解決後は必ず正規 ID で扱い、Theme のキーも正規 ID（組み込みは短縮名で書くことを許し、読み込み時に正規化する）とする。
- **ports は v1 スキーマから除外する**。D2/ELK で意味的なポートや辺の向きを保証できないことをスパイクで確認したため。必要になったら manifest と Figure に互換的な追加として入れる。
- **Registry API**: `register(manifest)`（manifest の検証と ID 衝突の検出）、`resolve(ref, kind)`、`list({ kind? })`、`validateUsage(manifest, { props, variant })`。いずれも同期関数で副作用を持たない（register はインスタンス内の状態のみ変更する）。

## 4. Theme と style 解決（#6）

### 4.1 実効スタイル（ResolvedStyle）
Sumi が公開するスタイルプロパティは、D2 で表現できるものだけに限定する。長さは pt で指定し、§5 の k = 0.5 で D2 unit（整数）に変換する。**0.5pt 刻みで表せない値は丸めずに error とする**（`theme/unrepresentable-value`）。

| prop | 対象 kind | 型・範囲（pt） | D2 |
|---|---|---|---|
| `fill` | node, group | `#rrggbb` / `#rgb` / `transparent` | `style.fill` |
| `stroke` | 全部 | 色 | `style.stroke` |
| `strokeWidth` | 全部 | 0–7.5（0.5 刻み） | `style.stroke-width`（×2） |
| `strokeDash` | 全部 | 整数 0–10（段階値。実長ではない） | `style.stroke-dash` |
| `radius` | node, group | 0 以上（0.5 刻み） | `style.border-radius`（×2） |
| `opacity` | 全部 | 0–1 | `style.opacity` |
| `fontSize` | 全部 | 4–50（0.5 刻み） | `style.font-size`（×2） |
| `fontColor` | 全部 | 色 | `style.font-color` |
| `bold` / `italic` | 全部 | bool | `style.bold` / `style.italic` |
| `mono` | 全部 | bool | `style.font: mono` |
| `filled` | edge | bool（矢尻の塗り） | arrowhead の `style.filled` |

- `shadow`、`3d`、`multiple`、`double-border` は公開しない（形状ごとの制約と固定オフセットがあるため）。
- 対象外の kind に指定されたプロパティ（edge の `fill` 等）は Theme 読み込み時に error（`theme/inapplicable-property`）。
- 色は `rgb()` を受け付けない（D2 が拒否する）。Theme 側で `#hex` に正規化する。

### 4.2 フォント
- D2 で要素ごとに指定できるのは mono・太字・斜体だけで、書体（family）は図全体の設定になる。そのため**フォントは Theme 単位の「フォントセット」**とし、要素ごとの `fontFamily` は提供しない。
- フォントセットは次の slot を持つ。D2 の既定フォントが決して使われないよう、レンダリング時は **8 つの `--font-*` フラグを常にすべて指定**する。

| slot | 必須 | 渡すフラグ | slot が欠けた場合の扱い |
|---|---|---|---|
| `regular` | ✓ | `--font-regular` | — |
| `bold` | ✓ | `--font-bold`、`--font-semibold` | — |
| `italic` | | `--font-italic` | `regular` のファイルを渡す。ただし Theme で `italic: true` を使えば error（`theme/missing-font`） |
| `mono` | | `--font-mono`、`--font-mono-bold`、`--font-mono-italic`、`--font-mono-semibold` | `regular` のファイルを渡す。ただし Theme で `mono: true` を使えば error（`theme/missing-font`） |

- `bold` と `italic` を同時に true にする組み合わせは、D2 に bold-italic のフラグがないため error（`theme/unsupported-font-combination`）とする。
- **字形の不足**: ラベルの文字がフォントセットに含まれない場合は `lint/missing-glyph`（warning）を出す。TTF の cmap を読んで判定する。描画前に検査できるため、構造 lint（#12）の範囲とする。
- 日本語ラベルを想定し、組み込みのフォントセットには **CJK を含む OFL ライセンスの TTF** を同梱する。#6 で **`sumi/biz-ud-gothic`**（BIZ UDPGothic Regular / Bold ＋ mono に BIZ UDGothic Regular、v1.051、計約 14MB、italic なし）に確定した（§4.4）。D2 の既定フォントは CJK を持たず、閲覧環境で表示が変わるため使わない。
- 既知の制約として記録する: D2 は shape ラベルを常に bold で計測し、CJK の幅を約 25% 大きく見積もる。そのためノードは実際の文字より広くなる（はみ出しは起きない）。

### 4.3 Theme の形式と解決順
```yaml
version: 1
id: minimal
fonts: sumi/biz-ud-gothic         # 組み込みフォントセット ID
tokens:                            # 葉の型: color | length(pt) | number | boolean
  color: { fg: "#1f2328", bg: "#ffffff", muted: "#6e7781", surface: "#f6f8fa" }
  size:  { text: 8pt, small: 7pt, heading: 9pt }
  line:  { regular: 1pt, bold: 1.5pt }
base:                              # kind ごとの完全な既定（全プロパティを埋める）
  node:  { fill: "{color.bg}", stroke: "{color.fg}", strokeWidth: "{line.regular}", radius: 0pt, fontSize: "{size.text}", fontColor: "{color.fg}", bold: false, italic: false, mono: false, strokeDash: 0, opacity: 1 }
  group: { fill: "{color.surface}", stroke: "{color.muted}", ... }
  edge:  { stroke: "{color.fg}", strokeWidth: "{line.regular}", fontSize: "{size.small}", ... , filled: true }
components:
  sumi/box:
    emphasis: { strokeWidth: "{line.bold}" }
    muted:    { fontColor: "{color.muted}", stroke: "{color.muted}" }
  sumi/arrow:
    dashed:   { strokeDash: 4 }
```
- **入力と解決結果の区別**: Theme の `base` と `components` はいずれも**部分指定**でよい（上の例の `...` は省略を意味する）。完全になるのは解決後の `ResolvedStyle` だけである。
- **Sumi 組み込みの kind 既定値**（Theme に依存しない最下層。全プロパティを埋める）:

| kind | fill | stroke | strokeWidth | strokeDash | radius | opacity | fontSize | fontColor | bold | italic | mono | filled |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| node | `#ffffff` | `#000000` | 1pt | 0 | 0pt | 1 | 8pt | `#000000` | false | false | false | — |
| group | `transparent` | `#000000` | 1pt | 0 | 0pt | 1 | 9pt | `#000000` | true | false | false | — |
| edge | — | `#000000` | 1pt | 0 | — | 1 | 7pt | `#000000` | false | false | false | true |

- **token の葉の型判定**（機械的に判定できる規則）:
  - YAML の数値 → `number`
  - YAML の真偽値 → `boolean`
  - `^-?\d+(\.\d+)?(pt|mm|cm|in)$` に一致する文字列 → `length`（pt に正規化）
  - `^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$` または `transparent` に一致する文字列 → `color`
  - フォントセット ID（`<namespace>/<name>`）は token にせず、`fonts` フィールドでのみ指定する
  - それ以外の文字列は `theme/invalid-token`（error）
- **プロパティが期待する型**:
  - `length`: strokeWidth / radius / fontSize
  - `color`: fill / stroke / fontColor
  - `number`: strokeDash / opacity
  - `boolean`: bold / italic / mono / filled
- 適用順: **Sumi 組み込みの kind 既定（全プロパティ）→ Theme `base.<kind>` → Theme `components.<正規ID>.default` → `components.<正規ID>.<variant>`**。プロパティ単位で後勝ち。Sumi の組み込み既定も全プロパティを持つので、D2 自身のテーマや既定値には依存しない（コンパイラは全要素に実効スタイルを明示的に出力する）。
- token 参照は `{a.b}` 形式。token 同士の参照も可で、循環は `theme/token-cycle`。プロパティの期待型と token の葉型が合わなければ `theme/type-mismatch`。
- variant の扱い: manifest にない variant は `component/unknown-variant`（error）。manifest にはあるが Theme に定義がない variant は `default` を使い、`theme/missing-variant`（warning）を出す。
- **Figure 側からのスタイル直接指定は v1 では提供しない**（見た目は variant で選ぶ）。
- 解決結果は全プロパティが確定した、immutable な `ResolvedStyle` とする。
- 組み込み Theme: `minimal`（モノクロ）と `academic`（論文向け）。分野固有のパレットは持たない。

### 4.4 実装で確定した事項（#6）
- **フォントセット**: `sumi/biz-ud-gothic` を同梱する（`assets/fonts/biz-ud-gothic/`。出典・版・sha256 は同ディレクトリの README）。Noto Sans JP は google/fonts では可変 TTF のみ、noto-cjk の公式配布は OTF / OTC（CFF）で、D2 が受け付ける静的 TTF の公式配布がないため、静的 TTF を公式リリースで配布している BIZ UD ゴシックを採用した。D2 v0.9.0 で 8 つの `--font-*` をすべて指定し、日本語＋英字のラベルが WOFF subset として `@font-face` に埋め込まれることを確認済み。フォントのパスはソースからの相対で解決する（`bun build --compile` での同梱は配布の Issue で扱う）。
- **ResolvedStyle**: kind を判別子に持つ（`{ kind: "node" | "group" | "edge", ... }`）。長さは `{ pt, units }`（`units` は D2 の整数 unit、`pt = units × 0.5`）。色は小文字に正規化する（`#rgb` は短縮形のまま）。オブジェクトは freeze する。
- **Theme の検証**: 構造（strict object、`version`、未知フィールド）の error がある場合は、token・値の意味的な検査を行わない。Theme 定義内の未知 variant は `theme/unknown-variant`（Figure 側の `component/unknown-variant` とは別）。
- **値の誤り**: プロパティに直接書いた不正なリテラルも token と同じ規則で判定し、`theme/invalid-token` とする。値域外は `theme/out-of-range`、0.5pt 刻みでない長さは `theme/unrepresentable-value`（最も近い表現可能な値を hint に出す。丸めない）。
- **bold と italic の同時指定**は、層をまたいで合成した結果で判定する（kind ごとの base、Theme に書かれた各部品の default と各 variant）。error は両者のいずれかを true にした最も具体的な層に付ける。
- **theme/missing-variant**（warning）は `theme` 段で Figure の要素の `variant` の位置に出す。組み込み Theme は全組み込み部品の全 variant を定義する。
- **診断コード**（stage `theme`）: `theme/unknown`、`theme/unknown-font-set`、`theme/unknown-field`、`theme/missing-field`、`theme/invalid-type`、`theme/invalid-value`、`theme/unsupported-version`、`theme/unknown-property`、`theme/inapplicable-property`、`theme/unknown-component`、`theme/duplicate-component`、`theme/unknown-variant`、`theme/invalid-token`、`theme/unknown-token`、`theme/token-cycle`、`theme/type-mismatch`、`theme/out-of-range`、`theme/unrepresentable-value`、`theme/missing-font`、`theme/unsupported-font-combination`、`theme/missing-variant`（warning）。

## 5. Output Profile と物理サイズ（#7）

### 5.1 単位とスケール
- **1 D2 unit = 0.5pt（k = 0.5）** に固定する。D2 の整数制約のもとで 0.5pt 刻みの表現力を得られ、D2 の既定比率（文字 16 unit = 8pt、線 2 unit = 1pt）もそのまま保てる。
- 入力単位は `mm` / `cm` / `in` / `pt` を受け付け、内部では pt に正規化する（1in = 72pt = 25.4mm）。`px` は曖昧なので受け付けない。
- 出力 SVG: D2 の root `<svg>` の viewBox（W × H unit）は変更せず、`width="{W·0.5}pt" height="{H·0.5}pt"` を付ける（#11）。後から一律に縮小することはしない。

### 5.2 Profile の形式
```yaml
version: 1
id: paper-single
description: Single-column figure in a two-column paper
page:
  maxWidth: 88mm        # 余白込みの出力幅の上限
  maxHeight: 120mm      # 任意
margin: 2mm             # 内容境界の外側の余白（D2 の --pad として渡す。stroke のはみ出しは D2 が境界に含める）
typography:
  minFontSize: 7pt
layout:
  layerGap: 10mm        # ELK: nodeNodeBetweenLayers = layerGap、edgeNodeBetweenLayers = layerGap / 2
  containerPadding: 4mm # ELK: --elk-padding（上側はラベル分を D2 が強制する）
```
- **Profile の値から D2 引数への変換**:
  - 長さはすべて「入力単位 → pt → D2 unit（= pt × 2）」の順に変換する。
  - レイアウト用の値（D2 は整数しか受け付けない）は、**最も近い整数 unit に丸める**（0.5 は切り上げ）。丸め誤差は最大 0.25pt で、レイアウトのヒントとしては無視できる。丸めた実効値は render の成果物（`args`）に記録する。
  - 見た目に関わる Theme の値（§4.1）は、丸めずに error とする。この違いは意図的なもの。
  - ページの上限（`maxWidth` / `maxHeight`）と最小文字サイズは量子化せず、物理量（pt の実数）のまま比較する。

| Profile 項目 | 例 | unit | CLI 引数 |
|---|---|---|---|
| `margin` | 2mm = 5.669pt | 11.34 → **11** | `--pad 11` |
| `layout.layerGap` | 10mm = 28.35pt | 56.69 → **57** | `--elk-nodeNodeBetweenLayers 57`、`--elk-edgeNodeBetweenLayers 29`（= round(57 / 2)） |
| `layout.containerPadding` | 4mm = 11.34pt | 22.68 → **23** | `--elk-padding "[top=23,left=23,bottom=23,right=23]"`（top はラベル分を D2 が拡張する） |
| `page.maxWidth` | 88mm = 249.45pt | 量子化しない | 使わない（geometry lint で比較） |
| `typography.minFontSize` | 7pt | 量子化しない | 使わない（profile 段で比較） |

  - 引数の型（いずれも整数、`--elk-padding` は `[top=N,left=N,bottom=N,right=N]` の文字列）は D2 v0.9.0 で確認済み（#9 のスパイク）。
- **D2/ELK で実現できない項目は持たない**: 同じ層の中の間隔は D2 v0.9 では 20 unit（10pt）固定であり、設定できないことを Profile 仕様に明記する。
- 出力サイズの算出: 出力幅 = (D2 の viewBox 幅) × 0.5pt。viewBox は内容の境界と `--pad` を含む。これが `page.maxWidth` を超えたら縮小せず、`geometry/exceeds-page-width`（error）を出す。`maxHeight` も同様。
- 事前検査（stage `profile`）: 図中で実際に使われる要素の実効 `fontSize` が `minFontSize` 未満なら `profile/font-too-small`（error）。Theme だけを変えても Profile の制約は変わらない。「実際に使われる」は**ラベルが空でない要素**とする（ラベルのない要素は文字を描かないため。#6 で確定）。
- 組み込み Profile:
  - `paper-single`: maxWidth 88mm, minFontSize 7pt
  - `paper-double`: maxWidth 180mm, minFontSize 7pt
  - `presentation-16x9`: maxWidth 338.7mm, maxHeight 190.5mm, minFontSize 14pt（固定キャンバスへの配置は MVP 外。上限としてのみ扱う）
- 自動再配置（方向を変えて試すなど）は段階的に導入する。MVP は診断のみ。

## 6. #8〜#13 に引き継ぐ契約

- **Figure IR（#8）**: 正規化済みの node / group / edge、グループ木、正規部品 ID、ResolvedStyle、内部 D2 key、元の `DocPath` / `SourceLocation`（source map）を持つ。
- **D2 生成（#8）**: 全要素について shape・label（クォート / エスケープ済み）・class・実効スタイルを明示的に出力する。ELK 指定は D2 ソースではなく CLI フラグで渡す（d2-config では ELK のオプションを指定できないため）。
- **Backend（#9）**: D2 CLI v0.9.0 を sha256 付きで固定する。引数は `--layout elk --pad <margin> --elk-* --font-* --omit-version`。成果物は `{ svg: string; d2Source: string; backend: { name: "d2-cli"; version: string }; fontSetId; args }`。D2.js（WASM）は、v0.9 系が npm に出た時点で再評価する（現行の 0.1.33 は v0.7 系で、出力が CLI と一致しない）。
- **SVG（#11）**: 依存してよい構造は、root `<svg>` → 単一の `svg.d2-svg`（transform なし）、`<g class="… sumi-k-… sumi-kind-…">`、`g.shape` / `text` / `path.connection`、user unit の座標、同じバージョン内での決定性。依存してはいけないのは `d2-<hash>`、数値書式、エッジ経路の細部、font subset。SVG を解析して geometry を抽出する API を #11 で提供する。
  ```ts
  interface ElementGeometry {
    key: ElementKey;                 // §2.4。class `sumi-k-*` から逆引きする
    kind: "node" | "group" | "edge";
    bbox?: Rect;                     // node / group: g.shape の図形自体の外接矩形（stroke 幅は含めない）
    labels: { text: string; anchor: Point; fontSizeUnits: number; lines: number }[];
                                     // text 要素の x（中心）、y（ベースライン）、font-size をそのまま記録する。
                                     // ラベルの外接矩形は #13 がフォントセットで再計測して求める
    path?: PathSegment[];            // edge: path.connection の d を絶対座標の M/L/C 列に正規化したもの
  }
  ```
  - 座標系は `svg.d2-svg` の user unit（= D2 unit、1 unit = 0.5pt）とする。pt や mm への換算は helper で行う。
- **Geometry lint（#13）**: 入力は geometry ＋ ResolvedStyle ＋ フォントセット。ラベル幅は同じ TTF で再計測する（D2 の bold 計測・CJK の過大見積もりを考慮）。ルール候補: ページ幅・高さの超過、明示サイズでのラベルはみ出し、祖先→子孫エッジがラベルを横切るケース、要素の重なり。
- **キャッシュ / ゴールデンのキー**: (D2 ソース, D2 バージョン, フォントセットの hash, CLI 引数)。

### 6.1 実装で確定した事項（#8）
- **API**: `compileFigure(text, opts): Result<CompiledFigure>`（`src/compiler`）。`checkFigure()` に error がなければ `buildFigureIR()` → `generateD2()` を実行する。`CompiledFigure = { ir, d2Source, layout: toD2LayoutArgs(profile), fontSet: { id, args: fontSetArgs(...) }, sourceMap }`。I/O も D2 CLI も使わない純関数である。
- **IR**: freeze 済み（`elements` と `sourceMap` は内部の Map を露出しない読み取り専用ビュー）。要素は groups / nodes / edges を文書順に持ち、`elements`（ElementKey → 要素）、`roots`（root 直下の group → node）、group の `children`（子 group → 子 node、各文書順）、`d2Path`、明示サイズ（`{ pt, units }`）、ResolvedStyle、edge の `sourceArrowhead` / `targetArrowhead`（方向で矢尻を持つ端だけ。manifest で未指定なら `triangle`）を持つ。source map は ElementKey → `{ path, location }`。
- **D2 の key は常にダブルクォートする**（`"g_backend"."n_api"`）。ID に `-` を含められるため。未クォートの `n_a--b` は edge として解釈され、`n_x-` も壊れる（D2 v0.9.0 で確認）。
- **文字列のエスケープ**（D2 v0.9.0 で確認）: ダブルクォート内で `\` → `\\`、`"` → `\"`、`$` → `\$`（未エスケープの `$` は置換の開始と解釈され、`${...}` は変数置換、それ以外は `substitutions must begin on {` でコンパイルエラーになる）、改行（`\r\n` / `\r` / `\n`）→ `\n`、タブ → `\t`。その他の制御文字は U+FFFD に置き換える（D2 自身もそう描画する）。`\u` エスケープは D2 での解釈が一貫しないため使わない。`#` `.` `:` `;` `{}` `[]` `|` `->` 等はクォート内ではそのまま安全。`"null"` などもクォートすれば文字列になる。
- **class** は `class: ["sumi-k-<enc>"; "sumi-kind-<kind>"]`（配列）で付け、SVG の `<g class>` に D2 の base64 class に続けて追記される。
- **arrowhead**: 矢尻を持つ端にだけ `source-arrowhead` / `target-arrowhead` を `{ shape; style.filled }` で出力する（`->` の source 側などに指定しても D2 は描画しない）。
- 生成結果は `d2 fmt` を通しても変わらない形式で出力する（テストで検査）。
- 既知の制約: D2 v0.9.0 は要素 0 件の図に対して exit 0 のまま SVG を出力しない（backend では `backend/empty-output`）。#11 では `renderFigure()` が D2 を呼ぶ前に `svg/empty-figure`（error）を返す（§6.2）。

### 6.2 実装で確定した事項（#11）
- **API**（`src/render`）:
  - `finalizeSvg(artifact, compiled, { source }): Result<{ svg, metadata, widthPt, heightPt }>` — D2 の SVG を Sumi の成果物に仕上げる。
  - `inspectSvg(svg, ir): Result<SvgInspection>` — 生の SVG と仕上げ後の SVG のどちらも受け付ける。
  - `renderFigure(text, opts): Promise<Result<{ svg, metadata, inspection, compiled, artifact }>>` — compile → backend.render → finalize → inspect を順に実行する。各段の warning も含めて diagnostics を返す。`opts.backend` の既定は D2 CLI backend。
  - `readSvgMetadata(svg)`、`parsePath(d)`、`decodeElementClass(class)`、`unitsToPt` / `unitsToMm` / `toSize` も公開する。
- **XML parser**: 依存ライブラリを追加せず、`src/render/xml.ts` に最小の厳格な parser を実装した。理由は次のとおり。
  1. DTD（`<!DOCTYPE`）とマークアップ宣言を構文として受け付けないため、XXE や entity 展開攻撃（billion laughs）が原理的に起きない。entity は定義済みの 5 つと数値文字参照だけを展開し、それ以外は error とする。`<?xml?>` 宣言以外の処理命令（`<?xml-stylesheet?>` 等）も拒否する。
  2. 要素ごとに元テキスト上の offset を記録する。これにより、再直列化せずに root の開始タグだけを差し替えられる（非破壊の後処理）。
  3. 入力は固定版の D2 が生成する SVG だけなので、汎用 parser の機能（名前空間解決、DTD、エンコーディング変換）は不要。依存を増やさず、`bun build --compile` にも影響しない。
  - 走査は再帰しない（深いネストでもスタックが溢れない）。不正な XML は行・列付きで `svg/invalid` とする。
- **仕上げ（finalize）**: root `<svg>` の開始タグに `width="{W·0.5}pt" height="{H·0.5}pt"` を追加し、直後に `<metadata>` を挿入する。それ以外の D2 の出力はバイト単位でそのまま残す（root 開始タグ内の属性は、元の順序のまま正規の空白で再出力する）。viewBox は変更せず、縮小もしない。数値は指数表記を使わず、小数点以下は最大 6 桁とする。
- **メタデータの形式**（決定的。時刻や絶対パスは含めない）:
  ```xml
  <metadata><sumi:render xmlns:sumi="https://github.com/nishide-dev/sumi-diagram/ns/svg-metadata/1"
    format="1" sumi-version="…" backend="d2-cli" backend-version="0.9.0" figure-id="…" theme="…"
    profile="…" font-set="sumi/biz-ud-gothic" input-sha256="<YAML の sha256>" d2-sha256="<D2 ソースの sha256>"/></metadata>
  ```
  - CLI 引数（`args`）はフォントの絶対パスを含み、マシンごとに変わるため記録しない（再現に必要な情報は D2 ソースの hash、D2 のバージョン、フォントセット ID で足りる）。
- **フォントの検査**: `<text>` が使うフォント class（`text`、`text-bold`、`text-mono-italic` 等）ごとに、CSS 規則で対応する font-family が `@font-face`（`data:` URL）として埋め込まれていることを確認する。欠けていれば `svg/missing-font-face` を **error** とする。閲覧環境のフォントで描画が変わり、§4.2 の前提（D2 の既定フォントも閲覧側のフォントも使わない）が崩れるため。文字を含まない図には D2 がフォントを埋め込まないので、検査しない。
- **空の図**: node も group もない図（edge は端点が必要なので、要素 0 件と同じ）は、`renderFigure()` が D2 を呼ぶ前に `svg/empty-figure`（error、hint 付き）を返す。D2 v0.9.0 はこの場合に SVG を書かないため、空のキャンバスを Sumi が作ることはしない（大きさや余白の根拠がないため）。stage 名は §0 の一覧に合わせて `svg` とした（`render/` という stage は作らない）。
- **inspection**:
  - 要素の識別は `sumi-k-*` class を ElementKey に戻して行う（§2.4 の逆変換。`sumi-k-e--_<n>` → `e:#<n>`）。IR の各要素がちょうど 1 回現れることを検査する（`svg/missing-element` / `svg/duplicate-element`、要素の source 位置付き）。IR にない key、復号できない class、`sumi-kind-*` の不一致は `svg/unknown-element`。
  - bbox は `g.shape` 内の `rect` / `ellipse` / `circle` / `polygon` / `polyline` / `line` / `path` の図形そのものの外接矩形とする（stroke は含めない。cubic は極値まで含めた厳密な範囲）。D2 v0.9.0 が 14 の組み込み部品で出力するのは `rect`（box・square・container）、`ellipse`（circle・ellipse）、`path`（diamond・hexagon・parallelogram・cylinder・document）。`sumi/label`（`shape: text`）は D2 が図形を描かないため、bbox を持たない（`undefined`）。
  - path は M / L / C の絶対座標列に正規化する。D2 v0.9.0 が出力するのは `M L C S V Z`（edge の角は `S`、cylinder は `V`）。他に `H` / 相対形 / `Q` / `T` も厳密に変換できるので受け付ける。円弧（`A`）は近似になるため受け付けない。`transform` や未知の図形要素も推測せず、`svg/unsupported-geometry`（error）とする。
  - label は `<text>` ごとに、テキスト（`<tspan>` は改行でつなぐ）、anchor（x = 中心、y = 1 行目のベースライン。`text-anchor: middle` 以外は unsupported）、font-size（unit）、行数、フォント class（`regular` / `bold` / `mono-italic` 等。#13 での再計測に使う）を記録する。
  - キャンバスは、要素の座標と同じ座標系（`svg.d2-svg` の viewBox）で返し、大きさを units・pt・mm で添える。D2 は内側の viewBox の原点をずらすことがある（例: `1 0 W H`）が、大きさは root の viewBox と一致する（一致しなければ `svg/invalid`）。#13 用に、Profile の上限を量子化しない pt で添える（`profile: { id, maxWidthPt?, maxHeightPt?, minFontSizePt }`）。比較と診断は #13 で行う。
- **診断コード**（stage `svg`）: `svg/invalid`、`svg/empty`、`svg/empty-figure`、`svg/missing-font-face`、`svg/missing-element`、`svg/duplicate-element`、`svg/unknown-element`、`svg/unsupported-geometry`、`svg/artifact-mismatch`（artifact の D2 ソースまたはフォントセットが compile 結果と一致しない）。いずれも error。
- **観察（#13 への引き継ぎ）**: ELK は次数に応じてノードを拡大するため、`circle` でも縦横比が 1:1 にならないことがある（自己ループのある circle が `rx=35 ry=80` の ellipse になった）。bbox は描画どおりに返す。
- `scripts/render-example.ts`（`bun run example:render`。#10 で暫定的に width / height を自前で付けていた）は `renderFigure()` を使うよう切り替えた。width / height とメタデータの実装は `finalizeSvg()` の 1 か所だけになる。`examples/` の SVG はこの経路で再生成し、golden 比較のテストでメタデータの input hash も検査する。入力 YAML の hash がプラットフォームで変わらないよう、`.gitattributes` で `*.sumi.yaml` を `eol=lf` に固定した。
- 実際の D2 を使う統合テスト（`src/render/render.integration.test.ts`）で、全 fixture について次を固定している: 幅・高さ = viewBox × 0.5pt、全要素がちょうど 1 回、子の bbox が親 group の bbox に含まれる、label の anchor が図形の内側にある、edge の端点が両端の要素の近く（12 unit 以内）にある、出力がバイト単位で決定的、メタデータの内容。

### 6.2 実装で確定した事項（#12）
- **API**: `lintFigure(text, { file?, registry?, config?, rules? }): LintReport`（`src/lint`）。`checkFigure()` の後に構造 lint（stage `lint`、`runLintRules()`）を実行する。D2 も描画も使わない。`LintReport = { file?, diagnostics, summary: { errors, warnings, infos }, exitCode: 0 | 1 }`。規則・設定・出力形式・終了コードの一覧は [docs/lint-rules.md](../lint-rules.md)。
- **規則の枠組み**: 規則は `{ id: "lint/<rule>", description, defaultSeverity, fixable: false, options?: Zod, run(context, options) }`。`context.elements` には `invalid` でない要素だけを入れる（解決済みの部品・スタイル付き）。規則は位置情報を持たない finding（`message`・`path`・`subject`・`hint`・`related`）を返し、枠組みが code・設定後の severity・`SourceLocation` を付ける。
- **設定**: `{ rules?: { [id]: "off" | Severity | { level?, options? } }, maxWarnings? }`。対象は `lint/*` だけ。不正な設定は図の診断ではなく `LintConfigError`（CLI では exit 2）とする。Figure Schema に図ごとの抑制フィールドは追加しない（必要になれば別途提案する）。
- **終了コード**: 0 = error なし（かつ warning が `maxWarnings` 以下）、1 = error あり、または warning が `maxWarnings` 超、2 = 使い方の誤り・内部エラー（`lintFigure()` は返さない）。
- **非推奨の部品**: `component/deprecated`（stage `component`、warning）で報告済みのため、`lint/deprecated-component` は設けない。
- **`lint/self-loop` は info**、`lint/duplicate-edge` は warning とした。自己ループと多重エッジは §2.2 で有効と定めたため、意図しない可能性を知らせるだけにとどめる。多重エッジは「端点・部品・ラベルがすべて同じ」場合だけを重複とする（ラベルの違う多重エッジは正当な用途がある）。
- **`lint/no-edges` は error のないノード 2 つ以上**のときだけ出す（ノード 1 つの図ではエッジを引けないため。error のあるノードは数えない）。
- **`lint/missing-glyph`**: 依存ライブラリは追加せず、TTF の `cmap`（format 4 / 12）を読む最小のリーダーを実装した（`src/lint/cmap.ts`。読み取りはテーブル / サブテーブルの宣言範囲内に限り、segment / group の昇順・非重複・値域を検査し、カバー範囲は区間の二分探索で持つ）。同梱フォントの判定結果が fontconfig（`fc-query`）と一致すること（3 ファイルとも 11741 code point）を確認済み。
- **ラベルの長さ**は、書記素クラスタ単位で East Asian Wide / Fullwidth と絵文字（keycap 列を含む）を 2 桁と数える表示幅で測る（既定は 1 行 40 桁、4 行まで）。

## 7. 実装順
1. #4: Diagnostic・Result 型、位置付き YAML 解析、Figure Schema（Zod）＋ JSON Schema 生成、参照検証（重複 ID・未知の端点 / グループ・グループの循環）、fixtures
2. #5 / #6 / #7（#4 の後に並行可能）
   - #5: manifest の型と検証、Registry、テスト用の最小 manifest
   - #6: Theme の形式、token 解決、style のマージ、量子化と値域の検査、フォントセットの同梱
   - #7: 単位パーサ、Profile の形式、組み込み Profile、事前検査
