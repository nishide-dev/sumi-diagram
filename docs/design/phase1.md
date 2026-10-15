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
| `fill` | 全部（edge ではラベルの背景。#31） | `#rrggbb` / `#rgb` / `transparent` | `style.fill` |
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
- 対象外の kind に指定されたプロパティ（edge の `radius` 等）は Theme 読み込み時に error（`theme/inapplicable-property`）。
- edge の `fill` は、D2 の connection の `style.fill` と同じく**ラベルの背景**になる。D2 はラベルのあるエッジにだけ、ラベルより少し大きい角丸の矩形（`rx=10`）を描く（§6.6）。`transparent` なら背景を描かない。
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
| edge | `#ffffff`（ラベルの背景） | `#000000` | 1pt | 0 | — | 1 | 7pt | `#000000` | false | false | false | true |

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
- 組み込み Theme: `minimal`（モノクロ）、`academic`（論文向け）、`slides`（スライド向け。#36 で追加、§6.9）。分野固有のパレットは持たない。

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
  maxHeight: 220mm      # 任意
margin: 2mm             # 内容境界の外側の余白（D2 の --pad として渡す。stroke のはみ出しは D2 が境界に含める）
typography:
  minFontSize: 7pt
layout:
  layerGap: 8mm         # ELK: nodeNodeBetweenLayers = layerGap、edgeNodeBetweenLayers = layerGap / 2
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
| `layout.layerGap` | 8mm = 22.68pt | 45.35 → **45** | `--elk-nodeNodeBetweenLayers 45`、`--elk-edgeNodeBetweenLayers 23`（= round(45 / 2)。22.5 は切り上げ） |
| `layout.containerPadding` | 4mm = 11.34pt | 22.68 → **23** | `--elk-padding "[top=23,left=23,bottom=23,right=23]"`（top はラベル分を D2 が拡張する） |
| `page.maxWidth` | 88mm = 249.45pt | 量子化しない | 使わない（geometry lint で比較） |
| `typography.minFontSize` | 7pt | 量子化しない | 使わない（profile 段で比較） |

  - 引数の型（いずれも整数、`--elk-padding` は `[top=N,left=N,bottom=N,right=N]` の文字列）は D2 v0.9.0 で確認済み（#9 のスパイク）。
- **D2/ELK で実現できない項目は持たない**: 同じ層の中の間隔は D2 v0.9 では 20 unit（10pt）固定であり、設定できないことを Profile 仕様に明記する。
- 出力サイズの算出: 出力幅 = (D2 の viewBox 幅) × 0.5pt。viewBox は内容の境界と `--pad` を含む。これが `page.maxWidth` を超えたら縮小せず、`geometry/exceeds-page-width`（error）を出す。`maxHeight` も同様。
- 事前検査（stage `profile`）: 図中で実際に使われる要素の実効 `fontSize` が `minFontSize` 未満なら `profile/font-too-small`（error）。Theme だけを変えても Profile の制約は変わらない。「実際に使われる」は**ラベルが空でない要素**とする（ラベルのない要素は文字を描かないため。#6 で確定）。
- 組み込み Profile:
  - `paper-single`: maxWidth 88mm, maxHeight 220mm, minFontSize 7pt
  - `paper-double`: maxWidth 180mm, maxHeight 220mm, minFontSize 7pt
  - `presentation-16x9`: maxWidth 338.7mm, maxHeight 190.5mm, minFontSize 14pt（固定キャンバスへの配置は MVP 外。上限としてのみ扱う）。組み込み Theme では `slides` だけがこの最小文字サイズを満たす（§6.9）
  - 間隔: paper 系は margin 2mm、layerGap 8mm、containerPadding 4mm。presentation は paper 系の 2 倍（4mm、16mm、8mm）。maxHeight と layerGap は #31 で決めた（§6.6）。
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
- 既知の制約: D2 v0.9.0 は要素 0 件の図に対して exit 0 のまま SVG を出力しない（backend では `backend/empty-output`）。#11 では `renderFigure()` が D2 を呼ぶ前に `svg/empty-figure`（error）を返す（§6.3）。

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

### 6.3 実装で確定した事項（#11）
- **API**（`src/render`）:
  - `finalizeSvg(artifact, compiled, { source }): Result<{ svg, metadata, widthPt, heightPt }>` — D2 の SVG を Sumi の成果物に仕上げる。
  - `inspectSvg(svg, ir): Result<SvgInspection>` — 生の SVG と仕上げ後の SVG のどちらも受け付ける。
  - `renderFigure(text, opts): Promise<Result<{ svg, metadata, inspection, compiled, artifact }>>` — compile → backend.render → finalize → inspect を順に実行する。各段の warning も含めて diagnostics を返す。`opts.backend` の既定は D2 CLI backend。
  - `readSvgMetadata(svg)`、`parsePath(d)`、`decodeElementClass(class)`、`unitsToPt` / `unitsToMm` / `toSize` も公開する。
- **XML parser**: 依存ライブラリを追加せず、`src/render/xml.ts` に最小の厳格な parser を実装した。理由は次のとおり。
  1. DTD（`<!DOCTYPE`）とマークアップ宣言を構文として受け付けないため、XXE や entity 展開攻撃（billion laughs）が原理的に起きない。entity は定義済みの 5 つと数値文字参照だけを展開し、それ以外は error とする。`<?xml?>` 宣言以外の処理命令（`<?xml-stylesheet?>` 等）も拒否する。
  2. 要素ごとに元テキスト上の offset を記録する。これにより、再直列化せずに root の開始タグだけを差し替えられる（非破壊の後処理）。
  3. 入力は固定版の D2 が生成する SVG だけなので、汎用 parser の機能（名前空間解決、DTD、エンコーディング変換）は不要。依存を増やさず、`bun build --compile` にも影響しない。
  - entity 名は `Map` で引く（`&constructor;` や `&__proto__;` が prototype 経由で解決されない）。XML 1.0 の `Char` に含まれない生の文字（tab / LF / CR 以外の C0 制御文字、対になっていないサロゲート、U+FFFE / U+FFFF）は、テキスト・属性値・CDATA・コメントのどこにあっても、code point 単位で走査して拒否する。
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
  - path は M / L / C の絶対座標列に正規化する。D2 v0.9.0 が出力するのは `M L C S V Z`（edge の角は `S`、cylinder は `V`）。他に `H` / 相対形 / `Q` / `T` も厳密に変換できるので受け付ける。円弧（`A`）は近似になるため受け付けない。範囲外の数値や、相対座標・反射・次数上げの計算で生じた非有限値も拒否する。`transform` は、計測する要素（図形、`g.shape`、`path.connection`、`text`）とその祖先（要素の `g`、`svg.d2-svg`、root `<svg>`）のどこにあっても推測せず、`svg/unsupported-geometry`（error）とする。`svg.d2-svg` の 0 でない `x` / `y` も同様に扱う。未知の図形要素も同じ。
  - label は `<text>` ごとに、テキスト（`<tspan>` は改行でつなぐ）、anchor（x = 中心、y = 1 行目のベースライン。`text-anchor: middle` 以外は unsupported）、font-size（unit）、行数、フォント class（`regular` / `bold` / `mono-italic` 等。#13 での再計測に使う）と、行送り `lineHeightUnits`（#13 で追加。§6.5）を記録する。
  - キャンバスは、要素の座標と同じ座標系（`svg.d2-svg` の viewBox）で返し、大きさを units・pt・mm で添える。D2 は内側の viewBox の原点をずらすことがある（例: `1 0 W H`）が、大きさは root の viewBox と一致する（一致しなければ `svg/invalid`）。#13 用に、Profile の上限を量子化しない pt で添える（`profile: { id, maxWidthPt?, maxHeightPt?, minFontSizePt }`）。比較と診断は #13 で行う。
- **診断コード**（stage `svg`）: `svg/invalid`、`svg/empty`、`svg/empty-figure`、`svg/missing-font-face`、`svg/missing-element`、`svg/duplicate-element`、`svg/unknown-element`、`svg/unsupported-geometry`、`svg/artifact-mismatch`（artifact の D2 ソースまたはフォントセットが compile 結果と一致しない）。いずれも error。
- **観察（#13 への引き継ぎ）**: ELK は次数に応じてノードを拡大するため、`circle` でも縦横比が 1:1 にならないことがある（自己ループのある circle が `rx=35 ry=80` の ellipse になった）。bbox は描画どおりに返す。
- `scripts/render-example.ts`（`bun run example:render`。#10 で暫定的に width / height を自前で付けていた）は `renderFigure()` を使うよう切り替えた。width / height とメタデータの実装は `finalizeSvg()` の 1 か所だけになる。`examples/` の SVG はこの経路で再生成し、golden 比較のテストでメタデータの input hash も検査する。入力 YAML の hash がプラットフォームで変わらないよう、`.gitattributes` で `*.sumi.yaml` を `eol=lf` に固定した。
- 実際の D2 を使う統合テスト（`src/render/render.integration.test.ts`）で、全 fixture について次を固定している: 幅・高さ = viewBox × 0.5pt、全要素がちょうど 1 回、子の bbox が親 group の bbox に含まれる、label の anchor が図形の内側にある、edge の端点が両端の要素の近く（12 unit 以内）にある、出力がバイト単位で決定的、メタデータの内容。

### 6.4 実装で確定した事項（#14）
- **CLI の構成**: `src/cli/program.ts` の `run(argv, { stdout, stderr, cwd, env }): Promise<ExitCode>` が唯一の入口で、`process.exit` を呼ばない。bin（`src/cli/index.ts`）・テスト・`scripts/render-example.ts`（`sumi render` の別名になった）が同じ関数を使う。commander のエラーは `exitOverride` で例外として受け、exit 2 に変換する。
- **stdout / stderr**: stdout は結果（lint の報告、JSON、`fmt --stdout` の本文、`render -o -` の SVG、`Wrote …`）、stderr は成果物がファイルであるコマンド（`render`・`fmt`）の診断、使い方の誤り、ログ。`render -o -` のときは `Wrote …` も stderr に出し、stdout を SVG だけにする。
- **終了コード**（全コマンド共通）: 0 = 成功、1 = 問題あり（error、`--max-warnings` 超過、`fmt --check` で未整形、`fmt` の YAML エラー、`doctor` の必須項目の失敗）、2 = 使い方の誤り・内部エラー（不正なフラグ・設定、読めない / 書けないファイル、例外）。使い方の誤りは 1 行のメッセージだけを出し、内部エラーのスタックトレースは `SUMI_DEBUG=1` のときだけ出す。
- **色**: `--no-color` または空でない `NO_COLOR` で無効、空でなく `0` でない `FORCE_COLOR` で有効、それ以外は出力先が端末のときだけ有効。色を付けるのは severity・summary・doctor の状態だけで、JSON には付けない。
- **`render` の `--theme` / `--profile`**: `CheckFigureOptions.overrides` として、schema 検証の**後**に正規化済みの `figure.theme` / `figure.profile` を置き換える。ファイル側の値の schema エラーは元の位置で報告する。上書きしたフィールド（`["figure", "theme" | "profile"]` 以下）を指す診断・related には位置情報を付けない（ファイル中の値は使っていないため。例: `profile/font-too-small` の related「Profile … is selected here」は位置なし）。未知の名前は CLI が事前に検査し、使い方の誤り（exit 2、近い候補付き）とする。メタデータの `inputSha256` はファイルの内容の hash のままで、theme / profile は上書き後の値になる。
- **`render` の出力**: 既定の出力先は入力の `.sumi.yaml` / `.yaml` / `.yml` を `.svg` に置き換えたパス。SVG と `--emit-d2` の D2 ソースは、同じディレクトリの一時ファイルに書いてから rename する（既存ファイルのパーミッションを保つ）。`--emit-d2` は compile が成功すれば、D2 が失敗しても書く。出力先が入力ファイル、または SVG と D2 で同じファイルになる指定は、書き込む前に拒否する（exit 2）。比較はシンボリックリンクを解決した実パスで行う。存在するファイルの場合は、デバイスと inode も比べる（親ディレクトリへのリンクやハードリンクを含む）。書き込み先のディレクトリが大文字小文字を区別しない場合（macOS の既定など。一時ファイルを作って大文字の名前で引けるかで判定する）は、名前を小文字化（と Unicode 正規化）して比べる。これは事前検査の近似で、ファイルシステムの折りたたみ規則（APFS で `Σ` と `ς` が同じ名前になるなど）は再現しない。
- **出力先は 1 回だけ解決する**（`render`）: 検査時に解決した実ディレクトリとエントリ名へ書き込み、書き込み時に解決し直さない。`rename` はエントリ自体を置き換え、その間に作られたリンクをたどらない。rename の直前に、ディレクトリの実パスが変わっていないこと、そのエントリが入力ファイル（dev/ino）になっていないことを確かめ、変わっていれば書き込まずに exit 2 とする。
- **出力どうしの衝突の最終判定はファイルシステムに任せる**: 2 つ目の出力（SVG）を rename する直前に、そのエントリを lstat し、入力または 1 つ目の出力（`--emit-d2`、直前に書いたもの）と dev/ino が同じなら書き込まずに exit 2 とする。これで名前の近似では検出できない折りたたみやハードリンクも検出できる。この場合、1 つ目の出力は、この実行で新しく作ったファイルなら削除し、以前から存在したファイルなら書き込んだ内容のまま残す（元の内容には戻せないため）。削除の前に、ディレクトリの実パスが変わっていないこと、エントリが書き込み時と同じ dev/ino であることを確かめる。変わっていれば削除せず、エラーメッセージで残したことを伝える。ローカル CLI の脅威モデルとして、openat 相当の仕組みは使わない。
- **シンボリックリンクへの書き込み**（`render`・`fmt` 共通）: リンクをたどり、リンク先のファイルを、そのディレクトリの一時ファイルからの rename で置き換える。リンク自体は残す。リンク先が存在しないリンクは使い方の誤り（exit 2）とする。`--json` は lint の封筒に `output`（書いた SVG。失敗時は `null`）と `d2` を加えたもの（#37 で出力サイズの `size` も加えた。§6.10）。
- **`lint`**: 複数ファイルを受け付ける。`--json` は `{ version: 1, results: [<ファイルごとの封筒>], summary }` で、ファイル数によらず同じ形にする（ファイルごとの封筒は docs/lint-rules.md のとおり）。`--max-warnings` は全ファイルの合計で判定する（設定ファイルの `maxWarnings` も同じ）。`--config <json>` → `--rule <id>=<level>`（options は保つ）→ `--max-warnings` の順に上書きする。読めないファイルがあっても他のファイルは検査し、終了コードは 2。`--geometry` は #13 で配線した（§6.5）。
- **`fmt`**: `formatFigureSource()`（`src/core/figure/format.ts`）。`yaml` の Document API で出力し直す。変えるのはインデント（2、シーケンスもキーの下に字下げ）、`:` や `-` の後・行末コメントの前の空白（行末コメントの桁揃えは保たない）、flow collection の内側の空白（`{ a: 1 }`、`[ 1, 2 ]`）、改行コード（LF）、行末の空白、連続した空行（1 行にまとめる）、等価な plain scalar の表記（例: `0x1F` → `0x1f`）。キーの順序、scalar の引用符の種類、block scalar、flow / block の別、コメント、エントリ間の空行の有無は変えない。タグのない 1 行の引用符付き文字列は、エスケープを含めて元の文字列のまま残す（ライブラリに任せると `"\u0085"` が不可視の生の文字になるため）。明示的なタグ付きの scalar（`!!int "123"`、`!!str 123`）は、タグと値を保ったままライブラリが出力し直す（例: `!!int 123`、`!!str "123"`）。長い行は折り返さない。
  - キーの並べ替えは意味を変えないが差分が大きくなるため、`--canonical-order` を指定したときだけ行う。root・`figure`・`figure.layout`・group・node・edge の既知のキーを Figure Schema のフィールド順（Zod の shape の順）に並べ、未知のキーは元の順で後ろに置く。`props` と `metadata` は並べ替えない。エントリの前のコメントはエントリと一緒に動くが、root の先頭のコメントはファイルのヘッダとして先頭に残す。
  - YAML 段のエラー（構文、重複キー、alias、タグ、複数文書）がある文書は整形せず、診断を返す（exit 1、ファイルは変更しない）。schema 以降のエラーは整形を妨げない。
  - 安全検査: 整形結果を再度解析し、YAML エラーがないこと、データが同じであること（`--canonical-order` でなければキーの順序も同じ）、コメントの集合が同じであること、もう一度整形しても変わらないことを確かめる。満たさなければ `FormatSafetyError` で、CLI は書き込まずに exit 2 とする（formatter の不具合として扱う）。
- **`doctor`**: Sumi・Bun のバージョンとプラットフォーム、D2（探索結果・パス・バージョン・固定版との一致・導入方法）、同梱フォントの存在と sha256（`BUNDLED_FONT_SHA256`。`assets/fonts/*/README.md` の表と一致することをテストで検査）、幾何 lint の検査環境（同梱フォントの metrics を読めるか。#13 で `skipped` から変更。必須ではない）を報告する。必須項目（D2・フォント）が `error` なら exit 1。`--json` は `{ version: 1, sumi, runtime, checks: [{ id, status, required, message, hint?, details? }], ok }`。
- **`catalog`**: `--json` は `buildCatalog()` の出力そのもの（`version` 付き）。`--kind node|group|edge` で絞り込む。表は ID・KIND・VARIANTS・DESCRIPTION（非推奨の部品は説明に追記）。#37 で Theme と Profile を加えた（`buildFullCatalog()`、§6.10）。

### 6.5 実装で確定した事項（#13）
- **API**（`src/lint/geometry`）:
  - `lintRenderedFigure(text, opts): Promise<LintReport & { rendered? }>` — `lintFigure()` の全診断に加え、check 段に error がなければ `renderFigure()` で描画し、`geometry/*` の規則を実行する。`compile` / `backend` / `svg` の診断も含める（check 段の診断は重複させない）。`sumi lint --geometry`（#14）が呼ぶ。
  - `lintGeometry({ compiled, inspection }, { config?, source?, file?, fontSet? }): Diagnostic[]` — 描画済みの図（`renderFigure()` の値）に幾何の規則だけを実行する。`sumi render` が描画結果に対して呼ぶ。`source` を渡すと `props` / `label` の位置を指し、渡さなければ source map の要素の位置を使う。
  - 規則の枠組みは #12 と共有する: `defineGeometryRule()`、`GeometryRule`（`id: "geometry/<rule>"`、`run(GeometryContext, options)`）。**設定は 1 つ**で、`resolveLintConfig()` の既定の規則一覧は `ALL_LINT_RULES`（`lint/*` → `geometry/*`）。`lintFigure()` は `geometry/*` の設定を検証するだけで実行しない。
- **ブラウザを使わない計測**（Playwright / Chromium は採用しない。依存と `bun build --compile` の単一バイナリを保つため）: D2 が SVG に埋め込むのと同じ TTF（Theme のフォントセット）を読み、ラベルを再計測する。
  - TTF リーダーを拡張した: `sfnt.ts`（テーブルディレクトリと境界検査付きの reader を cmap と共有）、`cmap.ts`（code point → glyph ID。区間は glyph ID が連続する場合だけ結合する）、`metrics.ts`（`head.unitsPerEm`・`maxp.numGlyphs`・`hhea` の ascender / descender / lineGap / numberOfHMetrics・`hmtx`・任意で `OS/2` の sTypo*）。読み取りはテーブルの宣言範囲内に限り、`numberOfHMetrics` が 1〜numGlyphs の外、`hmtx` が宣言より短い、`head` の magic 不一致、`unitsPerEm` が 16〜16384 の外は `FontParseError`。numberOfHMetrics 以降の glyph は最後の advance、範囲外の glyph と未収録の文字は `.notdef` の advance（ブラウザが豆腐を描く幅）。未収録の制御文字・既定で無視される文字（ZWJ、異体字セレクタ）は幅 0。
  - **検証**: 同梱 3 ファイルの全 11741 code point の advance が fontTools（`hmtx` × `getBestCmap`）と一致した（合計 23487293 / 23507145 / 23448576 をテストに固定）。文字列の幅は FreeType（Pillow の `getlength`、2048px）と一致した（例: "Hello World" regular 12972、"認証サーバ" 10056 font unit）。同梱フォントは `kern` / `GPOS` を持たないため、advance の合計がブラウザの描画幅と一致する。
  - フォント class（inspection の `font`）から slot を選ぶ: `mono*` → mono、`bold` / `semibold` → bold、`italic` → italic、他は regular（欠けた slot は regular。§4.2 の `--font-*` と同じ）。D2 がラベルを bold で計測するのは D2 自身の寸法決めの話で、lint は SVG に実際に描かれる class で計測する。
  - **ブラウザでの確認**（検証のみ。依存には加えない）: D2 v0.9.0 の SVG をヘッドレス Chrome で開き、`getComputedTextLength()` と比較した。Latin・CJK・bold・複数行の 25 ラベルで、再計測の幅は Chrome より最大 0.12 unit（0.06%）大きいだけだった（Chrome の advance の丸め。許容誤差 1 unit より十分小さい）。
- **空白**: D2 の `<text>` には `xml:space="preserve"` も `white-space: pre` もないため、描画側は CSS `white-space: normal` で空白を畳む。D2 は空白とタブをそのまま出力する（タブも文字として残る）。再計測は計測前に同じ正規化をする（`renderedLines()`）: タブ等は空白にし、連続する空白は最初の 1 つに畳み（`<tspan>` の境界をまたいでも畳む）、text 全体の先頭・末尾の空白を除く。U+00A0・U+3000 は畳まない。空白だけの行（U+00A0 だけの行を含む）は何も描かないので規則の判定から除く（`visibleLines`）。Chrome の描画と一致することを確認した（`"x     y"` 24.70 / 再計測 24.70、空白 50 個は 0、`"line\n   \nend"` の中央の行は空白 1 個分 5.34）。この正規化がないと、空白 50 個のラベルで `label-overflow` と `out-of-canvas` が誤検出された（PR #34 のレビュー）。
- **ラベルの矩形**: 各行は anchor の x を中心とし（`text-anchor: middle`、`<tspan>` の x は `<text>` と同じ）、幅は advance の合計 × font-size。縦は 1 行目のベースラインが anchor の y、行送りは `<tspan>` の `dy`。D2 v0.9.0 の `dy` は font-size と一致しない。D2 が計測したラベルの高さを行数で割った値で、2 行目以降はすべて同じ値になる（16px → 16、18px → 18.5、14px → 14.5）。先頭・末尾の空行は高さに数えないため、`"\nmiddle\n"` では 16 / 3、空行だけのラベル（`"\n"`、`" \n "`）では **0** になる。そのため、`inspectSvg()` の `LabelGeometry` に **`lineHeightUnits`**（2 行目以降の `dy`。1 行なら font-size）を追加した。`dy` が 0 の行送りは受け付け、負の値・行ごとに異なる値・相対単位・`<tspan>` の x が異なる場合は `svg/unsupported-geometry`。再計測は `dy` をそのまま使うので、重なって描かれる行も描画どおりの位置で測る（空白だけの行はもともと判定から除く）。各行の高さは ascender から descender（`hhea`。BIZ UD Gothic は 1802 + 246 = 2048 = 1em）。
- **実測で確認した D2 v0.9.0 の挙動**: 明示サイズの box にラベルが収まらない場合、D2 はサイズを保ち、ラベルを図形の**下の外側**に描く（`label-overflow` は「図形の外に描かれる」と伝える）。circle は明示サイズより大きく描かれることがある（ラベルに合わせて拡大）。自動サイズの図形では、D2 の過大な見積もり（bold・CJK）により再計測したラベルは常に収まる（全 fixture で誤検出なし）。
- **規則**（stage `geometry`）: `exceeds-page-width`（error）、`exceeds-page-height`（error、`maxHeight` がある Profile のみ）、`text-too-small`（error）、`label-overflow`（error）、`out-of-canvas`（error）、`node-overlap`（warning）、`label-collision`（warning）、`edge-crosses-label`（warning）、`aspect-distorted`（warning。§6.3 の観察の ELK による円の変形）、`reversed-edge`（warning。#31 で追加。§6.6）。内容・図形ごとの文字の範囲・許容誤差（1 unit = 0.5pt）・限界は [docs/lint-rules.md](../lint-rules.md)。
- **意図した包含の除外**: `node-overlap` はグループの木（IR の `parent`）で祖先・子孫の組を除外する。`label-collision` はグループの図形との重なりを除外し（中の要素は意図して重ねて描く）、グループのラベルとの重なりは検出する。
- **#31 との関係**: 項目 1（上から入るエッジがコンテナのラベルを横切る）は `edge-crosses-label` で、項目 5（円が長いラベルで大きくなる・縦横比）は `aspect-distorted` と `label-overflow` で検出する。項目 2〜4 は lowering / Theme / Profile の課題として #31 に残す（#31 での判断は §6.6）。
- **観察**: `tests/fixtures/compile/builtins.sumi.yaml` では、ELK がエッジ（circle → ellipse）を別のノード（ellipse-muted）の上に通し、そのラベルが `label-collision` で検出される。エッジとノードの図形の交差そのものを検出する規則は MVP では設けない。
- **CLI**（#14 の後に配線）: `sumi lint --geometry` は `lintRenderedFigure()` を呼ぶ（ファイルは書かない）。`sumi render` は描画結果に `lintGeometry()` を既定の設定で実行し、診断を stderr に出す。幾何の error があっても SVG は書き出し、終了コードを 1 にする（成果物を確認できるようにするため。`--no-geometry` で省ける）。`sumi doctor` の `geometry-lint` は、同梱フォントの metrics を読めれば `ok`。`tests/fixtures/figures/lint/clean.sumi.yaml` は paper-single の幅を超えていたため、Profile を `paper-double` にした（幾何 lint でも clean にするため）。
- 自動修正はしない。文字や図を黙って縮小しない（§5）。

### 6.6 #31 での読みやすさの判断
#10 の目視確認で見つかった 5 項目を、D2 v0.9.0 の実出力（同梱フォント、paper 系 Profile）と幾何 lint で確かめて判断した。比較には examples の 2 図と、コンテナ・ループ・縦長・横向きの検証用の図 7 つを使った。

1. **コンテナのラベルとエッジの交差 → lowering で対応**: group を `label.near: top-left` で出力する（`src/compiler/d2.ts`）。
   - D2 の既定ではコンテナのラベルは上辺の中央にあり、ELK は上から入るエッジを、中央に置いた最初の子へ向けて引く。そのため、ラベルがエッジの通り道に重なる。
   - ELK レイアウトでコンテナに使える `label.near` を試した。`top-left` / `top-right` / `bottom-left` は、D2 がラベル分の余白を内側に確保する（`bottom-left` は下側に確保するので、下へ出るエッジと交差する）。`outside-top-left` はラベルを枠の外（上）に描く。交差は減らず、`label-overflow` の前提（ラベルは図形の内側）とも合わないため採らない。
   - `geometry/edge-crosses-label` の件数は、中央 4 → `top-left` 2 → `outside-top-left` 2（加えて全コンテナで `label-overflow`）だった。`top-left` で残るのは、ラベルがコンテナの幅の半分を超える場合だけ（幅の狭い 1 列のコンテナ。`tests/fixtures/figures/geometry/edge-crosses-label.sumi.yaml`）。この場合は従来どおり `edge-crosses-label` が検出する。
   - 位置を選ぶ Theme のプロパティ（`labelPosition` など）は追加しない。D2 の挙動を Sumi が決めた 1 つの位置に固定するほうが、出力を予測しやすい。必要になれば、互換的な追加として Theme の group のプロパティにする。
   - 回帰 fixture: `container-label.sumi.yaml`（中央なら交差、`top-left` なら交差しないことを確認済み）。`d2-render.test.ts` で、ラベルの anchor が group の左 1/3 にあることを検査する。
2. **コンテナ内のループの反転 → lint の warning（`geometry/reversed-edge`）**:
   - 再現: `process → done → process` をコンテナで囲むと、ELK は `process → done` を逆向きにし、`done` を上に置く。コンテナがない場合と、コンテナの中の 3 ノードのループでは起きない。同じ 2 ノードのループでも、コンテナの中で `done` を先に宣言すると正しい向きになる。
   - lowering での回避（コンテナの子の宣言順を逆にする）は採らない。2 ノードのループは直るが、3 ノードのループが逆に反転した。ELK の閉路の切り方は宣言順への依存が一定でなく、D2 v0.9.0 は ELK の `cycleBreaking` を CLI で指定できない。確実な回避がないため、検出にとどめる。
   - 規則: 宣言順に読んだときに閉路を閉じる辺（入次数 0 の要素から、残りは IR の順に深さ優先探索し、探索中の経路上の要素へ戻る辺）以外の矢印（`forward` のエッジ）が、`layout.direction` に逆らって描かれていれば warning にする。「逆らう」は、終点の図形（`label` 部品はラベルの矩形）が始点より方向の手前側に完全にある（許容誤差 1 unit）こと。線（`line`）・両矢印は向きが見えないので報告しない。自己ループと、group とその子孫を結ぶエッジ（`lint/ancestor-edge` の対象）は探索にも含めない。hint で、宣言順を入れ替えるか、ループをコンテナの外に出すよう示す（`reversed-edge-reordered.sumi.yaml` で効果を確認済み）。
   - group の境界をまたぐエッジ: ELK は group を兄弟の中の 1 つの塊として配置する。そのため探索では、エッジの両端どうしの辺に加え、両端の最小共通祖先の直下にある祖先どうしの辺（射影）もたどる。例: group `g` の中の `a` と外の `b` で `g → b`、`b → a` と書くと、`g → b → g` が閉路になり、`b → a` が閉じる辺になる（PR #39 のレビューで見つかった誤検出。`reversed-edge-group.sumi.yaml`）。
   - 既存の fixture・examples で誤検出はない（統合テストで検査）。
3. **エッジのラベルの背景 → Theme の edge の `fill` で対応**:
   - D2 はもともと、すべてのエッジの線をラベルの位置でマスクしている（`<mask>` の黒い矩形）。背景がないように見えた原因は、マスクの余白がほとんどないこと。同梱フォントの計測では、7pt のラベル "yes" のマスクは 31 × 15 unit で、文字の箱（14 unit）との差は上下とも 1 unit 未満。`y` の descender が線に触れていた。
   - D2 の connection の `style.fill` は、ラベルの背後に角丸の矩形（`rx=10`、同じラベルで 35 × 21 unit。左右 2・上下 3 unit 広い）を描く。ラベルのないエッジには何も描かない（検査済み）。これを edge の `fill` として公開し（§4.1）、組み込みの kind 既定値と組み込み Theme では背景色（白）にした。矩形はエッジの `<g>` の中にあり、inspect は図形として扱わない（edge の bbox は持たない）。
   - コンテナの中では、白い矩形が group の塗り（`minimal` の surface `#f6f8fa`）の上に見えるが、ラベルのチップとして読めるので許容する。エッジの中点ではなく折れ曲がりの近くに置かれる配置は ELK が決める。D2 の connection の `label.near` は ELK では無視されることを確認したため、配置は変えない。
4. **縦長の図 → Profile の maxHeight と層間隔を見直す**:
   - `paper-single` / `paper-double` に `maxHeight: 220mm` を追加した。二段組の論文テンプレートの本文領域の高さは、おおよそ 235mm（US letter、上 0.75in・下 1in）〜 250mm（A4、上下 25mm）で、キャプションと前後の間隔に 15mm ほど残す。1 段組と 2 段組でページは同じなので、同じ値にした。超えると `geometry/exceeds-page-height`（error。`exceeds-page-height.sumi.yaml`、14 段で 258mm）。
   - `layerGap` を 10mm → 8mm にした（presentation は 2 倍の 16mm）。6〜7 段の図の高さは pipeline 163.0 → 150.3mm、decision-flow 166.3 → 149.4mm、7 段の直列 139.9 → 127.2mm。6mm も試したが（それぞれ 137.9 / 133.2 / 115.5mm）、層の間のエッジのラベルが隣のノードの枠に接した（"query" と Auth）ため採らない。
   - それでも 165mm 程度の図は 220mm に収まるので診断は出ない。単段の図としては縦長だが、ページに収まる図を error にはしない。読みやすさの目安としての警告は、必要になれば別の規則として検討する。
5. **ラベルの寸法 → 見送り**: D2 の bold での計測と CJK の過大な見積もりは、ノードを広くするだけで、はみ出しは起こさない（§6.5 の実測）。円・正方形が長いラベルで大きくなる・歪む場合は `aspect-distorted` と `label-overflow` で検出できる。D2 の計測を補正する手段（D2 にラベルの寸法を渡す方法）はなく、明示サイズを自動で付けると `label-overflow` の誤検出の原因になるため、今は何もしない。円・正方形のラベルの長さの目安を lint にするかは、実際の図で問題になってから判断する。

- examples の SVG はこれらの変更で再生成した（ラベルの位置・背景・高さが変わる）。`builtins-render.test.ts` は、examples が Profile の幅と高さに収まり、`sumi render` の幾何 lint が何も出さないことを検査する。

### 6.7 #16 のテスト戦略と CI
- **テストは `bun test` 1 本**。単体テストは各モジュールの隣（`*.test.ts`）、実際の D2 を使う統合テストは `*.integration.test.ts` と `src/compiler/*-render.test.ts`・`src/cli/cli.test.ts` の描画部分。統合テストは、ローカルでは固定版の D2 がなければスキップ（警告を出す）し、`CI` が設定されていれば必須（D2 がなければ失敗）とする。
- **層ごとの主なテスト**:

  | 層 | 単体 | 統合（D2） / E2E |
  | --- | --- | --- |
  | schema（YAML・検証・参照） | `core/figure/*.test.ts`（不正入力の fixture 一式 `tests/fixtures/figures/invalid/`） | — |
  | registry / theme / profile | `core/registry`・`core/theme`・`core/profile` の各テスト | `compiler/builtins-render.test.ts`（全部品 × 全 variant × 全テーマ） |
  | compiler（IR・D2 生成） | `compiler/ir.test.ts`・`d2.test.ts`（`.d2` ゴールデン） | `compiler/d2-render.test.ts`（`d2 fmt` で不変・全要素が SVG に 1 回） |
  | backend | `backends/d2/*.test.ts`（偽の d2 で引数・環境・タイムアウト・I/O 失敗） | `d2.integration.test.ts`（決定性・位置付きエラー） |
  | render / inspect | `render/*.test.ts`（合成 SVG で未対応の幾何・壊れた出力） | `render.integration.test.ts` |
  | lint（構造 / 幾何） | `lint/**/*.test.ts`（出力形式のゴールデン `tests/fixtures/lint-output/`） | `geometry.integration.test.ts`（はみ出し・横切り・ページ超過の fixture） |
  | CLI / Skill | — | `cli/cli.test.ts`・`cli/skill.test.ts`（実際のエントリポイントを子プロセスで起動） |
  | gallery / examples | `scripts/gallery/*.test.ts` | `bun run gallery:check`（SVG のバイト一致） |
  | PR タイトル | `scripts/commitlint/rules.test.ts` | — |

- **ゴールデン**は 3 種類で、いずれもバイト一致で比較する。
  1. D2 ソース `tests/fixtures/d2/*.d2`（D2 を使わない）。更新: `SUMI_UPDATE_GOLDEN=1 bun test src/compiler/d2.test.ts`
  2. lint の出力 `tests/fixtures/lint-output/*`。更新: `SUMI_UPDATE_GOLDEN=1 bun test src/lint/lint.test.ts`
  3. SVG: `examples/*/*.svg` と `docs/gallery/`。更新: `bun run gallery`、検査: `bun run gallery:check`。サンプルと例は診断ゼロ（幾何 lint を含む）でなければ生成自体が失敗する。

  SVG のキーは §6 のとおり（D2 ソース、D2 のバージョン、フォントセットの hash、CLI 引数）。OS は含めない: CI は Linux（x64）と macOS（arm64）の両方で `gallery:check` を実行し、同じバイト列になることを検査する。
- **ラスタ画像の比較（視覚回帰）は現時点では導入しない**。理由:
  - SVG のバイト一致はラスタ比較より厳しい。ラスタで差が出る変更は必ず SVG にも差が出る。出力は決定的なので、許容差やその調整も要らない。
  - ラスタ化はラスタライザ（resvg・Chromium など）と OS ごとのアンチエイリアス・ヒンティングに依存し、許容差が必要になる。許容差は誤検出と見逃しの両方を生む。Playwright などの依存は `bun build --compile` の単一バイナリ方針（CLAUDE.md）にも合わない。
  - 「見た目の崩れ」は、ラベルのはみ出し・重なり・ページ超過などを幾何 lint（§6.5）が SVG の幾何から決定的に検出する。ブラウザでの文字幅との一致も #13 で確認済み。
  - 人による確認は、ギャラリー（`docs/gallery/index.html`）と PR の SVG 差分（GitHub の画像差分表示）で行う。
  - 再検討する条件: 出力が決定的でないバックエンド（D2.js など）を加える場合、または PNG / PDF 出力を提供する場合。
- **D2・フォントを更新するときの手順**（1 つの PR で行う）:
  1. D2: `src/backends/d2/version.ts` の `D2_VERSION` と全プラットフォームの sha256（リリースの `SHA256SUMS`）を更新し、`bun run d2:install`。フォント: `assets/fonts/<set>/` のファイル、`src/core/theme/fonts.ts` の `BUNDLED_FONT_SHA256`、同ディレクトリの README の表（テストで一致を検査）を更新する
  2. `SUMI_UPDATE_GOLDEN=1 bun test` → `bun test` が通るまで、D2 の挙動に依存する箇所（幾何 lint の比率など）を直す
  3. `bun run gallery` でギャラリーと例を再生成し、ギャラリーで見た目を確認して差分をコミットする
  4. CI の両 OS で `gallery:check` が通ることを確認する（D2 のキャッシュは `version.ts` の hash で自動的に入れ替わる）
- **環境の記録と唯一の出典**: Bun は `.bun-version`（CI の setup-bun が読む）、D2 は `src/backends/d2/version.ts`（インストーラ・backend・CI のキャッシュキーが参照）、フォントは `src/core/theme/fonts.ts` の sha256 表。CI のテストジョブは最初に OS（`uname -a`、macOS は `sw_vers`）と `sumi doctor`（text と `--json`: Bun・OS・アーキテクチャ・D2 のパスと版・各フォントの sha256）を出力する。doctor が失敗すればその時点でジョブを止める。
- **CI の構成**（`.github/workflows/ci.yml`）: `static`（ubuntu: Biome・tsc・`schema:check`）と `test`（ubuntu-latest / macos-latest の matrix: D2 の導入、環境の記録、`bun test`、`gallery:check`）。サードパーティの action はコミット SHA で固定し、`permissions: contents: read`、PR では新しい push が古い実行を取り消す（`concurrency`）、各ジョブにタイムアウトを設ける。D2 と Bun のパッケージはキャッシュする。
- **カバレッジ**: Linux のジョブで `bun test --coverage` の表をログに出す（参考情報。閾値は設けない）。CLI は子プロセスで E2E テストしているため `src/cli/commands/*` の数値は実態より低く出る。#16 で数値を手がかりに見直し、未検査だったエラー経路（スキーマの `version` / `figure` 欠落・入れ子の未知フィールド・空の部品参照、inspect の数値でない属性・不正な points・shape group の数・描画の viewBox 不一致、検査後に消えた D2 バイナリ）にテストを追加した。
- **PR タイトルの検査**（`.github/workflows/pr-title.yml`、`scripts/commitlint.ts`）: タイトルは squash merge のコミットになるため、CONTRIBUTING.md の規則を検査する。検査する: `<type>(<scope>)!: <summary>` の形、type の語彙（`style` は不可）、空でない小文字の scope、コロンの後の空白 1 つ、空でない summary、summary が大文字の単語（`Add`）で始まらないこと・末尾のピリオドがないこと、日本語（かな・漢字・全角）を含まないこと。検査しない（誤検出を避ける）: 英語としての正しさや命令形か、長さ、先頭の略語・コード（`SVG`、`` `sumi fmt` ``）、アクセント付きの文字や記号（`→`、`×`）。同じ検査はコミットにも使える（`bun run commitlint origin/main..HEAD`）が、コミットは squash されるため CI では検査しない。

### 6.8 #20 での配布の判断
`bun build --compile` の単一バイナリを、GitHub Release の tarball で配布する。D2.js（WASM）は採用しない（§6、#9）ため、D2 をバイナリの中に含めることはできない。

1. **tarball の構成（ターゲットごとに 1 つ）**: `sumi-<version>-<target>.tar.gz` の中に、prefix 形式で次を置く。
   ```
   sumi-<version>-<target>/
     bin/sumi                     bun build --compile（--no-compile-autoload-dotenv / -bunfig）
     libexec/sumi/d2              D2 v0.9.0 の公式バイナリ（無改変。MPL-2.0）
     share/sumi/fonts/<set>/      同梱フォント（OFL-1.1）と出典の README
     licenses/d2/                 D2 の LICENSE.txt・THIRD_PARTY_NOTICES.txt
     licenses/biz-ud-gothic/      OFL.txt
     LICENSE  NOTICE  README.md  VERSION
     SHA256SUMS                   tarball 内の全ファイルの sha256
   ```
   - D2 は tarball に同梱する。`sumi doctor` での案内だけにすると、利用者が D2 v0.9.0 を正確に入手する手間が残り、決定性（§6）の前提が崩れやすい。D2 は MPL-2.0 で、無改変のバイナリの再配布は、ライセンス本文の同梱と、ソースの入手先（`NOTICE` に tag の URL）の明記で足りる。
   - `libexec/sumi/` に置き、`bin/` には置かない。`bin/` を `PATH` に通したときに、別の `d2` を隠したり上書きしたりしないため。
   - リリース側の sha256 は、ターゲットごとの `.tar.gz.sha256` と、それらをまとめた `SHA256SUMS` を添付する。tarball 自体は決定的に作る（エントリを名前順に並べ、uid / gid 0、mtime は `SOURCE_DATE_EPOCH` か最後のコミット、gzip のヘッダは固定）。GNU tar と bsdtar で必要なフラグが違うため、ustar の書き出しは `scripts/release/lib.ts` で行う。同じ入力からの再ビルドで同じ sha256 になることを確認した（darwin-arm64）。
   - x64 は Bun の `baseline` ランタイム（AVX2 不要）でビルドする。
2. **フォントは埋め込まず、実ファイルとして同梱する**: D2 は `--font-*` にファイルのパスを要求する。バイナリに埋め込むと、実行時にキャッシュディレクトリへ展開する処理（展開先の決定、書き込めない環境、並行実行、版の切り替え、破損時の再展開）が必要になる。実ファイルなら、`sumi doctor` がディスク上の sha256 をそのまま検証でき、geometry lint（§6.5）も同じファイルを読む。配布サイズはどちらでも変わらない（フォント 3 ファイルで約 14MB）。
3. **実行モードとパスの解決（`src/core/install-layout.ts`）**: モジュールのパスが `/$bunfs/`（Windows では `B:/~BUN/`）で始まれば compiled、それ以外は source とする。
   - source: フォントは `<repo>/assets/fonts`（従来どおり）。
   - compiled: `process.execPath` を realpath で解決した実体の `../`（prefix）を基準に、フォントは `share/sumi/fonts`、D2 は `libexec/sumi/d2`。`PATH` 上のシンボリックリンクから起動しても同梱物を見つけられる。
   - `sumi doctor --json` の `runtime` に `mode`（`source` / `compiled`）を追加した（JSON の版は 1 のまま。項目の追加のみ）。D2 とフォントの hint も、compiled では「tarball を入れ直す」「`SUMI_D2_PATH`」を案内する。
4. **D2 の探索順**: オプション → `SUMI_D2_PATH` → **compiled のときの `<prefix>/libexec/sumi/d2`（source: `bundled`）** → `<cwd>/.sumi/bin/d2`（`managed`）→ `PATH`。明示したパス（オプション・環境変数）が存在しなければ error のまま、`bundled` と `managed` は無ければ次へ進む。`bundled` を `managed` より前に置くのは、リリースのバイナリは同じ tarball の D2 と組で検証しており、作業ディレクトリによって D2 が変わらないようにするため。source での実行では `bundled` の段はない。
5. **対象**: darwin-arm64・darwin-x64・linux-x64・linux-arm64（D2 に公式の tarball があり、GitHub に ARM の Linux runner があるため追加した）。Windows は見送る（D2 の Windows 版の配布形式と、`/$bunfs/` 以外のパス解決・smoke の整備が必要）。各ターゲットは native の runner（`macos-15`、`macos-15-intel`、`ubuntu-24.04`、`ubuntu-24.04-arm`）でビルドし、同じ runner で smoke test する。クロスビルドは smoke できないため使わない。
6. **smoke test（`scripts/smoke-release.ts`）**: tarball を空白を含む一時ディレクトリに展開し、リポジトリの外の空のディレクトリから、`PATH` を `/usr/bin:/bin:/usr/sbin:/sbin` に絞り（Bun・Node.js が見えないことも確認する）、`HOME` を一時ディレクトリにし、`SUMI_D2_PATH` を外して実行する。tarball と中身の sha256、`sumi --version` と `VERSION` の一致、`sumi doctor --json`（compiled・D2 は `bundled`・フォントの sha256）、日本語ラベルの図の `render`（終了コード 0、SVG が XML として正しく、ラベルを含む）を、バイナリ直接とシンボリックリンク経由の両方で確認する。release.yml の各ターゲットと、PR ごとの ci.yml の `release` ジョブ（linux-x64）で同じスクリプトを使う。
7. **バージョン**: バイナリは `package.json` の `version` を表示するため、ビルドの `--version` と tag は `package.json` と一致しなければならない（不一致はビルドと release.yml の preflight で失敗）。リリースノートは `docs/releases/v<version>.md` に置き、無ければ release.yml が失敗する。
8. **npm には公開しない**: `sumi` は npm で使用済みの名前で、パッケージ名は `sumi-diagram`。D2 とフォントを同梱する必要があり、npm の配布形態（`bunx` 等）では D2 の取得とプラットフォームごとの配布を別に設計する必要がある。`package.json` の `private: true` は維持し、必要になれば別の Issue で検討する。
9. **ライセンス**: Sumi は MIT（#41）。tarball には次のライセンス文を入れ、`NOTICE` に各同梱物の出典・版・ライセンスとファイルの場所をまとめる。ビルドはどれかが欠けると失敗し、smoke test も存在を確認する。release.yml も tag のときに LICENSE の存在を確認する。
   - Sumi: `LICENSE`（MIT）。
   - バイナリに bundle される npm パッケージ: `licenses/npm/<package>/LICENSE`。対象は固定のリストではなく、`bun build --compile --metafile` の入力から `node_modules/` 配下のパッケージを導出する（推移的な依存を含め、実際に bundle されたものだけ。現在は commander・semver・yaml・zod）。各パッケージのディレクトリのライセンスファイル（著作権表示・許諾・免責を含む本文）をそのままコピーし、無ければビルドを失敗させる。
   - Bun ランタイム: `licenses/bun/LICENSE.md`。Bun のリポジトリにある唯一のライセンス文書で、`.bun-version` の版の `LICENSE.md` を `scripts/release/bun/` に固定して置く（`VERSION` が `.bun-version` と違えばビルドが失敗する）。Bun 本体は MIT、JavaScriptCore / WebKit（LGPL-2）と tinycc（LGPL-2.1）などを静的リンクしており、同文書にそれらの一覧・ライセンス・パッチ済み WebKit のソース（oven-sh/webkit）と再リンクの手順が書かれている。
   - D2: `licenses/d2/LICENSE.txt`（MPL-2.0）と `THIRD_PARTY_NOTICES.txt`。フォント: `licenses/biz-ud-gothic/OFL.txt`。
   - **未解決（要判断）**: (a) LGPL の静的リンクについて、Bun の LICENSE.md は「利用者が改変・再リンクできるよう、アプリケーションをオブジェクト形式で提供する」ことを求める LGPL の条項を引用している。`bun build --compile` の実行ファイルを再配布する側（Sumi）に、同じ義務（Sumi の JS バンドルを再リンク可能な形で提供すること等）がどこまで及ぶかは Bun が明示しておらず、この Issue では判断しない。Sumi のソースは公開リポジトリにあり、tag から同じバイナリを再ビルドできる。(b) Bun が静的リンクする MIT / BSD / Apache-2.0 等のライブラリ（boringssl・ICU など）のライセンス本文は Bun 自身の配布物にも含まれておらず、tarball には Bun の LICENSE.md（一覧とリンク）だけを入れている。本文の同梱が必要かどうかも未判断として残す。

### 6.9 #36 の slides テーマ
`presentation-16x9` の最小文字サイズは 14pt だが、組み込み Theme（`minimal` / `academic`）の文字は 7〜9pt なので、ラベルのある図はすべて `profile/font-too-small` になり、スライド向けの図を作れなかった（#15 の Skill の検証で判明）。

1. **方式: スライド向けの組み込み Theme `slides` を追加する**。Theme（見た目）と Profile（出力先の制約）の責務分担は変えない。
   - 検討した代替案: (a) Profile に文字サイズの倍率（`typography.fontScale` など）を持たせる。(b) Profile の最小文字サイズに合わせて、Theme の文字を自動で拡大する。
   - (a)・(b) を採らない理由: §5.2 の「Theme だけを変えても Profile の制約は変わらない」「Profile は図を縮小・拡大しない」という独立性が崩れる。スタイルの解決結果が Theme と Profile の両方に依存し、`ResolvedStyle`・ギャラリーの部品カード・`profile/font-too-small` の意味（Theme の値と Profile の下限の比較）がすべて変わる。また、文字だけを拡大すると線幅・矢尻・余白との釣り合いが崩れ、それを補う倍率がさらに必要になる。見た目の比率を一か所（Theme）で決めるほうが予測しやすい。
   - 影響: `presentation-16x9` で使える組み込み Theme は `slides` だけになる。`minimal` / `academic` × `presentation-16x9` が `profile/font-too-small` になるのは意図どおりで、ギャラリーの比較表と Skill の参照文書でそう説明する。`slides` は paper 系の Profile でも使える（最小 7pt を満たす）が、図が大きくなるため想定しない。
2. **値**（`src/core/theme/builtin.ts`。D2 unit は ×2）:

   | 項目 | `minimal` | `slides` | D2 unit |
   | --- | --- | --- | --- |
   | 文字（node） | 8pt | 16pt | 32 |
   | 文字（edge のラベル） | 7pt | 14pt | 28 |
   | 文字（group のラベル、bold） | 9pt | 18pt | 36 |
   | 線（regular / bold） | 1pt / 2pt | 2pt / 4pt | 4 / 8 |
   | 角の丸み | 0 | 0 | 0 |
   | 色（fg / muted / surface / highlight） | `#1f2328` / `#6e7781` / `#f6f8fa` / — | `#1a1a1a` / `#595959` / `#f2f2f2` / `#e0e0e0` | — |
   | 破線 | 4 | 4 | — |

   - 文字は `minimal` の 2 倍とした。最小のエッジのラベルが Profile の下限 14pt にちょうど届き、node と group の文字の比率（8 : 7 : 9）も保つ。線も 2 倍にして、文字との釣り合いを `minimal` と同じにした（`presentation-16x9` の間隔も paper 系の 2 倍で、図全体がほぼ相似に大きくなる）。最大値は D2 の範囲内（fontSize ≤ 50pt、strokeWidth ≤ 7.5pt）で、すべて 0.5pt 刻みで表せる。
   - 角の丸みは他の Theme と同じ 0 にした。比例させても 0 であり、角丸の矩形は流れ図で別の意味（端子など）に読まれることがあるため。
   - 色は他の Theme と同じくモノクロに抑えた。プロジェクタでは淡い灰色が飛ぶため、muted を `#595959`（白地でコントラスト比約 7:1）に濃くし、group の塗り `#f2f2f2` と強調の塗り `#e0e0e0` も `minimal` より少し濃くした。強調は太い線（4pt）・太字・灰色の塗りの 3 つで示し、投影しても区別できるようにした。
3. **実際の描画**（D2 v0.9.0、`--theme slides --profile presentation-16x9`、`sumi lint --geometry`）:
   - ギャラリーの全部品のサンプル（14 図）: 幾何 lint の診断なし（エッジのない部品のサンプルに構造 lint の `lint/no-edges` が出るのは、他の Theme と同じ）。ギャラリーの部品カードは、他の Theme と同じく `paper-double` で描く。
   - `system-architecture`（278.0 × 93.7mm）・`grouped`（285.8 × 104.4mm）: 診断なし。`builtins-render.test.ts` で検査する。
   - `pipeline`（95.8 × 239.2mm）・`decision-flow`（97.0 × 254.0mm）: `geometry/exceeds-page-height`（error）と `geometry/edge-crosses-label`（warning。大きくなったコンテナ・注記のラベルをエッジが横切る）。6〜7 段の縦の流れで、層の間隔 16mm だけで約 100mm になる。`direction: right` にしても幅が 356mm・434mm で `exceeds-page-width` になる。スライドには層の少ない図が向くという制約で、Theme をこれに合わせて小さくはしない（文字をすべて下限の 14pt にしても、高さは pipeline 239.2 → 234.9mm、decision-flow 254.0 → 248.5mm と 2% ほどしか縮まず、収まらない。高さの大半は Profile の層の間隔とノードの枠で決まる）。ギャラリーの比較表では、この図を描いたうえで error を示す。
   - 目視（headless Chrome で PNG 化）: 文字・線は投影向けの太さで、variant（強調・muted・破線）は区別できる。コンテナのラベル（18pt bold）は最初の子に近いが重ならない（D2 がラベル分の余白を取る）。エッジのラベルの背景（§6.6）は 14pt でも機能している。
4. **テスト**: `theme.test.ts` で、`slides` が全部品 × 全 variant で `presentation-16x9` の最小文字サイズを満たし D2 の範囲内であること、`builtins.test.ts` で全部品 × 全 variant の図が `presentation-16x9` の検査を通る（`minimal` / `academic` は `profile/font-too-small` だけになる）こと、`builtins-render.test.ts` で実際の D2 で例を描画して診断がないことを検査する。全部品 × 全 variant × 全 Theme の既存のテストとギャラリーは `BUILTIN_THEMES` から自動で `slides` を含む。

### 6.10 実装で確定した事項（#37）
- **互換性の方針（CLI の JSON 全般）**: `version` は封筒ごとの版で、同じ版のうちはフィールドとセクションの**追加だけ**を行う（既存のフィールドの削除・名前や型・意味の変更はしない）。読む側は未知のフィールドを無視する。破壊的な変更をするときは `version` を上げる。これは §2.3 の「v1 のうちは任意フィールドの追加だけ」と同じ考え方を CLI の出力に当てはめたもの。#37 の追加はすべてこの範囲なので、catalog・render・lint の JSON はいずれも `version: 1` のまま。
- **`sumi catalog --json`**: `buildFullCatalog()`（`src/core/catalog.ts`）の出力そのもので、`{ version: 1, components, themes, profiles }`。`components` は従来の `buildCatalog()` の `components` と同じ。`themes` は `buildThemeCatalog()`（`src/core/theme/catalog.ts`）、`profiles` は `buildProfileCatalog()`（`src/core/profile/catalog.ts`）。どちらも `BUILTIN_THEMES` / `BUILTIN_PROFILES` と Registry から導出するので、組み込みの Theme・Profile・部品を追加すれば自動で現れる。gallery や Skill の検証も同じ関数を使える。
  - **セクションの選択**: `--section components|themes|profiles`（繰り返し可）で選んだセクションだけを出す（キーの順は固定）。`--section` がなければ全セクション。ただし `--kind` だけを指定したときは従来どおり `components` だけを出す（`catalog --json --kind node` の出力は #14 から変わらない）。`--kind` と、`components` を含まない `--section` の組み合わせは使い方の誤り（exit 2）。
  - **表**: セクションが 2 つ以上なら見出し（`Components:` 等）付きで表を並べ、1 つなら見出しなしで出す（`catalog --kind node` の表は従来どおり）。Theme の表は ID・FONT SIZE（最小〜最大）・FONTS・PROFILES（`compatibleProfiles`）・DESCRIPTION、Profile の表は ID・MAX WIDTH・MAX HEIGHT・MIN FONT・MARGIN/GAP/PADDING・DESCRIPTION（いずれも書かれたとおりの長さ）。
- **Theme の項目**: `{ id, description, fonts: { id, description, styles }, fontSizePt: { min, max, base: { node, group, edge } }, missingVariants, compatibleProfiles }`。
  - `fonts.styles` はフォントセットにある書体（`regular`・`bold` と、あれば `italic`・`mono`）。`italic: true` / `mono: true` が使えるかの判断に使う。フォントファイルのパスと sha256 は載せない（インストール先に依存し、移植性がない。検査は `sumi doctor` の役割）。
  - `fontSizePt` は、Registry の全部品 × 全 variant の実効スタイル（`resolveStyle()`）の文字サイズの最小・最大と、kind ごとの base のサイズ。最小・最大は実効値だけから求め、どの部品でも上書きされる base の値は含めない（部品が 1 つもない Registry のときだけ base で代える）。
  - `missingVariants` は Theme にスタイルがなく `default` に戻る（`theme/missing-variant`）variant を部品 ID ごとに並べたもの（あるものだけ）。base は kind ごとに必ずあるので、どの部品もどの Theme でも使える。組み込み Theme では空。
  - `compatibleProfiles` は `minFontSize` ≤ `fontSizePt.min` の Profile。この Theme ならどの図でも `profile/font-too-small` にならない Profile で、エージェントが Theme と Profile の組み合わせを選ぶ材料になる（外れていても、小さい文字を使う要素がなければ通ることはある）。
- **Profile の項目**: 定義の構造（§5.2）に合わせて `{ id, description, page: { maxWidth, maxHeight }, margin, typography: { minFontSize }, layout: { layerGap, containerPadding } }`。長さはすべて `{ written, pt, mm }`（`written` は定義に書かれたとおりの文字列、pt・mm は 0.01 に丸めた値。比較は丸めない値で行う）。D2 に渡す長さ（`margin`・`layerGap`・`containerPadding`）には、丸めた実効値 `d2Units`（`toD2LayoutArgs()` と同じ）も付ける。上限のない `maxWidth` / `maxHeight` は `null`。
- **`sumi render --json` の `size`**: 封筒に `size` を追加する（`{ version, file, diagnostics, summary, output, d2, size }`）。`size` は `outputSize()`（`src/render/size.ts`）の出力で `{ widthPt, heightPt, widthMm, heightMm, profile: { id, maxWidthMm, maxHeightMm, minFontSizePt }, fits }`。`widthPt` / `heightPt` は SVG の `width` / `height` と同じ値（viewBox × 0.5pt。丸めない）、mm は 0.01 に丸める。`fits` は幅と高さが Profile の上限以内か（`geometry/exceeds-page-width` / `-height` と同じく丸めない値で比べる）。文字サイズは含めない（診断で報告する）。描画に失敗したとき（出力がないとき）は `size: null`。`--no-geometry` でも `size` は出す。
- **`sumi lint --geometry --json`**: ファイルごとの封筒にも同じ `size` を追加する（描画しなかった・できなかったファイルは `null`）。`--geometry` なしでは描画しないので、`size` キー自体を出さない（従来の出力のまま）。
- **Skill**: Theme・Profile の発見を参照資料の表ではなく `sumi catalog --json` で行い、出力サイズを `render --json` の `size` から読むように変更した。参照資料に載せた JSON の例は、`src/cli/skill.test.ts` で CLI の出力と照合する（catalog の項目は値まで一致、`size` は形が一致）。

### 6.11 #45 の Skill の配布
- **置き場所**: Skill の正を `.claude/skills/sumi/` から `skills/sumi/` に移した（`git mv`）。skills CLI（vercel-labs/skills、`npx skills add <owner/repo>`）が最初に探す `skills/<name>/SKILL.md` の構成で、`nishide-dev/vega-paper` と揃う。`.claude/skills/` はこのリポジトリの開発用設定に戻る。
- **開発用のシンボリックリンク**: `.claude/skills/sumi` → `../../skills/sumi`（相対、git にはシンボリックリンク（mode 120000）として保存）を置き、このリポジトリの Claude Code のセッションでも同じ Skill を読み込む。skills CLI（1.7.2 で確認）は、`skills/` を `.claude/skills` などのエージェント用ディレクトリより先に探し、同じ `name` の Skill を重ねて列挙しない。また走査ではディレクトリの実体だけをたどり（`Dirent.isDirectory()`）、シンボリックリンクは対象にならない。`npx -y skills@1.7.2 add . -l`（`--full-depth` 付きでも）で `sumi` は 1 件だけ列挙される。代替案（リンクを置かず、開発者が `npx skills add . --skill sumi` で自分の環境に導入する）は、リポジトリを開くだけで使えなくなるため採らなかった。Windows で `core.symlinks` が無効なチェックアウトでは、リンクはテキストファイルになり Skill は読み込まれない（Windows は §6.8 で対象外）。
- **CLI の探索（`skills/sumi/scripts/sumi`）**: Skill をリポジトリの外に導入するとソースはないため、ラッパーは次の順に CLI を探す。(1) `SUMI_BIN`（実行可能なファイルでない、またはラッパー自身・その複製を指していれば終了コード 127）→ (2) ラッパーの実体（シンボリックリンクを解決した場所）から上にたどって見つかる Sumi のソースチェックアウト → (3) `PATH` 上の `sumi`（§6.8 のリリース版）→ (4) 作業ディレクトリから上にたどって見つかるソースチェックアウト → (5) どれも無ければ、リリース版の導入手順と `sumi doctor` を案内して終了コード 127。ソースチェックアウトは `package.json` の `name` が `sumi-diagram` で `src/cli/index.ts` があるディレクトリで、`bun` で実行し、`SUMI_D2_PATH` が未設定ならその `.sumi/bin/d2` を使う。(2) を `PATH` より前に置くのは、このリポジトリで開発するときに、古いリリース版ではなく作業中のソースで Skill を試すため（PR #47 のレビュー）。導入先にはチェックアウトがないので (2) は働かず、`PATH` のリリース版が使われる。`PATH` の探索では、ラッパー自身（同じ inode。別名のシンボリックリンク経由でも、実体のパスで比べる）と、先頭 512 バイトに目印の `sumi-skill-wrapper` を含むファイル（別の場所にあるラッパーの複製）を飛ばして探索を続けるので、循環せず、後ろにある本物の `sumi` も見つかる。POSIX sh で書き、空白を含むパスを扱う。
- **`scripts/preview`**: SVG の file URL を作るのに Bun を使っていたが、導入先には Bun も Node.js もないことがあるため、Bun → Node.js → Python 3 の順に使う。
- **検証**: `src/cli/skill.test.ts` で、skills CLI が期待する構成（`skills/` の直下のディレクトリごとに、ディレクトリ名と同じ `name` を持つ SKILL.md）、シンボリックリンク、ラッパーの探索順（`SUMI_BIN` の優先、自身のチェックアウトが `PATH` の `sumi` より優先、導入先では `PATH` の `sumi` が作業ディレクトリのチェックアウトより優先、そのチェックアウトへのフォールバック、どれも無いときのメッセージと終了コード、別名のリンク・複製を `PATH` 上で飛ばすこと）と、preview の Bun・Node.js・Python 3 の各経路（それぞれの実行環境だけを置いた `PATH` で。CI では 3 つとも必須）を検査する。テストはネットワークを使わないため、`npx skills add` 自体は PR で手動で確認した。

## 7. 実装順
1. #4: Diagnostic・Result 型、位置付き YAML 解析、Figure Schema（Zod）＋ JSON Schema 生成、参照検証（重複 ID・未知の端点 / グループ・グループの循環）、fixtures
2. #5 / #6 / #7（#4 の後に並行可能）
   - #5: manifest の型と検証、Registry、テスト用の最小 manifest
   - #6: Theme の形式、token 解決、style のマージ、量子化と値域の検査、フォントセットの同梱
   - #7: 単位パーサ、Profile の形式、組み込み Profile、事前検査
