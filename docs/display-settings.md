# 表示・通知設定

上部の「設定」歯車から、返信の書体とビューワーを選択できます。Direct・終了Agent履歴・執務室の返信／報告に共通で適用し、人間入力の表示は変えません。

- 標準／ゴシック／明朝／等幅はOSの書体を使用します。利用可能な書体がなければgeneric familyへフォールバックします。
- 既定はMarkdown。プレーンテキストではMarkdown・Mermaid・画像参照を安全な原文で表示します。Markdownへ戻すと図・保存画像の表示と拡大が使えます。
- 表示設定はブラウザのlocalStorage `village-display` に保存します。
- 管理セクションのAgent追加・Project管理・工房設定・終了Agent履歴は従来どおり利用できます。

通常のturn完了（未読更新を含む）は淡い緑、正式依頼全体の未確認完了 `attention=true` だけ強い緑です。sidebarの色・選択・作業中の青・不明状態は維持します。

## 通知

ON/OFFは村全体の既存通知CLIに適用します。ブラウザ通知権限を設定する機能ではありません。認証情報は既存のサーバー／CLI設定を使い、設定画面へ返しません。宛先の編集方法は下記を参照してください。ONでも未設定・送信失敗・到着未確認を成功と表示しません。設定画面を開いたり変更しても通知テストは送りません。

正式CLI（既存の認証・VILLAGE_URLを利用）:

```sh
node scripts/village.mjs notifications status
node scripts/village.mjs notifications configure false
node scripts/village.mjs notifications configure true
```

HTTPは既存 `POST /api/village` に `{"argv":["notifications","configure","false"]}` 等を送ります。引数は `true` / `false` のみです。

`VILLAGE_STATE_DIR/notification-settings.json` に設定をatomic renameで保存し、再起動後も維持します。ファイルがない初回は従来の `VILLAGE_NOTIFICATIONS` を既定値とし、保存後は設定ファイルが優先します。壊れた設定は安全側のOFFに倒します。更新は既存通知キュー上で直列化するため、既に開始した送信の取り消しではありません。OFF中の完了は既存履歴に未送信として記録し、ONへ戻しても再送しません。正式依頼完了の判定・券・既読の仕組みは変更しません。

## 通知先の編集（PR12上の追加）

設定歯車の「通知サーバーURL」「トピック」から保存できます。これは村全体の通知先です。空欄／省略は現在値を維持し、「既存CLI設定に戻す」で村側の宛先指定だけを解除します。ON/OFFや保存・解除ではテスト通知を送りません。未保存のフォーム内容は送信に使いません。

```sh
node scripts/village.mjs notifications configure '{"server":"https://notify.example.com","topic":"village"}'
node scripts/village.mjs notifications configure '{"resetDestination":true}'
```

同じ操作を `POST /api/village` の `argv` で利用できます。保存先は従来の `VILLAGE_STATE_DIR/notification-settings.json`（Git管理外、0600）で、enabled/server/topicだけを保存します。ON/OFFだけの旧CLI操作・旧設定ファイルも互換です。

実装確認した `/home/eletim/.local/bin/notify` の `--help` と本体に従い、保存したserver/topicを `notify send --server ... --topic ...` で渡します。宛先は各項目について次の順に優先します。

1. 村で保存した指定（CLI引数）
2. notify実行環境の `NOTIFY_SERVER` / `NOTIFY_TOPIC`
3. `NOTIFY_CONFIG`、または `XDG_CONFIG_HOME` / HOME配下のnotify設定ファイル
4. notify自身の既定値（serverのみ。topic未設定はCLIが失敗）

tokenは今までどおりnotifyの環境変数／設定ファイルからのみ取得します。村はtokenを読み出して表示・保存せず、CLI標準出力も記録しません。誤ってtokenや認証付きURLをAPIに渡した場合も拒否し、通知設定操作の生の引数は監査ログに記録しません。設定ファイル由来の有効宛先を取得するためにshell設定を評価することもありません。画面で空欄なら「既存のCLI設定を使用」と表示します。

URLはHTTPS（loopbackだけHTTP可）、userinfo/query/fragment/control文字は不可。topicは英数字・`_`・`-`だけです。VILLAGE_OFFICE_URLは通知をクリックした時の村へのリンクであり、通知サーバーURLとは別です。既存のクリック先・token設定やCLIが使えなければ送信は成功せず、結果に失敗を記録します。設定保存は接続確認を意味しません。

## 配色テーマ

設定の「配色テーマ」からダーク（既定）・ライト・セピアを選択できます。即時反映し、書体／viewerと同じlocalStorage `village-display` に保存します。Direct・執務室・履歴・設定や管理ダイアログ・入力・Markdown表／コードの面と文字色を切り替え、作業中の青／完了の緑／不明状態の色と正式依頼のattentionは維持します。旧執務室ヘッダーの独立した配色選択は共通設定へ統合しました。

検証では実notify本体に隔離configとmock curlを渡し、実通信なしで4経路（村指定、空欄維持、環境変数、CLI設定ファイル）を確認しました。これは実通知先への接続確認ではありません。

## Agent表示の丸／役割アイコン

「Agent表示」は既定の「状態の丸」と「役割アイコン」から選べます。`village-display.iconMode` に `dots` / `roles` を保存し、テーマ・書体・ビューワーと併存します。sidebarとAgentカード見出しに同じ形を表示します。

- 色＝従来の状態色（作業中の青、通常完了の淡い緑、正式依頼attentionの強調など）。busyの動きとreduced-motionも従来どおりです。
- 人＋名札＝秘書、工房＝worker。登録済み `role` または `location` だけで判定し、Agent名・cwdからは推測しません。不明・矛盾した役割は「?」の菱形にします。
- 工房内部の8セルの模様は工房設定を優先し、未設定時は `workshopId` から決定します。同じ工房は同じ模様で、Agent／工房の改名で変わりません。工房IDがない場合は模様部分を「×」にします。
- 模様には衝突の可能性があるため、それだけで所属を断定しません。title／aria-labelにAgent名・役割・登録工房名（登録がなければ保存された名前または未登録）・状態・要確認を表示します。

SVGは自前の固定図形のみで、外部画像や名前由来のSVGを使用しません。20pxのアイコンを折り返して配置し、狭いsidebarでも重ならないようにしています。丸モードのサイズ・状態色・選択操作は維持します。

## 工房ごとに8セルの模様を保存

設定 → 工房設定 → 対象工房の「編集」で、縦2段×横4マスを「なし／横線／ダイヤ」から選びます。実寸20pxと拡大100pxのプレビューを表示し、保存に成功した内容をsidebarとカード見出しに適用します。左側の固定二本線と1.4px点は廃止しました。配列の順番は上段左→右、下段左→右です。

保存先は既存のruntime `direct.json` のworkshops内 `iconPattern`（Git管理外）。設定値を優先し、未設定／nullでは工房IDから安定した8セルの仮模様を生成します。改名しても変わりません。新規登録フォームで保存する模様はプレビューの選択値です。既存工房をAPI更新する際、iconPatternや他の工房項目を省略すると現在値を保持します。

登録工房IDの確認:

```sh
node scripts/village.mjs agents list
```

区別しやすい初期案（実登録には適用していません）:

```sh
# 工房A: 上段は横線4本、下段は空白
node scripts/village.mjs workshops pattern WORKSHOP_A_ID '["line","line","line","line","none","none","none","none"]'
# 工房B: 上段は空白、下段はダイヤ4個
node scripts/village.mjs workshops pattern WORKSHOP_B_ID '["none","none","none","none","diamond","diamond","diamond","diamond"]'
# 自動の仮模様に戻す
node scripts/village.mjs workshops pattern WORKSHOP_ID null
```

正式HTTP操作は `PUT /api/direct/workshops/:id` に `{"iconPattern":["line","line","line","line","none","none","none","none"]}` を送ります。CLIは同じ保存処理を使用します。8要素以外、none/line/diamond以外を拒否します。工房ID・接続設定・登録作業場所や既存Agentの接続スナップショットは変えません。登録実データを編集せず、統合・反映後に必要な工房IDへ設定してください。
