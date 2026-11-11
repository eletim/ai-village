# 正常時の表示を簡潔にする

基準: integration/single-village `2c8f13f`。本番への変更・接続・再起動なし。

| 場所 | 変更前 | 変更後 |
| --- | --- | --- |
| Agent送信ボタン | 送信 | 紙飛行機SVG（最小40px） |
| Agent接続 | ● 接続 · 時刻 | ● 時刻 |
| 地図接続 | 接続中 · 登録情報から表示 | ● 時刻 |
| 会話の完了 | 報告完了／応答完了／作業完了（報告に統合済み）／依頼全体完了 | チェックSVG |
| Agent見出し・地図住人 | 応答完了 | チェックSVG |

アイコンはcurrentColorのインラインSVG。元の日本語はtitleとaria-labelに保持。既存の送信可否・キーボード操作・補足送信対象は変更しない。送信中、結果確認中、待機キュー、補足送信は文字で区別。接続未確認/同期中/エラー、要確認/確認待ち、復旧操作は文字を残す。地図の人数・警告集計や詳細欄は変更しない。

## 比較画像

隔離サーバー5397・専用状態ディレクトリ・通知OFF・PurpleMux無効。Playwrightの固定APIデータで同じ正常完了状態を表示した（実Agentは起動していない）。時刻のみ取得時点によって異なる。

| 画面・テーマ・幅 | 前 | 後 |
| --- | --- | --- |
| Agent・light・1440 | [前](before-agents-light-1440.png) | [後](after-agents-light-1440.png) |
| Agent・dark・1440 | [前](before-agents-dark-1440.png) | [後](after-agents-dark-1440.png) |
| Agent・light・390 | [前](before-agents-light-390.png) | [後](after-agents-light-390.png) |
| Agent・dark・390 | [前](before-agents-dark-390.png) | [後](after-agents-dark-390.png) |
| 地図・light・1440 | [前](before-map-light-1440.png) | [後](after-map-light-1440.png) |
| 地図・dark・1440 | [前](before-map-dark-1440.png) | [後](after-map-dark-1440.png) |
| 地図・light・390 | [前](before-map-light-390.png) | [後](after-map-light-390.png) |
| 地図・dark・390 | [前](before-map-dark-390.png) | [後](after-map-dark-390.png) |

両テーマで既存の文字色に追従。390pxでも横はみ出しなし。送信欄右端を保ち、完了状態の長い文字列を削減した。地図は住人名と配置を維持し、完了のみチェックにした。

## 限界

端末の実スクリーンリーダーとタッチ端末実機は未検証。スマホではホバーがないため、titleだけに依存せずaria-labelを併記している。UIのみの変更であり実CLI送信は行わず、ブラウザテストの制御可能な応答で送信中・失敗・切断等を検証した。

## 検証結果

- npm test: 基準・変更後とも311成功、失敗0、既存skip1。
- 型検査・構文検査・ビルド・diff検査成功。
- Playwright: 基準102成功/17失敗、最終108成功/17失敗。失敗集合は完全一致（[一覧](baseline-failures.txt)）。追加6件は全成功。送信中/受付不明に変わったラベルを既存テスト2件へ反映。
- 比較画像16枚に加え、[要確認時の文字と復旧操作](review-text.png)も保存。同期中・切断・送信無効・補足対象・二重送信防止はブラウザテストで確認。
- 途中実行では表示名の期待値2件を更新し、ビルドと並行した回で画面初期化の失敗2件が発生したため、ビルド終了後に全体を再実行して上記結果を確認。
- 隔離サーバー停止、一時状態・テスト出力を削除。証跡画像のみ保持。本番・実Agentの操作なし。
