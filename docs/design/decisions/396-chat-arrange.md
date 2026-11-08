# #396 会話を並べる chat 配置

## 背景

`bubble` (#395) の輪郭・和文／英文の折り返しを使い、会話だけを書けば左右の発言、
時刻・既読、日付区切り、同一話者の連投を並べられるようにする。
既存の stack / row / grid と、剛体として配置する place (#364) の検証・IR・寸法計算を踏襲する。

## 決定

- 第5の arrange 箱を `chat` とする。ルート、グループ、入れ子のどこでも使用できる。
  `width` は正の物理長。省略時は profile のページ幅から margin と1グループ分の padding を引く。
  `maxWidth` は `(0, 1]` の列幅比率または正の物理長、既定は `0.7`。
  比率と長さは正規化後も区別し、`0.5pt` を比率と誤認しない。
- `speakers` は話者 ID → `{ side: left|right, avatar?, tone?, variant? }`。
  `items` は `{ node, from, meta? }` または `{ divider: text }`。
  `meta` は文字列または文字列の配列。明示改行と配列の各行を積む。
- 本文は通常の `bubble` ノードを参照する。`text:` から本文ノードを生成する案は採らない。
  ID、ラベル、props、tone、辺の端点、ソース位置を既存経路で扱え、本文の二重定義を避けられる。
- 同一話者が隣接する間を run とする。divider は run を切る。
  先頭は話者側の `tail` と `tailAt: start`、連投は `tail: none`。
  しっぽの有無で本体の端がずれないよう、連投にも horn の幅を予約する。
  明示幅が小さい場合は renderer と同じく幅の1/3に clamp した実効 horn 幅を使う。
  文字は左揃え。話者の tone / variant は本文に明示指定があればそちらを優先する。
  明示 `variant: default` も上書きしない。省略時は左が白い default、右が gray / filled。
  green などの指定もテーマの tone で解決し、アプリ固有の色を持ち込まない。
- 最大幅は文字だけでなく bubble の自然 footprint に対する上限とする。
  角の安全帯・しっぽ・padding と丸めの余裕を引いて既存の折り返し関数へ渡す。
  sublabel も同じ幅を実際の小さい文字サイズで折り返す。
  chat の maxWidth は既定値を含めノードの props.maxWidth に優先する。
  明示 width / height は通常ノードと同じく保持する。不可分の数式などが幅を超える場合は
  輪郭を潰さず、列の overflow を診断する。
- chat 内の本文は会話に適した寸法にするため、profile の左右 node padding の半分、
  上下の追加 padding は0、角の安全帯の基準は実効 fontSize の1.4倍とする。
  通常の bubble の寸法・輪郭契約は変更しない。
- avatar は既存ノード ID。run 先頭の bubble の上に揃え、同じ話者の連投もその幅と gap を予約する。
  初回は元のノードを使い、次の run から通常のノードとして複製する。
  元の avatar ID への辺は初回だけに接続し、複製への辺の複製・付け替えは行わない。
  右話者も明示 avatar があれば対応し、省略なら予約しない。
- meta は muted label、divider は gray / filled の小さい bubble（しっぽなし）に展開する。
  両者の文字サイズはテーマの小さい注記（edge の既定サイズ）、文字色は muted label と共通。
  divider は列の中央、左右 padding は通常の半分、上下 padding は0、安全帯の基準は1em。
  meta は bubble の内側の横に置き、下端を揃える。右発言の注記は右揃え、左発言は左揃え。
  複数行の meta が本文より高いときも、行全体の高さを予約する。
  avatar の上端と meta の下端は badge を除く本体矩形に揃え、行間・衝突回避には
  badge を含む footprint 全体を予約する。
- profile の実効 arrangeGap を G とし、異なる話者／divider の前は G/2、連投は G/4、
  avatar と meta の横 gap は G/4。compact と slides の倍率も同じ経路で適用する。
- 展開した各要素は通常の component / asset / theme / profile / geometry lint / export を通す。
  meta を SVG だけに後描画しない。page bounds、衝突、辺の障害物にも含まれる。
  会話要素には接続辺が必須ではないため `lint/no-edges` のノード数から除外する。
  本文は自動折り返しするため `lint/long-label` のソース1行幅のヒューリスティックを適用しない。
  明示改行の行数上限と、描画後の geometry lint は維持する。
  内部 ID は `chat-<箱番号>-<item番号>-meta|divider|avatar` を予約し、衝突は `ref/reserved-id`。
  展開元を sourceMap に保持する。
- chat は place 同様に剛体で、親の余剰領域では全体を中央に置く。
  列幅自体もページ寸法へ寄与する。cross-tree align は外側の stack / row を動かせる場合のみ満たす。

## 診断

- 未知話者: `layout/chat-unknown-speaker` (error)、`from` の位置。
- 未知本文 ID: 既存の `layout/unknown-item` (error)。二重配置・所属不一致も既存の診断。
- 未知 avatar ID: `layout/chat-unknown-avatar` (error)、話者の `avatar` の位置。
- 本文が bubble 以外（グループを含む）: `layout/chat-non-bubble` (error)。
  警告で配置を続けると horn／折り返しの契約を満たせないためエラーとする。
- 本文・avatar・meta・divider が列幅を越える: `layout/chat-overflow` (warning)。
  配置は保持し、幅を広げる／maxWidth を下げる／注記を短くするヒントを出す。
- 不正な寸法・フィールドは schema の既存診断、auto エンジンでの使用は `layout/structured-only`。

## 互換性と検証

既存 arrangement の分岐と通常 bubble の計測は維持する。カタログは component / theme /
profile 等の一覧で arrange を列挙しないため、chat は Figure JSON Schema と Skill で説明する。

回帰テストで左右、run、horn／avatar の省略と複製、本文の明示スタイル優先、
meta の下端と複数行、divider の中央・run リセット、和文／英文の最大幅、
物理長と比率、ルート列幅、入れ子と所属、未知参照と不正型、overflow を検証する。
SVG → vector PDF、picture / editable PPTX でも和文・英文・注記と輪郭を検査する。
全組み込みテーマを通し、meta の衝突とページ幅への寄与も固定する。

互換性比較では research/ と private figures を除外し、変更前の102図を自テーマと
全6組み込みテーマ（714通り）で描画、SVG / PDF / PPTX / D2 の SHA-256 と失敗時の
error code を比較する。追加プレビューは `.sumi/preview/` に置き、examples には追加しない。
参照の日本語5発言、今日、初期文字 avatar を再現し、CLI の PDF を pdftoppm で PNG にして
`.sumi/ref/chat.png` の会話領域と比較する。

実測では、既存478成功条件の SVG / PDF / picture PPTX と D2 252件が全件バイト一致し、
236失敗条件の error code も一致した。既存図の出力変更はなく、gallery の283ファイルも不変。
除外対象を参照するテストファイルを外した `CI=1 bun run test` は149ファイル、
4,744 pass / 0 fail。追加16テストの最終実行も成功した。
check / typecheck は除外設定を一時適用して成功し、schema:check / gallery:check も成功。
除外設定はコミットに含めない。

プレビューは `.sumi/preview/chat.pdf` を pdftoppm で1600pxの PNG にし、
参照の会話領域と同じ列幅で `.sumi/preview/chat-comparison.png` に並べて目視した。
初回の高さが大きすぎたため chat 専用の padding を縮め、最終83.96 × 59.09mmで
本文5発言・連投の省略・Y avatar・日付・下端の注記を確認。geometry を含む lint は0件。
