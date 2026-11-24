# #639 v0.20 の Skill を最近の論文・tech report・技術資料で試す

v0.20.0（線を真っ直ぐにする既定、確かめたヒント、レーン、辺のラベル、シーケンス図、matrix、`sumi` の白いパネルと細い枠）の Skill どおりに、新しい Opus エージェントが最近の資料から図を 1 枚ずつ作る。別の Opus のレビューと利用者のフィードバックから、Sumi の機能・Skill・lint の改善点を探し、#603 の指摘が直ったかも確かめる。

- 題材は会議の論文 4 本、tech report 3 本、技術資料 3 本。#603 と重ならず、図の種類が偏らないよう選んだ（各資料が実在し、本文を無料で読めることを 2026-11-22 に確認済み）。利用者の承認済み。
- 原図の複製ではなく、資料の本文から図を作る。著者名・所属は図に入れない。
- 各エージェントへの指示は [prompt.md](prompt.md)。Sumi は公開された v0.20.0 のバイナリ、テーマは `sumi`。

## 題材と依頼

| # | slug | 資料 | 種類 | 図にする内容 | 置き場所（profile） |
|---|---|---|---|---|---|
| 1 | d4rt | Efficiently Reconstructing Dynamic Scenes One D4RT at a Time（CVPR 2026 Best Paper）https://arxiv.org/abs/2512.08924 | 立体＋アーキテクチャ | 1 本の動画を統一した Transformer で符号化し、任意の時空間点をクエリするデコーダが深度・対応点・カメラをまとめて推定する流れ | 論文 2 段（`paper-double`） |
| 2 | hivemind | Artificial Hivemind: The Open-Ended Homogeneity of Language Models（NeurIPS 2025 Datasets & Benchmarks）https://arxiv.org/abs/2510.22954 | matrix | 多数の LLM の応答の埋め込みの類似度をモデル×モデルの行列で示し、モデル間の均質化を見せる | 論文 1 段（`paper-single`） |
| 3 | flex-trap | The Flexibility Trap: Rethinking the Value of Arbitrary Order in Diffusion LMs（ICML 2026 Outstanding Paper）https://arxiv.org/abs/2601.15165 | 並べて比較 | 任意順序のデコードと左から右の順序を並べ、前者が不確かなトークンを避けて解の多様性が崩れること、JustGRPO で左から右に戻す案を対比する | 論文 2 段（`paper-double`） |
| 4 | hyperedge | HyperEdge: An Edge CDN Infrastructure for Cost Efficient Video Streaming（NSDI 2026 Outstanding Paper）https://www.usenix.org/conference/nsdi26/presentation/wei | ネットワーク（ML 以外） | 遊休のエッジ端末群・集中トラッカー・補助の CDN・クライアントの関係と、複数経路での配信の経路 | 論文 2 段（`paper-double`） |
| 5 | qwen3-omni | Qwen3-Omni Technical Report（tech report、2025）https://arxiv.org/abs/2509.17765 | 密なアーキテクチャ | MoE の Thinker（テキスト生成）と、ストリーミングで音声を作る Talker（マルチコードブック）を分けた構成 | 論文 2 段（`paper-double`） |
| 6 | tongyi-dr | Tongyi DeepResearch Technical Report（tech report、2025）https://arxiv.org/abs/2510.24701 | エージェントのループ＋学習 | 検索・閲覧ツールを使う推論のループと、agentic mid-training から post-training までの学習の枠組み | スライド（`presentation-16x9`） |
| 7 | olmo3 | Olmo 3（tech report、2025）https://arxiv.org/abs/2512.13961 | 学習・データの流れ | Dolma 3 の事前学習 → Dolmino の中間学習 → Longmino の長文脈 → Dolci の SFT・DPO・RL の段階と、Think / Instruct / RL-Zero への枝分かれ | 論文 2 段（`paper-double`） |
| 8 | ap2 | Agent Payments Protocol (AP2) Specification v0.2（公式仕様、2025）https://ap2-protocol.org/ap2/specification/ | プロトコル・シーケンス | 利用者がその場にいる（Human-Present）購入で、買い物エージェント・利用者の画面・加盟店・資格情報の提供者・決済処理者のあいだを、署名付きの Mandate と支払い情報が順に流れる | README（`screen-doc`） |
| 9 | a2a-task | A2A Protocol v1.0 のタスクの一生（公式仕様）https://a2a-protocol.org/latest/topics/life-of-a-task/ と https://a2a-protocol.org/latest/specification/ の TaskState | 状態遷移 | submitted → working → 中断（input-required / auth-required）→ 終端（completed / failed / canceled / rejected）。終端のタスクは再開せず、同じ contextId で新しいタスクを始める | README（`screen-doc`） |
| 10 | kafka-queues | KIP-932: Queues for Kafka（Accepted）https://cwiki.apache.org/confluence/display/KAFKA/KIP-932%3A+Queues+for+Kafka | レーン＋状態（ML 以外） | 共有グループの消費者群・グループコーディネータ・share-partition leader・share coordinator と `__share_group_state` トピックの関係、レコードの Available / Acquired / Acknowledged / Archived の状態 | スライド（`presentation-16x9`） |

## 成果物

- `runs/<#>-<slug>/`: 初稿・最終版（YAML・SVG・PNG）、下絵があれば下絵、`log.md`
- `review.md`: 別の Opus のレビュー
- `report.md`: 利用者のフィードバックとあわせた改善点のまとめ
