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
  → arrange      (structured の配置の木・所属, §6.19) stage: layout
  → resolve      (Registry: 部品・props・variant)   stage: component
  → style        (Theme: token → 実効スタイル)       stage: theme
  → constrain    (Profile: 単位・制約の事前検査)      stage: profile
  → Figure IR    (#8)
  → Layout IR    (structured のみ。配置 #89 §6.21・経路 #90 §6.22 → SVG writer #91 §6.23。D2 の段は通らない)
  → D2 source    (#8)                               stage: compile
  → render       (D2 CLI, #9)                       stage: backend
  → SVG artifact (#11)                              stage: svg
  → lint         (#12 構造 / #13 幾何)               stage: lint / geometry
  → PDF          (任意。krilla/WASM, #59・#74, §6.12) stage: pdf
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
| figure.layout | `engine` | | `auto`\|`structured` | `arrange` があれば `structured`、なければ `auto`（§6.19） |
| figure.layout | `direction` | | `right`\|`down`\|`left`\|`up` | `right`（`auto` のみ） |
| figure.layout | `arrange` | | 配置の木（§6.19。structured のみ） | なし |
| group | `id` | ✓ | ID | |
| group | `label` | | string | `""` |
| group | `component` | | 部品参照（kind=group） | `container` |
| group | `variant` | | string | `default` |
| group | `group` | | 親 group の ID | なし（root。structured では配置の木から補完, §6.19） |
| group | `arrange` | | 配置の木（子を並べる。structured のみ） | なし |
| node | `id` | ✓ | ID | |
| node | `component` | ✓ | 部品参照（kind=node） | |
| node | `label` | | string | `""` |
| node | `variant` | | string | `default` |
| node | `props` | | object | `{}`（manifest の既定値で補完） |
| node | `group` | | group の ID | なし（root。structured では配置の木から補完, §6.19） |
| node | `attach` | | `{ to, side, gap? }`（structured のみ） | なし |
| edge | `from` / `to` | ✓ | node または group の ID | |
| edge | `fromAnchor` / `toAnchor` | | `"<side>"` か `"<side>:<0..1>"`（structured のみ） | なし |
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
- **グループ**: 所属は子側の `group:` で表す（単一の親、ネスト可。structured では配置の木からも決まる。§6.19）。循環は `ref/group-cycle`。存在しない親は `ref/unknown-group`。
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
  render?: OutlineRender;       // #52: 省略時は従来の D2 shape
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
| `sumi/trapezoid`（#55、since 0.3.0） | node | rectangle プレースホルダ + 台形の outline 合成 | 同上 |
| `sumi/stack`（#55、since 0.3.0） | node | rectangle プレースホルダ + 3枚の矩形の outline 合成 | 同上 |
| `sumi/label` | node | `shape: text`（枠なしのテキスト）。label は必須（空または空白のみなら `component/missing-label`。D2 は Go の `unicode.IsSpace` で trim して空になるラベルの text shape を拒否する。#8） | default, muted |
| `sumi/container` | group | コンテナ（`shape: rectangle`） | default, muted |
| `sumi/arrow` | edge | `->`、target-arrowhead `triangle` | default, dashed, emphasis, muted |
| `sumi/line` | edge | `--`（矢尻なし） | 同上 |
| `sumi/double-arrow` | edge | `<->`、両端 `triangle` | 同上 |

- #10 で確認: 上表の lowering はすべて D2 の標準 shape（`rectangle` / `square` / `circle` / `oval` / `diamond` / `hexagon` / `parallelogram` / `cylinder` / `document` / `text`）と標準の接続演算子・矢尻だけで表せ、表との差異はない。全部品 × 全 variant × 組み込み Theme 2 種を D2 v0.9.0 で描画するテスト（`src/compiler/builtins-render.test.ts`）と、lowering 表・色の直書き禁止（`src/compiler` と `src/core/registry` には色を書かず、色はすべて Theme から来る）を検査するテスト（`src/compiler/builtins.test.ts`）で固定した。汎用の作例は `examples/` に置く。

- **名前解決**: 参照は短縮名（`box`）か正規 ID（`sumi/box`）。短縮名は MVP では `sumi` 名前空間にのみ解決する。外部名前空間が入った時点で、短縮名の衝突は error とする。**alias は MVP では提供しない**（Theme の適用先が曖昧になるため）。解決後は必ず正規 ID で扱い、Theme のキーも正規 ID（組み込みは短縮名で書くことを許し、読み込み時に正規化する）とする。
- **ports は v1 スキーマから除外する**。D2/ELK で意味的なポートや辺の向きを保証できないことをスパイクで確認したため。必要になったら manifest と Figure に互換的な追加として入れる。
- **Registry API**: `register(manifest)`（manifest の検証と ID 衝突の検出）、`resolve(ref, kind)`、`list({ kind? })`、`validateUsage(manifest, { props, variant })`。いずれも同期関数で副作用を持たない（register はインスタンス内の状態のみ変更する）。

### 3.1 カスタム輪郭の契約（#52）

#18 の[調査](../research/18-custom-svg-components.md)に基づく v1 互換の追加。一次ソースの Figure YAML ではなく、部品 manifest に描画方式を持たせる。

```ts
interface OutlineRender {
  type: "outline";
  renderer: string; // 正規 ID。組み込み Registry に存在するもの
  params?: Record<string, number | boolean | string>;
}

interface OutlinePath {
  points: readonly Point[]; // 直線の頂点列のみ。曲線・SVG の断片は受け付けない
  closed: boolean;         // SVG に書くときの Z を保つ
}

interface OutlineDrawing {
  layers: readonly { role: "body" | "line"; path: OutlinePath }[]; // 背面から順
  outline: readonly Point[]; // body の和集合の境界と一致する単純多角形
  safeArea: Rect;            // body の和集合に含まれる矩形。中心へラベルを置く
  collision?: Region;       // outline を含む凸領域。省略時は outline の凸包
}

interface OutlineRenderer<P extends Record<string, number | boolean | string>> {
  id: `${string}/${string}`;
  version: 1;
  params: z.ZodType<P>; // 組み込みは strict な Zod object。既定値適用後の P を使う
  footprint(label: { width: number; height: number }, params: P): { width: number; height: number };
  draw(footprint: Rect, params: P): OutlineDrawing;
}
```

- **manifest の検証**: `render` は node のみ。`shape: "rectangle"` と既存の sizing 制約により `sizing: "auto"` を要求する。renderer は正規 ID で引き、未知の ID・不正な params・shape / sizing の不一致は既存の `component/invalid-manifest` で返す。検証に失敗した manifest は登録しない。
- **params**: Figure の props ではなく manifest 固有の固定値。renderer の strict object で検証し、省略時も既定値を適用した新しい値を登録 manifest の `render.params` に保存する（呼び出し元の manifest は変えない）。カタログはこの実効値を JSON で返す。`render` のない既存の manifest / catalog には新しいキーを付けない。
- **Registry**: `src/core/outline/` の `BUILTIN_OUTLINE_RENDERERS`（ReadonlyMap）と `getOutlineRenderer(id)`。外部 renderer の登録・実行コードのロードは行わない。型と実装の単位は D2 / SVG user unit（1 unit = 0.5pt）。Point / Rect / Region の宣言は `src/core/geometry.ts` で共有し、既存の render / lint の export は維持する。
- **純関数の契約**: 正で有限のラベル寸法・footprint と、スキーマで検証済みの params を入力とし、入力を変えず、同じ値から同じ幾何を返す。座標は footprint の内側にあり、各辺の全位置から内向きの射線が輪郭に当たる。`footprint()` はラベルを safeArea に含む寸法を返し、ラベルの幅・高さに対して単調増加。色・線・Theme・SVG 文字列は返さない。`body` は閉じた塗り付きの多角形、`line` は塗らない装飾線。inspect 用の `PathSegment` は Z を L に正規化するため、renderer のパス型とは分ける。
- **最初の実装**: 台形と stack の純関数 renderer を契約の実例として追加する。台形は `slant`（0〜1、既定0.4）、stack は `layers`（整数1〜8、既定3）と `offset`（0より大きく64以下、既定8 user unit）。台形の斜辺は幅の1/4まで、stack の段差は幅・高さの `1/(2*layers)` までに抑え、小さい明示 footprint でも safeArea と連続した body を保つ。`footprint()` は指定した段差を含めて余裕を確保する。
- **実装の境界**: #52 は契約・幾何 renderer・manifest 検証・catalog メタデータを用意する。IR / SVG 合成は #53（§6.13）、幾何 lint の接続は #54（§6.14）、利用者向けの部品 manifest・Theme・variant・ギャラリーは #55（§6.15）で接続する。既存の通常部品の描画結果は保つ。
- **契約の検査**: 型検査で曲線のパスを拒否する。幾何のテストは多角形の頂点・交点で断面を分割し、body の和集合と outline の一致、safeArea の包含、両軸への投影（各辺からの射線）を検査する。正方形・縦長・横長・微小な footprint、パラメータの境界値、位置の平行移動、決定性・入力非破壊・サイズの単調性を含む。欠けたレイヤー・誤った輪郭・開いた body・凹部にまたがる safeArea などの負例でも検査を固定する。

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
- edge の `fill` は、D2 の connection の `style.fill` と同じく**ラベルの背景**になる。D2 はラベルのあるエッジにだけ、ラベルより少し大きい角丸の矩形（`rx=10`）を描く（§6.6）。`transparent` なら背景を描かない。structured では `fill` は背景を描くかどうかだけを決め、色はラベルの下に塗られている色になる（#170、§6.41）。
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
| `math` | | 渡さない（structured のラベルの数式だけ。§6.25） | `regular` で描く |
| `mathItalic` | | 渡さない（同上） | `math`、それもなければ `regular` で描く |
| `latin` | | 渡さない（structured の regular の文字のうち、このフォントが持つもの。§6.44） | `regular` で描く |
| `latinBold` | | 渡さない（同上。bold の文字） | `bold` で描く |

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
- **薄表示**（#175、§6.53）: `dim: true` の group とその中の要素は、上の解決の後で色だけを Theme の `dim` で変換する（文字と線は dim の色、塗りは白へ寄せる）。
- 解決結果は全プロパティが確定した、immutable な `ResolvedStyle` とする。
- 組み込み Theme: `minimal`（モノクロ）、`academic`（論文向け）、`slides`（スライド向け。#36 で追加、§6.9）、`color`（色を使う汎用。#92 で追加、§6.20）、`paper`（論文の図の見た目: 角丸・パステルの tone・小さい矢じり・Inter。#173 で追加、§6.52）。分野固有のパレットは持たない。tone（色の分類の名前）の色は Theme の `tones`（塗り）と `toneLines`（線と文字。#177、§6.54）にだけ置く（§6.20）。

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
  arrangeGap: 4mm       # structured のみ（§6.21）。省略可（paper 系の値）
  groupPadding: 8pt
  nodePaddingX: 7pt
  nodePaddingY: 3.5pt
  compact:              # figure.layout.density: compact の 4 項目（§6.55）。省略可（paper 系の値）
    arrangeGap: 2.5mm
    groupPadding: 6pt
    nodePaddingX: 7pt
    nodePaddingY: 1.5pt
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
| `typography.minScaledFontSize`（任意、#183） | 5pt（paper 系） | 量子化しない | 使わない（`figure.fit: scale` で縮めた図の印刷される文字を幾何 lint で比較。省略は `minFontSize`。§6.48） |

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
  - `renderFigure(text, opts): Promise<Result<{ svg, metadata, inspection, compiled, artifact }>>` — compile → backend.render → finalize → inspect を順に実行する。#53 の outline があれば測定パスと compose → 再 inspect を加える（§6.13）。各段の warning も含めて diagnostics を返す。`opts.backend` の既定は D2 CLI backend。
  - `readSvgMetadata(svg)`、`parsePath(d)`、`decodeElementClass(class)`、`unitsToPt` / `unitsToMm` / `toSize` も公開する。
- **XML parser**: 依存ライブラリを追加せず、`src/render/xml.ts` に最小の厳格な parser を実装した。理由は次のとおり。
  1. DTD（`<!DOCTYPE`）とマークアップ宣言を構文として受け付けないため、XXE や entity 展開攻撃（billion laughs）が原理的に起きない。entity は定義済みの 5 つと数値文字参照だけを展開し、それ以外は error とする。`<?xml?>` 宣言以外の処理命令（`<?xml-stylesheet?>` 等）も拒否する。
  2. 要素ごとに元テキスト上の offset を記録する。これにより、再直列化せずに root の開始タグだけを差し替えられる（非破壊の後処理）。
  3. 入力は固定版の D2 が生成する SVG だけなので、汎用 parser の機能（名前空間解決、DTD、エンコーディング変換）は不要。依存を増やさず、`bun build --compile` にも影響しない。
  - entity 名は `Map` で引く（`&constructor;` や `&__proto__;` が prototype 経由で解決されない）。XML 1.0 の `Char` に含まれない生の文字（tab / LF / CR 以外の C0 制御文字、対になっていないサロゲート、U+FFFE / U+FFFF）は、テキスト・属性値・CDATA・コメントのどこにあっても、code point 単位で走査して拒否する。
  - 走査は再帰しない（深いネストでもスタックが溢れない）。不正な XML は行・列付きで `svg/invalid` とする。
- **仕上げ（finalize）**: root `<svg>` の開始タグに `width="{W·0.5}pt" height="{H·0.5}pt"` を追加し、直後に `<metadata>` を挿入する。それ以外の D2 の出力はバイト単位でそのまま残す（root 開始タグ内の属性は、元の順序のまま正規の空白で再出力する）。viewBox は変更せず、縮小もしない。数値は指数表記を使わず、小数点以下は最大 6 桁とする。
  - #53 の outline 合成は finalize の後の独立した段で、outline ノードの `g.shape` の中身、ラベルの `text` / `tspan` の位置、接するエッジの `d` のみを編集する。それ以外のバイトと metadata の形式は保つ。通常の部品のみの図は従来どおりで、合成しない（§6.13）。
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
  - path は M / L / C の絶対座標列に正規化する。D2 v0.9.0 が出力するのは `M L C S V Z`（edge の角は `S`、cylinder は `V`）。他に `H` / 相対形 / `Q` / `T` も厳密に変換できるので受け付ける。円弧（`A`）は近似になるため受け付けない。範囲外の数値や、相対座標・反射・次数上げの計算で生じた非有限値も拒否する。`transform` は、計測する要素（図形、`g.shape`、`path.connection`、`text`）とその祖先（要素の `g`、`svg.d2-svg`、root `<svg>`）のどこにあっても推測せず、`svg/unsupported-geometry`（error）とする。例外は `<text>` のちょうど `rotate(±90 cx cy)` だけで、回転したラベル（#178）として読む（§6.46）。`svg.d2-svg` の 0 でない `x` / `y` も同様に扱う。未知の図形要素も同じ。
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
- **読み手が先に閉じた出力（EPIPE、#49）**: `run()` は stdout / stderr を `guardStream()`（`src/cli/io.ts`）で包む。書き込みが EPIPE で失敗したら、その stream への以降の出力を捨て、メッセージもスタックトレースも出さず、**コマンドは最後まで実行し、自身の終了コード（0 / 1 / 2）で終わる**。Bun は SIGPIPE で終了せず、失敗を非同期に（write の callback か `error` イベントで）伝えるので、`run()` は全ての書き込みの完了を待ってから終了コードを返す。`SUMI_DEBUG=1` のときは stderr に 1 行の debug メッセージを出す。EPIPE 以外の書き込みの失敗（`code` を持つエラー。ENOSPC など）は、出力が失われたので `sumi: error: cannot write to <stream>: …`（1 行）で exit 2 とする。このメッセージや debug 行の書き込みの完了も待ち、stderr が EPIPE 以外で失敗していれば exit 2 にする（stderr 自身の失敗は stderr に報告しない）。`code` を持たない同期例外は従来どおり内部エラー。`error` リスナーは stream ごとに 1 つだけ付け（WeakMap で管理し、その stream の最新の guard に転送する）、外さない。`run()` の後に届く遅い `error` イベント（非同期の `_destroy()` など）でもプロセスが落ちず、同じ stream で `run()` を繰り返してもリスナーが増えない。
  - 128+SIGPIPE（141）にしない理由: (1) `render` の SVG や `fmt` の書き換えは stdout の読み手と独立した成果で、その成否は終了コードで伝えるべきである（読み手が `head` でも、幾何 lint の error なら 1）。(2) 141 は、出力がパイプのバッファに収まって読み手の終了より先に書き終わったかどうかで、同じ入力でも 0 と 141 に分かれる。`set -o pipefail` のスクリプトが不定に失敗しないよう、決定的な終了コードにする。(3) 終了コードの集合を 0 / 1 / 2 のまま保つ。
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
     licenses/pdf-wasm/           bin/sumi に埋め込む PDF エンジンのクレートの一覧とライセンス（#74、§6.12）
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
- **Theme の項目**: `{ id, description, fonts: { id, description, styles }, fontSizePt: { min, max, base: { node, group, edge } }, missingVariants, tones, compatibleProfiles }`（`tones` は #92 で追加。§6.20）。
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

### 6.12 PDF 出力（#59・#74）

**現行実装は #74 の krilla + krilla-svg。** 保守終了した svg2pdf を置き換える判断は [#60 の評価](../research/60-krilla.md)、移行の検証は [#74 の記録](../verification/74-krilla.md) を参照。

- **契約**: `svgToPdf(svg, { fontSet? }): Result<Uint8Array>`、CLI の形式・出力先・JSON、provenance の項目、既存 `pdf/*` Diagnostic、入力上限は #59 の契約を維持する。
- **エンジン**: `native/pdf-wasm/` の krilla 0.8.2 + krilla-svg 0.8.1、usvg 0.47.0、fontdb 0.23.0。Rust 1.98.1 / `wasm32-unknown-unknown`、Cargo.lock の版・checksum 固定、upstream パッチなし。raw ABI は `alloc` / `add_font` / `convert` / `output_ptr`。host imports は 0 と検査する。
- **生成物と配布**: `assets/wasm/sumi-pdf.wasm`、`src/render/pdf/engine.ts` の `PDF_WASM_SHA256`。`with { type: "file" }` で単一実行ファイルへ埋め込み、sha256 検証・プロセス単位のコンパイル・変換単位の新規 instance を維持する。基準ビルドは linux-x64。`bun run pdf:wasm` の再現ビルドと `--adopt` の運用は CONTRIBUTING.md のとおり。
- **文字とページ**: 既存 `resolveSvgFonts()` で D2 の CSS を同梱 TTF の実 family/weight へ解決する。fontdb は渡したファイルだけを読む。usvg の CSS px を ×72/96 して MediaBox と描画先の Size を定義し、SVG の pt と一致する 1 ページの PDF 1.7 を生成する。Sumi の図は文字のサブセット・ToUnicode とベクターマスクを保ち、画像数 0。krilla-svg の推移 feature に画像・フィルタ機能があるため、任意の外部 SVG 全般について純ベクターを保証する意味ではない。
- **メタデータ**: krilla の公開 Metadata API は独自項目に対応しないため、wrapper が書く `/Producer(Sumi krilla)` の辞書を TS 側で厳密に確認して置換する。Info は Catalog より前にあるので、辞書の長さ差に合わせて後続オブジェクトの全 xref offset と startxref を更新する。日時・XMP・incremental update は追加しない。項目は従来どおり、Producer は `Sumi <版> (krilla 0.8.2, krilla-svg 0.8.1)`。形式の不一致は `pdf/conversion-failed`。
- **reader と決定性**: 固定版 krilla の classic xref、compact 辞書、indirect resources は既存の最小 reader が対応済み（object/xref stream は出力されない）。examples 4 図の PDF と、全 48 部品/テーマ＋日本語 mask の hash を golden として Linux/macOS と release の全 4 OS/CPU ターゲットで検査する。Poppler での独立検査、実 pdfLaTeX / LuaLaTeX の取り込み検査も維持する。
- **ライセンス**: `native/pdf-wasm/THIRD_PARTY.md` と `licenses/` を生成し、tarball の `licenses/pdf-wasm/` に同梱する。Cargo metadata から埋め込み 78 crates / build-only 10 crates を分類する。krilla の crate package に欠ける原文は `.cargo_vcs_info.json` の commit から SHA-256 検証して取得する。NOTICE の MPL-2.0 部分について、原文と無改変 upstream の対応ソース入手先を記録する。
- **互換性**: PDF の内部構造・subset tag・Producer・バイト列は更新される。YAML・CLI・SVG・ページ寸法・フォント・provenance の契約を変えるものではない。PDF/A / PDF/X・タグ付き PDF・複数ページ等は引き続き保証しない。

<details>
<summary>#59 時点の svg2pdf 実装の記録（#74 で置換済み）</summary>

#19 の評価（[docs/research/19-pdf-pptx-export.md](../research/19-pdf-pptx-export.md)）で推した方式（svg2pdf を WASM にして同梱）で実装した。

1. **段と API**（`src/render/pdf`）: 仕上げ後の SVG（§6.3）を入力にする新しい段 `pdf`（§0）。`svgToPdf(svg, { fontSet? }): Result<Uint8Array>`。フォントセットは省略すると SVG のメタデータの `font-set` から引く。診断コード（いずれも error）: `pdf/input-too-large`（下記の入力の上限を超えた）、`pdf/missing-font`（フォントセットが分からない、またはフォントファイルを読めない・解析できない）、`pdf/unresolved-font`（SVG が使う D2 のフォント slot にファイルがない、または書き換え後も D2 の family 名が残る）、`pdf/engine-unavailable`（WASM がない、または sha256 が固定値と違う）、`pdf/conversion-failed`（エンジンが SVG を拒否した、エンジンが trap で止まった、または出力の文書情報が想定と違う）。
   - **trap**: WASM の trap（スタック溢れによる範囲外アクセス、メモリ不足、Rust の panic による `unreachable`）や、想定した export がないモジュールは、`runEngine()` が例外にせず失敗として返し、`pdf/conversion-failed` になる（CLI は exit 1、`--json` も出る）。インスタンスは変換ごとに作り直すので、trap したインスタンスを使い回すことはない。
   - **入力の上限**（`PDF_INPUT_LIMITS`、エンジンに渡す前に検査）: UTF-8 で 32 MiB、要素の入れ子 64 段（root の `<svg>` が 1 段目）、要素 200,000 個。usvg は WASM（スタック 1 MiB）の中で木を再帰的にたどる。実測では、opacity 付きの `<g>` の入れ子は約 400 段で trap し、opacity・mask・clip-path・transform・文字を各段に持つ入れ子でも 192 段までは変換できた。D2 の SVG は平ら（examples で深さ 5、要素 100 未満）なので、上限は実際の図に対して十分な余裕があり、病的な入力だけを明確な診断で止める。スタックは広げなかった（上限の内側では足りており、WASM を作り直すと基準ビルドの更新が要るため。上限を超えない入力の trap も上記のとおり診断になる）。要素 200,000 個（opacity 付き）の変換は約 0.3 秒だった。メタデータが壊れていれば `svg/invalid`。幾何 lint は従来どおり SVG に対して実行する（PDF は同じ図を写すだけなので、PDF 側で再検査しない）。
2. **エンジンの出所と固定**:
   - `native/svg2pdf-wasm/`（Cargo.toml・Cargo.lock・`rust-toolchain.toml`・`src/lib.rs`・`svg2pdf-deterministic.patch`）。svg2pdf 0.13.0（usvg 0.45 / fontdb 0.23 / pdf-writer 0.12）を default features なし・`text` のみで使う（ラスタ画像・フィルタ・システムフォントの読み込みを含まない）。ツールチェーンは Rust 1.98.1、target は `wasm32-unknown-unknown`（WASI もホスト関数もない。C ABI の `alloc` / `add_font` / `convert` / `output_ptr` だけを出す）。
   - **決定性パッチ**: crates.io の svg2pdf 0.13.0（`.crate` の sha256 `e50dc062439cc1a396181059c80932a6e6bd731b130e674c597c0c8874b6df22`）に、フォントオブジェクトの書き出し（`Context::write_global_objects`）とリソース辞書の並び（`ResourceContainer::finish`）を HashMap の順ではなく参照番号の順にする 2 か所（十数行）の修正を当てる。理由は #19 §3.2（実行ごとに PDF のバイトが変わる）。当て方は、クレート全体を vendoring せず、`bun run pdf:wasm` が `.crate` を sha256 を検査してから `native/svg2pdf-wasm/vendor/`（gitignore）に展開してパッチを当て、`[patch.crates-io]` でそこを指す方式にした（コミットするのはパッチ 1 ファイルだけで済む）。上流への提案は #60（未提案）。取り込まれればパッチと `[patch.crates-io]` を外す。
   - **生成物**: `assets/wasm/sumi-svg2pdf.wasm`（1,922,851 バイト、gzip で約 0.73MB、sha256 `7a8ea73e55d113facda46ed261f6dd144d1fee341ab02d96bccd3bc128e7e71d`。linux-x64 でのビルド）をコミットし、sha256 を `src/render/pdf/engine.ts` の `SVG2PDF_WASM_SHA256` に固定する（`bun run pdf:wasm` が両方を書く）。読み込むたびに sha256 を確かめ、違えば `pdf/engine-unavailable`。通常のテスト・リリースのジョブは Rust を使わない。
   - **再現性の検査**: CI の `pdf-wasm` ジョブ（ubuntu-24.04）が `bun run pdf:wasm` でソースから作り直し、`.wasm`・sha256 の定数・`THIRD_PARTY.md`・`licenses/` がコミットと一致しなければ失敗する。キャッシュはツールチェーンとクレートのソースだけで、ビルド自体は毎回行う。ローカルのパス（チェックアウトと `CARGO_HOME`）が panic の位置情報として WASM に入らないよう `--remap-path-prefix` で消す（std は元から `/rustc/<hash>/`）。**ホストの違い**: 同じホストでは何度ビルドしても同じバイトになるが、darwin-arm64 と linux-x64 ではコードの数バイトが違った（1,922,690 と 1,922,851 バイト。文字列・パスの差はなく、LLVM がホストの数学ライブラリで浮動小数の定数を畳み込むためと推測）。そのため**基準のビルドは linux-x64（CI）**とし、コミットする `.wasm` はそれにした（sha256 は CI の値）。他のホストでのビルドは手元の試験用で、変更をコミットするときは CI が不一致時に残す artifact を `bun run pdf:wasm --adopt <file>` で取り込む（CONTRIBUTING.md）。どちらのビルドでも examples の PDF はバイト単位で同じだった（WASM の実行はホストによらないので、利用者の PDF は基準の `.wasm` だけで決まる）。macOS の rustup では `rust-lld` が `libLLVM.dylib` を見つけられないことがあり、スクリプトはツールチェーンの `lib/` を `DYLD_FALLBACK_LIBRARY_PATH` に入れて回避する。
3. **単一バイナリへの埋め込み**: `import wasmPath from "../../../assets/wasm/sumi-svg2pdf.wasm" with { type: "file" }`。source では実ファイルのパス、`bun build --compile` では `/$bunfs/` のパスになり、どちらも `readFileSync` で読める。release の build と smoke で確認した。バイナリは darwin-arm64 で 64.82MB → 66.77MB（+1.95MB）、tarball は 49.99MB → 50.80MB（+0.81MB）。フォントと違い WASM は Sumi 自身の一部で、外部プロセスにパスを渡す必要もないので、埋め込みでよい（§6.8 の 2 の理由は当てはまらない）。WebAssembly のコンパイルはプロセスごとに 1 回で、変換ごとに新しいインスタンスを作る（前の変換のフォントやメモリを持ち越さない）。1 図の変換は約 30ms（同梱フォント 3 ファイル、計 14MB の受け渡しを含む）。
4. **フォント**: D2 は WOFF のサブセットを `@font-face` と図ごとの family 名（`d2-<hash>-font-<slot>`）で埋め込むが、usvg は `@font-face` を読まない。`resolveSvgFonts()` が、strict な XML parser（§6.3）の offset で `<style>` 要素の中身だけを取り出し、その CSS の class 規則の family 名を、その slot に対応するフォントセットのファイル（`fontSetArgs()` と同じ対応。D2 に渡したファイルそのもの）の実名・太さ・スタイルに書き換え（`name` テーブルの typographic family（ID 16）、なければ family（ID 1）の英語名と、`OS/2` の `usWeightClass`・`fsSelection`。`sumi/biz-ud-gothic` では `"BIZ UDPGothic"` 400 / 700 と `"BIZ UDGothic"` 400）、`@font-face` を除く。文字（ラベル）は、`d2-123-font-regular` や CSS に見える文字列でもそのまま描く（書き換えも診断もしない）。`font-family` 属性と `style` 属性に D2 の family 名があれば（D2 は書かない）`pdf/unresolved-font` とする（書き換えはしない）。エンジンにはフォントセットのファイルだけを渡し（regular を先頭にして、名前のない文字の代替にする）、fontdb はシステムフォントを読まない。結果として文字は同梱フォントの CID TrueType サブセットとして埋め込まれ、ToUnicode 付きで抽出・検索できる。
5. **ページと内容**: usvg は root の `width="…pt"` を CSS px（96/in）に解決するので、`PageOptions { dpi: 96 }` で pt に戻し、MediaBox = SVG の `width` × `height`（pt）ちょうどの 1 ページにする。図形はベクターのまま、ラスタ画像は 0（D2 のラベル用 `<mask>` はベクターの soft mask になる）。PDF のバージョンは 1.7、ページのグループは sRGB の ICC（svg2pdf 同梱、CC0）の透明グループ。
6. **決定性とメタデータ**: パッチ後の svg2pdf は時刻も乱数も使わない。エンジンは 1 つの WASM なので、OS・CPU によらず同じ SVG から同じバイトが出る（ネイティブ版とはサブセットのタグだけが違うことが #19 で分かっているが、ネイティブ版は使わない）。svg2pdf は文書情報辞書に `/Producer (svg2pdf)` だけを書くので、`setDocumentInfo()` がその辞書を、ファイルの構造から見つけて（末尾の `startxref` → xref 表 → trailer の `/Info` の参照 → xref 表のその offset。固定の範囲は仮定しない。xref 表が 64 KiB を超える PDF でも動く）、xref 表の直前の最後のオブジェクトであることと内容が `/Producer (svg2pdf)` であることを確かめたうえで、SVG のメタデータ（§6.3）と同じ内容に置き換え、`startxref` をずらす: `/Title`（figure の id）、`/Creator`（`Sumi <版>`）、`/Producer`（`Sumi <版> (svg2pdf 0.13.0)`）、`/SumiBackend`・`/SumiTheme`・`/SumiProfile`・`/SumiFontSet`・`/SumiInputSha256`・`/SumiD2Sha256`。日時（`/CreationDate`）は入れない。XMP のメタデータストリームは書かない（PDF/A の要件でもなく、決定的に作る手間に見合わない）。想定と違えば（svg2pdf が変わったら）`pdf/conversion-failed` で止める。Rust 側で設定しなかったのは、svg2pdf 0.13 の `to_pdf` がこの辞書をクレート内部の状態（`Context`・`tree_to_stream`）から書くため、パッチを大きくする（または `to_pdf` を作り直す）必要があり、項目を変えるたびに WASM の基準ビルドの更新も要るため。バイト列の置き換えは svg2pdf の出力に対して厳密に検査し、golden でも固定している。
7. **CLI**（§6.4 の拡張）: `sumi render` は `--format svg|pdf`、なければ `-o` の拡張子（`.svg` / `.pdf`、大文字小文字を区別しない）、どちらもなければ SVG。明示の `--format` が拡張子と矛盾する場合（`--format svg -o x.pdf`）と未知の形式は使い方の誤り（exit 2。何も書かない）。それ以外の拡張子は従来どおり（SVG）。既定の出力先は入力の `.sumi.yaml` を `.pdf` に替えたパス。`-o -`（stdout）は SVG だけとし、PDF では使い方の誤りにした（バイナリを stdout に流す要望が出てから検討する）。書き込みは SVG と同じ一時ファイル＋rename で、入力・`--emit-d2` との同一ファイルの検査（シンボリックリンク・dev/ino・大文字小文字）も同じ。PDF の変換に失敗したら何も書かず、`pdf/*` の診断で exit 1。幾何 lint の error があっても PDF は書く（SVG と同じ）。`--json` の封筒には最後に `format`（`svg` / `pdf`）を加えた（§6.10 の方針どおり追加のみで `version: 1` のまま。既存のキーの順も変えない）。
8. **テスト**:
   - **golden**: `examples/<name>/<name>.pdf` をバイト一致の golden にした。`src/render/pdf/pdf.test.ts` がコミット済みの SVG から変換して比べる（D2 不要なので CI の Linux と macOS の `test` ジョブの両方で同じバイトを検査する）。`bun run gallery` も同じ PDF を書き、`gallery:check` が古い PDF を検出する。更新は `bun run gallery` か `SUMI_UPDATE_GOLDEN=1 bun test src/render/pdf`。ギャラリーの例には PDF へのリンクを付けた。
   - **構造の検査**（外部ツールなし）: `src/render/pdf/testing.ts` に最小の PDF reader（xref 表を読み、各エントリが正しいオブジェクトを指すことを確かめる。FlateDecode、フォント、画像、文書情報、内容ストリームの q/Q/cm・BT/Tm/Td/Tf/Tj/TJ・form XObject の Do を解釈し、ToUnicode と `/W` から各 glyph の位置と送り幅を得る）を置いた。poppler に頼らないので CI でスキップされない。各例について、ページ = SVG の pt サイズ、フォントはすべて埋め込みの BIZ UD のサブセット、画像 0、文書情報 = SVG のメタデータ、**全ラベルの全行が、幾何 lint の再計測（`measureLabel()`）と左端・ベースライン・幅とも 0.01pt 以内**で文字として描かれていることを検査する。
   - 単体: family 名の書き換え（`fonts.test.ts`。D2 の family 名や CSS に見えるラベルが PDF にそのまま描かれること、属性の検査を含む）、文書情報の置き換えと xref の整合（`info.test.ts`、xref 表が 64 KiB を超える PDF は `limits.test.ts`）、trap が失敗の結果になり次の変換は新しいインスタンスで成功すること・入力の上限（入れ子・要素数・サイズ）（`limits.test.ts`）、各 `pdf/*` の診断。CLI の E2E: `-o x.pdf`、`--format pdf`（既定の出力先）、矛盾・未知の形式・`-o -` の誤り、`--json` の `format`、幾何 lint の error でも PDF を書くこと。
   - **リリース**: `release:smoke` が、同梱バイナリ（直接とシンボリックリンク経由）で日本語の図を PDF にし、ページの大きさ・埋め込みサブセット・画像 0・ラベルの文字を検査し、**ソースから同じ SVG を変換したバイトと一致する**ことを確かめ、sha256 を出力する。release.yml は 4 ターゲットでこれを実行するので、各ターゲットのバイナリがソースと同じ（したがって互いに同じ）PDF を出すことが確かめられる。
9. **ライセンス**（§6.8 の 9 に追加）: `bun run pdf:wasm` が `cargo metadata`（wasm の target、Cargo.lock）から、WASM にコンパイルされるクレート 67 個と、ビルド時だけ使うクレート 7 個（proc-macro とその依存。同梱しない）を `native/svg2pdf-wasm/THIRD_PARTY.md` に書き、前者のライセンスファイルをクレートのパッケージからそのまま `native/svg2pdf-wasm/licenses/<crate>-<version>/` にコピーする（コミットし、CI で一致を検査）。ライセンスはすべて許容的なもの（MIT・Apache-2.0 の選択が大半。ほかに BSD-2-Clause（arrayref）・BSD-3-Clause（tiny-skia、tiny-skia-path）・Zlib（slotmap、zlib-rs）、選択肢として 0BSD・Unlicense・BSL-1.0）。svg2pdf の NOTICE によれば、ICC プロファイル（`src/icc/`）は CC0、`src/util/helper.rs` と `src/render/path.rs` の一部は MPL-2.0。MPL-2.0 の部分はソース（crates.io の 0.13.0 と、パッチを含む Sumi のリポジトリ）の入手先を `NOTICE` に書いた（パッチはこれらのファイルを変更しない）。release build は `licenses/svg2pdf-wasm/` にこれらを入れ、`NOTICE` に PDF エンジンの項（版・WASM の sha256・パッチ・MPL の部分）を加える。build は WASM の sha256 と svg2pdf のライセンスファイルが揃っていなければ失敗し、smoke もその存在を確かめる。
10. **保証しないこと・制約**: PDF/A・PDF/X 等の規格適合（D2 のラベル用 mask が透明を使う。必要になれば、変換前に mask をラベルの白い背景に置き換える前処理（#19 §3.2・§10 の 6）で透明をなくせる。需要が出てから別 Issue）、タグ付き PDF（アクセシビリティ）、複数ページ、レイヤー・リンク。pdfLaTeX / LuaLaTeX での取り込み（PDF 1.7）は #63 で検証済み（TeX Live 2026、文字・フォント埋め込み・位置・表示）。[検証記録](../verification/63-pdf-latex.md)と `bun run pdf:latex` で再現でき、CI に専用の検査ジョブを設ける。svg2pdf / usvg の版を上げると出力が変わる（golden の更新が必要。D2 の更新と同じ扱い）。

</details>

### 6.13 #53 のカスタム輪郭合成

- **IR**: NodeIR に任意の `render` を保持する。manifest 検証後の固定 params を複製して freeze し、既存ノードにはキーを追加しない。render のない図では描画パス・D2・SVG・PDF の出力を変更しない。
- **2パス描画**: 自動寸法の outline ノードがあれば、測定専用 IR ではそのノードの width / height をいったん外し、D2 のラベル・余白・次数を含む箱を得る。`renderer.footprint()` から必要寸法を求め、D2 unit の整数へ切り上げた幅・高さを最終 IR へ補完して2回目を描く。片方が明示済みならその値を保ち、未指定の軸だけ補完する。両方明示済みなら1パス。YAML は書き換えず、最終 `compiled.ir`・`d2Source`・`artifact.d2Source` を一致させる。入力 hash は元の YAML、D2 hash は最終パスのソース。
- **合成**（`src/render/compose.ts`）: inspect 済みの SVG を XML offset で部分編集する。プレースホルダは `g.shape` 1つの直下に rect 1つであることを要求し、違えば `svg/unsupported-geometry`（error、要素・位置付き）。rect の x/y/width/height/rx/ry 以外の属性を輪郭の各 path へ写し、塗り・線・class・style・破線を維持する。`line` レイヤーは fill を none にする。パスは3桁に丸めた M/L と Z。角丸は多角形に適用できないため、非0の radius は `svg/outline-radius-ignored`（warning）。
- **ラベル**: outline ノードの D2 には `label.near: center-center` を明示する。D2 は狭い明示サイズの矩形では既定でラベルを外へ移すため、合成の前提となる内部中央配置を固定する（既存の通常ノードには追加しない）。元の footprint の中心から safeArea の中心への差分を text の x/y と各 tspan の x へ加え、文字・フォント・行送り・中央配置時の baseline offset は変えない。明示 footprint が小さすぎる場合もサイズを強制変更しない。safeArea を使う幾何 lint の詳細は #54 で接続する。狭い両軸指定・幅だけの指定について、台形と stack の文字位置を十分大きい参照図の baseline offset と比較する回帰テストを置く。
- **エッジ**: 正規化した経路の先頭は IR の from、末尾は to に対応させる。最後の線分（曲線では端点の制御点）から内向きの単位射線を取り、footprint と輪郭への最初の交差距離の差だけ端点を延ばす。矢じり・stroke のために D2 が空けた距離と接線方向は保つ。曲線の端の制御点も同じ差分だけ動かす。エッジラベル・mask・marker の属性・他の経路部分は変更しない。自己ループ・逆向き・両矢印・矢印なし・多重エッジも同じ処理。
- **端点契約が成立しない場合**: 射線が footprint / outline に当たらない、端が退化して方向を決められない、端点が footprint の内側にある、最後の方向が入る辺の法線から許容角度（5°、#82 で「水平/垂直」から緩和。§6.18）を超えて傾いている場合は、その端を変更せず `svg/outline-edge-miss`（warning）。ただし射線上で輪郭と footprint が一致する（延長量 ≈ 0）端は、変更が不要なので角度によらず warning にしない。近くの別ノードへ推測して付け替えない。
- **延長区間の交差方針**: 同じ部品で延ばした区間どうしの内部交差と共線の重なりを `svg/outline-edge-crossing`（warning）として報告する。境界で触れるだけは除外する。主診断は片方のエッジを指し、related にもう一方のエッジ位置を添える。`tests/fixtures/outlines/corner.*` で stack の左上の角へ隣り合う2辺から接続する例を固定した。これら svg 段の warning は lint 規則の severity 設定の対象ではない。
- **再検査とメタデータ**: 合成後に inspect を再実行し、移動後のラベル・エッジを返す。bbox は footprint と一致し、コンテナの包含は維持する。`artifact.svg` は最終 D2 パスの生の SVG、`svg` は合成済みの成果物。メタデータ形式1は維持し、合成フラグは追加しない（IR の render と Sumi 版で方式が分かる）。
- **統合テスト**: 固定 D2 v0.9.0 で3テーマ × 4方向、auto / explicit / partial のサイズ、入れ子・複数行日本語、両矢印・line・逆向き・自己ループ・多重エッジを描く。端点の最後の線分が footprint に垂直で、from/to の端に入ること、元の隙間が輪郭までの距離として0.01 unit以内で保たれること、bbox / 親の包含、metadata / 最終 D2 の一致、バイト決定性を確認する。合成単体では曲線の制御点・非対象バイト・異常プレースホルダ・miss / crossing の診断・各パスの backend 失敗を検査する。

### 6.14 #54 のカスタム輪郭の幾何 lint

- **領域の解決**: `createGeometryContext()` が outline ノードの合成後 bbox を renderer.draw() に渡し、`collision`（なければ silhouette の凸包）を GeometryElement.outline、`safeArea` の矩形を labelArea にする。純粋な幾何の再現のみで SVG / IR / renderer 出力は変更しない。既存ノードの shapeOutline / labelArea は維持する。
- **凸包と衝突**: 凸包は monotone chain で頂点の重複・一直線上の中間点を除く。カスタム部品が片方以上にあれば node-overlap は両者の凸領域の交差を検査し、通常部品同士は従来の bbox 判定を維持する。許容誤差は各領域を0.5 unitずつ縮めて吸収する。多角形は半平面の inset、楕円は半径の縮小による近似。多角形同士は分離軸、多角形/楕円は単位円への変換と辺との距離、楕円同士は GJK（最大64反復）。詳細・近似の限界は [lint 規則](../lint-rules.md#カスタム輪郭54) に記録する。
- **ルールの接続**: label-overflow は safeArea と strokeInset を検査する。label-collision は凸衝突領域を自動的に利用し、edge-crosses-label は合成後のラベルと経路を使う。祖先グループの包含除外・severity 設定・ソース位置の仕組みは変えない。独自の新しい規則は追加しない。
- **サイズの由来**: 2パス描画で元の両軸が未指定だったノードだけ NodeIR.autoSized を true にする。IR の寸法が補完されていても、overflow の位置と案内は label を指す。片軸以上が明示済みの場合は従来どおり props を指し label を related とする。この内部フラグを Figure YAML・D2・SVG に追加しない。
- **延長失敗の診断**: #53 の svg/outline-edge-miss と svg/outline-edge-crossing を引き継ぐ。描画の診断は lintRenderedFigure がすでに返すため、同じ内容の geometry 規則を増やさない。
- **検証**: 実際の D2 で3テーマ×2 renderer の自動サイズと安全領域を確認し、明示の台形が外接矩形には収まるラベルを safeArea overflow として報告すること、部分指定の props 位置を検査する。synthetic inspection で斜辺・stack の前面・角の空白・衝突・祖先除外・auto サイズの label 位置を固定し、明示 collision の採用・凸包・許容誤差・polygon/ellipse の交差を検査する。既存 fixture / gallery / examples の差分は不要。

### 6.15 #55 の台形・stack の公開

- **部品名と契約**: `sumi/trapezoid`（短縮名 trapezoid）、`sumi/stack`（stack）を node として登録する。placeholder は rectangle / auto。幅と高さの props は既存図形と共通の単位付き長さで、0.5pt刻み。variants は default / emphasis / muted。`since: 0.3.0` として次回機能リリース向けに追加する（この変更では package.json の版とリリースは変更しない）。
- **固定パラメータ**: trapezoid は slant 0.4、stack は layers 3 / offset 8 user unit。renderer は #52 の実装を再利用する。これらは catalog の render.params に出し、利用者の props としては公開しない。stack の文字は前面の safeArea に置く。
- **見た目**: 既存の汎用図形用 variant 定義を3テーマすべてに適用する。塗り・線・太字・文字色は Theme から来る。新しいドメイン固有の表現・スタイルキーは追加しない。
- **発見と説明**: catalog の description / variants / since / 説明付き props / render を公開する。ギャラリーは catalog から6枚（2部品×3テーマ）の SVG を生成し、各図に全 variant を含める。Skill に新部品の使い方・固定 props の境界と、コンテナ内で接続する YAML 例を追加する。
- **テスト**: 全組み込み部品×variant×Theme の既存描画テストを renderFigure 経由にし、outline が rect のまま出ていないことを検査する。公開ID・短縮名・metadata・props の単体テスト、3テーマ×3variant×4方向の接続をコンテナ内で描く統合テストを追加する。合成後の幾何 lint は診断ゼロ、塗り・線・stroke幅・layer数・bbox包含・端点clearanceを確認する。既存 examples の SVG / PDF は保つ。

### 6.16 #61 の画像方式 PPTX

- **API / CLI**: `src/render/pptx` の `svgToPptx(svg, { fontSet? }): Result<Uint8Array>`。`sumi render --format pptx` または `-o x.pptx`。出力先推論・矛盾検出・atomic write・geometry lint・JSON は既存と共通。stdout は SVG のみ。PPTX は図全体が1枚の画像で、図形・文字・矢印の個別編集は保証しない（#62 と分離）。
- **パッケージ**: 自前 ZIP32（固定時刻・固定順序）と OOXML。blank master/layout、1スライド、1つの `p:pic`、PNG の `a:blip` と SVG の `asvg:svgBlip`、内部 relationships、core/custom provenance。日時は入れない。
- **画像**: PDF と共通の import-free WASM に resvg 0.47.0 の直接依存と `picture` ABI を追加。同じ同梱フォントで usvg tree を作り、文字を path 化した SVG と原則192dpiの PNG を返す。PNG は8192px/辺・約1600万画素に制限する。CLI 自体にブラウザ・Office・.NET は不要。
- **サイズ**: 1pt = 12700EMU。画像の物理サイズと縦横比を維持し、PPTX の1〜56inch制約に合わせて小さな図には余白を加え中央配置する。56inch超は `pptx/unsupported-size`。JSON の size は図自身を指す。
- **診断**: `pptx/input-too-large` / `unsupported-size` / `missing-font` / `unresolved-font` / `engine-unavailable` / `conversion-failed` は共有 Diagnostic の error。変換失敗時はPPTXを書かない。幾何 error 時は従来どおり出力を書いて exit 1。
- **検証と配布**: 53ケースの固定 hash、ZIP/XML/relationships・画像・寸法・反復決定性を検査し、release workflow の4ターゲットでも実行する。独立した Open XML SDK 3.3.0 は通常版＋マゼンタPNG対照版106ファイルをOffice2019スキーマで検証する（検証専用で非同梱）。resvgと推移依存の固定版・原文は `licenses/pdf-wasm/` に含める。
- **保証範囲と実アプリ確認**: 生成は macOS/Linux × x64/arm64、実アプリの表示確認は PowerPoint for Mac（16.114.1）を対象とする。日本語/mask の通常版とPNG対照版を比較し、SVG表示を確認済み（[検証記録](../verification/61-pptx.md)）。Windows PowerPoint・Keynote・Google Slides は今回の保証対象外とし、確認をマージ条件には含めない。生成環境と閲覧アプリの対応範囲は別の契約として扱う。

### 6.17 #62 の実験的な編集可能 PPTX

- **選択**: PPTXの既定は画像方式。`--pptx-mode editable` で実験的DrawingMLを選び、`--pptx-connectors freeform|glued`（既定freeform）を指定する。PPTX以外での指定やmodeの矛盾はusage error。個別選択・編集だけを保証し、完全な表示一致・編集後のレイアウト維持・YAML逆変換は保証しない。
- **入力と出力**: 対応するfinalized SVGとFigure IRを再inspectし、描画順・bbox・M/L/C・同梱フォントで測ったラベルを使う。node/groupを個別`p:sp`、文字を`p:txBody`、edge labelをtext boxとして出す。複合輪郭はcustom geometry、楕円はpreset。コンテナは独立枠でPowerPointの階層groupにしない。
- **経路**: freeformは通常図形`p:sp`の開いた自由形状で経路を保持するが接着しない。gluedは標準`p:cxnSp`直線と接着参照を出し、元経路を捨てる。ラベルは固定。自己ループのgluedや非対応矢じりは診断で拒否する。PPTX固有の接着点であり、Figure YAMLの固定ポートは追加しない。
- **文字・矢じり**: 文字はlive textで、同梱fontの実family/weightを参照するが埋め込まない。閲覧側の置換を許容し、今回のMacではMS-Gothicを観測した。矢じりはSVG markerからDrawingML離散サイズへ近似する。角丸のcubic化や白背景labelによるmask近似も完全一致の保証には含めない。
- **共通基盤と検証**: 既存の決定的ZIP・blank slide・provenanceを共有し、画像方式のbyteを維持する。53入力×2modeのXML goldenとPPTX hash、独立スキーマ検証、全4生成ターゲットのbyte一致と配布smokeを検査する。追加runtime依存・WASM変更なし。
- **実確認と境界**: 生成はmacOS/Linux、実アプリはPowerPoint for Mac16.114.1。日本語fixtureで8個のobjectを保持し、文字変更と20pt移動を保存、freeformは非追従・gluedは追従と確認。自由形状`p:cxnSp`の対照は正常activationを確認できず公開構造から除外した。根拠・再現は [検証記録](../verification/62-editable-pptx.md)。

### 6.18 #82 のほぼ軸平行な端点

- **原因**: §6.13 は「最後の線分が水平/垂直」を厳密（1e-6）に要求していた。D2 はひし形・楕円・円の端を図形の輪郭まで辿り直すため、中心がわずかにずれたノードの間の直線のエッジは軸から少し傾く（例: v0.3.0 の再現図で 0.27° と 1.27°）。延長量が 0 の平らな辺でも warning になり、台形の斜辺では延長されず隙間（約 12〜15 unit）が残っていた。
- **実測**（D2 v0.9.0、合成前の経路）: 3テーマ × 4方向の再現図と、長短のラベルで幅の違う隣接ノード、台形の斜辺・stack への集中/分岐、§6.13 の統合テスト図、明示サイズの box との組み合わせ、ひし形・楕円・円 × ラベル × 台形ラベルの組み合わせ（左右方向で斜辺に入る）の計241図・カスタム輪郭の端770個を測った。軸から傾いた端は160個で、最大 1.302°（slides テーマ、32 unit の線分で横ずれ 0.95 unit）。横ずれは常に 1 unit 未満で、傾いた端はすべて反対側の端がひし形・楕円・円のエッジだった（box どうしの144端は全て 0°）。台形の斜辺に傾いて入る端は延長量 11.9〜15.3 unit。修正後は同じ図で `svg/outline-*` の warning が0件になり、全ての端で輪郭までの距離が D2 の隙間と 0.01 unit 以内で一致した。
- **許容角度**: 端の進行方向（最後の線分の向き）と、射線が最初に当たる footprint の辺の内向き法線のなす角が **5°** 以内なら「法線方向から入る」とみなす（`ENDPOINT_ANGLE_TOLERANCE_DEG`）。実測の最大値に約4倍の余裕があり、1 unit の横ずれなら 11.5 unit 以上の線分まで受け入れる。軸ではなく当たった辺の法線で測るので、ほぼ水平でも上辺をかすめる射線は拒否する。これより大きな傾き（斜めの経路、曲線や角への進入）は D2 の端点の性質が変わったとみなして従来どおり警告する。
- **延長**: 端の実際の進行方向の射線で footprint と輪郭への距離を求め、その差だけ端点（曲線では制御点も）を射線に沿って動かす。D2 が空けた距離と矢じりの向きは保たれ、延長区間は斜めになりうる。既存の安全条件（footprint と輪郭の両方に当たる、輪郭が footprint より手前にない（0.01 unit 以内）、延長区間の交差検査 `svg/outline-edge-crossing`）は維持する。端点が footprint の内側にある場合も `svg/outline-edge-miss` にする（入る辺を決められない）。
- **延長不要の端**: 射線上で輪郭と footprint が一致する（|延長量| ≤ 1e-6）端は変更不要なので、角度によらず warning にしない。描画は D2 の矩形の端点のままで、組み込み部品と同じ見た目になる。
- **後段との整合**: 幾何 lint は合成後の経路を inspect し直して使うので、斜めの延長区間もそのまま検査される（追加規則なし）。編集可能 PPTX の freeform は合成後の経路をそのまま書き、glued は端点に最も近い接続点へ接着する（経路の向きに依存しない）。軸に平行な端の処理・出力は変わらないため、ギャラリー・examples・PDF・PPTX の golden は変わらない。
- **テスト**: 再現図（`tests/fixtures/outlines/nearly-aligned.sumi.yaml`）と、最大角度で台形の斜辺に入る図（`slanted-side.sumi.yaml`）を実際の D2 で描き、診断ゼロ（幾何 lint 込み）、輪郭までの距離が D2 の隙間と 0.01 unit 以内で一致、延長が射線方向であること、PPTX 両方式の生成を確認する。図が傾いた経路を作り続けていることもテストで確認する。合成単体では許容角度の境界（4.9° は延長、5.1° は warning）、急な角度、footprint 内の端点、延長不要の急な端を検査する。

### 6.19 #88 の構造的配置のスキーマと検査

[#86 の調査](../research/86-paper-figures.md)（§2.1・§3.5・§9.1）の段階 A の 1 件目。配置エンジン・経路・SVG 出力は #89〜#91 で、この節はスキーマ・正規化・検査だけを扱う。すべて Figure v1 への任意フィールドの追加で、既存の図の正規化結果に `figure.layout.engine: auto` が加わる以外、診断・IR・D2・SVG・PDF・PPTX は変わらない。

- **フィールド**（すべて strict）:
  - `figure.layout.engine`: `auto`（D2/ELK、従来）| `structured`。`figure.layout.arrange`: root の配置の木。`groups[].arrange`: group の子の配置の木。`nodes[].attach: { to, side, gap? }`: 配置の木の外で、`to`（node か group）の `side` 側に `gap` 離して置く。`edges[].fromAnchor` / `toAnchor`: `"<side>"` か `"<side>:<0..1>"`（north/south では左→右、east/west では上→下の位置。省略時 0.5）。
  - 配置の木の箱は `stack`（縦。`direction: down|up`、既定 `down`）か `row`（横。`right|left`、既定 `right`）のちょうど 1 つ。`gap`（長さ）・`align`（`start|center|end|stretch`）・`items`（1 個以上。ID か入れ子の箱）。`gap` と `align` は省略を保ち、既定値（Theme / Profile の間隔、同じ軸の箱からの揃えの継承）は配置エンジン（#89）が決める。
  - 長さは単位付き（`3mm`・`6pt` 等、§5.1 の単位パーサ）で、`0` だけは単位なしで書ける。負の値は不可。正規化後は pt の数値。辺は north/east/south/west（調査の試作と同じ語。図の上下左右と一致し、`direction` の up/down と混同しない）。
- **engine の推定（判断）**: `engine` を省略した場合、**`figure.layout.arrange` があれば `structured`、なければ `auto`** とする。正規化は schema 段で行い、以降の段は常に具体的な engine を見る（推定は `figure.layout` だけで決まるので、要素を読む前に確定できる）。
  - 理由: 利用者の判断（2026-10-26、扱いやすさを優先）に従い、structured の図に `engine:` を書かなくてよくする。structured の図には root の配置の木が必ず要る（root の要素を置く場所がほかにない）ため、`arrange` を書くこと自体が structured を選んだ明確な合図になる。
  - 「structured 専用のフィールドがどれか 1 つでもあれば structured」とする案は採らなかった。`auto` の流れ図に `toAnchor` を 1 つ足しただけで図全体が structured になり、全要素の `layout/unplaced` が並ぶ。根の `arrange` だけで決めれば、同じ誤りは `toAnchor` の位置の `layout/structured-only` 1 件になり、直し方（`arrange` を足すか、フィールドを消す）がそのまま分かる。
  - `auto`（明示・推定とも）で structured 専用フィールド（`figure.layout.arrange`・`groups[].arrange`・`nodes[].attach`・`fromAnchor` / `toAnchor`）を使うと、各フィールドのキーの位置に `layout/structured-only`（error）。黙って無視しない（#57 の方針）。`figure.layout.direction` は `auto` 専用で、structured では使わない（各箱が向きを持つ）。既定値があるため、書いてあっても診断は出さない。
- **配置の規則（判断）**: structured では、すべての node と group が、**どれか 1 つの配置の木の項目として、または `attach` で、ちょうど 1 回**置かれる（調査 §2.1）。
  - `figure.layout.arrange` は root の要素を、`groups[].arrange` はその group の子を置く。**配置の木の項目は、その木の持ち主の子になる**（group の木なら group の子、root の木なら root）。`attach` した node は**対象と同じ親**になる。`group:` を省略すると、この所属を正規化で補完する（以降の段・IR・lint は補完後の `group` を見る）。`group:` を書いてあって所属と食い違えば `layout/group-mismatch`（配置した位置に出し、related に `group:` の位置）。
  - 判断: 所属を配置から決めるのは、調査 §2.1 の「`arrange.items` に入れた要素はその group の子」に従い、同じ情報を 2 か所に書かせないため。`attach` を対象の親に揃えるのは、図 A の `N×`（group の横の注記）や位置エンコーディングの記号のように、添える要素は対象と同じ階層に描くのが自然で、group の枠の内外が配置と食い違わないようにするため。
  - 診断（stage `layout`、すべて error、YAML の位置付き）: 木の項目の未知の ID は `layout/unknown-item`（近い ID、edge の ID なら「edge は置かない」を hint に）、`attach.to` の未知の ID は `layout/unknown-attach-target`、2 回目以降の配置は `layout/duplicate-placement`（ファイル上で後の方に出し、related に最初の位置）、どこにも置かれない要素は `layout/unplaced`（要素の `id` の位置。置くべき木を hint に）、`attach` の循環（自分自身を含む）は `layout/attach-cycle`、配置の木を通した group の入れ子の循環は `layout/group-cycle`（`group:` だけの循環は従来どおり `ref/group-cycle`）、不正な anchor は `layout/invalid-anchor`（近い辺を hint に）。
  - anchor の形式を schema 段の正規表現でなく layout 段で検査するのは、anchor の妥当性が端点に依存しうるため（段階 C のセル端点 `sequence.a5` 等）。JSON Schema には同じ pattern を載せ、エディタでの補助は保つ。長さ・箱の形（stack / row のちょうど 1 つ）・`side`・`align`・`direction` の誤りは schema 段の `schema/*`。
  - 無効化（§0 の規則）: 前段までに invalid になった要素（未知のフィールド・重複 ID・未知の参照など）には layout の診断を出さない。ただしその要素の配置の木と `attach` も「置いた」と数え、木の項目を `layout/unplaced` にしない（その項目は無効な group の子として診断なしで invalid になる）。layout 段の誤りは、その誤りの要素（重複して置かれた要素、食い違う要素、未知の対象に attach した node、不正な anchor の edge）を invalid にし、配置の木の持ち主は invalid にしない（未知の項目が 1 つあっても、その group の他の子の検査を続けるため）。
  - 依存の伝播: 共通の `invalidateDependents()` に「`attach.to` が無効な node は無効」を加え、group の子・edge の端点と同じく推移的に伝播する。layout 段の中でも、親の比較・`layout/unplaced` の前後で伝播するので、無効な要素に連なる attach の鎖や子には重ねて診断を出さない。後段（component 等）で無効になった対象に attach した node も、同じ関数で無効になる。置かれていない group の中の要素は、宣言の順序によらず、最も外側の置かれていない要素だけを報告する。`attach.to` が読めないコレクション（schema 段の error）のために確かめられない場合も、診断なしでその node を invalid にする。読めない group / node がある場合は、その木が読めないので `layout/unplaced` を出さない（誤検出を避ける）。
- **描画（暫定）**: structured の図は `sumi lint` で上記をすべて検査できる。`sumi render`（`compileFigure()`）は、検査が通っても D2 には渡さず `layout/engine-unavailable`（error、`figure.layout.arrange` か `engine` の位置）で止める。#89〜#91 で structured のエンジンが入るときに外す。`lintRenderedFigure()` は、検査時と描画時の両方で出る stage `layout` の診断を、`lintFigure()` と同じものだけ重複として除く。 **#91 で `layout/engine-unavailable` を外した**（§6.23）。
- **その他**: `sumi fmt --canonical-order` は `figure.layout`（engine → direction → arrange）、group（… → group → arrange）、node（… → group → attach）、edge（id → from → fromAnchor → to → toAnchor → …）、`attach`（to → side → gap）と配置の木の箱（direction → gap → align → items、入れ子も）をスキーマ順にする。`lint/duplicate-edge` は structured の図で anchor も比較し、`south:0.15` と `south:0.85` に入る 2 本を重複としない（`south` と `south:0.5` は同じ）。
- **検証**: 各診断のコード・パス・行・列、engine の推定と正規化、所属の補完、`auto` での拒否、`compileFigure()` での停止を単体テストで固定した。図 A の理想の YAML（調査の `figures/ideal/a-transformer.sumi.yaml`）は、`requires` を外すと残る診断が後続の Issue の範囲（`tone` / `icon` の `schema/unknown-field`、`operator` / `junction` の `component/unknown`。#92・#94）だけであることをテストで確かめる。それらを既存の部品に置き換えた `tests/fixtures/figures/layout/a-transformer.sumi.yaml` は、構造 lint を含めて診断ゼロ。

### 6.20 #92 の operator・junction・tone と color テーマ

[#86 の調査](../research/86-paper-figures.md)（§2.1・§9.1 の Issue 5）。すべて追加で、`tone` を書かず新しい部品も使わない図の診断・IR・D2・SVG・PDF は変わらない（既存の examples・ギャラリーの SVG はバイト単位で同じ）。

- **`tone` はフィールド（props ではない）**: `nodes[].tone` と `groups[].tone`（任意）。値は Sumi が固定する 8 色名 `gray | red | orange | yellow | green | blue | purple | pink`（`src/core/theme/tones.ts`。スキーマの enum なので未知の名前は `schema/*`、エディタ補完が効く）。
  - 理由: tone は `variant` と同じく「Theme が見た目を決める、部品をまたいだ選択」で、部品の意味（props）ではない。props にすると全 manifest に同じ prop を宣言させることになり、部品の契約と見た目が混ざる。調査の提案（node のフィールド）どおり。group にも同じ規則で付けられる（追加の費用がほぼない）。edge の tone（調査の段階 C）は対象外（#177 で追加、§6.54）。
  - 名前の集合を閉じるのは、どの Theme でも同じ図が描けるようにするため（Theme ごとに名前が違うと、`--theme` の切り替えで図が壊れる）。名前は色相だけで、分野の意味を持たない。
- **Theme の `tones`**: `tones.<tone>` は部分スタイルで、**色だけ**（`fill`・`stroke`・`fontColor`）を書ける。他のプロパティは `theme/inapplicable-property`、未知の tone 名は `theme/unknown-tone`。解決順は §4.3 の最後に足す: kind 既定 → `base` → `components.<id>.default` → `<variant>` → **`tones.<tone>`**（tone を書いた node / group だけ）。色だけなので、文字の大きさ・フォント・線幅は変えず、Profile の文字サイズ検査・カタログの文字サイズ・bold/italic の検査に影響しない。variant との組み合わせは「tone の色が後勝ち」（例: academic の emphasis は灰色の塗りと太線だが、tone を付けると塗りだけ tone の色になり、太線は残る）。Theme が定義しない tone は `theme/missing-tone`（warning、`tone` の位置）で、その tone なしで描く。組み込み Theme は 8 色すべてを定義する。
- **既存 Theme の写像（判断）**: `minimal`・`academic`・`slides` は単色のまま（利用者の判断 2026-10-26: academic に色を入れない）。tone は 3 段の灰色の塗りに写す: 明 `yellow`・`green`、中 `gray`・`orange`・`blue`、暗 `red`・`purple`・`pink`（minimal / academic は `#f2f2f2`・`#e3e3e3`・`#d4d4d4`、slides は投影で薄い灰色が飛ぶので `#ebebeb`・`#d9d9d9`・`#c7c7c7`）。図 A のように隣り合いやすい組（orange / blue のブロックと yellow の Add & Norm、purple と green）が別の段になるよう割り当てた。同じ段の tone は単色 Theme では見分けられない（すべてを区別するなら `color`）。グレースケールで印刷できる方針は保つ。
- **新しい Theme `color`（判断）**: 論文専用ではない汎用の色つき Theme（利用者の判断 2026-10-26）。線・文字・大きさは `minimal` と同じ（8pt、1pt / 2pt の線）で、tone は淡い色の塗り（文字色 `#1f2328` とのコントラスト 11:1 以上）、emphasis は青のアクセント（`#0969da`）の太線と太字、muted は灰色。名前は「色を使う」ことだけを表す（`academic-color` のような用途名にしない）。`presentation-16x9`（14pt 以上）には `minimal` と同じく合わない。
- **部品 `sumi/operator`**: 記号の入った小さな円（props `symbol`: `plus` + / `minus` − / `times` × / `dot` • / `concat` ‖、必須）。variant は default / emphasis / muted、tone 可。**`sumi/junction`**: 線が分かれる・合流する点（props なし、variant は default / muted、tone 不可）。どちらも 0.4.0 から。
- **manifest の `mark`（判断）**: 2 つの部品は「ラベルの代わりに決まった印を描く node」として、manifest に任意の `mark` を持つ（カタログにもそのまま出る。他の部品には付けない）。
  - `{ type: "glyph", prop, glyphs, size }`: `props[prop]`（文字列の enum。値は `glyphs` のキーと一致することを登録時に検査）に対応する文字を、ラベルとして中央に描く。直径は `size` × 実効の文字サイズ。operator は `size: 2`（同梱フォントの記号の advance の箱は最大 1em 四方で、内接円に枠線の分も含めて収まる。`geometry/label-overflow` を満たす最小の切りのよい倍率）。
  - `{ type: "point", size }`: 図形だけを描く。直径は `size` × 実効の線幅。junction は `size: 3`（academic 1.5pt、minimal 3pt、slides 6pt。線の太さに合わせて点が大きくなる）。Theme は junction を線の色で塗る（`fill` = `stroke` = 線の色）。
  - 共通: `mark` のある node は**ラベルを取らない**（空白以外のラベルは `component/unexpected-label`、error）。大きさは Theme から決まるので、manifest は `width` / `height` の props を持てない（登録時に検査）。`sizing: fixed-aspect-1` を要求する。`lint/empty-label` は対象外。glyph の node は文字を描くので、Profile の最小文字サイズの検査と `lint/missing-glyph`（記号の文字を `props.<prop>` の位置で検査。IR と同じ `markText()` を使う）に含め、point の node はラベル（空白だけでも）があっても文字を描かないので含めない。point の node に `tone` を書くと `component/tone-unsupported`（error。点は線の色で描く）。
  - 大きさは D2 の unit（0.5pt）に丸める（最小 1 unit）。利用者が書いた長さではなく導出した値なので、§5.1 の「丸めない」規則の対象外。
  - 部品ごとの特別扱いをコンパイラに書かず、manifest の宣言から IR を作るために `mark` にした。既存の `render`（カスタム輪郭）は Figure の props を受け取れない（params は manifest に固定）ため使わなかった。
- **`auto`（D2/ELK）での描画**: IR は `mark` を保持し、`label` を glyph の文字（point は `""`）、`width` = `height` を mark の大きさにする。D2 では operator は明示サイズの `circle` にラベルとして記号を置き、junction は明示サイズの小さい `circle`（塗りつぶした点）になる。明示サイズなので、入力が複数でも ELK は円を引き伸ばさない（`geometry/aspect-distorted` なし。3 入力・4 出力で確認）。記号はフォントの文字なので、PDF・PPTX でも文字として残る。junction へ入る線は `line` にするのがよい（矢じりが点を覆う）。
- **構造的配置（#90・#91）への引き継ぎ**: 契約は「ラベルなし・Theme から決まる正方形の footprint」まで。structured の配置は IR の `width` / `height` をそのまま footprint に使える。junction のネットの共有・向きの自由な端点は #90、structured での記号の描き方（文字か線分か）と junction を描くかどうか（Theme の塗りが透明でなければ点を描く、等）は #91 が決める。
- **カタログ**: `sumi catalog --json` の Theme の項目に `tones`（その Theme が色を持つ tone 名。`TONE_NAMES` の順）を追加した（§6.10 の「同じ版ではフィールドの追加だけ」に従う）。部品の項目は mark のある部品だけ `mark` を持つ。
- **ギャラリー**: operator は variant ごと・記号ごとに `box` から指す行、junction は variant ごとに `box` → 点 → 2 つの `box` を描く（mark はラベルを取らないため、サンプルの生成で分岐する）。全部品 × 全 Theme に `color` が加わり、tone は `docs/gallery/tones/`（全 tone と tone 付きの group・operator を全 Theme で）に描く。
- **検証**: manifest の `mark` の検査、`unexpected-label`・`tone-unsupported`・`missing-tone`・`unknown-tone`・tone の色以外のプロパティ、解決順（variant の後）、IR の大きさとラベル、D2 の出力、既存 Theme の出力が tone なしでは変わらないことを単体テストで固定した。図 A の理想の YAML は、`requires` を外すと残る診断が `icon` の `schema/unknown-field`（#94）だけになる（#94 の後は診断ゼロ。§6.25）。

### 6.21 #89 の構造的配置エンジンと Layout IR

[#86 の調査](../research/86-paper-figures.md)（§3.2・§3.5・§9.1）の段階 A の 2 件目。§6.19 で検査した structured の図から、要素の矩形とラベルの箱を求める配置エンジンと、その結果の型 **Layout IR** を `src/layout/` に置く。経路（#90）と SVG 出力（#91）はまだないため、`compileFigure()` は §6.19 のとおり `layout/engine-unavailable` で止めたままとし、エンジンは単体のモジュールとしてテストする（`layoutStructured(ir, { profile?, measurer? })`、検査から配置までを通す `layoutStructuredFigure(text)`）。`auto` の経路（D2 ソース・SVG・PDF・PPTX）は変えていない。

- **Figure IR への追加**: `meta.engine`（`auto` | `structured`）、root の配置の木 `arrange`、`GroupIR.arrange`、`NodeIR.attach`（`{ to: ElementKey, side, gapPt }`。gap 省略は 0）、`EdgeIR.fromAnchor` / `toAnchor`（`parseAnchor()` 済みの `{ side, offset }`）。配置の木の箱は `{ kind: stack|row, direction, gapPt?, align?, items: (ElementKey | 箱)[] }` で、`gapPt` と `align` は省略を保つ（既定値はエンジンが決める）。`gapPt` は §6.19 のとおり pt の数値で、量子化しない。
- **Layout IR**（`src/layout/ir.ts`）: 計算方法によらない幾何の型。将来 ELK を直接使う backend（#57 §5）も同じ型を返す（ELK の node の x/y/width/height → `rect`、group の子の領域 → `content`）。**幾何だけを持ち、見た目は持たない**: 部品・アウトラインの renderer と params・実効スタイル（線幅・矢じり・色）・フォントセットは Figure IR にあり、消費者（#90・#91）は **Figure IR と Layout IR を `ElementKey` で突き合わせて**使う（YAML に戻らない）。

  | 項目 | 内容 |
  | --- | --- |
  | 座標系 | SVG の user unit（1 unit = 0.5pt。D2・`inspectSvg()` と同じ）、y は下向き、原点はキャンバス左上（余白はキャンバスの内側） |
  | 丸め | すべての座標を 1/1000 unit に丸める（`roundUnits`: 0 から遠い方へ、`-0` なし）。矩形は**辺**（左・上・右・下）を丸め、幅・高さはその差とする。丸める前に接していた矩形（`gap: 0` の積み重ね）は丸めた後も厳密に接する |
  | `engine` | 結果を作ったもの（`sumi-structured`）。#91 で SVG の metadata の `backend` に書く（調査 §3.5） |
  | `canvas` / `margin` / `content` | キャンバス（整数 unit）、内容と各辺の最小の余白、node・group・ラベルの外接矩形（エッジは経路が決まるまで含まない） |
  | `groups` | `{ key, parent?, rect, content, label? }`。group の木の前順（親が先、同じ階層は文書順）。`content` は padding とラベルを除いた、子を置く領域 |
  | `nodes` | `{ key, parent?, shape, rect, placement: arrange|attach, label? }`、文書順。`rect` は図形の外接矩形（stroke を含まない。inspect の `bbox` と同じ定義）。`shape: text`（`sumi/label`）は図形を描かない |
  | `edges` | `{ key, from, to, fromAnchor?, toAnchor?, labelMetrics?, route? }`、文書順。配置エンジンは経路を作らず、`route` は省略。ラベルは計測だけして（`labelMetrics`）置かない |
  | ラベル（`TextLayout`） | 描く行（改行で分割し、`xml:space` のない `<text>` と同じく空白を畳んだもの）、行ごとの幅、フォント class（inspect の `font` と同じ名前: `regular` / `bold` / `italic` / `mono` / `mono-bold` / `mono-italic`。bold と italic の両方なら bold）、`fontSizeUnits`、`lineHeightUnits`、`ascentUnits` / `descentUnits`、`box`（**行の箱**: 各行の `lineHeightUnits` を積んだ組版上の箱で、字形の外接矩形ではない。幾何 lint が再計測する各行の ascender〜descender の箱は、行送り ≥ ascender + descender なのでこの中に収まる。空行も高さを取る）、`anchor`（x = 中心、y = 1 行目のベースライン。各行の行送りの中央に ascender〜descender を置く CSS の half-leading） |

  - **#90（経路）への契約**: 入力は Layout IR。`route.points`（始点は source の輪郭上、終点は target の輪郭上、直交の折れ線）と、ラベルを置いた `route.label`（`TextLayout`）を埋めた Layout IR を返す。anchor のない端は経路側が辺を選ぶ。経路がキャンバスからはみ出す場合は、ルータが `content` と `canvas` を広げる（配置エンジンは経路を知らない）。`junction`（#92）は大きさ 0 の `rect` になりうる。矢じりの有無・線幅は Figure IR の `EdgeIR` を見る。アウトライン部品の輪郭は `rect` と Figure IR の `render` から `draw()` で得る。
    - `EdgeRoute` は**エッジ 1 本ごとの平坦な折れ線**（ELK の edge section を連結したもの）だけを表す。共有の幹線（調査 §4.1）は各エッジの折れ線に重なった区間として含め、「幹線を 1 回だけ描く」「ネットの ID」「解決済みのポートの位置」が必要なら、#90 が追加のフィールド（例: `nets: { id, edges, segments }[]`、`route.sourcePort` / `targetPort`）として加える（既存のフィールドは変えない）。ELK の分岐する section を区間のまま持つ必要が出た場合も同様に追加で表す。
  - **#91（SVG writer）への契約**: §6.3 の inspect 契約に合わせ、`groups`（前順）→ `nodes` → `edges` の順に描く。node・group の `g.shape` の図形の外接矩形が `rect` と一致するように描き、ラベルは `anchor` を `text-anchor: middle` の `<text>` の x / 1 行目の y とし、2 行目以降は `lineHeightUnits` ずつ下げる（`font-size` は `fontSizeUnits`、フォント class は `font`）。group のラベルは `rect` の上端に置かれている。`xml:space` は付けない（計測は畳んだ空白で行っている）。幾何 lint は同じ TTF・同じ空白の畳み方で再計測するので、行の文字列と行ごとの幅は IR と一致し、lint の字形の箱は IR の行の箱に収まる（テストで確認）。
- **アルゴリズム**（`src/layout/structured/engine.ts`。試作 `proto/layout.ts` と同じ 1 パスの箱モデル）: 葉の大きさを計測し、箱を下から上へ計測し（stack は高さの和＋間隔、幅は最大。row は逆）、上から下へ置く。`direction: up / left` は項目の順を逆にする。`align` は交差軸の位置で、`stretch` は伸ばせる項目（入れ子の箱・group・`text` / `circle` / `square` 以外の形で、アウトライン部品でなく、その軸の明示サイズがない node）を箱の幅（高さ）に伸ばし、伸ばせない項目は中央に置く。主軸に余りがある箱（伸ばされた箱）は項目を中央に寄せる。**揃えの継承は同じ軸の箱どうしだけ**（stack の中の stack）。軸の違う入れ子の箱・group の配置の木の根・root の木は `center` から始まる。最後に、内容の左上を余白の位置に移して丸め、キャンバスは内容＋両側の余白を整数 unit に切り上げる。
- **attach と親の大きさ**: attach した node は対象の `side` の中央に、`gap` 離して置く（連鎖可。順序は文書順に、対象が置かれたものから）。node は対象と同じ親に属し（§6.19）、**親の内容は配置の木と attach した node の和**とする。group は attach した node を収めるまで大きくなり（例: 対象が group の西端にあれば、その分 group が左に広がる）、root ではキャンバスが広がる。はみ出し量は配置の木の自然な大きさでの配置で測る。group が親の `stretch` やラベルの幅で自然な大きさより広くなった場合、余りは配置の木に渡し、はみ出し量は変えない。余りは項目を中央に寄せる（両端から遠ざかる）、`start` / `end` の項目を端に保つ、すでに端まで届いている `stretch` の項目を広げる、のいずれかにしかならないので、対象の辺の中央に置く node が自然な配置より外に出ることはない。反復は不要（1,000 個の乱数の図で、attach した node を含むすべての子が親の `content` に収まることをテストで確かめる。種は固定）。
- **既定値（判断）**: Profile の `layout` に structured 専用の値を追加した（`auto` の値は変えない。調査 §3.5）。Profile 定義で省略すると paper 系の値になる（既存の定義はそのまま通る）。カタログ（`sumi catalog`）の profile の項目は変えていない。

  | 項目 | paper 系 | presentation-16x9 | 用途 |
  | --- | --- | --- | --- |
  | `layout.arrangeGap` | 4mm | 8mm | `gap` を省略した stack / row の間隔（試作の既定 4mm）。stack と row に共通なので、Issue 例の `stackGap` ではなくこの名前にした |
  | `layout.groupPadding` | 8pt（16 unit） | 16pt | group の内側の余白（4 辺）。`auto` の `containerPadding`（ELK、4mm）とは別。試作の 16 unit |
  | `layout.nodePaddingX` / `nodePaddingY` | 7pt / 3.5pt（14 / 7 unit） | 14pt / 7pt | ラベルと図形の間の余白（左右 / 上下）。試作の箱の余白 |

  - 余白（キャンバスの縁）は Profile の `margin` を `auto` の `--pad` と同じく整数 unit に丸めた値（paper 系 2mm → 11 unit）。試作の 11 と同じ。
  - 行送りはフォントサイズの 1.25 倍（試作と同じ。`LINE_HEIGHT`）。
  - group のラベルは上端の padding の下に置き、ラベルの高さ（整数 unit に切り上げ）と padding の半分を内容の上に取る。group の幅はラベルの幅以上。試作は group のラベルを描かない（fixture の group にはラベルがない）。
- **葉の大きさ**（`sizing.ts`）: ラベルの箱 `w × h` と、余白を足した `P = ⌈w + 2x⌉ × ⌈h + 2y⌉` から、形ごとに「余白込みのラベルが幾何 lint の label area（`lint/geometry/shapes.ts` の `labelArea()`）に収まる最小」を整数 unit で求める。明示の `width` / `height` が優先（circle・square などの固定比の部品は、片方だけ書いてもその値の正方形）。
  - アウトライン部品（#53。`sumi/trapezoid`・`sumi/stack`）: renderer の `footprint(P)` を切り上げた大きさ（`auto` の 2 パスの寸法決めと同じく、`P` を `safeArea` に収める）。ラベルは `draw()` した `safeArea` の中央に置く。`stretch` では伸ばさない（伸ばすと renderer の `safeArea` が変わり、たとえば縦に伸びた台形は斜辺が深くなってラベルが収まらなくなるため）。
  - rectangle・page: `P`。text: `⌈w⌉ × ⌈h⌉`（試作の label と同じ）。square: `max(P)` の正方形。
  - circle: 直径 `⌈max(h + 2y, hypot(w + y, h + y))⌉`。1 行の箱と同じ高さ以上で、ラベルの箱を各辺 `y / 2` 広げたものが円に収まる。1 文字のラベル（`+`・`·`・`~`）では 34 unit で、試作の円（アイコン用に 34 固定）と一致する。
  - oval: `⌈P·√2⌉`。diamond: `2P`。hexagon: 高さ `P.h`、ラベルの上端の高さで斜辺の内側に収まる幅。parallelogram: 高さ `P.h`、D2 の斜辺（26 unit）をよける幅。cylinder: `P` の高さに蓋（D2 の 24 unit × 3）。document: 高さを波線より上の割合で割る。cylinder と document はラベルを label area の中央に置く（他は図形の中央）。
  - 全形・数種のラベルで label area に収まることをテストする。新しい形は `naturalSize()` の網羅的な `switch` に追加が要る（型検査で漏れが分かる）。#92 の operator / junction は circle の形で、mark（§6.20）の大きさが IR の `width` / `height` に入るので、固定比の明示サイズとしてそのまま使う（operator は 2 em = 32 unit、junction は線幅の 3 倍 = academic で 3 unit）。
- **文字の計測**（`src/layout/text.ts`）: 幾何 lint（§6.5）と同じ TTF の reader（`loadFontMetrics`、`hmtx` の advance の和、kerning・shaping なし、`hhea` の ascender / descender）と同じ空白の畳み方（`renderedLines`）を使う。依存は追加していない（`bun build --compile` への影響なし）。`TextMeasurer` を差し替えられるので、テストは固定の字幅で厳密な座標を確かめる。
- **試作との一致（受け入れ条件）**: 試作と製品の両方が読める図で、全 node・group の矩形を比べる。図は 2 組: (1) `tests/fixtures/figures/layout/` の図 A と図 B の 1 パネル（operator / junction / icon を 1 文字のラベルの circle に、tone・キャプション・数式ラベルを除いた版）、(2) 調査の理想の YAML（`figures/ideal/`）そのものから、後の Issue の範囲（`requires`、`icon`（#94。`~` のラベルにする）、`caption`（段階 B））だけをテストの中で除いたもの。(2) では operator / junction の大きさが設計上異なる（#92 は 32 / 3 unit、試作は 18 / 0）ため、試作に製品の大きさを渡して配置を比べる（`research/86-paper-figures/proto/engine-parity.test.ts`。研究のコードが製品を参照し、逆はない）。

  | 図 | 要素 | 最大の差 | キャンバス |
  | --- | --- | --- | --- |
  | A（Transformer） | node 30・group 2 | 0.001 unit | 513 × 898（一致） |
  | B の 1 パネル | node 16・group 1 | 0 | 387 × 718（一致） |
  | 理想の A（operator / junction / tone あり） | node 30・group 2 | 0.01 以内 | 511 × 803（一致） |
  | 理想の B パネル | node 16・group 1 | 0.01 以内 | 387 × 621（一致） |

  - 0.001 の差は丸め方の違い（試作は x と幅を別々に丸め、製品は辺を丸める）による。計測したラベルの幅・高さも一致する。
  - 設計上の違い（fixture では差が出ない）: 試作の circle は 34 固定で、製品の circle はラベルから大きさを決める（上記）。operator / junction の大きさ（上記）。試作は group のラベルを無視し、キャプション（段階 B）を持つ。試作は空白を畳まない。試作は明示サイズを持たない。試作は margin を 11 に固定、製品は Profile から（paper 系で同じ 11）。
- **決定性**: 図 A・B の Layout IR を JSON にした golden（`tests/fixtures/layout/*.layout.json`、`SUMI_UPDATE_GOLDEN=1` で更新）とバイト単位で比べ、2 回の実行の一致も確かめる。探索・反復・乱数・Map の走査順への依存はない（出力の並びは文書順と group の木の前順）。
- **#91 で確認**: Layout IR から作った SVG で `exceeds-page-*` などの既存の幾何 lint が働くこと（§6.23。図 A の fixture は paper-single の幅を超え、`geometry/exceeds-page-width` だけが出る）。

### 6.22 #90 の直交ルータ

[#86 の調査](../research/86-paper-figures.md)（§4）の段階 A の 3 件目。§6.21 の Layout IR を受け取り、全エッジの `route` と `nets` を埋める直交ルータを `src/layout/route/` に置く。`layoutStructuredFigure(text)` は検査 → Figure IR → 配置 → **経路**まで通す（`{ route: false }` で配置だけ）。単体の入口は `routeEdges(ir, layout)`（`{ layout, diagnostics }` を返し、経路のないエッジがあっても他のエッジの経路を持つ Layout IR を返す）。SVG writer（#91）がまだないため、`compileFigure()` は §6.19 のとおり `layout/engine-unavailable` で止めたまま。`auto` の出力（D2・SVG・PDF・PPTX・lint の golden・ギャラリー）は変えていない。

- **端点（`ports.ts`）**:
  - anchor があればその辺と位置。ない端は、相手の中心へ向かう向きのうち、差の大きい軸の辺（同じなら縦）。位置は 0.5。#134 から、2 つの要素を分ける配置の木の箱があればその向きの辺（stack なら北 / 南、row なら東 / 西。§6.33）、`figure.layout.fanIn: spread` では別の要素から同じ口に入る端を並べる（§6.33）。
  - **同じ 2 要素の間のエッジ**（多重辺・`a → b` と `b → a` の閉路）で、ある要素の同じ既定の辺を使う端は、文書順に位置 1/(n+1) … n/(n+1) に振り分ける。平行な別の線になり、重ならない（anchor を書いた端は動かさない）。
  - **入りと出が同じ口を使う場合（#113）**: 上の振り分けの後、同じ口（要素・辺・点・向き）から出る端と入る端が両方ある口は、片方の向きの端をまとめて辺に沿って動かす。下のネットは向きごとなので、動かさないと 2 つのネットが口の stub を共有し、`api → worker` と `worker → store` が `api → store` に読める（[調査 #109](../research/109-dogfood-v0.4/README.md) の A2）。
    - **動かす側（判断）**: anchor を書いた端は動かさない（上の振り分けと同じ契約。`checkRoutes` も anchor の位置を検査する）。両方の向きが動かせるなら、相手の端と一直線（辺に垂直な同じ線上）のエッジが少ない向き、次にエッジが少ない向き、次に出る向きを動かす。両方に anchor があれば動かさず、文書順で後の向きのエッジを `layout/no-route`（「出る辺と入る辺が同じ点に anchor されていて線を共有する」）にする。別のネットのまま重ねて描くと #113 の誤読そのもので、検査でも重なりになるため、黙って描かない。
    - **動かす先**: 位置 `o` から辺の端までの中点（`o / 2` か `(o + 1) / 2`。0.5 なら 0.25 / 0.75）。向きは動かす端の相手の平均の側、同じなら残る端の相手と反対の側、それも同じなら正の側。辺の角（0 / 1）では反対側。多重辺の振り分け（1/3・2/3 など）と同じ幅にしなかったのは、口がもう 1 つ増えるだけなので、辺の中央からの距離を大きくして 2 本の線の間を空けるため。動かす先が**平行な辺**（同じ 2 要素を同じ向きに結ぶ辺）の端の点なら、反対側の半分、次に辺の空いた位置に置く（#143、§6.35）。
    - **一直線を保つ**: 動かした端のエッジが向かい合う辺どうしの直線だった場合、相手の端に anchor がなく、その口を他のエッジが使っていなければ、相手の端も同じ座標に動かす（再現の `api → worker` は直線のまま上にずれる）。動かした先が別の口と重なれば次の周回で同じ処理をする（最大 8 周。決定的）。8 周で解けなければ（半分ずつ動かす先がすべて使われている場合）、動かせる向きを 1/4, 3/4, 1/8, 3/8, …（1/1024 まで）のうち最初の空いた位置に置く。使用中かは向き（外から・内から）によらず点で判定する。`layout/no-route` になるのは、両方の向きに anchor がある場合と、それらの位置がすべて使われている場合（1 辺に千を超える口。理由を分けて出す）だけ。
  - **group** が端の場合は group の外枠上。相手が group の中にある（子孫から自分の group へ）なら、相手の中心に最も近い辺を使い、経路は group の内側を通る（`fromSide` / `toSide` はその辺）。子孫の側の端も同じ辺の向きを使う。
  - **自己ループ**: 既定は東から出て北に入る（角を回る）。片方だけ anchor があれば、もう片方は時計回りの隣の辺。両端が同じ点になる場合は `layout/no-route`。
  - 端点は外接矩形の辺上の点（**ポート**）から法線に沿って内側へ動かし、図形の輪郭（circle・oval・diamond・hexagon・parallelogram は lint と同じ `shapeOutline`、アウトライン部品は renderer の衝突領域、`text` は外接矩形）に置く。矢じりは常に辺に垂直に入る。辺の端（位置 0 / 1）で法線が図形に接するだけの場合も、最初の共通点（円なら左右上下の端）に置く（接触を含む判定。貫通の判定とは別の関数）。
  - **junction**（mark が `point` の node、#92）は中心が端点で、向きは自由。junction は 3×3 unit の点で、自分を端に持たないエッジは通れない。
- **格子と探索（`router.ts`）**: 疎な格子（Hanan grid）上の最短経路探索。状態は（格子点, 進行方向）で、U ターンはしない。格子の線は、junction 以外の node の辺とそれを clearance（6 unit = 3pt）広げた辺、group の辺と group ラベルの箱の辺、内容の外側 12 unit の枠、それらの隣り合う線の中点（溝の中央を通すため。間隔が 2 unit を超える場合。ポートの線の間には入れない）、ポートと stub の先端、junction の中心。座標は 1/1000 unit に丸めて整数の添字で扱い、ヒープの同点は状態の番号で決まる。格子と格子の辺の費用は 1 回だけ作り、占有はその場で更新する。
  - **A\***: 下界 `h(p) = max(0, min(|p t|, min_q |q t|) − stub)`（`q` は自分のネットの点のうち終点の stub の外にあるものと、stub の点でネットが stub の外から届いているもの。`stub` は終点の stub の長さ）。同じ終点に入る幹線が stub に合流している場合、その合流点を除くと下界が過大になる（レビューで見つけ、Dijkstra と費用が一致することをテストで確かめる。#116 で、図全体の経路の一致から、同じ占有でのエッジごとの費用の一致に改めた。同じ費用の経路は探索順で選ばれ、1 本の選び方が違うと後のエッジの占有が変わるので、図全体の一致は偶然に頼っていた。`RouteOptions.verifyLowerBound`）。自分のネットの辺は費用 0 なので、マンハッタン距離そのままでは下界にならない。経路が（終点の stub 以外で）ネットの辺を使わなければ費用は `|p t| − stub` 以上、使うなら最後にネットを離れる点 `q` から `|q t| − stub` 以上、他の辺の費用は長さ以上なので、この `h` は過大評価しない。したがって結果の費用は Dijkstra と同じで、同じ費用の経路の間の選び方だけが探索順で決まる（決定的）。
  - **探索範囲**: まず両端の stub の外接矩形を 80 unit（40pt）広げた範囲で探し、見つからなければ格子全体で探し直す。範囲の外を回る方が安い経路は、範囲の中に経路がある限り選ばれない（図 A・B では経路は変わらない）。

  | 費用 | 値 | 内容 |
  | --- | --- | --- |
  | 長さ | 1 / unit | |
  | clearance | +4 / unit | node の clearance の内側、または group の枠に沿って進む部分 |
  | 折れ | 40 | |
  | group の枠の通過 | 150 | |
  | group のラベル | 1000 / 格子の辺 | ラベルの箱を横切る |
  | 他のネットとの交差・接触 | 300 | 他のネットの線がある格子点に入る（交差、T 字の接触、端点どうしの接触） |
  | 他のネットとの重なり | 4000 | 他のネットが使った格子の辺を通る |
  | 同じネットが使った格子の辺 | 0 | 幹線・バスの共有 |
  | 矢じりの前の余白（#116、#217 で更新） | 60 | 余白の中で曲がる、または同じネットの別の端の余白の領域に進入する（格子点ごとではない。§6.57） |

  - node の辺上と内側の格子の辺は使えない（junction を除く）。したがって経路は**設計上 node を貫通しない**（試作の「膨らませた障害物の内側を通れない」から変えた: 2mm 間隔のスタックでは膨らませた障害物が重なり、隣のブロックを直線でつなぐ特別扱いが要った。製品は clearance を費用にしたので、隣どうしの直線も通常の探索で最短として見つかる）。
  - 交差の費用（300）は試作（80）より高い。図の交差は折れより読みにくいので、折れ 7 回分程度までの迂回は交差より安くする。
- **stub**: ポートから辺に垂直に、clearance 以上（矢じりのある端は矢じりの長さ以上）まっすぐ進むまで曲がれない。矢じりの長さは D2 の三角形と同じ **4 + 4 × 線幅**（unit。academic の 1 unit の線で 8）とし、`arrowheadLength()` として公開する。junction の端には stub がない。stub は「曲がれない範囲」なので、向かい合う 2 つのポートを結ぶ直線は stub より短くてもよい（2mm 間隔のスタックの線）。ただし**矢じりは描く場所が要る**ので、矢じりのある端の線分が矢じりより短くなる場合（向かい合う端の間隔が矢じりより狭い直線）は `layout/no-route` にする（矢じりのない `line` なら引ける）。
- **矢じりの前の余白（#116）**: [調査 #109](../research/109-dogfood-v0.4/README.md) の A7。stub は矢じりの長さだけなので、角の直後に矢じりが来て丸めた角（§6.26）が矢じりに重なり、共有の幹線が矢じりの直前で分かれる（gateway → 3 つの API。真ん中の矢じりの底が分岐点）と「+」の形に見えた。
  - **#217 による更新（§6.57 が現行仕様）**: 直前の stub の説明の「junction の端には stub がない」は自由な方向の初回探索についての記述。矢じりのある junction の直線が不足する場合は、4 方向（両端なら最大 16 通り）を矢じり長の hard stub で再探索し、どれも引けなければ `layout/no-route`。以下の **100・格子点ごとの課金・S 字を作らないという説明は旧仕様の記録**であり、現行は **60・別の端の room の領域への進入時に 1 回**。`40 < 60 < 80` は余分な S 字を避ける好みで、共有の格子辺では曲がりの費用を省く場合や複数の room 進入・曲がりの費用が累積する場合があり、保証ではない。
  - **余白**: 矢じりのある端に `arrowRoom()` = 矢じりの長さ + 角の最大半径（`WIRE_CORNER_RADIUS` = 8。§6.26 の定数をルータに移し、writer が読む）。余白の中で曲がる（終点の線分に入る・始点の線分から出る）と 100、同じネットの別の口のエッジが余白の中の格子点に入る（幹線から分かれる・合流する）と 100 を足す。stub（曲がれない範囲）は従来どおり矢じりの長さで、余白は禁止ではない。
  - **費用 100（判断）**: 折れ 2 回（80）より高く、交差（300）より低い。余白は折れや幹線の位置をずらすだけで得られることが多く（長さは変わらない）、その場合は必ず取る。2 回の余分な折れ（S 字）や交差と引き換えには取らない。150 では 3mm 間隔のスタックの Z 字の線が S 字に迂回した。禁止（stub を余白まで伸ばし、経路がなければ従来の stub で探し直す）や 3000 では、下記のグループの扱いがないと Transformer の残差がグループの枠の外を回った。
  - **グループの中の余白（判断）**: 両端を含むグループの枠までの距離が余白 + clearance に満たない端は、余白を持たない（`#room`）。図 A の残差（encoder の padding 16 unit = 余白と同じ）は、余白を取ると枠の外を回ってしまう。両端がそのグループの中にあるなら経路が枠を出る理由はないので、従来どおり padding の中で曲がる（矢じりは角の直後のまま。writer は弧を矢じりに重ねない。§6.26）。片方が外なら枠は通過するので余白を保つ（cylinder の北）。#171 から、この曲がりが枠に寄らないよう、配置エンジンがその側のグループの余白を「矢じりの長さ ＋ clearance」まで広げる（§6.42）。
  - **格子と占有**: 矢じりのある端の格子の線は stub の先ではなく**余白の先**に置く（端ごとに 1 本のまま。両方に置くと格子が大きくなり、合成図で 3 割遅くなった）。stub の点は「ポートからの距離が stub 未満」で判定するので、stub の先が格子にない場合は、その先の最初の線で曲がる。狭い所では stub の先が唯一の曲がれる位置のことがあるので（レビューで指摘: 壁が target の 9 unit 手前で終わる場合）、経路のないエッジがあれば、stub の先にも線を置いた格子で図全体を引き直し、引けたエッジが多ければそれを採る（`routeEdges`。まれなので、通常の格子は小さいまま）。余白まで占有に登録し（他のネットは余白に触れると交差・接触の費用を払う）、A\* の下界は余白の長さを引く（登録した分は費用 0）。
  - **既存の経路**: 図 A は Q・K・V への分岐が junction の近く（最後の線分 16〜18.5 unit）で分かれ、encoder の出力から decoder の注意への 2 本が余白 16 になった。図 B は MLP のバスが 8 unit 右へ（191 → 199）移り、4 本のタップの最後の線分が 8 → 16 unit になった。いずれも分岐・角の直後に矢じりがあった箇所。
- **ネット**: 同じポート（要素・点・向き）**から出る**エッジどうし、同じポート**に入る**エッジどうし、同じ junction に触れるエッジを **union-find** で 1 つのネットにする。junction どうしをつなぐエッジで推移的に統合される（試作の限界の解消。試作は 1 本ごとに 1 つの junction か始点を選ぶだけだった）。合流（同じポートに入る複数のエッジ）も同じネットになる。ネットの番号は、最初のエッジの文書順。
  - **向き（#113 で修正）**: 当初はポートのキーに入りと出の区別がなく、`api → worker`（worker の西に入る）と `worker → store`（worker の西から出る）が 1 つのネットになり、幹線を共有して `api → store` に読めた。入りと出は別のネットにし、同じ点を使う場合は上の「端点」で口を分ける。junction は「線が合流する点」を明示する部品なので、junction に入るエッジと出るエッジは従来どおり 1 つのネット。
  - **橋渡しされたネット（判断）**: union-find は推移的なので、`x → z` が `x → y` と x の口を、`w → z` と z の口を共有すると、3 本が 1 つのネットになる。ネットは描く単位（線の和を 1 回だけ描く。§6.23）としてはこのままにするが、**線を共有してよいのは直接つながる 2 本だけ**にする: 同じポートから出る、同じポートに入る、または junction（edge でつながった junction の組）に触れる。費用 0 で通れるのは自分のネットの格子の辺のうち、その上の**すべてのエッジ**とこの関係にあるものだけで、そうでない辺は他のネットと同じく重なり（4000）、点は交差・接触（300）の費用がかかる（格子の辺と点ごとに、そこを通るエッジを記録する）。費用 0 の辺でも、着いた点に直接つながらない同じネットのエッジがあれば交差・接触の費用（300）はかかる（レビューで指摘: 狭い隙間で、分岐が相手の stub の先端まで幹線を進んで接していた）。`x → y` と `w → z` が同じ線を走ると、`w → y` にも読めるため。同じネットの分岐点で 2 本が 1 点で出会うこと（例: 4mm の隙間で、上の箱の出口の stub と下の箱の入口の stub の先端が一致する）は避けられない場合があり、検査でも重なりだけを数える。
  - **A\* の下界**: 下界はネットの点（費用 0 になりうる辺の端点の上位集合）だけを使うので、費用 0 の辺が減っても過大評価しない（上の証明は「自分のネットの辺を最後に離れる点」を、費用 0 の辺を最後に離れる点に読み替えればそのまま成り立つ）。テストで再現・合成図 2 つの各エッジの費用が Dijkstra と一致することを確かめる。
- **占有**: 格子の辺と格子点の所有者を**すべて**記録する（試作は 1 つだけ）。全エッジの stub を探索の前に登録するので、先に引く経路は後のエッジの stub を避ける。隣のブロックを結ぶ直線も通常の経路なので占有を登録し、交差の費用の判定も通る（試作の限界の解消。例: `a → b` の直線の後に引く `x → y` は直線を横切らずに回り込む。テストで確認）。
- **順序**: YAML の順に貪欲に引く（全体最適ではない）。交差が残れば検査で検出する。
- **`layout/no-route`（error）**: 経路がない（node に囲まれている、接している node の間、stub が向かいの node に当たる）、両端が同じ点、または端の間隔が矢じりより狭い。位置はエッジ（`edges[i]`）。他のエッジは引く。経路がない場合は、塞いでいる候補の node（#114）をメッセージ（`in the way: "note"`）と `related`（YAML の位置）に示す: 端の stub と重なる・接する node、なければ両端の stub の先端を対角とする箱（直線・L 字の経路が通る範囲）と重なる node を、端に近い順（同じなら配置順）に最大 3 個。経路は端でない junction にも入れないので junction も含め、端の 2 要素は除く。`attach` した node が含まれれば、hint で「`attach` は配置の木で場所を取らない」ことと直し方を示す。失敗時だけ、node の走査と該当したものの整列をする（決定的）。`layoutStructuredFigure` は error として失敗を返す。
- **エッジのラベル（`labels.ts`、試作 `edge-labels.ts` と同じ）**: 矢じりのある端（target、なければ source）の最後の線分で、矢じりの手前に置く。水平なら線の上、垂直なら線の右、間隔 3 unit。矢じりのない線は最も長い線分の中央。
  - **経路と枠線を避ける（#116）**: [調査 #109](../research/109-dogfood-v0.4/README.md) の A8・A9。最後の線分がラベルより短いと、ラベルの箱（背景で塗る）が手前の線分を覆い、破線の切れ端が点に見えた（`update θ·`）。またラベルがグループの枠線に乗った（gRPC）。最初の位置が、いずれかの経路（自分の手前の線分、同じネットの幹線、他のエッジ）か、グループの枠線に間隔 3 unit より近ければ、候補を順に試す: 反対側、最後の線分に沿って、それを横切る経路・枠線の先まで下げた位置（角の先まで）を、矢じりに近い順（同じ距離なら上・右が先）に、両側。最後に手前の線分の脇（最後の線分が出ていかない側、角から 3 unit）。枠線は線を描くグループだけ（線幅 0・`transparent` のグループは lint と同じく除く）。経路に近くない候補のうち、枠線と node の箱にも重ならないもの、なければ node の箱に重ならないもの（node の上のラベルは枠線の上より多くを隠す）、なければ最初のものを選ぶ。どれも経路に近ければ最初の位置のまま。最初の位置が経路にも枠線にも近くなければ動かさない（node との重なりは従来どおり検査で検出）ので、既存の図のラベルは、この 2 つの不具合があった箇所だけが動く（図 B のタップのラベルはバスが動いた分、`x` 194 → 202）。残る衝突は検査（`checkRoutes`）と幾何 lint の `geometry/label-collision`（枠線も対象にした）で検出する。
- **内容とキャンバス**: 経路とエッジのラベルを含めて `content` を広げる。上か左にはみ出した場合は全体（node・group・ラベル・経路）を平行移動して、内容の左上を余白の位置に保つ。キャンバスは配置エンジンと同じ式（内容＋両側の余白を整数 unit に切り上げ）。
- **Layout IR への追加**（既存のフィールドは変えていない）:

  | 項目 | 内容 |
  | --- | --- |
  | `EdgeRoute.net` | ネットの番号（`LayoutIR.nets` の添字） |
  | `EdgeRoute.fromSide` / `toSide` | 使った辺。junction の端では省略 |
  | `LayoutIR.nets` | `{ id, edges, segments }[]`。`edges` は文書順。`segments` はネットの全経路の和を、最大の軸平行な線分にまとめたもの（水平を y・x の順、次に垂直を x・y の順。各線分は小さい端から）。共有の幹線を 1 回だけ描くのに使う |

  `route.points` は直交の折れ線で、同じ点の繰り返しと一直線上の中間点を含まない。共有の幹線は各エッジの折れ線にも含まれる（§6.21 の契約どおり）。
- **検査（`check.ts`、`checkRoutes(ir, layout)`）**: ルータの仕組みに依らず、Layout IR だけで確かめる: 経路のないエッジ、直交でない線分、同じ点の繰り返し・一直線上の中間点・折り返し、node の貫通（下記の lint と同じ関数。自分の端の node も、端に接する線分以外で入れば検出）、端点のずれ（輪郭上にない、junction の中心でない、anchor の位置でない、辺に垂直でない、要素から離れる向き（内側から入る group では入る向き）でない）、異なるネットの交差・接触（一方の点が他方の線上）・重なり、矢じりより短い最後の線分、エッジのラベルの衝突（node・ラベル・経路・group の枠）、内容やキャンバスの外の点。
  - **ネットの正しさ（#113）**: `route.net` を信用せず、経路の端点（要素・辺・点）と向きから、線を共有してよい組（同じポートから出る・同じポートに入る・junction の組に触れる）を作り直す。`misjoinedNets` は、その推移閉包とネットの分け方が違うもの（つながりのないエッジを含むネット、つながるのに別のネット）。`overlaps` は、別のネットの組に加えて、同じネットでも直接つながらない組（橋渡しされたネット）の重なりも数える（交差・接触は同じネットの中では数えない。分岐点になるため）。修正前のルータでは再現が `misjoinedNets` と重なり 41 unit で検出される。
  - **SVG の幾何 lint には足さない（判断）**: 描いた SVG の線はネットとスタイルごとにまとめた path で、どの線分をどのエッジが通るかは edge ごとの `path.connection` にしかなく、junction・ポートの向きは SVG から読めない。また幾何 lint は auto（D2/ELK）の図にも掛かり、D2 の線の重なりは別の問題なので、auto の出力（lint の golden）を変えないためにも、この検査は Layout IR の `checkRoutes`（テスト）に置く。
  - **図 A と図 B のパネル**（fixture）で、すべての項目が 0 件（テストで固定）。図 A では enc-split1 からの Q/K/V と残差が 1 つのネット、エンコーダ出力 → K / V は先頭 3 点を共有する幹線になる。図 B では MLP の 4 本が 1 本のバスを共有し、ラベルは矢じりの手前に衝突なく置かれる。
  - fixture は #92 が入ったので、調査の理想の YAML と同じく本物の operator・junction・tone を使う形に更新した（A は `icon` だけを `~` の circle に、B は `caption` と数式ラベルだけを除く）。§6.21 の試作との一致の比較はそのまま通る。
- **幾何 lint `geometry/edge-through-node`（warning）**: エッジの経路が、端でない node の図形（凸の衝突領域。circle・diamond は外接矩形ではなく図形）を許容 1 unit より深く通る。`text` の node（図形がない）は `edge-crosses-label` に任せる。許容は輪郭からの距離で、楕円は半径を減らす近似ではなく点と楕円の距離（Eberly の二分法）で測る（細長い oval で浅い通過を誤検出しない）。判定の本体は `src/lint/geometry/edges.ts`（`segmentCrossesRegion`・`obstaclesCrossedByRoute`）で、SVG の検査（inspect の経路）と Layout IR の検査が同じ関数を使う。#91 で structured の SVG にも自動で掛かる。`auto`（D2/ELK）の図にも掛けるが、既存の examples・ギャラリー・lint の golden では 1 件も出ない（出力は変わらない）。
- **処理時間**（Apple M4 Pro、Bun 1.3.14、`routeEdges` のみ、9 回の中央値。合成図は `router.test.ts` で同じものを生成し、時間をログに出す。CI の時間は変動が大きいので、テストでは時間を検査しない）:

  | 図 | node | edge | 時間 |
  | --- | --- | --- | --- |
  | A（Transformer） | 30 | 30 | 3.3ms |
  | B のパネル | 16 | 20 | 0.6ms |
  | 合成: 5 つの group × 20 段のスタック、鎖・残差・group 間 | 100 | 129 | 45ms |
  | 合成: 10 × 10 の箱、任意の 2 つを結ぶ乱数のエッジ（最悪に近い） | 100 | 146 | 193ms |

  #116 の後（同じ環境・同じ方法で前後を測った 9 回の中央値）: 5 つの group は 47 → 54ms、10 × 10 は 327 → 405ms。余白の費用自体（0 にしても 50 / 390ms）や分岐の判定（3% 程度）ではなく、格子の線が stub の先から余白の先に移り、経路と占有が変わった分の探索の差。10 × 10 の検査は重なり 7・接触 20（変わらず）、交差は 2029 → 1945。
  #113 の後（同じ環境で前後を測った中央値）: 5 つの group は 39 → 35ms、10 × 10 は 205 → 350ms。10 × 10 では入りと出が同じ口を使う端が約 50 あり、口を分けた分だけ格子の線とネットが増え、費用 0 の辺が減るため（入りと出をまとめていたネットが探索を短くしていた）。10 × 10 の図は、#113 の前は検査が 0 件だったが、正しいネットで数え直すと重なり 91・接触 46 があり（入りと出を 1 つのネットにしていたため隠れていた）、後は重なり 7・接触 20 になる。乱数の密な図では貪欲な経路探索がすべてを避けきれないので、テストはこの件数を上限として固定する（5 つの group の図は引き続き 0 件。修正前は正しく数えると重なり 22）。

  - 最初の版（格子全体の Dijkstra、すべての隣り合う線の中点）は 10 × 10 の図で 953ms（格子 456 × 141、取り出し 746 万回）で、CI（coverage 付き）では 10〜20 秒かかった。A\*、探索範囲、中点をポートの線の間に入れないこと（格子 434 × 102）、ヒープを型付き配列に、占有の判定を内側のループに展開したことで 193ms（取り出し 180 万回程度）になった。図 A・B の経路は変わっていない（golden は同じ）。残りの探索は、交差（300）・折れ（40）の費用が下界との差になる範囲を調べる分で、乱数の密なエッジでは範囲の大部分になる。
  - 格子は node・ポートの数に対して縦横それぞれ線形に増えるので、点の数は 2 乗で増える。数百 node の図では、ポートの線をそのエッジの探索だけに使う（他のエッジの格子から外す）などがさらに必要になりうる。
- **決定性**: 図 A・B の経路込みの Layout IR を golden（`tests/fixtures/layout/*.routed.layout.json`）とバイト単位で比べ、2 回の実行の一致も確かめる。合成図でも 3 回の出力が一致することを確かめる。union-find の根は小さい添字、ネットの番号は文書順、Map の走査は挿入順だけを使う。
- **限界（判断）**: 交差の最小化は貪欲（残った交差は `layout/edge-crossing` で報告する。§6.28）。エッジのラベルは経路とグループの枠線を避ける位置を探すが（#116）、ラベルどうし・node との衝突は解消しない。矢じりの前の余白は費用なので、交差や迂回と引き換えには取らず、両端を含むグループの padding が狭い端では持たない（矢じりが角の直後に来る）。アウトライン部品の端点は衝突領域（凸包）の上で、描く輪郭（凹みがある場合）とは一致しないことがある。junction の端には stub がないので、junction に入る矢じりは短い線分の上に描かれうる（junction へは `line` を推奨。§6.20）。
- **#91（SVG writer）への引き継ぎ**: 経路は `route.points` を折れ線として描き、矢じりは最後の線分の向き（`arrowheadLength()` 以下の長さ）。共有の幹線を重ねて描かない場合は `nets[].segments` を描く（ネット内で線のスタイルが混ざる場合の扱いは #91 が決める）。junction の点・operator の記号は #92 の mark から描く。エッジのラベルは `route.label`（`TextLayout`、node のラベルと同じ描き方）。描いた SVG では `geometry/edge-through-node` を含む既存の幾何 lint が掛かる。

### 6.23 #91 の structured の SVG writer とフォントのサブセット

[#86 の調査](../research/86-paper-figures.md)（§3.5）の段階 A の 4 件目。§6.21・§6.22 の Layout IR から SVG を書き、既存の finalize・inspect・幾何 lint・PDF・PPTX に接続した。§6.19 の `layout/engine-unavailable` はなくなり、structured の図は `sumi render` で描ける。`auto` の図の出力（D2 ソース・SVG・PDF・PPTX・lint の golden・ギャラリー）はバイト単位で変わらない。

- **経路**: `compileFigure()` の値 `CompiledFigure` を `engine` で判別する union にした。`auto` は従来どおり `d2Source` と `layout`（D2 の引数）を持つ `CompiledD2Figure`、`structured` はそれらを持たない `CompiledStructuredFigure`（D2 ソースがないので、作り物の D2 を持たせない）。`compileFigure()` は I/O のない純関数のまま（配置はフォントファイルを読むので描画時に行う）。`renderFigure()` は structured を **配置（`layoutStructured`）→ 経路（`routeEdges`）→ `writeStructuredSvg()` → `finalizeStructuredSvg()` → `inspectSvg()`** で描き、D2 backend を呼ばない。`layout/no-route` は error として失敗を返す。`RenderedFigure` も union で、D2 なら `artifact`、structured なら描いた `layout`（経路付きの Layout IR）を持つ。要素のない図は従来どおり `svg/empty-figure`。
- **inspect 契約との差の解消**（調査 §3.5 の 5 点）:

  | 試作の差 | writer |
  | --- | --- |
  | `svg.d2-svg` の包みがない | root `<svg>`（viewBox = キャンバス）の中に `svg.d2-svg` を 1 つ（同じ viewBox、transform・offset なし）。class は `sumi-<n> d2-svg` |
  | edge の class が `#` | §2.4 と同じ符号化（`:` → `--`、`#` → `_`。`sumi-k-e--_3`） |
  | tspan ごとの x/y | `<text x y>` は Layout IR の `anchor`（中心・1 行目のベースライン）、`text-anchor:middle`、2 行目以降は `<tspan x dy>` で `lineHeightUnits` ずつ。`xml:space` なし。フォント class は D2 と同じ `text` / `text-bold` / `text-mono` … |
  | junction が inspect できない | junction も `g.shape` の中の `<circle>`（外接矩形 = Layout IR の 3×3 などの `rect`） |
  | アイコンが入れ子の `<svg>` | 入れ子の `<svg>` は使わない（アイコンは #94。`g.shape` の中の図形として描く前提） |

- **描画の約束**（`src/render/structured.ts`）: group（前順）→ node → 線（ネット）→ edge の順。node・group の `g.shape` の図形の外接矩形は Layout IR の `rect` と一致する（テストで 1e-9 以内）。形は D2 v0.9.0 の比率に合わせた: rectangle / square は `rect`（radius → `rx`）、circle / oval は `circle` / `ellipse`、diamond・hexagon・parallelogram は幾何 lint の `shapeOutline()` と同じ多角形、cylinder は D2 と同じ曲線（蓋の深さ 24、制御点は幅の 5%）、document は D2 の波線（縁は高さの 0.8586）で、両端が縁 `bottom − 3k`・制御点が `bottom + k`（`k` は小数 6 桁に丸めた値）の 3 次曲線にして、波の最下点が箱の下端にちょうど来るようにした（D2 は整数に丸めるので外接矩形が 1 unit ほどずれる）、page は折り返しの角、アウトライン部品は renderer の `draw(rect)` の層（`line` は塗りなし）。`text` は図形なし。キャンバスは D2 と同じく白の矩形で塗る。破線は D2 の式（`stroke-width × dash` と、太いほど狭くなる間隔）、`opacity` は要素の `<g>` に付ける。
- **mark（判断、#92 の引き継ぎ）**: junction（`point`）は Theme の `fill`（= 線の色）で塗った枠線なしの円。外接矩形がそのまま点の大きさになる。塗りが `transparent` なら見えないだけで、要素は残る。operator（`glyph`）の記号は**文字**で描く（線分にしない）: PDF で検索・抽出でき、`auto` の D2 の描画と同じで、幾何 lint の再計測・`lint/missing-glyph` もそのまま働く。同梱の BIZ UDPGothic（regular / bold）は `+ − × • ‖` をすべて収録している（cmap で確認）。
- **矢じり**: 経路の端に、最後の線分の向きで描く多角形（`marker` は使わない。id が要らず、決定的）。長さは `arrowheadLength()`（ルータが空けた長さ）以下、幅はその半分ずつ。triangle・arrow（切り欠き付き）・diamond・circle・box は `filled` なら線の色で塗り、そうでなければ矢じりの下の塗りの色（#192 で白から変更。§6.43）で塗って線の色で縁取る。cross は線。線（下記）は矢じりの底で止める（cross と none は止めない）。矢じりの底から後ろ（arrow の切り欠きの奥、cross の全長）は線が通るが、角の弧はそこに入れない（`keepStart` / `keepEnd`、#116。§6.26）。
- **線とネット（判断）**: 共有の幹線を 2 回描かないよう、線は edge ごとではなく**ネットごと・線のスタイル（色・太さ・破線・不透明度）ごと**に 1 本の path（`path.sumi-wire`、最大の軸平行な線分の和、丸い端）で描く。重ねて描くと、破線の幹線は位相のずれで実線のように見え、半透明の幹線は濃くなるため。線分の和は各 edge の折れ線から矢じりの分を除いて作る（`nets[].segments` は矢じりの下まで含むので、そのままは使わない）。**ネットの中でスタイルが混ざる場合**はスタイルごとに別の path にし、両方が通る区間は両方で描く（文書順で後の edge が上）。inspect のための edge ごとの `path.connection` は経路全体（M/L）を持ち、線幅と破線は書くが `stroke` は書かない（SVG の初期値 `none` なので見えない）。そのため幾何 lint・編集可能 PPTX は従来どおり edge ごとの経路を読む。
- **エッジのラベル**: `route.label`（node のラベルと同じ描き方）。edge の `fill` が `transparent` でなければ、ラベルの行の箱を 1 unit 広げた矩形を背景に描く（#31。ルータはラベルを線から 3 unit 離すので、線は隠れない）。背景の色はラベルの下に塗られている色（#170、§6.41）。
- **フォント（判断）**: `@font-face` は、使ったフォント class ごとに、フォントセットのファイル（幾何 lint の `fontFileFor()` と同じ対応）から、描いた文字だけの **TrueType のサブセット**（`data:font/ttf;base64`）を埋め込む。family 名は `sumi-<n>-font-<class>`（`<n>` は描画部分の FNV-1a。同じページに複数の図を置いても衝突しない）。PDF・PPTX の `resolveSvgFonts()` は `d2-<n>-font-*` と同じく `sumi-<n>-font-*` を同梱 TTF の実名に書き換える。
  - サブセットは WASM エンジンの新しい export `subset`（krilla が PDF に使う subsetter 0.2.6 をそのまま呼ぶ）で作る。subsetter は PDF の CID フォント用で `cmap` と `OS/2` を落とすので、TS 側（`src/render/font-subset.ts`）が、元の `cmap` で文字を glyph に引き、複合 glyph の部品を推移的に加えて昇順に並べた glyph の列を渡し（新しい glyph ID が `.notdef` に続いてこの順になることを WASM 側でも確かめる）、新しい `cmap`（BMP は 3/1 の format 4、全体は 3/10 の format 12）と元の `OS/2` を加えてフォントを組み直す（tag 順、checksum、`head.checkSumAdjustment`）。フォントにない文字は `cmap` に入れない（閲覧側の代替。`lint/missing-glyph` が報告する）。format 4 の長さ（16 bit）に収まらないほど区間が多い場合（約 8,000 区間）は format 12 だけを書く。subsetter は `.notdef` を必ず含めるので、複合 glyph の部品の探索も `.notdef` から始める。
  - 検証: ヘッドレス Chrome で図 A の SVG の `@font-face` が `loaded` になり、`getComputedTextLength()` が Layout IR の行の幅と 0.05 unit（0.04%）以内で一致した（§6.5 のブラウザ確認と同じ丸めの差）。テストでは、埋め込んだフォントが描いた全文字を収録し、advance が元のフォントと一致することを確かめる。WOFF にはしない（圧縮を WASM か TS に足す必要があり、図 A で regular の TTF が約 11.6KB と十分小さいため）。
  - ライセンス: BIZ UD は OFL 1.1（Reserved Font Name なし）。サブセットは `name` テーブル（著作権・ライセンスの記述）を保つ。D2 も同じフォントのサブセットを SVG に埋め込んでいる。subsetter はもともと krilla の依存として WASM に入っていた crate なので、`Cargo.lock` は sumi-pdf の依存の行が増えるだけで、`THIRD_PARTY.md`・`licenses/` は変わらない。WASM（CONTRIBUTING の手順どおり CI の linux-x64 のビルドを `--adopt` で取り込んだもの）は 3,565,005 → 3,566,734 バイト（+1,729）。
- **メタデータ**: 形式 1 のまま、`backend="sumi-structured"`、`backend-version` は Sumi の版、`d2-sha256` は書かない（D2 ソースがない）。`readSvgMetadata()` は `sumi-structured` のときだけ `d2-sha256` を省略可とし、`SumiSvgMetadata.d2Sha256` は任意になった。PDF の文書情報と PPTX の custom properties は `SumiD2Sha256` を省く。
- **CLI**: structured の図に `--emit-d2` を付けると使い方の誤り（exit 2、何も書かない）。
- **PDF・PPTX**: PDF・画像方式の PPTX は既存の経路のまま。**編集可能 PPTX も対応した**: `path.connection` に `stroke` がないので、線の色は Figure IR の `stroke` から取り（既存の処理）、矢じりは Figure IR の種類と既定の大きさ（`marker` がないため）になる。freeform・glued の両方で全 edge が線を持つことをテストで確かめた。
- **幾何 lint**: 既存の規則がそのまま掛かる（`edge-through-node` を含む）。#89 の残りの受け入れ条件として、図 A の fixture（paper-single で 90.13mm）で `geometry/exceeds-page-width` だけが出て、paper-double では何も出ないことを確かめた。`geometry/reversed-edge` は structured の図には掛けない（`layout.direction` と ELK の閉路の処理が前提の規則で、structured では配置の木が向きを決めるため）。
- **決定性**: 数値は小数 6 桁以内（Layout IR の座標は 3 桁、それを半分にした中心・半径は 4 桁なので、図形の範囲が丸めで変わらない）、Map は挿入順だけを走査、フォントのサブセットは 1 つの WASM と整数演算。2 回の描画のバイト一致をテストし、examples の SVG・PDF・PPTX の golden は CI の Linux / macOS と release の 4 ターゲットで検査される。
- **作例（golden）**: `examples/transformer`（図 A、academic / paper-single。88mm に収めるため、列の間隔と位置エンコーディングの注記の gap を図 A の fixture より狭くした。正弦波のアイコンは #94 までは `~` の円。#94 で `icon: tabler/wave-sine` にした、§6.25）と `examples/dit-block`（図 B の adaLN のパネル、color / paper-single、tone・group のラベル・ラベル付きのバス。color テーマの太い線の矢じりに合わせて縦の間隔は 3mm）。ギャラリー・PDF・PPTX の golden は追加だけで、既存のものは変わらない。
- **テスト**（`src/render/structured.test.ts` ほか）: 作例と fixture の 4 図で、実際の `inspectSvg()` が通り、bbox・ラベルの anchor / 行 / 行送り / フォント class・経路が Layout IR と一致すること、決定性とメタデータ、埋め込みフォント、PDF・PPTX（両方式）への変換と編集可能 PPTX の線、幾何 lint（作例と B は 0 件、A は `exceeds-page-width`）。全部品（アウトライン・mark・各形）を 1 図に置いた図の inspect と幾何 lint 0 件、全矢じりが `arrowheadLength()` 以内、線分の結合、D2 の破線の式、サブセットの cmap / advance / 複合 glyph。CLI の E2E（SVG・PDF・PPTX 両方式、`--emit-d2` の拒否）。PDF の文字位置が幾何 lint の再計測と 0.01pt 以内で一致することは、既存の PDF の構造検査が examples に自動で掛かる。
- **限界・引き継ぎ**: 空行（renderedLines で空になった行）は中身のない `<tspan>` になり、ブラウザによっては `dy` が効かない（D2 と同じ）。junction に入る矢じりは短い線分の上に描かれうる（§6.22）。operator の記号の上下は文字の行の箱の中央で、記号の字形の中心とは少しずれうる。エッジのラベルの衝突はルータの限界のまま（§6.22）。#93（数式）は、`<tspan>` の上付き・下付きと数式フォントのサブセットを同じ writer と `subset` に足す。#94（画像・アイコン）は、inspect の bbox の対象にならないよう `g.shape` の外か、許可した図形として描き、入れ子の `<svg>` は使わない。#95（Skill）は structured の書き方・`layout/no-route` の直し方・`--emit-d2` の制約を教える。

### 6.24 #93 のラベルの数式と数式フォント

[#86 の調査](../research/86-paper-figures.md)（§5）の段階 A の 6 件目。structured の図のラベルに `$...$` の数式の部分集合を書けるようにし、数式用の OFL フォントを同梱した。`$` を含まないラベル、`auto` の図の出力（D2 ソース・SVG・PDF・PPTX・lint の golden・ギャラリー）はバイト単位で変わらない。変わる golden は `examples/dit-block`（数式を使うように書き換えた）だけ。

- **記法**（`src/core/label/`。I/O のない純関数）:
  - `$...$` の外は文字どおり。`\$` だけが `$` 1 文字になる。`$` は同じ行で閉じる。
  - 中は TeX の部分集合: ラテン文字と小文字のギリシャ文字（`\alpha` … `\omega`、`\varepsilon` 等、または `α` を直接）は変数として斜体、数字・大文字のギリシャ文字・記号は立体（TeX の慣習）。空白は無視する。`_` / `^` は 1 文字・1 コマンド・`{…}` を下付き / 上付きにする（1 段のみ。1 つの基底に両方を書けるが、積み重ねず書いた順に並べる。`$x_i^2$` は `xi2`、`$x^2_i$` は `x2i` と抽出される）。記号コマンド（`\times` `\cdot` `\pm` `\oplus` `\otimes` `\leq` `\geq` `\approx` `\sim` `\equiv` `\neq` `\in` `\to` `\leftrightarrow` `\Rightarrow` `\infty` `\partial` `\nabla` `\sum` `\prod` `\int` `\cdots` `\ldots` `\langle` 等、`symbols.ts`）、明示の空白（`\,` `\:` `\;` `\ ` `\quad` `\qquad` `~`）、`\mathrm{…}` `\mathit{…}` `\operatorname{…}`、関数名（`\log` `\exp` `\sin` `\max` 等）、`\text{…}`（ラベル自身のフォントで、日本語も書ける）。`-` は U+2212、`*` は ∗、`'` は ′ にする（TeX と同じ）。
  - **自動の空白**: 二項演算子の両側に U+2005（four-per-em、TeX の 4mu 相当）、関係の両側に U+2004（three-per-em、5mu 相当）。TeX の規則 5・6 のとおり、左に被演算子がない二項演算子（先頭、演算子・関係・開き括弧・句読点の後）と、右が関係・閉じ括弧・句読点・末尾の二項演算子は普通の記号として扱う（`$-1$` は空白なし）。添字の中には空白を入れない。**句読点の後の薄い空白（TeX の punct）は入れない**: `$\gamma_1,\beta_1$` を PDF から `γ1,β1` として取り出せるようにするため。必要なら `\,` と書く。空白は空白文字（収縮しない U+2004/2005/2009/00A0/2003）なので、テキスト抽出でも空白として現れる。
  - **未対応・誤り**は推測せず error にする: 未知のコマンド（`\frac` `\sqrt` `\mathbf` …）、`$$`、閉じない `$`・`{`、対応しない `}`、空の添字、二重の添字、入れ子の添字、未対応の文字（`@` 等。`\text{…}` に入れるよう hint）、32 段を超える `{…}` の入れ子（スタックを溢れさせない）。位置は原因の文字（閉じない `{`、引数のない `_` 自体）を指し、サロゲートペアの文字は分割しない。
- **診断**（stage `component`。要素の部品を解決した後）:
  - structured: `component/invalid-math`（error。要素は invalid になり描かれない）。`path` は `…label`、メッセージにラベル内の文字位置（コードポイント単位、1 始まり）と該当部分を入れる。`location` は該当文字の範囲を指す: `Locator` に `span`（値の UTF-16 offset）を足し、1 行の plain・single-quoted（`''`）・double-quoted（エスケープを復号して対応を取る）のスカラーでは正確な列、block scalar や折り返した行ではラベル全体の位置にする（`scalarSourceOffset()`）。
  - `auto`: D2 はラベルを文字列として描き、tspan もフォントも渡せない（下記）。`$…$` の中にコマンド・`_`・`^` があるラベルだけを `component/unsupported-in-auto`（**warning**）にし、従来どおり書いたまま描く。`$5 or $10` のような金額は何も出さない。error にしなかったのは、v0.3 までの `auto` の図で `$` は普通の文字で、`\$` の扱いもなかったため（error にすると、そのラベルを書く手段がなくなる）。`auto` では `\$` も書いたまま描く。
  - `auto` で数式を描く方法は採らなかった: D2 にラベルを渡すと D2 が `$\gamma_1$` の文字列で幅を測って描き、描いた後の SVG を tspan に書き換えるには D2 が埋め込んだフォントのサブセットとノードの大きさも作り直す必要がある（D2 の `|latex|` は §5.2 のとおり path で、検索できない）。
- **フォント（判断）**: フォントセット `sumi/biz-ud-gothic` に任意の slot `math`（**STIX Two Math** Regular）と `mathItalic`（**STIX Two Text Italic**）を足した。いずれも v2.13（OFL-1.1、`assets/fonts/stix-two/`、sha256 を `BUNDLED_FONT_SHA256` と README で固定、`sumi doctor` が検査）。フォントセットの ID は変えない（SVG のメタデータの互換）。
  - 理由: STIX Two Text は Regular・Italic とも数学記号（⊕ ≤ ∼ ⋯ ∑ → 等）を持たず（cmap で確認）、STIX Two Math は記号・ギリシャ文字・下付き / 上付き数字・数学用イタリック（U+1D400〜）まで持つが、斜体の変数は別の符号位置（𝛾）でしか持たない。変数を数学用イタリックの符号位置で描くと PDF から `𝛾1` が抽出され、検索で `γ` に当たらない。そこで**変数は STIX Two Text Italic の通常の符号位置（γ、x）**で、それ以外を STIX Two Math で描く。2 書体は同じデザインの系列。Math だけ（すべて立体）にする案は、論文の図の慣習（変数は斜体）と合わないので採らなかった。
  - 大きさ: 2 ファイルで 1,942,604 bytes（gzip -9 で 993,251 bytes）。**実測（darwin-arm64、`release:build`）: tarball 51,394,942 → 52,404,364 bytes（+1,009,422、+0.96 MiB）、`bin/sumi` 68,614,370 → 68,647,394 bytes（+33,024。フォントは従来どおり `share/sumi/fonts/` に置き、バイナリに埋め込まないので増えるのはコードだけ）、展開後 +1.9 MiB**。利用者の判断（約 1MB まで）の範囲。
  - D2 には渡さない（8 つの `--font-*` は従来どおり）。`math` が欠けたフォントセットでは regular、`mathItalic` が欠ければ `math` で描く（`fontFileFor()`）。
  - **代替（判断）**: structured の図では、ラベルのフォントが持たず `math` が持つ文字は、`$` の外でも `math` で描く（`₂` `⁵` `∼` `⋯` `𝑥` 等。§5.3 の BIZ UDPGothic で豆腐になる文字）。文字単位で cmap を引いて run を分ける。下付きの文字（ₐₑₒₓₜ）と絵文字は STIX Two Math にもないので、従来どおり `lint/missing-glyph`。
  - ライセンス: release の `licenses/stix-two/OFL.txt`、`NOTICE` の 4 項（著作権者・RFN "TM Math"・IEEE の商標・入手先）、`README.md`（配布物）に追加し、build はフォントの sha256 と OFL の存在を検査、smoke も確認する。SVG に埋め込むのは BIZ UD と同じく `name` テーブル（著作権・ライセンス）を保った TrueType のサブセットで、配布するフォントファイル自体は無改変。
- **run と計測**（`labelRuns()`、`measureText()`）: ラベルを行ごとの run（文字列・フォント class・`base` / `sub` / `sup`）に分け、`renderedLines()` と同じ規則で空白を run と行をまたいで畳む。run がラベルのフォントの 1 つだけの行しかないラベルは従来の経路のまま（Layout IR の `TextMetrics.runs` を持たない）。
  - 添字の大きさと位置は STIX Two Math の `MATH` 表の定数: 0.7 倍（ScriptPercentScaleDown 70）、下付きは 0.21em 下（SubscriptShiftDown 210）、上付きは 0.36em 上（SuperscriptShiftUp 360）。em はラベルのフォントサイズ。
  - 幅は run ごとにそのフォント・大きさの `hmtx` の和。縦は、各 run のフォントの `hhea` の ascender / descender を run の大きさで、run の baseline（行の baseline + ずれ）の上下に取り、ラベルの `ascentUnits` / `descentUnits` をラベルのフォントの値と全 run の最大にする。行送りは `max(1.25 × size, ascent + descent)`。これで添字が行の箱からはみ出さず、ノードの大きさに入る。
  - **カーニング**: STIX Two は `GPOS` のカーニングを持つ（BIZ UD は持たない）。計測はカーニングなしなので、run を持つラベルの `<text>` に `font-kerning: none` を付ける（usvg 0.47 もブラウザも従う。usvg は style 属性でだけ読む）。STIX Two Text Italic は `f` の前後に幅の変わる文脈置換（`GSUB`）も持ち、usvg は `font-feature-settings` を読まない。SVG のサブセット（subsetter は `GSUB` / `GPOS` を落とす）を使うブラウザは計測どおりに描くので、**PDF / 画像 PPTX でも `resolveSvgFonts()` が math の 2 ファイルから `GSUB` と `GPOS` を除いたコピー（`withoutTables()`）をエンジンに渡す**。これで `$ffiffi$` のような入力でも PDF の文字の位置が計測と一致する。BIZ UD のファイルはそのまま渡す（D2 の図の PDF は変わらない）。
- **SVG**（`structured.ts`）: run を持つラベルは、1 行でもすべての行を **絶対位置の `<tspan x y>`**（y = その行の baseline）にし、その中に run を順に置く。ラベルのフォント・大きさ・baseline の run は文字のまま、それ以外は `<tspan class="text-math-italic" style="font-size:…px" dy="…">`（違う属性だけ）。run の `dy` は同じ行の直前の run の baseline からの差。行を `dy` でなく `y` にしたのは、空行（中身のない `<tspan>`）では描画系が `dy` を適用せず、添字で終わる行のずれも次の行へ持ち越されるため（PDF で 13pt ずれる例があった）。**`dx` は使わない**（usvg は `text-anchor` の幅を advance の和で求め `dx` を含めないため、上付きと下付きを積み重ねると中央揃えがブラウザとずれる）。フォントは class ごとのサブセットで、`math` / `math-italic` も同じ `@font-face` の仕組み（`sumi-<n>-font-math`）。`<text>` に付くラベル自身のフォント class は、全文字が数式の run でも `@font-face` を持つ（`.notdef` だけのサブセット。finalize の `svg/missing-font-face` を満たす）。
- **inspect と幾何 lint**: `readLabel()` は行の `<tspan>` の中の run（文字か、`class`・`style` の `font-size`・`dy` だけを持つ `<tspan>`、入れ子なし）を読み、`LabelGeometry.runs` に文字・フォント class・大きさ・baseline のずれを入れる。行の baseline は行の `<tspan>` の `y`（run を持つラベル）か、すべての `dy` の累積（D2 の SVG）で求め、行送りが等しいことを従来どおり検査する（D2 の SVG は run を持たず、結果は従来と同じ）。`measureLabel()` は run ごとにそのフォントで幅と箱を測り、行の箱を run の箱の和にする（`MeasuredLabel.runs`）。`geometry/text-too-small` はラベルのフォントサイズで判定し、添字（0.7 倍）は対象にしない（TeX の scriptsize と同じ組版上の慣習。Profile の最小は本文の文字に掛かる）。
- **構造 lint**: structured の図では `lint/missing-glyph` を描く run ごとにそのフォントで判定し（代替後に両方にない文字だけを報告）、`lint/long-label` を描く文字（数式の展開後）で数える。`auto` は従来どおり。
- **PDF**: `resolveSvgFonts()` は `sumi-<n>-font-math` / `-math-italic` を `fontFileFor()` のファイルの実名（`"STIX Two Math"` 400、`"STIX Two Text"` 400 italic）に書き換え、**SVG が使うときだけ**そのファイルをエンジンに渡す（D2 の図は従来と同じファイル列なので PDF のバイトも変わらない）。添字は別の y の文字として描かれ、ToUnicode 付きの CID サブセット。**抽出**: 内容ストリームの順（= ラベルの順）に `γ` `1` `,` `β` `1` が並ぶので、Poppler の `pdftotext`（26.x）と Sumi の PDF reader とも `γ1,β1`、`α2` を返す（添字の文字は 1 文字として基底の後に続き、下付き / 上付きの区別は抽出されない。`x_1^2` は `x12`）。examples の PDF の構造検査（全ラベルの位置が `measureLabel()` と 0.01pt 以内）は run ごとに行う。
- **run ごとのフォント（#112）**: v0.4.0 では、PDF と画像方式 PPTX（PNG・輪郭化した SVG）で `$y \nabla x$` `$y \to x$` `$y \leq x$` `$y \mid x$` `$y \partial x$` の変数が斜体でなくなり、ゴシックや立体のセリフで描かれた（SVG は正しく、`\times` は正しい）。
  - **原因**: usvg 0.47（`text/layout.rs` の `process_chunk()` / `shape_text()`）は、text chunk（`x` / `y` を持つ `<tspan>` で区切られる。ラベルでは 1 行）の**全文**を run のフォントごとに shaping し、その run の文字の glyph だけを採る。shaping したフォントに無い文字が chunk のどこかにあると代替のフォントを探し、**代替のフォントが chunk の全文字を持てば、全 glyph をそのフォントに置き換える**。STIX Two Text Italic は `∇` `→` `≤` `∂` `∣` を持たない（Latin-1 の `×` は持つ）ので、`y∇x` を Italic で shaping すると `∇` が欠け、全文字を持つ BIZ UDPGothic（`∣` なら STIX Two Math）に置き換わり、斜体の run `y` `x` がそのフォントで描かれていた。同じ理由で、日本語と数式が混ざる行（STIX Two Math が日本語を持たない）の数式や、`₂` を含む太字のラベルの行（太字に `₂` がなく、STIX Two Math が行の全文字を持つ）の文字も、run のフォントで描かれていなかった。フォントの書き換え（`resolveSvgFonts()`）や `GSUB` / `GPOS` の除去が原因ではない。
  - **修正（判断）**: WASM（usvg）は変えず、`resolveSvgFonts()` が渡すフォントで直した。複数のフォントの run を持つ `<text>` ごとに、各フォントに**ほかの run の文字で、そのフォントに無いもの**を集め、そのフォントの `cmap` にそれらを空白の glyph へ割り当て（`withCodePoints()`。Unicode の対応を format 4（3/1、収まる場合）と format 12（3/10）に書き直し、format 14 の異体字シーケンスは保つ）、family 名を `<family> Sumi Runs <n>` に変えた（`withFamily()`。PostScript 名・著作権・ライセンスの name レコードは保つので、PDF のフォント名は変わらない）**コピー**を、元のファイルの**後に**エンジンに渡し、CSS はそのクラスでコピーを選ぶ。どの run のフォントで chunk を shaping しても、欠けるのは run が**自分の文字**として持たない文字（`lint/missing-glyph` の warning）だけになる。その文字はどのコピーにも足さないので、代替の選択（fontdb の face を順に見て、その文字を持つ最初の face）は**未変更のファイル**を選び（コピーが文字を持つのは元のファイルが持つときだけで、元のファイルが先）、従来どおりに代替する。コピーを代替に使うと、足した空白の glyph がほかの文字の代わりに描かれうる（レビューで、別の `<text>` の `損𝐀` の `損` が消える例を確認）ため、元のファイルを残して改名した。足した glyph はほかの run の位置にしか現れず、usvg はその位置の glyph を各 run のフォントのもので上書きするので描かれない。run の文字とフォントは、`<style>` の規則のクラス（`.text-math` 等）と、要素とその祖先の `class` で決める（ブラウザの継承と同じく、最も近い要素の規則。同じ要素に複数あれば CSS で後の規則）。フォントのクラスを持たない文字（エンジンの既定の family = 未変更の regular で描かれ、CSS でコピーを選べない）は検査には含めるがコピーを作らず、この保証の対象外（Sumi の SVG は `<text>` に必ずフォントのクラスを付ける）。`cmap` を読めないフォント、format 0 でない `name` 表は `<format>/missing-font`。
  - 代替案: 各 run を絶対位置の別の chunk にする（`<tspan x>`）案は、SVG の出力と幅の計算を変え、ブラウザ側の中央揃えにも影響するので採らなかった。usvg を修正して WASM を作り直す案は、未改変のリリースを使う方針（§6.12）に反する。
  - **影響**: 足す文字がないときはコピーを作らないので、`auto` の図（D2 の `<text>` は 1 フォント）と、1 フォントの `<text>` だけの structured の図の PDF / PPTX はバイト単位で変わらない（`examples/dit-block` も同じ）。SVG は変わらない。
  - **検証**: `label-math-fonts.test.ts` が、`symbols.ts` の全コマンド（記号・関数名・空白）と ASCII の記号それぞれを `$y C x$`・`y $C$ x`・`損失 $C x$` に入れた図で、(1) PDF の各 run の glyph が run のフォント（`STIXTwoText-Italic` / `STIXTwoMath-Regular` / `BIZUDPGothic-Regular`）で、計測した位置に 1 つの連続した文字列として描かれること、(2) 画像方式 PPTX の輪郭化した SVG の glyph の輪郭が、各 run を計測した位置に別の `<text>`（1 フォント）として置いた SVG の輪郭と 0.01 unit 以内で一致することを検査する（修正前はどちらも失敗する）。`label-math.test.ts` の PDF の位置の検査も run ごとのフォントを確かめる。`fonts.test.ts` は足す文字・足さない文字（どのフォントにもない文字）・既存の対応の不変・改名と CSS・format 14 の保持、自分のフォントにない文字が未変更のファイルに代替されること（PDF のフォントと画像方式 PPTX の輪郭）、`cmap` を読めないフォントの診断を検査する。
- **PPTX**: 画像方式はそのまま（resvg が文字を輪郭にする）。編集可能方式は run ごとに `<a:r>` を分け、run のフォントの typeface と、添字に DrawingML の `baseline`（下付き −21000、上付き 36000。PowerPoint は baseline のある run を自分で小さく描くので `sz` はラベルの大きさのまま）を付ける。
- **作例**: `examples/dit-block` のバスのラベルを `'$\gamma_1,\beta_1$'`・`$\alpha_1$` 等にした（YAML の flow mapping では `,` を含むので single-quote が要る）。
- **検証**: 記法の単体テスト（run・空白・単項の負号・誤りの位置）、全コマンド・記号・文字が割り当てたフォントに収録されていること（cmap）、`Locator` の span（plain / quote / エスケープ / block scalar）、`auto` の warning と金額の無視、描画した SVG の run が Layout IR と一致し、再計測した箱がレイアウトの箱に入り、幾何 lint 0 件、決定性、PDF の抽出とフォント、編集可能 PPTX の baseline、§5.3 の文字（ギリシャ・下付き / 上付き数字・演算子・数学用イタリック）で `lint/missing-glyph` が出ないこと。release smoke が配布物のバイナリで数式の図を PDF にし、STIX Two の埋め込みと `γ1,β1` の抽出を確かめる。
- **限界・引き継ぎ**: 上付きと下付きは積み重ねない。分数・根号・行列・`\mathbf`・2 段目の添字・太字の数式は対象外（需要が出たら §5.2 の MathJax を再評価）。bold のラベルでも数式は Regular / Italic の太さ。#95（Skill）は、数式は structured だけで使えること、flow mapping での quote、`component/invalid-math` の直し方、`\$` を教える。

### 6.25 #94 のユーザー画像と同梱アイコン

[#86 の調査](../research/86-paper-figures.md)（§6・§9.1 の Issue 7）。Sumi は画像を描かず・加工せず、外部の資産を**検査して埋め込むだけ**にする（利用者の判断 2026-10-26）。すべて追加で、アイコンも画像も使わない図の診断・IR・D2・SVG・PDF・PPTX はバイト単位で変わらない（examples・ギャラリーで変わったのは `examples/transformer` の作例だけ）。

- **`icon`（判断: node のフィールド）**: `nodes[].icon: <set>/<name>`（例 `tabler/wave-sine`。形式はスキーマの pattern）。`tone`・`variant` と同じく部品をまたいだ選択なので props にせず、どの部品の manifest にも宣言させない。
  - 使える部品は**輪郭が普通の図形の node だけ**（box・circle・ellipse・diamond など、と `label`）。mark（operator / junction）・アウトライン部品（trapezoid / stack）・image に書くと `asset/icon-unsupported`。group は対象外（スキーマにない）。
  - アイコンは**ラベルの代わり**に描く。ラベルと両方書くと `asset/icon-with-label`（ラベルを添えるなら attach した label node。図 A の「Positional Encoding」と同じ書き方）。`label` 部品はアイコンがあればラベルなしでよい（`component/missing-label` を出さない。ラベルのない図形の `lint/empty-label` も出さない）。
  - 未知の set は `asset/unknown-icon-set`、未知の名前は `asset/unknown-icon`（編集距離で最も近い名前を hint に。値は 80 文字まで＝スキーマで制限し、候補探しの費用を抑える）。いずれも stage `asset`（`component` の後・`theme` の前の純粋な検査）で、`sumi lint` でも出る。
  - **大きさ**: 1 em（node の実効のフォントサイズ）の正方形を、ラベルの箱の代わりに置く。node の自然な大きさは、その正方形をラベルの箱として §6.21 の `naturalSize()` で求める（academic の circle で 33 unit。`~` のラベルの 34 unit とほぼ同じ）。明示の width / height が優先。位置はラベルと同じ中心（`labelCenter()`。cylinder・document は本体の中央）。
  - **色（判断）**: Tabler の outline は `stroke="currentColor"` の線画なので、`currentColor` を **node の文字色（`fontColor`）** に置き換える。ラベルの代わりに描くものなので、ラベルと同じ色規則に従う: Theme・variant（muted は薄い文字色）・tone（Theme が tone に文字色を定義していればそれ）がそのまま効く。線の太さはアイコンの設計どおり（24 の格子で 2、1 em では 0.083 em）で、Theme の線幅には合わせない（字形と同じ扱い）。
- **`sumi/image`（部品）**: props は `src`（必須）・`sha256`（任意、hex 64 桁、大文字可）・`fit`（`contain` 既定 / `cover` / `fill` → `preserveAspectRatio` の `xMidYMid meet` / `xMidYMid slice` / `none`）・`width` / `height`（**少なくとも一方が必須**。片方なら画像の縦横比から他方を整数 unit に丸めて補う。どちらも書けば `fit` に従う）。ラベル不可（`component/unexpected-label`）。variant は `default`（枠も背景もなし）と `framed`（Theme の線の枠）。tone は背景色になる（`contain` の余白に見える）。manifest には `embed: "image"` を持ち（新しい任意フィールド。登録時に shape rectangle・mark / outline なし・文字列の `src`・`width` / `height`・あれば `contain` / `cover` / `fill` の enum の `fit` を要求。`fit` がなければ `contain`）、コンパイラは部品名ではなく宣言から扱う。
  - 描く順（判断）: node の図形（背景。tone の塗り）→ 画像 → 枠（`framed` の線を `fill="none"` でもう一度）。アイコンは図形の上。塗りが画像を隠さず、枠が画像の縁に重なる（レビューで、tone の塗りが画像を覆う誤りを見つけて直した）。
- **パス（判断）**: `src` は **YAML ファイルのあるディレクトリからの相対パス**（`/` 区切り）。検査段（純粋）で、制御文字・URL（`scheme:`）・絶対パス（POSIX / Windows / `\` 始まり）・`\` を含むもの・ディレクトリ名・正規化して `..` で外へ出るものを `asset/invalid-path`（`props.src` の位置）。描画時に、YAML のディレクトリと対象の**実パス**（シンボリックリンクを解決）を比べ、外なら `asset/outside-base`。開くのは最後の要素をたどらない `O_NOFOLLOW` と、FIFO で書き手を待たない `O_NONBLOCK` で、通常ファイルか・大きさを**開いた記述子**で確かめ、もう一度実パスを解決して「ディレクトリの内側」かつ「開いたものと同じファイル（dev / inode）」であることを確かめてから、同じ記述子で読む。途中のディレクトリを開く直前にシンボリックリンクへ差し替える競合への対策（Node には `openat` がない）: Linux では開いた記述子が指すファイルの実パスをカーネル（`/proc/self/fd/<fd>`）から得て照合するので、後からの差し替えで欺けない。macOS など他の OS ではパスを解決し直して照合する（判断: 残る窓は、図のディレクトリに書き込める別のプロセスが各段階の間で差し替えを往復させる場合だけ。図のディレクトリを信頼できない者が同時に書き換える環境は対象外とし、FFI で `fcntl(F_GETPATH)` を呼ぶ案は可変長引数の ABI で不安定なため採らなかった）。CLI は `dirname(<YAML>)` を `assetBase` として渡す（`sumi render`・`sumi lint --geometry`）。ライブラリの `renderFigure()` で `assetBase` がなく画像があれば `asset/no-base-directory`。
- **形式と上限**（描画時、`asset/*` はすべて error、位置は `props.src`）: 中身のマジックナンバーで PNG / JPEG / SVG を判定し（`asset/unsupported-format`）、拡張子（`.png` / `.jpg` / `.jpeg` / `.svg`）と食い違えば `asset/format-mismatch`、ヘッダが読めなければ `asset/invalid-image`。上限は調査 §6.2 のとおり 1 ファイル 16 MiB・図全体 32 MiB（`asset/too-large`）、PNG / JPEG は 8192 px/辺・16,777,216 画素（`asset/too-many-pixels`）。**縮小せずにエラー**にする（Sumi は画素を変えない）。`sha256` が違えば `asset/sha256-mismatch`（実際の値を本文に）。補った辺が 10,000pt を超える極端な縦横比も `asset/invalid-image`。WebP・GIF は段階 A では受け付けない（調査ではエンジンが読めたが、閲覧アプリでの表示を保証できない）。
- **埋め込み**: PNG / JPEG は**ファイルのバイトそのまま**を base64 の `data:` URI にし、`<image class="sumi-image" xlink:href="data:…">`（`xmlns:xlink` を要素に宣言。PowerPoint の svgBlip など古い SVG 1.1 の読み手でも読める属性）で node の箱に置く。PDF では PNG が Flate の画像、JPEG が **DCTDecode のまま（再圧縮なし）**の画像になる（krilla。実測）。SVG は下記の取り込みで**再直列化した文書**を `data:image/svg+xml;base64` で埋め込み、PDF ではベクターのまま（画像 0）。外部を指す `href` は出力しない。
- **SVG の取り込み（`src/assets/svg-import.ts`、アイコンとユーザーの SVG で共通）**:
  - 厳格な XML parser（既存 `parseXml()`。DTD・未定義の entity・処理命令を拒否）で読む。
  - **unsafe**（`asset/unsafe-svg`）: `script`・`foreignObject`・`style`（CSS は `@import` / `url()` を持てる）・`image`・`use`・`a`・`iframe` / `object` / `embed` / `audio` / `video` / `canvas`・アニメーション（`set` / `animate*` / `discard`）・`feImage`・`cursor`・`font-face-uri`（接頭辞があっても局所名で判定）、`on*` 属性、どの名前空間でも `href` / `src`、値の中の `url(` / `javascript:` / `expression(`、DTD・entity・処理命令。
  - **unsupported**（`asset/unsupported-svg`）: 上記以外の、Sumi が描かない要素（`defs`・グラデーション・`clipPath`・`mask`・`text`・`filter`・`pattern`・`symbol` など）と属性。**黙って捨てない**（絵が変わったことに気づけないため）。描画に効かないものだけを読み飛ばす: `title` / `desc` / `metadata`、エディタの名前空間（sodipodi・inkscape など）の要素・属性、`id`・`class`・`xmlns*`・`version`・`data-*`・`aria-*` など。
  - 許可するのは `svg`・`g`・`path`（円弧 `A` を含む）・`rect`・`circle`・`ellipse`・`line`・`polyline`・`polygon` と、その幾何属性、塗り・線の属性（`fill` / `stroke` 系・`opacity` 系・`fill-rule`・`transform`）、`style` 属性の中の同じプロパティ（属性より優先）。値はすべて厳格な形（数値・path data・色・transform の関数列）で検査し、**入力のテキストは出力に写さず、検査済みの値から書き直す**。#18 §5.5 の規則（円弧・`transform` の拒否）は、Sumi が幾何を測るカスタム輪郭のためのもので、中身を測らない画像・アイコンには適用しない（`transform` は 6 つの関数だけ、円弧はそのまま）。
  - 形式の判定は先頭の `<?xml` / `<!--` / `<!DOCTYPE` / `<svg` だけで行い、ルートが `<svg>` かは parser が決める（長いライセンスのコメントが前にあってもよい）。JPEG はフレームヘッダの長さと成分数を確かめる。
  - 各問題は SVG ファイルの**行・列**を持ち、Diagnostic は YAML の `props.src` の位置に、本文に `<file>:<line>:<column>`、`related` に最大 20 件の SVG 内の位置（`location.file` は src）を付ける。unsafe が 1 つでもあれば code は `asset/unsafe-svg`。
  - 要素 20,000 個・入れ子 32 段を上限にし、**parser が木を作る途中で**数える（読み飛ばす metadata の中も含む。`parseXml()` に任意の上限を追加）。問題は種類ごとに 100 件まで、行・列は行頭の索引の二分探索で求める（多数の誤りでも二乗にならない）。数値はパターンに加えて有限であること（`1e999` は不可）、ルートの大きさも有限・正であることを確かめる。正規表現はすべて入れ子・隣接する量指定子を持たない形にし、長い悪意ある値でも線形時間（20 万文字の値 4 種で 2 秒未満をテスト）。
  - 名前空間は接頭辞の綴りではなく**束縛された URI** で判定する（sodipodi・inkscape・Adobe 等のエディタの URI だけを読み飛ばす。SVG に束縛した `inkscape:g` や SVG 以外の既定の名前空間の要素は unsupported）。
- **アイコンの描き方（判断、#91 の引き継ぎ）**: 入れ子の `<svg>` は使わず、取り込みの結果の図形を `<g class="sumi-icon" transform="translate(…) scale(…)">` の下に置く（viewBox の原点を戻し、1 em の正方形に収まるよう等倍で縮める）。Tabler の大きさの枠（`stroke="none" fill="none"` の path）は捨てる。要素の `<g>` の中、`g.shape` の後ろに置くので、`inspectSvg()`（`g.shape`・`text`・`path.connection` だけを読む）には node の箱として見える。
- **幾何 lint とアイコン（判断）**: アイコンはラベルの代わりなので、幾何 lint の文脈（`createGeometryContext()`）でアイコンの正方形を**文字のない 1 行のラベル**として加える。`label-overflow`（明示サイズが小さすぎる node）・`label-collision`（重なるアイコン）・`edge-crosses-label`・`out-of-canvas` がそのまま掛かり、メッセージは「icon」、位置は `icon`。`text-too-small` は対象外（文字ではない）。structured の `label` 部品のアイコンは `g.shape` に見えない矩形を置き、inspect が箱を測れるようにする（auto は D2 の透明な矩形）。
- **2 つのエンジン**:
  - structured: 配置エンジンがアイコンの正方形をラベルの箱として大きさを決め、writer が `assetMarkup()` を node の `<g>` に直接書く。
  - auto（#53 の合成の流用）: D2 にはアイコンの node を**ラベルなし・structured と同じ大きさの明示サイズ**で、画像の node を**画像の大きさの透明な矩形**で渡す（`label` 部品のアイコンは D2 が空ラベルの text を拒否するため、label の透明なスタイルの rectangle にする）。D2 → finalize → inspect →（アウトラインの合成）の後、`composeAssets()` が inspect で測った箱にアイコン / 画像を XML のオフセットで差し込む。D2 の他のバイトは変えない。画像の大きさの補完は D2 ソースの生成前（`withImageSizes()`）なので、`--emit-d2` と metadata の `d2-sha256` は実際に描いた D2 と一致する。
- **同梱アイコン（判断: 利用者の決定どおり）**: **Tabler Icons 3.49.0（MIT）の outline 全量から Tabler 自身の Brand カテゴリ（376 個。ロゴは商標で、ライセンスとは別の問題が残るため。調査 §6.4）を除いた 4,808 個**。`bun run icons:build` が npm の `@tabler/icons@3.49.0` を sha512 integrity で確かめて取得し、`icons.json` の category と `categories/outline/Brand/` の両方で Brand を除き、全アイコンを取り込みに通してから、元の SVG のバイトを名前順の 1 つの JSON にして gzip した `assets/icons/tabler-outline.json.gz`（244,883 バイト）と LICENSE を書き、sha256 を `src/assets/icons.ts`（`TABLER_ARCHIVE_SHA256`）に記録する。`with { type: "file" }` で単一実行ファイルに埋め込み、最初にアイコンを使うときに sha256 を確かめてから 1 回だけ展開する（不一致・欠落は `asset/icons-unavailable`）。CI の Static checks は `bun run icons:check`（再取得して中身・sha256・LICENSE の一致を検査。gzip のバイトは zlib の版で変わりうるので比べない）。
- **探し方**: `sumi catalog` に `icons` の節（set・名前・版・ライセンス・出典・個数。名前の一覧は大きいので含めない）を追加した（§6.10 の「節の追加だけ」）。`sumi catalog --icons <語>` は、すべての語を含む名前を `icon:` にそのまま書ける `tabler/<name>` の形で 1 行ずつ（`--json` で `{ version, query, icons }`）出す。`asset/unknown-icon` の hint もこの使い方を案内する。
- **来歴とライセンスの告知（調査 §6.4）**:
  - SVG の metadata（形式 1 のまま、属性の追加だけ）: アイコンか画像があれば `assets-sha256` = 文書順に node ごとの行 `icon <set>/<name>@<版> <元の SVG の sha256>` / `image <src> <ファイルの sha256>` を連結した UTF-8 の sha256。同梱アイコンを使った図は、set ごとに `<sumi:notice name version license source>` を `<metadata>` に置き、**本文に LICENSE の全文**を入れる（MIT の「著作権表示と許諾表示を含めること」を、図にクレジットを描かずに満たす）。`readSvgMetadata()` は両方を読み、どちらも省略可。
  - PDF の文書情報と PPTX の custom properties: `SumiAssetsSha256`、`SumiThirdParty`（`Tabler Icons 3.49.0 (MIT): <出典>`）、`SumiThirdPartyNotice`（全文）。`sumi render --json` は告知があるときだけ最後に `notices` を加える。ユーザー自身の画像には告知を付けない（権利は利用者にある）。
  - release: tarball の `licenses/tabler-icons/LICENSE`、NOTICE の 1.d（版・出典・アーカイブの sha256・著作権者）、README の表。`release:smoke` が LICENSE の存在と、コンパイル済みの binary でアイコンと画像を描けることを検査する。
- **PDF・PPTX**: PDF と画像方式 PPTX は SVG をそのまま変換する（エンジンは WASM で host import 0、ファイル・ネットワークに触れない。入力の `data:` URI だけを読む）。**編集可能 PPTX（判断）**: アイコン・画像を持つ図は `pptx/unsupported-asset`（error、node ごと、hint で画像方式を案内）で拒否し、何も書かない。図形を黙って落とさないため。`p:pic` として別の画像にするのは段階 B（調査 §6.2）。編集可能 PPTX の corpus（golden）からはアイコン・画像の図を外した（`examples/transformer` の 2 件が抜けた）。
- **作例**: `examples/transformer` の位置エンコーディングを `~` の円から `icon: tabler/wave-sine` の円にした（structured だけの作例。SVG・PDF・画像方式 PPTX の golden が変わった）。auto の examples の出力はバイト単位で同じ。図 A の調査の YAML（`figures/ideal/a-transformer.sumi.yaml`）は `requires` を外すと**診断ゼロ**になった（§6.19・§6.20 のテストを更新）。
- **ギャラリー**: カタログから自動で `sumi/image` の見本（variant ごと、`fit: cover`、SVG の画像。`tests/fixtures/assets/` の自作画像を読む）を全 Theme で描く。
- **大きさの増分**（darwin-arm64、`bun run release:build`、main `622ea86` との比較）: `bin/sumi` 68,647,394 → 68,944,610 バイト（+297,216。アーカイブ 244,883 + コードと LICENSE）、tarball 52,404,563 → 52,665,720 バイト（+261,157）。
- **レビュー**（opencode）で、途中のディレクトリの差し替え競合・FIFO・tone の塗りが画像を覆う・parser の上限が木を作った後だった・アイコンが幾何 lint に見えない・外部の image manifest の `fit` / 省略可能な `src`（以上 MUST。再レビューで指摘された競合の残りは上記のとおり Linux で記述子から照合）、非有限の数値・名前空間の綴り判定・長いアイコン名・長いコメントの SVG・壊れた JPEG の SOF（SHOULD）を指摘され、上記のとおり直した。
- **テスト**: 取り込み（許可・再直列化・`currentColor`、unsafe 11 種と DTD / entity / 処理命令の位置、unsupported、invalid、線形時間、parser 時点の上限、多数の誤り、名前空間の URI、非有限の数値）、FIFO、tone と枠の描く順、アイコンの重なりと小さすぎる node の幾何 lint、外部の image manifest、同梱の全 4,808 個が取り込みを通り Brand を含まないこと、パスの検査 13 例、PNG / JPEG のヘッダ、検査段の各診断と位置、読み込み（3 形式の `data:` URI と大きさ、再直列化、`assets-sha256`、告知、sha256 の照合、unsafe / unsupported の fixture 7 個の位置、存在しない・ディレクトリ・形式の不一致・未対応形式・壊れたヘッダ・base なし、シンボリックリンクでの脱出 2 種、1 ファイル・図全体・画素の上限、極端な縦横比）。描画（`tests/fixtures/assets/images*.sumi.yaml`、PNG・JPEG・SVG の画像とアイコンを structured と auto で）: 2 回の描画のバイト一致、幾何 lint 0 件、inspect、入れ子の `<svg>` と外部 `href` がないこと、PDF の画像数と文書情報、PPTX の custom properties、SVG / PDF / 画像方式 PPTX の sha256 golden（`outputs-sha256.json`）、編集可能 PPTX の拒否、アイコンの色が variant に従うこと、資産のない図に metadata が増えないこと。CLI の E2E（cwd と違うディレクトリの YAML からの相対パス・`--json` の `notices`・`..` の位置付きエラーで何も書かない・編集可能 PPTX の拒否）。全部品の描画テスト・PDF / PPTX の corpus に `sumi/image` が加わった。
- **限界・引き継ぎ**: アイコンとラベルの併記、group のアイコン、角のバッジ（`badge`）と絵文字（Fluent Emoji Flat）は段階 C。画像の `layers`（ずらした重ね）も段階 C。編集可能 PPTX の `p:pic` は段階 B。WebP / GIF・`sumi fmt --pin-assets`（sha256 の書き込み）・プロジェクト単位の asset ルートは需要が出てから。#95（Skill）は、`icon:` の書き方と `sumi catalog --icons` での探し方、`sumi/image` のパスの規則（YAML からの相対、外に出ない、`width` か `height`）、`asset/*` の直し方、編集可能 PPTX では使えないことを教える。

### 6.26 #101 の structured の図の仕上げ（隠れた junction・何もない先への矢印・角の丸め）

段階 A の仕上げ。#91 で描けるようになった `examples/transformer`・`examples/dit-block` を原図と見比べて残った差（分岐点の黒丸、DiT の出力矢印の先の黒丸、角の鋭い残差の線）を詰めた。**hidden junction を使わない `auto` の図**の診断・IR・D2・SVG・PDF・PPTX はバイト単位で変わらない（auto の examples・ギャラリーで変わったのは、variant が 1 つ増えた junction のギャラリーの見本だけ）。structured の図は、junction の variant によらず線の角が丸くなる（下記）ので、SVG・PDF・画像方式 PPTX が変わる（golden は 2 つの作例）。

- **黒丸を出さない junction（判断: variant `hidden`）**: `sumi/junction` の variant を `default` / `muted` / **`hidden`** にした。組み込みの 4 Theme は `hidden` を `fill: transparent`・`stroke: transparent`・`strokeWidth: 0pt` と定義する。§6.20 の mark の大きさ（線幅 × 3、最小 1 unit）により点は 1 unit になる。要素は残る（inspect の `g.shape` の `<circle>`、ネット、経路の端点）ので、ルータ・inspect・幾何 lint の契約は変わらない。
  - variant にした理由: 見た目の選択で、部品の意味（props）ではない（§6.20 の tone と同じ考え方）。Theme の設定（Theme ごとに黒丸の有無を変える）にしなかったのは、同じ YAML が `--theme` の切り替えで「分岐」と「交差」の区別を失うのを避けるため。また既存の Theme の junction を変えると auto の出力が変わる。`hidden` を定義しない利用者の Theme では、他の variant と同じく `theme/missing-variant`（warning）で既定の黒丸になる（黙って消さない）。
  - **既定は黒丸のまま（判断）**: 黒丸は「線が合流している」ことと「無関係の線が交差している」ことを見分ける唯一の印である。ルータ（§6.22）は異なるネットの交差を費用 300 で避けるが、禁止ではなく貪欲なので、交差が残る図はありうる（`checkRoutes` の検査では検出するが、描いた図からは読み取れない）。また auto（ELK）は交差を避けない。したがって安全な既定は黒丸で、原図のような滑らかな分岐は、近くに交差がないことを作者が確かめたうえで `hidden` を選ぶ。両エンジンで同じ YAML が同じ意味になるよう、エンジンごとに既定を変えることもしない。
- **何もない先への矢印（判断: 1 本だけの hidden junction）**: 新しい部品は足さず、**`hidden` の junction を矢印の先に置く**（DiT の `add2 → out`）。junction は §6.22 のとおり中心が端点で stub がないので、矢印の先端は点の中心（何もない位置）になる。端点だけの部品を別に作ると、点・ネット・inspect の扱いが junction と同じものが 2 つになる。矢じりを置く場所は §6.22 と同じ規則（直前の線分が矢じりより短ければ `layout/no-route`）なので、作例のように直線上に置くのがよい。
- **角の丸め（判断: structured の線は常に丸める）**: `src/render/wire.ts` の `roundCorners()` で、線（`path.sumi-wire`）の折れを最大半径 **8 unit（4pt）** の四分円（3 次 Bézier、制御点 0.5523r）にする。D2 も ELK の直交の経路の角を 10 unit で丸めるので、auto と structured の見た目がそろう（4pt にしたのは structured の方がブロックを密に置くため）。
  - 1 本の経路の折れ: 両側の脚を r ずつ切り、弧でつなぐ。同じ線（ネット・スタイル）の別の経路がその角をまっすぐ通る場合（幹線から 1 本が離れる）は、その経路の線分が角を覆ったままなので、離れる側だけが弧で滑らかに分かれる。
  - **hidden junction を通る結合**（hidden junction は variant が `hidden` で、Theme の解決した塗りが `transparent`、線が `transparent` か幅 0 のもの。`isHiddenJunction()`。利用者の Theme が既定の junction を中空の点にしても対象にならない）: 入る経路と出る経路の組（入るだけ・出るだけの junction では全組）で、直交する組は弧でつなぐ。反対向きの相手（まっすぐ通り抜ける組）がある経路は切らない。これで「本線から残差が曲がって分かれる」（入る線と出る線の一方がまっすぐ）、「左右に分かれる」（両方を切る）が原図どおりになる。junction の弧の半径は 1 つ（すべての切り口が弧と合う）。黒丸のある junction は丸めない（点が結合の位置を示す。点の手前で曲がると点とずれる）。線のスタイルが混ざる junction、矢じりで線が中心まで届かない junction も丸めない。
  - 半径の上限: 各脚の半分（両端の角の弧が重ならない。矢じりのある端の脚では、さらに矢じりの下を通る部分を除いた長さ。#116 で、弧が矢じりに重ならないことを writer の側でも保証した。ルータは角の前に矢じり + 最大半径の直線を空けようとする（§6.22 の余白）ので、通常は半径 8 まで取れ、余白がない端では弧が小さくなるか角が鋭いままになる。hidden junction 側の脚は、junction の弧が付く長さ（切られない脚でも弧の付け根は残す）を除いた全長）と、弧を含む「2 本の脚が張る正方形」が障害物から線幅以上離れる最大。障害物は node（hidden junction を除く）の矩形、group・edge のラベルの箱、他のネットの線分。線幅に満たない半径しか取れない角は丸めない。弧は角の内側（2 本の脚の間）にあり、正方形が障害物に触れないので、`geometry/edge-through-node` などの判定は折れ線（下記）のままで正しい。
  - **hidden junction の弧と矢じり（#160）**: #116 の時点では、junction の弧の半径の上限は各脚の半分だけで、矢じりの下を通る部分（`keepStart` / `keepEnd`）を見ていなかった（PR #158 のレビューで指摘）。junction から矢先まで 10 unit の `arrow`（長さ 8、線は 5.2 で止まり 3.2 が矢じりの下）では半径 2.6 になり、弧が矢じりの切り欠きに入る。junction の脚が経路の唯一の線分なら、上限を「脚の半分」と「脚 − 反対の端の矢じりの下の長さ」の小さい方にした（`JunctionEnd.room`）。junction の端そのものに矢じりの下の部分がある（`cross` は線が中心まで届くので結合されうる）脚は 0 とする。弧は脚に乗るので、上限は脚（junction から出る向き）ごとに、その脚に沿うすべての経路の最小を取る。直交する相手がなく弧の組に入らない経路（相手が平行な経路）も、同じ脚を通る別の組の弧を制限する（レビューで指摘）。junction の端に `cross` がある脚に弧が付く組があれば、junction の半径は 1 つなのでその junction は丸めない。上限が線幅に満たなければ従来どおり鋭い角のまま。組み込みの矢印（`arrow`・`double-arrow`）の矢じりは三角形で、線は矢じりの底で止まり下を通らない（`keep` = 0）ので、組み込み部品だけの図では起きない。起きるのは独自の edge 部品で `arrow`・`cross` の矢じりを使う場合だけで、既存の作例・調査の図・fixture（`.sumi.yaml` 108 件のうち描画できる 72 件）の描画はバイト単位で変わらない（修正前後で SVG を比較）。独自部品の再現図（junction から上の node まで 1.5mm の `arrow`、1.5〜2mm の `cross`）で、弧が矢じりから外れることを PNG で確認した。テストは `wire.test.ts`（指摘の数値、入る経路の始点の矢じり、余地が足りず鋭いまま、矢じりの前で曲がる経路は従来どおり、組に入らない経路が共有する脚、両端の矢じり、脚以上の長さの矢じり、線幅ちょうど・わずかに下の余地、junction の端の矢じり）。
  - **inspect 契約（§6.3）**: edge ごとの `path.connection` は従来どおり経路の折れ線（M / L）のまま。inspect・幾何 lint・編集可能 PPTX はこれを読む。丸めは見た目の線（`path.sumi-wire`、inspect が読まない）だけに `C` で入れる。`path.connection` 自体を `C` にすることも §6.3 の許可の範囲だが、ルータの検査・lint・編集可能 PPTX のコネクタが前提とする直交の折れ線を保つため、変えなかった。
  - **PDF・PPTX**: PDF と画像方式 PPTX は SVG をそのまま変換するので、弧はベクターの曲線として出る（作例の PDF golden で確認）。編集可能 PPTX は従来どおり `path.connection` から線を作るので角は鋭いまま（DrawingML のコネクタに角の丸めはなく、freeform で弧を描くと glued のコネクタと形が変わるため。段階 B で検討）。hidden junction は塗りも線もない図形になる。
- **auto での hidden junction**: D2 は線を node の輪郭の手前（約 1 unit）で止めるので、点を描かないと分岐点に隙間が見える（academic の 0.5pt の線で約 0.5pt）。`composeJunctionEnds()`（`src/render/compose.ts`）が、hidden junction に接する**矢じりのない端**を、その端の向きのまま junction の中心の射影まで延ばす（§6.13 の outline と同じく `path.connection` の `d` だけを編集し、編集後にもう一度 inspect する）。矢じりのある端（何もない先への矢印）は D2 の描いたまま。hidden junction のない図は何もしない（バイト単位で同じ）。D2 に渡す D2 ソース・ELK の配置は、点が 1 unit になる以外は変わらない。
- **作例**: 2 つの作例の junction をすべて `hidden` にした。Transformer は Q・K・V への分岐が本線から左右に弧で分かれ、残差は本線から曲がって離れる。DiT は残差が本線から滑らかに分かれ、最上部の出力矢印は何もない先で終わる（黒丸なし）。点が 3 unit から 1 unit になった分、縦の大きさが少し縮んだ。描いた PNG（画像方式 PPTX の経路と同じ resvg）で原図と見比べて確認した。
- **テスト**: `wire.test.ts`（L 字の弧と切り口・四分円上の中点、脚の半分の上限、障害物による縮小と丸めない角、正方形の外の障害物、幹線が角を覆うこと、hidden junction の分岐・左右の分岐・L 字・切られない脚の全長・入るだけの junction・1 本だけの端）、`junction.integration.test.ts`（structured: hidden の点が描かれず 1 unit、分岐と残差の弧の数、黒丸の junction は丸めない、inspect は M / L のまま、幾何 lint 0 件、決定性。auto: hidden では線の端が中心から 1 unit 以内、黒丸では D2 の位置のまま、矢印の先端は動かさない、幾何 lint 0 件）。golden: 2 つの作例の SVG・PDF・画像方式 PPTX・編集可能 PPTX（DiT）、junction のギャラリーの見本（`hidden` の行が加わった）とその PDF / PPTX。
- **限界・引き継ぎ**: 弧の半径はコードの定数（Theme の値にはしていない。需要が出れば Theme の `line` に足す）。hidden junction の安全性（近くに交差がないこと）は作者の判断で、検査はしない。#95（Skill）は `variant: hidden` の使いどころ（滑らかな分岐・何もない先への矢印）と、交差と見分けられなくなる注意を教える。

### 6.27 #127 のグループ見出しの位置（`groups[].labelAt`）

段階 B（[#124 の計画](../research/124-stage-b.md) §3.1・§5-1）の 1 件目。#109 の 4 図中 3 図で、structured の上端中央に固定の見出し（§6.21）が上から入る辺とぶつかった。Figure v1 への任意フィールドの追加で、**`labelAt` を書かない図**の IR・Layout IR・D2・SVG・PDF・PPTX はバイト単位で変わらない（既存の golden・作例・ギャラリーは無変更）。診断も code・位置・本文は変わらず、変わるのは下記の hint の文言だけ（新しい warning は `labelAt` を書いた図にだけ出る）。

- **フィールド**: `groups[].labelAt`: `top-left` | `top` | `top-right` | `bottom-left` | `bottom` | `bottom-right`（Zod の enum で閉じる。誤った値は `schema/invalid-value` と最も近い値の提案）。見出しは常に**枠の内側**で、位置は名前で指定する（座標・オフセットは書かせない。#124 §2）。値の名前は、中央を `top` / `bottom`（D2 の `top-center` ではなく）として短くした。`fmt --canonical-order` は `label` の直後に並べる（スキーマのフィールド順。既定の `fmt` はキーの順を保つ）。
- **見出しのない group（判断: warning）**: `label` が省略・空・空白だけの group に `labelAt` を書くと `component/label-at-without-label`（warning、`groups[i].labelAt` の位置。hint: ラベルを足すか `labelAt` を消す）。見える見出しがないので error にはしないが、黙って無視もしない（§6.19 と同じ考え方）。group は有効なまま。省略・空のラベルは場所を取らないので `labelAt` は何も変えない。空白だけのラベルは structured では計測されて空の帯が残り、`labelAt` はその帯を上下に動かす（子の位置が変わる。メッセージで区別し、`engine.test.ts` で固定）。
- **省略時の既定（判断）**: エンジンごとに今の位置のまま。structured は上端中央（`top`）、auto は左上（`top-left`、§6.6 の #31 の判断）。正規化で既定値を埋めず、IR（`GroupIR.labelAt`）も**書いたときだけ**持つ。各段（配置エンジン・D2・lint の hint）が自分のエンジンの既定を当てる。structured の既定を auto に合わせて左上にする案は採らなかった（#124 §8 Q2、利用者の判断 2026-10-27）: `examples/dit-block` の golden が変わり、位置は `labelAt` で個別に変えられるため。エンジンごとに既定が違うことは残るが、両エンジンで同じ見た目にしたい図は `labelAt` を書けばよい。
- **structured（`src/layout/structured/engine.ts`）**: 見出しの帯（見出しの高さを整数 unit に切り上げたもの＋padding の半分。§6.21）を、`bottom*` では内容の**下**に、それ以外では上に取る。group の大きさは位置によらない（幅は見出しの幅以上、高さは内容＋padding＋帯）。見出しの箱は padding の内側に置く: 左は `rect.x + padding`、右は `rect.x + rect.width − padding` に箱の端を合わせ、中央は従来どおり枠の中央。上は `rect.y + padding` に箱の上端、下は `rect.y + rect.height − padding` に箱の下端。Layout IR の形（`label.box` / `anchor`）は変えず、`anchor.x` は箱の中央のまま（`text-anchor: middle`）なので、writer・inspect・幾何 lint・PDF・編集可能 PPTX（anchor の偏りを左右の inset にする）は変更なしで従う。複数行の見出しは、左右に寄せても行ごとには中央揃え（箱が寄るだけ）。ルータは従来どおり `group.label.box` を障害物として避ける。
  - `top` は従来の式そのもの（`rect.x + rect.width / 2`、`rect.y + padding + h / 2`）で、省略と `top` の Layout IR・SVG が一致することをテストで確かめる（SVG はメタデータの入力の sha256 を除いて一致）。
- **auto（`src/compiler/d2.ts`）**: D2 の container の `label.near` に写す: `top-left` / `top-center` / `top-right` / `bottom-left` / `bottom-center` / `bottom-right`。固定 D2 v0.9.0 が 13 値すべてを受け付け、内側の 6 値では container の大きさが変わらないことは #124 で実測した（`research/124-stage-b/results/d2-probes.json`）。D2/ELK は `bottom*` でも見出しの分の余白を上に取ったまま見出しを下端の内側に描く（上に空きが残る。D2 の挙動で、Sumi は配置に介入しない）。省略時は従来どおり `top-left` を書く。
- **幾何 lint の hint（判断: 文言だけ変える）**: `geometry/edge-crosses-label` の group の見出しの hint は、その group の実効の `labelAt`（省略時はエンジンの既定）で、見出しの位置（「top centre」「bottom-right corner」など）と、**その側から見出しの近くに入る辺なら**見出しを横切ること（lint は経路の向きを調べないので条件の形で書く）を述べ、**`labelAt` で移す案**（今の位置以外の候補。例: `top` なら `top-left, top-right or bottom`）を先頭に挙げる。structured の anchor の例は見出しのある側で、見出しから離れた位置にする（右寄せの見出しは `north:0.15` / `south:0.15`、左寄せと中央は `…:0.85`。中央は #127 以前の例と同じ）。`geometry/label-collision` で一方が group の見出しのときの既定の hint にも `labelAt` を加えた。どの位置が空いているかは図による（#124 §3.1 の図 2: `top-left` にすると別の辺のラベルとぶつかる）ので、自動では動かさず、既存の lint の報告と hint で作者が選ぶ。
- **テスト**: `engine.test.ts`（6 値で、group の大きさが同じ・見出しの箱が padding の内側の指定の位置・帯が内容の上か下・`anchor.x` が箱の中央、省略と `top` の Layout IR の一致）、`figure.test.ts`（任意・誤った値の位置）、`resolve.test.ts`（見出しの省略・空・空白だけで warning、group は有効）、`rules.test.ts`（hint が `labelAt` と engine に従う）、`group-label-at.integration.test.ts`（6 値 × 両エンジンの fixture で、inspect して再計測した見出しの箱が group の枠の内側の上下 1/3・左右の指定の側にあり、幾何 lint 0 件・診断 0 件。まっすぐ進めば下端中央・右上の見出しを横切る辺を、ルータが見出しの箱を避けて引く。編集可能 PPTX の見出しの文字領域（形の範囲から inset を引いたもの）の中央と上端が、SVG の anchor と 1 行目の上端に EMU の丸めの範囲で一致する。#124 の図 1 の草案（見出し `top-left` ×2）が診断ゼロ）。golden: Layout IR（`tests/fixtures/layout/group-label-at.layout.json`・`.routed.layout.json`）と D2 ソース（`tests/fixtures/d2/group-label-at.d2`）。図 1 の草案は `requires: ">=0.5.0"`（この版より新しい）と辺の `labelAt`（#128 の範囲）だけをテストの中で外して描く。
- **非対象・引き継ぎ**: 枠の外（D2 の `outside-*`）・側面（`center-*`）の見出し、見出しの回転、見出しの位置の自動選択（#127 の非対象。#124 §6）。Skill の説明（`structured.md` の回避策の置き換え）は #135。

### 6.28 #133 の structured の図での交差の報告

[#124 の調査](../research/124-stage-b.md) §3.7 の判断（Issue 7）。ルータの交差は費用で、禁止ではなく貪欲なので（§6.22）、密な図では別のネットの交差が残る（#109 の図 3 で 4 点）。費用の調整・辺の順序・rip-up・交渉は効果が 1 点以下で、遠回りか時間が増えたので採らず、交差を **`layout/edge-crossing`（info）** として作者に知らせ、辺の順序・anchor・配置で直せるようにする。描いた出力（SVG・PDF・PPTX・Layout IR）はバイト単位で変わらず、info の診断が増えるだけ。

- **段と入口**: `routeEdges()`（経路の選択は `chooseRouting()`）が、no-route の再試行（§6.22 の stub の線）で結果を選んだ後、すべてのエッジに経路があるとき（`layout/no-route` が 0 件）だけ、`crossingDiagnostics(ir, layout)`（`src/layout/route/crossings.ts`）を足す。`renderFigure()`・`layoutStructuredFigure()`・`sumi render`・`sumi lint --geometry`（layout の段は描画の診断も残す。`src/lint/geometry/lint.ts` の `MIXED_STAGES`）に同じ診断が出る。`layout/no-route` がある図は描画が失敗するので、交差は出さない（直すべき error を埋もれさせない）。再試行で全エッジが引けた場合は、その結果の交差を出す。
- **交差の定義（判断）**: 2 つのネットの `nets[].segments`（ネットの経路の和を最大の軸平行な線分にしたもの）で、一方の水平な線分と他方の垂直な線分が、**両方の内側**（端から 0.01 unit より内）で交わる点。
  - 同じネットの中（共有の幹線、junction で合流する線、橋渡しされたネットの分岐点）は数えない。
  - 一方の端や折れが他方の線上にある（T 字に触れる）だけは交差ではない（`checkRoutes` の接触。ルータが別の費用で避ける）。重なりも同様。
  - **同じ点は 1 件**: 両方のネットがその点を縦にも横にも通る場合（水平 × 垂直が 2 通り見つかる）は、ネットの組と点で 1 件にまとめ、両方の向きで交わるエッジを合わせて示す。
  - **交わるエッジ**: その点を、自分の線分（交わる向きのもの）の**内側**で通るエッジだけを示す。その点で折れるだけ・終わるだけのエッジや、相手の線に重なって進むエッジは示さない（位置にもしない）。どちらかのネットにそうしたエッジが 1 本もない点（ネットの線分の和では通り抜けて見えるが、実際は折れの組み合わせか、端どうしが一直線に接するだけ、または相手の線に重なる）は、読む人に見える交差ではない縮退した合流・重なりとして**報告しない**（重なり・接触はルータの費用と `checkRoutes` の範囲）。
  - **点ごとに 1 件（判断）**: 共有の幹線を 1 本の線として数えるので、3 本の幹線と 1 本の線の交差は 1 件。`checkRoutes().crossings`（エッジの組ごと。§6.22）とは数え方が違うが、各点の両側のエッジの数の積の和は `checkRoutes` の件数と一致する（テストで確かめる。図 3 は 4 点・9 組、図 2 は 2 点・2 組）。読む人に見える交差の数は点の数で、組ごとに出すと 1 つの交差に 3〜4 件が並ぶ。
- **診断の形**:
  - 2 つのネットのうち、最初のエッジが文書で後のネット（ルータが後に引いた方。先に書いた辺がまっすぐになるので、直す候補）の、その点を通るエッジのうち最初のものを位置（`path`・`location`・`subject`）にする。
  - メッセージは両側のエッジ（`edges[6] ("infer-api" → "infer-worker")`、ID があれば `"id" (...)`）と、点の位置（キャンバスの左上からの mm、小数 1 桁）。片側が複数のエッジなら「the line shared by ... and ...」。
  - `related` は、相手の側のエッジ（`Crossed edge ...`）、次に自分の側の残りのエッジ（`... runs on the same line.`）の YAML の位置。
  - hint: 交差は error ではないこと、先に書いた辺がまっすぐになるので直したい辺を前に移す、`fromAnchor` / `toAnchor` で別の辺から出す、配置（`gap`・箱の項目の順序・`align`）を変える、入れ替わる 2 本のように避けられない交差もあること。
  - 順序: 後のネットのエッジの文書順、相手のエッジの文書順、上から下、左から右（決定的）。
- **件数の上限（判断: 10 件 ＋ 要約 1 件）**: `MAX_REPORTED_CROSSINGS = 10` 件まで個別に出し、それより多ければ位置のない 1 件（`N more edge crossings are not listed (M in total).`、subject は figure）を足す。合成 grid（交差 1233 点）でも 11 件。10 件は、#109 の 4 図（最大 4 点）を全部示し、直す順に上から読める量として選んだ。上限を変える設定は足さない（需要が出たら lint の設定に寄せる）。
- **severity は info（判断）**: 入れ替わり（2 本が互いの側へ渡る）のように構造上避けられない交差があり、warning にすると `--max-warnings` で CI を落とす。lint 規則（`--rule` で上げ下げできる規則）にはしていない（`layout/no-route` と同じく描画の段の診断）。
- **時間**: 交差の判定はネットの組ごとに水平 × 垂直の線分を比べるだけ。合成 columns（129 辺・23 点）で 1.2ms、合成 grid（146 辺・1233 点）で 12.7ms（Apple M4 Pro、Bun 1.3.14、5 回の平均。経路探索の約 350ms に対して 4% 弱）。ネットの組ごとに H1·V2 + V1·H2 回（H・V はネットの水平・垂直の線分の数）の比較と、見つかった交差ごとに 2 つのネットのエッジの線分を走査する。
- **テスト**: `crossings.test.ts` で、2 本の交差、両向きで交わる同じ点（2 通りの順序）、折れるだけのエッジを示さないこと、同じネット、T 字・L 字の接触、重なり、0.01 unit の境界、`chooseRouting` の再試行（全エッジが引けた再試行は交差を出す、no-route が残れば出さない、error が減らない再試行は採らない）。合成図の件数は `checkRoutes` の組から独立に数えた点の数（23・1233。#134 の配置の木による辺の選択で 24・1169、§6.33）と要約の文で固定する。
- **結果**: 作例 2 つ・fixture（図 A・B のパネル・画像）・#113 の再現で 0 件（テストで固定）。#109 の図 3（v0.4.1）で 4 件、図 2 で 2 件。
- **限界・引き継ぎ**: 交差の自動の削減はしない（#124 §3.7）。hidden junction（§6.26）の近くの交差かどうかは区別しない（交差の位置から作者が確かめる）。auto（D2/ELK）の図の交差は報告しない（D2 の経路のネットは Sumi が持たない）。Skill の読み方は #135。

### 6.29 #129 の数式のアクセント

段階 B（[#124 の調査](../research/124-stage-b.md) §3.6・§5-3）。§6.24 のラベルの数式に `\hat` `\tilde` `\bar` `\dot` `\ddot` `\vec` を足した。今までエラーだった記法が通るようになるだけで、**アクセントのない図の出力（D2 ソース・SVG・PDF・PPTX・lint の golden・ギャラリー）はバイト単位で変わらない**。

- **記法**（`src/core/label/math.ts`・`symbols.ts` の `ACCENT_COMMANDS`）: 引数は 1 文字か 1 コマンド（`\hat y`、`\hat{y}`、`\bar\theta`、`\hat{\nabla}`）で、数式のフォントの 1 文字になるもの。アクセントの付いた atom は ord（TeX の Acc と同じ）で、後の `_` / `^` はその atom に付く（`\hat\theta_t`）。添字の中（`x_{\hat i}`）と `\mathrm{…}` の中でも書ける。アクセントは結合文字（U+0302 0303 0304 0307 0308 20D7）として、基底の run（`MarkupRun.accent`）に持たせ、その run は隣と結合しない（`mergeableRuns()`）。
  - **エラー**（`component/invalid-math`。位置は §6.24 と同じく文字の範囲）: 複数文字の引数（`\hat{xy}`・`\hat\log`・`\hat{x_t}`・`\hat\text{a}`・空白）は引数の範囲、引数がない（`\hat`、`\hat}`）はコマンドの範囲、入れ子（`\hat\hat x` は引数に入る前に拒否するので、深い入れ子でもスタックを溢れさせない。`\hat{\hat x}` は §6.24 の 32 段の上限の中）、幅のあるアクセント（`\widehat` `\widetilde` `\overline` `\overrightarrow` 等、`WIDE_ACCENT_COMMANDS`）は未知のコマンドより具体的なメッセージで、どれも `\hat{y}` の形を hint に示す。`\imath` / `\jmath` は対象外（`\hat i` は i の点の上に描く）。
- **位置（判断: Sumi が決める。#124 の方式 C）**: どの出力でも GPOS の `mark` は効かない（SVG のサブセットは GPOS を持たず §6.23、PDF / 画像方式 PPTX は数式フォントから GSUB / GPOS を外す §6.24）。そこで `placeAccent()`（`src/layout/text.ts`）が、基底の字形の箱（`glyf`）の中央に、斜体の傾き（`post.italicAngle`、STIX Two Text Italic は −12°）× 箱の高さの半分を足した位置に、アクセントの字形の箱の中央を合わせる。縦は、アクセントの字形の下端を基底の字形の上端の **0.04em** 上に置く（`ACCENT_GAP`）。アクセントは基底と同じフォント・大きさ（Text Italic と Math の両方が 6 種を持つ）。字形の箱は `FontMetrics.glyphBounds()`（`loca` / `glyf`）、傾きは `FontMetrics.italicAngle`。`TextMeasurer` の任意の `glyphBox` / `slant` がなければ（テストの測り）、基底の advance の中央、アクセントは基底の baseline のまま。
  - 合成済み文字（`ŷ`）への置き換えは採らない（ȳ・θ̂ がない）。結合文字を `<tspan dy>` で上げるだけの方式は Chrome でアクセントが基底から外れる（#124 の方式 D）。
- **計測**（`measureText()`）: アクセントの advance（STIX Two では 0）は行の幅に足さない。Layout IR の `TextRun.accent`（`TextAccent`: 文字、run の始点からの pen の位置 `dxUnits`、行の baseline からのずれ `shiftUnits`、advance `width`）に位置を持たせる。行の ascent / descent はアクセントの**字形の箱**まで広げる（背の高い基底では ascender を超える。16 unit のラベルで BIZ UDPGothic の ascender は 14.08 unit、`\hat\theta` のアクセントの上端は 14.56、`\vec\nabla` は 15.70。`y`・`W` の `\hat` は超えない）。超えた行は行送り（`max(1.25 × size, ascent + descent)`）と箱が広がる。`TextMetrics.lines` は基底の後に結合文字を並べる（`y` U+0302。SVG・PDF の文字の順と同じ）。
- **SVG（判断: アクセントのある行だけ絶対位置の chunk）**: §6.24 の run の仕組み（行ごとに絶対位置の `<tspan x y>`、run は `dy` だけ、`dx` は使わない）では、アクセントを基底の上に戻す水平の移動が書けない。そこで、アクセントを持つ run のある行だけを chunk（`<tspan x y>`）の列にする（`accentChunks()`）: 基底で chunk を閉じ、アクセントは自分の chunk（pen の位置 = 基底の run の始点 + `dxUnits`、run の `dy` で行の baseline から上げる）、その後の文字は基底の advance の終わりから次の chunk。`text-anchor: middle` は chunk ごとに効くので、各 chunk の `x` はその chunk の中央（Sumi は各 run の幅を測っている）。chunk の `y` はどれも行の baseline。
  - **chunk を空白で始めない**: usvg は chunk の先頭の空白を畳み、Chrome は畳まない（#124 の方式 E で、後ろの文字が左に詰まった）。`labelRuns()` がアクセントの直後の run の先頭の空白（U+0020 も、自動の空白 U+2004/2005 も、`\,` 等も）を別の run に分け、空白だけの run（別のフォントの `\,` など）を挟んでも、その後の run の先頭の空白まで分ける。writer はそれらをアクセントの chunk の末尾に置く（空白は前の chunk の末尾、#124 §3.6 のとおり。usvg も chunk の末尾の空白は保つことを PDF の位置で確かめた）。
  - アクセントのない行・ラベルは従来どおり 1 行 1 つの `<tspan>`（またはそれもなし）なので、出力は変わらない。アクセントの文字は基底と同じフォントのサブセットに入る。
- **inspect の契約の拡張（§6.3）**: run を持つラベルで、直前の行と同じ baseline の `y` と `x` を持つ `<tspan>` は、その行の続きの chunk として読む。chunk が 2 つ以上の行では、各 chunk の最初の run に `LabelRunGeometry.chunkX`（その chunk の中央）を入れ、2 つ目以降の chunk で結合文字だけで始まる run に `accent: true` を付ける。`LabelGeometry.text` は chunk をつないだ行の文字列（`\n` 区切り）、`lines` は行の数。chunk が 1 つの行は従来どおり `x` が `<text>` の `x` と同じであることを検査する。D2 の SVG は `<tspan>` に `y` を持たないので、結果は従来と同じ。
- **幾何 lint**（`measureRuns()`）: `chunkX` のある行は chunk ごとに中央から並べ、ない行は従来どおり anchor の中央。アクセントの run の箱は ascender / descender の箱ではなく**字形の箱**（上に上げた baseline の ascender の箱では、Layout IR の行の箱を超えて誤検出になる）。`MeasuredRun` に pen の位置 `x` と advance の `width` を足した（箱が字形の箱になる run があるため）。
- **PDF**: 変更なし。アクセントの chunk も #112 の run ごとのフォント（`resolveSvgFonts()` のコピー）の対象で、結合文字は基底と同じフォントの run の文字。PDF には基底 → 結合文字の順に入り、Sumi の PDF reader で `y` U+0302 として抽出される（Poppler の `pdftotext` も同じ。`\vec{W}` だけ間に空白が入る）。NFC の `ŷ` での検索は閲覧アプリによる。
- **編集可能 PPTX**: アクセントの run を直前の run（基底）の `<a:r>` に入れる（`y` U+0302 を 1 つの run。baseline の指定は付けない。PowerPoint は自分で結合文字を置く）。PowerPoint での見た目は未確認。
- **lint**: `lint/missing-glyph` はアクセントの文字も基底のフォントで調べる（同梱のフォントセットでは出ない。数式フォントのないフォントセットでは BIZ UDPGothic が U+0307・U+20D7 を持たないので報告される）。
- **検証**: 記法の単体テスト（6 種・基底の種類・スクリプト・入れ子・エラーの位置）、`placeAccent()` の式（字形の箱がない場合を含む）、描いた SVG の各アクセントの位置が、テストの中で `glyf` / `post` から直接計算した位置と一致（6 種 × `y`・`W`・`θ`・`θ_t`・`∇`・日本語の後の `x`）、幾何 lint 0 件、決定性、アクセントのある行だけが chunk で空白で始まる chunk がないこと、PDF の各 run の位置とフォント（`expectPdfMatchesMeasure()`。同じフォント・大きさ・baseline で続く run は PDF の reader と同じ規則でまとめ、文字・原点・advance・フォントを照合）、PDF の抽出、編集可能 PPTX、`lint/missing-glyph` が出ないこと、`label-math-fonts.test.ts` の行列に 6 種 × 2 ラベル（小文字・大文字・添字付きのギリシャ・Math の基底・日本語の後）を追加（PDF の run ごとの書体と位置、画像方式 PPTX の輪郭）。製品の PDF エンジンとヘッドレス Chrome の一致は CI 外の[検証記録](../../research/129-math-accents/README.md)（109 文字の位置の差が最大 0.022 単位、アクセントは 0.008 単位）。
- **限界・引き継ぎ**: 幅のあるアクセント（`\widehat` `\overline`）、アクセントの積み重ね、`\imath` は対象外（段階 C の MathJax の再評価で扱う）。アクセントの位置は TeX の `\skewchar` のカーニングではなく字形の箱と傾きによる近似。#135（Skill）は v0.4.1 で書いた回避（`x'`・`ŷ` の直接入力）をアクセントの記法に置き換える。

### 6.30 #128 のエッジのラベルの位置（`edges[].labelAt` / `labelSide`）

段階 B（[#124 の計画](../research/124-stage-b.md) §3.2・§5-2）の 2 件目。#109 の 4 図中 3 図で、辺のラベルを始点寄り・終点寄りや線の片側に置きたかった。Figure v1 への任意フィールドの追加で、**どちらも書かない辺**のラベルは §6.22（#116）の規則のまま（`labels.ts` の既定の分岐は変えていない）。既存の IR・Layout IR・D2・SVG・PDF・PPTX・診断はバイト単位で変わらない（既存の golden・作例・ギャラリーは無変更）。

- **フィールド**: `edges[].labelAt`: `start` | `middle` | `end`、`edges[].labelSide`: `left` | `right`（Zod の enum で閉じる。誤った値は `schema/invalid-value`）。IR（`EdgeIR.labelAt` / `labelSide`）は**書いたときだけ**持つ（§6.27 と同じ）。`fmt --canonical-order` では `label` の直後。
- **auto（判断: `layout/structured-only`）**: D2 v0.9.0 は辺の `label.near` を受け付けるが位置を変えない（#124 で実測）。黙って無視しないよう、`fromAnchor` / `toAnchor` と同じく `layout/structured-only`（error、そのフィールドの位置）にし、辺を無効にする。矢じりのラベル（`source-arrowhead.label`）で `start` / `end` を写す案は、D2 の塗りの class と inspect の確認が要るので後回し（#124 §6）。
- **指定の線分**: `start` は最初の線分（source 側）、`end` は最後の線分（target 側）、`middle` は最も長い線分（同じ長さなら source に近い方。矢じりのない線の既定と同じ）。`labelAt` を省略して `labelSide` だけ書いた場合は、既定の端（target の矢じり、なければ source の矢じり、どちらもなければ `middle`）。
- **指定の側（判断: 進む向きに対して）**: `left` / `right` は、その線分を source → target の向きに進むときの左右（SVG の座標で、右向きの線の左は上、下向きの線の左は右）。上下・東西の絶対の向きにしないのは、線分の向きはルータが決め、作者は YAML の時点で知らないため（TikZ の `auto` / `swap` と同じ考え方。#124 §3.2）。省略時は両側を候補にし、上（水平）・右（垂直）を先に試す（既定と同じ）。
- **最初の位置**: `end` / `start` はその端の矢じりのすぐ手前（矢じりのない端は端から間隔 3 unit）で、既定の配置と同じ位置。`middle` は線分の中央。線からの間隔は既定と同じ 3 unit（`EDGE_LABEL_GAP`）。矢じりのある `arrow` で `labelAt: end` または `labelSide: left`（右向き・下向きの線）だけを書くと、最初の位置が空いていれば既定と同じ位置になる（テストで確かめる）。
- **回避（判断: 指定の範囲の中だけ）**: 最初の位置が経路・矢じり・枠線・node・ラベルのどれかに当たれば、**同じ線分に沿って**、経路・矢じり（自分と**他の辺**の矢じり。各辺の線幅から求めた長さ）・グループの枠線・node の箱・ラベル（グループの見出しとエッジのラベル）の手前と先（間隔 3 unit）に滑らせた位置を、最初の位置に近い順（同じ距離なら target 側が先）に、許された側ごとに試す。滑らせた位置は、ラベルの中心が線分の両端の間にあるものに限り、`end` / `start` はその端から離れる向きにだけ滑る（矢じりに近づかない）。選び方は #116 と同じ形: 経路と矢じりから間隔を保つ候補のうち、枠線・node・ラベルにも当たらない最初のもの、なければ node・ラベルに当たらないもの、なければ経路から離れた最初のもの、どれもなければ最初の位置。
  - **範囲の外には動かさない**: 指定の線分・側に空いた場所がなければ、最初の位置のまま置く（黙って反対側や手前の線分に動かさない。#124 §3.2 の判断）。#116 の既定の回避が使う「手前の線分の脇」の候補は、指定の線分の外なので使わない。
  - **報告（`layout/edge-label-overlap`、warning）**: 残った重なりは描画の診断として作者に知らせる（`renderFigure`・`sumi render`・`sumi lint --geometry`。`layout/edge-crossing` と同じく `chooseRouting()` が、全エッジに経路があるときだけ足す）。`checkRoutes` は Layout IR の内部の検査（テスト用）で、作者には見えない。幾何 lint は、経路が**他の**要素のラベルを横切ること（`geometry/edge-crosses-label`）と、ラベルどうし・ラベルと node・枠線の重なり（`geometry/label-collision`）を検査するが、**辺の自分のラベルと自分の線**、および**矢じり**との重なりは見ない（#116 の既定の配置が自分の線を避けるため）。そこで `labelAt` / `labelSide` を書いた辺だけ、最終の Layout IR でラベルの箱を、すべての経路（自分の線を含む）・矢じり・node・ほかのラベル・線を描くグループの枠線と比べ、重なる相手を 1 件の warning にまとめて出す（位置は辺。メッセージは相手の名前と書いた値、hint は反対の `labelSide`、ほかの `labelAt`、フィールドを外す、余白・anchor・ラベルを短くする）。書かない辺は検査しないので、既存の図の診断は変わらない。新しい code にしたのは、`geometry/*` が描いた SVG を再計測する lint の規則（`--rule` で重さを変えられる）で、ルータの段の診断とは出どころが違うため。
  - `middle` も同じ回避を通す（#124 の試作では、図 2 の `update θ` に `labelAt: middle` を付けると最も長い線分の中央、つまり loss の箱の上に置かれ、衝突が 3 件だった）。
  - **置く順序（判断: 既定を先に）**: 既定の配置のラベルを先に（文書順に）すべて置き、その後で `labelAt` / `labelSide` のラベルを文書順に置く。後者は、グループの見出し・既定のラベル（文書で後の辺のものも）・先に置いた指定のラベル・他の辺の矢じりを避ける。既定の配置はラベルと矢じりを見ないので、順序を変えても出力は以前と同じ。文書順だけで置くと、指定のラベルが後の既定のラベルを見られず、順序で重なりが決まった。
- **短い線分**: 最後の線分がラベルより短い場合（#116 の再現）、最初の位置はラベルの中心が線分の外（角の先）になりうる。その場合、最初の位置以外の候補はない。角の反対側（手前の線分が出ていかない側）なら空いていて衝突 0、角の側では手前の線分に当たり `layout/edge-label-overlap` が出る（テストで件数を固定）。
- **テスト**: `edge-label-at.test.ts`（3 × 2 の組み合わせ × 水平・垂直・L 字・短い最後の線分で、Layout IR のラベルの箱が指定の線分（テストの中で独立に求める）の指定の側に間隔 3 unit で並び、中心が線分の範囲にあること（短い最後の線分の `end` は箱が線分に掛かること）。`checkRoutes` のラベル衝突 0 と warning 0（短い最後の線分の角の側 3 通りだけは、衝突と辺の位置の warning を期待値として固定）。最初の位置（`end` と省略が同じ、`start` の矢じりの有無、`middle` の中央、`line` の `end`）。中央を別の経路が横切る場合に `middle` が線分に沿って滑ること。幹線を共有する 2 本（`line` のラベルと矢印）で、他の辺の矢じりに重ならず、残った node との重なりが warning になること。後に書いた既定のラベルを避けること）、`edge-label-at.integration.test.ts`（`renderFigure` の診断として、#116 の再現の `labelAt: end, labelSide: right` が位置付きの warning になり幾何 lint は 0 件、反対側やフィールドなしでは診断なし。図 2 の草案）、`layout.test.ts`（auto で `layout/structured-only` の位置）、`figure.test.ts`（任意・誤った値の位置）。#116 の回帰（`router.test.ts`）と既存の golden は無変更で通る。
- **結果（図 2 の草案）**: #124 の草案（`requires`・キャプション・凡例は未実装のためテストの中で外す）の `update θ` に `labelAt: middle` を付けると、loss の下を通る破線の下側に、loss→curve の線を避けて置かれ、loss の箱にも経路にも当たらない（`update θ` についての診断・幾何 lint は 0 件）。同じ草案の `batch`（`labelSide: right`）は、指定の側を dataset→loss の線が通るため、範囲の外には動かさず `layout/edge-label-overlap` が 1 件出る（幾何 lint はこの重なりを見ない。上記）。
- **非対象・引き継ぎ**: auto でのラベル位置、ラベルの回転、線の上に重ねるラベル（#128 の非対象）。幾何 lint の hint に `labelAt` / `labelSide` を挙げることと Skill の説明は #135。

### 6.31 #132 の配置の木をまたぐ整列（`figure.layout.align`）

[#124 の計画](../research/124-stage-b.md) §3.5・§5-6。#109 の 4 図中 2 図で、別の配置の木（箱）にある要素どうしを揃えたかった（U-Net の concat を encoder の段と同じ高さにして skip を水平にする、encoder の出力と decoder の Cross-Attention を揃えて K,V を 1 本の水平線にする）。Figure v1 への任意フィールドの追加で、**`align` を書かない図**の IR・Layout IR・D2・SVG・PDF・PPTX・診断はバイト単位で変わらない（既存の golden・作例・ギャラリーは無変更。`align` のない図は従来の 1 パスそのもので、strut の入力は空）。

- **フィールド**: `figure.layout.align`: 制約のリスト。各制約は `{ y: [ids...] }`（項目の y が等しい＝1 本の水平線）か `{ x: [ids...] }`（x が等しい＝1 本の垂直線）のちょうど一方と、任意の `at: center | start | end`（中心・上端/左端・下端/右端。省略時 `center`）。ID は node か group。配置の木の外（`figure.layout`）に置くのは、木をまたぐ関係だから（#124 §2 の「配置は配置に書く」）。group の中だけの整列も同じ書き方で書ける。`x` と `y` の両方・どちらもなしは `schema/invalid-value`（`stack` / `row` と同じ「ちょうど 1 つ」の検査。`z` のような綴りの誤りは `schema/unknown-field` の 1 件だけにする。JSON Schema は `oneOf` の `required`）。正規化で `at` は埋めず、IR（`AlignIR`）で `center` にする。
- **layout の段の検査（error、位置付き）**: auto の図で書くと `figure.layout.align` のキーの位置に `layout/structured-only`（§6.19 と同じ）。structured では、未知の ID は `layout/unknown-align-item`（その項目の位置。近い ID の提案、edge の ID なら「node と group だけ」）、同じ制約に同じ要素が 2 回なら `layout/duplicate-align-item`（2 回目の位置、1 回目を `related`）、項目が 2 個未満なら `layout/invalid-align`（`x` / `y` のキーの位置）。制約は図についての指定なので、要素を無効にしない。すでに無効な要素（自分の error がある）の ID は重ねて報告しない。**attach された node も項目にできる**（判断）: 対象と一緒に動く（strut は対象の経路に入る）。attach の対象と同じ制約に並べた場合など動かせない組は、下記の `layout/unsatisfied-align` で報告する（静的に禁止すると、`east` に付けた node と対象の y 揃えのように最初から満たされる制約まで拒むため）。
- **IR**: `FigureIR.align?: AlignIR[]`（`{ axis, at, items: ElementKey[], srcAt }`。`srcAt` は `figure.layout.align[i]` の位置で、診断に使う）。書いたときだけ持つ。
- **エンジン（`src/layout/structured/align.ts`、判断: strut の固定点反復。kiwi は採らない、#124 §3.5）**:
  - 配置の 1 パス（§6.21）に入力 **strut** を足した: 箱の項目の前（`lead`）・後（`trail`）に主軸の余白を足す（見た目の順。`direction: up` / `left` でも「上 / 左」が前）。箱の大きさに含まれ、余分な主軸の余白の中央寄せ（§6.21）も strut 込みの大きさで行う。`StructuredLayout` は計測（ラベル・葉の大きさ）を 1 回だけ行い、`run(struts)` で配置だけをやり直す。strut が空なら従来の 1 パスと同じ（`align` のない図は反復に入らない）。
  - 反復: 各回、文書順に、まだ揃っていない制約ごとに次の案を配置し、全制約の残差（各制約の項目の座標の幅）の**和**が最も小さい案を採る（同じなら先の案。#155 で、同じなら canvas の小さい案、それでも同じなら先の案に変えた。§6.36）。和が下がらなければ採らない。
    - A: 最も上（左）の項目の前に不足分の `lead`（下 / 右へ押す）。B: 最も下（右）の項目の後に `trail`（終端揃えの箱の中で上 / 左へ押す。始端揃えでは箱が伸びるだけ）。
    - 項目が 3 個以上なら、さらに C: 最も下（右）の項目に届かないすべての項目の前に、それぞれの不足分の `lead`、D: 最も上（左）の項目より先にあるすべての項目の後に、それぞれの超過分の `trail`。**端で並ぶ項目をまとめて動かす**ため（レビューでの指摘）: `[a]`・`[b]`・`[pad, c]` の 3 つの stack で `y: [a, b, c]` のとき、a と b が同じ高さで上にあり、a だけ（A）を下げても幅は変わらず、和の目的関数は部分的な進展を見られない。C は a と b を同時に c の高さへ下げる。2 項目の制約では C・D は A・B と同じなので試さない（試作・2 図の結果は変わらない）。
  - strut を置く場所: その項目の経路（root から項目までの箱と、その箱の中の項目の列。attach された node は対象の経路）のうち、軸の向きの箱（`y` は stack、`x` は row）で、経路上の項目が制約のほかの項目を含まない最も深いもの。**`gap: 0` の箱には入れない**（ブロックと Add & Norm のように一体に描く箱。祖先の箱に置くので接したまま）。試作の最初の版は図 1 の別案でブロックと Add & Norm を引き離した（#124 §3.5）。
  - **2 手先の補助探索（#213、§6.58）**: 通常の貪欲な 1 巡で和が下がらなければ、その時点の案を文書順に配置し、その試行の座標と strut から全制約の 2 手目の案を作る。1 手目で悪化しても採用せず、2 手を合わせた和が元の採用済み状態より厳密に小さい組だけを、和・canvas 面積・先着順で比べて採る。1 手目で崩れた、元は揃っていた制約も 2 手目の対象になる。すべての試行を既存の配置予算に数え、予算が途中で尽きても、完成した改善組があればその最良を返す。
  - **停止（判断）**: 全制約の残差がそれぞれ 0.01 unit 以下（`ALIGN_EPSILON`。**制約ごとの最大**で判定し、和では判定しない: 揃った 99 個の中の 1 個の 0.5 unit のずれを和は隠す）、貪欲探索と補助探索の両方で和が下がらない、50 回（`MAX_ALIGN_ROUNDS`）、または**配置の回数の予算**（`MAX_ALIGN_LAYOUTS` = 1,000 回。最初の配置・各案・補助探索の両手・診断の調べを含む）を使い切ったときに止める。strut は増えるだけなので、各回は和を真に減らすか止まる。結果は最後に採った配置（残差の和が最小のもの）。
  - **予算（判断）**: 反復の上限だけでは、1 回の反復が「揃っていない制約 × 案」回の配置になり、制約の多い図で時間が決まらない（最初の版では 200 node・1,000 制約で 4.8s）。回数で数えるので決定的（時計を見ない）。反復か診断の調べ（下記）で使い切り、揃っていない制約が残れば `layout/align-search-limit`（warning、`figure.layout.align` のパス、位置なし。予算の回数と、何個の制約が残ったか）を、各制約の `layout/unsatisfied-align` の前に出す（調べの後で判定する。同じ不可能な制約 250 個では、#213 の先読み（§6.58）が予算を使い切る場合をテストで固定）。1,000 回は、#109 の図（7 回）の 100 倍以上で、200 node の図で約 0.8s。
  - 決定的（制約は文書順、Map は挿入順、丸めは配置エンジンと同じ）。
- **解けない制約（判断: warning）**: 止まったときに残差が 0.01 unit を超える制約ごとに `layout/unsatisfied-align`（warning、`figure.layout.align[i]` の位置、subject は figure）。図は見つかった最良の配置で描く（error にすると、整列のずれ 1 つで描画全体が止まる。warning なので `--max-warnings` で CI では落とせる）。メッセージは制約の全項目の名前・軸と `at`・最も離れた 2 項目と、その距離（mm、小数 2 桁）。hint は 2 通り: 反復と同じ案（A〜D）のどれを足してもその制約の残差が変わらない場合（同じ stack の 2 項目、`gap: 0` の箱だけの経路、strut が後ろの項目ごと動かす）は「動かして離せない」理由と、別の箱に置く案。この調べの配置も予算と `layouts` に数える（予算を使い切っていれば、分からないので一般の hint）。変わる場合は、ほかの制約（矛盾し得る）か配置が引き離していること。項目を共有するほかの制約を `related` に挙げる。`renderFigure()`・`layoutStructuredFigure()`・`sumi render`・`sumi lint --geometry` に出る（配置の段の診断。`sumi lint` だけでは配置しないので出ない。`layout/no-route` と同じ）。
  - **限界**: 中央寄せでは、strut が箱の大きさを変えてほかの項目も動かすため、**ID を共有しない制約どうしも結合する**（#213、§6.58）。不足分の半分しか動かないだけでなく、1 つの残差を減らす案がほかの残差の和をそれ以上に増やす。2 手先の補助探索でこの局所的な停止を抜けられる場合があるが、3 手以上や別の候補が必要な場合・矛盾する制約・同じ箱の動かせない項目など、一般の収束は保証しない。補助探索でも解けない表の行見出しは、親の row を **`align: start`**（転置した表は親の stack）にして、見出しを上 / 左から独立に押せる配置にする。`layout/unsatisfied-align` は許容値を超える実際の残差を報告する。不等式・等幅の強制・`auto` での整列は #132 の非対象（#124 §6）。
- **入口**: `placeStructured(ir, options)`（`{ layout, diagnostics, align?: { rounds, layouts, residuals, struts } }`。`layouts` は最初の配置・各案・診断の調べを含む。`options.alignLimits` で上限と予算を下げられる（テスト用））。`layoutStructured()` は従来どおり Layout IR だけを返す（整列は解く）。描画（`renderStructured`）と `layoutStructuredFigure()` は `placeStructured()` を使い、診断を加える。ルータ・writer・inspect・lint は変更なし。
- **結果**（Apple M4 Pro、Bun 1.3.14、9 回の中央値）:

  | 図 | 制約 | 反復 / 配置の回数 | 残差 | strut | 解く時間（配置 1 回） |
  | --- | --- | --- | --- | --- | --- |
  | 図 4（U-Net、`align-unet`） | 3（`y`） | 1 / 7 | 0 | `enc1` の前 148.024、`enc2` の前 31.999、`enc3` の前 32.001 unit | 0.6ms（0.15ms） |
  | 図 1 の別案（K,V を横から、`align-side-kv`） | 1（`y`） | 1 / 3 | 0 | Encoder の stack で、`gap: 0` の stack（Feed Forward と Add & Norm）の後（下）に 24 unit（下端揃えの row の中で Encoder の上側が上がる） | 0.4ms（0.23ms） |

  試作（#124 `results/align.json`）と同じ strut・回数。skip の破線 3 本と K,V は 1 本の水平な線分になる（テストで経路の点が 2 個・同じ y）。
- **乱数の制約**（3〜10 列の stack を並べ、`gap: 0` の組・終端揃えの列を含む合成図に、乱数の 2 項目の制約を `x` 3 割・`y` 7 割、`at` は一様に置く。同じ列の 2 項目など、多くは構造上解けない）:

  | 図 | 制約 × 試行 | すべて満たした試行 / 満たした制約 | 反復（中央値 / 最大） | 配置の回数（中央値 / 最大） | 時間（中央値 / 最大） |
  | --- | --- | --- | --- | --- | --- |
  | 18 node | 2 × 1,000 | 97 / 822 of 2,000 | 2 / 4 | 9 / 17 | 0.47 / 2.1ms |
  | 60 node | 10 × 100 | 0 / 289 of 1,000 | 2 / 5 | 46 / 90 | 7.2 / 14.0ms |
  | 200 node | 100 × 10 | 0 / 63 of 1,000 | 3 / 4 | 695 / 871 | 342 / 440ms |
  | 200 node | 1,000 × 1 | 0 / 20 of 1,000 | 1 | 1,000（予算） | 0.83s |

  配置の回数は診断の調べを含む。反復の上限の 50 回には届かない（和が真に減る間だけ続くため）。時間は「反復 × 揃っていない制約 × 案」回の配置で決まり、予算で頭打ちになる（1,000 制約の行は予算で止まり `layout/align-search-limit`。予算を入れる前は 5,845 回・4.8s）。#109 の図の規模（数個の制約）では 1ms 前後。
- **テスト**: `layout.test.ts`（正規化、auto の `layout/structured-only`、ちょうど 1 つ・綴りの誤り・`at` の値、未知・重複・2 個未満・edge の ID の位置と hint）、`align.test.ts`（停止の規則、`align` なし・空の `align` が従来の配置と一致、`y` の lead、`x` の `start` / `end`、group の中の node と group そのもの、attach された node、`gap: 0` の箱の祖先に置いて接したまま、置く祖先がなければ診断、揃った 100 個と揃わない 1 個、端で並ぶ 2 項目を含む 3 項目の制約（`y` と、転置した `x`）、予算を使い切ったときの最良の配置と `layout/align-search-limit`、決定性、同じ stack・矛盾・解けない組の診断と hint・`related`・診断の調べを含む `layouts`、2 図の残差 0・1 回・経路が水平、図 1 の別案の `gap: 0` の 5 組が接したまま、乱数の制約 40 試行で上限・診断の件数・`gap: 0` の接触）。golden: `tests/fixtures/layout/align-unet.*`・`align-side-kv.*`（配置と経路の Layout IR、`checkRoutes` の問題 0）。2 図は #124 の草案から、ほかの段階 B の Issue のフィールド（凡例・`labelSide`・辺の `labelAt`）と、それなしでは group の枠に重なる K,V のラベルを外したもの。
- **引き継ぎ**: Skill の説明は #135。

### 6.32 #130 のグループのキャプション（`groups[].caption`）

段階 B（[#124 の計画](../research/124-stage-b.md) §3.3・§5-4）。#109 の 4 図中 2 図で、パネルの下に「(a) …」のキャプションが要った。Figure v1 への任意フィールドの追加で、**`caption` を書かない図**の診断・IR・Layout IR・D2・SVG・PDF・PPTX はバイト単位で変わらない（既存の golden・作例・ギャラリーは無変更）。

- **フィールド**: `groups[].caption`: 空でない文字列（空は `schema/invalid-value`）。改行で複数行、structured ではラベルの数式（§6.24）も使える（ノードの `label` と同じ扱い）。位置は常に**枠の下の中央**で、指定するフィールドはない。`fmt --canonical-order` では `labelAt` の直後。
- **展開（判断）**: `checkFigure()` が `layout` 段の後、`component` 段の前に、キャプションを `sumi/label` のノード **`<group>-caption`**（予約した ID）として `nodes` の末尾に足す（`expandCaptions()`、`src/core/figure/caption.ts`）。ノードは group の親を持つ。以降の段（component・asset・theme・profile・lint・IR）はこれを普通の label として検査し、描く。`layout` 段の後にしたのは、配置の木の検査（各要素をちょうど 1 回置く、未知の項目）が作者の書いたものだけを見るため。`parseFigure()`（`fmt` が読むもの）は展開しない。
  - **予約した ID**: キャプションのある group について、利用者のノード・グループが `<group>-caption` を使っていれば `ref/reserved-id`（error、その要素の `id` の位置。related はキャプション）で、そのキャプションは展開しない。#124 の案の `component/reserved-id` ではなく `ref/` にしたのは、ID の空間（`ref/duplicate-id`）の問題だから。`<group>-caption` は辺の端点・配置の木の項目・`attach` の先には書けない（書けば従来どおり未知の ID）。ID は最長 72 文字になるので、inspect の `sumi-k-*` の復号は 72 文字まで受け付ける。
  - **診断の位置**: 展開したノードの path は `groups[i].caption`、subject はその group（`figureElements()`・IR の source map）。ノードのフィールドへの path（`…caption.label` など）は `caption` に丸め（`captionLocator()`・`clampCaptionPaths()`）、数式の誤りはキャプションの文字列の中の範囲を指す。メッセージでは `the caption of group "x"` と呼ぶ（profile・lint・幾何 lint・ルータの no-route）。`lint/empty-figure` と `lint/no-edges` はキャプションをノードに数えない。
- **structured（`src/compiler/ir.ts` の配置の木の IR）**: group の項目を `stack { direction: down, gap, items: [group, caption] }` に置き換える。
  - **間隔（判断・#127 と共有）**: `gap` は **group の padding の半分**（paper で 4pt）。§6.21・§6.27 の見出しの帯と内容の間と同じ値で、`labelAt: bottom*` の見出しは枠の内側に padding 離れて、キャプションは枠の外に padding の半分離れて、枠を挟んで並ぶ（`group-caption` の fixture の `dec`）。#124 の試作の 1mm（2.8pt）より少し広い。
  - **揃え**: 親が `align: stretch`（省略時は継承した値）の stack なら `stretch`（group はキャプションがない場合と同じ幅に伸びる）、それ以外は `center`（キャプションが group の中央の下）。キャプションが group より広いと、group はその幅の中で中央に置かれ、`start` / `end` の揃えから外れる。row の `stretch` では、キャプションの stack が行の高さに伸ばされ、配置エンジンは余った高さを中央寄せにせず**最初の項目（group）に渡す**（IR の内部の印 `growFirst`。キャプションの stack にだけ付く）。group は兄弟と同じ上端から伸び、キャプションは group の下に gap 離れて、行の下端に揃う（キャプションがない場合の group の高さからキャプションと gap を引いた高さ。`group-caption.integration.test.ts` で Layout IR の矩形を確かめる）。
  - **attach**: キャプションのある group に `side: south` で付けたノードは、キャプションの下に付ける（IR で `attach.to` をキャプションにする）。ほかの向きは group のまま。
  - **ルータ**: キャプションは普通のノードなので障害物として避ける（`layout/no-route` の「in the way」にも `the caption of "x"` として出る）。枠とキャプションの間（4pt）は、clearance（3pt）より広いので線が通れる。
- **auto（`src/compiler/d2.ts`）**: キャプションのノードを、group を囲む透明な container として書く（`n_<group>-caption`、`label.near: bottom-center`、`shape: rectangle`、文字はキャプションの style、塗りは container の既定（`transparent`）、線幅 0）。group とその子孫の D2 path はこの container を通る（IR の `d2Path`）。`--emit-d2` にもこの container が出る。
  - **`outside-bottom-center` を採らない（判断・実測）**: #124 は透明な container の `label.near: outside-bottom-center` でキャプションが枠の下の中央に出ることを確かめたが、固定版 D2 v0.9.0 はこのとき ELK の配置の後に container の中身をラベルの分だけ上へ動かし、container から外へ出る辺の外側の端は動かさないので、辺が斜めになる（`direction: right` で `w.g.b -> d.c` が `M 351 124.2 L 580 144.6`。ラベルのない container では `M 351 145 L 580 145`）。内側の `bottom-center` では、D2 は見出しの分の余白を上に取ったまま（§6.27）ラベルを container の下端の内側、つまり group の下の padding（`containerPadding`、paper で 4mm）の中に描くので、辺は直交のまま。実測でキャプションの箱は枠の下端から 6.9 unit、中央から ±2.5 unit 以内（D2 の半 unit の丸め）。2 行のキャプションでは D2 が container を下へ広げる。container の分（padding と上の余白）だけ図は大きくなる。
  - **限界**: ELK はキャプションを知らないので、group から下へ出る辺（`direction: down` など）はキャプションを横切る。`geometry/edge-crosses-label` が警告し、hint で `layout.direction`・横に出る接続・structured を勧める（structured のルータはキャプションを避ける）。
- **inspect・幾何 lint・編集可能 PPTX**: キャプションは `text` のノードとして読まれ、ほかの `text` のノードと同じく bbox を持たない（auto で D2 が描く container の矩形はキャプションの形ではないので、inspect が bbox にしない）。幾何 lint の label の path は `caption`。編集可能 PPTX はキャプションを塗りも線もない text box にする（auto の container の矩形を形にしない）。
- **テスト**: `caption.test.ts`（展開・親・予約した ID（ノード・グループ）・無効な group・数式の誤りの位置・auto の数式の警告・フォントの下限・lint の長いラベルと数え方・IR の配置の木（stretch / row / start）・`attach`・auto の `d2Path` の入れ子）、`figure.test.ts`（任意・空・型）、`group-caption.integration.test.ts`（両エンジンの fixture でキャプションが枠の下・中央（structured は厳密、auto は 2.5 unit 以内）、診断（info を除く）0 件・幾何 lint 0 件、structured の間隔と `attach`・どの経路もキャプションを横切らない・下端の見出しとの位置、auto の辺が直交、編集可能 PPTX の text box、auto で下へ出る辺の警告の位置と hint、#124 の図 2 の草案（`requires`・凡例と、別の線と重なる `batch` の `labelSide` を外す）が 2 つのキャプション付きで幾何 lint 0 件）。golden: D2 ソース（`tests/fixtures/d2/group-caption.d2`）と Layout IR（`tests/fixtures/layout/group-caption.layout.json`・`.routed.layout.json`）。
- **非対象・引き継ぎ**: キャプションの位置の指定・`(a)` の自動採番・図全体のキャプション・`component: panel`（#130 の非対象）。auto でキャプションを避ける経路（ELK に渡す手段がない）。Skill の説明は #135。

### 6.33 #134 の配置の木による既定の辺と fan-in の口の分散（`figure.layout.fanIn`）

[#124 の調査](../research/124-stage-b.md)（§3.7・§8 Q1）の Issue 8。anchor のない端の辺の選び方を配置の木から決め（既定）、別の要素から同じ口に入る辺を並べて入れる（opt-in）。どちらも `ports.ts` の `resolveEnds` の中で、§6.22 の多重辺の振り分けと #113 の口の分割はそのまま通る。

- **配置の木で辺を選ぶ（既定、利用者の判断 2026-10-27、レビュー後に再確認）**: anchor のない端（junction・自己ループ・group とその内側の要素の場合を除く、§6.22 で `facingSide` を使っていた端）は、2 つの要素を分ける配置の木の箱（根からの道が最初に別の項目に分かれる、共通の祖先の箱）の向きで辺を決める。stack なら北 / 南、row なら東 / 西で、相手の中心の側（`up` / `left` の箱も中心で決まる）。`attach` で置いた node は対象の場所を使う（連鎖をたどる）。group が端なら group の場所。
  - **箱の軸で離れていなければ使わない（レビューで修正）**: 2 つの端の外接矩形が、箱の軸（stack なら y、row なら x）で重なる場合は、箱の向きは端の位置を表さないので従来の `facingSide`。`attach` した node は配置の木で場所を取らないので、次の項目の横に来ることがある（stack [a, b]、a の東に p、p の南に x を attach すると x は b と同じ高さ。修正前は x → b が南 / 南の 188 unit・折れ 2 になり、従来の直線 120 unit より悪かった）。判定は 2 つの矩形の対称な条件なので、両端に同じく掛かる。
  - 分ける箱がない場合（node とそれに attach した node、配置の木を持たない要素）も `facingSide`（中心の差の大きい軸）。
  - **理由**: `facingSide` は中心の差だけを見るので、stack の下の段で横に遠い箱が東西の辺から出て、相手の横に回り込む。配置の木は作者が書いた流れの向きで、それに沿う辺の方が経路が短くなる場合がある。**経路が短くなるのは合成図での実測だけ**（下の表）で、#109 の図・作例では変わらない。
  - **互換性（実測）**: 作例 2（transformer・dit-block）・fixture 2（a-transformer・b-adaln-panel）・#109 の 4 図で、経路（Layout IR の JSON）がバイト単位で v0.4.x と同じ（`CI=1 bun test` の golden と `bun run gallery:check` も無変更で通る）。これらの図では中心の差の大きい軸がもともと配置の箱の向きと一致していたことに加え、#109 の図 3 は作者が書いた anchor（11 個）が端を決めているので、既定の辺の規則に依らない。anchor のない図、特に箱の軸と中心の差が食い違う配置では経路が変わりうる（release note に書く）。
  - **図 3 の anchor なし版の悪化（調べた・判断）**: 交差は 4 → 3 点に減るが、excess が 16.2 → 51.7mm・遠回り 1 → 3 に増える。レビューの分析どおり、配置の木の辺で worker → ストアの端が同じ口に集まり、合流したネット（幹線は費用 0、§6.22）に乗るために経路が回り込む。安い緩和を 2 つ試した（実測、下の表）:
    1. **両方の軸で離れている（斜めの）組は `facingSide`**: 全図で v0.4.x と同じ出力になり、合成図の改善も消える（合成図の改善は斜めの組から来ている）。採らない。
    2. **合流を変えるときだけ戻す**: 箱の向きの辺が `facingSide` と違い、その辺に別の要素からの端が入って合流になる target の端だけ `facingSide` に戻す（2a）、その辺の source の端も戻す（2b）。作例・fixture・#109 の 4 図はバイト一致のまま、図 3 の anchor なし版は 2a で excess 20.2mm・遠回り 1、2b で v0.4.x と同じ（16.2mm）になる。しかし合成 grid が悪化する（2a: 交差 1169 → 1261 点・経路長 17016 → 17273mm、2b: 1260 点・17301mm。いずれも v0.4.x の 1233 点より多い）。「合成図を悪くしない」条件を満たさないので採らない。

    合流で遠回りする図には `fanIn: spread`（下、図 3 の anchor なし版で遠回り 0）か anchor を使う。この対応は Skill に書く（#135）。

  | 案（既定の辺） | 図 3（anchor なし） 交差 点/組・excess・遠回り | 合成 columns 点・経路長 | 合成 grid 点・経路長 | 作例・fixture・#109 の 4 図 |
  | --- | --- | --- | --- | --- |
  | v0.4.x（`facingSide`） | 4/9・16.2mm・1 | 23・2700mm | 1233・17547mm | — |
  | **配置の木（採用）** | 3/8・51.7mm・3 | 24・2536mm | 1169・17016mm | バイト一致 |
  | 1. 斜めは `facingSide` | 4/9・16.2mm・1 | 23・2700mm | 1233・17547mm | バイト一致 |
  | 2a. 合流を変える target の端を戻す | 3/8・20.2mm・1 | 24・2536mm | 1261・17273mm | バイト一致 |
  | 2b. 2a ＋ その辺の source の端 | 4/9・16.2mm・1 | 24・2536mm | 1260・17301mm | バイト一致 |

- **fan-in の口の分散（opt-in、`figure.layout.fanIn: spread`）**: 1 回目の解決の後、anchor のない target の端が 2 本以上入る口（要素・辺・点・向き）の端を、その辺に並べて解決し直す。別々の口になるので、ネット（§6.22、同じ口に入る端どうし）も別になり、合流しない。junction の端（合流を明示する部品）と anchor を書いた端は動かさない。合流させたい場合は junction を使う。
  - **辺ごとの割り当て（レビューで修正）**: 位置は辺（要素・辺・向き）ごとに、その辺の他の端を知った上で決める。辺の位置を `N` =（並べる端の数）＋（他の端の異なる位置の数）等分した k/(N+1) とし、他の端（anchor の端、多重辺の振り分けの位置、その辺から出る端、1 本だけの端）は位置を変えず、順序を保って距離の和が最小になるように最寄りの位置を取る（動的計画法）。並べる端は残った位置に、相手の端の口の辺に沿った座標の順（同じなら文書順）に入る（互いに交差しない）。修正前は口ごとに 1/(n+1) … n/(n+1) としていたので、`a → t` 2 本（1/3・2/3）と `b → t`・`c → t` の分散（1/3・2/3）が同じ点になり合流し、`north:0.5` の anchor と 3 本の分散の真ん中も重なった。残った位置が他の端の点に重なる場合は（丸めの一致。通常は起きない）その辺は分散せず合流のまま（1 つの点に 2 つのネットを置かない）。
  - **残る端の固定（再レビューで修正）**: 2 回目の解決では、並べる端だけでなく、分散する辺の残りの端もすべて 1 回目の位置（割り当てで残した位置）に固定する。固定しないと、多重辺の一部が並べる端になった場合、残りの端が少ない本数で振り分け直され、並べる端に渡した位置に移る（`a → t` 2 本と `b → t` 5 本で、7 本のうち 2 組が同じ点・同じネットになった）。固定した端も anchor ではないので、#113 の分割では動かせる。
  - **合流を増やさない保証（再々レビューで追加）**: 固定や並べた位置のまわりで #113 の分割が別の結果になり、merge のときは別の点だった端どうしが同じ点に来ることがある（再レビューの例では、`a → b` 2 本が 1 つの点・1 つのネットになった）。個別に直すのではなく、分散した解決（#113 を含む）の後に不変条件を確かめる: 2 つの端（junction を除く）が同じ点にあるなら、merge の解決でも同じ点にあったこと、かつ merge で引けた辺に分散で理由（`layout/no-route`）が出ていないこと。破れたら**図全体を merge の解決に戻す**（辺ごとに戻すと、戻した端が分散した端の位置と重なりうるので、決定的で単純な図単位にした）。分散は合流を減らすことしかしない。#109 の 4 図・図 3 の anchor なし版・合成 2 図では保証は働かない（出力は保証の前と同じ）。乱数で作った小さな図（3 個の row と attach の 2 個、4〜11 本の辺）3000 個のうち 3 個で働いた。
  - **経路の数も merge より減らさない（再々レビューで追加）**: 端の解決が通っても、並べた位置の stub の先を別の箱が塞ぎ、merge なら引けた辺が `layout/no-route` になることがある（stack（`align: start`・`gap: 0`）の [a・b の row、t より狭い o、t] で、`a → t` の並べた端の上に o がある）。`routeEdges` は分散で引いた結果（`chooseRouting` の stub の線での再試行を含む）に error があるときだけ、`fanIn` を外した IR でも同じく `chooseRouting` で引き、error が少なければ**図全体を merge の経路**にする。error がない通常の場合は 1 回だけ引くので時間は増えない（上の表の数値は変わらない）。交差の報告・ラベルの診断も選んだ方の結果のもの。
  - **merge のときの合流（#143 で修正、§6.35）**: #113 の分割は、多重辺の 1 本を同じ向きの別の端の点に動かすことがあり、merge のときに平行な辺が 1 本の線・1 つのネットに潰れていた（再レビューの例の `a → b` 2 本は、分散なしでも 1 つの点に来た）。この PR の範囲外として残し、#143 で分割が平行な辺の端の点を避けるようにした。今は再レビューの例の `a → b` 2 本は merge・spread とも別の点・別のネットになる。保証は分散の安全策として残す（比べる merge の解決が正しくなったので、働く図は減る。§6.35 の乱数の図（seed 143）の spread 3000 図中 30 → 15 個）。
  - **anchor ではない（判断）**: 試作（`research/124-stage-b/route/strategies.ts`）は並べた位置を anchor として書き込んでいたが、製品では「位置は決まっているが anchor ではない」端にした。多重辺の振り分けは位置の決まった端を扱わない（anchor と同じ）が、#113 の分割では動かせる。anchor として扱うと、並べた位置が出る端と重なったときに「両方 anchor」の `layout/no-route` になり得る。
  - **フィールド名（判断）**: Issue の案は `figure.layout.ports: spread`。分散するのは入る側（fan-in）だけで、出る側（fan-out）は合流のまま（非対象: 合成 grid で経路のない辺が出た）なので、`ports` では全部の口が分かれるように読める。`fanIn: merge | spread` は対象と既定を名前で示し、将来 fan-out を分ける場合も別のフィールド（`fanOut`）で意味を変えずに足せる。値の綴りは他の列挙（`labelAt` など）と同じ小文字の英単語。
  - **既定を merge にした理由（利用者の判断）**: 図 3 の遠回りは解消するが、合流していた線が別々に他の線を横切るので交差の点が増え（下）、合流を前提にした既存の図の経路が変わる。
  - **検査**: 値は Zod の列挙で、誤った値は位置付きの `schema/invalid-value`（値の一覧つき）。auto では `merge` も含めて `layout/structured-only`（§6.19。黙って無視しない）。`FigureMetaIR.fanIn` は書いた場合だけ持つ（省略時の IR は変わらない）。
- **実測**（Apple M4 Pro・Bun 1.3.14。時間は経路探索の中央値、図は 9 回・合成図は 5 回で、機械の状態で 1〜2 割ぶれる。交差は #133 の `layout/edge-crossing` の点の数と `checkRoutes` の組の数。excess は各辺の「経路長 − 両端のマンハッタン距離」の和、遠回りは excess が 10mm を超える辺）:

  | 図 | v0.4.x 交差 点/組・excess・遠回り・時間 | 既定（配置の木） | `fanIn: spread` |
  | --- | --- | --- | --- |
  | #109 図 3（anchor 11 個） | 4/9・18.4mm・1・10ms | 同じ（バイト一致） | 6/10・3.3mm・0・13ms |
  | 図 3（anchor なし） | 4/9・16.2mm・1・18ms | 3/8・51.7mm・3・14ms | **6/10・1.1mm・0**・10ms |
  | 図 1・2・4、作例、fixture | — | 同じ（バイト一致） | 同じ（fan-in がない） |
  | 合成 columns（129 辺） | 23/24・2700mm・49ms | 24/25・2536mm・35ms | 24/25・2536mm・28ms（経路のない辺 0） |
  | 合成 grid（146 辺） | 1233/1945・17547mm・360ms | 1169/2030・17016mm・307ms | 1508/2010・16844mm・452ms（経路のない辺 0、重なり 3・接触 16） |

  図 3 の anchor なし版は、受け入れ条件（遠回り 0・excess 2mm 以下）を満たす。分散の時間の増加は grid で約 +34%（338 → 452ms）（端点の解決は 2 回になるが、増えた分の多くは口が増えて格子が大きくなるためと考えられる。推論）。合成 grid の重なり・接触は既定（0・8）より多いが、v0.4.x（7・20）と同程度の混み合った溝での接触で、テストで上限（接触 16・重なり 3）を固定する。
- **テスト**: `port-sides.test.ts`（中心の差による規則と箱の向きが食い違う配置であることをテストの中で確かめた上で: stack・row、`up` / `left` の箱、attach と attach の連鎖、別々の group の要素、group が端。箱の軸で重なる attach（レビューの再現）とその逆向きの辺は中心。分ける箱がない場合も中心。merge は 1 つの口と 1 つのネット・省略と同じ出力、spread は文書順と違う相手の順に 1/4・2/4・3/4 で 3 つのネット、東西の辺では上から順、相手の位置が同じなら文書順、anchor の端は動かず最寄りの位置を取る、中央の anchor と重ならない、多重辺の位置を保って別の位置に入る（レビューの再現）、本数の違う多重辺で残る端が予約した位置のまま 7 本とも別の点・別のネット（再レビューの再現）、保証: 乱数の探索で見つけた図で分散が merge に戻り、再レビューの例で merge にない合流がない、o が塞ぐ図で分散が merge の経路・診断と同じになる、junction は合流のまま、同じ辺から出る端とは #113 で分かれる。図 3 の anchor なし版で spread の遠回り 0・excess 2mm 以下・交差 6 点、merge は遠回り 3）、`router.test.ts`（合成 2 図の spread で全辺が引け、決定的で、時間をログに出す）、`layout.test.ts`（auto での `layout/structured-only` の位置、誤った値の位置、IR の値）。
- **研究のコード**: `research/124-stage-b/route/variant.ts` は製品の `facingSide` の行に文字列のパッチを当てるので、この変更で当たらなくなり、`stage-b.test.ts` の該当テストは（設計どおり）スキップされる。試作の数値は `results/route.json` に残る。
- **非対象・引き継ぎ**: fan-out の分散、交差の最小化（§6.28 の判断のまま）、auto での分散。Skill の説明（「同じ口に入る辺は合流する」の改訂と、`fanIn: spread`・合流させたい場合の junction、合流で遠回りする場合の対処）は #135。

### 6.34 #131 の凡例（`component: legend`）

段階 B（[#124 の計画](../research/124-stage-b.md) §3.3・§5-5）。#109 の 4 図中 2 図（図 2・4）で「破線 = skip / 教師信号・更新」の凡例が要った。新しい部品の追加で、**`legend` を使わない図**の IR・Layout IR・D2・SVG・PDF・PPTX はバイト単位で変わらない（作例・ギャラリーの既存の出力は無変更。ギャラリーには legend の見本 4 枚と目次が**追加**され、PDF・画像方式 PPTX・編集可能 PPTX の corpus の hash も追加だけ）。診断で変わるのは、未知の部品・種類違いの hint の部品の一覧に `legend` が加わることだけ（lint の golden `no-cascade` を更新）。

- **部品**: `sumi/legend`（kind `node`、variants `default`（枠あり）・`plain`（枠なし）、since 0.5.0）。`props.entries`（1〜20 件、上から順）の各項目は `edge`（見本の線: `component`（既定 `arrow`）・`variant`）か `node`（見本の箱: `component`（既定 `box`）・`variant`・`tone`）の**ちょうど一方**と、`label`（空でない文字列。ラベルの数式も使える）を持つ。どちらもない・両方ある項目は `component/invalid-prop`（項目の位置）。項目のフィールド名は辺・ノードのフィールド名そのままで、色の値は書かない（Theme が決める）。凡例の `label` は枠の見出し（group の見出しの書式）、`tone` は枠の色。`icon` は `asset/icon-unsupported`。
- **manifest の `engines`（判断）**: 部品が描けるエンジンを manifest に書けるようにした（`engines: ["structured"]`。省略はすべてのエンジン。空・重複は `component/invalid-manifest`）。`component` 段が、図のエンジンを含まない部品を `layout/structured-only`（auto の図。対称のため structured の図では `layout/auto-only`。組み込みでは使わない）として部品の参照の位置に出す。`sumi catalog --json` とギャラリーの部品の表にもそのまま出るので、利用者・エージェント・試験基盤（下記）がエンジンを見て部品を選べる。凡例の ID で特別扱いしなかったのは、試験基盤の見本の生成を「エンジンを見る」一般の規則にするため。
- **展開（判断: `component` 段の後）**: `checkFigure()` が `component` 段の直後に `expandLegends()`（`src/core/figure/legend.ts`）を実行する。キャプション（§6.32）と違って `component` 段の**後**にしたのは、検査済みの `props.entries`（既定値の補完と型の検査の済んだもの）から展開するため。展開で足した要素は同じ `component` 段（`resolveComponents()` の `only`）で解決し、以降の段（asset・theme・profile・lint・IR）は普通の要素として扱う。auto の図では展開しない（凡例は上のとおりすでに error）。
  - **枠**: 凡例のノード（`nodes[i]`）を消し（`undefined` にする）、**同じ ID のグループ**を `groups` の末尾に足す。配置の木の項目・`align`・`attach.to`・辺の端点に書かれた凡例の ID は、そのまま枠を指す。親は凡例のノードの親（`layout` 段が配置から補ったもの）。枠の部品は `sumi/legend` のままにし、`component` 段の結果には凡例の manifest から作った**グループの manifest**（名前・variants・Theme の `components.legend` を共有、`shape: rectangle`）を入れる。枠はグループとして描かれる（padding・見出しの帯・枠線）ので、凡例のスタイルは Theme で他の部品と同じく `components.legend.<variant>` に書く。
  - **部品と配置**: 項目 n（1 始まり）ごとに、文字の `sumi/label`（`<凡例>-<n>-label`）と、見本の線なら hidden の junction 2 つ（`-start`・`-end`）とその間の辺（ID `<凡例>-<n>-line`、項目の `edge` のフィールド）、見本の箱なら項目の `node` のフィールドを持つノード（`-box`、ラベルなし）を足す。枠の配置の木は `stack { gap: rowGap, align: start }` に、項目ごとの `row { gap: textGap, align: center, items: [見本, 文字] }`（見本の線は `row { gap: line, items: [start, end] }`）。見本の線は**本物の辺**なので、Theme の解決・ルータ（2 点の間の直線）・SVG writer・inspect・PPTX が他の辺と同じ破線（位相を含む `stroke-dasharray`）・矢じり・線幅・色で描く（下記のテストで SVG の markup を比べる）。
  - **大きさ（判断: 文字の大きさに比例）**: 見本の幅 2.5em、箱の高さ 1.125em、見本と文字の間 0.5em、行の間 0.375em（em は Theme の `sumi/label` の文字の大きさ。D2 単位 0.5pt に丸める）。8pt の Theme では幅 20pt（破線 2 つと矢じりが入る。#124 の試作の 6mm ≒ 17pt に近い）、slides（16pt・線幅 2pt）では 40pt。固定の mm にすると slides の太い矢じりで破線が見えなくなった（実測）。見本の線の長さは幅から hidden の junction 2 つ分を引いたもの（組み込みの Theme では 0.5pt × 2）で、線と箱の見本の幅が揃い、文字の左端が揃う。円・正方形（`fixed-aspect-1`）の箱は高さの正方形なので、その行だけ文字が左に寄る（許容）。width / height の props のない形の部品はその部品の既定の大きさ。印（mark）・画像・文字だけの部品・凡例は見本の箱にできない（`component/invalid-prop`、項目の `node.component` の位置）。
  - **予約した ID（§6.32 と共有）**: 利用者のノード・グループが部品の ID を、辺が `<凡例>-<n>-line` を使っていれば `ref/reserved-id`（error、その要素の `id` の位置、related は凡例の項目）で、その凡例は展開せず無効にする。キャプションと同じ処理を `src/core/figure/expand.ts`（`takenIds()`・`reportReservedId()`・`recordExpanded()`）にまとめ、キャプションのメッセージは変えていない。ID は最長 64 + 9 文字（項目を 20 件までにしたのはこのため）なので、inspect の `sumi-k-*` の復号は 73 文字まで受け付ける。
  - **由来の記録（§6.32 の拡張）**: 展開した要素の由来を `doc.expanded`（ElementKey → `{ from: "caption" | "legend", path, subject, name }`）にまとめた。キャプションもここに記録し、`figureElements()`・profile 段・数式の警告・lint のメッセージは由来の `path`・`subject`・`name` を使う（キャプションの診断は従来と同じ）。凡例の部品の path は、枠が `nodes[i]`、文字が `…entries[j]`（`label` の位置は `entries[j].label`）、見本の線（辺と junction）が `…entries[j].edge`（`component`・`variant` の位置もそのまま実在する）、見本の箱が `…entries[j].node`。subject は凡例のノード、name は `legend "key"`・`the sample line of entry 1 of legend "key"` など。IR の要素には `legend: { id, name }` を付け（凡例に関係しない要素には付かないので既存の IR は不変）、source map・幾何 lint（subject と名前）・ルータの no-route（`Legend "key" is in the way.`）がこれを使う。
- **`attach`**: 凡例は枠（グループ）として配置の木に置くので、`attach` で置いた凡例は `layout/attached-legend`（error、`attach` の位置）。
- **lint `lint/unused-legend-entry`（warning）**: 項目の見本と同じ部品・variant（箱は tone も）の辺・ノードが、作者の書いた要素（展開した要素を除く。ほかの凡例の見本は数えない）にないとき、項目の位置に出す。比べるのは解決した部品の ID と variant（`arrow` と `sumi/arrow`、省略した `default` は同じ）。箱の項目はノードとだけ比べる（グループの tone は対象外）。
- **構造 lint の調整**: `lint/empty-figure`・`lint/no-edges` は展開した要素を数えない（凡例だけの図は空ではなく、見本の線は作者の辺ではない）。`lint/empty-label` は見本の箱を対象外にする。`lint/long-label`・`lint/missing-glyph` は項目の文字にも働き、`entries[j].label` を指す。
- **Theme**: 4 つの組み込み Theme に `legend` を足した（`default`: 紙の色の塗りと枠の色（academic は `color.paper`・`color.frame`、ほかは `color.bg`・`color.muted`）、`plain`: 塗りなし・線幅 0）。
- **試験基盤（判断: 黙って除外しない）**: 全部品の描画テスト（`src/compiler/testing.ts`）は auto の図に全部品を並べていた。`primitivesFigure()` は auto で描ける部品（manifest の `engines`）だけを並べ、描けない部品（`STRUCTURED_ONLY_MANIFESTS`、今は凡例だけ）は `structuredPrimitivesFigure()` の structured の図に置く（知らない structured 専用部品は throw）。`writtenComponentOf()` が展開した要素を凡例の部品・variant にたどる。`builtins.test.ts` は両方の図で全部品 × 全 variant と下ろし方の表（凡例は `rectangle`）を、`builtins-render.test.ts` は structured の図を 4 Theme で描き（D2 不要なので常に実行）、各要素の markup がちょうど 1 つ・凡例が全 variant・見本の線の色・幅・破線（描かれる `sumi-wire` の線）・矢じりの形と見本の箱の形・塗り・線が同じ部品・variant の作者の要素と同じことを確かめる。ギャラリー（`scripts/gallery/samples.ts`）も同じく `engines` を見て `structuredSample()` を使い（知らない部品は throw）、`samples.test.ts` がエンジンと、展開した要素から部品・variant をたどれることを確かめる。
- **テスト**: `legend.test.ts`（展開の形・配置の木・部品と ID・枠の部品とスタイル・`doc.legends`、IR の `legend`・source map、大きさの比例・正方形の箱、auto の `layout/structured-only` の位置、ノード・グループ・辺の予約した ID の位置付きの診断と related、項目の検査、見本の未知の部品・variant と数式の誤りが項目のフィールドを指すこと、見本の箱にできない部品、`attach`・`icon`、構造 lint の数え方、`lint/unused-legend-entry` の位置・文言・ほかの凡例の見本を数えないこと）、`legend.integration.test.ts`（#124 の図 2・4 の草案（`requires` だけ外す）が凡例付きで error・warning・幾何 lint・構造 lint 0 件（図 2 は #133 の交差の info 2 件）、各部品が枠の内側、見本の線が同じ部品・variant の辺と IR のスタイル・矢じり・SVG の markup（線の色・幅・破線・矢じり）で一致）、上記の試験基盤。
- **非対象・引き継ぎ**: auto の凡例（D2 の `near` と grid で可能と確認済み。#124 §6）、行列の class の凡例（段階 C）、凡例の見出しの位置（ノードには `labelAt` がない）、正方形の箱の行の文字の揃え、グループの tone を説明する項目。Skill の説明は #135。

### 6.35 #143 の入りと出の分割で平行な辺を潰さない

§6.22 の #113 の分割（`ports.ts` の `separateDirections`）の不具合の修正。#142 のレビューで見つかり、§6.33 に既存の挙動として記録していた。

- **不具合**: 平行な辺（同じ 2 要素を**同じ向き**に結ぶ辺。`a → b` 2 本）は、多重辺の振り分けで別の位置（1/3・2/3）に置かれる。#113 の分割は、入りと出が同じ口を使うとき片方の向きの端を「辺の端までの中点」に動かすが、その先がもう 1 本の平行な辺の端の点だと、2 本が同じ点から出る。同じ向きの共有は fan-out のネットとして許しているので、2 本は 1 つのネットになり、相手の端も直線を保つために同じ点へ動くと、同じ経路の 1 本の線になった。再現（120pt × 60pt の 5 つの box。row [a, b, c]（gap 30pt）、b の南に d・c の南に e を attach（gap 60pt）、辺 `d→c a→e c→d c→a a→b a→e a→c a→e a→b`）では、a の東の 1/3 に `a → b`（1 本目、出る）と `c → a`（入る）があり、出る側が (1/3 + 1) / 2 = 2/3 に動いて、2 本目の `a → b` の点に重なった（edges[4] と [8] が `(251,97) → (311,97)`・net 0）。
- **修正（判断: 平行な辺の端だけを避ける）**: 動かす先が、動かす端のいずれかについて平行な辺の端（同じ辺・同じ内外）の点なら、反対側の半分（`o / 2` と `(o + 1) / 2` のもう一方）、次に 1/4, 3/4, 1/8, 3/8, …（1/1024 まで）のうちその辺で使われていない位置のうち、平行な辺の端に重ならない最初のものに動かす。直線を保つために相手の端を動かす場合も、その先が相手の側の平行な辺の端の点なら動かさない（線は曲がる）。再現では `a → b` の 1 本目が 1/6 に動き、b の端も 1/6 に来て直線のまま、2 本は別のネットになる。
  - **避けるのは平行な辺だけ（判断）**: 動かす先が別の要素への端と重なる場合（fan-out・fan-in の合流になる場合や、入りと出が再び重なって次の周回で分けられる場合）は従来どおり。§6.22 の設計（同じ向きの共有は合流のネット、重なりは次の周回で分ける）を変えず、出力が変わる図を「平行な辺が潰れていた図」に限るため。動かす前から同じ点にある端（多重辺の振り分けの前から同じ点、または一緒に動く端）は対象外。
  - **報告（判断）**: 候補がすべて平行な辺の端に重なる場合（1 つの辺に千を超える平行な辺）は従来の位置に動かし、分割の後に「分割の前は別の点だった平行な辺の 2 端が同じ点にある」組を確かめて、文書順で後の辺を `layout/no-route`（「平行な辺と点を共有し、その辺に空いた位置がない」）にする。黙って 1 本に描かない。既存のコード（§6.22 の「空いた位置がない」と同じ扱い）を使い、新しいコードは足さない。実際の図ではまず起きない（テストの乱数の図では一度も出ない）。
- **互換性（実測）**: 作例・fixture・#109 の 4 図・#124 / #135 の図・#86 の図を含むリポジトリの structured 図で配置まで通るもの全部（`*.sumi.yaml` の 28 図）の Layout IR と診断がバイト単位で修正前と同じ。golden（`CI=1 bun test`）と `bun run gallery:check` も無変更で通る。合成 2 図（merge・spread）の Layout IR も同じ（sha256 一致）。出力が変わるのは、分割の途中で動く先が平行な辺の端に重なる図だけ（最後まで重なったまま残る図に加えて、途中で一度重なってから後の周回で離れていた図も、動き方が変わるので結果が変わる）。乱数の小さな図（下のテストと同じ生成器、seed 143 と 99 の各 3000 図 × merge / spread）では、修正前に平行な辺の端が重なっていた図が 459 / 469 個（12000 個中）、修正後 0 個。merge で出力が変わり修正前に最後の重なりのなかった図は 7 / 6 個（各 6000 個中）で、これがその途中の重なりの例（乱数の図ではすべて attach した箱が別の箱に重なる配置だったが、途中の重なり自体は配置によらず起こりうる）。また各 seed の 12 個（すべて重なった配置）で、接する 2 辺の上で辺の両端が同じ点になり「both ends are the same point」が増える。同じ診断の変化は、重ならずに接する箱（`gap: 0`）の間の辺でも起こりうるが、その辺は修正前も引けなかった（接する 2 要素の間の辺は §6.22 の `layout/no-route`）ので、変わるのは理由の文だけ。箱が重ならない乱数の図（各 seed 約 2300 個）では、修正の前後とも端の解決の error は 0。
- **実測**（Apple M4 Pro・Bun 1.3.14。経路探索の中央値（5 回）、修正前と後を 3 回ずつ交互に測った範囲。交差・経路長は変わらない）:

  | 図 | 修正前 | 修正後 | 交差 点/組・重なり・接触（前後で同じ） |
  | --- | --- | --- | --- |
  | 合成 columns（merge） | 38〜39ms | 37〜39ms | 24/25・0・0 |
  | 合成 columns（spread） | 36〜37ms | 37〜38ms | 24/25・0・0 |
  | 合成 grid（merge） | 316〜351ms | 322〜335ms | 1169/2030・0・8 |
  | 合成 grid（spread） | 438〜459ms | 445〜466ms | 1508/2010・3・16 |

  候補を探すのは平行な辺の端に重なる場合だけで、平行な辺の索引は 1 回だけ作るので、時間の差は測定のぶれの範囲。
- **テスト**: `router.test.ts`（再現: edges[4] と [8] が別の端点・別のネットで、それぞれ直線のまま。`a → c` と 2 本目の `a → b` の fan-out の共有は残る。小さな例: row [a, b, c] に `c→a a→c a→b a→b` で、1 本目の `a → b` が 1/6 に動き b の端も追う。両方の半分が平行な辺の端: 3 本の `a → x` の真ん中が、anchor の 1/8 と他の端を避けて 3/8 に動き、a の端も追い、anchor の端は動かない。相手の端の先が平行な辺の端: 相手は動かず線が曲がる。接する箱（`gap: 0`）を含む図: 平行な辺が別のネットで、全辺が引ける。乱数の図: §6.33 と同じ形（3 個の row と attach の 2 個、4〜11 本の辺）を 1500 個、merge と spread で、平行な辺が同じ端点を持たず、平行な辺の報告も出ない。箱が重ならない図（776 個）では全辺の端が解決する。6 つとも修正前の `ports.ts` では失敗する）、`port-sides.test.ts`（§6.33 の再レビューの例: `a → b` 2 本が merge・spread とも別のネット）。

### 6.36 #155 の `align` による図の拡大の報告と、同点の案の選び方

#151 の A2。`figure.layout.align`（§6.31）が制約を満たすために図を大きく伸ばしても何も言わなかった（#151 の図 4 の 4 回目で高さ 125.77 → 188.38mm、再現 `research/151-dogfood-v0.5/repro/align-grows-figure.sumi.yaml` で 89.96 → 126.82mm）。

- **原因**: 案は残差の和だけで比べ、同じなら先の案を残していた。中央寄せの row で、単独の stack にある項目（隠れた junction）と、背の高い枝の奥の項目（gateway）を `y` で揃えると、A（上の項目の枝の前の `lead`）も B（下の項目の後の `trail`）も 1 回で不足分の半分しか縮めず（中央寄せで箱ごと半分動く）、和が毎回ぴったり並ぶ。先の A が選ばれ続け、gateway の枝の上に空きを足して押し下げた（junction も図の中央寄せで下がる）。B は junction の短い stack を伸ばすだけで図は伸びない。
- **選び方の変更（判断: 同点のときだけ canvas の面積を見る）**: 和が小さい案を採るのは従来どおり。和が同じ（差が浮動小数の誤差 1e-9 unit 以内。従来の比較と同じ幅）なら canvas の面積（幅 × 高さ、unit）が小さい案、それでも同じなら先の案。
  - **同点の幅を `ALIGN_EPSILON`（0.01 unit）にしない（判断）**: 最初は「満たしたとみなす幅より小さい差は区別しない」として 0.01 にしたが、#151 の図 4 の最終版（`x` の制約 1 つ）の 1 回目で、和が 0.001 unit だけ小さい B を A と同点に扱い、面積も同じなので先の A を採り、大きさは同じまま API tier と Workers の位置と経路が変わった（見た目は悪くなった: Training API → Metadata DB が Workers の枠の中を通る）。和に実際の差がある案の選び方は変えず、出力が変わる図を「ぴったり同点で面積が違う」図に限る。
  - **面積（判断）**: 幅と高さの和でもよいが、面積は紙の上での図の大きさに近く、伸びる向きを問わない。canvas は整数 unit に丸めるので、配置の差が丸めた後の canvas の幅・高さを変えなければ面積は同じで、先の案が残る。
  - **根本の見直しではない**: 1 回ごとの貪欲な選び方の同点を破るだけで、和に差があれば図が伸びる案も採る。図の大きさを目的関数に入れる解き方は段階 C（#151 の C7）。
- **報告（判断: info `layout/align-grew-figure`）**: 解いた後、最初の配置（strut なし。反復の最初に必ず計算するので配置の回数は増えない）と最後の配置の canvas を比べ、幅か高さが **5mm を超え、かつ元の 10% を超えて**伸びたら 1 件（`figure.layout.align` のパス、位置なし、subject は figure）。メッセージは伸びた辺ごとに増分と前後の大きさ（mm、小数 2 桁）と割合（例: `figure.layout.align made the figure 36.86mm taller (height 89.96mm → 126.82mm, +41%) than the layout without it.`）。hint は「strut は空きを足すだけで、後ろの項目と囲む箱も動かす。不要なら単独で動ける項目（自分の stack / row に包む）を揃える、木の中で近づける、制約をやめる」。
  - **info にする**: 制約は満たされており、伸びが意図どおりのこともある（U-Net の skip を水平にするために encoder の段を下げる）。警告にすると、`--max-warnings 0` の CI で正しい図を落とす。
  - **閾値**: 揃えるための通常の費用は gap か箱の半分ほど（`align-unet` で高さ +1.94mm（2%）、`align-side-kv` で +4.23mm（3.5%））、暴走した例は +36.9mm（41%）・+62.6mm（50%）。両方を超えたときだけ出すのは、大きな図の数 mm は目立たず、小さな図の大きな割合も紙の上では数 mm だから。閾値は `ALIGN_GROWTH_MM`・`ALIGN_GROWTH_RATIO`（`align.ts`）。
  - 比べるのは配置の段の canvas（経路を引く前）。経路やラベルで最後の SVG の大きさは変わり得るが、strut の有無で同じ条件の比較になる。
- **互換性（実測）**: `align` を書いた図はリポジトリに 7 つ（作例・ギャラリーにはない。`tests/fixtures/figures/layout/align-unet`・`align-side-kv`、#124 の 2 図、#151 の図 3・図 4・再現）。変更の前後で SVG を比べ、変わったのは再現だけ（意図した変更）。golden（`CI=1 bun test`）と `bun run gallery:check` は無変更で通る。`align` のない図は反復に入らないので変わらない。
- **結果**:

  | 図 | 変更前 | 変更後 | 反復 / 配置の回数（後） |
  | --- | --- | --- | --- |
  | 再現（`align-grows-figure`） | 88.19 × 126.82mm（strut なしは 89.96mm） | 88.19 × 89.96mm（伸びない。junction が上がり gateway と同じ高さ） | 14 / 29 |
  | #151 の図 4 の 4 回目（junction を stack に包み `y: [client-join, gateway]` を足したもの） | 165.28 × 188.38mm（なしは 164.75 × 125.77mm） | 164.75 × 125.77mm（ML platform の上の約 60mm の空白がなくなる） | 15 / 59 |

  変更前の 2 図では info が出る（再現は高さ +36.86mm・+41%、図 4 は高さ +62.61mm・+50%）。変更後は伸びないので出ない。
- **テスト**: `align.test.ts`（再現と同じ形の図で、junction の `trail` が空きを受け持ち canvas が strut なしと同じになる（変更前の選び方では失敗する）、`lead` しか解けない図で info の code・severity・パス・前後の大きさ、`align-side-kv` の約 4mm の伸びは出さない、片方の閾値だけを超える伸びは出さない、幅の伸びと幅・高さの両方を 1 件で報告する）。既存のテストのうち、group を下げて揃える例（高さ +7.58mm・+15%）と乱数の制約の件数の検査は info を除いて数える。
- **Skill**: `references/diagnostics.md` の表に 1 行。

### 6.37 #153 の矢じりの前の余白を junction の先まで伸ばさない

§6.22 の矢じりの前の余白（#116）の不具合の修正。[調査 #151](../research/151-dogfood-v0.5/README.md) の A1。

- **不具合**: ⊕ からすぐ上の hidden junction への線（`add1 → split2`）が、まっすぐ引けるのに S 字に迂回し、junction に西から入った（再現 `research/151-dogfood-v0.5/repro/junction-detour.sumi.yaml`）。
- **原因**: junction から出て矢じりで入る辺（`split2 → norm2`）の余白（`arrowRoom()` = 20 unit）が、junction と Layer Norm の距離（約 14.7 unit）より長く、余白（とその stub の予約）が自分の始点の junction を越えて、反対側（⊕ の側）まで伸びていた。`add1 → split2` は junction を通じて同じネットなので、その余白の中の格子点に踏み込むたびに「同じネットの別のエッジが余白の中で合流する」費用 `ROUTE.arrowRoom`（100）を払う。費用は格子点ごとなので、格子の密度で変わる。凡例（とその上の MLP）が加える格子の線（junction の真下の 159.274・155.854）で、まっすぐの経路は 3 点分（300）、西に出て横から junction に入る経路は junction の 1 点分（100）と曲がり 3 回（120）になり、S 字が安くなった。凡例・MLP・Feedforward のどれかを消すと線の位置が変わってまっすぐに戻るのはこのため（Issue の疑いだった、凡例の見本の junction の扱いやネットの結合は関係しない。凡例の見本を `node` にしても起きたのは、格子の線を加えるのが凡例の箱だから）。A8（破線の共有幹線の T 字の分岐が「›」に見える）は経路ではなく、分岐点で各経路が自分の角を丸める描画（`src/render/wire.ts`）によるもので、原因が違うのでこの修正の対象外（経路は修正の前後で同じ）。
- **修正（判断: 余白を真正面の junction で止める）**: `Router.#room` で、もう一方の端が junction で、余白の向きの真正面（同じ線の上、前方）に余白より近くにあれば、余白をその距離までにする。その距離が stub（矢じりの長さ以上）より短ければ余白なし（従来の stub だけ）。その経路は junction までのまっすぐな線で、junction の先の余白は自分の辺の外になり、そこを走るのは同じ junction のネットの他の辺だけなので、守る意味がない。余白の終わりは junction の中心で、そこは元から格子の線なので格子は増えない。判定は `clipRoomAtJunction`（`router.ts`）。
  - **余白が短くなることの影響（範囲を限って記録）**: 余白は、矢じりの手前の角を丸めても矢じりに届かないように経路の側で長さを取っておく仕組み（#116）で、丸めそのものを保証するのは SVG writer（`src/render/wire.ts`）。この修正で余白が junction までに縮むのは、junction から矢じりの口までが 1 本の直線になる場合で、その線の上には曲がり角がないので、経路の側で守るべき角はない。ただし、junction で他の辺が曲がるときの丸め（`wire.ts` の junction の角の半径。設定の最大値・障害物との間隔・線分の長さの半分で制限し、矢じりの側の残す長さ `keepStart` / `keepEnd` を見ない）は、矢じりの手前の余白を考慮しない既存の挙動で、この修正の前からある（半径は経路の点と周りの障害物で決まり、この修正で経路が変わったリポジトリの図は再現の 1 図だけ）。この PR では変えず、#160 で junction の丸めも残す長さに従うよう直した（§6.26）。
  - **障害物で直線にならない場合**: 余白を縮めた端で経路が曲がると、縮めた余白の外（stub の先）での曲がりは `ROUTE.arrowRoom` を払わない。真正面の junction との間に node は置けない（間隔は余白より短い）ので、実際にこうなるのは他のネットの経路を避ける場合だけで、#116 の「狭い隙間は従来どおり」と同じ扱いになる。
  - **junction に限る（判断）**: 端が box の口なら、真正面でも余白を止めない。向かい合う口の間の短い直線は §6.22 の「狭い隙間は従来どおり」で扱っていて、出力を変える理由がない。横にずれた junction も対象外（余白の中で曲がるか、余白を保って回り込むかは #116 の費用の比べ方のまま）。
  - **格子点ごとの費用は変えない（判断）**: 費用が格子の密度で変わるのは #116 の設計の性質だが、正しく余白を置けば、余白の中に同じネットの辺が入るのは本当に矢じりの直前での分岐・合流だけになる。費用の数え方を変えると #116 の全図の出力に及ぶので、今回は原因（余白の伸びすぎ）だけを直す。
- **互換性（実測）**: リポジトリの structured の図（`*.sumi.yaml` のうち `layoutStructuredFigure` が受け付ける 70 図。作例・fixture・#109 / #151 の図を含む）の Layout IR と診断のうち、修正の前後で変わるのは再現の 1 図だけ（sha256 で比較）。golden（`CI=1 bun test`）と `bun run gallery:check` も無変更で通る。
- **テスト**: `router.test.ts`（再現: 凡例ありでも `add1 → split2` が 2 点のまっすぐな線で、`split2 → norm2` も同じ x のまま。凡例を消した図も同じ。再現で A* の下界が Dijkstra と同じ費用。凡例ありの 1 つは修正前の `router.ts` では失敗する。`clipRoomAtJunction` を 4 方向それぞれで: stub より近い（余白なし）・stub ちょうど・stub と余白の間（junction で切る）・余白ちょうどとその先・横にずれた junction・後ろの junction・真正面の口（いずれも変えない）。4 方向（stack down / up・row right / left）× 矢じりが終点（`j → b`）か始点（`b → j` の double-arrow）で、junction に別の辺（`j → c`）もある図: junction を通る 2 本が直線で、全エッジで A* の下界と Dijkstra の費用が一致する。この 8 図は格子の線が足りず修正前でも直線になるので、回帰の検出は再現が担い、こちらは方向と端の組み合わせでの挙動と下界の確認）。

### 6.38 #154 の文字どおりの `\n`・junction 端の anchor・交差の hint

#151 の dogfooding（`research/151-dogfood-v0.5/README.md` の A4・A5・A10）で見つかった、診断の出ない書き方の誤りと、読みにくい診断の整理。描いた出力（SVG・PDF・PPTX・Layout IR・D2）は変わらず、診断だけが変わる。

- **文字どおりの `\n`（A4。判断: `lint/literal-newline`、warning）**: 単一引用符・引用符なしの YAML のラベルでは `\n` が改行にならず、2 文字のまま描かれる（数式を単一引用符で書き、2 行目に数式を置くと気付きにくい）。ラベルの平文の部分に `\n`（バックスラッシュ + n）があれば警告する。
  - **段（判断: 構造 lint）**: 文字どおりの `\n` を描く意図もありうる（`C:\new` のようなパス、コードの文字列）ので、`--rule lint/literal-newline=off` で止められる lint の規則にする。値は誤りではないので error・component の段にはしない。`sumi lint`（D2 不要）と `sumi render` の両方に出る。
  - **平文の切り分け（判断: 数式の構文解析と同じ区切り）**: `literalNewlines()`（`src/core/label/math.ts`）が、`parseLabel()` と同じ規則で `$...$` を見分ける: `\$` は数式を開かない、数式の閉じの `$` は行の中で探し `\` は次の 1 文字を飛ばす（`closingDollar()` を共用）、閉じない `$` の後は平文。数式の中の `\nu` `\neq` `\nabla` は対象外。structured では閉じない `$` は `component/invalid-math` で要素が invalid になるので lint は見ない。auto でも同じ区切りで見る（D2 もバックスラッシュをエスケープして描くので、文字どおりの `\n` はそのまま描かれる。`$\nu$` は `component/unsupported-in-auto` の範囲）。`\\n`（バックスラッシュ 2 つ + n）も、描かれる文字に `\n` が現れるので報告する。
  - **対象**: lint の要素すべて（node・group・edge のラベル、キャプション、凡例の項目のラベル）。ラベルを取らない印（junction・operator）はラベルが空なので出ない。報告はラベルごとに 1 件（複数あればメッセージに回数）。
  - **位置**: 最初の `\n` の 2 文字。`LintFinding` に任意の `span`（値の UTF-16 offset）を足し、`toDiagnostic()` が `Locator` の `span`（§6.24）に渡す。1 行の引用符付き・引用符なしのスカラーでは正確な列、それ以外はラベル全体。
  - **hint**: そのラベルの `\n` を改行にして二重引用符の YAML 文字列で書いた形（`JSON.stringify` の出力は YAML の二重引用符のスカラーとして読める）を示す。例: `'Scale, Shift\n$\gamma_1$'` → `"Scale, Shift\n$\\gamma_1$"`。他にバックスラッシュがあれば「他のバックスラッシュは 2 つに」と添える。80 文字を超える形は代わりに短い例を示す。ブロックスカラー（`|`）と、規則を無効にする方法も挙げる。
  - **既存の図**: リポジトリの `*.sumi.yaml` 108 図のうち、出るのは #151 の再現と `tests/fixtures/compile/labels.sumi.yaml`（エスケープの検査のため意図して `'C:\path\n\t (literal backslashes)'` を描く。真の陽性で、lint を検査する fixture ではない）の 2 つだけ。作例・ギャラリーには出ない。
- **junction 端の anchor（A5。判断: `component/anchor-on-junction`、warning）**: junction（manifest の `mark.type: point`）の端はルータが anchor を見ずに中心を使う（`ports.ts` の `resolveEnds()`）ので、`fromAnchor` / `toAnchor` は黙って無視されていた。
  - **段（判断: component）**: junction かどうかは部品の解決後に分かる（`layout` の段の anchor の検査は部品の解決の前）。「junction はラベル・tone・anchor を取らない」という部品の約束の検査として、`component/tone-unsupported`・`component/label-at-without-label`（効かない設定の warning、§6.27）と同じ `component` の段に置く。描画の段（ルータ）に置くと `sumi lint` に出ないので採らなかった。#151 の調査が仮に挙げた `layout/anchor-on-junction` は、段と code の接頭辞を揃える規約（§1）に合わせて `component/` にした。
  - **severity は warning（判断）**: anchor を外しても描かれる図は同じなので、要素は invalid にしない。位置は `edges[i].fromAnchor` / `toAnchor`。両端なら 2 件。hint: anchor を消す、線の向きを変えたいなら反対の端に anchor を付けるか、配置の木・`attach` で junction を動かす。
  - **auto**: anchor は `layout/structured-only`（error）でエッジが invalid になるので、重ねて出さない。端の junction 自体が invalid（`component/tone-unsupported` など）でも、エッジが invalid になるので出ない。凡例の部分（§6.34）の解決（`only`）では、その部分のエッジだけを見る。
- **交差の hint（A10。判断: 1 回だけ）**: `layout/edge-crossing`（§6.28）は 1 件ごとに同じ約 400 字の hint を付けていた。hint を、出力の並び（`sumi lint` / `render` と同じ `compareDiagnostics()`: ファイル・位置・code・path・メッセージの順。同じ辺の 2 つの交差は位置が同じなので、位置だけでは決まらない。比較関数は layout から使えるよう `src/core/diagnostics.ts` に移し、`src/lint/lint.ts` から再 export する）で最初になる 1 件だけに付ける。個別の交差がない（上限 0）ときだけ要約の 1 件に付ける。code・severity・メッセージ・位置・件数は変わらない。
- **テスト**: `math.test.ts`（`literalNewlines()`: #151 の再現、改行と文字どおりの区別、`\nu` `\neq` `\nabla`、`\$` の前後、閉じない `$`、行をまたぐ `$`、`parseLabel()` と同じ区切り）、`lint.test.ts`（fixture `lint/literal-newline.sumi.yaml` で node・group・キャプション・凡例・edge と位置、hint の形が YAML として読み戻せること、長いラベル、auto、`off`）、`resolve.test.ts`（junction・hidden junction の両端、group の端は対象外、auto、invalid な junction）、`crossings.test.ts`（hint は 1 件だけ、並びで最初の 1 件（位置が同じなら path・メッセージで決まる）、上限 0 の要約）。

### 6.39 #156 の線と枠線・線どうし・見出しの近接の幾何 lint

#151 の A6。ラベルと枠線の重なりは `geometry/label-collision`（#116）が見ているが、線（エッジの経路）が枠線の上やすぐ脇を走る、2 本の線がほぼ重なって並ぶ、線が見出しの文字に接する、は診断が出なかった。幾何 lint に 4 つの規則を足す（`src/lint/geometry/proximity.ts` の幾何と `rules.ts` の規則）。描いた出力は変わらない。

- **規則と severity（判断）**:

  | code | 既定 | 条件 |
  | --- | --- | --- |
  | `geometry/edge-on-border` | warning | 線が枠線と平行に 3mm 以上並び、線の間（下記）が 0.5pt 以下（線どうしが接する・重なる） |
  | `geometry/edge-near-border` | info | 同じく、線の間が 0.5pt を超え 1.5pt 未満 |
  | `geometry/edge-near-edge` | warning | 2 本の線（共有の幹線は 1 本と数える）が平行に 3mm 以上、線の間 1.5pt 未満で並び、同じ線ではない（中心の差 0.25pt を超える） |
  | `geometry/edge-touches-label` | info | 線が、端でないグループの見出し・キャプション・`label` 部品の文字から 1.5pt 未満を通り、横切らない |

  warning は見て明らかに不具合のものに限った: 枠線に重なる線は枠の一部として描かれ（線が消える）、ほぼ重なる 2 本はどちらの線か読めない。枠のすぐ脇（0.5〜1.5pt）は読めるが窮屈で、structured では下記のとおりルータの格子の制約から作者に直す手段がないことが多いので info。文字に接する線は意味を変えないので info（横切れば従来どおり `edge-crosses-label` の warning）。
- **描かれた線で測る（判断）**: D2 は `path.connection` そのものを描く（角は C の弧）ので、それを使う。structured の `path.connection` は線を持たない鋭角の論理経路で、実際の線はネットごとの `path.sumi-wire`（角を丸め、矢じりの手前で止まる。§6.26）なので、描いたものをエッジごとに持つ。SVG の wire は同じネット・線種のエッジを 1 本にまとめ、どのエッジが描いたかを失うので、SVG から読み直さず、writer と同じ計算（`paintedEdges()`: 角の丸め・矢じりの手前での切り詰め）の結果を `renderFigure()` が `SvgInspection.painted` に載せる（hidden junction で 2 本をつなぐ弧は `roundCorners()` のとおり入る側のエッジのもの）。`GeometryElement.drawn` はその線で、規則は長さと距離をこれで測る（見出しを横切るかの判定だけは `edge-crosses-label` と揃えて経路で見る）。描かれない角の分も、別のエッジ（透明なものを含む）の wire も、そのエッジの長さに数えない。SVG の本文だけを `inspectSvg()` した場合（`painted` なし）は経路で測る。
- **幾何**: 描かれた線を軸平行な直線の部分（傾き 0.25 unit 以内。弧の弦は短く、実質対象外）に分け、**部分ごとに自分のエッジと線幅を持たせる**。同じ座標・同じ範囲・同じ線幅の部分（共有の幹線）だけを 1 つの束にまとめ、座標の近さで連鎖的にまとめることはしない。比べるのは部分どうしで、中心の差が 0.25pt 以下の組は同じ線（共有の幹線）として除き、同じエッジの部分どうし（自分の折り返し）も除く。幹線から分かれた枝は、幹線を共有していた別のエッジとも比べる。枠との比較も、各エッジが自分で描く範囲を自分の線幅で測る（太い線が届かない範囲に太さを持ち込まない）。グループの枠は角の丸め（`radius`）を除いた 4 辺。線幅 0・`transparent`・不透明度 0 のグループとエッジ、不透明度 0 の文字、凡例の見本の線は対象外。線と線の**間**は、中心の距離から両方の線幅の半分を引いたもの。報告は、エッジとグループごと・エッジの組ごとに最も近い（次に長い）並びをとり、同じ線（最初に見つけた並びから 0.25pt 以内で重なる並び）に乗る他のエッジを 1 件にまとめて `related` に載せる。部分は軸ごとに座標で並べ、近いものだけを掃引で探す（束ごとに 1 回）。auto（D2 SVG）と structured の両方に掛かる。
- **しきい値（判断）**: 単位は D2 unit（0.5pt）。
  - **線の間 1.5pt（3 unit、0.53mm）**: 実測で、拡大して不具合と判断した並びは線の間 −0.67〜2.63 unit（#135・#151 の図 4 の二重線、枠に沿う線）。意図どおりの並び（作例 transformer の encoder と decoder の間の通り道 4.67、`group-caption` fixture の 4、残差の線と枠 7）と、拡大して枠から離れて見えた並び（#151 の図 4 の Auth → Metadata DB と Workers の右の枠、3.85）は 3.85 以上。印刷で 0.5mm を切ると、1pt の線 2 本は 1 本の太い線か二重線に見える。
  - **接する・重なる 0.5pt（1 unit）**: 幾何 lint の許容（`GEOMETRY_TOLERANCE_UNITS`）と同じで、`label-collision` の枠線の「触れる」と揃えた。
  - **長さ 3mm（17 unit）**: 矢じりと手前の stub より長い。短い例（#109 の図 4 の GPU pool の枠上の 6 unit の段差、#124 の図で分岐直後に 1.25 unit 離れて 9 unit 並ぶ 2 本）は数えない。
  - **同じ線 0.25pt（0.5 unit）**: structured の共有の幹線は同じ座標に引かれるが、D2/ELK は hidden junction から出る 2 本の間に 0.22 unit を残す（ギャラリーの `sumi/junction`・slides。最初の実装 0.05 unit ではここで誤検出した）。0.5 unit 以内なら線はほぼ全体で重なり、1 本に見える。
  - **見出しの文字**: 行の箱（ascender〜descender）ではなく、グリフの輪郭（`glyf`）の範囲で測る（`inkLines()`。計測と同じく、フォントにない制御文字・default-ignorable は描かず進めない。runs の数式・アイコンは行の箱）。行の箱は大文字の上に空きがあり、上を通る線を近すぎると数える。距離から線幅の半分を引いて 1.5pt 未満を報告する。実測: #151 の図 2 の 3 回目の「DiT」（作者が「接する」と記録）2.59 unit、図 4 の 1 回目の「GPU pool」の脇 2.83、`seq2seq-attention` の「Decoder」の「r」1.07 は報告。図 4 の最終版の「Workers」の上 3.4、「GPU pool」の上 3.23 は報告しない（拡大して離れて見える）。辺のラベルは対象外（共有の幹線の脇に置く `labelSide` のラベルに他の分岐が 3〜4.65 unit で並ぶのは意図どおり。`b-adaln-panel`）。
- **確かめた図（実測）**: リポジトリの `*.sumi.yaml` 80 図（examples・tests/fixtures・research。描画まで通る 72 図）とギャラリー（部品 × テーマ、tone、比較の表）。新しい診断は 33 件 + ギャラリーの比較の表 4 件で、すべて拡大して見て正しい検出と判断した（誤検出 0。作例・部品・tone の見本は 0 件）:

  | 規則 | 件数 | 図 |
  | --- | --- | --- |
  | `edge-on-border` | 5 | #135 の図 4（3）、#151 の図 4（Training API → Metadata DB が Workers の右の枠に 0.16mm）、#151 の再現 `caption-blocks-input`（キャプションを避けた線が枠の下辺の上） |
  | `edge-near-border` | 20 | #109・#124・#135・#151 の図 4（API tier の左の枠に沿う Clients の線、GPU pool・Storage の上で曲がる線）、#151 の図 2（MLP からの破線の幹線がブロックの右の枠の 0.35mm 脇を 44mm） |
  | `edge-near-edge` | 4 | #135 の図 4（2）、#151 の図 4（Training API と Auth から Metadata DB への 2 本が 0.16mm で 41mm、spread の 2 本の幹線が 0.46mm） |
  | `edge-touches-label` | 4 + 4 | `seq2seq-attention`（research 3 図と `align-side-kv` fixture）の「Decoder」。ギャラリーの比較で `pipeline` の minimal・color（2 Profile ずつ）の「Storage」（矢じりが「e」に重なる） |

  最初の実装（鋭角の経路で測る）では 39 件で、描かれた線で測るようにして 6 件が 3mm 未満になって消えた（いずれも角の丸めの分だけ短い並び。例: #135 の図 4 の ML platform の下辺の上 4.9mm → 2mm、分岐直後に重なる 2 本 5.6mm → 2.8mm）。残った件は長さが 0.3〜2.8mm 短くなっただけで、新しく出た診断はない。

  `group-label-at.integration.test.ts` の 2 図（#127 の題の周りを回る線、#124 の図 1）も同じ `edge-touches-label` が出るようになり、テストはその診断を期待する形にした（どちらも拡大して文字に接する）。
- **A9（別の辺のラベルに読める位置）は実装しない（判断）**: #151 の図 3 の 4 回目を再現すると、「identity」は自分の線から 3.0 unit、Global Pool へ入る別の辺の矢じりの先から 16.6 unit にある。距離では自分の線のほうがずっと近く、読み違えるのは「矢じりのすぐ脇のラベルはその矢印のもの」と読む習慣による。「別の辺の矢じりの先から 20 unit 以内」で拾うと、ラベルを矢じりの脇に置く structured の既定（`labelAt: end`）で、同じノードに並んで入る辺のラベルがすべて掛かる。リポジトリの図の辺のラベル（約 75）では再現以外に該当がなく、誤検出の率を見積もれる数がないので、規則にはしない。
- **限界・引き継ぎ**: 矢じりは経路に含めない（`pipeline` の「Storage」は線は 0.25mm 離れ、矢じりが文字に重なる）。斜めの線は見ない（両エンジンとも直交）。structured の `edge-near-border` の多くは、グループの中のノードの口の手前の曲がり（矢じりの余地）がグループの余白とほぼ同じ位置にあり、格子に枠から離れた線がないことによる（§6.22）。格子に枠 ± clearance の線を足すなどのルータの改善は別 Issue とし、ここでは検出だけをする。
- **時間**: 1 本の線分のエッジ 8000 本で 3 規則 4ms、3 本の幹線に 8000 本を重ねた図で 11ms（Apple M4 Pro、Bun 1.3.14）。座標は近いが範囲が互いに重ならない部分が多数並ぶ図（2 本の近い座標に交互に並ぶ短い部分）では、近い座標の組をすべて範囲で確かめるので、部分の数の 2 乗に近づく（レビューの測定で 8000 本 146ms）。実際の図では起きない形なので、区間の索引は足さない。
- **テスト**: `proximity.test.ts`（直線の部分のまとめ、束と掃引、wire の割り当て（角を丸めた U 字で直線 4 unit だけ・他のネットの wire は割り当てない）、角の丸め、矩形との距離。各規則の境界: 枠の上・0.35mm・0.53mm、3mm 未満、横切る線、線とグループごとに最も近い 1 件、共有の幹線の 1 件と `related`、二重線と線の重なり、同じ線・0.22 unit・自分の折り返し、見出しの文字・横切る場合・端の `label` 部品。#163 のレビューの再現: 幹線から分かれた枝、0.4 unit 間隔で並ぶ 8 本、太い線が届かない範囲、不透明度 0。`inkLines()`: 見えない文字、複数行、字形の種類、runs・アイコンの代替）、`proximity.integration.test.ts`（structured の図 4 を描いて、各エッジの描かれた直線が経路の上にあり角を覆わないこと、診断の全文。図 2 で hidden junction の弧がエッジに割り当てられること）。再レビューの再現: 共有の幹線の上のエッジと、相手の折り返した枝の比較、矢じりで切り詰めたエッジに同じ線の別のエッジの wire を貸さないこと（`painted` を持つ検査）、`group-label-at.integration.test.ts`（実際の structured の経路で `edge-touches-label`）。
- **破線（判断）**: 破線の間も描いた線として測る（長さも距離も中心線の連続した線）。破線の線が枠や別の線に沿って並ぶ見え方は実線とほぼ同じで、規則の対象とする。見出しとの距離は、線が文字の脇で切れている（破線の間）場合も接するとみなす（誤検出側。破線の位相までは追わない）。

### 6.40 #169 のほぼ揃った端で一周しない

[#167 の調査](../research/167-stage-c.md) の R1（§3.1）。structured の図で、向かい合う 2 つの端が 1 unit 未満ずれていると、段差で済むところを端の周りを一周する経路になった（再現 `research/167-stage-c/repro/operator-loop.sumi.yaml` は根の `gap` 50mm で一周し、49mm・51mm では起きない）。

- **原因（実測）**: 2 つが重なって起きる。
  1. **ずれの出どころ**: Layout IR の座標は 1/1000 unit に丸める。`align: stretch` で伸びた箱の中心（丸めた `x` ＋ 丸めた `width` の半分）と、中央に置いた ⊕ の中心（中心から計算して丸めた `x` ＋ 16）は別々に丸まるので、根の位置によって 0.001 unit ずれる（50mm で Attention の中心 444.968、⊕ 444.969。49mm では幅が 249.008 になり一致する）。幅の 1/1000 の桁が奇数の箱の中心は 1/1000 unit で表せないので、丸め方を変えても全部は揃わない。anchor を描画から 4 桁で写す・切りのよい分数で書く場合のずれ（0.001〜0.8 unit）も同じ形。
  2. **ルータに道がない**: 向かい合う口のずれた端を結ぶ段差（折れ 2 つ）は、送り元の stub（lane。clearance 6）と送り先の stub（矢じり 12、§6.22）の両方より先の行で横に渡る。隙間（2.5mm = 14.173 unit）が 6 + 12 = 18 より短いとその行がなく、残るのは「送り元の stub の先まで出て、横に出て、送り先の stub の手前まで戻り、横に入って、送り先へ入る」S 字（逆向きの区間を持つ）だけ。S 字の戻る縦の線は 2 つの口の線の**間**の列が要る（外側の列だと、片方の横の線がもう片方の stub を横切る。stub の中は曲がる・横切るのを禁じている）。格子の中線は 2 unit を超える隙間にしか足さず、口の線には中線を足さないので、ずれが小さいとその列がなく、残る経路は箱の脇の線（clearance の線）を使って ⊕ を回るものだけだった。直線を特別扱いしていない（§6.22）ことは原因ではなく、直線は揃っていれば最も安い経路として選ばれる。
  - 確かめ方: `layoutStructuredFigure` で 50mm の配置を取り、各端の stub と lane、格子の線を見た。下限（`verifyLowerBound`）は前後とも Dijkstra と一致し、探索の誤りではない。anchor で送り先をずらした実験（下の表）で、ずれが 2 unit を超えて間に別の線（中線や junction の中心）がある場合は S 字（長さ 24〜35 unit）になり、ない場合は一周（約 209 unit）になることを確かめた。
- **修正 1（判断: ε 以内のずれは揃える）**: 端を解決した後（`resolveEnds`、#113 の分割・fan-in の分散の後）、文書順に、向かい合う 2 つの端（2 つの口が反対向きで、相手が前方にある。または片方が junction で、口が junction を向く）のずれが `STRAIGHTEN_TOLERANCE`（2 unit = 1pt）以下なら、片方を辺に沿って相手の線へ動かす（`straighten()`、`ports.ts`）。経路は直線になる。
  - **ε = 1pt（判断）**: 既定の辺の線幅。線幅より狭い段差は段差に読めず、ねじれ・にじみに見える（0.001 unit の段差は描画上は直線で、経路に点が 2 つ増えるだけ）。調査の案は 1 unit だったが、1〜2 unit のずれは間の列がなく一周が残る（下の表の 49mm・1.5 / 2 unit）。2 unit で切ると、それを超えるずれは修正 2 の S 字になる。1pt 以下の anchor の移動は印刷で見分けられない。
  - **動かす端（判断）**: その点を他の端が使っていない端（共有の口を動かすと fan-in / fan-out のネットや他の辺の線が変わる）、動かす先に他の端がない（#113・#143 の「端を離す」を崩さない）、辺の範囲に収まる、の 3 つを満たすもの。候補は anchor のない端を先に、同じなら送り先を先に。junction は動かさない。どちらも動かせなければ動かさず、修正 3 で報告する。
  - **anchor も動かす（判断）**: §6.22 の「anchor を書いた端は動かさない」の例外。4 桁の anchor のずれは anchor の側にあり、送り元が共有の口の場合などは anchor 側しか動かせない。動かすのは ε 以内に限る。`checkRoutes` は、経路が 1 本の直線で、もう一方の端が自分の anchor の位置にある（anchor がなければ問わない）場合に限り、anchor の端が `STRAIGHTEN_TOLERANCE` まで離れるのを許す。両端がずれた直線、直線でない経路、ε を超えるずれは従来どおり報告する（レビューの指摘: 無条件に 2 unit を許すと、揃った直線を横に 1 unit ずらしても通った）。
- **修正 2（判断: 段差が入らない隙間には S 字の格子を足す）**: 向かい合う 2 つの口がずれていて、隙間が両方の lane の和より短い辺だけ、2 つの口の線の中間の列と、送り元の lane の端・送り先の lane の端の行を格子に足す（`tightJog()`、`router.ts`）。S 字は一周より短く、探索は普通の費用で選ぶ（特別扱いの経路は作らない）。足すのはその辺のある図だけなので、他の図の格子は変わらない。
  - 列は 1/1000 unit に丸めた後に 2 つの口の線の**真に間**にある場合だけ足す。修正 1 で揃わなかった端（両端とも共有の口）が 0.001 unit ずれている場合、中点は丸めで片方の口の線に重なり、S 字は作れない（レビューの指摘。最初の版ではここで列を足したつもりで、実際には一周（約 553 unit）に戻っていた）。そのときは一周が残り、修正 3 の warning が出る。0.002 unit 以上なら 0.001 unit 幅の S 字になる。
  - 段差が入らない場合の受け入れ条件「一周より短い経路か診断」は、端が動かせれば直線（修正 1）か S 字（修正 2）、動かせず S 字も作れなければ診断（修正 3）で満たす。
- **修正 3（判断: 揃えられなかった端は warning `layout/unaligned-ends`）**: 向かい合う端のずれが 0 より大きく ε 以下のまま残った辺（どちらの端も動かせなかった。両端が他の辺と点を共有する、相手の線が辺の範囲を外れる、動かす先に他の端がある）に 1 件。メッセージはずれ（pt）と、結果が「その幅の段差」「その幅の S 字」「端の周りの回り道」のどれかを述べる。hint は「両端を同じ位置に（同じ長さの辺に同じ anchor の比、または anchor なし）、または片方に自分の点を与えて動かせるようにする」。
  - **warning にする**: 一周は交差を生み見た目を壊す（info の `edge-crossing` だけでは原因が分からない）。段差・S 字の場合も、ずれが線幅以下で意図した形ではない。作者の YAML で直せる（anchor の比を揃える）。リポジトリの図では出ない。
  - **新しい経路は作らない（判断）**: 共有の口ごと動かす案は、同じ点の他の辺の揃いを崩しうる（それを避ける条件と反復が要る）ので採らなかった。両端が共有で ε 以下にずれる図は、同じ点に複数の辺を anchor で書いた場合にほぼ限られる。
- **検査の精度（判断）**: `checkRoutes` の `malformed`（同じ点の繰り返し・一直線上の 3 点）は、Layout IR の精度の半分（0.0005 unit）で比べる。従来の 0.01 unit では、ルータが別の格子線に引いた 0.001〜0.01 unit 幅の段差・S 字を「繰り返し」「折り返し」と誤って報告した（レビューの指摘）。他の比較（直交・端の位置・ノードの通過）は 0.01 のまま。
  - room（§6.22 #116）はそのまま。隙間が短いと room の端は送り元の箱の中に来るが、S 字が送り先の stub に入る曲がりに `ROUTE.arrowRoom` を払うだけで、選ぶ経路は変わらない。
- **結果（実測）**:

  | 対象 | 修正前 | 修正後 |
  | --- | --- | --- |
  | 再現、根の `gap` 40〜200mm（0.5mm 刻み 321 通り） | 21 通りで交差 4（43・50・58.5・67・…・170・…・194mm。約 8mm ごと） | 交差 0、⊕ の前後の 6 本がすべて直線、`checkRoutes` 0 件 |
  | 再現（49mm）、⊕ の anchor を 0.5〜2 unit ずらす | 一周（約 209 unit、交差 2） | 直線 |
  | 同、2.5〜10 unit | S 字（24.5〜35.3 unit） | 同じ |
  | 試作 P1 の 4 桁の anchor（§5.1）: C 7 本 / B 5 本 / ViT 9 本 | 5/7（一周 2）/ 3/5 / 1/9 がまっすぐ | 7/7 / 5/5 / 9/9 |
  | 図 C の Encoder → Refiner の anchor を 0.001・0.035・0.5・±0.8・1・1.5 unit ずらす（3・5 回目と同じずれ） | 5 本とも一周（交差 3〜5） | 5 本とも直線、交差 0 |
  | 同、3 unit | S 字 | 同じ |
  | 再現の Input Tokens → Concatenate（`south:0.3`、ずれ 15.7 unit） | ラベルの周りを一周 | S 字（修正 2 の列） |

- **互換性（実測）**: リポジトリの structured の `*.sumi.yaml` 41 図（examples・tests/fixtures・research）の Layout IR と SVG を前後で sha256 で比べ、変わったのは research の 5 図だけ。作例・fixture・ギャラリー・golden（`CI=1 bun test`、`bun run gallery:check`）は無変更。変わった図はすべて描いて拡大して見た:
  - `research/167-stage-c/repro/operator-loop`: 一周 4 本と、0.001 unit の段差 3 本（junction の前後）が直線に、Input Tokens・Conditioning を一周していた 2 本が S 字に（改善）。
  - `research/151-dogfood-v0.5/figures/vit-input`（0.006〜0.128 unit の段差 11 本）、`serving-architecture`（0.008 unit 1 本）、`repro/align-grows-figure`（junction への 0.006 unit 1 本）: 直線になる。画素の差は 0〜26 個で見た目は同じ。
  - `research/167-stage-c/figures/b-dit`: Linear and Reshape → Noise / Σ の 2 本（ずれ 74 unit、隙間 14.2 unit）が修正前から S 字で、足した行と列で S 字の戻りの行が送り先の stub の端（Linear の上辺から 2.2 unit。修正前は 1.1 unit）、列が中間に変わった。形は同じで、見た目は同等。
  - `port-sides.test.ts` の fan-in の分散（§6.33）の例: 1/4・3/4 の口が送り元の中心から 1.323 unit ずれており、分散した送り先の端（anchor ではない）が送り元の中心の線へ動いて直線になる（修正前は 1.323 unit の段差）。テストの期待をそのように直した。
- **限界**: ずれが ε を超え、間の列が別の箱や線で塞がれている場合は従来どおり回り道になり得る（S 字の列は 1 本だけ足す）。両端が共有で 0.001 unit ずれた辺は一周のまま（warning）。段差を ε 以内の移動で直すのは向かい合う口と junction だけで、L 字の端（直角の 2 辺）は対象外（ずれても回り道にならない）。
- **テスト**: `router.test.ts`（再現を 40〜200mm の 0.5mm 刻みで描いて交差 0・6 本が直線・`checkRoutes` 0 件、50mm で下限の検証。4 方向（stack の下・上、row の右・左）で隙間 2mm、送り先の anchor を 0.001・0.035・0.8・2 unit ずらすと送り元が動いて直線、2.5・3・6・20 unit で S 字（点 6 つ、長さ = 隙間 + 2 ×（lane の和 − 隙間）+ ずれ）と下限の検証。fan-in で共有の口は動かず、anchor の送り元が動く。両端 anchor で送り先が動き、`checkRoutes` はその直線を許すが、両端を横に 1 unit ずらした直線（揃った直線も）、2.5 unit 離れた直線、ε 以内でも直線でない経路は報告する。両端が共有の辺（同じ点に anchor した 2 本）: 短い隙間で 0.001 unit は一周と warning、0.002・0.01・0.5・2 unit は S 字と warning、2.5 unit は S 字で warning なし、広い隙間の 0.001・0.005 unit は細い段差と warning、いずれも `checkRoutes` 0 件と下限の検証。レビューの再現（共有の口に別の箱への辺）で warning 1 件。`tightJog` の単体（列と行、揃っている・段差が入る・後ろ・向かい合わない・junction で undefined））。修正 1 を外すと（ε = 0）20 件、修正 2 を外すと S 字の 16 件が失敗する。

### 6.41 #170 の辺のラベルの背景をその下の塗りにする

#167 の調査の R2（`docs/research/167-stage-c.md` §3.2、図 B の B-7）。structured の辺のラベルの背景は辺のスタイルの `fill`（#31、組み込みの Theme ではすべて白）で描いていたので、塗りのある group の上では白い四角になった（[`detail-label-halo.png`](../../research/167-stage-c/previews/detail-label-halo.png)）。背景を、ラベルの下に実際に塗られている色にする。

- **色の決め方（判断）**: 図の背景（キャンバス。writer が最初に描く白の `<rect>`、`CANVAS_FILL`）から始め、ラベルの箱の中心を含む group を描く順（前順。外側が先）に重ねる（`labelBackground()`、`src/render/structured.ts`）。`transparent` の group と不透明度 0 の group は飛ばす。規則はあくまで**描く順の合成**（画家のアルゴリズムをその 1 点で行う）で、「内側から外側へたどって最初に塗られている色、なければキャンバス」はその略記にすぎない。略記が合成と一致するのは、中心を含む group が入れ子の祖先だけで（重なる兄弟がない）、塗りのある group が不透明な場合に限る。重なる兄弟の group では後に描かれたほうが上（入れ子の深さではない）、半透明の group は下の色との合成になり、どちらも合成の規則のとおりに決まる。**`transparent` は返さない**: 背景は下を走るもの（線）を隠すためにあり（#31）、透明では目的を失う。
- **不透明度**: group の `opacity` が 1 未満なら、その塗りを下の色に `opacity` で合成した色（`#rrggbb`）にする。SVG の `<g opacity>` が塗りを下に重ねるのと同じ結果になる。1 のときは Theme の色の文字列をそのまま使う（`#rgb` も変えない）。
- **境界をまたぐ箱（判断: 中心で決める）**: ラベルの箱が group の枠をまたぐときは、箱の中心がある側の色にする（中心が枠の上ちょうどなら group の内側とみなす）。またぐこと自体は `geometry/label-collision`（#116）が報告し、ラベルは配置の段で枠を避けて置かれる（§6.22）ので、またぐのは避けられなかった場合だけ。面積の大きい側や、またぐ部分ごとに色を分ける案は採らなかった: 前者は中心とほぼ同じ結果で計算が増え、後者は背景が 2 色になり、どちらでも枠線は背景に隠れる（lint が報告する不具合のまま）。group の判定は矩形で、角の丸め（`radius`）の外の角は内側とみなす（角の丸めの範囲にラベルの中心が来ることは配置上まずない）。
- **node は見ない（判断）**: 辺のラベルは配置の段で node の箱を避けて置かれ、避けられずに node に重なったラベルは `label-collision` が報告する。node の形（円・ひし形・アイコン・画像）ごとに下の色を決めても、重なりという不具合は直らないので、node の塗りは背景の色に使わない（重なったラベルは、その下の group かキャンバスの色の背景で読める）。
- **edge の `fill` の意味**: structured では `transparent` かどうか（背景を描くか）だけを決め、色は使わない。組み込みの Theme の edge の `fill` はすべて白（= キャンバス）なので、group の外のラベルは今までと同じ。Theme（今は組み込みのみ）で edge の `fill` を白以外にした場合は、structured ではその色が使われない（ラベルを色のチップにする用途は想定しない。必要になれば別のプロパティとして検討する）。auto（D2）は対象外（D2 が `style.fill` で描く。#170 の非対象。D2 の塗りの扱いを確かめてから別 Issue）。
- **編集可能 PPTX**: 辺のラベルの文字の箱の塗りを、SVG がそのラベルの `<text>` の直前に描く `<rect>` の `fill` から取る（`src/render/pptx/editable.ts`）。structured では上の色、D2 では辺の `fill` の角丸の矩形の色。D2 で「今までどおり白」なのは組み込みの Theme（edge の `fill` が白）の場合で、edge の `fill` が白以外なら、これまで常に白で書いていた箱がその色になる（SVG と同じ）。`<rect>` がない場合、D2 は線をマスクで隠しているので今までどおり白、structured（`fill: transparent`）は何も描かないので塗りなし（`<a:noFill/>`。これまでは白で SVG と食い違っていた）。PDF・画像方式の PPTX は SVG を描くので、そのまま同じになる。
- **変わった出力**: リポジトリの structured の図（`arrange` を持つ `*.sumi.yaml` 43 個のうち描画まで通る 41 個）を図の Theme と組み込みの 4 Theme で描いて（SVG 173、編集可能 PPTX 113。アイコン・画像のある図は編集可能 PPTX にならない）、変更の前後を sha256 で比べた。変わったのは、辺のラベルが塗りのある group の中にある図だけで、差はすべてラベルの背景の `fill` 属性（と、本文のハッシュから決まる図の id）だった。
  - golden: `examples/dit-block`（`color` の `surface` の上の α・γ 4 つ: `#ffffff` → `#f6f8fa`）の SVG・PDF・画像方式 PPTX の hash・編集可能 PPTX の slide XML 2 つ。拡大して、白い四角が消え、ラベルが group の塗りの上に読めることを確かめた。他のギャラリー・作例（auto の図、structured の `transformer`）は変わらない。
  - golden でない図: research の `serving-architecture`・`training-pipeline`・`seq2seq-attention`（#109・#124・#135・#151 の各版）、`b-dit`・`c-h3world`（#167）、`tests/fixtures/figures/lint/literal-newline.sumi.yaml` の `minimal`・`color`・`slides`（surface `#f6f8fa` / `#f2f2f2`、`b-dit` の灰色のパネルは `#e6e6e6` / `#e3e3e3`）。`academic` で変わったのは tone のある group を持つ `b-dit` だけで、既定の group（`transparent`）の中のラベルは白のまま。
- **テスト**: `structured.test.ts` の「edge label backgrounds (#170)」: 塗りのある group（`minimal` の surface）、tone のある group、透明な内側と色のある外側（`academic` の外側に tone）、透明な group だけの入れ子（`academic` の既定。キャンバスの白）、境界をまたぐ箱（#116 の再現。中心は枠の外なのでキャンバスの色）、中心がちょうど枠の上の箱（配置を動かして writer で描き直す。内側の色、0.001 unit 外ならキャンバス）、edge の `fill` が `transparent`（背景なし）と白以外（それでも下の色）の場合（Theme は組み込みのみなので、IR の edge のスタイルを変えて writer で描き直す）。各図で、編集可能 PPTX のラベルの塗りが SVG と同じことも検査する。`labelBackground()` の単体: 半透明の合成（複数の層、順序による違い、`#rgb`）、不透明度 0、重なる兄弟（描く順の後が上、順を逆にすると逆）、中心による境界の判定（両側と枠の上）、group の外。`editable.test.ts`: D2 の SVG（`decision-flow`）で、ラベルの `<rect>` の色（白・白以外）、`<rect>` がなくマスクがあれば白、どちらもなければ塗りなし。

### 6.42 #171 の矢じりの前の余地をグループの余白に取る

[調査 #167](../research/167-stage-c.md) の R3（§3.3）。

- **不具合**: 図 A（Transformer）の残差（`toAnchor: west` / `east` で Add & Norm に横から入る辺）が、`color` では group の枠から 4 unit（線の間 0.35mm、`geometry/edge-near-border` info ×5）を走った。`academic` では余白の中央。
- **原因**: 両端が同じグループの中にある端は、§6.22 の「グループの中の余白」のとおり余白（`arrowRoom()`）を持たず、口から stub（矢じりの長さ）だけまっすぐ進んで曲がる。矢じりの長さは `4 + 4 × 線幅` で、`academic`（0.5pt = 1 unit の線）は 8、`color`（1pt = 2 unit）は 12。paper の `groupPadding` は 8pt = 16 unit なので、曲がる位置は枠から `academic` で 8（ちょうど中央）、`color` で 4。テーマの違いは余白の値でも格子の線でもなく、**線幅で決まる矢じりの長さ**だけ（ルータは stub の手前では曲がれないので、格子やルータの側では枠から離せない）。
- **修正（判断: 配置エンジンがその側の余白を広げる）**: `placeStructured` は 1 回配置した後、`arrowheadPaddingDeficits`（`src/layout/route/padding.ts`）で、矢じりのある端（junction でない）のうち、もう一方の端も同じグループの中にあるものについて、口から前方のグループの枠までの距離が「stub（矢じりの長さ。clearance 以上）＋ clearance（3pt = 6 unit。`ROUTE.clearance` と同じ値をテストで確かめる）」に満たない分を数え、そのグループのその側の余白だけに足して配置し直す（`growPadding`。`align` があれば解き直す）。足りない分がなければ配置は 1 回で終わり、出力は今までと同じ。広げると口はその枠から離れるだけなので、普通は配置し直し 1 回（配置は計 2 回）で収まる。配置し直しは最大 3 回（配置は計 4 回）。
  - **`align` の予算（判断）**: 配置し直すたびに `align` を解き直すが、`MAX_ALIGN_LAYOUTS`（1000）は図ごとの上限のまま、各回の解き直しで共有する（残りを次の回の上限として渡し、使い切ったら配置し直さない）。`AlignStats.layouts` はすべての回の合計。ただし予算切れの `layout/align-search-limit` の文面に出る数は、その回に渡した残りの数になる。予算が尽きて不足が残る場合は、診断を出さずにその配置を使う（線は従来どおり枠の近くを通り、`edge-near-border` が報告する）。
  - **最も内側のグループだけ（判断）**: 両端を含むグループが入れ子なら、枠が最も近いグループだけを広げる。外のグループの余地はそれで一緒に増える。入れ子のグループが枠を共有する（余白 0 の Profile など）と距離が同じになるので、同点ならグループの木で最も深いものを選ぶ（文書順で先の外側を選ぶと、1 回に 1 段ずつしか内へ進まず、3 回で尽きて不足が残った。レビューで指摘）。
  - **端そのもののグループは除く（判断）**: 端がグループ自身（自己ループ `g → g` など）なら、口はそのグループの枠の上にあり、余白をいくら広げても枠からの距離は 0 のまま。広げても曲がりは動かないので、端の要素とその中のグループは対象にしない（外側のグループは対象。レビューで指摘: 除かないと、3 回ともグループが無駄に大きくなっていた）。
  - **必要な幅（判断）**: 曲がりから枠まで clearance（§6.22 で線と要素の間に取る値）。`color` では 16 → 18 unit（広げた側ごとに 2 unit = 0.35mm 図が広がる）で、曲がりは枠から 6 unit（線の間 2pt、lint の閾値 1.5pt を超える）。中央に置く案（矢じりの 2 倍 = 24 unit）は図 A の幅が 88.19mm になり paper-single（88mm）を超えたので採らない。余白（`arrowRoom()` + clearance = 26 unit）まで広げる案は `academic`（22 unit が必要）の図もすべて変わるので採らない。`academic` は 8 + 6 = 14 ≤ 16 で変わらない。
  - **ルータは変えない**: 余白が広がった後のルータの判断（余白なし、stub の先で曲がる）は §6.22 のまま。`arrowheadLength()` は配置エンジンから循環せずに使えるよう `src/layout/route/arrowhead.ts` に移した（`router.ts` から再 export。公開の名前は同じ）。
  - **YAML で余白を指定するフィールドは作らない**（Issue の非対象）。
- **互換性（実測。この PR の時点のリポジトリの図での結果）**: structured の図 43 本（`arrange` を持つ `*.sumi.yaml`）を、書かれたテーマと `minimal` / `academic` / `slides` / `color` の 5 通りで描いて SVG の sha256 を比べた（215 件。`slides` は paper の間隔では `layout/no-route` になる図が多く、その 42 件は前後とも描けない）。
  - 変わったのは 19 件で、いずれも残差を横から入れる Transformer 系の図（作例 `transformer`、fixture の `a-transformer` / `align-side-kv`、#86・#109・#124・#135・#167 の Transformer / seq2seq）の `minimal` / `color`（1pt の線）だけ。書かれたテーマで変わるのは #167 の図 A（`color`）だけ。
  - 変わった図はすべて `edge-near-border` が 5 → 0 になり、幅は 2〜4 unit 広がった（高さは同じ）。#124 の 2 図・fixture の `align-side-kv`・#135 の seq2seq では `edge-touches-label`（Decoder の見出し）も 1 → 0。
  - **lint の悪化が 1 件**: #135 の seq2seq を `color` / `minimal` に差し替えて描くと、幅が 87.3mm から 88.02mm になり、`geometry/exceeds-page-width`（error）が出る。書かれたテーマ（`academic`）では変わらず、テーマを差し替えた場合だけなので受け入れる。
  - これらの図の範囲では、`academic` の出力・作例・golden（`CI=1 bun test`、`bun run gallery:check`）は無変更。ただし `academic` でも、口から枠までが 14 unit に満たない形（余白の小さい Profile や、端がグループの枠に接する形）では余白が広がる。
- **テスト**: `padding.integration.test.ts`（#167 の図 A を `color` と `academic` で描き、encoder の西・decoder の東の余白が `color` だけ 18、反対側は 16、配置し直した後は不足 0、残差の曲がりが口から矢じりの長さ以上・枠から clearance 以上、`edge-on-border` / `edge-near-border` が 0。`BORDER_CLEARANCE` と `ROUTE.clearance` の一致。レビューの再現 2 件: グループの自己ループでグループの大きさが変わらないこと、余白 0 の Profile で 4 段の入れ子のグループが枠を共有する場合に最も内側だけが 18 unit 広がり不足が残らないこと（いずれも修正前は失敗する）。`align` のある図（`align-side-kv` を `color` で）で、配置し直した後の不足が 0、`AlignStats.layouts` が全回の合計で上限以下、上限を 1・2・5 にしても超えないこと）。

### 6.43 #192 の中を塗らない矢じりの内側をその下の塗りにする

PR #190（#170）のレビューで見つかった、§6.41 と同じ種類の問題。structured の中を塗らない矢じり（edge の `filled: false` の `triangle`・`arrow`・`diamond`・`circle`・`box`）は内側を `#ffffff` 固定で塗っていたので、塗りのある group の上では白い矢じりになった。内側を、矢じりの下に実際に塗られている色にする。

- **色の決め方**: §6.41 と同じ規則（キャンバスから始め、点を含む group を描く順に重ね、`transparent` と不透明度 0 は飛ばし、半透明は合成する）。規則を点についての関数 `backgroundAt()`（`src/render/structured.ts`）にし、辺のラベルの `labelBackground()` は箱の中心でそれを呼ぶ形に整理した（ラベルの結果は変わらない）。**透明にはしない**: 矢じりの内側の塗りは、下を通るもの（他の辺の線、またぐ group の枠線）を隠すためにあり、透明では中を塗らない矢じりの形が読めなくなる。
- **色を取る点（判断: 軸の中点という一貫した規則）**: 先端から矢じりの長さ（`arrowheadLength()`、ルータが空けておく長さ）の半分だけ線の向きと逆に戻った、軸の上の点。種類によらず同じ点で取る、と決めた規則であり、面積の大きい側を選ぶ規則ではない。`circle`・`box`・`diamond` では図形の中心と一致するが、`triangle`・`arrow` では一致しない（三角形の面積のうち先端と軸の中点のあいだにあるのは 25% だけで、重心は先端から長さの 2/3。矢じりが枠をまたがない限り、どの点で取っても同じ色になる）。先端で取らないのは、先端が node か group の枠の上にあるため: 先端では枠の上（内側とみなす）の色になり、group に入る辺では矢じりの本体が外にあるのに group の色になってしまう。
- **境界をまたぐ矢じり**: §6.41 の箱と同じく、中心がある側の色にする（中心がちょうど枠の上なら group の内側とみなす）。矢じりを 2 色に分けない理由も §6.41 と同じ（枠線は内側の塗りに隠れ、またぐこと自体は配置の問題）。group に入る辺（`to` が group）の矢じりは、先端が枠の上で本体は枠の外なので、外側の色になる。
- **node は見ない**: 矢じりはふつう指す node の枠の外にあり、先端が枠に触れるだけなので、node の塗りは使わない（§6.41 と同じ）。ただし junction（§6.22）の端点はその中心なので、junction に入る・出る矢じりは junction の点に重なりうる（外にあるとは限らない）。この場合も junction の塗りは見ず、その下の group かキャンバスの色にする（junction の点は 3×3 unit と矢じりより小さく、矢じりがその上に描かれる）。
- **辺の不透明度**: 矢じりは辺の `<g opacity>` の中に描かれるので、半透明の辺では内側の塗りも線と同じく下に合成される（ラベルの背景と同じ扱い）。
- **編集可能 PPTX（判断: 変えない）**: 矢じりは DrawingML の線端（`<a:headEnd>` / `<a:tailEnd>`）で書く（§6.17）。線端は種類と大きさだけを持ち、内側の色を指定できない（線の色で描かれる）。中を塗らない矢じりのうち書けるのは `arrow`（DrawingML の `arrow` は内側のない開いた矢印）だけで、他（`triangle`・`diamond`・`circle`・`box`）はこれまでどおり `pptx/unsupported-geometry` で書かない。どちらでも塗る内側がないので、合わせる色がない。中を塗らない `triangle` などを編集可能 PPTX に書くには、矢じりを別の図形として描く必要があり、#192 の範囲外とした。PDF・画像方式の PPTX は SVG を描くので、そのまま同じになる。
- **auto（D2）は対象外**: D2 の矢じりは D2 が `style.filled` から描く（§6.41 と同じく、#192 の非対象）。
- **変わった出力: なし**。組み込みの Theme の edge はすべて `filled: true` で（Theme は今は組み込みのみ）、YAML から中を塗らない矢じりは描かれない（`src/compiler/testing.ts` の IR のような、スタイルを直接変えた場合だけ）。リポジトリの `*.sumi.yaml` 113 個（描画まで通った図の SVG 358・編集可能 PPTX 293）（structured と auto）を図の Theme と組み込みの 4 Theme で描いて、SVG と編集可能 PPTX の slide XML を変更の前後で sha256 で比べ、すべて一致した。`bun run gallery:check` と PDF・PPTX・画像の golden も変わらない。中を塗らない矢じりの見た目は、IR の `filled` と矢じりの種類を変えて描き直した図（`minimal` の surface、`academic` の tone のある group、キャンバス）を PNG にして、5 種類とも内側が下の塗りになり、group の外では白のままであることを確かめた。
- **テスト**: `structured.test.ts` の「hollow arrowheads (#192)」: 中を塗らない 5 種類それぞれで、塗りのある group（`minimal` の surface）とその外のキャンバス、tone のある group、透明な内側と色のある外側、透明な group だけの入れ子（キャンバス）。境界をまたぐ矢じり（group の枠を矢じりの中心に動かして writer で描き直す。内側の色、0.001 unit 外ならキャンバス）。始点の矢じりと junction の端の矢じり（左右に並べた色の違う 2 つの group の間を横に走る辺。始点の矢じりは始点側の group、junction の中心に先端がある矢じりはその下の group の色。group の色を入れ替えると入れ替わる）。塗る矢じりは線の色のまま。編集可能 PPTX では中を塗らない `arrow` が開いた矢印の線端のまま。`backgroundAt()` の単体（枠の上、外、`labelBackground()` と一致）と、`drawArrowhead()` の色を取る点（中心が枠の上と 0.001 外）。描き直しの補助（`redraw()`）は、編集可能 PPTX が読む `elements` も変えた要素にするよう直した。

### 6.44 #172 の欧文のサンセリフ（フォントセットの `latin` / `latinBold`）

[#167 の調査](../research/167-stage-c.md) §10 Q6 の利用者の判断（2026-10-28）: 3 図の原図は欧文がサンセリフ（Helvetica 系・Arial・Avenir）で、今の Sumi は欧文も BIZ UDPGothic で描く。欧文用の OFL のサンセリフを同梱し、論文向けの Theme（#173）で使う。この Issue では同梱とフォントセットの slot までで、**既存の Theme・フォントセットの字形は変えない**（paper Theme は #173）。

- **候補の比較（実測。製品の cmap / hmtx reader で各 Regular を読んだ）**: 幅は「The quick brown fox jumps over the lazy dog」の advance の和（em）。記号は → ↑ ↔ − × ≤ ≥ ≈ … – — ‘ ’ “ ” • 等 18 字のうち持つ数。大きさは Regular + Bold の静的 TTF。

  | 書体（版） | 系統 | x-height | 幅（em） | 記号 | RFN | 大きさ（bytes） |
  | --- | --- | --- | --- | --- | --- | --- |
  | （参考）Arial | グロテスク | 0.519 | 19.79 | 18/18 | — | — |
  | **Inter 4.1** | ネオグロテスク（Helvetica 系） | 0.546 | 21.36 | 18/18 | なし | 832,068 |
  | Source Sans 3（3.052） | ヒューマニスト | 0.486 | 18.54 | 18/18 | "Source" | 859,372 |
  | IBM Plex Sans（1.1.0） | グロテスク（癖のある字形） | 0.516 | 19.87 | 18/18 | "Plex" | 401,372 |
  | Noto Sans（2.015、unhinted） | ヒューマニスト | 0.536 | 21.01 | 10/18 | なし | 862,740 |
  | Liberation Sans（2.1.5） | Arial と同じ幅のグロテスク | 0.528 | 19.79 | 18/18 | "Liberation" ほか | 825,168 |
  | （参考）BIZ UDPGothic | — | 0.541 | 24.77 | 18/18 | — | — |
  | （参考）STIX Two Text Italic | セリフ（数式の変数） | 0.467 | 18.15 | 10/18 | — | — |

  いずれも Latin-1・Latin Extended-A・ギリシャ文字を持ち、かなと漢字は持たない（Inter は U+00AD と U+0149 だけ欠ける）。

- **選んだもの（判断）: Inter 4.1 の静的 TTF（`extras/ttf/` の Inter-Regular / Inter-Bold）**。
  - 字形: 原図の Helvetica・Arial に最も近い系統（ネオグロテスク）。Source Sans 3・Noto Sans はヒューマニストで、論文の図の Helvetica の印象から離れる。IBM Plex Sans は `a` `t` `r` などの字形に癖がある。Liberation Sans は Arial と同じ幅で字形も最も近いが、下の RFN の問題がある。
  - 幅: Arial より 5〜10% 広く（`Encoder`・`Self-Attention`・数字など 6 つの見本で）、BIZ UDPGothic より約 14% 狭い。Sumi は計測した幅で箱を決める（§6.21）ので、幅は箱の大きさに効くだけで、はみ出しは起きない。
  - **RFN（Reserved Font Name）がない**: Sumi は SVG に `name` を保ったサブセットを埋め込み、PDF ではファミリー名を変えたコピー（`<family> Sumi Runs <n>`、§6.24 の #112）をエンジンに渡す。RFN のある書体（Liberation・Source Sans 3・IBM Plex Sans）では、名前を変えたコピーが RFN を含む名前になり、OFL の「改変版に RFN を使わない」との関係を議論しなければならない。Inter と Noto Sans にはその問題がない。Noto Sans は矢印・≤ ≥ 等を持たず（10/18）、それらが BIZ UDPGothic に戻って字形が混ざる。
  - STIX Two との並び: サンセリフの本文とセリフ（Times 系）の数式を並べるのは論文の図の慣習（Helvetica と Times / Computer Modern）と同じ。Inter の x-height（0.546）は STIX Two Text Italic（0.467）より大きく、数式の変数は相対的に小さく見える（Arial でも同じ傾向）。数式の大きさはこの Issue では変えない（paper Theme で必要なら #173 で検討する）。
  - 静的か可変か: 可変の `InterVariable.ttf`（879,708 bytes）は 1 本で Regular と Bold を兼ねるが、計測（`hmtx`）・SVG のサブセット（subsetter）・PDF（krilla）は既定のインスタンス（Regular）しか扱わず、Bold には `gvar` / `HVAR` の適用が要る。静的 2 本にした。光学サイズの `InterDisplay` は大きな見出し用なので、本文用の `Inter` を選んだ。
  - カーニング: Inter は `GPOS` のカーニングに頼る設計だが、Sumi の計測はカーニングなし（§6.5）。SVG のサブセットは `GSUB` / `GPOS` を落とし、PDF / 画像 PPTX には数式のフォントと同じく `GSUB` / `GPOS` を除いたコピーを渡す（`resolveSvgFonts()`）ので、どの出力も計測どおりの位置に描く。`AV` `To` の詰めがない分の見た目は、PDF を PNG にして確かめ、図のラベルの大きさでは許容できると判断した。

- **入手と固定**: <https://github.com/rsms/inter/releases/tag/v4.1>（タグのコミット `e3a3d4c57d5ecc01453a575621882a384c1995a3`）の `Inter-4.1.zip`（sha256 `9883fdd4…6b11e`）から `extras/ttf/Inter-Regular.ttf`・`Inter-Bold.ttf` と `LICENSE.txt`（`OFL.txt` として）を無改変で `assets/fonts/inter/` に置いた。ファイルの sha256 は `BUNDLED_FONT_SHA256` と `assets/fonts/inter/README.md` で固定し、`sumi doctor` と `release:build` が検査する（既存のフォントと同じ）。

- **slot（`src/core/theme/fonts.ts`）**: `FontSet` に任意の `latin`（regular の文字）と `latinBold`（bold の文字）を足した（`FONT_SLOTS` にも追加）。フォント class は `latin` / `latin-bold`（SVG の class は `text-latin` / `text-latin-bold`）で、`fontFileFor()` が `latin` → `latin`（なければ `regular`）、`latin-bold` → `latinBold`（なければ `bold`）を返す。計測・SVG のサブセット・幾何 lint・PDF・編集可能 PPTX はどれもフォント class から `fontFileFor()` でファイルを引くので、同じファイルを使う。
  - **新しいフォントセット `sumi/inter-biz-ud-gothic`**: 既定の `sumi/biz-ud-gothic` の全 slot に `latin` / `latinBold`（Inter）を足したもの。**既定のフォントセットには足さない**: 足すと組み込みの 4 Theme の図がすべて変わる（Issue の受け入れ条件）。組み込みの Theme は既定のフォントセットのまま（テストで確認）。paper Theme（#173）が `fonts: sumi/inter-biz-ud-gothic` を選ぶ。フォントセットの ID は SVG のメタデータ（`font-set`）に入り、PDF / PPTX はそこからフォントセットを引く。
  - **どの文字を Inter で描くか（判断: cmap だけで決める）**: structured の図で、regular / bold のラベルの文字（`$...$` の外と `\text{…}`）のうち、Inter の cmap にある文字はすべて Inter、ない文字（かな・漢字・全角の記号）はラベルのフォント（BIZ UDPGothic）で描く。数式の run（`math` / `math-italic`）は変えない。§6.24 の代替（ラベルのフォントになく `math` にある文字）はその後で、残った文字に効く。Unicode の範囲表は持たない（フォントが持つかどうかだけで決まり、字形の混ざりが最も少ない）。**判定は書記素クラスタ（基底文字と結合文字）ごと**（レビューで指摘）: レンダラはクラスタを 1 つのフォントで shaping するので、基底と結合文字を別のフォントにすると PDF で結合文字が消えた（`か` + U+0342 は `か` を BIZ、U+0342 を Inter にしていた）。クラスタ全体を Inter が持てば Inter、ラベルのフォントが持てばそれ、`math` が持てば `math`、どれも持たなければラベルのフォントのまま（`lint/missing-glyph` が欠ける文字を報告する）。制御文字と default-ignorable は字形が要らないので判定から除く。1 文字のクラスタでは §6.24 の文字ごとの規則と同じ。PDF のフォントのコピー（§6.24 の #112）も、自分のフォントにない（見える）文字を含むクラスタの文字はどのコピーにも足さない（足すと usvg がクラスタごとコピーの空白の字形で描き、クラスタが消えた）。字形の要らない文字（制御文字・異体字セレクタなどの default-ignorable）は run や lint と同じくこの判定から除く（除かないと、`漢` + U+E0100 のラベル全体が PDF で BIZ UDPGothic になった。再レビューで指摘）。空白・数字・句読点・ギリシャ文字・矢印・× も Inter になり、日本語の文の中の `“”` `…` `—` も Inter の（全角でない）字形になる。mono（BIZ UDGothic）と italic は対象外（`latinFontOf()` が `undefined`）。
  - **run（`labelRuns()`、`src/core/label/runs.ts`）**: `latin`（ラベルのフォント class → Latin の class）を受け取り、書記素クラスタごとに cmap を引いて run を分ける（上の規則）。**全部が Latin の 1 run のラベルは、そのフォントの普通のラベル**（`TextMetrics.font` が `latin`、`runs` なし。`<text class="text-latin">`）にする。日本語と混ざるラベルは run（`<tspan class="text-latin">`）になる。`latin` を渡さない（既定のフォントセットの）場合、1 文字のクラスタだけのラベルの結果は今までと同じで、変わるのは複数のコード ポイントからなるクラスタの一部をラベルのフォントが持たないラベルだけ（下の互換性）。
  - **D2（`auto`）には渡さない**: D2 はラベルを 1 つの書体で描くので、`latin` を持つフォントセットでも `auto` の図は今までどおり BIZ UDPGothic で描く（8 つの `--font-*` は変えない）。`lint/missing-glyph` も `auto` では従来どおり。
  - **lint**: `lint/missing-glyph` は structured では描く run ごとに判定し、Latin の slot があればメッセージが「the regular, Latin and math fonts」になる。幾何 lint の既定のフォントセットを、Theme からではなく図の IR の `meta.fontSetId` から引くようにした（組み込みの Theme では同じもの。テストでフォントセットを差し替えた図も、描いたフォントで再計測する）。
  - **`sumi doctor`**: フォントセット間で同じファイルを共有するので、フォントの検査と幾何 lint の検査はファイルごとに 1 回にした（`details.files` は 7 件。`fontSet` / `slot` はそのファイルを最初に使うフォントセットと slot）。
- **usvg の空白の不具合の修正（`src/render/structured.ts` の `runContent()`。どのフォントセットにも効く）**: PDF にして確かめたところ、usvg（PDF・画像 PPTX のエンジン）は、テキストノードの直後の `<tspan>` の先頭の空白を落とす（`入力<tspan class="text-latin"> Embedding</tspan>` で、ブラウザでは空白があるが、PDF では「入力Embedding」になった。同じフォントの `<tspan>` でも、数式のフォントでも同じ。前の部分も `<tspan>` なら落とさない）。ラベルのフォントの run を書くとき、次の run が空白で始まる `<tspan>` なら、その run を属性のない `<tspan>` で包むようにした。Latin の run では普通に起きるが、**既定のフォントセットでも起きうる**（レビューで指摘: `a$_\text{ b}$` の添字の run は空白で始まる）ので、既存の Theme でもそのようなラベルの SVG のバイトは変わる（`a` がテキストノードから `<tspan>a</tspan>` になり、PDF で空白が描かれる）。下の比較の範囲の図にはこの形がなかった。
- **配布**: release の `share/sumi/fonts/inter/`、`licenses/inter/OFL.txt`、`NOTICE` の 5 項（著作権者・入手先）、配布物の `README.md` に追加し、smoke はライセンスの存在と `sumi doctor`（7 ファイルの sha256）を確かめる。SVG に埋め込むのは他のフォントと同じく `name` テーブルを保った TrueType のサブセットで、配布するフォントファイル自体は無改変。
- **大きさ（実測。darwin-arm64、`release:build`、`SOURCE_DATE_EPOCH` を揃えて main（d429e97）と比較）**: フォント 2 本で 832,068 bytes（gzip -9 で 398,677 bytes）。**tarball 52,710,136 → 53,119,861 bytes（+409,725、+0.39 MiB）、`bin/sumi` 69,126,242 → 69,126,242 bytes（±0。フォントはバイナリに埋め込まない）、展開後 +843,629 bytes**。main から作った tarball は v0.5.3 のリリースの tarball と同じ大きさだった。
- **互換性（実測。リポジトリの図の範囲）**: 既定のフォントセットでも出力が変わりうるのは、上の 2 つの修正に当たるラベルだけ（空白で始まる添字などの run がテキストノードの後に続くラベルと、複数のコード ポイントからなるクラスタの一部をラベルのフォントが持たないラベル）。`CI=1 bun test`（PDF・画像 PPTX・編集可能 PPTX・画像の golden を含む）、`bun run gallery:check` は無変更で通る。リポジトリの `*.sumi.yaml` 114 個を図の Theme と組み込みの 4 Theme で描き、SVG・PDF・編集可能 PPTX の sha256 を main と比べてすべて一致した（描画まで通った SVG 363・PDF 363・編集可能 PPTX 298。570 通り。#178・#179 を取り込んだ main と比較）。release の smoke が書く PDF・PPTX の sha256 も main の tarball と同じ。
- **テスト**:
  - `src/core/label/runs.test.ts`: 全部が Latin のラベルは Latin の class の普通のラベル（regular と bold）、日本語と混ざるラベルの run、Latin のない文字・mono・`latin` なしでは今までどおり、数式の run と §6.24 の代替はそのまま、書記素クラスタを分けないこと（Latin のフォントにない結合文字、`math` だけが持つクラスタ、どれも持たないクラスタ）。
  - 書記素クラスタの PDF の回帰（`latin-font.test.ts`）: `か` + U+0342（結合文字は Inter だけが持ち、基底は Inter にない）は BIZ UDPGothic の 1 クラスタで描かれ（空白の字形にならない）、`lint/missing-glyph` が U+0342 を報告する。`e` + U+0301 は Inter で、計測どおりの幅。
  - 異体字セレクタの回帰（`latin-font.test.ts`）: `漢` + U+E0100（BIZ UDPGothic が持たないセレクタ）と ` test` のラベルで、PDF の `漢` は BIZ UDPGothic、` test` は Inter で計測どおりの位置。
  - 空白の回帰（既定のフォントセット）: `a$_\text{ b}$` の SVG が `<tspan>a</tspan>` になり、PDF で `b` が空白の後の計測どおりの位置に描かれる。
  - `src/layout/text.test.ts`: 既定のフォントセットの計測器は Latin の class を持たず、`sumi/inter-biz-ud-gothic` では Inter の幅と縦の寸法で計測する。
  - `src/render/latin-font.test.ts`（端から端まで。#173 の Theme がないので、コンパイルした図のフォントセットだけを差し替えて `renderCompiledFigure()` で描く）: 計測（Inter の幅、group の見出しは Inter Bold、混ざるラベルの run、数式）、SVG の `@font-face` が Inter のサブセット、幾何 lint の再計測が配置と一致し指摘なし、PDF のフォントが Inter-Regular / Inter-Bold / BIZ UDPGothic / STIX Two で、各文字列の幅と、混ざるラベルの各字の位置（空白を含む）が計測どおり、画像方式と編集可能 PPTX（`typeface="Inter"`）、`lint/missing-glyph`、既定のフォントセットでは Inter を使わず Theme で描いた図とバイト単位で同じ。
  - `theme.test.ts`（フォントセットの一覧、組み込みの Theme はすべて既定のフォントセット、sha256 と README）、`cli.test.ts`（`sumi doctor` のファイル数）。
- **非対象**: paper Theme（#173）、日本語のフォントの変更、利用者が任意のフォントを指定すること、欧文の italic（Inter Italic は同梱しない。BIZ UD に italic がないので `italic: true` は従来どおり `theme/missing-font`）。

### 6.45 #176 の拡大の引き出し線（`component: zoom`）

#167 の調査（`docs/research/167-stage-c.md` §4.3、図 B の B-4・図 C の C-10）。DiT（Fig. 3 の DiT Block → adaLN のパネル）と H3-World（(b) の Attention → (c)）は、ブロックからそれを拡大したパネルへ、対応する角どうしを結ぶ斜めの破線 2 本を引く。これまでは `fromAnchor: "east:0"` → `toAnchor: "west:0"` の `line` 2 本で代用し、直交の折れ線になっていた（下の 1 本はパネルの枠に重なる）。経路探索をしない部品として足す。

- **構文（判断: edge の部品）**: `{ from: dit-block, to: adaln, component: zoom }`。`sumi/zoom`（edge、`since: 0.6.0`、props なし）。variant は `default`（破線）・`solid`（実線）・`muted`（破線・薄い色）。既存の `arrow` / `line` / `double-arrow` と同じく、線の描き方を部品で選ぶ。edge のフィールド（`zoom: true` など）にしなかったのは、Theme が部品ごとに線種を持て（既定を破線にできる）、`sumi catalog` とギャラリーにそのまま出て、Figure Schema（v1）を変えずに済むため。manifest には `routing: "zoom"` を足す（省略は経路探索する辺。カタログの JSON にも出る）。`routing: "zoom"` の manifest は `direction: "none"`（矢じりなし）かつ `engines: ["structured"]` でなければ登録できない（`component/invalid-manifest`）。
- **角の組（規則）**: 送り元と拡大先の箱（node・group の `rect`）の位置関係で辺を決める。
  - 右（拡大先の左端 ≥ 送り元の右端）: 送り元の右上 → 拡大先の左上、右下 → 左下。
  - 左: 左上 → 右上、左下 → 右下。下（拡大先の上端 ≥ 送り元の下端）: 左下 → 左上、右下 → 右上。上: 左上 → 左下、右上 → 右下。
  - 両方の軸で離れている（斜め）ときは、隙間の大きい軸で決める（同じなら横）。中心の向きではなく隙間で決めるのは、小さいブロックから大きなパネルへの拡大で、パネルが上下に大きくはみ出しても「右」になるため（中心の差では縦が勝ちうる）。
  - 1 本目は上（左右のとき）か左（上下のとき）の線。junction（点）の端は 4 つの角がその中心。
  - 両方の軸で重なる箱（要素とそれを含む group、自分自身）には辺がないので `layout/no-route`（error、他の辺の no-route と同じ形の文）。
  - 選んだ角の線は、2 つの箱の間を単調に進むので、端の角を除いて両方の箱の外にある（自分の端の中は通らない）。
  - 円・ひし形などの端も外接矩形の角を使う（角の丸めがある箱でも同じ）。図形の輪郭の上の点にはしない（拡大の対応は箱の範囲を示すため）。
- **Layout IR**: `EdgeRoute.lines`（2 本の `[Point, Point]`）を足し、`points` は 1 本目とする。`net` を省略可にし、zoom の辺には付けない（どのネットにも属さない）。他の消費者が `points` だけを見ても壊れない形にした。
- **ルータ（判断: 経路探索の前に外し、後で足す）**: `routeEdges()` は zoom の辺を Figure IR と Layout IR から外して今までどおり経路を探し、結果（ルータが内容を動かしたあとの箱）から zoom の線を足す。group の余白の矢じりの余地（§6.42、`arrowheadPaddingDeficits()`）も zoom の辺を外して端を決める。したがって **他の辺の経路・ネット・交差の報告（`layout/edge-crossing`）・ラベルの位置と `layout/edge-label-overlap` は、zoom の辺がない場合とまったく同じ**（テストで確かめる）。zoom の線は他の線と交差してよく、交差として報告しない（直交の線どうしの交差の規則は斜めの線に意味がない）。キャンバスは広げない（線は 2 つの箱の範囲に収まる）。`checkRoutes()`（テスト用の検査）は zoom の辺を直交・端・ネット・交差の検査から外し、2 本の線が上の規則の角を結ぶことだけを見る（`zoomMisses`）。
- **描画**: SVG は §6.23 の約束どおり、辺ごとに 1 つの `path.connection`（2 本を 2 つの subpath `M … L … M … L …` で）に経路を持ち、線は zoom の辺ごとの `path.sumi-wire`（線の色・幅・破線は Theme の edge のスタイル）で描く。ネットの線より前（下）に描く。矢じり・ラベルはない。幾何 lint が測る「描いた線」（`SvgInspection.painted`、§6.39）は 2 本の線。PDF と画像方式の PPTX は SVG から作るのでそのまま描かれる。**編集可能 PPTX（判断: 対応）**: freeform では他の辺と同じく `path.connection` から custGeom（`moveTo` 2 つ）を書く。glued でも zoom の辺は freeform の図形にする（2 本の線は図形の接続点どうしを結ぶ 1 本のコネクタにならない。`p:cxnSp` にすると誤った線になる）。SVG と同じく経路探索した辺の下に描くため、zoom の図形は最初の経路探索した辺の図形の直前に書く（文書順で後にあっても）。
- **診断**:
  - auto の図では、manifest の `engines` から既存の `layout/structured-only`（error）。
  - ラベルは `component/unexpected-label`（error。operator・junction・image と同じ）。
  - `fromAnchor` / `toAnchor` は効かないので `component/anchor-on-zoom`（warning、§6.38 の `component/anchor-on-junction` と同じ形）。
  - 幾何 lint に `geometry/zoom-crosses-node`（warning）を足す: zoom の線が、端でないノードの図形（`edge-through-node` と同じ凸の衝突領域・許容 1 unit）を通る。zoom の辺は `geometry/edge-through-node` の対象から外す（同じことを 2 度報告しない。hint も違う: 曲げずに、ノードか拡大元・拡大先を動かす）。研究メモの案の名前を採った。
  - `edge-crosses-label`・`edge-touches-label`（文字との干渉）はそのまま掛かる。zoom の辺への指摘では、これらと近接の規則の hint は `fromAnchor` / `toAnchor` を勧めず（効かないため）、拡大元・拡大先の位置やラベル（group の見出しの `labelAt` など）を動かすよう勧める。平行な線の近接（`edge-on-border` / `edge-near-border` / `edge-near-edge`）は軸に平行な部分だけを測るので、斜めの線は対象にならない（角が横・縦に揃って軸に平行になった場合だけ測る）。
- **非対象**: 曲線、auto（D2）、ラベル、角の組の手動指定（Issue の非対象。角の組は配置の木で拡大先を置く側を変えて選ぶ）。凡例の見本線（`legend` の `edge: { component: zoom }`）は、見本の 2 つの junction の中心どうしを結ぶので 2 本が重なった 1 本の破線になり、zoom の線種の説明に使える（禁止しない）。
- **互換性**: 新しい部品だけで、既存の図の出力は変わらない。リポジトリの追跡済みの `*.sumi.yaml` 113 個を、図の Theme と組み込みの 4 Theme で、変更前（`d429e97`）と変更後のコードで描き（565 回。描画まで通った SVG 358・編集可能 PPTX 293、通らない 207 は同じ error code）、D2 ソース・SVG・PDF・画像方式の PPTX・編集可能 PPTX（freeform・glued）・診断の sha256 がすべて一致した。`bun run gallery:check`、PDF・PPTX の golden は既存の項目が変わらず、ギャラリーの `sumi-zoom` 4 図と、その PDF・画像方式 PPTX・編集可能 PPTX の golden を足した。診断の hint のうち、edge の部品を列挙する文（`component/wrong-kind` / `component/unknown`）には `zoom` が加わる。
- **検証**: `research/176-zoom-edge/figures/` に、#167 の図 B（DiT）と図 C（H3-World）の写しを置き、代用の破線 2 本を `component: zoom` の 1 本に書き換えた（他は同じ。#167 の記録のファイルは変えない）。zoom の辺についての診断は 0 件で、図全体の診断（B: `geometry/exceeds-page-width` 1、C: それに `lint/empty-label` 90）は元の図と同じ（`src/render/zoom.integration.test.ts`）。
- **テスト**: `src/layout/route/zoom.test.ts`（4 方向の角の組、接する箱、斜めの配置と同点、重なる箱、junction の端、Layout IR の線とネットなし、`checkRoutes` が空、zoom の辺がある図とない図で他の辺の経路・キャンバス・ノードが同じ、交差する zoom の線が `layout/edge-crossing` にならない、重なる端の `layout/no-route`、ラベルと anchor の診断、auto の `layout/structured-only`）、`src/render/zoom.integration.test.ts`（SVG の `path.connection` と破線の wire、`solid`、`geometry/zoom-crosses-node` と `edge-through-node` が出ないこと、PDF・画像方式 PPTX・編集可能 PPTX の両方式、research の 2 図）、`registry.test.ts`（manifest の制約）。全部品 × 全 variant × 全 Theme の描画テスト（`structuredPrimitivesFigure()`）にも zoom を足した。


### 6.46 #178 の ±90° 回転したラベル（`nodes[].labelRotation`）

段階 C（[#167 の調査](../research/167-stage-c.md) §4.7、試作 P2）。H3-World の「Visual VAE Encoder」（縦長の箱）と「Query」（軸のラベル）は 90° 回転した文字。Figure v1 への任意フィールドの追加で、**`labelRotation` を書かない図**の診断・IR・Layout IR・D2・SVG・PDF・PPTX はバイト単位で変わらない。

- **フィールド**: `nodes[].labelRotation`: `90` または `-90`（数値。`"90"`・`45`・`180`・`0` は `schema/invalid-value`）。角度は SVG の `rotate()` と同じく**正が時計回り**（y 下向き）: `-90` は下から上へ読む（H3-World の向き）、`90` は上から下へ読む。#86 §5.1 の判断どおり ±90° に限り、縦組みは非対象。`fmt --canonical-order` では `label` の直後。
- **対象（判断: ノードだけ）**: ノード（`label` 部品を含む）にだけ置く。group と edge のスキーマには足さない（書けば `schema/unknown-field`）。理由: group の見出しは上下の帯（§6.21・§6.27、高さはラベルの高さ）に置く設計で、回転した見出しには左右の帯という別の配置が要る。edge のラベルはルータが線分の横に水平な箱として置く（§6.30）前提で、回転した箱の置き方は別に設計が要る。H3-World の 2 つはどちらもノード（箱と `label` 部品）で足りる。
- **診断**:
  - auto では `layout/structured-only`（`layout` 段、ノードは無効）。D2 にラベルを回す手段がないため。
  - アイコン（`icon`）・mark（`operator`・`junction`）・画像（`image`）のノードと `legend` では `component/label-rotation-unsupported`（error、`labelRotation` の位置）。回す文字がない（legend の見出しは項目の上に置く）。
  - ラベルが省略・空・空白だけなら `component/label-rotation-without-label`（warning。`component/label-at-without-label`（§6.27）と同じ考え方で、ノードは有効なまま）。
- **計測と配置（structured）**: `measureText()` は回転前の文字を測る（変更なし）。ノードの大きさ（`nodeSize()`）には幅と高さを入れ替えた箱を渡すので、`label` 部品は縦長に、箱は文字に合わせて細く高くなり、明示の `width` / `height` も従来どおり優先する。`placeText()` は回転を受け取り、Layout IR の `TextLayout` に `rotation` を記録する。`box` は**回転後の箱**（同じ中心で幅と高さを入れ替え。ルータの障害物・図の範囲・ラベルの重なりの検査はこれを使う）、`anchor` は**回転前の枠での**位置（`<text>` の `x` / `y`）。中心はラベルの中心（`nodeLabelCenter()`）のまま。
- **SVG の writer**: 回転したラベルの `<text>` に `transform="rotate(±90 cx cy)"`（`cx cy` は `box` の中心）を足す。複数行の `<tspan>` と数式の run（§6.24・§6.29）は回転前の枠のまま書き、`<text>` ごと回す。回転のないラベルには属性を足さないので出力は変わらない。
- **inspect の契約（§6.3 の拡張）**: `<text>` の `transform` は、**ちょうど `rotate(90 cx cy)` か `rotate(-90 cx cy)`**（SVG の transform の文法どおり: 空白は SVG の空白（空白・タブ・CR・LF。`\s` と違い U+00A0 などは含まない）、数の区切りは空白かカンマ（comma-wsp）、数は共通の `parseNumber()` と同じ文法（符号・末尾の小数点・`9e1` のような指数を受け付ける）、前後の空白は可）だけを読む。他の角度・`rotate(90)`（中心なし）・`scale` / `translate` / `matrix`・複数の変換は従来どおり `svg/unsupported-geometry`（メッセージは「`<text> has a transform other than rotate(90 cx cy) or rotate(-90 cx cy)`」）。`LabelGeometry.rotation = { degrees, center }` を返し、他のフィールド（`anchor`・行・run）は回転前の枠のまま。要素の `<g>`・shape・接続の path の `transform` は従来どおり拒否する。固定版 D2 は `<text>` に `transform` を書かないので、auto の SVG の読み取りは変わらない。
- **幾何 lint**: `measureLabel()` は回転前の枠で従来どおり測り、行・見える行・全体・run の箱をすべて回転の中心のまわりに回す（`turnRect()`。±90° では軸に平行な箱は軸に平行な箱のままなので正確）。`inkLines()`（§6.39 のグリフの輪郭）は行を回転前に戻して輪郭を求め、また回す。これで `label-overflow`・`label-collision`・`edge-crosses-label`・`edge-touches-label`・`out-of-canvas` が回転後の箱で働く。
- **複数行・数式（判断: 対応する）**: 回転前の枠では普通のラベルと同じなので、改行・数式（添字・アクセント）もそのまま回る。診断で止める理由がない。
- **PDF**: PDF エンジン（usvg / krilla）は回転した `<text>` を文字として描く。試作 P2 と同じく、文字は抽出でき（ToUnicode）、フォントは埋め込みの CIDFontType2（Type 3 なし）。テストでは「Query」のグリフが同じ x に並び、y が増える（PDF の y は上向き）ことも確かめる。
- **画像方式の PPTX**: SVG を描くので追加の処理はない。
- **編集可能 PPTX（判断: 別の text box を `rot` で回す）**: 回転したラベルは、ノードの図形の `txBody` ではなく、図形の直後に置く**独立した text box**（名前 `<key> label`、塗り・線なし）にし、DrawingML の `<a:xfrm rot>`（時計回り、1/60000 度。`90` → `5400000`、`-90` → `16200000`）で回す。text box は回転前のラベルの箱を、SVG の回転の中心に中心が来るよう左右・上下に対称に広げたもの（DrawingML は図形をその中心で回すので、中心を合わせれば SVG と同じ位置になる）。中の段落と余白は回転していないラベルと同じ方法（§6.17）で書く。ノードの図形を回さないのは、図形の形（custom geometry）も回ってしまうため。`bodyPr vert="vert270"`（#167 の案）を採らなかったのは、回転後の枠での余白と中央寄せの解釈が PowerPoint の実装に依存し、位置を SVG と合わせる根拠が持てないため。代償として、文字はノードと別の図形になり、ノードを動かしても付いてこない（辺のラベルと同じ）。固定版 Open XML SDK の検証は通る（CI の PPTX ジョブと同じ validator を手元で実行）。PowerPoint での見た目は未確認。
- **auto（D2）は対象外**: 上の `layout/structured-only` のとおり。
- **変わった出力: なし**。リポジトリの `*.sumi.yaml` 113 個（描画まで通る 77 個、残りは不正な fixture の診断）を変更の前（`git archive HEAD`）と後で描き、SVG・PDF・画像方式の PPTX・編集可能 PPTX（freeform・glued）の sha256 と診断の code がすべて一致した。`CI=1 bun test`（D2・Layout IR・PDF・PPTX の golden を含む）、`bun run gallery:check`、`bun run schema:check` も通る（JSON Schema は `labelRotation` の追加だけ）。
- **テスト**: `layout.test.ts`（auto の `layout/structured-only`、90 / -90 以外の値）、`resolve.test.ts`（アイコン・`operator`・`junction`・`image`・`legend` の error、ラベルなしの warning）、`inspect.test.ts`（±90° と区切り・空白・数の書き方（指数を含む）を読む。他の変換、SVG の空白でない空白（U+00A0・U+3000・U+2003）、壊れた区切りや数は拒否）、`measure.test.ts`（`turnRect()` の向きと逆回転、回転したラベルの全部の箱と輪郭・run の箱）、`rotation.test.ts`（4 つの幾何 lint 規則が、回転前の箱と逆の判定をする組で回転後の箱を見る）、`label-rotation.integration.test.ts`（fixture `tests/fixtures/figures/layout/label-rotation.sumi.yaml`: 診断・幾何 lint 0 件、`<text>` の `transform` 4 つ、inspect の回転の中心が Layout IR の箱の中心、再計測した行が箱とノードの内側、回転しない場合との大きさの入れ替わり、`label-overflow` が回転後の箱で出る、PDF の抽出と字の並び、画像方式の PPTX、編集可能 PPTX の `rot`・中心・文字、さらに text box の位置と余白・行送りから回転前のアンカーと各行の上端を復元し、`rot` で回して SVG の行の箱（回転前・回転後）と一致すること（fixture は幅の違う 2 行のラベルと、アクセントと添字のある数式のラベルを含む）、auto の診断）。
- **非対象・引き継ぎ**: ±90° 以外の角度、縦組み（#178 の非対象）、group の見出しと edge のラベルの回転（上の判断）、編集可能 PPTX の PowerPoint 実機での確認。

### 6.47 #179 の相手の真上（真横）で入る端（`toAnchor: straight` / `fromAnchor: straight`）

[#167 の調査](../research/167-stage-c.md) の §4.4（#151 C1）。幅の広い箱へ並んだ送り元から入る線は、既定では受け手の中心（merge）か分散した位置（`fanIn: spread`）に入り、段差ができる。作者が手で `"south:0.3127"` を計算して書くと 4 桁の丸めでずれる（§6.40 の R1）。相手の中心の射影を router が配置の後に計算して端にする値を足す。**opt-in の値**で、既定の端の規則は変えない（利用者の判断 2026-10-28、§10 Q3）。

- **構文（判断: `straight` だけ、辺は書かない）**: `toAnchor: straight` / `fromAnchor: straight`。`south:straight` のように辺を書く形は採らない。まっすぐ入れる辺は、2 つの要素が離れている軸（1 つだけ）で決まり、向かい合う辺のほかにはない。辺を書くと、決まる辺と同じなら冗長、違えば矛盾（まっすぐにならない）で、検査する規則が増えるだけになる。既存の文法（`<side>` / `<side>:<0..1>`）と重ならない 1 語なので、`parseAnchor()` は `"straight"` を返し（`EdgeAnchor = Anchor | "straight"`）、`ANCHOR_PATTERN`（JSON Schema）にも加えた。大文字・`straight:0.5`・`south:straight` は `layout/invalid-anchor`。メッセージの期待する形と hint に `straight` を加え、`strait` などには `Did you mean "straight"?` が出る（誤った anchor の診断の文面だけが変わる。リポジトリの図・golden には出ない）。IR・Layout IR の `fromAnchor` / `toAnchor` は書いたとおり `"straight"` を持つ（解決した位置は経路の端の点にだけ現れる）。
- **辺と位置（`straightPlacement()`、`ports.ts`）**: 2 つの要素の外接矩形が y だけで離れていれば北 / 南、x だけなら東 / 西の、相手に向かう辺。位置は相手の中心の、その辺への射影（丸めない値の比。端点は他の端と同じく `anchorPoint` で 1/1000 unit に丸まる）。射影が辺の角から `STRAIGHT_MARGIN`（6 unit = 3pt、router の clearance と同じ）以上内側にあるときだけ採る（矢じりと線が角や隣の辺に掛からない。辺が 12 unit より短ければ中央だけ）。試作 P1 と同じ規則。
- **相手の端**: anchor のない相手の端（junction を除く）は、配置の木の辺（§6.33）ではなく `straight` の端に向かい合う辺を使う。配置の木の辺は多くの場合同じだが、`attach` などで別の辺になると、まっすぐの意味がなくなるため。相手の端の位置は従来どおり（中央、多重辺の振り分け、fan-in の分散）。
- **相手の口に揃える（判断）**: 相手の中心の射影は、相手の端が辺の中央にあるときの相手の口と同じ点。多重辺の振り分け（1/3・2/3）・分散（`fanIn: spread`）・#113 の分割で相手の口が中央から動くと、中心の射影では段差が残る。そこで、`straight` の端は、多重辺の振り分けの後に**相手の口の座標**へ揃える（相手が向かい合う辺にあり、その座標が自分の辺の余白の内側にある場合。そうでなければ中心の射影のまま）。相手が junction ならその中心、相手に anchor があればその点。座標をそのまま写すので、丸めの差もなく直線になる（P1 の 21 本はすべて点 2 つで、2 点の x（y）が完全に一致する）。
  - **多重辺**: `straight` の端も同じ 2 要素の間の振り分けに加える。`a → t` 2 本を両方 `straight` にすると、a の 1/3・2/3 の口の真下に 2 本の平行な直線（別のネット）になる。`a → t`（`straight`）と `t → a` の往復も、両方直線のまま並ぶ。
  - **相手の口が余白の外の平行な辺（レビューで修正）**: 幅の広い a から狭い t へ `straight` の 2 本を引くと、a の 1/3・2/3 の口は t の辺の外にある。最初の版は両方を中心の射影（同じ点）に戻したので、2 本が同じ点・同じネット・同じ矢じりに潰れ、#113・#143 の平行な辺の保護（分割の前後で比べる）も、潰れたのが分割の前なので働かなかった（診断なし）。振り分けた端（同じ辺・同じ組に 2 本以上）は、揃えられないとき**振り分けた位置のまま**にする（平行な辺は別の点のまま）。その辺は直線にならないので、router が `layout/straight-off-side`（下記の「揃えられない」の文面）を辺ごとに出す。`straight` は広い側の端に書く（`fromAnchor`）のが正しい使い方で、hint もそう示す。
  - **両端が `straight`**: 送り先の端が送り元の口（振り分けた位置。1 本なら送り元の中心）に揃い、送り元の端はそのまま。線は送り元の中心を通る（両端が解決できる場合）。片方だけ解決できなければ、解決した端が相手の既定の端に揃う。
  - **#113 の分割**: `straight` の端は anchor と同じく分割で動かされない（`anchored`）。分割が相手の端を動かした場合は、§6.22 の「一直線を保つ」の規則で `straight` の端も相手について動く（anchor の端は動かないという例外を `straight` の端だけ外す。動く先は余白の内側に限る）。再現: `u → a` が a の南の中央に anchor され、`a → t`（`straight`）の a の端が 1/4 に動くと、t の端も 1/4 の線へ動いて直線のまま。
- **同じ点に重なる 2 端（判断: anchor と同じ）**: 2 つの送り元の中心が受け手の辺の同じ座標にある（縦に並んだ 2 つの送り元）場合、2 つの端は同じ点・同じ向きの口になり、fan-in のネットとして合流する。同じ点に anchor を書いた 2 本と同じ扱いで、新しい規則は足さない。入りと出が同じ点になった場合は #113 の分割（`straight` の端は動かず、相手側が動く。両方が動かせなければ従来の `layout/no-route`）。
- **`fanIn: spread` との併用（判断: `straight` の端は分散しない）**: `straight` の端は位置を持つ端として、anchor の端と同じく分散の対象にせず、同じ辺の他の端（anchor のない端）がそれを避けて残りの位置に並ぶ（§6.33 の割り当て）。`straight` の端どうしが同じ点に来る場合は spread でも合流のまま（分散すると直線でなくなる）。解決できなかった `straight` の端は anchor のない端として分散の対象になる。送り元の `fromAnchor: straight` の相手（送り先の端）が分散で動いた場合は、上の「相手の口に揃える」でついていく。
- **#169 の `straighten()` との関係**: `straight` の端は anchor の端として扱い、ε（1pt）以内のずれは従来どおり直す。上のとおり座標を写すので、通常はずれが残らない。`checkRoutes` は `straight` の端について、解決できる場合に限り「向かい合う辺にあり、余白の内側にある（または 1 本の直線で、余白から `STRAIGHTEN_TOLERANCE` 以内。`straighten()` が動かせる範囲。レビューで、1 本の直線なら辺のどこでも通していたのを修正）」を検査する（位置そのものは相手の口に依るので問わない）。
- **診断 `layout/straight-off-side`（判断: warning）**: 解決した `straight` の端でも、端の解決の後に 2 つの端が一直線（`facing()` の横のずれが 0）でなければ、「揃えられない」（相手の口が辺の余白の外で、平行な辺が別の点を保つ、または別の辺の端が相手を動かした）として同じ code で報告する。向かい合う辺がない（斜めに離れている、重なる・一方が他方を含む、自己ループ）か、相手の中心の射影が辺の余白の外にある場合、その端は anchor のない端として解決し（既定の辺・振り分け・分散）、router が warning を出す（位置は `edges[i].toAnchor` / `fromAnchor`、メッセージは理由を区別、hint は「並べる（stack の上下・row の左右・`align`）、箱を広げる、辺の anchor を書く」）。図は描けて作者の意図と違うだけなので error にはしない（§6.38 の `component/anchor-on-junction` と同じ考え）。info にしないのは、作者が `straight` を書いて段差が残るのは見落としやすく、YAML で直せるため。junction の端は anchor を見ないので `component/anchor-on-junction` だけ（重ねて出さない）。射影は配置の後にしか分からないので、経路の段（router）の診断。
- **auto**: 他の anchor と同じく `layout/structured-only`（error、§6.19）。値によらず anchor のフィールドを報告する既存の規則のまま。
- **互換性（実測）**: リポジトリの `*.sumi.yaml` 113 個（structured 41・auto）を図の Theme と組み込みの 4 Theme で描いて（565 通り、描けたもの 358）、Layout IR・SVG・診断の sha256 を変更の前後で比べ、すべて一致した。`CI=1 bun test`（D2・PDF・PPTX の golden）と `bun run gallery:check` も無変更で通る。`straight` を書かない図の端の解決は、新しい分岐に入らない（`straight` の端・その相手の端だけが変わる）。
- **結果（実測、P1 の 3 図・21 本）**:

  | 図（辺の数） | anchor なし | `straight` |
  | --- | --- | --- |
  | #167 図 C（7。Refiner → A5 は `fromAnchor`、ほかは `toAnchor`） | 1/7 まっすぐ、折れ 24 | **7/7、折れ 0**、交差 0 |
  | #167 図 B（5） | 3/5、折れ 4 | **5/5、折れ 0**、交差 0 |
  | #151 ViT（9） | 0/9、折れ 28 | **9/9、折れ 0**、交差 0 |

  試作（§5.1 の「straight（正確）」）と同じ。Refiner → A5 は A5 が狭く Refiner の中心が A5 の辺の外にあるので、試作と同じく広い側（送り元）に `fromAnchor: straight` を書く。
- **テスト**: `straight.integration.test.ts`（P1 の 3 図の 21 本を YAML に `straight` を書いて描き、それぞれ点 2 つ・折れ 0・2 点の座標が完全一致、`straight-off-side` と `unaligned-ends` なし、`checkRoutes` 0 件、同じ配置で下限の検証（`verifyLowerBound`）。anchor を外すと同じ辺が折れること）、`straight.test.ts`（`straightPlacement()` の 4 方向・丸めない射影・余白の境界（6 unit ちょうど・その外・短い辺）・斜め・重なり・入れ子、送り先の 3 本が別の点・別のネットの直線（なしでは合流して折れる）、横の場合、Layout IR に `"straight"` が残ること、`fromAnchor` の広い送り元、分散した送り先の端に `fromAnchor` がついていくこと、`straight-off-side` の 3 つの理由・位置・文面と、経路が anchor なしと同じこと、自己ループの既定の角、junction の端は `anchor-on-junction` だけ、多重辺の平行な直線、往復、縦に並んだ 2 つの送り元の合流（merge・spread）、spread で他の端が `straight` の端を避けること、両端 `straight`、#113 の分割についていくこと、`checkRoutes` が別の辺の `straight` の端を報告すること）、`layout.test.ts`（`parseAnchor`、誤った形、`strait` の hint、メッセージ、auto の `layout/structured-only` の位置）。分割で相手についていく変更と振り分けへの参加を外すと、それぞれのテストが失敗することを確かめた。
- **非対象・引き継ぎ**: 既定の端の規則の変更（`straight` を anchor のない端の既定にするか。§10 Q3 で opt-in に決まった）。斜めの配置で 1 回曲げて入る端。相手の中心ではなく相手の辺との重なりの中央に揃える規則（両端 `straight` の別案）。

### 6.48 #183 の幅に合わせた縮小（`figure.fit: scale`）

#167 の調査（[§4.6・§10 Q1](../research/167-stage-c.md)）で、論文の原図の文字は印刷時 5〜6pt 程度で、Sumi の B（DiT、幅 257mm）・C（H3-World、232mm）は 180mm に縮めると文字が原図と同程度になると分かった。利用者の判断（2026-10-28）: 縮小を正式に認め、縮小後の実効の文字の下限は 5pt とする。これまでは幅超過の error を無視して LaTeX の `\includegraphics` で縮めるしかなく、Sumi は縮小後の文字を検査しなかった。配置は変えない（密度を上げる compact は #167 の別項目）。

- **構文（判断: `figure.fit`、`figure.layout.fit` ではない）**: `figure.fit: scale`。`figure.layout` は配置を決める欄（`engine`・`direction`・`arrange`・`align`・`fanIn`）で、そのうち 3 つは structured 専用。`fit` は配置を変えず、出力の物理的な大きさだけを変えるので、物理的な出力先を選ぶ `figure.profile` の隣に置く（両 engine 共通であることも、layout の下より伝わる）。値は列挙で今は `scale` だけ。省略は今までどおり自然な大きさ（0.5pt/unit）。任意フィールドの追加なので Figure v1 のまま（`requires: ">=0.6.0"` を書けば古い Sumi は `schema/unsatisfied-requires` で止まる）。
- **縮小率（判断: 幅だけで決め、拡大しない）**: s = min(1, `maxWidth` ÷ 自然な幅)。`maxWidth` のない Profile では何もしない。高さは縮小後の大きさで `geometry/exceeds-page-height` を検査し、はみ出せば今までどおり error（受け入れ条件）。高さにも合わせる（幅と高さの比の小さい方）案は採らない: 論文の図は幅をそろえて載せるもので、高さの超過は分割・配置で直す問題であり、黙って縮めると文字が予想外に小さくなる。
- **SVG（判断: 根の `width` / `height` だけを変える）**: viewBox と中の座標・文字の大きさはそのままで、根の `width` を `maxWidth`（paper-double なら `510.23622pt`）、`height` を同じ率で縮めた値にする（`finalizeSvg()` / `finalizeStructuredSvg()`、両 engine で共通の `finalizeDocument()`）。viewBox と `width` / `height` の比で縮めるのは SVG の標準の仕組みで、ブラウザ・LaTeX の取り込み・PDF エンジン（usvg）がそのまま扱う。包む `<g transform>` の案は採らない: inspect は根と描画の `<svg>` の transform を測れないものとして拒否する契約（§6）で、幾何 lint・編集可能 PPTX はすべて描画の座標で読む。縮小率を metadata に書く案も採らない: 根の `width` と viewBox の比で一意に分かり、属性を足すと metadata の形式が変わる。`fit` のない図と、`fit` があっても幅に収まる図は、根の属性も含めて今までとバイト単位で同じ（入力の sha256 だけが YAML の違いで変わる）。
- **inspect と大きさ**: `inspectSvg()` が根の `width`（pt）と viewBox の自然な幅の比を `SvgInspection.scale` に入れる（`width` が自然な幅と 1e-6pt 以内なら省略 = 1。`width` は小数 6 桁で書くので、その丸めだけを除く。比で比べないのは、上限をわずかに超える図（249.4489pt を 249.448819pt に）の縮小が比では 3e-7 にしかならず、捨てられてしまうため。`width` がない D2 の生の SVG も 1）。要素の幾何は描画の単位のまま。印刷される大きさは `printedSize()`（`src/render/size.ts`）: canvas × scale。`outputSize()`（`--json` の `size`）・`sumi render` の表示（`scaled to 70%`）・`exceeds-page-width` / `-height`・その hint の Profile の提案はこれを使う。`size` には縮めたときだけ `scale`（0.0001 に丸め）を足す。
- **PDF**: エンジン（usvg）は根の `width` / `height` でページを決め、viewBox を写すので、変更なしでページ幅が `maxWidth` になり、文字の大きさも縮む（B の 8pt のラベルは PDF で 5.6pt の glyph）。WASM は作り直さない。
- **画像方式の PPTX**: 根の `width` / `height`（pt）からスライドと画像の大きさを決めるので変更なし（B で 6,480,000 EMU = 180mm）。PNG の代替画像はエンジンが印刷の大きさの 2 倍で描くので、画素数も小さくなる。
- **編集可能 PPTX**: inspect の幾何（unit）から EMU を出すので、`scale` を掛ける: 位置と大きさ（`emuAt(scale)`、自由形状の経路を含む）・線幅・文字の大きさ（`sz`）・行送り・矢じりの大きさの選び方・スライドの大きさ。scale = 1 では式の結果が変わらず、既存の slide XML は同じ。DrawingML の文字の大きさ（`sz`、1/100pt）は 100（1pt）以上なので、強く縮めて 1pt 未満になる文字があれば、不正なパッケージを書いたり文字を勝手に大きくしたりせず `pptx/unsupported-size`（error）で書かない（画像方式の PPTX は文字を輪郭にするので書ける）。
- **文字の下限（判断: Profile の `typography.minScaledFontSize`）**: Profile に任意の `minScaledFontSize` を足し、paper-single・paper-double を 5pt にする（利用者の判断。#167 §4.6 の (b) どおり Profile に持つ: 5pt は論文の版面での判断で、媒体ごとの値）。省略時は `minFontSize`（緩めない）。presentation-16x9 は省略し、縮めたスライドも 14pt。`sumi catalog --json` の `typography.minScaledFontSize`（ある Profile だけ）と、表の `MIN FONT`（`7pt (scaled 5pt)`）に出す。
- **`geometry/text-too-small`（判断: 縮めた図は印刷される大きさで判定）**: scale < 1 の図では、ラベルの文字サイズ × scale を `minScaledFontSize` と比べる。メッセージは印刷される大きさと、縮小前の大きさ・率（`printed at 4.9pt (7pt shrunk to 70% by figure.fit: scale)`）。hint は縮小率を下げる方向（`fit` を外したときの `exceeds-page-width` の案で幅を詰める、幅の広い Profile）。縮めない図は今までどおり `minFontSize`。描画前の `profile/font-too-small`（Theme の文字と `minFontSize`）はそのまま: 縮小前の設計の大きさは 7pt を守り、縮小は図全体の比率を保ったまま小さくするだけにする。
- **添字（判断: 縮めた図でだけ、情報として図全体で 1 件）**: ラベルの数式の添字（0.7 倍）は §6.24 で `text-too-small` の対象外。縮めた図ではそのままだと 3.4pt の添字が黙って通るので、新しい `geometry/script-too-small`（既定 info）で報告する。error にしない: B・C の添字は縮めるとすべて 5pt 未満で（§4.6 の 3.4〜3.8pt）、縮小を認めた判断と矛盾し、原図の添字も同程度に小さい。図全体で 1 件（`figure.fit` を指し、最小の印刷サイズと該当ラベルを 3 つまで挙げ、残りは件数）にする: 添字はすべて同じ率で縮むので、ラベルごとに出しても情報は増えない（C では 40 ラベル）。縮めない図では出さない（既存の図の lint 結果を変えない。§6.24 の判断のまま）。
- **物理的なしきい値（判断: 印刷される大きさで判定し、包含と交差は描画の座標のまま）**: 幾何 lint のしきい値のうち物理的な長さ（線と線・枠・文字のあいだの 1.5pt、並んで走る長さ 3mm）は印刷される大きさの値なので、縮めた図では描画の単位に直して比べる（しきい値 ÷ scale。`edge-near-edge`・`edge-on-border` / `edge-near-border`・`edge-touches-label`）。メッセージの長さ（mm・pt。`label-overflow` と `aspect-distorted` の大きさ、`out-of-canvas` のはみ出し、近さの rule の距離と長さ）も印刷される大きさで示す。重なり・包含・交差（`node-overlap`・`label-overflow`・`out-of-canvas`・`edge-through-node` など）は縮めても変わらないので描画の座標で判定し、D2 の丸めの許容（`GEOMETRY_TOLERANCE_UNITS`・`COINCIDENT_UNITS`）と図形の定数も描画の単位のまま。B では、自然な大きさで枠から 2pt の辺 2 本が印刷では 1.39pt になり、`edge-near-border`（info）が 2 件出る。
- **hint の変更**: `exceeds-page-width` の hint を「Sumi never shrinks a figure on its own. （配置の案）. Or print it smaller as drawn with `figure.fit: scale` (its text must then print at 5pt or more).」にした。縮小は配置の案の後に、条件（印刷される最小の文字）付きで示す。`fit` のある図の `exceeds-page-height` の hint は「`figure.fit: scale` shrinks a figure to the page width only.」で始める。
- **実測**（fixture `tests/fixtures/figures/fit/`: #167 の B・C の複製に `fit: scale` の 1 行だけを足したもの。Theme `color`、paper-double）:

  | 図 | 自然な大きさ | 縮小率 | 印刷される大きさ | ラベル（描画 → 印刷） | 添字（描画 → 印刷） | `fits` | 診断 |
  | --- | --- | --- | --- | --- | --- | --- | --- |
  | B（DiT） | 257 × 119.94mm | 0.7004 | 180 × 84.01mm | 8 → 5.60pt、7（辺）→ 4.90pt | 4.9 → 3.43pt | true | `text-too-small` error 4（辺のラベル γ₁β₁ などの 4 本、4.90pt）、`script-too-small` info 1、`edge-near-border` info 2（印刷で枠から 0.49mm） |
  | C（H3-World） | 232.48 × 163.51mm | 0.7743 | 180 × 126.6mm | 9 → 6.97pt、8 → 6.19pt、7 → 5.42pt | 5.6 → 4.34pt | true | `script-too-small` info 1（40 ラベル） |

  PDF のページは B 510.236 × 238.134pt、C 510.236 × 358.869pt（手元の `pdfinfo` で確認。自動テストは PDF の MediaBox を同じ値で検査する）。B の 7pt の辺のラベルは 5pt の下限を 0.1pt 下回る（#167 §4.6 の予測 4.9pt どおり）。B を error なしにするには縮小率を 0.714 以上にする（幅を 252mm 以下に詰める）か、辺の文字の大きい Theme が要る。下限は利用者の判断のまま変えない。
- **変わった出力**: `fit` のない図の SVG・PDF・PPTX は変わらない（`bun run gallery:check`、PDF・PPTX・画像の golden、`CI=1 bun test`）。変わったのは: `exceeds-page-width` の hint の文、`sumi catalog` の paper 系の `minScaledFontSize`、`SvgInspection.profile` の `minScaledFontSizePt`。
- **非対象**: 配置・余白の変更（compact、#167 の 10）、高さに合わせた縮小、拡大、`maxWidth` のない Profile での縮小。
- **自動テスト**: `src/render/fit.integration.test.ts`（B・C: 180mm・`fits: true`・縮小率、`fit` のない版との SVG の差が根の大きさと入力の sha256 だけ、inspect の幾何が同じ、描画の文字サイズ、B・C の幾何 lint の結果。PDF のページ（B・C）と glyph の大きさ（B）、画像方式の PPTX のスライド幅（B・C）。編集可能 PPTX（B、freeform と glued）: `fit` のない版の slide XML と同じ図形の並びで、位置・大きさ・経路の点・線幅・余白（inset）・文字の大きさ・行送りの値がすべて自然な値 × 縮小率（丸めの差 1.5 EMU 以内）、矢じりの大きさの選択が大きくならない。1pt 未満の文字になる図は `pptx/unsupported-size`。幅に収まる図は縮めない（SVG が同じ）、auto（D2）の横に長い図）。`src/render/fit.test.ts`（上限をわずかに超える図の縮小を inspect が読む・幅に収まる図・6 桁に丸めた自然な幅は縮小と読まない）。`rules.test.ts`（縮めた図の `text-too-small` の境界と、`minScaledFontSize` を持たない Profile が `minFontSize` に戻ること、`script-too-small` の 1 件・縮めない図では出ない、縮小後の高さの超過、`out-of-canvas` のはみ出しの印刷サイズ、hint の文）。`proximity.test.ts`（縮めた図の `edge-near-edge` の間隔と長さ、`edge-near-border`、`edge-touches-label` を印刷される大きさで判定・表示）。CI の Open XML 検証（`scripts/check-pptx-editable.ts`）に縮めた B の編集可能 PPTX（freeform・glued）を加えた。
- **手作業の確認**: B の PDF を PNG にして見た目（配置は変わらず全体が縮む）を目で確かめ、縮めた B の編集可能 PPTX 2 つを Open XML SDK の検証器で手元でも通した。PowerPoint・Keynote での表示は確かめていない。

### 6.49 #174 の枠のない node と、枠のない・破線の container（`variant: filled` / `plain` / `dashed`）

#167 の調査（[§4.1](../research/167-stage-c.md)）で、B（DiT）の箱は枠線のない塗り、左のパネルは枠も塗りもなく、C（H3-World）の (a)(b) は枠のない塗りのパネル、(c) は破線の枠と分かった。今の box と group は必ず枠を描くので、B の左のパネルは stack の下に `label` のノードを置いてキャプションの代わりにしており、他のパネルのキャプションと揃わなかった。角丸（`radius`）と論文向けの Theme は #173 で別に扱う。

- **構文（判断: 既存の variant の追加）**: 部品も style のフィールドも増やさず、manifest の variant にする（#124 §3.3 で `component: panel` を作らなかった判断、#101 の junction `hidden`、#131 の legend `plain` と同じ流れ）。variant は Theme が部品ごとに見た目を持つ閉じた一覧で、`sumi catalog`・ギャラリー・`theme/missing-variant` にそのまま乗り、Figure Schema（v1）は変わらない。名前は調査の理想の YAML のとおり:
  - node の **`filled`**: 塗りだけで枠線なし。box・square・circle・ellipse・diamond・hexagon・parallelogram・cylinder・document・trapezoid・operator。**stack には付けない**: 重なる 3 枚の矩形を分けているのは枠線で、枠を消すと 1 つの塗りの形に潰れる（意味のない variant をギャラリーに出さない）。label・junction・image・legend は既に枠のない variant（`default` / `hidden` / `plain`）を持つので変えない。
  - container の **`plain`**（枠も塗りもない。見出しとキャプションだけ）・**`filled`**（塗りだけ）・**`dashed`**（破線の枠だけ、塗りなし）。variant は 1 つしか書けないので、`muted` と組み合わせた「薄い破線」などは表せない（薄表示の継承は #175 の `dim` で扱う）。
  - 要素の style のフィールド（`border: none` など）にしなかったのは、Figure の要素は style を持たず、見た目を Theme の variant と tone で選ぶ形（§4）を崩すため。
- **「枠なし」の表し方（判断: 線幅 0）**: Theme で `strokeWidth: 0pt` にする。既存の label・image・legend `plain`・junction `hidden` と同じ表し方で、幾何 lint（下記）・editable PPTX（線幅 0 は `<a:ln><a:noFill/>`）・D2（`stroke-width: 0`）が既に「描かれない枠」として扱う。`stroke: transparent` は使わない（線幅 0 と二重に書かず、Theme の枠の色は残す）。形の矩形（`g.shape` の `<rect>`）は残るので、inspect・ルータ・キャプション・`labelAt` の契約は変わらない。
- **Theme ごとの値（判断）**: 4 Theme すべてで定義する（未定義なら `theme/missing-variant`）。
  - node `filled`: その Theme の **tone gray の塗り**（minimal・academic `#e3e3e3`、slides `#d9d9d9`、color `{tone.gray}` = `#e6e6e6`）。`tone` を書けば tone の塗りになる（tone の層は variant の後、§6.20）。既定の白のままにすると白地の上で見えない箱になるため、tone なしでも塗りが見える値にした。文字・太さは既定のまま。
  - container `plain`: `fill: transparent`・`strokeWidth: 0pt`。`filled`: 枠を消して塗りは **group の既定の塗り**（minimal・slides・color は `{color.surface}`）。academic は group の既定が透明なので、Token `color.surface: #f2f2f2`（monochrome の tone の最も淡い段と同じ）を足した（Token の追加だけで既存の出力は変わらない）。`dashed`: `strokeDash: {dash.regular}`・`fill: transparent`。枠の色と太さは既定のまま。どれも見出しの色・太字は既定のまま（`muted` と違い弱めない）。
  - **tone はどの variant でも塗りを決める**: `plain` に tone を書くと `filled` と同じ見た目になる（tone は色だけの層で、variant を見ない §6.20 の規則のまま）。診断は出さず、Skill で「`filled` を使う」と書いた。`dashed` に tone は「破線の枠＋塗り」で、C の破線のパネルに淡い塗りを付ける用途に使える。
  - academic の `muted` は従来から破線の枠なので、`dashed` との差は見出しの色（`muted` は灰色、`dashed` は既定の黒）だけ。`muted` の意味（弱める）と `dashed` の意味（枠の線種）を分けるため両方を残した。
- **幾何 lint（判断: 既存の除外のまま、変更なし）**: `geometry/edge-on-border` / `edge-near-border`（§6.39）は「線幅 0・`transparent`・不透明度 0 のグループ」を対象外にしており、`label-collision` の枠（#116）も線幅 0 か `transparent` の group を飛ばす。node の `label-overflow` の安全領域は枠線の内側の半分（線幅 0 なら 0）で測る。したがって `plain`・`filled` の group では枠の診断が出ず、`dashed` では出る（破線も線として測る §6.39 の判断どおり）。node `filled` も線幅 0 なので枠の分だけラベルの安全領域が広がる。変更は不要で、テストで固定した。`edge-touches-label` など見出し・キャプションの文字の規則は見出しがあるので従来どおり掛かる。
- **ラベルの背景（§6.41）**: 塗りの合成は group の `fill` を見るので、`plain`（透明）は飛ばされその下の色（キャンバスや外側の group）、`filled` は塗りの色になる。`dashed` も塗りなしなので透明として扱う。§6.43 の白抜きの矢じりの内側も同じ。
- **キャプション・`labelAt`・inspect**: group の矩形は枠の有無によらず同じ（線幅は配置に影響しない）。キャプションは矩形の下、`labelAt` は矩形の内側に置かれる。inspect は `g.shape` の `<rect>`（`fill="none"`・`stroke-width="0"`）を読み、group の矩形を返す。
- **D2（auto）**: variant は Theme のスタイルなので D2 にそのまま下ろせる（`stroke-width: 0`、`fill: "transparent"`、`stroke-dash`）。D2 v0.9.0 で全部品 × 全 variant × 全 Theme を描くテスト（`builtins-render.test.ts`）が自動で新しい variant を含み、診断なしで描ける。structured 専用にする理由はないので `engines` は付けない。
- **ギャラリー（判断: slides の幅の広い見本だけ presentation-16x9）**: 見本は catalog から自動で全 variant × 全 Theme を作る。node の 4 variant・container の 5 variant を横に並べると、slides（文字と線が 2 倍）では paper-double の 180mm を超える（ellipse 184mm、diamond 213mm、container 225mm）。`sampleProfile()`（`scripts/gallery/samples.ts`）で、slides の見本のうち横に並べる node・group で variant が 4 つ以上のものだけを `--profile presentation-16x9`（slides の想定の Profile）で描く。対象はこの変更で variant が増えた部品だけで、他の見本の出力は変わらない。ただし対象の slides の見本は、**既存の variant の部分も意図して配置が変わる**（Profile の余白・間隔・group の padding が presentation-16x9 の値になる）: 例えば `sumi-container.slides` の `default` / `muted` の矩形は 234 × 147 → 278 × 169 unit になり、中の member の位置も動く。node の見本は図形の大きさは同じで、キャンバスの外側の余白が広がる（box の `default` 177 × 77 unit は同じ、キャンバスの端からの距離が変わる）。見本は部品の見た目を示すもので、slides の想定の Profile で描く方が実際の使い方に近いと判断した。
- **受け入れの図**: `tests/fixtures/figures/variants/b-dit-plain.sumi.yaml`（#167 の B の複製。research の記録は変えない）で、左のパネルを `variant: plain` の group `ldt`（`caption: Latent Diffusion Transformer`）にし、`ldt-caption` のノードを消した。1・2 番目のパネルの tone の箱は `variant: filled`（原図どおり枠なし）、3・4 番目は `muted` のまま。幅は `figure.fit: scale`（§6.48）で 180mm。根の `row` が `align: stretch` なので 4 つの group は同じ高さで、**4 つのキャプションが同じ y**（テストで検査）。幾何 lint は §6.48 の B と同じ（`text-too-small` error 4（辺のラベル）、`script-too-small` info 1、`edge-near-border` info 2（拡大線と adaLN-Zero の枠））で、`ldt` についての診断は 0。
- **互換性（実測）**: 新しい variant を使わない図の出力はバイト単位で同じ。リポジトリの `*.sumi.yaml` 118 図（`research/` を含む）を変更前（origin/main `c25514b`）と後で `sumi render` し、出力できたもの（D2 38・SVG 36・PDF 36・画像方式 PPTX 36・編集可能 PPTX 65）の sha256 はすべて一致した。`--json` の結果（各 117〜118）も、出力先のパスを除いて一致した。違ったのは知らない variant の hint（`Variants of sumi/cylinder: default, emphasis, muted, filled.`。`tests/fixtures/figures/invalid/component-no-cascade`）だけ。変わったのは意図した追加だけ: ギャラリーの部品の見本 48 枚（variant が増えた 12 部品 × 4 Theme）と `docs/gallery/README.md`・`index.html`、それに伴う PDF・PPTX の golden（`tests/fixtures/pdf/corpus-sha256.json`、`pptx-sha256.json`、`pptx-editable-sha256.json` と slide XML）。`sumi catalog` の variants が増え、Skill の作例の catalog の 1 行を合わせた。
- **非対象**: 角丸と論文向けの Theme（#173）、`component: panel`、(a)(b) の自動採番、薄表示の継承（#175）、variant の組み合わせ。
- **自動テスト**: `src/core/theme/theme.test.ts`（4 Theme で node `filled` が線幅 0・tone gray の塗り・tone で上書き、container の 3 variant の塗り・線幅・破線・見出し、tone で塗り）、`src/lint/geometry/rules.test.ts`（4 Theme で辺のラベルが `plain`・`filled` の枠に重なっても `label-collision` なし、`default`・`dashed` はあり）、`src/render/borderless-variants.integration.test.ts`（DiT の fixture: キャプションの y が揃う、`ldt` の矩形を inspect が読み `fill="none"`・`stroke-width="0"` で描く、`ldt` の診断なし。adaLN-Zero を `dashed` にすると `edge-near-border` は同じ 2 件、`filled`・`plain` で 0 件。辺のラベルの背景が `plain`・`dashed` でキャンバス、`filled` で塗り。auto の D2 の style と、D2 での描画で幾何 lint が空）、`scripts/gallery/samples.test.ts`（presentation-16x9 で描く見本は slides の該当部品だけ）。registry・catalog・theme の既存テストの variant の一覧を更新した。

### 6.50 #181 のセルの並び（`component: tokens`）とセルへの参照（`<node>.<cell>`）

#167 の調査（[§4.5・§10 Q4](../research/167-stage-c.md)）。H3-World（C）のトークン列（`Static`・A1〜・V1〜）、(b) の H3 ブロックのトークン、(c) の LoRA のトークンの列、キーの並び（W / ASD、IF / JKL。押したキーに色）と、ViT（#151）の位置とパッチのトークンを、これまでは 1 セルずつのノードで書いていた（C では 177 ノードの大半）。利用者の判断（2026-10-28）: キーボード専用の部品は作らず、キーの並びもこの汎用の「セルの並び」と tone（枠線の tone は #177）で書く。legend（§6.34）と同じく、検査の後に普通のノードへ展開する。

- **部品**: `sumi/tokens`（kind `node`、variants `default`、since 0.6.0、`engines: ["structured"]`）。props:
  - `cells`（1 件以上）か `lines`（1 行以上、各行 1 件以上のセルのリスト）の**ちょうど一方**（両方・どちらもないは `component/invalid-prop`、props の位置）。
  - セルは文字列（ラベル）か `{ id?, label?, tone?, component?, variant?, width?, height? }`。`label` は省略可（空のセル）。数式も使える（`'$A_{\ldots}$'`）。省略記号のセルは枠のない `{ label: '…', component: label }` か、数式のラベル。
  - `direction`（`right`（既定）・`left` は row、`down`・`up` は stack）、`gap`・`align`（arrange の box と同じ意味・同じ長さの書式。省略は box と同じく既定・外側から継承）、`lineGap`（省略は `gap`）・`lineAlign`（`lines` の行どうしの揃え。省略は継承）。
  - セルの既定: `component`（既定 `box`）・`variant`（既定 `default`）・`width`・`height`（node の size props と同じ書式）と、tokens ノード自身の `tone`。セルの同名のフィールドが優先する。
  - variant はセルごと（`cells[j].variant`）と全体（`props.variant`）に書けるので、#177 の枠線の variant（例 `variant: outlined`）は部品の変更なしにそのまま使える。tokens ノード自身の variant は `default` だけ（描かれないため）。
- **展開（判断: 枠を作らず、配置の木の項目を置き換える）**: legend と違ってグループの枠を作らない。tokens ノードの配置の木の項目（`figure.layout.arrange` か `groups[].arrange` の文字列）を、セルを並べる box に置き換える: `cells` なら `row { direction, gap?, align?, items: [セル…] }`（`down` / `up` なら stack）、`lines` なら行ごとのその box を、`direction` を横切る向きに並べた `stack { direction: down, gap: lineGap ?? gap, align: lineAlign? }`（`down` / `up` の行なら `row { right }`）。**1 セルだけの行・並びは box に包まずセルそのもの**にする（W / ASD の W は書き下した版と同じく stack の直接の項目）。省略した `gap` / `align` は box にも書かない。こうして展開の結果は、作者が 1 セル 1 ノードで書く図と**同じ arrange の box・同じ props** になり、以降の段（asset・theme・profile・lint・IR・配置・経路・inspect・PDF・PPTX）は普通のノードだけを見る。グループの枠にする案は採らない: 枠のグループは Layout IR の要素になり、padding で位置が変わるので、受け入れ条件の「書き下した版と同じ Layout IR」を満たせない。tokens ノードは消え（`nodes[i]` を `undefined` に、`component` 段の結果からも除く）、その ID は**どの要素も指さない**。
- **順序（判断: legend の後）**: `checkFigure()` は `component` 段 → legend の展開 → tokens の展開（`expandTokens()`、`src/core/figure/tokens.ts`）→ asset 以降。検査済みの props（既定値と長さの変換の済んだもの）から展開し、足したセルは `resolveComponents()` の `only` で同じ `component` 段にかける（未知の variant・数式の誤りなどはセルの位置で出る）。auto の図では展開しない（manifest の `engines` から `layout/structured-only`）。
- **セルの ID と鍵（判断）**: セルの鍵は `id`（ID の規則）か、ないときは**1 始まりの位置**（`lines` では行をまたいで通し番号）。セルは予約 ID `<node>-<鍵>`（例 `seq-a5`、`keys-3`）のノードになる。予約 ID は ID の規則（64 文字まで）を満たさなければ `component/invalid-prop`（セルの `id`、なければセルの位置）。同じ tokens の中で `id` が重なれば `component/invalid-prop`（2 つ目の `id`）。位置の鍵は数字で始まるので `id`（英字で始まる）とは重ならない。利用者のノード・グループ、キャプション、凡例の部品、先に展開した別の tokens のセルが同じ ID を持てば `ref/reserved-id`（error、その要素の `id` の位置。展開した要素なら由来の位置。related はセル）で、その tokens は展開せず無効にする（キャプション・凡例と同じ `src/core/figure/expand.ts` の処理）。ID は通常の ID なので、inspect の `sumi-k-*` の復号・D2 の鍵の制約は変わらない。
- **セルへの参照 `<node>.<cell>`（判断: 端点・`attach.to`・`align` の項目）**: これまで ID の規則（`^[a-z][a-z0-9_-]{0,63}$`）で `schema/invalid-id` にしていた参照を、`REF_PATTERN`（`<ID>` か `<ID>.<ID か 1〜4 桁の位置>`）に広げた。対象は辺の `from` / `to`、`nodes[].attach.to`、`figure.layout.align[].x` / `y` の項目（配置の木の項目・`group` は ID のまま: セルは tokens が置く）。`.` を含まない参照の誤りは、メッセージ・hint とも従来の ID の誤りと**同じ文**（互換性）。`.` を含む参照の誤りは `Invalid reference "seq.X" …; expected an ID (…) or a tokens cell as <node>.<cell>.`（同じ `schema/invalid-id`、小文字の候補の hint）。`ref` 段・`layout` 段・`invalidateDependents()` は参照の**ノードの部分**（`refOwner()`）で存在・無効・配置の親を判定し（セルは tokens と同じ親に置かれる）、tokens の展開がすべての参照をセルの ID に書き換える。以降の段は ID だけを見る。
  - 鍵の分からないセル、tokens でないノードへの `.` の参照は `ref/unknown-cell`（error、参照の位置。辺・付けたノードは無効、align は何も無効にしない）。hint は位置の規則と近い鍵（`Did you mean "x"?`）、tokens でなければ「`<node>.<cell>` で指せるのは tokens のセルだけ。要素そのものは `"a"`」。
  - tokens ノードの ID そのものを端点・`attach.to`・align の項目に書くと `ref/tokens-reference`（error。tokens は描かれず、その ID の要素はない。hint は最初のセルの例 `"seq.static"`）。行全体への辺は非対象（行を囲む要素がないため。必要ならグループで囲む）。
  - error のある tokens（展開しないもの）と、auto の図の tokens へのセルの参照は、tokens の error で説明済みなので黙って無効にする（`invalidateDependents()` が参照のノードの部分を見る）。
- **anchor・`straight`**: セルは普通のノードなので、`fromAnchor` / `toAnchor`（`north:0.25`・`straight`）はそのセルの辺に効く。`straight` が効かない場合の `layout/straight-off-side` などのメッセージはセルを予約 ID（`seq-2`）で呼ぶ。
- **tokens ノード自身のフィールド**: `label`（空白でない）は `component/unexpected-label`（tokens は描かれない。見出しは横に `label` ノードを置く）、`icon` は `asset/icon-unsupported`、`labelRotation` は `component/label-rotation-unsupported`（回転するラベルがない。`component` 段の `label-rotation-without-label` の warning も出る）、`attach` は新しい `layout/attached-tokens`（error、`attach` の位置。tokens は box として配置の木に置く。セルに付けるのは `attach.to: seq.a1` で可）。`tone` はセルの既定の tone。
- **セルにできない部品**: 印（`operator`・`junction`）・画像（`image`）・`legend`・`tokens` は `component/invalid-prop`（その部品を書いた位置: セルの `component` か `props.component`）。未知の部品は `component/unknown` を同じ位置に出す。`label`（文字だけ）はセルにできる（省略記号）。凡例の見本の箱にも `tokens` はできない（`component/invalid-prop`、項目の `node.component` の位置。§6.34 の `legend` と同じ扱い）。
- **文書順と描く順（判断: tokens ノードの位置）**: セルは、後ろのノードの添字（DocPath）を変えないよう `nodes` の末尾に足すが、figure IR はノードを `nodeOrder()`（`src/core/figure/tokens.ts`）の順に並べ、セルを tokens ノードの位置に置く。Layout IR の `nodes`（文書順）と SVG の描く順（後に描いたものが上）はこの順なので、書き下した版と同じになる。末尾のままだと、tokens より後に書いたノードがセルの下に描かれ、セルに重なる `attach` のノード（例: 1 つ目のセルの東に付けた、2 つ目のセルと同じ位置の箱）が隠れる（レビューで指摘。回帰テストあり）。
- **診断の位置（判断: 書いたフィールド）**: 以降の段はセルのノードのフィールドの位置を、由来の位置（セル）に `props.height` などを足して作るが、セルの書式は平ら（`cells[j].height`）で、既定は tokens 側（`props.height`・`props.variant`・`props.component`・ノードの `tone`）にある。展開がセルごとに「ノードのフィールド → 書いた位置」（`fields`）を記録し、`tokensLocator()` と `remapTokensPaths()`（キャプションの `captionLocator()`・`clampCaptionPaths()` と同じ形。`checkFigure()` と lint で使う）が診断の位置をそこに直す。例: 正方形のセルの幅と高さの違いは `cells[j].height`、tokens の既定から受け継いだなら `props.height`、未知の variant を受け継いだなら `props.variant`。文字列のセルのラベルはその文字列の位置。幾何 lint も同じ対応（figure IR のセルの `tokens.fields`）で位置を直す。大きさ全体についての指摘（`label-overflow` の `props` など）は、セルが自分の `width` / `height` を持てばセル、受け継いだならその `props.width`（なければ `props.height`）を指す。
- **由来・IR・lint**: 各セルの由来を `doc.expanded` に `{ from: "tokens", path: セルの位置（…cells[j] / …lines[l][j]）, subject: tokens ノード, name: 'cell "a5" of tokens "seq"' }` で記録し、`doc.tokens` に展開の一覧を置く。figure IR のセルに `tokens: { id, variant, name }` を付け（セル以外の要素には付かないので既存の IR は不変）、source map はセルの位置、幾何 lint の subject と名前は tokens ノードとセルの名前を使う（`writtenComponentOf()` もセルを tokens にたどる）。`lint/empty-label` はセルを対象外にする（空のトークン・色だけのトークンを書けるようにするため。受け入れ条件）。セルは作者のノードとして数える: `lint/no-edges` のノード数と `lint/unused-legend-entry` の「作者の描いた要素」に含める。（診断の位置は上記）
- **Layout IR の一致（受け入れ条件）**: `research/181-tokens/rewrite.ts` が、#167 の図 C（H3-World: `seq` 14 セル、`bt` 9 セル、`ct` 9 セルの縦の列（位置の鍵、`direction: down`）、キーの並び 10 個（`k<n>-move: lines [[W], [A, S, D]]`・`k<n>-look: lines [[I, F], [J, K, L]]`、押したキーはセルの `tone`））と #151 の ViT（位置とパッチの組 5 つ: `tok<i>`、`cells: [{ id: pos }, { id: x }]`、`gap: 0`）のセルを tokens に書き換えた写しを `research/181-tokens/figures/` に作る（元の図は変えない。画像は写し）。`src/render/tokens.integration.test.ts` が、元と写しを描き、セルの予約 ID を書き下した ID に写した（`k0-move-3` → `k0-s`、`ct-5` → `ct-4`、`tok1-x` → `t1` など）**Layout IR が一致**（C はノードの文書順も含めて一致。ViT は書き下しが `e0…e4, t0…t4` の順で、tokens は組 `e0, t0, …` の順なので、ノードを鍵の順に並べて比べる）、接するか重なるノードの組ごとの描く順が一致、要素ごとの SVG の markup が一致（C は描く順も一致）、診断は `lint/empty-label` が C で 9 件（`ct` の空のセル）減るだけで、ほかは同じ（C: `geometry/exceeds-page-width` 1 と行列のセルの `empty-label` 81）ことを確かめる。C の書き下しのノードのうち 77 個（キー 45・トークン 32）が 13 個の tokens ノードに、ViT の 10 個が 5 個になり、`empty-label` は 90 → 81 件（残りは行列。#167 §4.5 の `matrix` の対象）。
- **互換性**: 新しい部品と参照の構文の拡張だけで、tokens と `.` の参照を使わない図の出力は変わらない。リポジトリの追跡済みの `*.sumi.yaml` 118 個を、図の Theme と組み込みの 4 Theme で、変更前（`397c120`）と変更後のコードで描き（590 回、描画まで通ったもの 379。追加した research/181-tokens の図を除く）、D2 ソース・SVG・PDF・画像方式の PPTX・編集可能 PPTX（freeform・glued）の sha256 がすべて一致した。診断が変わったのは、未知の部品・種類違いの hint の部品の一覧に `tokens` が加わる 6 ファイル（lint の golden `no-cascade` を更新）だけ。JSON Schema は辺の `from` / `to`・`attach.to`・`align` の項目の pattern と説明が変わる（`schema:check`）。ギャラリーには `sumi-tokens` の 4 図と目次が**追加**され、PDF・画像方式 PPTX・編集可能 PPTX の corpus の hash も追加だけ。
- **試験基盤**: `structuredPrimitivesFigure()` に tokens（ラベル・tone・数式・枠のないセルとセルからの辺）の行を足した。tokens は展開でそれ自身の要素を残さないので、`builtins.test.ts` の下ろし方の表は tokens を `EXPANDED_AWAY` として除き、部品 × variant の網羅は `writtenComponentOf()` でたどった要素で確かめる。ギャラリー（`structuredSample()`）は variant ごとに、セルへ 2 本の辺が入る列とキーの並び（`lines`）を描く。
- **テスト**: `src/core/figure/tokens.test.ts`（展開の形: セルのノード・props・tone と variant の既定・配置の木の置き換え（row・stack・`lines`・1 セル）・グループの中・`doc.tokens`・由来、辺・`attach.to`・`align` の参照の書き換えと anchor、IR の `tokens`・source map、空のセルに `empty-label` が出ない・`no-edges` の数え方、セルの診断の位置、`ref/unknown-cell`・`ref/tokens-reference`・`ref/reserved-id`（2 つの tokens の衝突を含む）・`id` の重複と長さ・セルにできない部品・`cells` / `lines` の一方・`attach` / `label` / `icon` / `labelRotation`・auto の `layout/structured-only` と黙った無効化・不正な参照の `schema/invalid-id` と `.` のない参照の従来どおりの文）、フィールドの位置（自分のフィールドと受け継いだ既定の `fields`、正方形のセルの大きさと受け継いだ variant の診断の位置）、`src/render/tokens.integration.test.ts`（上記の 2 図と、セルに重なる `attach` のノードの描く順の回帰）、`legend.test.ts`（見本の箱に tokens）、上記の試験基盤、`registry.test.ts`、`skill.test.ts`（Skill の作例を描く）。
- **Skill**: `references/structured.md` に「Token sequences」（構文・`<node>.<cell>`・予約 ID・診断、描いて確かめる作例）、`figure-format.md` の部品の一覧、`diagnostics.md` に `ref/unknown-cell`・`ref/tokens-reference`・`layout/attached-tokens` と予約 ID を足した。
- **非対象・引き継ぎ**: auto（D2 の grid で可能だが、Issue の非対象）、セルの中の画像、キーボード専用の部品、行全体への辺、セルの区切りの破線（`separator`、#167 §4.5 の案。今は枠のない `label` のセルで代用）、行列（`matrix`、#167 §4.9）、枠線の tone（#177。セルの `variant` でそのまま使える）。

### 6.51 #184 の小さい 2 行目（`nodes[].sublabel`）

段階 C（[#167 の調査](../research/167-stage-c.md) §4.8、B-5）。DiT の Noise・Σ・Noised Latent は、名前（原図 8.4pt）の下に小さい寸法「32 × 32 × 4」（7.35pt）の 2 行。今までは 3 行目のラベルとして同じ大きさで書くしかなかった。Figure v1 への任意フィールドの追加で、**`sublabel` を書かない図**の診断・IR・Layout IR・D2・SVG・PDF・PPTX はバイト単位で変わらない。

- **フィールド**: `nodes[].sublabel`: 文字列。空・空白だけは `schema/invalid-value`（`must not be empty or only whitespace`）。改行（`\n`）で行を分け、ラベルの数式（§6.24・§6.29）も書ける（`component/invalid-math` の位置は `sublabel`、メッセージは `sublabel characters …`）。`fmt --canonical-order` では `label` の直後（`labelRotation` の前）。
- **対象（判断: ノードだけ）**: group と edge のスキーマには足さない（書けば `schema/unknown-field`）。group の見出しの帯（§6.21・§6.27）と edge のラベルの置き方（§6.30）は 1 つの箱を前提にしており、DiT の 3 か所はどれもノード。
  - アイコン（`icon`）・mark（`operator`・`junction`）・画像（`image`）のノードと `legend` では `component/sublabel-unsupported`（error、`sublabel` の位置）。下に置くラベルがない。
  - ラベルが省略・空・空白だけなら `component/sublabel-without-label`（**error**）。`labelRotation` のラベルなし（§6.46、warning で効果なし）と違い、`sublabel` は見える文字を描くので、ラベルなしでは「小さい 1 行目」になり、意図と違う図が黙って描かれる。hint は「ラベルを足すか、その文字をラベルに書く」。
  - `label` 部品（文字だけのノード）には置ける（軸のラベルの下の注記など）。
- **大きさ（判断: ラベルの 7/8 を 0.5pt 単位に切り捨て、Theme の値にしない）**: `sublabelFontSize(fontSize)` = ⌊ラベルの文字サイズ（D2 unit）× 7/8⌋。8pt → 7pt、9pt → 7.5pt、16pt → 14pt、7pt → 6pt。7/8 は DiT の原図の比（7.35 / 8.4 = 0.875）で、組み込みの 4 Theme ではちょうど `size.text` → `size.small`（edge の文字）になる。0.5pt 単位にするのは、他の文字サイズと同じく D2 unit の整数に保つため。§4.1 は Theme に書いた 0.5pt 刻みでない長さを丸めずに error にするが、sublabel の大きさは利用者が書く値ではなくこの規則が導く値なので、丸め（切り捨て。7/8 を超えない）はこの規則の一部として決めた。
  - Theme の値にしなかった理由: 解決済みの style property（`ResolvedStyle` の `sublabelFontSize`）を足さないのは、§4.1 の「style property は D2 で表せるものだけ」の方針と、kind の既定（§4.3、全プロパティを固定値で埋める）ではラベルの大きさに追従できないため。この方針は Theme の比率の値（例: Theme の任意フィールド）までは禁じない。今回は需要が 1 つの比で足りるので、部品の契約として固定した。token `size.small` は Theme の中の名前で、意味を持たない（利用者の Theme にはなくてもよい）うえ、variant で文字を大きくした部品にも小さいままになる。比率ならどの Theme・variant でも同じ関係になる。Theme ごとに比率を変える需要が出たら、Theme の任意フィールドとして足す（非対象）。
  - 大きさは IR の `NodeIR.sublabel = { text, fontSize }` に入れ、配置・writer・Profile の検査が同じ値を使う。
- **最小の文字（判断: 描画前と描画後の両方で、sublabel 自身の大きさで検査）**:
  - `profile/font-too-small`（描画前）: `labelFontUsages()` が sublabel の大きさも返し（`FontUsage.sublabel`）、下回れば位置 `nodes[i].sublabel`・メッセージ「Font size 7pt of the sublabel of node "a" …」・hint に 7/8 の規則を出す。組み込みの Theme と Profile の組では下限ちょうどで通る（academic・minimal・color の 7pt = paper 系の 7pt、slides の 14pt = presentation-16x9 の 14pt）。
  - `geometry/text-too-small`（描画後の安全網）: SVG の `<text>` ごとの大きさで判定する（下記の「2 つ目の `<text>`」で変更なし）。sublabel だけが下回るときは、メッセージ（`The sublabel of node …`）と位置（`sublabel`）がそれを指す。
  - **`figure.fit: scale`（§6.48）**: 縮めた図では印刷される大きさ（7pt × 縮小率）を `minScaledFontSize`（5pt）と比べる。DiT の fixture に `fit: scale` を足すと縮小率 0.7126 で 7pt の sublabel は 4.99pt になり、3 か所とも error（同じ 7pt の辺のラベルと同じ扱い）。下限は利用者の判断（§6.48）のまま変えない。sublabel の数式の添字は `geometry/script-too-small` が sublabel の大きさを基準に扱う。
- **間隔と揃え（判断: 行の箱を隙間なく積む、中央揃え）**: ラベルの行の箱（行数 × 行送り 1.25em）の直下に、sublabel の行の箱（行数 × sublabel の行送り）を置く。2 つの間はそれぞれの半行送り（half-leading）で空き、ラベルの改行と同じ見た目の間隔になる（追加の定数を持たない）。横は両方とも中央揃え。2 つを合わせたブロック（幅 = 広い方、高さ = 和）をノードのラベルの中心（`nodeLabelCenter()`）に置き、ノードの大きさ（`nodeSize()`）もこのブロックで決める（明示の `width` / `height` は従来どおり優先し、はみ出せば `geometry/label-overflow`）。
- **`labelRotation` との併用（判断: 対応する。ブロックごと回す）**: ブロックをその中心で ±90° 回す。実装は、ラベルと sublabel をそれぞれ「ブロックの中心で回した後の中心」に置き、自分の中心で回す（剛体の回転は、中心の移動と自分の中心での回転に分けられる）ので、各 `<text>` は §6.46 の `rotate(±90 cx cy)` の形のままで、inspect の契約は変わらない。`-90`（下から上へ読む）ではラベルが左、`90` では右に来る。
- **auto（判断: `layout/structured-only`）**: D2 のラベルは 1 つの大きさで、`|md|` は inspect の契約の外（#167 §5.2）。D2 だけで大きさの違う 2 行を正確に置き・測る手段がないので、§6.46 と同じく structured 専用にする。
- **Layout IR**: `NodeLayout.sublabel?: TextLayout`（ラベルと同じ形で、自分の文字サイズと行送り）。辺のラベルの重なりの診断（`label-diagnostics.ts`）と経路の検査（`check.ts`）は sublabel の箱も見る。
- **SVG の writer（判断: 2 つ目の `<text>`）**: ノードの `<g>` の中で、ラベルの `<text>` の直後に同じ形の `<text>`（同じ色・フォントのクラス、小さい `font-size`）を書く。同じ `<text>` の中で `<tspan>` ごとに大きさを変える案（#167 §4.8 の当初の案）は採らない: inspect の契約（§6.3: `<text>` ごとに 1 つの大きさ、行は等間隔）を広げ、幾何 lint の計測と PPTX の読み取りをすべて変えることになる。別の `<text>` なら、inspect は従来どおりそれぞれの大きさ・行送り・行を読み（`ElementGeometry.labels` の 2 つ目。sublabel は IR に `sublabel` があるノードの 2 つ目の `<text>`）、幾何 lint の規則（`label-overflow`・`label-collision`・`edge-crosses-label`・`edge-touches-label`・`out-of-canvas`・`text-too-small`）は要素のすべてのラベルを見るので、規則を変えずに行ごとの大きさで働く。受け入れ条件の「inspect と幾何 lint が行ごとの大きさを読む」は、この `<text>` ごとの大きさで満たす。フォントのサブセットはラベルと共有する。
- **inspect の契約**: 変更なし（1 つのノードに `<text>` が 2 つあるだけ）。
- **PDF**: 文字として抽出でき（ToUnicode）、フォントは埋め込みの CIDFontType2。テストで「32 × 32 × 4」が 7pt、「Noise」が 8pt の glyph であることを確かめる。
- **画像方式の PPTX**: SVG を描くので追加の処理はない。
- **編集可能 PPTX（判断: 同じ text body の、小さい `sz` の段落。位置を保てなければ別の text box）**: ノードの図形の `txBody` に、ラベルの段落に続けて sublabel の段落（`sz` は sublabel の大きさ、行送りも sublabel の）を書く。ノードを動かせば一緒に動く。各行の上端は「上の余白（`tIns`）＋上の行の行送りの和」なので、sublabel の最初の段落に `spcBef` を足して、その上端を SVG の行の上端に合わせる（1 行のラベルは inspect の行送りが文字サイズになる（§6.3）ため、この補正がないと 2pt 上にずれる）。**DrawingML の行間は負にできない**ので、必要な `spcBef` が負になる場合（2 行以上のラベル。ずれの量は 2 つの大きさの半行送りの差だけでなく、フォントの寸法・数式の run によって変わり、レビューで slides の `"Two\nlines"` / `"a\n$x_i$"` は 2pt に達した）は、0 に丸めず、sublabel を**別の text box**（名前 `<key> sublabel`、塗り・線なし。辺のラベルと同じく、SVG の sublabel の箱に置き、最初の行の上端を `tIns` で合わせる）にする（判断: 位置を保つ方を優先）。代償としてその sublabel はノードと別の図形になり、ノードを動かしても付いてこない。DiT では Noise・Σ（1 行のラベル）が同じ text body、Noised Latent（2 行）が別の text box になる。テストは、両方の場合で各 text の最初の行の上端と、その後の行の基線の間隔（行送り）が SVG と一致すること（`spcPts` の 1/100pt の丸めの 0.015 unit 以内）を、color・slides・academic・minimal と複数行・数式の sublabel で確かめる（2 行目以降の上端そのものは、数式や添字の run で字面の高さが行ごとに変わるので比べない。基線は SVG でも PowerPoint の固定の行送りでも等間隔）。回転したブロックは、§6.46 の text box を 2 つ（名前 `<key> label`・`<key> sublabel`）にして、それぞれ `rot` で回す。sublabel のないノードの slide XML は変わらない（`spcBef` は 0 のまま）。CI の Open XML 検証（`scripts/check-pptx-editable.ts`）に DiT の fixture の編集可能 PPTX（freeform・glued）を加え、手元でも同じ validator を通した（回転したブロックを含む図も）。PowerPoint での見た目は未確認。
- **構造の lint**: `lint/long-label`・`lint/missing-glyph`・`lint/literal-newline` は sublabel も同じ規則で検査し、位置とメッセージ（`The sublabel of …`）が sublabel を指す。
- **DiT（受け入れ条件）**: fixture `tests/fixtures/figures/sublabel/b-dit.sumi.yaml` は #167 の図 B（`research/167-stage-c/figures/b-dit.sumi.yaml`、調査の記録なので変えない）の複製で、3 つのノードの寸法を `sublabel` にしただけ。幾何 lint は元の図と同じ `exceeds-page-width` 1 件だけで、幅は 257.0mm から 252.59mm になった（Noised Latent が 3 行から 2 行＋小さい 1 行になり、狭く低くなったため）。
- **変わった出力: なし**（`sublabel` を書いた入力の診断を除く）。リポジトリの `*.sumi.yaml` 118 個を図の Theme と組み込みの 4 Theme で（590 通り、描けたもの 379）、変更の前（`origin/main` の `git archive`）と後で描き、D2・SVG・PDF・画像方式の PPTX・編集可能 PPTX（freeform・glued）の sha256 はすべて一致した。診断＋幾何 lint の sha256 が変わったのは、#86 の構文の草案 `research/86-paper-figures/figures/ideal/b-dit.sumi.yaml`（描けない草案。`component/unknown` 4 件で止まる）の 5 通りだけで、3 つの `sublabel` の `schema/unknown-field` が消えた（意図どおり）。`CI=1 bun test`（D2・Layout IR・PDF・PPTX の golden を含む）、`bun run gallery:check`、`bun run schema:check` も通る（JSON Schema は `sublabel` の追加だけ）。
- **テスト**: `sublabel.integration.test.ts`（DiT の fixture: 幾何 lint が元の図と同じ、3 か所の `<text>` 2 つと大きさ 16・14 unit、sublabel の箱がラベルの箱の直下・同じ中心、再計測した行がラベルの下・ノードの中、ノードの高さが sublabel の分だけ増える、PDF の 7pt と 8pt の glyph、編集可能 PPTX の段落の `sz`、同じ text body か別の text box かと、`tIns`・行送り・`spcBef` から復元した各行の位置（4 Theme、複数行・数式の sublabel）、`labelRotation` との併用（±90°、ラベルと sublabel の位置関係、行がノードの中、PPTX の text box 2 つの `rot`）、`fit: scale` で `text-too-small` が sublabel を指す、auto の `layout/structured-only`）、`layout.test.ts`（auto の診断と位置、空・空白・文字列でない値）、`resolve.test.ts`（アイコン・`operator`・`junction`・`image`・`legend` の error、ラベルなしの error、sublabel の数式の error の位置、`profile/font-too-small` の sublabel の位置と組み込みの組で通ること）、`theme.test.ts`（`sublabelFontSize()` の値と、組み込み Theme で `size.small` になること）、`lint.test.ts`（3 つの構造の lint が sublabel を指す）。
- **非対象・引き継ぎ**: 3 段以上の大きさ（#184 の非対象）、group・edge の sublabel、Theme での比率の変更、左揃え（`textAlign`、#167 §4.9）、編集可能 PPTX の PowerPoint 実機での確認。

### 6.52 #173 の論文向けの Theme paper

[#167 の調査](../research/167-stage-c.md) §4.1・§10 Q2 の利用者の判断（2026-10-28）: 3 図の原図（Transformer arXiv 1706.03762 Fig. 1、DiT arXiv 2212.09748 Fig. 3、利用者の H3-World）は角丸・tone の塗り・小さめの矢じり・欧文のサンセリフで描かれている。**新しい組み込みの Theme `paper` を足し、既存の `minimal`・`academic`・`slides`・`color` は変えない**。原図と並べた記録は [`research/173-paper-theme/`](../../research/173-paper-theme/README.md)。

- **値（`src/core/theme/builtin.ts`）**:

  | 項目 | 値 | 理由（判断） |
  | --- | --- | --- |
  | フォントセット | `sumi/inter-biz-ud-gothic`（§6.44） | 3 図とも欧文はサンセリフ（Helvetica 系）。structured の図の欧文は Inter、日本語は BIZ UDPGothic、数式は STIX Two。auto（D2）の図は §6.44 のとおり全部 BIZ UDPGothic |
  | 文字 | node 8pt、group の見出し 9pt（太字）、辺 7pt | `color` と同じ。最小 7pt なので `compatibleProfiles` は paper-single・paper-double（presentation-16x9 は 14pt で不可）。辺 7pt で B が縮小後 5.52pt になり 5pt の下限を満たす（下の実測）。7.5pt は幅が増えて縮小率が下がるので採らない |
  | 枠 | node・group 1pt の黒 | A のブロックとパネルの黒い太い枠（推定 約 1pt） |
  | 辺 | 0.5pt の黒、emphasis 1pt | 下の「矢じり」 |
  | emphasis（node） | 枠 1.5pt＋太字 | 黒い枠の Theme で塗りを tone に任せるため、線と太字で示す（`minimal` と同じ考え） |
  | 角丸 | box・square 2pt、group 6pt、legend 3pt | 原図の箱の角は印刷時 0.5〜0.7mm（1.5〜2pt）、パネルは 1.5〜3mm。group は Profile の余白（8pt）より小さく、見出しにかからない 6pt |
  | group の塗り | `#f3f3f5` | A のパネル（`#f3f3f4`）と B の 2 番目のパネル（`#f3f3f6`）の実測 |
  | muted（node・辺） | `#737373` の線と文字 | 白地で 4.7:1（7pt の灰色の文字が読める下限の近く）。B の薄表示のパネルの灰色に近い |
  | muted（container） | 白地・`#737373` の枠と細字の見出し | B の 3・4 番目のパネル（白に近い地・灰色の枠と見出し）。`academic` の破線は使わない（破線のパネルは `dashed`） |
  | node の `filled`（#174、§6.49） | 線幅 0・2pt の角丸、塗りは tone gray（`#dcdee6`。tone があればその色） | B・C の枠線のない角丸の塗りの箱。他の Theme と同じく tone gray を既定の塗りにする |
  | container の `plain` / `filled` / `dashed`（#174） | `plain`: 枠も塗りもなし。`filled`: `#f3f3f5` の塗りだけ（線幅 0）。`dashed`: 塗りなし・破線 3 の黒い 1pt の枠。どれも 6pt の角丸、見出しは黒の太字 | C の (a)(b) の枠線のない淡い塗りのパネル、(c) の角丸の破線の枠、B の左の枠のないパネル。`outlineVariants()`（§6.49）を `color` と同じく group の塗りの token で使う |
  | `sublabel`（#184、§6.51） | node の 7/8（8pt → 7pt）。Theme の値ではなく node の文字から決まる | 最小 7pt のままなので `compatibleProfiles` は変わらない。B の縮小後 5.61pt |
  | tone | gray `#dcdee6`、red `#f6dcdb`、orange `#f9e0bc`、yellow `#f1f4c6`、green `#d0e6cd`、blue `#cddff6`、purple `#dfdcef`、pink `#f6d8e5` | 原図の画素を測った色に寄せた（A: `#f7e1e1`・`#fae3c0`・`#f2f4c6`・`#c9e7f5`・`#dcdfee`・`#d1e6d1`、B: `#cadafb`・`#c9e2c0`・`#f2ce94`・`#d5d7e2`）。A（水色）と B（青紫）で違う blue は中間。黒い文字とのコントラストは 15:1 以上（`color` は 11:1 以上） |
  | 破線 | 3 | `academic` と同じ（線が細い） |

- **矢じり（判断: 辺を 0.5pt にして小さくする。新しいプロパティは足さない）**: 矢じりの長さは D2 の三角形と同じ `4 + 4 × 線幅`（unit、§6.42）で、Theme が持つのは線幅だけ。0.5pt の辺で長さ 4pt（1.41mm、`academic` と同じ）、1pt（`color`）では 6pt。原図は A が線 約 1pt・矢じり 約 1.2mm、B が線 約 0.5pt・矢じり 約 1.1mm（いずれも印刷時の推定）で、太い線と小さい矢じりの組（A）は今の契約では作れない。3 図のうち 2 図が細い線なので、小さい矢じりを優先して辺を 0.5pt にした（B の縮小後は 3.2pt = 1.1mm で原図と同程度）。矢じりの大きさを線幅と別に Theme で選ぶプロパティは、ルータ（stub と `arrowRoom()`）・writer・D2（D2 は矢じりの大きさを指定できない）・PPTX にまたがるので、この Issue では足さない。§6.42 の矢じりの前の余地も `academic` と同じ 8 unit で、余白を広げる配置し直しは起きない。
- **角丸を付ける部品（判断）**: `radius` は box・square の各 variant と group（`base.group`）、legend だけに付ける（`roundedBoxes()`）。`base.node` には置かない: structured の writer は矩形（`rectangle` / `square`）にだけ `rx` を描き、D2 の `border-radius` を矩形以外の形に書いた場合の描画は確かめていない（書かなければ既存の出力と同じ道筋になる）。stack・document などの輪郭は部品の renderer が描くので角丸にならない（輪郭の角丸は対象外）。幾何 lint のラベルの領域は矩形のままで、2pt の角はラベルの余白（Profile の node padding）の中に収まる。group の枠と線の近さの検査（`edge-near-border`・`label-collision`）は以前から `radius` を見て角を丸めた輪郭で測る。一方、辺のラベルの背景の色（§6.41 の `labelBackground()`）は group を矩形として判定し、角丸の外の切り欠きの角も内側とみなす（§6.41 に書いた既知の制限）。`paper` の 6pt の角丸で切り欠きは大きくなるが、ラベルの中心がそこに来ることは配置上まずなく、来た場合は背景が group の塗りになる（tone のない group ならキャンバスの白との差は `#f3f3f5` の薄灰だけ）。
- **数式の大きさ（判断: 変えない）**: Inter の x-height（0.546em）は STIX Two Text Italic（0.467em）より 17% 大きく、同じ大きさの数式の変数（γ・α・添字の A₁ など）は小さく見える（3 図で確認）。x-height を揃えるには数式を約 1.17 倍にするが、Theme の形式には数式の倍率がなく（数式の run はラベルの文字の大きさで描く）、計測・行の高さ・幾何 lint・PDF・PPTX にまたがる。今は変えず、必要なら別 Issue で「Theme の数式の倍率」として検討する。
- **Inter の行の箱（実測、利用上の注意）**: 幾何 lint は文字の行の箱を hhea の ascender＋descender で測る（§6.24）。Inter は 1.21em、BIZ UDPGothic は 1.00em なので、幅・高さを明示した小さな node は `paper` で `geometry/label-overflow` になりやすい。#167 の C（8.5pt 四方のキーに 8pt の 1 文字）は 45 個すべてが error になり、11pt 四方で収まった（研究の複製だけを変えた）。配置の行の高さ（文字の大きさ × 1.25、§6.21）は書体によらないので、大きさを自動で決める node は変わらない。Skill に「1 文字のキー・トークンの正方形は一辺を文字の約 1.4 倍に（幅の一般則ではない。長いラベルは大きさを書かずに自動に任せる）」と書いた。
- **auto（D2）の group の見出し**: D2 は group の見出しを枠の左上の内側に置く。`paper` では 6pt の角丸と黒い枠のため、ギャラリーの container の見出しが枠の角に近く見える（位置は `color` と同じ、lint の指摘なし）。structured の図は見出しを余白の中に置くので近くならない。
- **実測（`research/173-paper-theme/`。同じ YAML を `paper` と `color` で）**:

  | 図 | Theme | 自然な幅 | 縮小率 | 縮小後の文字（node / 辺 / 添字） | 診断（error / warning / info） |
  | --- | --- | --- | --- | --- | --- |
  | A | paper | 79.2mm | 1 | 8 / 7 / 4.9pt | 0 / 0 / 0 |
  | A | color | 87.14mm | 1 | 8 / 7 / 4.9pt | 0 / 0 / 0 |
  | B | paper | 224.5mm | 0.8016 | 6.41 / 5.61 / 3.93pt | 0 / 0 / 1 |
  | B | color | 252.6mm | 0.7126 | 5.70 / 4.99 / 3.49pt | 7 / 0 / 3 |
  | C | paper | 230.4mm | 0.7814 | 6.25 / 5.47 / 4.38pt | 0 / 0 / 1 |
  | C | color | 232.5mm | 0.7743 | 6.19 / 5.42 / 4.34pt | 0 / 0 / 1 |

  研究の B は原図に合わせて枠のない箱（`filled`）と寸法の `sublabel` を使い、C は (a)(b) を `filled`、(c) を `dashed` にした版（研究の README）。辺のラベルと sublabel はどちらも 7pt（表の「辺」）。Inter が BIZ UDPGothic より約 14% 狭いので、A は 9% 狭く、B は縮小率が 0.71 → 0.80 に上がり、同じ YAML の `color` で error になる辺のラベル 4 つと sublabel 3 つ（4.99pt）が 5.61pt で下限を満たす。info は `script-too-small`（B・C）と、`color` の B の `edge-near-border` 2。
- **原図との比較（判断。詳細は研究の README）**: 角丸・パステルの塗り・小さい矢じり・サンセリフは 3 図とも原図に近づき、#174 の variant と #184 の sublabel で B・C の箱とパネルの描き方もほぼ原図どおりになった。残る主な差は、C の色の枠線で白地の箱と色つきの辺（tone の枠線、#167 §4.5）、B の薄表示の箱（`muted` と `filled` を同時に選べず、塗りも淡くならない。`dim` の継承、#167 §4.2）、数式の大きさ（上）、A の太い線（上の矢じり）、拡大線の代用（`zoom` で直せる）、C の行列・回転・絵文字など、A の縦の長さ（compact）。
- **新しい variant との関係**: `paper` は #174 の variant を含む全部品 × 全 variant の値を持つ（`theme/missing-variant` なし、テストで確認）。#184 の sublabel は variant を足さない。#181（`tokens`）は main に入っており、`paper` でも見本を描く。今後 variant を足す PR は、その PR で `paper` にも値を足す。
- **互換性（実測）**: 既存の 4 Theme の定義・フォントセットは変えていない。足したのは `paper` の定義と、それを作る `roundedBoxes()` だけ。リポジトリの `*.sumi.yaml` 120 個（`research/173-paper-theme/` を除く）を書かれた Theme と `minimal` / `academic` / `slides` / `color` で SVG に、書かれた Theme で PDF に描き（720 通り、うち出力のある 471 件）、main（#174・#184 を取り込んだ `3a25427`）と sha256 がすべて一致した。`CI=1 bun test`（PDF・画像 PPTX・編集可能 PPTX の golden）と `bun run gallery:check` は、golden とギャラリーへの `paper` の追加（ギャラリーの SVG 25、PDF・画像 PPTX の hash 各 22、編集可能 PPTX の hash と slide XML 各 42）だけで通る。既存の hash は 1 つも変わらない。
- **カタログ・ギャラリー・Skill**: `sumi catalog` の Theme に `paper`（`fonts` は `sumi/inter-biz-ud-gothic`、`compatibleProfiles` は paper-single・paper-double）が自動で加わる。ギャラリーは全部品 × variant・tone・pipeline の比較に `paper` の列が加わる（auto の図なので欧文も BIZ UDPGothic）。Skill の Theme の選び方・表・tone・診断の表に `paper` を足した。
- **テスト**: `theme.test.ts`（組み込みの 5 Theme とフォントセット、`paper` の角丸を付ける部品と付けない部品、枠と辺の線幅、辺の線幅が `academic` と同じ、8 色の tone）、`catalog.test.ts`（`paper` の文字の大きさと `compatibleProfiles`、フォントセット）、`stage.test.ts`（`theme/unknown` の hint）。全部品 × variant を完全に解決できることは既存の組み込み Theme のテストが `paper` にも回る。
- **非対象**: 既存 Theme の変更、利用者定義の Theme、矢じりの大きさ・数式の倍率のプロパティ。

### 6.53 #175 の薄表示の継承（`groups[].dim`）

[#167 の調査](../research/167-stage-c.md) §4.2（図 B の B-3）と [#86](../research/86-paper-figures.md) §8。DiT（Fig. 3）の 3・4 番目のパネルは、文字・線・矢じり・枠・キャプションが灰色で、tone の塗りも淡い（原図を見て確かめた）。今は `variant: muted` を node・辺・group の 53 か所に書いて近似し、それでも塗りは tone のまま濃く、キャプションは黒いままだった。group に 1 か所書けば、その group と中のすべてが薄くなるようにする。Figure v1 への任意フィールドと Theme の任意フィールドの追加で、**`dim` を書かない図**の診断・IR・Layout IR・D2・SVG・PDF・PPTX はバイト単位で変わらない（下記）。

- **構文（判断: variant ではなくフィールド）**: `groups[].dim: true`（`tone` の直後。`fmt --canonical-order` でもこの位置）。#167 §4.2 の理想の YAML は `variant: dim` だったが、次の理由でフィールドにした。
  - **variant は 1 要素に 1 つ**（§4.3、§6.49 の「`filled` と `muted` は両立しない」）。薄くしたいパネルにも自分の見た目（`dashed`・`plain`・`filled` の枠、凡例の `plain`）があり、`variant: dim` ではそれを捨てることになる。薄表示はその見た目を**変換**するもので、見た目の選択肢の 1 つではない。
  - **variant は継承しない**。variant は部品ごとに manifest が持つ閉じた一覧で、Theme の `components.<id>.<variant>` が要素自身のスタイルを決める（§4.3）。`dim` は子孫すべてに及ぶので、性質が違う。`variant: dim` にすると、すべての group の部品（container・legend・利用者の部品）の manifest に `dim` を足し、Theme の全部品に同じ層を書かせることになる。
  - `tone`（§6.20）と同じ「Theme が色を決める、部品をまたいだフィールド」の扱いで、スキーマの慣例に合う。
  - 値は **`true` だけ**（`false` は `schema/invalid-value`）。薄表示は内側で取り消せない（下記）ので、`dim: false` を「内側で戻す」と読まれる書き方を許さない。薄くしないなら書かない。
- **Theme の `dim`（判断: 透明度ではなく、Theme の色と白への寄せ方）**: Theme に任意の `dim: { fontColor, stroke, lighten }` を足した（3 つとも必須。token 参照可）。`fontColor` と `stroke` は色（`transparent` は `theme/invalid-value`: 薄くした文字と線も見えなければならない）、`lighten` は 0〜1 の数（範囲外は `theme/out-of-range`、数でなければ `theme/type-mismatch`）。#86 §8 のとおり `opacity` は使わない（PDF/X の透明、編集可能 PPTX の再現、下に重なる線が透ける問題を避ける）。解決結果は不透明な 16 進の色で（白へ寄せた塗りは `#rrggbb`。`dim.fontColor`・`dim.stroke` は Theme に書いた形のままで、`#rgb` もありうる）、どの出力でもただの色になる。
  - **変換の規則**（`dimStyle()`、`src/core/theme/dim.ts`）: 解決したスタイル（§4.3 の全層と tone の後）の**色だけ**を変える。見える `stroke`（線・枠・矢じり）は `dim.stroke`、`fontColor`（ラベル・見出し・キャプション・sublabel・アイコン・operator の記号）は `dim.fontColor`、`fill` は白へ `lighten` の割合だけ寄せる（各チャンネル `c + (255 − c) × lighten` を四捨五入）。`transparent` は透明のまま。塗りが要素自身の線の色と同じもの（junction の点など「インク」）は線と同じ `dim.stroke` にする（寄せると点と輪郭が 2 色になる）。同じかどうかは `#rgb` を `#rrggbb` に展開して比べる（`#000` と `#000000` は同じインク）。大きさ・フォント・破線・不透明度は変えないので、配置・経路・診断は `dim` の有無で変わらない（下記のテスト）。
  - **塗りを Theme の固定の色表にしなかった理由**: tone ごとの淡い色だけを持つと、tone 以外の塗り（group の surface、`emphasis` の highlight、`filled` の灰色、凡例の紙の色、tone を書いた group の塗り）の行き先がない。塗りを 1 色にまとめると、薄くした group の中の `filled` の箱が group の塗りと同じ色になり消える。白への寄せなら、どの塗りにも同じ規則が働き、濃淡の順序（group の塗りより中の箱が濃い、など）が保たれ、tone も色相のまま淡くなる。値を決めるのは Theme（割合と 2 色）で、利用者が色を書くことはない。
  - **組み込み Theme の値**: `minimal`・`color` は文字・線 `#8c959f`（白に対して約 3:1。原図の灰色の文字・線に近い）と `lighten: 0.5`（`color` の blue `#cfe8f3` → `#e7f4f9`、orange `#fbe1c0` → `#fdf0e0`。原図の淡い塗りとほぼ同じ割合）。`academic` は無彩色の `#8c8c8c` と 0.5。`slides` は投影で淡い色が飛ぶので、濃い `#808080` と 0.4。`paper`（§6.52）は DiT の原図の薄いパネルを測った値: 文字・線 `#949494`、`lighten: 0.5`（原図の淡い青 `#e8effd`・緑 `#e8f3e4`・パネルの塗り `#f9f9fb` は、`paper` の tone と surface を白へほぼ半分寄せた色。surface `#f3f3f5` → `#f9f9fa`）。
  - Theme が `dim` を持たない場合（今は組み込みのみなので起きない）は、`dim: true` の位置に `theme/missing-dim`（warning）を出し、薄くせずに描く（`theme/missing-tone` と同じ扱い）。
- **どの要素を薄くするか（判断）**（`dimmedElements()`）:
  - `dim: true` の group と、その中のすべての group・node（`group` を親へたどる。structured では `layout` 段が配置の木から `group` を補った後、`attach` した node は相手の group に入っている）。親の循環（`ref` 段が報告済み）では止まる。
  - **展開した要素**も同じ規則で決まる: 凡例（§6.34）の枠・文字・見本の線と箱、tokens（§6.50）のセルは親をたどって中に入る。**キャプション**（§6.32）は枠の外に描くため、展開したノードの親は group の親になっている。キャプションは group の一部なので、`doc.captions` から**キャプションの group** の薄表示を引き継ぐ（原図のキャプションも灰色）。
  - **辺は両端がともに薄い要素のとき**だけ薄くする。group に入る・出る辺（片端だけが中）は、薄いパネルと薄くない要素をつなぐもので、どちらにも属さないので書いたまま描く（薄くしたければ `variant: muted`）。端が薄い group そのもの（`to: cross`）なら、その端は中とみなす。セル参照（`<node>.<cell>`）は展開の段でセルの ID に置き換わっているので、セルで判定する。`zoom`（§6.45）も辺なので同じ規則で、外の node から薄いパネルへの拡大線は薄くしない。
  - **入れ子**: 薄い group の中の `dim: true` は何も変えない（色は 1 回だけ変換する。2 回かけて更に淡くはしない）。内側で取り消す手段はない（取り消せると「薄いパネルの中の 1 つだけ濃い」を書けるが、需要が出てから別のフィールドとして検討する）。診断の参照は最も外側の `dim` を指す。
- **描画**: 変換は `theme` 段で `state.styles` に入れる実効スタイルそのものなので、以降の IR・両エンジン・inspect・幾何 lint・PDF・PPTX は普通のスタイルとして扱い、描画側の変更はない。
  - structured の辺のラベルの背景（§6.41）と中を塗らない矢じりの内側（§6.43）は、下に塗られている group の**解決後の塗り**から決まるので、薄くした group の上では薄い塗りになる（テストでラベルの背景を確かめた。中を塗らない矢じりは組み込み Theme では YAML から描かれない）。
  - **auto（D2）**: D2 のスタイルは要素ごとなので、そのまま描ける（group・node・キャプションの container・辺の `stroke`・`font-color`・`fill`）。auto の辺のラベルの背景は従来どおり辺の `fill`（白）で、§6.41 と同じく対象外。
  - 編集可能 PPTX は解決した色を `srgbClr` に書く。
  - **画像（判断: 診断する）**: `component: image` は利用者の画像をそのまま描くので、色では薄くできない。薄い group の中の画像には `theme/undimmed-image`（warning、その node の位置）を出し、画像はそのまま、枠（`framed`）の線だけを薄くする。透明度で薄くすることはしない（上記の方針）。
- **互換性**: `dim` を書かない図では `dimmedElements()` が空で、スタイルは前と同じオブジェクトになる。リポジトリの `*.sumi.yaml` 125 個（新しい fixture を除く）を、書かれた Theme と組み込みの 5 Theme（`paper` を含む）で描き、SVG 276・編集可能 PPTX の slide XML 171・描けなかった 474 件の診断を、変更の前（origin/main、#205 の後）と後で sha256 で比べ、すべて一致した。`bun run gallery:check`・PDF・PPTX・画像・D2・lint の golden も変わらない（golden の再生成で差分なし）。ギャラリーには薄表示の見本 5 枚（`docs/gallery/dim/`）と目次の節が**追加**された（既存の SVG は無変更）。スキーマには `groups[].dim` が加わった。
- **DiT での確認**: `tests/fixtures/figures/dim/b-dit.sumi.yaml`（`research/167-stage-c/figures/b-dit.sumi.yaml` の写しで、53 か所の `variant: muted` を消し、2 つの group に `dim: true` を書いただけ。研究の記録は変えていない）を `color` と `paper` で PNG にして原図と並べ、3・4 番目のパネルの文字・線・矢じり・⊕ が灰色、tone の塗りが淡い版、枠が灰色で塗りがごく淡い灰色、キャプションが灰色になり、2 番目のパネルと左のパネルは変わらないことを確かめた。`paper`（§6.52）で描くと、薄いパネルの枠は角の丸い灰色の枠になり、原図にさらに近い（角の丸めは Theme の `radius` で、`dim` は変えない）。
- **テスト**: `dim.test.ts`（白への寄せ・`#rgb`・透明、変換が色だけでインクの塗りは線の色、全組み込み Theme の `dim`、Theme の検査（token・欠けたフィールド・透明・型・範囲・未知のフィールド）、対象の決め方（group・入れ子の group・node・キャプション・両端が中の辺だけ・入る辺・出る辺・group への辺）、入れ子の `dim` が 1 回だけで最も外側を指すこと、内側だけの `dim`、`attach` した node（中の node に付けると中、薄い group 自身に付けると外の兄弟）、別々に薄くした 2 つの group の間の辺と `zoom` が薄いこと、`#000` と `#000000` を同じインクとみなすこと、全組み込み Theme で薄い要素だけが `dimStyle()` の結果になり他は同じ・group の破線と tone の淡い塗りが残ること、凡例・tokens のセル・セル間の辺が薄く外からの `zoom` は薄くないこと、`dim: false`、`theme/undimmed-image`、`theme/missing-dim`）、`dim.integration.test.ts`（DiT: 配置・経路・診断が `dim` なしと同じ、3・4 番目のパネルの要素の文字・線は dim の色・塗りは白へ寄せた色、ほかの要素の markup は同じ、パネル内の線（wire）だけが灰色、変わった辺（矢じり）は 9 本で dim の色だけ、編集可能 PPTX に dim の色、薄い group の上の辺のラベルの背景、auto の D2 のスタイルと D2 で描いた SVG の色）。
- **非対象・引き継ぎ**: 透明度による薄表示（#175 の非対象）、内側での取り消し、node・辺単位の `dim`（node・辺には `variant: muted` がある）、画像を薄くすること。

### 6.54 #177 の tone の枠線（`variant: outlined`）と辺の `tone`

[#167 の調査](../research/167-stage-c.md) §4.5（C-2・C-9）。H3-World（C）は、白地に色の枠線と色の文字の箱（H3 Encoder の紫、Visual VAE Encoder の橙、トークンの紫・橙・灰、キーの橙・青）と、色のついた辺（橙・ピンク・青）を多く使う。これまで tone は node と group の塗りだけを変え（§6.20）、辺には付けられなかった。Figure v1 への任意フィールド・variant と Theme の任意フィールドの追加で、**`outlined` も辺の `tone` も使わない図**の診断・IR・D2・SVG・PDF・PPTX はバイト単位で変わらない（下の実測）。原図と並べた記録は [`research/177-outlined-tones/`](../../research/177-outlined-tones/README.md)。

- **構文（判断）**:
  - node の **`variant: outlined`**: 白地（Theme の紙の色）で、枠線と文字を tone の色にする。`filled`（§6.49）と同じく manifest の variant で、box・square・circle・ellipse・diamond・hexagon・parallelogram・cylinder・document・trapezoid・operator に加え **stack にも付ける**（枠線が残るので重なりは分かれる）。label（枠がない）・junction（点）・image・legend・tokens・container には付けない。名前は #167 §4.5 の理想の YAML どおり。
    - variant にした理由: 「tone を塗りに使うか、枠と文字に使うか」は見た目の選択肢の 1 つで、継承もしない（§6.53 の `dim` をフィールドにした理由の逆）。`toneOn: border` のような新しいフィールドにすると、tone のない要素で意味を持たず、`filled`（枠なし）との組み合わせ（枠なしで枠の色）も無意味になる。variant ならカタログ・ギャラリー・`theme/missing-variant` にそのまま乗る。
    - variant は 1 つなので、`outlined` と `muted`・`emphasis`・`filled` は同時に選べない。原図の Encoder と A のセルは「淡い紫の塗り＋紫の枠＋紫の文字」だが、`outlined` は白地にした（V のセル・VAE・キーは白地で、白地の方が多い。塗りと色の枠を両方持つ variant は需要が出てから検討する）。
  - edge の **`tone`**（`edges[].tone`、`variant` の直後）: 値は node と同じ 8 色。線・矢じり・ラベルの文字を tone の色にする。#92 で「edge の tone は段階 C」と後回しにした項目（§6.20）。props ではなくフィールドなのは node と同じ理由（部品をまたいだ、Theme が色を決める選択）。
- **Theme の `toneLines`（判断: 塗りとは別の、tone ごとの線と文字の色）**: Theme に任意の `toneLines.<tone>`（部分スタイル、`stroke` と `fontColor` だけ）を足した。`tones.<tone>` の淡い塗りは線や文字には薄すぎる（白地で 1.1〜1.4:1）ので、同じ色相の濃い色を別に持つ（#167 §4.5 の「塗りの淡い色は線・文字には薄すぎるので別の値」）。
  - **どちらの層を使うか**（`toneField()`、`src/core/theme/resolve.ts`）: node・group の variant が `outlined`（`OUTLINED_VARIANT`）なら `toneLines.<tone>`、辺は常に `toneLines.<tone>`、それ以外は従来どおり `tones.<tone>`。解決順の位置（variant の後、§4.3）は同じで、層が入れ替わるだけ。outlined の node には `tones`（塗り）を重ねない。`outlined` は Theme が別の層を選ぶ**予約された variant 名**になる（利用者の部品が `outlined` を持てば同じ規則が働く。今は組み込みのみ）。group の部品（container）には付けていないが、規則は kind によらない。
  - `fill` を書けない（`theme/inapplicable-property`）: outlined の塗りは variant が決め（白地）、辺の `fill` はラベルの背景（§4.1）なので、tone で変えると意味が混ざる。未知の tone 名は `theme/unknown-tone`、未知のプロパティは `theme/unknown-property`（hint は `stroke, fontColor`）。
  - Theme が `toneLines.<tone>` を持たなければ、従来の `theme/missing-tone`（warning）で、hint が `Add toneLines.<tone> to the theme` になる。組み込みの 5 Theme は 8 色すべてを持つ。
  - **線と文字は同じ色**: 枠と文字を別の色にする原図はなく、1 色の方が Theme の値と検査が単純。層は `stroke` と `fontColor` の 2 つを持てるので、別にしたい Theme は書き分けられる。
- **組み込み Theme の値（判断）**: どの色も**白地で 4.5:1 以上**（7pt の文字として読める。outlined の文字は白地に描く）。テストで全 Theme・全 tone を検査する。

  | Theme | gray | red | orange | yellow | green | blue | purple | pink |
  | --- | --- | --- | --- | --- | --- | --- | --- | --- |
  | `color`（token `ink.*`） | `#57606a` | `#cf222e` | `#bc4c00` | `#9a6700` | `#1a7f37` | `#0969da` | `#8250df` | `#bf3989` |
  | `paper`（token `ink.*`） | `#6b6e78` | `#c0392b` | `#bd5410` | `#857500` | `#3f7d3a` | `#2f62b0` | `#7240a8` | `#b8336a` |
  | `minimal`・`academic` | `#525252` | `#2e2e2e` | `#525252` | `#757575` | `#757575` | `#525252` | `#2e2e2e` | `#2e2e2e` |
  | `slides` | `#474747` | `#262626` | `#474747` | `#666666` | `#666666` | `#474747` | `#262626` | `#262626` |

  - `color` は GitHub Primer の各色相の前景色に近い値（blue は `accent` と同じ `#0969da`）で、コントラストは 4.87〜6.39:1。
  - `paper` は H3-World の原図の色の枠・文字・辺の色相（紫・橙・青・ピンク）に寄せ、4.5:1 に届かない明るい色（原図の橙の文字は約 3:1、黄は 2:1 未満）は 4.5:1 まで暗くした（orange 4.73:1、yellow 4.62:1）。紫・青・ピンクは原図の色に近いまま 5.6〜7.0:1。
  - 単色の Theme は塗りと同じ 3 段（§6.20: 明 yellow・green、中 gray・orange・blue、暗 red・purple・pink）に写し、**淡い塗りの tone ほど淡い線**にした（同じ段の tone は線も同じ。テストで検査）。minimal・academic は `#757575`（4.61:1）・`#525252`・`#2e2e2e`、slides は投影で薄い灰色が飛ぶので 1 段濃い `#666666`・`#474747`・`#262626`。暗い段は既定の線（`#1f2328` / `#000000`）とほとんど見分けられないが、灰色で印刷できる方針（§6.20）を優先した。
- **outlined の見た目**: 塗りは Theme の紙の色（minimal・slides・color は `{color.bg}`、academic・paper は `{color.paper}`。すべて白）、枠と文字は tone の線の色。**tone がなければ tone gray の線**（`filled` が tone なしで tone gray の塗りになる §6.49 と同じ考え。既定の黒のままでは `default` と同じ見た目になる）。線幅・角丸（paper の 2pt）・文字の大きさと太さは `default` のまま。原図の Encoder・VAE の文字は太字だが、太字は `emphasis` の役割で、`outlined` に含めると V のセルやキーまで太字になるので含めない。tone gray の線は `muted` の灰色（paper `#737373`、color `#6e7781`）と近いので、tone のない `outlined` は `muted` に似て見える（ギャラリーの部品の見本）。用途は tone と組み合わせることで、Skill にもそう書いた。
- **辺の tone の見た目（判断: 線・矢じり・ラベルの文字）**: 辺の `stroke`（線と矢じり。structured の writer は矢じりを線の色で描き、D2 も connection の `stroke` で矢じりを描く）と `fontColor`（ラベル）を変える。ラベルの背景（`fill`、§6.41）は変えない。ラベルも色にしたのは、色の線の横の黒い文字より、どの線のラベルかが分かりやすく、`toneLines` の色は文字として読める値にしてあるため。線幅・破線・矢じりの形は variant のまま（`variant: dashed` と `tone: orange` は橙の破線）。
  - **合流（注意）**: `fanIn: merge`（§6.33）で同じ点に入る辺は経路を共有するが、structured の writer は線の色ごとに別の wire を描く（線の様式が違えば wire を分ける既存の規則）。色の違う 2 本が同じ点に入ると、共有した区間で 2 色の線が重なり、縞に見える（H3-World の ⊕ で確認）。原図どおり別の向き（`toAnchor: north` / `south`）から入れるか `fanIn: spread` にする。色ごとに合流を分ける変更はルータにまたがるので、この Issue ではしない（Skill に書いた）。
- **legend（§6.34）**: 辺の見本に `edge.tone` を足した（node の見本は既に `variant`・`tone` を持つので、`node: { variant: outlined, tone: orange }` がそのまま outlined の見本になる）。`lint/unused-legend-entry` は辺でも tone を比べる（従来は辺に tone がなかった）。hint の文言を「component, variant and tone」に揃えた（golden への影響なし）。
- **tokens（§6.50）**: セルは普通の node なので変更はない。`props.variant: outlined` で全セルを枠線にし、セルの `variant: filled` で押したキーなど 1 つだけ塗りにできる（H3-World のキー）。
- **dim（§6.53）との関係**: `dim` は解決後のスタイルの色を変換するので、薄い group の中の outlined の node は枠と文字が dim の灰色、塗りは白のまま、両端が中の色の辺は線・矢じり・ラベルが dim の灰色になる（テストで確認）。片端が外の辺は従来どおり書いたまま（tone の色）。
- **auto（D2）**: tone の層も解決後のスタイルなので、D2 には `stroke`・`font-color` として書くだけで、writer の変更はない。node の枠・文字、辺の線・矢じり・ラベルが同じ色になることを D2 v0.9.0 で確認した（`outlined-tones.integration.test.ts`）。全部品 × 全 variant × 全 Theme の描画テストが `outlined` を自動で含む。
- **カタログ（§6.10 のフィールドの追加）**: Theme の項目に `toneLines`（線の色を持つ tone 名、`TONE_NAMES` の順）を足した。部品の `variants` に `outlined` が加わる。
- **ギャラリー**: 部品の見本に `outlined` の列が加わる（12 部品 × 5 Theme の SVG と、それに伴う PDF・PPTX の golden。slides の stack は variant が 4 つになり、§6.49 の規則で presentation-16x9 で描く）。tone の節の後に **「Outlined tones and edge tones」**（`docs/gallery/tones/outlined.<theme>.svg`、5 Theme）を足した: 8 tone の outlined のセル（tokens）の列、同じ tone の塗り（`default`）の列、その間の 8 色の辺、outlined と辺の見本を含む凡例。既存の tone の見本（`tones.<theme>.svg`）は変えない。
- **H3-World での確認**（`research/177-outlined-tones/`）: #173 の図を読み、Encoder・VAE を `outlined`、キーを塊の色の `outlined`（押したキーは `filled`）、(a)(b) のトークン列を `outlined` のセルの tokens、VAE の辺を橙、⊕ への辺をピンクと青にした写しを生成し、`paper` と `color` で描いた。原図と同じ位置に同じ色が出て、縮小率（0.7814 / 0.7743）と診断（info 1、warning 90）は #173 の図と同じ。残る差は Encoder と A のセルの淡い塗り、太字、押したキーの濃い塗りと白い文字、行列の見出しの色の文字、⊕ の塗り（研究の README）。
- **互換性（実測）**: リポジトリの `*.sumi.yaml` 126 個（新しい fixture を除く）を、書かれた Theme と組み込みの 5 Theme で `sumi render --json`（756 通り、SVG が出たもの 503）し、SVG と診断（code と message）の sha256 を変更の前（origin/main `7aeb996`）と後で比べ、すべて一致した。`bun run gallery:check` は、意図した追加（部品の見本 60 枚、outlined の見本 5 枚、`README.md`・`index.html`）だけで通り、examples の SVG・PDF と既存の tone・dim の見本は変わらない。PDF・画像 PPTX・編集可能 PPTX の golden は部品の見本の分だけ変わり、examples・日本語の fixture の hash は変わらない。D2・lint の golden は変わらない。
- **テスト**: `tone-lines.test.ts`（全組み込み Theme が 8 色の `toneLines` を `stroke`＝`fontColor` で持ち白地 4.5:1 以上、color・paper は 8 色、単色は塗りと同じ 3 段で淡い塗りほど淡い線、カタログ、`toneField()`、outlined が白地に線の色・tone なしは tone gray、辺の 4 variant で色だけが変わる、`toneLines` の欠けた tone、検証（token 参照・`fill` と他のプロパティ・未知の tone・未知のプロパティの hint）、figure の theme 段（outlined・辺・凡例の見本）、凡例の未使用の検査が辺の tone を比べる、薄い group の中で dim の色、辺の未知の tone の hint）、`tones.test.ts`（辺が tone の線の色を取る）、`outlined-tones.integration.test.ts`（structured の paper・color で枠・文字・wire・矢じり・ラベルの色と幾何 lint が空、編集可能 PPTX の freeform・glued の両方で node の塗り・枠・文字と辺の線・矢じり（線の `tailEnd`）・ラベルの色、D2 で同じ色）、`samples.test.ts`（slides の stack が presentation-16x9。tone・outlined・dim の見本が全 Theme で構造の lint に何も出さず、部品の見本は `lint/no-edges` 以外の warning・error がない。凡例の見本が図に使われない `lint/unused-legend-entry` を防ぐ）。編集可能 PPTX の corpus（`scripts/pptx-validator/editable-corpus.ts`）に outlined の見本 5 枚を足した（golden の slide XML と hash の追加）、registry・catalog・CLI の既存テストの variant・項目の一覧。
- **非対象・引き継ぎ**: 任意の色の値（#177 の非対象）、塗りと色の枠を同時に持つ variant・濃い塗りに白い文字の variant（押したキー）、container の `outlined`、label の色の文字（行列の見出し、#167 §4.9）、色ごとの合流の分離。

### 6.55 #182 の詰めた間隔（`figure.layout.density: compact`）

[#167 の調査](../research/167-stage-c.md) §4.6 の (c)。原図は Sumi より密で、DiT を原図と同じ 170mm 幅にそろえても Sumi の版は 17〜25% 高かった（`paper` の #173 の版では 33.5%）。余白を半分にしただけでは変わらず、効くのは間隔と 1 行の箱の高さ（§4.6）。利用者の判断（2026-10-28）: 縮小後の実効の文字の下限は原図並み（5pt。§6.48 の `minScaledFontSize`）とし、密度は間隔を詰めて原図に近づける。3 図の記録は [`research/182-compact/`](../../research/182-compact/README.md)。

- **構文（判断: `figure.layout.density`）**: `figure.layout.density: compact`（値は `normal` | `compact`、省略は `normal`）。structured の図だけで、auto の図に書くと `fanIn` などと同じ `layout/structured-only`（error。`normal` でも。黙って無視しないため）。任意フィールドの追加なので Figure v1 のまま。`figure.fit`（§6.48）は配置を変えず出力の大きさだけを変えるので `figure` の直下に置いたが、`density` は配置そのものを変えるので、配置を決める欄（`arrange`・`align`・`fanIn`）の並びの `figure.layout` に置く。
- **値の置き場所（判断: Profile が値を持ち、図が選ぶ）**: 間隔の値は §6.21 のとおり Profile の `layout`（`arrangeGap`・`groupPadding`・`nodePaddingX` / `nodePaddingY`）にある。Profile の `layout` に同じ 4 項目の組 `compact` を足し、図の `density: compact` がその組を選ぶ。配置エンジンは `spacedProfile(profile, density)`（`src/core/profile/schema.ts`）で 4 項目だけを差し替えた Profile で配置する（`placeStructured`、キャプションとの間の `groupPadding / 2` を決める `buildFigureIR`）。ページの上限・余白（margin）・文字の下限・auto の値（`layerGap`・`containerPadding`）は変えない。compact の各値は通常の値以下でなければならず（`validateProfile`。超えれば `layout.compact.<項目>` の位置に `profile/invalid-value`。等しいのは可）、compact が図を通常より広げることはない。定義で `compact` を省略すると paper 系の値（`COMPACT_DEFAULTS`）と通常の値の小さい方を項目ごとに取る（既存の定義はそのまま通り、通常の間隔が小さい Profile でも compact が広がらない）。他の案を採らなかった理由:
  - **新しい Profile（`paper-double-compact` など）**: Profile はページ（物理的な出力先）を選ぶもので（§5）、同じページの Profile が密度ごとに増える（single / double × normal / compact）。組み込み Profile の一覧は `exceeds-page-width` の hint の「より広い Profile」（`largerBuiltinProfiles`、#114）と、Theme のカタログの `compatibleProfiles` に出るので、足すと**既存の図の lint の文面とカタログの出力が変わる**。
  - **Theme（`paper` の密度の設定、または `paper-compact`）**: Theme は見た目（色・線・文字・角丸。§4.1）を持ち、間隔を持たない（§6.21 で Profile に置いた）。Theme に間隔を持たせると、Theme を差し替えたときに配置まで変わる。また `paper` の既定を変えると #173 の出力が変わる。
  - 値を Profile に置くのは、間隔が文字の大きさとともに媒体で変わる値だから（presentation-16x9 は paper の 2 倍。compact も 2 倍にした）。
- **値（判断。paper-single・paper-double）**:

  | 項目 | 通常 | compact | 理由 |
  | --- | --- | --- | --- |
  | `arrangeGap` | 4mm | 2.5mm | 1pt の辺の Theme（`minimal`・`color`）の矢じりは 6pt（2.12mm、§6.42）で、2mm 以下では縦に並んだ 2 つの箱の間の矢印が `layout/no-route`（「端が矢じりより近い」）になる。2.5mm は、試した組み合わせ（研究の B と縦 3 段・分岐 1 つの小さな図を、paper 系の Profile で `paper`・`academic`・`minimal`・`color` に差し替えたもの）でまっすぐな矢印が通った、控えめな既定値であり、どの図でも通る下限ではない: 曲がる辺・途中の障害物・辺のラベルにはもっと要ることがある（研究の B の Linear → Noise・Σ は 2mm では `color` で通らず、C では 3 か所に `gap` を書き戻した）。`slides` は paper 系の Profile では通常の間隔でも `layout/no-route` になる図が多く（§6.42）、compact でも研究の A で 10 件・B で 2 件出る。0.5pt の辺（`paper`・`academic`、矢じり 4pt）なら 1.5mm でも通るので、図に `gap` を書けば詰められる（Skill） |
  | `groupPadding` | 8pt | 6pt | 5pt では #167 の B の代用の引き出し線がパネルの枠に沿って走った（`edge-near-border`）。矢じりの前の余地（`paper` で 4 + 3 = 7pt、1pt の辺で 9pt。§6.42）が足りない側は配置エンジンが自動で広げる（`growPadding`）ので、6pt でも矢じりは枠に寄らない |
  | `nodePaddingX` | 7pt | 7pt | 左右を詰めると図が狭くなり、`fit: scale` の縮小率が上がって、原図の幅にそろえた高さはかえって増える（B: 4pt で 85.6mm、7pt で 82.8mm）。原図の箱も文字に対して横に広い。§4.6 の「余白を半分にしても変わらない」の原因 |
  | `nodePaddingY` | 3.5pt | 1.5pt | 1 行の箱が 17pt → 13pt（8pt の文字、行送り 10pt）。Inter の行の箱（ascender＋descender = 1.21em、§6.52）は行送り（1.25em）に収まり、字形の箱から箱の端まで 1.66pt（1pt の枠の内側の線まで 1.16pt）。1pt では 0.66pt で近すぎる |

  presentation-16x9 の compact は 2 倍（5mm・12pt・14pt・3pt）。行送り（文字の 1.25 倍、§6.21）は変えない: Inter の 1.21em より小さくできず、詰めても 1 行で 0.3pt しか変わらない。
- **書いた `gap` はそのまま（判断）**: `density` は既定値だけを変える。書いた `gap` を一律に縮める案は採らない: `gap: 0`・キーやトークンの間の小さな間隔・辺のラベルやバッジのために空けた間隔など、意図して書いた値を壊す。図を詰めるときは、通常の間隔のために書いた `gap` を外す（Skill）。研究の C では、外した後に足りなかった 3 か所（辺の経路・辺のラベル・バッジ）を書き戻した。
- **ルータと診断**: ルータの clearance（3pt）・矢じりの長さ・幾何 lint のしきい値は変えない。詰めた結果、経路が通らない・ラベルが重なる場合は今までどおり `layout/no-route`・`layout/edge-label-overlap`・`geometry/label-collision` などで報告され、図の作者がその箱にだけ `gap` を書く。自動で間隔を広げ直すことはしない（Issue の非対象「自動の詰め・折り返し」と同じく、配置を勝手に変えない）。
- **実測（`research/182-compact/`、Theme `paper`。原図の幅にそろえた高さ）**:

  | 図 | 間隔 | 印刷される大きさ | 縮小率 | 原図の幅での高さ（原図） | 縮小後の文字（node / 辺・sublabel / 添字） | 診断 |
  | --- | --- | --- | --- | --- | --- | --- |
  | A（paper-single） | 通常 | 79.2 × 140.58mm | 1 | 137.0mm（113.7mm、×1.205） | 8 / 7 / 4.9pt | なし |
  | A | compact | 76.02 × 114.83mm | 1 | 116.6mm（×1.026） | 8 / 7 / 4.9pt | なし |
  | B（paper-double、`fit: scale`） | 通常 | 180 × 96.15mm | 0.8016 | 90.8mm（68mm、×1.335） | 6.41 / 5.61 / 3.93pt | info 1 |
  | B | compact | 180 × 87.66mm | 0.8297 | 82.8mm（×1.217） | 6.64 / 5.81 / 4.07pt | info 1 |
  | B | compact＋縦の stack に `gap: 1.5mm` | 180 × 76.83mm | 0.8297 | 72.6mm（×1.067） | 6.64 / 5.81 / 4.07pt | info 1 |
  | C（paper-double、`fit: scale`） | 通常 | 180 × 129.14mm | 0.7814 | 縦横比 0.717（0.828） | 6.25 / 5.47 / 4.38pt | info 1 |
  | C | compact | 180 × 124.78mm | 0.8462 | 縦横比 0.693 | 6.77 / 5.92 / 4.74pt | info 1 |

  info はすべて `geometry/script-too-small`（§6.48）。warning・error は 0 で、縮小後の node・辺のラベル・sublabel の文字は 5pt 以上（数式の添字はそれより小さく、B で 4.07pt。§6.48 のとおり info）。compact の図は狭くなるので縮小率が上がり、文字は通常より大きく印刷される。A は原図並み、B は既定値だけで原図の 1.22 倍（通常は 1.34 倍）、図に 1.5mm を書けば 1.07 倍。B の残りは、長い縦の stack の junction（前後に間隔を 2 つ取る）と ⊕（`paper` で 16pt）で、間隔の値の範囲外。
- **互換性（実測）**: `density` を書かない図は、Profile に `compact` の値が増えても使わないので、出力は変わらない。リポジトリの `*.sumi.yaml` 125 個（この PR で足した研究と fixture の 6 個を除く）を書かれた Theme と `minimal` / `academic` / `slides` / `color` / `paper` で SVG に、書かれた Theme で PDF に描き（875 通り、うち出力のある 587 件）、main（`c596da4`）と sha256 がすべて一致した。`CI=1 bun test`（D2・PDF・PPTX・画像の golden）と `bun run gallery:check` も無変更で通る。変わったのは JSON Schema（`figure.layout.density` の追加、`bun run schema:check`）だけ。`sumi catalog` は structured の間隔を出していないので、`compact` も出さない（変更なし）。
- **Skill**: `layout-tips.md` に「Compact spacing」の節（使いどころ、書いた `gap` を外す、Theme ごとの矢印に要る間隔、衝突したらその箱だけ `gap` を書く）、`figure-format.md`・`structured.md`・`diagnostics.md` の structured 専用の欄の一覧に `density`、`SKILL.md` の structured の機能の一覧に `density: compact`。
- **テスト**: `profile.test.ts`（paper 系・presentation の compact の値、定義で省略したときの既定値と通常の値で頭打ちになること、通常の値を超える compact の `profile/invalid-value`（等しい値は可）、`spacedProfile` が compact だけで 4 項目を差し替え、ページ・余白・文字・auto の値と D2 の引数が同じ）、`layout.test.ts`（書いた値の保持と省略、IR の `meta.density`、未知の値の schema error、auto の図での `layout/structured-only`）、`caption.test.ts`（compact のキャプションとの間が compact の group の余白の半分）、`engine.test.ts`（compact の間隔・上下の余白・group の余白、`normal` と省略が同じ配置、書いた `gap` が優先、presentation の 2 倍）、`compact.integration.test.ts`（研究の B・A の複製を fixture にし、同じ YAML の通常の間隔と比べて、B の縮小率が上がり高さ／幅が下がること・印刷される大きさ・1 行の箱が 26 unit（13pt）・診断が `script-too-small` の info だけ、A の大きさと診断なし）。
- **非対象**: 自動の詰め・折り返し、書いた `gap` の縮小、auto（D2）の図の間隔、行送り・⊕ の大きさ・文字の大きさの変更、既存の Theme・Profile の値の変更。

### 6.56 #180 の行列（`component: matrix`）と斜線・class から作る凡例

#167 の調査（[§4.5](../research/167-stage-c.md)）と #86（[§7・§9](../research/86-paper-figures.md)）。H3-World（C）の (c) の注意のマスクは、行・列の見出しと、色と斜線で塗り分けたセル（Allowed は緑、A↔V Link は橙、Masked は斜線）の行列で、横に同じ塗り分けの凡例がある。これまでは 81 個のセルの box・19 個の見出しの label・行ごとの row の group で書いており（約 100 ノード）、空のセルが `lint/empty-label` を 81 件出し、斜線は描けなかった（Masked は白い box で代用）。凡例は見本の箱を別に書くので、行列の塗りと食い違いうる。legend（§6.34）・tokens（§6.50）と同じく、検査の後に普通の要素へ展開する部品にする。

- **部品**: `sumi/matrix`（kind `node`、variants `default`、since 0.6.0、`engines: ["structured"]`）。props:
  - `cells`（必須、1〜64 行）: 上の行から、各行のセルの **class 名**を左から。行は class 名のリスト、または文字列。文字列は空白で区切った class 名の並びで、**すべての class 名が 1 文字なら文字そのもの**（空白は無視。`"o...oooo."`）。#167 §4.5 の案の「1 行 1 文字列」を、1 文字でない名前（`allowed` など）でも書けるように広げた。規則は class の集合だけで決まり、曖昧さはない（1 文字の名前だけなら 1 文字ずつ、そうでなければ空白区切り）。
  - `classes`（必須、1 件以上）: class 名（空白を含まない 1〜16 文字。`.` も可）→ `{ tone?, variant?, pattern?: hatch, label? }`。`tone` と `variant`（セルの box の variant。`filled`・`outlined` など）はセルの見た目、`pattern: hatch` は塗りの上の斜線、`label` は凡例の文字。色の値は書かない（tone と Theme が決める。#92 の方針）。Issue の `fill` は tone で表す（任意の色は Figure の方針で書けない）。
  - `rows` / `columns`（任意）: 見出し。文字列（数式可）か `{ label, tone? }`。`tone` は**文字を tone の線の色**（`toneLines.<tone>`、§6.54）で描く（原図の A は紫、V は橙の見出し）。`corner`（任意）は行と列の見出しの間の文字（`Q / K`。両方の見出しが要る）。
  - `rowsAt`（`left` 既定 / `right`）・`columnsAt`（`top` 既定 / `bottom`）: 見出しの側。
  - `cellWidth`（既定 10pt）・`cellHeight`（既定 `cellWidth`）・`gap`（セルの間、縦横とも。既定 0 = 接する）・`headerGap`（見出しとセルの間。既定 `gap`）・`headerWidth`（行の見出しの幅。既定は文字の幅）・`variant`（すべてのセルの variant の既定。class の `variant` が優先）。
  - class 名の参照（凡例の `class`・セルの class）は**自身のプロパティ**だけを見る（`Object.hasOwn`）: `constructor`・`toString`・`hasOwnProperty` のような `Object.prototype` の名前は、書いていなければ class ではない（`ref/unknown-class`・`component/invalid-prop`。PR #211 のレビューで指摘、回帰テストあり）。`__proto__` という名前は Zod の解析で黙って落ちる（`classes` が空になる。Figure のスキーマの `props` の `z.record` も、props の直下の `__proto__` を部品の検査の前に落とす）。そこで、入力を**解析する前に**生の値をたどり、どの深さの `__proto__` のキーも報告する（`src/core/reserved-keys.ts`、PR #211 の 2 回目のレビュー）: 図は `schema/reserved-key`（error、そのキーの位置。値ではなく**キーそのもの**を指す。`validateFigure()`）、Theme の定義は `theme/reserved-key`（`validateTheme()`）、lint の設定は `LintConfigError`。どれも `z.record`（class・props・Theme の `tones` / `components`・lint の `rules` など）で同じく落ちていたキーで、一様に扱う。書いた図は error になる（リポジトリの図にこのキーはない）。
  - 検査（manifest の `superRefine`。`component/invalid-prop`、書いた位置）: 未知の class 名（その行。リストの行はそのセル。hint は近い名前か class の一覧）、最初の行と長さの違う行、行の数と違う `rows`、列の数と違う `columns`、両方の見出しのない `corner`、空の `classes`、65 個以上のセルの行。こうして展開は、整った格子だけを受け取る。セルの variant（`props.variant` と class の `variant`）は box の variant であることを展開が**書いた位置で 1 回だけ**確かめる（`component/unknown-variant`。セルごとに 81 回出さない）。
- **展開（判断: legend と同じ枠の group）**: 行列のノードは、**その ID の group**（`sumi/container` の `plain`: 枠も塗りもない。§6.49）になり、その中に普通のノードを置く。tokens（§6.50）と違い枠を作るのは、行列が**全体として**辺の端点・`align`・配置の木の項目になるから（C の `c-add-in → mask`、`mask → lora-out`）。書き下した版も `variant: plain` の group だったので、同じ形になる。行列のノードの `label` は枠の見出し（上）、`tone` は枠の tone、`group` は枠の親。
  - セル: `<行列>-<行>-<列>`（1 始まり。`mask-2-6`）の `sumi/box`。ラベルなし、`cellWidth` × `cellHeight`、variant は class の `variant` ?? `props.variant` ?? `default`、tone は class の `tone`。
  - 見出し: `<行列>-row-<r>`・`<行列>-col-<c>`・`<行列>-corner` の `sumi/label`。**行の見出しは高さをセルと同じに**（`height: cellHeight`。幅は文字、`headerWidth` があればその幅）、**列の見出しは幅をセルと同じに**（中央に揃う）。行の見出しの高さをセルに揃えないと、行の高さが文字の高さになり、縦の間隔だけが `gap` より広がる（書き下した版はそうなっていた）。文字が `cellHeight + gap` より高いと見出しどうしが重なり、`geometry/label-collision` が出る（ギャラリーの `slides` の 16pt の文字では 10pt のセルに収まらないので、見本は 22pt のセルにした）。
  - 配置の木: 各行のセルを `row { gap }`、行の見出しと合わせて `row { gap: headerGap, align: center, items: [見出し, セルの row] }`、行を `stack { gap, align }`、列の見出しを `row { gap }`（`corner` があれば `row { gap: headerGap, align: center, items: [corner, 見出しの row] }`）、全体を `stack { gap: headerGap, align, items: [列の見出し, 本体] }`（`columnsAt: bottom` なら逆順、`rowsAt: right` なら見出しを右に）。`align` は**セルの側**（見出しが左なら `end`）にする: 幅の違う行の見出しがあっても、セルは右端で揃い、見出しはセルの横に付く。見出しがなければ本体の stack だけ。
  - ID: 枠は行列のノードの ID を引き継ぐ（ノードは消える: `nodes[i]` を `undefined`、`component` 段の結果からも除く）。実際に作る部品の ID のうち最も長いもの（行・列の数と見出しの有無で決まる。例: 9 × 9 で見出しありなら `<ID>-row-9`・`<ID>-col-9`・`<ID>-corner` の 7 文字の接尾辞、見出しのない 1 × 1 なら `<ID>-1-1` の 4 文字）が ID の規則（64 文字）を超える行列は `component/invalid-prop`（ノードの `id`。メッセージにその ID）、利用者の要素・先に展開した要素が部品の ID を使っていれば `ref/reserved-id`（その要素。related は行列）で、その行列は展開せず無効にする（`src/core/figure/expand.ts` の共通の処理）。
- **順序（判断: legend より前）**: `checkFigure()` は `component` 段 → **行列の展開**（`expandMatrices()`、`src/core/figure/matrix.ts`）→ legend の展開 → tokens の展開 → asset 以降。凡例の `class` の項目が行列の class を引くので、行列を先に展開する（`doc.matrices` に class と、セルの既定の variant を置く）。足した部品は `resolveComponents()` の `only` で同じ `component` 段にかける。auto の図では展開しない（manifest の `engines` から `layout/structured-only`）。
- **共有した仕組み（tokens §6.50）**: 部品の由来（`doc.expanded`、`from: "matrix"`、名前は `cell 2, 6 (class "L") of matrix "mask"` など）、文書順（`nodeOrder()` が部品を行列のノードの位置に置く: Layout IR の `nodes` と SVG の描く順）、診断の位置（部品ごとの `fields`: セルのラベルはその行、`tone` / `variant` は class の書いた位置か `props.variant`、大きさは `cellWidth` / `cellHeight`、見出しのラベルはその見出し。`tokensCellPath()`・`remapTokensPaths()`・幾何 lint の `cellFieldPath()` が tokens のセルと同じ表で直す）、figure IR の印（`matrix: { id, variant, name, fields }`。枠と部品。幾何 lint の subject と名前は行列のノード、`writtenComponentOf()` は `sumi/matrix` にたどる）。文字列の行では 1 行のセルが同じ位置を持つので、セルの診断は行を指す（セルごとの診断は、variant を先に確かめたので組み込み Theme では出ない）。
- **セルへの参照（判断: 作らない）**: `<行列>.<行>.<列>` は作らない。原図にセルへの辺はなく、§6.50 の `REF_PATTERN`（`<ID>.<鍵>`）を 3 段に広げると構文と `ref/unknown-cell` の文が複雑になる。`mask.3` のような参照は従来どおり `ref/unknown-cell`（tokens でないノード）。必要になれば別 Issue。
- **塗りの追加の印（`doc.paints`）**: Figure の要素のフィールドではなく、展開だけが置く印。`hatch`（斜線のセル・凡例の見本）と `toneText`（tone のある見出し）。`theme` 段が読む:
  - `toneText`: tone の層を `tones`（塗り）ではなく `toneLines`（線と文字の色）にする（`StyleTarget.toneText`）。`label` の tone は塗りしか変えず、文字の見えない `label` では効果がないため。`label` に `outlined` の variant を足す案は採らない: 公開の variant が増え（カタログ・ギャラリーの `sumi-label` の図が変わる）、行列の見出しのためだけにしては大きい。
  - `hatch`: ノードのスタイルに **`hatch`（斜線の色）** を足す（`NodeStyle.hatch`。Theme の層では書けない、展開だけが付ける値）。色は `toneLines.<tone>.stroke`、tone がなければ `toneLines.gray` の線の色（outlined §6.54 と同じ「tone がなければ灰色」）。薄表示（§6.53）の `dimStyle()` は斜線を線として `dim.stroke` にする。斜線のないノードのスタイルは前と同じオブジェクト（`hatch` のキーもない）。
- **斜線の描き方（判断: 線分。SVG の `<pattern>`・クリップ・DrawingML の模様の塗りは使わない）**: #86 §7 の方針。`hatchSegments()`（`src/render/hatch.ts`）が、ノードの矩形から**右上がり 45° の線分**を計算し、角の丸め（`radius`）を含む輪郭の内側に**解析的に切る**（矩形を 2 つの箱と 4 つの角の円の和とみなし、凸なので線との交わりの区間の和が 1 つの区間になる）。輪郭の線幅の半分と斜線の幅の半分だけ内側に入れるので、丸い線端が枠に掛からない。間隔は x 方向に 5 unit（2.5pt。線と線の間は約 1.77pt）、幅 1 unit（0.5pt）、丸い線端で固定（junction の点の大きさと同じく、斜線は模様でデータではない）。線は矩形の中央に揃えるので、同じ大きさのセルは同じ斜線になる。0.25pt 未満の切れ端は描かない。
  - **SVG**: ノードの `g.shape` の直後に `<path class="sumi-hatch" d="M … L … M …" fill="none" stroke="…" stroke-width="1" stroke-linecap="round"/>` を 1 つ。`g.shape` の外なので、inspect・幾何 lint・編集可能 PPTX の形の読み取りは変わらない（形の外接矩形は矩形のまま）。描く順は塗り・枠 → 斜線 → ラベル。
  - **PDF**: krilla（usvg）が同じ SVG のパスをそのまま描く。内容ストリームは SVG の座標（`cm` の下、f32）で同じ線分の `m`・`l` になる（テストで照合）。
  - **画像方式の PPTX**: resvg の SVG と PNG。SVG の中の同じパス（f32 の座標）を照合した。
  - **編集可能 PPTX**: `path.sumi-hatch` の線分を、セルの箱に重ねた**線だけの図形**（`p:sp`、`custGeom` の `fill="none"` の path、`a:ln` は斜線の色と幅、`cap="rnd"`、名前は `<key> hatch`）にする。DrawingML の模様の塗り（`pattFill prst="wdUpDiag"` など）は、模様の大きさが印刷の倍率や PowerPoint の実装で決まり、間隔・線幅・位相が SVG と合わないので採らない。拒否（`pptx/unsupported-*`）もしない（線分で同じ絵が書けるため）。斜線の図形はセルと別の図形なので、セルを動かしても付いてこない（グループ化は接続の `stCxn` の参照先の id の扱いが変わるので今回はしない）。
  - **背景の規則（§6.41・§6.43）**: 辺のラベルの背景と中を塗らない矢じりの内側は、下に塗られている **group** の塗りから決まる。斜線はノードの上の線なので、その計算に入らない（辺のラベルがセルの上に乗る図は想定しない）。
- **凡例（判断: 項目 `{ class: <行列>.<class> }`）**: legend（§6.34）の項目に `class` を足した（`edge`・`node`・`class` のちょうど 1 つ）。見本の箱は、その class のセルと同じ規則（`box`、class の `variant` ?? 行列の `props.variant`、class の `tone`、斜線）で、文字は項目の `label` があればそれ、なければ class の `label`。行列の側に「凡例を出す」prop を持たせる案（`matrix.legend`）は採らない: C の凡例は行列から離れた位置（右端）にあり、配置の木で自由に置ける独立の legend の方がよい。class をまとめて展開する `{ classes: mask }` も作らない（1 項目 1 class の方が順序・ラベルの上書きが明確）。
  - `node` の項目の見本の箱と tokens のセル（§6.50）に `matrix` は書けない（`component/invalid-prop`、その `component` の位置。tokens と同じく「セルとして描かれる」部品）。
  - 診断: 行列でないノード・未知の class は `ref/unknown-class`（error、項目の `class`。hint は近い class か一覧）、ラベルのない class の項目は `component/invalid-prop`（項目）。エラーのある行列（展開しないもの）の class を指す凡例は、行列のエラーで説明済みなので黙って無効にする。
  - 互換性: 項目の検査を `refine` から `superRefine` に変え、`label` を任意にした。`label` のない項目の文は、従来の必須の文字列の文（`Invalid input: expected string, received undefined`）を同じ位置に出す。`edge` / `node` のどちらでもない項目の文は `an entry needs exactly one of "edge", "node" or "class"` に変わる（`legend.test.ts` を更新）。
- **lint**:
  - `lint/empty-label` はセルを対象外にする（受け入れ条件。見出しは文字が必須）。
  - **`lint/unused-matrix-class`**（新、warning、`props.classes.<name>`、subject は行列）: どのセルも使わない class。
  - `lint/unused-legend-entry` は `class` の項目を報告しない（使われない class は上の規則が報告する）。`node` の項目の「作者の描いた要素」には行列のセルを含める（`node: { tone: green }` で行列の緑を説明できる）。
  - `lint/no-edges` は行列の部品を作者のノードに数えない（legend の部品と同じ。行列と凡例だけの図に warning を出さない）。tokens のセルは数える（§6.50）のと違うが、行列は 1 つの図として書かれる。
- **ほかの機能との組み合わせ**: 薄表示（§6.53）は枠の親をたどってセル・見出しにも効き、斜線も dim の線の色になる（テスト）。`density: compact`（§6.55）は枠の余白だけが詰まる（セルの間隔は行列の props）。`fit: scale`（§6.48）は全体と同じく縮む。tone の枠線（§6.54）は class の `variant: outlined` で使える。
- **H3-World（受け入れ条件）**: `research/180-matrix/render.ts` が #177 の図から写しを作り（#177 の図は変えない）、行列を 1 つの `matrix` ノード（24 行。9 行の class の文字列、A は紫・V は橙の見出し、`gap: 1.5pt`、`variant: filled`、Masked は `pattern: hatch`）に、凡例を `{ class: mask.o }` などに、(c) の左のトークンの列を tokens に書き換える。class は #177 の box の tone から読む（green → `o`、orange → `L`、tone なし → `.`）。`src/render/matrix.integration.test.ts` が、`lint/empty-label` が 90 → 0 件でほかの診断は #177 と同じ（`paper` で info 1 件）こと、`o` / `L` のセルの塗りが #177 の同じ位置の box と同じで `.` のセルだけが斜線を持つことを確かめる。見た目は、枠のない灰色の塗りに斜線（`filled`）が原図の Masked に近い（`outlined` に斜線は枠が重い）。プレビュー: `research/180-matrix/previews/`。
- **互換性（実測）**: 新しい部品・凡例の項目・lint の規則の追加だけで、`matrix` と凡例の `class` を使わない図は、スタイルに `hatch` が付かず（`doc.paints` が空）、SVG に斜線のパスも出ないので出力は変わらない。リポジトリの追跡済みの `*.sumi.yaml` 133 個（この PR で足した `research/180-matrix` を除く）を、書かれた Theme と組み込みの 5 Theme で、main（`cc8c9cc`）と変更後のコードで描き（798 回、描画まで通ったもの 536）、D2 ソース 222・SVG 536・PDF 536・画像方式 PPTX 536・編集可能 PPTX の slide XML（freeform 405・glued 393）の sha256 がすべて一致した。診断が変わったのは、未知の部品の hint の部品の一覧に `matrix` が加わる 6 ファイル（lint の golden `no-cascade` を更新）だけ。JSON Schema は変わらない（部品の props は Figure のスキーマの外。`schema:check`）。ギャラリーには `sumi-matrix` の 5 図と目次が**追加**され、PDF・画像方式 PPTX・編集可能 PPTX の corpus の hash も追加だけ（既存の値は無変更）。
- **テスト**: `matrix.test.ts`（展開の形: 枠の group と配置の木・部品の ID と props・見出しの大きさ・`doc.paints`・由来・`doc.matrices`、行の 3 つの書き方と長い class 名、見出しの側・見出しなし・`headerWidth` / `headerGap`、既定値、文書順、IR の `matrix` と source map と枠への辺、全組み込み Theme の斜線の色と見出しの文字の色、tone のある斜線、薄表示の斜線、props の診断の位置と文・hint、variant の 1 回だけの診断、`attach` / `icon` / `sublabel` / `labelRotation` と枠の見出し、`ref/reserved-id` と長すぎる ID、auto の `layout/structured-only`、凡例の `class` の項目（見本・文字・上書き・`ref/unknown-class`・ラベルなし・`class` と `node` の両方・不正な書式・エラーのある行列）、lint（セルに `empty-label` なし・`unused-matrix-class`・`no-edges`））、`hatch.test.ts`（向き・間隔・中央揃え・平行移動で同じ・内側への寄せ・角の丸めの内側・空）、`matrix.integration.test.ts`（斜線の線分が SVG・PDF の内容ストリーム・画像方式 PPTX の SVG・編集可能 PPTX（両方式）の線の図形で一致し、色・幅・線端も同じ。H3-World。compact と薄表示）、試験基盤（`structuredPrimitivesFigure()` に行列、`builtins.test.ts` の `EXPANDED_AWAY`）、ギャラリー（`matrixSample()`: 見出しの tone・斜線の class・`outlined` の class・class から作る凡例・行列への辺）、`legend.test.ts`・`registry.test.ts`・lint の golden（部品の一覧に `matrix`）、編集可能 PPTX の corpus のテストは数式の見出しを文字で比べる、`skill.test.ts`（Skill の作例を描く）。
- **Skill**: `references/structured.md` に「Matrices」（構文・凡例の `class`・予約 ID・見出しの大きさと衝突・診断、描いて確かめる作例）と legend の `class` の項目、`figure-format.md` の部品の一覧、`diagnostics.md` に `ref/unknown-class`・`layout/attached-matrix`・`lint/unused-matrix-class` と予約 ID、`SKILL.md` の structured の機能の一覧に `matrix`。
- **非対象・引き継ぎ**: 連続値のヒートマップ（Issue の非対象）、セルへの参照・セルのラベル、auto（D2）の行列、回転した軸の見出し（原図の Query / Key。`labelRotation` の `label` ノードを横に置けば書ける）、斜線以外の模様（`pattern` は列挙なので追加できる）、枠の余白なしで辺をセルの端まで届けること（辺は枠で止まる。書き下した版と同じ）、編集可能 PPTX でセルと斜線をグループにすること。


### 6.57 #217 の矢じりの直前の段差の除去・幾何 lint と junction 端の保証

- **指摘された図の原因**: `research/185-acceptance/figures/c-h3world.sumi.yaml` の `out-proj → c-add-out` は、先端までの縦の差が **14.008 unit**。矢じりの hard stub（8 unit）は置けるが、§6.22 の推奨 room（16 unit）は置けない。従来は room 内の曲がりの費用 **100** が、曲がり 2 回分 **80** より高かったため、1.992 unit 下がり、0.913 unit 横に進み、16 unit 上がる S 字が、右からそのまま上がる経路より安くなった。さらに同じネットの別の矢じりの room 内では格子点ごとに 100 を足し、格子の密度で費用が増えていた。最初の実装は stub の長さだけを検査してこの段差を保持してしまったが、それではユーザーの指摘は解決しない。
- **費用の判断**: `ROUTE.arrowRoom` を **60**（曲がり 1 回の 40 より大きく、2 回の 80 より小さい）にし、別の矢じりの room は **領域に入るときだけ 1 回**払う。同じ領域内を直進する格子点ごとの課金を廃止する。既存の曲がり・幹線をずらして room を買う余地は残し、推奨余白だけのための余分な S 字を避ける**好みであり、保証ではない**。共有ネットの格子辺では曲がりの費用を省く場合があり、複数の room 進入・曲がりの費用も累積するため、`40 < 60 < 80` だけでは全経路の選択を拘束しない。直線長 ≥ 矢じり長の hard stub と §6.26 の writer の `keepStart` / `keepEnd` は維持し、余白不足時には丸めの半径を小さくする。交差・障害物・固定された口のずれを避けるための段差は禁止しない。
- **受け入れ図の修正後**: `(982.535, 694.327) → (1025.709, 694.327) → (1025.709, 680.319)`。曲がりは 1 回、最後の直線は **14.008 unit ≥ 8 unit**。`toAnchor: south` と青色を維持し、丸めた角は矢じりに重ならない。`tests/fixtures/figures/layout/arrowhead-room-jog.sumi.yaml` に 14 unit の隙間だけの最小再現を追加した。
- **実際に再現した穴（原因）**: junction は方向が自由で stub がなく、さらに `shortArrowEnd()` が junction 端を明示的に検査から除いていた。通常のポートは探索の hard stub と最後の長さの検査の二重の保証があるが、junction の矢じりだけは両方を素通りした。最小 fixture `tests/fixtures/figures/layout/arrowhead-on-bend.sumi.yaml` は、同じ行の箱の `east:0.6` から hidden junction に入る青い矢印で、修正前は最後の縦線が **3.4 unit < 矢じり 8 unit**。writer の `trimEnd()` が前の線分まで切り詰め、矢じりが曲がり角をまたぐ。`wire.ts` の `keepStart` / `keepEnd` は既にある線の丸めを制限するだけで、不足する直線を作れない。幾何 lint にはこの検査自体がなかった。
- **修正（判断: 問題のある経路だけ再探索）**: `shortArrowEnd()` は junction を含む両端を見る。自由な方向で引いた経路が短い場合だけ、矢じりのある junction の 4 方向を通常のポートと同じ hard stub（矢じりの長さ）で試し、妥当な経路のうち費用が最小のものを採る（同点は方向の順、両端 junction なら最大 16 通り）。通常の A*・費用・占有・格子を使い、アンカーや要素は動かさず、格子線も増やさない。候補がどれも引けない、または短いままなら `layout/no-route`（error）で黙って描かない。修正後の fixture の最終線分は **17.25 unit**。矢じりのない junction は従来どおり自由。最初から十分な直線のある図は再探索せず、既存の格子・経路・出力は同じ。
- **新しい幾何 lint（判断: `geometry/arrowhead-on-bend`、warning）**: 先端から最後の曲がりまで（矢じりに隠れる部分を含む）の直線が矢じりより短く、不足が幾何 lint 共通の許容 **1 unit = 0.5pt** を超えると報告する。誤読につながる描画の不具合なので `edge-through-node`・`edge-on-border` と同じ warning。始点の矢じりと終点の矢じりは独立で、位置は辺、メッセージに端・矢じりの長さ・直線長（印刷時の pt）、hint に anchor・gap・配置の変更を示す。比べる両方の長さが同率で縮むため `fit: scale` で判定は変わらない。
  - **描かれた幾何**: `GeometryElement.drawn`（§6.39、`paintedEdges()` の wire をエッジごとに持つ）で丸めた後の曲がりを測り、論理経路から先端を得る。別の辺の共有幹線は借りない。先端と triangle の底の間の「線を描かない部分」は曲がりではない。一直線上の中間点・重複点は無視する。透明な線、線幅 0、不透明度 0、凡例の見本は対象外。
  - **D2 の違いと誤検出の調整**: structured の矢じりは `4 + 4w` unit だが、固定版 D2 の triangle marker は長さ `4 + 3w`、`refX = 4 + 1.5w` なので先端が connection の端より `1.5w` 先にある。これを無視した最初の検査は 8 図（decision-flow・grouped・pipeline・#86 の v1 Transformer・compile/builtins・compile/structure・container-label・reversed-edge）で誤検出した。すべて PDF から PNG にして確認し、marker の先端の offset と、D2 の接線付近の弧の量子化の許容（1 unit）を反映した。D2 の triangle 以外は marker の寸法の契約が異なるので検査しない（structured はすべての矢じりの種類を検査）。しきい値を図ごとに緩める例外は作らない。
- **段差の幾何 lint（判断: `geometry/edge-jog`、info）**: エッジ自身の painted route の直線が、2 つの直角の間で **印刷時 1pt 未満**なら報告する。矢じりが重なる場合と別の診断で、矢じりの有無を問わない。同じ辺の接する subpath をまとめるが、切れ目・分岐はまたがず、同一直線の中間点・重複点を除く。曲線を平坦化した chord は直角の段差ではなく、端の stub も曲がり 2 回の間ではないので対象外。SVG の量子化は 0.002 unit だけ許容し、`fit: scale` を反映する。透明・線幅 0・不透明度 0・凡例の見本を除く。図ごとの閾値の例外は設けない。固定された口・共有幹線による既存所見で `--max-warnings 0` を壊さないよう patch release の既定は info とし、rule 設定で warning に昇格できる。
- **互換性と全図検査（実測）**: 費用修正前の **139 図 ×（元の Theme + 組み込み 5 Theme）= 834 通り**を描画し、成功 **568 通り**を比較。成功・失敗は変わらず、**50 出力**が変化し、すべて段差の除去か幹線の単純化だった。全変更と残った lint の所見を PDF → `pdftoppm` → PNG で確認した。`edge-jog` は **171 → 55 件**（残るのは 34 通りの実際の小さな段差、誤検出 0）、`arrowhead-on-bend` は 0。受け入れ図の own Theme は段差 2 件 → 0。最小再現追加後は **140 図・840 通り・成功 574 通り**で、既存 834 通りの出力と診断が再検査でも一致。gallery は **155 ファイル変更 0・新規診断 0**、PDF・PPTX・画像の golden も指定の更新コマンドで変更 0。全変更一覧と残る所見は [検証記録](../verification/217-arrowhead-jogs.md) に記載。
- **テスト**: 受け入れ図の正確な 3 点（曲がり 1 回）と 14 unit の最小 fixture、junction の全組み込み Theme・始点側・経路なし error・A* / Dijkstra の費用一致を検査する。lint は矢じりの短い端、始点・終点、境界・縮小・丸めた描画・D2 offset と、段差の正例・負例・印刷時の閾値・量子化・分割された描画・重複・同一直線・曲線・切れ目・分岐・透明な線を検査する。既存の fit と caption の統合テストは新たに可視化された実際の段差を辺 ID 付きで明示的に期待する。

### 6.58 #213 の中央寄せの箱にある `align` の収束と 2 手先の補助探索

再現は `research/185-acceptance/repro/align-residual.sumi.yaml`（#185）。原因は**中央寄せによる制約間の結合と、1 手だけで残差の和を減らす貪欲探索の局所的な停止**。レビューで示された、停止時だけの決定的な **2 手先の補助探索**を実装した。目的関数・採用状態の単調改善・許容値・上限・§6.36 の同点の規則を維持し、再現は 12 回 / 73 配置、残差 `[0.008, 0.006, 0]`、診断なしで収束する。

- **修正前の停止の原因**: 組み込みフォント・書かれた `paper` では、10 回 / 56 配置（診断の調べ込み）で残差 `[0.007, 0.006, 0.077]` unit、和 0.090。50 回 / 1,000 配置には達しない。最初の 2 制約は許容値以下なので案を作らず、最後の制約の案はいずれも和を増やす。予算を 100 回 / 2,000 配置にしても同じ結果になる。
- **中央寄せの作用**: 親から与えられる高さが変わらない範囲では、主軸の strut が枝の高さを s 増すと、中央寄せの原点が −s/2 動く。lead の後の項目は差し引き +s/2、ほかの項目は −s/2 動く。相手の枝や祖先の計測にも作用するので、常に「不足分を 2 倍すればよい」とはならない。再現の 3 制約は ID を共有しないが、同じ見出しの stack と、中央寄せされた列を介して結合する。
- **打ち切り時の実測**（配置エンジンの 0.001 unit の丸め後。候補を一時的に計測）:

  | 最後の制約への追加 | 残差 3 個（unit） | 和 |
  | --- | --- | --- |
  | なし（採用済み） | 0.007 / 0.006 / 0.077 | 0.090 |
  | 通常の lead（不足分 0.077） | 0.046 / 0.033 / 0.039 | 0.118 |
  | 通常の trail（不足分 0.077） | 0.031 / 0.045 / 0.039 | 0.115 |
  | lead を倍増（0.154） | 0.084 / 0.071 / 0 | 0.155 |
  | trail を倍増（0.154） | 0.070 / 0.083 / 0 | 0.153 |

  通常案は最後の残差をほぼ半減するので、丸めで動かなくなったのではない。どちらも和が厳密に増え、同点でもないので #155 の canvas の比較は原因ではない。小さい刻みも調べた: 1/8 の lead は和を 0.085 まで減らすが、候補を 2、1、1/2、…、1/64 倍に広げた試行も最終的に `[0.014, 0, 0]` で止まり、許容値を満たさなかった（元の停止位置からの追加探索）。単純な倍率・刻みの調整は一般の収束を保証しない。
- **修正**: 通常の 1 巡で和が下がらないときだけ、現在の各候補を配置し、そこから全制約の 2 手目の候補を再生成する。元は揃っていた制約も、中間配置で崩れれば修復の候補を出す。中間配置を採用せず、完成した組の和が元の和より厳密に小さい場合だけ採用する。同点は canvas 面積、さらに同じなら文書順・候補順で先の組。再現では制約 2 の trail で `[0.031, 0.045, 0.039]`（和 0.115）になった後、制約 1 を直す組が和を 0.090 → 0.047 に減らし、通常探索が再開して収束する。1 手目・2 手目の配置はすべて同じ `run()` を通り、`MAX_ALIGN_LAYOUTS = 1000` に数える。予算途中なら完成した改善組の最良だけを返し、未完の中間状態は返さない。反復上限 50 と診断の予算も維持する。
- **代替案と選択理由**: レビュアーの実験では、最大残差を目的関数にする変更だけ、または倍増だけでは解けなかったが、**最大残差の採用規則と倍率付き候補の組み合わせ**は 2 回 / 97 配置、`[0.001, 0, 0]` に収束した。単独の変更の失敗は組み合わせの失敗を意味しない。一方、目的関数を変えると通常の探索から既存の案の順位が変わる。2 手先の探索は既存の和の規則と単調改善を保ち、既に収束する図の経路には介入せず、既存予算で打ち切れるため採用した。一般の収束を保証する変更ではなく、解けなければ従来どおり `layout/unsatisfied-align`、予算を使い切れば `layout/align-search-limit` も出す。
- **回避策と回帰テスト**: 再現の root row の `align: start` は引き続き `[0, 0, 0]`。中央寄せでも制約を単独で解けば収束する。`align.test.ts` は残差を固定する旧テストを収束の回帰に置き換え、3 組の実座標・診断なし・12 回 / 73 配置・繰り返しと上限変更での決定性・補助探索の両手での予算切れ・未完の中間状態を返さないことを検査する。不可能な制約では callback の実呼び出し数と統計を独立に比較し、最初・貪欲探索・2 手先・診断の調べを含む 11 配置すべてと、各位置での予算切れを確かめる。Skill の回避策は補助探索でも解けない場合に限定した。
- **互換性と時間（実測）**: 138 ファイル × 書かれた Theme と組み込み 5 Theme = 828 ケースを修正前後に描画。成功 562 件のうち **556 件の SVG sha256 が一致**。変わるのは上記再現の 6 設定だけで、すべて以前 `layout/unsatisfied-align` があったものが収束した。失敗 266 件の診断コード・severity・path も一致。align-unet / side-kv の時間は 0.533 → 0.559ms / 0.545 → 0.521ms、再現は 4.201 → 5.524ms。停止する合成ケースには補助探索の費用がかかる（250 個の不可能な制約は 48.859 → 69.732ms、両方 1,000 配置以内）。全変更の hash と測定方法・合成ケースの数値は [検証記録](../verification/213-align-convergence.md)。生成物と golden の更新は不要。

### 6.59 #126 の配置の箱 `grid`

[#124 §3.4](../research/124-stage-b.md) と #167 の H3-World (a) の表状の配置。Figure v1 の配置の木に任意の箱を追加する。新しい箱を使わない図の出力は不変。

- **構文・順序**: `grid: { columns, rowGap?, columnGap?, align?, items }`。`columns` は正の整数。項目は ID・入れ子の箱（stack / row / grid）、または `{ item: IDか箱, span?: 正の整数 }`（省略は 1）。fmt の canonical order もこの順。常に左から右、上から下に埋め、`direction` は受け付けない（`schema/unknown-field`）。横の span だけを扱い、行をまたぐ span・自動折り返し・free は対象外。
- **空のセルと個数（判断）**: 空けたいセルには明示的な YAML `null` / `~`、複数列には `{ item: null, span: N }` を使う。自然サイズは幅・高さとも 0 で、列を消費するだけでノード・経路の障害物・net の端点を作らない。hidden junction は障害物と接続の意味を持つため、空セルの代用にしない。暗黙の穴・空文字・空の items は認めない（位置付き `schema/*`）。全行をちょうど `columns` 列分で埋める。項目が行の残りを越えると `layout/grid-span-overflow`（error、wrapper の `span` の位置）、最後の行が未完なら `layout/grid-item-count`（error、`items` キーの位置）。途中で自動改行する案は採らない: 空の列が暗黙に増えると、作者が列を予測しにくい。所属・未知 ID・重複配置は既存の検査を wrapper の `item` の位置で実行する。auto は既存の `arrange` の `layout/structured-only`。
- **1 パスの計測（判断）**: 子を下から計測し、span 1 の最大幅を列幅、各行の最大の高さを行高とする。次に span > 1 を文書順に見て、その列幅の和＋内部の columnGap が子の幅に足りないときだけ、不足をその span の各列に等分して足す（列幅は減らないので、それ以前の項目も収まる）。解の探索や整列 strut の反復は不要。計測結果は 1 回の配置 pass の間だけキャッシュし、align や padding の再配置では作り直す。既定の両 gap は Profile の `arrangeGap`（compact も含む）、明示値はそのまま。pt から unit への変換・最終の丸めは既存の規則。
- **揃え（判断）**: `align` はセル内の横方向の start / center（既定）/ end / stretch。縦方向は行の中央。stretch は stack と同じ伸縮可否で幅だけを伸ばす（高さや明示サイズは変えない）。grid は軸を持たず外からの align を継承しない。子の箱も center から始める。親から余分な領域を渡された場合は grid 全体を中央に置き、track は広げない。span 1 の同じ列は同じセルの x を持つ（start なら node の左辺も一致）。grid の内部には整列 strut を挿入しないが、子の stack / row と祖先の箱は従来どおり使える。ルータの箱の軸による側の選択は grid では使わず、矩形から選ぶ。
- **IR・展開**: Figure IR の箱に `kind: grid`・`columns`・項目と並行する `spans`・`rowGapPt?` / `columnGapPt?` を追加（内部の direction は right で固定）。Layout IR は従来の node / group の rect だけで十分で、新しい要素を足さない。tokens・matrix の置換と caption の wrapper も grid の項目の内側までたどる。既存の箱の IR のフィールドは変えない。
- **縦揃えの制限**: `align: start/end/stretch` でもセルの縦位置は常に中央。grid の直接のセルは strut を取れないため、`figure.layout.align` で上辺・下辺を揃えることもできず、満たせない制約は位置付き `layout/unsatisfied-align` になる。縦揃えが必要なら入れ子の線形の箱（stack / row）で包み、その内部または祖先で strut を使う。独立した縦揃えオプションは今回は追加しない。
- **空セルの fmt・IR**: canonical order では `~` も `null` に統一し、wrapper は `{ item: null, span: N }` の順にする。Figure IR も空セルを `null` として保持し、span と列位置を維持するが、配置・参照・経路の木をたどる際は端点として扱わない。
- **受け入れ例**: `tests/fixtures/figures/layout/grid-training.sumi.yaml` は #109 図 2 の 4 列・2 行（optimizer は span 2）。`research/126-grid/c-h3world.sumi.yaml` は #185 の (a) の 5 本の column-stack を 5 列×4 行の grid に転置したもの。画像・キーの局所の並び、見出しの align、refiner と sequence を並べる外側の stack は保持。**全 node と group の矩形が元と完全一致**（小差なし）。`rewrite.ts` で元から再生成できる（画像も複製）。テストは実際の SVG・PDF・画像方式 PPTX、列の x と行の中心、span、compact、診断の位置、fmt を検証する。

### 6.60 #187 の画像の重ね（`image.props.layers`）

- `layers: { count: 4, offset: 3pt }` を image の省略可能な props とする。
  `count` は最前面を含む整数 1〜16、`offset` は正の 0.5pt 単位の長さ。
  右上方向に同じ画像を重ね、奥から手前の順で描く。各コピーの背景・枠は
  theme / variant / tone を使う。画素の読み替え・加工は一切しない。
- `width` / `height` と欠けた側のアスペクト比補完は **1 枚分**。
  asset 読込後に各辺へ `(count - 1) × offset` を加えた union box を IR に戻す。
  structured / D2 の双方がその足跡で配置・障害物判定し、inspect・幾何 lint も
  同じ矩形を使う。足跡の shape は計測用の透明矩形、画像・枠は各コピーで描く。
  edge port は足跡上で選ぶが、描く端点はその進行方向で最初に接するコピーの
  輪郭まで延ばす（D2 の矢じり・線幅のクリアランスは保持）。大きな spread でも
  足跡の透明部分で止めない。コピーが離れ、その port から接触できない場合は
  structured の `layout/no-route` / D2 の `svg/outline-edge-miss`（error）で拒否する。
- ノードは最前面の画像ではなく **束全体**。image 自体の label / sublabel は
  従来どおり禁止。`attach` した label は足跡の辺の中央に揃い、south の中央揃えは
  最前面の画像の中央より右へ **spread / 2**（count 4・offset 3pt なら 4.5pt）
  ずれる。囲む group の寸法・caption の配置にも足跡全体が含まれる。
- SVG は束ごとに 1 個の `<defs><image>` と `count` 個の `<use>` を使う。
  PNG / JPEG / SVG と contain / cover / fill に共通。既存の layers なしの
  描画分岐はそのまま保持する。PDF は変換エンジンの画像再利用を使い、JPEG
  4 枚の fixture が **Image XObject 1 個**であることを両 engine で検証する。
  編集可能 PPTX は従来の `pptx/unsupported-asset` で拒否し、picture PPTX は保持する。
- 上限は大量のコピーによる出力肥大化を抑えるため。単なる整数指定や theme
  固定のずらしではなく、寸法を明示できる object にした。複数の別フレームを
  選ぶ `srcs` は追加しない。不正値は既存の component 診断を使い、新規診断なし。
- 実測: `research/187-image-layers/h3-world-frames.sumi.yaml` は先頭 1 枚と
  4 枚の束 4 組（計 17 コピー）。1 枚 72 × 40.5pt、ずらし 3pt の束の足跡は
  **81 × 49.5pt**。SVG の画像定義・PDF の Image XObject はそれぞれ **5 個**。
  変更前の全 138 YAML × 元テーマ・組み込み 5 theme の SHA-256 比較も記録する。
  詳細・再現方法・目視した PNG は同ディレクトリの README を参照。

### 6.61 #186 の色つき文字範囲とラベルの左右揃え

段階 C（[#167 の調査](../research/167-stage-c.md) §4.9）。H3-World のプロンプトの動作・カメラの句を orange / blue で区別し、複数行を左揃えで描く。

- **文法と互換性**: structured の `$…$` 内だけで `\textcolor{<tone>}{…}` を認識する。平文は `\text{…}` で包む。tone は既存の 8 色名だけ（任意の RGB・CSS は不可）。以前は `component/invalid-math` だった場所だけを拡張する。数式の外は文字どおり、`\text{…}` の中は従来のエスケープ規則のまま（`\\textcolor` は文字列、エスケープなしのコマンドは error）。auto の数式は `component/unsupported-in-auto` の warning と文字どおりの描画を維持する。不正な色名・欠けた引数・閉じない波括弧には既存の `component/invalid-math` を使い、新しい診断コードは追加しない。
- **run の契約**: parser → フォント fallback → 測定の run に任意の `tone` を保ち、隣接 run は tone も一致するときだけ統合する。色だけの単一 run も plain-text 経路へ省略しない。入れ子は内側の色が優先し、添字・accent にも適用する。色は幅やフォントに影響しない。writer でテーマの **`toneLines.fontColor`** に解決し、`<tspan fill>` を描く。`dim` の継承が優先するため、IR は dimmed な要素の key を任意リストで保持する（色の値から薄表示を推測しない）。
- **横揃え**: `nodes[].textAlign: left | center | right`。省略は従来の中央揃え。structured 専用で auto では既存の `layout/structured-only`。ラベルと sublabel の共有文字ブロック（最長行の幅）をノードの中央に置き、その左端・中央・右端に各行を揃える。ノードの幅・padding や文字の折り返しは変えない。±90° は揃えたブロック全体を回す。
- **色と数式の空白**: `\textcolor` は内部の atom の class・添字を保持したまま周囲のリストに展開し、自動空白の挿入は周囲の文脈が揃ってから行う。色境界で二項演算子を単項に再分類したり、関係演算子を ordinary atom に潰したりしない。色つきの `+` / `=` / `\leq`、範囲の先頭・末尾、隣接・入れ子、単項・明示空白・添字について、無着色時と文字列・フォント・添字・ノード寸法・測定幅を照合する。
- **塗り背景の制約**: `toneLines.fontColor` のコントラスト保証は白背景に対するもの。色つき span は背景に応じた色の再選択をしない。例えば paper の `tone: orange` の箱に `label: '$\textcolor{orange}{\text{Highlight}}$'` を置くと、文字 `#bd5410` / 背景 `#f9e0bc` で約 **3.70:1** となる。この filled-node 例を描画テストに含め、保証を必要とする句は白背景を推奨する。既定の tone 対応は変更しない。
- **inspect・各出力**: `<text>` の `text-anchor: start / middle / end` と run の `fill` を読み、幾何測定はアンカーに応じて行・accent の chunk の左端を復元する。PDF と画像方式 PPTX は同じ SVG を変換する。編集可能 PPTX は run の色を DrawingML の `solidFill`、左右揃えを `algn=l/r` と本文の inset に写し、中央揃えの既存バイト列を保つ。PDF のテスト用 reader でも glyph の RGB を読んで全テーマの句の色を独立に照合する。
- **使用例**:

  ```yaml
  label: 'The character $\textcolor{orange}{\text{\{stands still\}}}$, camera $\textcolor{blue}{\text{\{holds steady\}}}$'
  textAlign: left
  ```

- **互換性検査**: 変更前の全 `*.sumi.yaml` **140 図 ×（元の Theme + 組み込み 5 Theme）= 840 通り**を前後で描画し、成功 **574 通り**の SVG・PDF・画像方式 PPTX・編集可能 PPTX と auto の D2 の SHA-256 がすべて一致した。既存の描画出力の変更は **0**。失敗する ideal の `research/86-paper-figures/figures/ideal/c-h3world.sumi.yaml` は元々新フィールド `textAlign` を含むため、その unknown-field 5 件だけが全 6 Theme 条件で消える。他の失敗の診断は不変。gallery（155 ファイル）と指定コマンドで再生成した PDF・PPTX・画像の golden も変更 0。
- **レビュー修正後の再検証**: 上記の既存 140 図を修正前後で再描画し、840 条件中成功 574 条件の全出力 hash と失敗条件の診断が一致した。`bun run check`・`bun run typecheck`・`CI=1 bun test`（2819 pass / 13 skip / 0 fail）・`bun run gallery:check`（155 ファイル一致）・`bun run schema:check` がすべて成功。色と揃えの統合テストは 9 件で、既存 golden の変更はない。
- **受け入れ図**: [research/186-color-spans](../../research/186-color-spans/) は #185 の再構成をコピーし、5 つのプロンプトに色と左揃えを付けたもの。元の私有図は参照せず、既存の仮画像を使用する。句の波括弧も文字として保つ。PNG を開いて、色・行頭・箱からのはみ出しがないことを確認した。生成 SVG は gitignore、コミットするプレビューは 150KB 未満。6 行のプロンプトによる `lint/long-label` 5 件と、既存の縮小添字の info は意図した所見として記録する。
- **検証**: 色境界、入れ子・数式・accent・日本語／Latin fallback、全 Theme の SVG・PDF glyph の色と文字列・編集可能 PPTX の色、literal と auto、不正な文法、左右揃えの測定・sublabel・±90°、dim の継承を統合テストで検査する。label / sublabel のどちらが広い場合も、全行の共有端と ±90° の明示座標を照合し、編集可能 PPTX の段落揃え・左右／上 inset・回転・回転中心を読み戻して検証する。新しい部品・variant は追加しない。

### 6.62 #188 の多色絵文字・角バッジ・角への attach・bowtie

- **判断（2026-10-29 review 対応）**: 利用者の「多色絵文字セットを同梱する」判断に従い、
  Microsoft の **Fluent Emoji Flat** の汎用 47 点を同梱する。状態記号・警告/情報・電球・
  rocket・工具・鍵・文書/package・図表・時計・cloud/network/device・robot/brain・人・
  吹き出し・星・的と fire / snowflake を含む。全名は catalog と Skill assets reference に列挙。
  MIT 原文は upstream commit
  `1ffb34c752ecf5d402f04cfb4b392c77f57c54bc` の LICENSE と SHA-256 で照合した
  （`c2cfccb8…e15383`、1,141 bytes）。Iconify JSON
  `@iconify-json/fluent-emoji-flat@1.2.6` の tarball を SHA-512 integrity で固定し、
  path・色を保った SVG に包む。`bun run emoji:build` / `emoji:check` で再現・照合する。
  フォントや OS の絵文字描画には依存しない。
- **サイズの実測と範囲**: upstream の npm tarball は **1,172,438 bytes**、
  全 3,174 named entries を Sumi の SVG JSON gzip にすると **1,154,399 bytes**。
  47 点の subset は **13,971 bytes**（SHA-256 `b57f5a82…fba633`、license/code は別）。
  旧 2 点は 1,016 bytes、review の候補 47 点は 14,246 bytes。本採用は同じ汎用カテゴリを
  満たす 47 点で、全件を importer と両 engine の各出力で検査する。全セットのうち
  importer が受け入れるのは 2,747 / 3,174 点で、
  `airplane-arrival` 等は `clipPath` / `defs` / `url(#…)` を持ち、既存の基本図形限定
  importer（§6.25）が拒否する。全セットには追加の importer 対応が必要なため、
  汎用 subset を採用する。追加する場合も importer と
  SVG/PDF/PPTX の経路を通して検証する。`catalog --icons` と `catalog --json` が実際の範囲を示す。
- **構文**: `icon: emoji/fire` / `emoji/snowflake` はラベルを置き換える（Tabler と同じ）。
  `badge: { icon: emoji/fire, corner: north-east }` はラベルから独立した 1 em の正方形。
  `north-east` / `south-east` / `south-west` / `north-west` の bbox の角を中心に重ねる。
  Tabler の badge も可能。多色は theme / tone で単色化せず、Tabler だけが文字色に従う。
  **dim の例外**: dim group 内の多色 emoji（icon/badge）は元の色を維持し、
  `theme/undimmed-image` は出さない。dim と連動する記号には Tabler を使う。回帰テストあり。
  `legend` / `tokens` / `matrix` と point junction は単独の本体を持たないため
  `component/badge-unsupported`（error）。画像・outline には使える。
- **足跡と描画**: structured は本体サイズを保ち、**本体と badge の実際の union** の
  東西南北の張り出しを個別に保持し、arrange の item、attach の両端、group、canvas に
  含める。0.5 em 未満の本体では角の反対側にも張り出す。ルーティングの端点は本体のまま。
  auto は既存の asset composition で D2 の配置後に重ねる（周囲の余白は幾何 lint で確認）。
  `geometry/badge-collision`（warning）が他の本体・文字・バッジ・辺、自身の文字、canvas 外
  を検査する。自身の本体と祖先 group の本体包含だけを除き、祖先のタイトルは検査する。
  診断位置は `nodes[].badge`。tiny body・逆順・attach chain・nested group・辺横断・
  自身の label/sublabel・実際の fit 縮小を回帰テストに含める。
- **角の attach**: `attach: { to: frame, side: south-east, gap: 1mm }` など。
  通常の attach と同じ親・依存順・循環検査で、双方の軸で gap だけ外側に置く。
  badge の「角の中央」とは異なる。edge anchor の四辺の契約は変えない。
- **bowtie**: `component: bowtie` は #52 の outline renderer。左右の太い端から中央の
  waist に絞る、自己交差しない 6 頂点の汎用輪郭。中央の高さ 1/2 を safeArea とし、
  label fitting は高さを 2 倍にして確保する。全 5 themes × 7 variants
  （default / emphasis / muted / filled / outlined / solid / tinted。後の 2 つは #214 から）を catalog と gallery に含めた。
  極端な縦横比・safeArea・単調な fitting は既存の outline oracle で検査する。
  衝突判定は保守的な凸包、port は順序付きの実輪郭との最初の交点を使い分ける。
  north/south の中央と 1/4・3/4 anchor が空白で終わらないことを routing 回帰で検査。
- **出力と告知**: 圧縮 archive と MIT 原文を単一 binary に埋め込む。図には使った SVG のみを
  埋め込み、SVG metadata / PDF properties / PPTX custom properties に原文を保持する。
  release は `licenses/fluent-emoji/LICENSE`、`NOTICE`、`README.dist` を保持し、smoke で
  コンパイル済み binary の bowtie と多色 badge の SVG/PDF/PPTX を確認する。
  PDF は vector paths、picture PPTX は同じ色の outlined SVG と PNG fallback。
  editable PPTX は既存の `pptx/unsupported-asset` で badge を明示的に拒否する。
- **受け入れと互換性**: `research/188-badges-emoji-bowtie/` に #185 の C をコピーし、
  LoRA 2 個を bowtie + fire、QKV / Out Proj を snowflake badge にした。
  SVG と PDF raster、PPTX の PNG fallback を目視し、136,568-byte preview を保持。
  180 × 124.88 mm、fit 84.7%、error / warning は 0（縮小した script の info 1）。
  変更前の全 140 YAML × 自分の theme + 5 built-ins = 840 cases を実行した。
  描画可能な 574 cases の SVG/PDF/PPTX と 222 D2 sources はすべて SHA-256 が一致。
  既に無効な `research/86-paper-figures/figures/ideal/c-h3world.sumi.yaml` は badge が認識され
  6 theme 選択で schema error が減るが、変更前後とも出力はない。既存の描画出力の変更は 0。
  追加 golden は bowtie gallery と emoji-badges fixture。診断の golden は既知の部品一覧に
  bowtie が増えるだけ。wrapper のテストは TMPDIR が checkout 内でもインストール先の
  隔離を模擬できるよう、fixture の dirname に境界を設けた（製品 wrapper は変更なし）。
  review 修正後にも同じ 840 cases を再実行し、574 cases の SVG/PDF/PPTX と 222 D2 の
  hash がすべて一致。既存 golden は更新なし。`check` / `typecheck` / `CI=1 bun test`
  （2,873 pass / 13 skip / 0 fail）/ `gallery:check`（160 files）/ `schema:check` /
  `emoji:check` が成功した。


### 6.63 #214 の濃い塗りと色付き淡色面（`solid` / `tinted`）

- **構文と対象**: shape node の variant に `solid` と `tinted` を追加する。box・square・circle・ellipse・diamond・hexagon・parallelogram・cylinder・document・trapezoid・stack・operator の 12 部品が対象（#188 の bowtie を加えて 13 部品）。tokens の共通 `props.variant` とセルごとの `variant`、legend の `node.variant` は既存の Registry 検証・展開を通るので同じ名前が使える。tone 未指定時は gray。新しい YAML field・診断は増やさない。
- **色の組み合わせ**: `solid` は `toneLines.<tone>.stroke` を塗りと枠に使い、文字は白。例外として solid stack の枠は白にする。同色の塗りと枠では重なった矩形の境界が消えるため、白い区切りで全層を区別する（文字と同じ 4.5:1 以上）。`tinted` は `tones.<tone>.fill` を面に使い、同じ tone の line 色を枠と文字に使う。全 Theme の components に両 variant の gray の基本値を定義し、解決時に palette を合成する。線幅は既存の通常線幅を使い、`filled` と同じ線幅 0 にはしない。
- **4.5:1 と互換性の両立**: 既存の line 色は白地で 4.5:1 以上だが、淡色面では不足する tone がある。既存の `tones` / `toneLines` は変更しない。tinted に限り、line 色の RGB を黒へ 1% 刻みで混ぜ、量子化後の相対輝度で文字と面の比が 4.5:1 以上となる最初の色を枠・文字に採用する。これにより元の淡色面と色相を保つ。solid は既存 line 色と白で条件を満たす。全 12 部品（#188 の後は bowtie を含む 13 部品）× 全 5 Theme × 全 8 tone と tone 未指定を実測する。dim は意図した薄表示なのでこのコントラスト条件の対象外。
- **§6.53 の dim**: palette 合成後に dim pass を 1 回適用する。文字と枠は dim gray、面は white へ lighten。solid は fill と stroke が等しくても junction の点のような「ink」ではなく面として扱う。面と文字がほぼ同じ輝度になる tone があるため、solid の文字は dim gray を黒へ 1% 刻みで混ぜ、量子化後の文字 / 面のコントラストが **3:1 以上**となる最初の色を使う。薄表示を保ちつつ最低限の可読性を確保し、既存 palette と lighten は変えない。dimmed solid stack の枠はこの文字色を使い、層の境界にも 3:1 以上を保証する。既存の点・矢じり・他 variant の判定は同じ。Skill の 4.5:1 の説明は非 dim ノードに限定する。
- **発見性と作例**: catalog の全 shape manifest、全 Theme × 全 variant の部品 gallery、全 Theme × 8 tone の solid/tinted gallery（tokens と legend）を更新する。7 variant の横一列は paper-double の幅を超えるため、shape の部品見本だけ structured の 2 行にする。D2 の全 variant × 全 Theme 描画テストも維持する。`research/214-solid-tinted/figures/c-h3world.sumi.yaml` は #185 の写しで、押したキーと ⊕ を solid、全 Encoder と A のセルを tinted にする。placeholder の frame は描画スクリプトが #185 から ignored directory に複製し、SVG/PDF は out/、コミットする画像は previews/ の PNG 1 枚（150KB 未満）。
- **出力検査**: 変更前の 140 YAML ×（元 Theme + 5 Theme）= 840 通りを再描画。成功した 574 通りの SVG / PDF / PPTX と auto の D2 の sha256 はすべて一致。失敗例も同じ失敗で、unknown-variant の候補が増える既存 fixture 1 枚 × 6 通りだけ診断文が変わる。gallery の変更は新 variant を示す部品 SVG 60 枚・新 tone SVG 5 枚と索引 2 枚。全変更 gallery と受け入れ図を PNG で確認する。詳細は [検証記録](../../research/214-solid-tinted/README.md)。

### 6.64 #215 の paper operator の縮小

- **判断: Theme の値だけで対応**。operator の既存契約は円の直径が glyph の fontSize の 2 倍（§6.20）。`paper` の operator にだけ default スタイルを追加し、fontSize を既存の `{size.small}`（7pt）、strokeWidth を `{line.edge}`（0.5pt）とした。記号 8 → 7pt、円 16 → 14pt（12.5% 縮小）。6pt / 12pt の試作は `profile/font-too-small`（紙の下限 7pt）になり不採用。小さい記号と 0.5pt の辺に釣り合う細い円とする。emphasis は既存の 1.5pt と bold を保って意図した強調を残し、filled は枠なし、muted / outlined の色と tone / dim は既存の解決順を使う。props・variant・schema・診断は増やさず、サイズの自由指定や lint の例外も追加しない。
- **目視と受け入れ**: `research/185-acceptance/render.ts` で 3 図を再描画し、変更前後の PDF を 200dpi PNG にして比較。円と記号の余白を保ち、Transformer・DiT の加算が箱より目立ちすぎず、H3-World の橙の円にも細い枠と ＋ が残る。operator が原図より大きいという #185 / #215 の記録に対応する方向の変更であり、未公開の H3-World 原図の直接比較はしていない。`research/215-paper-operator/out/figures/` に受け入れ図・相対参照する代用画像の完全な写しを生成して描画する。成果物は gitignore、同ディレクトリの `previews/c-h3world.png` は 74,384 bytes（150KB 未満）。既存の受け入れ図の preview 3 件も更新。
- **実測（mm）**: Transformer **76.02 × 114.83 → 75.32 × 114.12**、DiT **180 × 85.98 → 180 × 84.69**、H3-World **180 × 122.24 → 180 × 123.04**。DiT は **170mm 幅で 81.2041 → 79.9841mm（−1.2200mm、−1.50%）**。#185 の原図約 68mm に対して ×1.194 → ×1.176。§6.55 の compact だけで残る縦長さを少し改善するが、間隔や文字の大きさの差は残る。§6.55 の旧 fixture は 180mm 幅で 87.66 → 86.34mm（170mm 幅で 82.79 → 81.54mm）。H3-World は自然幅が小さくなって fit の縮小が弱まり（0.829 → 0.8344）、固定された 180mm 幅での高さは逆に増える。3 図の warning / error は 0。DiT と H3-World の既存の添字の info のみ継続。
- **互換性（実測）**: 追跡済み YAML **140 個 ×（own + 組み込み 5 Theme）= 840 通り**の変更前後を描画し、実際の SVG / PDF / 画像方式 PPTX と D2 ソースの SHA-256 を比較。成功 **574 通り**、失敗 **266 通り**は不変、D2 **234 件すべて同一**。**45 ファイル・59 通りの SVG / PDF / PPTX（177 出力）だけ**が変化し、すべて paper で operator を使う図。own の変更も paper の図だけ。残る Theme と operator のない paper はバイト一致。失敗の診断も同一。全変更を PDF → PNG の一覧で確認し、既存の再現図の重なりを含む意図した差分を [一覧](../../research/215-paper-operator/changed-outputs.md) に記録した。
- **golden とテスト**: `bun run gallery` で operator / tones / dim の paper SVG と目次を更新、指定の `SUMI_UPDATE_GOLDEN=1 CI=1 bun test src/render/pdf src/render/pptx src/render/assets.integration.test.ts` で PDF / PPTX corpus と operator の編集可能 slide XML を再生成（hash の手編集なし）。3 ギャラリーの PNG で全 symbol・variant・tone・dim を確認。`marks.test.ts` で全 symbol × variant の直径・文字・線幅・profile 下限を検査、既存の全部品 × variant × Theme の実 D2 描画も通る。compact の実測期待値と #217 の受け入れ経路の座標を新しい大きさに更新（曲がり 1 回と矢じりの直線長の保証は保持）。Skill にサイズの説明を追記。`check` / `typecheck` / `CI=1 bun test`（2811 pass・13 skip・0 fail）/ `gallery:check` / `schema:check` を確認。

### 6.65 #216 のトークン列の点線の区切り

- **構文の判断**: `tokens`（§6.50）の `cells` / `lines` に `{ separator: dotted }` というセルを追加する。任意の `id`・`tone`・`width`・`height` を持てるが、ラベル・部品・variant は持たない。別の `separators` 配列では、位置・行・参照との対応を二重に管理することになるため、既存の並びの中に書くセルにした。通常のセルと同じく位置番号に数え、`<tokens>.<id>` / `<tokens>.<番号>` で参照でき、予約 ID・重複 ID・診断の由来も既存の仕組みを使う。挿入で番号が変わるため安定した参照には `id` を勧める。
- **大きさと方向**: `right` / `left` は縦線で、予約幅の既定は **6pt**、高さは tokens の `height`（なければ **14pt**）。`down` / `up` は横線で、予約高さが **6pt**、幅は tokens の `width`（なければ **14pt**）。セル自身のサイズが優先し、`gap` は両側に効く。行をまたいだ境界線ではなく、そのセルの箱の中央に引く短い区切り。周辺セルを測って高さを決める後処理を加えず、明示サイズ・配置・stretch の通常の規則に従う。
- **テーマと描画**: `box` の `outlined` に展開して全組み込みテーマの線幅と `toneLines` の色を使う（tone はセル → tokens の順）。通常セルの `component` / `variant` は引き継がない。展開記録と Figure IR の `tokens.separator` に向きを持たせる。SVG の `g.shape` は無色の矩形で予約箱を表し、その直後に `path.sumi-token-separator` を描く。線幅と同じ長さの dash・線幅の 2 倍の間隔・丸い線端。線端を線幅の半分だけ箱の内側に入れ、幅は箱の短辺以下に制限する。線幅 0 は描かない。薄表示や全体の縮小は既存のスタイル・変換に従う。
- **端点・inspect・幾何 lint**: 名前・番号のどちらの参照でも区切りを辺の端点にできる。anchor は点線の中心線ではなく**不可視の予約矩形**を指し、編集可能 PPTX の接続先もこの矩形。予約箱を既存のノードとして扱うため、配置・ルーティング・inspect の bbox・衝突検査が同じ箱を共有する。`geometry/edge-through-node` も予約箱への侵入を検査する。一方、`g.shape` の外にある点線パスは斜線と同じ装飾で、inspect はパスを公開・検査せず、辺同士の近接規則も点線 stroke までの距離を検査しない。重なりは `geometry/node-overlap` で書かれた区切りセルを指す。空ラベルの警告は他の tokens セルと同じく出さない。新しい診断コードは追加しない。
- **出力形式**: PDF と画像方式 PPTX は同じ SVG パスを変換する。編集可能 PPTX は行列の斜線（§6.56）と同様に、予約箱に重ねた独立の線図形（`<key> separator`、`custGeom`、丸い線端、`custDash`）にする。`freeform` / `glued` の両方を検査する。線と予約箱はグループ化しない（行列の斜線と同じ制約）。
- **受け入れ図と目視**: `research/185-acceptance/figures/c-h3world.sumi.yaml` の写しを `research/216-token-separator/` に置き、(a) の `seq` の `adots` と `i0`、(b) の `bt` の `a3` と `i0` の間に `id: av` の点線セルを挿入した。原図は参照できないため Issue の説明を根拠とし、フレームは既存のプレースホルダーのまま。PDF から PNG にして両方の点線と既存の接続を確認した。**180 × 120.87mm**、scale **0.8197**、error / warning **0**、既存の `geometry/script-too-small`（info）1 件。コミットするプレビューは **74,629 bytes** の 1 枚だけで、SVG / PDF / PPTX とフルサイズ PNG は `out/` に生成して gitignore する。
- **ギャラリーと golden の意図した変更**: `tokensSample()` に区切りを 1 つ加え、全 variant（default）× 全テーマの見本で機能を見せる。変わる既存の図は `docs/gallery/components/sumi-tokens.{minimal,academic,slides,color,paper}.svg` の **5 枚**のみで、すべて PDF → PNG にして確認した。通常セルのサイズは維持するが、予約幅の追加で後ろの省略記号とキー群が移動し、広がった行の中央に揃う model も移動する。paper では model が 7.5 unit 動き、出る辺の始点 x も 195.508 → 203.008 になる。これは見本の入力を変えた結果で、端点が不変という意味ではない。目次の 2 ファイルはカタログの説明の更新。対応する PDF / 画像方式 PPTX の corpus hash 各 5 エントリ、編集可能 PPTX の hash と slide XML は 5 テーマ × 2 方式の 10 件を指定の生成コマンドで更新した。既存 YAML の図の出力変更とは区別する。
- **テスト**: 区切りの strict props、4 方向の線分座標、明示サイズ・既定サイズ、`lines`、名前・番号の参照と描画した予約矩形への接続（glued PPTX の接続先を含む）、由来と IR、全 5 テーマの inspect bbox と診断ゼロ、衝突の書いた位置、装飾パスを除いても予約箱を横切る無関係な辺の診断、tone 継承、H3-World の順序、縦・横 × 通常・dim の SVG / PDF の線分と dash、画像方式 PPTX の色・dash、編集可能 PPTX 両方式の線図形・色・dash を検査する。部品 props は Figure JSON Schema の外なのでスキーマ本体は変えない。
- **レビュー対応後の検証**: `bun run check`・`bun run typecheck`・`CI=1 bun test`（**2861 pass / 13 skip / 0 fail、90164 assertions**）・`bun run gallery:check`（**155 ファイルがバイト一致**）・`bun run schema:check` が成功した。既存の D2・lint・画像・PDF・画像方式 / 編集可能 PPTX の golden も更新なしで通る。今回のレビュー対応ではギャラリー・サンプル・golden の変更は **0**。下記の 840 通りの比較は最初の実装時の記録で、今回の追加検証とは区別する。
- **互換性（実測）**: 既存 `*.sumi.yaml` **140 図 ×（元のテーマ + 組み込み 5 テーマ）= 840 通り**を変更前後に描いた。成功する **574 通り**の SVG・PDF・画像方式 PPTX 各 574 件と、auto の D2 ソース **222 件**は sha256 がすべて一致した。既存の失敗 **266 通り**は失敗のまま。診断の差分は、既に `{ separator: dotted }` が提案構文として書かれていた `research/86-paper-figures/figures/ideal/c-h3world.sumi.yaml` の 6 テーマ分で `component/unknown-prop` が 1 件減ったことだけ（他の未対応構文により出力は引き続きない）。成功・失敗の変化、既存出力の変更は **0**。全チェックは `bun run check`・`bun run typecheck`・`CI=1 bun test`（**2854 pass / 13 skip / 0 fail**）・`bun run gallery:check`（155 ファイル）・`bun run schema:check` が成功した。skip は既存の prototype / 任意環境のテスト。


### 6.66 #233 の離れた 2 台形の bowtie と台形の向き

- **目的・API**: H3-World の LoRA は中央で接合した砂時計ではなく、横向きの台形を 2 枚、間隔を空けて向かい合わせる。汎用部品 `sumi/bowtie` に `props.gap`（有限の数、0–64、D2 単位＝0.5pt）を追加し、未指定・0 は従来の輪郭をそのまま使う。明示した小さい幅でも半分が潰れないよう、描画する間隔は幅の半分以下に制限する。`sumi/trapezoid` には `props.narrow: south|north|east|west` を追加し、狭い平行辺の側を選ぶ。未指定・south は従来の上が広い台形。slant は引き続き renderer の固定パラメータで、利用側には公開しない。
- **幾何契約**: `OutlineDrawing.boundaries` を任意で追加し、離れた body の実輪郭を返す。既存 renderer の単一 `outline` は変更しない。離れた bowtie の `outline` は全体の外接矩形、`boundaries` は左右それぞれの四角形とする。safeArea は中央の高さ半分で 1 個のラベルが左右・gap をまたぐ。幾何 oracle は body union と boundaries の一致を検査し、safeArea は enclosing silhouette 内で検査する。衝突・inspect/lint は従来どおり保守的な凸領域を使い、gap を通路にしない。
- **辺・バッジ**: structured の `nodeBoundaryEntry` は boundaries の全辺に対する最初の交点を使う。north/south の法線が gap 内なら最寄りの台形の口へ port を移す（距離差 1e-6 単位以内は同距離として左を選び、浮動小数点誤差で左右を変えない）。auto の compose も左右の輪郭を使い、上下の法線から 5° 以内で gap に向かう D2 の端は、接線方向の ray が口に当たるよう平行移動してから延長し、D2 の clearance を保つ。直線端は footprint 外の隣接点に平行移動した approach と折れ点を加え、端だけを動かして gap を横切る斜線にしない。曲線端は対応する制御点も移す。D2/ELK に渡す footprint は 1 個の矩形のままで、gap に無関係な辺を通さない。バッジは左右を別 node に分けず、全体の従来の角に付く。
- **PPTX**: 2 枚の body は 1 個の native custom geometry の 2 個の path、ラベルは同じオブジェクトの編集可能テキストとする。新機能を使った輪郭では SVG の辺端から接線方向へ実輪郭との最初の交点を求めて DrawingML の接続点として列挙する。auto の clearance 付き辺端をそのまま登録せず、丸め等で ray が交差しなければ最寄りの実輪郭上の点へ射影する。glued でも外接矩形の中央（gap 内）や輪郭外の clearance 位置に戻さない。従来図の接続点はバイト互換のため従来のまま。#188 の既存制約どおり、絵文字バッジ付きは picture PPTX を使う。
- **auto の gap 判定・安全な fallback（#241 再レビュー）**: gap の補正要否は最終 approach の前方 ray を左右両方の**塗られた台形**に当てて判定する。端点の x が body の外接 span に入るかでは判定しない。ray がどちらの body にも届かず gap を抜ける場合だけ口へ平行移動する。source/target 両端の補正と折れ点をまず完成させ、同じ挿入 index でも source の折れ点が target より先になる経路順を守る。SVG に書く 3 桁丸め後の全経路に、ゼロ長・退化・逆行・自己交差・自己重複がないことを検査し、さらに新しい区間が、composition の inspection から得られる他の node/group の shape footprint（保守的な bbox、当該 edge 自身の source/target は除く）の内部を横切らないことを検査する。既存区間の既存衝突は新設区間の衝突として扱わない。曲線は制御点の単調射影と制御点 bounds / 隣接 hull の分離で保守的に証明し、標本点だけで安全とみなさない。証明できない場合は**両端を含む D2 の元 path 属性をバイト単位で維持**し、共有 `Diagnostic` の `svg/outline-edge-miss`（warning、edge の sourceMap/subject 付き）で layout の調整を促す。採用しない延長は延長同士の交差検査にも登録しない。この検証は split outline の補正に限定し、structured と gap/narrow 未使用図の出力はバイト互換を保つ。
- **発見・検証**: catalog の props 説明、全 5 Theme × 全 variant の gap 付き bowtie と 4 方向の台形 gallery、微小・極端サイズの oracle、各側の 0.25/0.5/0.75 port、gap の迂回、D2 の上下左右、inspect・幾何 lint・PDF・editable PPTX 両接続方式を検査する。既存の 149 個の `*.sumi.yaml` を変更前後で自テーマ＋全組み込み Theme で処理し、生成できた SVG/PDF/picture PPTX/editable PPTX/D2 の sha256 と生成できない fixture の診断コードを比較する。
- **受け入れ図**: `research/188-badges-emoji-bowtie/c-h3world.sumi.yaml` を `research/233-lora/` にコピーし、2 個の LoRA に `gap: 8` を設定。画像は #185 の同じ assets をコピーする。内容と接続は維持し、PNG preview を 150KB 未満にして目視確認する。再現手順・診断と互換性の集計は同ディレクトリの README に記録する。

### 6.67 #234 の Fluent Emoji Flat セット拡大

- **同梱範囲の判断**: §6.62 の汎用 47 点の選別をやめ、固定済みの `@iconify-json/fluent-emoji-flat@1.2.6`（3,174 点）のうち、共有 SVG importer を通る **3,124 点すべて**を同梱する。元の 47 名と元 SVG はそのまま。全件を名前順に判定し、受理した元 SVG と除外した名前・理由を同じ gzip JSON に記録する。非対応の絵を黙って簡略化しない。依存・上流バージョン・npm SHA-512 integrity・MIT 原文の固定先は変更しない。
- **importer の調査と小修正**: 変更前は 2,747 点が成功し、427 点が失敗した。`finite()` が色の `#4e3233` / `#4E3233` を指数表記 `4e3233` と誤認していたため、検証済みの十六進色だけ数値の有限性検査から外す（数値属性・rgb 値の検査は維持）。もう一つは `clip-rule` で、`nonzero|evenodd` のみを許可し、再シリアライズ時に保持する。これだけで **377 点**を追加で受理する。残る **50 点**は `<defs>` / `<use>`、clipping、gradient、filter 等を必要とする（該当する名前の数は use 29・clipping 18・gradient 3・filter 6、重複あり）。参照の安全な解決・ID のスコープ管理・全出力エンジンの対応が必要で、小修正ではないため今回は除外する。
- **診断と発見性**: 存在するが除外した名前（例: `emoji/airplane-arrival`、`butter`、`eleven-oclock`、`phoenix-bird`、`teacher`、`violin`）は `asset/unsupported-icon` と具体的な importer の理由を返す。通常の置換 icon と `badge.icon` の両方で、書かれた位置を指す。誤記は従来の `asset/unknown-icon` と近い名前の hint のまま。`sumi catalog --section icons` は count、`sumi catalog --icons "<words>"` は Tabler と同じ検索、`--icons "" --json` は全対応名を返す。Skill の assets reference に検索・JSON から `emoji/` を選ぶ方法と除外診断を記載した。
- **再現性と大きさ**: `emoji:build` が count と archive SHA-256 を `src/assets/icons.ts` に自動反映し、`emoji:check` は展開した JSON・コミット済み gzip 自身の SHA-256・count・MIT 原文を検査する。gzip の OS 差を受け入れる既存方針は維持する。Bun 1.3.14 / darwin-arm64 の実測:

  | 対象 | 変更前 | 変更後 | 増分（bytes） |
  | --- | ---: | ---: | ---: |
  | 同梱 emoji gzip JSON | 13,971 | 1,128,359 | +1,114,388 |
  | `release:build --target darwin-arm64` の tarball | 53,171,890 | 54,287,631 | +1,115,741（約 1.06 MiB） |
  | 展開した `bin/sumi` | 69,291,362 | 70,414,178 | +1,122,816 |

  同じ環境・バージョン 0.7.0・コミット時刻で前後をビルドした。npm tarball は 1,172,438 bytes、非対応も含む全 3,174 SVG の JSON gzip は 1,154,399 bytes。配布物の増分は実際の tarball の差で、gzip の推定値ではない。
- **遅延ロードと費用**: `iconSets()` の説明から巨大な名前列を除き、count を生成済みメタデータにする。Tabler の既知の count（4,808）も同じ扱いにし、通常の catalog はどちらの gzip も読まない。`iconNames()` / `iconSvg()` で使ったセットだけを初回に read → SHA-256 → gunzip → JSON parse し、以後はキャッシュする。別プロセスでファイル読み込みを拒否しても metadata を取得できることをテストする。上記 2 つの実リリースバイナリを交互に起動し、各 1 回 warm-up 後の **20 回の中央値**を比較した（stdout は pipe、ローカル環境の参考値）:

  | コマンド | 変更前 ms | 変更後 ms | stdout bytes（前 → 後） |
  | --- | ---: | ---: | ---: |
  | `--version` | 71.04 | 71.68 | 6 → 6 |
  | `catalog --section components --json` | 73.01 | 72.80 | 49,418 → 49,418 |
  | `catalog --section icons --json` | 77.88 | 70.21 | 1,179 → 579 |
  | `catalog --icons "" --json` | 77.92 | 95.68 | 133,107 → 232,664 |

  別の新規 Bun プロセス内で metadata 呼び出しは 0.027ms、emoji 名一覧の初回ロードは 16.09ms、キャッシュ済み呼び出しは 0.005ms。起動や emoji のない描画に全 SVG の展開費用を加えず、名前の検索や利用時にだけ支払う。
- **ライセンス・告知**: `fluent-emoji-LICENSE.txt` と配布物の `licenses/fluent-emoji/LICENSE` は前後バイト一致（SHA-256 `c2cfccb8…15383`）。MIT・著作者 Microsoft Corporation・上流 URL・図の full notice は維持。配布物の NOTICE / README は同梱範囲の記述（47 → 3,124）と archive hash だけ追従させる。SVG / vector PDF / picture PPTX の notice を両 engine × 全 5 Theme で検査し、元の 47 点に加えて importer 修正を使う `anchor` / `artist-dark` / `hyacinth` と新しい face の各出力も検査する。実リリースの smoke も新しい `artist-dark`、全対応名の件数・非対応名の非掲載を確認する。
- **互換性の実測**: リポジトリの既存 `*.sumi.yaml` **149 個 ×（書かれた Theme + 組み込み 5 Theme）= 894 通り**を変更前後に `renderFigure()` で描画し、SVG / PDF / 画像方式 PPTX と auto の D2 ソースの SHA-256 を比較。成功 **613 通り**の 3 形式各 613 出力、D2 **222 件**はすべてバイト一致。失敗 **281 通り**の診断も一致した。元の 47 点は元 SVG と importer の戻り値も変更前と全件一致。`bun run gallery` は全 variant × 全 Theme を含む **165 ファイルに差分 0**、golden の更新も不要。
- **最終検証**: `bun run check`・`bun run typecheck`・`CI=1 bun test`（**2,988 pass / 13 skip / 0 fail**）・`bun run gallery:check`（165 ファイル）・`bun run schema:check`・`bun run emoji:check` が成功。darwin-arm64 の `release:build` と拡大セットを使う `release:smoke` も成功した。


### 6.69 #246 の split bowtie の口と隣接端の直線化

- **原因**: structured の通常の横 `row [box, bowtie(gap: 8), box]` は左右の外側の口で既に直線になる。一方、north/south の接続は §6.66 が gap 中央の port を左の口へ 4 unit 移すため、§6.40 の許容差 2 unit を超え、段差も `layout/unaligned-ends` の検査も対象外になっていた。gap が小さい場合も、直線化の候補を再解決すると gap から同じ口へ戻るのに「移動成功」と扱い、隣の端を試さず終了していた。
- **解決**: port に gap 補正前の位置を内部情報として保持する。向かい合う端の実際のずれが従来の許容差内、または **gap 補正前なら許容差内**の場合だけ直線化を試す。候補の再解決後に要求した座標と一致することを確認してから使用点を更新し、gap に戻される候補は不採用として隣の端を試す。口は塗られた輪郭上に残し、既定の隣接端をその口の線へ移す。アンカーを許容差以上動かさず、共有 port を動かしたり別の端と合流したりせず、side 外にも移さない。ルータの障害物・探索費用・gap を通路にしない契約は維持する。
- **診断・検査**: 同じ適格条件を `layout/unaligned-ends`（warning）にも使い、共有端・アンカー・狭い side のため移動不能なら gap と口のずれを明示する。経路の独立検査 `checkRoutes` は split body の端点だけ `boundaries` の実輪郭で確認し、衝突検査には従来の enclosing region を使う。空の gap 内への接続を正しい端点として認めない。
- **回帰・互換性**: 全 5 Theme で横 row の両辺、縦 stack の入出力と gap 1/4/8/64（幅による clamp を含む）の route points を検査する。アンカー・共有 net・口が隣の side 外にある場合の残る段差と診断、gap 内に改変した端点の拒否も検査する。新 API・部品・variant・Theme は追加せず、catalog と全 Theme × variant の gallery は既存の契約を維持する。変更を許すのは `bowtie.props.gap` 使用図のみとし、全 YAML の自テーマ＋全組み込み Theme の SVG/PDF/PPTX/D2 の sha256 を変更前後で比較する。
- **受け入れ図**: `research/233-lora/c-h3world.sumi.yaml` を lint・render し、PNG preview を再生成して目視する。同図の LoRA は左右の口を使うため出力は変わらず、既存の添字サイズ info 1 件のみ。プレビューも同じ 100,542 bytes。
- **実測結果**: 全 150 YAML ×（自テーマ＋5 Theme）= 900 組を変更前後に実行。成功 628 組の SVG/PDF/picture PPTX 各 628 件、editable PPTX 428 件、auto の D2 222 件はすべて sha256 一致。描画不能 272 組と editable 非対応の診断コードも一致した。互換性例外に該当する YAML は上記 `research/233-lora/c-h3world.sumi.yaml` のみで、実際に変化した既存図は 0。gallery は全 Theme × variant を再生成・目視し 165 ファイル差分なし。`bun run check`・`bun run typecheck`・`CI=1 bun test`（3219 pass / 13 skip / 0 fail）・`bun run gallery:check`・`bun run schema:check` が成功。

### 6.71 #248 のパネル内の空きと主軸の fill

- **分類（`research/233-lora/c-h3world.sumi.yaml` の (c)）**: (1) 縦の兄弟合わせは既に row の `align: stretch` で可能だが、この図は `center`。さらに stretch された stack は余った高さを中央寄せするだけで子を大きくできない。(2) LoRA / QKV の間の明示 `6mm` は辺と badge の通路で、単に gap を削っても列全体は伸びない。(3) token のセルには `height: 7pt` があり、明示サイズを守る配置では自動拡大できない。(4) パネル自体を (b) と同じ高さに stretch すること、軸・caption を body と同じ stack に含めることが見出し・下端の帯を作る。Profile の padding やフォントだけの問題ではない。
- **構文・最小化（判断）**: row / stack に任意の `justify: center | stretch | space-between`。既存の交差軸の `align: stretch` を再利用し、新しい item wrapper / grow weight / group の size は足さない。`justify` は主軸（stack は高さ、row は幅）に渡された自然サイズ以上の領域だけを使い、継承しない。省略と `center` は従来どおり中央。`stretch` は余りを伸縮可能な子に等分して**加算**（最終サイズを同じにする意味ではない）し、gap・整列 strut は維持する。`space-between` はサイズを保ち、余りを gap に等分加算する。1項目、または伸ばせる子がない場合は中央。grid は主軸を持たず受け付けない。方向 up / left は従来どおり視覚順を反転し、自然サイズの計測・最後の丸めは変えない。
- **伸縮対象（判断）**: 入れ子の配置箱、group、主軸の明示サイズがない通常の伸縮可能な形。circle / square 等の固定アスペクト比・text・custom outline は固定。custom outline の footprint が単調でも一方の軸だけを伸ばした safeArea の単調性は保証されないため（§6.21）、bowtie も自動では伸ばさない。badge 付きの通常の box は新しい justify のときだけ伸ばせる（badge の予約 footprint は維持）。既存の align の伸縮可否は変えない。caption の内部 `growFirst` は優先し、caption を押し離す代わりに group に余りを渡す従来の約束を保つ。Figure IR の `justify?` を渡すだけで Layout IR・writer・PDF/PPTX に新しい形式は要らない。部品 manifest / props / theme / catalog は変更不要。
- **補助の info（判断）**: `geometry/group-empty-area`、render / `lint --geometry` のみ。group の外接矩形から、見出しと直接の子の外接矩形（ラベル・badge を含む）の union を引いた割合。矩形を親に clip し、重複面積は一度だけ数える。辺は占有面積としない。入れ子の group は footprint 全体を占有とし、その内側は別に計測する。空の group と展開でできる tokens / matrix / legend の内部枠は除外。ピクセルの空きや最大空き矩形の推定ではなく、形状の中の余白や辺の通路を悪いと断定しない。hint は `align: stretch` と内側の `justify: stretch` / `space-between`、gap、パネル自体の stretch を外す方法。`maxWarnings` に数えず、通常 lint・出力は変えない。
- **しきい値の実測**: 変更前の全150 YAML を各自の theme で描画し、成功114図の225 group を計測（失敗36図は不正 fixture・追加 registry・旧研究図の経路や素材の制約等のため除外）。中央値 **56.81%**、p75 **69.28%**、p90 **75.25%**、p95 **76.56%**、最大 **93.19%**（nearest rank、研究のコピーも1図として数える）。上位約1割だけを候補にするため p90 を丸めた **75%以上**（24/225 group）を採用。閾値は実行時にコーパスを読まず固定する。元の (c) は **60.63%** で対象外: 一部の列が短い問題を全体の比率だけで必ず検出するものではなく、配置機能を主にするという合意を優先し、特定の図が鳴るまでしきい値を下げない。生データ・再現手順は [`research/248-fill/`](../../research/248-fill/README.md)。
- **描き直し・目視**: #233 の YAML とコミット済み assets をコピー（`.gitignore` は生成形式だけを除外、assets は追跡）。(b)/(c) の row は `align: start`、(c) 内は `align: stretch`、投影列と明示9 box の token 列は `justify: stretch`。LoRA は outline の制約を守って高さ28ptを明示し、余りは QKV / Out Proj. に渡す。Key / Masked Attention を matrix の北／南に1mmで attach し、凡例は中央の stack に包んで伸ばさない。印刷 pt で matrix **99.75 → 99.75**、投影列の body の全高 **59.68 → 96.34**（badge の予約を含めると matrix に一致）、QKV **19.61 → 54.55**、token 列 **63.94 → 99.75**。見出し→Key の空き **3.88 → 2.77pt**、caption→枠 **6.22 → 5.12pt**、(c) の高さ **148.86 → 144.22pt**。全体180 ×125.71mmは (a)/(b) が決めるため不変。空き比率 **60.63 → 54.77%**。`previews/c-h3world.png` **101,820 bytes** を元と見比べ、短い青い箱と token が縦方向を埋めること、凡例と軸文字が引き伸ばされないことを確認。render は既存の添字の info 1件のみ、構造 lint の9件の empty-label は意図した無文字の token box。

- **互換性の実測**: `61e6c20` の renderer を worktree 内の `.sumi/248-base/` へ展開し、既存150 YAML × 自テーマ＋全5 theme の900通りを変更前後で描画（CLI と同じ `overrides.theme` を使用）。成功628通りのSVG / PDF / picture PPTX、autoのD2 222通りのsha256と、生成不可272通りのerror codeが全件一致した。両manifestのsha256は `b935f1789c3ce83c220f7c536faefb401df8f4778fe27363d7bda0c55ab1fc43`（[`compatibility.json`](../../research/248-fill/compatibility.json)）。全theme×variantのgalleryは165 files変更0。指定のPDF/PPTX/assets golden再生成も594 pass・変更0。既存図の診断が増えた箇所だけテストの期待を更新し、出力のgoldenは変更しない。


## 7. 実装順
1. #4: Diagnostic・Result 型、位置付き YAML 解析、Figure Schema（Zod）＋ JSON Schema 生成、参照検証（重複 ID・未知の端点 / グループ・グループの循環）、fixtures
2. #5 / #6 / #7（#4 の後に並行可能）
   - #5: manifest の型と検証、Registry、テスト用の最小 manifest
   - #6: Theme の形式、token 解決、style のマージ、量子化と値域の検査、フォントセットの同梱
   - #7: 単位パーサ、Profile の形式、組み込み Profile、事前検査
