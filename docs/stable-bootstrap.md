# 固定起動契約と更新される操作仕様

## 判断と旧設計

e14e289では安定した共通規則を起動時に、本文・識別・今回の資料だけを各入力に分け、全文指紋で受付を照合した。その後、操作仕様と起動規則が同じ全文になり、direct.initのハッシュ更新検出でstartup-v1をlegacyへ戻した。既存developer/system指示はファイル更新で変わらないという検出自体は必要だが、常時全文fallbackは短縮を失い、古い高優先度指示との衝突も解決しない。

contract 2は短い起動契約だけをセッションへ導入する。操作仕様は `server/agent-rules.mjs` を正本に `rules get work|report` と `GET /api/direct/rules?phase=work|report` で返す。CLI helpの操作schemaも同じagentActionsから生成する。仕様にrevision（SHA-256）を付け、封筒にそのrevisionを載せる。初回・revision変更時だけAgentが該当phaseの仕様を取得し、同revisionを確認する。未取得・不一致・取得失敗は推測せず作業を止めて報告する。ポーリングや新しいタイマーは追加しない。

起動契約のハッシュは仕様本文に依存しない。通常の操作仕様更新とサービス再起動でstartup-v2を失わない。起動契約自身・接続URL/CLI経路・native sessionの変更は新しい起動境界を必要とする。仕様は権限を増やさない。現在の権限検証、正式委任、report/deadline、inputProtocol、inputs/results、明示accept/rework、申告run正常終了による確定は変更しない。

## 封筒

本文を一度、discoveryとrequestを一度送る。requestには識別情報、contract、rulesRevision、inputProtocol、期限の値、対象入力を載せる。入力全文が本文に含まれる場合は `textInInstruction:true` で参照し、複製しない。他の入力は2000文字の抜粋・truncated・textSourceUnavailable・結果参照を維持する。報告はquestion/finalResult等の資料とphaseを送る。通常/委任/結果/補足/報告とも共通規則・全API一覧は封筒に入れない。長い原依頼や必要な引継ぎ資料を「固定費」として数えない。

受付指紋は最終的に送った全文から作成する。過去に送信した本文、hash、runID、native受付照合は一切書き換えない。Claudeのpaste変換の照合とCodexのnative重複判定は従来どおり。

## 旧秘書を移す具体手順（反映管理者が実施）

この実装は本番へ移行操作をしていない。旧startup-v1/legacyへの新規送信は `queuedReason:startup-contract-migration-required` で**未送信queuedのまま**保留する。送信済みの観察は継続する。全文fallbackせず、古いdeveloper指示を書き換えたともみなさない。

1. 管理者が反映前に通常の状態バックアップ（SQLiteを含む）を取り、進行中・受付不明を確認する。移行中は対象の新規投入やPurpleMuxからの直接入力を控える。
2. 正式CLI `agents instructions OLD_AGENT_ID` で契約・追跡中run・queued・依頼をread-only診断する。対象の旧秘書は既存IDを使い続ける。
3. 通常の `agents create JSON` で同じProject・場所・workshop・cwd・provider・connectionの未使用Agentを準備する。新workspaceへ固定契約を導入してから起動する。新Agentに仕事や人間入力を送らない。`agents instructions NEW_AGENT_ID` でstartup-v2を確認する。ファイルreceiptはliveモデルの記憶を証明しない。
4. 両ランタイムがidleで旧Agentにsent/runningがない境界で、人間専用 `POST /api/direct/human/agents/OLD_AGENT_ID/adopt-runtime` を操作する。既存の人間認証・Origin/cookie/X-Village-Human-UIを使い、payloadは `{operationId,replacementAgentId:NEW_AGENT_ID,revision:OLD_METADATA_REVISION,replacementRevision:NEW_METADATA_REVISION,handover:HANDOVER_NOTES}`。revisionは最新のagents取得のmetadataRevision（未設定なら0）。handoverは元の目的、継続中の判断、実施済み外部操作（commit/PR/送信等）、未完了事項、成否不明を記した管理者の引継ぎメモ。過去に送信したrunがあるAgentでは必須（1〜30000文字）。旧セッションの最終回答・正式report・履歴を確認して作成し、未記録の外部操作を「なし」と推測しない。同じ操作を再確認する場合は同じoperationIdとpayload（handoverを含む）。権限をAgent CLIには公開しない。専用の選択UIは未提供で、反映管理者が認証済みHTTP操作を行う。
5. サーバーは両Agentをロックし、同じ登録属性、未使用のnative履歴、idle、起動ファイルhashを検証し、一つの保存transactionでランタイム所有を交換する。**旧AgentのID・名前・Project・依頼担当・親子関係・run・入力・結果・通知はそのまま**。新Agent側は旧ランタイム保管用になり新規作業を拒否する。旧セッションは停止しない。監査receiptを保存し、再起動後の同じoperationIdも再交換しない。保存失敗なら所有交換をrollbackする。
6. 下表の進行を確認する。今後の新規依頼も元の秘書IDへ送れる。新しい依頼として再委任せず、完了済み外部作業をやり直さない。保管された旧ランタイムの停止は別途の人間判断とする。

|移行前の状態|正式操作とその後|
|---|---|
|未送信queued|adopt-runtime後、既存イベント駆動の再評価で**同じrunID**を一度送信。cancel/retry不要|
|親正常終了・子結果待ち|adopt-runtime。子/親リンクを維持し、結果到着時の通常の親入力が新ランタイムへ配送される|
|報告生成待ち/生成済みqueued report|adopt-runtime。既存report権・runを維持し、通常の報告処理で通知一回。完了した実装を再実行しない|
|sent/受付追跡中/running、native busy|移行を拒否。観察を継続し終端の根拠を確認。自動再送・停止で解決しない|
|終端failed/interrupted/unconfirmed|ランタイム移行自体はidle確認後に可能だが、依頼の失敗や不明を成功に変えない。外部効果確認後の人間専用retry/resume等による明示復旧が別途必要|

現在の親秘書については、今回許可された反映管理の範囲で管理者が、レビュー回の正常終了とnative idleを確認してから実施する。実行中の親を入れ替えない。親の最終回答/reportから引継ぎメモを準備し、子結果待ち境界でこの操作を行えば、同じ親依頼へ結果を受領し、レビュー・最終報告・今後の新規依頼を継続できる。受付中に更新を強行しない。全Agent停止や、modeだけの強制変更は不要。移行操作は外部送信せず所有台帳だけを確定し、その後の送信は既存の受付照合を通る。

## 新セッションの文脈と遅延イベント

採用transactionは対象の依頼/ノードID一覧と引継ぎメモをreceiptに保存する。移行後、そのノードへの初回送信（既存queued、結果入力、reportを含む）の `sessionHandover` は、requests get / inputs / resultsの具体的な引数を持ち、作業・報告前に全文を読むよう指示する。getは元目的・全runの指示と成果・操作履歴、inputsは対応済みを含む全補足と未対応入力、resultsは子結果を保持する。短い通常の引継ぎ抜粋だけで過去文脈を代用しない。現runのinputs/results対応手続きや報告だけの制限は変わらない。

会話記憶や未記録の外部操作を自動復元できたとは主張しない。管理者メモも資料であって新しい許可ではない。過去の外部操作は再実行せず、成否不明は確認する。次の新規依頼には旧依頼の引継ぎを付けない。この一回の引継ぎ参照・メモと、APIから読む必要な履歴は移行コストであり、通常封筒の固定費削減には含めない。

監視イベントは観測結果を運ばずAgentを再評価するきっかけだけである。採用と観測は同じAgentロックで直列化され、遅延通知でも現在のworkspace/tab/sessionから読み直す。旧native結果を新sessionの観測として取り込まない。旧sessionの既存終端履歴は元session ID付きで保持する。遅延通知を採用前に予約し、採用後に旧sessionの通知・結果を発生させる隔離回帰で確認した。直接PurpleMuxへ同時入力する管理操作は避ける。

採用応答を失った場合は、新Agentを作り直さず同じoperationId/payloadを再送する。保存済みなら同じreceiptを返し、旧新runtimeを再交換せず、queued runも増やさない。保存前の失敗なら所有関係はrollbackされ、同じ操作を再試行する。人間認証は維持し、Agentへ人間専用権限を渡さない。

## 失敗・再起動・ロールバック

起動ファイルの不在・読取失敗・ハッシュ不一致・native session変更はmigration-requiredとして診断可能にする。復元されたファイルだけで自動復帰せず、新しい起動境界を要求する。未送信runを保留した記録と、送信済み/受付不明の事実を区別する。保存失敗時は既存のtransaction rollbackが適用され、外部送信は成功した保存の後だけ行う。仕様取得はread-onlyで台帳に受付や完了を追加しない。

ロールバック時も新しい外部効果があれば古いスナップショットへ単純に戻さない。旧コードは新契約セッションの仕様取得APIを持たないので、コードだけ戻して新Agentを継続利用しない。送信を止め、runと外部効果を照合し、管理者がコード・状態・セッション契約を揃える。

## 測定と限界

`node scripts/measure-input-envelopes.mjs` は9aa66f2の実際の旧生成コードと新生成コードを、固定本文・同じUUID/期限/URLで比較する。外部通信なし。Unicode文字数とUTF-8 bytesを出し、token数・請求額とは呼ばない。通常/委任/結果/補足/報告の固定費を比較するため、report本文も同じ長さの資料に固定している。

|入力|本文文字数|旧legacy|旧startup-v1|新startup-v2|新固定費|
|---|---:|---:|---:|---:|---:|
|通常|80|4184|1151|787|707|
|委任|80|4189|1156|792|712|
|結果|80|4184|1151|787|707|
|補足|80|4190|1157|793|713|
|報告|80|1799|655|691|611|
|通常|8000|14023|10990|8707|707|
|委任|8000|14028|10995|8712|712|
|結果|8000|14023|10990|8707|707|
|補足|8000|14029|10996|8713|713|
|報告|8000|9719|8575|8611|611|

旧起動全文4320文字、新起動契約603文字。ただし初回/更新時の仕様取得応答はwork 3400文字、report 1253文字を別途要する（JSON payloadのみ。CLIの外枠・ツール呼出し・モデル出力は別）。80文字の通常本文では、新封筒787＋work取得3400＝4187文字となり、**初回は旧legacy封筒4184文字とほぼ同じ**。更新がない後続入力で固定費が下がる。旧短縮reportより新reportはrevision等の分だけ36文字増える。キャッシュ・コンテキスト再読込・token化・実際の長い引継ぎ内容による総コストは未測定で、起動時への移動だけを削減と主張しない。

Codex/Claudeの既存launcherへの導入は同じPython install/verify経路を使用し、両providerの一時HOMEでの実ファイル検証とnative JSONLの照合回帰を実施。実モデルを起動した新契約取得・推論・SSH越しの実機試験は今回行っていない。ファイル検証と送信は非原子的で、CLIメモリの証明ではないという従来の制約も残る。

## 今回の検証結果

- 最終 `npm test`: 533件中532成功・条件付き1skip・失敗0。初期実行で旧「全文fallback」期待のテストを新しい診断停止契約へ更新した。
- `typecheck` / `check` / `build`: 成功。
- 隔離Playwright全172件成功。専用ポート15189、使い捨て状態、通知無効化、既存サーバー再利用禁止・実bind/state検証のガードを維持。
- 新規回帰: 仕様更新と再起動後も短縮、旧セッションへの新規送信停止、read-only診断、sent/runningの照合維持と早すぎる担当交代拒否、同一Agent IDでのランタイム移行と冪等再試行、各phaseの本文一回、再開引継ぎの重複抑制、既存promptへの再追記拒否。HTTP/CLIで同一仕様revision、未知phase拒否を確認。
- 既存の期限/report、inputs/results、明示採否、正式委任、権限、保存失敗、再起動、通知一回、Codex/Claude native受付照合の回帰を含む。本番のコード・サービス・データ・Agentには移行やテスト操作をしていない。依頼元への指定された途中reportだけを送った。

追加回帰は未送信queued、子結果待ち、生成済みreport待ち、sent/unknown・running拒否、未使用/属性/revision検証、保存失敗rollback、移行後再起動と新規依頼を検証。隔離HTTPでは人間権限拒否/認証済み移行/同一操作再試行の後に依頼・委任・結果・報告・通知一回の実際の経路を通した。ブラウザ全体は既存画面の回帰であり、新操作の画面操作検証ではない。

ブラウザ初回は171成功・1失敗。compact-status fixtureがgraph更新前に変更通知を送り、古い投影を表示する順序競合を修正し、全体再実行で172成功。今回の本体変更による表示機能の変更はない。

追加補足の検証では、移行後の通常/結果/reportの引継ぎ参照、長い補足の全文取得、過去成果・管理者の外部操作メモ、旧通知の隔離を確認。queuedを持った採用の保存失敗→同一operationId再試行→応答喪失相当の再起動→再試行→送信後再試行でも、runtime所有とrun数が変わらず送信一回であることを確認した。通常封筒の再測定は既掲載値と同じ。
