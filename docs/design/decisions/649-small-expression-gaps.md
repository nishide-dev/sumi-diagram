# #649 小さな表現の不足: 並びに加わらない注記、番号のバッジ、バスにしないレーン、入れ子の place の座標

## 背景

#639（v0.20.0 の dogfooding）の横断の問題 9 のうち、次の 4 つを扱う。

- run 3: `tokens` のセルに `attach` した注記で行の大きさが変わり、同じ行の `t=3` のラベルがずれた。`tokens` 全体から辺が出ると、`tokens` は枠のグループになり（#281）、セルに付けた注記はその枠の中に入る。枠は注記を収めるように伸び（#517）、行の `align: center` は伸びた枠の中心にラベルを合わせる。
- run 4: 線の上に段階の番号を丸いバッジとして描く手段がなかった。
- run 10: 1 つのノードの同じ側から出る 2 本のレーンは、仕様（#609）によって必ず 1 本のバスになる。独立した 2 つのループを同じ側に出せなかった。
- run 9: 入れ子の `place` の座標は、項目の足跡の外接矩形で正規化される。2 つのグループを 1 つのモックアップの座標で並べるために、グループの中心を手で計算した。

## 決定

4 つとも小さな機能として入れた。いずれも書いたときだけ効き、書かない図の出力は変わらない。

### 1. `attach.inFlow: false`

```yaml
- {id: note, component: label, label: "fork here", attach: {to: seq.f, side: south, gap: 1mm, inFlow: false}}
```

- 付けたノードは、そのノードの属するグループ（`tokens` の枠、または普通のグループ）の大きさを変えない。エンジン（`engine.ts` の `#containerSize`）は、そのグループの attach の張り出し（overhang）を数えるときに、このノードを除く。
- 除いた分がグループの枠からどれだけ出るか（`#hangs`。張り出しと padding を引いた残り）を記録し、その外側のコンテナが自分の張り出しを数えるときに、グループの枠をその分だけ広げた矩形として数える。外側のコンテナは、ほかの attach と同じく、自分の arrange の箱からはみ出す分だけ伸びる。ルート（外側がない）では従来どおり張り出しに数え、キャンバスがノードを収める。
- ノードは並びの中に場所を取らない。隣の項目との間は作者が `gap` で空ける。重なれば `geometry/label-collision` などの既存の lint が言う。
- 置き方（`#placeAttached`）は変えない。ターゲットの側に `gap` だけ離して中心を合わせる。

### 2. `labelStyle: badge`

```yaml
- {from: client, to: tracker, label: "1", labelStyle: badge}
```

- `tag`（#610）と同じ置き方・同じ診断で、枠を丸くした。`isTagLabel` が `badge` も真とし、置き場・重なりの判定・`edge-label-detached` の対象外などは tag の経路をそのまま通る。
- 形（`tagPadding` / `tagBox` に辺を渡す）: 高さは tag と同じ（文字の行の箱＋上下に文字サイズの 1/10）。幅は高さ以上で、左右の余白は文字サイズの 1/6 以上。1〜2 文字なら円、長いラベルなら角の丸い pill になる。`rx` は高さの半分。
- SVG では `<rect class="sumi-edge-badge">`（tag は `sumi-edge-tag`）。塗りと枠は tag と同じ（下の色で塗り、線の色の細い枠）。編集可能 PPTX はラベルの直前の `rect` を背景として読むので、tag と同じく塗りは残る。

### 3. `lane.bus: false`

```yaml
- {from: acq, to: avail, lane: {side: east, bus: false}}
- {from: acq, to: arch, lane: {side: east, offset: 10mm, bus: false}}
```

- `planLanes` のバスの結合（同じ側・同じ源または先の lane を推移的にまとめる）から、`bus: false` の辺を外す。その lane は自分の `offset` の線を走る。
- 端: `bus: false` の lane が 2 本以上、同じ要素の同じ側に、その側のアンカーを書かずに付くとき、その側に 1/(k+1), 2/(k+1), … の位置に広げる（`ports.ts` の `unbussedLaneOffsets`）。並びは他端の中心の位置（東西の側なら y、南北の側なら x）、同じなら文書順。上に戻るループが上の点から、下へ行くループが下の点から出るので、交わらない。広げないと 2 本は 1 点を共有し、そこで分かれる小さなバスに見える。その側に書いたアンカーは従来どおり優先する。
- `layout/lane-bus-split` は出ない（バスではないため）。その hint に「`lane.bus: false` で別の線にする」を足した。

### 4. `origin: place`（入れ子の place の座標）

```yaml
figure:
  layout:
    arrange:
      place:
        unit: 1mm
        items:
          - {item: active, at: [0, 0], origin: place}
          - {item: terminal, at: [0, 0], origin: place}
```

- place の項目の `origin` に `place` を足した（既存の `footprint` / `body` は #517）。`at` は「グループ自身の place の [0, 0] が来る点」になる。`at: [0, 0]` と同じ `unit` なら、内側の座標がそのままページの座標になり、グループの中心を計算しなくてよい。
- 計算（`engine.ts` の `#placeZero`）: グループを自然な大きさで置いたときの、内側の [0, 0] の位置を、`#placeElement` と `#placeCoordinates` と同じ手順で求める（枠、padding と題の帯、attach の張り出し、残りの中で place の箱を中央に置く）。`#coordinateRect` はその点が `at` に来るように足跡の矩形を返す。外接・重なりの判定・配置はすべて `#coordinateRect` を通るので、同じ矩形を見る。
- 対象は「自分の arrange が `place` のグループ」に限る。ノード、`place` 以外の arrange、arrange のないグループには `layout/invalid-place-origin`（error、検査段階）。傾いた平面（#577）は置き方が違うので、エンジンでは従来の `footprint` として扱う。

## 採らなかった案

- **inFlow: false のノードを外側のコンテナの attach に移す**: 外側のコンテナの局所の配置には内側のセルの位置がないので、ターゲットが置かれていない（`#placeAttached` が前提とする「ターゲットは同じコンテナ」が崩れる）。所属は変えず、大きさの計算だけを分けた。
- **inFlow: false でも並びに場所を取る（行の高さには入れず、stack の高さには入れる）**: 行の中央揃えに入れずに stack にだけ場所を取らせるには、項目の大きさを 2 つ持つ必要があり、変更が大きい。作者が gap で空け、重なりは lint に任せる。
- **バッジを線の色で塗り、文字を白くする**: 文字と塗りのコントラストの判定、PPTX の背景の読み取り、テーマごとの文字色が絡む。tag と同じ塗り（下の色）にして、形だけを変えた。色は辺の `tone` で付く。
- **`bus: false` の端を広げずに作者のアンカーに任せる**: 1 点から 2 本が分かれるとバスに見え、#639 run 10 の「独立した 2 つのループ」にならない。アンカーなしで分かれる既定にした。
- **入れ子の place を「親と同じ座標系」と宣言する `place.coordinates: parent`、または `at` の省略**: 内側の箱の書き方と外側の項目の両方に効く指定になり、`at` が必須という place の契約も変わる。外側の項目の `origin` の値を 1 つ足すだけで同じことが書ける。
- **Skill の説明だけで済ませる**: 手で計算する手順を書いても、題の帯・padding・attach の張り出しを含む計算はエージェントには重く、#639 run 9 で実際に時間を使った。

## 互換性

- 4 つとも新しい書き方で、書かない図の配置・経路・SVG・PDF はバイト単位で変わらない（`bun run gallery:check` が通る。ピン留めした再現は `SUMI_UPDATE_REPRODUCTIONS` なしで `reproduction-hashes.test.ts` が通る）。
  - inFlow: 該当するノードがなければ `#hangs` は空で、張り出しの計算は従来と同じ。
  - badge: `isTagLabel` の判定が広がるだけで、`tag` の形と置き方は同じ。
  - bus: `bus: false` がなければバスの結合と端の解決は同じ。
  - origin: `innerOrigin` がなければ `#coordinateRect` は従来どおり。
- スキーマ: `attach.inFlow`、`lane.bus`、`labelStyle` の `badge`、place の `origin` の `place` が加わった。既存の YAML はそのまま有効。
- 診断: `layout/invalid-place-origin`（error）が新しい。`layout/lane-bus-split` の hint の文が変わった。

## 検証

- `src/layout/expression-gaps.test.ts`: inFlow（ラベルとセルの中心が揃う、枠がセルだけ、注記が枠の下、外のグループが注記を収める）、badge（短いラベルは円、長いラベルは pill、線の上）、bus（自分の offset、端が側の上で分かれる、上のループが上から出る、lane の警告なし）、origin: place（グループをまたいで中心が揃う、座標の差がそのまま、誤用の error）。
- #639 の run 3 の下書きに `inFlow: false` を足して描き、`t=3` のラベルがセルの中心に揃うことを確かめた（(b) の注記は下の文と重なり、`geometry/label-collision` が出た。gap で空ける必要がある）。
