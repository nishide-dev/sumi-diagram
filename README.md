# Sumi

Sumi は、事前定義されたコンポーネントとデザインシステムから図を構築する、汎用的な Diagram-as-Code CLI です。

`*.sumi.yaml` を一次ソースとし、コンポーネントレジストリ → テーマ／プロファイル解決 → Figure IR → D2（ELK）→ SVG → Lint のパイプラインで図を生成・検証します。MVPと当初の拡張タスクは完了し、SVG・PDF・PPTX出力に対応しています（[現行ロードマップ](https://github.com/nishide-dev/sumi-diagram/issues/80)、[初期計画の完了記録](https://github.com/nishide-dev/sumi-diagram/issues/1)）。[v0.3.0 の変更点](docs/releases/v0.3.0.md)も参照してください。

`*.sumi.yaml` の形式は [Phase 1 設計](docs/design/phase1.md) の Figure Schema v1 で定義し、エディタ補完用の JSON Schema を [`schema/figure.v1.schema.json`](schema/figure.v1.schema.json) に置いています。

## ギャラリーと例

- [コンポーネントギャラリー](docs/gallery/README.md)（[単体の HTML 版](docs/gallery/index.html)）: 組み込み部品のすべての variant を、組み込みテーマごとに描画した一覧。部品ごとの説明・props・それを生成する YAML と、同じ図をテーマ × プロファイルで描き比べた例を載せています。
- [`examples/`](examples/README.md): 汎用的な図の例（pipeline、decision flow、system architecture、入れ子のグループ）。各ディレクトリに元の `*.sumi.yaml` と生成した SVG・PDF があります。

どちらも `bun run gallery` で再生成します（CI の `bun run gallery:check` で、ソースと SVG・PDF が一致していることを検査します）。

## インストール（リリース版）

[GitHub Releases](https://github.com/nishide-dev/sumi-diagram/releases) で、macOS（arm64 / x64）と Linux（x64 / arm64）向けの tarball を配布しています。Bun・Node.js は不要です。Windows 版はまだありません。

tarball には次が入っています。

| パス | 内容 |
| --- | --- |
| `bin/sumi` | Sumi 本体（`bun build --compile` の単一実行ファイル） |
| `libexec/sumi/d2` | 固定版の D2 CLI v0.9.0（公式バイナリを無改変で同梱。MPL-2.0） |
| `share/sumi/fonts/` | 同梱フォント（BIZ UD ゴシック、数式用の STIX Two。いずれも SIL OFL 1.1） |
| `LICENSE`・`licenses/`・`NOTICE` | Sumi（MIT）と同梱物（Bun ランタイム・bundle した npm パッケージ・D2・フォント）のライセンス、出典と版 |
| `SHA256SUMS` | tarball 内の全ファイルの sha256 |

```sh
version=0.4.0 target=darwin-arm64   # darwin-arm64 | darwin-x64 | linux-x64 | linux-arm64
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
sumi render figure.sumi.yaml -o figure.pdf       # ベクター PDF を出力（--format pdf でも可）
sumi render figure.sumi.yaml -o out.svg --emit-d2 out.d2 --profile paper-double --theme academic
sumi lint figures/*.sumi.yaml --max-warnings 0   # 描画せずに検査
sumi lint --geometry figure.sumi.yaml            # D2 で描画し、幅・文字のはみ出し・重なりも検査
sumi fmt figure.sumi.yaml                        # その場で整形（--check で検査のみ）
sumi doctor                                      # D2・同梱フォントなど環境の確認
sumi catalog                                     # 使える部品・Theme・Profile の一覧
sumi catalog --kind node                         # 部品（node）だけの一覧
sumi catalog --json --section themes --section profiles   # Theme と Profile を JSON で
```

| コマンド | 内容 | 主なオプション |
| --- | --- | --- |
| `render <file>` | 全段（D2 を含む）を実行し、SVG・PDF・PPTXを書き出す。描画結果（SVG）に幾何 lintを実行し、幾何errorでも出力を残してexit 1。変換失敗時は出力しない。形式は `--format`、なければ `-o` の既知の拡張子、どちらもなければSVG。既定は入力のYAML拡張子を出力形式へ替えたパス。一時ファイル経由で書き込む | `-o, --out <file>`（stdoutはSVGのみ）、`--format svg\|pdf\|pptx`（拡張子との矛盾はusage error）、`--pptx-mode picture\|editable`（editableは実験的）、`--pptx-connectors freeform\|glued`（editableのみ）、`--emit-d2 <file>`、`--theme <name>`・`--profile <name>`、`--no-geometry`、`--json` |
| `lint <files...>` | 描画せずに schema・参照・部品・Theme・Profile と構造 lint を検査する。`--geometry` を付けると D2 で描画し（ファイルは書かない）、幾何 lint も実行する（[規則の一覧](docs/lint-rules.md)） | `--geometry`、`--json`、`--config <lint.json>`、`--rule <id>=<level>`（繰り返し可。`geometry/*` も可）、`--max-warnings <n>`（全ファイルの合計） |
| `fmt <files...>` | YAML を意味を変えずに整形する（コメント・引用符・キー順は保つ）。YAML として不正なファイルは整形しない | `--check`（書き込まずに未整形のファイルを列挙）、`--stdout`、`--canonical-order`（既知のキーを schema の順に並べる） |
| `doctor` | Sumi / Bun のバージョン、D2 の有無とバージョン、同梱フォントの sha256、幾何 lint 用のフォントの metrics を読めるかを確認する | `--json` |
| `catalog` | 部品・Theme・Profile の一覧（`--json` は `buildFullCatalog()` の出力そのもの） | `--json`、`--section components\|themes\|profiles`（繰り返し可）、`--kind node\|group\|edge`（`--section` なしでは部品だけを出す） |

### 台形と stack

v0.3.0 から、台形 `trapezoid` と重なった矩形 `stack` を使えます。インストール済みの CLI では `sumi catalog --kind node` にある部品を選びます。

- `trapezoid`: 上辺が広く、下辺が狭い台形。
- `stack`: 3枚の矩形を重ねた形。書類やレイヤーの集まりなどに使い、文字は前面に配置します。
- どちらも `default`・`emphasis`・`muted`、3テーマに対応し、props は任意の `width` / `height` です。傾き・枚数・ずれ幅は固定で、props では変更できません。通常はサイズを省略し、文字に合わせて自動配置します。

`sumi catalog --json` の `render` は Sumi が輪郭を合成する部品のメタデータで、Figure YAML に書くフィールドではありません。接続は ELK が選ぶ辺と位置に従い、輪郭までエッジを延ばします。任意位置のポートは提供しません。[ギャラリー](docs/gallery/README.md)に全 variant・全テーマの作例があります。

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
- 出力の読み手が先に終了した場合（`sumi catalog | head -1` など。EPIPE）は、残りの出力を捨てて何も表示せず、コマンド自身の終了コードで終わります。`render` の SVG や `fmt` の書き換えは最後まで行います。
- 出力は同じ入力に対して決定的です。JSON の形式は `version` で版を管理します。同じ版のうちはフィールドの追加だけを行うので、未知のフィールドは無視してください（[設計 §6.10](docs/design/phase1.md)）。

### 機械可読な出力（JSON）

`sumi catalog --json` は `{ version: 1, components, themes, profiles }` を出力します。Theme には説明・フォントセット（使える書体）・文字サイズの範囲・最小文字サイズを満たす Profile（`compatibleProfiles`）が、Profile にはページの上限・余白・最小文字サイズ・レイアウトの間隔（書かれた値、pt、mm、D2 に渡す unit）が入ります。

```json
{
  "version": 1,
  "themes": [
    {
      "id": "academic",
      "description": "Restrained theme for papers: thin lines, black text, gray emphasis",
      "fonts": { "id": "sumi/biz-ud-gothic", "description": "…", "styles": ["regular", "bold", "mono"] },
      "fontSizePt": { "min": 7, "max": 8, "base": { "node": 8, "group": 8, "edge": 7 } },
      "missingVariants": {},
      "compatibleProfiles": ["paper-single", "paper-double"]
    }
  ],
  "profiles": [
    {
      "id": "presentation-16x9",
      "description": "16:9 presentation slide (13.33in × 7.5in); used as an upper bound only",
      "page": {
        "maxWidth": { "written": "338.7mm", "pt": 960.09, "mm": 338.7 },
        "maxHeight": { "written": "190.5mm", "pt": 540, "mm": 190.5 }
      },
      "margin": { "written": "4mm", "pt": 11.34, "mm": 4, "d2Units": 23 },
      "typography": { "minFontSize": { "written": "14pt", "pt": 14, "mm": 4.94 } },
      "layout": {
        "layerGap": { "written": "16mm", "pt": 45.35, "mm": 16, "d2Units": 91 },
        "containerPadding": { "written": "8mm", "pt": 22.68, "mm": 8, "d2Units": 45 }
      }
    }
  ]
}
```

`sumi render --json`（と `sumi lint --geometry --json` のファイルごとの結果）は、出力サイズと Profile の上限を `size` に入れます（描画できなかったときは `null`）。`fits` は幅と高さが上限以内かどうかで、文字サイズは診断で報告します。`render --json` の `format` は出力形式（`svg` / `pdf` / `pptx`）です。

```json
{
  "version": 1,
  "file": "figure.sumi.yaml",
  "diagnostics": [],
  "summary": { "errors": 0, "warnings": 0, "infos": 0 },
  "output": "figure.svg",
  "d2": null,
  "size": {
    "widthPt": 138.5,
    "heightPt": 439,
    "widthMm": 48.86,
    "heightMm": 154.87,
    "profile": { "id": "paper-single", "maxWidthMm": 88, "maxHeightMm": 220, "minFontSizePt": 7 },
    "fits": true
  },
  "format": "svg"
}
```

### PDF 出力

`sumi render figure.sumi.yaml -o figure.pdf`（または `--format pdf`）は、SVG と同じ図をベクター PDF にします（[設計 §6.12](docs/design/phase1.md#612-59-の-pdf-出力)）。

- ページは SVG の `width` × `height`（pt）と同じ大きさの 1 ページです。論文の `\includegraphics` などで縮尺を変えずに使えます。
- 文字は同梱フォント（BIZ UDPGothic / BIZ UDGothic）のサブセットを埋め込んだ文字として残り、検索・コピーできます。閲覧側・変換側のフォントには依存しません。
- 図形・線はベクターのままで、ラスタ画像は含みません。同じ入力・同じ版の Sumi なら、OS によらずバイト単位で同じ PDF になります。
- 変換は krilla + krilla-svg（WebAssembly にして `sumi` に同梱）が行い、Node.js・ブラウザ・追加のバイナリは不要です。
- v0.3.0 では PDF エンジンを移行したため、v0.2.0 の PDF とは内部表現・Producer・バイト列が変わります。寸法・検索可能な日本語・ベクター・provenance は維持します（[移行の検証](docs/verification/74-krilla.md)）。
- PDF/A・PDF/X などの規格には適合しません（エッジのラベルの下の線を消すために透明（soft mask）を使います）。PDF のバージョンは 1.7 です。

pdfLaTeX / LuaLaTeX では `graphicx` の `\includegraphics{figure.pdf}` で取り込めます。図の日本語フォントも PDF に埋め込まれているため、図のための CJK パッケージやシステムフォントは不要です。[検証環境と再現手順](docs/verification/63-pdf-latex.md)を参照してください。取り込み時に PDF のバージョンの警告が出る環境では、文書の先頭で PDF 1.7 を指定します（pdfLaTeX: `\pdfminorversion=7`、LuaLaTeX: `\pdfvariable minorversion=7`）。

### PPTX（v0.3.0〜）

```sh
sumi render figure.sumi.yaml -o figure.pptx
sumi render figure.sumi.yaml --format pptx
```

図全体を **1 枚の画像**として 1 スライドへ格納します。文字をアウトライン化した SVG と、resvg で生成した PNG フォールバックを両方含むため、閲覧側のフォントに依存しません。**図形・文字・矢印は個別に編集できません**（編集可能な PPTX は別機能の #62）。PDF への再書き出しがベクターになることも保証しません。

画像は元 SVG の物理サイズを保ちます。PPTX の仕様に合わせ、スライドは各辺 1〜56 inch。1 inch 未満の図は余白を足して中央に配置し、56 inch 超は `pptx/unsupported-size` になります。PNG は原則 192dpi、最大 8192px/辺・約 1600 万画素に収まるよう大きな図では解像度を下げます。`--json` の `size` は従来どおり図自体の寸法です。詳細・アプリ別の確認状況は [PPTX 検証記録](docs/verification/61-pptx.md) を参照してください。

生成は macOS／Linux（x64／arm64）をサポートし、表示は PowerPoint for Mac 16.114.1 で確認しています。Windows PowerPoint・Keynote・Google Slides は今回の保証対象外です。

#### 編集可能 PPTX（実験的）

```sh
sumi render figure.sumi.yaml -o editable.pptx --pptx-mode editable
sumi render figure.sumi.yaml -o glued.pptx --pptx-mode editable --pptx-connectors glued
```

`--pptx-mode editable` は図形と文字を DrawingML の個別オブジェクトにします。**保証するのは個別の選択・編集のみ**で、見た目の完全一致、編集後のレイアウト維持、YAMLへの逆変換は保証しません。文字はフォント名を参照し、フォント自体は埋め込まないため、閲覧側に BIZ UDPGothic / BIZ UDGothic がなければ置換されます。

既定の `freeform` は元の経路を自由形状として保持しますが、ノードを動かしてもエッジは追従しません。`--pptx-connectors glued` は上下左右の接着点へ接続する標準の直線コネクタに置き換えます。元の折れ線・曲線は失われ、エッジラベルは追従しません。コンテナは独立した枠で、子オブジェクトをまとめて移動する PowerPoint グループではありません。詳細・対応しない形状とMac実確認は [編集可能PPTXの記録](docs/verification/62-editable-pptx.md) を参照してください。画像方式は引き続き既定です。

### テーマとプロファイル

見た目はテーマ（`figure.theme`）、出力先の制約（ページの大きさ・最小文字サイズ・間隔）はプロファイル（`figure.profile`）で選びます。両者は独立で、プロファイルが図や文字を拡大・縮小することはありません。

| テーマ | 内容 |
| --- | --- |
| `minimal`（既定） | モノクロ、はっきりした線。文字 8pt（エッジ 7pt） |
| `academic` | 論文向け。細い線・黒い文字・灰色の強調。文字 8pt（エッジ 7pt） |
| `slides` | スライド向け。文字 16pt（エッジ 14pt、コンテナ 18pt）、線 2pt。`presentation-16x9` と組み合わせる |
| `color` | 色を使う汎用テーマ。`minimal` と同じ線・文字で、tone は淡い色の塗り、強調は青。文字 8pt（エッジ 7pt） |

node と group の `tone`（`gray` / `red` / `orange` / `yellow` / `green` / `blue` / `purple` / `pink`）で色の分類を指定できます。色の値はテーマが決めます。`color` では色ごとに別の淡い塗りになり、`minimal` / `academic` / `slides` ではグレースケールで印刷できるよう 3 段階の灰色になります（[設計 §6.20](docs/design/phase1.md#620-92-の-operatorjunctiontone-と-color-テーマ)、[ギャラリー](docs/gallery/README.md#tones)）。

| プロファイル | 最大幅 | 最大高さ | 最小文字サイズ |
| --- | --- | --- | --- |
| `paper-single`（既定） | 88mm | 220mm | 7pt |
| `paper-double` | 180mm | 220mm | 7pt |
| `presentation-16x9` | 338.7mm | 190.5mm | 14pt |

スライドの図は `theme: slides` と `profile: presentation-16x9` で作ります。`presentation-16x9` は 14pt 以上の文字を求めるため、`minimal` / `academic` / `color` では `profile/font-too-small` になります（意図どおり）。描き比べは[ギャラリー](docs/gallery/README.md#themes-and-profiles)にあります。

### アイコンと画像

node の `icon: tabler/<name>` で、同梱の [Tabler Icons](https://github.com/tabler/tabler-icons)（MIT。outline から Brand カテゴリを除いた 4,808 個）のアイコンをラベルの代わりに描けます。色は node の文字色に従います。名前は `sumi catalog --icons <語>` で探せます。自分の画像は `component: image` と `props.src`（YAML ファイルからの相対パス。PNG / JPEG / SVG）・`width` か `height` で埋め込みます。Sumi は画像を加工せずそのまま埋め込み、SVG は許可した図形だけを取り込みます（スクリプトや外部への参照は位置付きのエラー）。編集可能 PPTX では使えません（[設計 §6.25](docs/design/phase1.md#625-94-のユーザー画像と同梱アイコン)）。

```yaml
nodes:
  - { id: pe, component: circle, icon: tabler/wave-sine }
  - { id: photo, component: image, props: { src: img/photo.png, height: 30pt } }
```

## Claude Code から使う

Claude Code 用の Skill を [`skills/sumi/`](skills/sumi/SKILL.md) で配布しています。[skills CLI](https://github.com/vercel-labs/skills) で、使いたいプロジェクトに導入します。

```sh
npx skills add nishide-dev/sumi-diagram --skill sumi           # 対話的に導入先のエージェントを選ぶ
npx skills add nishide-dev/sumi-diagram --skill sumi -a claude-code -y   # Claude Code のプロジェクト（.claude/skills/sumi）に導入
```

Skill は CLI を含みません。先に[リリース版](#インストールリリース版)を導入して `sumi` を `PATH` に通し、`sumi doctor` で確認してください（D2 とフォントは tarball に同梱）。Claude Code で「この処理の流れを Sumi で図にして（論文の 1 段組）」のように頼むと、Skill が次の手順で図を作ります。

1. 図の内容と出力先（`paper-single` / `paper-double` / `presentation-16x9`）を確認する
2. `sumi doctor` で環境を確認し、`sumi catalog --json` で使える部品・variant・props と Theme・Profile を調べる（存在しない部品やスタイルは使わない）
3. `*.sumi.yaml` を書き、`sumi fmt` → `sumi lint --json` → 診断の `code` / `path` / `hint` に従って修正する
4. `sumi render` で SVG を出力し、幾何 lint（`geometry/*`）の診断を確認したうえで、PNG に変換して目視で確認する
5. 作成したファイル・サイズ・残った warning・仮定を報告する（修正が進まない場合や、内容・Profile の判断が必要な場合は推測せずに確認する）

Skill は CLI をラッパー（`skills/sumi/scripts/sumi`）経由で実行します。ラッパーは次の順に CLI を探し、どれも無ければ導入手順と `sumi doctor` を案内して終了コード 127 で終わります。

1. 環境変数 `SUMI_BIN`（実行ファイルのパス）
2. ラッパー（シンボリックリンクを解決した実体）を含む Sumi のソースチェックアウト。このリポジトリで開発するときは常にソースが使われます
3. `PATH` 上の `sumi`（リリース版の単一バイナリ。ラッパー自身とその複製は除外）
4. 作業ディレクトリの上にある Sumi のソースチェックアウト

ソースチェックアウトでは `bun <repo>/src/cli/index.ts` を実行し、`SUMI_D2_PATH` が未設定ならリポジトリの `.sumi/bin/d2` を使います。

このリポジトリで開発するときは、`.claude/skills/sumi` が `../../skills/sumi` へのシンボリックリンクになっているので、リポジトリで Claude Code を開けばそのまま Skill が読み込まれます（Windows で `core.symlinks` が無効なチェックアウトでは使えません）。ラッパーはリリース版が `PATH` にあってもこのリポジトリのソースから実行するため、事前に `bun install` と `bun run d2:install` を済ませておいてください。手順の詳細と、診断・レイアウトの参照資料は `skills/sumi/references/` にあります。Skill の記述（部品名・診断コード・作例の YAML）とラッパーの探索順は `src/cli/skill.test.ts` で実装と照合しています。

## 開発コマンド

| コマンド | 内容 |
| --- | --- |
| `bun run check` | Biome による format / lint チェック |
| `bun run check:fix` | Biome による自動修正 |
| `bun run typecheck` | `tsc --noEmit` による型チェック |
| `bun test` | テスト実行 |
| `bun run schema:gen` / `schema:check` | JSON Schema の再生成 / 差分検査 |
| `bun run d2:install` | 固定バージョンの D2 CLI を `.sumi/bin/d2` に導入 |
| `bun run pdf:wasm` | PDF/PPTX 共通エンジン（`native/pdf-wasm` → `assets/wasm/sumi-pdf.wasm`）を再ビルドする（rustup が必要。[手順](CONTRIBUTING.md#pdf-エンジンwasmの再ビルド)） |
| `bun run pdf:latex` | pdfLaTeX / LuaLaTeX への実際の取り込みを検証する（TeX Live・Poppler・D2 が必要。[検証記録](docs/verification/63-pdf-latex.md)） |
| `bun run src/cli/index.ts --help` | CLI をソースから実行 |
| `bun run example:render <file> [out.svg]` | `sumi render` の別名（`examples/` の再生成用） |
| `bun run release:build --target <target>` | リリース用 tarball を `dist/release/` に作る（[リリース手順](CONTRIBUTING.md#リリース)） |
| `bun run release:smoke <tarball>` | tarball を一時ディレクトリに展開し、Bun・Node.js のない `PATH` で `--version`・`doctor`・`render`（SVG と PDF）を確認する |
| `bun run gallery` / `gallery:check` | `docs/gallery/` と `examples/*/*.{svg,pdf}` の再生成 / 差分検査（D2 が必要） |

## ディレクトリ構成

| パス | 役割 |
| --- | --- |
| `src/cli` | CLI エントリポイントとコマンド定義 |
| `src/core` | スキーマ・IR・共通ユーティリティ |
| `src/backends` | レイアウトバックエンド（D2 / ELK） |
| `src/render` | SVG 出力（`src/render/pdf`: PDF への変換） |
| `native/pdf-wasm` | PDF/PPTX 共通の Rust エンジン（krilla・krilla-svg・resvg を WASM に。生成物は `assets/wasm/`） |
| `src/lint` | 構造・視覚 Lint |
| `schema` | 生成された JSON Schema（手で編集しない） |
| `tests/fixtures` | テスト用の入力ファイル |
| `examples` | 図の例（`*.sumi.yaml` と生成した SVG・PDF） |
| `docs/gallery` | 生成されたコンポーネントギャラリー（手で編集しない） |
| `skills/sumi` | Claude Code 用の Skill（`npx skills add` で配布。`.claude/skills/sumi` はここへのシンボリックリンク） |

## ライセンス

Sumi は [MIT License](LICENSE) で提供する。同梱・配布するサードパーティのファイルは、それぞれのライセンスに従う（BIZ UD ゴシック: SIL Open Font License 1.1 — `assets/fonts/biz-ud-gothic/OFL.txt`。リリース版の tarball に同梱する D2: Mozilla Public License 2.0 — tarball の `licenses/d2/`。出典と版は tarball の `NOTICE`）。
