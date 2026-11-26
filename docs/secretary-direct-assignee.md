# 秘書から担当への直接依頼

## 変更と許可範囲

人間の「修正を進めて」と、リーダーを既定にしつつ担当を明示できる要望に基づく実装。Issueの文章を仕様とはしない。PR作成まで。独立レビューは依頼元が実施し、秘書の最終レビュー・明示反映指示まで統合取込/村反映を保留する。mainマージ、既存Agentの停止/runtime交換は行わない。

分岐元は `d4c4adc4428090f56e9b3f3eb26aa7274324ac54`（integration/event-driven-requests）。この統合にはPR171のsteeringとPR172の遠隔接続が既に取り込まれている。未承認branchは取り込んでいない。PR170性能reworkはこの変更へ取り込まない。

## 操作

- CLI: `village order --run RUN [--assignee AGENT_ID] "指示文"`
- API: `conversations job` の既存JSONに、新規依頼のみ `assigneeAgentId` を追加可能。
- IDは既存の `agents list` で確認。名前や文字列から担当を推測しない。
- 省略時は現在のProjectリーダー。明示時は同一Projectの適格な工房Agent。リーダー未設定でも明示依頼は可能。Projectリーダー設定は書き換えない。
- 継続は `followup` または既存の `continue`。担当指定は拒否する。宛先変更の権限は増やさない。

役割 `location=workshop` と実行経路 `connectionType=local/ssh` は別。両経路の工房が対象であり、秘書自身、他Project、秘書role、停止・削除・未接続等の不適格担当は既存gateで拒否する。既存のactor受付/原文許可/目的/起動契約/稼働状態照合を維持。busyな担当は既存の順序queueに入り、別仕事へsteerしない。

## 冪等性と実担当

CLIの省略指定は従来の `hash(run,order,instruction)` を維持する。明示指定は `hash(run,order,instruction,{assigneeAgentId})`。同じ引数の再試行は保存済receiptを返すため、Projectリーダー変更後も配送先は変わらない。

**省略と明示は異なる依頼指定**。明示したIDがその時点の既定リーダーと同じでも別キーとなる。再試行は指定の有無と値を含め同じ引数を使用する。省略から明示への変更を、曖昧な再試行と推測して自動統合しない。異なる担当へ同じ内容を依頼できる一方、再試行時に指定方式を変えると別依頼になる点に注意する。

APIで同じoperationIdのpayloadを変更（省略→明示同一ID、別ID等）すると拒否する。既存のpayload照合を緩めない。新operationIdは新しい操作。保存成功時のroot assignee/run/receiptが確定した配送先であり、後の設定から再解決しない。保存前rollbackなら依頼は存在せず、同操作の再試行で一度だけ生成する。送信試行後にtransport応答を失った場合は再送せず、既存受付照合を維持する。

継続新jobは `rootNode(previous.q).assignee` を使う。起点の `originAgentId` や現在のProjectリーダー、末端の子仕事は使わない。人間の正式な担当変更後に作られた成果も、変更後のroot担当へ戻る。既存graphで正常に完了・配送済みのrootへhandoverを適用することはできないため、試験は失敗後の正式な人間retry/assign→正常成果→秘書followupを通した。既存仕組みの制約は変えない。子仕事への直接割込みは追加しない。

## 結果・表示・互換

依頼は従来と同じrequest graph、目的、許可参照、root recipient={kind:conversation}を持つ。結果は元の秘書会話へ配送され、採否・相談・通知は既存経路で処理する。新しい手作業状態管理や別の通知経路は追加しない。

receipt/状態投影に `assigneeAgentId`、状態投影に `assigneeName` を追加。旧 `leaderAgentId`/`leaderName` は実担当を指す互換aliasとして保持する（Projectの現在リーダーではない）。古いreceiptを再試行した場合は保存済の旧形をそのまま返す。UIの関連依頼/依頼一覧には実担当、Project設定側は「既定の依頼先」と表示。資料の文言は「担当」に改めるが、保存済source.kind='leader'、結果JSON、採否、通知規則は互換性のため維持。

work規則/helpを更新し、固定startup2/startup3本文は変更しない。両者のbyte互換をbaseとのテストで確認。規則revisionの変更とruntime契約hashの変更は別である。稼働秘書の交換や新契約適用済みという扱いはしない。

## 競合と反映/戻し方

`server/conversations.mjs`はsteeringと共通だが、今回の変更はjob担当解決/receipt/読取投影/配送文言。currentActor、同turn入力照合、追記配送の実装は変更していない。統合済steering/remoteを含む全単体・ブラウザ回帰を実行する。PR170とは同じserverファイルを触らないが、最終統合時には固定head差分を再確認する。

独立レビュー→秘書最終確認後、別担当が明示指示に従ってSQLite整合online backup、設定・添付・現統合head/runtime識別情報を保存して反映する。今回schema変更はない。ただし追加された直接依頼と継続の履歴は消さない。旧コードへ戻すと旧「現在のProjectリーダーへ継続」が復活するため、直接依頼が残る間の単純コードrollbackは安全とは断定しない。問題時は配送を行わない正式な保守手順で記録を照合し、修正前進または互換修正を選ぶ。古いDBを上書きして反映後の入力を消さない。今回これらの運用操作は行わない。

## 検証と失敗履歴

実装者の隔離検証であり、独立レビュー済みとは呼ばない。

- `conversation-assignee.test.js` 9件: 既定/明示、リーダー未設定、他Project/秘書自己/不適格担当、local/ssh、API同operationの指定変更拒否、CLI指定別キーと再試行、再起動後receipt保持、結果配送/採用、followup/continue/withdraw、リーダー変更、正式な人間担当変更、保存rollback、受付不明非再送、busy queue。
- `conversation-assignee-http.test.js` 1件: 専用15710の実サーバー、実HTTP会話→偽native入力受付→API明示job→実CLIによる同操作再試行→リーダー解除後再試行→偽native終了→元秘書へ正式結果配送→再起動非重複→採用→人間向け回答→偽通知CLI1回。異なる担当の結果をリーダーの結果と推定しない。偽通知は専用ファイルへの記録のみ。
- `conversation-assignee.spec.js` 2件: 実サービスfixtureのrequest graph→projection→Chromium DOM。PC1440/スマホ390で「担当: Worker 3」を確認し、Projectリーダー解除後も保持。実モデル/物理スマホ/実別ホストではない。
- 全単体（notifier単独を除外）968成功・1skip・0失敗。偽通知notifier単独7/7成功。build/syntax/typecheck成功。runtime startup2/3のbase互換テスト成功。
- 単体初回: 962成功・1skip・4失敗。配送資料の「リーダー→担当」変更に対する旧文字列期待だった。資料JSON/配送回復のassertは維持して文言を更新し、関連30件と全体を再検証。
- 新規試験作成中、完了済rootへのhandoverを期待して拒否された。既存仕様が許さない操作なので本体を緩めず、人間retry/assignからの継続に試験を訂正。transport応答消失をterminalと期待した試験も、既存仕様のsent/受付照合中に訂正し、再送なしを検証した。失敗ログを保存。
- ブラウザ初回257成功・2失敗。旧形式の担当fieldなしデータに「担当不明」が増えていたため、担当名fieldがある時だけ追加表示する互換処理を実装。旧testを変更せず再実行。

初回/途中/最終ログは `/tmp/direct-assignee-evidence` と `/tmp/direct-assignee-*.log`。スクリーンショットは [PC](direct-assignee-evidence/direct-assignee-1440.png)、[390幅](direct-assignee-evidence/direct-assignee-390.png)。スクリーンショットの回答は偽native fixtureであり実モデルの応答ではない。

本番のテスト入力・既読操作・障害注入・Agent停止/交換・外部通知なし。別clone、一時state、通知OFFまたは偽CLI。buildとtestは逐次。実機Codex/Claude・実別ホストの今回の直接依頼は未検証であり、fixtureを実機成功と扱わない。

最終ブラウザ: 259/259成功（既存257＋新規2）。その後、新規担当指定と既存目的/配送識別子の混在を拒否するAPI境界を強化し、実HTTP/CLI・新規担当・既存秘書操作/会話を含む関連52/52を追加実行した。全単体968/1skipはこの最終ガード追加前、関連52は追加後であり区別する。UIコードは259成功時から変更なし。
