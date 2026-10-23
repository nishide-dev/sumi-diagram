# #56 サイズ決定の1パス化の調査

調査の判断と測定結果は [調査メモ](../../docs/research/56-single-pass-sizing.md)、Issue は [#56](https://github.com/nishide-dev/sumi-diagram/issues/56)。製品コードはこのディレクトリを参照しない。

## 再現

リポジトリで Bun と固定 D2 v0.9.0 を用意する。

```sh
bun install --frozen-lockfile
bun run d2:install
bun research/56-single-pass/run.ts
```

100ケース × 4方式（製品の2パス＋研究用の1パス候補3つ）を描き、`out/` に YAML・SVG と `report.json` を残す。最初のケースは各方式で再描画してバイト決定性も確認する。さらに、1ノードの最初のケースを各方式5回、実行順を回しながら測って中央値を記録する。全体の実行には数分かかる。

各方式で backend 呼び出し数を検証し、候補は既存の finalize → inspect → compose → inspect と幾何 lint を通す。フォントの sha256 と D2 バージョンも検査する。出力の違い・診断は研究結果であり、製品の出力は変えない。

測定スナップショットを意図して更新する場合のみ次を使う。

```sh
bun research/56-single-pass/run.ts --record
```

`results/report.json` は今回の測定記録で、CI の golden ではない。時間は同じ条件でも変わる。通常は `out/report.json` と比較し、判断や表を変更する場合は調査メモと Issue も更新する。`baseCommit` は測定対象とした製品実装の基点を指す。

## ファイル

- `estimate.ts`: hinted ink bounds の完全な移植ではない D2近似、実フォントでの小型化、次数を先に考慮した小型化の3候補。
- `run.ts`: コーパス生成・測定・集計。84件の孤立ノードと16件のコンテナ内の複数入力エッジを比較する。
- `results/report.json`: macOS arm64 で測定した100件の寸法・安全領域・キャンバス・診断・SVG SHA-256・時間と集計。
- `out/`: 再現時の中間成果物（gitignore）。`.d2` は生成・手編集しない。
