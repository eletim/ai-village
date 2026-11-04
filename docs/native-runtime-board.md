# ネイティブ実行イベントと3拠点画面（2026-11-04）

利用URL: http://100.87.176.23:5173/agents （VPN内）。起動・反映は `systemctl --user restart ai-village-direct.service`。コードは `/home/eletim/DevEnv/ai-village`、ブランチは `feat/direct-workshop-agents`。

## 画面

村長の家（秘書）、E-ryzen（local）、E-frontier（SSH）の順に表示する。上のボタンで全拠点一覧／1拠点の拡大表示を切り替える。各場所の下にCodex／Claude、稼働状態、現在のツール、指示・返答・通知履歴、PurpleMuxタブリンクを表示する。下部の起動フォームで場所・工房・作業場所・種類を選ぶ。秘書はローカル工房を使う。追加指示と対象Agentの終了は各カードで行う。

村の `/` は既存の地図、`/office` は執務室と過去の会話・資料。執務室の新しい会話も村長の家のAgentへ送る。主操作画面は `/agents`。秘書を起動していない場合は明示エラーを返し、裏で別の秘書を生成しない。

## 撤廃した制御

- 返答に実行マーカーを出力させるプロンプトと、マーカー／前回返答の差分／idleを組み合わせた完了判定を削除。
- 秘書のJSON行動選択・JSONスキーマを削除。モデルの返答からdispatch、承認、メモ更新を選ばない。通常の秘書は同じDirectAgents APIで動く。旧単発会話経路も自然文をそのまま返し、CLIの機械イベントで終了を判定する。
- 旧工房bridgeも最新の返答本文や結果フィンガープリントではなく、同じネイティブイベント照合を使う。旧レポート生成はCLIの終了コードで処理結果を確認し、空の本文を失敗条件にしない。
- 本文は成果の内容であり、成功・中断・操作許可を示す制御値ではない。`achievement: unverified` は完了後も維持する。

旧秘書のJSONによる自動工房委譲・自動承認・構造化メモ更新は廃止した。既存履歴、資料、プログラム向け操作APIは保持する。新しい秘書にこれらの操作をさせる場合も、自然文の解析ではなく明示的な操作APIを利用する必要がある。

## 識別と状態

PurpleMuxの `agentSessionId` で対象セッションを限定し、同じ実行ユーザーのネイティブJSONLを読み取る。E-ryzenはローカルCLI／Python、E-frontierはSSH経由。PurpleMuxソースも調査したが、必要な識別情報は既存ランタイム記録にあるためPurpleMuxのコード変更はない。

送信前にsession ID、ファイル識別子（device/inode）、バイト位置、元の指示のハッシュを永続化する。送信確認を保存した後、その位置より後の入力イベントが一意に対応する場合だけnative input ID／turn IDへ結び付ける。ハッシュの対象は人間が送った入力でありAIの返答ではない。以後は同じturnの終了イベントだけを見る。

- Codex: `task_started.turn_id`、user message ID／turn metadata、`task_complete.turn_id`、`turn_aborted.turn_id`。
- Claude: user UUID、parentUuidの連鎖、assistantのネイティブstop_reason。`isApiErrorMessage` はエラーであり正常完了にしない。tool_useは継続。終了の機械的証拠がなければ完了にしない。
- 入力待ちはPurpleMuxのpermissionRequest／CLI状態、起動時の信頼確認はランタイムの確認画面で判定する。AIの自己申告は使わない。
- 接続失敗、記録の欠損・入れ替わり・切詰め、送信確認の消失、未照合の競合入力、同一turnへの追加入力は不明のまま。自動再送しない。
- 送信前の古い結果は候補にならない。PurpleMuxからの別turn入力は別の履歴として表示する。競合が曖昧な場合は自動的に帰属させない。
- 旧マーカー方式で開始済みの未完了実行にはnative checkpointがないため、完了を推測しない。対象Agentの終了は可能。
- バックエンド再起動後は保存済みIDの監視だけを再開。画面を閉じても監視・通知はサーバーで続く。

ランタイムの記録形式への依存はある。64MiB超・複数候補・不正JSONは取得不明とする。Python3と対象ユーザーのセッションログへのアクセスが必要。CLI送信と記録は単一トランザクションではないため、送信確認を保存する前の停止は安全側に倒して不明にする。Claudeの本文だけの中断表現は解析しない。

## 検証

- E-ryzen／E-frontierの新規Codexで、制御文字列を指示せず自由文の返答を取得。初回を並行実行し、実行中にバックエンドを再起動して同じturnの完了を確認。追加指示も別turnとして完了。
- 両工房でPurpleMux CLIから直接入力し、その後のAI村の指示が古い／外部の返答を拾わないことを確認。
- 両工房で実行中の専用検証Agentをinterruptし、両方を中断として保存。正常完了通知なし。
- CLI境界の通信エラーを一時的なラッパーで注入。両工房が不明となり、障害中のバックエンド再起動後も再送せず、接続復旧後に元のturnの完了を取得。物理ネットワーク切断そのものは未実施。
- 村長の家の秘書Codexを同じAPIで起動し、自由文の挨拶を取得。保持して追加指示可能。
- 検証用Claudeの2タブだけをAPIで終了し、各remainingOwned: 0を確認。秘書と両工房のCodexは待機状態で保持。
- Claudeは両工房で起動・指示送信・native user UUIDの照合まで確認。両方とも認証期限切れ（authentication_failed / Login expired）を正常完了と区別して記録。正常な返答と追加指示はログイン更新後の再検証が必要。
- 84件の自動テスト。過去結果、同一内容の競合、同turnへの外部入力、送信確認消失、再起動、ローカル／SSH分離、Claude UUID連鎖とAPIエラー等を含む。
- VPN URLのChromeで3拠点順序、1拠点拡大、390px表示（横はみ出しなし）、JSエラーなしを確認。ブラウザ自動テストは23件成功、既存の条件付き1件skip。構文チェック・buildも成功。
- 検証中は一時的なトークンなし通知設定を使い、完了からNotify呼び出し・失敗記録まで確認。終了時に元の設定へ復元。今回の検証で認証付き通知の配送成功は主張しない。

証跡はGit対象外の `.runtime/validation/native-*.json` とスクリーンショット、監査は `.runtime/ssh-audit.jsonl`、通知履歴は `.runtime/notifications.jsonl`。既存の無関係なAgent／workspaceは停止・変更していない。
