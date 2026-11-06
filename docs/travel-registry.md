# 出張先の登録と添付

入力欄の「＋ → 出張先を追加 → 登録・管理」でコンピューターの表示名と SSH 接続先（alias または user@host）を保存し、そのコンピューターにフォルダの表示名・パス・任意の補足を登録します。編集用の選択欄で「新規登録」を選ぶと追加できます。コンピューター削除は配下の登録フォルダも削除します。

「選択に戻る」でコンピューター → フォルダを選んで「添付」。Agent 直接入力と執務室は同じ操作です。添付名にはフォルダの表示名を使い、SSH 接続先・パス・補足をその時点の値でコピーします。登録変更・削除は添付済みの下書きや依頼、履歴に影響しません。チップから添付先の差し替え、「今回だけ入力」から従来の自由入力もできます。送信操作は Ctrl+Enter のままです。

登録は工房・Project と独立した参照データです。接続やフォルダ走査は行わず、既存工房から自動登録もしません。既存 `travelContexts` 送信 API と正式委任の引継ぎ形式は変更しません。

## CLI / HTTP API

既存の `VILLAGE_URL` と認証設定を使います。`node scripts/village.mjs help` にも操作が載ります。

```sh
node scripts/village.mjs travel list
node scripts/village.mjs travel update '{"revision":0,"entity":"computer","action":"add","name":"開発用PC","sshHost":"dev-machine"}'
```

返された `revision` とコンピューターの `id` を使います（以下の ID・revision は実際の一覧の値に置き換え）。

```sh
node scripts/village.mjs travel update '{"revision":1,"entity":"folder","action":"add","computerId":"COMPUTER_ID","name":"資料","cwd":"/path/to/docs","notes":"任意の補足"}'
node scripts/village.mjs travel update '{"revision":2,"entity":"computer","action":"edit","id":"COMPUTER_ID","name":"表示名変更","sshHost":"dev-machine"}'
node scripts/village.mjs travel update '{"revision":3,"entity":"folder","action":"edit","computerId":"COMPUTER_ID","id":"FOLDER_ID","name":"資料","cwd":"/path/to/new-docs","notes":""}'
node scripts/village.mjs travel update '{"revision":4,"entity":"folder","action":"delete","computerId":"COMPUTER_ID","id":"FOLDER_ID"}'
node scripts/village.mjs travel update '{"revision":5,"entity":"computer","action":"delete","id":"COMPUTER_ID"}'
```

HTTP は `GET /api/travel-registry` で一覧、`POST /api/travel-registry` に同じ JSON（Content-Type: application/json）で変更。既存と同じ認証・Origin 制限を適用します。同名も UUID で区別します。変更には一覧全体の最新 revision が必須で、競合時は HTTP 409。変更を再確認してから最新 revision で再操作してください。UI では競合した入力を残し、明示的な「一覧を再読込」で登録データに戻します。送信結果が不明な場合も先に一覧を確認し、追加を盲目的に再実行しないでください。

保存先は `VILLAGE_STATE_DIR`（既定 `.runtime`）内の `travel-registry.json`。再起動後も復元し、保存は一時ファイルからの置換です。既定の `.runtime/` は Git 管理外。別の state dir を指定する場合もソース管理外に配置してください。ホストやパスをソースへ登録する必要はありません。旧サーバーに新 UI だけが配信された場合は登録取得エラーを表示し、勝手に空データで上書きしません。
