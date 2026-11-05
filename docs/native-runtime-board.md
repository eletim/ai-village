# ネイティブ実行イベントと3拠点画面（2026-11-04）

利用URL: http://100.87.176.23:5173/agents （VPN内）。起動・反映は `systemctl --user restart ai-village-direct.service`。コードは `/home/eletim/DevEnv/ai-village`、ブランチは `feat/direct-workshop-agents`。

## 画面

画面は後続の [Agentワークスペース](agent-workspace-ui.md) で可変拠点・Agentタブ・最大9分割に更新しました。以下の3拠点表示の記述は更新前の記録です。

村長の家（秘書）、E-ryzen（local）、E-frontier（SSH）の順に表示する。上のボタンで全拠点一覧／1拠点の拡大表示を切り替える。各場所の下にCodex／Claude、稼働状態、現在のツール、指示・返答・通知履歴、PurpleMuxタブリンクを表示する。下部の起動フォームで場所・工房・作業場所・種類を選ぶ。秘書はローカル工房を使う。追加指示と対象Agentの終了は各カードで行う。

村の `/` は既存の地図、`/office` は執務室と過去の会話・資料。執務室の新しい会話も村長の家のAgentへ送る。主操作画面は `/agents`。秘書を起動していない場合は明示エラーを返し、裏で別の秘書を生成しない。

## 撤廃した制御

- 返答に実行マーカーを出力させるプロンプトと、マーカー／前回返答の差分／idleを組み合わせた完了判定を削除。
- 秘書のJSON行動選択・JSONスキーマを削除。モデルの返答からdispatch、承認、メモ更新を選ばない。通常の秘書は同じDirectAgents APIで動く。旧単発会話経路も自然文をそのまま返し、CLIの機械イベントで終了を判定する。
- 旧工房bridgeも最新の返答本文や結果フィンガープリントではなく、同じネイティブイベント照合を使う。旧レポート生成はCLIの終了コードで処理結果を確認し、空の本文を失敗条件にしない。
- 本文は成果の内容であり、成功・中断・操作許可を示す制御値ではない。`achievement: unverified` は完了後も維持する。

旧秘書のJSONによる自動工房委譲・自動承認・構造化メモ更新は廃止した。既存履歴、資料、プログラム向け操作APIは保持する。新しい秘書にこれらの操作をさせる場合も、自然文の解析ではなく明示的な操作APIを利用する必要がある。

## 識別と状態

PurpleMuxの `agentSessionId` で対象セッションを限定し、同じ実行ユーザーのネイティブJSONLを読み取る。E-ryzenはローカルCLI／Python、E-frontierはSSH経由。PurpleMuxソースも調査したが、必要な識別情報は既存ランタイム記録にあるためPurpleMuxのコード変更はない。

送信前にsession ID、ファイル識別子（device/inode）、バイト位置、元の指示のハッシュを永続化する。送信意図を保存し、その位置より後の実際の送信全文に一致する入力イベントが一意に対応する場合だけnative input ID／turn IDへ結び付ける。ハッシュの対象は依頼メタデータを含む実送信入力でありAIの返答ではない。以後は同じturnの終了イベントだけを見る。

- Codex: `task_started.turn_id`、user message ID／turn metadata、`task_complete.turn_id`、`turn_aborted.turn_id`。
- Claude: user UUID、parentUuidの連鎖、assistantのネイティブstop_reason。`isApiErrorMessage` はエラーであり正常完了にしない。tool_useは継続。終了の機械的証拠がなければ完了にしない。
- 入力待ちはPurpleMuxのpermissionRequest／CLI状態、起動時の信頼確認はランタイムの確認画面で判定する。AIの自己申告は使わない。
- 接続失敗、記録の欠損・入れ替わり・切詰め、送信意図の欠損、未照合の競合入力、同一turnへの追加入力は不明のまま。自動再送しない。
- 送信前の古い結果は候補にならない。PurpleMuxからの別turn入力は別の履歴として表示する。競合が曖昧な場合は自動的に帰属させない。
- 旧マーカー方式で開始済みの未完了実行にはnative checkpointがないため、完了を推測しない。対象Agentの終了は可能。
- バックエンド再起動後は保存済みIDの監視だけを再開。画面を閉じても監視・通知はサーバーで続く。

ランタイムの記録形式への依存はある。64MiB超・複数候補・不正JSONは取得不明とする。Python3と対象ユーザーのセッションログへのアクセスが必要。CLI送信と記録は単一トランザクションではないため、送信意図だけ残った場合も実入力が一意照合できるまで受付不明にする。Claudeの本文だけの中断表現は解析しない。

## 検証

- E-ryzen／E-frontierの新規Codexで、制御文字列を指示せず自由文の返答を取得。初回を並行実行し、実行中にバックエンドを再起動して同じturnの完了を確認。追加指示も別turnとして完了。
- 両工房でPurpleMux CLIから直接入力し、その後のAI村の指示が古い／外部の返答を拾わないことを確認。
- 両工房で実行中の専用検証Agentをinterruptし、両方を中断として保存。正常完了通知なし。
- CLI境界の通信エラーを一時的なラッパーで注入。両工房が不明となり、障害中のバックエンド再起動後も再送せず、接続復旧後に元のturnの完了を取得。物理ネットワーク切断そのものは未実施。
- 村長の家の秘書Codexを同じAPIで起動し、自由文の挨拶を取得。保持して追加指示可能。
- 検証用Claudeの2タブだけをAPIで終了し、各remainingOwned: 0を確認。秘書と両工房のCodexは待機状態で保持。
- Claudeは両工房で起動・指示送信・native user UUIDの照合まで確認。両方とも認証期限切れ（authentication_failed / Login expired）を正常完了と区別して記録。正常な返答と追加指示はログイン更新後の再検証が必要。
- 84件の自動テスト。過去結果、同一内容の競合、同turnへの外部入力、送信確認消失、再起動、ローカル／SSH分離、Claude UUID連鎖とAPIエラー等を含む。
- VPN URLのChromeで3拠点順序、1拠点拡大、390px表示（横はみ出しなし）、JSエラーなしを確認。ブラウザ自動テストは23件成功、既存の条件付き1件skip。構文チェック・buildも成功。
- 検証中は一時的なトークンなし通知設定を使い、完了からNotify呼び出し・失敗記録まで確認。終了時に元の設定へ復元。今回の検証で認証付き通知の配送成功は主張しない。

証跡はGit対象外の `.runtime/validation/native-*.json` とスクリーンショット、監査は `.runtime/ssh-audit.jsonl`、通知履歴は `.runtime/notifications.jsonl`。既存の無関係なAgent／workspaceは停止・変更していない。

## 人間の依頼全体を1回だけ通知する実装（2026-11-05）

設計のみの制限はユーザー指示で解除された。`server/requests.mjs` のRequestFlowがdirect.jsonへ依頼、作業ツリー、結果受信箱、通知権、通知試行を永続保存する。通常turn完了によるDirectAgentsの通知は撤去。DirectAgents利用中の旧秘書publishも独立通知しない。全Agentの通知を無効化する設定変更ではなく、通知の入口を依頼全体の明示確定へ移した。

### 人間の依頼と受付

/agentsの送信、/officeの送信、正式CLI `requests start` は、クライアントの冪等requestIdから1つのhumanRequestIdを作る。通知権はこの依頼に1枚だけ。Project・Agent・native turnとは別の単位で、追加の通常送信は新依頼になる。同じ依頼の途中応答後の継続はresume、失敗/中断後はretryを明示する。originAgentIdとfinalAgentIdは最初に人間が指定したAgent。直接工房への依頼も同じ仕組みを使う。

送信前に依頼/親子関係・run・接続先Agentを保存し、送信意図、native checkpoint、実際に渡すプロンプト全体のハッシュを保存してからPurpleMuxへ1回送る。成功レスポンスはdispatchConfirmedであり、受付ではない。session/input/turnを一意照合できたときだけacceptance=acceptedとなる。入力欄に残った場合はawaiting_inputで待ち、finishを拒否する。成功レスポンスを失っても、保存済み送信意図と正確なnative入力が一致すれば照合できる。不明な入力を自動再送しない。

全送信プロンプトにhumanRequestId、workId、runId、originAgentId、finalAgentIdと正式操作手順を注入。秘書には登録Agentのdiscoveryも渡す。別PCには設定済み村URLのHTTP APIを案内する。任意の生purplemux tab sendは依頼グラフを登録しないため、この保証の対象外。名前・cwd・返答本文・idleから依頼や委任を推定しない。依頼に属する全委任は正式delegateを使うことが運用上の必須条件で、生CLIの実行自体をOSレベルで禁止する仕組みはない。

### 正式な秘書CLI

コアPCのリポジトリで `node scripts/village.mjs help`。必要ならVILLAGE_URLで村の接続先を指定。以下の大文字値はプロンプトで渡されるID等へ置換する。operationIdは各操作で一意な8〜100文字、通信失敗の再試行時は同じ値を使う。

```sh
node scripts/village.mjs requests get HUMAN_REQUEST_ID
node scripts/village.mjs requests delegate '{"humanRequestId":"HUMAN_REQUEST_ID","parentWorkId":"WORK_ID","actorRunId":"RUN_ID","agentId":"CHILD_AGENT_ID","operationId":"delegate-unique-001","instruction":"子作業の指示"}'
node scripts/village.mjs requests results HUMAN_REQUEST_ID WORK_ID
node scripts/village.mjs requests acknowledge '{"humanRequestId":"HUMAN_REQUEST_ID","workId":"WORK_ID","actorRunId":"CURRENT_RUN_ID","resultIds":["RESULT_ID"]}'
node scripts/village.mjs requests get HUMAN_REQUEST_ID
node scripts/village.mjs requests finish '{"humanRequestId":"HUMAN_REQUEST_ID","workId":"WORK_ID","runId":"CURRENT_RUN_ID","revision":3,"operationId":"finish-unique-001"}'
```

revision=3は例。必ずgetの最新revisionを使う。finishは**最終回答の直前**に登録し、その同じnative turnが正常終了して初めて確定する。子Agentも自分の最終回答前にfinishが必要。秘書は結果を確認・統合してから自身の最終報告runに対してfinishする。途中の「依頼しました」にはfinishしない。全ての直下の子が正常完了し、各最新結果をacknowledgeするまで親のfinishを拒否する。子自身にも同じ制約があるため、孫以下も含めた未完了を残せない。

同じ操作はPOST /api/direct/requests/{get,delegate,results,acknowledge,finish,retry,resume,cancel}で呼べる。getは{humanRequestId}、resultsは{humanRequestId,workId}、その他はCLIと同じJSON。GET /api/direct/requestsで一覧。Agent管理discoveryにも案内を掲載。

### 結果配送と競合

子の正常確定・失敗/中断は永続受信箱へ記録する。結果IDは該当runのIDで一意。人間へ直接通知せず、parentWorkIdに指定された親Agentへ配送する。親Agentが他依頼も含めbusyなら待機する。新しい配送runは元の依頼/親作業へ属し、新しい券を作らない。配送意図を保存してから送信し、実native受付までdispatching、受付後accepted、結果確認後acknowledgedAtを記録。不明な配送は二重送信せず残す。

結果はresultsで取得でき、親が稼働中に取得・確認した場合は不要な後続配送を抑止する。別依頼/別親作業の結果や別runのacknowledge/finishは拒否。複数秘書・同じAgentへの複数依頼もそれぞれのIDを維持する。旧/officeは複数秘書から勝手に先頭を選ばず、agentIdなしなら/agentsで対象を選ぶようエラーを返す。

依頼グラフ操作をサーバー内で直列化し、finishはrevisionと現在runを確認する。子追加と最終確定は競合しない。サーバーは状態ディレクトリを単一所有し、原子的置換とfsyncで保存。重複イベントや同一operationIdは二重子作成・二重finish・二重通知を起こさない。

### 失敗・継続・再起動

- `requests retry JSON {humanRequestId,workId,revision,operationId,instruction,actorRunId?}` は失敗/中断/終了したrunのみ。resumeは途中の正常応答後のみ。子の再試行/継続には親の現在actorRunIdも必要。新しい券は作らず、古い結果をsupersededとし、新しい結果確認が必要。
- `requests cancel JSON {humanRequestId,revision}` は依頼と券をキャンセルし未送信runを停止扱いにする。実行中セッションは勝手に停止しない。キャンセル後に届いた結果も完了通知しない。
- 失敗・中断・入力不明は成功完了にしない。失敗を成功扱いにして子を除外する操作はない。復旧してretryするか全体cancelする。未受付の自動再送もない。
- 旧runはlegacy-untrackedとし、依頼/券を遡って作らない。再起動で過去完了が一斉通知されることはない。現在生CLIで進んでいる既存作業にも自動で券は付かない。新しい村UI送信またはrequests startから適用される。

### 通知と画面

根のfinish＋対応native正常終了時に、status=completed、finalRunId、券consumed、通知pendingを一緒に保存する。通知は `request:humanRequestId` を固定IDとし、外部呼出し前にattemptingを永続化。正常終了が最終確定を意味するのはfinishを明示したrunだけであり、出力文字列の判定はない。finalOutput（native最終回答）を通知本文に使う。

外部Notify CLIには受信端末までのexactly-once確認機能がない。サーバーは1回の送信試行を保証する方針で、送信中停止/応答不明はdelivery_unknownとし、自動再送しない。従って二重通知を避けられるが、障害窓で未着になる可能性は残る。通知失敗は結果・完了画面を取り消さない。失敗/キャンセルの別通知は今回追加していない。

最終確定した依頼だけ「依頼完了・要確認」の強い緑表示とfavicon警告を持つ。通常native完了の控えめな緑は別に維持。Agent選択のviewは表示済みrevisionと比較し、該当Agentの最終依頼を確認済みにする。最終確定をrevisionに含めるため、その直前の古い確認は新しい要確認を消せない。閲覧は券消費を変更しない。

### 今回の検証

隔離した単体テスト、および実HTTPサーバー＋実native JSONLパーサー＋偽PurpleMux/偽通知CLIで、途中返答0、複数子完了0、最終確定1、重複/再起動後も1を検証。入力欄残留、応答消失、busy結果待機、複数秘書/依頼、ネスト、retry/cancel、旧run移行、古いview拒否も対象。実人間への通知テストは送らない。実LLMが手順どおりdelegate/acknowledge/finishを行うか、実Notify端末受信は今回の隔離テストの保証範囲外。

検証結果: Node単体/HTTP 111件成功、関連UI 29件成功（既存28件と追加の執務室再送テスト。入力関連5件を変更後に再検証）、check/build/diff --check通過。ai-village-direct.serviceを再起動して反映。稼働画面で4枚2×2、分類切替と保存、青/緑、390pxの横はみ出しなし、JSエラーなしを確認。既存17Agentの識別情報と2Projectを照合して保持、旧58runはlegacy-untracked、新規依頼0件。実画面検証の書き込みAPI呼出し0件、既存Agentへの送信/停止0件。証跡: /tmp/village-request-deploy-validation.json、/tmp/ai-village-request-live-{projects,places,mobile}.png、/tmp/ai-village-final-request-attention.png。
