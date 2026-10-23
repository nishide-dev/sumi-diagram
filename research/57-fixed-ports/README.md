# #57 固定ポートの調査

[調査メモ](../../docs/research/57-fixed-ports.md)、[Issue #57](https://github.com/nishide-dev/sumi-diagram/issues/57)。製品コードはこの研究ディレクトリを参照しない。

```sh
bun install --frozen-lockfile
bun run d2:install
bun research/57-fixed-ports/run.ts
```

最初に elkjs 0.12.0 の tarball を npm registry から取得し、固定 sha512 で検査して `.tools/elkjs/` に展開する。root の package.json / bun.lock / node_modules は変更しない。通常のテスト・typecheck・CI で elkjs の導入は不要。

`run.ts` は以下を実行する。

1. 固定 D2 で通常ノード・一般ポート風のキー・SQL列ポートの5プローブを実行し、Sumi v1 が ports / fromPort / toPort を拒否することを記録する。
2. elkjs の通常importでの初期化結果を子プロセスで記録する。
3. 同梱bundleの内容を変更せず、`self` だけを字句的に隠す研究用adapterで16ケースを実行する（4方向 × flat/同一コンテナ内 × FIXED_POS/FREE）。各ケースで同じインスタンス2回・新しいインスタンス1回を比較する。
4. 同じbundleをテキストとして静的に埋め込んだ試作を `bun build --compile --minify` で作る。比較用の最小control実行ファイルも作り、サイズ差を記録する。
5. `.tools/elkjs/` を一時退避し、空のPATH・空の作業ディレクトリから試作バイナリを2回実行する。各回16ケースがソース実行と同じ幾何結果を返すことを検査し、finallyでパッケージを戻す。

生成したD2・SVG・entry JS・試作バイナリとreportは `out/`（gitignore）。ダウンロードしたパッケージもgitignore。setupは研究専用パッケージを再展開し、smokeは一時的に退避するため、このディレクトリのrunを同時実行しない。

測定スナップショットを意図して更新する場合のみ、次を使う。

```sh
bun research/57-fixed-ports/run.ts --record
```

`results/report.json` は macOS arm64 の測定記録で、OS別のバイナリサイズをCI goldenにはしない。最新リリース・上流HEADの調査時点の値は固定した記録であり、run時に自動で「最新」へ更新しない。改めて調べる場合は調査メモとIssueも更新する。

`probe.test.ts` はネットワークとelkjsに依存せず、親座標系の変換・不正値・ずれの検出・内部IDを除く幾何射影を検証する。
