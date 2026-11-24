# 秘書会話とリーダーの仕事

## 境界（実装前の設計）

通常の会話を依頼graphから外す。明示的な会話モードで作るconversationとrunにはworkIdもinputProtocolも付けず、正常なnative終了が会話ターンの終わりになる。仕事達成、秘書の成果採用、人間の了承とは別。分類器は置かない。従来の送信・進行中依頼の補足は従来契約で完了する。

秘書の窓口は `conversations get/job/amend/withdraw`。jobは実際に配送された人間発言への参照と引用、目的・制約を必須とし、受付中の秘書会話runだけが操作できる。引用が存在することは検証するが、曖昧な発言の意味を機械的に許可へ変換しない。秘書が明示依頼と権限範囲を判断し、不明なら会話で確認する。目的の改訂もAgent由来を維持。既存の一般操作の許可条件は変えない。

project.leaderAgentIdは同じProjectの既存工房Agentを指す担当設定。locationは所属場所、leaderはProjectでの担当であり別概念。未設定/消失/停止/移行中は新jobを拒否。受付済みjobはその時点のリーダーへ固定し、担当設定変更で付け替えない。実行不明を自動再送しない。通常の工房直接依頼を残す。

jobは独立した既存graph（createdBy=agent、root recipient=conversation）として原子的に作る。秘書会話をgraph親にはしない。リーダーは既存delegate/respond/finishで工房の子結果を読み採否・修正を担当する。rootの正常提出後、同じconversationの永続受信箱へ成果を1回記録してgraphの業務提出を完了する。これは秘書の採用でも人間への配信完了でもない。根のquestion/extension報告だけを同じ戻り口へ送る。細かいprogressと内部申告は注入しない。

戻り口の資料は不変のsource ID、順序、配送run IDを持つ。人間会話中には割り込まず後続runを予約する。queuedの同一Agent順序と既存native照合/不明時不再送を使い、正常終了した会話回答だけを「人間向け回答」として区別する。成果配送時点では秘書判断を記録しない。秘書が必要なら追加jobや制約訂正を行える。業務完了の外部通知は抑制し、秘書の説明と重複させない。

## 永続化と移行

新しいconversation記録をSQLiteの独立collectionへ保存。job作成、graph、戻り口は同じ保存境界に含め、保存失敗時は戻す。operationIdとpayloadで冪等受付し、内容の違う再利用は拒否。外部送信は保存後、受付不明の送信を再実行しない。旧データに会話を推定作成しない。

固定startup-v2は変更しない。同じwork rulesにconversation modeの別契約を明記し、封筒のmodeで区別する（phaseはwork、revision再取得を維持）。可変rulesに手続きを委ねているstartup-v2セッションは新しい明示会話で適用可能。旧固定契約/旧セッションにプロンプト編集だけで適用したことにしない。必要時は親が安全な境界でprepare-runtime→新Agent作成→正式adopt-runtimeと引継ぎを実施する。今回本番Agentは停止・採用しない。

導入はバックアップ→独立受入→コード反映→Project担当設定→新しい会話の開始。既存仕事は旧ルートのまま。ロールバック時は新会話/jobの受付を止め、進行中を正常終了または明示的取り下げして証拠を保存する。新recipientを知らない旧版へ新データのまま戻さない。旧版へ戻す場合は導入前バックアップを別stateで復元し、導入後外部操作を照合して手動引継ぎする。

## 受入の観測点

会話だけではgraph/申告案内/業務待機を生成しない。jobの同一operationId再送は同一graph/run。人間引用とAgent依頼を別記録。外国conversation・未受付run・worker・不一致payloadを拒否。子採否と正常終端が既存条件を満たすまで成果を送らない。questionは進捗とは区別、資料到着中の会話は中断しない。保存失敗/再起動/遅延成果で二重配送しない。失敗/不明配送は成功扱いせず自動再送しない。

独立実AI受入は専用cwd/port/state・通知無効・新秘書/リーダー/工房Agentで行う。相談→自然な返答→明示依頼→job→delegate→子結果レビュー/修正→finish正常終端→秘書への資料配送→成果説明のnative入力・出力・受付・runとgraphを保存する。人工bootstrap例外は不要とする。詳細手順・検証結果・限界は実装完了時追記する。

## 実装した入口と保存境界

- ブラウザの秘書欄に「秘書との会話」と従来の「新しい仕事」を表示。既存のactive依頼は従来補足先として残す。会話送信は既存runs endpointに `mode:"conversation"`。会話ID未指定は同Agent・Projectの最新会話を使う。別Projectへ移した後の会話は新IDになる。
- `POST /api/direct/conversations/get {conversationId,actorRunId?}`、`job/amend/withdraw` はCLIと同じサービス。Agentのgetは今回actorRunIdを必ず渡し、そのsequenceまでの人間発言/資料だけを読む。後着成果は状態だけ確認でき、後続正式配送の資料本文を先読み注入しない。actorRunIdなしは管理者用の全記録読取であり、今回ターンのモデル用コンテキストには使わない。
- job/amend/withdraw: `{conversationId,actorRunId,operationId,instruction,authorization:{runId,quote},humanRequestId?}`。amend/withdrawのみ仕事ID必須。同会話の受付済み人間発言引用は監査用根拠。意味上の実行許可の判断は秘書が担い、サーバーは分類器・許可推論器を持たない。既存と同じ信頼済みローカルAPIの権限モデルであり、同一ホストの悪意あるCLIから人間用APIを隔離する新認証基盤は追加しない。
- `projects leader PROJECT_ID REVISION AGENT_ID|-` またはProject操作UI。担当変更は今後のjobだけ。既存graphの委任/採否/finishを変更しない。仕事の通知先だけをconversationへ分け、グローバル報告書換え設定に依存せず秘書が成果説明する。
- 保存collectionはconversations。graph単位のRequestUnitsにも関連conversationと配送runを含める。operationとgraph生成、成果/相談の受信箱と配送run作成は同じSQLite保存。送信は保存後に既存のnative照合を使用。
- getのhumanAnswerは受付照合＋正常終端した表示対象回答。人間が実際に読んだこと・了承したことは意味しない。内部資料はdeliveries、回答はrunsとして分ける。run失敗/不明はhumanAnswer=null、配送を自動再送しない。後続の新規人間発言は別のrunとして配送可能。
- question/extensionと正常成果、失敗/中断/不明終端、人間による完了/取消を戻す。progressの全注入はしない。人間による状態変更とprogramによる失敗観測はprogram由来、元資料の人間記録を保持。会話への配送は業務完了通知を発火しない。
- 秘書の未完了job/配送がある間のAgent削除・Project移動を拒否。リーダー未設定/消失/停止/不明時はjob受付を拒否。受付済み仕事の担当変更・失敗runの再送は自動で行わず、既存の確認・復旧手続きへ戻す。

## 検証結果と限界

2026-11-24: 共有部分変更後のNode全体621成功・1skip、ブラウザ全体189成功。後続のターン読取境界/永続化検証は会話専用テストで追加確認。check/typecheck/build成功。Node/HTTPのnativeは合成fixtureであり実AI証拠ではない。

初回は会話runの再起動時ID検証の不足をテストが検出し修正した。別の初回失敗は新worktreeのvendor未生成、ブラウザテストの送信ボタンselector不一致。いずれもログを保持。正常終了前のfinishを確定扱いする変更はない。PR116/117/120を含む既存回帰は全体試験で確認。

実AIは親が独立実施する。この実装担当は未送信の新秘書/リーダー/工房Agentと隔離サーバーを準備しただけで、モデルの自然な意図判断・修正判断・文章品質は未評価。プログラム上の受付/配送は重複を抑止するが、Agentが別operationIdで同じ仕事を繰り返し頼むことや回答文の意味上の反復を一般に検出するものではない。権限引用も意味上の正しさの証明ではない。

初版では会話履歴のページング・会話内の複数スレッド切替・人間既読/秘書採否の独立状態・新しい仕事の復旧専用UIは追加しない。getは全文読取のため、非常に長い会話のコンテキスト量は今後の課題。起動時はconversationのrun/配送参照を検証し、欠損を勝手に再作成しない。新しい固定bootstrapは不要だが、startup-v2でないセッションは新セッションと正式adopt-runtimeが必要。adopt後も同じconversation IDでgetし、古い操作を再実行しない。

## 独立実AI受入手順

`scripts/prepare-secretary-leader-eval.mjs LAUNCHER_LOG NEW_EVIDENCE_DIR NEW_AGENT_CWD` はisolated-browser-serverのport/state/PID/cwd/通知無効を/procから照合し、新Project・工房・3Agent・担当だけ作る。送信は行わない。API呼出しごとにattempting→received/rejected/unknownを保存し、unknownで停止する。再実行で新規作成を重複させずmanifestと正式GETを照合する。

1. 親が対象SHAと起動PID/cwd/state/port、通知false、3Agentのstartup-v2 hash、canSendを記録。モデル設定は実際の最初のnative turn_contextを保存し、不明なら不明とする。
2. 秘書の会話モードで「日々の作業メモを整理したい。まず進め方だけ相談したい。今はファイルを作らないで」と送る。graphなし、respond/finishなし、外部書込なし、正常受付/終了と自然な回答を確認。
3. 同じ会話に明示依頼: 「ここから実装を依頼します。この隔離作業dirだけに短い作業メモのテンプレートを1ファイル作ってください。Projectリーダーに頼み、リーダーは登録済み工房Agentへ委任し、内容をレビューして不足なら修正依頼してください。完了したら私の目的に合うか判断して説明してください。本番・他ディレクトリ・外部送信は禁止」。具体的なAgent ID・専用dirはmanifestで補う。
4. 秘書jobのauthorization引用と元runを照合。graph作成1件、createdBy=agent、root.recipient=conversation、leader固定。リーダーのdelegate・子のrespond・リーダーの全文読取とaccept/rework・finish・native正常終了を保存。修正が不要なら修正ループを実測済みにしない。別の明示制約訂正で修正が必要なケースを追加する。
5. リーダー動作中に同じ会話へ別の相談を送り、結果到着のsequence/配送runを記録。既存会話を中断しない、get actorRunIdに未来本文なし、成果1配送、秘書が人間へ目的に照らして返答、不要な業務申告なしを確認する。
6. リーダーから正式question/extensionを送るケースで同会話への戻りと秘書の確認/訂正を確認。単なるprogressは再注入されない。人間回答→amendはAgent由来。必要なら明示取り下げも確認し、送信済み効果を停止したと誤認しない。
7. 隔離サーバー再起動後にrun/配送IDが増えないことを記録。不明・失敗・429があれば受付/終端/プロバイダ出力を保存し、受付不明の自動再送をしない。API成功だけでAI受入成功としない。

各段階で人間入力、rulesRevision、モデル/effort、native生入出力、API受付、conversation/get（管理者全文とターン別）、requests get/results、UI画像、成果ファイルhash、時刻を専用証拠dirへ保存する。判定は成功/失敗/未確認を分ける。
