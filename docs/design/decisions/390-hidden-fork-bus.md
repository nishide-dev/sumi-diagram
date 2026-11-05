# #390 高さの違う対象への hidden fork の共通バス

## 背景

hidden junction から箱 3 個と短い label に上向きに分岐すると、左側と右側でバスの高さが異なった。ルーターは文書順に探索し、共有できる既存経路を低コストで再利用する。label の端からの arrow room は箱より高い位置で終わるため、その枝が別の高さで曲がり、後続の箱への枝もそこを共有した。

## 決定

`src/layout/route/router.ts` の探索前に、同じ hidden junction を出る枝の target room をまとめる。対象は複数の枝がすべて通常のノードの同じ上下側に入り、既存の arrow room を持ち、中心が同じ行にあり、端の高さが異なる場合に限定する。中心の比較では座標の丸め誤差だけを許容する（0.002 unit）。異なる行に置いた同じ高さの箱は対象外とする。

対象の端を外向きの方向へ射影し、各枝の `max(toRoom, toLane)` の末端の最大値を必要位置とする。必要位置が junction より遠ければ補正全体を行わず、元の room とグリッド行を保存する。収まる場合だけ junction の位置まで room を延長し、既存の soft penalty でその位置より内側の分岐を避ける。短い対象への矢印が長くなり、すべての対象に arrowhead と角丸の余地が残る。障害物では従来の探索による迂回を許す。

レビューで、soft penalty だけでは狭い gap の互換性を保てないと判明した。room の延長は元の room-end グリッド行も置き換えるため、junction 行で曲がる経路が選ばれ、丸め後の stem が短くなる。paper / 4pt では label の stem が 2pt から 1.875pt、slides / 7pt では 0.75pt になっていた。必要位置が収まらない場合に補正を開始しないことで、元の描画品質を保持する。

スキーマ・描画処理・診断コードは変更しない。junction 自体も動かさないため、#385 の `junctionsOnBus` による配置補正とは役割が独立している。既存の角丸描画をそのまま使用する。

## 採らなかった案

- 探索順の変更: 他の net の共有・交差の選択にも影響する。
- 共通バスを hard constraint にする: 障害物や狭い gap で、従来描画できた枝が描画不能になる。
- SVG の経路を描画後に揃える: 障害物・arrow room・経路診断と整合しない。

## 診断

同じ net 内の段差や二重バス自体を通知する既存の診断はない。再現では後続の箱の短い stem に `geometry/arrowhead-cramped`（info）が出ていた。修正後の paper の再現では解消する。新しい診断は追加しない。

## 互換性と検証

- 全組み込みテーマで上向き・下向きの再現を回帰テストし、共通のバス位置と各枝の full arrow room を確認する。修正を外すと高さの異なる対象のテストが失敗する。
- 高さの等しい対象は補正対象外とし、同じ配置で補正なしのルーティングと一致することもテストする。
- 狭い gap の paper / 4pt と slides / 7pt を上下両方向で実際に描画し、サンプリングした角丸を含む painted route から 2pt の stem を確認する。paper の cramped 診断は 3 件のままで label には出ない。同サイズの箱を stack と row に分けた上下配置は全 5 テーマで全経路・net が補正なしと一致する。追加 14 テストはレビュー前の実装で全件失敗し、修正後は既存分を含む 34 件すべて成功する。共通バス用の slides の正常系は必要な room が入る 6mm にする。
- 互換性比較を再実行した。version-controlled な公開 YAML 106 図と検証用 3 図を自身のテーマと全 5 テーマで描画した（654 ケース）。research/ と private figures は除外する。ベースラインは `origin/main` の router を同じブランチの描画環境で読み込んで他の変更を分離した（ブランチ分岐点と同一の router）。SVG/PDF/PPTX 各 445 件、D2 228 件を SHA-256 比較し、描画不可の 209 ケースは診断コードが一致した。既存 106 図と等高の対照図は全形式で不変。上下の再現だけが各 5 テーマケース（own / minimal / academic / color / paper）で変わる。slides の 4mm 再現は必要位置が収まらないため従来出力を保つ。manifest は `.sumi/tmp/review-before.json` / `.sumi/tmp/review-after.json`。
- 必須検査: `bun run check`、`bun run typecheck`、`CI=1 bun run test`（4,815 pass / 13 skip / 0 fail）、`bun run schema:check`、`bun run gallery:check`（239 ファイル一致）。
- CLI の PDF を `pdftoppm -r 400 -png` で画像化し、変更前後のバスと角丸を目視確認する。
