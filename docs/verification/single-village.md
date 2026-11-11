# 単一村 第1段階の検証

基準: main 1a3cc75。Node 22.23.2。通知OFF、専用状態、隔離ポート5296〜5298で実施。本番には接続・変更していない。

## 自動テスト

- npm test: 299件中298成功、失敗0、既存スキップ1。
- typecheck / check / build / git diff --check: 成功。
- 新規4テスト: 旧データを読まず改変せず起動、旧URL404、独立実行/SSH引数と監査、旧操作拒否、残すPR操作のrepository設定を検証。
- main単体のtodo-http/travel-registry-httpは期待200に対し302で失敗することを確認。本変更では旧office/state/memoの期待を現行agents/directへ置き換え、アクセス制御の検証を維持して成功。
- Playwright全体119件: 101成功・18失敗。そのうち今回のCSS削除によるセピア配色1件を修正し、該当テストの再実行成功。残る17件はmainの同じテストを選択実行して全件失敗を再現。全体の再実行はしていないため、全件成功とは扱わない。

mainでも失敗する17件（本PRでは未解消）:

- `tests/browser/board-review.spec.js:18:1 › four cards use 2x2, nine use 3x3, narrow screen uses readable rows and one consistent state palette`
- `tests/browser/board-review.spec.js:85:1 › quiet selection preserves blue and muted green; unread turns alone have no wash or ring`
- `tests/browser/conversation-pages.spec.js:38:1 › recovery fetches full request only on explicit retry and uses current revision`
- `tests/browser/direct.spec.js:36:1 › notification deep link focuses the matching Agent after asynchronous loading`
- `tests/browser/direct.spec.js:86:1 › sidebar uses registered places, auto layout, same-button restore and archived termination`
- `tests/browser/direct.spec.js:104:1 › drafts, conversation and board scroll survive place, zoom, polling and responsive layout`
- `tests/browser/direct.spec.js:122:1 › notification link to a terminated Agent opens saved history, not an Agent tab`
- `tests/browser/direct.spec.js:131:1 › server send eligibility, chat alignment, draft and scroll survive refresh and reload`
- `tests/browser/direct.spec.js:170:1 › secretary setup opens local runtime registration, and zoom survives polling until explicit place change`
- `tests/browser/projects.spec.js:4:1 › Project spans places with nine-card groups, zoom restore, dots and explicit membership`
- `tests/browser/projects.spec.js:26:1 › sidebar modes persist their own group, restore drafts and reach unassigned Agents without auto-view`
- `tests/browser/report-mode.spec.js:7:1 › Direct preserves original work until report commits; failure keeps original, internal report stays hidden`
- `tests/browser/runtime-recovery.spec.js:2:1 › failed runtime displays reason, scheduled recovery and explicit revision-safe retry/cancel`
- `tests/browser/sidebar-toggle.spec.js:2:31 › sidebar toggle keeps draft and scope, grows board, persists at 1440px`
- `tests/browser/sidebar-toggle.spec.js:2:31 › sidebar toggle keeps draft and scope, grows board, persists at 390px`
- `tests/browser/status-icons.spec.js:8:1 › default dots, roles preserve other preferences, match headers, rename/poll stable, unknown and escaped labels`
- `tests/browser/travel-registry.spec.js:2:1 › registered computer/folder CRUD, selection isolation, immutable draft and concurrent editing`

## 隔離実機

実際のCodexを秘書Agentとして作成。通常依頼→正常終了→自動報告→依頼完了を確認。2送信とも正常終了、要確認なし。`/` と `/agents` はページエラーなし、旧執務室の導線なし。新しい状態ディレクトリにstate.json/conversation.jsonは作られなかった。

- [実機記録](single-village-live.json)
- [地図](single-village-map.png)
- [Agent Workspace](single-village-agents.png)

Agent停止（残留所有プロセス0）、タブ・workspace削除、サーバー停止、状態削除まで実施。main比較用コピーとブラウザ検証状態も削除。

## 限界

実機はローカルCodexのみ。Claude/実SSHの再検証は今回行っていない。旧状態の投影、規則文重複、hash/unpasted照合互換、PurpleMux内部promptファイル利用は次段階。旧通知設定名VILLAGE_OFFICE_URLは互換で残し、通知先だけ/agentsに正規化する。旧runtimeデータは移行も削除もしない。
