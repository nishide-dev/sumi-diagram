# Sumi

Sumi は、事前定義されたコンポーネントとデザインシステムから図を構築する、汎用的な Diagram-as-Code CLI です。

`*.sumi.yaml` を一次ソースとし、コンポーネントレジストリ → テーマ／プロファイル解決 → Figure IR → D2（ELK）→ SVG → Lint のパイプラインで図を生成・検証します。現在は開発初期段階です（[ロードマップ](https://github.com/nishide-dev/sumi-diagram/issues/1)）。

`*.sumi.yaml` の形式は [Phase 1 設計](docs/design/phase1.md) の Figure Schema v1 で定義し、エディタ補完用の JSON Schema を [`schema/figure.v1.schema.json`](schema/figure.v1.schema.json) に置いています。

## ギャラリーと例

- [コンポーネントギャラリー](docs/gallery/README.md)（[単体の HTML 版](docs/gallery/index.html)）: 組み込み部品のすべての variant を、組み込みテーマごとに描画した一覧。部品ごとの説明・props・それを生成する YAML と、同じ図をテーマ × プロファイルで描き比べた例を載せています。
- [`examples/`](examples/README.md): 汎用的な図の例（pipeline、decision flow、system architecture、入れ子のグループ）。各ディレクトリに元の `*.sumi.yaml` と生成した SVG があります。

どちらも `bun run gallery` で再生成します（CI の `bun run gallery:check` で、ソースと SVG が一致していることを検査します）。

## インストール（リリース版）

[GitHub Releases](https://github.com/nishide-dev/sumi-diagram/releases) で、macOS（arm64 / x64）と Linux（x64 / arm64）向けの tarball を配布しています。Bun・Node.js は不要です。Windows 版はまだありません。

tarball には次が入っています。

| パス | 内容 |
| --- | --- |
| `bin/sumi` | Sumi 本体（`bun build --compile` の単一実行ファイル） |
| `libexec/sumi/d2` | 固定版の D2 CLI v0.9.0（公式バイナリを無改変で同梱。MPL-2.0） |
| `share/sumi/fonts/` | 同梱フォント（BIZ UD ゴシック。SIL OFL 1.1） |
| `LICENSE`・`licenses/`・`NOTICE` | Sumi（MIT）と同梱物（Bun ランタイム・bundle した npm パッケージ・D2・フォント）のライセンス、出典と版 |
| `SHA256SUMS` | tarball 内の全ファイルの sha256 |

```sh
version=0.1.0 target=darwin-arm64   # darwin-arm64 | darwin-x64 | linux-x64 | linux-arm64
base=https://github.com/nishide-dev/sumi-diagram/releases/download/v$version
curl -LO "$base/sumi-$version-$target.tar.gz"
curl -LO "$base/SHA256SUMS"
shasum -a 256 --check --ignore-missing SHA256SUMS   # Linux では sha256sum --check --ignore-missing SHA256SUMS

mkdir -p ~/.local/opt ~/.local/bin
tar -xzf "sumi-$version-$target.tar.gz" -C ~/.local/opt
ln -sf ~/.local/opt/sumi-$version-$target/bin/sumi ~/.local/bin/sumi   # ~/.local/bin を PATH に通しておく
sumi doctor
```

- 展開したディレクトリの構成は変えないでください。`sumi` は自身の実体の位置（シンボリックリンクは解決します）から `../libexec/sumi/d2` と `../share/sumi/fonts/` を探します。`bin/sumi` だけを別の場所にコピーすると D2 とフォントが見つかりません。
- `sumi doctor` は、実行モード（`compiled`）、使う D2 の場所（`bundled`）とバージョン、同梱フォントの sha256 を確認します。
- macOS でブラウザからダウンロードした場合、`sumi` と `d2` は公証（notarization）されていないため Gatekeeper に止められることがあります。上のように `curl` や `gh release download` で取得するか、`xattr -dr com.apple.quarantine <展開したディレクトリ>` を実行してください。
- npm には公開していません（`sumi` は npm で使用済みの名前です）。

## セットアップ

Bun のバージョンは [`.bun-version`](.bun-version) で固定しています（現在 1.3.14）。

```sh
bun install --frozen-lockfile
```

## D2 のインストール

レイアウトと SVG 出力には [D2](https://d2lang.com) CLI を使います。出力は同じバージョン内でのみ決定的なため、**D2 v0.9.0 に固定**しており、それ以外のバージョンはエラー（`backend/d2-version-mismatch`）になります。

```sh
bun run d2:install
```

公式リリースから現在のプラットフォーム（macOS / Linux の arm64・amd64）向けの tarball を取得し、[`src/backends/d2/version.ts`](src/backends/d2/version.ts) に記録した sha256 で検証してから `.sumi/bin/d2`（git 管理外）に配置します。既に v0.9.0 が入っていれば何もしません（`--force` で再インストール）。

`d2` は次の順に探します（`sumi doctor` の `source` に、どれを使ったかを表示します）。

1. API のオプションで明示したパス（`option`）
2. 環境変数 `SUMI_D2_PATH`（`env`）
3. リリース版のときだけ: `sumi` と同じ tarball の `libexec/sumi/d2`（`bundled`）
4. 作業ディレクトリの `.sumi/bin/d2`（`bun run d2:install` で入れたもの。`managed`）
5. `PATH` 上の `d2`（`path`）

1・2 で指定したパスが存在しなければ、次へ進まずにエラーにします。

別の場所にある v0.9.0 を使う場合は `SUMI_D2_PATH=/path/to/d2` を設定してください。D2 の統合テストは `d2` が見つからなければスキップされます（CI では必須）。

## 使い方

ソースから実行する場合は `bun src/cli/index.ts <command>`（または `bun link` 後に `sumi <command>`）とします。`sumi --help`、`sumi <command> --help` で使い方を表示します。

```sh
sumi render figure.sumi.yaml                     # figure.svg を出力
sumi render figure.sumi.yaml -o out.svg --emit-d2 out.d2 --profile paper-double --theme academic
sumi lint figures/*.sumi.yaml --max-warnings 0   # 描画せずに検査
sumi lint --geometry figure.sumi.yaml            # D2 で描画し、幅・文字のはみ出し・重なりも検査
sumi fmt figure.sumi.yaml                        # その場で整形（--check で検査のみ）
sumi doctor                                      # D2・同梱フォントなど環境の確認
sumi catalog --kind node                         # 使える部品の一覧
```

| コマンド | 内容 | 主なオプション |
| --- | --- | --- |
| `render <file>` | 全段（D2 を含む）を実行し、SVG を書き出す。続けて描画結果に幾何 lint（`geometry/*`。ページ幅の超過・ラベルのはみ出しなど）を実行する。幾何 lint に error があっても SVG は書き出し（確認できるように）、終了コードは 1 になる。既定の出力先は入力の `.sumi.yaml` を `.svg` に替えたパス。書き込みは一時ファイル経由で行う | `-o, --out <file>`（`-` で stdout）、`--emit-d2 <file>`、`--theme <name>`・`--profile <name>`（ファイルを編集せずに上書き）、`--no-geometry`（幾何 lint を省く）、`--json` |
| `lint <files...>` | 描画せずに schema・参照・部品・Theme・Profile と構造 lint を検査する。`--geometry` を付けると D2 で描画し（ファイルは書かない）、幾何 lint も実行する（[規則の一覧](docs/lint-rules.md)） | `--geometry`、`--json`、`--config <lint.json>`、`--rule <id>=<level>`（繰り返し可。`geometry/*` も可）、`--max-warnings <n>`（全ファイルの合計） |
| `fmt <files...>` | YAML を意味を変えずに整形する（コメント・引用符・キー順は保つ）。YAML として不正なファイルは整形しない | `--check`（書き込まずに未整形のファイルを列挙）、`--stdout`、`--canonical-order`（既知のキーを schema の順に並べる） |
| `doctor` | Sumi / Bun のバージョン、D2 の有無とバージョン、同梱フォントの sha256、幾何 lint 用のフォントの metrics を読めるかを確認する | `--json` |
| `catalog` | 部品の一覧（`--json` は `buildCatalog()` の出力そのもの） | `--json`、`--kind node\|group\|edge` |

### 出力先と終了コード

| 出力 | 内容 |
| --- | --- |
| stdout | 結果: lint / doctor / catalog の報告、`--json` の JSON、`fmt` が書き換えた（`--check` では未整形の）ファイル名、`fmt --stdout` の本文、`render` の `Wrote …`、`render -o -` の SVG |
| stderr | `render`・`fmt` の診断、使い方の誤り、ログ（`render -o -` のときの `Wrote …` も含む） |

| 終了コード | 意味 |
| --- | --- |
| 0 | 成功（warning・info はあってもよい） |
| 1 | 問題あり: error がある（`render` の幾何 lint の error を含む。SVG は書き出す）、warning が `--max-warnings` を超えた、`fmt --check` で未整形のファイルがある、`fmt` の入力が YAML として不正、`doctor` の必須項目が失敗した |
| 2 | 使い方の誤り・内部エラー: 不正なフラグや設定、読めない / 書けないファイル、未知の theme / profile、例外 |

- 色は端末への出力にだけ付けます。`--no-color` または `NO_COLOR=1` で無効、`FORCE_COLOR=1` で常に有効になります。
- 使い方の誤りはスタックトレースを出さず 1 行で報告します。内部エラーのスタックトレースは `SUMI_DEBUG=1` で表示します。
- 出力は同じ入力に対して決定的です。JSON の形式は `version` で版を管理します。

## Claude Code から使う

このリポジトリには Claude Code 用の Skill（[`.claude/skills/sumi/`](.claude/skills/sumi/SKILL.md)）が含まれています。リポジトリで Claude Code を開き、「この処理の流れを Sumi で図にして（論文の 1 段組）」のように頼むと、Skill が次の手順で図を作ります。

1. 図の内容と出力先（`paper-single` / `paper-double` / `presentation-16x9`）を確認する
2. `sumi doctor` で環境を確認し、`sumi catalog --json` で使える部品・variant・props を調べる（存在しない部品やスタイルは使わない）
3. `*.sumi.yaml` を書き、`sumi fmt` → `sumi lint --json` → 診断の `code` / `path` / `hint` に従って修正する
4. `sumi render` で SVG を出力し、幾何 lint（`geometry/*`）の診断を確認したうえで、PNG に変換して目視で確認する
5. 作成したファイル・サイズ・残った warning・仮定を報告する（修正が進まない場合や、内容・Profile の判断が必要な場合は推測せずに確認する）

Skill は CLI をソースから実行するラッパー（`.claude/skills/sumi/scripts/sumi`）を使います。作業ディレクトリによらず動き、`SUMI_D2_PATH` が未設定ならリポジトリの `.sumi/bin/d2` を使うため、事前に `bun install` と `bun run d2:install` を済ませておいてください。手順の詳細と、診断・レイアウトの参照資料は `.claude/skills/sumi/references/` にあります。Skill の記述（部品名・診断コード・作例の YAML）は `src/cli/skill.test.ts` で実装と照合しています。

## 開発コマンド

| コマンド | 内容 |
| --- | --- |
| `bun run check` | Biome による format / lint チェック |
| `bun run check:fix` | Biome による自動修正 |
| `bun run typecheck` | `tsc --noEmit` による型チェック |
| `bun test` | テスト実行 |
| `bun run schema:gen` / `schema:check` | JSON Schema の再生成 / 差分検査 |
| `bun run d2:install` | 固定バージョンの D2 CLI を `.sumi/bin/d2` に導入 |
| `bun run src/cli/index.ts --help` | CLI をソースから実行 |
| `bun run example:render <file> [out.svg]` | `sumi render` の別名（`examples/` の再生成用） |
| `bun run release:build --target <target>` | リリース用 tarball を `dist/release/` に作る（[リリース手順](CONTRIBUTING.md#リリース)） |
| `bun run release:smoke <tarball>` | tarball を一時ディレクトリに展開し、Bun・Node.js のない `PATH` で `--version`・`doctor`・`render` を確認する |
| `bun run gallery` / `gallery:check` | `docs/gallery/` と `examples/*/*.svg` の再生成 / 差分検査（D2 が必要） |

## ディレクトリ構成

| パス | 役割 |
| --- | --- |
| `src/cli` | CLI エントリポイントとコマンド定義 |
| `src/core` | スキーマ・IR・共通ユーティリティ |
| `src/backends` | レイアウトバックエンド（D2 / ELK） |
| `src/render` | SVG 出力 |
| `src/lint` | 構造・視覚 Lint |
| `schema` | 生成された JSON Schema（手で編集しない） |
| `tests/fixtures` | テスト用の入力ファイル |
| `examples` | 図の例（`*.sumi.yaml` と生成した SVG） |
| `docs/gallery` | 生成されたコンポーネントギャラリー（手で編集しない） |

## ライセンス

Sumi は [MIT License](LICENSE) で提供する。同梱・配布するサードパーティのファイルは、それぞれのライセンスに従う（BIZ UD ゴシック: SIL Open Font License 1.1 — `assets/fonts/biz-ud-gothic/OFL.txt`。リリース版の tarball に同梱する D2: Mozilla Public License 2.0 — tarball の `licenses/d2/`。出典と版は tarball の `NOTICE`）。
