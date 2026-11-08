# AI村の現在の入口

標準は **[Agent Workspace](/agents)** です。Directの正式登録（Agent・場所・Project）とrequestsの会話・親子作業・完了記録を正とします。村マップは登録の別表現であり、名前やcwdから所属を推測しません。

## Projectの秘書方針

[村実装の短い方針](projects/village-implementation.md)を、[Project IDとの対応設定](projects/index.json)で明示しています。対象Projectの秘書の通常runだけに取得案内を渡します。worker・他Project・報告専用runには付けません。

- CLI: `node scripts/village.mjs projects guide PROJECT_ID`
- HTTP: `POST /api/village` に `{"argv":["projects","guide","PROJECT_ID"]}`（既存認証）。CLIのないSSH側でも村の接続可能なURLを使えます。
- 毎回ファイルを読み直し、本文とhashを返します。未設定・欠落・取得不能は `available:false`。文書変更でruntime登録を書き換えません。案内は本文を埋め込まず、今回の判断前に取得するよう求めます。

## 互換実装の境界

`compat/` は旧jobs/旧秘書の互換情報です。通常の書棚一覧から除外しています。旧「工房1つ・Agent1人」「ミク/レン固定」の運用メモは廃止しました。

- `compat/manual.md`: 旧Secretariatの操作前hash検証が必要な操作仕様。
- `compat/development.md` と `compat/workshops/`: 旧Development/WorkshopBridgeが読む設定と手順。Direct登録とは別系統で、現行の接続先の原本ではありません。
- `compat/session-continuity.md`: 旧秘書の継続・診断の説明。

旧API・保存済みjobs・互換設定の読み取りは維持します。古い文書パスは互換読み取りへ解決します。旧執務室はWorkspaceへの入口を案内しますが、旧会話やjobsをDirectの記録に変換する処理はありません。新規の仕事はWorkspaceで扱ってください。
