# #575 斜投影の直方体 `cuboid` と図ごとの投影設定（設計 #574 の段階 A）

- **背景**: U-Net・VGG 風 CNN の層を立体で描くには、奥行きを持つ形と面ごとの陰影が要る。立体の描き方の決定は `research/574-3d-components/`（モックアップ）にあり、3D エンジンは採らず、斜投影（cabinet）の 2D 外接形に落とす（設計 #574）。この記録は段階 A（投影設定と `cuboid`）の実装上の決定。格子・ハイライト（段階 B）と傾けた平面（段階 C）は別の issue。
- **決定**:
  - **投影設定**: `figure.projection: {angle, depthScale}`（図ごと、省略可）。`angle` は 10〜80 度（既定 45、`layers` と同じ右上）、`depthScale` は 0 より大きく 2 まで（既定 0.5）。`dx = depthScale·depth·cos(angle)`、`dy = depthScale·depth·sin(angle)`。`figure.layout` ではなく `figure` 直下に置いたのは、投影は配置の方式ではなく図全体の描き方で、エンジンに依らないため。省略時は IR に何も加えず、立体を使わない図の出力は変わらない。角度の端（0・90 度）は上面か側面が潰れるので範囲から外した。
  - **`cuboid`**（`sumi/cuboid`、outline renderer）: `props: {width, height, depth}`（必須。前面の幅・高さと奥行き）、`dims`。variant は `default`・`muted`・`tinted`・`solid`。ノードの箱は前面 + (dx, dy) の外接形（シルエット）。ラベルは前面の safeArea に置き、長ければ前面を広げる（footprint は単調）。ラベルが空なら IR の大きさを明示値（`width + dx`、`height + dy`）にして、空ラベルの余白で前面が広がらないようにする（薄い板）。角は丸めない。`lint/empty-label` は `cuboid` を免除する。
  - **outline の契約の変更**: `OutlineDrawing.layers` の要素に、面を表す `shade?: "front" | "top" | "side"`（body）と内側の辺を表す `inner?: true`（line）を足し、`portOffsets?: {north, south, east, west}`（辺ごとの既定のポートの位置、0〜1）を足した。契約は後方互換で、既存の renderer は何も変わらない。`shade` を持つ body は線なしで塗り、`front` はノードの fill、`top`・`side` はテーマが導く色。`inner` の line は枠の 0.5 倍の太さで、枠の色を fill へ 55% 混ぜた色。シルエットは `shade` のない closed の line（枠の太さと色）。SVG（`render/structured.ts`）、PDF（SVG 経由）、編集可能 PPTX（`render/pptx/editable.ts`: 面ごと・内側の辺ごとの freeform、最後に文字と接続点を持つシルエット）は、共通の `render/outline-paint.ts` で塗る。
  - **面の陰影（テーマ）**: 前面は tone の fill、top・side は fill から目標色へ混ぜる比率で決める。明るいテーマは top を白へ 0.55、side を枠の色へ 0.20。暗いテーマ（`sumi-dark`）は top を枠の色へ 0.22、side を `#1c2033` へ 0.35（モックアップの medium）。値は `Theme.cuboidShade`（`{top: {toward, amount}, side: {...}}`、`toward` は `line` か `#RRGGBB`）として持ち、組み込みの `sumi`・`sumi-dark` は明示し、他のテーマは書かなければキャンバスの明るさで同じ既定が決まる（`core/theme/cuboid-shade.ts`）。色は IR の render params（`topFill`・`sideFill`・`innerStroke`）に確定してから renderer へ渡す。fill が色でない variant は陰影を付けない。
  - **dims**: `props.dims: {width?, height?, depth?}` は check ステージで、`label` ノード `<id>-dim-width|height|depth` に展開し、cuboid に `attach` する（幅: 上 1.2mm、高さ: 下 2mm、奥行き: 右下の角）。文字は常に水平で、レイアウト・geometry lint（はみ出し・衝突）・PDF・PPTX が普通のテキストとして扱う。ID は予約（`ref/reserved-id`）。診断の path と subject は `dims` の欄を指す（`ExpandedOrigin.from: "dims"`）。
  - **ポート**: 既定（アンカーなし）で、左 = 前面の左辺の中点、右 = 前面の中央の高さの水平線がシルエットと交わる点（`h/2 ≥ dy` なら奥の右辺、そうでなければ側面の下辺）、上 = 上面の奥の辺の中点、下 = 前面の下辺の中点。`portOffsets` で辺ごとの既定の位置を返し、ルーターが 1 本だけの端に使う（同じ辺に複数本あるときは従来の等分）。衝突・外形はシルエット全体（凸）。例外として、向かい合う辺で前面（相手が箱なら辺）の範囲が重なる隣どうしでは、両端がその辺を単独で使っているとき（fan-in・fan-out、merge・spread の端は動かさない）、端を重なりの中央に移して、両方の前面の内側を通る 1 本の水平（垂直）線にする。重なりが 2·`STRAIGHT_MARGIN` 未満なら前面の中点のまま。
  - **auto（D2）では使えない**（`engines: ["structured"]`）: dims は `attach`（structured 専用）で置き、ポートはルーター（structured）の既定の位置で決める。D2 の座標ではどちらも実現できず、D2 は外接形の中央しか知らない。auto の図は `layout/structured-only` になる。
- **採らなかった案**:
  - dims を renderer が `<text>` として描く: はみ出し・衝突の lint、PPTX、レイアウトの余白のそれぞれに特別扱いが要る。ラベルノードにすればすべて既存の経路に乗る。代償として、幅・高さの文字の中心は前面ではなくシルエットの中心になる（モックアップは最上辺の中点）。差は dx/2。
  - テーマごとの係数を `figure.themeOverrides` で上書き可能にする（モックアップの未決事項）: 段階 A ではテーマの定義だけにした。必要になったら足す。
  - 書いたアンカー（`south` など）の既定位置を前面にする: アンカーの `offset` は辺の中央が既定値で、書いたかどうかを区別していない。前面の位置が要るときは書かない（既定のポート）か `north:0.85` のように位置を書く。
- **既知の制限と今後**:
  - 近接した cuboid を重ねる（モックアップの「ブロック間 0.5·dx + 1.2mm」）ことはできない。構造化レイアウトは外接形で隙間を取るので、隣は dx 以上離れる。
  - 上のポートと幅の dims は同じ上辺の近くに来る。スキップ接続は `north:<0.8 など>` で右寄りに出す。
  - 格子・ハイライト・受容野の線（段階 B）と傾けた平面（段階 C）は未実装。`cuboid` の params と `portOffsets`・`shade` はその拡張点になる。
- **互換性**: 既存の図・作例・再現図・ギャラリーの出力は変わらない（`gallery:check`、PPTX の既存 golden が一致）。追加は `sumi/cuboid` のギャラリー（8 テーマ分の SVG と PPTX golden）と、組み込み部品の一覧に `cuboid` が入ったことによる診断の hint の文面（`tests/fixtures/lint-output/no-cascade.*`）のみ。凡例（`legend`）の見本ノードは、`depth` を持つ部品（cuboid）のとき小さな立方体にする。
