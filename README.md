# Sumi

Sumi は、事前定義されたコンポーネントとデザインシステムから図を構築する、汎用的な Diagram-as-Code CLI です。

`*.sumi.yaml` を一次ソースとし、コンポーネントレジストリ → テーマ／プロファイル解決 → Figure IR → D2（ELK）→ SVG → Lint のパイプラインで図を生成・検証します。現在は開発初期段階です（[ロードマップ](https://github.com/nishide-dev/sumi-diagram/issues/1)）。

## セットアップ

Bun のバージョンは [`.bun-version`](.bun-version) で固定しています（現在 1.3.14）。

```sh
bun install --frozen-lockfile
```

## 開発コマンド

| コマンド | 内容 |
| --- | --- |
| `bun run check` | Biome による format / lint チェック |
| `bun run check:fix` | Biome による自動修正 |
| `bun run typecheck` | `tsc --noEmit` による型チェック |
| `bun test` | テスト実行 |
| `bun run src/cli/index.ts --help` | CLI をソースから実行 |

## ディレクトリ構成

| パス | 役割 |
| --- | --- |
| `src/cli` | CLI エントリポイントとコマンド定義 |
| `src/core` | スキーマ・IR・共通ユーティリティ |
| `src/backends` | レイアウトバックエンド（D2 / ELK） |
| `src/render` | SVG 出力 |
| `src/lint` | 構造・視覚 Lint |
