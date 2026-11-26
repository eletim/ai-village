# 秘書の回答完了表示を既読で解除

2026-11-26。人間の仕様訂正「既読にしたら解除されてほしい」に対応。分岐元はremote `integration/event-driven-requests` と照合した `593ddf07ecadaec0b60b737be167ffaf0b066d80`。既読後も次送信まで保持するPR166の仕様は撤回。PR166自体の再操作はしていない。

## 変更

`DirectAgents.presentation()` が返す `answerComplete` は、従来の正常回答判定と既存 `reviews[agentId].unreviewed === true` の両方を必要とする。`humanProjection` 内の正常回答候補は従来通り、受付済み・正常終端・最新run・session/turn・非progress・未処理runなしを確認する。APIの全体/lean/focus/差分/会話ページングより前で表示条件を一つにする。

既読は既存viewAgentが完了集合から作ったrevisionを照合し、現行revisionだけを保存する。古いackは409となり、新しい未読回答の枠を消さない。表示用の永続状態やschema、新しい操作、保持タイマーは追加しない。既読規則・通知・attention・成果採否・目的達成には変更なし。未読の正常回答だけが強調対象で、仕事達成表示ではない。

CSS色復元、送信前ローカル抑止は今回含まない。既存色を使い、既読で通常色に戻る。非選択/hidden中は未読を保持し、選択/visibleに戻ると既存autoackで解除。queued/実行中/失敗/中断/受付不明、内部progressは引き続き強調しない。工房・リーダーのanswerCompleteは従来通りfalse。

## 隔離検証と証拠

新規clone `/home/eletim/ai-village-completion-read-clear`、branch `fix/secretary-completion-read-clear`。空きを確認した専用15596（ブラウザ標準fixture）/15597（実HTTP+偽native）、使い捨てSQLite/HOME/CODEX_HOME、通知OFF、偽pmux/tmux。既存サーバー再利用や実データ複製なし。本番への会話入力/既読/停止/runtime交換なし。

`tests/browser/secretary-completion-http.spec.js` は実会話HTTP、native JSONL、終端観測、projection、SSE/同期、Chromium DOM/CSS、実view/ackを通す。attention/completedの直接注入やAPI応答mockなし。hiddenの試験ではdocument.visibilityStateだけを制御する。PC1440/スマホ幅390 × dark/lightで以下を確認:

- running/commentaryプレビューはfalse。hidden中に正常終端が到着すると未読true/完了表示trueを保持。
- visible復帰のautoack後は未読false/完了表示false、緑枠・濃緑見出し・アイコンoutlineが消える。
- 次の未読回答に対して前回答のrevisionでackすると409。新回答はtrueを保持し、現行autoackでfalse。
- final本文のみ、別turn正常終端、別sessionファイルの同turn終端では現在回答の完了表示false。別session試験は別隔離Agentのログに同turnIdを置く。現在Agent自身のobservedSessionId不一致も単体テストで確認。
- 未選択で完了→未読/強調保持→選択時autoackで解除。既読後reloadでもfalse。
- 正式job→リーダーfinish/正常終了→配送→followup→内部報告はfalse。修正成果を正式acceptした秘書正常回答は未読true/強調true。
- 保存直後、複数queued、旧回答正常終了、中断、失敗、受付不明、再接続でfalse。受付不明の送信回数は1。偽通知CLI呼出0。

[DOMとAPIの時系列](secretary-read-clear-evidence/completion-api-browser-evidence.json) に属性・computed色・revision/run/stateを保存。PC/390、dark/lightの未読/既読画像も同フォルダ。単体はviewAgentを通す既読解除、古いrevision拒否、次回答の未読保持、正常終端・session/turn等の既存境界を確認。

実行:

```sh
npm ci --ignore-scripts
npm run build
VILLAGE_NOTIFICATIONS=false node --test tests/secretary-completion.test.js
VILLAGE_NOTIFICATIONS=false node --test $(rg --files tests -g '*.test.js' | rg -v '^tests/notifier.test.js$')
env -u VILLAGE_NOTIFICATIONS node --test tests/notifier.test.js
VILLAGE_NOTIFICATIONS=false VILLAGE_TEST_PORT=15596 VILLAGE_COMPLETION_PORT=15597 npx playwright test tests/browser/secretary-completion-http.spec.js tests/browser/board-review.spec.js tests/browser/scoped-sync-review.spec.js tests/browser/sidebar-live-completion.spec.js tests/browser/notification-themes.spec.js --workers=1
npm run typecheck
npm run check
```

build/vendorは検証と並列実行しない。notifier単独は全送信先が生成された偽CLIまたはstubであることを読んで確認した上でOFF解除。他の検証はOFF。

## 結果・失敗履歴

- 関連単体5/5成功。
- notifier除外の全単体938成功・1skip・0失敗。6操作/永続化/既読/通知ポリシーを含む。
- 偽通知単独7/7成功。
- 関連ブラウザ18/18成功。工房/リーダーの既読・attention、非表示/非focus、stale ack、scope/paging/reconnect、sidebar/themeを含む。
- 最後にAPI/DOM一致、枠解除assert、画像保存を追加して実HTTPブラウザを再実行。1/1成功（12.6秒）。結果は `browser-final.log`。
- build、typecheck、check成功。
- 初回通知OFFの全単体は940成功・1skip・5失敗。失敗はnotifier.test.jsの通知送信期待5件。OFFによる不一致を成功と扱わずログを保持し、上記の分離実行で補完。
- 初回ブラウザ1/1成功。その後別session/複数queuedを追加した関連18件も成功。製品コードの追加変更はなし。

[検証ログ](secretary-read-clear-evidence/) に初回失敗を含め保存。検証用の一時scriptは既存テストへ反映し、再現可能にしている。

## 限界と引継ぎ

実装者による検証であり独立レビュー済みではない。独立レビュー/重要指摘の判定、バックアップ/反映は依頼元が担当。全ブラウザ一式の再実行は今回はせず、変更に関係する18件と実HTTP追加検証を実施した。実モデル・物理スマホ・実外部通知は未検証。幅390は同一PC上のChromiumであり物理端末ではない。全競合の形式保証はない。

マージ/本番反映/サービス再起動/runtime操作は未実施。状態移行は不要。必要ならレビュー後にこの差分をrevertして表示条件だけ戻せるが、戻す操作は実施していない。別目的の性能調査は `/tmp/secretary-conversation-performance-report.txt` として提出済みで取り下げず保持し、今回の修正へ混ぜない。
