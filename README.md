# Sumi

Sumi は、事前定義されたコンポーネントとデザインシステムから図を構築する、汎用的な Diagram-as-Code CLI です。

`*.sumi.yaml` を一次ソースとし、コンポーネントレジストリ → テーマ／プロファイル解決 → Figure IR → D2（ELK）→ SVG → Lint のパイプラインで図を生成・検証します。現在は開発初期段階です（[ロードマップ](https://github.com/nishide-dev/sumi-diagram/issues/1)）。

`*.sumi.yaml` の形式は [Phase 1 設計](docs/design/phase1.md) の Figure Schema v1 で定義し、エディタ補完用の JSON Schema を [`schema/figure.v1.schema.json`](schema/figure.v1.schema.json) に置いています。

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

`d2` は次の順に探します。

1. API のオプションで明示したパス
2. 環境変数 `SUMI_D2_PATH`
3. `.sumi/bin/d2`（`bun run d2:install` で入れたもの）
4. `PATH` 上の `d2`

別の場所にある v0.9.0 を使う場合は `SUMI_D2_PATH=/path/to/d2` を設定してください。D2 の統合テストは `d2` が見つからなければスキップされます（CI では必須）。

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
