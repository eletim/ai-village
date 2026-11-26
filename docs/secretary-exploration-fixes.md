# 探索指摘の修正と画像操作

基点は `integration/event-driven-requests` の `86e22702836ef4baa7b7983a9d3df3fa79fdb376`。remote取得で一致を確認し、専用cloneで実装。対象はH1/M1/L1と人間が追加許可した画像操作。今回の担当は実装者であり、独立レビューは依頼元が別担当へ依頼する。マージ・本番反映・サービス再起動・秘書runtime交換は未実施。

## 修正

- **H1 / 永続化**：書込失敗でデータを確実にrollbackした場合に、派生RequestUnits索引もresetする。保存準備中に作った索引が、失敗した依頼を参照し続ける問題を防ぐ。`persistenceUncertain`のfail-closed分岐は維持。自動再送や新しい復旧機構は追加しない。
- **M1 / 画像を閉じた後**：動的dialogを含めてcloseを捕捉し、秘書会話とプレビューを再同期。openerのDOM参照だけではなく回答IDと画像参照・出現順で対応triggerを再探索する。回答更新で画像が消えた場合は会話領域へfocusを戻す。同期を待つ間にユーザーがfocusを移動した場合は奪い返さない。
- **L1 / 案内**：attention/important-changeのaccept拒否はstatus、保存記録照合、人間への状況説明を案内する。失敗した仕事をfollowupで自動再送する案内は出さない。question/extensionは従来のfollowup/ask案内を維持。
- 後着入力に対するorder/withdraw/followupの境界、発言単位プレビュー、順番待ちは変更しない。

## 画像操作

全体/2倍ボタンを廃止。PCのホイール/トラックパッドはカーソル位置、スマホの2指ピンチは指の中心を基準に連続ズームする。fitに対して1〜8倍。拡大後はマウスドラッグ/1指タッチで移動する。画像がviewportより小さい軸は中央、大きい軸は端を越えて移動させず、画像を見失わない。

前/次・枚数・閉じるは維持し、切替/再表示時はfitへresetする。同じ回答内だけをグループ化し、開いた画像のsnapshotは回答更新後も保持する。

キーボードは `+` / `-` でズーム、`0` または `Home` でfit、拡大中の矢印でパン、fit中の左右矢印で画像切替、`Esc`で閉じる。Tabで前/次/閉じる/viewportを操作できる。Ctrl/Meta付きキーボード操作を横取りせず、ページ全体のアクセシビリティzoomを禁止するmeta設定も追加していない。タッチ/ホイールの抑止は画像dialog内に限定し、背景スクロールとpinch中の意図しない画像切替を防ぐ。

## 修正前後の証拠

元の探索script `/tmp/village-exploratory-probe.mjs` の3再現と2対照を含む11ケースを、修正前に同じcloneで実行。11成功のうち3件は**不具合を期待して成功した検証**。修正後は元の不具合期待assertが3失敗し、残り8件成功。これは残存不具合を隠すための再試行ではなく、元の不具合が発生しなくなったため。両ログを[証拠ディレクトリ](secretary-exploration-evidence/)に保存。

正常性を検査する `tests/secretary-rollback.test.js` では、故障3回と無故障対照1回を実行。SQLiteの依頼数1、finish宣言保存、正常終了保存、成果配送1回、再起動後の追加送信なし、失敗依頼の復活なしを確認。既存の保存成否不明・送信後保存失敗の回帰も全単体に含む。故障は書込前ENOSPC相当の注入であり、実OSを満杯にしていない。

元の連続6操作探索を `tests/secretary-journey.test.js` として保持。相談、複数目的、補足、修正、採用、質問回答、取り下げ、後着、判断失敗/未判断、受付不明、再起動を通す。L1は実際の失敗配送と資料種別の分岐で確認。

M1の元PC1440/スマホ390手順は `tests/browser/exploration-recovery.spec.js` に取り込み、画像を閉じた直後にpreviewが存在しtriggerへfocusが戻る正常assertへ変更。元の証拠は8/8でpreviewなし・BODY focus。今回の実行では両幅でpreview=1・BUTTON focusを確認。追加で、画像が応答から削除された場合と、閉じた直後の再同期で接続中だったtriggerが削除された場合にも、会話領域へ戻ることを確認。

## 実行結果

専用15580、毎回使い捨てstate、既存サーバー再利用なし。build/vendorとブラウザは並行しない。モデル/業務状態はfixture、実Chromium操作とSQLite処理を使用。画像は単色生成PNGのみ。

- 関連コア：27/27成功（rollback 4、連続操作6、秘書操作/案内17）。
- 最終全単体（通知CLI単独を除く）：933成功・1skip、失敗0。構文・型・buildも成功。
- 偽通知CLI単独：7/7成功。`notifier.test.js`のみ`env -u VILLAGE_NOTIFICATIONS`。他は通知OFF。
- 通知/永続化関連補助：17/17成功。
- 全ブラウザ：255/255成功。PC1440/スマホ390のwheel中心維持、ズーム上限、境界パン、キーボード、画像切替/close/reopen、応答更新snapshot、trigger消失時focus、元M1、既存sidebar/通知/既読/履歴/再接続を含む。
- Chromium CDPで2指touchを段階的に広げるpinchを2回連続実施（約4倍）、縮小pinchも続けて実施し、1指pan、切替fit/close/reopenを確認。Ctrl+wheelで画像倍率が変わりページ倍率が変わらないことも確認。

実行条件の訂正：最終全単体の初回はbuildと短時間重なったため、そのログを保持してbuild完了後に逐次再実行し、同じ933成功・1skipを確認した。最終全ブラウザもbuild/全単体の完了後に実行。

失敗履歴：元不具合期待assertの修正後3失敗を保存。Ctrl+wheel/縮小pinch追加後の全体実行では253成功・1失敗（390幅、倍率8確認後の矢印操作中にfitへ戻り画像番号も変化）を確認。画像loadが後着しても初期サイズ確定済みならfitを繰り返さず、ResizeObserverも実寸変更時だけfitするよう修正した。境界assertはclientWidthと小数座標の丸め差を1px以内として評価し、倍率8と画像番号維持のassertを追加した。修正後ジェスチャ3反復9/9成功。失敗ログをbrowser-load-race-failure.txtに保持。過去探索のfixture契約hash設定ミス等は元報告に保持し、製品不具合と混同しない。

## 限界とレビュー

物理スマホ、実トラックパッド機器、IME、実モデルの自然言語判断、実外部通知配達は未検証。ホイール/タッチは実Chromiumへの入力エミュレーションであり、端末固有のジェスチャ差まで確認したとはしない。commit不明時は従来どおり自動継続しない。

独立レビューは未実施。レビュー用PRまでが今回担当の成果。バックアップ/統合/本番反映は依頼元の独立レビュー後の担当作業。

再現用コマンド（専用clone内、順に完了を待つ）:

```sh
npm ci --ignore-scripts
npm run check
npm run typecheck
npm run build
VILLAGE_NOTIFICATIONS=false node --test tests/secretary-rollback.test.js tests/secretary-journey.test.js tests/secretary-commands.test.js
VILLAGE_TEST_PORT=15580 VILLAGE_NOTIFICATIONS=false npm run test:ui
# 下記だけ一時ディレクトリの偽CLIを使用する通知テスト
 env -u VILLAGE_NOTIFICATIONS node --test tests/notifier.test.js
```
