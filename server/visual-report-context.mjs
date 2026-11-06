export function visualReportContext(cli,apiBase){
 return '\n図が説明に役立つ場合は返信本文に fenced mermaid（例: ```mermaid\nflowchart LR\n A[依頼] --> B[確認]\n```）を使えます。図の設定変更・HTML・外部URLは使わないでください。生成グラフ/スクリーンショットは '+cli+' images upload LOCAL_FILE で保存し、返された ![説明](village-image:UUID) を返信本文に書くとインライン表示・拡大できます。CLIのファイルは実行PC上のものです。他PCでCLIがなければPOST '+apiBase+'/api/images?name=report.png に Content-Type: image/png と画像本体を送ってください（村の既存認証を使用）。サーバーファイルパスや外部画像URLは公開しません。必要な時だけ使い、通常の文字報告は維持してください。\n';
}
