# 実行中Codexへの補足

Directの「実行中に補足」は、現在の人間依頼・workを変更する入力です。新しい依頼や通知権を作りません。執務室／村でも、秘書が一意で同じ条件を満たす場合に利用できます。「待機キューへ」は別依頼を保存してidleを待つ従来の動作です。

## 受付と完了

- 生存・接続確認済みCodex、権限／setup待ちなし、明確なsessionの最新running turn、native受付済みで現在のworkを所有するrunが1件だけの場合に `canSteer` と `steerTarget` を返します。
- UIは添付アップロード前に対象を固定。サーバーは送信前（添付転送後にも）再観測し、一致しなければ送信しません。終了した補足を通常のidle入力へ自動変換しません。
- 同じworkに新runを保存して旧runを `superseded` にし、旧finishを破棄、revisionを進めます。既存子作業と結果は保持します。以後のdelegate/acknowledge/finishは補足に付いた新runを使います。
- 送信成功レスポンスだけでは受理扱いにしません。JSONLのresponse_item/userの明示的turn_id、session、送信後offset、本文全体SHA-256を照合します。既に照合した入力のID/hash/offsetだけを同turnの先行入力として許容します。未知入力、同文の二重イベント、別turn、欠損・不明な帰属はunknownです。
- 新runのfinishと同turnの正常終了だけで依頼全体の通知権を消費します。受付不明を再送しません。補足を含む失敗は副作用・既存子作業を確認して手動retryし、自動過負荷retryの対象にはしません。
- 添付は既存の接続先転送・ハッシュ検証を利用。補足の添付／出張先も後続run・新しい正式委任に引継ぎます。元の依頼内容は変更せず、元requestIdの再照合も維持します。

## API / CLI

`GET /api/direct` の対象Agentで `canSteer:true` と `steerTarget:{runId,sessionId,turnId}` を取得します。その値をそのまま送信してください。

```sh
node scripts/village.mjs requests start '{"agentId":"AGENT_ID","requestId":"NEW_UNIQUE_REQUEST_ID","instruction":"実行中の作業への補足","steerTarget":{"runId":"CURRENT_RUN_ID","sessionId":"SESSION_ID","turnId":"TURN_ID"}}'
```

HTTPは `POST /api/direct/agents/:id/runs` に同じJSON（agentIdはパス）です。照合の再試行では同じrequestId・内容・steerTargetを使用します。target省略は従来どおり独立した人間依頼です。古いクライアントが勝手に補足へ変わることはありません。複数秘書はDirectで宛先を選びます。

## 調査した実装と境界

- ローカルPurpleMux `4a53bf28`: `src/lib/tab-input-runtime.ts`。CLI/browser共通でliteral/bracketed paste → 250ms → Enterを1回。既存のtab送信経路を使用し、PurpleMuxの変更は不要です。
- インストール済みCodex CLIは0.163.0。npm配布物にはRustソースがないため、公式 `openai/codex` の `rust-v0.163.0`（`129b8ec7`）を隔離ディレクトリへ取得して確認しました。
- `codex-rs/tui/src/bottom_pane/chat_composer.rs`: Enterは即時送信、Tabは実行中キュー。
- `codex-rs/tui/src/app/thread_routing.rs` と `app_server_session.rs`: active turnへの `turn/steer`、expected_turn_idを使用。`protocol/src/turn_input.rs` にCoreのSteer/StartOrSteer定義があります。
- **村の観測から端末がEnterを処理する間のturn終了競合を、tab sendだけで原子的に排除することはできません。** Codex側が別turnへ入力を開始／retargetした場合、村はその入力を補足の成功・依頼完了に結び付けずunknownで止めます。ユーザーによる内容・状態確認が必要です。厳密な「別turnに一切入力しない」保証には、PurpleMux側で期待session/turnを指定できるCodex API経路が別途必要です。

## 実機検証

隔離state/server（実通知OFF）で正式APIから一時Codexを作成。sleep 45実行中に正式runs APIで補足し、元runと同じsession/turnでnative受理を確認しました。元入力の受付07:18:38 UTC、補足受付07:18:52 UTC、native完了07:19:45 UTC（2026-11-06）。最終出力は補足指定の `TEST-STEER-ACCEPTED`。新runでfinish、依頼1件・ticket1枚で完了し、通知はdisabledでした。

元のテストworktreeでは信頼確認が出たため送信せず正式stopし、リポジトリ外の空のsandboxで再作成して検証しました。両テストAgentとも正式stopでterminated確認済み。既存Agent／稼働checkout／稼働サービスは変更していません。
