# Projectの休止と再開

休止は表示整理だけです。Agentプロセス、所属、会話、正式依頼、通知には作用しません。休止Project内へのAgent追加・移動、会話送信、既存の管理操作も従来どおり可能です。実データへの初期設定や移行は行わず、`suspended` 未指定はactive扱いです。

## UI

- 通常Project一覧の下・週次使用率の上に「休止中（N）」を配置。場所モードからもアクセスできます。
- 各Projectの「…」は対象名つきの専用操作画面を開きます。名前変更・先頭固定・所属を固定したAgent追加・確認付き削除もここから操作できます。全体設定は右上の歯車に残ります。「…」→「休止する」/「再開」。名前と、処理や通知を止めない旨を表示します。失敗時には状態を先取りして変えず、エラーを表示します。競合時は閉じて再度メニューを開き、最新状態を確認してください。
- 休止Projectは通常のProject一覧から移動し、その所属Agentを全体/場所表示から除外します。未所属Agentは引き続き通常表示します。
- 休止欄の選択は再開ではありません。休止のまま会話へアクセスできます。選択復元、9枚単位のグループ、拡大/復帰、下書きは維持します。休止中にProjectが削除されれば全部表示へ戻ります。
- pinnedは削除せず、active一覧と休止一覧のそれぞれで優先します。再開後もpinを維持します。
- 折畳み状態でも作業中/確認待ち/更新/要確認/エラー・不明の件数を表示します。0件の区分は省略。Agentごとの状態アイコン・名前の説明、全体の要確認表示とfaviconは維持します。
- 村マップも休止所属の住人を通常マップから除外。登録工房の建物はそのまま残します。案内板の休止欄に状態集計と `/agents#project-PROJECT_ID` のリンクを設けます。通知の要確認数には休止中も含みます。

## 正式API / CLI

既存Project更新と同じ認証・保存・revision排他を使います。保存先はGit管理外の村state directory内 `direct.json`。

```sh
node scripts/village.mjs projects list
node scripts/village.mjs projects suspend PROJECT_ID REVISION
# 再取得した最新revisionを使用
node scripts/village.mjs projects resume PROJECT_ID NEW_REVISION
```

HTTP: `PUT /api/direct/projects/PROJECT_ID`、JSON `{"revision":N,"suspended":true}`（再開はfalse）。boolean以外は400、古いrevisionは409。削除中・削除済みへの更新は従来どおり拒否。保存失敗は変更をrollback。複数タブ操作は成功した更新だけrevisionが進みます。CLI help/discoveryにも記載しています。

## 制限

非表示化であって、セキュリティ境界・利用停止・通知停止ではありません。正式APIと履歴snapshotには休止Project/Agentも含まれます。折畳み状態はブラウザのlocalStorage、休止設定は村全体の永続設定です。確認済み操作や通知配送の仕組みは変更しません。
