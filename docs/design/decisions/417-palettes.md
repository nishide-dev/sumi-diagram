# #417 組み込みの配色パレット

## 背景

図の色合いは、テーマ（minimal・paper・color・llama など）、tone（意味を持つ 8 色）、`themeOverrides`（#380）で決まる。図ごとに統一感のある配色にするには、色を 1 つずつ指定する必要があった。Color Hunt の人気パレットのような、4 色で調和の取れた配色を、名前で選べるようにする。

人気パレットの 4 色は、同系色の濃淡 4 段階（例 `#e3fdfd #cbf1f5 #a6e3e9 #71c9ce`）か、背景・面・強調・文字の 4 役（例 `#f9f7f7 #dbe2ef #3f72af #112d4e`）のどちらかが多い。tone（青・緑・橙…）に当てはめるより、テーマの色の役割（パネルの塗り、ノードの塗り、線、強調、文字）に割り当てるほうが合う。

## 決定

### 適用の方法

- `figure.themeOverrides.palette: <name>` を追加する（スキーマは列挙型。未知の名前は `schema/invalid-value` で、最も近い名前を提案する）。`figure.palette` にしなかったのは、パレットが「選んだ組み込みテーマの図ごとの調整」であり、既存の `tones`・`groupFill` などと同じ場所に置くと次の 3 点が揃うため。
  - IR の `meta.themeOverrides` に載るので、構造化 SVG・HTML 埋め込み・PPTX など、テーマを引き直す経路がそのまま同じ指定を読める。
  - 同じオブジェクトの `tones`・`groupFill`・`groupStroke`・`solidFills` より先に適用するので、「パレットが土台、個別の指定が優先」という順序が 1 か所で表せる。
  - テーマを変えるだけで見た目が変わらないよう、パレットはテーマの選択（`figure.theme`）と独立に書ける。
- **どのテーマにも重ねられる**（minimal・academic・slides・color・paper・llama）。パレットは色だけを変え、大きさ・フォント・線の太さ・角の丸み・矢じりの形・dim の灰色はテーマのまま。`academic` は白黒印刷向けにグレー 1 色で作ったテーマなので、パレットを重ねると色が付く。白黒で印刷する図には重ねない（Skill に書く）。
- `withPalette(theme, name)`（`src/core/theme/palette.ts`）は、組み込みテーマの**写し**を返す。組み込みテーマ自体は変えない。`figureTheme(theme, themeOverrides)`（`overrides.ts`）が「パレット → `tones`」の順に適用し、図のテーマを引く 4 か所（`styleFigure`・IR の組み立て・構造化 SVG の書き出し・HTML 埋め込み）がこれを使う。`palette` を書かない図は `withPalette` が同じオブジェクトを返すので、すべての経路で従来と同じ値を読む。

### 4 色から役割への割り当て

パレットの 4 色は、明度の順に **panel**（最も淡い）・**tint**（2 番目に淡い）・**accent**（強調に使う 1 色）・**ink**（最も濃い）に割り当てる。これに、ink から導く **muted**、accent から導く **strong**、panel と tint から導く **soft**・**frame**（`muted` のグループ用）を足した 8 つが、テーマのどこに効くかの単位になる。panel と tint は、公開された色が白に近すぎる（`cool-blue` の `#f9f7f7`、`cyan-pink` の `#f5f5f5`）か、パレットの色相が出ない（`sage`・`seafoam` のクリーム・桃色）ときは、パレットの定義で別の公開色、またはその色を白・accent へ寄せた色にする。

| 役 | 決め方 | 効く先 |
| --- | --- | --- |
| panel | 淡い色。パレットの色相が見えるもの（公開色、または公開色を白へ寄せた色） | グループの塗り（`container` の既定。塗りのないグループは透明のまま）、枠なしの淡いパネル |
| tint | 2 番目に淡い色。ink が読める 4.5:1 に足りなければ白へ寄せる | `filled`・`tinted` のノード、`gray` tone の塗り、`container` の `filled`、`emphasis` が塗りの theme（academic・slides）の塗り |
| accent | 公開された色のうち、強調に選んだ 1 色。白に対して 4.5:1 に足りなければ、色相を保って明度を下げる | `emphasis` の枠（全テーマ）、`emphasis` の辺、llama の `emphasis` の塗り（白い文字が 4.5:1 になる） |
| ink | 最も濃い色。白に対して 9:1 に足りなければ黒へ寄せる | 文字、ノードの枠、辺・矢じり、junction、グループ見出し |
| muted | ink を白へ寄せ、白とパネルの上で 4.5:1 を保つ限り薄くした色 | `muted` の variant、ラベルの `muted`、グループの枠、凡例の枠、拡大線など灰色の補助線 |
| strong | accent の公開色を、色相を保って白とパネルの上で 4.5:1 になるまで暗くした色（accent と同系の濃い色） | `solid` の塗り（白い文字。灰色ではなくパレットの色になる）、`outlined` の枠と文字、`gray` tone の線（辺・ハッチ・set の輪郭） |
| soft / frame | soft は panel を白へ 50% 寄せた色、frame は tint を ink へ 30% 寄せた色 | `muted` のグループ（`sumi/container` の `muted`）の塗りと枠。他のテーマでは白地に灰色の枠だったものが、パレットの淡い色になる（塗りのない theme は透明のまま） |

実装は、テーマごとの値を知らずに済むよう、テーマが役割ごとに持つ色を**値で写す**。役割は組み込みテーマが共通して置く場所から読む（`colorMap()`）。

- 文字（`base.node.fontColor`）・ノードの枠（文字と同じなら ink、違えば muted。llama の灰色の枠）・辺（`base.edge`）・グループの見出し → ink。
- ラベルの `muted` の文字色 → muted。
- `gray` tone の塗り → tint、`gray` の線の色 → strong。
- `emphasis` が彩度のある色（color・llama のアクセント）→ accent。
- それ以外の淡い色・灰色（彩度が低いもの）は明度で振り分ける。輝度 0.85 超は panel、0.5 超は tint、それより濃いものは muted（グループの淡い塗り、academic の強調の塗り、llama の operator の枠、拡大線など）。
- すべての `emphasis` の枠は accent にする。minimal・academic・slides・paper の `emphasis` は太い黒枠だったが、パレットでは太さはそのまま、色が accent になる。
- テーマの `tokens`（HTML 埋め込みの `--sumi-fg`）にも同じ写しを適用する。
- 写すのは `base`・`components`・`gray` の `tones` / `toneLines` だけ。`dim` と、`gray` 以外の tone は触らない。

### tone との関係

tone は**テーマのまま**にする。`red`・`blue`・`green` などは図の意味（分類）を持つので、パレットで色相を変えると凡例や読み手の理解が崩れる。例外は `gray` tone で、これは「色を持たない中立」であり、tone なしの `filled`・`tinted`・`solid`・`outlined`、set の輪郭、辺の既定色がここから派生するので、パレットの中立（tint と strong）にする。

`themeOverrides.tones.gray`・`tones.<tone>`・`groupFill`・`groupStroke`・`solidFills` を同時に書くと、それらがパレットに勝つ。tone を指定していない `filled`（tone なしのノード）はテーマの variant の色であり tone の上書きの対象ではないので、`tones.gray` では変わらない（#380 のとおり）。

### 出典と、選んだ 8 パレット

色は Color Hunt の人気パレット（2026-11-08 取得、issue #417 の上位 20）の 4 色のみを使った。利用規約に明記がないため、色の値以外（名前・順位・説明・画像）は取らず、少数にとどめた。名前は系統を表す短い語で、元のパレットの名前は使わない。

上位 20 のうち、4 色がすべて極めて淡いもの（`#e3fdfd…`、`#f9f5f6…`、`#b1b2ff…` など）は、文字と線に使える濃い色がなく、ink をすべて作り直すことになるので選ばなかった。同系統のもの（青なら `#1b262c #0f4c75 #3282b8 #bbe1fa` と `#6096b4…`、茶なら `#8d7b68…`・`#ad8b73…`・`#fff8ea…`）は、性格の違う代表だけを選んだ。

| 名前 | 4 色（公開された順） | 性格と役 |
| --- | --- | --- |
| `cool-blue` | `#f9f7f7 #dbe2ef #3f72af #112d4e` | 冷たい青。高コントラスト。panel `#dbe2ef`（公開色）、tint は `#dbe2ef` を accent へ寄せた青、accent `#3f72af`、ink `#112d4e` |
| `slate` | `#27374d #526d82 #9db2bf #dde6ed` | くすんだ青灰色。panel `#dde6ed`、tint `#9db2bf`、accent `#526d82`、ink `#27374d`。落ち着いた図向け |
| `coral` | `#fff5e4 #ffe3e1 #ffd1d1 #ff9494` | 暖色（ピンク）。panel `#ffe3e1`、tint は `#ffd1d1` と `#ff9494` の中間、accent は `#ff9494` を暗くした赤、ink は `#ff9494` を暗くした茶 |
| `terracotta` | `#7d5a50 #b4846c #e5b299 #fcdec0` | くすんだ土色。panel `#fcdec0`、tint `#e5b299`、accent は `#b4846c` を暗く、ink は `#7d5a50` を暗く |
| `sage` | `#f8ede3 #bdd2b6 #a2b29f #798777` | くすんだ緑。panel は `#bdd2b6` を白へ寄せた淡い緑、tint `#bdd2b6`、accent は `#bdd2b6` を暗くした緑、ink は `#798777` を暗く |
| `lavender` | `#f4eeff #dcd6f7 #a6b1e1 #424874` | ラベンダー。panel は `#dcd6f7` を白へ寄せた色、tint `#dcd6f7`、accent は `#a6b1e1` を暗くした青紫、ink は `#424874` を暗く |
| `cyan-pink` | `#364f6b #3fc1c9 #f5f5f5 #fc5185` | 高コントラスト。panel は `#3fc1c9` を白へ寄せた淡いシアン、tint は `#3fc1c9`（ink が読めるよう少し淡く）、accent は `#fc5185` を暗くしたピンク、ink は `#364f6b` を暗く |
| `seafoam` | `#ffb6b9 #fae3d9 #bbded6 #61c0bf` | 緑青。panel は `#bbded6` を白へ寄せた淡い緑、tint `#bbded6`、accent は `#61c0bf` を暗くした青緑、ink は同じ色をさらに暗くした深い青緑。ピンクの 2 色は使わない |

各パレットの実際の役の色（`sumi catalog --section palettes` と同じ）と、公開された色のまま使えなかった役を次に示す。「調整した役」に ink・tint・accent の名前があるものは、その役の色が公開された 4 色のどれでもない（muted と strong は常に ink から導く）。

| 名前 | panel / tint / accent / ink / muted / strong / soft / frame | 調整した役 |
| --- | --- | --- |
| `cool-blue` | `#dbe2ef #acc0dc #3f72af #112d4e #51667e #38659c #edf1f7 #7e94b1` | tint, strong |
| `slate` | `#dde6ed #9db2bf #526d82 #27374d #5b6778 #4f697d #eef3f6 #7a8d9d` | strong |
| `coral` | `#ffe3e1 #ffb3b3 #cb4b4b #663b3b #836060 #bf3737 #fff1f0 #d18f8f` | ink, tint, accent, strong |
| `terracotta` | `#fcdec0 #e5b299 #9c6950 #5d433b #755f58 #875b45 #feefe0 #bc917d` | ink, accent, strong |
| `sage` | `#e1ebde #bdd2b6 #5a7e4e #434a41 #636961 #4f7045 #f0f5ef #98a993` | ink, panel, accent, strong |
| `lavender` | `#ece8fb #dcd6f7 #5d71c8 #404671 #62678b #4b62c2 #f6f4fd #adabcf` | ink, panel, accent, strong |
| `cyan-pink` | `#d9f3f4 #50c7ce #ca476f #334a65 #5a6c82 #bf3761 #ecf9fa #47a2af` | ink, panel, tint, accent, strong |
| `seafoam` | `#e0f0ed #bbded6 #348281 #284f4e #517070 #2e7473 #f0f8f6 #8fb3ad` | ink, panel, accent, strong |

ink を 9:1（白の上）に定めたのは、accent と ink を色覚の違いで見分けるために明度の差を大きく取るため。7:1 では coral の P 型で accent と ink の色差（CIE76 の ΔE）が 13 だった。

### 検証（`src/core/theme/palette.test.ts`）

各パレットを、次のテストで確かめる。

- **文字と背景のコントラスト**（`theme/low-contrast` の基準 4.5:1）: ink は白の上で 9:1 以上、panel・tint の上で 4.5:1 以上。muted は白とパネルの上で 4.5:1 以上。strong の上の白（solid）と、パネルの上の strong（outlined の文字）、accent の上の白（llama の `emphasis`）は 4.5:1 以上。さらに、全テーマ × 全パレット × 全部品 × 全 variant（tone なしと `gray`）で、解決した文字色が自分の塗り（塗りがなければ白かパネル）の上で 4.5:1 以上。
- **グレースケールでの分離**: L\*（CIELAB の明度）で、白 > panel > tint > accent > ink の順に、差が 2・4・20・10 以上。
- **色覚の違い**: Machado らの P 型・D 型の行列（強度 1.0、線形 RGB）で見たとき、accent と ink の色差が 15 以上、accent と tint の色差が 20 以上（CIE76）。

結果（ink は白 / panel / tint の上、L\* は panel / tint / accent / ink、ΔE は accent と ink の通常 / P 型 / D 型）:

| 名前 | ink のコントラスト | muted（panel） | 白に対する strong / accent | L\* | ΔE（accent-ink） |
| --- | --- | --- | --- | --- | --- |
| `cool-blue` | 13.9 / 10.7 / 7.5 | 4.5 | 6.0 / 5.0 | 90 / 77 / 47 / 18 | 32.4 / 32.9 / 32.2 |
| `slate` | 12.1 / 9.5 / 5.5 | 4.5 | 5.8 / 5.4 | 91 / 71 / 45 / 23 | 22.6 / 22.4 / 21.9 |
| `coral` | 9.3 / 7.7 / 5.5 | 4.6 | 5.5 / 4.5 | 92 / 80 / 50 / 30 | 42.1 / 19.2 / 31.5 |
| `terracotta` | 9.0 / 7.0 / 4.8 | 4.6 | 5.8 / 4.6 | 90 / 77 / 49 / 31 | 23.6 / 20.6 / 23.4 |
| `sage` | 9.2 / 7.5 / 5.7 | 4.6 | 5.6 / 4.6 | 92 / 82 / 49 / 31 | 31.1 / 28.1 / 24.4 |
| `lavender` | 9.0 / 7.5 / 6.4 | 4.6 | 5.5 / 4.5 | 93 / 87 / 50 / 31 | 30.1 / 29.4 / 29.7 |
| `cyan-pink` | 9.1 / 7.8 / 4.5 | 4.6 | 5.3 / 4.5 | 94 / 74 / 50 / 31 | 63.6 / 16.0 / 39.2 |
| `seafoam` | 9.1 / 7.7 / 6.3 | 4.6 | 5.4 / 4.5 | 94 / 86 / 50 / 31 | 21.5 / 19.9 / 18.8 |

**公開された色のままでは通らず、調整した色**:

- `coral`・`terracotta`・`sage`・`lavender`・`cyan-pink`・`seafoam` の ink: 最も濃い色が白の上で 9:1 に満たない（`#ff9494` は 2.1:1、`#364f6b` は 8.4:1 など）ので、黒へ寄せて 9:1 にした。`cool-blue`・`slate` は公開された色のまま。
- `coral`・`terracotta`・`sage`・`lavender`・`cyan-pink`・`seafoam` の accent: 公開された色が淡く、白の上で 4.5:1（枠として見えて、白い文字が読める値）に満たないので、色相を保って明度を下げた。彩度は 0.55 までにして、淡い色が蛍光色にならないようにした。
- `cool-blue` の tint、`coral` の tint、`sage`・`lavender`・`cyan-pink`・`seafoam` の panel: 公開色を白や accent へ寄せた派生色。`cyan-pink` の tint（`#3fc1c9`）: ink がその上で 4.5:1 に満たない（3.8:1）ので、白へ寄せて `#50c7ce` にした。
- `strong` は accent の公開色から導く（panel の上で 4.5:1 になるまで暗くする）。panel が濃い `slate` では `#4f697d` と、accent `#526d82` よりやや濃い。

制約として、`slate` の accent は ink と同じ青灰色の系統で、色相の差は小さい（ΔE 22）。強調は太い枠でも示すので見落とされないが、色だけで強調を伝える図には向かない。`coral` の P 型の ΔE が 19、`cyan-pink`・`seafoam` が 16〜19 と小さいのは、赤とこげ茶・紺・深緑が P 型でともに暗く見えるため。明度の差（L\* で 20 以上）で見分ける設計にしてある。

## 採らなかった案

- **tone もパレットから派生させる案**: 緑や赤が意味を持つ図で、パレットを変えると意味が変わる。見た目の差は gray tone と emphasis だけで足り、パレットを変えても tone は読める。
- **パレットごとに、テーマの各色を直接書く案**: パレット × テーマ（6）× variant の定義が膨らむ。役割への写しなら、テーマを足しても手を入れずに済む。
- **`figure.palette`**: 上の「適用の方法」のとおり、`themeOverrides` に置くほうが IR とテーマの経路に自然に載る。
- **テーマに「パレットを受け付けるか」の欄を足す案**: `academic` だけが例外で、禁止するより Skill の指示に任せる。
- **パレットの 4 色を判断せずにそのまま役に当てる案**: 淡い 4 色のパレットでは、白の上の文字や枠の色が 4.5:1 を満たせない。調整した役を明示するほうが安全。
- **Color Hunt の他の情報（名前・順位・説明）を持つ案**: 色の値だけを使い、出典を記す（利用規約に明記がないため）。

## `sumi catalog` と Skill

- `sumi catalog --section palettes`（`--json` では `palettes` 節）が、パレットの名前・説明・4 色・役の色・調整した役・出典を出す。セクションの追加なので、`version: 1` のまま（既存の読み手は変わらない）。
- JSON スキーマの `themeOverrides.palette` は `schema:gen` で再生成した。
- Skill（`skills/sumi/references/figure-format.md` と `layout-tips.md` の「見た目の方針を先に決める」）に、パレットを選ぶ手順（系統ごとの選び方、白黒印刷には `academic` を使うこと）を書いた。
- ギャラリーに `docs/gallery/palettes.md`（と `index.html` の節）を足した。小さなパイプライン（グループ・default・solid・filled・outlined・emphasis と辺・set・凡例・テーマのままの tone の見本）を 8 パレットで描く。

## 互換性

`palette` を書かない図の出力は変わらない（`withPalette` は同じテーマを返す）。対象 YAML（research と非公開の図を除く）を自身のテーマと全組み込みテーマで変更前後に描画し、SVG・D2・PDF・picture PPTX の SHA-256 が一致することを確かめた。変わるものはない（ギャラリーに加わった `palettes` の項目と、ギャラリーのナビゲーションのリンクを除く）。

回帰テスト: `src/core/theme/palette.test.ts`（出典の色、調整した役の申告、コントラスト、グレースケール、P 型・D 型、全テーマ × 全パレットの文字の可読性、テーマが変わらないこと、色以外が変わらないこと）、`src/render/palette.integration.test.ts`（パレットなしで出力が同じ、全テーマで役の色が効くこと、`tones` の優先、未知の名前のエラー、catalog の節）。
