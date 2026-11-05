# 直接Agent操作のNotify連携

対象ブランチ: `feat/direct-workshop-agents`。mainと過去の未マージブランチ、AWM固有の設定は変更していません。

送信先URL: https://eletim.jp/ntfy/topic-eletim （従来の `agents` から変更）。

## 配置した設定

実行ユーザーは `eletim`。設定ファイルは `/home/eletim/.config/notify/config`、所有者eletim、権限600です。

```sh
NOTIFY_SERVER='https://eletim.jp/ntfy'
NOTIFY_TOPIC='topic-eletim'
# NOTIFY_TOKEN は既存値があれば保持。新規設定の場合は空で準備。
```

既存トークンを出力・変更せず、送信先とtopicを更新しました。VPSからのトークン取得は行っていません。設定ファイルはこのリポジトリの外にあり、Gitには含めません。

`/home/eletim/.config/systemd/user/ai-village-direct.service.d/notify.conf`:

```ini
[Service]
Environment=VILLAGE_NOTIFICATIONS=true
Environment=VILLAGE_NOTIFY_BIN=/home/eletim/.local/bin/notify
Environment=NOTIFY_CONFIG=/home/eletim/.config/notify/config
Environment=VILLAGE_OFFICE_URL=http://100.87.176.23:5173/agents
UnsetEnvironment=NOTIFY_TOKEN NOTIFY_SERVER NOTIFY_TOPIC
```

UnsetEnvironmentは、systemd側に残る環境変数が設定ファイルの値を上書きしないための指定です。トークンをサービスファイルに記載しません。Notify CLIは設定ファイルを読み、Bearer認証ヘッダーをファイルディスクリプター経由でcurlへ渡します。トークンをコマンド引数にしません。既存CLI自体は変更していません。

## ユーザーが最後に行う操作

村長PCの通常の対話端末で以下を実行します。トークンはコマンド引数へ記入せず、`Notify token (hidden):` が出た後に貼り付けてEnterを押します。入力は画面に表示されず、シェル履歴にも入りません。echoを抑制できない端末やパイプ入力では保存を拒否します。

```bash
python3 /home/eletim/DevEnv/ai-village/scripts/configure-notify.py \
  --config /home/eletim/.config/notify/config --set-token
systemctl --user restart ai-village-direct.service
```

この明示操作でのみ既存トークンを置き換えます。空入力は拒否し、元のファイルを保持します。ファイルをsourceして編集することはなく、値をシェル引用して権限600で原子的に保存します。

まずバックエンドと同じ経路で通知テストを行います。下記IDは実機検証後も保持しているAgentです。

```bash
curl --fail-with-body -sS \
  -H 'Content-Type: application/json' \
  -d '{"agentId":"bdeab87b-6247-4355-9b5c-3a17c1a3c955"}' \
  http://127.0.0.1:5173/api/direct/notifications/test
```

APIのHTTP 200は配送成功を意味しません。JSONの `status: sent` と `delivered: true` がNotifyサーバー受理を示します。実端末への配送は端末で確認してください。`agentId`を省略して `{}` を送ると一覧ページ向けのテスト通知になります。存在しないAgentは404です。テストは毎回新しい通知IDを使い、過去の失敗通知を再送しません。

続いてVPNに接続した端末から以下を開きます。

http://100.87.176.23:5173/agents#agent-bdeab87b-6247-4355-9b5c-3a17c1a3c955

1. 「実機検証・継続Agent」に `通知テストです。短く「確認できました」と返答してください。` と送信する。
2. 「応答完了」、返答、通知状態を確認する。ページを閉じてもバックエンドの監視は続く。
3. 通知端末で到着を確認し、通知を開く。同じVPNに接続していれば、該当Agentのカードへスクロール・フォーカスする。
4. 同じAgentに別の指示を送信し、次の実行の通知が届くことを確認する。

## 実装と失敗時の確認

`DirectAgents.notify` は完了した実行を保存した後、実行IDを通知IDとして `VillageNotifier` へ渡します。通知にはAgent IDを渡し、クリック先をVPN originの `/agents#agent-<ID>` にします。秘書による報告生成は不要です。通知の送信・失敗は実行の完了・達成判定とは別です。再起動時は過去の通知を再送しません。送信途中の停止では結果不明の可能性があります。

確認場所:

- `/agents` の指示ごとの通知状態（例: `cli_failed / cli_configuration_error`）。
- `/home/eletim/DevEnv/ai-village/.runtime/notifications.jsonl`: 通知ID、Agentクリック先、試行・結果。CLIのstdout/stderrやトークンは保存しません。
- `/home/eletim/DevEnv/ai-village/.runtime/direct.json`: 指示・返答・実行ごとの通知結果。
- `journalctl --user -u ai-village-direct.service -n 50 --no-pager`: サービスの起動・待受・プロセス障害。

`exitCode: 2` / `cli_configuration_error` はCLIの設定不備（未設定トークンを含む）、`exitCode: 22` / `http_error` はHTTPエラー、`cli_unavailable` はCLIが見つからない、`timed_out` は期限超過です。認証エラーのHTTPステータスそのものはCLI出力を保存しないため記録しません。設定確認のためにトークン入りファイルをcatしたり、shellのxtraceを使ったりしないでください。

## トークン入力前の検証

- 自動テストで、VPN Agentリンク、再起動時の重複防止、CLI設定失敗の秘匿記録、既存トークンの保持、権限600、引用と入力制約を確認。
- ブラウザで、非同期にAgent一覧を取得した後、通知URLの対象Agentへフォーカスすることを確認。
- 実サービスを一時的に空トークンの検証用ファイルへ向け、実Notify CLIと実Agentでテスト。2回の指示とも `NOTIFY_PREP_1_OK` / `NOTIFY_PREP_2_OK` を取得し、応答完了を維持しながら通知結果 `cli_failed`、`exitCode: 2`、`reason: cli_configuration_error` と対象Agentリンクを保存した。検証後は上記の本番設定ファイルパスへ戻した。本番トークンは変更しない。
- 認証付き通知の配送成功・実端末の受信はユーザーの入力後に確認する。トークン入力前には確認済みとしない。

自動テスト106件、直接操作のブラウザテスト2件、構文検査・buildが成功。実機証跡は `.runtime/validation/notify-integration.json`（Git対象外）。
