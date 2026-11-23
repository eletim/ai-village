# 会話の補足・内部通知の表示

inboxのsupplementを会話へ投影するとき、従来は全件がhuman/inputReceiptとなり、人間bubbleの早期分岐で常時展開されていた。programの進捗/期限/再開予約通知、agentのamendを人間の発言として表示しないよう、表示用inputSource（actorと判定根拠）を会話ページAPIまで保持する。

- source.actorがhumanなら従来の人間表示。
- programなら「依頼の通知」、agentなら「Agentからの補足」。既存chat-body detailsで初期閉、開けば添付を含む全文を読める。既存data-disclosureの安定IDを使うため、再描画や古いページの読込でユーザーの開閉状態を保持する。
- sourceがない旧データは、既存report入力判定と同じ操作履歴照合を使う。operationId/inputId/type/requestId/textが一致し、actorRunId=nullならhuman、文字列ならagent。本文の文頭や名称で推測しない。この照合は共通の読取helperに移しただけで、報告仕様/プロンプトは変更しない。
- 根拠がない旧補足はactor=unknownを保持し、「補足（由来不明・旧形式）」として従来どおり本文を展開する。旧人間追記を一律に内部扱いすることを避ける互換方針。未知の内部通知まで正確に判定できる保証はなく、保存データの推測修復はしない。

依頼/予約/配送/完了状態は変更しない。完了した依頼の通知も消さず、同じ由来に基づいて折りたたむ。managed/native turnの重複除去、入力ID、履歴cursorと100件のページ境界を維持する。

検証: program進捗/期限/予約、agent補足、人間追記、旧由来不明/操作履歴で復元可能なデータ、最終報告後の投影、実HTTP会話ページとsnapshotを検証。隔離ブラウザのPC1440/スマホ390で初期非表示、展開全文、人間本文、再描画時の開閉保持、横溢れなしを確認する。画像証拠は/tmpに保存しcommitしない。本番の既存Agent/依頼へテスト書込はしない。
