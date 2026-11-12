# 単一化 第3段階：規則と入力照合

この文書は第3段階の履歴です。新規送信のマーカー廃止・全文照合と互換性は [input-envelope.md](input-envelope.md) が現行仕様です。

第2段階（PR #63）の上に積む。統合先は integration/single-village 系のみ。秘書が第2段階→第3段階の順で統合・反映する。本作業では本番を変更していない。

## 正本

`server/agent-rules.mjs` から起動指示、legacy全文、報告、discovery、Project、結果配送、CLI操作helpを生成する。Agentの判断操作はdelegate/finishだけ。通常回答と報告は正常終了で完了し、委任ありは申告と正常終了を照合する。達成度は本文の評価であり状態を変更しない。

既存Agentは再起動不要。導入済み規則が現在の規則と違う場合やpromptブロックの確認失敗時はlegacy全文へ戻す。既存CLIが持つ古い指示を書き換えたとはみなさない。acknowledge APIは第2段階で廃止しており、古い指示による呼出しは成功扱いにしない。

照合はnative user入力の `ai-village-run-<id>` の完全なトークンのみ。全文inputHash一致、Python unpastedを撤去。fileIdentity/cursor/session、競合・重複入力、owned input、steering境界は維持する。native index内のdigestは記録の重複排除用で、送信所有権の照合には使わない。出力文は状態判定に使わない。

## 移行

`markerVersion=1`、事前バックアップ `direct.pre-marker-v1.json`、移行結果 `markerMigration`。第2段階canonical移行の後で実行する。純粋変換は決定的・冪等。inputHash/priorInputs.hashを除去する。

- 目印ありsent/running: モデルと照合チェックポイントを保持して観察継続。
- 目印なしsent/running: ended/unconfirmed（legacy-marker-missing）、進行中依頼に要確認。自動再送しない。
- queued: 送信時に目印を付与する。
- 終了済み: 過去の結果を保持する。

本番の読取コピーでAgent33・送信628・依頼248。前後とも送信は正常523/確認できず92/失敗6/中断2/取消4/実行中1、依頼は完了212/取り下げ10/進行中＋要確認25/進行中1、停滞0。実行中1件は目印を持ち、モデル・チェックポイントを保持。目印欠落による終了変更0。二度目も同一結果。[記録](verification/stage3-migration.json)。本番Agent接続とSSHを遮断、通知OFF、別ポートで起動・health・地図/Agent画面を確認した。

## 検証

- npm test: 306成功、失敗0、既存スキップ1。統合基準は298成功/失敗0/スキップ1、第2段階は301成功/失敗0/スキップ1。
- 型検査・構文検査・ビルド成功。
- Playwright全体102成功/17失敗。17件は統合基準と同じ既存失敗。最後の表示整理後、関連10件を再実行し全成功。
- 実Claude/Codexの通常依頼→正常終了→報告。既存の両CLIを再起動せずlegacyへ移行して成功。
- Claude→Codex委任→子結果配送→finish→報告が成功。第2段階では結果配送実行中のサーバー再起動後も同じ送信が一度だけ正常終了。
- Claudeに文字列 `<pasted_content>` を含む依頼を送り成功。native記録はlegacy 2,395文字、startup-v1短縮824文字で、**両方とも包装され、本文の文字列もエスケープされた**。目印照合は成功。短縮しても包装されない保証はない。
- 初回新規Agentの指示ブロックversion不一致を検知して安全側へlegacy化したため、生成側を既存検証プロトコルversion=1に修正。両providerの実生成文で導入・検証する回帰テストを追加。その後の新規Claudeはstartup-v1を維持し依頼・報告を完了。

[実機記録](verification/stage3-live.json)、[Agent画面](verification/stage3-live-agents.png)、[コピー地図](verification/stage3-copy-map.png)、[コピーAgent画面](verification/stage3-copy-agents.png)。全4体を停止し残存所有プロセス0を確認、専用タブ/workspace、検証サーバー、コピー・一時状態を削除済み。

## 反映と復旧（秘書が実施）

第2段階→第3段階を integration/single-village に統合する。mainへは直接入れない。[第2段階のコマンド](state-completion.md#反映手順秘書が実施)に従い、clean確認→手動バックアップ→統合ブランチpull→Node22でnpm ci/typecheck/check→サービス再起動。

再起動後はhealth commit、実行Node、canonicalStateVersion/markerVersion、両移行記録と事前バックアップ、件数、進行中送信の同一IDでの追跡・重複なし、要確認と停滞0を確認。ブラウザを再読込する。目印なしの進行中があれば要確認になり、人間が判断する。

失敗時はサービス停止し、反映前commitと同時点の手動direct.jsonバックアップを対で戻し、そのコードでnpm ciして起動する。Agent CLIは再起動しない。外部操作は巻き戻らないので不明入力を自動再送しない。

## 限界

PurpleMux生成promptへの追記と読取確認は残る（第4段階で公式機能へ移す）。確認と送信は非原子的。目印は照合用であり真正性や本文完全性の証明ではない。実SSH・別CLIバージョンは未検証。direct/requestsの責務分割と過去検証文書の統合は第5段階。表示ラベルは境界DTOとして残り、保存モデルの別正本にはしない。
