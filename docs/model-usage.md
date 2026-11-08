# セッションのモデルと週次使用状況

プロフィールのモデルは、登録された local/SSH 接続先で既存の native transcript reader が読む、PurpleMux 指定セッションの最終記録です。Codex は `turn_context.payload.model` / `service_tier`、Claude は assistant message の `model` / `usage.speed` を使用します。設定ファイルの既定モデルや名前からは推測しません。記録後の未記録の設定変更は分かりません。Fast/Tier が記録されなければ不明です。セッション不一致、接続不能、不完全な読取では取得不能に戻します。

週次欄は村サーバー（コアPC）の `~/.purplemux/rate-limits.json` の読取専用adapterです。PurpleMux の `src/types/status.ts`、`src/lib/statusline-script.ts`、`src/lib/codex-rate-limits-cache.ts`、`src/pages/api/status/statusline.ts` の形式に対応し、各 provider の `seven_day.used_percentage` / `resets_at` / provider `ts` だけを公開します。キャッシュにアカウント識別子がないため、特定Agentのアカウントの使用状況とは断定せず、他PCやアカウントとも合算しません。

サーバー読取は60秒キャッシュ・同時実行統合、3秒タイムアウト。ブラウザは表示中60秒ごと（復帰時も更新）、5秒タイムアウト。15分より古い、またはリセット時刻を過ぎた記録は「古い記録」です。期限切れを0%に換算しません。不正・欠落・読取失敗は不明とし、認証情報や元ファイルの任意フィールド、エラー詳細を公開しません。取得APIは既存の村API認証内の `GET /api/direct/usage` です。

PurpleMux本体、プロバイダーの設定・モデル・Fast・アカウントは変更しません。APIはプロバイダーへの追加問い合わせや通知を行いません。
