# 段階4: Agentの観察と送信操作

`agent.agentModel` は人間の起動/停止意図と最新の構造化観察を保持する。
`state/agent.ts` の `deriveAgent / sendControls` だけが状態・操作可否を決める。
起動直後は保存した観察を破棄し再取得する（対象プロセス消失を検証した停止記録のみ保持）。
通信失敗を終了や待機にしない。送信中の受付待ちは物理入力の保留として扱い、二重送信を防ぐ。
補足にはCodexの実行状態、単一の所有送信、native入力照合・セッション一致が必要。
報告中も同じ条件で補足可能。依頼完了後の追加は新しい依頼になる。

報告待ち・要確認は依頼欄で表示する。Agentのボタンには混ぜない。
`reportPending` は削除し、`reportStatus` と依頼の要確認欄を使用する。
旧API名 `state/lifecycle/activityState/connectionState/canSend/canQueue/canSteer/sendReason`
は読み取り専用の導出値。保存しない。runの `acceptance/blocksInput/dispatchConfirmed/needsReview`、
work.state、ticket.state、inbox.stateもモデル/観察済み事実の投影であり独立した正本を持たない。
transport-ackはprogramが記録する配送事実で、native受付・成功とは区別する。
run.stateの旧名は既存UIとnative照合中の観察表示に限り残す。終端判定の正本はrunModel。

## PurpleMuxの例外

PurpleMuxのstatusには `cliState` と `permissionRequest` があり、入力待ちに使用する。
初回cwd信頼確認専用の構造化フィールドはない（src/types/status.tsを調査）。
セッション確立前だけ従来の `Do you trust` 等の画面検出を残す。
これは起動セットアップの例外であり、Agentの回答文から送信・依頼の成否を解析しない。
将来PurpleMuxが信頼確認を構造化したら置換する。

## 移行・反映

`agentStateVersion=1`、`agentMigration` を記録し、最初の起動でのみ
`direct.pre-agent-state-v1.json` を同一状態ディレクトリに排他作成・fsyncする。
未知の版・不正Agentモデル・バックアップ競合は起動拒否。送信/依頼モデル、
照合ID、cursor、fileIdentity、目印、通知記録は変更しない。
古い起動指示のAgentは既存のhash検査でlegacy全文送信に戻る。acknowledge互換は維持。

予行は本番状態のコピー、Node22.23.2のフルパス、systemd同環境、別ポート、
通知設定ファイルと環境変数の両方OFF、PurpleMux接続を遮断して行う。
health、移行記録/バックアップ、checkProgress違反0、要確認件数を確認しコピーを削除する。

予行成功後、PRをmerge commitでmainへ入れ、本番で以下を実行する。
空でないgit statusなら中止。手動バックアップ名と更新前commitを記録する。

```bash
cd /home/eletim/DevEnv/ai-village
git status --short
cp .runtime/direct.json ".runtime/direct.manual-backup-stage4-$(date +%Y%m%d-%H%M%S).json"
export PATH=/home/eletim/.nvm/versions/node/v22.23.2/bin:$PATH
git pull --ff-only origin main
npm ci
npm run typecheck
npm run check
systemctl --user restart ai-village-direct.service
```

反映後: サービスactive・/procの実行Node・healthのmerge commit、agentStateVersion、
agentMigrationとバックアップ、実行中送信のinput/turn/session/dispatch時刻の継続、
送信回数が増えていないこと、checkProgress違反0、要確認件数、秘書1/2と工房の
実際の観察とボタンが一致することを確認。要確認の依頼を勝手に処理しない。

失敗時はサービスを停止、コードを773f92bに戻し、上の手動バックアップをdirect.jsonへ
戻す。Node22でnpm ci後にサービスを開始する。node22.confは維持する。
コードとデータを必ず対で戻す。復旧中の新しい送信は行わない。

## 検証結果

- 全体339件: 336成功、既存HTTPリダイレクト期待差2失敗
  （todo-http / travel-registry-http）、既存1スキップ。追加6件は成功。
  typecheck、check、diffチェック成功。
- Claude/Codexの通常依頼と報告工程はfinishなしで完了。
  ClaudeのAskUserQuestionがneeds-inputとして検出され、回答後に完了。
  Codexの補足・実行中再起動後の正常完了（照合IDと送信時刻維持）を確認。
- Claude→Codex委任→結果配送→親finish、旧acknowledge互換、子中断時の要確認、
  UIの再試行/完了扱い/取り下げを実行した。通知OFF。
- 接続断は専用transportラッパーでPurpleMux呼出しを失敗させ、両実Agentの
  つながらない表示と操作禁止、復帰後の送信可を確認。Agentプロセス自体は維持。
  停止で両Agentの所有プロセス残数0を確認し、専用タブ・workspace・状態を削除した。
- 本番コピー初回予行: 33Agent / 612送信 / 242依頼、要確認25、進行違反0。
  実行中1送信を保持。通知OFF、接続遮断、移行バックアップ作成。

[実機記録](verification/state-stage4-live.json)、
[実行中](verification/state-stage4-running.png)、[入力待ち](verification/state-stage4-input.png)、
[要確認](verification/state-stage4-review.png)、[接続断](verification/state-stage4-disconnected.png)、
[停止](verification/state-stage4-stopped.png)。
