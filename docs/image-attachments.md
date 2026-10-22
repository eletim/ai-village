# 執務室の画像添付

## 実装と入力契約

2026-10-22、工房の実 `codex-cli 0.163.0` の `codex exec --help` で `-i, --image <FILE>...` を確認した。既存の秘書は `codex exec --output-schema ... -` でJSON行動を得る構成のため、この経路に画像ごとの `--image 保存ファイル` 引数を追加した。stdinの会話には画像IDの順序を記載し、画像バイトはCLIがファイルから読む。ファイル名や説明文を画像入力の代わりにしていない。公式のCLI参照入口は https://developers.openai.com/codex/cli/reference （現在 https://learn.chatgpt.com/docs/developer-commands?surface=cli に転送）。適合性の根拠はインストール済みCLIのhelpと、下記の実認識結果である。

今回の村長添付は各判断に渡す。過去画像は `read_image` 行動で指定した画像のみ再入力する。replyのattachmentsは保存IDを検証して、会話JSONへ画像メタデータとともに保存する。画像内の命令は資料であり、操作許可ではないと秘書の上位指示とmanualに明記した。

`server/images.mjs` はsharpでPNG/JPEG/WebPをデコードし、向きを反映してメタデータを除いたPNGとして保存する。8 MiB、2000万画素、静止画、送信4枚／閲覧8枚の制限がある。SVGや任意ファイル配信は追加していない。保存領域は `VILLAGE_STATE_DIR/images`、会話との関連は `conversation.json` のattachments。画像取得はUUIDのみで、固定保存領域のファイルをNOFOLLOWで読む。再起動後も同じ状態ディレクトリを使用する必要がある。

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
