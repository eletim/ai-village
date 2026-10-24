# 村長発言 4ed73fc7-5462-4dda-8250-c16f8854d558 対応

作業場所：`/home/eletim/ai-village-workshop/ac0585c5-a578-4b6c-bbbd-0b9a53b32d0d/source`

ベース：`443c384b1f9507c655d6ed0176e1a6ba5cd43a41`。指定Git接続でcloneし、ベースを含むことを確認して指定ブランチ `village/work-ef203ada-8812-4d54-aee2-f9227dd69f5a` を作成。他Agentへの委任、他workspace/tabの操作、コアのローカルパス使用、コア反映、実Agentの承認・停止・解放は行っていない。

## 変更

- 村長邸の常駐ミクを工房Agentと独立描画。実secretary.status、接続失敗、人物から執務室への移動に対応。
- TODO専用API・原子的ファイル保存・直列化・版番号競合検知・入力検証。ブラウザ間ポーリング同期、編集入力保持。会話や工房起動に接続しない。
- 秘書返信IDによる未読favicon。初回履歴を基準にし、以降の未読を再読み込みでも保持。非表示タブは既読にしない。会話内の返信末尾が表示されたら既読。既存notify処理は変更しない。
- loopback既定を維持し、Host/Originを制限。別端末向けHTTPS originは明示設定と認証ファイル必須。VPN限定プロキシひな型とコア適用手順を `vpn-access.md` に記載。
- 自動／ライト／ダークの保存とOS設定追従、資料・会話・報告・フォームの配色。
- 狭幅・横向き・縮小高さでの折り返し、タッチ対象、画像添付・長文・スクロール・入力の可用性改善。

## 検証実績

Node v22.23.2、Google Chrome 131.0.6778.264（`/usr/bin/google-chrome`）。専用状態ディレクトリと独立ポート5287〜5290を使用。テストサーバーはテスト終了時に停止。

- `npm ci`：成功、14 packages、audit脆弱性0。
- `npm run check`：成功。
- `npm test`：77件成功、失敗0、スキップ0。
- 実Chromeで `npm run test:ui`：最終16件成功、失敗0、スキップ0。`VILLAGE_TEST_CODEX_BIN` は専用fixtureを指定し、実工房へ送信しない。
- `npm run build`：成功、静的UIを `dist/` に生成。
- `git diff --check`：成功。

新規Nodeテスト：TODOの再ロード、並行競合、入力拒否、保存失敗時の未反映、削除、実HTTPサーバー停止・再起動後の復元、認証401、Host/Origin403、認証済み200、全インターフェースlisten拒否。Host境界テストはNode fetchがHostを書き換えるため、生HTTPクライアントで実Hostを送信するよう修正して成功を確認した。

新規Chromeテスト：独立ブラウザコンテキスト間のTODO同期、完了／未完了、編集競合、削除、保存失敗時の入力保持、仕事が増えないこと、常駐ミクと実status、解放済みAgentとの区別、未読faviconと再読み込み・重複・既読解除、テーマ保存／OS追従、1440/390/320px幅と横向き／縮小高さ、タッチ、長文末尾へのスクロール、画像添付、資料表示。既存テストで会話継続・メモ、画像HTTP境界、報告・承認・停止・解放の模擬API経路と復旧も通過。

初回UI実行では継続fixture未指定により1件スキップしたが、fixtureを指定した最終実行で解消した。未読の非表示タブ条件はheadless Chromeのフォーカス挙動に依存しないようvisibilityStateを明示的に模擬して検証。ソフトキーボードは縮小viewportで検証し、実スマートフォンのIMEではない。

## 確認画像とログ

保存先：`/home/eletim/ai-village-workshop/ac0585c5-a578-4b6c-bbbd-0b9a53b32d0d/verification/`

- `desktop-light-village.png` / `desktop-dark-village.png`
- `desktop-light-office.png` / `desktop-dark-office.png`
- `mobile-light-village.png` / `mobile-dark-village.png`
- `mobile-light-office.png` / `mobile-dark-office.png`
- `mobile-dark-documents-conversation.png` / `mobile-dark-report.png`

ライト／ダークのPC／スマホ画像を保存し、実画像を確認して見出し・入力・資料ボタンのコントラストを修正した。上位作業場所の `node-tests.log`、`ui-tests-release.log`、`check.log`、`build.log` に実行結果を保存。

## 未確認・適用範囲

コアへの反映は別作業。実VPN種別・コアアドレス・WSLネットワーク経路・TLSプロキシ適用・別の物理端末からの接続・実スマホIME・実通知受信は未確認。複数端末同期は独立ブラウザで確認したもの。工房Agent操作は既存テストの模擬境界で検証し、実Agentを操作していない。VPN設定に必要な確定情報と適用後チェックは `vpn-access.md` に記載。ACL・ファイアウォール・インターネット公開は変更していない。
