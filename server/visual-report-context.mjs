export function visualReportContext(cli,apiBase){
 return '\n図は必要時のみfenced mermaid（設定変更・HTML・外部URL禁止）。画像は '+cli+' images upload LOCAL_FILE、CLIがなければPOST '+apiBase+'/api/images?name=report.png（Content-Type: image/png、画像本体・既存認証）。返却された ![説明](village-image:UUID) を本文に記載。ファイルは実行PC上のものを使用し、内部パス・外部画像URLは公開しない。通常の文字報告を維持。\n';
}
