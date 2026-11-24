# #663 枠の上の見出しが `align: stretch` の row を高くしない

## 背景

#641（PR #662）の調査で見つかった不具合。`align: stretch` の row（または stack）に、見出しを枠の上に置く group（`labelAt: above-*`、#517）があると、枠と図全体が見出しの高さの分だけ高くなっていた。#639 の run 7 で根の row を `align: stretch` にすると 44.1mm → 49.2mm、run 10 で `align: start` → `stretch` にすると 190.2mm → 200.9mm（run 10 のレビューの「stretch で図が 10mm 伸びた」）。

## 原因

`#itemSize` は枠の上の見出しを、バッジと同じく item の北側のはみ出し（`#badgeOverhangs`）として item の高さに足す。`#boxSize` は交差軸の大きさを、各 item を「本体（枠）の中心で中央寄せする」前提で `2 × max(中心, 長さ − 中心)` と見積もる（#545）。枠の上に見出しがあると中心は `見出し + 枠/2` なので、見積もりは `枠 + 2 × 見出し` になり、見出しを 2 回数える。

`align: center` ではこの見積もりのとおりに中央寄せされるので正しい。しかし `align: stretch` で伸ばされる item は中央寄せされず（`#placeLine` のオフセットは 0）、row の高さ全部を受け取る。そのため余分な見出し 1 つ分がそのまま枠の高さに加わり、図も伸びた。

## 決定

`#boxSize` の交差軸の見積もりで、`box.align === "stretch"` かつその item が伸ばされる（`#crossStretched`）ときは、中央寄せの見積もりを使わず item の長さ（見出しを含む）をそのまま使う。伸ばされる item の本体の位置は、配置のときと同じく item の端から決まる。

- 伸ばされない item（`width`/`height` を書いたノード、アウトラインの部品など）は今までどおり中央寄せされるので、見積もりも変えない。
- #641 の `row.panels` も同じ考え方（パネルは中央寄せしないので長さそのまま）。PR #662 の後に main を取り込み、同じ箇所で「`panels: true` の row のパネル」と「`align: stretch` で伸ばされる item」の 2 つの条件を並べた。

## 範囲外

- `align` を書かず、同じ軸の親から `stretch` を継承した box（row の中の row など）。`#boxSize` は box ごとにキャッシュし、継承した `align` を知らない。この場合は見積もりが大きいまま（今までと同じ）。まれなので今回は扱わない。

## 互換性

- `bun run gallery`（494 ファイル）と `bun run skill:previews` で SVG は変わらなかった（Skill の PNG のドリフトのみで、破棄した）。再現図・ゴールデンも変わらない。
- 変わるのは、`align: stretch` の row / stack に枠の上の見出しを持つ group があり、その group が交差軸で最も大きい図。図が見出し 1 つ分低くなり、伸ばされた枠も同じだけ短くなる。

## 確かめたこと

- テスト（`predictable-align.test.ts`）: 最も高い group が枠の上に見出しを持つ row で、`stretch` の枠の高さと図の高さが `start` と同じになる。修正前は 152 に対し 183 unit で失敗する。
- #639 の run 7・10 の YAML（写し）: 根の row を `stretch` にした版が 49.2 → 44.1mm、200.9 → 190.2mm（どちらも `stretch` なしと同じ高さ）。元の YAML の出力は変わらない。
