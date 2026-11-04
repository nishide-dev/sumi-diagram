# #356 添字を figure.target.minFontSize で判定する

## 背景

[#347](347-figure-target.md) は、数式の添字（基準の 0.7 倍）を `minFontSize` の error 対象から外し、
縮小した図だけを `geometry/script-too-small`（info）で知らせた。しかし投稿先の
「印刷時の文字は 7pt 以上」という規定は添字にもかかる。8pt のラベルの `$q_1$` は 5.6pt で印刷されるが、
縮小していない図では render も `lint --geometry` も何も報告せず、SVG の文字の大きさを調べて初めて気づけた。

## 決定

- 新しい geometry rule `geometry/script-below-target`（**warning**）を追加する。
  `figure.target.minFontSize` が**明示されたときだけ**働き、縮小の有無にかかわらず、
  添字の最終的な印刷サイズ（描画サイズ × 縮尺）が最小値を下回れば報告する。
- 位置つき: ラベルを持つ要素・文字ごとに 1 件、そのラベルの `path` で報告する。
  メッセージは最小の添字の最終サイズ（縮小時は縮小前と縮尺）、最小値、基準の文字の最終サイズを示す。
  hint は基準の文字を「最小値 ÷ 0.7」（0.5pt 単位で切り上げ）以上にすること
  （縮小時は縮小を減らすことも）と、添字を使わない書き方にすることを示す。
- ラベルと node の `sublabel` は別の文字として判定する。sublabel の添字は「sublabel」と呼び、
  `path` は `sublabel`、基準の文字の大きさは sublabel 自身（ラベルの 7/8）。両方が下回れば
  それぞれ自分の位置で 2 件報告する（`text-too-small` と同じ扱い）。
- 重さは warning。本文の `text-too-small`（error）より弱くする。添字を小さく組むのは組版の慣例であり
  （[§6.24](../phase1.md)）、error にすると従来の契約を壊す。一方、投稿規定は実際に適用されるので
  info では見落とされる。warning は `--max-warnings` で止められる。
- `geometry/script-too-small`（info）は、`minFontSize` を明示**しない**縮小図だけを扱う。
  明示時は `script-below-target` が代わりに報告し、同じ事実を info と warning で二重に出さない。
  `figure.target` や `minFontSize` がない図の診断は変えない。
- 空白だけの run は対象外。画像・アイコン（フォントなし）のラベルも対象外。

## 採らなかった案

- 添字を `text-too-small` の error にする: 契約を壊し、組版上の小さい添字を許してきた方針と衝突する。
- `script-too-small` の info を残したまま warning を足す: 同じ事実の二重報告になる。
- `script-too-small` を target 付きの縮小なしにも広げる: 位置が図全体（`figure.fit`）で、縮小なしの図では指す先がない。
  ラベルの位置が必要。

## 互換性と検証

`minFontSize` を使う既存の YAML はなく、`target` のない図は新しい rule も旧 rule も通らない。
`research/` と c-h3world を除く 103 YAML × 自身のテーマと組み込み 5 テーマ（618 試行）の
render の JSON 報告と SVG の sha256 を変更前後で比べ、すべて一致した。
`target.minFontSize` ありで縮小した図の添字の診断は、info の `script-too-small` から
warning の `script-below-target` に変わる（#347 のテストを更新）。
