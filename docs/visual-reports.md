# 図・画像による返信

Agent直接画面と村／執務室のassistant本文で利用できる。文字だけの報告も従来どおり。人間入力や通常のコードブロックを図として解釈しない。

````text
処理の流れです。
```mermaid
flowchart LR
 A[依頼] --> B[検証] --> C[報告]
```
````

図や画像はクリックまたはボタンへのフォーカス＋Enterで拡大できる。閉じるボタン・Escapeに対応し、元のボタンへフォーカスを戻す。不正な図、閉じていないfence、利用不可の機能は読めるソースを残す。

画像はCLIを実行するPCのファイルをアップロードする。工房がSSH先でも、コアのパスをそのまま渡す必要はない。

```bash
VILLAGE_URL=http://village-host:5173 node scripts/village.mjs images upload ./report.png
```

返された`reference`（`![説明](village-image:UUID)`）をassistantの返信本文へ記載する。PNG/JPEG/WebPの静止画を既存ImageStoreでデコードし、安全なPNGへ再保存する。保存は`VILLAGE_STATE_DIR/images`（通常`.runtime/images`）、Git管理外。新規アップロードは1ファイル40 MiB・2400万画素まで。同時処理等の制限は docs/resource-limits.md を参照。既存保存画像の読取は維持する。

CLIがないPCからは既存認証付きの`POST /api/images?name=report.png`へ画像バイトを送れる。

```bash
curl --fail-with-body -H 'Content-Type: image/png' --data-binary @report.png \
  'http://village-host:5173/api/images?name=report.png'
```

認証が必要な公開環境では既存の認証方式を使う。CLIでは通常の`VILLAGE_PUBLIC_ORIGIN`と`VILLAGE_AUTH_FILE`を設定する。HTTPは成功応答の`id`を上記参照形式にする。APIにサーバーファイルパスを渡して公開する機能はない。`images upload`はクライアント専用で、`/api/village`からサーバーローカルファイルを読ませることはできない。外部URL、file/data/javascript URL、任意HTMLは画像参照として受け付けない。

## 配信と安全性

`npm ci`のpostinstall、または`npm run build`で、lockfileのMermaidとDOMPurifyを`src/vendor`へ配置する。buildはdistにもコピーする。外部CDN不要。生成vendorはGit管理外で、ライセンスもコピーする。スクリプト実行を無効化したinstallでは明示的にbuildが必要。

[Mermaid公式のstrict設定](https://mermaid.js.org/config/usage#securitylevel)を利用し、HTMLラベルを無効化。本文からの設定ディレクティブ、HTML、画像／外部URL、click、style/classDef/linkStyleは描画せずソース表示にする。出力SVGをDOMPurifyでサニタイズしてからSVG画像文書として表示し、リンク・スクリプト・foreignObject・外部画像等を除去する。Mermaidのイベントバインドは実行しない。複雑な設定付き図が必要なら、Agent側で画像化してアップロードする。

同じpollではDOMを変更せず、更新時も同じ図・画像のノードを再利用する。既存のAgentごとのスクロール追従／履歴閲覧とCtrl+Enter・IME入力処理を維持する。

## PRの範囲と検証

origin/mainから独立worktreeで実装。未マージPR5/6のProject設定・復旧機能は含めない。画像報告に必要なImageStoreと`/api/images`の容量／画素上限撤廃だけはPR5と共通修正。当時は上限を撤廃したが、後続の資源制限修正で新規アップロードに上限を導入した。既存添付全般の上限撤廃はPR5側の範囲。

単体／HTTPは安全な本文分割、認証付きCLIによる8 MiB超実PNGの保存・再起動後取得、破損画像／SVG／サーバーパスの拒否を検証。ブラウザは実Mermaid、画像upload→本文→拡大、キーボード、危険参照・不正／途中図のfallback、pollと返信伸長でのDOM再利用、村／執務室、既存スクロール・リンク・IMEを検証。実Agentへの送信や稼働デプロイは行わない。
