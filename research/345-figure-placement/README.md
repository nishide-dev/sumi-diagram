# #345 図の置き場所と内容から形を決める方法と、エージェントが描いた図の評価方法

[Issue #345](https://github.com/nishide-dev/sumi-diagram/issues/345)。関連: #323（Skill のデザイン原則とレイアウト計画）、#330（図全体の空白と大きな縮小の診断）、#183（`figure.fit: scale`、設計 §6.48）、#236（ロードマップ）。

この調査では、製品の src・schema・Skill・docs を変更しない。変更の提案は §5 にまとめ、このあと個別の issue にする。

| ファイル | 内容 |
| --- | --- |
| `README.md` | この報告 |
| [`placements.csv`](placements.csv) | 置き場所ごとの数値と出典（§3 の表の元データ） |
| [`figure-shapes.csv`](figure-shapes.csv) | 実際の論文の図 42 点の置き場所・縦横比・配置（§3.7。言葉による記述だけで、画像は含まない） |
| [`pilot-detr.csv`](pilot-detr.csv) | 既存の DETR の 4 図に、§6 の自動指標を当てた試行の値 |

出典の扱い: 各数値には出典（URL）と、その出典での強さを付けた。

- **【規則】**: 投稿規定やテンプレートが要件として書いているもの。
- **【推奨】**: 推奨や慣習として書いているもの。
- **【推論】**: 出典から筆者が計算・推論したもの。

公式ページが開けず、検索結果の抜粋だけで確かめたものには「（抜粋）」と書いた。図そのものは複製していない（§3.7 は言葉による記述だけ）。

---

## 0. 要約

1. **置き場所の条件で、規定として決まっているのは幅・高さの上限・最小の文字・最小の線幅だけ。** 通常の図について、縦横比や「全幅なら横長」を決めている出版社・学会は見つからなかった。縦横比が決まっているのは graphical abstract / TOC 画像（Elsevier 2.5:1、Cell 1:1、ACS 3.25×1.75in 以内）だけ。
   - 実際の論文の図（42 点、§3.7）では、2 段組みの ML の全幅の方法図は 2.8〜5.4:1 の一列が多い。1 本の連鎖を 2 段に折り返した例はまれだった。一方、論文誌の概要図はパネルに分け、1 段の図や構造の図は縦長も多い。慣習は分野と構造で違い、規定ではない。
2. **最小の文字の大きさは媒体ごとに大きく違う。**
   - 例: ACS 4.5pt、Nature 5〜7pt（7pt は**上限**）、Elsevier 7pt（添字 6pt）、PNAS 6pt、PLOS 8〜12pt【規則】、AAAI 9pt 以上【規則】、IEEE 9〜10pt【推奨】、CVPR・ACL「本文と同じ大きさに」【推奨】。
   - Sumi の paper 系 Profile の 7pt と、縮小時の 5pt は、どの媒体にも中立な値ではない。
3. **高さの上限は 170〜234mm（全ページ）。** 「全幅なら高さ 90mm 未満」に当たる規定はない。
   - 上限の例: Nature 170mm、IEEE 220mm、PLOS 222mm、Springer 234mm。
   - 学会のテンプレートは、図の高さの上限を持たない。高さを効かせるのはページ数の制限で、図の高さはそのまま本文の行を減らす。
4. **形は、置き場所が課す「予約される紙面」と「最終的な文字の大きさ」の交換で決まる。**
   - 全幅の図（`figure*`）は高さに関わらず幅全体を予約する。だから全幅の図の費用は**高さ**で、幅を使い切らない形は損になる。
   - 1 段の図の費用は、その段で使う高さ。
   - 折り返す、縮める、ラベルを短くする、段階をまとめる、パネルに分ける、のどれを選ぶかは、「予約する面積」と「最終的な文字の大きさ」と「読む向きの乱れ」の組み合わせを比べて決める。固定の規則にはしない（§4）。
5. **Sumi には、置き場所（高さの予算・その媒体の最小の文字）を書く手段がない。**
   - そのため lint は、形の良し悪しを判断できない。
   - `geometry/heavy-scaling` は縮小**率**（90%）で判定しており、媒体の最小の文字とは関係がない。
   - 推奨: 図に `figure.target`（置き場所の高さの予算・最小の文字の上書き）を足し、縮小の診断を最終的な文字の大きさで行い、予算に対する高さ・幅の使い方を info で示す（§5.3）。
6. **Skill の記述のうち、根拠のない固定規則が 9 か所ある**（§5.5）。
   - 例: 「全幅は 90mm 未満」「縮小より折り返し」「paper-single なら 4 つ以上は down」。
   - Skill の表には、paper 系の高さの上限を「—」とする事実の誤りもある（コードは 220mm）。
7. **評価は、内容 3 種 × 置き場所 3 種と、記憶の対照 1 題を、各条件 5 回描かせる設計を提案する**（§6）。
   - 採点の基準は事前に固定し、自動指標・内容の点検表・盲検の対比較の 3 層で採点する。
   - 既存の DETR 4 図で自動指標を試した。内容の点検表は 4 図とも満点で、違いを示したのは紙面の面積と最終的な文字の大きさだった。
8. **PaperBanana（arXiv:2601.23265）から取り入れる価値があるもの**（§5.6・§6.8）。
   - 描画後に元の内容と照らして点検する Critic の段。ただし画像だけでなく YAML の辺とも照らす。
   - 主要（内容の正しさ・読みやすさ）と副次（簡潔さ・見た目）を分ける段階的な集計。
   - 「選択肢を複数作って選ぶ」運用。
   - VLM の判定者を、人の盲検評価と並べて使うこと。
   - 一方で、PaperBananaBench は縦横比 1.5〜2.5 の横長の図だけに絞ってあり、この調査が問う「置き場所で形が変わる」場面を評価できない。

---

## 1. 背景

ViT と DETR を題材に、エージェントが Skill だけで論文の図を作れるかを評価してきた。その過程で、見つかった問題に対して、その場で Skill に規則を足してきた。

- #323 で、Skill の「Design principles」に次の 2 つを書いた。
  - 「Wrap a long chain into rows rather than shrink it.」
  - 「`paper-double` (180mm) a wide, short figure (usually under about 90mm tall)」
- DETR の 2 回目では、Sonnet がこれに従って、全幅の図を 2 段に折り返した。結果は 141.8 × 86.8mm で、幅の 21% を使わないまま、高さは 1 段の案の 1.6〜1.9 倍になった（§6.9）。
- その反省から「全幅は横長」と書き換えかけた。しかし、1 ページ目の 1 段の概要図、スライド、ポスター、README、ML 以外の分野では、条件が違う。

評価の方法にも問題があった。

- 1 題材を 1 モデルで 1 回だけ描かせていた。Opus は 1 回目と 2 回目でまったく違う配置になり（§6.9）、このばらつきを改善や悪化と見誤った。
- 採点の基準を、図を見てから決めていた。

---

## 2. 調べたこと

1. **投稿規定と図の手引き**
   - 出版社: IEEE、ACM、Springer Nature、Nature、Elsevier、Cell Press、Science、PNAS、APS、PLOS ONE、ACS、RSC、eLife、bioRxiv。
   - 学会のスタイルファイル: NeurIPS、ICML、ICLR、CVPR/ICCV、ACL/ARR、AAAI。
   - その他: スライド・ポスター・Web 文書の手引き、図のデザインの文献（Tufte、Rougier ら、Bang Wong）。
   - それぞれから、置き場所ごとの幅・高さ・最小の文字・線幅・縦横比の規定を集めた。
   - 公式ページを WebFetch で読んだ。403 で読めないページ（science.org、pnas.org、cell.com の一部、ACM TAPS、Springer、rsc.org）は、検索結果の抜粋で補い、そう明記した。
2. **実際の図の形**: arXiv の HTML 版などで、方法の概要図の幅の指定・縦横比・パネル数・折り返し方を、分野と置き場所ごとに数えた（§3.7）。
3. **Sumi の現状**: Profile（`src/core/profile/`）、`figure.fit`、幾何 lint（`geometry/heavy-scaling`・`dead-space`・`text-too-small`・`exceeds-page-*`）、Skill（`skills/sumi/SKILL.md`、`references/layout-tips.md`、`figure-format.md`、`diagnostics.md`）、設計 §5・§6.48・§6.96 を読んだ。
4. **既存の評価の出力**: DETR の 4 図（1 回目・2 回目 × Opus・Sonnet）を、現在の CLI で描き直して診断を集めた。
5. **PaperBanana**: 論文（arXiv:2601.23265v2 の本文と付録 B・C・F・H）と、非公式実装（github.com/llmsresearch/paperbanana）の README と `data/guidelines`、PaperBananaBench のデータセットカードを読んだ。

---

## 3. 置き場所ごとの条件

### 3.1 論文誌・出版社

単位は mm（1pt = 0.3528mm、1in = 25.4mm）。5pt = 1.76mm、7pt = 2.47mm、0.5pt = 0.18mm。

| 出版社 | 1 段 | 1.5 段 | 全幅 | 高さの上限 | 文字（印刷時） | 線幅 | 出典 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| IEEE | 88.9 | — | 182 | 220mm（182 × 220 を超えない） | 9〜10pt【推奨】 | 記載なし | [Resolution and size](https://journals.ieeeauthorcenter.ieee.org/create-your-ieee-journal-article/create-graphics-for-your-article/resolution-and-size/)、[File formatting](https://journals.ieeeauthorcenter.ieee.org/create-your-ieee-journal-article/create-graphics-for-your-article/file-formatting/) |
| Nature | 89 | 120 / 136 | 183 | **170mm**（凡例を下に置くため。ページ全体は 247mm）【規則】 | **5〜7pt**（最小 5pt、最大 7pt）【規則】、パネル記号 8pt 太字 | 記載なし | [building-and-exporting-figure-panels](https://research-figure-guide.nature.com/figures/building-and-exporting-figure-panels/)、[preparing-figures-our-specifications](https://research-figure-guide.nature.com/figures/preparing-figures-our-specifications/)、[final artwork PDF](https://www.nature.com/documents/nature-final-artwork.pdf) |
| Springer（一般） | 84（小 39） | 129 | 174 | 234mm【規則】 | 8〜12pt（2〜3mm）【推奨】 | **0.1mm（0.3pt）以上**【規則】 | VLDB Journal が転載した Springer の指針 [artwork](https://vldb.org/vldb_journal/index.php/572-author-guidelines/additional-specifics/54-artwork)（Springer の公式ページはログインに転送された） |
| Elsevier | 90（最小 30） | 140 | 190 | 記載なし | 通常 7pt、添字 6pt 以上 | 記載なし | [Artwork sizing](https://www.elsevier.com/about/policies-and-standards/author/artwork-and-media-instructions/artwork-sizing) |
| Cell Press | 85 | 114 | 174 | 約 203mm（6.5 × 8in）【推奨】 | 約 6〜8pt【推奨】 | 0.5〜1.5pt【推奨】 | cell.com/figureguidelines（抜粋。403） |
| Science | 5.5〜5.7cm（旧）/ 9cm（2025） | 12cm | 18.3〜18.4cm | 記載なし | 最小 5pt【規則】、6〜9pt | 記載なし | science.org の手引き（抜粋。版ごとに値が食い違う） |
| PNAS | 87 | 114 | 178 | 225mm【推奨】 | 6〜12pt（縮小後）【規則】 | 記載なし | pnas.org の digital art guidelines（抜粋。403） |
| APS（Phys. Rev.） | 86 | 1.5〜2 段も可 | （約 178【推論】） | 記載なし | 記号・文字の高さ **2mm 以上**【規則】 | **0.18mm（0.5pt）以上**【規則】 | [Physical Review Applied 投稿者情報](https://journals.aps.org/prapplied/authors/information-contributors-physical-review-applied) |
| PLOS ONE | 66.8〜190.5（本文の幅は 132 以下を推奨） | — | 190.5 | 222.3mm（ページ全体、凡例を除く）【規則】 | **8〜12pt**【規則】 | 0.2mm（ツールの例のみ） | [PLOS ONE Figures](https://journals.plos.org/plosone/s/figures) |
| ACS（JACS） | 84.7 以下 | — | 105.8〜177.8 | 記載なし | **4.5pt 以上**【規則】 | **0.5pt 以上**【規則】 | [ACS author guidelines (JACS) 付録 2](https://researcher-resources.acs.org/publish/author_guidelines?coden=jacsat) |
| ACM（sigconf） | 86.9 | — | 177.8 | 記載なし | 記載なし | 記載なし | TAPS image specifications（抜粋。403） |
| bioRxiv / eLife | 規定なし（図を含む PDF 1 本で投稿できる） | | | | | | [bioRxiv submit](https://www.biorxiv.org/submit-a-manuscript) |

各社に共通する傾向【推論】:

- 1 段は 84〜90mm、全幅は 174〜190mm にほぼ収まる。Sumi の 88mm / 180mm は、その中央付近にある。
- 高さの上限は 170〜234mm。

### 3.2 学会のテンプレート（ML・NLP・CV）

| 学会 | 組み方 | 段の幅 / 本文の幅 | 本文の高さ | ページ数 | 図についての規定 | 出典 |
| --- | --- | --- | --- | --- | --- | --- |
| NeurIPS | 1 段組み | — / 5.5in（139.7mm） | 9in | 9 ページ（図を含む）【規則】 | 「neat, clean, and legible」【推奨】。図の中の文字の最小は**規定なし** | [neurips_2020.tex](https://media.neurips.cc/Conferences/NeurIPS2020/Styles/neurips_2020.tex)（2024 版は 403）、2025 CFP（抜粋） |
| ICLR | 1 段組み | — / 5.5in | 9in | 9 ページ（最終版 10）【規則】 | 規定なし | [iclr2026_conference.tex](https://raw.githubusercontent.com/ICLR/Master-Template/master/iclr2026/iclr2026_conference.tex) |
| ICML | 2 段組み | 3.25in（82.6mm） / 6.75in（171.5mm） | 9in | 8 ページ【規則】 | **線は 0.5pt 以上**。全幅の図（`figure*`）はページの上か下に置く【規則】 | [icml2025.zip](https://media.icml.cc/Conferences/ICML2025/Styles/icml2025.zip) |
| CVPR / ICCV | 2 段組み | 約 3.28in（83.3mm） / 6.875in（174.6mm） | 8.875in | 8 ページ | 「図の中の文字は本文の大きさに合わせる」「読者は拡大できないと思って作る」【推奨】、callout 9pt | [cvpr-org/author-kit](https://github.com/cvpr-org/author-kit) |
| ACL / ARR | 2 段組み（A4） | 77mm / 160mm | 247mm | 8 ページ（最終版 9） | 「文字は可能なら本文の大きさ（11pt）で」【推奨】、「図は 1 段以上の幅」【規則】 | [ACLPUB formatting](https://acl-org.github.io/ACLPUB/formatting.html) |
| AAAI | 2 段組み | 3.3in（83.8mm） / 約 7in | — | 7 ページ | **図の中の文字は 9pt 以上**【規則】。2 段にまたがる図はページの上か下 | [AAAI-26 投稿手順](https://aaai.org/conference/aaai/aaai-26/submission-instructions/)、Overleaf の AAAI テンプレート |

- 図の高さの上限を明示した学会はなかった。上限は本文の高さ（約 225〜247mm）だけで、実際の予算はページ数の制限から来る【推論】。
- 1 段組みの NeurIPS / ICLR では、図の幅の上限は 139.7mm。2 段組みの論文の全幅の図（171〜180mm）とは別の置き場所になる。Sumi の paper-double（180mm）をそのまま使うと、NeurIPS では 0.78 倍に縮んで載る【推論】。

### 3.3 1 ページ目の概要図（teaser）と graphical abstract

| 置き場所 | 条件 | 強さ | 出典 |
| --- | --- | --- | --- |
| CVPR の teaser | 公式キットは、題名の直後に全幅の `strip` として置く例を示す。ただし「a two-column teaser is not mandatory」と明記 | 例であり、任意 | [cvpr-org/author-kit `fig/teaser.tex`](https://github.com/cvpr-org/author-kit) |
| ML/CV 論文の teaser 全般 | 「1 ページ目に入出力・主な発見を示す teaser を」 | 【推奨】 | Jia-Bin Huang の投稿（[thread 1](https://threadreaderapp.com/thread/1437443017510621185.html)、[thread 2](https://threadreaderapp.com/thread/1279992087497314305.html)） |
| ICML の全幅の図 | 全幅はページの上か下に限る（1 ページ目なら題名の下） | 【規則】 | ICML 2025 キット |
| Elsevier graphical abstract | 1328 × 531px 以上（300dpi で約 112 × 45mm、**2.5:1**）。上から下、または左から右に読む | 大きさは【規則】、読む向きは【推奨】 | [Elsevier graphical abstract](https://www.elsevier.com/researcher/author/tools-and-resources/graphical-abstract) |
| Cell graphical abstract | **正方形**、1 パネル、Arial 12〜16pt | 【規則】（大きさは文書ごとに食い違う） | [GA_guide.pdf](https://crosstalk.cell.com/hubfs/Files/GA_guide.pdf) |
| ACS TOC 画像 | 3.25 × 1.75in（82.6 × 44.5mm）以内、8pt を推奨し 6pt 以上 | 【規則】 | [ACS TOC guidelines PDF](https://pubsapp.acs.org/paragonplus/submission/toc_abstract_graphics_guidelines.pdf) |
| eLife striking image | 1800 × 900px 以上の横長（2:1） | 【規則】 | eLife author guide（抜粋） |

1 ページ目の概要図は、1 段の図（右上）でも、全幅の帯（題名の下）でもよい。どちらにするかは規定ではなく、著者が紙面の費用で選んでいる【推論。§3.7 の標本も参照】。

縦横比を規定として決めているのは graphical abstract / TOC だけで、その値も媒体によって 1:1 から 2.5:1 まで違う。

### 3.4 スライド（16:9）

| 項目 | 値 | 強さ | 出典 |
| --- | --- | --- | --- |
| 大きさ | PowerPoint の Widescreen は 13.333 × 7.5in（338.7 × 190.5mm） | 製品の既定 | [Microsoft Support](https://support.microsoft.com/en-us/powerpoint/change-the-size-of-your-powerpoint-slides) |
| 本文の最小 | 24pt（見出し 32pt） | 【推奨】 | [University of Manchester](https://www.staffnet.manchester.ac.uk/digital-inclusion/practical-guidance/designing-presentations/) |
| 本文の最小 | 18pt を絶対の最小 | 【推奨】 | [Cambridge CCTL](https://www.cctl.cam.ac.uk/slide-accessibility-guidance) |
| 本文の最小 | 30pt（10/20/30 の規則） | 意見 | Guy Kawasaki（[転載](https://www.presentationmagazine.com/the-10-20-30-rule-of-powerpoint-11710.htm)） |
| 見る距離 | 最も遠い視聴者は、画面の高さの約 4 倍（分析）・6 倍（一般）・8 倍（受動）以内 | 業界の目安 | AVIXA DISCAS の要約（Epson・Draper の資料の抜粋） |
| 図の描き方 | 線を太く、文字を大きく、縦書きを避け、単純にする | 【推奨】 | [Rougier et al. 2014, Rule 3](https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1003833) |

Sumi の presentation-16x9 の最小 14pt は、手引きの多く（18〜24pt）より小さい【推論】。ただし slides テーマの本文は 16pt。

### 3.5 ポスター

| 項目 | 値 | 強さ | 出典 |
| --- | --- | --- | --- |
| 大きさ | A0 = 841 × 1189mm | 規格 | ISO 216 |
| CVPR 2025 | 84 × 42in（213 × 107cm）、2:1 の横長 | 【規則】 | [CVPR 2025 poster printing](https://cvpr.thecvf.com/Conferences/2025/PosterPrintingInformation) |
| NeurIPS 2025 | 板は 96 × 48in。収まれば大きさは自由。ワークショップは 24 × 36in の縦長 | 【規則】 | [NeurIPS 2025 poster instructions](https://neurips.cc/Conferences/2025/PosterInstructions) |
| ICML 2025 | 36 × 48〜72in（縦 × 横）を推奨。ワークショップは縦長 36 × 24in 以内 | 【規則】/【推奨】 | [ICML 2025 poster instructions](https://icml.cc/Conferences/2025/PosterInstructions) |
| 文字 | 1.5〜2m から読める大きさ。本文 24pt、説明文 18pt、題 85pt | 【推奨】 | [UC Davis URC handout](https://urc.ucdavis.edu/sites/g/files/dgvnsk3561/files/inline-files/General%20Poster%20Design%20Principles%20-%20Handout.pdf) |
| 文字 | 本文 28pt 以上、説明文 24pt 以上 | 【推奨】 | [WKU libguides](https://libguides.wku.edu/posters/text) |
| 構成 | 図は約 2m から読める細部に。表より図、実験の設計は流れ図で。縦長は下が目の高さより下がる | 【推奨】 | [Colin Purrington](https://colinpurrington.com/tips/poster-design/) |

ポスターの図は、全体ではなくポスターの 1 区画（列の幅）に置く。区画の幅は、ポスターの段組みで決まる【推論】。

### 3.6 Web の文書・README

| 項目 | 値 | 強さ | 出典 |
| --- | --- | --- | --- |
| GitHub README の表示幅 | リポジトリのトップ 830px、ファイル表示 1012px（大きい画面での実測）。これより広い画像は縮む | 実測（非公式） | [wh0.github.io 2025-05-18](https://wh0.github.io/2025/05/18/banner-width.html) |
| GitHub の本文の幅 | 980px − 余白 45px × 2 ≈ 890px。767px 以下では余白 15px | コミュニティによる再現 | [github-markdown-css](https://github.com/sindresorhus/github-markdown-css) |
| 暗い表示 | `<picture>` と `prefers-color-scheme` で明暗を出し分けられる | 機能 | [GitHub changelog 2022-08-15](https://github.blog/changelog/2022-08-15-specify-theme-context-for-images-in-markdown-ga) |
| SVG の中の暗い表示 | `<img>` で埋め込んだ SVG の中の `prefers-color-scheme` は、埋め込み先に従う | 標準 | [MDN prefers-color-scheme](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-color-scheme) |
| 文書の画像 | 段より広い画像を使わない、小さすぎる画像を避ける、可能なら SVG、背景は透明にしない | 【推奨】 | [Google developer documentation style guide: images](https://developers.google.com/style/images) |

Web では、図の物理的な大きさが決まらない。表示幅（約 700〜1000px）に合わせて縮み、スマートフォンではさらに小さくなる。だから「最終的な文字の大きさ」は、図の幅と表示幅の比で決まる【推論】。

- 例: 幅 180mm（510pt）の図を 830px で表示すると 1pt ≈ 1.63px になり、8pt の文字は約 13px で表示される。
- 一方、幅 338mm のスライド用の図を同じ幅で表示すると、16pt の文字が約 14px で表示される。

### 3.7 実際の図の形（分野と置き場所ごとの標本）

42 図（36 論文）を調べた。一覧は [`figure-shapes.csv`](figure-shapes.csv) にある。

**調べ方:**

- **置き場所**: PDF の本文から、caption の 1 行目の文字数と x 位置を読んで判定した。1 段の caption はおよそ 40〜65 文字、全幅はおよそ 95〜130 文字。
- **縦横比**: arXiv の HTML 版・ar5iv・PMC の `<img>` の幅と高さから求めた（表の m）。測れない図は、推定（e）にした。
  - arXiv の HTML の画素幅は、`\linewidth` と `\textwidth` を区別しない。だから置き場所の判定には使わず、比だけを使った。
- **偏り**: 標本は有名な論文に偏っている。無作為抽出ではない。

**分野と置き場所ごとの傾向**【推論。標本の観察】:

| 分野・置き場所 | 観察 |
| --- | --- |
| 2 段組みの ML / CV（14 論文）の方法の図 | 全幅 8、1 段 6。全幅の概要図の縦横比は 2.8〜5.4:1（実測 5 図）で、高さが幅の 1/3〜1/5 の横長の一列が多い。1 段の方法図は 1.67〜2.25:1 が多く、縦長も 2 例ある（ControlNet 0.71、ResNet の 34 層の図は約 0.45 で、長い連鎖を 3 本の縦の列に折った） |
| 1 ページ目の概要図 | 全幅 9 例（SAM、ControlNet、DiT、Depth Anything、DUSt3R、DINO、3DGS、Generative Agents、AI Chains）、右上の 1 段 5 例（Mask R-CNN、Swin、YOLO、MAE、LDM）。acmart（CHI・UIST・SIGGRAPH）は `teaserfigure` で全幅。HCI の概要図は 1.4〜1.9:1 の複数パネルで、一列の帯ではない |
| 1 段組みの ML（NeurIPS、ICLR、LNCS） | 本文の幅いっぱいが多い。ただし縦横比は内容で大きく違う: DDPM 6.7、DETR 5.3 / 3.9、NeRF 3.35、ViT 1.98、CoT 2.05（2 パネル）。縦積みの構造は、引き伸ばさず細いまま中央に置く（Transformer は本文の幅の約 55%、0.68:1）。LoRA は本文の横に回り込ませる（wrapfigure） |
| NLP（ACL 系） | 全幅に 2 パネル（BERT: 事前学習 / 微調整、それぞれ下から上）、1 段に縦積みの図（Sentence-BERT） |
| システム（OSDI、SOSP、ATC） | 構成図は 1 段で正方形に近い（Spanner 1.29〜1.78、vLLM 1.87）。上から下の層、または入れ子の箱。全幅は、広いデータの流れや実行の概要（MapReduce、TensorFlow）に使う |
| 生命科学の論文誌（Nature、Cell、PLOS、Bioinformatics） | ほぼすべて全幅で、高さだけが変わる（実測 0.61〜3.5:1、模式図 0.87〜2.2:1）。概要は記号付きの複数パネル（Nature は a, b, c、Cell・PLOS は A, B, C）。長い工程は一列の帯にせず、パネルや格子に分ける。AlphaFold2 の図 1 では、構成の帯は結果のパネルの下のパネル e |
| 物理（PRL） | 装置の模式図を、データの図と同じ全幅の図に入れ、(a)(b) の小パネルにする |

**長い連鎖の扱い**: 最も多いのは、全幅の一列（3〜5.5:1、最大 6.7:1）。次が、記号付きのパネルに分ける形で、論文誌ではこれが普通。1 段の図は縦にする（ネットワークは下から上、システムの層は上から下）。

**1 本の連鎖を 2 段に折り返す形は、この標本ではまれだった。**

- DUSt3R と fastp は 2 行の形をとるが、これは並列の枝を行にしたもので、1 本の連鎖を折り返したものではない。
- 長い連鎖を折った例は、ResNet の図 3（縦の列を横に並べる）だけ。

この観察は、§1 の DETR の 2 段の図が「一般的でない」と感じられた理由を説明する。ただし、規定ではなく慣習である。分野（論文誌のパネル分割）や構造（縦積み）によって、慣習の形も違う。

### 3.8 置き場所の条件のまとめ（Sumi が扱うべき量）

規定から取り出せる、置き場所の量は次のとおり。

| 量 | 規定の例 | 性質 |
| --- | --- | --- |
| 幅 W | 1 段 84〜90mm、全幅 174〜190mm、1 段組み 139.7mm、スライド 338.7mm、README 約 830px | 規定（多くは固定値。PLOS や ACS は範囲） |
| 高さの上限 Hmax | 170〜234mm（Nature〜Springer）。学会は本文の高さだけ | 規定 |
| 高さの予算 Hbudget | ページ数の制限、ほかの図や表との兼ね合い | **規定ではない。** 著者がその図に割ける高さ |
| 最終的な文字の最小 Fmin | 4.5〜9pt（論文）、18〜24pt（スライド）、24pt（ポスター） | 規定または推奨。媒体ごとに違う |
| 最終的な文字の最大 Fmax | Nature 7pt、PNAS・PLOS 12pt | 規定（一部だけ） |
| 線幅の最小 Lmin | Springer 0.3pt、APS・ACS・ICML 0.5pt | 規定（一部だけ） |
| 予約される紙面 | 全幅の図は W 全体 × 高さを予約する。1 段の図はその段 × 高さ | 組版の性質（`figure*` は幅全体を取る）【推論】 |
| 縦横比 | graphical abstract / TOC だけ（1:1〜2.5:1） | 規定（一部だけ） |

---

## 4. 形を決める考え方

### 4.1 文献が言っていること

- **Tufte（*The Visual Display of Quantitative Information*、「Proportion and Scale」）**: 「If the nature of the data suggests the shape of the graphic, follow that suggestion. Otherwise, move toward horizontal graphics about 50 percent wider than tall.」。「The principles should not be applied rigidly」とも書いている。
  - 統計図表についての議論で、内容が形を示すならそれに従うのが第一で、横長は既定値にすぎない。
- **Rougier, Droettboom & Bourne（2014）Rule 3「Adapt the Figure to the Support Medium」**: 媒体ごとに物理的な大きさが違い、「Ideally, each type of support medium requires a different figure」。
- **Bang Wong（Nat. Methods 2010, Gestalt principles）**: パネルを順に読ませたいなら、横一列に並べると自然な順序になる。行と列の間隔の差が、縦と横のどちらでまとまって見えるかを決める。曲線の道筋は、順序を示す助けになる。
- **Cleveland の 45° banking と Heer & Agrawala（2006）**: 折れ線グラフの縦横比は、データから決める。
  - 節点と辺の図には直接当てはまらない。それでも「縦横比は内容から決める」ことの裏付けになる。

これらに「置き場所 X ならこの形」という固定の規則はない。共通するのは、**内容が示す形に従い、媒体の大きさの制約の中で読める大きさを確保する**、という考え方である。

### 4.2 入力

**置き場所（§3.8）**: W、Hmax、Hbudget（任意）、Fmin、Fmax（任意）、Lmin（任意）、紙面の予約の仕方（全幅か 1 段か）、媒体（印刷・画面・投影・Web）。

**内容の構造**（図を描く前に、内容の記述から数える）:

| 量 | 意味 | 例（DETR） |
| --- | --- | --- |
| 主経路の長さ n | 入力から出力までの段階の数 | 画像 → CNN → 特徴 → 1×1 conv・平坦化 → ⊕PE → encoder → decoder → FFN → 予測: 約 8〜9 |
| 側の入力 s | 主経路に横から入るもの | 位置エンコーディング、object queries: 2 |
| 分岐・並列の幅 b | 同じ段に並ぶ要素の最大数 | N 個の出力・FFN（省略記号で 3 本程度） |
| 階層の深さ d | 入れ子の数（拡大図、パネル内のパネル） | 1 |
| パネル数 p | 独立した話題（概要と詳細、比較する変種） | 1（学習時のマッチングを別パネルにすれば 2） |
| ラベルの長さ | 最長と中央値（文字数） | 「Transformer encoder」19 文字など |
| 自然な区切り | 段階の意味上の切れ目 | 「抽出」と「集合予測」の間、学習時のみの部分 |

### 4.3 手順: 候補を作り、比べる

1. **制約を確かめる。** W・Hmax・Fmin を置き場所から決める。決まっていなければ利用者に尋ねる（推測したら報告に書く）。
2. **候補を 2〜4 個作る。** 内容の構造から、次の型を組み合わせる。どれか 1 つを規則で選ばない。
   - **一列（strip）**: 主経路を 1 方向に並べる。側の入力と分岐は直交方向に出す。
   - **縦積み**: 層を積む構造（下から上）や、段の幅が狭い置き場所向け。
   - **折り返し（2 段以上）**: 自然な区切りで行を分ける。蛇行（2 行目が逆向き）と Z 型（2 行目も左から右）がある。
   - **L 字・T 字**: 主経路は一列にし、学習時の枝や詳細を下に出す。
   - **パネル分割**: 概要と詳細、または推論と学習を、別のパネルに分ける。
   - **要約**: 段階をまとめる（1×1 conv と平坦化を 1 箱にする）、ラベルを短くする（数式の記号・略語）。
3. **各候補の自然な大きさを測る。** Sumi なら `sumi render --json` の `size`。
4. **硬い制約で落とす。** 縮小後の幅 ≤ W、高さ ≤ Hmax、最終的な文字 ≥ Fmin（縮小率 × 設計の文字の大きさ）、線幅 ≥ Lmin。
5. **残った候補を、次の量で比べる。** 一つの点数に足し合わせず、優劣が決まる（支配される）候補を落とし、残りの交換関係を利用者に示す。
   - **予約する紙面**: 全幅の図なら W × 高さ、1 段の図なら段の幅 × 高さ。Hbudget があれば、それに対する比も見る。
   - **最終的な文字の大きさ**: 最小と本文の大きさ。Fmin に対する余裕を見る。
   - **読む向きの乱れ**: 主経路の向きが変わる回数と、逆向きに戻る回数。
   - **空白**: 説明のない大きな空き（`geometry/dead-space`）。
   - **辺の交差と回り道。**
6. **選び、理由を報告する。** 例:「高さ 46mm・本文 6.8pt の一列と、高さ 87mm・8pt の 2 段のうち、Fmin 5pt の媒体なので面積の小さい一列を選んだ」。

### 4.4 幅が足りないときの選択肢

「縮小より折り返し」のような順位は付けない。それぞれ、何を費やして何を得るかが違う。

| 選択肢 | 費やすもの | 選ぶ条件（判断の材料） |
| --- | --- | --- |
| ラベルを短くする | 説明の詳しさ（本文や凡例に移す） | ラベルが幅を決めている（幅の内訳で、ラベルの幅が箱の最小幅を上回る）。記号や略語が本文で定義されている |
| 段階をまとめる | 内容の細かさ | 隣り合う段階が本文で 1 文に収まり、図の主張に要らない。**内容を変えるので利用者に確かめる** |
| 間隔を詰める（`density: compact`） | まとまりの見分けやすさ | 間隔が幅の 15〜25% 以上を占めている【推論】。グループの内外で間隔の差を保てる |
| 縮小（`fit: scale`） | 最終的な文字・線の大きさ | 縮小後も Fmin（と Lmin）を満たし、余裕がある。媒体の Fmin が小さい（Nature 5pt、ACS 4.5pt）ほど有利。AAAI（9pt）、PLOS（8pt）、スライドではほぼ使えない |
| 折り返し | 高さ（予約する紙面）と、読む向きの連続 | 縮小では Fmin を割る。自然な区切りがある。全幅の図で高さの予算に余裕がある。1 段の図で主経路が長い |
| パネルに分ける | 図の間の参照の手間 | 2 つ以上の話題（推論と学習、概要と詳細）がある。各パネルが独立に読める |
| 置き場所を変える（1 段 → 全幅、1 図 → 2 図） | 紙面の構成 | 上のどれでも条件を満たせない。**利用者が決める** |

組み合わせることも多い（例: ラベルを短くして 0.9 倍に縮める）。候補ごとに上の比較（§4.3 の 5）をすればよい。

### 4.5 例: DETR（全幅、Fmin を媒体ごとに変える）

既存の 4 図の数値（§6.9、`pilot-detr.csv`）を、§4.3 の比較に当てはめる。予約する面積は、全幅の図なので 180mm × 高さで数える。

| 図 | 形 | 予約する面積 | 本文の文字（印刷時） | 小さい文字（印刷時） | 向きの変化 / 逆行 |
| --- | --- | --- | --- | --- | --- |
| detr1-opus | 階段状の一列（縮小なし、幅 167mm） | 9,779mm²（高さ 54mm） | 8.0pt | 7.0pt | 3 / 0 |
| detr1-sonnet | 一列 + 学習の枝（80.4% に縮小） | 9,727mm²（高さ 54mm） | 6.4pt | 5.6pt | 0 / 0 |
| detr2-opus | 一列 + 並列の出力（85.4% に縮小） | 8,296mm²（高さ 46mm） | 6.8pt | 6.0pt | 0 / 0 |
| detr2-sonnet | 蛇行の 2 段（縮小なし、幅 142mm） | 15,620mm²（高さ 87mm） | 8.0pt | 7.0pt | 2 / 1 |

- detr1-sonnet は detr1-opus に支配される。面積は同じで、文字が小さく、`geometry/dead-space`（28%）も出る。
- **Fmin = 5pt（Nature 型）の媒体**: detr2-opus が最も小さい面積で条件を満たす。detr2-sonnet は 1.9 倍の面積を使って、文字を大きくしている。
- **Fmin = 7pt（Elsevier 型）の媒体**: 縮小した 2 図は本文が 7pt を割るので落ちる。detr1-opus（面積 1.0）と detr2-sonnet（面積 1.6）が残り、detr1-opus が優る。
- **Fmin = 9pt（AAAI）の媒体**: 4 図とも落ちる（Sumi の paper テーマは本文 8pt）。テーマ、置き場所、内容の量のどれかを変える必要がある。

このように、同じ 4 図でも順位は置き場所の Fmin によって変わる。「全幅なら横長」「縮小より折り返し」のどちらの固定規則でも、この判断はできない。

---

## 5. Sumi への提案

### 5.1 現状

| 項目 | 現状 | 出典 |
| --- | --- | --- |
| Profile | 組み込み 3 つ（paper-single 88mm、paper-double 180mm、presentation-16x9）。項目は `page.maxWidth` / `maxHeight`、`margin`、`typography.minFontSize` / `minScaledFontSize`、`layout.*` | `src/core/profile/builtin.ts`、`schema.ts` |
| 高さ | paper 系はどちらも `maxHeight: 220mm`。根拠は、本文の高さ 235〜250mm から凡例の分を引いたもの | `builtin.ts` の `PAPER_MAX_HEIGHT` |
| 最小の文字 | paper 系 7pt、`fit: scale` のとき印刷時 5pt（#167 の参照図が 4.8〜6pt だったことによる利用者の判断）。presentation 14pt | 同上、設計 §6.48 |
| 利用者の Profile | **書けない。** 組み込みだけで、`figure.profile` は名前だけを受け付ける | `src/core/figure/schema.ts`（`profile: z.string()...describe("Built-in output profile name.")`） |
| 縮小 | `figure.fit: scale` は幅だけに合わせて縮める。高さには合わせない | 設計 §6.48 |
| `geometry/heavy-scaling` | 縮小**率** < 90% で info | `src/lint/geometry/rules.ts` |
| `geometry/text-too-small` | 印刷時の文字の大きさを、Profile の下限と比べる（error） | 同上 |
| `geometry/dead-space` | 内容の外接矩形の 27% 以上、かつ両辺 10mm 以上の空き矩形（info） | `dead-space.ts`、設計 §6.96 |
| 線幅 | 最小の検査なし。paper テーマの辺は 0.5pt なので、70% に縮めると 0.35pt になり、APS・ACS・ICML の 0.5pt を割る【推論】 | `src/core/theme/builtin.ts` |
| 文字の最大 | 検査なし。paper テーマの見出しは 9pt で、Nature の最大 7pt を超える | 同上 |
| 高さの予算・置き場所 | **表す手段がない** | — |

### 5.2 何を表し、何を検査するか

| 項目 | 表すべきか | lint で判断できること |
| --- | --- | --- |
| 置き場所の幅 W | 既にある（Profile） | 既にある（`exceeds-page-width`） |
| 高さの上限 Hmax | 既にある | 既にある（`exceeds-page-height`） |
| 高さの予算 Hbudget | **足す**（図ごとの値。媒体ではなく、その論文の都合） | 予算を超えたら warning。予算に対する比と、予約する面積を info で示す |
| 媒体の最小の文字 Fmin | **図ごとに上書きできるようにする**（AAAI 9pt、PLOS 8pt、Nature 5pt） | 最終的な文字の大きさで判定する（縮小率では判定しない） |
| 最大の文字 Fmax | 任意（Nature 用） | 最大を超える文字を info |
| 最小の線幅 Lmin | 任意 | 印刷時の線幅（線幅 × 縮小率）が Lmin 未満なら warning |
| 紙面の予約の仕方 | 全幅か 1 段か（Profile の性質） | 全幅の図で幅を大きく使い残し、かつ高さが予算に近いとき info（「幅の X% を使わず高さ Y mm」） |
| 縦横比 | **表さない**（規定があるのは graphical abstract だけ。必要ならそのための Profile にする） | — |

### 5.3 選択肢

**A. Skill の文章だけを直す**（スキーマ・lint は変えない）

- 利点: 費用が最も小さい。固定規則を外し、§4 の手順を書く。
- 欠点: Fmin と Hbudget を数値で扱えない。エージェントの目視に頼る。ばらつきが大きい（§6.9）ことへの対策にならない。

**B. 媒体ごとの組み込み Profile を増やす**（`nature-single`、`ieee-double`、`aaai-single` など）

- 利点: 名前を選ぶだけで済む。規定の数値（幅・Fmin・Lmin・Fmax）を正しく持てる。
- 欠点: 組み合わせが増え続ける（媒体 × 置き場所）。規定は版ごとに変わる（Science の 1 段の幅は版によって 5.5〜9cm）。高さの予算は媒体ではなく論文ごとの値なので、Profile に入らない。

**C. 図に `figure.target` を足す**（Profile は媒体の大枠、target はこの図の置き場所の細部）

```yaml
figure:
  profile: paper-double
  target:
    height: 60mm          # この図に割ける高さ（予算。上限ではない）
    minFontSize: 9pt      # 媒体の最小（Profile の値を上書き。小さくはできない?※）
    minLineWidth: 0.5pt   # 任意
```

- 利点: 予算と媒体の最小を、図ごとに数値で書ける。lint が予算に照らして判断できる。Profile の数は増えない。
- 欠点: スキーマが増える。Profile の値より小さい Fmin を許すかを決める必要がある（※ 5pt の媒体のために 7pt を下げるか）。
- lint の例:
  - `geometry/exceeds-height-budget`（warning）。
  - 予約する面積・幅の使い方の info。
  - `text-too-small` / `heavy-scaling` の基準に target.minFontSize を使う。

**D. 利用者が Profile ファイルを書けるようにする**（`figure.profile: ./venue/aaai-column.yaml`）

- 利点: 任意の媒体に対応でき、組み込みは少ないまま。Profile の形式（v1）は既に検証つきで定義されている。
- 欠点: 高さの予算は、やはり図ごとの値で入らない。ファイルを配る手間がある。Skill からエージェントが媒体の数値を調べて書くことになり、誤りの余地がある。

**E. lint の判定を、縮小率から最終的な文字の大きさへ変える**（A〜D のどれとも組み合わせられる）

- `geometry/heavy-scaling` の 90% は、媒体と無関係な値である。
  - 7pt の媒体: 90% でも、7pt の辺のラベルは 6.3pt になって割る。
  - 5pt の媒体: 75% でも、8pt の本文は 6pt になって十分。
- 提案: 「最終的な最小の文字が Fmin の何倍か」（余裕）で info を出し、縮小率はメッセージの補足にする。

### 5.4 推奨

**E + C を中心にし、B は少数（必要が確かめられた媒体）にとどめ、D は後で検討する。A は必ず行う。**

1. **A（Skill）**: §5.5 の記述を直し、§4.3 の手順（制約 → 候補 → 測る → 硬い制約 → 比べる → 理由を報告）を「Plan the layout」に置き換える。
2. **E（lint）**: `heavy-scaling` を「最終的な文字の余裕」による診断に改める（または、それを加える）。縮小した図の印刷時の線幅も測る（Lmin がある場合だけ判定）。
3. **C（`figure.target`）**: 最初は `height`（予算）と `minFontSize`（引き上げのみ）の 2 つにする。lint は予算を超えたら warning、予約する面積と幅の使い方を info にする。Fmin を Profile より**下げる**ことは、今回は認めない（下げる方向の判断は §6 の評価のあとにする）。
4. **figure-format.md の表の誤り**（paper 系の Max height「—」）を直す。
5. B と D は、利用者が実際に媒体の数値を必要としたとき（AAAI の 9pt、NeurIPS の 139.7mm など）に、どちらで受けるかを決める。

採らない案:

- **縦横比の診断**: 規定がない。内容が形を決めるので、縦横比そのものを良し悪しの基準にすると、今回と同じ固定規則の失敗を繰り返す。
- **高さに合わせた自動縮小**: 設計 §6.48 の判断（高さの超過は配置で直す問題）を変える理由が見つからない。

### 5.5 直すべき Skill の記述

| # | 場所 | 現在の記述 | 問題 | 方向 |
| --- | --- | --- | --- | --- |
| 1 | `layout-tips.md` Design principles「Fit the page」 | 「`paper-single` (88mm) suits a column, portrait or square; `paper-double` (180mm) a wide, short figure (usually under about 90mm tall).」 | 縦長・正方形・90mm のどれにも出典がない。全幅の図の上限は 170〜234mm。1 段の図も横長でよい | 置き場所の W・Hmax・Fmin と、予約する紙面で判断する、と書く |
| 2 | 同上 | 「Wrap a long chain into rows rather than shrink it. … `fit: scale` last.」 | 折り返しと縮小には順位がない。全幅の図では折り返すと予約する面積が増える（DETR で 1.6〜1.9 倍） | §4.4 の表（費やすもの・条件）に置き換える |
| 3 | `layout-tips.md` Plan the layout の手順 2 | 「a pipeline left to right on `paper-double`, top to bottom or in two rows on `paper-single`」 | 置き場所 ⇒ 形の固定規則 | 「候補を作る型」として列挙し、選ぶのは手順 4 の比較で、と書く |
| 4 | 同 手順 4 | 「aspect ratio against the profile」 | Profile は縦横比を持たない | 「高さの予算・予約する面積・最終的な文字」に置き換える |
| 5 | `layout-tips.md`「Direction vs. target width」 | 「`paper-single` (88mm): at most about 3 nodes side by side; use `direction: down` for any chain of four or more.」 | 短いラベルでの実測を、規則にしている。ラベルの長さ・縮小・折り返しで変わる | 実測の表は残し、「use down for any chain of four or more」を候補の一つに弱める |
| 6 | `SKILL.md` 手順 3 の箇条 | 「A chain of 4+ nodes laid out `right` does not fit `paper-single`; prefer `down`」 | 同上 | 同上（「often too wide; measure and compare with down or two rows」） |
| 7 | `layout-tips.md`「Too wide with `right`, too tall with `down`」 | 「When a long flow overflows both ways, wrap it」 | 折り返しを唯一の解にしている（短くする・まとめる・縮める・分ける、の比較がない） | 選択肢の一つとし、§4.4 へ誘導する |
| 8 | `layout-tips.md`「Shrinking」と「Paper figure recipe」の作業の順 | 「Prefer re-arranging when it fits without shrinking」「`fit: scale` last if still too wide」 | 縮小を最後の手段に固定している。Fmin の小さい媒体では、縮小が最も紙面を節約する | 最終的な文字の大きさと媒体の Fmin で判断する、と書く |
| 9 | `figure-format.md`「Themes and profiles」の表 | paper-single・paper-double の Max height を「—」 | **事実の誤り**。コードでは 220mm（`PAPER_MAX_HEIGHT`） | 220mm に直す |

あわせて、次の 3 か所も直す。

- `SKILL.md` の「Target」の箇条は、置き場所として 3 つ（1 段・全幅・スライド）しか挙げていない。1 段組みの論文（NeurIPS の 139.7mm）、1 ページ目の概要図、README、媒体の Fmin を尋ねる項目を足す。
- `diagnostics.md` と `layout-tips.md` の heavy-scaling の説明（「below 90%」）は、§5.4 の 2 に合わせて直す。
- ラベルの長さ・まとめる・分けるといった内容に関わる変更は、既に「When to stop and ask」で利用者に確かめることになっている。§4.4 の表からもそこへ誘導する。

### 5.6 PaperBanana から取り入れるもの

PaperBanana（Zhu ら、arXiv:2601.23265）は、方法の説明文と図の説明文（caption）から、VLM と画像生成モデルでラスター画像の方法図を作る枠組み。Sumi（ベクター・コード・決定的な描画）とは目的が違うが、工程と評価には参考になる点がある。

**論文の工程**（§3）:

- **Retriever**: 参照図の集合から、分野と図の型が近い例を選ぶ（「visual structure being prioritized over topic similarity」）。
- **Planner**: 例から学んで、図の詳細な説明文を作る。
- **Stylist**: 参照集合全体から要約した「Aesthetic Guideline」（色・形・線・配置・文字）で、説明文を直す。
- **Visualizer + Critic**: 画像を作る。Critic は「inspects it against the original source context to identify factual misalignments, visual glitches」し、直した説明文を返す。これを T 回（既定 3 回）繰り返す。
- 非公式実装は、このほかに次を足している（論文にはない）。
  - 任意の Input Optimizer（Context Enricher が本文を「components, flows, groupings, I/O」に構造化し、Caption Sharpener が caption を具体化する）。
  - 媒体別の style pack（neurips / icml / acl / ieee）。

**論文の結果で、Sumi に関係するもの**（§5.4 の除去実験、§9）:

- Stylist は簡潔さ（+17.5）と見た目（+4.7）を上げたが、**内容の正しさを 8.5 下げた**（「visual polishing sometimes omits technical details」）。それを Critic が取り戻した。見た目の指示と内容の点検は、組で使う必要がある。
- 参照図をランダムに選んでも、意味で選んだときとほぼ同じだった（「providing general structural and stylistic patterns is more critical than precise content matching」）。
- 最も多い誤りは、細かな接続（「misaligned start/end points or incorrect arrow directions」）で、Critic も見落としやすい。

**Sumi の Skill の工程との対応と、取り入れるもの:**

| PaperBanana | Sumi の Skill（現状） | 取り入れるもの |
| --- | --- | --- |
| Input Optimizer（要素・流れ・グループ・入出力に構造化） | Plan the layout 手順 1（要素と役割を列挙） | 手順 1 の出力を、**内容の点検表**（要素・辺と向き・入出力）として残す。§4.2 の構造の量（n、s、b、d、p）もここで数える |
| Retriever + Planner | Plan the layout 手順 3〜4（ASCII の候補 2 つ） | 参照図の検索は採らない（§6.8 の汚染の問題）。候補作りに §4.3 の型の一覧を使う |
| Stylist（媒体別の style guide） | Design principles、paper テーマ | 見た目は Theme が決めるので、style guide の多くは不要。**媒体別に要るのは見た目ではなく数値（W・Hmax・Fmin・Lmin）**で、それは §5.4 の C / E で扱う |
| Critic（元の内容と照らす） | `fmt → lint → render → preview` の目視 | **描画後の内容の点検を、明示の段にする。** 点検表の各項目を、(1) YAML の節点と辺、(2) 描画した PNG（**印刷時の大きさで**）の両方で確かめる |
| 生成して選ぶ（論文 §9、付録 C） | 1 つの図を直していく | 候補ごとに実際に描いて測る（§4.3 の 3）。評価でも、複数回の中から選ぶ運用と、1 回で決める運用を分けて測る |

非公式実装の venue pack（`data/guidelines/*/venue.yaml`）には、IEEE・ACL・ICML のすべてに `aspect_ratio: "4:3"` が既定値として書かれている。これは、この調査で避けるべきとした「置き場所 ⇒ 形」の固定値の例である。

依頼文にあった「Opus の図が encoder → decoder の矢印を落とした」件も確かめた。既存の DETR 4 図の YAML には、すべて `encoder → decoder` の辺がある。2 回目の Opus の図では、その矢印が印刷時に約 2.5mm と短く、全体を縮小表示した PNG では見落としやすい（拡大すると描かれている）。これは内容の誤りではなく、**読みやすさの問題が内容の誤りに見えた例**である。だから点検は、YAML と、印刷時の大きさの画像の両方で行う必要がある。

この件が別の実行（ViT や途中の版）でのことなら、その出力でも同じ 2 通りの点検をすればよい。DETR 1 回目の Opus の途中の版（v1〜v5）にも、この辺はあった。

---

## 6. 評価の方法

### 6.1 これまでの評価の問題

| 問題 | 影響 | 対策 |
| --- | --- | --- |
| 1 題材（DETR / ViT） | 題材固有の性質を、一般の傾向と見誤る | 内容の型と置き場所を変えた題材の組（§6.2） |
| 1 条件 1 回 | Opus は 2 回で配置がまったく違った。ばらつきを改善・悪化と見誤る | 各条件 5 回（§6.3） |
| 図を見てから基準を決めた | 見た結果に合わせた基準になる | 基準を事前に固定し、コミットしてから描かせる（§6.4） |
| 描いた者が分かる状態で採点 | 期待による偏り | 盲検（§6.5） |
| 有名な題材 | モデルが元の図を覚えている可能性 | 架空の題材を主にし、有名な題材は対照として扱う（§6.2） |

### 6.2 題材の組

方針:

- 内容の型 3 種 × 置き場所 3 種の 9 題に、記憶の対照 1 題を加えて 10 題にする。
- **同じ内容を別の置き場所で描かせる**ことで、「置き場所によって形を変えられるか」を直接測る。
- 内容の記述は、この評価のために書いた架空の方法・仕組みにする。実在の論文に似ないよう、要素の名前と数を変える。
  - 例: 「音声と加速度から転倒を検出する」架空の多段の流れ。

| 内容の型 | 構造（§4.2） | 分野 |
| --- | --- | --- |
| C1 長い主経路 + 側の入力 + 学習時の枝 | n ≈ 9、s = 2、b = 3、p = 1〜2 | ML（架空の検出・生成モデル） |
| C2 階層 + 繰り返し | d = 2（全体と拡大）、b = 4、n ≈ 5 | システム（架空の分散ストレージの書き込み経路）または生命科学（架空の解析パイプラインの段と道具） |
| C3 複数パネルの工程 | p = 3（試料の準備 / 測定 / 解析）、各パネル n ≈ 3〜4、分岐あり | 生命科学・化学（架空の実験の工程） |

| 置き場所 | W | Fmin | 高さの予算（題材に書く） | 想定 |
| --- | --- | --- | --- | --- |
| P1 2 段組みの 1 段 | 88mm | 7pt | 80mm | IEEE / ACM 型 |
| P2 2 段組みの全幅 | 180mm | 5pt（縮小を認める） | 70mm | Nature 型（Hmax 170mm） |
| P3 スライド 16:9 | 338.7mm | 18pt | 190mm（1 枚） | 講演 |

- **記憶の対照 T0**: DETR を全幅（P2）で描かせる。既存の題材なので、記憶の影響を、架空の題材との差で見る。元の図に似ているか（主な配置が一致するか）も記録する。
- Sumi がスライドに 18pt の Fmin を表せないうちは、P3 は slides テーマ（16pt）で描き、18pt との差を別に記録する。§5.4 の C が入れば `target.minFontSize` で書く。
- 将来は README（P4、表示幅 830px）とポスター（P5）を足す。今回は、費用を抑えるために外す。

### 6.3 条件と回数

| 要因 | 水準 |
| --- | --- |
| 題材 | 10（C1〜C3 × P1〜P3、T0） |
| モデル | 2（Opus、Sonnet） |
| Skill の版 | 2（現行 = 基準、§5 を反映した版）。ただし第 1 段階は現行だけ |
| 回数 | 各条件 5 回（独立のセッション、同じ指示文） |

- **第 1 段階（基準とばらつきの測定）**: 10 題 × 2 モデル × 5 回 = **100 回**。
  - 自動指標の、回どうしの標準偏差を条件ごとに求める。
  - これを使って、第 2 段階で差を検出するのに要る回数を見積もる。
- **第 2 段階（Skill の変更の効果）**: 新しい Skill で同じ 100 回を描かせ、第 1 段階と比べる。
  - 回数は、第 1 段階のばらつきから決め直す。目安: 主要な指標の差を、回どうしの SD の 1 倍程度で見分けるには、各条件 5〜8 回【推論。正規近似で検出力 0.8、両側 5% のとき 1 群 16 回が要るが、題材をまたいでまとめれば 1 条件 5 回 × 10 題で足りる】。
- 指示文は全条件で同じ形にし、置き場所の欄（W・Fmin・高さの予算・媒体）だけを変える。指示文は、DETR の `task.md` と同じ構成にする（内容の箇条、元の図を見ない、リポジトリを読まない）。

### 6.4 採点の基準（事前に固定する）

3 層に分ける。第 1 層・第 2 層は図を見る前に機械的に決まり、第 3 層だけが人の判断になる。

**第 1 層: 自動指標**（SVG と `sumi render --json` から計算する。`pilot-detr.csv` の列）

| 指標 | 操作的な定義 | 判定 |
| --- | --- | --- |
| 収まり | 印刷時の幅 ≤ W、高さ ≤ Hmax | 合否 |
| 高さの予算 | 印刷時の高さ ÷ 題材の予算 | 連続値（1 以下が望ましい） |
| 予約する面積 | 全幅の図は W × 高さ、1 段の図は段の幅 × 高さ、スライドは 1 枚 | 連続値（小さいほどよいが、文字との交換） |
| 最終的な本文の文字 | テーマの本文の大きさ × 縮小率 | Fmin 以上で合格。余裕は Fmin に対する比 |
| 最終的な最小の文字 | 描画されたすべての `<text>`（添字を除く）の最小 × 縮小率 | 同上 |
| 最終的な最小の線幅 | 描画された線幅の最小 × 縮小率 | 0.5pt 以上を記録（判定は参考） |
| 幅の使い方 | 印刷時の幅 ÷ W | 全幅の図だけ記録 |
| 空白 | `geometry/dead-space` の件数と最大の面積比 | 記録 |
| 交差 | `layout/edge-crossing` の件数 | 記録 |
| 主経路の向きの変化・逆行 | 題材に定めた主経路（入力 → 出力の辺の列）の各辺の向き（上下左右）が変わる回数と、最初の向きと逆になる区間の数 | 記録 |
| lint | error / warning の件数 | 記録 |

**第 2 層: 内容の点検表**（題材ごとに事前に書く）

- 項目は 3 種類:
  - **要素**: その要素がある。
  - **関係**: 辺があり、向きが正しい。
  - **禁止**: 内容にない接続や要素を作っていない。
- 例: DETR の 12 項目（§6.9）。
- 2 人が独立に、(a) YAML、(b) 印刷時の大きさの PNG で確かめる。
- (a) と (b) が食い違ったら（YAML にはあるが読めない）、内容ではなく**読みやすさの欠陥**として記録する（§5.6 の encoder → decoder の例）。
- 点数は満たした項目の割合とし、禁止の違反は別に数える。

**第 3 層: 盲検の対比較**（人。§6.5）

同じ題材・置き場所の 2 図を並べ、次を尋ねる。

| 観点 | 問い | 主要 / 副次 |
| --- | --- | --- |
| 内容の正しさ | 内容の記述に照らして、誤り・欠落・作り事が少ないのはどちらか | 主要 |
| 読みやすさ | 主経路を最初から最後まで、迷わず速くたどれるのはどちらか（印刷時の大きさで） | 主要 |
| 紙面への収まり | 指定の置き場所に載せたとき、紙面の使い方が良いのはどちらか（ページの模型の上で） | 主要 |
| 簡潔さ | 余計な文字や要素が少ないのはどちらか | 副次 |
| 見た目 | 論文に載せたいのはどちらか | 副次 |

各観点の答えは「A」「B」「どちらも良い」「どちらも悪い」の 4 択（PaperBanana の付録 B と同じ）。

総合は PaperBanana の段階的な規則に従う。主要の観点で勝者が決まれば（2 つ以上勝ち、残りは引き分け以上）それを総合とし、決まらなければ副次で決める。

### 6.5 盲検と提示

- 図のファイル名・YAML・報告文は見せず、PNG だけを提示する。左右の順は無作為にする。
- **印刷時の大きさで、ページの模型の上に置いて見せる**。
  - 全幅なら A4 / Letter の 2 段組みの版面（ダミーの本文）の上部、1 段ならその段に置く。
  - スライドは 16:9 の枠に置く。
  - 縮小表示した PNG だけで比べると、紙面の費用と最終的な文字の大きさが見えない（今回の DETR の評価の弱点）。
- 採点者は 2〜3 人。モデル名・Skill の版を知らない人にする（作業者は第 1・第 2 層だけを担当する）。
- 採点者 1 人あたり、同じ題材の 5 回 × 2 モデル = 10 図から、無作為の 15 組程度を比べる（全組 45 は多い）。

**VLM の判定者**は補助として使う。

- 第 3 層と同じ問いを、PaperBanana の付録 H の判定文に倣って与える。人の参照図はないので、候補どうしの対比較にする。
- 印刷時の大きさ（mm、pt）を文字で添える。画像だけでは、VLM に物理的な大きさが分からないため。
- 左右を入れ替えて 2 回問い、食い違えば引き分けにする（位置の偏りへの対策）。
- 描いたモデルと同じ系列のモデルを判定者にしない（自己の出力を好む偏りへの対策）。
- 人の採点と重なる組で、一致度（Kendall の τ、Cohen の κ）を報告する。一致が低ければ、VLM の結果は使わない。

### 6.6 集計

- **第 1 層**: 条件（題材 × モデル × Skill の版）ごとに、5 回の平均・標準偏差・最小と最大を示す。
  - 版の差は、題材を変量効果とする混合モデル、または題材ごとの差の並べ替え検定で見る。
  - 95% の区間は、回を単位にした bootstrap で求める。
- **第 2 層**: 項目の達成率を、条件ごとに示す。禁止の違反は件数で示す。
- **第 3 層**: 対比較の勝率（引き分けは 0.5）。Bradley–Terry モデルで条件の強さを推定する。
  - 採点者間の一致（Krippendorff の α）を報告する。
- **判断の規則（事前に決める）**: 新しい Skill を「良くなった」とするのは、次の 2 つを両方満たすときだけ。
  - 主要の観点の勝率の 95% 区間が 0.5 を超える。
  - 内容の点検表の達成率が下がらない（差の区間の下限が −5 ポイント以上）。
- 結果は、条件ごとのばらつき（同じ条件の最良と最悪の図）も並べて示す。平均だけで結論を出さない。

### 6.7 費用と時間の見積もり

1 回の作図の実測値は、手元に残っていない。下の数字は、過去の dogfooding（DETR・ViT）での作業の長さからの見込みで、第 1 段階の最初の 10 回で測り直す【推論】。

| 項目 | 見積もり |
| --- | --- |
| 作図 1 回 | 15〜40 分（Sonnet は短め、Opus は長め）。トークンは主に Skill と YAML・画像の読み込み |
| 第 1 段階 100 回 | 並列 5 本で 6〜12 時間 |
| 第 2 段階 100 回 | 同上 |
| 第 1 層の計算 | 自動（スクリプト 1 本。1 図数秒） |
| 第 2 層 | 1 図 3〜5 分 × 2 人。200 図で 2 人 × 10〜17 時間 |
| 第 3 層 | 1 組 1〜2 分。採点者 3 人 × 10 題 × 15 組 × 2 段階 = 900 判定で、1 人あたり 5〜10 時間 |
| VLM の判定 | 1 組 × 観点 5 × 左右 2 回。1 段階 150 組で 1,500 呼び出し |

- **金額**: 作図 1 回のトークン量 × 単価 × 回数で計算する。トークン量は第 1 段階の最初の 10 回で実測してから見積もる。
- **縮小版**: 費用を抑えるなら、まず 4 題（C1・C3 × P1・P2）× 2 モデル × 5 回 = 40 回で第 1 段階を行う。そのばらつきで、全体の規模を決め直す。

### 6.8 PaperBanana の評価を使えるか

**評価の方法**（論文 §4.2、付録 B・H）:

- 判定者（Gemini-3-Pro）が、モデルの図と**人の描いた参照図**を比べる。
  - 観点は内容の正しさ（Faithfulness）・簡潔さ（Conciseness）・読みやすさ（Readability）・見た目（Aesthetics）の 4 つ。
  - 各観点を勝ち / 負け / 引き分け（100 / 0 / 50）で採点する。
  - 内容の正しさと読みやすさを主要、簡潔さと見た目を副次として、段階的に総合を決める。
- 判定者どうしの一致: Kendall の τ は Gemini-3-Flash と 0.45〜0.60、GPT-5 と 0.42〜0.47。
- 人（2 人の合議）との一致: τ = 0.41〜0.57。
- 盲検の A/B 試験: 人 3 人、50 件。

**再利用できるもの:**

- 観点の分け方と、段階的な集計（§6.4 の第 3 層に採った）。
- 付録 H の判定文の形。
  - 定義 → 「Veto Rules」→ 判定の選択肢 → JSON。
  - 読みやすさの Veto Rules には、Sumi の lint と重なる項目が多い（文字の重なり、スパゲッティ状の辺、小さすぎる文字、「Unbalanced empty corners」）。
  - 読みやすさを「baseline requirement」とし、違反がなければ「Both are good」を既定にする点も、判定のぶれを抑える工夫として使える。
- 「4 択（両方良い・両方悪い）」の人の採点の形。

**そのまま使えないもの:**

| 点 | 理由 |
| --- | --- |
| 人の参照図との比較 | 架空の題材には参照図がない。有名な題材では、参照図に似せること自体が記憶の影響を受ける。候補どうしの比較にする |
| 物理的な大きさ | 判定は画像だけで行うので、mm や pt が分からない。「Illegible Font Size」も画像の中での相対的な判断になる。置き場所の評価（この調査の主題）が測れない |
| **PaperBananaBench の範囲** | 方法図の縦横比を **1.5〜2.5 に限っている**。理由は「methodology diagrams typically require wider landscape layouts」と、画像生成モデルの制約、人の図だと見抜かれるのを防ぐため。生成側も参照図の縦横比に合わせている（付録 C）。だから、置き場所で形を変える能力（1 段の縦長、1 ページ目の 1 段の図など）は評価できない |
| 題材の分野 | NeurIPS 2025 の論文だけ（1 段組み、本文の幅 139.7mm） |
| 汚染 | 元の論文と図は公開されている。モデルの学習期間によっては、元の図を見ている可能性がある。ベンチマーク自体も 2026-01 から公開されている |
| ライセンス | Hugging Face のデータセットカード（`dwzhu/PaperBananaBench`）は Apache-2.0 と表示している。ただし中身は第三者の論文の図と本文で、個々の論文のライセンスはさまざまである。リポジトリに入れるのは避ける。使うなら、手元で取得して評価にだけ使う |
| 判定者の偏り | 論文自身が、見た目の観点は文章の指示だけでは人の好みに合わせにくいと書いている（§9）。細かな接続の誤りは判定者も見落とす（§9） |

**VLM の判定と人の盲検の組み合わせ方**（§6.5 に反映した）:

- 主の判断は人の盲検にする。
- VLM は全組を判定する補助とし、人と重なる組で一致度を測ってから使う。
- 判定文には、印刷時の大きさを文字で添える。左右を入れ替えて 2 回問う。作図と同じ系列のモデルを判定者にしない。

**参照図の検索が役立つ場合と、評価を汚す場合:**

| 状況 | 判断 |
| --- | --- |
| 製品の Skill で、利用者が特定の参照図や様式を指定した | 役立つ（Skill は既に「reference figures」を、指定があるときだけ使う方針） |
| 評価の作図で、題材と同じ論文や同じ分野の図を見せる | 汚す。評価の作図では参照図を与えない（DETR の `task.md` のとおり） |
| 一般的な様式の例（題材と無関係な図）を Skill に入れる | PaperBanana では、ランダムな参照でも効果がほぼ同じだった。題材と無関係な見本は、評価を汚しにくい。ただし、見本の形（横長など）に引きずられる恐れがあるので、置き場所の異なる見本を混ぜる |

### 6.9 試行: 既存の DETR 4 図に自動指標を当てる

`pilot-detr.csv` の値。現在の CLI（このブランチ）で描き直して求めた。主経路は「画像 → … → 予測」とし、学習時のマッチングは含めない。

| 図 | 印刷時の大きさ | 縮小 | 本文 / 最小 / 添字（pt） | 幅の使い方 | 予約する面積 | 情報の診断 | 交差 | 向きの変化 / 逆行 | 内容（12 項目） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| detr1-opus | 167.0 × 54.3mm | 1.0 | 8.0 / 7.0 / 5.6 | 93% | 9,779mm² | `align-grew-figure` | 0 | 3 / 0 | 12 |
| detr1-sonnet | 180.0 × 54.0mm | 0.804 | 6.4 / 5.6 / 4.5 | 100% | 9,727mm² | `heavy-scaling`、`script-too-small`、**`dead-space` 28.3%** | 0 | 0 / 0 | 12 |
| detr2-opus | 180.0 × 46.1mm | 0.854 | 6.8 / 6.0 / 4.2 | 100% | 8,296mm² | `heavy-scaling`、`script-too-small`、`group-empty-area` | 1 | 0 / 0 | 12 |
| detr2-sonnet | 141.8 × 86.8mm | 1.0 | 8.0 / 7.0 / 5.6 | 79% | 15,620mm² | なし | 0 | 2 / 1 | 12 |

内容の 12 項目（事前に `task.md` から作れるもの）:

1. 入力画像
2. CNN → 特徴マップ
3. 1×1 conv でチャンネルを減らす
4. 平坦化して列にする
5. 位置エンコーディングを加えて encoder へ
6. encoder
7. decoder が N 個の object queries を受ける
8. decoder が encoder の出力を参照する
9. N 個の出力に共有の FFN
10. クラスと箱の予測
11. ∅（no object）
12. 学習時の二部マッチング

注記:

- 4 図とも 12 項目を満たした（筆者 1 人の判定）。
- detr1-sonnet は、予測からマッチングへの辺が ŷN からしか出ておらず、曖昧。
- detr2-sonnet は、特徴マップを独立の箱にしていない（「1×1 conv + flatten」に含む）。

この試行から分かったこと:

- **内容の点検表では、4 図に差がつかない。** 差は、予約する面積（最大 1.9 倍）、最終的な文字（6.4〜8pt）、向きの乱れにある。だから、置き場所の評価には第 1 層の指標が要る。
- **現在の lint は、detr2-sonnet（幅の 21% を使わず、高さが 1.6〜1.9 倍で、主経路が逆行する図）に何も出さない。** 「Skill の規則に従った図」が、lint からも良い図に見えてしまう。§5.4 の C（予算と面積の info）は、この穴を埋めるためのもの。
- **同じモデルの 1 回目と 2 回目で、形がまったく違う**（Opus: 階段状 → 一列、Sonnet: 一列 → 2 段）。間に Skill の変更（#323）があるので、ばらつきと Skill の効果を分けられない。§6.3 の 5 回の反復と、Skill の版を固定した比較が必要な理由である。

この試行の限界:

- 各条件 1 回だけ。
- 採点者は筆者 1 人で、盲検ではなく、図を見たあとに指標を当てた（ただし指標は §6.4 で定義したもので、この 4 図に合わせて作ってはいない）。
- 主経路の向きの数え方は、目視による。
- 第 3 層（人の対比較）は行っていない。

---

## 7. 未解決の点

1. **Fmin を Profile より下げることを認めるか。**
   - Nature（5pt）や ACS（4.5pt）では、縮小しない 7pt の設計に意味がない。
   - Sumi の 7pt は、縮小しない図で読みやすさを保つ既定値として妥当でもある。
   - `target.minFontSize` を下げる方向に使えるようにするかは、§6 の評価（P2 で 5pt を許した条件の結果）を見て決める。
2. **最大の文字（Nature 7pt）をどう扱うか。** paper テーマの見出し 9pt は、Nature の規定を超える。媒体別の Profile（B）で持つか、`target` に入れるか。
3. **1 段組みの論文の置き場所（NeurIPS / ICLR の 139.7mm）を組み込みにするか。** paper-double をそのまま使うと 0.78 倍に縮む。B と D のどちらで受けるか。
4. **Web / README の置き場所。** 物理的な大きさがなく、表示幅で決まる。px と pt の換算（表示幅 830px など）を Profile に持つか。
5. **主経路の自動判定。** §6.4 の向きの変化を lint で出すには、「主経路」を図に書く手段か、推定の方法が要る（例: 最も長い経路、または `emphasis` の辺）。
6. **予約する面積の重み。** 全幅の図の高さ 1mm と 1 段の図の高さ 1mm では、本文が失う行数が違う（全幅は 2 段分）。この換算を比較に入れるか。
7. **第 3 層の採点者。** 盲検の人の採点者を、誰が（社内か外部か）何人で担うか。費用の見積もり（§6.7）は、ここで大きく変わる。
8. **§3 の抜粋の確認。** 403 で読めなかったページ（Science、PNAS、Cell、ACM、Springer、RSC）の値は、公式の PDF を手元で入手して確かめる必要がある。特に Science は、版ごとに 1 段の幅が 5.5〜9cm と食い違う。
