# #395 吹き出し部品と本体・しっぽの境界

## 背景

チャットの発言と一般的な注釈を、既存の輪郭部品と同じ配置・出力・lint の経路で扱う。
operator の manifest／テーマ展開、bracket の曲線を分割した輪郭契約、zoom の
SVG → PDF／picture PPTX と editable PPTX の共通化を踏襲する。

## 決定

- `sumi/bubble`、`since: 0.16.0`。auto（D2/ELK）と structured の両方に対応する。
  variants は一般の塗れる形と同じ `default / emphasis / muted / filled / outlined / solid / tinted`。
  全組み込みテーマで定義する。default は白地の枠、filled と solid は枠なし。
  tone は既存の塗り／線／濃い塗りの解決をそのまま使う。
- `tail: left|right|top|bottom|none`。既定は `none`。一般の注釈・しっぽなしの発言にも使え、
  話者の左右を暗黙に決めない。チャットでは明示して左右を選ぶ。
- `tailAt: start|center|end|<length>`。既定は `start`。
  左右辺では本体の上、上下辺では本体の左から測る。`0`／`0pt` も可。
  角の丸みとしっぽの基部を避ける範囲にクランプする。
- `tailSize` は外への深さ（正の長さ、0.5pt 単位）。省略時はテーマの実効 fontSize の 0.6 倍、
  角半径は同 0.9 倍。投影用テーマでは文字とともに大きくなり、印刷では小さな wedge になる。
  小さな明示寸法では深さを横断寸法の 1/3、角半径を本体各辺の 1/4 以下に抑える。
- しっぽは外向きで少し始点側へ傾く短い wedge。戻り側は本体の辺へ接する三次曲線。
  四隅は 1/4 円を各16分割、しっぽの曲線は12分割し、既存の直線輪郭契約で
  **本体としっぽを1本の閉じた path** として描く。別の三角形を重ねないため継ぎ目がない。
  SVG・PDF・picture PPTX・editable PPTX はこの同じ path を使い、新しい backend は増やさない。
- 本体の外にしっぽを置き、全体が footprint に入る。自然寸法は padded label box に角の安全帯と
  しっぽの深さを足す。明示 `width / height` も全 footprint の寸法で、本体だけの寸法ではない。
  `safeArea` は本体の中に限定する。配置・経路探索の障害物・page bounds は全 footprint を確保する。
- `OutlineDrawing.portOutline` を任意で追加し、**辺の接続だけ本体の丸い輪郭**を使う。
  tip 接続は提供しない。D2 compose の延長、structured の port 射影・経路検査、editable PPTX の
  接続点も同じ境界を読む。省略時の挙動は従来どおり。しっぽのある側でも接続は本体上であり、
  基部と重なる anchor を選ぶと辺が自分のしっぽに重なり得るので、別の offset／辺を選ぶ。
- 衝突用 `outline` はしっぽ込みの silhouette、既存 lint の凸包を使う。
  node-overlap、edge-through-node、label-collision はしっぽを含む保守的な領域で検査する。
  角丸やしっぽ脇の未塗り部分に対しても保守的になる点は既存 outline と同じ。
- `maxWidth` は文字列の折り返し幅（既定120pt）。明示幅があればしっぽ・角の安全帯・profile の
  padding を引いた幅にも制約する。実効フォントセットの TTF advance と既存 `measureText` で
  Latin／BIZ UD Gothic の幅を測り、英単語の境界と和文の分節で折り返す。
  長い単語は grapheme 単位に分割し、基本的な行頭／行末禁則を守る。明示改行を保ち、
  `$...$` は途中で分けない（幅より長い不可分の数式や1文字は幅を超え得る）。
  折り返しは bubble の IR label だけを変え、既存部品の文字処理を変えない。
- 内容は文字。画像専用の props は増やさず、画像は既存 `image` ノードで組み合わせる。
  画像を内包する複合コンテンツは今回は追加しない。

## 採らなかった案

- 本体と三角形を別々に描く案: 枠線の継ぎ目が出る。
- しっぽを footprint 外へ後描画する案: 隣の要素・ページ端との衝突が配置時に見えない。
- tip を通常の port にする案: tailAt の変更で辺の位置が変わり、本体を示す接続と混同する。
- 輪郭契約に backend ごとの曲線コマンドを追加する案: bracket と同じ分割手法で十分な品質になり、
  幾何 lint と editable PPTX の別実装を増やす必要がない。

## 検証と互換性

- 四方向＋なし、位置・極端な寸法の輪郭契約、各テーマ×variant と tone、和文と英文の折り返し、
  明示幅、余白ゼロの配置、しっぽ上の衝突・辺・ラベル、ページ幅への寄与を回帰テストで固定する。
- 両 layout で PDF と picture／editable PPTX を変換し、閉じた図形・文字とベクター出力を検査する。
- ギャラリーに全 variant・全しっぽ方向・英語／日本語を追加する。
  CLI で PDF を描き `pdftoppm -png` の画像を開いて、しっぽと和文を目視する。
- 変更前後に対象の全 YAML を自テーマ＋全組み込みテーマで描き、SVG／PDF／PPTX／D2 の sha256 を比較する。
  research/ と private figures は除外する。比較結果は PR 本文に記載する。
  カタログ追加により未知の node の hint の一覧に bubble が増える。
- 比較対象は102図×（自テーマ＋6テーマ）=714組。描画成功478組の SVG／PDF／picture PPTX と
  D2 ソース252件の sha256 が全件一致し、描画できない236組の error code も一致した。
  既存の図で描画出力が変わったものはない。
- `CI=1 bun run test` は research/ と private figures を参照するファイルを除外した146ファイルで
  4,722 pass／0 fail。Biome も同じ除外を一時設定して検査し、設定はコミットに含めない。
  typecheck、gallery:check、schema:check も成功。schema:gen の再実行で汎用 Figure Schema の
  出力は不変（部品固有 props はカタログの JSON Schema に追加される）。
