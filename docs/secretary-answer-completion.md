# 秘書の回答完了表示

2026-11-26。分岐元 `f46ab2f0ac12738b377e061ee660498545266763`（remote integration/event-driven-requests と照合済み）。実装用cloneは `/home/eletim/ai-village-secretary-completion`、branchは `fix/secretary-answer-completion`。

## 変更と境界

以前は、普通の会話が正常終了しても `reviews.attention=false` なので枠・濃緑見出しが出なかった。attentionによる枠は閲覧中の既読ackで消えていた。元調査全文は [investigation.txt](secretary-completion-evidence/investigation.txt)。

`humanProjection` が秘書の `answerComplete` を都度導出する。永続状態、秘書の操作、起動入力は増やさない。現在Agentがidle/completed、最新entryが受付照合済みの正常終了会話で人間向け回答、現在native session/turnと一致する場合だけtrue。未処理run（queued/受付照合中等）があればfalse。最新の失敗・中断、別native turn/session、内部progress、工房Agentは対象外。判定は会話ページング・focusによる本文削減より前に行うので、非選択時のsidebarと選択時のパネルが一致する。

パネルとアイコンの `data-answer-complete` で描画する。枠とアイコンは既存正常終了色 `#22c55e`、見出しは既存緑系の `#245b3a`、文字は `#d8ffe4`。dark/light両方で同じ濃緑。選択表示・未読・要確認は独立して残る。既読ack後も回答完了表示は維持するが、次の保存済み入力、実行、失敗、中断、受付不明では解除する。

通知・既読・成果採否・仕事達成の処理、工房/リーダー/外側PurpleMuxの表示仕様は変更しない。`answerComplete` は仕事達成を意味しない。

## 実経路の検証

`tests/browser/secretary-completion-http.spec.js` と `tests/helpers/completion-http-fixture.mjs` は、APIやattention値のroute注入を行わない。専用15585で実際の `scripts/dev.mjs` と使い捨てSQLiteを起動し、会話API、正式job/followup/finish/decide、偽nativeのJSONL入力・終了を通す。実際のprojectionをChromiumがSSE/同期APIで取得し、実際のUI既読ackを送る。実モデルの返答生成は行っていない。

標準ブラウザサーバーは15584、一時state、通知OFF。偽pmux/偽tmux、隔離のsleepプロセスだけを使い、偽nativeの終了事実を観測させる。本番への入力・既読・故障注入・Agent操作はない。外部通知なし。

確認した流れ:

- PC1440/スマホ390 × dark/light。通常相談→受付照合→途中commentaryプレビュー→native正常終了→回答完了。枠・見出し・sidebarの属性とcomputed styleを検証。
- 閲覧中ack後 `unreviewed=false` でも完了表示保持。hidden/visible復帰、reload（SSE再接続）、再選択でも保持。
- 非選択で正常終了→実projectionの未読true→選択して既読false。どちらも完了表示保持。
- 人間依頼→正式job→リーダーfinish/正常終了→正式配送→followup→内部途中報告の正常終了では完了表示false。
- 修正後のリーダーfinish/正常終了→正式配送→accept→秘書正常終了ではtrue。会話のattentionはfalseのまま。リーダーのanswerCompleteはfalse。
- 次送信（native受付前）でfalse。実行中に新入力queued、先行run正常終了後もfalse。新runの中断、失敗でもfalse。
- 偽送信CLIが送信記録後に失敗する受付不明ではfalse。再接続後もfalse、送信回数1のまま。現行APIの正規化名は `awaiting_input` / runModel `sent`（transport-ack事実なし）。旧名 `send_unknown` も純粋境界テストに含む。
- 通知OFFで偽通知CLI呼出0。単体fixtureでも既読・projection取得による通知増加なし。通知ポリシーの既存回帰と、偽CLIだけのnotifier単独テストも成功。

[実projectionとDOM実色の時系列](secretary-completion-evidence/completion-api-browser-evidence.json)、[PC画像](secretary-completion-evidence/desktop-dark-completed.png)、[スマホ画像](secretary-completion-evidence/mobile-light-completed.png)。画像は今回実API/native fixtureの実ブラウザ出力。

## 検証結果

- `npm run check`、`npm run typecheck`、`npm run build` 成功。build/vendorはテストと並列にしない。
- 通知OFF、notifier以外の全単体: **937成功、1skip、0失敗**（938件）。6操作、永続化、目的判断、通知ポリシー、既読等の既存回帰を含む。
- 偽CLIのみ `env -u VILLAGE_NOTIFICATIONS node --test tests/notifier.test.js`: **7/7成功**。
- `VILLAGE_TEST_PORT=15584 VILLAGE_NOTIFICATIONS=false npm run test:ui`: **256/256成功**。既存工房/リーダー、要確認、色、既読抑制、再接続、画像等を含む。
- その後証拠ファイル出力と追加assertを加え、該当HTTPブラウザ **1/1**、該当単体 **4/4** を再実行して成功。実装コードは全体成功時から変更なし。
- 全ログは [secretary-completion-evidence](secretary-completion-evidence/) に保存。

## 途中の失敗履歴

1. 新cloneでvendor未生成のまま単体を実行し、`src/vendor/marked.mjs` 不在で開始失敗（2回）。build後に再実行。依存未生成による失敗で製品テスト合格とは数えない。
2. 初版の新単体fixtureでProject所属設定を省略し「Project所属の秘書で会話を開始してください」で1件失敗、3件成功。隔離Projectを作成して修正後4件成功。
3. 初版ブラウザassertがdot背景色のみを期待して失敗。既定のroleアイコンは透明背景＋currentColorで描画されるため、roleはcolor、dotはbackgroundColorを測るよう修正。製品CSSを弱めて回避していない。
4. 受付不明APIを旧名send_unknownと期待して失敗。現行のawaiting_input/sentとtransport-ackなし、再送なしを照合するassertに修正。UIの非完了表示確認は維持。

該当失敗ログも同ディレクトリに保持。全体単体・全体ブラウザの最終実行では失敗なし。

## 限界と引継ぎ

実モデル・物理スマホ・外側PurpleMuxの実画面は未検証。タッチ端末相当の幅390のChromium検証。通知OFFの主シナリオは外部通知の実送信を証明しない。実送信は意図的に行わず、偽通知CLIと既存ポリシーテストで補完する。

実装者による検証であり独立レビュー合格とは扱わない。依頼元が別担当レビューを行う。マージ・本番反映・サービス再起動・runtime交換は未実施。既存PR164等は操作していない。反映/バックアップ/戻し作業は依頼元の担当で、このPRには状態移行や永続schema変更はない。
