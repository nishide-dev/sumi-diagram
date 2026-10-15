# Contributing to Sumi

Sumi への貢献ガイドです。Issue・ブランチ・コミット・PR の形式を揃え、履歴と議論を追いやすく保つことを目的とします。全体の設計方針とロードマップは [#1](https://github.com/nishide-dev/sumi-diagram/issues/1) を参照してください。

## 言語の使い分け

| 対象 | 言語 |
| --- | --- |
| Issue / PR のタイトル | 英語 |
| Issue / PR の本文・議論・チェックリスト | 日本語 |
| コミットメッセージ | 英語 |
| コード・識別子・コード内コメント | 英語 |

## 開発の流れ

1. 作業対象の Issue を用意する（なければ作成する）。
2. `main` から Issue 番号入りのブランチを切る。
3. 小さな単位でコミットし、ローカルでチェックを通す。
4. PR を作成し、関連 Issue と検証方法を記載する。
5. レビュー後、**squash merge** で `main` に取り込む。

## 開発コマンド

```sh
bun install         # 依存関係のインストール
bun run check       # Biome による format / lint の検査
bun run check:fix   # Biome による自動修正
bun run typecheck   # tsc による型検査
bun test            # テスト
```

PR を出す前に `bun run check`、`bun run typecheck`、`bun test` がすべて通ることを確認してください。CI でも同じ検査を実行します。

## ブランチ名

```
<type>/<issue-number>-<short-description>
```

- `<type>` はコミットの type と同じ語彙を使う
- `<short-description>` は英小文字のケバブケース
- 例: `feat/4-figure-schema`、`fix/12-duplicate-id`、`docs/2-contribution-conventions`

## コミットメッセージ

[Conventional Commits](https://www.conventionalcommits.org/) に従い、英語で書きます。

```
<type>(<scope>): <summary>
<type>: <summary>
```

- scope を省略する場合は括弧ごと省略する。`feat(): ...` のような空の scope は不可
- summary は英語の命令形・小文字始まり・末尾ピリオドなし（例: `add`, `fix`, `handle`）
- 破壊的変更は `feat(schema)!: ...` のように `!` を付け、本文に `BREAKING CHANGE:` で内容を書く

### type

| type | 用途 |
| --- | --- |
| `feat` | 機能の追加 |
| `fix` | バグ修正 |
| `docs` | ドキュメントのみの変更 |
| `refactor` | 振る舞いを変えないコードの整理 |
| `perf` | 性能改善 |
| `test` | テストの追加・修正 |
| `build` | ビルド・依存関係・配布（`bun build --compile` など） |
| `ci` | CI 設定 |
| `chore` | 上記に当てはまらない雑務（設定ファイル、整形のみの変更など） |

`style` は使いません。整形は Biome が担うため、整形のみの変更は `chore` とします。

### scope

scope は変更対象のモジュール名を短く書きます（例: `cli`, `schema`, `registry`, `theme`, `profile`, `compiler`, `d2`, `svg`, `lint`, `skill`）。複数領域にまたがる場合は省略して構いません。

### 例

```
feat(registry): add component manifest loader
fix(compiler): handle missing edge targets
docs: describe output profile options
test(lint): cover duplicate node ids
ci: run typecheck on pull requests
feat(schema)!: rename `nodes` to `elements`
```

## Pull Request

- **タイトル**: 英語の Conventional Commits 形式。squash merge 後のコミットメッセージになるため、コミットと同じ規則を守る
- **本文**: 日本語。[PR テンプレート](.github/pull_request_template.md) の「概要 / 変更点 / 検証方法 / 関連 Issue」を埋める
- **関連 Issue**: 本文に `Closes #<number>` を書くと、マージ時に Issue が自動でクローズされる。複数ある場合は `Closes #4, Closes #5` のように各番号に付ける。クローズしない参照は `Refs #<number>` とする
- 1 つの PR は 1 つの目的に絞る

例:

```
Title: feat(schema): define figure YAML schema and diagnostics

## 概要
Figure YAML のスキーマと共通 Diagnostic 型を定義する。

## 関連 Issue
Closes #4
```

### マージ方式

**squash merge** を基本とします。PR 内の個々のコミットは最終履歴に残らないため、PR タイトルと本文の整理を優先してください。マージ後はブランチを削除します。

## Issue

- タイトルは英語、本文は日本語。[Issue テンプレート](.github/ISSUE_TEMPLATE/) を利用する
- タイトルは内容を表す英語の短文とする（例: `Define figure YAML schema and diagnostics`）。Conventional Commits の接頭辞は不要
- 受け入れ条件はチェックリストで書く

## 部品の追加・変更

組み込み部品（`src/core/registry/builtins.ts` の manifest）を追加・変更する PR は、次をすべて含めてください。部品は人間と AI エージェントの双方が `sumi catalog --json` と[ギャラリー](docs/gallery/README.md)から探すため、説明・見た目・サンプルが揃っていない部品は使えないものとして扱います。

1. **カタログの記述**: manifest の `description`（何を表す部品か、英語 1 文）、`variants`、`since`、props のスキーマと各 prop の `describe()`。`sumi catalog --json` にそのまま出ます。特定の業務・研究分野に固有の部品にしないでください。
2. **テーマの対応**: すべての組み込みテーマ（`src/core/theme/builtin.ts`）で、すべての variant の見た目を定義する。定義のない variant は `theme/missing-variant`（warning）で `default` に戻り、ギャラリーの生成とテストが失敗します。
3. **ギャラリーの再生成**: `bun run gallery` を実行し、`docs/gallery/` の変更をコミットする。サンプルの図はカタログから自動で作られます（全 variant × 全テーマ）。サンプルと `examples/` は診断ゼロ（幾何 lint を含む）でなければ生成が失敗します。CI の `bun run gallery:check` が、コミットされた出力が古くないことを検査します。
4. **テスト**: 単体テスト（manifest・props・テーマの解決）と、実際の D2 で描画するテスト（`src/compiler/builtins-render.test.ts` は全部品 × 全 variant × 全テーマを自動で含みます。部品固有の描画上の約束があれば追加する）。

コンパイラ・テーマ・フォント・プロファイルを変えて SVG が変わる場合も、`bun run gallery` で例とギャラリーをまとめて再生成してください。

チェックリスト:

- [ ] `description`・`variants`・`since`・props（説明付き）を書いた
- [ ] すべての組み込みテーマで、すべての variant を定義した
- [ ] `bun run gallery` で再生成し、ギャラリーで見た目を確認した
- [ ] 単体テストと D2 描画テストを追加・更新した
- [ ] `bun run check`・`bun run typecheck`・`bun test`・`bun run gallery:check` が通る

## 設計判断の記録

- 設計上の判断・代替案・トレードオフは、**関連 Issue のコメント**に記録する。PR だけで議論を完結させない
- API や後方互換性に影響する変更は、その影響を Issue と PR の双方に明記する
- 計画やフェーズ構成が変わった場合は、ロードマップ [#1](https://github.com/nishide-dev/sumi-diagram/issues/1) を更新する
- Issue に書かれた詳細仕様は実装前の初期提案であり、検証結果に応じて見直してよい

## リポジトリ上の約束事

- 図の一次ソースは `*.sumi.yaml`。生成された `.d2` は中間成果物であり、**手で編集しない**
- 特定の業務・研究分野に固有のコンポーネントを必須機能として追加しない
