# バックアップの保持と戻し方

村の反映（統合ブランチへの取込み・再起動）の前に、稼働データと配信中の画面を保存する。この文書は方針と手順であり、既存のバックアップを消す許可ではない。

## 置き場所（現状）

| 場所 | 中身 | 備考 |
| --- | --- | --- |
| `.runtime/backups/<作業名>-<日付>/` | `village.sqlite`（`VACUUM INTO` の一貫コピー）、`dist/`、`previous-commit.txt`、通知設定・通知記録・`state.json`・`travel-registry.json` | 2026-11-25以降の反映。稼働データと同じディスク |
| `~/DevEnv/ai-village-backups/` | 旧手順の `runtime/` 丸ごと | 2026-11-19〜20 |
| `~/village-backups/pre-pr*/` | `village.sqlite`、`commit.txt` | PR単位の旧手順 |

いずれも同じディスク上にある。ディスク故障には備えられないため、別ディスクや別ホストへの定期コピーを推奨する（外部設定は人間が判断する。この文書は設定しない）。

## 取得手順（反映ごと）

1. `B=.runtime/backups/<作業名>-<YYYYMMDD>` を作る。
2. `git rev-parse HEAD > $B/previous-commit.txt`
3. 稼働中のまま一貫コピーを取る: `node -e "new (require('node:sqlite').DatabaseSync)('.runtime/village.sqlite',{readOnly:true}).exec(\"VACUUM INTO '$B/village.sqlite'\")"`。`PRAGMA integrity_check` が `ok` であることを確認する。
4. `dist/`、`notification-settings.json`、`notifications.jsonl`、`state.json`、`travel-registry.json` をコピーする。
5. 添付（`attachments/`）、画像（`images/`）、監査記録（`*-audit*.jsonl*`）は反映で書き換えないため対象外。

## 保持方針

- 自動削除はしない。削除は人間が一覧を見て決める。
- 目安: 直近10回分の反映バックアップと、各月の最初の1件を残す。それ以外は人間の判断で削除・圧縮・別ディスクへ移動してよい。
- 監査記録 `local-audit.jsonl` / `ssh-audit.jsonl` は64MB（`VILLAGE_AUDIT_MAX_BYTES`）で `<名前>-<時刻>.jsonl` へ退避し、背景で `.jsonl.gz` に圧縮する（圧縮完了後に非圧縮を消す）。圧縮済み記録も自動削除しない。

## 戻し方（ロールバック）

1. 戻す先のバックアップ `B` を決め、その `previous-commit.txt` を確認する。
2. `systemctl --user stop ai-village-direct.service`
3. 現在の状態を念のため別名で残す: `cp .runtime/village.sqlite .runtime/village.sqlite.before-rollback-<時刻>`（`-wal`/`-shm` も同様）。
4. `cp $B/village.sqlite .runtime/village.sqlite` とし、古い `village.sqlite-wal` / `-shm` を退避して取り除く（WALが新しいデータを再適用しないように）。
5. コードを戻す: 統合ブランチ上で `git checkout <previous-commit>`（検証用）または該当PRのrevertを統合ブランチへ入れる。`npm run build`。
6. `systemctl --user start ai-village-direct.service`。画面とAPI（`/api/direct/agents`）の応答、起床待ち（`wakeups`）が0へ収束すること、進行中の仕事が再送されていないことを確認する。
7. バックアップ取得後に起きた依頼・会話・通知はデータを戻すと失われる。データは戻さずコードだけ戻せる場合はそちらを優先する。
