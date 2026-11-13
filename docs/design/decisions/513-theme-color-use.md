# #513 テーマの色の使い方の目安と lint

## 背景

#509 の 16 枚はすべて `theme: sumi` だったが、色で 2 点がついた 4 枚（1A・4A・5A・7A）には「sumi らしくない」という所見がついた。1A は `filled` 25・`solid` 3、4A は blue・gray・orange・purple・red の 4 色相を使っていた。高得点の 1B・4B・6A・8B は灰色が主で、アクセントは 1〜3 色、`tinted` / `emphasis` を使っていた。テーマは色の値を決めるが、塗り方と色の数を決めないので、テーマを選んでも「そのテーマらしい」図にならなかった。

## 決定

- **目安の持ち方**: テーマに任意の `colorUse` を足す（`maxAccentTones`・`preferredVariants`・`heavyVariants`・`maxHeavyShare`）。スタイルは変えず、lint と `sumi catalog` だけが読む。`sumi` / `sumi-dark` は 3 / `tinted`・`outlined`・`emphasis` / `filled`・`solid` / 0.3。ほかのテーマは未設定で、挙動は変わらない。
- **IR**: ノードとグループが書いた `tone` を `ElementIR.tone` に持つ（lint が色相を数えるため。色から tone を逆引きすると、パレットや上書きで外れる）。
- **lint `geometry/theme-color-use`（info）**:
  - 色の数: `gray` 以外の tone の種類。アイコン・画像のノード、label / junction / separator / operator は除く。
  - 面の塗り: 有彩色の tone を持つ heavy variant のノードの bbox 面積 / 描かれるノードの面積。凡例の部品は除く。
  - メッセージは tone 名と variant 名、ヒントは直す先（使用回数の少ない tone を gray か残す tone へ、heavy を `tinted` へ）を書く。
- **重大度**: info。配色は好みと意図に左右され、`color-harmony`・`color-on-panel` も info である。warning にすると `maxWarnings` で図が落ちる。
- **しきい値**: #509 の決勝 16 枚で較べた。heavy の面積は 1A 76%、4A 92% で、1B・4B・6A・2A・3A・5A・7A・8A/B は 0%（6B は 3 ノードで 30% 未満）。色数は 1B・4B が 3 色（高得点）、4A が 4 色なので上限を 3 にした（「1〜2 色」は Skill の助言とし、lint は 3 まで許す）。そのため 1A は面の塗りで検出され、色の数では検出されない。examples と docs/assets の `sumi` を使う図は出ない。

## 採らなかった案

- 上限を 2 にする: 高得点の 1B・4B が出てしまい、受け入れ条件に反する。
- filled / solid の割合を灰色のノードも含めて数える: 灰色の `solid` はマスクなど小さな要点に使われ、土台の灰色は sumi らしい使い方である。
- 色の逆引きで tone を決める: パレット・`themeOverrides.tones` の図で外れる。
- warning: 上記。

## 互換性

`ElementIR` に任意の `tone` が増えるだけで、描画・SVG・example のハッシュは変わらない。`sumi catalog --json` の `themes[]` に `colorUse`（なければ `null`）が増える。
