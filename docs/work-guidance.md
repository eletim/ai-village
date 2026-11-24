# 直接回答と必要時の操作案内

## 目標・既存の不足・最小変更

秘書の元回答を通常の返答として届け、必要な手続きだけ具体的な案内で補えるようにする。従来は設定未指定でも編集runを起動し、work仕様の全文に全操作schemaが含まれていた。また正常終了時のinput未申告は同じ入力を再配送するだけで、finish不足には再開する入力がなかった。

既存reportMode=false、可変仕様の取得、正常終了後のinbox再開を使う。新しい会話分類器、完了状態、審査Agent、要約DB、巡回は追加しない。

## 設定と仕様

- reportSettings.enabled未保存の村は、新規依頼の既定がfalse。保存済みtrue/falseは一切書き換えない。既存依頼は作成時のreportModeを保持する。設定の存在しない旧村の将来の依頼だけもfalseになる。古い依頼のreportMode未記録は既存どおり書換えを生成しない。
- 親が必要なら正式 `reports configure false` API/CLIまたは設定画面で設定する。本変更の実装担当は本番設定を操作しない。任意の書換えを選ぶ場合はtrue。変更は新規依頼にのみ適用し、既存の報告生成/通知履歴は再実行しない。
- `rules get work` は権限・由来・正常終了/採否/inputs・待機・受付不明の基本と操作別取得入口。`rules get work respond` 等で引数と操作の意味を取得する。HTTPは `GET /api/direct/rules?phase=work&action=respond`。CLI helpも既存の単一操作registryを使う。
- work revisionは基本仕様と操作registry両方に依存する。操作別応答は同じrevisionを持つ。固定startup文字列・report仕様は変更しない。旧セッションの新developer契約導入を偽らず、既存の可変仕様/互換経路で更新する。

## API拒否と正常終了後の案内は別

API拒否: 元の拒否・HTTP statusを維持し、requests get/inputs/resultsで何を確認するか、どの操作別rulesを見るかを返す。入力省略・子結果の採否省略・古い/他依頼の結果・未解決依存を具体的に説明する。採否は選ばず、権限/受付条件を緩めない。保存障害を「拒否なので別operationIdで再送」と案内しない。

正常終了後: 現在work runが正式に受付照合されnormal終了し、activeである場合だけ判定する。届いていた未対応inputと子結果、および全子解決後に必要なfinishが対象。新しく届いただけの未読入力は漏れに含めない。予約中、未完了子待ち、失敗/中断/不明、report phase、supersede/invalidatedは対象外。

不足内容をJSONのinput ID/result参照/finishで説明し、program由来supplementとして既存inboxへ保存する。確認と補完だけを求め、外部作業の再実行を指示しない。子結果は全文を読んでAgent自身がaccept/reworkを選ぶ。案内の `procedure` はtargetRunId・不足signatureだけの配送メタデータで、依頼状態の正本ではない。

- 同じ不足signatureは1回、work全体で最大2件。元inputのattemptsが2なら新案内で迂回しない。
- 案内を受けた正常終了でも直さなければ、その案内はretiredにする。元inputの上限と既存の停止/要確認を維持する。自動で成功にしない。
- 不足解消・人間完了/取消時の古い案内はretired。未送信で全入力がretiredの予約runは取消。既に送信した外部効果を未送信と偽らない。
- 新しい人間入力/子結果と同じinbox batchに集約。永続化/SQLite wakeupは既存の原子保存に含める。再起動は保存済み案内IDを再利用し、正常な再送判定だけを用いる。

申告は当該runの正常終了で確定する。案内があっても、未確定claimや失敗runの判断で採用/完了することはない。人間通知はroot1回。外部副作用のexactly-onceは保証しない。

## 隔離実AI受入

専用ポート/一時状態dir/新規Projectと新規Agentを用い、通知は無効化。実際のport/state/revisionを起動記録で確認し、既存Agentへ送らない。

1. reports statusと元の設定を記録。未指定ならfalseを確認し、相談を送り元回答だけで完了する経路（正しいrespond）を確認。編集runがないこと、回答全文が画面に表示されることを確認。
2. 別の依頼で検証用Agentに「最初の回だけ手続きAPIを呼ばず正常に回答し、村から補完案内が来たら正式仕様に従い不足だけ直す」と指示する。これは隔離受入用の故意の漏れで、通常ルールを変更しない。
3. native正常終了とinput受付、元input ID、program案内1件、新run1件を記録。次の回でrules get work respond/finish、requests inputs/resultsを読み、案内の内容を補完することを確認。外部作業を繰り返していないことをツール記録で確認。
4. 子結果の採否だけ忘れるケースでも結果参照が案内され、accept/reworkはAgentが内容を読んで選ぶことを確認。finishだけの漏れも確認。人間通知はroot1回。
5. 同じ漏れを2回繰り返す依頼は上限で停止し、予約待ち/子待ち/failed/unconfirmedに不要案内が出ないことを確認。停止/不明は既存の人間/依頼元による復旧判断を使う。
6. optional報告trueの別依頼では従来の書換えrunを確認。途中で設定をfalseにしてもその依頼のreportModeはtrueのまま、次の依頼のみfalseになることを確認。

人間会話の自然さは機械テストの合否と別。案内を受けたAIが正しく訂正する能力、既存developer指示との衝突は実AI受入対象。

## 同じ相談例での直接回答/書換え比較

`node scripts/prepare-direct-report-eval.mjs /tmp/NEW_EVAL_DIR` は元の相談例を含む固定ケースを読み、直接表示する元回答 `.direct.txt` と、全く同じ元回答を入力にする `.rewrite.json` を生成する（AI実行なし）。fixtureの元回答には既知の悪い自己申告も含むため、直接表示を自動的に品質合格とはしない。

新しいwork回答も評価する場合は、各 `.work.json` を独立した隔離CLIへ渡し、生出力を caseId→文字列 のanswers.jsonへ保存する。`node scripts/prepare-direct-report-eval.mjs /tmp/SECOND_NEW_DIR answers.json` でその生出力を直接表示/書換えの共通入力にする。rewriteを同条件の別セッションで実行する。生成モデルにはsystem/user/restrictionだけを与え、review-only.jsonの採点基準を渡さない。

全raw output/events、入力packet/hash、日時、CLI版、model/settings（不明なら不明）、各引用と根拠、pass/fail/uncertainを保存する。最新の人間の質問への返答、用語、主体、未完了/失敗、余計な不明化を人間が比較する。完全一致や禁止語の数で代用しない。外部通知/本物の操作はしない。

## 実測・実装時の検証

同じURL `http://127.0.0.1:15233`、同じ作業ディレクトリで336c391と比較したwork仕様本文は3,853→1,723文字。必要時に追加取得するrespondは160文字、finishは110文字。固定startup本文は同一、report revisionも同一。これは取得する文字数であり、トークン数や生成品質の保証ではない。

実装時の最終検証はNode 600成功・1skip、隔離ブラウザ188成功、check/typecheck/build成功。初回にはwork phaseの参照誤りを新規テストが検出し修正した。既存テストの旧default/full-schema期待は新契約へ変更。HTTP再起動テスト2件ではモデルのqueued/sent状態更新と実際の送信captureの時間差による失敗を確認し、送信完了を観測してから再起動して二重送信を検査するよう修正した。ブラウザの旧default期待も更新した。初回失敗を品質成功として扱わない。

実AIの自然さ・自発訂正はこの実装検証では未実施。上記の独立生成比較と隔離受入で判断する。全workで案内2件という抑制は保守的で、長い依頼で別の漏れが3回以上起きても追加の自動案内を出さず、既存の要確認/正式な継続判断に戻る。既存の明示report設定を変更しないため、ON保存済みの本番は親が正式設定を変更するまでONのまま。

## 独立レビュー後の境界修正

finishだけが不足する案内は、finish申告を保存しただけでは解消しない。現在runの受付照合・正常終端・supersede/invalidatedなしを確認してから解消する。失敗/中断/不明では案内を未対応のまま残し、自動再送は追加しない。

24件のinbox配送枠で案内が後回しになった場合は、生成時だけでなく退役判定時にも参照元入力の上限を確認する。未送信案内が上限到達済み入力を参照するなら退役する。ただし元入力と案内が同じ有効な2回目の予約runに含まれる場合は保持し、すでに送信した案内を上限検査で取り消さない。旧版が保存した案内だけの予約runは既存の全入力退役判定で取消し、新規人間入力が同じbatchにあればそのrunは維持する。

`tests/procedure-guidance-boundaries.test.js` は暫定finish後のfailed/interrupted/unknown、正常解消・人間完了/取消、24件境界、新規入力の同居、旧版の保存済み待機runと再起動を検証する。合成fixtureによる状態遷移検証であり、実AI受入とは区別する。
