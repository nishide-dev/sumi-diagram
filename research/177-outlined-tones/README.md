# #177 tone の枠線（`variant: outlined`）と辺の `tone` の確認

[Issue #177](https://github.com/nishide-dev/sumi-diagram/issues/177)、設計 [§6.54](../../docs/design/phase1.md#654-177-の-tone-の枠線variant-outlinedと辺の-tone)、調査 [#167 §4.5](../../docs/research/167-stage-c.md)（C-2・C-9）。

#173 の H3-World の図（[`research/173-paper-theme/figures/c-h3world.sumi.yaml`](../173-paper-theme/figures/c-h3world.sumi.yaml)、変更しない）から、原図で色の枠線・色の文字・色の線になっている箇所だけを新しい構文に書き換え、原図と同じ色の配置で描けることを確かめる。原図そのもの・切り出し・文言はリポジトリに入れていない（利用者自身の未公開の図で、見た目の特徴だけを書く）。

## 構成

| パス | 内容 |
| --- | --- |
| `render.ts` | #173 の図を読み、下の書き換えをして `figures/c-h3world.sumi.yaml` を書き（書き換えごとに一致の数を検査）、`paper` と `--theme color` で PDF → PNG（200dpi）→ 64 色のプレビューを書く |
| `figures/c-h3world.sumi.yaml` | 生成物（手で編集しない） |
| `figures/assets/` | #167 の仮のフレーム画像 5 点の複製（原図の画素ではない。画像の `src` は図のディレクトリの外を指せない） |
| `previews/c-h3world.png` | `paper` で描いた図 |
| `previews/c-h3world.color.png` | 同じ YAML を `--theme color` で描いた図 |

## 書き換え（原図の色の配置）

| 要素 | 原図 | 書き換え |
| --- | --- | --- |
| H3 Encoder（6 個） | 白地・紫の枠・紫の太字 | `tone: purple, variant: outlined` |
| Visual VAE Encoder | 白地・橙の枠・橙の文字 | `tone: orange, variant: outlined` |
| キー（45 個） | 左の塊（W・A・S・D）は橙の枠と文字、右の塊（I・F・J・K・L）は青の枠と文字。押したキーは橙・青の塗り | 押していないキーは塊の色の `outlined`、押したキーは元の tone のまま `variant: filled` |
| (a) のトークン列（14）・(b) のトークン列（9） | Static・I0・Pad は灰の枠と文字、A は紫、V は橙 | 1 セルずつのノードを `component: tokens`（#181）にし、`props.variant: outlined`、セルの tone は gray・purple・orange |
| フレーム → VAE → V… の辺 | 橙の線と矢じり | `tone: orange` |
| LoRA → ⊕ の辺（2 本） | ピンクの線 | `tone: pink`、`toAnchor: north` |
| QKV / Out Proj. → ⊕ の辺（2 本） | 青の線 | `tone: blue`、`toAnchor: south` |

⊕ に入る 2 本は原図どおり上と下から入れた。同じ点に入る（`fanIn: merge`）と、違う色の線が重なって縞に見える（設計 §6.54 の注意）。

## 結果

| Theme | 幅 | 縮小率 | 診断（error / warning / info） |
| --- | --- | --- | --- |
| paper | 180mm（自然な幅 230.4mm） | 0.7814 | 0 / 0 / 1（`script-too-small`） |
| color | 180mm（自然な幅 232.5mm） | 0.7743 | 0 / 0 / 1（`script-too-small`） |

縮小率・診断は #173 の図と同じ（`lint --geometry` の warning 90 件（行列の `lint/empty-label`）も同じ）。トークン列を tokens にしても配置は変わらない（#181 の確認と同じ）。

- 原図と同じ位置に同じ色が出る: 紫の枠と文字の Encoder、橙の枠と文字の VAE と V のセル、紫の A のセル、灰の Static・I0・Pad、橙・青の枠のキーと塗りの押したキー、橙の辺（VAE への引き込みと V… への辺）、ピンク・青の ⊕ への辺。
- 残る差（この Issue の対象外）: Encoder と A のセルは原図では淡い紫の塗り＋紫の枠（`outlined` は白地。塗りと色の枠は同時に選べない）、Encoder・VAE の文字は原図では太字、押したキーは原図では濃い橙・青の塗りに白い文字（`filled` はパステルの塗りに黒い文字）、行列の列・行の見出しの色の文字（label の色、#167 §4.9）、⊕ の塗りと白い ＋。

## 再現

```sh
bun install --frozen-lockfile
bun research/177-outlined-tones/render.ts
bun src/cli/index.ts lint --geometry research/177-outlined-tones/figures/c-h3world.sumi.yaml
```

環境: macOS 26.2 / arm64、Bun 1.3.14、基点 main `7aeb996`（#205・#208 を含む）、Poppler 26.04.0、ImageMagick 7.1.2。`out/` は無視される。プレビューの PNG は ImageMagick がメタデータを書くため、再生成でバイトが変わることがある（画素は同じ）。
