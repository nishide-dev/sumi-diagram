# #269 split bowtie の中央ラベルと互換性

設計判断は [§6.74](../design/phase1.md#674-269-の-split-bowtie-の中央ラベルへの復帰)。
ユーザー決定（2026-11-01）に従い、page 上で読める文字は左右の台形と gap 全体の中央を使う。
PR #273 のレビュー対応として、解決済み文字色・opacity の白地コントラストが4.5:1未満なら
#245 の左台形内配置・寸法を使う。`props.labelAt` は追加しない。

## 全 YAML の変更前後の比較

同じ worktree・Bun 1.3.14・固定版 D2・同梱フォントで、変更前のコードを
読み込んだ比較プロセスを起動してから実装を編集した。
`research/126-grid/compat.ts before` / `after` により、追跡済みの全151 YAMLを
自テーマ＋組み込み5 Themeで描画した（906組）。不正 fixture や素材・経路制約で
描画できない入力も診断コードを保存した。

| 形式 | 比較できた出力数 | バイト変更数 |
| --- | ---: | ---: |
| SVG | 633 | 10 |
| PDF | 633 | 10 |
| picture PPTX | 633 | 10 |
| editable PPTX / freeform | 428 | 0 |
| editable PPTX / glued | 416 | 0 |
| auto D2 | 234 | 0 |

**互換性例外かつ実際に出力が変わった YAML の全一覧**:

- `research/233-lora/c-h3world.sumi.yaml`
- `research/248-fill/c-h3world.sumi.yaml`

どちらも `bowtie.props.gap: 8` を使う図で、変わったのは own / minimal /
academic / color / paper の各 SVG・PDF・picture PPTX。絵文字 badge と画像を
使うため editable PPTX は従来どおり非対応。残り149 YAMLは診断を含め全件一致。
273組の描画不能入力のうち、#248 の slides だけ `layout/no-route` の件数が
16→17に変わった（同図の #233 slides は15件のまま）。slides は前後とも出力なし。

保存した全結果の JSON manifest の SHA-256:

- before: `1f40cad05da869bd4af7b81fc03ab0360869df0045439c0c72859e7a8d6ef7a9`
- after: `ee73db342bd55588cb18a3b1909d5ad71031038460b940cdf6a9619e7ee0731d`

汎用比較スクリプトは例外も差分として終了値1を返すため、追加検査で上記2図以外の
全entry（hash・非対応診断を含む）の JSON 一致も確認した。

## 生成と目視

```sh
bun src/cli/index.ts render research/233-lora/c-h3world.sumi.yaml
bun research/233-lora/preview.ts
bun src/cli/index.ts render research/248-fill/c-h3world.sumi.yaml
bun research/248-fill/preview.ts
bun run gallery
SUMI_UPDATE_GOLDEN=1 CI=1 bun run test src/render/pdf src/render/pptx src/render/assets.integration.test.ts
```

両図は180 ×125.71mm、0 errors / 0 warnings / 6 infos（縮小添字1件、短い
矢じりの直線5件）。#233の PNG は100,542 bytes、#248は101,820 bytes。
両PNGを実際に開き、2個の LoRA が線のない pastel 台形と gap をまたいで中央に
置かれること、左右のバッジ・辺端・周囲の文字を確認した。#248のPNGは既存の
コミット済みpreviewとバイト一致（今回の再生成でも同じ中央配置）。

全5 Theme ×全7 variant の bowtie gallery も rasterize して開いた。
`filled` は gap 8 に文字を重ねる例、stroke 付きは gap 64 に短い `S` を
収める例。`solid` の白文字は左の塗装された台形の中に1個だけ置き、
padding込みの文字箱が収まる幅を確保する。全5 Theme × auto / structured で、
短い `S`・英語と日本語の複数行ラベルが左body内に収まること、他6 variantが中央にあることを検査する。
輪郭交差の独立oracleは全7 variant ×全5 Theme ×両engineで、意図的に中央へ置いた文字と
実境界の交差を作り、`filled` だけ0件・他6 variantは1件と固定期待値で検査する。
解決済み色の境界値（4.48:1 / 4.54:1）、短縮hex、opacityもvariant名と独立に検査する。
golden は上記の指定経路だけで更新した。

## 最終検査

- `bun run check` / `bun run typecheck`
- `CI=1 bun test`: 3478 pass / 13 skip / 0 fail（PR #273レビュー対応後）
- `bun run gallery:check`: 203ファイル一致
- `bun run schema:check`: schema変更なし
- 指定のPDF / PPTX / assets golden更新テスト: 594 pass / 0 fail
- 全5 ThemeのgalleryをPNGとして開き、split `solid` の白い `S` が暗い左台形内に見えることを確認。他6 variantは中央配置を維持。
- research両図をrender→previewの順に再生成し、SVG / PNGともレビュー対応前とバイト一致。

emojiのデータ・importerには変更なし。
