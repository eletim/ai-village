# Agent返信のMarkdown表示

Agent返信は共通レンダラでMarkdownとして表示します。Directの返信と終了Agentの履歴、村／執務室の秘書会話、執務室の報告書・工房出力に適用します。ユーザー入力と保存された指示本文の表示は従来のままです。保存データを書き換えず、過去の返信も表示時に解釈します。

見出し、段落、強調、箇条書き・番号リスト、引用、GFMテーブル、inline code、fenced code、リンクに対応します。通常テキストの単一改行も表示上保持します。コードは等幅表示で、長いコードと表は領域内で横スクロールできます。構文ハイライトは追加していません。

PR7のMermaidと `![説明](village-image:UUID)` はそのまま利用でき、クリック・キーボードで拡大できます。未閉じfenceはコードとして表示し、閉じた安全なMermaid fenceだけ描画対象にします。不正な図は読めるソースを残します。Markdownの画像は保存済みvillage-image参照以外を文字表示し、外部画像をfetchしません。

[Markedのrenderer拡張](https://marked.js.org/using_pro#renderer)を使い、HTMLトークンをescape、リンク先をHTTP(S)と既存の村の成果物ダウンロードURLに限定します。危険なscheme、プロトコル省略URL、資格情報入りURLはリンク化しません。HTML埋込・JavaScript・任意SVGは実行せず文字として表示します。Mermaid側のstrict設定・DOMPurifyによるSVGサニタイズはPR7から維持しています。

Markedはpackage-lockで固定し、`npm ci`のpostinstallまたは`npm run build`で `src/vendor/marked.mjs` とライセンスをローカル配信します。CDNや実行時の外部パーサ取得は不要です。install scriptを無効化する場合はbuildを明示的に実行してください。生成vendorとdistはGit管理外です。

同じpollの本文はDOMを置換せず、返信伸長時も既存の図・画像ノードを再利用します。既存の自動スクロール・履歴閲覧・最新へ移動・Ctrl+Enter・IME入力仕様を維持します。

このPRのbaseは `feat/visual-reports`（PR7、42b4c73）です。PR7の図・画像基盤が必要で、mainへ単独適用する変更ではありません。PR5/6/8/9の変更は取り込んでいません。稼働反映は統合レビュー後に別途行ってください。
