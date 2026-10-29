# Sumi {{version}} ({{target}})

Sumi は、事前定義されたコンポーネントとデザインシステムから図を構築する Diagram-as-Code CLI です。`*.sumi.yaml` から SVG・ベクター PDF を生成します。Bun・Node.js は不要です。

詳しい使い方: https://github.com/nishide-dev/sumi-diagram

## 内容

| パス | 内容 |
| --- | --- |
| `bin/sumi` | Sumi 本体（単一実行ファイル） |
| `libexec/sumi/d2` | レイアウトに使う D2 CLI v{{d2Version}}（MPL-2.0。`licenses/d2/`） |
| `share/sumi/fonts/` | 同梱フォント BIZ UD ゴシック（SIL OFL 1.1。`licenses/biz-ud-gothic/`）、ラベルの数式用の STIX Two Math・STIX Two Text Italic（SIL OFL 1.1。`licenses/stix-two/`）、欧文用の Inter（SIL OFL 1.1。`licenses/inter/`。font set `sumi/inter-biz-ud-gothic` のみ） |
| `LICENSE` | Sumi のライセンス（MIT） |
| `licenses/bun/`・`licenses/npm/` | `bin/sumi` に含まれる Bun ランタイムと npm パッケージのライセンス |
| `licenses/pdf-wasm/` | `bin/sumi` に含まれる PDF エンジン（krilla・krilla-svg と Rust の依存クレート。WebAssembly）のライセンスと一覧（`THIRD_PARTY.md`） |
| `licenses/tabler-icons/` | `bin/sumi` に含まれるアイコン集 Tabler Icons（MIT。Brand カテゴリを除く outline）のライセンス |
| `licenses/fluent-emoji/` | `bin/sumi` に含まれる多色の Fluent Emoji Flat（MIT、Microsoft、Iconify JSON 1.2.6 経由、SVG importer 対応の 3,124 点）のライセンス。`icon: emoji/fire` 等で利用。名前は `sumi catalog --icons ""` で確認。使ったものだけ図に埋め込み、SVG/PDF/PPTX のメタデータにも告知を保持 |
| `NOTICE` | 同梱物の出典・版・ライセンス |
| `SHA256SUMS` | このディレクトリ内の全ファイルの sha256 |

## インストール

ディレクトリ構成を保ったまま任意の場所に置き、`bin/sumi` を `PATH` に通すか、`PATH` 上のディレクトリからシンボリックリンクを張ります。`sumi` は自身の実体の位置（シンボリックリンクは解決します）から `../libexec/sumi/d2` と `../share/sumi/fonts/` を探すため、`bin/sumi` だけを別の場所へコピーしないでください。

```sh
mkdir -p ~/.local/opt
tar -xzf sumi-{{version}}-{{target}}.tar.gz -C ~/.local/opt
ln -s ~/.local/opt/sumi-{{version}}-{{target}}/bin/sumi ~/.local/bin/sumi
sumi doctor
```

macOS でブラウザからダウンロードした場合、`sumi` と `d2` は公証（notarization）されていないため Gatekeeper に止められることがあります。`curl -LO` や `gh release download` で取得するか、展開したディレクトリに `xattr -dr com.apple.quarantine <dir>` を実行してください。

`sumi doctor` は D2 の場所とバージョン（`bundled` と表示されます）、同梱フォントの sha256 を確認します。別の D2 v{{d2Version}} を使う場合は `SUMI_D2_PATH` を設定してください。

## 使い方

```sh
sumi render figure.sumi.yaml          # figure.svg を出力
sumi render figure.sumi.yaml -o figure.pdf   # ベクター PDF を出力
sumi lint figure.sumi.yaml            # 描画せずに検査
sumi fmt figure.sumi.yaml             # 整形
sumi catalog                          # 使える部品の一覧
sumi --help
```
