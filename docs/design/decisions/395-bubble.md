# #395 吹き出し部品と本体・しっぽの境界

## 背景

チャットの発言と一般的な注釈を、既存の輪郭部品と同じ配置・出力・lint の経路で扱う。
operator の manifest／テーマ展開、bracket の曲線を分割した輪郭契約、zoom の
SVG → PDF／picture PPTX と editable PPTX の共通化を踏襲する。

## 決定

- `sumi/bubble`、`since: 0.15.2`。auto（D2/ELK）と structured の両方に対応する。
  variants は一般の塗れる形と同じ `default / emphasis / muted / filled / outlined / solid / tinted`。
  全組み込みテーマで定義する。default は白地の枠、filled と solid は枠なし。
  tone は既存の塗り／線／濃い塗りの解決をそのまま使う。
- `tail: left|right|top|bottom|none`。既定は `none`。一般の注釈・しっぽなしの発言にも使え、
  話者の左右を暗黙に決めない。チャットでは明示して左右を選ぶ。
- `tailAt: start|center|end|<length>`。既定は `start`。
  左右辺では本体の上、上下辺では本体の左から測る。`0`／`0pt` も可。
  基部が収まる範囲にクランプする。左右の文字列 start だけが上角の円弧に小さな thorn を付ける。
  数値（0を含む）と center／end、および上下は辺上の小さな対称 wedge にする。
- `tailSize` は外への深さ s（正の長さ、0.5pt 単位）。角半径 r はテーマの実効 fontSize の
  1.75 倍とし、1行の自然寸法では高さの約0.45倍になる。既定深さの絶対値は維持し、
  fontSize の左右 start で0.33倍、その他の左右で0.55倍、上下で0.66倍。
  長文で高さが増えても同じ絶対寸法を維持する。小さな明示寸法では深さを横断寸法の1/3、
  角半径を本体各辺の0.49倍以下（上下・左右の他位置は従来どおり0.4倍以下）に抑える。
  完全な半円にせず短い直線を残すことで、極小寸法でも円弧の端点が重複しない。
- 左右 start は四隅の丸みを残し、上角円弧の中間区間だけに付く小さな thorn。
  左側の tip は (x0−s,y0+0.6s)。上の接合点は円弧上の y0+0.23r
  （上端から約40°、x0+0.362r）、下の接合点も円弧上の y0+0.7r（x0+0.046r）。
  右側は正確な鏡像。上辺から上の接合点までは通常の円弧を維持する。
  両接合点の制御点は円弧の接線方向に置き、上側に小さな凹の谷を作る。
  上側全体の単調性・凸性は要求しない（3回目レビューの参照解釈を撤回）。
  tip だけを鋭くし、下側は凹曲線で円弧へ戻す。予約領域は張り出し s だけ。
  その他の位置の wedge は基部幅が約r、両側が凹曲線で辺と接線連続。
  往路・復路とも三次曲線とし、tip だけを鋭くする。
  corner を描き終わってから wedge を挿入せず、周長上の区間を置換するため
  内向きの段差や逆走がない。四隅は 1/4 円を各16分割、しっぽの曲線は各32分割し、既存の直線輪郭契約で
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
  `\$` と数式内部のエスケープは label parser と同じ規則で認識し、計測・禁則の
  後退でも分割しない。後退した残りも幅に収め直し、単語境界で禁則を満たせない場合は
  単語内で分割する。禁則と幅の両立が不可能な場合は幅を優先する。
  折り返しは bubble の IR label だけを変え、既存部品の文字処理を変えない。
- 文字は既存 `nodes[].textAlign: left|center|right` を再利用し、bubble の既定だけ `left`。
  structured は既存の文字ブロック配置、auto は outline compose 時に最長行の左端へ
  anchor と tspan を移す。bubble に限り auto でも明示指定を許可する。
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
  typecheck、gallery:check、schema:check も成功。初回追加時の schema:gen では汎用 Figure Schema の
  出力は不変（部品固有 props はカタログの JSON Schema に追加される）。
- しっぽと文字揃えのレビュー修正後、除外設定なしで `CI=1 bun run test` を実行し、
  174ファイル、5,352 pass／13 skip／0 fail。`bun run check`（既存 research の warning のみ）、
  typecheck、schema:check、gallery:check も成功。Figure Schema の `textAlign` 説明を
  bubble の auto 対応と既定左揃えに合わせて再生成した。
- `bun run gallery` と `SUMI_UPDATE_GOLDEN=1 bun run test src/render/pdf src/render/pptx`
  のみで golden を再生成。変更した描画 golden は bubble の6テーマ分だけ。
- `.sumi/preview/bubble.pdf` を `pdftoppm -scale-to 3200 -png -singlefile` で再ラスタライズし、
  4800px の拡大 crop も開いた。左右 hook・上下の凹曲線・和文2行の左揃えと余白を目視確認した。
- 2回目のレビューでは参照の左右 crop と実際のプレビュー crop を本体高さ288pxに揃え、
  縦横比を維持して `.sumi/preview/bubble-tail-comparison.png` に並べた。
  半径を1行本体高さの約0.34倍へ調整し、上角だけの horn・直線の上辺・側面への戻りを比較した。
  周長の剰余が浮動小数誤差で一周分になる場合を0へ正規化し、平行移動による端点の脱落も防ぐ。
  四方向の center／end は `.sumi/preview/bubble-positions.png` で目視確認した。
  最終の除外なし全テストは174ファイル、5,352 pass／13 skip／0 fail。
  check・typecheck・schema:check・gallery:check も成功。golden 更新は上記の文書化されたコマンドのみ。
- 4回目レビューでは `.sumi/ref/chat.png` の最初の左発言を本体高さ72pxのまま切り出し、
  production renderer の輪郭（r=35、s=5）を同じ座標へ4倍 supersampling で描画。
  ImageMagick の50% blendで重ねて目視し、行ごとの白領域の始点も比較した。
  上の接合点を約45°から約40°へ微調整し、谷の合流は参照y=20に対しy=21、
  上端・円弧・下側・側面の白領域始点は概ね1px以内になった。
  `.sumi/preview/bubble-reference-overlay.png` と `bubble-tail-comparison.png` に保存。
- 4回目レビューの最終検証は `CI=1 bun run test` が174ファイル、5,353 pass／13 skip／0 fail。
  check（既存13 warning／1 infoのみ）・typecheck・schema:check・gallery:check（283ファイル）も成功。
  文書化された gallery／PDF／PPTX の golden 更新コマンドで再生成し、806 pass／0 fail。
  描画の変更は追加した bubble の6テーマ分だけ。
