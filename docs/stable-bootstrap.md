# 固定起動契約と更新される操作仕様

## 判断と旧設計

e14e289では安定した共通規則を起動時に、本文・識別・今回の資料だけを各入力に分け、全文指紋で受付を照合した。その後、操作仕様と起動規則が同じ全文になり、direct.initのハッシュ更新検出でstartup-v1をlegacyへ戻した。既存developer/system指示はファイル更新で変わらないという検出自体は必要だが、常時全文fallbackは短縮を失い、古い高優先度指示との衝突も解決しない。

contract 2は短い起動契約だけをセッションへ導入する。操作仕様は `server/agent-rules.mjs` を正本に `rules get work|report` と `GET /api/direct/rules?phase=work|report` で返す。CLI helpの操作schemaも同じagentActionsから生成する。仕様にrevision（SHA-256）を付け、封筒にそのrevisionを載せる。初回・revision変更時だけAgentが該当phaseの仕様を取得し、同revisionを確認する。未取得・不一致・取得失敗は推測せず作業を止めて報告する。ポーリングや新しいタイマーは追加しない。

起動契約のハッシュは仕様本文に依存しない。通常の操作仕様更新とサービス再起動でstartup-v2を失わない。起動契約自身・接続URL/CLI経路・native sessionの変更は新しい起動境界を必要とする。仕様は権限を増やさない。現在の権限検証、正式委任、report/deadline、inputProtocol、inputs/results、明示accept/rework、申告run正常終了による確定は変更しない。

## 封筒

本文を一度、discoveryとrequestを一度送る。requestには識別情報、contract、rulesRevision、inputProtocol、期限の値、対象入力を載せる。入力全文が本文に含まれる場合は `textInInstruction:true` で参照し、複製しない。他の入力は2000文字の抜粋・truncated・textSourceUnavailable・結果参照を維持する。報告はquestion/finalResult等の資料とphaseを送る。通常/委任/結果/補足/報告とも共通規則・全API一覧は封筒に入れない。長い原依頼や必要な引継ぎ資料を「固定費」として数えない。

受付指紋は最終的に送った全文から作成する。過去に送信した本文、hash、runID、native受付照合は一切書き換えない。Claudeのpaste変換の照合とCodexのnative重複判定は従来どおり。

## 旧秘書を移す具体手順（反映管理者が実施）

この実装は本番へ移行操作をしていない。**反映後は旧startup-v1/legacyのAgentへ新たな入力を送らない**。既存の未受付/実行中runの観察は継続する。新規送信は実行前に `startup-contract-migration-required` で停止し、旧runが実行済みだったことにはしない。全文fallbackは行わない。旧セッションの古いdeveloper指示を無効化したとはみなさない。

1. 反映前に通常の状態バックアップを取る。進行中依頼と送信済み/受付不明の境界を確認し、新規投入を控える。反映は管理者が担当する。
2. 反映後、正式CLI `agents instructions OLD_AGENT_ID` で診断する。旧秘書は依頼で指定されたAgent IDを使う。返却はread-onlyで、契約、旧理由、追跡中run、queued、未完了の依頼/作業/revisionを返す。履歴や台帳ファイルを手編集しない。
3. 通常の `agents create JSON` で同じProject・local工房・作業場所・providerの**新Agent**を作成する。新しいworkspace生成→固定契約導入receipt保存→Agent起動の順。古いAgent IDのmodeだけを書き換えない。既存tabへのinstallInstructionsは拒否し、既存契約ブロックのあるpromptへの再追記も拒否する。
4. 新Agentの `agents instructions NEW_AGENT_ID` でstartup-v2とrequiresFreshSession=falseを確認する。これは起動準備のreceiptであり、liveモデルの記憶を読み取った証明ではない。最初の送信直前に実ファイルを再検証し、native session変化も検出する。
5. 旧runのsent/running（受付不明を含む）は同じrunIDで観察を継続し、未完了だからと新Agentへ再送しない。終端を確認し、成果・外部効果を確認してから引継ぐ。queuedは送信取消を確定するか、契約停止が記録されるまで待ち、受付不明と混同しない。
6. 未完了の各依頼を `requests get` で読み、人間専用API `POST /api/direct/human/requests/resume`（正常終了後）または`retry`（失敗/中断/確認できずの終端後）を使う。既存の人間認証・Origin/cookie/X-Village-Human-UIを維持し、{humanRequestId,workId,agentId:NEW_AGENT_ID,revision,operationId,instruction}を指定する。instructionは「既存成果・外部効果・子結果・未対応inputsを確認し、未完了分だけ引継ぐ」等、既存目的に沿った引継ぎとする。同一operationId再試行は同じpayload。IDや依頼を新規発行して再委任しない。担当先の変更で受付中のrunを移すことはサーバーが拒否する。
7. 原依頼・入力ID・子依頼・対応履歴が維持され、新runだけが新担当へ送られたことを確認する。完了済み依頼は再開しない。旧Agent停止は別の管理判断であり、この移行は自動停止しない。

現状の復旧画面には担当交代先の選択UIがないため、手順6は管理者による人間専用API操作が必要。Agent用CLIへ人間の復旧権限を開放していない。進行中の旧セッションを無停止でstartup-v2へ変更する機能は提供しない。全員を一括停止・再作成する処理もない。

## 失敗・再起動・ロールバック

起動ファイルの不在・読取失敗・ハッシュ不一致・native session変更はmigration-requiredとして診断可能にする。復元されたファイルだけで自動復帰せず、新しい起動境界を要求する。未送信runを停止した記録と、送信済み/受付不明の事実を区別する。保存失敗時は既存のtransaction rollbackが適用され、外部送信は成功した保存の後だけ行う。仕様取得はread-onlyで台帳に受付や完了を追加しない。

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

- 最終 `npm test`: 525件中524成功・条件付き1skip・失敗0。初期実行で旧「全文fallback」期待のテストを新しい診断停止契約へ更新した。
- `typecheck` / `check` / `build`: 成功。
- 隔離Playwright全172件成功。専用ポート15189、使い捨て状態、通知無効化、既存サーバー再利用禁止・実bind/state検証のガードを維持。
- 新規回帰: 仕様更新と再起動後も短縮、旧セッションへの新規送信停止、read-only診断、sent/runningの照合維持と早すぎる担当交代拒否、終端後の明示交代と冪等再試行、各phaseの本文一回、再開引継ぎの重複抑制、既存promptへの再追記拒否。HTTP/CLIで同一仕様revision、未知phase拒否を確認。
- 既存の期限/report、inputs/results、明示採否、正式委任、権限、保存失敗、再起動、通知一回、Codex/Claude native受付照合の回帰を含む。本番のコード・サービス・データ・Agentには移行やテスト操作をしていない。依頼元への指定された途中reportだけを送った。
