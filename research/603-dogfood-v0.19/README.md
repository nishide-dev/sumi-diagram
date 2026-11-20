# #603 v0.19 の Skill を最近の論文・tech report・技術資料で試す

v0.19.1（立体・平面、`sumi` の白い背景）の Skill どおりに、新しい Opus エージェントが最近の資料から図を 1 枚ずつ作る。別の Opus のレビューと利用者のフィードバックから、Sumi の機能・Skill・lint の改善点を探す。

- 題材は 2025〜2026 年の会議の論文 5 本、tech report 3 本、技術資料 2 本。図の種類と置き場所が偏らないよう選んだ（各資料が実在し、本文を無料で読めることを確認済み）。
- 原図の複製ではなく、資料の本文から図を作る。著者名・所属は図に入れない。
- 各エージェントへの指示は [prompt.md](prompt.md)。Sumi は公開された v0.19.1 のバイナリ、テーマは `sumi`。

## 題材と依頼

| # | slug | 資料 | 種類 | 図にする内容 | 置き場所（profile） |
|---|---|---|---|---|---|
| 1 | nsa | Native Sparse Attention: Hardware-Aligned and Natively Trainable Sparse Attention（ACL 2025 Best Paper）https://arxiv.org/abs/2502.11089 | 密なアーキテクチャ（複数パネル） | 1 つのクエリのキー・値が 3 つの枝（圧縮したブロック、選んだ上位 n ブロック、スライディングウィンドウ）を通り、学習したゲートで混ぜられる流れ。各枝がどのトークンブロックを残すかを横のパネルで示す | 論文 2 段（`paper-double`） |
| 2 | gated-attention | Gated Attention for Large Language Models: Non-linearity, Sparsity, and Attention-Sink-Free（NeurIPS 2025 Best Paper）https://arxiv.org/abs/2505.06708 | 比較・アブレーションの一覧 | softmax attention の層のどこにシグモイドのゲートを置けるか（Q・K・V、SDPA の後、出力射影の後）。採用した「SDPA の後のヘッドごとのゲート」を目立たせる | 論文 1 段（`paper-single`） |
| 3 | deep-crl | 1000 Layer Networks for Self-Supervised RL: Scaling Depth Can Enable New Goal-Reaching Capabilities（NeurIPS 2025 Best Paper）https://arxiv.org/abs/2503.14858 | 学習ループ＋深い層の積み重ね | contrastive RL の学習ループ（actor、環境、replay buffer、状態行動とゴールのエンコーダ、InfoNCE の critic）。エンコーダの 1 つを、N 回繰り返す残差ブロック（Dense・LayerNorm・Swish・skip）の積み重ねとして開いて見せる | スライド（`presentation-16x9`） |
| 4 | lost-multiturn | LLMs Get Lost In Multi-Turn Conversation（ICLR 2026 Outstanding Paper）https://arxiv.org/abs/2505.06120 | 会話・シミュレーションの流れ | 完全に指定された指示をシャードに分け、ユーザーシミュレーターが評価対象のアシスタントとターンごとに進める流れを、1 ターンの基準と比べて示す | 論文 2 段（`paper-double`） |
| 5 | trellis2 | Native and Compact Structured Latents for 3D Generation（TRELLIS.2、CVPR 2026 Best Student Paper）https://arxiv.org/abs/2512.14692 | 立体の体積を含む流れ | メッシュを形と見た目を持つ疎な O-Voxel の格子に符号化し、疎な圧縮 VAE でコンパクトな潜在に縮め、flow matching のモデルで生成して 3D のアセットに戻す流れ | 論文 2 段（`paper-double`） |
| 6 | deepseek-v4 | DeepSeek-V4: Towards Highly Efficient Million-Token Context Intelligence（tech report、2026）https://arxiv.org/abs/2606.19348 | 密なモデルアーキテクチャ | DeepSeek-V4 の 1 ブロック: 交互に置く CSA（compressed sparse attention）と HCA（heavily compressed attention）、通常の残差に代わる Manifold-Constrained Hyper-Connections、共有と routed の専門家を持つ MoE 層 | 論文 2 段（`paper-double`） |
| 7 | deepseek-r1 | DeepSeek-R1: Incentivizing Reasoning Capability in LLMs via Reinforcement Learning（tech report、2025）https://arxiv.org/abs/2501.12948 | 枝分かれのある学習手順 | ベースモデルからの多段の学習: 純粋な RL の R1-Zero の枝、cold-start SFT、推論の RL、rejection sampling と SFT、全場面の RL、小さな dense モデルへの蒸留 | README（`screen-doc`） |
| 8 | kimi-k2 | Kimi K2: Open Agentic Intelligence（tech report、2025）https://arxiv.org/abs/2507.20534 | データの流れ＋基盤 | エージェント用データの合成（実在の MCP ツールと合成したツール、ツールの保管庫、エージェントとタスクの生成、軌跡の rollout、LLM judge による選別）が、同じ場所に置いた RL の学習・推論のループに流れ込む様子 | 論文 2 段（`paper-double`） |
| 9 | mcp-mrtr | MCP specification 2026-07-28: Multi Round-Trip Requests（公式仕様）https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr | プロトコル・シーケンス | `tools/call` が `InputRequiredResult`（inputRequests と不透明な requestState）を返し、クライアントが利用者に尋ねてから、新しい id・inputResponses・送り返した requestState で再試行する。サーバーは状態を持たない | README（`screen-doc`） |
| 10 | multi-agent-research | How we built our multi-agent research system（Anthropic engineering blog、2025-06-13）https://www.anthropic.com/engineering/multi-agent-research-system | システム構成 | オーケストレーターとワーカー: 利用者の問いを受けたリードの研究エージェントが計画をメモリに保存し、並列の検索サブエージェントを起こし、結果をまとめ、必要なら調査を繰り返し、引用エージェントに渡してから報告を返す | スライド（`presentation-16x9`） |

## 成果物

- `runs/<#>-<slug>/`: 初稿・最終版（YAML・SVG・PNG）、下絵があれば下絵、`log.md`
- `review.md`: 別の Opus のレビュー
- `report.md`: 利用者のフィードバックとあわせた改善点のまとめ
