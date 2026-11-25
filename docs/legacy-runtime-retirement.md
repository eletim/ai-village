# 未確認履歴を保持する限定runtime退役

通常のadoptと正常終端freshProofは変更しない。既存の過去runを正常へ書き換えることなく、正式停止した実行環境から未使用runtimeへ移り、新しい仕事だけを受けるための人間専用オプションを追加する。

## 操作と境界

既存の人間認証付き `POST /api/direct/human/agents/:id/adopt-runtime` に、通常のoperationId/revision/replacementAgentId/replacementRevision/handoverに加えて次を指定する。

```json
{"retireLegacyHistory":{"version":1,"mode":"new-work-only","acknowledgement":"この対象の過去の結果不明を保持し、旧仕事を再送せず、新しい仕事だけを受ける限定移行を承認する。対象と不明事項をここに具体的に記す。"}}
```

この文は操作時に人間が入力する。実装依頼への「進めて」は実運用の承認ではない。人間用cookieをAgentへ渡さない。一般CLI・Agent API・認証なしHTTPは例外採用を拒否する。通常CLIの既存採用権限は変更しない。汎用の自動承認・設定・例外解除UIは追加しない。

必要条件:

- 正式prepare、stop intent、terminatedAt、PID+starttimeの所有記録、remainingOwned=0。旧tab不存在とPID不存在を非破壊観測し、保存直前にも再検証する。PID再利用・通信失敗・欠落は拒否。
- 旧runはすべてended。queued/sent/running、未分類、未解決unknownSince、dispatch後にtransport-ackもinputもない履歴を拒否。過去のunconfirmed終端は成功に変更しない。
- 対象の旧workはcompleted/withdrawn、未処理inbox・予約・未確定finish/採否/入力申告なし。関連会話の仕事も解決済みであること。状態の自動変更はしない。
- donorの未使用、独立workspace/tab、登録属性・実行先・現在cwd許可、現startup契約、idle、native未使用等の従来条件を維持。Claudeだけ明示profileと起動観測を必須とする。CodexへClaude証拠を流用しない。旧profileは推定しない。

## 記録と新旧仕事の分離

receipt.legacyRetirementに、操作専用承認、旧runのID/全記録digest/結果/理由、旧work参照、採用前のrequest ID集合、新runtime identity/profile/固定契約、startup eventを保存する。旧状態原本と停止観測は既存receiptに残る。元Agent ID、会話、履歴、成果採否は維持する。

採用後の新run追加を一律拒否しない。旧run集合の削除・改変、採用時点より前のrun追加、新runtimeと異なるsessionの送信履歴は拒否する。新しい人間会話、および採用後に作成された新しい仕事とその正規の後続配送は許可する。同じ秘書会話の新しい人間発言も利用できる。

旧workのretry/resume/遅延成果は新runtimeへ送らずqueued保留にし、`legacy-retirement-held` と理由を保存する。新規依頼で旧外部操作を再実行する許可が自動で増えるわけではない。追加runtime交換で保留境界を消すことも拒否する。同operationの同payloadは以前のreceiptを返す。

Agent詳細→セッションの切替には旧run、旧work、結果不明の理由、保留runを表示する。正式 `agents instructions ID` にもlegacyRetirement/retirementHoldsを返す。保留は後日人間が診断するための記録で、UI操作だけで自動解消しない。

初回の未使用Claudeは、native未記録、session-start、同session/profile/契約、setupなしを再確認する。再起動でsession-startを失った場合やpreviousSession/native喪失は従来どおり保留する。2回目以降は現nativeの通常境界に加え旧集合保全を確認する。

## 実対象の計画（未許可・未実施）

|対象|停止判断|残す不明／旧履歴|新model方針|採用後|
|---|---|---|---|---|
|VTuber秘書 aa163112-745c-4da2-8a3b-c0e2f1f51182|旧CLI生存。別途明示許可後に正式prepare/stop、fresh不在確認|旧失敗やinputId不足を成功へ補完しない。全旧集合保存|claude-sonnet-5/high|同ID、新規会話のみから開始|
|VTuber工房 09babb7e-5fab-4e66-b25c-bc3d66ea2406|旧CLI生存。別途明示許可が必要|5c9352d5-4e7e-4c56-a561-268b87be6d1c timeout/unconfirmed、旧work e871bc4c-f9da-49b4-9bf3-2e81eb001e90を保留対象として保持|claude-opus-5/high|同ID、新規仕事。旧仕事自動再開なし|
|ナポレオン旧秘書 de685d46-62a2-44f6-aa86-2f2bc1d9706b|既に正式停止。再停止せず証拠を再観測|e4031552-34cb-431a-b054-34d6e05f75d4 legacy-superseded/unconfirmed、旧work 918f5038-4762-4059-9093-b42e11fc8f14|Codex既存ゲート。native context gpt-6-astra/mediumは参考で、新規モデル決定とは別|保留方針は変更しない|

実donor IDは本調査で作成・選択しない。採用時に正式名簿で既存未使用候補を照合し、そのIDをpayloadに指定する。旧runtimeは交換先Agentに保管される。引継ぎには元目的、済んだ外部操作、不明run、再送禁止、旧work保留、新規入力の責任範囲を記す。環境構築モデル不明は保留のまま。

復旧は同operationの受付確認と診断を先行する。保存失敗は既存checkpoint rollback、保存結果不明は別ID再送禁止。旧CLI再生成、旧run再送、DBでreceipt消去による復旧はしない。追加の退役解除や再移行は別途レビューが必要。

## 反映順・限界

PurpleMuxの追加差分はない。既存pmux111の新tab限定profile受付／SessionStart観測対応が先、その後Village PR127と本追加差分。既存tabを閉じたり再作成したりしない。PurpleMux再起動はイベントのメモリ状態を失い得るため、親が反映前後のworkspace/tab/session/PID+starttimeと稼働状態を照合し、未使用Claudeの保留を成功に読み替えない。今回、本番の比較読取や操作は行わない。

rollbackは反映前の整合バックアップと旧コードへ戻す計画を親が管理する。既に限定採用した記録を無視する旧版をそのまま稼働させない。未反映ならコードのみ撤回可能。外部副作用の取り消し・exactly-onceを保証しない。

OS/process観測とDB保存は原子的ではない。前後のtab/PID確認と停止状態を厳密に照合して窓を狭めるが、外部からの再生成を完全に排除する仕組みではない。変化／観測不能なら閉じる。製品は未確認履歴を消さず、業務達成を推定しない。

## 今回の検証結果

機械テストでは擬似legacy記録を明記して使う。実AIでは別の使い捨て環境でSonnet5/Opus5のsource/donorを正式createし、sourceの無副作用な数列応答を受付照合後の実行中に正式stopした。これにより実際の `agent-stopped/unconfirmed` を作り、DBの結果書換えはしなかった。実本番のtimeout/legacy-supersededを再現したとは呼ばない。

donorは採用前に一度も発話せず、session-startとprofile受付だけを確認。人間用の隔離APIから操作専用承認で採用後、両モデルとも同じAgent/会話IDで2回の新会話に正常応答し、native assistantの完全model ID/high/end_turnを確認した。起動引数のhigh、無発話hookのmodel、実応答nativeのhighは別証拠。

Opusは新規仕事2件でも正式finishと依頼完了を確認。Sonnetは2件とも受付・native正常応答は確認できたが、ローカル手続きへの操作を未検証の指示として拒否し、案内・明示訂正後も未完了。モデルの手続き遂行まで両方成功とは報告しない。安全ゲートを緩めず、生出力とactive状態を保持して隔離環境を終了した。

その後の保守的なtransport拒否、未確定claim拒否、追加移行の拒否、旧配送による順番待ち阻害の回避は機械回帰で検証。全実AI行程を追加修正後に繰り返してはいない。実対象の移行可否・本番反映は親の別判断であり未実施。
