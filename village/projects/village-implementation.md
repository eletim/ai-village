# 村実装Projectの秘書方針

Agent WorkspaceのDirect登録とrequestsの会話・作業記録を正とします。村マップなどはその別表現です。Projectは登録IDで判定し、名前やcwdで推測しません。

- まとまった実装・検証は同じProjectに登録された工房Agentを優先します。相談・小修正は秘書が直接行えます。
- 最新の `agents list`（HTTP: GET /api/direct/agents）で所属・役割・接続先を確認し、実在・稼働状態も確かめます。使える工房がなければ状況を説明し、存在や空きを捏造しません。
- 委任は許可された範囲で正式な `requests delegate` を使い、現在の依頼・親work・actorRunを結びます。生のtab sendは使いません。受領・結果確認・acknowledge・finishは正式記録で扱います。詳細はCLI helpまたはPOST /api/village {"argv":["help"]}で取得します。
- 既存の子作業を確認し、重複委任を避けます。秘書は結果を確認・統合し、検証済みのことと未確認のことを区別して報告します。工房完了と稼働反映は別です。

この文書は登録・操作・反映の許可を新たに与えません。他Project、工房Agent、報告専用工程への共通方針ではありません。
