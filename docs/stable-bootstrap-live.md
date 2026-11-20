> 現在は依頼で許可されたAgentも `agents prepare-runtime` / `agents adopt-runtime` を使用できます。以下は人間専用だった時点の検証記録です。現行手順は stable-bootstrap.md を参照してください。

# 段階導入の実機検証（2026-11-20）

一般のfixtureとは別に、PurpleMuxから新規の使い捨てworkspaceと実際のCodex/Claude CLIを起動した。既存の本番Agentへテスト入力を送っていない。実機用ポート15192、別の一時stateディレクトリ、通知無効化を使用し、isolated-browser-serverの起動ログで実際のPID・bind・stateを照合した。旧版9aa66f2の隔離サーバーから起動したstartup-v1のCodexを、同じ隔離stateを使う現行サーバーへ引き継いだ。本番サービスを止めたのではなく、この隔離サーバーだけを入れ替えた。

実行環境: Codex CLI 0.163.0 / GPT-6-Astra medium、Claude Code 2.1.322 / Opus 5.5。実モデルへの通信・実際のCLIツール実行・村のHTTP受付・native終了を確認する検証であり、モデル応答をstubで作っていない。

## 管理者による移行の手順

1. 未使用の新Agentを同じ登録属性で作成する。古い会話を同じCLIへ再注入したと扱わない。
2. 対象親だけに人間専用prepare-runtimeを実行する（operationIdと最新metadataRevision）。現在runは継続し、次の送信だけを保留する。
3. requests getで現在runの正常終了を、Agent/native観測でidleを確認する。実機では稼働中のadopt-runtimeが409で拒否された。受付不明なら外部効果を確認するまで進めない。
4. 親の終了報告・外部操作・未完了事項をhandoverへ記し、同じ人間専用境界からadopt-runtimeを実行する。prepare後の新metadataRevisionと新Agentのrevisionを使う。応答喪失時は同じoperationId/payloadだけを再試行する。
5. 既に保留中の親入力は同じrunで再開する。子結果が後から届くなら通常配送を待つ。依頼がまだactive/submittedでレビュー指示の追記が必要な場合は人間専用requests/supplementへ同じhumanRequestId/workIdで送る。子結果の採否は親自身がrespond/finishで申告する。管理者が子結果を勝手にacceptしない。
6. 人間向け報告と次の新規入力は元のAgent IDから実行する。旧runtimeは保管され、自動停止されない。不要になった検証用runtimeだけを、最後に明示して停止する。

## 確認済みの観測

- 旧親は隔離村へのrespondだけを行い、`OLD-PARENT-READY`で正常終了した。
- 未移行の別startup-v1 Agentは、現行サーバー上で新規依頼と最終報告を完了した（`UNRELATED-COMPAT-OK`）。旧起動契約のままで、当時の7日間の互換情報が保存された。親の補足により最終実装では7日は管理者の確認日に変更し、超過しても自動停止しない。確認日超過の継続は追加の状態/送信経路テストで検証し、この時刻条件変更後に全実機行程は繰り返していない。
- 対象だけをprepareした後、同じ親の補足入力がqueuedで保留され、正常終了・idle後のadoptで同じrunが新sessionへ送られた。
- Claudeは固定bootstrapからwork仕様を取得し、封筒のrevision `8e8cc2c5e21c3f5e82ceb2281490817191c8ef07194fcac069c5db254f1faad3`との一致を確認した。inputsを指定しresults:[]でrespondを実行、`CLAUDE-V2-READY`で正常終了した。
- Claudeの2回目は短い封筒で、同じwork仕様を再取得せずinputs/resultsを指定してfinishし、`CLAUDE-SECOND-OK`で正常終了、最終報告も完了した。

- Codexの新セッションはrules get workを実行し、同revisionを確認。get/inputs/resultsの3つの引継ぎ読取を実行し、respondのinputs/resultsを明示して正常終了。report仕様も取得して人間向け報告を完了した。
- Codexの2回目はnative入力725文字。共通規則・bootstrap本文なし、依頼本文1回。work仕様の再取得なしでfinish inputs/resultsを実行し、`SECOND-CODEX-OK`と最終報告が正常終了した。
- 別の旧Codex親がClaudeへ正式delegateを1回実行して正常終了し、子が`CHILD-FIVE: 5`を提出。親の結果入力がqueuedの境界でprepare済みの親をadoptし、新Codex親が子結果を全文取得して明示accept/finishした。親子ID・queued run IDを維持し、再委任はしていない。
- 仕様更新試験は隔離サーバーへの一時Node preloadでwork仕様の末尾に検証注記を1文追加した（productソースの操作schema変更やモデル応答stubではない）。固定bootstrap・native sessionを変更せず、隔離サービスだけ再起動した。新revisionは `63942c6b853120162856850d6d6cc32c4607390216c9b69338b88e274f319d1a`。
- Claudeは更新後のrules get workを実行し、新revisionとの一致を確認してfinish inputs/results、`SPEC-UPDATE-OK`と最終報告を正常終了した。

生のnativeログ、認証cookie、一時state、内部パスはコミットしない。必要な履歴取得や移行メモは追加コンテキストであり、通常入力の固定費削減と別に数える。SSH接続の実機検証は対象外。

反映管理者は通常の村の画面を開いた同一originで、人間専用APIを操作する。例（画面の開発者コンソール、値は最新診断から指定）:

```js
const humanPost = async (path, body) => {
  const r = await fetch("/api/direct/human/" + path, {
    method: "POST", credentials: "same-origin",
    headers: {"Content-Type": "application/json", "X-Village-Human-UI": "1"},
    body: JSON.stringify(body)
  });
  const result = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(result));
  return result;
};
// prepare: agents/OLD_ID/prepare-runtime
//   {operationId, revision}
// 正常終了・idleを確認後、最新revisionでadopt:
// agents/OLD_ID/adopt-runtime
//   {operationId, revision, replacementAgentId, replacementRevision, handover}
// 既存active依頼へのレビュー補足:
// requests/supplement
//   {humanRequestId, workId, operationId, instruction}
```

これらは管理者が今回許可された反映範囲で行う操作で、Agentの通常CLIへ権限を追加していない。

## 最終結果と後片付け

Codexも更新後のrules get workを実際に呼び、新revisionと一致することを確認してfinish inputs/resultsを申告し、SPEC-UPDATE-OKと最終報告を正常終了した。親子検証の報告もFAMILY-REVIEW-OKで正常終了。8依頼・19runがすべてcompleted、親子検証のreport runは1回だけだった。通知は無効化しており、本番や外部への通知送信試験ではない。

実機再試行の最後で、採用receiptのnewRuntime.inputEnvelopeが現Agentと参照共有され、初回native session IDの観測によりreceiptのmetadataが変わる問題を検出した。ID/所有権/run数の二重化はなかった。product修正はold/new runtimeのdeep copyで、session ID後日確定・再起動後の不変receiptを回帰テストで確認した。実機の最初のreceipt完全一致チェックは失敗として記録し、成功と扱っていない。既存実機記録ではこのsession ID差分だけを特定した上で所有権・run数不変と再試行を確認した。修正後の新規実機採用全行程は繰り返しておらず、この修正の追加検証はコード回帰である。

今回作成した5つのworkspace/AgentをID・専用cwdで照合し、全依頼終了後に停止、残る初期terminalも閉じ、if-empty条件でworkspaceを削除した。隔離サーバーを停止し、旧版の使い捨てcheckoutも削除した。本番サービスや既存Agentは操作していない。

Codexでは一部の受付済みturnで応答開始まで約9分の待ちがあった。旧/新双方で発生し、原因は確定していない。再送やセッション作り直しをせず同じrunを追跡し、最終的にすべて正常終了した。性能改善として扱わない。
