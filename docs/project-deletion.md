# Projectと所属Agentの削除

村の「… → Project管理」で対象を選び、「Projectを削除…」を押します。確認画面にはProject名、所属Agentの名前・ID・状態、実行中の作業も終了することを表示します。「キャンセル」では何もしません。「削除」は所属解除ではなく、所属Agent全員の停止と削除です。

既存のstop処理で対象tabとsessionを照合し、所有プロセスを記録・停止します。全員の終了確認後にProjectを通常一覧から除外します。途中で接続不能等が起きた場合はProjectを残し、未確認Agentと理由を表示。「残りを再試行」で同じ操作を再開できます。終了確認済みのAgentは通常一覧から消え、再度終了しません。会話は「終了Agentの履歴」から閲覧でき、正式requests/work/runの参照も保持します。

削除開始時に対象一覧・操作IDをruntimeのdirect.jsonへ永続化します。再起動後は自動で停止を再実行せず、確認画面から再開してください。削除中のProject名・所属変更・Agent追加・新規送信は拒否します。終了を開始した後の「キャンセル」やEscapeは画面を閉じるだけで、既に開始した削除を取り消したりAgentを復活させたりしません。

## 正式CLI/API

既存のVILLAGE_URL・認証設定を使います。

```sh
node scripts/village.mjs projects list
node scripts/village.mjs projects delete-plan PROJECT_ID
```

返されたProject名とmembers全員を確認し、`revision`と`members`の各`id`/`revision`をそのまま送ります。操作IDは新しい一意の値を使います（再試行時は同じ値）。

```sh
node scripts/village.mjs projects delete PROJECT_ID '{"operationId":"delete-UNIQUE-ID","revision":3,"members":[{"id":"AGENT_ID","revision":0}]}'
```

HTTPでは `GET /api/direct/projects/:id/delete-plan` と `POST /api/direct/projects/:id/delete`（上記JSON、Content-Type: application/json）。確認時からProject revision・所属一覧・Agent metadata revisionが変わると409となり、削除を開始しません。再取得して確認し直してください。

応答の `status` は `deleted` または `partial`。**HTTP 200だけで全員の削除成功とは判断しないでください。** `partial`の`remaining`にはAgent ID・名前・理由が入ります。同じJSONで再試行できます。通信切断で応答不明の場合もdelete-planで状態を取得し、`deletion.operationId/revision/members`を使って再開します。二重呼び出しは直列化し、完了済み操作は保存された結果を返します。

削除途中の対象は固定され、所属の追加・解除・移動もできません。他のProjectのAgentは対象外です。過去の完了依頼は書き換えず、新たな成功通知も発行しません。削除対象の未完了workはAgentの終了確認後に終了扱いとなります。削除開始後は先行したfinishが後から成功確定することを防ぎます。

## 確認不能の場合

対象tabが既になく、所有プロセスの記録もない場合、tabがないことだけでは子プロセスの終了を証明できません。この場合はProjectを残し、手動確認が必要と表示します。起動結果不明でtab IDがない場合も同様です。存在しない証拠を作る強制成功操作は追加していません。接続障害やclose応答喪失は、接続回復後に保存済みの識別情報・所有プロセスを照合して再試行できます。

登録・削除状態は既存のstate dirに保存し、固有Project名・Agent ID・接続設定をソースに登録しません。このPRはmainから独立しており、未mergeの他PRとの統合・稼働反映は別途必要です。
