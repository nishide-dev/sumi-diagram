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

### テストをすべて実行する

D2 で実際に描画する統合テストは、固定版の D2 がなければローカルではスキップされます（CI では必須）。CI と同じ範囲を手元で通すには次を実行します。

```sh
bun run d2:install       # 固定版の D2（src/backends/d2/version.ts）を .sumi/bin/d2 に導入
bun src/cli/index.ts doctor  # Bun・D2・フォントの状態を確認
CI=1 bun test            # D2 の統合テストを必須にして全テストを実行
bun run schema:check     # schema/figure.v1.schema.json が最新か
bun run gallery:check    # examples/*/*.{svg,pdf} と docs/gallery/ が最新か（バイト一致）
```

### ゴールデンの更新

出力を意図して変えた場合は、ゴールデンを再生成して差分を確認し、同じ PR でコミットします。

| 対象 | 更新コマンド |
| --- | --- |
| D2 ソース（`tests/fixtures/d2/*.d2`） | `SUMI_UPDATE_GOLDEN=1 bun test src/compiler/d2.test.ts` |
| lint の出力（`tests/fixtures/lint-output/`） | `SUMI_UPDATE_GOLDEN=1 bun test src/lint/lint.test.ts` |
| SVG（`examples/*/*.svg`・`docs/gallery/`） | `bun run gallery` |
| PDF（`examples/*/*.pdf`） | `bun run gallery`（または `SUMI_UPDATE_GOLDEN=1 bun test src/render/pdf`。同じバイトを書く） |

SVG は D2 のバージョンとフォントが同じなら OS によらずバイト単位で一致します。D2 やフォントを更新する手順と、画像（ラスタ）比較を使わない理由は [設計 §6.7](docs/design/phase1.md#67-16-のテスト戦略と-ci) を参照してください。

### CI が検査すること

| ワークフロー | ジョブ | 内容 |
| --- | --- | --- |
| CI | Static checks（Linux） | `bun run check`・`bun run typecheck`・`bun run schema:check` |
| CI | Test（Linux / macOS） | D2 の導入、環境の記録（OS・`sumi doctor`: Bun・D2・フォントの sha256）、`bun test`（Linux ではカバレッジの表も出力。閾値なし。PDF の golden もここで両 OS のバイト一致を検査）、`bun run gallery:check` |
| CI | PDF engine reproducible build（Linux） | `bun run pdf:wasm` で PDF エンジンをソースから再ビルドし、コミット済みの `.wasm`・sha256・ライセンス一覧と一致するか（`git diff`） |
| CI | PDF LaTeX inclusion（Linux） | `bun run pdf:latex` で pdfLaTeX / LuaLaTeX に実際に取り込み、文字・位置・フォント埋め込み・ベクター・表示を検査する（TeX / Poppler はこのジョブのみで導入） |
| CI | PPTX Open XML validation（Linux） | 53ケースの通常版＋PNG対照版を生成し、固定版 Open XML SDK でスキーマを独立検証。確認用ファイルを `pptx-compatibility-fixtures` artifact に残す（.NET は検証専用） |
| CI | Release smoke（linux-x64） | `release:build` と `release:smoke`（SVG と PDF の描画を含む） |
| PR title | Conventional Commit title | PR タイトルが下記の[コミットメッセージ](#コミットメッセージ)の規則に従うか |

PR タイトルの検査は手元でも実行できます: `bun run commitlint --title "feat(cli): add doctor"`。コミットを検査する場合は `bun run commitlint origin/main..HEAD` です。検査する規則と、誤検出を避けるため検査しないこと（英語として自然か、命令形か、長さなど）は `scripts/commitlint/rules.ts` の先頭に書いてあります。

PDF の LaTeX 取り込み検証（#63）は、TeX Live と Poppler がある環境で `bun run pdf:latex` を実行します。通常の `bun test` とは独立しています。検証環境・導入パッケージ・検査内容・結果の読み方は [検証記録](docs/verification/63-pdf-latex.md) を参照してください。

### PDF エンジン（WASM）の再ビルド

PDF 出力（#59、#74）は、`native/pdf-wasm/` の Rust クレート（krilla 0.8.2 + krilla-svg 0.8.1、upstream パッチなし）を `wasm32-unknown-unknown` にビルドした `assets/wasm/sumi-pdf.wasm` を使います。生成物はコミットしてあり、通常の開発・テスト・リリースに Rust は不要です。クレート・依存の版・ツールチェーンを変えたときだけ再ビルドします。

#61 の PPTX は同じ WASM に resvg 0.47.0 の outlined SVG / PNG 生成を追加して使います。既存の `pdf:wasm` コマンドで両方を再ビルドします。PPTX の golden は `SUMI_UPDATE_GOLDEN=1 bun test src/render/pptx` で更新し、実アプリ確認の手順・制約は [検証記録](docs/verification/61-pptx.md) を参照してください。

```sh
bun run pdf:wasm   # rustup が必要。rust-toolchain.toml の版と wasm32 target は自動で導入される
```

このコマンドは、Cargo.lock の版と checksum で固定された crates.io パッケージを `cargo build --release --locked` し、`.wasm`・`src/render/pdf/engine.ts` の `PDF_WASM_SHA256`・`native/pdf-wasm/THIRD_PARTY.md`・`native/pdf-wasm/licenses/` を書き換えます。krilla のパッケージに欠けているライセンス原文は、パッケージの Git commit に対応する upstream 原文を SHA-256 検証して補います。ローカルのパス（チェックアウトと `CARGO_HOME`）は `--remap-path-prefix` で消します。

**コミットする `.wasm` は linux-x64 でのビルド**です（CI の `PDF engine reproducible build` が同じビルドをして一致を確かめます）。同じホストなら何度ビルドしても同じバイトになりますが、ホストが違うとコードの数バイトが変わります（darwin-arm64 と linux-x64 で確認。パスではなく、LLVM がホストの数学ライブラリで浮動小数の定数を畳み込むためと推測。変換結果の PDF は同じでした）。Linux 以外で変更する場合は次の手順にします。

1. `bun run pdf:wasm` で手元のビルドを作り、テストする（スクリプトは注意を表示します）。
2. ライセンス一覧などの差分と一緒に push する。CI の `PDF engine reproducible build` は `.wasm` の違いで失敗し、Linux で作った `.wasm` を artifact `sumi-pdf-wasm-linux` に残す。
3. `gh run download <run-id> -n sumi-pdf-wasm-linux -D /tmp/wasm` で取得し、`bun run pdf:wasm --adopt /tmp/wasm/sumi-pdf.wasm` で置き換える（ビルドせずにコピーし、`PDF_WASM_SHA256` を更新する）。

PDF の出力が変わる変更なら、続けて `SUMI_UPDATE_GOLDEN=1 bun test src/render/pdf` で examples の PDF と `tests/fixtures/pdf/corpus-sha256.json` を更新します。後者はギャラリー 48 図と日本語マスクの hash です。通常 CI の両 OS と release workflow の全 4 ターゲットで同じ値を検査します。

- macOS の rustup では `rust-lld` が `libLLVM.dylib` を見つけられないことがあります。スクリプトはツールチェーンの `lib/` を `DYLD_FALLBACK_LIBRARY_PATH` に入れて回避します（Linux では影響しません）。
- 依存（Cargo.lock）を変えた場合は、`THIRD_PARTY.md` のライセンスと NOTICE を確認します。krilla の NOTICE は `content_draw_path` の一部を MPL-2.0 としており、原文と対応ソースの入手先も同梱します。リリースの tarball は `licenses/pdf-wasm/` にこれらをそのまま入れます。

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

## Claude Code Skill

Skill の正は [`skills/sumi/`](skills/sumi/SKILL.md) です（`npx skills add nishide-dev/sumi-diagram` で配布。構成は skills CLI の規約 `skills/<name>/SKILL.md` に合わせる）。`.claude/skills/sumi` は `../../skills/sumi` への相対シンボリックリンクで、このリポジトリで Claude Code を開いたときに同じ Skill を読み込むためだけに置いています。ファイルは必ず `skills/sumi/` 側で編集してください。

- Skill はリポジトリの外に導入されるため、`references/` の記述はリポジトリのファイルがなくても成り立つようにする（リポジトリ内のパスを挙げるときは「in the repository」と明記する）。CLI は `scripts/sumi` 経由で呼び、その探索順（`SUMI_BIN` → ラッパーを含むソースチェックアウト → `PATH` 上の `sumi` → 作業ディレクトリの上のソースチェックアウト）を変えたら README と `src/cli/skill.test.ts` も更新する。
- 部品・Theme・Profile・診断コードを追加・変更したら、Skill の記述も合わせる。`src/cli/skill.test.ts` が、記述された名前・コード・作例の YAML・JSON の例を実装と照合します。
- skills CLI からの見え方は次で確認できます（`sumi` が 1 件だけ列挙されること）。
  ```sh
  npx -y skills@1.7.2 add . -l
  ```

## リリース

配布物は GitHub Release の tarball（ターゲットごとに `sumi` の単一バイナリ・D2 v0.9.0・同梱フォント・ライセンス・チェックサム）です。構成と判断は [設計 §6.8](docs/design/phase1.md) を参照してください。npm には公開しません。

1. **バージョンを上げる PR を出す**: `package.json` の `version` を上げ（バイナリの `sumi --version` と SVG のメタデータはこの値です）、リリースノート `docs/releases/v<version>.md`（日本語。利用者向けの変更点・互換性・既知の制約）を追加する。PR タイトルは `build: release v<version>` とする。
2. **手元で確認する（任意）**: 現在のプラットフォームの tarball を作り、smoke test を通す。
   ```sh
   bun run release:build --target darwin-arm64 --version <version>
   bun run release:smoke dist/release/sumi-<version>-darwin-arm64.tar.gz
   ```
   PR ごとに CI の `Release smoke (linux-x64)` ジョブが同じ build と smoke を実行しています。全ターゲットを試すには、Actions から `Release` workflow を手動実行（`workflow_dispatch`）します。この場合は tarball を artifact に残すだけで、Release は作りません。
3. **マージ後に tag を push する**: `main` の該当コミットに `v<version>` の annotated tag を付けて push する。
   ```sh
   git switch main && git pull
   git tag -a v<version> -m "v<version>"
   git push origin v<version>
   ```
4. `Release` workflow が、tag と `package.json` の一致、リリースノートと LICENSE の存在を確認し、4 ターゲットを native の runner でビルド・smoke test してから、tarball と `SHA256SUMS` を添付した GitHub Release を作成する（`-` を含む tag は pre-release）。失敗した場合は原因を直し、tag を付け直す（Release の作成前なら `git push --delete origin v<version>` で消せます）。

- tag は `v<major>.<minor>.<patch>`（pre-release は `v0.2.0-rc.1` など）とし、`package.json` と一致させる。
- 固定の D2 バージョンやフォントを変えた場合は、出力が変わることをリリースノートに明記する。

## 設計判断の記録

- 設計上の判断・代替案・トレードオフは、**関連 Issue のコメント**に記録する。PR だけで議論を完結させない
- API や後方互換性に影響する変更は、その影響を Issue と PR の双方に明記する
- 計画やフェーズ構成が変わった場合は、ロードマップ [#1](https://github.com/nishide-dev/sumi-diagram/issues/1) を更新する
- Issue に書かれた詳細仕様は実装前の初期提案であり、検証結果に応じて見直してよい

## リポジトリ上の約束事

- 図の一次ソースは `*.sumi.yaml`。生成された `.d2` は中間成果物であり、**手で編集しない**
- 特定の業務・研究分野に固有のコンポーネントを必須機能として追加しない
