# #19 ベクター PDF / 編集可能 PPTX 出力の評価

- Issue: [#19](https://github.com/nishide-dev/sumi-diagram/issues/19)（親: #1、関連: #11・#13）
- 調査日: 2026-10-18 / 環境: macOS 26.2（arm64）、Sumi v0.1.0 相当の `main`（D2 v0.9.0、`sumi/biz-ud-gothic`）
- PoC と再現手順: [`research/19-pdf-pptx/`](../../research/19-pdf-pptx/README.md)（結果の抜粋は `research/19-pdf-pptx/results/`）

## 0. 結論

1. **PDF は svg2pdf（typst 系の Rust ライブラリ）を WASM にして Sumi に組み込む方式を推す。** 調べた変換器のうち、(1) ページが SVG の pt サイズと一致し、(2) 文字が同梱フォント（BIZ UDPGothic）のサブセット埋め込みの文字として残り、(3) 全体がベクターのまま（ラスタ画像 0）で、(4) バイト単位で決定的（2 か所の小さなパッチ後）だったのは svg2pdf だけだった。WASM（2.37MB、gzip 0.81MB）は `bun build --compile` のバイナリに埋め込め、そのバイナリから同じ PDF を出力できた。ブラウザ・ネイティブの追加バイナリ・プラットフォームごとの配布物は増えない。
2. **PPTX は 2 段階に分ける。** まず (a) 「SVG 画像＋PNG フォールバック」の 1 枚画像を出す（忠実で保守が軽い。ただし編集はできない）。(b) ネイティブ図形への展開は、**「図形と文字が個別に選択・編集できる」までを保証範囲とし、「元と同じ見た目で、自由に再配置しても経路が保たれる」ことは保証しない**別機能（実験的）として扱う。PowerPoint は自由形状のコネクタを受け付けず（PoC で確認）、ELK の経路を保つと接着できず、接着すると経路が直線に変わるため、両立できない。
3. 優先順位は **PDF（svg2pdf/WASM） > PPTX (a) 画像 > PPTX (b) ネイティブ（実験的）**。PPTX (a) の PNG フォールバックにはラスタライザが要るため、PDF と同じ WASM に resvg を同梱する方向で一緒に設計するとよい。

## 1. 前提と制約

- 配布: プラットフォームごとの単一バイナリ（`bun build --compile`）＋同梱の D2・フォント（設計 §6.8）。Node.js・Bun・ブラウザは不要。新しい依存はこれを崩してはならない。
- 決定性: 同じ入力・同じ版から同じバイトを出す（SVG は既に OS を問わずバイト一致。設計 §6.7）。
- フォント: 日本語は同梱の BIZ UDPGothic で描く。閲覧側・変換側のフォントに依存しない（設計 §4.2・§6.3）。D2 は WOFF のサブセットを `@font-face`（`data:` URL、図ごとの family 名 `d2-<hash>-font-regular` 等）で SVG に埋め込み、class で選んでいる。
- 物理サイズ: root の `width` / `height` は pt（1 D2 unit = 0.5pt。設計 §5.1）。
- 用途: 論文（LaTeX の `\includegraphics` 用のベクター PDF）、スライド（PowerPoint / Keynote / Google Slides）。

## 2. 方法

- 入力: `examples/system-architecture`（グループ・破線グループ・六角形・円柱・文書・両矢印・破線エッジ）、`examples/decision-flow`（ひし形・平行四辺形・楕円・エッジラベル・ループ・ラベルのみのノード）、検証用の `research/19-pdf-pptx/figures/ja-review.sumi.yaml`（日本語・太字のグループラベル・2 行ラベル・日本語のエッジラベル・破線・両矢印）。いずれも通常の `renderFigure()` で描画した SVG（`sumi render` とバイト一致）を変換した。
- 各 PDF について次を計測した（`scripts/pdf.ts`）:
  - 決定性: 1 秒以上空けて 2 回変換し sha256 を比較。`SOURCE_DATE_EPOCH=0` でも同様に 2 回。
  - ページサイズ（`pdfinfo`）と、SVG の pt サイズ（`inspectSvg()` の canvas）との差。
  - フォント（`pdffonts`）: 埋め込み・サブセット・種類。ラスタ画像の有無（`pdfimages`）。
  - 文字の位置: `pdftotext -bbox-layout` の各行の箱と、Sumi の幾何 lint が同梱 TTF で計測した行の箱（`measureLabel()`、pt に換算）の差（x・幅・上端の最大値）。
  - 見た目: ヘッドレス Chrome で元の SVG を 144dpi でスクリーンショットしたものを基準に、PDF を `pdftoppm -r 144` でラスタ化し、25% を超えて異なる画素の割合（アンチエイリアスは許容）。
- PPTX は OOXML を自前で生成し（依存なし）、macOS の PowerPoint で開いて PDF に書き出し、同じ検査をした（`scripts/validate-pptx.ts`）。PowerPoint 上で図形を移動する操作も AppleScript で試した。

## 3. SVG → ベクター PDF

### 3.1 比較表

| | svg2pdf PoC（ネイティブ / WASM） | svg2pdf-cli 0.13（そのまま） | rsvg-convert 2.63（librsvg/cairo） | Inkscape 1.4.4 | Chrome 155 headless print | pdf-lib 等で自作（JS） |
| --- | --- | --- | --- | --- | --- | --- |
| ライセンス | MIT / Apache-2.0 | 同左 | LGPL-2.1+（cairo: LGPL/MPL、pango・glib 等多数） | GPL-2.0+ | BSD＋多数 | MIT（pdf-lib・fontkit） |
| 配布の形 | WASM 2.37MB（gzip 0.81MB）をバイナリに埋め込み。ネイティブなら 1.9MB の追加バイナリ | 4.5MB の追加バイナリ | 共有ライブラリ群（glib・pango・cairo・harfbuzz・fontconfig…） | アプリ一式（数百 MB） | ブラウザ一式（制約に反する） | npm 依存（pdf-lib 19MB unpacked、@pdf-lib/fontkit 4MB） |
| ページ = SVG の pt | ✓（`dpi: 96` が必要。既定の 72 では 4/3 倍になる） | ✗ 4/3 倍（CLI の既定 dpi 72） | ✓ | ✓ | ほぼ（445.92 × 204、168.96 × 424.08。CSS px への丸め） | 自前で決める |
| 同梱フォントで描く | ✓（フォント DB に同梱 TTF だけを入れる） | ✗ システムフォント（Times / Arial Unicode に置換） | ✗（macOS では Pango が CoreText を使い fontconfig を無視して Helvetica / ヒラギノに置換。Linux では fontconfig 経由で同梱 TTF を使える見込み・未検証） | ✓（`FONTCONFIG_FILE` で同梱 TTF だけを見せた） | ✓（`@font-face` の WOFF をそのまま使う） | 自前で TTF をサブセット |
| `@font-face` の WOFF を読む | ✗（family 名の書き換えが必要: §3.2） | ✗ | ✗ | ✗ | ✓ | — |
| 文字が文字のまま（抽出・検索可） | ✓ CID TrueType、サブセット | ✓ | ✓（一部 Type 3） | ✓ | ✓ | 実装次第 |
| ラスタ画像 | **0** | 0 | 16〜18 個（D2 のラベル用 mask を **72ppi** で画像化） | 同左（72ppi） | 16〜18 個（mask を 300ppi で画像化） | 実装次第 |
| 文字位置の差（x / 幅 / 上端、最大） | **0 / 0 / 0 pt** | 47〜130pt（サイズ違い＋代替フォント） | 3〜6 / 6〜12 / 0.9pt（代替フォント） | 0 / 0 / 0.01pt | 0.01 / 0.04 / 0.02pt | — |
| 画素差（Chrome 基準） | 0.30〜0.64% | 3.9〜5.4% | 0.5〜1.3% | 0.12〜27%（下記） | 0.30〜0.81% | — |
| 決定性（2 回 / `SOURCE_DATE_EPOCH`） | ✓ / ✓（パッチ後） | ✗ / ✗ | ✗ / **✓**（cairo が対応） | ✗ / ✗ | ✗ / ✗（CreationDate） | 実装次第 |
| 描画の欠陥 | なし（矢印・破線・mask・円柱・文書の曲線とも一致） | フォントとサイズ | フォント | `fill="transparent"` を黒で塗る（グループが黒く潰れる）、一部の矢印（marker）が欠ける | なし | — |

数値は `results/pdf-report.json`、比較画像は `results/pdf-system-architecture.png`・`results/pdf-ja-review.png`。

### 3.2 所見

- **ブラウザ以外の変換器は `@font-face` を読まない。** D2 の SVG はフォントを `d2-<hash>-font-regular` という図ごとの family 名と WOFF の `data:` URL で指定しているため、そのまま渡すとシステムの代替フォントで描かれる（svg2pdf-cli の結果が Times New Roman / Arial Unicode MS になったのはこのため）。PoC では変換前に class の規則を実名（`"BIZ UDPGothic"` と `font-weight: 400 / 700`、mono は `"BIZ UDGothic"`）に書き換え、`@font-face` を除いた（`scripts/lib/svg-fonts.ts`。フォントセットの slot と §4.2 の対応表から決まる）。その上で、変換器には同梱 TTF **だけ**を見せる（svg2pdf: フォント DB に TTF を読み込み、システムフォントを読まない。cairo 系: `FONTCONFIG_FILE`）。こうすると幅は Sumi の幾何 lint の再計測と一致する（差 0pt）。WOFF をそのまま使う道（WOFF の解凍）もあるが、同梱 TTF は既にあるので不要。
- **svg2pdf の非決定性は 2 か所の HashMap 順だった。** フォントオブジェクトの書き出し順（`Context::write_global_objects`）とリソース辞書の並び（`ResourceContainer::finish`）。参照番号で並べ替えるパッチ（`svg2pdf-poc/svg2pdf-deterministic.patch`、十数行）でバイト一致になった。上流に提案する価値がある。サブセットのタグ（`ABCDEF+`）は glyph 集合のハッシュから決まり、ネイティブ（64bit）と WASM（32bit）でタグだけが異なる（`usize` のハッシュ幅の違いと推測）。同じ WASM なら OS によらず同じバイトになる見込みで、むしろ WASM の利点になる（Linux での確認は未実施）。
- **D2 のラベル用 mask。** D2 はエッジのラベルの下で線を消すために `<mask>` を使う。cairo（rsvg・Inkscape）と Chrome はこれをラスタ画像の soft mask にする（rsvg は 72ppi）。svg2pdf はベクターの soft mask（透明グループ）として出力する。PDF/X-1a のような透明を禁じる入稿規定には、どの変換器でもそのままでは合わない。必要になれば、変換前に mask を「ラベルの白い背景」に置き換える前処理で避けられる（PPTX の PoC と同じ考え方）。
- **ページサイズ。** svg2pdf は root の `446pt` を CSS px（96/in）に解決するため、`PageOptions { dpi: 96 }` で pt に戻す必要がある（CLI の既定 72 では 4/3 倍）。Chrome は CSS px の丸めで最大 0.6pt ずれる。
- **性能。** WASM 版はバイナリ内から 50ms 程度で 1 図を変換した（同梱フォント 3 ファイル、計 14MB の読み込みを含む）。
- **JS / WASM での自作。** pdf-lib＋fontkit で D2 の SVG の部分集合（rect・ellipse・polygon・path の M/L/C/S/V/Z・marker・dasharray・mask・text）を描くことは可能だが、CJK の TrueType サブセット、marker と mask の意味論、テキストの配置を自分で持つことになり、svg2pdf が既に正しくやっていることの再実装になる。npm 依存の追加（pdf-lib は 19MB unpacked）も重い。svg2pdf.js（jsPDF）は DOM を前提とし、Bun 単体では動かない。採らない。
- **LaTeX。** svg2pdf の出力は PDF 1.7。pdfTeX は既定の出力版より新しい PDF を取り込むと警告を出すことがある（エラーではない）。TeX 環境が無く未検証のため、後続 Issue で確かめる。

## 4. PPTX

### 4.1 方式

| 方式 | 中身 | PoC |
| --- | --- | --- |
| (a) SVG 画像 | 1 枚の `p:pic`。`a:blip` は PNG（必須のフォールバック）を指し、拡張 `a:extLst/a:ext[@uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"]/asvg:svgBlip`（`xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main"`）が SVG を指す。`[Content_Types].xml` に `svg` → `image/svg+xml` | `*.image.pptx` |
| (b1) ネイティブ・自由形状のエッジ | ノード・グループ = `p:sp`（`rect` / `ellipse` はプリセット、ひし形・六角形・平行四辺形・円柱・文書は SVG の経路そのままの `a:custGeom`）。文字は図形の `p:txBody`。エッジ = 経路そのままの開いた自由形状（`p:sp`）、矢印は `a:headEnd` / `a:tailEnd`、破線は `a:custDash`。エッジのラベルは白地のテキストボックス（SVG の mask の代わり） | `*.native.pptx` |
| (b2) ネイティブ・接着コネクタ | (b1) のエッジを `p:cxnSp`（`straightConnector1`）にし、`a:stCxn` / `a:endCxn` で両端の図形の最寄りの接続点に接着 | `*.native-glued.pptx` |

PoC は依存なしの TypeScript（`scripts/pptx.ts`・`lib/ooxml.ts`・`lib/zip.ts`）。zip はエントリ順・時刻（1980-01-01）を固定した決定的なもの（Bun の `deflateSync` と `hash.crc32`）。PptxGenJS は使わなかった: 4.0.1 は `svgBlip` と `custGeom` は書けるが、接着コネクタ（`p:cxnSp`・`stCxn`・`endCxn`）を出力するコードを持たない（配布物を検索して確認）、実行時依存に `jszip`・`image-size`・`https`（npm のプレースホルダ）・`@types/node` を持つ（4.0.1、unpacked 2.6MB）、必要な XML は数百行で書けるため。

### 4.2 PowerPoint for Mac での結果

| | (a) 画像 | (b1) ネイティブ・自由形状 | (b2) ネイティブ・接着 |
| --- | --- | --- | --- |
| 開けるか | ✓（図形 1） | ✓（全図形が残る: 20 / 21 / 15） | ✓（同左） |
| 見た目（画素差） | 1.1〜1.5% | 0.9〜1.5% | 1.3〜1.8%（経路が直線になる） |
| 文字 | SVG を PowerPoint が描画。**PDF 書き出しでは 300ppi のラスタ画像**になり、文字は抽出できない | 文字として編集可。**同梱フォントが無い環境では置換**（この Mac では BIZ UDPGothic が無く、欧文は Calibri、和文は MS ゴシックになった） | 同左 |
| 文字位置の差（x / 幅 / 上端、最大） | —（画像） | 2.5〜8.2 / 5〜16 / 1〜2.6pt（すべて代替フォントによる幅の差と行送りの差） | 同左 |
| 図形・矢印・破線 | SVG どおり | 位置・大きさは SVG の bbox と一致（EMU = unit × 6350）。矢印は PowerPoint の矢じり（線幅に比例。D2 の 5×6pt とは大きさが違う）。破線は線幅比で再現 | 同左 |
| ノードを動かすと（Gateway を 60pt 下へ） | — | **エッジは元の位置に残る**（接着されていない） | **エッジが追従する**が、ELK の折れ線経路は最初から失われ直線になる |

比較画像: `results/pptx-ja-review-powerpoint.png`、`results/pptx-system-architecture-powerpoint.png`、`results/pptx-move-gateway.png`。数値: `results/pptx-report.json`。

### 4.3 所見

- **PowerPoint は `p:cxnSp` の `a:custGeom` を受け付けない。** 自由形状のコネクタを含むファイルは、図形が 1 つも無いスライドとして開くか、AppleScript からの操作が応答しなくなった（修復ダイアログが出たと推測。補助アクセスの権限が無く画面は確認できていない）（切り分け: 同じ経路を `p:sp` にすると開ける。コネクタをプリセット `line` にすると開ける）。したがって「ELK の経路を保つ」と「図形に接着して追従する」は同時に満たせない。接着するならプリセットのコネクタ（直線・`bentConnector2〜5`・`curvedConnector2〜5`）に近似するしかなく、PowerPoint は図形を動かした時点で独自に再ルーティングする。ELK の直交経路を `bentConnector` の調整値で再現する変換は、端点の向き・反転・折れ数の場合分けが多く、それでも 5 区間を超える経路は表せない。
- **フォントの埋め込みは実質使えない。** PPTX のフォント埋め込み（`p:embeddedFontLst`）は PowerPoint の独自形式で、Mac 版・Google Slides・Keynote での扱いがまちまち。OFL の BIZ UD は埋め込み自体は許諾上問題ないが、確実に効く手段が無い。和文フォントが無い環境では置換され、幅が変わる（今回 最大 16pt）。`wrap="none"` にしたので文字は折り返さないが、図形からはみ出す・重なることはありうる。BIZ UDPGothic は Windows 10 以降に標準で入っているため、Windows の PowerPoint では一致する可能性が高い（未検証）。macOS は BIZ UDGothic（等幅）のみダウンロード可能なフォントとして持ち、BIZ UDPGothic は持たない。
- **(a) の SVG は PowerPoint が描くが、`@font-face` の扱いは保証されない。** 今回の書き出しでは見た目は基準に近かったが、PDF 化すると 300ppi のラスタになった（PowerPoint for Mac の PDF 書き出しの挙動）。確実にするなら SVG の文字をアウトライン化（usvg は文字を path にできる）した版を `svgBlip` に入れる。PNG フォールバックは PowerPoint 2016 より前と、SVG を扱えないアプリで使われる。Google Slides・Keynote での見え方は未検証（Keynote は読み込み時のダイアログで自動化が止まった）。
- **PNG フォールバックにはラスタライザが要る。** PoC では Chrome のスクリーンショットを使ったが、製品では使えない。resvg（svg2pdf と同じ usvg を使う Rust のラスタライザ）を同じ WASM に入れるのが自然（増分は未計測。後続 Issue）。
- **IR と inspection で足りた。** (b) は Figure IR（エッジの端点）、`inspectSvg()` の bbox・ラベルの anchor・行送り・エッジの経路、SVG の色・線幅・破線・marker の有無、幾何 lint の文字計測（`measureLabel()`）だけで作れた。D2 の SVG の部分集合が小さい（#11 の検査で固定済み）ことが効いている。

## 5. 形式変換後の位置・大きさ

| 形式 | 図形 | 文字 | 根拠 |
| --- | --- | --- | --- |
| PDF（svg2pdf PoC） | SVG と同じ（ベクターをそのまま写す。画素差 0.3〜0.6% はアンチエイリアスのみ） | Sumi の計測と差 0pt（x・幅・上端） | `pdf-report.json` |
| PDF（Chrome） | 同じ。ページは最大 0.6pt 丸め | 差 ≤ 0.04pt | 同上 |
| PPTX (a) | 画像として同じ（スライド = 図の pt サイズ） | 画像 | `pptx-report.json` |
| PPTX (b) | bbox は一致（整数 EMU、0.5pt 刻みの D2 座標は割り切れる）。矢じりの大きさは異なる | 同梱フォントが無いと x 最大 8pt・幅最大 16pt ずれる。あれば一致が見込めるが未検証 | 同上 |

PowerPoint の書き出した PDF のページは 169 × 424pt（スライドは 423.5pt）で、整数 pt に丸められた。

## 6. 機能境界

### SVG（現状）

一次成果物。D2 の出力を非破壊に仕上げ、同梱フォントを WOFF で埋め込み、検査（#11）と幾何 lint（#13）の対象。

### PDF（提案）

- 保証すること: ページ = SVG の pt サイズ。図形・線・矢印・破線・文字の位置が SVG と同じ（文字は Sumi の計測と一致）。文字は同梱フォントのサブセット埋め込みの文字（抽出・検索可）。ラスタ画像を含まない。同じ入力・同じ版でバイト一致。
- 保証しないこと: PDF/A・PDF/X 等の規格適合（D2 の mask が透明を使う）、タグ付き PDF（アクセシビリティ）、複数ページ、画面上の見た目以上の構造（レイヤー・リンク）。

### PPTX (a) 画像（提案）

- 保証すること: スライドの大きさ = 図の大きさで、図が 1 枚の画像として正しく表示される（SVG を扱えるアプリでは SVG、それ以外では PNG）。
- **保証しないこと: 編集。** 図形・文字・矢印は個別に選べない（PowerPoint の「図形に変換」は利用者の操作で、結果は保証外）。PDF への書き出しがベクターになること。

### PPTX (b) ネイティブ（実験的）

「PPTX に対応」と書くとき、次をはっきり分ける。

- 保証すること:
  - ノードとグループが 1 つずつの図形になり、選択・移動・色や線の変更・文字の編集ができる。
  - 文字はテキストとして編集できる（検索・翻訳・差し替え可）。
  - 開いた直後の配置（図形の bbox、エッジの経路、ラベルの位置）は SVG と同じ座標で書かれている。
- **保証しないこと:**
  - **見た目の一致。** 同梱フォントが閲覧環境に無ければ別のフォントに置換され、文字の幅・行送りが変わる（今回 最大 16pt）。矢じりの形と大きさは PowerPoint のもの。
  - **編集後のレイアウト。** 自由形状のエッジ（既定）は図形を動かしても追従しない。接着コネクタにすると追従するが、ELK の経路は直線（またはプリセットの折れ線）になる。どちらでも Sumi のレイアウト規則（重なり・交差の回避、幾何 lint）は PowerPoint 上の編集に対しては働かない。
  - **往復。** PPTX で編集した内容を `*.sumi.yaml` に戻すことはしない。一次ソースは YAML のまま。
  - 自由形状の図形（ひし形・六角形・平行四辺形・円柱・文書）は PowerPoint のプリセット図形ではなく、調整ハンドルや「図形の変更」での意味（ひし形であること）は持たない（プリセットに写す場合は、D2 と PowerPoint の形の比率の違いで見た目がずれる）。
  - Keynote・Google Slides・LibreOffice での表示（未検証）。

## 7. 視覚回帰と依存の配布

| 形式 | 回帰テストの方法 | CI に必要なもの |
| --- | --- | --- |
| SVG | 現状どおりバイト一致の golden（設計 §6.7） | D2・フォント |
| PDF（svg2pdf/WASM） | **バイト一致の golden**（同じ WASM・同じ入力ならバイト一致。OS 間は要確認）。加えて構造の検査をテストに入れる: ページサイズ、`pdffonts` 相当（埋め込み・サブセット）、文字の位置（今回の `pdftotext -bbox` と `measureLabel()` の比較）。ラスタ比較は必須にしない | 追加なし（WASM はリポジトリ／バイナリに同梱）。検査に poppler を使うなら CI に入れる（テスト時のみ） |
| PPTX | XML の golden（決定的な zip ならバイト一致の golden も可）。OOXML のスキーマ検証は任意。PowerPoint での表示は CI では確かめられないため、手動の確認手順（今回の AppleScript）を残す。LibreOffice の headless 変換を「開けること」の煙テストに使うことはできる（今回は未導入） | なし（自前生成）。煙テストに LibreOffice |

配布物の増分: WASM 方式なら単一バイナリが約 2.7MB 増える（`bun build --compile` の確認で 63.1MB → 65.8MB）。ネイティブの svg2pdf を `libexec/` に置く方式は 1.9MB／ターゲットだが、4 ターゲット分のクロスビルドと署名・smoke の対象が増え、D2 と同じ配布の手間がかかる。cairo 系（rsvg・Inkscape）は共有ライブラリ群の同梱が必要で、LGPL の扱いも増える。Chrome は制約に反する。

## 8. 推奨と優先順位

1. **`sumi render --format pdf`（svg2pdf を WASM で同梱）**
   - Rust の小さなクレート（svg2pdf 0.13 ＋決定性のパッチ、フォント DB は同梱 TTF のみ、`dpi: 96`）を `wasm32-unknown-unknown` でビルドし、生成物（.wasm）と sha256 をリポジトリで固定する（ビルドは CI で再現性を確認）。Bun からは WASI なしの C ABI で呼ぶ（PoC の `lib/svg2pdf-wasm.ts`）。
   - SVG の前処理（family 名の解決）は TS 側で、フォントセットの slot から決める。
   - 決定性パッチは上流（typst/svg2pdf）に提案し、取り込まれれば外す。svg2pdf 0.13 は usvg 0.45 に依存し、typst の進化で API が変わりうる（版を固定する）。
2. **`sumi render --format pptx`（SVG 画像＋PNG フォールバック）**: PNG は同じ WASM の resvg で作る。SVG は文字をアウトライン化した版を入れるかを決める（PowerPoint の `@font-face` 対応に依存しないため）。
3. **ネイティブ PPTX（実験的、フラグ付き）**: (b1) を既定、(b2) をオプションとし、§6 の「保証しないこと」をヘルプとドキュメントに明記する。D2 の SVG の部分集合が変わったら壊れるため、#11 の検査（未知の要素は error）と同じ契約の上に作る。

## 9. リスク

- svg2pdf / usvg の版の更新で出力が変わる（golden の更新が必要。D2 と同じ扱い）。WASM の生成物を固定すれば、Rust のツールチェーンの違いの影響は受けない。
- svg2pdf の決定性パッチを自前で持つ保守コスト（十数行。上流に取り込まれなければ版ごとに当て直す）。
- D2 の SVG が透明（mask）を使うため、透明を禁じる入稿規定には別途前処理が要る。
- PDF 1.7 を pdfTeX で取り込むときの警告（未検証）。
- PPTX: アプリごとの差（SVG・フォント・コネクタの扱い）。CI で表示を確かめられない。「編集可能」を期待されやすく、§6 の境界を越えた要望が来やすい。
- フォントの置換による文字のはみ出しは PPTX 側で検出できない（幾何 lint は SVG に対して働く）。

## 10. 後続 Issue の提案（未作成）

1. **feat(render): export vector PDF via svg2pdf compiled to WASM**
   - 目的: `sumi render --format pdf` で、ページが図の pt サイズ・同梱フォントのサブセット埋め込み・ベクターのみ・決定的な PDF を出力する。
   - 内容: svg2pdf 0.13（決定性パッチ）を使う Rust クレートと .wasm の固定、ビルドの再現性の検査、family 名の前処理、`bun build --compile` への埋め込み、release smoke に PDF の生成を追加、PDF の golden と構造の検査（ページサイズ・フォント・文字位置）。
   - 完了条件: 4 ターゲットで同じ PDF（sha256）を出す。examples の PDF がバイト一致の golden になる。
2. **chore(research): upstream the deterministic output fix to typst/svg2pdf**
   - 目的: 自前パッチをなくす。フォントオブジェクトとリソース辞書の書き出し順を固定する修正を上流に提案する。
3. **feat(render): export PPTX with the SVG as a picture and a PNG fallback**
   - 目的: スライドに貼れる 1 枚画像の PPTX。編集はできないことを明記する。
   - 内容: OOXML の自前生成（決定的な zip）、`asvg:svgBlip`、PNG フォールバックのための resvg の WASM 同梱（サイズの計測を含む）、SVG の文字をアウトライン化するかの判断、PowerPoint（Windows / Mac）・Keynote・Google Slides での手動確認。
4. **feat(render): experimental native DrawingML PPTX export**
   - 目的: 図形・文字を個別に編集できる PPTX（実験的）。
   - 内容: 本メモの (b1)（既定）と (b2)（`--pptx-connectors glued`）、編集可能性の境界（§6）のドキュメント化、BIZ UDPGothic が入った環境（Windows）での位置の確認、矢じりの大きさの対応、XML の golden。
   - 前提: 1 と 3 の後。需要を確認してから着手する。
5. **test(render): verify PDF output in LaTeX and on Linux**
   - 目的: svg2pdf の PDF（1.7）を pdfLaTeX / LuaLaTeX の `\includegraphics` で取り込めること、Linux（x64 / arm64）で macOS と同じバイトになることを確かめる。
6. （任意）**feat(render): replace D2 label masks with label backgrounds for transparency-free PDF**
   - 目的: 透明を禁じる入稿規定（PDF/X-1a 等）向けに、mask を使わない SVG / PDF を出す。需要が出てから。

## 付録: 調査で導入したツール

| ツール | 版 | 場所 |
| --- | --- | --- |
| svg2pdf crate（パッチ適用）、svg2pdf-poc、svg2pdf-cli | 0.13.0 | `research/19-pdf-pptx/.tools/`（gitignore） |
| Rust の `wasm32-unknown-unknown` target | 1.98.1 stable | `~/.rustup`（ユーザー単位） |
| librsvg（rsvg-convert） | 2.63.3 | Homebrew |
| Inkscape | 1.4.4 | Homebrew cask |

既存のもの: Google Chrome 155、poppler、ImageMagick 7、Microsoft PowerPoint for Mac、Keynote。
