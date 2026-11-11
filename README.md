# AI村

村長（人間）が、PurpleMux上のClaude/Codex Agentに依頼し、委任と成果を追跡するアプリです。
村長の家の**秘書Agent**と工房の**工房Agent**は、同じAgent管理・状態モデルを使います。
概念・依存関係・単一化の段階計画は [docs/architecture.md](docs/architecture.md) を参照してください。

## 起動

Node **22.23.2以降の22系**とnpmを使用します。TypeScriptの状態モデルはNodeの型除去で実行します。
Agentを動かすPCにはPurpleMux、Claude CodeまたはCodex CLI、その認証設定が必要です。
SSH工房には鍵認証とPython 3が必要です。利用者の作業フォルダへCLAUDE.md/AGENTS.mdを書き込みません。

```bash
npm ci
npm run typecheck
npm run check
npm run dev -- --port 5173
```

- `/`: 登録された工房・村長の家・Agentの地図。
- `/agents`: Agent Workspace。工房/Project/Agentの管理、依頼、結果、要確認の人間操作。
- 工房には実行先PC（local/SSH）、PurpleMux URL、作業場所を登録します。
- Agentにはprovider、cwd、表示名、配置場所、必要ならProjectを指定します。
  Projectは分類と方針の共有単位であり、依頼とは別です。

## 依頼と状態

送信可否はAgentの最新観察から決めます。待機なら送信、実行中は待機キュー、
照合済みのCodex実行中には補足もできます。許可・入力待ちはPurpleMuxで回答してください。
通信不明を待機や成功と推測しません。受付不明の入力は自動再送しません。

委任なしの通常回答はnative正常終了で完了します。委任は正式なrequests delegateを使い、
まとめ役の完了申告と正常終了、子送信の終了を合わせて判断します。
報告モードでは最後に人間向け報告の送信を作り、その正常終了で完了します。
達成度は報告本文で伝え、本文を自動解析して状態を変更しません。
要確認の依頼は理由を確認して「再試行」「完了扱い」「取り下げ」を人間が選びます。
通知は依頼全体で1回。途中回答や子の終了だけでは通知しません。

## CLIとHTTP

```bash
VILLAGE_URL=http://127.0.0.1:5173 node scripts/village.mjs help
VILLAGE_URL=http://127.0.0.1:5173 node scripts/village.mjs agents list
VILLAGE_URL=http://127.0.0.1:5173 node scripts/village.mjs requests list
```

CLIは`POST /api/village {"argv":[...]}`と同じ操作を呼びます。
Agent/Project/依頼、TODO、出張先、画像、通知、文書・Web読取、PR管理を提供します。
画像は`images upload LOCAL_FILE`で呼び出し元の実ファイルをアップロードします。
詳細な引数はhelpを参照。旧jobs/desk/development等の操作はありません。

## 保存と接続

`VILLAGE_STATE_DIR`（既定`.runtime`）にdirect.json、専用ストア、監査記録を保存します。
起動時の版付き移行は事前バックアップを残し、不整合なら起動を拒否します。
実行中の送信の照合ID・目印・チェックポイントを引き継ぎ、再起動後に再観察します。
旧state.json/conversation.jsonは読み取りも削除も行いません。

`VILLAGE_PMUX_BIN`でローカルPurpleMux実行ファイルを指定できます。
SSH接続は登録された接続先で実行し、監査に記録します。
通知はnotify CLIを利用し、`VILLAGE_NOTIFICATIONS=false`で初期値をOFFにできます。
保存済み通知設定が優先されるため、隔離検証では専用状態を使用してください。
`VILLAGE_OFFICE_URL`は既存設定名として残し、通知先は`/agents`に正規化します。
公開アクセスは [docs/vpn-access.md](docs/vpn-access.md) など接続設定の文書を参照してください。

## 検証

```bash
npm test
npm run typecheck
npm run check
VILLAGE_TEST_PORT=5296 VILLAGE_TEST_STATE=/tmp/ai-village-isolated npm run test:ui
npm run build
```

実機検証は別ポート・専用状態・通知OFFで行い、専用Agent/タブ/状態を片付けます。
本番の状態ディレクトリを検証サーバーと共有しないでください。
過去の状態モデル接続と検証記録はdocs/state-stage*.mdにあります。
現在の単一化計画はarchitecture.mdが基準です。
