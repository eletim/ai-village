# 工房とAgentの直接操作

`/agents` は秘書を呼ばずに工房登録、Agent起動、指示、追加指示、状態・返答確認、終了を行う画面です。トップページにもリンクがあります。既存の秘書画面と旧job APIは互換性のため残しています。旧jobの「全体で1件」の制約は直接操作APIには適用されません。

## 起動

Node.js 22以上、SSH接続先のログインシェルから使えるPurpleMux/Codexが必要です。

```bash
npm ci
VILLAGE_OFFICE_URL=http://127.0.0.1:5173/agents npm run dev
```

利用URL: http://127.0.0.1:5173/agents

今回の村長PCには `ai-village-direct.service` をユーザーサービスとして設定しました。

```bash
systemctl --user start ai-village-direct.service
systemctl --user restart ai-village-direct.service
systemctl --user status ai-village-direct.service
journalctl --user -u ai-village-direct.service
```

サービスの配置は `~/.config/systemd/user/ai-village-direct.service`、作業ディレクトリは `/home/eletim/DevEnv/ai-village` です。同じ状態ディレクトリで別サーバーを同時起動しないでください。Linux abstract socketで二重監視を拒否します。サービスはユーザーセッション内で稼働し、ページを閉じても継続します。PC停止中は監視できません。

## データ・API

`VILLAGE_STATE_DIR`（既定 `.runtime`）の `direct.json` に工房、Agent、実行を別配列で保存します。工房は名前、SSH接続先、PurpleMuxブラウザURL、複数の作業場所を持ちます。作業場所は工房に存在する絶対パスを登録してください。Agent作成ごとに専用workspaceとcodex-cli tabを作成します。Agentは起動時の接続情報を保持し、工房を編集しても既存Agentを別ホストへ付け替えません。

| API | 内容 |
| --- | --- |
| GET `/api/direct` | 工房、Agent、実行履歴、通知状態 |
| POST `/api/direct/workshops` | `{name, sshHost, baseUrl, workplaces: ["/path"]}` |
| PUT `/api/direct/workshops/:id` | 工房の編集（同じ入力形式） |
| POST `/api/direct/agents` | `{workshopId, cwd, name, requestId}` |
| POST `/api/direct/agents/:id/runs` | `{instruction, requestId}` |
| POST `/api/direct/agents/:id/stop` | `{}`、対象Agentのみ終了 |

`requestId` は呼び出し側が発行する8〜100文字の英数字・underscore・hyphenの識別子です。通信結果不明の同一操作を照会するときは同じID・内容を使います。画面はUUIDを発行します。異なるAgentには並行送信できます。同じAgentには未確定の実行を重ねられません。将来の秘書もHTTP APIまたは `DirectAgents` サービスを呼べます。

既存の `WorkshopBridge.remote`（SSH、シェル引数quote、監査）、`VillageNotifier`（Notify CLI、通知履歴）、プロセス所有権確認を再利用しています。直接操作は旧bridgeの `job` には依存せず、hostとAgent IDを常に明示します。アクセス制限は既存HTTPサーバーのHost/Origin検査と認証設定を引き継ぎます。

## 復旧・完了判定

- JSONを一時ファイルへ書き、fsync、rename、ディレクトリfsyncで永続化します。書き込みとAgent単位の操作を直列化します。
- workspace/tab作成と指示送信の前に意図を保存します。作成・送信結果が不明でも自動再試行しません。Agent作成失敗時には保存済みworkspace IDとPurpleMux側の `AI村 direct <Agent UUID>` を確認してください。
- 送信時の前回結果を保存し、指示にランダムな実行IDの返答用識別子を付加します。結果が前回と異なり、その識別子を含み、同じAgentセッションの `idle` または `ready-for-review` 状態であるときだけ応答完了になります。識別子を返さないAgentや外部からのセッション変更は未確定のままです。画面キャプチャは成果として使いません。
- Codexの作業場所の信頼確認画面は、PurpleMuxがidleと返しても送信をブロックします。PurpleMuxリンクから確認してください。
- SSH障害は接続不明として監視を継続します。応答完了、通信不明、終了、送信結果不明を区別します。中断は完了にしません。未確定の実行を解消できない場合は対象Agentを明示終了し、新しいAgentで進められます。
- 応答完了でも `achievement: unverified` です。返答を読み、人間が依頼の達成を判断します。成功をモデルで推測する処理はありません。
- 再起動時は既存tabの監視を再開し、指示は再送しません。完了後もAgentを保持します。
- 終了は保存済みtab ID・tmux session名を照合し、そのプロセス木をPIDと開始時刻で追跡して停止します。別プロセス群へ移った子プロセスも追跡します。同じ作業場所の別Agentを停止対象にしません。初期terminal tab、workspace、作業ファイルは保持します。

## Notify

2026-11-04追記: 送信先を `/ntfy` に変更し、Agent別のVPN通知リンクを追加しました。トークン入力・通知テストの最新手順は [Notify連携](notify-direct.md) を参照してください。以下の404は変更前の検証記録です。

既存の `notify send --title ... --message ... --click ...` を使用します。`~/.config/notify/config` または既存の `NOTIFY_CONFIG` / `NOTIFY_*` 設定をCLIが解決します。秘密情報をUIへ渡しません。`VILLAGE_OFFICE_URL` は `/office` または `/agents` のHTTP(S) URLを受け付けます。通知端末から開く場合は、その端末から到達可能な認証済み公開URLを指定してください。localhostは村長PCからのアクセス用です。

指示ごとの実行IDで通知を重複排除し、`notifications.jsonl` に送信前のclaimを保存します。送信途中でバックエンドが停止した場合も再送せず、配送結果不明の可能性を残します。厳密なexactly-once配送は保証しません。`sent`はNotifyサーバー受理であり、端末への配送・クリックの確認ではありません。通知失敗でも返答と完了状態は保存します。

## 2026-11-04 実環境検証

- main `3276b47` を新規cloneし、既存チェックアウトを上書きせず `feat/direct-workshop-agents` を作成。リポジトリおよび親ディレクトリに適用されるAGENTS.mdはありませんでした。
- E-frontier: PurpleMux 0.5.2、ログインシェルのCLIは `/home/eletim/.local/share/pnpm/bin/purplemux`。`help`、`api-guide`、workspace一覧、タブ状態、設定キー、待受ポートを確認。秘密値は出力していません。
- PurpleMux URL: `http://e-frontier.tail6bc726.ts.net:8022/`。HTTPアクセスは認証画面への307。リンクは `?workspace=...&tab=...`。ブラウザログイン後の操作は未確認。
- 画面からE-frontierを登録し、実Agentを起動して `DIRECT_FIRST_OK` を取得。同じAgentの追加指示で `DIRECT_SECOND_OK` を取得。
- 初回に新規ディレクトリの信頼確認を検出。専用の `/home/eletim/ai-village-direct-check` のみCodexの信頼対象に登録。初回の未確定Agentは明示終了し、再送しませんでした。
- 2つのAgentへ同時に `sleep 25` を含む指示を送信。全ブラウザページを閉じたまま村長バックエンドを再起動し、instanceIdが変わったことを確認。両方で `RECOVERY_0_OK` / `RECOVERY_1_OK` を取得。物理工房はE-frontierのみで検証、複数工房の分離は自動テストで確認。
- 復旧検証実行ID: `36c68895-db8c-477f-a428-0a234a47aaee` / `bcc8e51b-ffd4-4f7c-ba4c-f40bd999bfd2`。同じ実行を維持して完了し、自動再送なし。
- 検証用の片方をAPIで終了し、`remainingOwned: 0` を確認。他方の `bdeab87b-6247-4355-9b5c-3a17c1a3c955` は待機状態で保持。workspace `ws--ot58m` / tab `tab-h3Ikog` で追加指示可能です。無関係な既存Agent/workspaceは終了していません。
- 完了ごとにNotify CLIを呼び出したものの、既存設定 `NOTIFY_SERVER=https://eletim.jp` の送信先がHTTP 404、CLI終了コード22。実配送は未完了です。有効なNotify配信エンドポイントとtopic設定の確認・修正が必要です。トークンの有効性は404のため判定できていません。
- 実機の証跡は `.runtime/validation/`（スクリーンショット、ブラウザエラー一覧、復旧結果）、操作履歴は `.runtime/ssh-audit.jsonl`、通知結果は `.runtime/notifications.jsonl`。ランタイムデータはcommit対象外です。

自動検証: `npm run check`、`npm test`（103件）、`npm run build`。ブラウザ検証は `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome VILLAGE_TEST_PORT=5184 npm run test:ui`。登録・編集、入力保持、HTMLの文字列表示、モバイル幅も確認しています。既存画面を含むブラウザテストは19件成功、1件skip（既存の条件付きテスト）でした。
