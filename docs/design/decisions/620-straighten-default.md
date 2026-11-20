# #620 structured 配置で `figure.layout.straighten` を既定にする

## 背景

#618（[設計 #618](618-straighten-by-shifting.md)）で入れた `figure.layout.straighten` は、ノードやグループを箱の余裕の範囲でずらして、向かい合う端がずれたエッジを直線にする。#618 では見た目が変わるため任意の設定（省略は `false`）にとどめ、比較を見て利用者と決めることにしていた。

構造化 70 図に強制的に有効にした比較では、変化は 4 図（屈曲 258 → 250、直線のエッジ 542 → 546、悪化したエッジ 0、警告の増加 0、キャンバスの変化 0）だった。比較画像（train-infer-a / agent-loop-a / request-states-a / arrowhead-on-bend）を見て、利用者が 2026-11-21 に既定にしてよいと判断した。

## 決定

- **structured 配置では `straighten` を省略したら `true` として扱う**。`false` を書くと #618 以前の配置になり、出力はバイト単位で同じ。auto 配置は対象外のまま: 書いた `straighten`（`true` / `false`）は従来どおり `layout/structured-only`、書かなければ診断は出ない。
- Figure IR の `meta.straighten` は「`false` を書いたときだけ `false`」に変えた（省略と `true` は同じ IR になる）。エンジンは `false` でなければずらしを試す。
- JSON Schema には `default: true` を書く（Zod の `.meta`。解析後の値は省略のまま残すので、auto の図で既定値が「書いた」扱いにならない）。
- **枠のないグループ（variant `plain`）の端は辺に沿って寄せない**（`ports.ts` の `straighten()`。ずらしで一線になる場合は従来どおり採る）。既定にする前に、強制有効の比較に入っていなかった図も含めて省略と `false` を比べたところ、`tests/fixtures/figures/density/sparse-small-elements` で (1) の plain グループ → Type-specific embedding（`toAnchor: west`）の始点がグループの描かれない右辺を上端近くまで寄せられ、内容から離れた余白から線が出るようになった。辺が描かれないので、寄せると始点が内容の中ほどから外れる。
- 決まり（「ほかの線を 1 本も悪くしない」「図を大きくしない」）は**緩めない**。6-deepseek-v4 の Router → experts（#618 の結果の例 3）は、直すと experts → ⊕ の屈曲が 1 → 3 になるため直らないままにする（利用者判断）。

## 採らなかった案

- **任意のまま残す**: 悪化が 0 で、利用者が比較を見て既定を選んだ。作者が毎回書く必要のある設定にしておく理由がない。
- **決まりを緩めて例 3 も直す**（屈曲の合計が減れば採る）: ほかのエッジが悪くなる移動を既定で行うことになる。

## 互換性

- `straighten` を書かない structured の図は配置が変わりうる。ただし、ギャラリーと examples（`bun run gallery`: 491 ファイル中 0 ファイル変化）、PDF / PPTX / 画像の goldens、Skill のプレビュー、Pages の例はどれも変わらなかった。ピン留めした論文再現（transformer / dit-block / clip / embedding-gemma / gcn / llama4-moe / tricl / llada）の出力も変わらないので、`straighten: false` を書いた再現はなく、再現ハッシュも変わらない。
- 変わるのは、structured のテスト図のうち次の 5 つ（examples・Skill・`docs/assets`・`tests/fixtures` の `straighten` を書かない structured 図をすべて省略と `false` で描いて比べた）:
  - `tests/fixtures/figures/color-use/train-infer-a`・`agent-loop-a`・`request-states-a`（#618 の比較画像のとおり）
  - `tests/fixtures/figures/fit/c-h3world`（(c) のトークン列が上へ動き、LoRA への枝が一直線）
  - `tests/fixtures/figures/layout/arrowhead-on-bend`（屈曲そのものを試す図なので `straighten: false` を書いた）
- 経路やずれそのものを試すテストは `straighten: false` で従来の配置に固定した: `router.test.ts` の向かい合う端の S 字、`group-title-diagnostics.test.ts` の見出しによるずれ、`cuboid.integration.test.ts` の細い側面の重心。`proximity.integration.test.ts` は配置が変わった分の期待値を更新した（境界に沿う線の指摘が 1 つ消え、並走の長さが 41.0 → 43.5mm）。
- 従来の配置が必要な図は `figure.layout.straighten: false` を書く。
- 配置の時間は、有効にした図で #618 の限界に書いた分だけ増える（ずらしの候補がない図では端の解決だけ）。
