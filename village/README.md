# AI村の現在の入口

標準は **[Agent Workspace](/agents)** です。Directの正式登録（Agent・場所・Project）とrequestsの会話・親子作業・完了記録を正とします。村マップは登録の別表現であり、名前やcwdから所属を推測しません。

## Projectの秘書方針

[村実装の短い方針](projects/village-implementation.md)を、[Project IDとの対応設定](projects/index.json)で明示しています。対象Projectの秘書の通常runだけに取得案内を渡します。worker・他Project・報告専用runには付けません。

- CLI: `node scripts/village.mjs projects guide PROJECT_ID`
- HTTP: `POST /api/village` に `{"argv":["projects","guide","PROJECT_ID"]}`（既存認証）。CLIのないSSH側でも村の接続可能なURLを使えます。
- 毎回ファイルを読み直し、本文とhashを返します。未設定・欠落・取得不能は `available:false`。文書変更でruntime登録を書き換えません。案内は本文を埋め込まず、今回の判断前に取得するよう求めます。

## 文書と旧データ

[設計基準](../docs/architecture.md)と[対象リポジトリ](repository.md)を参照してください。
工房の接続先はDirectの登録が正本です。旧jobs用の工房文書は使いません。
旧API・執務室画面は廃止。旧state.json/conversation.jsonは読み書きせず、そのまま残します。
