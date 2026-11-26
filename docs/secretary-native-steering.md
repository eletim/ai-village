# 秘書会話の実行中追加入力

## 範囲と設計

人間の「作業中の秘書に会話を送ったらCLIの追加指示として割り込んでほしい」に対応する。性能改善PR170とは別のbranch/clone。分岐元は integration/event-driven-requests `78e952421ece54329341473dd4ba3cb4443bb1fa`。独立レビュー・反映判断は依頼元が担当する。実装者による検証を独立レビュー済みとは呼ばない。

- 人間原文・添付・requestId・conversationSequenceは各runに保存する。新しい永続schemaや起動契約は追加しない。通常の「会話を送信」を利用する。
- 保存直後のdispatchで、Agent lock下のnative観測から追記先を選ぶ。同じ秘書・同じ会話の受付済みrunning owner、同じsession/現在turn、busy、競合入力なしの場合だけ既存PurpleMux `tab send` を使う。工房/リーダーへの補足配送は変更しない。
- 送信前にownerを再観測する。idleになっていれば普通の新turnとして送る。異常/不明なら未送信の待機、または既存境界拒否。送信予約を保存してからCLIへ送り、予約・送信結果・native受付を分ける。
- 送信予約と旧ownerのsupersede/追跡終了を同じ保存境界に置く。確実なrollbackでは旧ownerが戻る。commit不明ではfail-closed。送信試行後の不明は再送しない。
- 次の追記は先の追記のnative受付照合まで送らない。先行の未送信会話/内部配送を追い越さない。同turnへの複数入力は異なるnative入力ID/位置で識別する。
- 旧runは未確定の継続履歴となり、新しいrunだけが終端を所有する。既存のnative offsetで追記前後の出力を分割する。追記の位置より前の終端は追記runの正常終了に使わない。
- 旧actorが指すrunから、同会話・同Agent・同session/turn・受付済みsuccessorの連鎖だけを辿る。read/get/authorize/目的判断はこの受付済み境界を使用する。保存だけ/送信結果不明/別session/隣接次turnは旧actorの権限を広げない。readのcurrentとstatusは現在の受付済みrunを返す。
- 許可引用は引き続き受付済み人間原文の正確な引用。新しい人間入力で旧未確定成果判断は既存humanSequence境界によりstaleとなる。既に正常確定した採否や実行済み外部効果を巻き戻さない。再判断は最新の受付範囲で行う。
- 同じCLI操作の再試行は元のrunによるoperationIdを維持する。旧actorからの操作でも実効actorをreceiptへ記録し、通知の「仕事を渡しただけ」抑制や回答と仕事の関連を失わない。新しいタグのrunから同じ操作を明示する場合は別操作になる。
- 旧runの終端より前に保存された人間追記がある場合、未試行の旧通知は抑制する。既に試行済みの通知、または追記より前に正常確定した回答は取り消さない。
- UIは「送信待ち」「送信を確認中」「実行中への追記を受付済み」「追加入力へ継続（未確定）」を区別する。正常終端・既読revision・通知・成果採否の既存規則を維持する。追記保存時点では回答完了にならない。

これは強制停止や再起動による割込みではない。CLIの入力受付と、モデルがその内容を処理する時刻は異なる。長いツール処理等の途中で何秒以内に処理するかは保証しない。未受付の先行入力や別会話、先行内部配送がある場合には安全な順序を保って待機する。

## Codex実機（fixtureではない）

隔離API `127.0.0.1:15661`、状態 `/tmp/secretary-steer-real-state`、専用作業場所 `/tmp/secretary-steer-real-work`、通知OFF。新規の使い捨てCodex v0.163.0 / gpt-6-astra（既定起動設定）を村のAgent作成APIから起動した。本番Agentへは入力していない。

会話例:

1. 人間: 「約60秒の無害な待機処理を実行し、その後 result.txt に BLUE と書いて…途中で訂正が届いた場合は同じ作業への追加指示として反映」
2. Codex途中発言: 「指定のフォルダ内だけで約60秒待機し、その後 result.txt に BLUE と書き込みます。」
3. ツール稼働中に人間: 「訂正です。いま進めている同じ作業の result.txt は BLUE ではなく GREEN…別作業を作らず…」
4. Codex途中発言: 「訂正を反映し、現在の待機を続けます。終了後、result.txt には GREEN と書き込みます。」
5. 正常終端: 「訂正を反映し…`GREEN` を書き込み、内容を確認しました。」実ファイルは `GREEN\n`。

同一session `01a216f0-cebc-7f73-8e30-0dc9873c0397`、同一turn `01a216f1-3145-7570-ab94-d2c06342139e`。

| 記録 | UTC時刻 |
| --- | --- |
| 最初の送信予約 | 08:20:34.934 |
| 最初のnative受付照合 | 08:20:35.925 |
| 追記送信予約 | 08:20:41.433 |
| 追記native記録 | 08:20:45.187 |
| 追記native受付照合 | 08:20:45.371 |
| 訂正に言及するcommentary | 08:23:59.216 |
| 正常終端 | 08:24:08.236 |

追記の村の送信予約から照合まで約3.94秒。終端を待たずに送信・受付した。一方、受付から訂正に言及する発言までは約194秒、turn全体は約213秒だった。nativeのツール記録ではsleep 60の開始は08:20:40付近、コマンド終了は08:21:40.345。その後のツール応答返却/モデル処理の待ちが含まれるが、全遅延の内訳は未確定。CLIのツール/モデル処理はその後も続き、追記から終端まで約203秒あった。「即座にモデルが処理する」とは報告しない。元runはsuperseded、新runだけcompleted。通知記録はdisabled（外部送信なし）。自然終了後、今回作ったCodex tabと空の初期terminal tabだけを閉じた。本番runtimeの停止・交換はしていない。

証拠は [実機要約](secretary-steering-evidence/real-summary.json)、[native抜粋](secretary-steering-evidence/real-native-excerpt.json)（原本パスとSHA256を含む）。抜粋は人間向け発言と開始/終端に限定し、内部推論を収録しない。原本は作成したセッションのJSONL。再現補助scriptも同ディレクトリにあるが、作成は非冪等なので再実行時は新しい一時場所・識別情報を用い、既存作成/送信操作を再送しない。

実機は機能本体の初期実装で実施。その後の差分はCLI操作の重複防止、実効actorによる通知抑制/関連表示、送信直前再観測、追記より古い終端の拒否、およびテスト/文書。これらは下記のfixture回帰で確認した。実機を最終headで再実行したとは扱わない。

## Claude

既存照合には同turn queued入力と、対象turnが正常終了した後の隣接次turnのclaude-user受付がある。これを維持する。後者はUIで「次の実行で追記を受付済み」とし、旧actorから新turnへの権限拡張はしない。nativeの明示turn・本文・直前入力を照合できなければ成功とは扱わない。Claude実機は今回未実施。同turn即時反映の保証なし。

## 検証

すべて一時データ、通知OFFまたは単独の偽通知CLI。主なポートは15660（初期HTTPprobe）、15661（実機）、15662（追記HTTP/native/browser）、15663（ブラウザ本体）、15664（完了/既読HTTP）。本番の入力・既読操作・故障注入なし。

- 新規 `conversation-steering.test.js`: 連続2追記、未受付の権限拒否、旧actorから最新受付までのread/authorize、単一最終回答、再起動、送信不明無再送、別turn拒否、idle通常配送、dispatch保存rollback、別会話拒否、未送信取消、追記前の終端拒否、失敗/中断、Claude隣接次turn、同一CLI操作の重複防止、commit不明fail-closed。
- 新規 `secretary-steering-http.spec.js`: 実HTTP送信（うち1回はUIクリック）→偽native JSONL→実projection→Chromium DOM。1440/390×dark/lightで連続2追記、同turn、旧actorの可視境界、未確定表示、プレビュー、reload/再訪、最終回答、各入力1送信、通知なし。
- 既存の会話・6操作・成果判断・永続化・通知・native照合、全ブラウザの画像/フォーカス/scroll/既読/サイドバー等を回帰。
- 正常終端/既読HTTP試験も最終コードで再実行。物理タッチ端末、実ネットワーク断、Claude実モデル、全競合の実モデル再現は未検証。

実行数・失敗履歴・固定commitは実装報告および evidence の validation.txt に記録する。

## 失敗履歴

- 初期HTTPprobeの受付timeout: 偽nativeがeventのみで明示turn属性を持たなかった。実際のresponse_item形式へ修正。照合条件は緩和せず。
- 初回関連単体54件中8失敗: 変数参照ミス7件（修正）、従来の次turn待機前提1件。
- 初回全単体950件: 938成功、11失敗、1skip。内訳は旧順序queue前提6件と通知OFFで偽CLIが呼ばれない5件。前者は新しい同turn動作と未受付拒否へ検証を更新。後者は単独偽通知試験を環境変数解除で実行した。
- 更新後関連183件中2失敗: fixtureで同turnの入力IDが重複していた。入力ごとのnative IDを生成するよう修正。旧turnの完了を先に注入せず、追記受付→最後の終端という実順序へ修正。
- 初回新規ブラウザ1件失敗: 2番目のrunは受付後すぐ3番目へsupersedeされるため、瞬間的runningを待つテストがtimeout。永続的なacceptedAtの確認へ変更。以降成功。

## 反映・バックアップ・戻し方（未実施の提案）

依頼元の独立レビュー→重要指摘解消→秘書最終レビュー→秘書の明示反映指示の順。現時点では統合取込・本番反映・サービス再起動を行わない。main未許可。

反映担当は最新head/PR固定headとcleanを照合し、オンラインSQLite backup APIで整合snapshotを取得、integrity_checkを確認する。設定・添付/画像・現在code/dist・サービス定義も保存する。原本run/session/turn/dispatchAttemptedAt/履歴IDのbaselineを保存し、明示許可後に統合取込・build・正式反映・履歴とruntime識別情報の維持を確認する。Agent再起動/交換は不要。

schema変更なし。戻す際は新規データを先に保全して旧code/distへ戻す。稼働後DBを古いbackupで上書きしない。新たに作られたsteering履歴は旧コードにも既存run fieldsとして残るが、旧actorのalias対応は旧コードにない。進行中steeringの自然終了/受付状態を確認してからコードを戻す。送信不明や未受付を旧コードで自動再送せず、元のrun/原文/照合記録を保持して人間が判断する。
