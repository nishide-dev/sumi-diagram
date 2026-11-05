# #380 図ごとに tone の色とグループの塗り・枠を上書きする

## 背景

GCN の図 1（#367）の再現では、頂点の枠が tone の色、塗りが淡い同系色、文字が黒、層のカードが白地に黒い枠になっている。原図の色は paper テーマの tone より彩度が低い（青の線 `#5f6a95`・塗り `#dfe1ea` など）。これまでの `themeOverrides` で変えられる色は `solidFills`（solid の塗り）と `dashedGroupStroke` だけで、tinted の塗り・枠・文字、tone つきの辺、グループの塗りと枠は変えられなかった。tinted の文字は tone の線を 4.5:1 まで暗くした色で、黒にできなかった。

## 決定

- `figure.themeOverrides.tones: { <tone>: { fill?, line?, text? } }` を追加する。色は `#RRGGBB` のみ、未知の tone・未知のキーは `schema/*` のエラー（strict）。
- 上書きは theme の stage で、組み込み theme の写しの `tones.<tone>`（`fill`）と `toneLines.<tone>`（`stroke` = `line`、`fontColor` = `text`、なければ `line`）に合成する（`withToneOverrides`）。組み込み theme 自体は変更しない。tone を参照するすべての経路がこの写しを読むので、次のすべてに一貫して効く。
  - default・filled variant と tone つきグループの淡い塗り、行列のクラスのセルと凡例の見本（`fill`）。
  - outlined の枠と文字、tone つきの辺の線・矢じり・ラベル文字、tone つきの見出し文字、`\textcolor{<tone>}` の文字、ハッチの線（`line` / `text`）。
  - tinted: 塗りは `fill`、枠は `line` を**そのまま**使う（従来は文字と同じく暗くした線）。文字は `text` があればそのまま、なければ従来どおり線を塗りに対して 4.5:1 まで暗くした色。`line` も `text` も指定しなければ従来の結果と同じ。
  - solid: 塗りと枠は `line`。白い文字は `solidFills` と同じく 4.5:1 に満たなければ暗くする。`text` は淡い塗り（と白地）の上の文字色なので solid には使わない。`solidFills` が同じ tone を指定していれば、solid の塗りは `solidFills` が優先する（より限定的な指定のため）。
  - default・filled variant の文字は tone の色ではなく theme の文字色なので、`text` は効かない。
- dim は上書き後の style に従来どおり適用する（淡くする・灰色にする）。
- 上書きした tone の文字は自動調整しない場所が 2 つあるので、そこで 4.5:1 未満なら新しい警告 `theme/low-contrast` を出す（既存のコントラスト診断はないため新設した）。図が実際にその文脈で tone を使うときだけ検査する。
  - tone の塗りの上: 明示した `text` を、その tone の tinted ノード（tone のない tinted は gray）があるとき塗りと比べる。位置は `tones.<tone>.text`。`text` を省けば tinted の文字は自動で暗くなるので検査しない。
  - 白地の上: tone の文字色（`text`、なければ `line`）を、outlined の要素・ラベルつきの tone の辺・tone つきの見出し・`\textcolor{<tone>}` があるとき白と比べる。位置は `text` があれば `tones.<tone>.text`、なければ `tones.<tone>.line`。`line` だけを明るい色にすると outlined の文字や辺のラベルがそのまま薄くなるため。
  - メッセージにはどちらの背景で足りないかを書く。
- `gray` を上書きすると、tone のない tinted / solid ノードも変わる（これらの中立の既定は gray の塗りと線のため）。`solidFills.gray` と同じ扱い。tone のない outlined は variant 自体の色なので変わらない。
- HTML 埋め込みの `--sumi-accent` は青の線色なので、`tones.blue.line` に従う。
- グループには `themeOverrides.groupFill` と `groupStroke`（いずれも `#RRGGBB`）を追加する。対象は `container` のグループで、凡例や行列の枠は含まない。
  - `groupFill`: tone のない、塗りのある（`transparent` でない）グループの塗り。`plain` / `dashed` のような塗りのない variant は透明のまま。tone つきグループは tone の塗り（`tones.<tone>.fill` で上書き可）を優先する。
  - `groupStroke`: すべての container の枠の色。`dashed` は `dashedGroupStroke` があればそちらが優先する。枠の幅が 0 の variant には見た目の変化がない。
  - 重ねたカード（#365、`props.layers`）の背面カードはグループの style を共有するので、同じ塗り・枠になる。
- GCN の白いカードと黒い枠のために、issue の `groupFill` に加えて `groupStroke` を足した。paper の muted グループの枠は灰色（`color.muted`）で、塗りだけでは原図の黒い枠を表せないため。

## 採らなかった案

- `tones.<tone>.text` を default・filled variant の文字にも効かせる案: これらの文字は tone と無関係な theme の文字色で、tone ごとに文字色が変わると既存の意味（tone は塗りの分類）が崩れる。
- 明示した `text` も自動で暗くする案: 原図の黒文字など、書いた色をそのまま使いたい用途を満たせない。代わりに警告する。
- `groups: { fill, stroke }` のような入れ子: 既存の `dashedGroupStroke` と書き方が揃わない。
- `groupFill` を tone つきグループにも効かせる案: 要素ごとに明示した tone を図全体の指定が上書きしてしまう。

## 互換性

新しいキーを書かない図の出力は変わらない。`tones` が空（`{ blue: {} }`）でも同じ。対象 YAML（research と非公開の図を除く）を自身の theme と全組み込み theme で変更前後に描画し、SVG / PDF / picture PPTX / D2 の SHA-256 が一致することを確かめた。回帰テスト（`src/render/tone-overrides.test.ts`）は、全 variant・辺・矢じり・行列クラス・凡例・ハッチ・`\textcolor` への反映、`solidFills` との優先順位、dim、`groupFill` / `groupStroke` と背面カード・`dashedGroupStroke`、低コントラスト警告、スキーマのエラーを検証する。
