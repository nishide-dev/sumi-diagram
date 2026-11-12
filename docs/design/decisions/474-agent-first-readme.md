# #474 エージェント向けの README と仕組みの図

## 背景

README は人が CLI を使う前提の書き方で、作例の画像を並べていた。実際の主な使い方は、コーディングエージェントが Skill に従って `sumi catalog` で部品を調べ、YAML を書き、`fmt → lint → render` を回して診断を見て直す流れである。`npx skills add` は任意のハーネスに対応しているのに、`-a claude-code` 付きで Claude Code 専用に見えていた。作例はサイト（#469）で見られる。

## 決定

- README の冒頭で「エージェントが描き、検査し、直せる図」と位置づけ、はじめ方を 3 段（CLI の導入、Skill の追加、図の依頼）にする。Skill の導入コマンドはハーネスを指定しない（指定する場合の書き方は利用ガイドに置く）。エージェントと相性がよい理由（調べられる、描画後に検査する、機械可読、決定的、出力先に合わせる）を表で示す。インストールの細かいオプションは `<details>` にたたむ。
- 作例の画像の代わりに、Sumi 自身で描いた仕組みの図を 1 枚載せる。ソースは `docs/assets/architecture.sumi.yaml`、`bun run gallery` が `sumi` と `sumi-dark`（#473）で `architecture.light.svg` / `architecture.dark.svg` を描き、`gallery:check` が古くなっていないことを検査する。README では `<picture>` と `prefers-color-scheme` で GitHub の表示モードに合わせる。サイトの Home（#475）は同じ画像をサイトのライト / ダークに合わせて出す。
- 図の内容: エージェント（任意のハーネス）と Sumi Skill、`sumi catalog` による探索、`*.sumi.yaml` → Compile → Layout → Render → SVG / PDF / PPTX、描画結果を検査する幾何 lint と、エージェントに戻る診断のループ。
- 日本語版 `docs/README-ja.md` も同じ構成にする。利用ガイドの Skill の節もハーネスを限定しない書き方にする。

## 互換性

文書と生成物の追加のみ。CLI と既存の図の出力は変わらない。

## 図の作り直し（#493）

最初の図は箱と矢印だけで簡素だったため、Sumi の表現力が伝わる図に作り直した。

- Sumi CLI の範囲を一つの枠で示し、その中に `sumi catalog --json` の出力、`figure.sumi.yaml` の抜粋、`sumi lint --geometry --json` の診断を、`html` の小さなコードのカードとして置く。出力は箱と線だけの小さなサムネイル（これも `html`）で示す。
- 色はテーマ（`sumi` / `sumi-dark`）の色だけを使い、tone は使わない。カードの見出しは `--sumi-accent`（ライトは紺、ダークは砂色）。焦点のエージェントは `emphasis`。
- 読みやすさの下限は印刷用の 7pt ではなく画面用に `figure.target.minFontSize: 6pt` とした（GitHub の表示幅で 6pt は読める）。
- 背景は透明（#479）。ライトとダークの両方で目視して確かめた。
