# 実行中Claude Agentへの補足（調査結果：未実装）

`canSteer`はCodexのみ対象（`server/direct.mjs` `updateAvailability()`、`a.provider==='codex'`が前提）。Claude Agentでは常に`canSteer`が立たず、追加メッセージは常に新規独立依頼として待機キューに積まれる。この節は「Claude Code CLIに実行中turnへの安全な補足手段があるか」の実機調査結果であり、**実装はしていない**（下記の理由による）。

## 調査した実装と境界

Claude Code CLIはクローズドソースであり、Codex調査（`docs/codex-steering.md`）のようにRustプロトコル定義を直接読むことはできない。公開APIにもsteering/interrupt/queue相当のCLIフラグは存在しない（`claude --help`に該当するオプションなし）。そのため、隔離サンドボックス（`/tmp`配下、村・本番サーバーとは無関係のtmuxセッションで`claude`を直接起動。村のAgentとして登録せず、`direct.mjs`は一切経由していない）で、tab送信（`tab-input-runtime.ts`の`submitTabInput`と同じ手順: literal text → 250ms → Enter 1回）を busy 中に送った場合の挙動をJSONLレベルで直接観測した。

### 実機検証で確認した挙動（v2.1.272）

送信タイミングによって挙動が分岐することを確認した:

1. **ターンが既にidle（前のターンが完了済み）のときに送信**: 通常の新規独立`type:'user'`ターンとして記録される。既存のClaude分岐（`server/runtime-events.py`）の解析と完全に一致する、現在の挙動そのもの。
2. **ツール呼び出し（Bashコマンド等）がブロッキングで実行中のときに送信**: TUI上は「queued」と表示されるが、JSONLには新しい`type:'user'`ターンは**作成されない**。代わりに`type:'attachment'`（`attachment.type:'queued_command'`、`attachment.prompt`に全文）としてuuid鎖が**同じターンの継続**として記録され、次のtool_resultに続くモデルへの入力に、以下のsystem-reminderとして埋め込まれて配送される:
   > "This is how Claude Code surfaces messages the user sends mid-turn — within the running turn, often alongside the next tool result, rather than as a separate conversation turn. Address the message above as you continue this turn."
   
   実際に、busy中に送った補足（"also say the word KUMQUAT"）は、元のタスク完了と**同じ応答**の中でモデルに反映された。これは単純な「次ターンへのキュー」ではなく、**現在のターンへの実配送**であり、Codexのsteeringに機能的に近い。
3. **ツール呼び出しが無く、純粋な思考（テキスト生成）中のときに送信**: ケース2と見た目は似ているが、JSONL上は**通常の新規独立`type:'user'`ターン**として記録され（attachmentではない）、現在のターンがend_turnで完結した**後**に別の応答として処理された。つまりケース1と同じ「次ターンへのキュー」挙動になる。

### 実装しない理由

ケース2の発見自体は「Claudeには補足手段が全くない」という前提を覆すものだが、Codexの`turn/steer`（`protocol/src/turn_input.rs`の明示的プロトコル）と比較して、以下の点で**村のUIが「補足は現在の作業に反映される」と約束できるレベルの安定性・検証可能性を欠く**と判断した:

- **送信した瞬間にケース2とケース3のどちらになるかは、村側から事前に判定できない。** 村は`tab status`のポーリング（数秒間隔）でしか内部状態を観測できず、「ツール呼び出しが現在進行中か」をリアルタイムに保証する手段がない。Codexは`steerTarget`に紐づく`turnId`/`sessionId`をnative受付と照合して確定できるが、Claudeの`attachment`配送はタイミング依存で、村が送信ボタンを押した時点でどちらに転ぶか制御できない。
- **ケース2の配送形式（`type:'attachment'`、`attachment.prompt`）は、`server/runtime-events.py`のClaude分岐が現在一切認識していない新しいイベント種別。** これをCodexのsteering同様に「native受付の正式な確認」として使うには、`parse_event`に新しい解析ロジック（`attachment.prompt`のハッシュ化・turn所有権への統合）を追加する必要があり、既存のCodex steeringが頼っている「`response_item`/`user_message`の明示的turn_id」のような安定した一次情報とは異質。
- **これはClaude Code（クローズドソース、頻繁に更新される）の非公開UI挙動の観測結果であり、公開・安定が保証されたプロトコルではない。** Codex調査はオープンソースのRustプロトコル定義（`turn_input.rs`のSteer/StartOrSteer）を直接確認した上で実装したのに対し、ここではv2.1.272一バージョンの黒箱観測のみ。将来のバージョンで挙動が変わらない保証はない。

以上より、「本当に実行中turnへ安全に割り込める」とUIで約束するための十分な検証可能性・安定性が無いと判断し、`canSteer`をClaudeへ拡張する実装は見送った。

## UI側の緩和策（提案のみ、未実装）

依頼範囲外だが参考として: 「待機キューへ」の説明文に、Claudeの場合は「ツール実行中に送ると稀に現在の作業へ即時反映されることがあるが、村はそれを保証・検知できない」旨を注記する、程度の期待値調整は検討の余地がある。実装はしていない。

## 実機検証

隔離tmuxセッション（`/tmp`配下の使い捨てディレクトリ、村・本番サーバーとは無関係、村のAgentとしては未登録）で`claude`を直接起動し、foregroundでブロックするPythonのsleepコマンドを実行させ、busy中に2回・idle中に1回・純粋thinking中に1回の補足を送信して上記3パターンを確認した。検証後、`claude-steering-experiment`ディレクトリと対応するセッションJSONL・村のnative-indexキャッシュ（該当sidは村に一度も登録されていないため元から存在せず）を削除済み。既存Agent・稼働checkout・稼働サービスは変更していない。
