# Codex / Claude 設計対称性レビュー

`server/direct.mjs`、`server/runtime-events.mjs`、`server/runtime-events.py`、`server/runtime_index.py`、`server/runtime-reader.mjs`、および`canSteer`関連コードを対象に実施。実装・mainマージは依頼範囲（steering関連・途中報告関連・runtime-file-replaced関連）に限定し、以下はレビュー報告のみ。

## 発見1（実装を要検討・最重要）: `completionOffset`がClaudeに一度も設定されない

`server/runtime-events.py`のCodex分岐は`task_complete`/`turn_aborted`完了時に`completionOffset=offset`を設定する（1箇所）。Claude分岐（`isApiErrorMessage`・`end_turn`/`stop_sequence`/`max_tokens`の各完了分岐）は`finalOutput`・`outputThrough`・`completedAt`・`completionEvent`は設定するが、**`completionOffset`は一度も設定しない**。

影響（全てClaude側が常に不成立になる）:
- `server/runtime-events.mjs`の`terminalBoundary()`: `Number.isFinite(t.completionOffset)`を要求 → Claudeでは常にfalse → **Claudeのターンは`terminalBoundary()`で絶対に「確定した終端」と判定されない**。
- `server/direct.mjs:284`: `latest.completionOffset`が有限なら「完了後に追加入力があれば`activityState='unknown'`にする」という追加の異常検知 → Claudeではこの安全網が機能しない。
- `server/requests.mjs:257`（`server_overloaded`時の自動限定再試行の境界判定）: `terminalBoundary(snapshot,status)`を要求 → **Claudeのrunはこの自動再試行パスに絶対に到達できない**（下記発見2と複合）。

## 発見2（実装を要検討）: `errorCode`/`runtimeError`がClaudeに一度も設定されない

`server/runtime-events.py`のCodex分岐は`task_complete`等のエラー時に`runtimeError=error`・`errorCode=error.get('codex_error_info')`を構造化して設定する。Claude分岐の`isApiErrorMessage`は`error=x.get('error') or 'runtime-api-error'`という**プレーン文字列のみ**を設定し、`errorCode`・`runtimeError`は一切設定しない。

影響: `server/requests.mjs:257`の自動限定再試行は`observed.errorCode==='server_overloaded'`を要求するため、発見1と合わせて**Claude Agentは`server_overloaded`相当のAPIエラーから自動的に回復する手段が一切ない**（Codexは持つ）。`server/requests.mjs:269`のユーザー向け復旧理由表示（「自動再試行対象外のエラーです」等）も、Claudeでは常に「errorCode不明」側の分岐になる。

両発見は同じ機能領域（エラー後の自動復旧）に関わるため、1件のまとまった修正候補として扱うのが自然。ただし`completionOffset`・`errorCode`の意味（Claudeの`isApiErrorMessage`にCodexの`codex_error_info`相当の構造化エラー種別が実在するか）を確認する必要があり、今回の許可範囲（steering/途中報告/runtime-file-replaced）には含まれないため、**実装はしていない**。

## 発見3（実機で確認・新規・範囲外のため未実装）: ブラケットペースト経由の入力でClaude側の入力相関が壊れる場合がある

隔離サンドボックスで実機確認（Task 2参照）。`requests start`経由で届く指示（`server/requests.mjs`の`context()`が追記する`<ai-village-request>`ブロックを含む、複数行のテキスト）をPurpleMuxのtab-input機構（`tab-input-runtime.ts`、複数行は`\x1b[200~...\x1b[201~`のブラケットペーストで送信）経由で送信すると、**Claude Code CLI自身がそのペースト内容全体を`<pasted_content id="...">...</pasted_content>`というタグで包んでJSONLに記録する**ケースを2回連続（新規agentの1通目・2通目）で再現した。村側は送信した生のテキストのハッシュ（`inputHash`）を期待するため、このタグの付加によりハッシュが一致せず、runが`state:'unknown'`・`error:'competing-or-unmatched-input'`のまま永久に固定される。

**同一条件（同一ホスト・同一PurpleMux・同一の複数行`<ai-village-request>`文面）でCodex Agentを並行して検証したところ、Codexは正常に`state:'running'`・`acceptance:'accepted'`へ到達し、この問題は発生しなかった。** 明確な非対称であり、現在実運用中の複数のローカル接続Claude Agent（`connectionType:'local'`の秘書・工房Agentは多数存在することを`agents list`で確認済み）にも理論上影響しうる。

ただし、本番で長時間稼働中の筆者自身のセッション（同じく`connectionType:'local'`、同じホスト・同じPurpleMux）が過去に受け取った同種の複数行指示を確認した限り、`<pasted_content>`ラッピングは一度も発生していなかった。**何がこの差を生むかは特定できていない**（セッションの経過メッセージ数、ペイン幅、PurpleMuxサーバーの実行バイナリと`~/DevEnv/purplemux`のソースとの一致不一致、Claude Code側の内部的なペースト判定ヒューリスティックなど、複数の仮説を検討したが、いずれも反証も確証もできなかった）。再現性のある実害（corrrelate()の永久固定）と、Codexとの明確な非対称は確定しているが、根本原因・発生条件の完全な特定、および修正は**今回の許可範囲外**のため行っていない。PR #55のstop()修正により、少なくとも「永久に固定される」実害自体は、Agentを明示的にstop()すれば`'terminated'`へ解決されretryできる状態まで緩和されることは実機で確認済み（下記Task 2参照）。

## 既存の非対称で「意図的・妥当」と判断したもの（問題として報告しない）

- **`canSteer`が`provider==='codex'`固定**（`server/direct.mjs`の`updateAvailability()`・`steeringBoundary()`）: 既存調査（`docs/claude-steering.md`）で安全に拡張できないと確認済み。レビュー観点では妥当な非対称。
- **`freshClaude`ヒューリスティック**（`server/direct.mjs:274`、Claude専用）: Codexは起動直後からセッションファイルが存在するが、Claudeは最初の入力を受けるまでファイル自体が存在しない（`runtime_index.py`の`session-file-unrecorded`）。これはプロバイダ自身のネイティブな挙動差を吸収するための妥当な非対称であり、設計上の抜け漏れではない。

## 対応

発見1・2は機能的に重要（Claudeのエラー自動復旧が常に無効）だが、今回許可された実装範囲（steering/途中報告/runtime-file-replaced）に含まれないため、コード変更は行っていない。別途依頼いただければ対応します。発見3も同様に範囲外のため報告のみ。
