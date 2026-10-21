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

依頼欄へ制作内容を入力し、送信します。第一工房を開いてレンを選ぶか、地図のレンをクリックすると、その依頼用のPurpleMux端末リンクが表示されます。PurpleMuxに未ログインの場合は、先にログインしてから村のリンクをもう一度開いてください。PurpleMux側のログイン画面はリンク先パラメーターを保持しません。

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

状態は`planning → connecting → working → reporting → completed`。問題があれば`error`です。工房の制作終了と、秘書のレポート完成は別々です。「報告完了」は工房の結果を受け取り翻訳し終えた意味で、依頼の成否は報告本文で伝えます。工房の許可待ち・接続異常はレンの詳細で確認できます。未接続の村民は働きません。以前のデモ進行はUIから切り離しています。

接続に使うID・状態・リンクはプログラムが管理し、仕事の内容と成果は自然文で扱います。実物の`purplemux --help`・`api-guide`・ソースを確認して実装しました。端末リンクはPurpleMuxの`use-deep-link.ts`に従い、`/?workspace=WS&tab=TAB`を使います。CLIの認証情報は工房側の`~/.purplemux/{port,cli-token}`に任せ、村のUIへ渡しません。

## 保存・再起動・エラー

`.runtime/state.json`に現在の状態、`<job UUID>.json`に依頼ごとの結果を保存します。指示・レポートのCodex出力も同じディレクトリに保存します。これらはgit対象外でHTTPから直接配信しません。制作物は工房側の専用ディレクトリに残ります。

実行中の再起動では同じtabの結果取得を再開し、報告作成中なら取得済みの結果から報告を再作成します。workspace/tab作成や送信は、結果が不明でも自動で再実行しません。接続準備中の再起動はエラーにして、重複作業を防ぎます。

待ち時間超過・SSH異常・中断時にも、工房を自動停止・自動修正しません。端末リンクから状態を確認してください。工房に作業が残っている場合は、完了・中断を確認してから新しい依頼を送ってください。workspaceと成果は調査用に残し、自動削除はしません。UIに表示する現在の依頼は最新1件です。

## 検証

```bash
npm run check
npm test
npx playwright install chromium
npm run test:ui
npm run build
```

Nodeテストでは状態遷移、二重依頼の拒否、再起動後の再送防止、中断結果の扱いを確認します。ブラウザテストはAPIを模擬してアニメーション・詳細・リンク・報告保持を確認し、実際のCodexや工房には依頼しません。APIの入力・Origin検証と非公開ファイルへのアクセス拒否も確認します。ブラウザテストは5173の既存サーバーを使うか、なければテスト用状態ディレクトリで起動します。

`npm run build`は静的UIだけを`dist/`へ出力します。実際の仕事には同一オリジンのバックエンドが必要なので、実動版の利用は`npm run dev`で行ってください。

実環境での制作依頼・確認結果と残る確認事項は[実環境検証記録](docs/live-validation.md)を参照してください。

## 構成

- `server/bridge.mjs` — 秘書Codex、SSH、PurpleMux CLI、結果取得と永続化
- `scripts/dev.mjs` — 同一オリジンのUI/APIサーバー
- `src/live.js` — 実行状態と村民の活動の対応
- `src/main.js` — 依頼入力、ポーリング、詳細、報告表示
- `src/scene.js` / `src/styles.css` — 村の外観とトンカチ
- `src/simulation.js` — 旧デモ（実動UIからは使用しない）
- `docs/concept.md` — AI村の思想と将来の構成案
