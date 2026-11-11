# 送信状態モデルの接続・反映メモ

PR #58をbaseにした積み重ねdraft。マージ・本番反映は担当秘書が行う。

## 保存・安全性

- 正本は `runs[].runModel`（型Run、その中の判別共用体state）。`state`文字列は互換表示。
  書き換えは `run-lifecycle.mjs` に集約し、モデルの変更にはactor付き純粋遷移を使う。
- native照合は既存の `correlate` を先に通す。fileIdentity、cursor、同一入力の重複、
  競合入力、steering境界を省略しない。本文を解析せずCLIの構造化終了記録だけを使う。
- dispatchの耐久意図を送信前に保存する。sentは意図記録を含み、送信成功を推測しない。
  互換表示sendingとawaiting_inputを区別して、輸送応答前に送信済みと公開しない。
- 正常以外は手動で新IDを作ってやり直す。自動は確認済みserver_overloadedに限定し、
  既存の30秒/120秒待ち、2回/10分、最新境界と待機、委任なしrootの条件に加えて
  純粋遷移でも予算を検査する。確認不能の自動再送はない。
- 終端の確認不能は後から成功に変更しない。補足で置き換えられた追跡も、送信が始まると
  終端になり、元の履歴と出力境界は保持する。

## 初回移行と再起動

`runStateVersion:1` がない場合だけ `migrateDirect` の再開用オプションを使用する。
先に `direct.pre-run-state-v1.json` を同じディレクトリへ排他的に作成し、ファイルと
ディレクトリをfsyncする。その後、新データを一時ファイル＋rename＋fsyncで保存する。
バックアップを上書きしない。途中停止で既存バックアップがある場合、元ファイルと
完全に一致するときだけ続行する。版番号がある場合は検証し、二重移行しない。

不正JSON、配列・ID・参照・モデル形状の不整合、未知の版番号は診断付きで起動を止める。
唯一の明示例外は、旧依頼機能以前の **humanRequestIdがない履歴** のorphan-run。
削除も新依頼化もせず、移行記録 `runMigration.issues` に残す。humanRequestIdを持つ
参照切れは例外にせず拒否する。保存データを推測で補修しない。

実行中の送信はチェックポイントと照合IDを保持する。送信済み/実行中は再起動後の
観察で継続し、native正常終了を確認できれば正常終了する。送信側CLI/Agent自体は
村サーバーの再起動では停止しない。停止中にfinishのAPIが失敗する場合は、復旧後に
最新revisionを取得し同じoperationIdで再試行する。元の依頼入力は再送しない。
旧unknown/send_unknownで既に入力ブロックが外れたものは確認不能の終端へ移す。

## 検証記録（2026-11-11）

- 本番direct.jsonを読み取り専用でコピーし、コピーだけを移行。
  598送信: 正常493 / 確認不能92 / 失敗6 / 中断2 / 取消4 / 実行中1。
  依頼IDなしの履歴58件を診断として保存。追跡中1件を一律確認不能にしていない。
- コピー画面は別ポート5291、別状態ディレクトリ、通知OFF。コピー内の全接続をlocalに
  置き換え、PurpleMux実行ファイルを `/usr/bin/false` にして既存Agentへの操作を遮断。
  生コピーでの移行検証はこの置換前に別ディレクトリでも実施した。
  要確認一覧14件。称号に関する停止依頼を画面からキャンセルし、cancelledを確認。
- 実Agent用は別ポート5292、別状態・専用workspace・通知OFF。
  ClaudeとCodexで通常依頼→native正常終了→報告正常終了→依頼completedを確認。
- Codexがsleep待機中にサーバーだけ停止。保存した試験データを旧形式に戻して起動し、
  runningを移行保持。同一送信が再起動後normalとなり、報告もcompleted。
- Codexへの試験送信1回だけを専用輸送ラッパーで目印なし入力に置換。
  native終了後にended/unconfirmed（turn-ended-without-marker）。画面の復旧ボタンから
  新送信を作り、正常終了と報告までcompleted。元の確認不能は不変。
- Claudeの最初のsleep試験は背景タスク化され、途中の応答でnative回が終了した。
  これは「Claude実行中の再起動成功」と数えない。別の通常依頼で完了を検証した。
- 画像: [コピーの要確認](verification/state-stage2-copy-review.png)、
  [目印なし入力の復旧欄](verification/state-stage2-unconfirmed.png)、
  [再試行後の報告完了](verification/state-stage2-retry-completed.png)。

- 最終 `npm test`: 324件中321成功、既存失敗2件、既存skip1件。
  既存失敗は `todo-http.test.js` と `travel-registry-http.test.js` のHTTP 302/200差。
  新規 `run-stage2.test.js` 13件は全成功。`npm run typecheck`、`npm run check` も成功。
- 最終スモークテストでもClaude/Codex両方が通常送信と報告を正常完了。
  再試行先のない削除済みAgentの依頼もHTTP 200/cancelledを確認。
- 検証後、両Agentの所有プロセス残数0を確認。専用workspace・タブ、両サーバー、
  コピー/バックアップ/一時状態、試験nativeログを削除済み。画像だけを証拠として保持。

## 反映手順（秘書が実行、この作業では未実施）

先にPR #58、その後このPRをmainへ統合する。#58をmerge commitで統合すれば積み重ねの
祖先を保持できる。squashの場合はstage2を新mainへrebaseして差分・テストを再確認する。
このPRのbaseをmainへ変更しdraftを解除、レビュー結果を確認してから統合する。

レビュー後の統合コマンド（merge commitを使う場合）:

```bash
gh pr ready 58 --repo eletim/ai-village
gh pr merge 58 --merge --repo eletim/ai-village
gh pr edit 59 --base main --repo eletim/ai-village
gh pr ready 59 --repo eletim/ai-village
gh pr merge 59 --merge --repo eletim/ai-village
```

本番フォルダに未コミット変更がないことを確認して実行する。

```bash
cd /home/eletim/DevEnv/ai-village
pre_stage2_commit=$(git rev-parse HEAD)
git status --short
git pull --ff-only origin main
npm ci
npm run typecheck
npm run check
systemctl --user restart ai-village-direct.service
systemctl --user status ai-village-direct.service --no-pager
journalctl --user -u ai-village-direct.service -n 80 --no-pager
```

確認事項:

1. 起動エラーなし。direct.jsonのrunStateVersionが1で、バックアップが存在する。
2. 反映前の実行中IDが保持され、再観察で受付/終了を追跡する。送信回数が増えない。
3. 既存の確認不能依頼が要確認一覧に出る。報告停止後はreportPendingが残らない。
4. 通常依頼・報告が正常終了し、通知設定が反映前の値のまま。隔離設定を本番へ持ち込まない。
5. 移行後の件数を記録する。検証コピー以降に送信が増え得るため、上記件数と一致する必要はない。

起動拒否時はログに示された箇所を確認し、版番号だけ消したりバックアップを上書きしたり
しない。必要ならサービスを停止し、反映前コードと保存スナップショットを対で戻す。

```bash
systemctl --user stop ai-village-direct.service
cp -p .runtime/direct.json ".runtime/direct.after-stage2-$(date +%Y%m%d-%H%M%S).json"
install -m 600 .runtime/direct.pre-run-state-v1.json .runtime/direct.json
git switch --detach "$pre_stage2_commit"
npm ci
systemctl --user start ai-village-direct.service
```

この復元は移行時点へ戻るため、移行後の新依頼・完了登録を失う。新操作があった場合は
退避した移行後データを残し、操作履歴を照合してから判断する。未知の結果を再送しない。
旧コードの不明状態の問題も戻る点に注意する。

## 残る範囲

段階2は依頼・Agentの新モデル全体を接続しない。finish/acknowledgeの現行仕様、
報告回のfinish要件、互換ラベル、補助フラグは残る。依頼の全進行不変条件への接続と
操作削減は段階3、Agent状態・送信ボタン全体の整理は段階4。異なるPCの接続障害や
実プロセス停止を成功と推測しない。CLIがnative回を途中応答で終える場合、達成度は
判定できない。再起動継続の実機証拠はCodexで取得し、Claude実行中再起動は未確認。
