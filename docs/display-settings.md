# 表示・通知設定

上部の「設定」歯車から、返信の書体とビューワーを選択できます。Direct・終了Agent履歴・執務室の返信／報告に共通で適用し、人間入力の表示は変えません。

- 標準／ゴシック／明朝／等幅はOSの書体を使用します。利用可能な書体がなければgeneric familyへフォールバックします。
- 既定はMarkdown。プレーンテキストではMarkdown・Mermaid・画像参照を安全な原文で表示します。Markdownへ戻すと図・保存画像の表示と拡大が使えます。
- 表示設定はブラウザのlocalStorage `village-display` に保存します。
- 管理セクションのAgent追加・Project管理・工房設定・終了Agent履歴は従来どおり利用できます。

通常のturn完了（未読更新を含む）は淡い緑、正式依頼全体の未確認完了 `attention=true` だけ強い緑です。sidebarの色・選択・作業中の青・不明状態は維持します。

## 通知

ON/OFFは村全体の既存通知CLIに適用します。ブラウザ通知権限や宛先を設定する機能ではありません。宛先・認証情報は既存のサーバー／CLI設定を使い、設定画面へ返しません。ONでも未設定・送信失敗・到着未確認を成功と表示しません。設定画面を開いたり変更しても通知テストは送りません。

正式CLI（既存の認証・VILLAGE_URLを利用）:

```sh
node scripts/village.mjs notifications status
node scripts/village.mjs notifications configure false
node scripts/village.mjs notifications configure true
```

HTTPは既存 `POST /api/village` に `{"argv":["notifications","configure","false"]}` 等を送ります。引数は `true` / `false` のみです。

`VILLAGE_STATE_DIR/notification-settings.json` にbooleanのみをatomic renameで保存し、再起動後も維持します。ファイルがない初回は従来の `VILLAGE_NOTIFICATIONS` を既定値とし、保存後は設定ファイルが優先します。壊れた設定は安全側のOFFに倒します。更新は既存通知キュー上で直列化するため、既に開始した送信の取り消しではありません。OFF中の完了は既存履歴に未送信として記録し、ONへ戻しても再送しません。正式依頼完了の判定・券・既読の仕組みは変更しません。
