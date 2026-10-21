# AI村

村長が秘書ミクへ自然文で依頼し、工房のレンが実際に制作する最初の実動版です。村の外観とライト配色を保ち、コアPCのCodex → SSH → 工房のPurpleMux CLI → 工房Codex → 秘書Codexのレポートをつなぎます。接続対象は第一工房の1人だけで、ほかの工房・村民は未接続です。

## 起動

コアPC（WSL2 Ubuntu）でNode.js 22以上、認証済みのCodex CLI、パスワード入力なしで接続できる`ssh E-ryzen`が必要です。工房ではPurpleMuxが起動しており、ログインシェルで`purplemux`と認証済みCodexが利用できる必要があります。

```bash
cd /home/koji/DevEnv/ai-village
npm ci
npm run dev
```

Windowsのブラウザで **http://localhost:5173** を開いてください。既定はコアPCの`127.0.0.1:5173`で待ち受けます。実行時の追加npm依存はありません（インストールする依存はブラウザテスト用）。サーバーは通常のWSLターミナルで起動し、Codexが自身の認証・セッション保存先へアクセスできるようにしてください。

村の「村長の家」または「執務室へ」をクリックすると、**http://localhost:5173/office** の執務室へ入ります。秘書ミクに制作内容を入力し、送信します。部屋の出口から村へ戻れます。執務室URLへの直接アクセス・再読み込みにも対応します。第一工房を開いてレンを選ぶか、地図のレンをクリックすると、その依頼用のPurpleMux端末リンクが表示されます。PurpleMuxに未ログインの場合は、先にログインしてから村のリンクをもう一度開いてください。PurpleMux側のログイン画面はリンク先パラメーターを保持しません。

## 設定

環境変数を起動時に設定できます。`.env`ファイルの自動読み込みは行いません。

| 環境変数 | 既定値 | 用途 |
| --- | --- | --- |
| `VILLAGE_SSH_HOST` | `E-ryzen` | SSHの接続先エイリアス |
| `VILLAGE_REMOTE_ROOT` | `/home/eletim/ai-village-workshop` | 工房側の専用作業ルート |
| `VILLAGE_PMUX_URL` | `http://e-ryzen.tail6bc726.ts.net:8022/` | ブラウザから到達するPurpleMux URL |
| `VILLAGE_CODEX_BIN` | `codex` | コア側Codex CLIの実行ファイル |
| `VILLAGE_STATE_DIR` | `.runtime` | 依頼・指示・工房の報告・秘書の報告の保存先 |
| `VILLAGE_POLL_MS` | `2000` | 工房への問い合わせ間隔（ms） |
| `VILLAGE_JOB_TIMEOUT_MS` | `1800000` | 工房の結果を待つ上限（ms） |

```bash
VILLAGE_SSH_HOST=E-ryzen npm run dev -- --port 5173
```

このバックエンドは信頼する利用者がローカルで使う構成です。依頼は実際のCodexと工房へ送信されます。秘書Codexは読み取り専用で指示とレポートを生成し、工房CodexはPurpleMuxの既存起動設定・権限で作業します。複数バックエンドによる同時起動は対象外です。

## 接続と状態

1. `POST /api/jobs`で依頼を受け付け、コア側の`codex exec`で自然文の指示を作ります。
2. SSH越しに専用ディレクトリ`<VILLAGE_REMOTE_ROOT>/<job UUID>`とPurpleMux workspaceを新規作成します。既存workspaceには触れません。
3. `purplemux tab create -w WS -n NAME -t codex-cli`でレンを起動します。workspace作成時の初期terminal tabはそのまま残します。
4. `tab status`で起動を待ち、`tab send`で自然文を送ります。`cliState=busy`の間だけレンがトンカチを振ります。
5. `tab result`から完了した自然文を取得します。画面のcaptureやタイマーから完了を推測しません。専用の新規tabを使うため、以前の依頼の結果は混ざりません。
6. 工房の作業終了時刻を保存し、レンを待機に戻します。コアのCodexで人間向けレポートを作り、別途その完了時刻を保存してUIへ表示します。

状態は`planning → connecting → working → reporting → awaiting_review`。問題があれば`error`です。工房の制作終了と、秘書のレポート完成は別々です。「確認待ち」は工房の結果を受け取り翻訳し終えた状態で、依頼の成否は報告本文で伝えます。工房の許可待ち・接続異常はレンの詳細で確認できます。未接続の村民は働きません。以前のデモ進行はUIから切り離しています。

接続に使うID・状態・リンクはプログラムが管理し、仕事の内容と成果は自然文で扱います。実物の`purplemux --help`・`api-guide`・ソースを確認して実装しました。端末リンクはPurpleMuxの`use-deep-link.ts`に従い、`/?workspace=WS&tab=TAB`を使います。CLIの認証情報は工房側の`~/.purplemux/{port,cli-token}`に任せ、村のUIへ渡しません。

## 保存・再起動・エラー

`.runtime/state.json`のversion 2形式に、現在の仕事IDと全仕事の報告・OK日時・解放状態をまとめて保存します。書き込みは一時ファイルからのrenameで反映します。旧版の単一stateと`<job UUID>.json`の報告は初回起動時に移行し、元の報告・ID・接続先を保持します。旧版の完了ジョブも自動ではOKにせず、確認待ちとして扱います。指示・レポートのCodex出力も同じディレクトリに保存します。これらはgit対象外でHTTPから直接配信しません。制作物は工房側の専用ディレクトリに残ります。

実行中の再起動では同じtabの結果取得を再開し、報告作成中なら取得済みの結果から報告を再作成します。workspace/tab作成や送信は、結果が不明でも自動で再実行しません。接続準備中の再起動はエラーにして、重複作業を防ぎます。

待ち時間超過・SSH異常・中断時にも、工房を自動停止・自動修正しません。端末リンクから状態を確認してください。工房に作業が残っている場合は、完了・中断を確認してから新しい依頼を送ってください。エラー中のリソースは調査用に残します。執務室には過去の報告も表示します。実行エラーで報告が届かなかった仕事は、端末リンクから調査する運用です。

## 報告の確認とAgentの解放

執務室には秘書、机、届いた報告書を部屋として表示します。会話欄と報告書は分けて読みやすくし、報告書には依頼・秘書の説明・成果物のダウンロード・担当AgentのPurpleMuxリンク・工房の元の報告と指示を表示します。

工房の作業が終了しても、村長が報告書の「OK」チェックを入れるまでAgentのセッション情報とtabを保持します。この間レンは**待機中（確認待ち）**です。新しい仕事は、保留中の報告の確認・解放を終えてから受け付けます。

`POST /api/jobs/<job UUID>/approve`がOK日時を保存し、`held → releasing → released`でその仕事のAgentだけを解放します。保存したworkspace/tab・tmuxセッション名・Agent session IDを実際の一覧と照合し、`purplemux tab close -w WS TAB`でプロセス群とtabを終了します。別のtabは閉じません。初期terminal等が残ればworkspaceを保持し、空なら`workspace delete --if-empty`で片付けます。**成果物・作業ディレクトリ・報告・元のIDは削除しません。** 村のレンの配置も解除します。

OKは取り消しません。解放に失敗した場合は`failed`と理由を表示し、「Agentの解放を再試行する」から再試行できます。同じ仕事への並行OKは1つの処理を共有します。解放済みへのOKは何も再実行しません。再起動時に解放中だった場合は成功と推測せず、再試行が必要な状態に復元し、実際の残存tabを確認して続けます。tab closeの応答が失われても、再試行時に存在しないtabへ重ねてcloseを送りません。

成果物は`GET /api/jobs/<id>/artifact?path=<相対パス>`で工房からダウンロードします。最大100ファイル・各10MiB、専用ディレクトリ内の通常ファイルが対象で、シンボリックリンクと`.git`・`node_modules`・`.venv`を一覧から除外します。ダウンロード時にも実パスを確認します。HTML等も添付ファイルとして取得し、開く場合はダウンロード後にブラウザで開いてください。Agent解放後もSSHで取得できます。旧報告は「成果物の一覧を取得する」で列挙できます。

本実装の対象は単一バックエンドです。同じ状態ファイルを複数プロセスから同時に扱う運用は対象外です。

## 検証

```bash
npm run check
npm test
npx playwright install chromium
npm run test:ui
npm run build
```

Nodeテストでは状態遷移、二重依頼の拒否、再起動後の再送防止、中断結果、OKの並行実行、解放失敗・再試行、識別情報の変化、旧報告の移行を確認します。ブラウザテストはAPIを模擬して入退室・直接アクセス・アニメーション・詳細・成果物リンク・OKと解放失敗の再試行・報告保持・モバイル表示を確認し、実際のCodexや工房には依頼しません。APIの入力・Origin検証と非公開ファイルへのアクセス拒否も確認します。ブラウザテストは5173の既存サーバーを使うか、なければテスト用状態ディレクトリで起動します。

`npm run build`は静的UIだけを`dist/`へ出力します。実際の仕事には同一オリジンのバックエンドが必要なので、実動版の利用は`npm run dev`で行ってください。

実環境での制作依頼・確認結果と残る確認事項は[実環境検証記録](docs/live-validation.md)を参照してください。

## 構成

- `server/bridge.mjs` — 秘書Codex、SSH、PurpleMux CLI、結果取得と永続化
- `scripts/dev.mjs` — 同一オリジンのUI/APIサーバー
- `src/office.js` — 執務室の報告書、成果物リンク、OK・再試行UI
- `src/live.js` — 実行状態と村民の活動の対応
- `src/main.js` — 依頼入力、ポーリング、詳細、報告表示
- `src/scene.js` / `src/styles.css` — 村の外観とトンカチ
- `src/simulation.js` — 旧デモ（実動UIからは使用しない）
- `docs/concept.md` — AI村の思想と将来の構成案
