# 旧秘書の担当引継ぎ

`agents handover-plan SOURCE TARGET` は同Projectの秘書間の移管対象とplanHashを返す。
`agents handover SOURCE {operationId,planHash,targetAgentId,actorRunId,reason}` は、そのProjectの受付済み・実行中リーダー作業から、許可された整理に使う管理操作。人間専用retry/completeの代用ではない。

先にバックアップを取り、旧秘書に実行中/受付追跡がないことを確認し、正式stopでruntime終了とremainingOwned=0を確認する。移管前にplanを再取得。変更競合なら再調査し、同一操作の応答不明は同一operationId/入力で照合する。

- 会話ID、過去runの元Agent/runtime/結果を保存。会話の現在担当と今後の成果配送先を変更する。
- queuedは会話だけ、dispatch/facts/session/inputなしを必須とし、同じrun IDの担当だけ移す。転送後の未送信入力は通常配送の対象。
- 単一root・終端済みの旧仕事は担当のみ移す。unknown/review/inbox/過去runは保持し、retry/resume/新run生成は行わない。旧仕事の処置判断は引継先へ残る。
- sent/running、子仕事、開始前計画、予約、未配送入力がある旧仕事は拒否する。
- 履歴の画面上の所属は引継先へ投影するが保存済み過去runのAgent IDを変更しない。
- 移管後は旧秘書への新規入力を拒否。正式agents deleteの通常条件が満たされたら削除する。履歴は残る。

この機能は実行結果の成功化・仕事取消・不明入力の再送をしない。移管の許可は個別依頼から判断する。
