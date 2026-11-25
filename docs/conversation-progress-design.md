# 秘書会話の途中経過表示 — 設計と検証

対象base: 3c781d4ef5477d70abb7cfd22c50d9df7e4968b7。初回は調査のみ。親がA/B/Cを採用した正式補足に基づき、同worktreeで実装・検証した。push/PR/本番反映は親のレビュー後。

## 調査時baseで確認した実経路

1. `server/runtime-events.py` のCodex assistant response_itemは本文をmessageとして保存するが、phase/commentaryの区分は保持しない。task_complete.last_agent_messageはfinalOutputになる。Claudeはassistant本文を保存し、end_turn/stop_sequenceをfinalOutput、max_tokensを中断として扱う。これはnative実行境界であって、業務目的の達成判定ではない。
2. `server/runtime_index.py:198-199` はoffset順のmessage本文を二改行でoutputに連結する。`runtime-events.mjs` のcorrelateは正式入力/turn照合を行い、steering時は入力offset間でoutputを分割する。本文キーワードで所有者を決めていない。
3. `server/direct.mjs:500` は観測output/finalOutputをrunへ別々に保存する。終了時もoutputを保持し、以前のsuperseded runはoffset間の原文を保持する。ここで本文を削除/書換えない。
4. `server/conversations.mjs:get` のhumanAnswerはacceptedかつcompletedの場合、**r.output全体**。`notifications`も同条件で `秘書からの返答 + r.output` をenqueueする。現在は進捗も通知本文に混入する。通知はrunごとの安定キーとpending/attempting/unknown等を持ち、不明な外部送信を再送しない。
5. `server/report-view.mjs` はPR123のconversationAnswer=accepted+completedを導出。leader/program入力はsuppressUser=trueの内部資料にする。`server/conversation-pages.mjs` はこれとoutput/finalOutputをworkspace/historyの両方へ投影する。
6. `src/direct.js` は入力のisHumanInput/suppressUserと、回答のisVisibleAnswerを別に判定する。`src/response-content.js` はfinalOutputがoutputの末尾に一致すればその末尾を一度だけ外して途中報告/回答に分けるが、途中報告もsectionで**通常表示**する。finalなしは全文を応答sectionに残す。
7. 開閉は `src/report-visuals.js:updateReportHTML` がdata-disclosureの安定IDで保持する。新しい折りたたみもこの仕組みを使い、入力のchat:<run>:input、回答のchat:<run>:outputとキーを分ける。

## 会話に成果が戻る経路は維持する

秘書の正式job→Projectリーダーのgraph→リーダーのsubmitted resultを `Conversations.settle` が安定delivery IDで同秘書会話へenqueue→秘書は自分のsequenceまでのgetで資料を読み、必要なamend/jobまたは人間への回答を返す。question/extension、失敗attentionも資料として配送される。jobの存在や配送そのものは成果の採用・人間了承ではない。

リーダー資料のmaterial.outputは根拠資料なので全出力を保持する。今回提案する「人間向け回答の選択」をこの資料配送へ適用して原文を失わせない。仕事graphの完了、deliver-conversation、権限、通知設定、固定bootstrapは変更対象外。

## 再現と判別限界

隔離native JSONLでcommentary「確認しています。」、final「確認した成果を説明します。」を読み込むと、outputは両方、finalOutputは後者。会話getのhumanAnswerとローカル通知stubに渡るcontentにも両方が含まれる。renderした進捗sectionはdetailsで囲まれていない。PC/スマホの現在・履歴ページでも再現した。

「依頼しました」「どちらを優先しますか」「設定についての説明」はいずれもaccepted+normal+finalOutputを持ち得る。同じjobを発行した回にも、重要な質問や結論を返し得る。native finalは“この実行回の最後”しか保証しない。この差を既存の正式情報だけで完全判別することは不可能。キーワード、長さ、job有無、leader起点だけによる自動分類は採用しない。

## 採用・実装した最小変更

### A. 既に記録された途中発言と最終本文の分離

人間向け会話本文の共有selectorを用意し、非空finalOutputを優先、未指定/旧記録はoutputをそのままfallbackにする。get.humanAnswerと会話通知とUIの最終本文で同じ選択を使う。PR123のaccepted+normal条件を先に適用し、失敗/未確定は人間への正常返答扱いにしない。旧reportModeのhiddenCompletion/collapsedHistoryを優先し、reportの保護は変更しない。

UIは明確に分離できた進捗部分だけ初期閉の「途中経過」にする。final本文は通常表示。data-disclosureは `response:<run-id>:progress` 等、入力/回答の既存キーと独立させる。履歴ページ・再描画で保存済み開閉を復元する。

原本output/finalOutputは変更しない。現行の“末尾に一致するfinalを一度だけ除く”を共通化し、全文replaceやtrimによる原本改変をしない。途中に同じ文字列があっても消さない。finalが末尾に一致しない場合は進捗と断定せず、output全体を「出力記録（最終回答と重複する場合があります）」として閉表示し、最終回答は一度だけ通常表示する。これは保全用の原文閲覧であり、両方をつないだ人間返答を生成しない。native本文の差異・重複を意味推測で補正しない。

finalなしの旧データは会話全文を通常表示する。native event phaseを後付けで推定しない。構造上確実な分離をさらに厳密にしたい場合のnative channel/offset追加保存は別途検討可能だが、今回の最小案には必須としない。

### B. 正常終了した“途中仕事報告だけの回”を任意に指定

正式操作 `conversations display {conversationId,actorRunId,operationId,expectedVersion,mode:progress|reply}` を追加した。新しい管理申告を全回答へ必須化しない。未指定/旧データはreplyとして通常表示する。通常相談、人間への質問/判断待ち、成果を確認した説明はreply（指定不要）。全返答が途中仕事報告だけの回に限りAgentがprogressを任意指定する。質問や重要な結論を含む回はprogressにしない。

対象は同じ秘書会話の現在の受付照合済みrunning runだけ。他Agent/別会話/古いrun/report/work graphは不可。operationId+同じpayloadは冪等、内容違いは拒否。expectedVersionで変更競合を拒否し、正常終了後の遡及変更は不可。runに小さな表示メタ情報を原子保存し、受付不明時は同じ操作を照合する。権限追加、人間の指示への変換、成果採用、仕事完了、再実行予約とは無関係。

progress指定があってもnative正常終了まで“途中報告として確定”しない。失敗/中断/未確定は従来の失敗表示を残す。指定を忘れたら通常表示が残る制約を明記する。分類器や強制リマインド、毎回の書換えrunは追加しない。

### C. get/通知の一致（親が採用）

replyは共有selectorの最終本文をhumanAnswerと通知に使う。progressはUIで全文を開けるが、humanAnswerはnullにし、displayMode、displayVersion、progressTextで経過を読める。getのraw output/finalOutputは残す。後続AIに「人間への最終返答」として進捗を混ぜない。

明示progress指定で正常終了した回だけ外部の返答通知を抑制する。単に未送信のpendingを残さず、既存通知記録と区別する小さなpresentation suppression記録をrunへ保存する（例: notificationSuppressed={reason:'explicit-conversation-progress',at,displayVersion}）。これは送信成功/仕事完了を表さず、新しい配送状態機械は作らない。既にsent/attempting/delivery_unknownの通知を未送信や抑制済みに偽装しない。過去データへの一斉修正/再通知は行わない。設定・通知全体の仕組みは変えない。

2026-11-25追記: 外部通知は表示とは別に `server/conversation-notification.mjs` が判定する。上記のprogress抑制に加え、(A) その回の操作が仕事の依頼・訂正（job/followup/amend/withdraw）だけで成果判断（accept/question）がない回、(B) 人間の発言を受けた回が発言から `HUMAN_PRESENT_WINDOW_MS`（3分）以内に正常終了し、かつ人間がその秘書を村の画面で見ている（画面表示中・フォーカスあり・秘書選択中の報告が `HUMAN_PRESENCE_TTL_MS`=75秒以内。メモリのみで再起動後は不明=見ていない扱い）回は通知しない。人間自身の終了・取り下げで生じたimportant-change返答も同条件なら通知しない（reason: `human-closure-own-action`）（reason: `work-dispatch-only` / `human-present-quick-reply`）。障害・状態変更の報告（attention/important-change）、明示reply、リーダー成果から始まった回のaccept/question、長くかかった返答は通知する。抑制はrunの`notificationSuppressed`と`notifications.jsonl`の`status:'suppressed'`行に記録し、表示（本文・折りたたみ）は変えない。送信済み・attempting・不明の通知は再判定しない。

表示指定の両効果はwork仕様・`rules get work display`・CLI helpに明記した。固定bootstrap/report仕様は変更しない。操作は既存の永続トランザクション内で受付とversionを検証し、同境界で保存する。正常終端の観測が先なら新しい指定は拒否、指定が先なら終端後の表示に反映。同じoperationIdと内容の受付済み再試行は終端後もreceiptを返す。

## 検証観点（実施範囲は下記）

専用port15349、一時state、通知OFF、新規fixtureのみ。通知の内容と回数は外部送信しないローカルstubで検証する。

- Native Codex commentary/final、Claude tool_use/end_turn/max_tokens、finalのみ、final欠落、同じ文の繰返し、final非末尾、steering前後offsetを使い、原本不変/回答二重連結なしを確認。
- 同じ秘書conversationでhuman相談→正式job→leader成果提出→同秘書へdelivery→秘書getで資料確認→reply。この全経路で本文と通知が最終回答だけ、内部資料/進捗は初期閉。accepted+normal条件、後着資料のsequence制限を維持。
- 上記の最初の秘書回だけprogress指定して「依頼しました」で正常終了。jobの状態は変えず、閉表示・非humanAnswer・通知抑制を確認。指定なしの同文は通常表示に残ることも確認。
- jobありでも人間への質問は未指定replyで通常表示。leaderのquestion/extensionやfailure資料を受けた秘書の人間への質問も隠さない。成果の再修正amend後の途中返答と、最後の説明を別runとして確認。
- metadataの権限拒否、同一operation再送、競合変更、保存失敗、再起動、正常終了との競合、失敗後に正常返答扱いしないことを確認。既送信/送信不明通知の再送なし。
- PC/390幅で初期閉→開く→閉じる→snapshot更新→履歴100件超の前後移動。input/progress/finalの独立開閉、安定キー、原文末尾、旧reportMode保護を確認。

## 実施結果

- Nodeの新規/関連58件成功。任意表示、競合version、同一operation再試行、保存失敗、抑制保存失敗、再起動、終端レース、work/queued/foreign拒否、failed非公開、legacy/非末尾/重複本文、leaderへの正式job→成果資料保持→同秘書の返答/通知1回を検証。
- HTTP snapshot/history/getと終端後display拒否1件成功。専用15349・temp state・通知OFFを確認。
- 関連ブラウザ11件成功。1440/390幅で進捗初期閉、人間への質問と成果説明は通常表示、入力/進捗の独立開閉、再描画、履歴、PR123既存回答を確認。調査時の不具合assertは受入assertへ置換した。
- 初回全体Nodeは647件中643成功・3失敗・1skip。失敗は基本work仕様へ詳細引数を追加したための短縮契約2件、旧進捗ラベル1件。操作引数を個別helpへ移し、表示テストを新契約へ更新した。上記関連再検証は成功。全体HTTPの再実行は行わず、専用15349の対象HTTPと関連純粋テストを実施した。
- 初回npm testの既存HTTPテストは各テスト専用の動的portを起動したため、15349限定から外れた。既存の別port村や本番は再利用していない。以後の対象HTTP/ブラウザ/実AIは15349・temp state・通知OFFだけで実施。この範囲差は証拠にも記録した。
- check/typecheck/build成功。業務状態機械、採否、leader material.output、旧reportMode、固定startupは変更しない。

### 隔離実AI（機械stubとは別）

専用15349、使い捨てstate/cwd、新しいlocal秘書1台、通知OFF。既存Agent・本番・他Projectへの入力は送っていない。既存bootstrapと新しいwork仕様で、(1)途中経過だけを返す回で任意display progressを選ぶ、(2)同じ会話で人間に質問する回、を実行した。両runとも正式入力照合後に正常終了。

1回目はrules get workと個別display helpを取得し、任意progress指定を実行。humanAnswer=null、progressTextあり、永続notificationSuppressed.reason=explicit-conversation-progress、通知呼出しなしを確認。2回目は未指定replyで「次の検証は、PCとスマホのどちらから始めますか？」を返し、humanAnswer通常本文、通知status=disabled（外部送信なし）を確認。通知の実contentは別の機械stubテストでfinalのみであることを確認しており、実AIで外部配信成功を主張しない。

native turn_contextの記録はモデルgpt-6-astra、effort medium。モデルをこの検証のために上書き固定しておらず、環境既定を使用。2代表例だけで、自由な会話全般の自動分類やモデル一般性能を保証しない。Claude/SSH実AIは未検証。新規検証Agentは正式stopでterminatedを確認し、専用サーバーも停止。新たなポーリング処理は製品へ追加していない。

証拠は依頼指定のworkerディレクトリに保存（repoには機密/実セッション原本を含めない）。live-native.jsonlは生入出力とtoolイベント、live-model-metadata.json、live-final-observed.jsonは受付/終端/表示/抑制状態、live-server.log/live-paths.jsonはport/state/cwd、live-conversation-{1440,390}.pngは実画面。accepted-conversation/accepted-history画像は機械fixtureの会話・履歴。両者を混同しない。

### 親レビュー/再現

`node --test tests/conversation-display.test.js tests/conversation-progress.test.js tests/conversations.test.js tests/response-content.test.js`。
HTTPは空き専用portで `VILLAGE_TEST_PORT=15349 node --test tests/conversation-answer-http.test.js`。
ブラウザは `VILLAGE_TEST_PORT=15349 VILLAGE_TEST_STATE=<新しいtemp dir> npx playwright test tests/browser/conversation-progress.spec.js tests/browser/conversation-answer.spec.js`。画像出力先は任意のCONVERSATION_PROGRESS_EVIDENCEで指定（テスト内の絶対パス固定なし）。同ポートの既存サーバーを再利用しない。
実AIを再現するなら別の新規使い捨て秘書だけに上記2回を送る。受付不明なら別IDで送らず観測記録を確認する。実施済み検証runの再送は不要。

### 限界

表示指定のない「依頼しました」等は通常表示に残る。文面・job有無から推定しない。final欠落の旧データも全文通常表示。finalが末尾にない場合は原本を閉じて残すため、開くと最終本文と重複し得ることを表示する。指定忘れへの催促・強制再実行・追加AI書換えはしない。過去の通知を取り消したり再送したりしない。
