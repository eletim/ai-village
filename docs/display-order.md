# プロジェクトとAgentの表示順

秘書は既存の村CLI/APIから表示順を変更できます。プロジェクト名のドラッグと「…」の「１つ上へ／１つ下へ」でも変更できます。Agentは「…」の「Agentの表示順」でアイコンをドラッグします。数字が小さい順、未指定（null）は指定済みの後ろ。同じ数字の場合、プロジェクトは元の登録順、Agentは従来の作成日時・ID順を保ちます。

```sh
node scripts/village.mjs projects list
node scripts/village.mjs projects order PROJECT_ID REVISION 10
node scripts/village.mjs agents list
node scripts/village.mjs agents order AGENT_ID METADATA_REVISION 20
```

10、20、30のように指定すると間に挿入できます。`null`で指定を解除します。先頭固定は廃止しました。旧保存データにpinnedがあれば、従来の表示順をdisplayOrderへ移してpinnedを削除します。移行は初回のみで、旧revisionの編集は拒否されます。旧projects pinコマンドは削除し、HTTPのpinned指定もエラーにします。

APIは `PUT /api/direct/projects/:id {revision,displayOrder}` と `PUT /api/direct/agents/:id {revision,displayOrder}` です。displayOrderは安全な整数またはnull。古いrevision・不正値は拒否し、保存失敗時は変更前へ戻します。順番は保存され、再起動後も維持されます。

Agentの順番指定はProject所属が必要で、プロジェクト表示（カード、ページ分割、サイドバーの点、休止中のプロジェクト一覧）で適用します。場所別・全Agent表示の順番、実行や通知は変えません。別Projectへの移動や所属解除では順番をリセットします。同じPUTで新所属とdisplayOrderを指定すれば、移動先の順番を設定できます。

「１つ上へ／１つ下へ」は通常一覧・休止一覧それぞれの隣接プロジェクトを対象にします。端ではボタンを無効にします。設定画面を開いたまま連続操作でき、編集中の名前は保持します。ドラッグと同じ一括保存APIを使用します。
