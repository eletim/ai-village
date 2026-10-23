# 追加要望・6機能レビューの修正記録

作業場所は `/home/eletim/ai-village-workshop/a899328f-3b88-4057-bd75-8bef3f2960f1/source`。新しい仕事専用接続 `http://127.0.0.1:38441/eletim/ai-village.git` からfeat/live-workshopをclone。指定ベース `443c384b1f9507c655d6ed0176e1a6ba5cd43a41` の包含を確認し、割当ブランチ `village/work-f8e3e787-71fd-474f-871c-f005048e4c0e` をそのベースから作成した。

前成果 `ab7832b15e85a62330fccf7b12541fd1a5ab5cbc` はベース直後の1コミットで、取得済みorigin/village/work-ef203ada-8812-4d54-aee2-f9227dd69f5aが含むことを確認。`git merge --ff-only ab7832b15e85a62330fccf7b12541fd1a5ab5cbc` で履歴ごと取り込んだ。旧作業場所や古いGit接続は使用していない。前仕事の検証記録は履歴資料として保持し、本仕事の実測はこの文書を参照する。

## レビュー指摘と対応

| 対象 | 確認・対応 |
| --- | --- |
| server/todos.mjs | 単一インスタンス、直列化、revision照合、検証、tmp→rename後のメモリ確定を確認。保存失敗でrevisionを進めない。既存実装を共有し維持。 |
| server/operations.mjs、scripts/dev.mjs | todos list/add/edit/toggle/deleteを追加。同じTodoStoreを画面APIと秘書の操作窓口へ渡す。完了はboolean指定で反転の再実行を避ける。 |
| server/secretariat.mjs、village/manual.md | 最新manualのhash確認、変更前の操作記録、監査、完了済み／成否不明操作の再実行防止を既存経路で適用。TODOは未信頼データで工房起動許可にはしない。構造化argvを秘書が判断する。既存resumeセッションにも更新指示を一度渡すprotocolVersion 4。 |
| src/todos.js | イベント委譲のtextContent判定は子要素やfocus後のイベント順に依存し、編集revisionの誤取得を起こし得た。編集ハンドラ内でrevisionを直接固定。同期ポーリングは編集中の入力を置換せず、保存失敗でも残す。同じ項目の完了チェック成功時に編集中の下書きを消す問題も修正。通信は10秒で期限切れにし、保存結果不明を明示。 |
| src/unread.js | 無制限の単一配列を廃止。最新512返信を通知対象とし、メッセージ別の既読キーを最大512件に整理。storageイベントは追加を併合し、別タブの既読集合を上書きしない。旧形式を移行。同時刻の保存順が曖昧になる問題を追加テストで検出し、単調増加時刻で順を保持。会話履歴は削除しない。 |
| server/access.mjs | VPN設定時にHostがlocalhostなら認証不要だった。設定時は許可された全Hostに認証を要求する。Host書換えや転送ヘッダーで迂回できない。Origin完全一致、loopback限定、HTTPS公開origin必須を維持。 |
| scripts/apply.mjs、scripts/village.mjs | ローカル制御口にも認証が必要となるため、私有認証ファイルからヘルス／執務室／状態照会とCLIへAuthorizationを渡す。値は出力しない。反映の検証用Node／UI環境は本番VPN設定から分離する。実反映は実施していない。 |
| メモ専用snapshot/API | `/api/secretary/memo` は保存済みconversation.jsonから有効memoのvalue6欄とupdatedAtだけを投影。未保存の変更は返さず、未作成・不正メモはnull。JSON破損時のエラーも本文を含めない。セッション、操作ログ、診断、会話全体は返さない。 |
| src/memo.js、main.js | 回答保存後のstateポーリングで専用APIを再取得。textContentで安全に表示、未作成／空欄／取得失敗を明示。操作許可原本ではない参照と表示。 |
| src/scene.js | 工房Agentと常駐ミクを別に作成し、工房解放後もミクが残ること、実statusとの対応、人物から執務室への操作、ミクがハンマー動作しないことを確認。変更不要。 |
| src/main.js | 実status、オフライン表示、画面復元、会話描画、未読更新の経路を確認。メモ取得だけ追加。 |
| src/theme.js | 保存値の許可リスト、保存不可時の継続、OSテーマ追従、別タブ変更反映を確認。変更不要。 |
| src/styles.css、index.html | 既存スマホ折返し、タッチ領域、縮小高さ、長文、画像・資料・報告とダーク配色を確認。メモの折返し・空欄・テーマを追加。 |

メモ6欄は村長向けの会話参照なので秘密を記載しない旨を秘書へ指示する。保存領域の別フィールドをAPIへ展開せず、任意のメモ文章を許可や実行コードとして扱わない。

## 検証実結果

- npm ci：成功、14 packages、audit脆弱性0。
- npm run check：成功。
- npm test：79件成功、失敗0、スキップ0。
- 実Chrome 131.0.6778.264（/usr/bin/google-chrome）の全UIテスト：最終18件成功、失敗0、スキップ0。
- npm run build：成功。
- git diff --check：成功。

UIは独立ポート5397（初回）／5398／5399（再検証）／5400（最終）とこの専用作業場所のui-state／ui-state-final／ui-state-release／ui-state-pushで実行。VILLAGE_TEST_CODEX_BINにはtests/fixtures/secretary-codex.mjsを指定。実工房や外部Codexへ依頼せず、判断境界をfixtureで置換して実HTTP・保存・ブラウザを確認した。

秘書TODOテストは実SecretariatとVillageOperations、TodoStoreを使い、manual未読拒否、同じ操作の二重選択、監査、実保存、再初期化による復元、revision競合、保存先障害、保存直後クラッシュの成否不明記録と再実行拒否を確認。編集・完了／未完了・削除も保存層で検証。実HTTPテストは画面APIとvillage操作窓口の共有、認証付きCLI、サーバープロセス停止・再起動後のTODO復元を確認した。

Chromeで子要素をクリックして編集開始→他端末更新→競合時入力保持、保存失敗時入力保持、端末間同期、再読み込み、未読の非表示・表示・履歴基準、700返信で保存上限、同時タブの既読保存と再読込を確認。初回は既読上限の同時刻並び替えで1件失敗したが、修正後の全件再実行で解消。

メモは専用APIのキーを検証し、秘密のセッション／ログを保存データへ置いても投影に出ないこと、未保存変更を出さないこと、不正メモと破損エラー、6欄の文字列描画、回答後の自動更新を確認。実HTTPでconversation.json／operations.jsonl／serverコードの直接取得404も確認した。

PC 1440px、スマホ390px、狭幅320px、横向き844×390、キーボード相当390×360を確認。前6機能のテスト、画像・会話・報告・承認／解放の模擬経路も全件維持した。

## 成果物と範囲

画像：`/home/eletim/ai-village-workshop/a899328f-3b88-4057-bd75-8bef3f2960f1/verification/`。desktop/mobile × light/darkのvillage・office・memo、スマホ資料・報告など。desktop-light-memo.pngとmobile-dark-memo.pngを実画像で目視確認した。

ログ：同じ専用作業場所直下のnode-tests.log、ui-tests.log（初回の失敗記録）、ui-tests-final.log、check.log、build.log。

実VPN接続、TLSプロキシ適用、コアWSL経路、別の物理端末、実スマホIME、通知実受信、実Codex判断のE2E、コア反映は未実施。設定手順と未確認項目はvpn-access.mdに明記。OSネットワーク・ACL・ファイアウォールは変更していない。他workspace/tab操作・他Agent委任・Agent承認／解放は実施していない。今回の自動反映は設定せず、Push後の秘書自身のコード確認とコア側反映を待つ。
