## 概要

ViT Figure 1 の dogfood で詰まった grid span と grid cell の align 未達について、診断の hint が実際の原因と修正方法を示すようにします。既存図の出力を維持するため、span の既定 stretch 化は行わず `center` を維持します。

## 変更点

- 10列 grid の9列/10列 span と列ごとの要素を両方向の straight anchor で接続し、自然幅による `layout/straight-off-side` / `layout/no-route` を再現。
- 該当 hint に対象 ID・span 列数・自然幅と列予約の違い・その grid の `grid.align: stretch` を追加。固定 `props.width` と非伸縮 shape/custom outline/badge は、stretch 単独では直らないことも案内。
- grid 直接 cell と別 stack の item の未達 align に、strut が cell に入らない制限、cell 用/whole-grid 用 wrapper、親の alignment と競合 constraint の確認を案内。
- レビュー対応: 予約 cell の未使用幅と拡張後の straight placement を確認し、span を既に満たす box と span 外の接続には stretch を勧めない。予約矩形は WeakMap に保持し、LayoutIR と描画結果は維持。
- レビュー対応: 非伸縮性を明示幅より先に判定し、40pt幅の circle に幅削除を勧めない。strut の上方向/左方向の制約は start-aligned 親に限定し、end-aligned 親では trailing space で動けることを明記。
- 診断 code・severity・位置・blocker related、layout engine / solver / router の配置・探索は維持。部品・variant・theme・schema の追加なし。
- 回帰テスト、配布 Skill の Grids 節、日本語設計 §6.88 を追加。設計判断は [Issue のコメント](https://github.com/nishide-dev/sumi-diagram/issues/306#issuecomment-6596350723) にも記録。

## 検証方法

- [x] `bun run check` — 既存 research ファイルの13 warningsのみ
- [x] `bun run typecheck`
- [x] `CI=1 bun run test` — 4,146 pass / 13 skip / 0 fail（144ファイル、4159テスト）
- [x] `bun run gallery:check` — 全テーマ×variant を含む231ファイルが最新
- [x] `bun run schema:check`
- [x] `bun src/cli/index.ts catalog --json`
- [x] 対象回帰テスト: 両 anchor 方向、stretch 後の直線 route、固定幅/固定形、nested/group grid、span なし、cell wrapper による解決
- [x] レビュー probe の回帰: 自然幅で span 充足、未使用幅があっても span 外、明示幅 circle、end-aligned 親で上方向へ動く single-item stack、横接続/self-loop の除外
- [x] レビュー修正後の対象61テストが全件成功。HEAD を読み取り専用の baseline として160個の tracked YAMLを比較し、hint以外の診断・成功41件の structured layout と SVG writer 出力がすべて一致
- [x] 修正案の PDF を `pdftoppm` で `.sumi/preview/span-stretch.png` に変換し、文字・端列までの直線接続を目視確認
- [x] 全 repository 160個の `*.sumi.yaml` × 元テーマ/組み込み全5テーマの960ケースを前後比較。成功678ケースの SVG/PDF/picture PPTX、auto 228ケースの D2 が全件 SHA-256 一致。既存の不正 fixture・旧研究構文等282ケースもエラーコード一致、例外0

golden の変更はありません。初回のプレビューと互換性の hash は `.sumi/preview/`、レビュー修正後の検証ログと比較用スクリプト/hash は `.sumi/review/revision-*` に保存しています。一時ファイルはこのworktree内の `.sumi/tmp/` を使用しました。

## 関連 Issue

Closes #306

PR #313（#305）/ #314（#307）と衝突しにくいよう、engine の配置計算は維持し、予約矩形の観測と診断に限定しています。

🤖 Generated with [Claude Code](https://claude.com/claude-code)
