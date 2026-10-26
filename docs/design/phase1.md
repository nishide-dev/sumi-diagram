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
- 組み込み Theme: `minimal`（モノクロ）、`academic`（論文向け）、`slides`（スライド向け。#36 で追加、§6.9）、`color`（色を使う汎用。#92 で追加、§6.20）。分野固有のパレットは持たない。tone（色の分類の名前）の色は Theme の `tones` にだけ置く（§6.20）。

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
  - 理由: tone は `variant` と同じく「Theme が見た目を決める、部品をまたいだ選択」で、部品の意味（props）ではない。props にすると全 manifest に同じ prop を宣言させることになり、部品の契約と見た目が混ざる。調査の提案（node のフィールド）どおり。group にも同じ規則で付けられる（追加の費用がほぼない）。edge の tone（調査の段階 C）は対象外。
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
- **検証**: manifest の `mark` の検査、`unexpected-label`・`tone-unsupported`・`missing-tone`・`unknown-tone`・tone の色以外のプロパティ、解決順（variant の後）、IR の大きさとラベル、D2 の出力、既存 Theme の出力が tone なしでは変わらないことを単体テストで固定した。図 A の理想の YAML は、`requires` を外すと残る診断が `icon` の `schema/unknown-field`（#94）だけになる。

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
  - anchor があればその辺と位置。ない端は、相手の中心へ向かう向きのうち、差の大きい軸の辺（同じなら縦）。位置は 0.5。
  - **同じ 2 要素の間のエッジ**（多重辺・`a → b` と `b → a` の閉路）で、ある要素の同じ既定の辺を使う端は、文書順に位置 1/(n+1) … n/(n+1) に振り分ける。平行な別の線になり、重ならない（anchor を書いた端は動かさない）。
  - **group** が端の場合は group の外枠上。相手が group の中にある（子孫から自分の group へ）なら、相手の中心に最も近い辺を使い、経路は group の内側を通る（`fromSide` / `toSide` はその辺）。子孫の側の端も同じ辺の向きを使う。
  - **自己ループ**: 既定は東から出て北に入る（角を回る）。片方だけ anchor があれば、もう片方は時計回りの隣の辺。両端が同じ点になる場合は `layout/no-route`。
  - 端点は外接矩形の辺上の点（**ポート**）から法線に沿って内側へ動かし、図形の輪郭（circle・oval・diamond・hexagon・parallelogram は lint と同じ `shapeOutline`、アウトライン部品は renderer の衝突領域、`text` は外接矩形）に置く。矢じりは常に辺に垂直に入る。辺の端（位置 0 / 1）で法線が図形に接するだけの場合も、最初の共通点（円なら左右上下の端）に置く（接触を含む判定。貫通の判定とは別の関数）。
  - **junction**（mark が `point` の node、#92）は中心が端点で、向きは自由。junction は 3×3 unit の点で、自分を端に持たないエッジは通れない。
- **格子と探索（`router.ts`）**: 疎な格子（Hanan grid）上の最短経路探索。状態は（格子点, 進行方向）で、U ターンはしない。格子の線は、junction 以外の node の辺とそれを clearance（6 unit = 3pt）広げた辺、group の辺と group ラベルの箱の辺、内容の外側 12 unit の枠、それらの隣り合う線の中点（溝の中央を通すため。間隔が 2 unit を超える場合。ポートの線の間には入れない）、ポートと stub の先端、junction の中心。座標は 1/1000 unit に丸めて整数の添字で扱い、ヒープの同点は状態の番号で決まる。格子と格子の辺の費用は 1 回だけ作り、占有はその場で更新する。
  - **A\***: 下界 `h(p) = max(0, min(|p t|, min_q |q t|) − stub)`（`q` は自分のネットの点のうち終点の stub の外にあるものと、stub の点でネットが stub の外から届いているもの。`stub` は終点の stub の長さ）。同じ終点に入る幹線が stub に合流している場合、その合流点を除くと下界が過大になる（レビューで見つけ、Dijkstra と経路が一致することをテストで確かめる）。自分のネットの辺は費用 0 なので、マンハッタン距離そのままでは下界にならない。経路が（終点の stub 以外で）ネットの辺を使わなければ費用は `|p t| − stub` 以上、使うなら最後にネットを離れる点 `q` から `|q t| − stub` 以上、他の辺の費用は長さ以上なので、この `h` は過大評価しない。したがって結果の費用は Dijkstra と同じで、同じ費用の経路の間の選び方だけが探索順で決まる（決定的）。
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

  - node の辺上と内側の格子の辺は使えない（junction を除く）。したがって経路は**設計上 node を貫通しない**（試作の「膨らませた障害物の内側を通れない」から変えた: 2mm 間隔のスタックでは膨らませた障害物が重なり、隣のブロックを直線でつなぐ特別扱いが要った。製品は clearance を費用にしたので、隣どうしの直線も通常の探索で最短として見つかる）。
  - 交差の費用（300）は試作（80）より高い。図の交差は折れより読みにくいので、折れ 7 回分程度までの迂回は交差より安くする。
- **stub**: ポートから辺に垂直に、clearance 以上（矢じりのある端は矢じりの長さ以上）まっすぐ進むまで曲がれない。矢じりの長さは D2 の三角形と同じ **4 + 4 × 線幅**（unit。academic の 1 unit の線で 8）とし、`arrowheadLength()` として公開する。junction の端には stub がない。stub は「曲がれない範囲」なので、向かい合う 2 つのポートを結ぶ直線は stub より短くてもよい（2mm 間隔のスタックの線）。ただし**矢じりは描く場所が要る**ので、矢じりのある端の線分が矢じりより短くなる場合（向かい合う端の間隔が矢じりより狭い直線）は `layout/no-route` にする（矢じりのない `line` なら引ける）。
- **ネット**: 同じポート（要素・点・向き）を使うエッジ、同じ junction に触れるエッジを **union-find** で 1 つのネットにする。junction どうしをつなぐエッジで推移的に統合される（試作の限界の解消。試作は 1 本ごとに 1 つの junction か始点を選ぶだけだった）。合流（同じポートに入る複数のエッジ）も同じネットになる。ネットの番号は、最初のエッジの文書順。
- **占有**: 格子の辺と格子点の所有者を**すべて**記録する（試作は 1 つだけ）。全エッジの stub を探索の前に登録するので、先に引く経路は後のエッジの stub を避ける。隣のブロックを結ぶ直線も通常の経路なので占有を登録し、交差の費用の判定も通る（試作の限界の解消。例: `a → b` の直線の後に引く `x → y` は直線を横切らずに回り込む。テストで確認）。
- **順序**: YAML の順に貪欲に引く（全体最適ではない）。交差が残れば検査で検出する。
- **`layout/no-route`（error）**: 経路がない（node に囲まれている、接している node の間、stub が向かいの node に当たる）、両端が同じ点、または端の間隔が矢じりより狭い。位置はエッジ（`edges[i]`）。他のエッジは引く。`layoutStructuredFigure` は error として失敗を返す。
- **エッジのラベル（`labels.ts`、試作 `edge-labels.ts` と同じ）**: 矢じりのある端（target、なければ source）の最後の線分で、矢じりの手前に置く。水平なら線の上、垂直なら線の右、間隔 3 unit。矢じりのない線は最も長い線分の中央。衝突は避けず、検査で検出する（段階 B で解消を検討）。
- **内容とキャンバス**: 経路とエッジのラベルを含めて `content` を広げる。上か左にはみ出した場合は全体（node・group・ラベル・経路）を平行移動して、内容の左上を余白の位置に保つ。キャンバスは配置エンジンと同じ式（内容＋両側の余白を整数 unit に切り上げ）。
- **Layout IR への追加**（既存のフィールドは変えていない）:

  | 項目 | 内容 |
  | --- | --- |
  | `EdgeRoute.net` | ネットの番号（`LayoutIR.nets` の添字） |
  | `EdgeRoute.fromSide` / `toSide` | 使った辺。junction の端では省略 |
  | `LayoutIR.nets` | `{ id, edges, segments }[]`。`edges` は文書順。`segments` はネットの全経路の和を、最大の軸平行な線分にまとめたもの（水平を y・x の順、次に垂直を x・y の順。各線分は小さい端から）。共有の幹線を 1 回だけ描くのに使う |

  `route.points` は直交の折れ線で、同じ点の繰り返しと一直線上の中間点を含まない。共有の幹線は各エッジの折れ線にも含まれる（§6.21 の契約どおり）。
- **検査（`check.ts`、`checkRoutes(ir, layout)`）**: ルータの仕組みに依らず、Layout IR だけで確かめる: 経路のないエッジ、直交でない線分、同じ点の繰り返し・一直線上の中間点・折り返し、node の貫通（下記の lint と同じ関数。自分の端の node も、端に接する線分以外で入れば検出）、端点のずれ（輪郭上にない、junction の中心でない、anchor の位置でない、辺に垂直でない、要素から離れる向き（内側から入る group では入る向き）でない）、異なるネットの交差・接触（一方の点が他方の線上）・重なり、矢じりより短い最後の線分、エッジのラベルの衝突（node・ラベル・経路・group の枠）、内容やキャンバスの外の点。
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

  - 最初の版（格子全体の Dijkstra、すべての隣り合う線の中点）は 10 × 10 の図で 953ms（格子 456 × 141、取り出し 746 万回）で、CI（coverage 付き）では 10〜20 秒かかった。A\*、探索範囲、中点をポートの線の間に入れないこと（格子 434 × 102）、ヒープを型付き配列に、占有の判定を内側のループに展開したことで 193ms（取り出し 180 万回程度）になった。図 A・B の経路は変わっていない（golden は同じ）。残りの探索は、交差（300）・折れ（40）の費用が下界との差になる範囲を調べる分で、乱数の密なエッジでは範囲の大部分になる。
  - 格子は node・ポートの数に対して縦横それぞれ線形に増えるので、点の数は 2 乗で増える。数百 node の図では、ポートの線をそのエッジの探索だけに使う（他のエッジの格子から外す）などがさらに必要になりうる。
- **決定性**: 図 A・B の経路込みの Layout IR を golden（`tests/fixtures/layout/*.routed.layout.json`）とバイト単位で比べ、2 回の実行の一致も確かめる。合成図でも 3 回の出力が一致することを確かめる。union-find の根は小さい添字、ネットの番号は文書順、Map の走査は挿入順だけを使う。
- **限界（判断）**: 交差の最小化は貪欲。エッジのラベルの衝突は解消しない。アウトライン部品の端点は衝突領域（凸包）の上で、描く輪郭（凹みがある場合）とは一致しないことがある。junction の端には stub がないので、junction に入る矢じりは短い線分の上に描かれうる（junction へは `line` を推奨。§6.20）。
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
- **矢じり**: 経路の端に、最後の線分の向きで描く多角形（`marker` は使わない。id が要らず、決定的）。長さは `arrowheadLength()`（ルータが空けた長さ）以下、幅はその半分ずつ。triangle・arrow（切り欠き付き）・diamond・circle・box は `filled` なら線の色で塗り、そうでなければ白で塗って線の色で縁取る。cross は線。線（下記）は矢じりの底で止める（cross と none は止めない）。
- **線とネット（判断）**: 共有の幹線を 2 回描かないよう、線は edge ごとではなく**ネットごと・線のスタイル（色・太さ・破線・不透明度）ごと**に 1 本の path（`path.sumi-wire`、最大の軸平行な線分の和、丸い端）で描く。重ねて描くと、破線の幹線は位相のずれで実線のように見え、半透明の幹線は濃くなるため。線分の和は各 edge の折れ線から矢じりの分を除いて作る（`nets[].segments` は矢じりの下まで含むので、そのままは使わない）。**ネットの中でスタイルが混ざる場合**はスタイルごとに別の path にし、両方が通る区間は両方で描く（文書順で後の edge が上）。inspect のための edge ごとの `path.connection` は経路全体（M/L）を持ち、線幅と破線は書くが `stroke` は書かない（SVG の初期値 `none` なので見えない）。そのため幾何 lint・編集可能 PPTX は従来どおり edge ごとの経路を読む。
- **エッジのラベル**: `route.label`（node のラベルと同じ描き方）。edge の `fill` が `transparent` でなければ、ラベルの行の箱を 1 unit 広げた矩形を背景に描く（#31。ルータはラベルを線から 3 unit 離すので、線は隠れない）。
- **フォント（判断）**: `@font-face` は、使ったフォント class ごとに、フォントセットのファイル（幾何 lint の `fontFileFor()` と同じ対応）から、描いた文字だけの **TrueType のサブセット**（`data:font/ttf;base64`）を埋め込む。family 名は `sumi-<n>-font-<class>`（`<n>` は描画部分の FNV-1a。同じページに複数の図を置いても衝突しない）。PDF・PPTX の `resolveSvgFonts()` は `d2-<n>-font-*` と同じく `sumi-<n>-font-*` を同梱 TTF の実名に書き換える。
  - サブセットは WASM エンジンの新しい export `subset`（krilla が PDF に使う subsetter 0.2.6 をそのまま呼ぶ）で作る。subsetter は PDF の CID フォント用で `cmap` と `OS/2` を落とすので、TS 側（`src/render/font-subset.ts`）が、元の `cmap` で文字を glyph に引き、複合 glyph の部品を推移的に加えて昇順に並べた glyph の列を渡し（新しい glyph ID が `.notdef` に続いてこの順になることを WASM 側でも確かめる）、新しい `cmap`（BMP は 3/1 の format 4、全体は 3/10 の format 12）と元の `OS/2` を加えてフォントを組み直す（tag 順、checksum、`head.checkSumAdjustment`）。フォントにない文字は `cmap` に入れない（閲覧側の代替。`lint/missing-glyph` が報告する）。format 4 の長さ（16 bit）に収まらないほど区間が多い場合（約 8,000 区間）は format 12 だけを書く。subsetter は `.notdef` を必ず含めるので、複合 glyph の部品の探索も `.notdef` から始める。
  - 検証: ヘッドレス Chrome で図 A の SVG の `@font-face` が `loaded` になり、`getComputedTextLength()` が Layout IR の行の幅と 0.05 unit（0.04%）以内で一致した（§6.5 のブラウザ確認と同じ丸めの差）。テストでは、埋め込んだフォントが描いた全文字を収録し、advance が元のフォントと一致することを確かめる。WOFF にはしない（圧縮を WASM か TS に足す必要があり、図 A で regular の TTF が約 11.6KB と十分小さいため）。
  - ライセンス: BIZ UD は OFL 1.1（Reserved Font Name なし）。サブセットは `name` テーブル（著作権・ライセンスの記述）を保つ。D2 も同じフォントのサブセットを SVG に埋め込んでいる。subsetter はもともと krilla の依存として WASM に入っていた crate なので、`Cargo.lock` は sumi-pdf の依存の行が増えるだけで、`THIRD_PARTY.md`・`licenses/` は変わらない。WASM（CONTRIBUTING の手順どおり CI の linux-x64 のビルドを `--adopt` で取り込んだもの）は 3,565,005 → 3,566,734 バイト（+1,729）。
- **メタデータ**: 形式 1 のまま、`backend="sumi-structured"`、`backend-version` は Sumi の版、`d2-sha256` は書かない（D2 ソースがない）。`readSvgMetadata()` は `sumi-structured` のときだけ `d2-sha256` を省略可とし、`SumiSvgMetadata.d2Sha256` は任意になった。PDF の文書情報と PPTX の custom properties は `SumiD2Sha256` を省く。
- **CLI**: structured の図に `--emit-d2` を付けると使い方の誤り（exit 2、何も書かない）。
- **PDF・PPTX**: PDF・画像方式の PPTX は既存の経路のまま。**編集可能 PPTX も対応した**: `path.connection` に `stroke` がないので、線の色は Figure IR の `stroke` から取り（既存の処理）、矢じりは Figure IR の種類と既定の大きさ（`marker` がないため）になる。freeform・glued の両方で全 edge が線を持つことをテストで確かめた。
- **幾何 lint**: 既存の規則がそのまま掛かる（`edge-through-node` を含む）。#89 の残りの受け入れ条件として、図 A の fixture（paper-single で 90.13mm）で `geometry/exceeds-page-width` だけが出て、paper-double では何も出ないことを確かめた。`geometry/reversed-edge` は structured の図には掛けない（`layout.direction` と ELK の閉路の処理が前提の規則で、structured では配置の木が向きを決めるため）。
- **決定性**: 数値は小数 6 桁以内（Layout IR の座標は 3 桁、それを半分にした中心・半径は 4 桁なので、図形の範囲が丸めで変わらない）、Map は挿入順だけを走査、フォントのサブセットは 1 つの WASM と整数演算。2 回の描画のバイト一致をテストし、examples の SVG・PDF・PPTX の golden は CI の Linux / macOS と release の 4 ターゲットで検査される。
- **作例（golden）**: `examples/transformer`（図 A、academic / paper-single。88mm に収めるため、列の間隔と位置エンコーディングの注記の gap を図 A の fixture より狭くした。正弦波のアイコンは #94 までは `~` の円）と `examples/dit-block`（図 B の adaLN のパネル、color / paper-single、tone・group のラベル・ラベル付きのバス。color テーマの太い線の矢じりに合わせて縦の間隔は 3mm）。ギャラリー・PDF・PPTX の golden は追加だけで、既存のものは変わらない。
- **テスト**（`src/render/structured.test.ts` ほか）: 作例と fixture の 4 図で、実際の `inspectSvg()` が通り、bbox・ラベルの anchor / 行 / 行送り / フォント class・経路が Layout IR と一致すること、決定性とメタデータ、埋め込みフォント、PDF・PPTX（両方式）への変換と編集可能 PPTX の線、幾何 lint（作例と B は 0 件、A は `exceeds-page-width`）。全部品（アウトライン・mark・各形）を 1 図に置いた図の inspect と幾何 lint 0 件、全矢じりが `arrowheadLength()` 以内、線分の結合、D2 の破線の式、サブセットの cmap / advance / 複合 glyph。CLI の E2E（SVG・PDF・PPTX 両方式、`--emit-d2` の拒否）。PDF の文字位置が幾何 lint の再計測と 0.01pt 以内で一致することは、既存の PDF の構造検査が examples に自動で掛かる。
- **限界・引き継ぎ**: 空行（renderedLines で空になった行）は中身のない `<tspan>` になり、ブラウザによっては `dy` が効かない（D2 と同じ）。junction に入る矢じりは短い線分の上に描かれうる（§6.22）。operator の記号の上下は文字の行の箱の中央で、記号の字形の中心とは少しずれうる。エッジのラベルの衝突はルータの限界のまま（§6.22）。#93（数式）は、`<tspan>` の上付き・下付きと数式フォントのサブセットを同じ writer と `subset` に足す。#94（画像・アイコン）は、inspect の bbox の対象にならないよう `g.shape` の外か、許可した図形として描き、入れ子の `<svg>` は使わない。#95（Skill）は structured の書き方・`layout/no-route` の直し方・`--emit-d2` の制約を教える。

## 7. 実装順
1. #4: Diagnostic・Result 型、位置付き YAML 解析、Figure Schema（Zod）＋ JSON Schema 生成、参照検証（重複 ID・未知の端点 / グループ・グループの循環）、fixtures
2. #5 / #6 / #7（#4 の後に並行可能）
   - #5: manifest の型と検証、Registry、テスト用の最小 manifest
   - #6: Theme の形式、token 解決、style のマージ、量子化と値域の検査、フォントセットの同梱
   - #7: 単位パーサ、Profile の形式、組み込み Profile、事前検査
