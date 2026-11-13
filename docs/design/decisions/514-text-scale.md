# 514: 文字の倍率（textScale）と画面向けプロファイル

## 背景

#509 の 16 回のうち 10 回で文字の大きさが問題になった。`sumi` テーマの文字は 7〜9pt に固定で、`themeOverrides` では変えられない。`presentation-16x9`（最小 14pt）と組み合わせると全ラベルが `profile/font-too-small` になり、エージェントは `target.minFontSize` を下げて「小さく描いて拡大して貼る」回避をした。README・ブログ・文書の図にはプロファイルがなく、`paper-double`（最小 7pt）で代用していた。

## 決定

### `figure.themeOverrides.textScale`

0.25 の倍数、0.5 から 4。省略は 1（テーマそのまま。`figureTheme` がテーマ自身を返すので、使わない図は 1 バイトも変わらない）。

`figureTheme` の最初の段階で、テーマのコピーの全レイヤー（`base` と全部品・全バリアント）に次を掛ける。

| 値 | 倍率の扱い |
| --- | --- |
| 文字サイズ | 倍率を掛け、0.5pt（D2 の 1 unit）に丸める。4pt 未満・50pt 超は範囲に収める |
| 線の太さ | 同じ倍率で 0.5pt に丸める。0 は 0 のまま（枠なしは枠なし）、正の値は 0.5pt 未満にしない。7.5pt が上限 |
| 角の丸み | 同じ倍率で 0.5pt に丸める。0 は 0 のまま |
| 矢じり | 掛けない。矢じりは辺の線の太さから決まるので、線と一緒に大きくなる |
| サブラベル・演算子・アイコン・チャット注釈 | 掛けない。ラベルの文字サイズから導くので、一緒に大きくなる |

色・破線・フォント・余白・間隔は変えない。

- 丸めを 0.5pt にそろえた理由: auto レイアウトは `stroke-width` と `font-size` を D2 の整数 unit で書く。線だけ 0.25pt に丸めると 1.75 倍などで内部エラーになった（structured だけが 0.25pt の線を扱える）。1 つの規則に統一した。
- 図が自分で書く長さ（`lineWidth`・`frameWidth`・要素の `lineWidth`・`cornerRadius`・mm の `iconSize`）は最終の値であり、倍率を掛けない。`themeOverrides.lineWidth` の「重いバリアントはテーマの通常幅との比を保つ」規則は、倍率を掛けたテーマに対して働くので、比は保たれる。
- 余白・間隔（gap, padding, margin, layerGap）は倍率に追従させない。これらはプロファイルの値で、プロファイルが文字の大きさと釣り合うよう決める（`presentation-16x9` は paper の 2 倍、`screen-doc` は 1.5 倍）。倍率に自動で追従させると、同じ図をプロファイルだけ替えて描いたときに間隔が二重に変わる。

### 自動の倍率は作らない

`textScale: auto`（プロファイルの最小に届く最小の倍率）は採らなかった。テーマの解決はプロファイルを知らない段階（`figureTheme`）が 4 か所にあり、明示の `target.minFontSize` と競合し、図の書き手が書いていない倍率で寸法が変わる。代わりに次を出す。

- `profile/font-too-small` のヒントに、図全体の文字をそのプロファイルの最小に届かせる倍率（0.25 刻み、サブラベルは 7/8 で切り捨てるので含める）を名指しする。例: `Set figure.themeOverrides.textScale: 2 ...`
- `sumi catalog` のテーマに `textScaleFor`（プロファイル ID → 倍率）を足す。最初の lint の前に、`sumi` × スライドが 2、`sumi` × `screen-doc` が 1.5 と分かる。テキスト表の PROFILES 列にも `with textScale: ...` として出す。サブラベルは基本ノードの文字サイズで見る（部品ごとの最小で見ると、サブラベルを使わない 7pt の部品に引きずられて過大になるため。図ごとの正確な検査は lint が行う）。
- Skill の手順 3 と `figure-format.md#text-scale` に、置き場所から倍率を選ぶ手順と「`target.minFontSize` を下げない」を書いた。

### プロファイル `screen-doc`

README・ブログ・文書ページ向け。最大幅 200mm（96dpi で約 760px。GitHub の README の本文幅に近い）、最大高さ 150mm（約 570px、画面 1 つに収まる縦横比の目安）、最小文字 10pt（約 13px。README の本文は 16px = 12pt）、`fit: scale` で縮めた後は 8pt。`sumi` の文字（8pt、エッジ 7pt、サブラベル 7pt）は 1.5 倍で 12 / 10.5 / 10pt になって最小を満たす。余白と間隔は paper の 1.5 倍（margin 3mm、layerGap 12mm、containerPadding 6mm、arrangeGap 6mm、groupPadding 12pt、nodePadding 10.5pt / 5pt）。

SVG は mm 単位の固有の大きさを持つが、画面ではページが列の幅に拡縮する。200mm はその「自然な幅」の目安で、実際の表示幅が違っても文字の比は保たれる。

### `fit` と `target` との関係

- `fit: scale` は幅を超えた図を縮めるだけで、拡大しない。倍率で大きくした図が幅を超えると `fit: scale` が縮め、文字は印刷後の大きさで `minScaledFontSize` と比べられる（`screen-doc` は 8pt）。したがって「倍率で大きくして、`fit` で縮める」と相殺する。幅が足りないときは、倍率を上げずにラベルを短くするか行を折る。
- `target.minFontSize` は検査の下限で、図を大きくしない。文字を大きくする手段は `textScale` だけ。
- 「印刷より大きく表示する置き場所を target で書けない」（#514 の最後の項目）は、`target` に表示倍率を足さない。表示の拡縮は SVG の viewBox がすでに担っており、Sumi が検査するのは最終の印刷寸法だからである。置き場所が決める文字の大きさは、プロファイルの最小と `textScale` で表す。

## 既存の図への影響

`textScale` を使わない図は変わらない（ギャラリー・examples・固定した論文再現のハッシュは同一）。既存のプロファイル（`paper-*`、`presentation-16x9`）の値も変えない。`screen-doc` は新しいプロファイルで、`compatibleProfiles` に現れる（`slides` のみ）。

## 検証

`src/render/text-scale.integration.test.ts`: 倍率 2 の `sumi` が `presentation-16x9` を満たすこと、SVG・PDF の文字・編集可能 PPTX の `sz` が 14pt 以上であること（auto と structured）、サブラベルの切り捨て、倍率 1 が無指定と同じ描画になること、不正な値の拒否、`screen-doc` の倍率 1.5。16:9 のスライドに置いた `sumi` の図を Chrome ヘッドレスで確認した。
