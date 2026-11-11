# 依頼モデルの接続（段階3）

## 正本と境界

`requests[].requestModel` が依頼状態の正本。変更は `state/request.ts` の
actor付き遷移のみで行う。`request-lifecycle.mjs` は既存送信モデルの観察結果を
`observe-runs` へ渡し、作成された送信を `append-run` で登録する接続層である。
送信の事実は段階2の `runModel` から取得し、出力本文を判定に使わない。

旧 `status` と `works[].state` はAPI/画面用getter。保存時には除外する。
workは所属Agent、親子関係、送信IDの並び、互換申告履歴などを保持するが、独自の
状態遷移は持たない。作業途中の正常応答もCLIの正常終了という事実として扱い、
達成度は報告本文で説明する。完了した依頼へ追加質問するときは新しい依頼を作る。

- 委任なし: 正常終了で自動完了。報告モードなら別の報告送信を準備し、その正常終了で完了。
- 委任あり: まとめ役の申告、その送信の正常終了、全子送信の終端を照合する。
  子結果は1送信につき1回配送。配送も終わるまで完了しない。失敗の結果も配送する。
- 失敗、中断、確認不能、申告矛盾は要確認。人間は再試行・完了扱い・取り下げを選ぶ。
  人間の判断は記録し、旧送信の結果は書き換えない。
- すべての依頼遷移で `checkProgress` を検査する。次の手順の送信先が削除・停止済みなら
  要確認を追加する。報告作成や結果配送が待機中ならプログラムがpumpで進める。
- 通知は依頼ごとの固定キー、既存outbox、送信前の耐久記録を保持する。履歴通知を再発行しない。

## 操作

Agentの判断操作は `requests delegate` と `requests finish` のみ。
get/results/listは読取。旧acknowledgeはAPI/CLIで受け付けるが変更せずokを返し、helpには出さない。
finishは受付照合前、古いrevision、正常終了後も所属検証をした上で申告として記録する。
委任なし・報告のfinishは不要だが互換呼出しは拒否しない。

人間用APIは `POST /api/direct/human/requests/{retry,resume,complete,cancel,cancel-queued}`。
旧Agent用retry/resume/cancelと独立startはCLIから削除した。人間の新規入力・補足は
既存のagents/:id/runsを使用する。役割の区別は操作経路によるもので、同じ認証権限を
持つローカル呼出し元を人間とAgentへ暗号的に分離する仕組みではない。

古い起動指示を保持するAgentは起動時の指示ハッシュ比較でlegacy全文送信へ戻す。
実行中CLIの再起動・利用者cwdへの指示ファイル書込みはしない。

## 移行と運用

起動時に `requestStateVersion:1` がなければ移行する。事前に同じ状態ディレクトリへ
`direct.pre-request-state-v1.json` を排他的に保存・fsyncし、検証後にatomic renameする。
未知の版、重複/参照切れ/循環、不正モデルは起動を拒否する。既存バックアップの上書きは禁止。
既存の進行中送信と照合ID、通知履歴を保持する。移行だけで過去の進行中を成功にしない。
未終了送信も実行可能な次手順もない依頼には `legacy-needs-decision` を付ける。
報告準備が可能な依頼は起動後のpumpで準備するが、削除済みAgent宛ては要確認にする。

本番コピーでNode22フルパス、同じ環境、通知OFF・接続遮断・別ポートの予行を必ず行う。
反映時の実行中送信は再送せず、保存された照合情報から観察を継続する。

```bash
cd /home/eletim/DevEnv/ai-village
export PATH=/home/eletim/.nvm/versions/node/v22.23.2/bin:$PATH
git status --short # 空でなければ中止
cp -p .runtime/direct.json ".runtime/direct.manual-backup-stage3-$(date +%Y%m%d-%H%M%S).json"
git pull --ff-only origin main
npm ci
npm run typecheck
npm run check
systemctl --user restart ai-village-direct.service
systemctl --user is-active ai-village-direct.service
curl -fsS http://127.0.0.1:5173/api/health
```

確認: healthのcommit、実プロセスのNode22、requestStateVersion/requestMigration/バックアップ、
再起動前の送信ID・セッション・入力IDと送信回数、要確認件数、checkProgress違反0件、
秘書1/2の送信ボタン、通知設定維持。要確認の本番依頼には操作しない。

失敗時はサービス停止後、失敗後のdirect.jsonも退避してから、旧コードと手動バックアップを
対で戻す。Node22のdrop-inはそのまま保持する。

```bash
systemctl --user stop ai-village-direct.service
cp -p .runtime/direct.json ".runtime/direct.after-stage3-$(date +%Y%m%d-%H%M%S).json"
# STAGE3_BACKUP は今回保存した手動バックアップのファイル名
install -m 600 "$STAGE3_BACKUP" .runtime/direct.json
git switch --detach bfe8a7a
npm ci
systemctl --user start ai-village-direct.service
```

復元時点以降の新規操作はバックアップにないため、退避後データと操作履歴を保全する。
結果不明な送信の再送はしない。

## 検証記録

- 全体333件: 330成功、既存失敗2件（todo-http/travel-registry-httpの認証302対200）、既存skip1件。
- 型検査・構文検査成功。新規9件: 移行3件、依頼接続6件。既存の仕様変更テストも更新。
- 隔離村でClaude/Codex双方の通常依頼と報告モードがfinishなしで正常完了。
- ClaudeがCodexへ正式委任し、結果配送・acknowledge互換ok・まとめ役finish・正常完了を確認。
- Codexがsleep実行中に村サーバーだけ再起動。同一送信が再起動後に正常完了、再送なし。
- 実Codexの子送信を中断し、親への結果配送と要確認を確認。正常終了とは扱わない。
- 画面の3操作を実行。再試行後は正常完了、完了扱いと取り下げはhumanの判断として記録。
- 本番コピー予行: 242依頼（進行中27 / 完了205 / 取り下げ10）、移行時要確認17。
  起動後、削除・停止済み宛先などを検出して要確認25、進行不変条件違反0。実行中1件を保持。
  通知OFFと接続遮断を確認。予行・実Agent・専用workspace・コピーは検証後削除。
- [実機記録](verification/state-stage3-live.json)、[予行記録](verification/state-stage3-rehearsal.json)、
  [復旧画面](verification/state-stage3-review.png)。

## 段階4に残すもの

Agent状態の観察からの統一導出、送信ボタン判定全体の整理、残る表示互換ラベルの整理。
Agentの達成度を文章から抽出して状態を変える仕組みは導入しない。
