# #167 論文図の段階 C の調査（基準の 3 図の再現と試作）

[調査メモ](../../docs/research/167-stage-c.md)、[Issue #167](https://github.com/nishide-dev/sumi-diagram/issues/167)。関連: #80（ロードマップ）、#86（[論文図の調査](../../docs/research/86-paper-figures.md)）、#124（[段階 B](../../docs/research/124-stage-b.md)）、#151（[v0.5 の dogfooding](../151-dogfood-v0.5/README.md)）。

製品の `src/`・schema・examples・golden・テストは変更しない。ここのコードは製品の `src/` を読むだけ（import）で、製品のコードはこのディレクトリを参照しない。

基準の図（Transformer: arXiv 1706.03762v7 Fig. 1、DiT: arXiv 2212.09748v2 Fig. 3、H3-World: 利用者自身の未公開の図）は、手元で描いた PNG と並べて比べたが、原図そのもの・切り出し・文言はリポジトリに入れていない。

## 固定した基点

| 対象 | 版 |
| --- | --- |
| Sumi | `67a4816`（main、v0.5.2） |
| Bun | 1.3.14 |
| PDF/PNG エンジン | 製品の `assets/wasm/sumi-pdf.wasm`（無変更） |
| フォント | 同梱の BIZ UDPGothic 1.051、STIX Two Math / Text Italic 2.13 |
| 外部ツール（画像の確認用） | Poppler 26.04.0（`pdftoppm`・`pdftotext`・`pdffonts`）、ImageMagick 7.1.2 |

D2 は使わない（3 図とも structured）。環境: macOS 26.2 / arm64。

## 構成

| パス | 内容 |
| --- | --- |
| `figures/a-transformer.sumi.yaml` | 図 A: Transformer を今の構文で、原図にできるだけ近く描いたもの。`color`、`paper-single` |
| `figures/b-dit.sumi.yaml` | 図 B: DiT の 4 パネル全体（拡大線の代用、3・4 番目の薄表示を `variant: muted` で近似）。`color`、`paper-double` |
| `figures/c-h3world.sumi.yaml` | 図 C: H3-World の概要図（#86 の草案から始め、利用者の図に合わせた）。**`gen-c.ts` が生成**（キー・トークン列・行列をノードで書き下すため） |
| `figures/assets/` | この調査のために作った仮のフレーム画像 5 点（ImageMagick の plasma。各 2KB 未満）。原図の画素ではない |
| `gen-c.ts` | 図 C の生成スクリプト。部品がないためにノードを何個書くかを測る目的も兼ねる |
| `render.sh` | 1 回分の手順: `fmt → lint --geometry → render（SVG・PDF）→ pdftoppm → 64 色に減色した previews/*.png` |
| `bisect.ts` | 構造的な図の根の項目を一部だけ残す（不具合の切り分け用） |
| `repro/operator-loop.sumi.yaml` | 不具合 R1 の最小再現（50mm ずらすと ⊕ の周りを線が一周する。49mm・51mm では起きない） |
| `proto/straight.ts` | 試作 P1: 送り元の真上（真横）で入る端（#151 C1）と、端の小さなずれ（R1）の影響。結果は `results/straight.json` |
| `proto/rotate.ts` | 試作 P2: 回転した文字（`labelRotation`）が inspect・PDF・抽出でどうなるか。結果は `results/rotate.json` |
| `proto/compact.ts` | 試作 P3: 文字の大きさ・余白（compact）を変えたときの B・C の大きさと、180mm に縮小した場合の高さ・実効の文字の大きさ。結果は `results/compact.json` |
| `previews/*.png` | 3 図の最終版（200dpi、64 色）、再現・試作・細部の切り出し。各 150KB 未満 |

## 再現

```sh
bun install --frozen-lockfile
bun research/167-stage-c/gen-c.ts                                   # 図 C を生成
sh research/167-stage-c/render.sh research/167-stage-c/figures/a-transformer.sumi.yaml
sh research/167-stage-c/render.sh research/167-stage-c/figures/b-dit.sumi.yaml
sh research/167-stage-c/render.sh research/167-stage-c/figures/c-h3world.sumi.yaml
bun src/cli/index.ts lint --geometry research/167-stage-c/repro/operator-loop.sumi.yaml   # 4 infos（R1）
bun research/167-stage-c/proto/straight.ts --png    # P1（out/straight/ に PDF・PNG）
bun research/167-stage-c/proto/rotate.ts            # P2（render.sh で図 C を描いた後）
bun research/167-stage-c/proto/compact.ts           # P3
```

- `out/`（このディレクトリの `.gitignore`）に SVG・PDF・PNG を書く。
- 試作は製品のモジュールを読み取り専用で使う。`compact.ts` は、テーマとプロファイルの複製をそのプロセスの中だけで組み込みの一覧に足す（製品のファイルは書き換えない）。
- `proto/straight.ts` は `research/124-stage-b/route/load.ts`（配置まで行う読み込み）を再利用する。
