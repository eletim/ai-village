# 人間向け報告の入力と生成評価

## 契約と由来

reportだけの仕様を更新する。元依頼と人間の追記・訂正を時系列で読み、最新要求を優先しつつ以前の重要な制約を保持する。用語と指示語の対象を資料で確認し、自然な返答へ編集する。作業回答は証拠であって作文の見本ではない。編集チェックリスト自体は報告に出さない。新たな外部操作・アップロードはしない。work仕様・固定bootstrap・報告配送状態機械は変更しない。

`reportInputs` は同じhumanRequestIdのgraphとrunだけを読む。全子依頼を含め、正式に人間が加えた制約もworkId付きで保持する。本文の単語やAgent名で分類しない。

- 新規補足: `transitionGraph(supplement)` が許可済みevent.actorを `inbox.source.actor` に保存する。呼出側のinput.sourceより優先する。humanComposeはhuman、Agent amendはagent、deadline/report通知はprogram。初回受付と冪等再試行は同じ保存済み入力を返す。
- 保存済み補足: sourceがなければ同じoperationId/inputIdの正式なsupplement操作payloadを照合する。対象依頼・本文が一致し、actorRunIdが明示nullならhuman、文字列ならagent。それ以外はunknown。旧構成変更通知など根拠を残さなかったものは復元しない。
- 旧steering: 同じ依頼のrunModel.createdByで判断する。originだけでは人間とみなさない。取消済み予約と元依頼そのものの重複は除外する。人間のresume/retryは受付境界のinstructionSourceを保存し、report再試行では生成済み資料ではなくretryInstructionを使う。旧記録で根拠がない場合はunknown。
- 元依頼はcanonicalなq.instruction。root.createdByも添える。unknownなら人間由来と断定しない。

時刻とIDで決定的に整列し、同一操作だけを重複排除する。同文でも別操作は残す。ID/workId/createdAt/由来根拠を付ける。上限超過はtruncatedとomitted参照を明示し、requests get（run/元依頼/成果）とrequests inputs（各workIdの補足）で報告前に全文取得する。最新12件だけで古い制約を捨ててよいという契約ではない。旧記録の欠落時刻の正確な順序や、未記録の人間指示は復元できない。

保存形式の版変更・一括移行は不要。sourceとinstructionSourceは新規受付の追加情報で、過去データを上書きしない。報告の仕様revisionはreportの正本文から変わり、封筒とrules get reportに反映される。既に送信済みの入力へ新仕様を導入済みとはみなさない。既存セッションの起動指示が競合する場合もその競合を隠さない。

## 実生成の比較（親レビュー担当）

1. このworktreeで `node scripts/prepare-report-eval.mjs /tmp/report-eval-NEW` を実行する。未存在の出力ディレクトリを指定する。固定8ケース×旧/新の16入力とmanifest、評価雛形ができる。準備スクリプトはAIを起動せず通知しない。旧側はfb5a469の実装、新側は作業ツリーの実装を用い、各入力・仕様のhashを記録する。
2. 各packetのsystemを仕様、userを資料として、隔離した新規実AIセッションに渡す。restrictionsも守り、ツール・ネットワーク・通知を無効化する。既存本番Agentや村の配送APIへ送らない。packet.criteriaは生成モデルに渡さず評価者だけが読む。旧/新は別の空セッション、同じモデル・設定で行う。Codex/Claudeなど実行したprovider・モデル版・設定・時刻を記録し、未実施環境は明記する。揺らぎを見る場合は同条件で各3回とし、良い出力だけを選ばない。
3. 生出力を `CASE.VARIANT.TRIAL.output.txt` に無編集で保存する。assessment-templateを複製し、対応する出力とmanifestのhash、モデル情報を紐付けて採点する。各ケース固有のcriteriaに加え、直近要求への返答、根拠ある用語/参照/主体、重要な失敗・未完了の保持、資料と指示の区別、監査手順非流出を文脈で評価する。pass/fail/uncertainと出力の引用・資料の根拠を記録する。単語の禁止リストや正解文一致で置き換えない。
4. 両方式の全出力・評価・manifestを同じ証拠束に保存し、ケース別比較表にまとめる。誤った判断主体、失敗隠蔽、内部通知への追従は受入不可。新方式に重要なfail/uncertainがあれば親が再設計する。単体テストやprompt文字列の存在は生成品質の成功を意味しない。

固定ケースは人工資料のみ。今回の工房ではパケット生成と機械回帰を検証し、実AI生成・採否は親が実施する。新しいAI審査・再生成の状態機械は追加しない。変更を反映する場合も、原本と通知履歴を保持し、既に配送した報告を自動再送しない。
