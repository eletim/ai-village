# AI村

村長と秘書ミクが会話し、資料を読み、進めると合意した仕事を工房のレンが実際に制作する実動版です。村の外観とライト配色を保ち、コアPCのCodex → SSH → 工房のPurpleMux CLI → 工房Codex → 秘書Codexのレポートをつなぎます。接続対象は第一工房の1人だけで、ほかの工房・村民は未接続です。

## 起動

コアPC（WSL2 Ubuntu）でNode.js 22以上、認証済みのCodex CLI、工房資料に記載した接続先へパスワード入力なしで接続できるSSHが必要です。通常の会話と資料閲覧には工房接続は不要です。工房ではPurpleMuxが起動しており、ログインシェルで`purplemux`と認証済みCodexが利用できる必要があります。

```bash
cd /home/koji/DevEnv/ai-village
npm ci
npm run dev
```

Windowsのブラウザで **http://localhost:5173** を開いてください。既定はコアPCの`127.0.0.1:5173`で待ち受けます。実行時の追加npm依存はありません（インストールする依存はブラウザテスト用）。サーバーは通常のWSLターミナルで起動し、Codexが自身の認証・セッション保存先へアクセスできるようにしてください。

村の「村長の家」または「執務室へ」をクリックすると、**http://localhost:5173/office** の執務室へ入ります。秘書ミクへ相談や質問、実行指示を送ります。挨拶や相談だけで工房を起動しません。部屋の出口から村へ戻れます。執務室URLへの直接アクセス・再読み込みにも対応します。第一工房を開いてレンを選ぶか、地図のレンをクリックすると、その依頼用のPurpleMux端末リンクが表示されます。PurpleMuxに未ログインの場合は、先にログインしてから村のリンクをもう一度開いてください。PurpleMux側のログイン画面はリンク先パラメーターを保持しません。

## 設定

環境変数を起動時に設定できます。`.env`ファイルの自動読み込みは行いません。

| 環境変数 | 既定値 | 用途 |
| --- | --- | --- |
| `VILLAGE_LIBRARY_DIR` | `village` | 村長と秘書が読む資料のルート |
| `VILLAGE_CODEX_BIN` | `codex` | コア側Codex CLIの実行ファイル |
| `VILLAGE_STATE_DIR` | `.runtime` | 依頼・指示・工房の報告・秘書の報告の保存先 |
| `VILLAGE_POLL_MS` | `2000` | 工房への問い合わせ間隔（ms） |
| `VILLAGE_JOB_TIMEOUT_MS` | `1800000` | 工房の結果を待つ上限（ms） |

```bash
npm run dev -- --port 5173
```

このバックエンドは信頼する利用者がローカルで使う構成です。依頼は実際のCodexと工房へ送信されます。秘書Codexは読み取り専用で指示とレポートを生成し、工房CodexはPurpleMuxの既存起動設定・権限で作業します。複数バックエンドによる同時起動は対象外です。

## 秘書との継続した会話

`POST /api/messages`の`{"message":"自然文"}`で会話します。旧`POST /api/jobs`も同じ秘書の会話へ渡す互換入口で、自動的な制作ジョブの起動口ではありません。

実際のCodex CLIの同じ永続セッションで会話し、構造化出力で行動を選びます。固定のキーワード判定はありません。

| 秘書が選ぶ行動 | 処理 | 工房へのSSH |
| --- | --- | --- |
| `reply` | 回答・相談・提案を自然文で返す | なし |
| `read_document` | 相対パスでMarkdown原本を読む | なし |
| `read_state` | コアのジョブ・Agentの保存状態を読む | なし |
| `check_workshop` | 最新の工房資料から接続先を取得し、設備・PurpleMux・現在のAgentを読み取り専用で照会 | あり、Agentは起動しない |
| `village` | マニュアルを読み、共通の操作窓口から仕事の検索・キャンセル・承認・片付けなどを実行。操作の追加はレジストリで行い、LLM行動enumの追加は不要 | 検索はなし、停止・解放はあり |
| `dispatch` | 明確な指示・文脈上の合意に基づく仕事を工房へ渡す | あり、専用Agentを起動 |

例えば「作れそう？」では相談を続け、続く「では、それで作って」は前の提案への合意として扱います。最初から「作って」と明確な指示がある場合は、同じ同意確認を挟まず進められます。進行中・確認待ちの仕事があっても会話できます。新規Agentの配置は従来どおり1件に限定され、前の仕事が保留なら秘書がその状況を説明します。

Codexのプロセスは判断ごとに起動しますが、通常は `codex exec resume セッションID` で同じ会話を継続します。新しい発言と直前の操作結果だけを渡し、全文履歴や引き継ぎメモを毎回再送しません。短いワーキングメモ、送信位置、切替意図、操作記録を `conversation.json` version 3に保存します。メモは最大4000文字の置換方式で、回答と同じ原子的保存に含めます。対象セッションの実測コンテクストが80%に達した時、または観測不能時の保守的なローカル予算で新セッションへ切り替えます。累積課金トークンは判定に使いません。コンテクスト上限・セッション消失は回数を限定して復旧し、一般エラーは自動再試行しません。操作途中の停止では成否不明の操作を再実行しません。仕様・限界・診断・検証方法は [秘書のセッション継続](village/session-continuity.md) を参照してください。

## 村の資料

操作方法の原本は[村の操作マニュアル](village/manual.md)です。村長の明確な指示があれば、秘書自身が対象を調べ、実際にキャンセルや承認を実行し、結果を再照会して説明します。

原本は[村の案内](village/README.md)、[第一工房の資料](village/workshops/first-workshop.md)、[運用メモ](village/operations.md)です。執務室の書棚か「村の資料」から、同じファイルの本文を閲覧できます。秘書の回答には参照したファイルへのボタンが付きます。

工房資料の先頭に次のキーを置きます。値の原本は工房資料にだけ記載します。

```text
---
name: 工房の名前
ssh_host: SSHの接続先エイリアス
purplemux_url: ブラウザで開くPurpleMuxのURL
work_root: 工房の専用作業ルートの絶対パス
---
```

`---`の下は自由なMarkdownです。設備・特徴・確認した事実・未確認事項を自然文で追記してください。接続情報はこのファイルを更新するだけで次の参照・実行へ反映されます。旧`VILLAGE_SSH_HOST`・`VILLAGE_REMOTE_ROOT`・`VILLAGE_PMUX_URL`は使用しません。

`GET /api/documents`で目次、`GET /api/documents/content?path=<相対パス>`で本文を取得します。ファイルをキャッシュせず、UIは開き直し・「資料を読み直す」で再取得します。秘書も資料の回答にあたってそのターンで原本を読み、実行・状況照会前に読んだファイルと現在のハッシュが一致することを検証します。別の接続先をモデルの出力から直接受け取ることはありません。資料の場所を指定し直す場合だけ`VILLAGE_LIBRARY_DIR`を変えます。

資料を編集するための画面はありません。ファイルをエディタで変更してください。ソース変更や再ビルドは不要です。UTF-8のMarkdown、1ファイル128KiBまで。先頭の接続情報は単純な`key: value`（必要ならJSON形式の二重引用文字列）を使い、複雑なYAML構文は使いません。資料ルートの外や外を指すシンボリックリンクは読めません。

設備の記録は現在の稼働状態ではありません。現在値が必要なときだけ状況照会を選びます。接続先・設備・得意分野を秘書のプロンプトやUIへ重複して埋め込まず、初期資料も実際に確認した情報だけを記載しています。

## 接続と状態

1. 会話の中でCodexが実行を選んだとき、読んだ工房資料と会話に基づく自然文の指示でジョブを作ります。
2. SSH越しに専用ディレクトリ`<工房資料のwork_root>/<job UUID>`とPurpleMux workspaceを新規作成します。既存workspaceには触れません。
3. `purplemux tab create -w WS -n NAME -t codex-cli`でレンを起動します。workspace作成時の初期terminal tabはそのまま残します。
4. `tab status`で起動を待ち、`tab send`で自然文を送ります。`cliState=busy`の間だけレンがトンカチを振ります。
5. `tab result`から完了した自然文を取得します。画面のcaptureやタイマーから完了を推測しません。専用の新規tabを使うため、以前の依頼の結果は混ざりません。
6. 工房の作業終了時刻を保存し、レンを待機に戻します。コアのCodexで人間向けレポートを作り、別途その完了時刻を保存してUIへ表示します。

状態は`planning → connecting → working → reporting → awaiting_review`。問題があれば`error`です。工房の制作終了と、秘書のレポート完成は別々です。「確認待ち」は工房の結果を受け取り翻訳し終えた状態で、依頼の成否は報告本文で伝えます。工房の許可待ち・接続異常はレンの詳細で確認できます。未接続の村民は働きません。以前のデモ進行はUIから切り離しています。

接続に使うID・状態・リンクはプログラムが管理し、仕事の内容と成果は自然文で扱います。実物の`purplemux --help`・`api-guide`・ソースを確認して実装しました。端末リンクはPurpleMuxの`use-deep-link.ts`に従い、`/?workspace=WS&tab=TAB`を使います。CLIの認証情報は工房側の`~/.purplemux/{port,cli-token}`に任せ、村のUIへ渡しません。

## 保存・再起動・エラー

`.runtime/state.json`のversion 2形式に、現在の仕事IDと全仕事の報告・OK日時・解放状態をまとめて保存します。書き込みは一時ファイルからのrenameで反映します。旧版の単一stateと`<job UUID>.json`の報告は初回起動時に移行し、元の報告・ID・接続先を保持します。旧版の完了ジョブも自動ではOKにせず、確認待ちとして扱います。会話は同じ保存先の`conversation.json`に、村長・秘書の発言、参照・照会の結果、報告との対応を保存します。UIは再読み込み・サーバー再起動後も会話を復元します。会話処理中に再起動した場合は中断を伝え、自動で実行をやり直しません。資料更新後も過去の会話で読んだ内容は履歴として残ります。指示・レポート・会話の判断用Codex出力も同じディレクトリに保存します。これらはgit対象外でHTTPから直接配信しません。制作物は工房側の専用ディレクトリに残ります。

実行中の再起動では同じtabの結果取得を再開し、報告作成中なら取得済みの結果から報告を再作成します。workspace/tab作成や送信は、結果が不明でも自動で再実行しません。接続準備中の再起動はエラーにして、重複作業を防ぎます。

待ち時間超過・SSH異常・中断時にも、工房を自動停止・自動修正しません。端末リンクから状態を確認してください。工房に作業が残っている場合は、完了・中断を確認してから新しい依頼を送ってください。エラー中のリソースは調査用に残します。執務室には過去の報告も表示します。実行エラーで報告が届かなかった仕事は、端末リンクから調査する運用です。

## 報告の確認とAgentの解放

執務室には秘書、机、届いた報告書を部屋として表示します。会話欄と報告書は分けて読みやすくし、報告書には依頼・秘書の説明・成果物のダウンロード・担当AgentのPurpleMuxリンク・工房の元の報告と指示を表示します。

工房の作業が終了しても、村長が報告書の「OK」チェックを入れるまでAgentのセッション情報とtabを保持します。この間レンは**待機中（確認待ち）**です。新しいAgentの配置は、保留中の報告の確認・解放を終えてから行います。通常の会話や資料参照は続けられます。

`POST /api/jobs/<job UUID>/approve`がOK日時を保存し、`held → releasing → released`でその仕事のAgentだけを解放します。保存したworkspace/tab・tmuxセッション名・Agent session IDを実際の一覧と照合し、`purplemux tab close -w WS TAB`でプロセス群とtabを終了します。別のtabは閉じません。初期terminal等が残ればworkspaceを保持し、空なら`workspace delete --if-empty`で片付けます。**成果物・作業ディレクトリ・報告・元のIDは削除しません。** 村のレンの配置も解除します。

OKは取り消しません。解放に失敗した場合は`failed`と理由を表示し、「Agentの解放を再試行する」から再試行できます。同じ仕事への並行OKは1つの処理を共有します。解放済みへのOKは何も再実行しません。再起動時に解放中だった場合は成功と推測せず、再試行が必要な状態に復元し、実際の残存tabを確認して続けます。tab closeの応答が失われても、再試行時に存在しないtabへ重ねてcloseを送りません。

成果物は`GET /api/jobs/<id>/artifact?path=<相対パス>`で工房からダウンロードします。最大100ファイル・各10MiB、専用ディレクトリ内の通常ファイルが対象で、シンボリックリンクと`.git`・`node_modules`・`.venv`を一覧から除外します。ダウンロード時にも実パスを確認します。HTML等も添付ファイルとして取得し、開く場合はダウンロード後にブラウザで開いてください。Agent解放後もSSHで取得できます。旧報告は「成果物の一覧を取得する」で列挙できます。

ジョブには資料から選んだ接続情報を作成時に保存します。資料が後で変更されても、そのジョブの結果取得・ダウンロード・解放には元の接続先を使います。

本実装の対象は単一バックエンドです。同じ状態ファイルを複数プロセスから同時に扱う運用は対象外です。

## 村の操作と机の片付け

机には未確認・実行中・エラー・停止や解放が未確認の仕事だけを置きます。OKとAgent解放が完了した報告、キャンセルと停止・解放の確認が済んだ仕事は自動で消えます。追加の片付け操作は不要です。通常画面には過去の一覧や件数を置きません。会話の文章・報告・成果物・作業ディレクトリは保存したままです。過去の成果を秘書に尋ねたときの村内ダウンロードリンクは、会話から開けます。

既存記録も、`approvedAt`があり`releaseState: released`なら、古い`phase: awaiting_review`のままでも処理済みと判定します。当時の事実を推測で書き換えません。`src/job-state.js`の同じ判定をUIと操作窓口で使います。解放に失敗した報告は机に残り、OK日時を保持して再試行できます。

起動中のサーバーに接続するCLIとHTTP APIがあります。詳細は[操作マニュアル](village/manual.md)を参照してください。

```bash
node scripts/village.mjs help
node scripts/village.mjs jobs list
node scripts/village.mjs jobs get JOB_ID
node scripts/village.mjs jobs cancel JOB_ID --reason "村長からの指示"
node scripts/village.mjs reports approve JOB_ID
node scripts/village.mjs history search --query "過去の依頼"
node scripts/village.mjs history get JOB_ID
```

`VILLAGE_URL`でCLIの接続先を指定できます（既定`http://127.0.0.1:5173`）。HTTPは`POST /api/village`、本文`{"argv":["jobs","list"]}`。CLI・API・秘書の`village`行動は同じ`server/operations.mjs`の拡張可能なコマンドレジストリを使用します。シェル文字列を実行する口ではありません。秘書は変更操作の前にそのターンの最新マニュアルを読む必要があり、自然文の対象理解・操作の選択は実Codexが行います。変更結果は保存済みstate.jsonから読み直し、操作監査を`operations.jsonl`に残します。`ok: false`や`verification.confirmed: false`を成功と解釈しないでください。

実行中のキャンセルは`cancelRequestedAt`を先に保存し、コアのその仕事のCodexを停止します。進行中のSSHによる作成は返答を待ってIDを記録してから、専用のPurpleMux Agent tabを閉じます。作成結果不明・接続不能・識別情報不一致の場合は推測で他のtabを閉じず、停止・解放未確認のまま机に残します。同じキャンセルで再試行できます。完了は`cancelledAt`・`stopConfirmedAt`・`releasedAt`と確認情報で記録し、その後に机から下げます。

同一仕事の停止・解放は処理を共有し、完了済み操作の繰り返しではSSHを実行しません。再起動で停止確認が中断した場合も自動で再送せず、未確認として復元します。古いエラーでworkspace/tabのIDがない場合は、作業場所に対応するworkspaceとAgent関連プロセスがないことを調べ、確認できたときだけ片付けます。対応するリソースを安全に特定できなければ未確認のままです。

## 検証

```bash
npm run check
npm test
npx playwright install chromium
npm run test:ui
npm run build
```

Nodeテストでは会話の復元、資料更新、ファイル境界、行動選択と実行先の契約、SSH照会失敗からの会話継続に加え、状態遷移、二重依頼の拒否、再起動後の再送防止、中断結果、OKの並行実行、解放失敗・再試行、識別情報の変化、旧報告の移行を確認します。ブラウザテストはAPIを模擬して入退室・直接アクセス・アニメーション・詳細・成果物リンク・OKと解放失敗の再試行・報告保持・モバイル表示、会話のみでは工房が動かないこと、資料閲覧と再取得を確認し、実際のCodexや工房には依頼しません。APIの入力・Origin検証と非公開ファイルへのアクセス拒否も確認します。ブラウザテストは5173の既存サーバーを使うか、なければテスト用状態ディレクトリで起動します。

`npm run build`は静的UIだけを`dist/`へ出力します。実際の仕事には同一オリジンのバックエンドが必要なので、実動版の利用は`npm run dev`で行ってください。

実環境での制作依頼・確認結果と残る確認事項は[実環境検証記録](docs/live-validation.md)を参照してください。

## 構成

- `village/` — 村長と秘書が読むMarkdown原本
- `server/library.mjs` — 資料の読み込みと接続情報の解釈
- `server/secretariat.mjs` — Codexによる会話・行動選択と会話の永続化
- `src/conversation.js` / `src/library.js` — 会話履歴と書棚の閲覧
- `server/bridge.mjs` / `server/processes.mjs` — 秘書Codex、SSH、PurpleMux CLI、対象プロセスの停止確認、結果取得と永続化
- `server/operations.mjs` / `scripts/village.mjs` — 共通の村操作窓口・CLI、結果確認と監査
- `server/notifier.mjs` — notify CLIによる非同期通知、期限、重複防止と監査
- `src/job-state.js` — 処理済み判定と机の表示状態
- `scripts/dev.mjs` — 同一オリジンのUI/APIサーバー
- `src/office.js` — 執務室の報告書、成果物リンク、OK・再試行UI
- `src/live.js` — 実行状態と村民の活動の対応
- `src/main.js` — 依頼入力、ポーリング、詳細、報告表示
- `src/scene.js` / `src/styles.css` — 村の外観とトンカチ
- `src/simulation.js` — 旧デモ（実動UIからは使用しない）
- `docs/concept.md` — AI村の思想と将来の構成案

停止・解放では、実物のPurpleMuxで確認したmanaged tmux socket `purple`と対象のsession名からpane PIDを取得し、その子孫を一時停止してPIDとLinuxの開始時刻を保存します。tab close後に、別プロセス群へ移った専用ツールもpidfdで同一性を確認して停止します。他のtabのプロセス木は除外し、専用作業場所に所有関係が不明な残存プロセスがあれば成功にしません。この接続アダプターは現在のLinux/PurpleMux実装を対象とします。

## ブラウザを閉じて使う

ブラウザは村の表示・操作の窓口です。依頼を送信してサーバーが受け付けた後は、ページを閉じても、秘書Codexの判断・SSHでの工房起動と監視・成果取得・秘書の報告作成がバックエンド内で続きます。ブラウザのポーリングや接続維持は仕事を進める条件ではありません。再び `/office` を開けば、保存された会話・報告・Agentの状態を表示します。

**コアのバックエンドが稼働している必要があります。** `npm run dev` のターミナル、WSLやコアPCを終了すると処理は続きません。ブラウザを閉じることと、Nodeバックエンドを止めることは別です。ターミナルも閉じて使う場合はtmuxや既存のサービス管理でバックエンドを起動してください。サーバー再起動時の復元・未確認処理の扱いは前述のとおりです。

## AWM方式の通知

[AWMのnotifier.py](https://github.com/eletim/agent-workflow-manager/blob/main/src/purplemux_client/notifier.py)・[notification_settings.py](https://github.com/eletim/agent-workflow-manager/blob/main/src/purplemux_client/notification_settings.py)と、[公式notify CLI](https://github.com/eletim/notify-server#notify-cli)を確認した実装です。NotifyServer本体は追加せず、既存サーバーへ次のCLI形式で送信します。

```bash
notify send --title 'AI村からのお知らせ' --message '通知の内容' --click '端末から到達できる執務室URL'
```

通常回答、工房へ依頼した返答、成果から作成した秘書の報告、会話エラーの返答が対象です。新しいユーザー向けメッセージを会話ファイルへ保存した後、コア側で非同期に1回送信します。資料参照や内部ツール結果は対象外。会話と報告書の二重表示・ページ再表示・履歴復元・再起動で過去の通知を再送しません。

### notify CLIの導入と認証

AWM等で導入済みなら、そのCLIと設定をそのまま利用できます。なければ公式のCLIだけを導入します（Bashとcurlが必要）。

```bash
notify_install_dir=$(mktemp -d)
mkdir -p "$notify_install_dir/bin"
curl -fsSL https://raw.githubusercontent.com/eletim/notify-server/main/install-cli.sh -o "$notify_install_dir/install-cli.sh"
curl -fsSL https://raw.githubusercontent.com/eletim/notify-server/main/bin/notify -o "$notify_install_dir/bin/notify"
bash "$notify_install_dir/install-cli.sh"
export PATH="$HOME/.local/bin:$PATH"
notify --help
```

既定の設定ファイルは `${XDG_CONFIG_HOME:-$HOME/.config}/notify/config`。別の既存設定を使うなら `NOTIFY_CONFIG` を指定します。設定ファイルには次のキーを置き、実際のサーバー・topic・トークンへ置き換えてください。**トークンはこのリポジトリや村の資料へ書きません。**

```text
NOTIFY_SERVER=https://your-notify-server.example
NOTIFY_TOPIC=agents
NOTIFY_TOKEN=tk_REPLACE_WITH_YOUR_TOKEN
NOTIFY_CONNECT_TIMEOUT=5
NOTIFY_TIMEOUT=15
```

```bash
chmod 600 "$HOME/.config/notify/config"
export NOTIFY_CONFIG="$HOME/.config/notify/config"
```

CLIは設定ファイルを送信のたびに読み、明示的な環境変数 `NOTIFY_SERVER`・`NOTIFY_TOPIC`・`NOTIFY_TOKEN` 等がファイルより優先されます。CLIの通信タイムアウトは秒単位。HTTPSが基本で、loopbackの開発用接続だけHTTPを許します。インストーラーの初期値はサーバー `https://eletim.jp`・topic `agents` ですが、トークンは空です。初期ファイルを作っただけでは送信できず、利用する受信先と認証情報の確認が必要です。

### 村の起動とテスト送信

| 環境変数 | 既定値 | 内容 |
| --- | --- | --- |
| `VILLAGE_OFFICE_URL` | なし | 通知を開く端末から到達できる完全な `http(s)://…/office` URL。未設定・不正なら送信を見送る |
| `VILLAGE_NOTIFICATIONS` | `true` | `false` / `0` / `off` で通知を無効化 |
| `VILLAGE_NOTIFY_BIN` | `notify` | CLI実行ファイル。PATH外なら絶対パスを指定 |
| `VILLAGE_NOTIFY_TIMEOUT_MS` | `10000` | コア側の送信期限。最大30000ms |
| `NOTIFY_CONFIG` 等 | CLIの設定に従う | 通知先・topic・トークンはCLIへ継承し、村のAPIでトークンを読み出さない |

Windowsの同じPCで開く場合の例です。別の端末で通知を受けるなら、その端末から到達できるコアのアドレスに変更してください。localhostをコードへ固定してはいません。

```bash
cd /home/koji/DevEnv/ai-village
export NOTIFY_CONFIG="$HOME/.config/notify/config"
export VILLAGE_OFFICE_URL="http://localhost:5173/office"
npm run dev
```

別ターミナルで起動中の村に対して確認・テスト送信できます。

```bash
node scripts/village.mjs notifications status
node scripts/village.mjs notifications test
```

`notifications test` はテスト通知1件を実送信し、失敗時はCLI終了コードが非0になります。秘書にも、マニュアルを読んで設定状況の確認や、明確に指示されたテスト送信を実行する窓口があります。設定変更は設定ファイル/環境変数で行います。村側の環境変数を変更した場合はバックエンドを再起動してください。notifyの設定ファイルだけの変更なら再ビルド・再起動は不要です。

通知は会話や仕事の完了処理を待たせません。CLI失敗・接続不能・タイムアウトでも返答・成果・報告は保存され、通常どおり利用できます。期限を超えたCLIのプロセス群は終了します。本文は先頭2000文字まで。結果は状態ディレクトリの `notifications.jsonl` にメッセージIDと固定の診断だけを記録し、CLIのstdout/stderrやトークンは記録しません。`notifications status` の最後の結果から確認できます。

`sent` / `delivered: true` はCLIが終了コード0で返り、サーバーが受理したことを示します。端末への受信・表示・クリックまで確認したという意味ではありません。送信途中でバックエンドが停止すると受理の有無が不明な場合があります。二重通知を避けるため過去の自動再送は行わず、必要なら別のテスト送信で確認します。

## 外部資料を読み、村自身を修正する

秘書にはGitHub/WebのURLをそのまま渡せます。`web read URL` を実行して本文と取得元・参照ブランチ・確定commitを読み、相談や仕事の指示へ利用します。GitHubのREADME・branch/tag/commitのファイル・ディレクトリ・Issue・PRを扱い、通常のWebは静的HTMLの本文を取得します。本文50000文字、Web応答1MB、コメントやPR差分の件数に上限があり、切り詰めを明示します。動的なブラウザ処理やログイン代行はしません。失敗時は未取得として扱います。

GitHubはWSLのGitHub REST APIを使用します。既存のgh認証、またはGH_TOKEN/GITHUB_TOKENを私有環境から使えます。ChatGPTプラグインの接続は仮定しません。取得した外部文章は未信頼の資料として扱い、操作許可へ置き換えません。認証値をURL、会話、資料、Gitへ記録しないでください。

村の開発対象の原本は [village/development.md](village/development.md) です。工房接続は同資料が指す既存の工房資料から取得します。秘書は `development start --task TEXT` を選び、通常のレンの実行経路へつなぎます。コアのパスは工房で使わず、仕事専用の作業場所にcloneし、割当ブランチで修正・検証・commit・Pushします。

工房に有効なGitHub認証がないため、コアの認証を使う仕事専用Git HTTP接続をSSH逆転送します。認証値は工房へ渡さず、Push先はその仕事専用ブランチだけに制限します。工房がPushしたcommitはコアからGitHubへ照会して確認し、自然文の報告から推測しません。接続はAgent解放時またはコア停止時に終了します。

村長が反映まで指示した場合は `development start --task TEXT --apply`、工房の報告を見て後から反映する場合は `development apply JOB_ID` を使います。結果は `deployments list/get` で確認できます。秘書に自然文で頼む例：

- 「https://github.com/eletim/agent-workflow-manager を読み、通知の実装ファイルまで調べて説明して」
- 「この村の執務室の副題を○○へ変えて。工房で検証・commit・Pushし、この村へ反映して結果を報告して」
- 「その仕事のcommitを村へ反映して。再起動後の確認結果も教えて」

`npm run dev` は `scripts/supervise.mjs` でバックエンドを起動し、反映時の再起動を管理します。起動コマンドとURLは従来どおりです。直接 `node scripts/dev.mjs` を使った単独の検証サーバーでは反映再起動の管理をしません。`/api/health` に起動時commit・instanceId・監視下かを返します。

反映処理はバックエンドから独立し、対象commitの作業ツリーで依存導入・check・Nodeテスト・独立ポートのブラウザテスト・buildを行います。その後、コアがクリーンか再確認し、開発ブランチへfast-forwardで取り込み、ビルド・再起動・稼働commit・執務室・保存会話/仕事の復元を確認してPushします。未commit変更はstash/reset/上書きせず停止します。mainへのマージはしません。失敗後もどこまで適用されたかを反映記録に残し、自動ロールバックはしません。

記録と実行時のrunnerは `.runtime/deployments/` に保持され、起動した秘書が再起動で中断しても結果を照会できます。秘書は完了記録を実Codexで説明し、保存後に既存の非同期通知を行います。工房の完成報告と、村に反映した結果の報告は別です。OK・Agent解放も反映とは独立し、反映しても村長のOKまではAgentを保持します。
