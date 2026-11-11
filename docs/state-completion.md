# 単一村 第2段階: 状態の正本

`runModel`、`requestModel`、`agentModel`を正本とする。`projectObservation`と互換getterを廃止し、旧run.stateを観察で上書きしない。照合待ちはsent/runningを維持し、終了境界・セッション変更・タイムアウトでended/unconfirmedになる。

画面・HTTP・CLIの表示値は`state/projection.ts`と`state-projection.mjs`で生成するDTO。表示ラベル（completed/awaiting_input等）は保存状態ではない。`acceptance`/`blocksInput`/`dispatchConfirmed`、work.state、ticket、inbox、work.finishはAPIからも削除。transport-ack/inputはrunのfacts、完了申告はrequestのdeclarations、結果配送はresultOf/recipientRunIdで表す。`requests results`とgetのresultsは送信と親子関係から導出する。workは識別子・親子・送信の並びのみを持つ。

acknowledgeはCLI/APIから削除（404）。古い起動指示のhashが一致しなければlegacy全文方式へ降格し、再起動せず現行規則を受け取れる。Agentが過去の指示を参照してacknowledgeを呼んでも操作は行われない。

## 移行

`canonicalStateVersion=1`を追加。既存run/request/agent移行の検証後、`direct.pre-canonical-state-v1.json`を排他的に作成しfsyncしてから置換する。純粋変換は決定的・冪等。元モデル、進行中の目印/セッション/inputId/turnId/cursor/fileIdentity/priorInputs、通知履歴を保持。旧項目から残っている受付事実・申告はモデルへ収容する。停滞したactiveはlegacy-needs-decisionを付ける。不整合なモデル/参照は起動拒否し、元ファイルを黙って捨てない。診断とバックアップから人間が確認できる。

今回の本番コピーはAgent33 / run628 / request248。移行前後の分布は同一。送信は正常523、確認できず92、失敗6、中断2、取消4、実行中1。依頼は完了212、取り下げ10、進行中＋要確認25、進行中1。停滞0。コピーの本番Agent接続を遮断し、通知OFFで起動と画面を確認した。詳細は[移行記録](verification/stage2-migration.json)。

## 反映手順（秘書が実施）

本PRのbaseはintegration/single-village。mainにはマージしない。旧クライアントと新APIの混在を避け、反映後ブラウザを再読込する。

```bash
# 本番フォルダで未コミット変更がないことを確認
 git status --short
 cp .runtime/direct.json .runtime/direct.manual-backup-$(date +%Y%m%d-%H%M%S).json
 git checkout integration/single-village
 git pull --ff-only origin integration/single-village
 PATH=/home/eletim/.nvm/versions/node/v22.23.2/bin:$PATH npm ci
 PATH=/home/eletim/.nvm/versions/node/v22.23.2/bin:$PATH npm run typecheck
 PATH=/home/eletim/.nvm/versions/node/v22.23.2/bin:$PATH npm run check
 systemctl --user restart ai-village-direct.service
```

healthのcommit、Node22、canonicalStateVersion=1、canonicalMigration、バックアップ、件数、進行中送信の追跡と重複なし、要確認、停滞0を確認。実行中は一律終了させず再観察する。

失敗時はサービス停止→コードを反映前commitへ戻す→同時点の手動バックアップをdirect.jsonへ戻す→そのコードでnpm ci→サービス起動。コードとデータを必ず対で戻す。AgentのCLIプロセスは再起動しない。復旧中に実行済みの外部操作は巻き戻らないため、不明入力を再送しない。

## 検証と限界

- npm test: 301成功・失敗0・既存スキップ1（基準ブランチは298成功・失敗0・スキップ1）。型・構文・ビルド成功。
- Claude/Codex通常依頼→報告、ClaudeからCodexへの委任→子結果配送→finish→報告を実機確認。結果配送実行中のサーバー再起動後、同じ送信が正常終了。結果は[実機記録](verification/stage2-live.json)。
- 本番データを変更せず隔離コピーだけを使用。ローカル実機であり実SSHは未検証。
- 型付き投影はAPI互換の表示ラベルを残す。照合hash互換・規則の重複は第3段階で除去する。PurpleMux内部prompt利用の解消は第4段階。

Playwrightは基準102成功/17失敗。第2段階の全体実行99成功/20失敗のうち、新しいモデルを欠く旧fixture3件を更新し対象再実行3件成功。残る17件は基準と同じ既存失敗。全体の最終再実行は未実施。実機Agentは第3段階の「再起動なしlegacy継続」検証に引き継ぎ、全検証後に削除する。
