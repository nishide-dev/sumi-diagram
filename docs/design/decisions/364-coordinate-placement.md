# #364 structured arrange の座標配置

## 背景

GCN の入力・出力グラフのように、同じ頂点配置を異なるグループで繰り返したい。
grid では分数位置を表せず、空セルで余白が増える。頂点を独自の複合部品にすると
既存のラベル・tone・attach・辺・geometry lint の契約を再実装する必要がある。

## 決定

- arrange の第4の箱を `place` とする。`place: { unit: 6mm, items:
  [{ item: a, at: [1.5, -1] }, ...] }`。`item` は通常のノード／グループ ID、
  または再帰的な arrange 箱。既存の所属推論・一意配置チェックをそのまま通す。
- `unit` は正の mm/cm/in/pt 長。省略・ゼロ・負・裸の数値は schema error。
  座標は有限な数の2要素 tuple。分数・負座標を許容する。負座標は局所座標系の
  選び方にすぎず、原点からの空白は予約しない。共通の長さ上限と同じく、座標×unit
  の絶対値は100000pt以下とし、乗算の overflow や誤記による巨大な図を拒否する。
  JSON Schema の unit pattern と tuple も生成する。unit と座標の積の上限は
  フィールド間の検証なので実行時に検査する。
- 座標は要素の中心、y は下向き。pt に正規化し、レイアウト内部の0.5pt単位へ
  **丸めず**変換する。最終座標の既存の1/1000内部単位への丸めだけを適用する。
  バッジ／caption のある要素は本体中心を固定し、その張り出しも footprint に含める。
  通常の入れ子箱は箱の中心を固定する。
- 箱の自然寸法は配置した全 item の自然 footprint の外接矩形。原点への固定や
  grid の最小セル間隔、衝突回避のための自動移動を行わない。同じ unit と座標を
  書けば、ラベル幅やグループ寸法が異なっても中心間のベクトルは同じになる。
- 親の stack/row/grid は通常の item として配置する。親から大きい領域を割り当て
  られた場合は、形を拡大・変形せず領域の中央に置く。place 自身は align/justify/
  gap/centerOn を持たない。親の align と centerOn は従来の契約を維持する。
  attach は従来どおり対象と同じコンテナの overhang に加算する。
- cross-tree align は既存 solver を利用する。place 内部には strut を挿入せず、
  外側の stack/row を通して箱全体を動かせる場合のみ合わせる。満たせない制約は
  既存の `layout/unsatisfied-align` warning で報告し、座標を変えない。
- 自然 footprint が正の面積で重なれば render 時の `layout/place-overlap` warning。
  計算上の誤差を除くため各軸0.001内部単位以下の接触は許容する。両 item の位置と
  YAML の `at` の位置を Diagnostic / related に記録する。警告のみで描画を続ける。
  未知 ID は `layout/unknown-item`、重複は `layout/duplicate-placement`、
  unit／座標不正は共通 schema Diagnostic。独自のエラーフォーマットを追加しない。
- 頂点と辺は既存の IR と描画経路を使う。`line` + `route: straight` は無向の
  直線として輪郭で切られ、他の頂点を通る辺には既存 geometry lint が発火する。

## 採らなかった案

- グラフ専用 component: 通常要素の描画・参照・lint を再利用できない。
- grid の空セル／span による近似: 配置の分解能に依存し、同型性と密度が安定しない。
- 固定 canvas と絶対座標: 親の arrange や group padding と合成しにくく、原点までの
  不要な余白が生まれる。
- 衝突回避や親の stretch に応じて座標を変形: 入力・出力で同じ形にする目的に反する。

## 互換性と検証

新しい箱の分岐だけを追加し、既存 stack/row/grid の寸法・経路・SVG を維持する。
既存 YAML（research/ と名前に c-h3world を含むものを除く）を自身の theme と全
組み込み theme で変更前後に描画し、SVG/PDF/PPTX/D2 の SHA-256 を比較する。
既存の不正 fixture は共通 error code を比較し、出力を捏造しない。

回帰テストは分数／負座標、異なる寸法、原点移動の不変性、入れ子、親 stretch、
2つの caption 付き group、attach、未知／重複 ID、不正な unit／tuple／overflow、
接触と重なりの位置情報、満たせない align、fmt、全 theme での4頂点と無向直線辺、
頂点を貫く辺の geometry lint を検証する。Skill の fits 作例とローカルの GCN を
CLI で PDF にし、pdftoppm の PNG で目視確認する。ローカル GCN はコミットしない。

実測: 変更前の104 YAML ×（自身の theme ＋ 組み込み5 theme）=624通り。
417通りを描画・hash 化し、207通りは既存の不正 fixture／theme-profile 制約等で
error を返した。ローカル GCN の6通りだけが意図して変わり、それ以外の411通りの
成功出力は4形式ともバイト一致、207通りの error code も一致した。新しいローカル
fits 作例の6通りは追加として比較から分離した。gallery の237ファイルも変更なし。
全テストは4700 pass / 13 skip / 0 fail。元の配置 engine を差し込んだ検証では
分数座標と重なり位置の2回帰テストが失敗することを確認した。

GCN の最終手動チェックは、slides の大きい文字でも重ならないよう両側とも unit を
8mm に揃えた。paper では115.18 × 45.68mm（元の grid は108.48 × 42.33mm）、
全5 theme の PDF preview を目視し、0 error / 0 warning を確認した。paper 等の
group-empty-area info は配置したグラフとラベル欄の意図した空白なので保持した。
