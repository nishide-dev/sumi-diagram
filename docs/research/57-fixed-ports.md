# #57 カスタム部品の固定ポートを提供できるか

対象: [#57](https://github.com/nishide-dev/sumi-diagram/issues/57)。#9 の D2 バックエンド、#18 の[輪郭合成調査](18-custom-svg-components.md)、#52〜#55 の実装に対する追加調査。

## 0. 判断

**現行 D2 経路では固定ポートを公開せず、Figure v1 から除外する判断を維持する。ELK 直接利用は技術的に可能だが、採用は別のバックエンド設計として保留する。**

- 調査時点の最新安定版 D2 は、Sumi が固定している **v0.9.0** と同じ。より新しいリリースはなく、一般ノードの名前付き・固定座標ポートの DSL は確認できなかった。未リリースHEADもソースで調査したが、一般ノード向けの公開は見つからなかった。
- **elkjs 0.12.0 では FIXED_POS が機能する**。4方向×flat/同一コンテナ内の8ケースで32ポート位置と32端点がすべて誤差0だった。
- Bunの通常importでは互換性問題があるが、研究用adapterを使った単一バイナリ化は、この環境で成功した。「elkjsは単一バイナリにできない」という理由で不採用にはしない。
- ただし、ELKの座標・経路だけでは Sumi の SVG 出力にはならない。サイズ計測・フォント埋め込み・ラベル配置・矢尻・輪郭・metadata・lintとの統合を担う新しい経路が必要。今回ポート欄だけを先にスキーマへ追加することはしない。

## 1. 調査条件・参照先

2026-10-24、macOS 26.2 / arm64、Bun 1.3.14、Sumi製品の基点 `17c2352`、固定D2 v0.9.0。実験の再現手順は [`research/57-fixed-ports/`](../../research/57-fixed-ports/README.md)、記録は [`results/report.json`](../../research/57-fixed-ports/results/report.json)。

- [D2最新リリース](https://github.com/d2lang/d2/releases/tag/v0.9.0): v0.9.0、公開2026-09-07。GitHub Releases APIで最新と直近のリリースを確認した。
- [固定D2のソース](https://github.com/d2lang/d2/tree/d5a51743b6d5c00f1ec6f8340003f5d5a6ba4eda): v0.9.0のタグ参照先。
- [未リリースHEAD](https://github.com/d2lang/d2/tree/6a7b4837838a3907604a1d9eec57ee98b6f3cd01): 調査時点。DSLの予約語とELKアダプタを調べたもので、このcommitをビルド・実行したわけではない。
- [ELK Port Constraints](https://eclipse.dev/elk/reference/options/org-eclipse-elk-portConstraints.html): FIXED_POSはnodeのオプション。[Port Anchor Offset](https://eclipse.dev/elk/reference/options/org-eclipse-elk-port-anchor.html)はport位置からの接続点のずれ。
- [elkjsソース・README](https://github.com/kieler/elkjs/tree/ff5771d7165445c42c408bb8a090c8035272218c): 0.12.0のnpm metadataのgitHead。APIとworkerをまとめたelk.bundled.js、FakeWorker、実workerの区別を確認した。

最新の状態は時間とともに変わる。以下の採否は上記の版・commitに対する判断である。

## 2. D2 の一般ポートと内部ポートの区別

固定版と調査HEADの [d2elklayout](https://github.com/d2lang/d2/blob/6a7b4837838a3907604a1d9eec57ee98b6f3cd01/d2layouts/d2elklayout/layout.go) には `Ports` / `PortConstraints` と `FIXED_POS` のコードがある。しかし、これは **SQLテーブルの列接続**へ使われる。普通のnodeのエッジはそのnode自身のIDへ接続される。

[DSLの予約語](https://github.com/d2lang/d2/blob/6a7b4837838a3907604a1d9eec57ee98b6f3cd01/d2ast/keywords.go)にも一般のports / source-port / target-portはない。キーを置いてコンパイルが成功しても、ポートとして解釈されたとは限らない。

固定バイナリで次のプローブを実行した。

| プローブ | 結果 |
| --- | --- |
| 通常の矩形a→b | 成功、ノード2つ |
| `a.ports.out: {x: 120; y: 20}` とその参照 | 成功するが、ports/out/x/y は**通常の子ノード**として作られ、計6ノードになる |
| `a.elk.portConstraints: FIXED_POS` | 成功するが、elk/portConstraints が子ノードになり、計4ノードになる |
| edgeに `source-port` / `target-port` | `edge map keys must be reserved keywords` で失敗 |
| SQLテーブルのa.id→b.value | 成功。ただしSQL列専用の内部ポートの対照であり、汎用部品の契約として採用しない |

Sumi v1 も node.ports / edge.fromPort / edge.toPort を `schema/unknown-field` で拒否することを確認した。後処理で任意の点へ端点だけを付け替える案は、ELKが引いた最後の線分以外との整合や障害物回避を保証できないので採らない（#18の判断を維持）。

## 3. ELK 直接利用の測定

### 3.1 依存と固定

elkjs 0.12.0 の npm tarball を、metadataに記載されたsha512で検査して研究専用 `.tools/elkjs/` に展開する。root の依存・lockfileは変更しない。

- npmのruntime dependencies欄は空。Babel / Browserify / Gradle等はライブラリ自身をビルドするためのもの。実workerを使う場合のweb-workerは別の選択肢で、今回のFakeWorker経路では導入しない。
- 配布bundleは **1,609,707 bytes**、sha256は `1222e44f953ce7746af23801e723708f8e6f436b8b377a6a5fc7552f34a307b3`。
- packageのライセンス表示は **EPL-2.0 OR GPL-3.0-or-later**、LICENSE.mdはEPL 2.0。製品へ同梱するなら、採用するライセンスと同梱コードの出典・ライセンス文書・ソースの入手先を、既存のreleaseのNOTICE / licenses方式へ組み込む必要がある。runtime dependenciesが空というだけでbundle内のコードのライセンス確認が完了したとは扱わない。
- 今回のリポジトリへの追加は研究コードと結果のみ。ダウンロードしたパッケージ・そのコードを埋め込んだバイナリはコミット・配布しない。

### 3.2 Bun の互換性

このBunではmain threadにも `self` / `postMessage` が存在する。elkjsのGWT workerはこれを実workerと判断し、CommonJS用のFakeWorkerをexportしない。そのため通常の `new ELK()` は `TypeError: undefined is not a constructor (evaluating 'new _Worker(url)')` になる。

研究用 `load-elk.ts` は固定bundleを変更せず、`self` をundefinedとして字句的に隠すCommonJS wrapperで評価する。Bunのglobal selfを書き換えず、外部moduleのrequireも許可しない。これは **互換adapterを要するという実測**であり、通常importがそのまま製品で使えるという結果ではない。製品採用時はこの境界の保守・起動時の評価・上流での対応を検討する。

### 3.3 固定位置と対照

120×80の矩形2つ、各2ポート、2エッジを使う。portsは寸法0の接続点で、該当する辺の1/4・3/4の位置。rootにlayered / ORTHOGONAL / randomSeed=1 / INCLUDE_CHILDRENを指定する。

4方向 × flat/同一コンテナ内 × FIXED_POS/FREE の16ケースを、同一instance2回・新しいinstance1回の計48layoutで比較した。

| 制約 | ケース数 | 指定local位置との差 | portとedge端点の差 |
| --- | --- | --- | --- |
| FIXED_POS | 8 | 全32ポートで0 | 全32端点で0 |
| FREE | 8 | right/leftで最大33.3333、up/downで最大50 | 全32端点で0（ELKが移動した後のportへ接続） |

コンテナ内ではedgeがrootに宣言されていても、ELKが `container: group` として返し、sectionはgroup相対になる。このoriginを足してportの絶対座標と比較する。単にroot相対と仮定すると誤判定するため、ネットワーク不要の負例付きテストも追加した。

### 3.4 決定性

- 生のJSONは、GWTが追加する内部の **`$H`** が変わるため、同じinstanceで再実行してもバイト一致しなかった。
- node / portのID・座標・寸法、edgeのsource/target/containerとsectionの座標だけを自分の固定順で射影した幾何JSONは、全16ケースで繰り返しとfresh instanceで一致した。reportにはそのsha256を記録する。
- 将来のLayout IRやSVGへは、ライブラリ内部オブジェクトをそのまま直列化しない。対応するフィールドを選んで正規化する必要がある。
- 今回はmacOS arm64のみ。一般の全グラフやOS間の決定性、worker並列実行は未検証。
- fixtureは明示サイズの矩形leaf node 2つ・寸法0のport 4つ・edge 2本のみ。nestedは同一コンテナ内の接続であり、階層をまたぐedge、実寸のportとanchor offset、自動サイズ・ラベル・カスタム輪郭のportはこの実験で保証していない。

## 4. 単一バイナリへの影響

同じbundleをテキストとして静的importし、adapterとプローブを `bun build --compile --minify` で実行ファイルにした。

| 比較 | サイズ |
| --- | --- |
| 最小control実行ファイル | 63,446,114 bytes |
| ELKプローブを含む実行ファイル | 65,064,290 bytes |
| 差 | **1,618,176 bytes（約1.54MiB）** |

`.tools/elkjs/` を一時退避し、空のPATH・別の作業ディレクトリから2回実行した。Bun / NodeがPATHにないことを確認し、16ケースの結果・幾何hashがソース実行と一致した。外部のworkerスクリプト・npmパッケージのファイルを実行時に参照しない経路として、この環境では成立した。

このサイズは**最小実験プログラムとの比較**であり、Sumi製品のサイズ増分の保証ではない。4配布ターゲットでのcompile/smoke、OS間の出力、メモリ・大規模グラフ・起動時間は検証していない。Bun単一バイナリ化の可能性と、製品で必要な実装量は分けて判断する。

## 5. 採用方式の比較

| 方式 | 利点 | 必要な変更・制約 | 今回の判断 |
| --- | --- | --- | --- |
| 現行D2のまま | 既存SVG/フォント/ラベル/metadataと配布を維持 | 汎用固定ポートを公開できない | 維持 |
| D2の汎用ポート対応を上流へ追加／fork | D2の描画を再利用できる | DSL・graph・adapter・rendererの対応、版の追従、全ターゲットのバイナリ・出力検証 | 将来の選択肢 |
| elkjs直接利用 | JSONでFIXED_POSを扱え、今回のBun compileも成功 | Bun互換adapter、IR-first backendとSumi側SVG生成、ライセンス・決定性・4ターゲット検証 | 技術的候補として保留 |
| native GoのELK直接利用 | D2 v0.9.0も [elk-go](https://github.com/d2lang/d2/blob/d5a51743b6d5c00f1ec6f8340003f5d5a6ba4eda/d2layouts/d2elklayout/layout.go) を利用している | TSから利用するbinding／追加helperの配布・ビルドと描画統合が必要。今回直接の実験はしていない | 比較候補として残す |

現在のDiagramBackendは **D2 source入力→D2 SVG出力**で、backend名もd2-cliに限定されている。単にopts.backendを差し替えるだけでは、ELK JSONのnode・port・routeをrenderFigureへ返せない。

ELK用には、Figure IR / Profile / 文字寸法を受け取りnode・port・route・label座標を返すLayout IRと、その座標からSVGを作る経路が必要になる。Sumiのoutline rendererは再利用できるが、通常図形・文字組み・フォント埋め込み・edge label・矢尻のclearance・SVG inspect・PDFへの変換・metadataのbackend識別とhashは別に統合する。今回の測定は**論理portと経路端点**の一致であり、矢尻を含む最終SVGの接触を検証したものではない。

## 6. 将来の互換的な契約案（未実装）

次のような任意フィールドの追加を候補とする。**現在のFigure YAMLでは使えない。**

```ts
// Component manifest: nodeのみ。portsはその部品の意味的な接続点名。
ports?: readonly {
  id: string;
  side: "north" | "east" | "south" | "west";
  offset: number; // 0..1: 横辺は左→右、縦辺は上→下
}[];

// Figure edge: node IDは既存のfrom/toのまま。
fromPort?: string;
toPort?: string;
```

- 参照はnodeごとの名前空間で解決し、未知・重複ID・不正offset・端点の部品にないport・未対応backendを共通Diagnosticでエラーにする。名前は既存ID相当の単純な形式とし、node IDに`.`等で連結して解釈しない。
- 任意フィールドとして加えれば、新しいSumiで古いv1図を読む後方互換を維持できる。古いSumiが新しい欄を読める保証はなく、導入版のrequiresとschema補完を更新する。
- port未指定の図は現行の自動接続と出力を保つ。固定と自動を同じnodeで混在させる方法は、backendのnode単位portConstraintsと合わせて追加の検証が必要。未対応なのに指定を黙って無視しない。
- 自動サイズ・variantの解決後のfootprintから実座標を計算する。カスタム輪郭では辺のoffsetから内向き射線で輪郭との接点を求める方式が候補で、自由なx/yへ最後の端点だけを動かす方式とは区別する。安全領域との非交差・接線・marker・port表示も検査する。
- 最初はnodeのportだけを対象とし、groupのport、レイヤー別port、動的propsでの増減、ユーザー定義コードは後回しにする。label/geometry/portを含むLayout IRができてからmanifestとFigureの契約を確定する。

## 7. 完了範囲

今回の成果物は、D2の現状確認、固定依存を使ったELK直接利用とBun compileの再現実験、採否・互換契約の検討である。製品のschema / dependencies / renderer / 配布を変更せず、設計 §3 の「portsはv1から除外」を現時点では維持する。ELK直接利用が不可能だと結論づけるのではなく、需要と新backendの設計が具体化した時点で再検討する。
