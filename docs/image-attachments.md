> 現行の秘書は `/agents` の村長の家のランタイムを共有します。旧JSONスキーマによる行動選択は廃止済みです。詳しくは [現行仕様](native-runtime-board.md) を参照してください。

# 執務室の画像添付

## 実装と入力契約

2026-10-22、工房の実 `codex-cli 0.163.0` の `codex exec --help` で `-i, --image <FILE>...` を確認した。既存の秘書は `codex exec --output-schema ... -` でJSON行動を得る構成のため、この経路に画像ごとの `--image 保存ファイル` 引数を追加した。stdinの会話には画像IDの順序を記載し、画像バイトはCLIがファイルから読む。ファイル名や説明文を画像入力の代わりにしていない。公式のCLI参照入口は https://developers.openai.com/codex/cli/reference （現在 https://learn.chatgpt.com/docs/developer-commands?surface=cli に転送）。適合性の根拠はインストール済みCLIのhelpと、下記の実認識結果である。

今回の村長添付は各判断に渡す。過去画像は `read_image` 行動で指定した画像のみ再入力する。replyのattachmentsは保存IDを検証して、会話JSONへ画像メタデータとともに保存する。画像内の命令は資料であり、操作許可ではないと秘書の上位指示とmanualに明記した。

`server/images.mjs` はsharpでPNG/JPEG/WebPをデコードし、向きを反映してメタデータを除いたPNGとして保存する。静止画、送信4枚／閲覧8枚の制限がある。SVGや任意ファイル配信は追加していない。保存領域は `VILLAGE_STATE_DIR/images`、会話との関連は `conversation.json` のattachments。画像取得はUUIDのみで、固定保存領域のファイルをNOFOLLOWで読む。再起動後も同じ状態ディレクトリを使用する必要がある。

`images list` と `images import JOB_ID RELATIVE_PATH`、`jobs artifacts JOB_ID` を操作窓口に追加した。成果物は登録一覧との照合、相対パス制限、既存成果物取得処理の実パス境界、画像デコードを通した後にコアへコピーする。後の表示には工房接続が不要。秘書のreplyのattachmentsによって既存画像を会話へ提示できる。

UIはファイル選択、クリップボード貼り付け、プレビュー取消し、画像のみ／文章併用送信、画像拡大、失敗表示を備える。送信失敗時は入力と添付を保持する。執務室の絵は上部154px（狭い画面132px）、会話は全幅、報告書は下に配置した。既存副題、仕事状態、承認・解放、通知、会話保存の経路は保持した。画像だけの秘書返信の通知には画像到着の短い文を使う。

## 検証の再現

```
npm ci
npm run check
npm test
VILLAGE_TEST_PORT=5197 VILLAGE_TEST_STATE="$PWD/.runtime/ui" PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome npm run test:ui
npm run build
# 実Codexを呼び出す独立検証（外部通知無効、独立ポート5198）
node scripts/verify-images.mjs
```

実検証スクリプトは実Chromeのcanvasでランダム文字列を描き、画像内容を説明しないファイル名・質問で貼り付け送信する。ランダム文字列はプロンプトに渡さない。実Codexの文字列・色の回答、再読み込み、バックエンド再起動（instanceId変更）、read_image経由の再閲覧・秘書添付、狭い画面、画像のみ送信を検証する。代替Codex応答はこの検証には使っていない。

初回成功記録: `source/.runtime/image-verification-final/result.json`。実応答は「左から順に、赤い円、青い正方形、緑の三角形」「A6CB62」。Chromeは131.0.6778.264。実画像 `sample.png`、画面 `desktop.png` / `mobile.png`、会話・Codex構造化応答は同じディレクトリに保持した。UIスクロール調整後の再検証も成功し、別のランダム文字列「97CCAD」と同じ図形を正しく認識した。記録は `source/.runtime/image-verification-reviewed/` に保持する。これらは工房内の成果で、Gitへは検証スクリプトとテストを収録する。

Nodeテストでは不正形式、切断画像、容量・画素・枚数超過、不正ID、保存領域のsymlink、成果物の外部symlink、実Python成果物読取処理、取り込み後の元画像削除、会話復元と秘書の添付を検証する。CLI引数の捕捉テストは実認識テストと区別している。最終結果は構文チェック成功、Node 51件成功、実Chrome UI 8件（既存6件＋画像2件）成功、ビルド成功。

## 範囲と未確認点

稼働コアへの反映、Agent承認・解放、他workspace/tabの操作、外部通知送信は行っていない。リモート工房の新しい仕事を起動して画像成果物を作る実験は行っていない。成果物取得は既存のSSH経路を使用し、追加経路は独立ローカルの仕事ディレクトリで実Python読取・保存・返信まで検証した。

アップロード成功後に送信失敗・取り消しになった画像は保存領域に残る。自動削除や保存容量全体の管理は今回追加していない。会話と画像をまとめてバックアップすること。対応ブラウザ検証はLinuxの実Google Chrome（PC幅1440px、狭い画面390px）であり、iOS Safari等の実機は未確認。

## 2026-11-05 共通添付・依頼継承・スクロール

現行のAgent直接指示と村／執務室の人間入力は、＋メニューに「出張先を追加」「画像を追加」「ファイルを追加」を集約した。添付のみでも送信可能。画像は既存ImageStoreのデコード／向き補正／PNG再保存を利用する。PDF、txt、CSV、JSON、Markdown、log、YAML、TSV、XMLはデータファイルとして保存する。添付は4件まで。画像・ファイルの容量と画像の画素数に村独自の上限は設けない。プレビュー／名前・サイズ／削除を表示する。

選択中のファイル本体と保存済みレコードはIndexedDBに保存し、同一タブの下書きIDとAgent IDごとに分離する。追加直後の再読み込みで保存前のファイルを失わないよう、保存後にプレビューを表示する。削除済みファイルは同期的な下書きマスクでも除外する。アップロード済みIDを再利用し、受付不明の再送は同じrequestIdと同じ添付ID列を使う。サーバーも同じrequestIdで内容を変更した再送を拒否する。サーバー未反映時はcapabilities.attachmentsを確認してアップロード／送信を止め、既存下書きを保持する。

POST /api/attachments?name=NAME はraw bodyのアップロード。GET /api/attachments/:UUID は画像のプレビューまたはデータのダウンロード。どちらも全API共通のHost／Origin／VPN-peer／設定済みBasic認証チェックを通り、例外トークンや認証迂回は設けない。名前を保存パスに使わずUUIDを使い、symlinkを追わない。画像以外はapplication/octet-stream、Content-Disposition: attachment、nosniff、CSP sandboxで返す。HTML／SVGや実行ファイルは受付対象外。テキスト内のHTMLを解釈しない。旧画像APIと保存画像IDも維持する。

依頼と各runのattachmentsに正規化したレコード（ID、名前、種別、サイズ、SHA-256）を保存し、正式delegate、内部結果配送、resume/retryへ継承する。生ファイル内容をプロンプトに混入させず、Agentに渡す前に接続先へ転送する。

- localはコアと同じ実行ユーザーで固定Python受信プログラムを実行する。
- SSHはAgentに登録済みのsshHostへBatchModeで接続し、固定受信プログラムのstdinでバイト列を渡す。出張先添付のSSH名やユーザーのファイル名を接続コマンドへ使わない。API認証情報もAgentへ渡さない。
- 接続先の/tmp/ai-village-attachment-*（0700）にdata.拡張子（0600）として保存し、内容のSHA-256とサイズを照合してから、その接続先のパスをプロンプトに付ける。任意のファイル名・内容はシェルソースにしない。実行権限を付けず、自動実行しない。
- 転送失敗時はpromptを送らず依頼をqueuedに残し、30秒後以降に転送を再試行する。転送後にもAgentの待機状態を再確認し、実native入力の照合は既存経路を維持する。再送／新しい子runでは新たに転送するため、コアだけに存在するパスを別PCへ送らない。

転送コピーはOSの一時領域であり、OS再起動や清掃後の同じパスの存続は保証しない。原本はコアのimages/attachmentsに保持し、次のrunで再転送する。アップロード後に取り消した原本、失敗した転送で残った一時コピーの全体容量管理・自動GCは今回の範囲外。未使用ファイルを依頼履歴と誤って一緒に消す処理は追加していない。

会話欄は共通chatScrollコントローラを各Agent／秘書会話へ適用。初回、自己送信、最下部付近での新着・応答伸長・画像loadに追従する。読者が上へ移動した場合は位置を保持し、読み返し中の「最新へ」で追従を再開する。Agentごとの位置と追従状態を保存し、Project／場所／ページ／拡大切替でも維持する。Ctrl+Enter／IME保護と状態配色は変更しない。

検証は隔離HTTPサーバー、実Pythonの保存／転送処理、認証ありのHTTPアップロード／ダウンロード、ローカルとSSHコマンド境界を分けた転送試験、ブラウザによる下書き／添付のみ送信／再送／スクロールを実施。SSH境界試験ではSSH呼出しを隔離したプロセスへ差し替え、実受信プログラムでバイトと保存先を照合した。稼働工房への実SSH転送や実LLMによるPDF／画像読取は行っていない。既存Agentへの送信・停止、登録変更、サービス再起動、push、PR作成も行わない。

旧執務室の画像依頼は本文にコア画像パスを付加して保存されていたため、その送信結果照合は保存済み入力との完全一致を確認して旧requestIdのまま返す。新しい依頼にこの形式を使わない。画像のブラウザ表示は互換の/api/imagesを使い、静的ファイルだけ新しい時点でも既存画像を表示できる。

検証結果: Node単体／HTTP 117件成功。ブラウザ57ケース成功、既存の専用Codex境界を要求する1ケースは条件未設定でskip（全体56件＋追加1件、添付／スクロール7件を最終調整後に再検証）。check/build/diff --check成功。画面は1440pxと390pxで確認。画像: /tmp/ai-village-files-direct.png、/tmp/ai-village-files-office.png、/tmp/ai-village-file-menu-mobile.png。本番バックエンドはレビュー後の再起動待ち。今回の作業では再起動・push・PR作成、既存Agentの送信／停止・登録データ変更は行っていない。

秘書レビュー：旧版の数値だけのスクロール保存値は初回に最新追従へ移行し、新着がなくても読み返し中は「最新へ」を表示する。E-frontierへの検証用テキストの実SSH転送・SHA-256一致も確認し、検証コピーは削除済み。

### 容量制限撤廃のレビュー補足（2026-11-06）

アップロードだけでなく、成果物一覧・成果物画像の取り込みに残っていた10 MiB制限を撤廃。成果物本体を取得する場合だけ転送標準出力の容量制限を外す。通常のコマンド出力制限、接続タイムアウト、登録成果物との照合、実パス境界、破損画像拒否、添付件数制限は維持する。

追加検証では10 MiBを超え、base64転送も旧15 MB出力制限を超える実PNGを一覧から発見・取り込み・再取得し、元データとの一致を確認。ハッシュが一致しない同サイズの転送データの拒否と、Projectの並べ替えが保存順・所属を変えないことも確認した。実SSH接続の再検証は行わず、接続先で実行するPythonを隔離ローカル環境で検証した。


Projectの表示順は固有名ではなく、実行時登録の `pinned: true` を優先する。未設定は非pin。`projects list` でIDとrevisionを取得し、`projects pin PROJECT_ID REVISION true`（解除はfalse）で更新する。名前変更は従来の `projects rename` を利用でき、pinを維持する。HTTPは `PUT /api/direct/projects/:id` に `{revision,pinned:true}`。実登録の変更・自動移行は含めない。

## 2026-11-06 返信本文の図・画像

assistant本文のMermaidと保存画像参照、アップロードCLIを追加した。画像報告の `/api/images` とImageStoreにはバイト・画素上限を設けない。詳細・配信ビルド・安全な描画範囲・既存PRとの統合範囲は[visual-reports.md](visual-reports.md)を参照。
