# #217: 矢じりの直前の段差と互換性の検証

## 比較条件

- 費用修正前（`ca401d3`）と費用修正後を、同じ Bun・同梱フォント・固定版 D2 で比較。
- リポジトリの `**/*.sumi.yaml`（node_modules を除く）139 図を、元の Theme（own）と minimal / academic / slides / color / paper で描画。834 通りのうち 568 通り成功。失敗は invalid fixture、古い構文、Theme と Profile の不適合などで、成功・失敗の組み合わせは変化しなかった。
- SVG の sha256 と論理経路を比較し、**50 出力**が変化。以下が全変更一覧。own と明示的な Theme が同じ場合も別の描画として数える。
- 各変更と全 lint 所見を PDF → `pdftoppm -png` で PNG 化し、前後の切り出しと全体像を確認。作業用の JSON・SVG・PDF・PNG は `.sumi/review/` に保存（生成物はコミット対象外）。
- 14 unit の最小 fixture 追加後の最終検査は 140 図・840 通り・成功 574 通り。追加 fixture の 6 通りは両 lint が 0 件、既存 834 通りは前回の修正後と出力・診断がすべて一致した。

## 変更された出力の全一覧

| YAML | 変化した Theme | PNG と経路で確認した改善 |
| --- | --- | --- |
| `research/109-dogfood-v0.4/figures/serving-architecture.sumi.yaml` | academic, paper | workers からの段付きの接近を 2 曲がりに単純化。academic の隣の辺も同じ幹線へ移動し、ネット全体の曲がりを減らす。最終直線は 11 unit ≥ 矢じり 8 unit。 |
| `research/124-stage-b/figures/serving-architecture.sumi.yaml` | paper | 2 辺の共有幹線を y=349.370 → 352.032 に移動し、Training workers への短い枝を単純化。最終直線は 13.338 unit ≥ 8 unit、ノードと矢じりは不変。 |
| `research/151-dogfood-v0.5/figures/vit-input.sumi.yaml` | slides | 上向きの接近の S 字（余分な 2 曲がり）を除去。 |
| `research/167-stage-c/figures/c-h3world.sumi.yaml` | own, minimal, academic, color, paper | academic / paper は上段の画像からの接近、own / minimal / color は下段の射影・加算への接近の微小段差を除去。 |
| `research/173-paper-theme/figures/c-h3world.sumi.yaml` | own, minimal, academic, color, paper | 上段の画像からの段差を除去。minimal / color は下段の射影・加算への段差も除去。 |
| `research/176-zoom-edge/figures/c-h3world.sumi.yaml` | own, minimal, academic, color, paper | #167 と同じ接近の微小段差を除去。zoom の線と接続先は不変。 |
| `research/177-outlined-tones/figures/c-h3world.sumi.yaml` | own, minimal, academic, color, paper | 上段の段差と、minimal / color の下段の上向き接近の S 字を除去。 |
| `research/180-matrix/figures/c-h3world.sumi.yaml` | own, minimal, academic, color, paper | 上段の段差と、minimal / color の下段の射影・加算への S 字を除去。 |
| `research/181-tokens/figures/c-h3world.sumi.yaml` | own, minimal, academic, color, paper | #167 と同じ接近の微小段差を除去。 |
| `research/181-tokens/figures/vit-input.sumi.yaml` | slides | #151 と同じ上向きの S 字を除去。 |
| `research/182-compact/figures/c-h3world.sumi.yaml` | own, minimal, academic, color, paper | 上段の段差を除去。own / academic / paper は下段の射影への迂回も除去し、8 unit 以上の接近を維持。 |
| `research/185-acceptance/figures/c-h3world.sumi.yaml` | own, minimal, academic, color, paper | 下段の青い 2 辺（`qkv → c-add-in` と `out-proj → c-add-out`）が各 3 曲がりから 1 曲がりへ。先端の直線は 14.008 unit、own の矢じりは 8 unit。 |
| `tests/fixtures/figures/fit/c-h3world.sumi.yaml` | own, minimal, academic, color, paper | #167 と同じ接近の微小段差を除去。縮小率・ページ寸法は不変。 |

この表以外の SVG の変更はない。例・gallery の own Theme と全 component gallery は変化せず、`bun run gallery` は 155 ファイル中変更 0、新規 lint 診断 0。

## lint 所見と誤検出の確認

`geometry/edge-jog` は 1pt 未満の painted の直角間の線分を検出する。印刷時の長さで判定し、1 件に複数の短い段差がある場合は最短の長さを報告する。

- 修正前 **171 件 / 57 通り** → 修正後 **55 件 / 34 通り**。
- 修正前の受け入れ図 own の `edges[31]`（問題の辺）も検出（印刷時 0.38pt）。`edges[26]` も検出し、修正後の own は両方とも消えた。
- 55 件は既存の **実際に描かれた短い段差**。PNG と painted の座標を確認し、誤検出 0。共有幹線・交差・固定された口の列のずれを含むため、辺の一部を単に削除・平行移動する修正はしない。曲線 chord、矢じりで隠れた線、端の stub を誤検出していない。
- `geometry/arrowhead-on-bend` は全成功出力で 0 件。

残った所見の全一覧（辺は YAML の 0-based index）:

| YAML | Theme と辺 | 件数 |
| --- | --- | --- |
| `examples/transformer/transformer.sumi.yaml` | minimal, color: 19 | 2 |
| `research/135-skill-dogfood/figures/serving-architecture.sumi.yaml` | paper: 1 | 1 |
| `research/151-dogfood-v0.5/figures/serving-architecture.sumi.yaml` | own, minimal, color: 13; academic: 11, 13; slides: 17 | 6 |
| `research/167-stage-c/figures/c-h3world.sumi.yaml` | own, minimal, color: 17, 20 | 6 |
| `research/173-paper-theme/figures/c-h3world.sumi.yaml` | minimal, color: 20 | 2 |
| `research/176-zoom-edge/figures/c-h3world.sumi.yaml` | own, minimal, color: 17, 20 | 6 |
| `research/177-outlined-tones/figures/c-h3world.sumi.yaml` | minimal, color: 20 | 2 |
| `research/180-matrix/figures/c-h3world.sumi.yaml` | minimal, color: 20 | 2 |
| `research/181-tokens/figures/c-h3world.sumi.yaml` | own, minimal, color: 17, 20 | 6 |
| `research/182-compact/figures/c-h3world.sumi.yaml` | minimal, color: 24, 26, 29, 31 | 8 |
| `research/185-acceptance/figures/c-h3world.sumi.yaml` | minimal, color: 23, 28 | 4 |
| `tests/fixtures/figures/fit/c-h3world.sumi.yaml` | own, minimal, color: 17, 20 | 6 |
| `tests/fixtures/figures/layout/group-caption.sumi.yaml` | own, minimal, academic, color: 2 | 4 |

例えば caption fixture は `(330.709, 250.354) → (330.854, 250.354)` の **0.145 unit** の水平な段差が縦の線の間にある。Transformer の minimal / color も **1 unit** の水平な段差がある。これらは描画上の実在する所見で、lint から除外する図ごとの例外は追加しない。fit と caption の統合テストでは、新しく検出される辺を ID 付きで期待する。

## golden とチェック

更新は以下の正規コマンドだけを使用し、**golden の変更は 0**。

```sh
bun run gallery
SUMI_UPDATE_GOLDEN=1 CI=1 bun test src/render/pdf src/render/pptx src/render/assets.integration.test.ts
```

`bun run check`、`bun run typecheck`、`CI=1 bun test`（2,806 pass / 13 skip / 0 fail）、`bun run gallery:check`、`bun run schema:check` はすべて成功。skip は既存の研究用 prototype 等。

## PR #223 レビュー 1 の追補

- **patch release の互換性**: `geometry/edge-jog` の既定を **info** に変更。固定された口や共有幹線で残る既存の 55 件を warning budget に数えず、`--max-warnings 0` の既存ワークフローを維持する。所見の検出・閾値は同じ。rule 設定 `{"rules":{"geometry/edge-jog":"warning"}}` で warning に昇格でき、`off` も使える。caption fixture を実際に描画して、既定では `maxWarnings: 0` で終了 0、昇格すると終了 1 になることをテストした。
- **room は好みであって禁止ではない**: `40 < 60 < 80` は孤立した再現の費用を説明する。共有ネットの格子辺では曲がりの費用を省く場合があり、room への進入・room 内の曲がりの費用も複数回累積しうるため、S 字を常に排除する保証ではない。`router.ts` と §6.57 を修正し、§6.22 に旧 100・格子点ごとの課金・junction stub の説明を置き換える注記を追加。writer の `keepStart` / `keepEnd` の参照を **§6.26** に訂正した。
- **共有ネットの回帰**: `router.test.ts` の新しい合成図は `a → c` が `a → b` の幹線を通り、**別の端 b の room（x > 84）に進入して x=91 で分岐**する。離れた非接続 node を移動して room 内の格子を分割しても、2 辺の経路は一致する。両方の格子で A* / Dijkstra の費用を照合。進入条件から `!inOthersArrowRoom(p)` を一時的に外して旧来の格子点ごとの課金に戻すと、このテストは余分な段差を検出して失敗することも確認（変更は戻した）。
- **独立 checker**: `checkRoutes().shortArrowSegments` の junction 除外を削除。全 Theme の正常な接近を検査し、始点・終点の junction の直線を意図的に 1 unit に短縮した場合は、それぞれ `source` / `target` の不足を報告する回帰を追加。
- **直前コミットとの出力一致**: `41152a4` の既存監査 `.sumi/review/jog-final.json` と、再描画した `.sumi/review/review-1-final.json` を比較。**140 図・840 通り・成功 574 通り**で成功・失敗、SVG sha256、全論理経路、error code がすべて一致し、**出力変更 0・経路変更 0**。2 種の新 lint の所見も、55 件の `edge-jog` の severity が warning → info になる点だけが変化。比較スクリプトは `.sumi/review/compare-review-1.ts`。
- **最終検査**: `bun run check`、`bun run typecheck`、`CI=1 bun test`（**2,810 pass / 13 skip / 0 fail**）、`bun run gallery:check`（**155 ファイル変更 0**）、`bun run schema:check` はすべて成功。生成物・golden の変更はない。
