# Workspaceの会話ページング

Agent Workspaceの通常pollは `GET /api/direct?view=workspace&ranges=JSON` を使用する。従来のクエリなし `GET /api/direct` と正式 `requests get/results` は変更しない。

- 人間向けprojectionとmanaged/native照合を先に行い、各Agent直近100会話項目を取得・表示する。1項目はrunまたは外部native turnであり、Markdown段落数ではない。既存の途中/最終報告・経過の折畳みを維持する。
- 表示済み範囲をAgentごとのcursorで保持し、pollではその範囲以降を最新projectionで取り直す。完了報告への統合や実行中の伸長を古いキャッシュで覆わない。元の回答と非表示のreport内部指示を別ルートで復元しない。
- `GET /api/direct/agents/:id/history?before=CURSOR` は古い100件と次cursorを返す。UIは `boundaryOnly=1` で境界だけを取得し、そのcursorからsnapshotを更新するため、古い本文を同じ操作で二重取得しない。
- cursorはAgentと固定の会話開始時刻・種別・ID（nativeはsessionも）に結びつく。件数offsetや出力本文の比較ではない。同文の正当な再発言は削除しない。native受付後のmanaged session ID変更でcursorが動かない。
- 未送信・受付不明・実行中の古いrunは100件の外でも操作を残す。全Agent/Project/場所の登録情報とサーバー側の未確認状態も残す。復旧時の元指示全文は明示的な再試行操作時だけ `requests get` で取得する。
- 追加表示前に読んでいた会話項目と画面内位置を保持する。終了Agentの履歴にも同じページングを使用する。下書き、添付、補足/取消の操作は既存経路を使用する。

送信直後はフォームに添付準備/アップロード・サーバー送信・受付状態更新を表示する。POST成功をnative受付完了とは表示せず、以降は既存のqueued/受付照合中/受付不明の状態を表示する。通信結果不明時は同一requestIdを保持し、自動再送しない。spinnerはreduced-motionで静止する。

週次アイコンはPurpleMuxのOpenAIIconとClaudeCodeIcon（ClaudeLogo）から静的SVGへ移植。名称はaria-label/tooltip、詳細は既存のdetailsを維持。ライセンスと出所を `src/purplemux-icons-LICENSE.txt` に同梱。

## 計測と制限

隔離235件fixtureのHTTP比較では約1.27MBから約0.57MB（約55%削減）。実稼働の読取専用snapshot（21 Agent・369 run）を同じadapterへ通した比較では5,695,626から1,935,569 bytes（約66%削減）。件数・本文量によって効果は変わる。

サーバー内部の保存・nativeログ読取・projection自体は今回差分化しない。既読の範囲と新しい項目をpollで再取得するので、開いた過去履歴が多いほど転送量・DOM量は増える。初回100件も1件あたりの本文量により大きくなりうる。ページ再読込では初期範囲へ戻る（下書きは従来どおり保持）。サーバーの履歴削除や書換えは行わない。稼働反映はレビュー後に別途実施する。

検証時、旧office専用DOM（`#conversation-log` / `#request`）を期待する既存テスト3件はベースdd1875fでも失敗した。現在のofficeはWorkspaceへ誘導されるため、このPRでは旧画面を復活させず、Workspaceの入力・報告・office誘導のテストで回帰を確認した。
