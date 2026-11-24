# #646 揃え（`figure.layout.align`）の副作用を見せる診断と、動かす側の指定（`move`）

## 背景

#639 の dogfooding の 3 枚（run 1・3・6）で、`figure.layout.align` の副作用が診断なしに起きた（横断の問題 6）。

- **run 1（3 枚のパネルを `align: stretch` の row に並べた図）**: パネルをまたぐ `{y: [feat, dec]}` で、パネル (a) の枠だけが低くなり、3 つの枠の高さが揃わなくなった。原因は、キャプション付きの group が入るキャプションの stack（#130、`growFirst`）で、パネルの後ろに trail の strut が入ること。stretch した row が大きさを決めた後で、その strut がパネル自身の高さを削る（エンジンは stretch した item の大きさを `crossAvailable - margin` にし、キャプションの stack は余りを先頭の group に渡す）。同時に、キャプションがパネルから 16mm 離れる。縮小した再現（`tests/fixtures/figures/layout/align-uneven-stretch.sumi.yaml`）でも、(a) が 29.69mm、(b) が 40.75mm になる（揃えなしでは両方 33.75mm）。
- **run 3（トークン列の下に注記を置いた図）**: `{x: [note, seq.f]}` で、stack の中の注記ではなくトークンのセルが動き、セルが割れた（`layout/align-splits-tokens`）。ソルバーは各ラウンドで「小さい側の前に lead」「大きい側の後ろに trail」を試し、主軸の strut で満たせればそれを採る。注記は stack の直下にあり、`x` の主軸の strut（row が要る）を取れない。交差軸の strut（#545）は主軸の探索が満たせないときにしか試さないので、セルの row の trail が先に採られる。「こちらだけを動かす」指定がない。
- **run 6（学習の流れの下にデータの箱を揃えた図）**: `{x: [envs, rl]}` で、データの箱が段階の箱より広いため、`rl` の前に lead が入り、SFT → RL の gap が 6mm → 12.61mm になった（隣の RL → Merge は 6mm のまま）。`layout/align-grew-figure` は図全体が 5mm かつ 10% を超えて大きくなったときしか出ず、ここでは図の大きさは変わらない。

## 決定

### 1. `layout/align-widened-gap`（info）

- 揃えた配置（strut あり、straighten 前）と揃えなしの配置（strut なし）を比べる。strut（主軸の lead / trail）が入った item と、その箱の中で見た目の順に隣の item（lead なら前、trail なら後ろ）の間の gap を、両方の配置の外接矩形（無名の箱は中の要素の union）で測る。
- 報告する条件（すべて満たすとき）:
  - 広がりが **3mm を超える**（`ALIGN_GAP_MM`）。gap の一部や箱の大きさの差の半分程度は、書いた間隔として読める。
  - 揃えた後の幅が、揃えなしの **1.5 倍を超える**（`ALIGN_GAP_RATIO`）。
  - 同じ箱に他の gap があれば、その最小（揃えた後）より 3mm を超えて長く、1.5 倍を超える。箱のすべての gap が同じだけ広がった場合（U-Net の段を揃えて下げる `align-unet.sumi.yaml`）は 1 つの間隔に見えるので出さない。run 6 の評価の言葉どおり「兄弟より 1 つだけ長い gap」を拾う。
- 箱の先頭の前・末尾の後ろの空き（隣がない）は gap ではないので対象外。同じ tokens の行のセルの間は `layout/align-splits-tokens`（warning）と重なるので除く。キャプションの stack（`growFirst`）の gap は「キャプションが枠から離れる」と言い換えて報告する。
- メッセージは 2 つの item（無名の箱は「the row of "a", "b", …」）、前後の幅（mm、小数 2 桁）、その strut を実際に置いた制約（`figure.layout.align[i] (x: [envs, rl])`）。位置は最初の制約、ほかは related。
- **原因の制約はソルバーが記録する**（PR レビューで変更）: strut の集合（`Struts`）に、strut を置いた候補の制約を item ごとに持たせる（`causes`）。採られた候補だけが最終の strut に残るので、記録も実際に空きを足した制約だけになる。最初の実装は「strut を受けた item の中に要素を持つ制約」を数えたため、軸の違う満たされた制約（`{y: [rl, merge]}`）まで原因に挙げ、`move: merge` を勧めた。
- しきい値は丸めない値で比べる（`widened(was, now)`）。丸めはメッセージだけ。
- `figure.layout.alignGrowth: allow` で消える。`alignGrowth` は「揃えが足す空きは意図どおり」という宣言で、図の拡大と gap の広がりは同じ空きの別の見え方だから。スキーマの説明を合わせて直した。

### 2. `layout/align-uneven-stretch`（info）

- 実効の `align` が `stretch` の stack / row（エンジンと同じく、同じ種類の入れ子の箱には継承し、group の arrange の根と他の種類の箱では `center` に戻す）について、item の枠（文字列の item はその矩形、キャプションの stack は先頭の group の矩形。区切り線は除く）の交差軸の大きさを比べる。
- 「伸ばされた枠」はエンジンと同じ規則で決める（`sizing.ts` の `crossStretchable` をエンジンと共有）: group・箱は伸びる。node は、その軸の明示サイズ・outline の renderer・badge・glyphs がなく、伸ばせる形のときだけ伸びる。2 つ以上あるとき、揃えた後の大きさの差が **0.5mm を超えれば**報告する（`ALIGN_UNEVEN_MM`）。小さくなった枠と残りの枠の大きさ、揃えなしの大きさを示す。最初の実装は「揃えなしで同じ大きさ」を伸ばされた証拠にしたため、たまたま同じ高さの固定サイズの node（33.75mm）を報告した（PR レビューで変更）。
- 原因の制約は、伸ばされた枠の中に strut を置いた制約（上の `causes`）。
- `alignGrowth: allow` では消さない。stretch は枠を揃えるための指定で、枠の不揃いは空きの量と違って意図とは読めない。消すには下の `move` などで原因を直す。
- 原因の修正（ソルバーが stretch の枠を崩す strut を避ける）はしなかった。候補を捨てると、今は満たせている制約が満たせなくなる図が出る（出力が変わる）。まず見えるようにし、直す手段は `move` に任せる。

### 3. `move: <id>`（または一覧）

- 制約に `move` を足す（スキーマは `Ref | Ref[]`、空の一覧はスキーマ error）。書いた item だけが strut を受け、ほかの item はその制約のためには動かない。実装はソルバーの `stepFor`（item ごとの strut の置き場所）と、交差軸の再探索に進むかの判定（`holdable`）で、`move` にない item を除くだけ。主軸で満たせなければ、今までどおり交差軸の strut（#545）で再探索する。run 3 の再現（`align-move-note.sumi.yaml`）では、注記が交差軸の strut でセルの下に動き、セルは揃えなしと同じ位置に残る。
- `move` に制約の item でない ID を書くと `layout/invalid-align-move`（error、layout 段）。ほかの制約で動くことは止めない（制約ごとの指定）。
- `move` に全部の item を書いた制約は、`move` なしと同じ配置になる（テストで確かめる）。
- strut は空きを足すだけなので、箱の先頭の方へ戻る必要がある item だけを `move` に書くと満たせない。そのときの `layout/unsatisfied-align` の hint に「`move` の item しか動かない」ことを足した（grid のセルの hint は試行で確かめた編集に差し替えるので、そちらには足さない）。
- `align-widened-gap` と `align-uneven-stretch`、`align-splits-tokens` の hint は、strut が入った側の外にある制約の item を `move` に書く案を示す（制約に `move` がまだないとき）。試行の配置では確かめないことを hint に書いた。`align-grew-figure` の hint にも「動かす item を `move` に書く」を足した。

## 採らなかった案

- **`align-grew-figure` を拡張する**: 図の大きさの変化と、図の中の 1 つの gap の変化は別のことで、run 6 では図の大きさは変わらない。しきい値（5mm かつ 10%）も意味も違うので、新しいコードにした。`alignGrowth` で両方を消せるようにして、意図の宣言は 1 つのまま。
- **strut ごとに報告する**: 揃えは本来 gap を広げて満たすので、すべてを出すと既存の 17 図の多くに info が付く。兄弟の gap より目立つものだけにした（下の互換性）。
- **`prefer: <id>`（優先だけ）**: 優先する側で満たせないときに他方へ落ちると、作者が避けたかった動き（トークンの分割）が黙って起きる。`move` は「ほかは動かさない」と決め、満たせなければ `unsatisfied-align` で知らせる。
- **stretch の枠を崩す strut をソルバーが避ける**: 上の 2 に書いたとおり、既存の図の出力が変わり得る。

## 互換性

- 出力（SVG・PDF・Layout IR）は変わらない。`move` を書かない図はソルバーの候補が同じで、新しい診断は配置を読むだけ。`bun run gallery:check` は差分なし。
- 新しい info は描画の診断だけに出る（`sumi render` / `lint --geometry`）。リポジトリの align を使う 17 図を走査すると、`layout/align-widened-gap` が Skill の例の `gcn`（y1 → y4 の gap 4mm → 16.65mm）、基本レイアウトの `train-infer-panels`、テストの fixture（`color-use/*`、`align-side-kv`、`fit/c-h3world`）に出た。どれも 1 つの gap が兄弟より長くなっている実際の不揃いで、ギャラリーは info を許すので検査は通る。`layout/align-uneven-stretch` は既存の図には出ない。
- 既存のテストのうち、strut 1 つで gap を広げる小さな木で「診断なし」を確かめていたもの（`align.test.ts` の solving・side-KV・random）は、`layout/align-widened-gap` を除いて比べるようにした。side-KV の「小さな拡大は報告しない」テストは、出るのが `align-widened-gap` だけであることを確かめる。
- 期待診断の記録の更新: `docs/gallery/examples.md`・`index.html` の gcn（info が 1 件増える）、`builtins-render.test.ts` の gcn（4 → 5 infos）、`token-separator.integration.test.ts` の H3-World（`align-widened-gap` が 2 件）。Skill の `structured.md` の U-Net の例は、段を下げる gap が意図どおりであることを示す `alignGrowth: allow` を書き足した（`expect-render: fits` を保つ）。
