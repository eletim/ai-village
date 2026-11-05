# ローカル工房とSSH工房

`/agents` の工房登録・編集に「接続方式」を追加しました。

| 工房 | 接続方式 | CLI | PurpleMux URL |
| --- | --- | --- | --- |
| E-ryzen（村長PC） | local | `/home/eletim/.local/bin/purplemux` を直接実行 | http://e-ryzen.tail6bc726.ts.net:8022/ |
| E-frontier | ssh | `ssh E-frontier` の `bash -lic` から実行 | http://e-frontier.tail6bc726.ts.net:8022/ |

両工房を稼働中のAI村に登録済みです。利用URLは http://100.87.176.23:5173/agents 。工房と作業場所を選ぶと、同じ画面から起動・指示・追加指示・履歴確認・タブリンク・終了を操作できます。

## 接続方式

工房APIの `connectionType` は `local` または `ssh`。省略した従来の入力・保存データは `ssh` として扱います。ローカル工房はSSH接続先が不要です。既存Agentの接続情報は起動時の値を維持し、後から工房を編集しても接続方式や実行PCは変わりません。

ローカル処理は `run(command, argv)` で直接起動し、シェル文字列の評価やSSHを行いません。PurpleMux操作だけでなく、終了時の所有プロセス追跡・停止も同じ接続方式で実行します。ローカル操作のIDと操作名は `.runtime/local-audit.jsonl`、SSH操作は既存の `.runtime/ssh-audit.jsonl` に記録します。指示本文や認証値は操作監査に含めません。

サービスの `/home/eletim/.config/systemd/user/ai-village-direct.service.d/local-workshop.conf`:

```ini
[Service]
Environment=VILLAGE_PMUX_BIN=/home/eletim/.local/bin/purplemux
```

`VILLAGE_PMUX_BIN` はバックエンド起動時の設定です。ブラウザから任意のCLIパスは指定できません。工房のURLはブラウザ用で、CLIの認証値・接続ポートは各PCのPurpleMux CLIが解決します。

## 2026-11-04 検証

専用作業場所 `/home/eletim/ai-village-direct-check` を使用。ローカル側ではこの場所だけをCodexの信頼対象に登録しました。既存Agent/workspaceは操作対象にしていません。

- E-ryzenのローカルCLIのhelp・workspace一覧・稼働ポート8022を確認。CLIは実チェックアウトを起動するwrapperで、`--version` は未対応でした。
- 実機検証前に両PCの既存tab ID・workspace ID・session名を保存。終了後に同じ一覧と照合し、E-ryzenの既存4タブ・E-frontierの既存82タブがすべて保持されていることを確認しました。
- 通知topicは `topic-eletim` へ変更。既存トークンを保持し、実機検証中だけ空トークン設定を使用しました。新topicへの認証付き配送確認はユーザーの入力後に行います。
- VPNのHTTP originでも送信要求IDを発行できるよう、secure context限定の `crypto.randomUUID` を `crypto.getRandomValues` によるUUID生成へ変更しました。

通知の入力・反映・テスト手順は [Notify連携](notify-direct.md) を参照してください。

- 各工房に1つずつ検証Agentを起動し、`sleep 15` を含む指示を並行送信。初回・追加指示の計4実行すべてで応答完了を確認。
- 先にE-frontierの検証Agentだけを終了し、E-ryzen側が待機状態を維持していることを確認。その後E-ryzen側も明示終了。いずれも `remainingOwned: 0`。
- 各PurpleMuxタブのリンクに保存済みworkspace/tab IDが含まれ、実ブラウザで各PCのログイン画面へ到達することを確認。未ログイン状態なので、ログイン後のタブ表示自体は未確認。
- VPNのHTTP URLから実ChromeでE-ryzenのAgent起動→直接指示→返答取得→終了を追加確認（`isSecureContext: false`）。ブラウザエラーなし。
- 今回起動した3つの検証Agentは終了済み。専用workspaceの初期terminalは保持。以前から保持しているAgentには操作していません。
- 証跡: `.runtime/validation/two-workshops.json`、`two-workshops.png`、`local-vpn-ui.json`。ランタイムファイルはGit対象外。
- 構文検査、build、自動テスト108件、直接操作ブラウザテスト4件が成功。
